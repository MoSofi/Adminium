// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WEBSITE CHATS IN A PERSON'S DATA, and how long they are kept, on SQLite,
 * Postgres and MySQL, over a chat add-on and a CRM installed by the real
 * installer:
 *
 *  - a search by address finds the conversations with the address typed in
 *    them, and a conversation with no address through the enquiry it became
 *    (a copy of the person, linked to their contact), with their messages
 *    and the answerer's choices; nobody else's;
 *  - the download writes all three;
 *  - "What goes" counts them; the erasure deletes all three tables' rows,
 *    leaves everybody else's, and the chat store forgets them;
 *  - the "How long we keep things" row reads the add-on's own setting (12
 *    months with no settings row's value; empty: until removed), and the
 *    sweep removes a conversation past it with its messages and choices, and
 *    keeps a fresh one.
 */
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chatAddOn } from '../../../packages/manifest/test/chat-fixture.js';
import { sweepChatTranscripts } from '../src/chat/transcripts.js';
import { createConsentService } from '../src/consent/index.js';
import { bindWriteValue } from '../src/crud/write-values.js';
import type { FileStore } from '../src/files/store.js';
import { findChatRows } from '../src/privacy/chat-transcripts.js';
import { erasePerson, previewErasure } from '../src/privacy/erase.js';
import { personZip } from '../src/privacy/export.js';
import { chatTranscriptsKeeping } from '../src/privacy/keeping.js';
import { findPerson } from '../src/privacy/sources.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-18T12:00:00Z');
const MARTA = 'marta@cobalt.example';
const NO_FILES = { remove: async () => undefined, driverFor: async () => ({ remove: async () => undefined }) } as unknown as FileStore;
const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });

/** A CRM whose contacts are people and whose enquiries copy them (by the address, and a link to the contact). */
function crm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A small CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.64', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'contacts', columns: [id, text('name', 80), text('email', 254)] },
        { ref: 'enquiries', columns: [id, text('email', 254), { ref: 'message', type: 'text', nullable: true }, { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true }] },
      ],
    },
    people: [{ table: 'contacts', kind: 'people', email: 'email', name: 'name', copies: [{ table: 'enquiries', column: 'email', holds: 'email', via: 'contact_id' }] }],
    pages: [{ ref: 'crm-contacts', template: 'page-crud', title: { key: 't', fallback: 'Contacts' }, nav: { group: 'crm', icon: 'home', order: 1 }, bindings: { rows: 'contacts' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

describe.each(LEGS)('website chats in a person\'s data — %s', (dialect, available) => {
  let h: Harness;
  let views: ReturnType<typeof createPublicViews>;
  const names: Record<string, string> = {};
  const forgotten: string[] = [];
  const consent = () => createConsentService({ meta: h.meta, secret: TEST_SECRET });
  const deps = () => ({ meta: h.meta, manager: h.manager, consent: consent(), storage: NO_FILES, secret: TEST_SECRET, now: () => NOW, chatForget: (_place: unknown, key: string) => forgotten.push(key) });

  async function insert(ref: string, values: Record<string, unknown>): Promise<void> {
    const view = (await views.viewFor(h.connectionId))!;
    const table = view.table(names[ref]!);
    const { db } = await h.manager.data(h.connectionId);
    const bound = Object.fromEntries(Object.entries(values).map(([column, value]) => [column, value === null ? null : bindWriteValue(table.columns.get(column)!, value, dialect)]));
    await db.insertInto(table.id as never).values(bound as never).execute();
  }
  const ids = async (ref: string) => (await h.rows(`SELECT id FROM ${names[ref]!} ORDER BY id`)).map((row) => Number(row['id']));
  /** A conversation with one visitor message and one choice about it. */
  async function chat(n: number, values: { email?: string | null; name?: string | null; became?: [string, string] | null; last?: number }): Promise<void> {
    const at = new Date(values.last ?? NOW - DAY).toISOString();
    await insert('conversations', {
      id: n,
      started_at: at,
      last_message_at: at,
      state: 'closed',
      language: 'en-US',
      name: values.name ?? null,
      email: values.email ?? null,
      outside_hours: dialect === 'sqlite' ? 0 : false,
      became_table: values.became?.[0] ?? null,
      became_key: values.became?.[1] ?? null,
      automatic_count: 0,
    });
    await insert('messages', { id: n * 10, conversation_id: n, kind: 'visitor', body: `Question ${String(n)}`, drafted: dialect === 'sqlite' ? 0 : false, sent_at: at });
    await insert('messages', { id: n * 10 + 1, conversation_id: n, kind: 'staff', body: `Answer ${String(n)}`, drafted: dialect === 'sqlite' ? 0 : false, sent_at: at });
    await insert('choices', { id: n, conversation_id: n, message_id: n * 10, outcome: 'hand-over', tokens_in: 5, tokens_out: 1, at });
  }

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(crm());
    expect((await h.install('crm', '1.0.0')).statusCode).toBe(200);
    await h.stageAddOn(chatAddOn(), { bundled: true });
    expect((await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'live-chat', version: '1.0.0', attachTo: ['crm'] } })).statusCode).toBe(200);
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['ref', 'tableName']).execute()) names[record.ref] = record.tableName;
    views = createPublicViews(h.meta);
    await insert('contacts', { id: 1, name: 'Marta Kovac', email: MARTA });
    await insert('contacts', { id: 2, name: 'Bob Harbour', email: 'bob@harbour.dev' });
    // Her enquiry from a chat where nobody typed an address: a copy of her through the link to her contact.
    await insert('enquiries', { id: 11, email: null, message: 'Ten booths', contact_id: 1 });
    await insert('enquiries', { id: 12, email: null, message: 'Two chairs', contact_id: 2 });
    // 1: her address typed in it. 2: no address, became her enquiry. 3: Bob's address. 4: no address, became Bob's enquiry.
    await chat(1, { email: ' Marta@Cobalt.example ', name: 'Marta' });
    await chat(2, { became: ['crm:enquiries', '11'] });
    await chat(3, { email: 'bob@harbour.dev' });
    await chat(4, { became: ['crm:enquiries', '12'] });
  }, 240_000);

  afterAll(async () => {
    if (available) await h?.close();
  });

  it.skipIf(!available)('a search finds her conversations by the address and by the enquiry one became, with their messages and choices; nobody else\'s', async () => {
    const found = await findPerson(deps(), 'MARTA@cobalt.example');
    const of = (kind: string) => found.sources.find((one) => one.kind === kind)!;
    expect(of('chat-conversations')).toMatchObject({ id: 'chat-conversations-live-chat', group: 'gave', app: 'live-chat', ref: 'conversations', count: 2 });
    expect(of('chat-conversations').keys.sort()).toEqual(['1', '2']);
    expect(of('chat-messages')).toMatchObject({ count: 4, group: 'gave' });
    expect(of('chat-choices')).toMatchObject({ count: 2, group: 'held' });
    expect(JSON.stringify(found.sources.filter((one) => one.kind.startsWith('chat-')))).not.toContain('bob@harbour.dev');
    expect(JSON.stringify(found.sources.filter((one) => one.kind.startsWith('chat-')))).not.toContain('Question 4');
  });

  it.skipIf(!available)('the download writes her conversations, their messages and the choices', async () => {
    const files = unzipSync(personZip(await findPerson(deps(), MARTA), NOW));
    expect(Object.keys(files).filter((name) => name.startsWith('chat-')).sort()).toEqual([
      'chat-choices-live-chat.csv',
      'chat-choices-live-chat.json',
      'chat-conversations-live-chat.csv',
      'chat-conversations-live-chat.json',
      'chat-messages-live-chat.csv',
      'chat-messages-live-chat.json',
    ]);
    const said = strFromU8(files['chat-messages-live-chat.json']!);
    expect(said).toContain('Question 2');
    expect(said).not.toContain('Question 3');
  });

  it.skipIf(!available)('"What goes" counts them; the erasure removes all three tables\' rows of hers, leaves Bob\'s, and the store forgets them', async () => {
    const preview = await previewErasure(deps(), MARTA);
    expect(preview.goes).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'chat-conversations', count: 2, app: 'live-chat' })]));
    const result = await erasePerson(deps(), MARTA);
    expect(result.counts).toMatchObject({ 'chat-conversations-live-chat': 2, 'chat-messages-live-chat': 4, 'chat-choices-live-chat': 2 });
    expect(await ids('conversations')).toEqual([3, 4]);
    expect(await ids('messages')).toEqual([30, 31, 40, 41]);
    expect(await ids('choices')).toEqual([3, 4]);
    expect(forgotten.sort()).toEqual(['1', '2']);
    // Found again, nothing of hers is left in the chat.
    expect((await findPerson(deps(), MARTA)).sources.filter((one) => one.kind.startsWith('chat-'))).toEqual([]);
  });

  it.skipIf(!available)('an erasure with no address (by phone) never reads an empty address as a match', async () => {
    await chat(7, { email: '' });
    expect(await findChatRows(deps(), '', [])).toEqual([]);
    const { db } = await h.manager.data(h.connectionId);
    await db.deleteFrom(names['choices']! as never).where('conversation_id' as never, '=', 7 as never).execute();
    await db.deleteFrom(names['messages']! as never).where('conversation_id' as never, '=', 7 as never).execute();
    await db.deleteFrom(names['conversations']! as never).where('id' as never, '=', 7 as never).execute();
  });

  it.skipIf(!available)('the keeping row reads the add-on\'s setting, and the sweep removes an old conversation with its messages and choices, and keeps a fresh one', async () => {
    const { db } = await h.manager.data(h.connectionId);
    const settings = names['chat_settings']!;
    const row = async (): Promise<unknown> => (await chatTranscriptsKeeping({ meta: h.meta, manager: h.manager }))[0]?.keptFor;
    await db.deleteFrom(settings as never).execute();
    // No settings row yet: twelve months.
    expect(await row()).toBe(12);
    await insert('chat_settings', { id: 1, transcripts_months: 6 });
    expect(await chatTranscriptsKeeping({ meta: h.meta, manager: h.manager })).toEqual([{ key: 'chat-conversations', fixed: true, keptFor: 6, options: [], addOn: { key: 'live-chat', name: 'Live chat' } }]);
    await chat(5, { email: 'old@harbour.dev', last: NOW - 200 * DAY });
    await chat(6, { email: 'new@harbour.dev', last: NOW - 20 * DAY });
    // Empty: kept until somebody removes them, and the sweep takes nothing.
    await db.updateTable(settings as never).set({ transcripts_months: null } as never).execute();
    expect(await row()).toBe('until-removed');
    expect(await sweepChatTranscripts({ meta: h.meta, manager: h.manager, now: () => NOW })).toEqual({});
    expect(await ids('conversations')).toContain(5);
    await db.updateTable(settings as never).set({ transcripts_months: 6 } as never).execute();
    forgotten.length = 0;
    expect(await sweepChatTranscripts({ meta: h.meta, manager: h.manager, now: () => NOW, forget: (_place, key) => forgotten.push(key) })).toEqual({ 'live-chat': 1 });
    expect(await ids('conversations')).not.toContain(5);
    expect(await ids('conversations')).toContain(6);
    expect(await ids('messages')).not.toContain(50);
    expect(await ids('choices')).not.toContain(5);
    expect(forgotten).toEqual(['5']);
  });
});
