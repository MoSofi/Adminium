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
 *   3. compose the server exactly like apps/server/scripts/demo-v01.mjs
 *      (buildServer + rbac + jobs/realtime + connections/schema/data/
 *      generate/schema-import/pages/widget-data/settings routes), with all
 *      three engine adapters registered
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
// (same pattern as apps/server/scripts/demo-v01.mjs — routes/plugins are not
// part of the package's export surface, so they are loaded by dist path).

const distUrl = (rel) => pathToFileURL(join(serverRoot, 'dist', rel)).href;

const [
  { buildServer, envSchema },
  { hashPassword },
  { rbacPlugin },
  { registerJobsAndRealtime },
  { dsnCryptoFromSecret },
  { ConnectionManager },
  { registerAdapters },
  { connectionsRoutes },
  { schemaRoutes },
  { dataRoutes },
  { generateRoutes },
  { schemaImportRoutes },
  { pagesRoutes },
  { widgetDataRoutes },
  { settingsRoutes },
  { meViewsRoutes },
  { llmRoutes },
  { createRunService },
  { createApplyService },
  { createProviderResolver },
  { deriveKey, encryptSecret, decryptSecret },
  { UndoStore },
  { createSqliteMetaDb, firstRun, createFirstSuperAdmin },
  { adapterRegistry },
  sqliteAdapterModule,
  mysqlAdapterModule,
  { default: BetterSqlite3 },
] = await Promise.all([
  import('@adminium/server'),
  import(distUrl('auth/passwords.js')),
  import(distUrl('plugins/rbac.js')),
  import(distUrl('jobs/register.js')),
  import(distUrl('connections/crypto.js')),
  import(distUrl('connections/manager.js')),
  import(distUrl('connections/register-adapters.js')),
  import(distUrl('routes/connections/index.js')),
  import(distUrl('routes/schema/index.js')),
  import(distUrl('routes/data/index.js')),
  import(distUrl('routes/generate/index.js')),
  import(distUrl('routes/schema-import/index.js')),
  import(distUrl('routes/pages/index.js')),
  import(distUrl('routes/widget-data/index.js')),
  import(distUrl('routes/settings/index.js')),
  import(distUrl('routes/me-views/index.js')),
  import(distUrl('routes/llm/index.js')),
  import(distUrl('llm/run-service.js')),
  import(distUrl('llm/apply-service.js')),
  import(distUrl('llm/provider-resolver.js')),
  import(distUrl('config/secrets.js')),
  import(distUrl('crud/undo.js')),
  import('@adminium/meta'),
  import('@adminium/engine/adapter'),
  import('@adminium/adapter-sqlite'),
  import('@adminium/adapter-mysql'),
  import('better-sqlite3'),
]);
/**
 * Build the LLM API-key crypto closures (`LlmKeyCrypto` — 06 §3.2) inline from
 * the server's AES-256-GCM `secrets` primitives, scoped by the LLM key salt.
 * Mirrors `@adminium/llm`'s `llmKeyCryptoFromSecret` WITHOUT importing that
 * package — it is not an apps/e2e dependency, and the BYO golden path only needs
 * the closures the routes require, not the package's browser-safe barrel.
 */
const LLM_KEY_SALT = 'adminium:llm-key:v1';
const llmKeyCryptoFromSecret = (secret) => {
  const key = deriveKey(secret, LLM_KEY_SALT);
  return { encrypt: (plaintext) => encryptSecret(plaintext, key), decrypt: (token) => decryptSecret(token, key) };
};
// The LLM allow-lists live in @adminium/widgets, which the server tree may not
// import (01 §2.3) — the app-wiring layer supplies them. Load from the built
// widgets dist by file path (same pattern as apps/server/scripts/demo-v01.mjs).
const widgetsAllowlistUrl = pathToFileURL(
  join(repoRoot, 'packages', 'widgets', 'dist', 'registry', 'llm-allowlist.js'),
).href;

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
const cleanup = () => {
  rmSync(tempDir, { recursive: true, force: true });
  if (sqliteSourceFile !== null) rmSync(sqliteSourceFile, { force: true });
};

try {
  const dsn = await prepareSourceDb();

  // Meta store: temp SQLite file + first super admin.
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(join(tempDir, 'meta.sqlite')) });
  await firstRun(meta);
  await createFirstSuperAdmin(meta, {
    email: ADMIN_EMAIL,
    name: ADMIN_NAME,
    passwordHash: await hashPassword(ADMIN_PASSWORD),
  });

  // All three engine adapters into the process-wide registry.
  await registerAdapters(adapterRegistry);
  for (const provider of [sqliteAdapterModule.sqliteAdapter, mysqlAdapterModule.mysqlAdapter]) {
    if (provider !== undefined && !adapterRegistry.has(provider.dialect)) {
      adapterRegistry.register(provider);
    }
  }

  const SECRET = randomBytes(32).toString('hex');
  const env = envSchema.parse({ ADMINIUM_SECRET: SECRET, PORT: String(PORT), HOST });

  const manager = new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret(SECRET),
    metaDsn: null,
    blockLoopback: false, // every e2e database is loopback by design
  });
  const undoStore = new UndoStore();

  app = await buildServer({ env, metaDb: meta, staticRoot: dashboardDist, logger: false });
  await app.register(rbacPlugin, { meta });

  // --- LLM assist wiring (M6, 06-llm-assist.md §10.5) --------------------------
  // Enables the connect wizard's "Enrich with AI" step + review/apply so the
  // T15 golden BYO round-trip e2e can run. Degrades gracefully: if the widgets
  // allow-lists aren't built, only the AI routes are skipped (core flow unaffected).
  let llmWiring = null;
  try {
    const { LLM_ALLOWED_TEMPLATES, LLM_ALLOWED_WIDGETS } = await import(widgetsAllowlistUrl);
    const keyCrypto = llmKeyCryptoFromSecret(SECRET);
    const runService = createRunService({ meta });
    const applyService = createApplyService({ meta, runService });
    const resolve = createProviderResolver({
      meta,
      keyCrypto,
      allowedTemplates: LLM_ALLOWED_TEMPLATES,
      allowedWidgets: LLM_ALLOWED_WIDGETS,
    });
    llmWiring = {
      runService,
      applyService,
      keyCrypto,
      resolve,
      allowed: { templates: LLM_ALLOWED_TEMPLATES, widgets: LLM_ALLOWED_WIDGETS },
    };
  } catch (error) {
    log(`AI assist routes skipped (${error?.message ?? error})`);
  }

  await registerJobsAndRealtime(app, {
    meta,
    resolveUser: (req) => req.user ?? null,
    can: (user, permission) => app.rbac.can(user, permission),
    ...(llmWiring ? { llm: { resolve: llmWiring.resolve } } : {}),
  });
  await app.register(
    async (api) => {
      await api.register(connectionsRoutes({ manager, meta }));
      await api.register(schemaRoutes({ manager, meta }));
      await api.register(dataRoutes({ manager, meta, undoStore }));
      await api.register(generateRoutes({ manager, meta }));
      await api.register(schemaImportRoutes());
      await api.register(pagesRoutes({ meta }));
      await api.register(widgetDataRoutes({ manager, meta }));
      await api.register(settingsRoutes({ meta }));
      await api.register(meViewsRoutes({ meta }));
      if (llmWiring) {
        await api.register(
          llmRoutes({
            meta,
            runService: llmWiring.runService,
            applyService: llmWiring.applyService,
            keyCrypto: llmWiring.keyCrypto,
            allowed: llmWiring.allowed,
          }),
        );
      }
    },
    { prefix: '/api/v1' },
  );
  app.addHook('onClose', async () => {
    await manager.disposeAll();
  });
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
  cleanup();
  process.exit(1);
}

const shutdown = () => {
  const finish = () => {
    cleanup();
    process.exit(0);
  };
  app.close().then(finish, finish);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
