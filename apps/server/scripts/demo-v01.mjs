#!/usr/bin/env node
/**
 * v0.1 exit script (workplan/16-milestones.md §3.1 — "under 2 minutes, zero
 * manual config"):
 *
 *   cd apps/server && node scripts/demo-v01.mjs [--no-wait] [--port 4600]
 *
 * 1. creates a throwaway local Postgres database `adminium_demo_<rand>`
 *    (via psql) and loads the Northwind seed,
 * 2. boots the real server on a temp SQLite meta store, seeds the first
 *    super admin, registers the connections/schema/data/generate routes,
 * 3. creates the connection, runs introspection, runs generation —
 *    all over plain HTTP with a real session cookie,
 * 4. prints the timing breakdown + the URL and credentials, then leaves the
 *    server RUNNING for manual browsing (Ctrl-C stops it and drops the demo
 *    database). `--no-wait` exits immediately after the checks (CI mode).
 *
 * Requires: a local PostgreSQL accepting connections for $USER (the same
 * probe the test suites use), and built workspace dists.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(here, '..');
const repoRoot = join(serverRoot, '..', '..');
const distEntry = join(serverRoot, 'dist', 'app.js');
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const NO_WAIT = args.includes('--no-wait');
const portFlag = args.indexOf('--port');
const PORT = portFlag >= 0 ? Number(args[portFlag + 1]) : 4600;

const ok = (msg) => console.log(`  ✓ ${msg}`);
const step = (msg) => console.log(`\n▸ ${msg}`);
const info = (msg) => console.log(`    ${msg}`);

function assert(condition, message) {
  if (!condition) throw new Error(`demo assertion failed: ${message}`);
}

// --- ensure the compiled build exists -------------------------------------------------

if (!existsSync(distEntry)) {
  step('dist/ missing — compiling @adminium/server with the workspace tsc');
  const tscJs = require.resolve('typescript/lib/tsc.js');
  const result = spawnSync(process.execPath, [tscJs, '-p', join(serverRoot, 'tsconfig.json')], {
    cwd: serverRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0 || !existsSync(distEntry)) {
    console.error('Build failed. Try: pnpm --filter @adminium/server... build');
    process.exit(1);
  }
}

// --- locate psql + the Northwind seed -------------------------------------------------

const PG_HOST = process.env.ADMINIUM_TEST_PG_HOST ?? '127.0.0.1';
const PG_PORT = process.env.ADMINIUM_TEST_PG_PORT ?? '5432';
const NORTHWIND_SQL = join(repoRoot, 'packages', 'adapter-postgres', 'fixtures', 'northwind.sql');

function findPsql() {
  const candidates = [
    process.env.ADMINIUM_TEST_PSQL,
    'psql',
    '/opt/homebrew/opt/postgresql@16/bin/psql',
    '/usr/lib/postgresql/16/bin/psql',
  ];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

const PSQL = findPsql();
if (PSQL === null || !existsSync(NORTHWIND_SQL)) {
  console.error('Need a local psql and the Northwind fixture (packages/adapter-postgres/fixtures/northwind.sql).');
  process.exit(1);
}

const psql = (database, sql) =>
  execFileSync(PSQL, ['-h', PG_HOST, '-p', PG_PORT, '-d', database, '-v', 'ON_ERROR_STOP=1', '-Atc', sql], {
    encoding: 'utf8',
  });
const psqlFile = (database, file) =>
  execFileSync(PSQL, ['-h', PG_HOST, '-p', PG_PORT, '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], {
    stdio: 'ignore',
  });

// --- dynamic imports (dist + workspace deps) ------------------------------------------

const distUrl = (rel) => pathToFileURL(join(serverRoot, 'dist', rel)).href;

const [
  { buildServer },
  { envSchema },
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
  { UndoStore },
  meta_,
  { adapterRegistry },
  { default: BetterSqlite3 },
] = await Promise.all([
  import(distUrl('app.js')),
  import(distUrl('config/env.js')),
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
  import(distUrl('crud/undo.js')),
  import('@adminium/meta'),
  import('@adminium/engine/adapter'),
  import('better-sqlite3'),
]);
const { createSqliteMetaDb, firstRun, createFirstSuperAdmin, pagesRepo } = meta_;

// --- the demo --------------------------------------------------------------------------

const EMAIL = 'demo@adminium.local';
const PASSWORD = 'adminium-demo';
const SECRET = randomBytes(32).toString('hex');
const demoDb = `adminium_demo_${randomBytes(4).toString('hex')}`;
const tempDir = mkdtempSync(join(tmpdir(), 'adminium-v01-demo-'));

const timings = [];
async function timed(label, fn) {
  const startedAt = performance.now();
  const value = await fn();
  timings.push([label, performance.now() - startedAt]);
  return value;
}

console.log('v0.1 internal demo — connection → generated admin app (M4 §3.1)');
console.log('=================================================================');
const wallStart = performance.now();

let app = null;
let dropped = false;
const dropDemoDb = () => {
  if (dropped) return;
  dropped = true;
  try {
    psql('postgres', `DROP DATABASE IF EXISTS ${demoDb} WITH (FORCE)`);
  } catch {
    /* already gone */
  }
  rmSync(tempDir, { recursive: true, force: true });
};

try {
  step(`fresh demo database ${demoDb} on ${PG_HOST}:${PG_PORT}`);
  await timed('createdb', async () => psql('postgres', `CREATE DATABASE ${demoDb}`));
  await timed('seed northwind', async () => psqlFile(demoDb, NORTHWIND_SQL));
  const tableCount = psql(demoDb, "SELECT count(*) FROM pg_tables WHERE schemaname='public'").trim();
  ok(`Northwind loaded — ${tableCount} tables`);

  step('boot server (temp SQLite meta, super admin seeded)');
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(join(tempDir, 'meta.sqlite')) });
  await timed('meta firstRun', () => firstRun(meta));
  await createFirstSuperAdmin(meta, {
    email: EMAIL,
    name: 'Demo Admin',
    passwordHash: await hashPassword(PASSWORD),
  });

  const env = envSchema.parse({ ADMINIUM_SECRET: SECRET, PORT: String(PORT), HOST: '127.0.0.1' });
  const dashboardDist = join(repoRoot, 'apps', 'dashboard', 'dist');
  const staticRoot = existsSync(join(dashboardDist, 'index.html')) ? dashboardDist : undefined;

  await timed('server boot', async () => {
    await registerAdapters(adapterRegistry);
    const manager = new ConnectionManager({
      meta,
      crypto: dsnCryptoFromSecret(SECRET),
      metaDsn: null,
      blockLoopback: false, // the demo database IS local by design
    });
    const undoStore = new UndoStore();
    app = await buildServer({ env, metaDb: meta, staticRoot, logger: false });
    await app.register(rbacPlugin, { meta });
    await registerJobsAndRealtime(app, {
      meta,
      resolveUser: (req) => req.user ?? null,
      can: (user, permission) => app.rbac.can(user, permission),
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
      },
      { prefix: '/api/v1' },
    );
    app.addHook('onClose', async () => {
      await manager.disposeAll();
    });
    await app.listen({ port: PORT, host: '127.0.0.1' });
  });
  ok(`listening on http://localhost:${PORT}${staticRoot ? ' (dashboard build served)' : ' (API only — build apps/dashboard for the UI)'}`);

  const base = `http://127.0.0.1:${PORT}`;
  const api = async (method, path, { cookie, body } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie === undefined ? {} : { cookie }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json, headers: res.headers };
  };

  step('login + create the Northwind connection (zero manual config from here)');
  const login = await api('POST', '/api/v1/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  assert(login.status === 200, `login (${login.status})`);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  assert(cookie.startsWith('adminium_session='), 'session cookie issued');

  const user = process.env.USER ?? 'postgres';
  const dsn = `postgres://${user}@${PG_HOST}:${PG_PORT}/${demoDb}`;
  const created = await timed('create connection', () =>
    api('POST', '/api/v1/connections', {
      cookie,
      body: { name: 'northwind-demo', engine: 'postgres', dsn },
    }),
  );
  assert(created.status === 201, `connection create (${created.status}) ${JSON.stringify(created.json)}`);
  const connectionId = created.json.id;
  ok(`connection ${connectionId} (schema-only introspect role, PII masking defaults on)`);

  step('introspect (schema only — never your rows) + generate');
  const introspect = await timed('introspect', () =>
    api('POST', `/api/v1/connections/${connectionId}/introspect`, { cookie }),
  );
  assert(introspect.status === 200 || introspect.status === 202, `introspect (${introspect.status})`);
  if (introspect.status === 202) {
    // Jobs worker path — poll until the snapshot lands.
    for (let i = 0; i < 120; i += 1) {
      const conn = await api('GET', `/api/v1/connections/${connectionId}`, { cookie });
      if (conn.json?.snapshot) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  ok('snapshot stored (classified model, checksum-deduped)');

  const generate = await timed('generate', () =>
    api('POST', `/api/v1/connections/${connectionId}/generate`, { cookie }),
  );
  assert(generate.status === 200, `generate (${generate.status}) ${JSON.stringify(generate.json)}`);
  const g = generate.json;
  ok(`${g.pages} pages generated → nav groups [${g.navGroups.join(', ')}] (intent: ${g.intent})`);
  for (const warning of g.warnings) info(`note: ${warning}`);

  const pages = await pagesRepo(meta).listForConnection(connectionId);
  const dashboards = pages.filter((p) => p.type === 'page-dashboard');
  const crud = pages.filter((p) => p.type === 'page-crud');
  assert(dashboards.length >= 1, 'at least one dashboard');
  assert(crud.some((p) => p.slug === 'customers'), 'customers crud page');
  ok(`pages: ${dashboards.length} dashboard + ${crud.length} crud (${crud.slice(0, 5).map((p) => p.slug).join(', ')}, …)`);

  const bootstrap = await api('GET', '/api/v1/bootstrap', { cookie });
  assert(bootstrap.status === 200, 'bootstrap');
  const navGroups = bootstrap.json.data.nav.groups.map((grp) => `${grp.key}(${grp.items.length})`);
  ok(`bootstrap nav populated: ${navGroups.join(' · ')}`);

  // --- timing breakdown ----------------------------------------------------------------

  const wallMs = performance.now() - wallStart;
  step('timing breakdown');
  for (const [label, ms] of timings) {
    console.log(`    ${label.padEnd(18)} ${(ms / 1000).toFixed(2).padStart(7)} s`);
  }
  const genPipelineMs = timings
    .filter(([l]) => ['create connection', 'introspect', 'generate'].includes(l))
    .reduce((n, [, ms]) => n + ms, 0);
  console.log('    ────────────────────────────');
  console.log(`    connection → app  ${(genPipelineMs / 1000).toFixed(2).padStart(7)} s`);
  console.log(`\n  ⏱  TOTAL WALL CLOCK: ${(wallMs / 1000).toFixed(2)} s  (budget: 120 s — ${wallMs < 120_000 ? 'PASS ✅' : 'FAIL ❌'})`);
  assert(wallMs < 120_000, 'under 2 minutes');

  console.log('\n=================================================================');
  console.log(`  Open:      http://localhost:${PORT}`);
  console.log(`  Login:     ${EMAIL}`);
  console.log(`  Password:  ${PASSWORD}`);
  console.log(`  Demo DB:   ${demoDb} (dropped on exit)`);
  console.log('=================================================================');

  if (NO_WAIT) {
    console.log('\n--no-wait: shutting down.');
    await app.close();
    dropDemoDb();
    process.exit(0);
  }

  console.log('\nServer is running — browse the generated app, Ctrl-C to stop.');
  const shutdown = () => {
    console.log('\nshutting down, dropping demo database…');
    const finish = () => {
      dropDemoDb();
      process.exit(0);
    };
    app.close().then(finish, finish);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  if (app !== null) await app.close().catch(() => {});
  dropDemoDb();
  process.exit(1);
}
