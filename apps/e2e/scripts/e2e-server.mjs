#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * e2e boot script: boots the BUILT @adminium/server serving the BUILT
 * dashboard, against a Northwind source database on the engine chosen by
 * E2E_ENGINE, then seeds the full demo state over the real API:
 *
 *   1. prepare the source DB
 *        sqlite   → temp file seeded from packages/adapter-sqlite/fixtures
 *        postgres → (re)creates E2E_DATABASE on TEST_POSTGRES_URL via `pg`
 *        mysql    → (re)creates E2E_DATABASE on TEST_MYSQL_URL via `mysql2`
 *   2. temp SQLite meta store: firstRun + first super admin
 *   3. compose the server through the SHARED COMPOSITION ROOT — the same
 *      `openRuntime` → `composeServer` path `adminium start` runs (this script
 *      used to hand-wire every route itself, mirroring the pre-fold
 *      demo-v01.mjs; that was a composition path that could drift from the
 *      shipped one, and the e2e suite exists to test the shipped one)
 *   4. seed via `app.inject()` (login → create connection → introspect →
 *      generate), and only THEN listen — a 200 from /api/v1/healthz therefore
 *      means "fully seeded and ready", which is what Playwright's webServer
 *      readiness probe polls.
 *
 * Standalone use (manual browsing): pnpm --filter @adminium/e2e e2e:server
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';

import { createFakeLlmServer } from './fake-llm.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const serverRoot = join(repoRoot, 'apps', 'server');
const dashboardDist = join(repoRoot, 'apps', 'dashboard', 'dist');

// --- parameters (playwright.config.ts forwards these; fallbacks match tests/constants.ts) ---

/**
 * A FIRST-RUN instance: migrated, with its roles, and nothing else.
 *
 * The shared server seeds a super admin before it listens, which is what every
 * other spec signs in as — and which makes `/setup` unreachable, because the
 * route guard bounces it to `/login` the moment `setup.state.required` is
 * false. The six-step onboarding wizard can therefore only be walked on a
 * server that has NOT been bootstrapped. Same script, same seeded Northwind
 * (the wizard needs a real DSN to type), everything after the migrations
 * skipped. See `tests/onboarding.spec.ts`.
 */
const FIRST_RUN = process.env.E2E_FIRST_RUN === '1';
const ENGINE = process.env.E2E_ENGINE ?? 'sqlite';
const DEFAULT_PORTS = { sqlite: 4610, postgres: 4611, mysql: 4612 };
const PORT = Number(process.env.E2E_PORT ?? DEFAULT_PORTS[ENGINE] ?? 4610);
const HOST = '127.0.0.1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e@adminium.local';
const ADMIN_NAME = process.env.E2E_ADMIN_NAME ?? 'E2E Admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'adminium-e2e-password';
/**
 * A second super admin for the files specs — they get their own `api` rate
 * budget, which is keyed by principal (tests/constants.ts explains why).
 */
const FILES_ADMIN_EMAIL = process.env.E2E_FILES_ADMIN_EMAIL ?? 'e2e-files@adminium.local';
const FILES_ADMIN_NAME = 'E2E Files Admin';
const FILES_ADMIN_PASSWORD = process.env.E2E_FILES_ADMIN_PASSWORD ?? 'adminium-e2e-password';
/** A third, for the public API specs: the keys page and its axe sweeps are heavy too. */
const PUBLIC_API_ADMIN_EMAIL = process.env.E2E_PUBLIC_API_ADMIN_EMAIL ?? 'e2e-public-api@adminium.local';
const PUBLIC_API_ADMIN_NAME = 'E2E Public API Admin';
const PUBLIC_API_ADMIN_PASSWORD = process.env.E2E_PUBLIC_API_ADMIN_PASSWORD ?? 'adminium-e2e-password';

// One super admin per heavy spec file, signed in by the file itself
// (tests/constants.ts OWN_PRINCIPALS): the same reason, their own `api` budget.
const OWN_PRINCIPALS = [
  ['e2e-generated@adminium.local', 'E2E Generated App Admin'],
  ['e2e-enrich@adminium.local', 'E2E Enrich Admin'],
  ['e2e-booking@adminium.local', 'E2E Booking App Admin'],
];
const OWN_PRINCIPAL_PASSWORD = 'adminium-e2e-password';
const CONNECTION_NAME = process.env.E2E_CONNECTION_NAME ?? 'northwind';
const E2E_DATABASE = process.env.E2E_DATABASE ?? 'adminium_e2e';
/**
 * The SMTP sink: an in-process `smtp-server` on loopback, plain (no
 * STARTTLS, no AUTH — the transport drops `requireTLS` for a loopback host
 * and sends no AUTH for an empty user), parsed by `mailparser` and served
 * back to the specs as JSON over a second loopback port. Both ports derive
 * from the API port so the three engines never collide (tests/constants.ts
 * mirrors the arithmetic).
 */
const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? PORT + 100);
const SINK_PORT = Number(process.env.E2E_SINK_PORT ?? PORT + 101);
/**
 * The scripted OpenAI-compatible endpoint the assistant specs point a provider
 * at. It is UP for every run and CONFIGURED by none: `llm.enabled` is
 * bootstrap state for the whole instance, so a spec that left a provider
 * behind would change what every spec after it renders. Each assistant spec
 * PUTs the config in `beforeAll` and clears it in `afterAll`.
 */
const FAKE_LLM_PORT = Number(process.env.E2E_FAKE_LLM_PORT ?? PORT + 102);

const log = (msg) => console.log(`[e2e-server] ${msg}`);
const die = (msg) => {
  console.error(`[e2e-server] FATAL: ${msg}`);
  process.exit(1);
};

// --- preflight: built artifacts -----------------------------------------------------

if (!existsSync(join(serverRoot, 'dist', 'app.js'))) {
  die('apps/server/dist missing — run `pnpm turbo run build --filter=@adminium/e2e...` first');
}
if (!existsSync(join(dashboardDist, 'index.html'))) {
  die('apps/dashboard/dist missing — run `pnpm turbo run build --filter=@adminium/e2e...` first');
}

// --- imports: @adminium/server public API + non-exported dist modules ----------------
// Everything the old version imported route-by-route (rbac, jobs, every
// routes/*/index.js, the inline LLM key-crypto mirror, the widgets allow-list
// file URL, the per-engine adapter modules) is internal to `openRuntime` +
// `composeServer` now. Only `hashPassword` is off the package barrel.

const distUrl = (rel) => pathToFileURL(join(serverRoot, 'dist', rel)).href;

const [{ loadCliEnv, openRuntime, composeServer }, { hashPassword }, { firstRun, createFirstSuperAdmin, rolesRepo, usersRepo }, { default: BetterSqlite3 }] =
  await Promise.all([
    import('@adminium/server'),
    import(distUrl('auth/passwords.js')),
    import('@adminium/meta'),
    import('better-sqlite3'),
  ]);

// --- source database per engine -------------------------------------------------------

const tempDir = mkdtempSync(join(tmpdir(), 'adminium-e2e-'));

/**
 * WHERE THE DATA DIR IS, at a path a spec can derive from the port.
 *
 * The data dir itself stays an mkdtemp: two servers (the shared one and the
 * first-run one) run at once and a fixed path would have them share a store.
 * But a spec sometimes has to put a file INTO it — the app catalogue's cache
 * is written only by a refresh JOB that fetches adminium.dev, and an e2e run
 * must never reach the internet, so the cached document is seeded by hand
 * instead. Same reasoning as `sqliteSourcePath()` in tests/constants.ts:
 * one deterministic path both processes compute, rather than a temp path one of
 * them has to guess.
 */
const dataDirPointer = join(tmpdir(), `adminium-e2e-datadir-${String(PORT)}.txt`);
writeFileSync(dataDirPointer, tempDir, { mode: 0o600 });

/** Deterministic sqlite source file (set in prepareSourceDb) — removed on exit. */
let sqliteSourceFile = null;
const fixture = (engineDir, file) =>
  join(repoRoot, 'packages', engineDir, 'fixtures', file);

/**
 * The one column Northwind does not have and this suite
 * needs.
 *
 * The owner's original sentence for the whole files feature is "while creating
 * an invoice, attach a PDF and store the link in the invoices table" — a
 * COLUMN-BOUND file. Nothing in stock Northwind is one: the classifier seeds a
 * `file` block only onto a text column whose NAME matches its file/attachment
 * vocabulary (`classify/columns.ts` r20, `FILE_RE`), and Northwind has no such
 * column on any table. Without one, the e2e suite could only ever exercise the
 * sidecar path, and the flow the feature exists for would be proved by unit
 * tests alone.
 *
 * WHY IT IS ADDED HERE AND NOT TO THE FIXTURES. The per-adapter `fixtures`
 * directories are shared with the three adapters' introspection suites and with
 * `apps/server/test/connections-helpers.ts`; a column added there would ripple
 * into assertions that have nothing to do with files. The e2e harness is the
 * thing that defines the e2e world, so it defines this too.
 *
 * WHY `shippers`. It has three columns, so the new one survives generation's
 * eight-column list cap — a `file-ref` ranks last (`generate/crud-body.ts`
 * `rankColumn`), and on a wide table like `customers` it would be composed out
 * of the grid and the chip would never render. No other spec touches shippers,
 * so the column cannot perturb an unrelated assertion.
 *
 * WHY `varchar(400)`. The seeded reference shape is `url` and a content URL
 * needs 200 characters (`files/refs.ts` REF_MIN_WIDTH); a narrower column
 * would store a truncated link on some engines and refuse the write on others.
 * Nullable, so the create form has nothing extra to satisfy.
 */
const SHIPPER_FILE_COLUMN = 'document_url';

/** Prepares the Northwind source DB; returns the DSN for the connections API. */
async function prepareSourceDb() {
  if (ENGINE === 'sqlite') {
    // Deterministic path (NOT the mkdtemp dir) so tests/constants.ts can derive
    // the same DSN for the enrichment wizard leg. Pre-deleted so a leftover
    // file from a crashed run never fails the CREATE TABLEs.
    const file = join(tmpdir(), `adminium-e2e-source-sqlite-${String(PORT)}.db`);
    rmSync(file, { force: true });
    const db = new BetterSqlite3(file);
    try {
      db.exec(readFileSync(fixture('adapter-sqlite', 'northwind.sqlite.sql'), 'utf8'));
      db.exec(`ALTER TABLE shippers ADD COLUMN ${SHIPPER_FILE_COLUMN} varchar(400)`);
    } finally {
      db.close();
    }
    sqliteSourceFile = file;
    log(`sqlite Northwind at ${file}`);
    return `sqlite:${file}`;
  }

  if (ENGINE === 'postgres') {
    const base = process.env.TEST_POSTGRES_URL ?? '';
    if (base === '') die('E2E_ENGINE=postgres needs TEST_POSTGRES_URL');
    const { default: pg } = await import('pg');
    const admin = new pg.Client({ connectionString: base });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${E2E_DATABASE} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${E2E_DATABASE}`);
    } finally {
      await admin.end();
    }
    const url = new URL(base);
    url.pathname = `/${E2E_DATABASE}`;
    const seeded = new pg.Client({ connectionString: url.toString() });
    await seeded.connect();
    try {
      await seeded.query(readFileSync(fixture('adapter-postgres', 'northwind.sql'), 'utf8'));
      await seeded.query(`ALTER TABLE shippers ADD COLUMN ${SHIPPER_FILE_COLUMN} varchar(400)`);
    } finally {
      await seeded.end();
    }
    log(`postgres Northwind in ${E2E_DATABASE} on ${url.host}`);
    return url.toString();
  }

  if (ENGINE === 'mysql') {
    const base = process.env.TEST_MYSQL_URL ?? '';
    if (base === '') die('E2E_ENGINE=mysql needs TEST_MYSQL_URL');
    const mysql = await import('mysql2/promise');
    const admin = await mysql.createConnection({ uri: base, multipleStatements: true });
    try {
      await admin.query(`DROP DATABASE IF EXISTS \`${E2E_DATABASE}\``);
      await admin.query(`CREATE DATABASE \`${E2E_DATABASE}\``);
    } finally {
      await admin.end();
    }
    const url = new URL(base);
    url.pathname = `/${E2E_DATABASE}`;
    const seeded = await mysql.createConnection({ uri: url.toString(), multipleStatements: true });
    try {
      await seeded.query(readFileSync(fixture('adapter-mysql', 'northwind.mysql.sql'), 'utf8'));
      await seeded.query(`ALTER TABLE shippers ADD COLUMN ${SHIPPER_FILE_COLUMN} varchar(400)`);
    } finally {
      await seeded.end();
    }
    log(`mysql Northwind in ${E2E_DATABASE} on ${url.host}`);
    return url.toString();
  }

  die(`unknown E2E_ENGINE "${ENGINE}" (sqlite | postgres | mysql)`);
  return '';
}

// --- boot --------------------------------------------------------------------------

let app = null;
let runtime = null;
let smtpSink = null;
let sinkHttp = null;
let fakeLlm = null;
const cleanup = () => {
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(dataDirPointer, { force: true });
  if (sqliteSourceFile !== null) rmSync(sqliteSourceFile, { force: true });
};

try {
  const dsn = await prepareSourceDb();

  const SECRET = randomBytes(32).toString('hex');
  // Hermetic env: nothing inherited. ADMINIUM_DATA_DIR drives the embedded
  // meta-store fallback into the temp dir; no ADMINIUM_RUNTIME means every
  // desktop-only door in composeServer stays closed, exactly like self-host.
  const env = loadCliEnv(
    {
      ADMINIUM_SECRET: SECRET,
      // The public API is registered, answering this instance's own pages
      // (`self`), so the keys page, `/api-docs` and its playground can be
      // driven end to end. Registration serves nothing on its
      // own: `publicApi.enabled` still defaults to off.
      ADMINIUM_PUBLIC_API_ORIGINS: process.env.E2E_PUBLIC_API_ORIGINS ?? 'self',
    },
    { port: PORT, host: HOST, dataDir: tempDir },
  );

  // openRuntime = all three engine adapters + meta store + ConnectionManager +
  // run/apply services + stats collector + widgets allow-lists (null ⇒ /llm
  // skipped — the BYO leg would fail loudly, core flow unaffected).
  runtime = await openRuntime(env, { blockLoopback: false }); // every e2e database is loopback by design
  if (runtime.promptServiceError !== null) {
    log(`AI assist routes skipped (${runtime.promptServiceError.message})`);
  }

  // openRuntime deliberately does NOT bootstrap (migrate/start own that);
  // the e2e harness seeds its throwaway meta store here.
  await firstRun(runtime.metaStore.meta);
  if (!FIRST_RUN) {
    await createFirstSuperAdmin(runtime.metaStore.meta, {
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      passwordHash: await hashPassword(ADMIN_PASSWORD),
    });
  }

  // A SECOND super admin, for the files specs alone. The `api` rate bucket is
  // keyed by principal, and those specs are the expensive ones (real uploads, a
  // schema plan+apply, a create dialog) — sharing one budget with the rest of
  // the suite tipped whole runs over the ceiling. See tests/constants.ts.
  if (!FIRST_RUN) {
    const meta = runtime.metaStore.meta;
    const superAdmin = await rolesRepo(meta).findBySlug('super-admin');
    const extra = [
      [FILES_ADMIN_EMAIL, FILES_ADMIN_NAME, FILES_ADMIN_PASSWORD],
      // The public API specs, for the same reason: their own `api` budget.
      [PUBLIC_API_ADMIN_EMAIL, PUBLIC_API_ADMIN_NAME, PUBLIC_API_ADMIN_PASSWORD],
      ...OWN_PRINCIPALS.map(([email, name]) => [email, name, OWN_PRINCIPAL_PASSWORD]),
    ];
    for (const [email, name, password] of extra) {
      const user = await usersRepo(meta).create({
        email,
        name,
        passwordHash: await hashPassword(password),
        status: 'active',
      });
      if (superAdmin !== null) await rolesRepo(meta).assignToUser(user.id, superAdmin.id);
    }
  }

  // --- the SMTP sink: up before the server so a send can never race it -----------
  const sinkMessages = [];
  smtpSink = new SMTPServer({
    authOptional: true,
    disabledCommands: ['AUTH', 'STARTTLS'],
    disableReverseLookup: true,
    logger: false,
    onData(stream, session, callback) {
      simpleParser(stream).then(
        (parsed) => {
          const list = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
          sinkMessages.push({
            receivedAt: Date.now(),
            envelope: {
              from: session.envelope.mailFrom === false ? '' : session.envelope.mailFrom.address,
              to: session.envelope.rcptTo.map((entry) => entry.address),
            },
            subject: parsed.subject ?? '',
            from: parsed.from?.text ?? '',
            to: list(parsed.to).flatMap((entry) => entry.value.map((address) => address.address ?? '')),
            html: typeof parsed.html === 'string' ? parsed.html : '',
            text: parsed.text ?? '',
            attachments: parsed.attachments.map((attachment) => ({
              filename: attachment.filename ?? '',
              contentType: attachment.contentType,
              cid: attachment.cid ?? null,
              size: attachment.size,
              related: attachment.related === true,
            })),
          });
          callback();
        },
        (error) => callback(error instanceof Error ? error : new Error(String(error))),
      );
    },
  });
  await new Promise((resolve, reject) => {
    smtpSink.once('error', reject);
    smtpSink.listen(SMTP_PORT, HOST, () => resolve());
  });
  sinkHttp = createHttpServer((req, res) => {
    if (req.url === '/messages' && req.method === 'GET') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(sinkMessages));
      return;
    }
    if (req.url === '/messages' && req.method === 'DELETE') {
      sinkMessages.length = 0;
      res.statusCode = 204;
      res.end();
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((resolve) => sinkHttp.listen(SINK_PORT, HOST, resolve));
  log(`SMTP sink listening on ${HOST}:${String(SMTP_PORT)} — messages at http://${HOST}:${String(SINK_PORT)}/messages`);

  // --- the scripted LLM: up beside the sink, configured by nobody ---------------
  fakeLlm = createFakeLlmServer();
  await new Promise((resolve) => fakeLlm.listen(FAKE_LLM_PORT, HOST, resolve));
  log(`fake LLM listening on http://${HOST}:${String(FAKE_LLM_PORT)}/v1 (no provider is configured at boot)`);

  const composed = await composeServer({
    env,
    metaStore: runtime.metaStore,
    manager: runtime.manager,
    runService: runtime.runService,
    applyService: runtime.applyService,
    allowed: runtime.allowed,
    collectStats: runtime.collectStats,
    staticRoot: dashboardDist,
    logger: false,
    telemetry: false, // a throwaway e2e server registers no reporting schedule
  });
  app = composed.app;
  await app.ready();

  // --- seed over the real API (inject: not listening yet — readiness probe
  // stays red until every page is generated) ------------------------------------

  const inject = async (method, url, { cookie, payload } = {}) => {
    const res = await app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload }),
      ...(cookie === undefined ? {} : { headers: { cookie } }),
    });
    let json = null;
    try {
      json = res.json();
    } catch {
      /* non-JSON reply */
    }
    return { status: res.statusCode, json, headers: res.headers };
  };
  const expectStatus = (label, res, ...codes) => {
    if (!codes.includes(res.status)) {
      throw new Error(`${label} → ${res.status} ${JSON.stringify(res.json)}`);
    }
  };

  if (FIRST_RUN) {
    // Nothing to sign in as, nothing to seed: the wizard is the thing under
    // test, and it does the connecting, the inviting and the generating.
    // SMTP is deliberately left unconfigured — a fresh install has none, which
    // is what puts the invitation LINK on screen instead of an email.
    await app.listen({ port: PORT, host: HOST });
    log(`READY (first run) on http://${HOST}:${PORT} — no account, setup is open`);
  } else {

  const login = await inject('POST', '/api/v1/auth/login', {
    payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expectStatus('login', login, 200);
  const setCookie = login.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
  // Point the relay at the sink. `user: ''` → no AUTH; loopback → plain.
  const emailSettings = await inject('PUT', '/api/v1/settings/email', {
    cookie,
    payload: { smtp: { host: HOST, port: SMTP_PORT, user: '', from: `E2E <${ADMIN_EMAIL}>`, secure: false } },
  });
  expectStatus('email settings', emailSettings, 200);

  const created = await inject('POST', '/api/v1/connections', {
    cookie,
    payload: { name: CONNECTION_NAME, engine: ENGINE, dsn },
  });
  expectStatus('create connection', created, 201);
  const connectionId = created.json.id;
  log(`connection ${connectionId} (${ENGINE})`);

  const introspect = await inject('POST', `/api/v1/connections/${connectionId}/introspect`, { cookie });
  expectStatus('introspect', introspect, 200, 202);
  if (introspect.status === 202) {
    // Async job path — poll the connection until the snapshot lands.
    let snapshotSeen = false;
    for (let i = 0; i < 240 && !snapshotSeen; i += 1) {
      const conn = await inject('GET', `/api/v1/connections/${connectionId}`, { cookie });
      snapshotSeen = conn.json?.snapshot != null;
      if (!snapshotSeen) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!snapshotSeen) throw new Error('introspection job did not produce a snapshot in 120s');
  }
  log('introspection snapshot stored');

  const generate = await inject('POST', `/api/v1/connections/${connectionId}/generate`, { cookie });
  expectStatus('generate', generate, 200);
  log(`generated ${generate.json.pages} pages → nav groups [${generate.json.navGroups.join(', ')}]`);

  const bootstrap = await inject('GET', '/api/v1/bootstrap', { cookie });
  expectStatus('bootstrap', bootstrap, 200);
  const groups = bootstrap.json.data.nav.groups;
  if (groups.length === 0) throw new Error('bootstrap nav is empty after generation');

  // Ready: listen — Playwright's /api/v1/healthz probe now turns green.
  await app.listen({ port: PORT, host: HOST });
  log(`READY on http://${HOST}:${PORT} — ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  }
} catch (error) {
  console.error(`[e2e-server] boot failed: ${error?.stack ?? error}`);
  if (app !== null) await app.close().catch(() => {});
  if (runtime !== null) await runtime.close().catch(() => {});
  if (sinkHttp !== null) sinkHttp.close();
  if (smtpSink !== null) smtpSink.close();
  if (fakeLlm !== null) fakeLlm.close();
  cleanup();
  process.exit(1);
}

const shutdown = () => {
  const finish = () => {
    if (sinkHttp !== null) sinkHttp.close();
    if (smtpSink !== null) smtpSink.close();
    if (fakeLlm !== null) fakeLlm.close();
    cleanup();
    process.exit(0);
  };
  // app.close() disposes the manager (compose.ts onClose); runtime.close()
  // is idempotent over that and additionally closes the meta store.
  app
    .close()
    .then(() => runtime.close())
    .then(finish, finish);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
