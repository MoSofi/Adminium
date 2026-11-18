// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LANDING PAGES ON A REAL SERVER, for the landing page's spec: the built
 * server serving the built `/x/` bundle, composed in this process (as
 * `chatWorld.ts` does), with a forms add-on and a landing pages add-on
 * installed and vouched for (`ADMINIUM_ADD_ON_DEV_TRUST`), a public https
 * address and a privacy notice (so strangers may reach the pages).
 *
 * The pages are written as the add-on's editor writes them, through the
 * data routes and past the engine's publish seal; their pictures are kept
 * by the engine's picture route as each page's own copy. The forms are rows
 * of the forms add-on's table, as the form builder publishes them.
 *
 *   acoustic-booths   every block kind but a Hero (comp board 1a), its Form block the showroom form
 *   open-day          a Hero whose picture is missing (1d-2), then Features
 *   thanks-open-day   a Heading, a text, a button (1f), and a Form block of a form that is closed
 *   kabain            the Arabic page, right to left (1i)
 *   old-offer         published, then switched off
 *
 * Everything is in a temporary directory; `close` removes it.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

import { composeServer, loadCliEnv, openRuntime, type ComposedServer } from '@adminium/server';
import { createFirstSuperAdmin, firstRun, paymentSettingsRepo, settingsRepo } from '@adminium/meta';

import { bundleOf } from './appBundle.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

/** This spec's own port, never the shared suite's (W4's range). */
export const PAGES_PORT = Number(process.env['E2E_PORT'] ?? 4902);
export const SERVER = `http://127.0.0.1:${String(PAGES_PORT)}`;
/** The install's public address: its host is where a live page may be indexed. */
export const PUBLIC_HOST = 'pages.e2e-meridian.dev';
export const LANDING = 'landing-pages';
export const FORMS = 'forms';

const ADMIN = { email: 'e2e-pages-admin@adminium.local', password: 'adminium-e2e-pages-admin-pass' };

export const BUSINESS = { name: 'Meridian', legal: 'Meridian Workplace Ltd', email: 'hello@meridian.example', notice: 'https://www.meridian.example/privacy' };

const text = (ref: string, maxLength?: number, more: Doc = {}): Doc => ({ ref, type: 'text', ...(maxLength === undefined ? {} : { maxLength }), ...more });
const nullable = { nullable: true };
const moment = (ref: string, more: Doc = {}): Doc => ({ ref, type: 'timestamptz', ...more });
const json = (ref: string, more: Doc = {}): Doc => ({ ref, type: 'json', ...more });
const add = (key: string, name: string, word: Doc, minAdminiumVersion: string): Doc => ({
  kind: 'add-on',
  manifestVersion: 1,
  key,
  name,
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: `${key}.description`, fallback: name },
  categories: ['marketing'],
  compatibility: { minAdminiumVersion },
  addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' }, ...word },
});

/** A forms add-on as the engine reads one: the forms door serves its forms and takes its answers. */
const FORMS_MANIFEST: Doc = {
  ...add(FORMS, 'Forms & surveys', { forms: { forms: 'forms', answers: 'answers', invitations: 'invitations', files: 'answer_files' } }, '0.3.40'),
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'forms',
        columns: [
          { ref: 'id', type: 'id', role: 'pk' },
          text('title', 200),
          text('slug', 80, { unique: true }),
          { ref: 'kind', type: 'enum', enum: ['form', 'survey'] },
          { ref: 'state', type: 'enum', enum: ['draft', 'live', 'closed'], default: 'draft' },
          json('definition'),
          json('settings'),
          json('published', nullable),
          moment('published_at', nullable),
        ],
      },
      {
        ref: 'invitations',
        columns: [
          { ref: 'id', type: 'id', role: 'pk' },
          { ref: 'form_id', type: 'fk', references: 'forms' },
          text('email', 320),
          text('name', 200, nullable),
          text('language', 10),
          text('person_table', 64),
          text('person_key', 200),
          text('record_table', 64, nullable),
          text('record_key', 200, nullable),
          text('token_hash', 64, nullable),
          { ref: 'class', type: 'enum', enum: ['marketing', 'service'] },
          moment('invited_at'),
          moment('answered_at', nullable),
          moment('expires_at', nullable),
        ],
      },
      {
        ref: 'answers',
        columns: [
          { ref: 'id', type: 'id', role: 'pk' },
          { ref: 'form_id', type: 'fk', references: 'forms' },
          moment('submitted_at'),
          text('language', 10),
          json('values'),
          text('email', 320, nullable),
          text('name', 200, nullable),
          text('became_table', 64, nullable),
          text('became_key', 200, nullable),
          { ref: 'invitation_id', type: 'fk', references: 'invitations', nullable: true },
          { ref: 'confirm', type: 'enum', enum: ['none', 'pending', 'confirmed', 'expired'] },
          text('consent_purpose', 20, nullable),
          text('consent_wording', undefined, nullable),
          { ref: 'consent_version', type: 'int', nullable: true },
          text('ip', 64, nullable),
          text('user_agent', 512, nullable),
          text('sent_from', undefined, nullable),
        ],
      },
      {
        ref: 'answer_files',
        columns: [
          { ref: 'id', type: 'id', role: 'pk' },
          { ref: 'answer_id', type: 'fk', references: 'answers', nullable: true },
          text('file_id', 64),
          text('question', 16),
          text('name', 255),
          { ref: 'size', type: 'bigint' },
          text('kind', 20),
          moment('uploaded_at'),
          moment('expires_at', nullable),
        ],
      },
    ],
  },
};

/** A landing pages add-on as the engine reads one: its pages (and funnels) tables, the contract's columns. */
const LANDING_MANIFEST: Doc = {
  ...add(LANDING, 'Landing pages', { landing: { pages: 'pages', funnels: 'funnels' } }, '0.3.65'),
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'pages',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          text('name', 200),
          text('slug', 80),
          { ref: 'state', type: 'enum', enum: ['draft', 'live', 'off'], default: 'draft' },
          text('language', 10),
          json('draft'),
          json('published', nullable),
          moment('published_at', nullable),
          moment('updated_at'),
        ],
      },
      { ref: 'funnels', columns: [{ ref: 'id', type: 'int', role: 'pk' }, text('name', 200), json('steps'), text('rule_id', 64, nullable)] },
    ],
  },
};

const w = (en: string, ar: string) => ({ 'en-US': en, 'ar-EG': ar });

/** The showroom form, in English and Arabic, as the form builder publishes it. */
const SHOWROOM = {
  v: 1,
  kind: 'form',
  languages: ['en-US', 'ar-EG'],
  defaultLanguage: 'en-US',
  title: w('Book a showroom visit', 'احجز زيارة لصالة العرض'),
  intro: w("See the new booths and desks in our Leeds showroom. We'll confirm your time within one working day.", 'شاهد الكبائن والمكاتب الجديدة في صالة العرض في ليدز.'),
  questions: [
    { id: 'qname', kind: 'short', role: 'name', required: true, maxLength: 200, label: w('Your name', 'اسمك') },
    { id: 'qemail', kind: 'short', check: 'email', role: 'email', required: true, maxLength: 200, label: w('Work e-mail', 'البريد الإلكتروني للعمل') },
    { id: 'qcompany', kind: 'short', required: false, maxLength: 200, label: w('Company', 'الشركة') },
  ],
  ending: { kind: 'words', words: w("We'll confirm your time within one working day.", 'سنؤكد زيارتك خلال يوم عمل واحد.') },
};
const SETTINGS = { becomes: null, tell: [], limits: { perHour: 50, harder: false } };

/** A PNG of one colour, made here: what the picture route keeps as a page's own copy. */
function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const u32 = (n: number) => {
    const out = Buffer.alloc(4);
    out.writeUInt32BE(n >>> 0);
    return out;
  };
  const chunk = (type: string, data: Buffer) => Buffer.concat([u32(data.length), Buffer.from(type, 'latin1'), data, u32(crc(Buffer.concat([Buffer.from(type, 'latin1'), data])))]);
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: width }, () => Buffer.from(rgb)))]);
  const rows = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.concat([u32(width), u32(height), Buffer.from([8, 2, 0, 0, 0])])),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface LandingWorld {
  composed: ComposedServer;
  /** Each page's row key, by its slug. */
  keys: Record<string, string>;
  /** Each picture's file id, by its name here. */
  files: Record<string, string>;
  /** Visitor counting's level, as the owner sets it on the Privacy page. */
  counting(level: 'off' | 'counts' | 'visitor'): Promise<void>;
  close(): Promise<void>;
}

/** The slice of the SQLite driver used here (it ships no types). */
interface SqliteDb {
  prepare(sql: string): { get(...args: unknown[]): unknown; run(...args: unknown[]): unknown };
  close(): void;
}
type SqliteModule = new (file: string) => SqliteDb;

const distUrl = (rel: string): string => pathToFileURL(join(repoRoot, 'apps', 'server', 'dist', rel)).href;

export async function startLandingWorld(): Promise<LandingWorld> {
  // The test packages are vouched for by name, as a developer's own would be.
  process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = `${FORMS},${LANDING}`;
  const dir = mkdtempSync(join(tmpdir(), 'adminium-pages-e2e-'));
  const sourceFile = join(dir, 'source.db');
  const BetterSqlite3 = createRequire(import.meta.url)('better-sqlite3') as SqliteModule;
  new BetterSqlite3(sourceFile).close();
  const env = loadCliEnv({ ADMINIUM_SECRET: randomBytes(32).toString('hex') }, { port: PAGES_PORT, host: '127.0.0.1', dataDir: dir });
  const runtime = await openRuntime(env, { blockLoopback: false });
  const meta = runtime.metaStore.meta;
  const { hashPassword } = (await import(distUrl('auth/passwords.js'))) as { hashPassword: (password: string) => Promise<string> };
  await firstRun(meta);
  await createFirstSuperAdmin(meta, { email: ADMIN.email, name: 'Pages Admin', passwordHash: await hashPassword(ADMIN.password) });
  for (const name of ['addOns.catalogEnabled', 'apps.catalogEnabled'] as const) await settingsRepo(meta).set(name, false, { updatedBy: null, at: Date.now() });

  // The packages go into the add-on store as a verified download would.
  const { createAddOnStore } = (await import(distUrl('add-ons/store.js'))) as {
    createAddOnStore: (opts: { dataDir: string }) => { stage(pkg: { key: string; version: string; tarball: Uint8Array; expectedIntegrity: string }): Promise<unknown> };
  };
  const store = createAddOnStore({ dataDir: env.ADMINIUM_DATA_DIR });
  for (const manifest of [FORMS_MANIFEST, LANDING_MANIFEST]) {
    const bundle = bundleOf({ 'package.json': JSON.stringify({ name: `@adminiumjs/add-on-${String(manifest['key'])}` }), 'manifest.json': JSON.stringify(manifest), 'dist/client.js': 'export const register = () => {};' });
    await store.stage({ key: String(manifest['key']), version: '1.0.0', tarball: bundle.buffer, expectedIntegrity: bundle.integrity });
  }

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
  });
  await composed.app.ready();

  const inject = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, cookie: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Doc> => {
    const res = await composed.app.inject({ method, url, headers: { ...headers, cookie }, ...(payload === undefined ? {} : { payload: payload as Doc }) });
    if (res.statusCode >= 300) throw new Error(`${method} ${url} → ${String(res.statusCode)} ${res.body}`);
    return res.body === '' ? {} : (res.json() as Doc);
  };
  const login = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: ADMIN });
  if (login.statusCode !== 200) throw new Error(`login → ${String(login.statusCode)} ${login.body}`);
  const cookieHeader = login.headers['set-cookie'];
  const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0]! : String(cookieHeader)).split(';')[0]!;

  const connection = await inject('POST', '/api/v1/connections', cookie, { name: 'Website', engine: 'sqlite', dsn: `sqlite:${sourceFile}` });
  const connectionId = String(connection['id']);
  for (const key of [FORMS, LANDING]) await inject('POST', '/api/v1/add-ons', cookie, { key, version: '1.0.0', attachTo: ['dashboard'], connectionId });

  const settings = settingsRepo(meta);
  const by = { updatedBy: null, at: Date.now() };
  await settings.set('system.publicOrigin', `https://${PUBLIC_HOST}`, by);
  await settings.set('privacy.businessName', BUSINESS.legal, by);
  await settings.set('privacy.noticeUrl', BUSINESS.notice, by);
  await settings.set('appearance.accent', 'teal', by);
  // The business's address on its pages ("Questions? Write to …"), kept where the pay page keeps it.
  const { PAY_PAGE_DOC, payPageSchema } = (await import(distUrl('routes/payments/ways.js'))) as { PAY_PAGE_DOC: string; payPageSchema: Parameters<ReturnType<typeof paymentSettingsRepo>['set']>[1] };
  await paymentSettingsRepo(meta).set(PAY_PAGE_DOC, payPageSchema, { shopName: BUSINESS.name, logoFileId: null, contactEmail: BUSINESS.email, contactPhone: null, shopCountry: 'GB', showLines: false });

  const tables: Record<string, string> = {};
  for (const row of await meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) tables[`${row.appKey}:${row.ref}`] = row.tableName;
  // The forms, as the builder publishes them: one live, one closed.
  const db = new BetterSqlite3(sourceFile);
  const formsTable = tables[`${FORMS}:forms`]!;
  const insert = db.prepare(`INSERT INTO ${formsTable} (id, title, slug, kind, state, definition, settings, published) VALUES (?, ?, ?, 'form', ?, '{}', '{}', ?)`);
  insert.run('frm_showroom', 'Book a showroom visit', 'showroom-visit', 'live', JSON.stringify({ definition: SHOWROOM, settings: SETTINGS }));
  insert.run('frm_closed', 'Spring raffle', 'spring-raffle', 'closed', JSON.stringify({ definition: { ...SHOWROOM, title: w('Spring raffle', 'سحب الربيع') }, settings: SETTINGS }));
  db.close();

  // The pages table's id, as the data routes name it.
  const schema = await inject('GET', `/api/v1/connections/${connectionId}/schema`, cookie);
  const listed = (schema['tables'] ?? schema['model']?.tables ?? schema['data']?.tables ?? []) as { id: string; name: string }[];
  const pagesId = listed.find((table) => table.name === tables[`${LANDING}:pages`])!.id;
  const rows = `/api/v1/data/${connectionId}/${encodeURIComponent(pagesId)}`;

  const keys: Record<string, string> = {};
  const files: Record<string, string> = {};
  const doc = (title: string, description: string, blocks: Doc[], more: Doc = {}) => ({ v: 1, title, description, blocks, ...more });
  async function draft(slug: string, language: string, title: string): Promise<void> {
    const made = await inject('POST', rows, cookie, { values: { name: title, slug, state: 'draft', language, draft: doc(title, `${title}.`, []), updated_at: new Date().toISOString() } });
    keys[slug] = String(made['data']['id']);
  }
  async function picture(page: string, name: string, rgb: [number, number, number]): Promise<void> {
    const kept = await composed.app.inject({
      method: 'POST',
      url: `/api/v1/landing/${LANDING}/pictures?page=${keys[page]!}&filename=${name}.png`,
      headers: { cookie, 'content-type': 'image/png' },
      payload: png(320, 180, rgb),
    });
    if (kept.statusCode !== 201) throw new Error(`picture ${name} → ${String(kept.statusCode)} ${kept.body}`);
    files[name] = String((kept.json() as Doc)['data']['id']);
  }
  async function publish(slug: string, document: Doc): Promise<void> {
    await inject('PATCH', `${rows}/${keys[slug]!}`, cookie, { values: { state: 'live', draft: document, published: document } });
  }

  for (const [slug, language, title] of [
    ['acoustic-booths', 'en-US', 'Acoustic booths for open offices'],
    ['open-day', 'en-US', 'Open day at our Leeds showroom'],
    ['thanks-open-day', 'en-US', 'Thanks, see you there'],
    ['kabain', 'ar-EG', 'كبائن هادئة للمكاتب المفتوحة'],
    ['old-offer', 'en-US', 'Spring offer'],
  ] as const) {
    await draft(slug, language, title);
  }
  await picture('acoustic-booths', 'booths', [118, 150, 146]);
  await picture('acoustic-booths', 'sketch', [212, 226, 223]);
  await picture('acoustic-booths', 'share', [0, 113, 103]);
  await picture('kabain', 'kabain', [118, 150, 146]);

  await publish('open-day', {
    ...doc('Open day at our Leeds showroom', 'Thursday 18 September, 10:00–19:00. Sit in the new booths and try the desks.', [
      // Its picture is no file the page owns: it never loads, and the page draws its quiet box (1d-2).
      { id: 'hero', kind: 'hero', heading: 'Open day at our Leeds showroom', text: 'Thursday 18 September, 10:00–19:00. Sit in the new booths and try the desks.', picture: { file: 'missingshowroom', alt: 'A bright showroom with booths and desks' } },
      {
        id: 'feat',
        kind: 'features',
        items: [
          { icon: 'volume-x', heading: 'Quiet inside', text: 'Talk at a normal voice.' },
          { icon: 'wind', heading: 'Air that moves', text: 'A silent fan changes the air every two minutes.' },
          { icon: 'move', heading: 'Moves with you', text: 'Lift it onto wheels and roll it to a new spot.' },
        ],
      },
    ]),
  });
  await publish('acoustic-booths', {
    ...doc(
      'Acoustic booths for open offices',
      'Our booths cut the noise of a busy floor by half.',
      [
        { id: 'h', kind: 'heading', text: 'Acoustic booths for open offices' },
        { id: 't', kind: 'text', text: 'Our booths cut the noise of a busy floor by half. Each one seats two, fits through a standard door, and is in place in a day.' },
        { id: 'p', kind: 'picture', picture: { file: files['booths']!, alt: 'Two grey acoustic booths in an open office' } },
        { id: 'b', kind: 'button', label: 'See them at our open day', link: { kind: 'page', key: keys['open-day']! } },
        {
          id: 'c',
          kind: 'columns',
          columns: [
            { heading: 'What fits where', text: 'Single booths for calls, double booths for two people, and a meeting pod for four.' },
            { text: 'Seen from above.', picture: { file: files['sketch']!, decorative: true } },
          ],
        },
        { id: 's', kind: 'spacer', size: 'm' },
        {
          id: 'f',
          kind: 'features',
          items: [
            { icon: 'volume-x', heading: 'Quiet inside', text: 'Talk at a normal voice.' },
            { icon: 'wind', heading: 'Air that moves', text: 'A silent fan changes the air every two minutes.' },
            { icon: 'move', heading: 'Moves with you', text: 'Lift it onto wheels and roll it to a new spot.' },
          ],
        },
        { id: 'q', kind: 'quote', text: 'The floor is calm again, and nobody books a meeting room for a call.', who: 'Ana Ruiz, office manager' },
        {
          id: 'qa',
          kind: 'questions',
          title: 'Questions and answers',
          items: [
            { question: 'How long does fitting take?', answer: 'One day for up to four booths.' },
            { question: 'Do the booths need power?', answer: 'One standard socket runs the fan and the light.' },
            { question: 'Can we try one first?', answer: 'Yes. Come to our open day in Leeds and sit in one.' },
          ],
        },
        { id: 'go', kind: 'button', label: 'Book a visit', link: { kind: 'form' } },
        { id: 'form', kind: 'form', addOn: FORMS, form: 'frm_showroom' },
      ],
    ),
    picture: { file: files['share']!, alt: 'Two grey acoustic booths in an open office' },
  });
  await publish('thanks-open-day', {
    ...doc('Thanks, see you there', 'We have your booking.', [
      { id: 'h', kind: 'heading', text: 'Thanks, see you there' },
      { id: 't', kind: 'text', text: "We have your booking for Thursday 18 September. We'll confirm your time within one working day." },
      { id: 'b', kind: 'button', label: 'See the booths', link: { kind: 'page', key: keys['acoustic-booths']! } },
      // A form that is closed: left out of the page.
      { id: 'raffle', kind: 'form', addOn: FORMS, form: 'frm_closed' },
    ]),
  });
  await publish('kabain', {
    ...doc('كبائن هادئة للمكاتب المفتوحة', 'جرّب الكبائن الجديدة في صالة العرض في ليدز.', [
      { id: 'h', kind: 'heading', text: 'كبائن هادئة للمكاتب المفتوحة' },
      { id: 't', kind: 'text', text: 'جرّب الكبائن الجديدة في صالة العرض في ليدز.' },
      { id: 'b', kind: 'button', label: 'احجز زيارة', link: { kind: 'page', key: keys['open-day']! } },
      { id: 'p', kind: 'picture', picture: { file: files['kabain']!, alt: 'كبينتان رماديتان في مكتب مفتوح' } },
      {
        id: 'qa',
        kind: 'questions',
        title: 'أسئلة وأجوبة',
        items: [
          { question: 'كم يستغرق التركيب؟', answer: 'يوم واحد لما يصل إلى أربع كبائن.' },
          { question: 'هل تحتاج الكبائن إلى كهرباء؟', answer: 'مقبس عادي واحد يكفي للمروحة والضوء.' },
        ],
      },
      { id: 'form', kind: 'form', addOn: FORMS, form: 'frm_showroom' },
    ]),
  });
  await publish('old-offer', doc('Spring offer', 'Ten per cent off booths in March.', [{ id: 'h', kind: 'heading', text: 'Spring offer' }]));
  await inject('PATCH', `${rows}/${keys['old-offer']!}`, cookie, { values: { state: 'off' } });

  await composed.app.listen({ port: PAGES_PORT, host: '127.0.0.1' });
  return {
    composed,
    keys,
    files,
    async counting(level) {
      await inject('PUT', '/api/v1/privacy/counting', cookie, { level });
    },
    async close() {
      await composed.app.close().catch(() => undefined);
      await runtime.close().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
