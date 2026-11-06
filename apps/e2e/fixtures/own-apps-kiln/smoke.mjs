#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Smoke for the Kiln Street fixture: boots the BUILT server on a fresh data
 * directory (the same composition root `adminium start` and the e2e harness
 * use), runs `buildKiln` against it through `/setup` — the first super admin,
 * no sign-in spent — and reads back each of the seven pieces with a GET.
 *
 *   E2E_PORT=4790 KILN_ADD_ONS_BUNDLE=<dir with invoices-<v>.tgz(.integrity)> \
 *     node apps/e2e/fixtures/own-apps-kiln/smoke.mjs
 *
 * Never on 4610: that port is a live server on the owner's machine. Exits 0
 * when every check holds, 1 with the failing one otherwise.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const serverRoot = join(repoRoot, 'apps', 'server');
const dashboardDist = join(repoRoot, 'apps', 'dashboard', 'dist');

const PORT = Number(process.env.E2E_PORT ?? 4790);
if (PORT === 4610 || PORT === 4611 || PORT === 4612) throw new Error(`E2E_PORT ${String(PORT)} is an e2e default port; pick a free one (4790)`);
const HOST = '127.0.0.1';
const URL_ = `http://${HOST}:${String(PORT)}`;

const bundle = resolve(process.env.KILN_ADD_ONS_BUNDLE ?? join(repoRoot, 'add-ons-bundle'));
if (!existsSync(bundle)) {
  throw new Error(`no add-on bundle at ${bundle}: set KILN_ADD_ONS_BUNDLE (README.md, "The add-on")`);
}
if (!existsSync(join(serverRoot, 'dist', 'app.js'))) throw new Error('apps/server/dist is missing: run `pnpm build` first');
// Read by the composition root as it loads, so it is set before the import.
process.env.ADMINIUM_BUNDLED_ADD_ONS = bundle;

const tempDir = mkdtempSync(join(tmpdir(), 'adminium-kiln-'));
const [{ loadCliEnv, openRuntime, composeServer }, { firstRun, settingsRepo }] = await Promise.all([
  import('@adminium/server'),
  import('@adminium/meta'),
]);
const { buildKiln } = await import(pathToFileURL(join(here, 'build.mjs')).href);
const K = await import(pathToFileURL(join(here, 'kiln.mjs')).href);

const checks = [];
const check = (label, ok, detail = '') => {
  checks.push({ label, ok });
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}\n`);
};

let app = null;
let failed = false;
try {
  const env = loadCliEnv(
    { ADMINIUM_SECRET: randomBytes(32).toString('hex'), ADMINIUM_PUBLIC_API_ORIGINS: 'self' },
    { port: PORT, host: HOST, dataDir: tempDir },
  );
  const runtime = await openRuntime(env, { blockLoopback: false });
  await firstRun(runtime.metaStore.meta);
  // Nothing here asks adminium.dev for anything.
  for (const key of ['addOns.catalogEnabled', 'apps.catalogEnabled']) {
    await settingsRepo(runtime.metaStore.meta).set(key, false, { updatedBy: null, at: Date.now() });
  }
  const composed = await composeServer({
    env,
    metaStore: runtime.metaStore,
    manager: runtime.manager,
    runService: runtime.runService,
    applyService: runtime.applyService,
    allowed: runtime.allowed,
    collectStats: runtime.collectStats,
    staticRoot: existsSync(join(dashboardDist, 'index.html')) ? dashboardDist : null,
    logger: false,
    telemetry: false,
  });
  app = composed.app;
  await app.listen({ port: PORT, host: HOST });
  process.stdout.write(`[smoke] server on ${URL_} (data ${tempDir})\n`);

  const started = Date.now();
  const made = await buildKiln({
    url: URL_,
    email: 'owner@kilnstreet.test',
    password: `kiln-${randomBytes(9).toString('hex')}`,
    setup: true,
    db: join(tempDir, 'kiln-street.db'),
  });
  process.stdout.write(`[smoke] built in ${String(Date.now() - started)} ms\n`);
  const c = made.client;
  const conn = made.connectionId;
  const T = made.tables;

  // 1. tables made in Studio, with their rows and pages
  const schema = await c.get(`/connections/${conn}/schema`);
  const names = (schema.model.tables ?? []).map((t) => t.name).sort();
  check('tables made in Studio', K.TABLES.every((t) => names.includes(t)), names.join(', '));
  const changes = await c.get(`/connections/${conn}/schema/changes`, { allow: [404] });
  check('…through two schema changes', Array.isArray(changes?.changes) ? changes.changes.length >= 2 : changes !== null, Array.isArray(changes?.changes) ? `${String(changes.changes.length)} changes` : 'listed');
  const counts = {};
  for (const t of K.TABLES) {
    const page = await c.get(`/data/${conn}/${T[t]}?limit=100`);
    counts[t] = (page.data ?? page.rows ?? []).length;
  }
  const want = { members: K.MEMBERS.length, classes: K.CLASSES.length, firings: K.FIRINGS.length, pieces: K.PIECES.length, shop_orders: K.SHOP_ORDERS.length };
  check('rows', K.TABLES.every((t) => counts[t] === want[t]), JSON.stringify(counts));
  const pages = (await c.get('/pages')).data.filter((p) => p.connectionId === conn || p.config?.connectionId === conn);
  check('pages for the new tables', pages.length >= K.TABLES.length, `${String(pages.length)} pages`);

  // 2. the option list, bound to a column
  const list = await c.get(`/option-lists/${K.OPTION_LIST.key}`);
  const overrides = (await c.get(`/connections/${conn}/overrides`)).overrides;
  const bound = overrides.find((o) => o.op === 'column.options' && o.tableName === T.pieces && o.columnName === 'glaze');
  check('option list', list.items.length === K.OPTION_LIST.items.length && bound !== undefined, `${String(list.items.length)} items, bound: ${String(bound !== undefined)}`);

  // 3. the public endpoint, saved and answering a key minted here (the fixture itself keeps no key)
  const endpoints = await c.get(`/public-endpoints?connectionId=${encodeURIComponent(conn)}`);
  const ep = endpoints.endpoints.find((e) => e.ref === K.ENDPOINT.ref);
  check('public endpoint saved', ep?.stored === true, ep === undefined ? 'missing' : `origin ${String(ep.origin)}`);
  const minted = await c.post('/public-keys', { name: 'Smoke', kind: 'server', connectionId: conn, access: [{ ref: K.ENDPOINT.ref, methods: ['GET'] }] });
  // Plain http, not fetch: fetch sends `Sec-Fetch-Mode`, and a server key is refused from anything browser-like.
  const served = await new Promise((done, fail) => {
    const req = httpGet(`${URL_}/api/v1/public/records/${K.ENDPOINT.ref}?limit=10`, { headers: { authorization: `Bearer ${minted.token}`, accept: 'application/json' } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => done({ ok: res.statusCode === 200, status: res.statusCode, text }));
    });
    req.on('error', fail);
  });
  const servedBody = JSON.parse(served.text);
  check('public endpoint answers', served.ok && servedBody.data?.length === K.CLASSES.length, `${String(served.status)}, ${String(servedBody.data?.length)} rows, first ${JSON.stringify(servedBody.data?.[0] ?? servedBody).slice(0, 160)}`);

  // 4. the add-on
  const addOns = (await c.get('/add-ons')).addOns;
  const inv = addOns.find((a) => a.key === 'invoices');
  check('add-on installed', inv !== undefined && inv.missing === false, inv === undefined ? 'missing' : `invoices ${String(inv.version)}`);

  // 5. the document profile
  const profiles = (await c.get(`/documents/profiles?connectionId=${encodeURIComponent(conn)}`)).profiles;
  const prof = profiles.find((p) => p.id === made.documentProfileId);
  check('document profile', prof !== undefined && prof.table === T.shop_orders, prof === undefined ? 'missing' : `${String(prof.kind)} on ${String(prof.table)}`);

  // 6. the payment profile
  const payables = (await c.get('/payments/payables')).data.profiles;
  const pay = payables.find((p) => p.id === made.payableProfileId);
  const ways = (await c.get('/payments/ways')).data.ways;
  const counter = ways.find((w) => w.method === 'cash-on-delivery');
  check('payment profile', pay !== undefined && pay.valid === true && pay.enabled === true && counter?.enabled === true, pay === undefined ? 'missing' : `${String(pay.tableName)} valid ${String(pay.valid)}, counter ${String(counter?.enabled)}`);

  // 7. the second language
  const locales = (await c.get('/i18n/manifest')).locales;
  const on = locales.filter((l) => l.enabled).map((l) => l.locale).sort();
  const words = await c.get(`/i18n/bundle/${K.LOCALE}/common`);
  const fr = await c.get(`/connections/${conn}/schema?locale=${K.LOCALE}`);
  const frTable = (fr.model.tables ?? []).find((t) => t.name === 'members');
  const frLabel = frTable?.label ?? frTable?.displayName ?? JSON.stringify(frTable?.labels ?? frTable?.overrides ?? '').slice(0, 80);
  check('second language', on.join(',') === ['en_US', K.LOCALE].sort().join(',') && words.overrides['account.title'] === 'Mon compte', `on: ${on.join(', ')}; members in ${K.LOCALE}: ${String(frLabel)}`);
} catch (error) {
  failed = true;
  process.stdout.write(`FAIL ${error instanceof Error ? error.message : String(error)}\n`);
} finally {
  if (app !== null) await app.close().catch(() => undefined);
  rmSync(tempDir, { recursive: true, force: true });
}

const bad = checks.filter((x) => !x.ok).length;
process.stdout.write(`[smoke] ${String(checks.length - bad)}/${String(checks.length)} checks passed${failed ? ', build failed' : ''}\n`);
process.exit(failed || bad > 0 ? 1 : 0);
