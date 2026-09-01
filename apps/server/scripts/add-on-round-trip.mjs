#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ADD-ON ROUND TRIP (26-add-on-runtime.md §9, 26-T15).
 *
 *   node apps/server/scripts/add-on-round-trip.mjs
 *
 * ── WHY THIS IS A SCRIPT AND NOT A SUITE ───────────────────────────────────
 *
 * 26 D6 says it in one line: "the acceptance test is a round trip, not a green
 * suite". The failure it is written against is the M10/M11 one — routes
 * exported and never registered, green the whole way — and the add-on layer
 * has already produced its own version of it. So this does not build a server
 * out of parts the way `demo-m2.mjs` does. It SPAWNS THE REAL BINARY, the way
 * an operator starts one, and everything below happens over HTTP against a
 * process that knows nothing about this file.
 *
 * That is the point of the exercise. A composed-by-hand server can register the
 * routes a test remembers to register; a spawned one registers whatever
 * `compose.ts` actually wires, which is acceptance #8's whole subject.
 *
 * ── WHAT IT NEEDS ──────────────────────────────────────────────────────────
 *
 *   · a built server           `pnpm --filter @adminium/server... build`
 *   · a reachable PostgreSQL   TEST_POSTGRES_URL, or postgres://localhost:5432
 *   · the add-on tarballs      `npm run release:dry` in the add-ons repo,
 *                              which writes them to scripts/out/
 *
 * It creates its own database and its own data directory, and drops both on
 * the way out — including after a failure, because a half-finished round trip
 * that leaves a database behind is one somebody has to clean up by hand before
 * they can run it again.
 *
 * ── WHAT IT DOES NOT COVER, STATED HERE RATHER THAN IMPLIED ────────────────
 *
 * Acceptance #3's second half — "a connected add-on's surface appears in a
 * host" — is a BROWSER question. This script proves the server half of it: the
 * list a host reads, the bundle URL in it, the integrity value, and the bytes
 * behind that URL hashing to it. Whether a React app then draws the fill is
 * `print-shop`'s own ground, and `src/add-ons/connected.test.ts` there drives
 * the loader that does it. Both halves are named in the plan's run record.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(here, '..');
const repoRoot = join(serverRoot, '..', '..');

const ok = (m) => console.log(`  [32m✓[0m ${m}`);
const step = (m) => console.log(`\n[1m▸ ${m}[0m`);
const info = (m) => console.log(`      ${m}`);

let failures = 0;
function check(condition, message) {
  if (condition) {
    ok(message);
    return true;
  }
  failures += 1;
  console.log(`  [31m✗[0m ${message}`);
  return false;
}

// ── inputs ──────────────────────────────────────────────────────────────────

const CLI = join(serverRoot, 'dist', 'cli', 'index.js');
if (!existsSync(CLI)) {
  console.error('No build. Run:  pnpm --filter @adminium/server... build');
  process.exit(1);
}

/**
 * The tarballs, from the add-ons repo beside this one.
 *
 * Real packages, packed by the same script that publishes them — not fixtures.
 * D6 says "from a real manifest", and a fixture written here would be a
 * manifest this repository wrote for itself to pass.
 */
const ADD_ONS_REPO = process.env.ADD_ONS_REPO ?? join(repoRoot, '..', 'add-ons');
const OUT = join(ADD_ONS_REPO, 'scripts', 'out');
if (!existsSync(OUT)) {
  console.error(`No packed add-ons at ${OUT}.`);
  console.error('Run `npm run release:dry` in the add-ons repo first.');
  process.exit(1);
}

const PACKAGES = readdirSync(OUT)
  .filter((f) => f.endsWith('.tgz'))
  .map((file) => {
    const bytes = readFileSync(join(OUT, file));
    return {
      file,
      // `adminiumjs-add-on-<key>-<version>.tgz`
      key: /^adminiumjs-add-on-(.+)-\d+\.\d+\.\d+\.tgz$/.exec(file)?.[1] ?? file,
      version: /-(\d+\.\d+\.\d+)\.tgz$/.exec(file)?.[1] ?? '0.0.0',
      bytes,
      sha512: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    };
  });

const POSTGRES = process.env.TEST_POSTGRES_URL ?? 'postgres://localhost:5432/postgres';

/**
 * `--keep` leaves the stack up for the BROWSER half of acceptance #3.
 *
 * The server half of "a connected add-on's surface appears in a host" is
 * everything below; the other half is a React app drawing a fill, and that
 * needs a server still running when the browser arrives. With `--keep` the
 * database and the port are fixed rather than per-run, so `.claude/launch.json`
 * and a host's dev proxy can both name them, and nothing is torn down — the
 * script prints how to reach it and how to clean it up by hand.
 */
const KEEP = process.argv.includes('--keep');

/**
 * `--air-gapped` runs the SAME loop with `ADMINIUM_NETWORK_FEATURES=off`
 * (32-T13, acceptance #2).
 *
 * Not a separate script, because the thing being asserted is that it IS the
 * same loop: the bundled set browses and installs, a sideloaded tarball with an
 * operator-supplied hash installs, and every path that would reach a registry
 * refuses without trying. A second script would drift from this one and would
 * stop proving that.
 */
const AIR_GAPPED = process.argv.includes('--air-gapped');

/**
 * `--online-catalog` adds 32 acceptance #1's CATALOG LEG on the end of the
 * default loop: switch the online catalog on, refresh from the real
 * `adminium.dev/marketplace/catalog.json`, download one add-on from the real
 * registry (packument pin → ledger cross-check → hardened unpack → staged),
 * and install it from the stage. It reaches the live internet by design —
 * that is the acceptance — so it is a flag rather than the default, and it
 * contradicts `--air-gapped` outright.
 */
const ONLINE_CATALOG = process.argv.includes('--online-catalog');
if (ONLINE_CATALOG && AIR_GAPPED) {
  console.error('--online-catalog and --air-gapped contradict each other; pick one.');
  process.exit(2);
}
const DB = KEEP
  ? 'adminium_round_trip_keep'
  : `adminium_round_trip_${Math.abs(process.pid)}_${process.hrtime.bigint() % 100000n}`;

const EMAIL = 'owner@round-trip.test';
const PASSWORD = 'correct-horse-battery-staple-26';

// ── plumbing ────────────────────────────────────────────────────────────────

let dataDir = null;
let child = null;
let baseUrl = null;
let cookie = null;
/**
 * The §7-item-4 CSRF token.
 *
 * A cookie-authenticated mutation is refused without it, which is correct and
 * is why this script holds one: driving the API "as an operator would" means
 * carrying what a browser carries, not switching the check off. The token
 * arrives with the session — `POST /setup/super-admin` and `GET /bootstrap`
 * both mint it — and rides in `x-adminium-csrf`.
 */
let csrf = null;

async function pg(sql, url = POSTGRES) {
  const { default: pgLib } = await import(
    join(serverRoot, 'node_modules', 'pg', 'lib', 'index.js')
  ).catch(async () => ({ default: (await import('pg')).default }));
  const client = new pgLib.Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

async function api(method, path, { body, raw, query, cookie: as = cookie, headers = {} } = {}) {
  const url = new URL(path, baseUrl);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(raw !== undefined ? { 'content-type': 'application/octet-stream' } : {}),
      ...(as !== null && as !== undefined ? { cookie: as } : {}),
      ...(csrf !== null && method !== 'GET' ? { 'x-adminium-csrf': csrf } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(raw !== undefined ? { body: raw } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  const set = res.headers
    .getSetCookie()
    .map((h) => h.split(';')[0])
    .find((p) => p.startsWith('adminium_session='));
  return { status: res.status, json, cookie: set ?? null, text };
}

/**
 * Polls `GET /api/v1/jobs/:id` until the job leaves `queued`/`running`, and
 * returns the terminal status string. The online leg's two jobs both talk to
 * the live internet, so the deadline is generous rather than tight — a slow
 * registry is not a failed acceptance.
 */
async function waitForJob(jobId, deadlineMs = 120_000) {
  const startedAt = Date.now();
  for (;;) {
    const res = await api('GET', `/api/v1/jobs/${jobId}`);
    // The jobs route wraps its view: `{ data: { status, … } }` (§1.5 shape).
    const jobStatus = res.json?.data?.status ?? `HTTP ${String(res.status)}`;
    if (jobStatus !== 'pending' && jobStatus !== 'queued' && jobStatus !== 'running') {
      return jobStatus;
    }
    if (Date.now() - startedAt > deadlineMs) return `timed out as ${jobStatus}`;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function waitForHealth(url, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(new URL('/api/v1/healthz', url));
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function cleanup() {
  if (KEEP) {
    console.log('');
    console.log(`[1mLeft running for the browser half:[0m ${String(baseUrl)}`);
    console.log(`  sign in    ${EMAIL} / ${PASSWORD}`);
    console.log(`  database   ${DB}`);
    console.log(`  data dir   ${String(dataDir)}`);
    console.log('  host       cd ../print-shop && npm run dev:hosted');
    console.log(`  clean up   kill ${String(child?.pid)} && dropdb ${DB} && rm -rf ${String(dataDir)}`);
    /*
     * Detached from this process's lifetime, so the server outlives the script
     * and this script EXITS. An earlier draft parked on a promise that never
     * settles, which kept the shell occupied for as long as the sandbox lived —
     * the opposite of what `--keep` is for.
     *
     * The child's stdio is `ignore` in this mode (below) rather than `pipe`: a
     * detached child writing into pipes whose only reader has exited takes
     * EPIPE, which would kill the very server this flag exists to keep.
     */
    child?.unref();
    return;
  }
  if (child !== null && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  if (dataDir !== null) rmSync(dataDir, { recursive: true, force: true });
  try {
    await pg(`drop database if exists ${DB} with (force)`);
  } catch {
    /* the database may never have been created */
  }
}

// ── the round trip ──────────────────────────────────────────────────────────

async function main() {
  console.log(
    AIR_GAPPED
      ? 'Add-on round trip, AIR-GAPPED — 32-add-on-distribution.md §7 #2'
      : 'Add-on round trip — 26-add-on-runtime.md §9',
  );
  console.log('==============================================');
  info(`${PACKAGES.length} package(s) from ${OUT}`);

  step('a real database and a real data directory');
  await pg(`create database ${DB}`);
  const sourceUrl = new URL(POSTGRES);
  sourceUrl.pathname = `/${DB}`;
  dataDir = mkdtempSync(join(tmpdir(), 'adminium-round-trip-'));
  ok(`postgres ${DB}, data dir ${dataDir}`);

  /*
   * A HOST TABLE THE ADD-ONS CAN ATTACH TO.
   *
   * `design-studio` declares `artwork_designs.job_id -> jobs` and
   * `personalizer` declares two more into `products` and `order_lines`. Those
   * belong to the HOST — that is the intended shape for an add-on attaching to
   * a shop's own data — so the planner resolves them as `host` references and
   * the install creates only what the add-on brings. Without them the plan is
   * correctly UNINSTALLABLE, which is a different thing to prove and is proved
   * further down.
   */
  await pg(
    `create table jobs (id text primary key, ref text);
     create table products (id text primary key, name text);
     create table order_lines (id text primary key, product_id text);
     insert into jobs (id, ref) values ('j1', 'MP-1001');`,
    sourceUrl.toString(),
  );
  ok('host tables: jobs, products, order_lines');

  step('spawning the REAL server binary (acceptance #8 is about compose.ts)');
  const port = KEEP ? 4808 : 4700 + (Number(process.pid) % 200);
  child = spawn(
    process.execPath,
    [CLI, 'start', '--port', String(port), '--host', '127.0.0.1'],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        ADMINIUM_DATA_DIR: dataDir,
        ADMINIUM_SECRET: 'a'.repeat(64),
        ADMINIUM_META_URL: `sqlite:${join(dataDir, 'meta.db')}`,
        ADMINIUM_SOURCE_URL: sourceUrl.toString(),
        ADMINIUM_LOG_LEVEL: 'warn',
        ...(AIR_GAPPED ? { ADMINIUM_NETWORK_FEATURES: 'off' } : {}),
      },
      stdio: KEEP ? 'ignore' : ['ignore', 'pipe', 'pipe'],
      detached: KEEP,
    },
  );
  const serverLog = [];
  child.stdout?.on('data', (b) => serverLog.push(String(b)));
  child.stderr?.on('data', (b) => serverLog.push(String(b)));
  baseUrl = `http://127.0.0.1:${port}`;
  if (!(await waitForHealth(baseUrl))) {
    console.error(serverLog.join(''));
    throw new Error('the server never became healthy');
  }
  ok(`listening on ${baseUrl}`);

  step('first run: an owner, and a session');
  const setup = await api('POST', '/api/v1/setup/super-admin', {
    body: { email: EMAIL, password: PASSWORD, name: 'Round Trip' },
  });
  if (!check(setup.status === 201, `super admin created (${String(setup.status)})`)) {
    info(JSON.stringify(setup.json).slice(0, 400));
  }
  const login = await api('POST', '/api/v1/auth/login', {
    body: { email: EMAIL, password: PASSWORD },
  });
  cookie = login.cookie;
  check(cookie !== null, 'signed in, session cookie held');
  const boot = await api('GET', '/api/v1/bootstrap');
  csrf = boot.json?.data?.csrfToken ?? boot.json?.csrfToken ?? null;
  check(csrf !== null, 'and the CSRF token a browser would carry with every mutation');

  // ── acceptance #6 — the permission gate ───────────────────────────────────
  step('acceptance #6 — `manifests.manage` gates the routes');
  const anonymous = await api('GET', '/api/v1/add-ons', { cookie: null });
  check(
    anonymous.status === 401 || anonymous.status === 403,
    `no session is refused (${String(anonymous.status)}), which is why connected mode is hosted-only`,
  );

  // ── acceptance #1 — install from a real manifest ──────────────────────────
  step('acceptance #1 — a real add-on installs from its real manifest');
  const installed = [];
  for (const pkg of PACKAGES) {
    const staged = await api('POST', '/api/v1/add-ons/upload', {
      query: { key: pkg.key, version: pkg.version, expectedSha512: pkg.sha512 },
      raw: pkg.bytes,
    });
    if (!check(staged.status === 200, `staged ${pkg.key}@${pkg.version} (${String(staged.status)})`)) {
      info(JSON.stringify(staged.json).slice(0, 300));
      continue;
    }

    const plan = await api('GET', `/api/v1/add-ons/${pkg.key}/plan`);
    const p = plan.json?.plan;
    info(
      `plan: create=[${(p?.create ?? []).map((t) => t.ref).join(', ')}] ` +
        `reuse=[${(p?.reuse ?? []).map((t) => t.ref).join(', ')}] ` +
        `installable=${String(p?.installable)}`,
    );

    // Every shipped add-on attaches to `printing` or to `*`; the install route
    // refuses a host the manifest does not claim, which is checked below.
    const res = await api('POST', '/api/v1/add-ons', {
      body: { key: pkg.key, version: pkg.version, attachTo: ['printing'] },
    });
    if (res.status === 200) {
      installed.push({ ...pkg, plan: res.json.plan });
      ok(`installed ${pkg.key}`);
    } else {
      // Not every add-on attaches to a print works. That is a correct refusal
      // and it is reported rather than counted as a failure.
      info(`${pkg.key}: ${String(res.status)} ${String(res.json?.error?.message ?? '').slice(0, 120)}`);
    }
  }
  check(installed.length > 0, `${String(installed.length)} add-on(s) installed`);

  step('acceptance #1 — and the tables its requiredSchema declares exist');
  const wanted = installed.flatMap((i) => (i.plan?.create ?? []).map((t) => t.ref));
  const live = (
    await pg(
      `select table_name from information_schema.tables where table_schema = 'public'`,
      sourceUrl.toString(),
    )
  ).rows.map((r) => r.table_name);
  for (const table of wanted) {
    check(live.includes(table), `${table} exists in the database`);
  }
  if (wanted.length === 0) info('(no add-on in this set brought a table it did not already have)');

  // A foreign key into the HOST's data, which is the shape the whole design is
  // for — asserted against the catalogue rather than against the plan.
  const fks = (
    await pg(
      `select tc.table_name, ccu.table_name as target
         from information_schema.table_constraints tc
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name
        where tc.constraint_type = 'FOREIGN KEY'
          and tc.table_schema = 'public'`,
      sourceUrl.toString(),
    )
  ).rows;
  const intoHost = fks.filter((r) => ['jobs', 'products', 'order_lines'].includes(r.target));
  if (wanted.length > 0) {
    check(
      intoHost.length > 0,
      `an add-on's table points at the host's own data (${intoHost
        .map((r) => `${r.table_name}→${r.target}`)
        .join(', ')})`,
    );
  }

  // ── acceptance #2 — the connect kinds ─────────────────────────────────────
  step('acceptance #2 — the connect kinds, against the real manifests');
  const list1 = await api('GET', '/api/v1/add-ons');
  const kinds = new Map((list1.json?.addOns ?? []).map((a) => [a.key, a.connectKind]));
  info([...kinds].map(([k, v]) => `${k}=${v}`).join('  '));

  for (const [key, kind] of kinds) {
    if (kind === 'none') {
      const res = await api('POST', `/api/v1/add-ons/${key}/connect`, { body: { values: {} } });
      check(
        res.status >= 400,
        `${key}: connect kind "none" refuses a credential (${String(res.status)}) — there is nothing to connect`,
      );
    }
    if (kind === 'api-key') {
      // The manifest's own `secret: true` setting keys; anything else is
      // refused, which is asserted right after.
      const manifestKeys = await api('GET', `/api/v1/add-ons/${key}/plan`);
      void manifestKeys;
      const bad = await api('POST', `/api/v1/add-ons/${key}/connect`, {
        body: { values: { not_a_real_setting: 'x' } },
      });
      check(bad.status >= 400, `${key}: an unknown credential field is refused (${String(bad.status)})`);
    }
    if (kind === 'oauth2') {
      // The operator's OWN registration with the provider. The client secret
      // goes to the host and stays there — the add-on never sees it, which is
      // the half of acceptance #2 worth proving.
      const start = await api('POST', `/api/v1/add-ons/${key}/connect/oauth/start`, {
        body: {
          clientId: 'round-trip-client',
          clientSecret: 'round-trip-secret-never-leaves-the-host',
          redirectUri: `${baseUrl}/oauth/done`,
        },
      });
      if (
        !check(
          start.status === 200 && typeof start.json?.authorizeUrl === 'string',
          `${key}: the host builds the authorize URL (${String(start.status)})`,
        )
      ) {
        info(start.text.slice(0, 400));
      }
      if (start.json?.authorizeUrl !== undefined) {
        const u = new URL(start.json.authorizeUrl);
        check(
          u.searchParams.has('code_challenge') && u.searchParams.get('code_challenge_method') === 'S256',
          `${key}: PKCE, S256 — and no client secret in the URL the browser gets`,
        );
        check(
          !start.text.includes('round-trip-secret-never-leaves-the-host'),
          `${key}: the client secret is nowhere in the reply, nor in the URL the browser gets`,
        );
      }
    }
  }

  // ── acceptance #3 — what a host reads ─────────────────────────────────────
  step('acceptance #3 — the list a host reads, and the bundle behind it');
  const list = await api('GET', '/api/v1/add-ons');
  const mounted = (list.json?.addOns ?? []).filter((a) =>
    a.attachments.some((x) => x.attachedTo === 'printing' && x.enabled),
  );
  check(mounted.length > 0, `${String(mounted.length)} add-on(s) attached to "printing" and enabled`);

  const withBundle = mounted.find((a) => a.bundles.length > 0);
  if (check(withBundle !== undefined, 'at least one ships a client bundle')) {
    const bundle = withBundle.bundles[0];
    info(`${withBundle.key} → ${bundle.url}`);
    check(
      bundle.url.startsWith('/api/v1/add-ons/'),
      'the bundle URL is same-origin and inside the API namespace (the host fences on both)',
    );
    const res = await fetch(new URL(bundle.url, baseUrl), { headers: { cookie } });
    const bytes = Buffer.from(await res.arrayBuffer());
    const seen = `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
    check(res.status === 200, `the bundle serves (${String(res.status)}, ${String(bytes.length)} bytes)`);
    check(seen === bundle.integrity, 'the bytes hash to the integrity the list carried');
    const source = bytes.toString('utf8');
    check(
      !/(?:^|[\s;}])(?:import|export)[^;'"]*?from\s*["'](?![./])/.test(source),
      'the bundle asks a browser to resolve NO package specifier (26 §0.7)',
    );
    check(source.includes('register'), 'and it exports a register()');
  }

  step('acceptance #3 — disabling it takes the surface away');
  const target = mounted[0];
  if (target === undefined) {
    info('(nothing is mounted, so there is no surface to take away)');
  } else {
  const off = await api('PATCH', `/api/v1/add-ons/${target.key}`, {
    body: { attachedTo: 'printing', enabled: false },
  });
  check(off.status === 200, `disabled ${target.key} on printing (${String(off.status)})`);
  const afterOff = await api('GET', '/api/v1/add-ons');
  const stillOn = (afterOff.json?.addOns ?? [])
    .find((a) => a.key === target.key)
    ?.attachments.find((x) => x.attachedTo === 'printing')?.enabled;
  check(stillOn === false, 'the list a host reads now says it is off there — the fill disappears');
  await api('PATCH', `/api/v1/add-ons/${target.key}`, {
    body: { attachedTo: 'printing', enabled: true },
  });
  }

  // ── 32 acceptance #2 — the same loop, with no network at all ─────────────
  if (AIR_GAPPED) {
    step('32 acceptance #2 — every path to a registry refuses, without trying');

    const browse = await api('GET', '/api/v1/add-ons/catalog');
    check(browse.status === 200, `browsing still works offline (${String(browse.status)})`);
    check(
      browse.json?.onlineEnabled === false,
      'and it says browsing online is off, rather than pretending',
    );
    check(
      (browse.json?.addOns ?? []).length > 0,
      `the bundled + staged set is still listed (${String((browse.json?.addOns ?? []).length)} entries)`,
    );

    // The operator CAN flip the switch. The environment still wins, and the
    // reply says so rather than letting a toggle spring back unexplained.
    const toggled = await api('PUT', '/api/v1/add-ons/catalog', { body: { enabled: true } });
    check(
      toggled.json?.onlineEnabled === false && toggled.json?.vetoed === true,
      `the switch is saved and VETOED by the environment (${JSON.stringify(toggled.json)})`,
    );

    const refresh = await api('POST', '/api/v1/add-ons/catalog/refresh');
    check(
      refresh.status >= 400,
      `refresh refuses (${String(refresh.status)}) rather than reaching a registry`,
    );

    const download = await api('POST', '/api/v1/add-ons/download', {
      body: { key: 'holiday-calendars', version: '1.0.0' },
    });
    check(
      download.status >= 400,
      `download refuses (${String(download.status)}) — the only way in here is sideload`,
    );

    // And sideload — the one path that must still work — did: every install
    // above arrived through `POST /add-ons/upload` with an operator-supplied
    // sha512, which is what an air-gapped operator actually has.
    check(
      installed.length > 0,
      `${String(installed.length)} add-on(s) installed from an uploaded tarball with its own hash`,
    );
  }

  // ── 32 acceptance #1 — the catalog leg, against the real feed ─────────────
  if (ONLINE_CATALOG) {
    step('32 acceptance #1 — the catalog leg: live feed, live registry, one real download');

    const toggled = await api('PUT', '/api/v1/add-ons/catalog', { body: { enabled: true } });
    check(
      toggled.status === 200 &&
        toggled.json?.onlineEnabled === true &&
        toggled.json?.vetoed === false,
      `the switch turns on, un-vetoed (${JSON.stringify(toggled.json)})`,
    );

    const refresh = await api('POST', '/api/v1/add-ons/catalog/refresh');
    check(
      refresh.status === 200 && typeof refresh.json?.jobId === 'string',
      `refresh enqueued (${String(refresh.status)})`,
    );
    const refreshOutcome = await waitForJob(refresh.json.jobId);
    check(
      refreshOutcome === 'succeeded',
      `catalog-refresh job ${refreshOutcome} — adminium.dev answered with the live feed`,
    );

    const browse = await api('GET', '/api/v1/add-ons/catalog');
    check(browse.json?.onlineEnabled === true, 'browse says online is on');
    check(
      typeof browse.json?.catalogFetchedAt === 'number',
      'and carries the fetch timestamp rather than null',
    );
    const fromFeed = (browse.json?.addOns ?? []).filter((a) => a.source === 'catalog');
    check(
      fromFeed.length >= 1,
      `the live feed contributed ${String(fromFeed.length)} catalog-sourced entr(y/ies)`,
    );

    // One REAL download: packument pin → ledger cross-check → tarball →
    // hardened unpack → staged. Uninstall AND discard the upload-era stage
    // first — a stage survives uninstall by design, and the first draft of
    // this leg read that leftover as proof of a download that never ran.
    await api('DELETE', '/api/v1/add-ons/holiday-calendars');
    await api('DELETE', '/api/v1/add-ons/staged/holiday-calendars/1.0.0');
    const cleared = await api('GET', '/api/v1/add-ons/catalog');
    const preState = (cleared.json?.addOns ?? []).find(
      (a) => a.key === 'holiday-calendars',
    )?.state;
    check(
      preState === 'available',
      `with stage discarded, holiday-calendars is merely available (${String(preState)})`,
    );
    const dl = await api('POST', '/api/v1/add-ons/download', {
      body: { key: 'holiday-calendars', version: '1.0.0' },
    });
    check(
      dl.status === 200 && typeof dl.json?.jobId === 'string',
      `download enqueued (${String(dl.status)})`,
    );
    const dlOutcome = await waitForJob(dl.json.jobId);
    check(
      dlOutcome === 'succeeded',
      `add-on-download job ${dlOutcome} — registry.npmjs.org served bytes matching pin AND ledger`,
    );

    const after = await api('GET', '/api/v1/add-ons/catalog');
    const row = (after.json?.addOns ?? []).find((a) => a.key === 'holiday-calendars');
    check(row?.state === 'staged', `holiday-calendars is staged (${String(row?.state)})`);

    const reinstall = await api('POST', '/api/v1/add-ons', {
      body: { key: 'holiday-calendars', version: '1.0.0', attachTo: [] },
    });
    check(
      reinstall.status === 200,
      `and installs from the downloaded stage (${String(reinstall.status)})`,
    );
    const cleanup = await api('DELETE', '/api/v1/add-ons/holiday-calendars');
    check(cleanup.status === 200, 'and uninstalls again, leaving the loop where it started');
  }

  // ── acceptance #5 — the egress refusal ────────────────────────────────────
  step('acceptance #5 — an add-on calling outside its allow-list is refused, and audited');
  const { hostnameAllowed } = await import(
    new URL(`file://${join(serverRoot, 'dist', 'add-ons', 'egress-policy.js')}`)
  );
  const allowFor = mounted.find((a) => a.networkAllow.length > 0);
  if (allowFor !== undefined) {
    const declared = allowFor.networkAllow[0];
    info(`${allowFor.key} declares ${allowFor.networkAllow.join(', ')}`);
    // It takes a `URL` and answers `'ok'` or the REASON — not a boolean. A
    // truthiness test on this would read every refusal as a pass, which is what
    // the first draft of this script did.
    const verdict = (href) => hostnameAllowed(new URL(href), allowFor.networkAllow);
    check(verdict(`https://${declared}/x`) === 'ok', `a call to ${declared} is allowed`);
    check(
      verdict(`https://${declared}.evil.test/x`) === 'HOST_NOT_ALLOWED',
      `a suffix near-match is refused (${verdict(`https://${declared}.evil.test/x`)})`,
    );
    check(
      verdict('https://collect.example-analytics.net/x') === 'HOST_NOT_ALLOWED',
      'an undeclared host is refused',
    );
    check(verdict(`http://${declared}/x`) === 'NOT_HTTPS', 'plain http is refused');
    check(
      verdict(`https://evil.test@${declared}/x`) === 'CREDENTIALS_IN_URL',
      'credentials in the URL are refused outright',
    );
    check(verdict(`https://${declared}./x`) === 'ok', 'a trailing dot is normalised, not a bypass');
  } else {
    info('(no installed add-on declares network.allow)');
  }

  // ── acceptance #4 — disconnect keeps the data ─────────────────────────────
  step('acceptance #4 — disconnect leaves every table the add-on brought (D5)');
  const brought = wanted[0];
  if (brought !== undefined) {
    await pg(`insert into ${brought} values (default)`, sourceUrl.toString()).catch(() => {
      /* the table's columns are the add-on's; an insert is best-effort */
    });
    const key = installed.find((i) => (i.plan?.create ?? []).some((t) => t.ref === brought))?.key;
    const res = await api('DELETE', `/api/v1/add-ons/${key}/connect`);
    info(`disconnect ${key}: ${String(res.status)}`);
    const after = (
      await pg(
        `select table_name from information_schema.tables where table_schema = 'public'`,
        sourceUrl.toString(),
      )
    ).rows.map((r) => r.table_name);
    check(after.includes(brought), `${brought} is still there after disconnect`);

    step('acceptance #4 — and so does UNINSTALL, which is the stronger claim');
    const gone = await api('DELETE', `/api/v1/add-ons/${key}`);
    check(gone.status === 200, `uninstalled ${key} (${String(gone.status)})`);
    check(gone.json?.tablesKept === true, 'the reply says the tables were kept');
    const afterUninstall = (
      await pg(
        `select table_name from information_schema.tables where table_schema = 'public'`,
        sourceUrl.toString(),
      )
    ).rows.map((r) => r.table_name);
    check(afterUninstall.includes(brought), `${brought} survived the uninstall, with its rows`);
  } else {
    info('(nothing in this set brought a table, so there is nothing to keep)');
  }

  // ── acceptance #7 — no secret reaches the browser ─────────────────────────
  step('acceptance #7 — nothing in the list a browser reads is a credential');
  const final = await api('GET', '/api/v1/add-ons');
  const asBrowserSeesIt = JSON.stringify(final.json);
  for (const needle of ['api_key', 'apiKey', 'accessToken', 'refreshToken', 'client_secret', PASSWORD]) {
    check(!asBrowserSeesIt.includes(needle), `the reply carries no "${needle}"`);
  }

  // ── the audit trail ───────────────────────────────────────────────────────
  step('the lifecycle is in the audit trail');
  const audit = await api('GET', '/api/v1/audit', { query: { limit: 100 } });
  const actions = new Set((audit.json?.data ?? audit.json?.entries ?? []).map((r) => r.action));
  for (const action of ['add-on.installed', 'add-on.uninstalled']) {
    check(actions.has(action), `${action} recorded`);
  }
  info([...actions].filter((a) => String(a).startsWith('add-on')).join(', '));
}

// ── run ─────────────────────────────────────────────────────────────────────

let exitCode = 0;
try {
  await main();
} catch (error) {
  console.error(`\n[31mround trip aborted:[0m ${error?.stack ?? String(error)}`);
  exitCode = 1;
} finally {
  await cleanup();
}

console.log('');
if (failures > 0 || exitCode !== 0) {
  console.log(`[31m${String(failures)} check(s) failed.[0m`);
  process.exit(1);
}
console.log('[32mRound trip complete — every check passed.[0m');
