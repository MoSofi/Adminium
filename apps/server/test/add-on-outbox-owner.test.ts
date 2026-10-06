// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON'S OWN EMAILS — its outbox table and its templates, installed with
 * it and sent by the same sender that sends an app's: a message queued in the
 * add-on's table goes out in the add-on's own words, to the address on the
 * row it is about, with no app attached; a row of the add-on's sample is
 * never mailed; and removing the add-on takes its templates with it.
 */
import { documentSequencesRepo, emailTemplatesRepo, settingsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { createWriteService } from '../src/crud/write-service.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { createOutboxProducers } from '../src/outbox/producers.js';
import { createOutboxSender, type OutboxSender } from '../src/outbox/sender.js';
import { createSampleDataService, findSampleOwner } from '../src/apps/sample-data.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { CARDS_KIT, cardsKitManifest } from './fixtures/cards-kit/index.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

const pk = { ref: 'id', type: 'int', role: 'pk' };

/** The cards kit, sending a card to the person it is for. */
function mailingKit(): Record<string, unknown> {
  const base = cardsKitManifest();
  const tables = (base['requiredSchema'] as { tables: { ref: string; columns: unknown[] }[] }).tables;
  tables.find((table) => table.ref === 'cards')!.columns.push({ ref: 'email', type: 'text', maxLength: 254, nullable: true }, { ref: 'holder', type: 'text', maxLength: 80, nullable: true });
  tables.push({
    ref: 'messages',
    columns: [
      pk,
      { ref: 'kind', type: 'enum', enum: ['card-sent'] },
      { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
      { ref: 'to_address', type: 'text', maxLength: 254, nullable: true },
      { ref: 'card_id', type: 'fk', references: 'cards', nullable: true },
      { ref: 'error', type: 'text', maxLength: 200, nullable: true },
      { ref: 'sent_at', type: 'timestamptz', nullable: true },
    ],
  } as never);
  return {
    ...base,
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: { card: 'card_id' },
      recipient: { via: 'card_id', table: 'cards', email: 'email', name: 'holder' },
      kinds: { 'card-sent': 'cards-kit-card-sent' },
      // A card that is made is sent to the person it is for.
      producers: [{ kind: 'card-sent', link: 'card_id', onCreate: { table: 'cards' } }],
    },
    sampleData: { file: 'seeds/cards.sample.json' },
    emailTemplates: [
      {
        key: 'cards-kit-card-sent',
        name: 'A card, sent',
        locales: { 'en-US': { subject: 'Your gift card', blocks: [
              { block: 'email.text', data: { text: 'Hi {{recipient.first_name}}, your card “{{card.label}}” holds {{card.balance}}.' } },
              // The card's own link: a code Adminium made to be handed on, to the person the card is for.
              { block: 'email.text', data: { text: 'Open it: {{card.link_token}}' } },
            ],
          },
        },
      },
    ],
  };
}

const SAMPLE = {
  format: 'adminium.sample/1',
  app: CARDS_KIT,
  tables: [{ ref: 'cards', rows: [{ label: 'A sample card', status: 'active', balance: 25, email: 'sample@client.studio.dev', holder: 'Sam Sample' }] }],
};

describe.each(LEGS)("an add-on's own emails — %s", (dialect, available) => {
  let h: Harness;
  let sender: OutboxSender;
  let producers: ReturnType<typeof createOutboxProducers>;
  let views: ReturnType<typeof createPublicViews>;
  const now = Date.parse('2026-10-06T12:00:00Z');
  afterEach(async () => {
    if (available) await h.close();
  });

  const mail = async () =>
    (await h.meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').orderBy('id').execute()).map((job) => {
      const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { envelope: string };
      return JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string; text: string };
    });

  const setUp = async (): Promise<void> => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(mailingKit(), { files: { 'seeds/cards.sample.json': JSON.stringify(SAMPLE) } });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: CARDS_KIT, version: '1.0.0', attachTo: [] } });
    expect(added.statusCode, added.body).toBe(200);
    await settingsRepo(h.meta).set('email.smtp', {
      host: 'localhost',
      port: 587,
      user: 'postmaster',
      passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)),
      from: 'Shop <no-reply@shop.example>',
      secure: false,
    } as never);
    views = createPublicViews(h.meta);
    const writes = createWriteService({ sequences: documentSequencesRepo(h.meta) });
    producers = createOutboxProducers({ meta: h.meta, manager: h.manager, viewFor: views.viewFor, writes });
    sender = createOutboxSender({ meta: h.meta, manager: h.manager, viewFor: views.viewFor, writes, live: () => producers.live(), secret: TEST_SECRET, hostFor: async () => 'shop.example' });
    await h.rows(`INSERT INTO cards_kit_cards (code, link_token, label, status, balance, email, holder) VALUES ('GC-7K2M9QXA41TR', '7K2M9QXA41TR8PZC', 'For Mia', 'active', 50, 'mia@client.studio.dev', 'Mia Chen')`);
  };

  it.skipIf(!available)('its templates are installed as its own, and a queued message goes out in its words with no app attached', async () => {
    await setUp();
    const templates = (await emailTemplatesRepo(h.meta).list()).filter((template) => template.key === 'cards-kit-card-sent');
    expect(templates.map((template) => template.locale)).toEqual(['en_US']);
    await h.rows(`INSERT INTO cards_kit_messages (kind, status, card_id) VALUES ('card-sent', 'queued', 1)`);
    expect(await sender.sendApp(CARDS_KIT, now)).toBe(1);
    const [row] = await h.rows('SELECT status, error, to_address FROM cards_kit_messages');
    expect(row).toMatchObject({ status: 'sent', error: null });
    const sent = (await mail()).filter((message) => message.subject === 'Your gift card');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toContain('mia@client.studio.dev');
    expect(sent[0]!.text).toContain('Hi Mia, your card “For Mia” holds 50');
    // The link's code goes to the person the card is for: the sender reads the add-on's own entries to know it is one.
    expect(sent[0]!.text).toContain('Open it: 7K2M9QXA41TR8PZC');
    expect(sent[0]!.text).not.toContain('{{');
  });

  it.skipIf(!available)('a card that is made queues its mail; a card of the add-on\'s own sample never does', async () => {
    await setUp();
    const owner = (await findSampleOwner(h.meta, CARDS_KIT, 'add-on'))!;
    await createSampleDataService(h.sampleData).add(owner, { locale: 'en-US', userId: h.owner.id, userLabel: 'owner@test' });
    const table = (await views.viewFor(h.connectionId))!.table('cards_kit_cards');
    const made = async (id: number) => {
      const after = (await h.rows(`SELECT * FROM cards_kit_cards WHERE id = ${String(id)}`))[0]!;
      await producers.onRecordEvent({ connectionId: h.connectionId, table, action: 'create', entity: { connectionId: h.connectionId, table: table.id, pk: { id }, label: '' }, before: null, after } as never);
      return Number((await h.rows(`SELECT count(*) AS n FROM cards_kit_messages WHERE card_id = ${String(id)}`))[0]!['n']);
    };
    const sample = Number((await h.rows(`SELECT id FROM cards_kit_cards WHERE label = 'A sample card'`))[0]!['id']);
    // The owner's own card: one message, for the add-on's kind.
    expect(await made(1)).toBe(1);
    // The sample's card: nobody is written to about a made-up row.
    expect(await made(sample)).toBe(0);
  });

  it.skipIf(!available)('removing the add-on takes its templates with it', async () => {
    await setUp();
    const gone = await h.inject({ method: 'DELETE', url: `/add-ons/${CARDS_KIT}` });
    expect(gone.statusCode, gone.body).toBe(200);
    expect((await emailTemplatesRepo(h.meta).list()).filter((template) => template.key === 'cards-kit-card-sent')).toEqual([]);
    expect(gone.json().removed.emails).toBeGreaterThan(0);
  });
});
