// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A DOCUMENT WAITS FOR THE ADD-ON THAT DRAWS IT.
 *
 * An add-on may print through another it only suggests. Alone, its mail goes
 * as text; once the other is installed — in a version it said it works
 * with, and one that draws the kind — the next mail carries the document,
 * with no reinstall of either. A drawing add-on that fails mid-draw fails
 * the message: it is never sent bare. And a recipient on a reserved domain
 * (a sample supplier's) is never mailed at all.
 */
import { documentProfilesRepo, documentSequencesRepo, settingsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { createWriteService } from '../src/crud/write-service.js';
import { drawersFor } from '../src/documents/app-documents.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { createOutboxProducers } from '../src/outbox/producers.js';
import { createOutboxSender, type OutboxSender } from '../src/outbox/sender.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { CARDS_KIT, cardsKitManifest } from './fixtures/cards-kit/index.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;
const PRINTER = 'printer-kit';
const pk = { ref: 'id', type: 'int', role: 'pk' };

/** The cards kit, mailing each card — with its PDF when the printer kit is there to draw one. */
function mailingKit(): Doc {
  const base = cardsKitManifest();
  const tables = (base['requiredSchema'] as { tables: { ref: string; columns: unknown[] }[] }).tables;
  tables.find((table) => table.ref === 'cards')!.columns.push({ ref: 'email', type: 'text', maxLength: 254, nullable: true }, { ref: 'holder', type: 'text', maxLength: 80, nullable: true });
  tables.push({
    ref: 'messages',
    columns: [pk, { ref: 'kind', type: 'enum', enum: ['card-sent'] }, { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' }, { ref: 'to_address', type: 'text', maxLength: 254, nullable: true }, { ref: 'card_id', type: 'fk', references: 'cards', nullable: true }, { ref: 'error', type: 'text', maxLength: 200, nullable: true }, { ref: 'sent_at', type: 'timestamptz', nullable: true }],
  } as never);
  return {
    ...base,
    addOns: { suggests: [{ key: PRINTER, range: '>=1.1.0', reason: { 'en-US': 'Prints the card.' } }] },
    documents: [{ kind: 'card-pdf', addOn: PRINTER, table: 'cards', name: 'Card', mapping: { title: { column: 'label' } } }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: { card: 'card_id' },
      recipient: { via: 'card_id', table: 'cards', email: 'email', name: 'holder' },
      kinds: { 'card-sent': 'cards-kit-card-sent' },
    },
    emailTemplates: [
      {
        key: 'cards-kit-card-sent',
        name: 'A card, sent',
        attach: { kind: 'card-pdf', link: 'card', optional: true },
        locales: { 'en-US': { subject: 'Your gift card', blocks: [{ block: 'email.text', data: { text: 'Hi {{recipient.first_name}}, your card is “{{card.label}}”.' } }, { block: 'email.text', data: { text: 'The card is attached.', withAttachment: true } }] } },
      },
    ],
  };
}

function printerKit(version: string): Doc {
  const { roles: _roles, pages: _pages, optionLists: _lists, ...base } = stockKitManifest();
  return { ...base, key: PRINTER, name: 'Printer kit', version, requiredSchema: { prefixed: true, tables: [{ ref: 'jobs', columns: [pk] }] }, addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' }, hostApi: 1 } };
}

describe.each(LEGS)('a document waits for the add-on that draws it — %s', (dialect, available) => {
  let h: Harness;
  let sender: OutboxSender;
  /** What the printer kit's loaded code draws right now; `fail` makes a draw throw. */
  let printer: { kinds: string[]; fail: boolean } | null = null;
  const now = Date.parse('2026-10-06T12:00:00Z');
  afterEach(async () => {
    if (available) await h.close();
    printer = null;
  });

  const mail = async () =>
    (await h.meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').orderBy('id').execute()).map((job) => {
      const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { envelope: string; attachments?: unknown[] };
      // The words travel sealed; the files that go with them are named beside the seal.
      return { ...(JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string; text: string }), attachments: payload.attachments ?? [] };
    });
  const setUp = async (): Promise<void> => {
    const state = { providers: new Map<string, unknown[]>(), slots: new Map(), conflicts: [], problems: [], deciders: new Map() };
    const module = {
      key: PRINTER,
      kinds: () => (printer?.kinds ?? []).map((id) => ({ id, formats: ['html'], paper: ['a4'] })),
      describe: () => ({ slots: [{ id: 'title', type: 'text' }] }),
      render: (input: { kind: string }) => (printer?.fail === true ? Promise.reject(new Error('the printer jammed')) : Promise.resolve([{ format: 'html', filename: `${input.kind}.html`, mediaType: 'text/html; charset=utf-8', bytes: new TextEncoder().encode('<p>card</p>'), locale: 'en-US', warnings: [] }])),
    };
    h = await addOnHarness(dialect, { unbuiltWords: {}, documents: { runtime: () => state as never }, onRebuild: () => state.providers.set('document-render@1', printer === null ? [] : [{ addOnKey: PRINTER, contract: 'document-render', version: 1, module }]) });
    await h.stageAddOn(mailingKit());
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: CARDS_KIT, version: '1.0.0', attachTo: [] } });
    expect(added.statusCode, added.body).toBe(200);
    await settingsRepo(h.meta).set('email.smtp', { host: 'localhost', port: 587, user: 'postmaster', passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)), from: 'Shop <no-reply@shop.example>', secure: false } as never);
    const views = createPublicViews(h.meta);
    const writes = createWriteService({ sequences: documentSequencesRepo(h.meta) });
    const producers = createOutboxProducers({ meta: h.meta, manager: h.manager, viewFor: views.viewFor, writes });
    sender = createOutboxSender({ meta: h.meta, manager: h.manager, viewFor: views.viewFor, writes, live: () => producers.live(), secret: TEST_SECRET, hostFor: async () => 'shop.example', documents: () => h.pipeline! });
    await h.rows(`INSERT INTO cards_kit_cards (id, code, link_token, label, status, balance, email, holder) VALUES (1, 'GC-7K2M9QXA41TR', '7K2M9QXA41TR8PZC', 'For Mia', 'active', 50, 'mia@client.studio.dev', 'Mia Chen')`);
  };
  /** Queues a mail for card 1 and sends it; answers the message's row and the mail that went, if one did. */
  const send = async () => {
    const before = (await mail()).length;
    await h.rows(`INSERT INTO cards_kit_messages (kind, status, card_id) VALUES ('card-sent', 'queued', 1)`);
    await sender.sendApp(CARDS_KIT, now);
    const [row] = await h.rows('SELECT status, error FROM cards_kit_messages ORDER BY id DESC');
    const sent = (await mail()).slice(before);
    return { row: row!, sent: sent[0] };
  };
  const install = async (version: string, kinds: string[]) => {
    printer = { kinds, fail: false };
    await h.stageAddOn(printerKit(version));
    const res = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: PRINTER, version, attachTo: [] } });
    expect(res.statusCode, res.body).toBe(200);
  };
  const update = async (version: string, kinds: string[]) => {
    printer = { kinds, fail: false };
    await h.stageAddOn(printerKit(version));
    const res = await h.inject({ method: 'POST', url: `/add-ons/${PRINTER}/update`, payload: { to: version } });
    expect(res.statusCode, res.body).toBe(200);
  };
  const profiles = async () => (await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, CARDS_KIT)).map((profile) => `${profile.kind}@${profile.addOnKey}`);
  const text = (one: { sent: { text: string; attachments?: unknown[] } | undefined }) => ({ attached: (one.sent?.attachments ?? []).length, says: one.sent?.text.includes('The card is attached.') });

  it.skipIf(!available)('alone, the mail goes as text; after the drawing add-on is installed the next mail carries the document, with no reinstall', async () => {
    await setUp();
    expect(await profiles()).toEqual([]);
    const alone = await send();
    expect(alone.row, JSON.stringify(alone.row)).toMatchObject({ status: 'sent', error: null });
    // Without the part, and without the sentence that speaks of it.
    expect(text(alone)).toEqual({ attached: 0, says: false });
    expect(alone.sent!.text).toContain('your card is “For Mia”');

    await install('1.1.0', ['card-pdf']);
    // Made by the arrival itself: nobody touched the cards kit.
    expect(await profiles()).toEqual([`card-pdf@${PRINTER}`]);
    const carried = await send();
    expect(carried.row).toMatchObject({ status: 'sent', error: null });
    expect(text(carried)).toEqual({ attached: 1, says: true });
  });

  it.skipIf(!available)('an installed version below the range is a skip and the mail goes as text; after its update the document is carried', async () => {
    await setUp();
    await install('1.0.0', ['card-pdf']);
    // Installed, and not one the cards kit said it works with: it draws nothing for it.
    expect([...(await drawersFor(h.meta, CARDS_KIT))]).toEqual([CARDS_KIT]);
    expect(await profiles()).toEqual([]);
    expect(text(await send())).toEqual({ attached: 0, says: false });
    await update('1.1.0', ['card-pdf']);
    expect(await profiles()).toEqual([`card-pdf@${PRINTER}`]);
    expect(text(await send())).toEqual({ attached: 1, says: true });
  });

  it.skipIf(!available)('an installed version that lacks the kind is a skip and the mail goes as text; after the update that draws it the document is carried', async () => {
    await setUp();
    await install('1.1.0', ['label']);
    expect(await profiles()).toEqual([]);
    const bare = await send();
    expect(bare.row).toMatchObject({ status: 'sent', error: null });
    expect(text(bare)).toEqual({ attached: 0, says: false });
    await update('1.2.0', ['label', 'card-pdf']);
    expect(await profiles()).toEqual([`card-pdf@${PRINTER}`]);
    expect(text(await send())).toEqual({ attached: 1, says: true });
  });

  it.skipIf(!available)('a drawing add-on that fails mid-draw fails the message: it is not sent bare', async () => {
    await setUp();
    await install('1.1.0', ['card-pdf']);
    printer = { kinds: ['card-pdf'], fail: true };
    const failed = await send();
    expect(failed.row['status']).toBe('failed');
    expect(String(failed.row['error'])).toMatch(/could not be drawn/i);
    expect(failed.sent).toBeUndefined();
  });

  it.skipIf(!available)('a mail to an address on a reserved domain is skipped with its reason and never handed to the transport; the same card to a real address is sent', async () => {
    await setUp();
    for (const address of ['orders@northgate.example', 'buyer@shop.test', 'nobody@host.invalid']) {
      await h.rows(`UPDATE cards_kit_cards SET email = '${address}' WHERE id = 1`);
      const skipped = await send();
      expect(skipped.row, address).toMatchObject({ status: 'skipped', error: 'A reserved address (for examples and tests)' });
      expect(skipped.sent, address).toBeUndefined();
    }
    await h.rows(`UPDATE cards_kit_cards SET email = 'mia@client.studio.dev' WHERE id = 1`);
    const real = await send();
    expect(real.row).toMatchObject({ status: 'sent', error: null });
    expect(real.sent!.to).toContain('mia@client.studio.dev');
  });
});
