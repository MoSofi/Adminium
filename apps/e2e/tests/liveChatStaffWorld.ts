// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LIVE CHAT ADD-ON'S STAFF SIDE ON A REAL SERVER: the built server and
 * dashboard, composed in this process (as the chat window's own spec does),
 * with the live chat add-on's package installed as it is released, and a
 * small CRM that opens its enquiries to the chat.
 *
 * The package lives in the add-ons repository, not here. It is found, in
 * this order (`liveChatPackage`):
 *  1. `LIVE_CHAT_PACKAGE`: a packed `.tgz` of it (`npm pack` in its folder);
 *  2. `ADD_ONS_REPO` (or `ADMINIUM_ADD_ONS_REPO`): an add-ons checkout whose
 *     `packages/live-chat` is built; it is packed here, as npm would.
 * With neither, the spec is skipped and says so.
 *
 * It sets up what a business would: a database, the CRM and the chat,
 * vouched for (`ADMINIUM_ADD_ON_DEV_TRUST`), a public https address and a
 * privacy notice, mail, the website, and an owner who signs in. The AI
 * service is said to be usable and the answerer always hands over: what is
 * under test is the staff side.
 */
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { composeServer, loadCliEnv, openRuntime, type ComposedServer } from '@adminium/server';
import { createFirstSuperAdmin, firstRun, settingsRepo } from '@adminium/meta';

import { bundleOf } from './appBundle.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

/** The slice of the SQLite driver used here (it ships no types). */
interface SqliteDb {
  prepare(sql: string): { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[]; run(...args: unknown[]): unknown };
  close(): void;
}
const BetterSqlite3 = createRequire(import.meta.url)('better-sqlite3') as new (file: string) => SqliteDb;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

export const PORT = Number(process.env['E2E_PORT'] ?? 4880);
export const SERVER = `http://127.0.0.1:${String(PORT)}`;
export const KEY = 'live-chat';
export const PUBLIC = 'https://chat.e2e-meridian.dev';
export const SITE = 'https://www.meridian.example';
const ADMIN = { email: 'e2e-chat-owner@adminium.local', password: 'adminium-e2e-chat-owner-pass' };
const PACKED = process.env['LIVE_CHAT_PACKAGE'] ?? '';
const REPO = process.env['ADD_ONS_REPO'] ?? process.env['ADMINIUM_ADD_ONS_REPO'] ?? '';
const PACKAGE = REPO === '' ? '' : join(REPO, 'packages', KEY);

/**
 * Where the live chat's package comes from, or why there is none: a packed
 * file, else a built folder of an add-ons checkout.
 */
export function liveChatPackage(): { packed: string } | { folder: string } | { missing: string } {
  if (PACKED !== '') return existsSync(PACKED) ? { packed: PACKED } : { missing: `LIVE_CHAT_PACKAGE names ${PACKED}, which is not there` };
  if (PACKAGE === '') return { missing: 'the live chat add-on is not in this repository: set LIVE_CHAT_PACKAGE to its packed .tgz, or ADD_ONS_REPO to an add-ons checkout with packages/live-chat built' };
  if (!existsSync(join(PACKAGE, 'manifest.json'))) return { missing: `ADD_ONS_REPO has no ${join('packages', KEY, 'manifest.json')} (${PACKAGE})` };
  if (!existsSync(join(PACKAGE, 'dist'))) return { missing: `${PACKAGE} is not built: run its build first` };
  return { folder: PACKAGE };
}

const pk = { ref: 'id', type: 'int', role: 'pk' };
const CRM = {
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
      {
        ref: 'enquiries',
        label: 'Enquiries',
        columns: [
          pk,
          { ref: 'person', type: 'text', maxLength: 80, nullable: true, label: 'Person' },
          { ref: 'email', type: 'text', maxLength: 254, nullable: true, label: 'E-mail' },
          { ref: 'message', type: 'text', nullable: true, label: 'Message' },
          { ref: 'state', type: 'enum', enum: ['open', 'closed'], default: 'open', label: 'State' },
        ],
      },
    ],
  },
  publicAccess: [{ table: 'enquiries', methods: ['POST'], key: 'chat', writable: ['person', 'email', 'message'], defaults: { state: 'open' }, anonymous: { plainText: ['person'], perIpHour: 20 } }],
  pages: [{ ref: 'crm-enquiries', template: 'page-crud', title: { key: 't', fallback: 'Enquiries' }, nav: { group: 'crm', icon: 'inbox', order: 1 }, bindings: { rows: 'enquiries' } }],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
};

export interface StaffWorld {
  composed: ComposedServer;
  /** The owner's session cookie, as `name=value`. */
  cookie: string;
  /** Rows of one of the add-on's tables, or the CRM's, by short name. */
  rows(table: string, where?: string): Doc[];
  /** Change the chat's settings row, and tell the door at once. */
  settle(values: Doc): void;
  /** A visitor starts a chat: the human check solved, then the first message. */
  start(body: string): Promise<{ token: string; id: string }>;
  /** The visitor names themselves and leaves an e-mail. */
  details(token: string, name: string, email: string): Promise<void>;
  /** The visitor presses "Talk to a person". */
  talk(token: string): Promise<void>;
  /** What the visitor's window reads since a cursor. */
  poll(token: string, after?: string): Promise<Doc>;
  /** The visitor's last heartbeat moved back, as if they closed the page that long ago. */
  leave(id: string, minutesAgo: number): void;
  /** E-mails queued to go. */
  mailsQueued(): Promise<number>;
  close(): Promise<void>;
}

const distUrl = (rel: string): string => pathToFileURL(join(repoRoot, 'apps', 'server', 'dist', rel)).href;

/** The add-on as it is released: a packed file as given, or its built folder packed by npm. */
function packed(): { bytes: Buffer; version: string } {
  const found = liveChatPackage();
  if ('missing' in found) throw new Error(found.missing);
  if ('packed' in found) {
    const bytes = readFileSync(found.packed);
    // The version is the package's own, read from the file's package.json.
    const listing = execFileSync('tar', ['-xzOf', found.packed, 'package/package.json'], { encoding: 'utf8' });
    return { bytes, version: (JSON.parse(listing) as { version: string }).version };
  }
  const out = mkdtempSync(join(tmpdir(), 'live-chat-pack-'));
  const [made] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', out], { cwd: found.folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as { filename: string; version: string }[];
  return { bytes: readFileSync(join(out, made!.filename)), version: made!.version };
}

/** A human check solved for real: the leading zero bits of sha256(salt + nonce). */
function solve(salt: string, difficulty: number): string {
  for (let nonce = 0; ; nonce += 1) {
    const digest = createHash('sha256').update(salt + nonce.toString(36)).digest();
    let bits = 0;
    for (const byte of digest) {
      if (byte === 0) {
        bits += 8;
        continue;
      }
      bits += Math.clz32(byte) - 24;
      break;
    }
    if (bits >= difficulty) return nonce.toString(36);
  }
}

export async function startStaffWorld(): Promise<StaffWorld> {
  process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = KEY;
  // A server reads that list only when NODE_ENV says test or development (`add-ons/dev-trust.ts`).
  process.env['NODE_ENV'] ??= 'test';
  const dir = mkdtempSync(join(tmpdir(), 'adminium-chat-staff-e2e-'));
  const sourceFile = join(dir, 'source.db');
  new BetterSqlite3(sourceFile).close();
  const env = loadCliEnv({ ADMINIUM_SECRET: randomBytes(32).toString('hex') }, { port: PORT, host: '127.0.0.1', dataDir: dir });
  const runtime = await openRuntime(env, { blockLoopback: false });
  const meta = runtime.metaStore.meta;
  const { hashPassword } = (await import(distUrl('auth/passwords.js'))) as { hashPassword: (password: string) => Promise<string> };
  await firstRun(meta);
  await createFirstSuperAdmin(meta, { email: ADMIN.email, name: 'Dana Whitlock', passwordHash: await hashPassword(ADMIN.password) });
  for (const name of ['addOns.catalogEnabled', 'apps.catalogEnabled'] as const) await settingsRepo(meta).set(name, false, { updatedBy: null, at: Date.now() });

  // Both packages go in the stores as a verified download would put them: they need 0.3.64's words, which an upload to
  // this server, numbered 0.3.63 until its release, would refuse.
  const { createAddOnStore } = (await import(distUrl('add-ons/store.js'))) as { createAddOnStore: (opts: { dataDir: string }) => { stage(pkg: { key: string; version: string; tarball: Uint8Array; expectedIntegrity: string }): Promise<unknown> } };
  const { createAppStore } = (await import(distUrl('apps/store.js'))) as { createAppStore: (opts: { dataDir: string }) => { stage(pkg: { key: string; version: string; tarball: Uint8Array; expectedIntegrity: string }): Promise<unknown> } };
  const chat = packed();
  await createAddOnStore({ dataDir: env.ADMINIUM_DATA_DIR }).stage({ key: KEY, version: chat.version, tarball: chat.bytes, expectedIntegrity: `sha512-${createHash('sha512').update(chat.bytes).digest('base64')}` });
  const crm = bundleOf({ 'package.json': JSON.stringify({ name: '@adminium-apps/crm', version: '1.0.0' }), 'manifest.json': JSON.stringify(CRM), 'staff/index.html': '<!doctype html><html><head><title>CRM</title></head><body><main>CRM</main></body></html>' });
  await createAppStore({ dataDir: env.ADMINIUM_DATA_DIR }).stage({ key: 'crm', version: '1.0.0', tarball: crm.buffer, expectedIntegrity: crm.integrity });

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
      ai: async () => ({ usable: true, service: 'Anthropic' }),
      answerer: { pick: async () => ({ kind: 'hand-over', outcome: 'hand-over' }) },
    },
  });
  await composed.app.ready();

  const inject = async (method: 'GET' | 'POST' | 'PUT', url: string, cookie: string | undefined, payload?: unknown): Promise<Doc> => {
    const res = await composed.app.inject({ method, url, headers: cookie === undefined ? {} : { cookie }, ...(payload === undefined ? {} : { payload: payload as Doc }) });
    if (res.statusCode >= 300) throw new Error(`${method} ${url} → ${String(res.statusCode)} ${res.body}`);
    return res.body === '' ? {} : (res.json() as Doc);
  };
  const login = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: ADMIN });
  if (login.statusCode !== 200) throw new Error(`login → ${String(login.statusCode)} ${login.body}`);
  const setCookie = login.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : String(setCookie)).split(';')[0]!;

  const connection = await inject('POST', '/api/v1/connections', cookie, { name: 'Meridian', engine: 'sqlite', dsn: `sqlite:${sourceFile}` });
  const connectionId = String(connection['id']);
  const plan = (await inject('POST', '/api/v1/apps/plan', cookie, { key: 'crm', version: '1.0.0', connectionId }))['plan'] as Doc;
  await inject('POST', '/api/v1/apps/install', cookie, { key: 'crm', version: '1.0.0', connectionId, planChecksum: plan['checksum'] });
  await inject('POST', '/api/v1/add-ons', cookie, { key: KEY, version: chat.version, attachTo: ['crm'], connectionId });
  await inject('PUT', '/api/v1/settings/email', cookie, { smtp: { host: '127.0.0.1', port: 9, user: '', from: 'Meridian <hello@meridian.example>', secure: false } });

  const settings = settingsRepo(meta);
  const by = { updatedBy: null, at: Date.now() };
  await settings.set('system.publicOrigin', PUBLIC, by);
  await settings.set('privacy.businessName', 'Meridian', by);
  await settings.set('privacy.noticeUrl', 'https://www.meridian.example/privacy', by);
  await settings.set('publicPages.websites', [{ origin: SITE, addedBy: null, addedAt: Date.now() }], by);

  const tables: Record<string, string> = {};
  for (const row of await meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) tables[row.ref] = row.tableName;
  const db = new BetterSqlite3(sourceFile);
  const settingsTable = tables['settings']!;
  if ((db.prepare(`SELECT COUNT(*) AS n FROM ${settingsTable}`).get() as { n: number }).n === 0) db.prepare(`INSERT INTO ${settingsTable} (automatic) VALUES (0)`).run();

  // A visitor reaches the door through the public address, from the website.
  const door = async (method: 'GET' | 'POST', path: string, payload?: Doc, headers: Record<string, string> = {}): Promise<Doc> => {
    const res = await composed.app.inject({ method, url: `/x/chat/api/${KEY}/${path}`, remoteAddress: '203.0.113.50', headers: { host: new URL(PUBLIC).host, origin: PUBLIC, 'x-forwarded-proto': 'https', ...headers }, ...(payload === undefined ? {} : { payload }) });
    if (res.statusCode >= 300) throw new Error(`${method} ${path} → ${String(res.statusCode)} ${res.body}`);
    return res.json() as Doc;
  };

  const world: StaffWorld = {
    composed,
    cookie,
    rows: (table, where = '1=1') => db.prepare(`SELECT * FROM ${tables[table]!} WHERE ${where} ORDER BY id`).all() as Doc[],
    settle(values) {
      const set = Object.entries(values).map(([column, value]) => [column, typeof value === 'object' && value !== null ? JSON.stringify(value) : typeof value === 'boolean' ? (value ? 1 : 0) : value] as const);
      db.prepare(`UPDATE ${settingsTable} SET ${set.map(([column]) => `${column} = ?`).join(', ')}`).run(...set.map(([, value]) => value));
      composed.chat.catalog.forget();
    },
    async start(body) {
      const challenge = await door('POST', 'challenge', {});
      const proof = `${String(challenge['id'])}.${solve(String(challenge['salt']), Number(challenge['difficulty']))}`;
      const started = await door('POST', 'start', { language: 'en-US', body, cameFrom: `${SITE}/showroom` }, { 'x-adminium-proof': proof });
      return { token: String(started['token']), id: String((started['messages'] as Doc[])[0]?.['conversationId'] ?? (db.prepare(`SELECT MAX(id) AS id FROM ${tables['conversations']!}`).get() as { id: number }).id) };
    },
    async details(token, name, email) {
      await door('POST', 'details', { token, name, email });
    },
    async talk(token) {
      await door('POST', 'messages', { token, talk: true });
    },
    async poll(token, after = '0') {
      return door('GET', `messages?after=${after}`, undefined, { 'x-adminium-chat': token });
    },
    leave(id, minutesAgo) {
      db.prepare(`UPDATE ${tables['conversations']!} SET last_visitor_at = ? WHERE id = ?`).run(new Date(Date.now() - minutesAgo * 60_000).toISOString(), id);
    },
    async mailsQueued() {
      return Number((await meta.db.selectFrom('adminium_jobs').select((eb) => eb.fn.countAll<number>().as('n')).where('kind', '=', 'email.send').executeTakeFirst())?.n ?? 0);
    },
    async close() {
      db.close();
      await composed.app.close().catch(() => undefined);
      await runtime.close().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    },
  };
  world.settle({ hours: Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => [day, [['00:00', '24:00']]])), time_zone: 'UTC', automatic: false, daily_tokens: 0, theme: 'light' });
  await composed.app.listen({ port: PORT, host: '127.0.0.1' });
  return world;
}
