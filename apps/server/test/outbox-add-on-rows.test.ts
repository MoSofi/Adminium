// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON'S ROWS FOR AN ORDER, LISTED IN ITS MAIL AND ON ITS RECEIPT.
 *
 * The rows are the add-on's; each says which row it belongs to by a pair it
 * stores — that row's table, by its stored name, and its key as text. A mail's
 * rows block and a document's list find them by that pair: this order's, and
 * never another's, nor a row of another table that happens to carry the same
 * key. With the add-on absent or switched off for the app the list is empty
 * and the mail still goes.
 */
import { documentProfilesRepo, documentSequencesRepo, settingsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { createWriteService } from '../src/crud/write-service.js';
import { renderDocument } from '../src/documents/render.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { createOutboxProducers } from '../src/outbox/producers.js';
import { createOutboxSender, type OutboxSender } from '../src/outbox/sender.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { CARDS_KIT, cardsKitManifest, shopManifest } from './fixtures/cards-kit/index.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;
const pk = { ref: 'id', type: 'int', role: 'pk' };
const PAIR = { addOn: CARDS_KIT, table: 'applied', match: { table: 'source_table', row: 'source_row' } };

/** The cards kit, keeping what it took off each order: a row per reduction, saying whose it is by table and key. */
function kit(matchColumn = 'source_row'): Doc {
  const base = cardsKitManifest() as Doc & { requiredSchema: { tables: Doc[] } };
  base.requiredSchema.tables.push({
    ref: 'applied',
    columns: [pk, { ref: 'source_table', type: 'text', maxLength: 128, rules: { tableRef: true } }, { ref: matchColumn, type: 'text', maxLength: 64 }, { ref: 'label', type: 'text', maxLength: 80 }, { ref: 'amount', type: 'decimal', scale: 2, default: 0 }, { ref: 'void', type: 'bool', default: false }],
  });
  return { ...base, addOn: { ...(base['addOn'] as Doc), provides: [{ contract: 'document-render', version: 1, server: 'dist/server.js' }] } };
}

/** A shop whose order mail, and whose receipt, list what the cards kit took off the order. */
function shop(): Doc {
  const base = shopManifest() as Doc & { requiredSchema: { tables: Doc[] } };
  base.requiredSchema.tables.push(
    { ref: 'orders', columns: [pk, { ref: 'ref', type: 'text', maxLength: 16, nullable: true }, { ref: 'email', type: 'text', maxLength: 254, nullable: true }, { ref: 'customer', type: 'text', maxLength: 80, nullable: true }] },
    {
      ref: 'messages',
      columns: [pk, { ref: 'kind', type: 'enum', enum: ['order-placed'] }, { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' }, { ref: 'to_address', type: 'text', maxLength: 254, nullable: true }, { ref: 'order_id', type: 'fk', references: 'orders', nullable: true }, { ref: 'error', type: 'text', maxLength: 200, nullable: true }, { ref: 'sent_at', type: 'timestamptz', nullable: true }],
    },
  );
  return {
    ...base,
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: { order: 'order_id' },
      recipient: { via: 'order_id', table: 'orders', email: 'email', name: 'customer' },
      kinds: { 'order-placed': 'shop-order-placed' },
    },
    emailTemplates: [
      {
        key: 'shop-order-placed',
        name: 'An order, placed',
        locales: {
          'en-US': {
            subject: 'Order {{order.ref}}',
            blocks: [
              { block: 'email.text', data: { text: 'Thank you for order {{order.ref}}.' } },
              { block: 'email.rows', id: 'reductions', data: { from: { link: 'order', ...PAIR, orderBy: 'label', unless: 'void' }, row: { title: '{{row.label}}', amount: '−{{row.amount}}' }, empty: 'No reductions.' } },
            ],
          },
        },
      },
    ],
    documents: [{ kind: 'receipt', addOn: CARDS_KIT, table: 'orders', name: 'Receipt', mapping: { title: { column: 'ref' }, lines: { collection: { ...PAIR, columns: { label: 'label', amount: 'amount' }, orderBy: 'label', unless: 'void' } } } }],
  };
}

describe.each(LEGS)("an add-on's rows for an order — %s", (dialect, available) => {
  let h: Harness;
  let sender: OutboxSender;
  const drawn: Doc[] = [];
  const now = Date.parse('2026-10-06T12:00:00Z');
  afterEach(async () => {
    if (available) await h.close();
    drawn.length = 0;
  });

  const mail = async () =>
    (await h.meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').orderBy('id').execute()).map((job) => {
      const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { envelope: string };
      return JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string; text: string };
    });
  const setUp = async (opts: { addOn?: boolean; kit?: Doc } = {}): Promise<void> => {
    const state = { providers: new Map<string, unknown[]>(), slots: new Map(), conflicts: [], problems: [], deciders: new Map() };
    const module = {
      key: CARDS_KIT,
      kinds: () => [{ id: 'receipt', formats: ['html'], paper: ['a4'] }],
      describe: () => ({ slots: [{ id: 'title', type: 'text' }, { id: 'lines', type: 'collection', columns: [{ id: 'label', type: 'text' }, { id: 'amount', type: 'money' }] }] }),
      render: (input: { subject: Doc }) => {
        drawn.push(input.subject);
        return Promise.resolve([{ format: 'html', filename: 'receipt.html', mediaType: 'text/html; charset=utf-8', bytes: new TextEncoder().encode('<p>r</p>'), locale: 'en-US', warnings: [] }]);
      },
    };
    h = await addOnHarness(dialect, { unbuiltWords: {}, documents: { runtime: () => state as never }, onRebuild: () => state.providers.set('document-render@1', [{ addOnKey: CARDS_KIT, contract: 'document-render', version: 1, module }]) });
    await h.stageApp(shop());
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    if (opts.addOn !== false) {
      await h.stageAddOn(opts.kit ?? kit(), { files: { 'dist/server.js': 'module.exports = {};' } });
      const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: CARDS_KIT, version: '1.0.0', attachTo: ['shop'] } });
      expect(added.statusCode, added.body).toBe(200);
    }
    await settingsRepo(h.meta).set('email.smtp', { host: 'localhost', port: 587, user: 'postmaster', passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)), from: 'Shop <no-reply@shop.example>', secure: false } as never);
    const views = createPublicViews(h.meta);
    const writes = createWriteService({ sequences: documentSequencesRepo(h.meta) });
    const producers = createOutboxProducers({ meta: h.meta, manager: h.manager, viewFor: views.viewFor, writes });
    sender = createOutboxSender({ meta: h.meta, manager: h.manager, viewFor: views.viewFor, writes, live: () => producers.live(), secret: TEST_SECRET, hostFor: async () => 'shop.example', documents: () => h.pipeline! });
    await h.rows(`INSERT INTO shop_orders (id, ref, email, customer) VALUES (7, 'A-7', 'mia@client.studio.dev', 'Mia Chen'), (8, 'A-8', 'leo@client.studio.dev', 'Leo Park')`);
  };
  /** The reductions the kit wrote: two for order 7, one for order 8, one voided, and one for row 7 of ANOTHER table. */
  const reduce = async (): Promise<void> => {
    const column = 'source_row';
    await h.rows(
      `INSERT INTO cards_kit_applied (source_table, ${column}, label, amount, void) VALUES ` +
        ['shop:orders|7|Birthday card|10.00|0', 'shop:orders|7|Staff discount|2.50|0', 'shop:orders|7|Voided|9.99|1', 'shop:orders|8|Loyalty|1.00|0', 'shop:products|7|Not an order|77.00|0']
          .map((row) => row.split('|'))
          .map(([table, key, label, amount, gone]) => `('${table!}', '${key!}', '${label!}', ${amount!}, ${dialect === 'postgres' ? (gone === '1' ? 'true' : 'false') : gone!})`)
          .join(', '),
    );
  };
  const send = async (order: number) => {
    const before = (await mail()).length;
    await h.rows(`INSERT INTO shop_messages (kind, status, order_id) VALUES ('order-placed', 'queued', ${String(order)})`);
    await sender.sendApp('shop', now + before * 60_000);
    const [row] = await h.rows('SELECT status, error FROM shop_messages ORDER BY id DESC');
    return { row: row!, sent: (await mail()).slice(before)[0] };
  };

  it.skipIf(!available)('an order\'s mail lists the reductions written for it — not another order\'s, not a voided one, not another table\'s row of the same key', async () => {
    await setUp();
    await reduce();
    const seven = await send(7);
    expect(seven.row, JSON.stringify(seven.row)).toMatchObject({ status: 'sent', error: null });
    expect(seven.sent!.text).toContain('Birthday card');
    expect(seven.sent!.text).toContain('Staff discount');
    expect(seven.sent!.text.indexOf('Birthday card')).toBeLessThan(seven.sent!.text.indexOf('Staff discount'));
    for (const other of ['Loyalty', 'Voided', 'Not an order', 'No reductions.']) expect(seven.sent!.text, other).not.toContain(other);
    // A numeric key matches its text copy on every database.
    const eight = await send(8);
    expect(eight.sent!.text).toContain('Loyalty');
    expect(eight.sent!.text).not.toContain('Birthday card');
  });

  it.skipIf(!available)('with the add-on absent, or switched off for the app, the list is empty and the mail still goes', async () => {
    await setUp({ addOn: false });
    const alone = await send(7);
    expect(alone.row, JSON.stringify(alone.row)).toMatchObject({ status: 'sent', error: null });
    expect(alone.sent!.text).toContain('No reductions.');
    await h.close();

    await setUp();
    await reduce();
    const off = await h.inject({ method: 'PATCH', url: `/add-ons/${CARDS_KIT}`, payload: { attachedTo: 'shop', enabled: false } });
    expect(off.statusCode, off.body).toBe(200);
    const quiet = await send(7);
    expect(quiet.row, JSON.stringify(quiet.row)).toMatchObject({ status: 'sent', error: null });
    expect(quiet.sent!.text).toContain('No reductions.');
    expect(quiet.sent!.text).not.toContain('Birthday card');
  });

  it.skipIf(!available)('a match column the add-on\'s table lacks fails the message: a broken manifest is not an absent add-on', async () => {
    // The kit's table keeps the row's key under another name than the shop's mail asks by.
    await setUp({ kit: kit('row_key') });
    const broken = await send(7);
    expect(broken.row['status']).toBe('failed');
    expect(broken.sent).toBeUndefined();
  });

  it.skipIf(!available)('a receipt draws a line per reduction from the add-on\'s rows, kept in its profile by the add-on\'s own names', async () => {
    await setUp();
    await reduce();
    const [profile] = await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'shop');
    // Kept by the add-on's own names: no table of this database is written into the profile.
    expect(JSON.stringify(profile!.mapping)).toContain('"pair":{"addOn":"cards-kit","table":"applied","matchTable":"source_table","matchRow":"source_row"}');
    expect(JSON.stringify(profile!.mapping)).not.toContain('cards_kit_applied');
    const outcome = await renderDocument(h.pipeline!, { profileId: profile!.id, pk: { id: 7 }, actorKind: 'system' });
    expect(outcome.status, JSON.stringify(outcome)).toBe('rendered');
    const lines = JSON.stringify(drawn.at(-1));
    expect(lines).toContain('Birthday card');
    expect(lines).toContain('Staff discount');
    for (const other of ['Loyalty', 'Voided', 'Not an order']) expect(lines, other).not.toContain(other);
    // An order nothing was taken off draws a receipt with no line.
    await h.rows("INSERT INTO shop_orders (id, ref, email, customer) VALUES (9, 'A-9', 'ada@client.studio.dev', 'Ada')");
    expect((await renderDocument(h.pipeline!, { profileId: profile!.id, pk: { id: 9 }, actorKind: 'system' })).status).toBe('rendered');
    expect(JSON.stringify(drawn.at(-1))).not.toMatch(/Birthday card|Loyalty/);
  });
});
