// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A WEBSITE CHAT'S SETTINGS PAGE, ON THE REAL SERVER, on SQLite, Postgres
 * and MySQL.
 *
 *  - `GET /api/v1/chat/<add-on>/status` answers everything the page shows
 *    (reach and its doubt, the notice, the address, the websites, the mail,
 *    the roles, the languages, the business's name, the time zone) to a
 *    person who may read the chat's settings and holds no Forms or privacy
 *    right; 403 to one who may not read them; 404 for no chat. Its reach
 *    answer is the forms status's own, in each state.
 *  - The columns the chat's contract names are the engine's to read and
 *    write and the add-on's pages to show: `daily_tokens` and `tokens_in`
 *    reach a reader of the table though their names read like a secret, with
 *    no `secret: false` in the package. A column of the add-on's own named
 *    `api_token` is still taken for a secret, and an add-on that says
 *    `secret: true` of a contract column keeps it hidden.
 */
import { permissionsRepo, rolesRepo, settingsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chatAddOn } from '../../../packages/manifest/test/chat-fixture.js';
import { recordDeciderTrust } from '../src/add-ons/decider-trust.js';
import type { LiveChat } from '../src/chat/catalog.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { readDoorStatus } from '../src/routes/forms/index.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const ORIGIN = 'https://chat.meridian.example';
const WEBSITE = 'https://www.meridian.example';

/** The fixture's chat, with a column of its own named like a secret on its settings table. */
function liveChat(): Doc {
  const doc = chatAddOn();
  const settings = (doc['requiredSchema'] as { tables: { ref: string; columns: Doc[] }[] }).tables.find((table) => table.ref === 'chat_settings')!;
  settings.columns.push({ ref: 'api_token', type: 'text', maxLength: 64, nullable: true });
  return doc;
}

/** A second chat whose package keeps its day's tokens hidden: the owner's word wins. */
function hiddenTokensChat(): Doc {
  const doc = { ...chatAddOn(), key: 'quiet-chat', name: 'Quiet chat' };
  const settings = (doc['requiredSchema'] as { tables: { ref: string; columns: Doc[] }[] }).tables.find((table) => table.ref === 'chat_settings')!;
  const column = settings.columns.find((one) => one['ref'] === 'daily_tokens')!;
  column['rules'] = { secret: true };
  return doc;
}

describe.each(LEGS)('a website chat’s settings page — %s', (dialect, available) => {
  let h: Harness;
  let served: Awaited<ReturnType<typeof servePublic>>;
  const tables: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  let signIns = 0;

  const as = (who: string, url: string, headers: Record<string, string> = {}) => served.composed.app.inject({ method: 'GET', url, headers: { cookie: cookies[who]!, ...headers } });
  const chatOf = async (addOn: string): Promise<LiveChat> => (await served.composed.chat.catalog.forStaff(addOn))!;
  const settle = async (addOn: string, values: Doc) => {
    const { db } = await h.manager.data(h.connectionId);
    const out: Doc = {};
    for (const [column, value] of Object.entries(values)) out[column] = ['hours', 'welcome', 'outside_words', 'tell'].includes(column) ? JSON.stringify(value) : value;
    await db.updateTable(tables[`${addOn}:chat_settings`]! as never).set(out as never).execute();
  };

  /** Someone with these grants, signed in. */
  async function person(key: string, grants: string[]): Promise<void> {
    const user = await usersRepo(h.meta).create({ email: `${key}@meridian.example`, name: key, passwordHash: await adminPasswordHash() });
    const role = await rolesRepo(h.meta).create({ slug: `status-${key}`, name: `Status ${key}` });
    for (const row of matrixRowsFromGrants(grants).rows) await permissionsRepo(h.meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions as never);
    await rolesRepo(h.meta).assignToUser(user.id, role.id);
    signIns += 1;
    const res = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.8.0.${String(signIns)}`, payload: { email: `${key}@meridian.example`, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    cookies[key] = sessionCookie(res.headers['set-cookie']);
  }

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    for (const doc of [liveChat(), hiddenTokensChat()]) {
      const key = doc['key'] as string;
      await h.stageAddOn(doc, { bundled: true });
      const installed = await h.inject({ method: 'POST', url: '/add-ons', payload: { key, version: '1.0.0', attachTo: ['dashboard'] } });
      expect(installed.statusCode, installed.body).toBe(200);
      await recordDeciderTrust(h.meta, { key, version: '1.0.0', integrity: (await h.addOnStore.verifyTree(key, '1.0.0')).integrity });
    }
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) tables[`${record.appKey}:${record.ref}`] = record.tableName;
    const { db } = await h.manager.data(h.connectionId);
    for (const key of ['live-chat', 'quiet-chat']) {
      const table = tables[`${key}:chat_settings`]!;
      if (Number((await h.rows(`SELECT COUNT(*) AS n FROM ${table}`))[0]!['n']) === 0) await db.insertInto(table as never).values({ theme: 'light' } as never).execute();
    }

    const settings = settingsRepo(h.meta);
    await settings.set('system.publicOrigin', ORIGIN, { updatedBy: null });
    await settings.set('privacy.businessName', 'Meridian Workplace Ltd', { updatedBy: null });
    await settings.set('privacy.noticeUrl', 'https://www.meridian.example/privacy', { updatedBy: null });
    await settings.set('publicPages.websites', [{ origin: WEBSITE, addedBy: null, addedAt: Date.now() }], { updatedBy: null });
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });

    const conn = h.connectionId;
    const live = await chatOf('live-chat');
    const quiet = await chatOf('quiet-chat');
    const grant = (chat: LiveChat, ref: string, ...actions: string[]) => actions.map((action) => `table:${conn}:${chat.view.table(tables[`${chat.addOn}:${ref}`]!).id}:${action}`);
    // A settings manager of the chat, and nothing else: no Forms, no privacy, no roles.
    await person('seth', [...grant(live, 'chat_settings', 'read', 'update'), ...grant(live, 'choices', 'read'), ...grant(quiet, 'chat_settings', 'read')]);
    // An agent who answers chats but may not read the settings.
    await person('nora', [...grant(live, 'conversations', 'read', 'update'), ...grant(live, 'messages', 'read')]);
  }, 300_000);

  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  const status = (who: string, addOn = 'live-chat', headers: Record<string, string> = {}) => as(who, `/api/v1/chat/${addOn}/status`, headers);

  it.skipIf(!available)('answers a settings manager with no Forms or privacy rights everything the page shows', async () => {
    await settle('live-chat', { time_zone: 'Europe/Berlin', welcome: { 'en-US': 'Hi', 'de-DE': 'Hallo' } });
    // Neither of the reads the page borrowed before answers this person.
    expect((await as('seth', '/api/v1/forms/status')).statusCode).toBe(403);
    expect((await as('seth', '/api/v1/privacy/reach')).statusCode).toBe(403);

    const res = await status('seth');
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as Doc).data;
    expect(data).toMatchObject({
      reach: { state: 'reachable', proxyUnchecked: true },
      notice: true,
      publicOrigin: ORIGIN,
      websites: [WEBSITE],
      mail: { sends: false, blocked: 'no-mail-server' },
      languages: ['en-US', 'de-DE'],
      defaultLanguage: 'en-US',
      businessName: 'Meridian Workplace Ltd',
      timeZone: 'Europe/Berlin',
    });
    // The roles the chat may tell, by name, and none of their members.
    expect(data.roles).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Status seth' })]));
    expect(JSON.stringify(data.roles)).not.toContain('@');
    // `?install=` names an install, as the other chat routes take it.
    expect((await as('seth', `/api/v1/chat/live-chat/status?install=${(await chatOf('live-chat')).installId}`)).statusCode).toBe(200);
  });

  it.skipIf(!available)('is refused to someone who may not read the chat’s settings, and not found for no chat', async () => {
    const refused = await status('nora');
    expect(refused.statusCode).toBe(403);
    expect((refused.json() as Doc).error).toMatchObject({ code: 'TABLE_FORBIDDEN', details: { reason: 'chat-settings-read' } });
    expect((await status('seth', 'no-such-chat')).statusCode).toBe(404);
    expect((await served.composed.app.inject({ method: 'GET', url: '/api/v1/chat/live-chat/status' })).statusCode).toBe(401);
  });

  it.skipIf(!available)('says each reach state as the forms status does', async () => {
    const settings = settingsRepo(h.meta);
    const states: [string | null, Record<string, string>, string, boolean][] = [
      [null, {}, 'not-set', true],
      ['http://127.0.0.1:4879', {}, 'this-computer', true],
      ['https://10.0.0.5', {}, 'private-network', true],
      ['https://desk.local', {}, 'dot-local', true],
      ['http://chat.meridian.example', {}, 'not-https', true],
      [ORIGIN, { 'x-forwarded-for': '203.0.113.9' }, 'proxy-hidden', false],
      [ORIGIN, {}, 'reachable', true],
    ];
    try {
      for (const [origin, headers, state, unchecked] of states) {
        if (origin === null) await settings.unset('system.publicOrigin');
        else await settings.set('system.publicOrigin', origin, { updatedBy: null });
        const data = ((await status('seth', 'live-chat', headers)).json() as Doc).data;
        expect(data.reach, `${String(origin)} ${state}`).toEqual({ state, proxyUnchecked: unchecked });
        expect(data.publicOrigin).toBe(origin);
        // With no address, no mail goes either: the page says the address is missing first.
        if (origin === null) expect(data.mail).toEqual({ sends: false, blocked: 'no-public-origin' });
      }
      // The states a server's own settings decide, through the same read.
      const request = { headers: {}, user: null } as never;
      expect((await readDoorStatus(h.meta, 'secret', { networkFeatures: false, desktop: false, trustProxy: false }, request)).reach.state).toBe('network-off');
      expect((await readDoorStatus(h.meta, 'secret', { networkFeatures: true, desktop: true, trustProxy: false }, request)).reach.state).toBe('desktop');
      expect((await readDoorStatus(h.meta, 'secret', { networkFeatures: true, desktop: false, trustProxy: true }, { headers: { 'x-forwarded-for': '203.0.113.9' }, user: null } as never)).reach).toEqual({ state: 'reachable', proxyUnchecked: false });
    } finally {
      await settings.set('system.publicOrigin', ORIGIN, { updatedBy: null });
    }
  });

  it.skipIf(!available)('shows the contract’s token columns to a reader of the table, and keeps a column of its own named like a secret hidden', async () => {
    await settle('live-chat', { daily_tokens: 5000, api_token: 'sk-not-for-anyone' });
    const live = await chatOf('live-chat');
    const read = async (chat: LiveChat, ref: string) => {
      const res = await as('seth', `/api/v1/data/${h.connectionId}/${chat.view.table(tables[`${chat.addOn}:${ref}`]!).id}`);
      expect(res.statusCode, res.body).toBe(200);
      return ((res.json() as Doc).data as Doc[])[0] ?? {};
    };
    const row = await read(live, 'chat_settings');
    expect(Number(row['daily_tokens'])).toBe(5000);
    expect(row).not.toHaveProperty('api_token');
    expect(JSON.stringify(row)).not.toContain('sk-not-for-anyone');
    // The answerer's choices, whose tokens the usage card adds up.
    const choices = live.view.table(tables['live-chat:choices']!);
    expect(choices.columns.get('tokens_in')?.secret).toBe(false);
    expect(choices.columns.get('tokens_out')?.secret).toBe(false);

    // An add-on that says its day's tokens are a secret keeps them one.
    await settle('quiet-chat', { daily_tokens: 7000 });
    expect(await read(await chatOf('quiet-chat'), 'chat_settings')).not.toHaveProperty('daily_tokens');
  });
});
