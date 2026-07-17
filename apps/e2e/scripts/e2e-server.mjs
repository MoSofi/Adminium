#!/usr/bin/env node
/**
 * e2e boot script (M9-T05): boots the BUILT @adminium/server serving the
 * BUILT dashboard, against a Northwind source database on the engine chosen
 * by E2E_ENGINE, then seeds the full demo state over the real API:
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
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const serverRoot = join(repoRoot, 'apps', 'server');
const dashboardDist = join(repoRoot, 'apps', 'dashboard', 'dist');

// --- parameters (playwright.config.ts forwards these; fallbacks match tests/constants.ts) ---

const ENGINE = process.env.E2E_ENGINE ?? 'sqlite';
const DEFAULT_PORTS = { sqlite: 4610, postgres: 4611, mysql: 4612 };
const PORT = Number(process.env.E2E_PORT ?? DEFAULT_PORTS[ENGINE] ?? 4610);
const HOST = '127.0.0.1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e@adminium.local';
const ADMIN_NAME = process.env.E2E_ADMIN_NAME ?? 'E2E Admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'adminium-e2e-password';
const CONNECTION_NAME = process.env.E2E_CONNECTION_NAME ?? 'northwind';
const E2E_DATABASE = process.env.E2E_DATABASE ?? 'adminium_e2e';

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

const [{ loadCliEnv, openRuntime, composeServer }, { hashPassword }, { firstRun, createFirstSuperAdmin }, { default: BetterSqlite3 }] =
  await Promise.all([
    import('@adminium/server'),
    import(distUrl('auth/passwords.js')),
    import('@adminium/meta'),
    import('better-sqlite3'),
  ]);

// --- source database per engine -------------------------------------------------------

const tempDir = mkdtempSync(join(tmpdir(), 'adminium-e2e-'));
/** Deterministic sqlite source file (set in prepareSourceDb) — removed on exit. */
let sqliteSourceFile = null;
const fixture = (engineDir, file) =>
  join(repoRoot, 'packages', engineDir, 'fixtures', file);

/** Prepares the Northwind source DB; returns the DSN for the connections API. */
async function prepareSourceDb() {
  if (ENGINE === 'sqlite') {
    // Deterministic path (NOT the mkdtemp dir) so tests/constants.ts can derive
    // the same DSN for the T15 enrichment wizard leg. Pre-deleted so a leftover
    // file from a crashed run never fails the CREATE TABLEs.
    const file = join(tmpdir(), `adminium-e2e-source-sqlite-${String(PORT)}.db`);
    rmSync(file, { force: true });
    const db = new BetterSqlite3(file);
    try {
      db.exec(readFileSync(fixture('adapter-sqlite', 'northwind.sqlite.sql'), 'utf8'));
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
const cleanup = () => {
  rmSync(tempDir, { recursive: true, force: true });
  if (sqliteSourceFile !== null) rmSync(sqliteSourceFile, { force: true });
};

try {
  const dsn = await prepareSourceDb();

  const SECRET = randomBytes(32).toString('hex');
  // Hermetic env: nothing inherited. ADMINIUM_DATA_DIR drives the embedded
  // meta-store fallback into the temp dir; no ADMINIUM_RUNTIME means every
  // desktop-only door in composeServer stays closed, exactly like self-host.
  const env = loadCliEnv(
    { ADMINIUM_SECRET: SECRET },
    { port: PORT, host: HOST, dataDir: tempDir },
  );

  // openRuntime = all three engine adapters + meta store + ConnectionManager +
  // run/apply services + stats collector + widgets allow-lists (null ⇒ /llm
  // skipped — the T15 BYO leg would fail loudly, core flow unaffected).
  runtime = await openRuntime(env, { blockLoopback: false }); // every e2e database is loopback by design
  if (runtime.promptServiceError !== null) {
    log(`AI assist routes skipped (${runtime.promptServiceError.message})`);
  }

  // openRuntime deliberately does NOT bootstrap (migrate/start own that);
  // the e2e harness seeds its throwaway meta store here.
  await firstRun(runtime.metaStore.meta);
  await createFirstSuperAdmin(runtime.metaStore.meta, {
    email: ADMIN_EMAIL,
    name: ADMIN_NAME,
    passwordHash: await hashPassword(ADMIN_PASSWORD),
  });

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

  const login = await inject('POST', '/api/v1/auth/login', {
    payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expectStatus('login', login, 200);
  const setCookie = login.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];

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
} catch (error) {
  console.error(`[e2e-server] boot failed: ${error?.stack ?? error}`);
  if (app !== null) await app.close().catch(() => {});
  if (runtime !== null) await runtime.close().catch(() => {});
  cleanup();
  process.exit(1);
}

const shutdown = () => {
  const finish = () => {
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
