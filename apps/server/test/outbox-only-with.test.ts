// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A MAIL BLOCK THAT DEPENDS ON A VALUE, AND A LINK INTO AN APP.
 *
 * A block marked `onlyWith` goes when its variable is filled; one marked
 * `onlyWithout` goes when it is not — decided before anything else looks at
 * the blocks, so a name only a dropped block prints is never asked for. An
 * add-on's mail links into a page of an app that names it, has it switched
 * on, declares the route and has an address; with none, the link is empty
 * and the block written for that case is the one sent.
 */
import { documentSequencesRepo, settingsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { createWriteService } from '../src/crud/write-service.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { createOutboxProducers } from '../src/outbox/producers.js';
import { createOutboxSender, withoutUnmetBlocks, type OutboxSender } from '../src/outbox/sender.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { CARDS_KIT, cardsKitManifest, shopManifest } from './fixtures/cards-kit/index.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;
const pk = { ref: 'id', type: 'int', role: 'pk' };

/** The cards kit, mailing a card: who it is from when that is known, and where its balance is read when an app serves that page. */
function mailingKit(): Doc {
  const base = cardsKitManifest();
  const tables = (base['requiredSchema'] as { tables: { ref: string; columns: unknown[] }[] }).tables;
  tables.find((table) => table.ref === 'cards')!.columns.push({ ref: 'email', type: 'text', maxLength: 254, nullable: true }, { ref: 'holder', type: 'text', maxLength: 80, nullable: true }, { ref: 'sender_name', type: 'text', maxLength: 80, nullable: true });
  tables.push({
    ref: 'messages',
    columns: [pk, { ref: 'kind', type: 'enum', enum: ['card-sent'] }, { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' }, { ref: 'to_address', type: 'text', maxLength: 254, nullable: true }, { ref: 'card_id', type: 'fk', references: 'cards', nullable: true }, { ref: 'error', type: 'text', maxLength: 200, nullable: true }, { ref: 'sent_at', type: 'timestamptz', nullable: true }],
  } as never);
  return {
    ...base,
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: { card: 'card_id' },
      recipient: { via: 'card_id', table: 'cards', email: 'email', name: 'holder' },
      kinds: { 'card-sent': 'cards-kit-card-sent' },
      // Where a card's balance is read: the page of whichever app serves it.
      pages: { app: { balance: 'cards' } },
    },
    emailTemplates: [
      {
        key: 'cards-kit-card-sent',
        name: 'A card, sent',
        locales: {
          'en-US': {
            subject: 'Your gift card',
            blocks: [
              { block: 'email.text', data: { text: 'A gift from {{card.sender_name}}.', onlyWith: 'card.sender_name' } },
              { block: 'email.text', data: { text: 'A gift for you.', onlyWithout: 'card.sender_name' } },
              { block: 'email.text', data: { text: 'It holds {{card.balance}}.' } },
              // The card's own link: a code only the person the card is for is sent.
              { block: 'email.text', data: { text: 'Open it: {{card.link_token}}', onlyWith: 'card.link_token' } },
              { block: 'email.text', data: { text: 'See your balance: {{app_url.balance}}', onlyWith: 'app_url.balance' } },
              { block: 'email.text', data: { text: 'Ask in the shop for your balance.', onlyWithout: 'app_url.balance' } },
            ],
          },
        },
      },
    ],
  };
}

const shop = (over: Doc = {}): Doc =>
  shopManifest({
    frontends: [
      { side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } },
      { side: 'customer', kind: 'spa', entry: 'index.html', routes: { shop: '/', cards: '/cards' } },
    ],
    ...over,
  });

describe('a block that depends on a value', () => {
  const block = (text: string, data: Doc = {}) => ({ block: 'email.text', data: { text, ...data } });
  const template = { subject: 's', blocks: [block('plain'), block('with', { onlyWith: 'card.sender_name' }), block('without', { onlyWithout: 'card.sender_name' }), block('code', { onlyWith: 'card.code' })] };
  const texts = (vars: Record<string, string>, withheld: string[] = []) => withoutUnmetBlocks(template, vars, new Set(withheld)).blocks.map((one) => (one as { data: { text: string } }).data.text);

  it('with the value the first goes, without it the second; blank is not a value', () => {
    expect(texts({ 'card.sender_name': 'Ada', 'card.code': 'GC-1' })).toEqual(['plain', 'with', 'code']);
    expect(texts({ 'card.sender_name': '', 'card.code': 'GC-1' })).toEqual(['plain', 'without', 'code']);
    expect(texts({ 'card.sender_name': '   ' })).toEqual(['plain', 'without']);
    expect(texts({})).toEqual(['plain', 'without']);
  });

  it('a block whose value is held back from this reader is left out with it; held back counts as not there', () => {
    // The code is not this reader's to see: its block goes, and nothing is printed in its place.
    expect(texts({ 'card.sender_name': 'Ada', 'card.code': 'GC-1' }, ['card.code'])).toEqual(['plain', 'with']);
    expect(texts({ 'card.sender_name': 'Ada' }, ['card.sender_name'])).toEqual(['plain', 'without']);
  });

  it('a template with no mark is handed back as it is', () => {
    const plain = { subject: 's', blocks: [block('a'), block('b')] };
    expect(withoutUnmetBlocks(plain, {}, new Set())).toBe(plain);
  });
});

describe.each(LEGS)("an add-on's mail: blocks by a value, and a link into an app — %s", (dialect, available) => {
  let h: Harness;
  let sender: OutboxSender;
  /** The address guests reach each app by; an app with none has no guest side to link into. */
  let hosts: Record<string, string> = {};
  const now = Date.parse('2026-10-06T12:00:00Z');
  afterEach(async () => {
    if (available) await h.close();
    hosts = {};
  });

  const mail = async () =>
    (await h.meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').orderBy('id').execute()).map((job) => {
      const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { envelope: string };
      return JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string; text: string; html: string };
    });
  const setUp = async (apps: Doc[] = [], attachTo: string[] = []): Promise<void> => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    for (const app of apps) {
      await h.stageApp(app);
      const installed = await h.install(String(app['key']), '1.0.0');
      expect(installed.statusCode, installed.body).toBe(200);
    }
    await h.stageAddOn(mailingKit());
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: CARDS_KIT, version: '1.0.0', attachTo } });
    expect(added.statusCode, added.body).toBe(200);
    await settingsRepo(h.meta).set('email.smtp', { host: 'localhost', port: 587, user: 'postmaster', passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)), from: 'Shop <no-reply@shop.example>', secure: false } as never);
    const views = createPublicViews(h.meta);
    const writes = createWriteService({ sequences: documentSequencesRepo(h.meta) });
    const producers = createOutboxProducers({ meta: h.meta, manager: h.manager, viewFor: views.viewFor, writes });
    sender = createOutboxSender({ meta: h.meta, manager: h.manager, viewFor: views.viewFor, writes, live: () => producers.live(), secret: TEST_SECRET, hostFor: async (appKey) => hosts[appKey] });
    await h.rows(`INSERT INTO cards_kit_cards (id, code, link_token, label, status, balance, email, holder, sender_name) VALUES (1, 'GC-7K2M9QXA41TR', '7K2M9QXA41TR8PZC', 'For Mia', 'active', 50, 'mia@client.studio.dev', 'Mia Chen', 'Ada'), (2, 'GC-3HHW8PZC65NE', '3HHW8PZC65NE7K2M', 'For Leo', 'active', 20, 'leo@client.studio.dev', 'Leo Park', NULL)`);
  };
  /** Sends a card's mail and answers its text; fails loudly when it did not go. */
  const send = async (card: number): Promise<{ text: string; html: string }> => {
    const before = (await mail()).length;
    await h.rows(`INSERT INTO cards_kit_messages (kind, status, card_id) VALUES ('card-sent', 'queued', ${String(card)})`);
    await sender.sendApp(CARDS_KIT, now + before * 60_000);
    const [row] = await h.rows('SELECT status, error FROM cards_kit_messages ORDER BY id DESC');
    expect(row, JSON.stringify(row)).toMatchObject({ status: 'sent', error: null });
    return (await mail()).at(-1)!;
  };

  it.skipIf(!available)('with a sender\'s name the first heading goes, without it the second; a dropped block\'s names are not asked for; html and text carry the same blocks', async () => {
    await setUp();
    const named = await send(1);
    expect(named.text).toContain('A gift from Ada.');
    expect(named.text).not.toContain('A gift for you.');
    // Leo's card names no sender: `{{card.sender_name}}` has no value, and the block that prints it is gone — the mail still goes.
    const plain = await send(2);
    expect(plain.text).toContain('A gift for you.');
    expect(plain.text).not.toContain('A gift from');
    expect(plain.text).not.toContain('{{');
    for (const one of [named, plain]) {
      for (const sentence of ['A gift from Ada.', 'A gift for you.', 'See your balance', 'Ask in the shop']) expect(one.html.includes(sentence), sentence).toBe(one.text.includes(sentence));
    }
  });

  it.skipIf(!available)('a block whose value is held back is left out with its code, and the mail still goes: its name is not asked of the fill check', async () => {
    await setUp();
    // To the person the card is for: the link goes with it.
    expect((await send(1)).text).toContain('Open it: 7K2M9QXA41TR8PZC');
    // The same card's mail, addressed to somebody else: the code is not theirs, so the block that prints it is gone — not a failed message.
    await h.rows(`INSERT INTO cards_kit_messages (kind, status, card_id, to_address) VALUES ('card-sent', 'queued', 1, 'somebody.else@client.studio.dev')`);
    await sender.sendApp(CARDS_KIT, now + 3_600_000);
    const [row] = await h.rows('SELECT status, error FROM cards_kit_messages ORDER BY id DESC');
    expect(row, JSON.stringify(row)).toMatchObject({ status: 'sent', error: null });
    const other = (await mail()).at(-1)!;
    expect(other.to).toContain('somebody.else@client.studio.dev');
    expect(other.text).not.toContain('7K2M9QXA41TR8PZC');
    expect(other.text).not.toContain('Open it');
    expect(other.text).toContain('It holds');
  });

  it.skipIf(!available)('no app: the link is empty, and the block written for that is the one sent', async () => {
    await setUp();
    const sent = await send(1);
    expect(sent.text).toContain('Ask in the shop for your balance.');
    expect(sent.text).not.toContain('See your balance');
  });

  it.skipIf(!available)('with an app that names the add-on, has it on and declares the route, the link leads to that app\'s address', async () => {
    hosts = { shop: 'shop.example' };
    await setUp([shop()], ['shop']);
    const sent = await send(1);
    expect(sent.text).toContain('See your balance: https://shop.example/cards');
    expect(sent.text).not.toContain('Ask in the shop');
  });

  it.skipIf(!available)('switched off for the app, with no such route, or with no guest address: empty', async () => {
    hosts = { shop: 'shop.example' };
    await setUp([shop()], ['shop']);
    const off = await h.inject({ method: 'PATCH', url: `/add-ons/${CARDS_KIT}`, payload: { attachedTo: 'shop', enabled: false } });
    expect(off.statusCode, off.body).toBe(200);
    expect((await send(1)).text).toContain('Ask in the shop for your balance.');
    await h.close();

    // An app that does not declare the route the add-on links to.
    hosts = { shop: 'shop.example' };
    await setUp([shopManifest()], ['shop']);
    expect((await send(1)).text).toContain('Ask in the shop for your balance.');
    await h.close();

    // An app the add-on is attached to that does not name it: its pages are not the add-on's to link into.
    hosts = { shop: 'shop.example' };
    const { addOns: _named, ...unnamed } = shop();
    await setUp([unnamed], ['shop']);
    expect((await send(1)).text).toContain('Ask in the shop for your balance.');
    await h.close();

    // An app guests cannot reach: no address of its own, and no public origin.
    hosts = {};
    await setUp([shop()], ['shop']);
    expect((await send(1)).text).toContain('Ask in the shop for your balance.');
  });

  it.skipIf(!available)('two such apps: the first by key', async () => {
    hosts = { shop: 'shop.example', kiosk: 'kiosk.example' };
    await setUp([shop(), shop({ key: 'kiosk', name: 'Kiosk', pages: [{ ref: 'kiosk-home', template: 'page-dashboard', title: { key: 'mft.kiosk.page.home', fallback: 'Home' }, nav: { group: 'manifest:sample', icon: 'layout-dashboard', order: 1 } }] })], ['shop', 'kiosk']);
    expect((await send(1)).text).toContain('See your balance: https://kiosk.example/cards');
  });
});
