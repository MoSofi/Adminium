// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LIVE CHAT ON A REAL SERVER, for the chat window's spec: the built server
 * serving the built `/x/` bundle and loader, composed in this process (as
 * `scripts/e2e-server.mjs` composes it) so the spec can write a person's
 * reply through the chat's own store, the one writer every poll reads.
 *
 * On a fresh install it sets up what a business would: a database, the
 * chat add-on installed on it and vouched for (`ADMINIUM_ADD_ON_DEV_TRUST`),
 * a public https address and a privacy notice (so strangers may reach the
 * chat), mail, the website the chat sits on ("Your websites"), one stored
 * answer, and Dana, who answers. Automatic answers come from a scripted
 * answerer and the AI service is said to be usable: what is under test is
 * the window, not the model.
 *
 * Everything is in a temporary directory; `close` removes it.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import BetterSqlite3 from 'better-sqlite3';
import { composeServer, loadCliEnv, openRuntime, type ComposedServer } from '@adminium/server';
import { createFirstSuperAdmin, firstRun, settingsRepo, usersRepo } from '@adminium/meta';

import { bundleOf } from './appBundle.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

/** The chat's server: this spec's own port, never the shared suite's. */
export const CHAT_PORT = Number(process.env['E2E_PORT'] ?? 4876);
export const SERVER = `http://127.0.0.1:${String(CHAT_PORT)}`;
/** The owner's website, served by the browser's router: an https page the chat may be framed on. */
export const SITE = 'https://www.meridian.example';
export const KEY = 'live-chat';
export const ANSWER = 'Yes, we can clear and recycle your old furniture as part of the job.';

const ADMIN = { email: 'e2e-chat-admin@adminium.local', password: 'adminium-e2e-chat-admin-pass' };

const text = (ref: string, maxLength?: number, more: Doc = {}): Doc => ({ ref, type: 'text', ...(maxLength === undefined ? {} : { maxLength }), ...more });
const key = (): Doc => ({ ref: 'id', type: 'int', role: 'pk' });
const moment = (ref: string, more: Doc = {}): Doc => ({ ref, type: 'timestamptz', ...more });
const yesNo = (ref: string, value = false): Doc => ({ ref, type: 'bool', default: value });
const whole = (ref: string, more: Doc = {}): Doc => ({ ref, type: 'int', ...more });
const nullable = { nullable: true };

/** A live chat add-on as the engine reads one: its four tables and its settings. */
const CHAT_MANIFEST: Doc = {
  kind: 'add-on',
  manifestVersion: 1,
  key: KEY,
  name: 'Live chat',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'live-chat.description', fallback: 'Live chat on your website.' },
  categories: ['marketing'],
  compatibility: { minAdminiumVersion: '0.3.64' },
  addOn: {
    attaches: [{ app: '*', range: '*' }],
    connect: { kind: 'none' },
    settingsTable: 'chat_settings',
    chat: { conversations: 'conversations', messages: 'messages', answers: 'answers', choices: 'choices' },
  },
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'conversations',
        columns: [
          key(),
          moment('started_at'),
          moment('last_message_at'),
          { ref: 'state', type: 'enum', enum: ['bot', 'waiting', 'open', 'closed'] },
          text('language', 10),
          text('name', 200, nullable),
          text('email', 320, nullable),
          text('came_from', undefined, nullable),
          yesNo('outside_hours'),
          text('taken_by', 64, nullable),
          moment('taken_at', nullable),
          moment('last_visitor_at', nullable),
          moment('last_staff_at', nullable),
          moment('closed_at', nullable),
          text('became_table', 64, nullable),
          text('became_key', 200, nullable),
          whole('automatic_count', { default: 0 }),
        ],
      },
      {
        ref: 'messages',
        columns: [
          { ref: 'id', type: 'bigint', role: 'pk' },
          { ref: 'conversation_id', type: 'fk', references: 'conversations' },
          { ref: 'kind', type: 'enum', enum: ['visitor', 'staff', 'automatic', 'system'] },
          text('body'),
          text('event', 30, nullable),
          text('answer_ref', 64, nullable),
          text('author_id', 64, nullable),
          yesNo('drafted'),
          moment('sent_at'),
          moment('mailed_at', nullable),
        ],
      },
      { ref: 'answers', columns: [key(), text('ref', 64, { unique: true }), { ref: 'versions', type: 'json' }, yesNo('active', true), whole('position', { default: 0 })] },
      {
        ref: 'choices',
        columns: [
          key(),
          { ref: 'conversation_id', type: 'fk', references: 'conversations' },
          whole('message_id'),
          text('answer_ref', 64, nullable),
          { ref: 'outcome', type: 'enum', enum: ['answered', 'hand-over', 'error', 'budget', 'cap', 'off'] },
          text('model', 100, nullable),
          whole('tokens_in'),
          whole('tokens_out'),
          moment('at'),
        ],
      },
      {
        ref: 'chat_settings',
        columns: [
          key(),
          { ref: 'hours', type: 'json', nullable: true },
          text('time_zone', 64, nullable),
          { ref: 'closed_until', type: 'date', nullable: true },
          { ref: 'welcome', type: 'json', nullable: true },
          { ref: 'outside_words', type: 'json', nullable: true },
          yesNo('automatic'),
          whole('daily_tokens', { default: 0 }),
          yesNo('milo_drafts'),
          { ref: 'tell', type: 'json', nullable: true },
          whole('transcripts_months', { nullable: true, default: 12 }),
          { ref: 'theme', type: 'enum', enum: ['light', 'dark', 'visitor'], default: 'light' },
        ],
      },
    ],
  },
};

/** Every day, all day. */
export const ALL_DAY = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => [day, [['00:00', '24:00']]]));
/** Every day for one minute at 9:00 UTC: outside hours whenever a test runs, opening "at 9:00". */
export const NINE_ONLY = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => [day, [['09:00', '09:01']]]));

export interface ChatWorld {
  composed: ComposedServer;
  /** The chat's settings row changed, and the door told at once. */
  settle(values: Doc): Promise<void>;
  /** The latest conversation's id. */
  latest(): Promise<string>;
  /** A row of the conversations table. */
  conversation(id: string): Promise<Doc>;
  /** Dana writes to the latest conversation, taking it. */
  reply(body: string): Promise<void>;
  /** Dana closes the latest conversation. */
  closeLatest(): Promise<void>;
  close(): Promise<void>;
}

const distUrl = (rel: string): string => pathToFileURL(join(repoRoot, 'apps', 'server', 'dist', rel)).href;

export async function startChatWorld(): Promise<ChatWorld> {
  // The test package is vouched for by name, as a developer's own would be.
  process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = KEY;
  const dir = mkdtempSync(join(tmpdir(), 'adminium-chat-e2e-'));
  const sourceFile = join(dir, 'source.db');
  new BetterSqlite3(sourceFile).close();
  const env = loadCliEnv({ ADMINIUM_SECRET: randomBytes(32).toString('hex') }, { port: CHAT_PORT, host: '127.0.0.1', dataDir: dir });
  const runtime = await openRuntime(env, { blockLoopback: false });
  const meta = runtime.metaStore.meta;
  const { hashPassword } = (await import(distUrl('auth/passwords.js'))) as { hashPassword: (password: string) => Promise<string> };
  await firstRun(meta);
  await createFirstSuperAdmin(meta, { email: ADMIN.email, name: 'Chat Admin', passwordHash: await hashPassword(ADMIN.password) });
  for (const name of ['addOns.catalogEnabled', 'apps.catalogEnabled'] as const) await settingsRepo(meta).set(name, false, { updatedBy: null, at: Date.now() });

  // The package is put in the add-on store as a verified download would be: it needs 0.3.64's chat words,
  // which an upload to this server, still numbered 0.3.63 until its release, would refuse.
  const { createAddOnStore } = (await import(distUrl('add-ons/store.js'))) as {
    createAddOnStore: (opts: { dataDir: string }) => { stage(pkg: { key: string; version: string; tarball: Uint8Array; expectedIntegrity: string }): Promise<unknown> };
  };
  const bundle = bundleOf({ 'package.json': JSON.stringify({ name: `@adminiumjs/add-on-${KEY}` }), 'manifest.json': JSON.stringify(CHAT_MANIFEST), 'dist/client.js': 'export const register = () => {};' });
  await createAddOnStore({ dataDir: env.ADMINIUM_DATA_DIR }).stage({ key: KEY, version: '1.0.0', tarball: bundle.buffer, expectedIntegrity: bundle.integrity });

  const composed = await composeServer({
    env,
    metaStore: runtime.metaStore,
    manager: runtime.manager,
    runService: runtime.runService,
    applyService: runtime.applyService,
    allowed: runtime.allowed,
    collectStats: runtime.collectStats,
    staticRoot: join(repoRoot, 'apps', 'dashboard', 'dist'),
    logger: false,
    telemetry: false,
    chatSeams: {
      // What is under test is the window: an AI service said usable, and an answerer that knows one answer.
      ai: async () => ({ usable: true, service: 'Anthropic' }),
      answerer: { pick: async (input) => (/desk/i.test(input.visitorMessages[input.visitorMessages.length - 1] ?? '') ? { kind: 'answer', ref: 'old-furniture' } : { kind: 'hand-over', outcome: 'hand-over' }) },
    },
  });
  await composed.app.ready();

  const inject = async (method: 'GET' | 'POST' | 'PUT', url: string, cookie: string | undefined, payload?: unknown, headers: Record<string, string> = {}): Promise<Doc> => {
    const res = await composed.app.inject({ method, url, headers: { ...headers, ...(cookie === undefined ? {} : { cookie }) }, ...(payload === undefined ? {} : { payload: payload as Doc }) });
    if (res.statusCode >= 300) throw new Error(`${method} ${url} → ${String(res.statusCode)} ${res.body}`);
    return res.body === '' ? {} : (res.json() as Doc);
  };
  const login = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: ADMIN });
  if (login.statusCode !== 200) throw new Error(`login → ${String(login.statusCode)} ${login.body}`);
  const cookieHeader = login.headers['set-cookie'];
  const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0]! : String(cookieHeader)).split(';')[0]!;

  const connection = await inject('POST', '/api/v1/connections', cookie, { name: 'Website', engine: 'sqlite', dsn: `sqlite:${sourceFile}` });
  const connectionId = String(connection['id']);
  await inject('POST', '/api/v1/add-ons', cookie, { key: KEY, version: '1.0.0', attachTo: ['dashboard'], connectionId });
  await inject('PUT', '/api/v1/settings/email', cookie, { smtp: { host: '127.0.0.1', port: 9, user: '', from: 'Meridian <hello@meridian.example>', secure: false } });

  const settings = settingsRepo(meta);
  const by = { updatedBy: null, at: Date.now() };
  await settings.set('system.publicOrigin', 'https://chat.e2e-meridian.dev', by);
  await settings.set('privacy.businessName', 'Meridian', by);
  await settings.set('privacy.noticeUrl', 'https://www.meridian.example/privacy', by);
  await settings.set('appearance.accent', 'teal', by);
  await settings.set('publicPages.websites', [{ origin: SITE, addedBy: null, addedAt: Date.now() }], by);
  const dana = (await usersRepo(meta).create({ email: 'dana.whitlock@meridian.example', name: 'Dana Whitlock' })).id;

  const tables: Record<string, string> = {};
  for (const row of await meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) if (row.appKey === KEY) tables[row.ref] = row.tableName;
  const db = new BetterSqlite3(sourceFile);
  db.prepare(`INSERT INTO ${tables['answers']!} (ref, versions, active, position) VALUES (?, ?, 1, 0)`).run(
    'old-furniture',
    JSON.stringify({ 'en-US': { title: 'Do you take old furniture away?', text: ANSWER, examples: ['do you take away old desks'] } }),
  );
  const settingsTable = tables['chat_settings']!;
  if ((db.prepare(`SELECT COUNT(*) AS n FROM ${settingsTable}`).get() as { n: number }).n === 0) db.prepare(`INSERT INTO ${settingsTable} (automatic) VALUES (0)`).run();

  const chatOf = async () => (await composed.chat.catalog.forStaff(KEY))!;
  const world: ChatWorld = {
    composed,
    async settle(values) {
      const set = Object.entries(values).map(([column, value]) => [column, typeof value === 'object' && value !== null ? JSON.stringify(value) : typeof value === 'boolean' ? (value ? 1 : 0) : value] as const);
      db.prepare(`UPDATE ${settingsTable} SET ${set.map(([column]) => `${column} = ?`).join(', ')}`).run(...set.map(([, value]) => value));
      composed.chat.catalog.forget();
    },
    async latest() {
      return String((db.prepare(`SELECT MAX(id) AS id FROM ${tables['conversations']!}`).get() as { id: number }).id);
    },
    async conversation(id) {
      return db.prepare(`SELECT * FROM ${tables['conversations']!} WHERE id = ?`).get(id) as Doc;
    },
    async reply(body) {
      const id = await world.latest();
      const now = Date.now();
      await composed.chat.store.add(await chatOf(), id, { kind: 'staff', body, authorId: dana }, { state: 'open', takenBy: dana, takenAt: now, lastStaffAt: now });
    },
    async closeLatest() {
      const id = await world.latest();
      await composed.chat.store.add(await chatOf(), id, { kind: 'system', body: 'The chat was closed.', event: 'closed', authorId: dana }, { state: 'closed', closedAt: Date.now() });
    },
    async close() {
      db.close();
      await composed.app.close().catch(() => undefined);
      await runtime.close().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    },
  };
  await world.settle({ hours: ALL_DAY, time_zone: 'UTC', automatic: true, daily_tokens: 5000, theme: 'light' });
  await composed.app.listen({ port: CHAT_PORT, host: '127.0.0.1' });
  return world;
}
