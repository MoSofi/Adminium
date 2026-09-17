#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rehearse the project workflow against LOCAL code: `adminium new`, then the
 * project's own `build`, `check`, `dev` and `start`, the way a developer runs
 * them after `npx @adminiumjs/adminium new`.
 *
 * It packs the release tarballs (publish-npm.mjs --dry-run), installs the CLI
 * from its tarball into a prefix, and creates the project with
 * `--adminium <tarball>`, so the project installs the same local build. Other
 * dependencies (esbuild, fastify, …) come from the registry, as they would for
 * anyone.
 *
 *   node scripts/release/rehearse-project.mjs               pack, then rehearse
 *   node scripts/release/rehearse-project.mjs --skip-pack   reuse the tarballs
 *
 * Checks, in order:
 *   1. `adminium new demo --sample` creates the files, the sample database and
 *      a .env with a secret, and installs;
 *   2. `npm run build` writes .adminium/build with a hook, an action, a React
 *      page and two widgets the rehearsal adds, and `npm run check` passes,
 *      loads the hook and the action, and builds the page and the widgets;
 *   3. `npm run dev` serves the admin, connects the sample database and
 *      generates its pages; an edit to adminium.config.ts restarts it; Ctrl-C
 *      stops everything and frees the port; dev writes the page and schema
 *      files, and a saved page file is applied at once, without a restart;
 *      the hook refuses an edit with its message, an edit to the hook is live
 *      without a restart, and the action runs; the React page has a page row
 *      Studio will not edit, the bootstrap lists it and the widgets, its file
 *      is served to a signed-in person only and matches its integrity, and a
 *      saved page is rebuilt and listed under a new URL without a restart;
 *      `adminium eject` turns a generated page file into a page of code that
 *      keeps its row, its table and its address, through a regeneration;
 *   4. `npm start` serves the same project from its build, as a server: the
 *      edited hook is in force, the React page and widgets are listed and
 *      served, the ejected page is still code, a page
 *      edited through the API is flagged, `npm run pull -- --from` writes it into
 *      the folder with an API key, a redeploy of the pulled file clears the
 *      flag, and a page changed on both sides is a conflict the API settles;
 *   5. `adminium new` in an existing app adds to it without changing its files.
 *
 * Everything lives under scripts/release/out/project-rehearsal/ (gitignored)
 * and is rebuilt on each run. Ports 4697 and 4698 must be free.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = join(ROOT, 'scripts/release/out');
const WORK = join(OUT_DIR, 'project-rehearsal');
const CLI_PREFIX = join(WORK, 'cli');
const DEV_PORT = 4697;
const START_PORT = 4698;

const argv = process.argv.slice(2);
const log = (message) => void console.log(message);
/** Background process groups still running, stopped if the rehearsal fails. */
const running = new Set();
const die = (message) => {
  console.error(`\nrehearse-project: ${message}\n`);
  for (const pid of running) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  process.exit(1);
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...opts });
  if (result.status !== 0) die(`\`${command} ${args.join(' ')}\` exited ${String(result.status ?? 'by signal')}`);
  return result;
}

function portIsFree(port) {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      done(false);
    });
    socket.once('error', () => done(true));
  });
}

async function waitForHealth(port, output, seconds = 90) {
  for (const deadline = Date.now() + seconds * 1000; Date.now() < deadline; ) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/healthz`);
      if (response.ok && (await response.json())?.ok === true) return;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  console.error(output());
  die(`nothing healthy on port ${port} within ${seconds} s`);
}

async function waitFor(predicate, what, output, seconds = 60) {
  for (const deadline = Date.now() + seconds * 1000; Date.now() < deadline; ) {
    if (predicate()) return;
    await sleep(250);
  }
  console.error(output());
  die(`timed out waiting for ${what}`);
}

/** Start a command in its own process group, capturing its output. */
function background(command, args, cwd) {
  const child = spawn(command, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  running.add(child.pid);
  const exited = new Promise((done) =>
    child.once('exit', (code, signal) => {
      running.delete(child.pid);
      done({ code, signal });
    }),
  );
  return { child, exited, output: () => output };
}

async function stopGroup(proc, signal = 'SIGINT') {
  try {
    process.kill(-proc.child.pid, signal);
  } catch {
    return;
  }
  const result = await Promise.race([proc.exited, sleep(20_000).then(() => null)]);
  if (result === null) {
    process.kill(-proc.child.pid, 'SIGKILL');
    await proc.exited;
    die('the process group ignored the stop signal for 20 s');
  }
}

// ── 1. The tarball and the CLI ───────────────────────────────────────────────

if (!argv.includes('--skip-pack')) {
  for (const file of existsSync(OUT_DIR) ? readdirSync(OUT_DIR) : []) {
    if (file.endsWith('.tgz')) rmSync(join(OUT_DIR, file), { force: true });
  }
  log('▸ packing the release tarballs');
  run('node', [join(ROOT, 'scripts/release/publish-npm.mjs'), '--dry-run'], { cwd: ROOT });
}
const flagship = readdirSync(OUT_DIR).filter((file) => /^adminiumjs-adminium-.*\.tgz$/.test(file));
if (flagship.length !== 1) die(`expected one flagship tarball in ${OUT_DIR}, found ${flagship.length}`);
const tarball = join(OUT_DIR, flagship[0]);

if (!(await portIsFree(DEV_PORT)) || !(await portIsFree(START_PORT))) {
  die(`ports ${DEV_PORT} and ${START_PORT} must be free`);
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(CLI_PREFIX, { recursive: true });
writeFileSync(join(CLI_PREFIX, 'package.json'), '{ "name": "cli", "private": true }\n');
log(`▸ installing the CLI from ${flagship[0]}`);
run('npm', ['install', tarball, '--no-audit', '--no-fund'], { cwd: CLI_PREFIX });
const cli = join(CLI_PREFIX, 'node_modules/.bin/adminium');

// ── 2. adminium new ──────────────────────────────────────────────────────────

const demo = join(WORK, 'demo');
log('▸ adminium new demo --sample --yes');
run(cli, ['new', 'demo', '--sample', '--yes', '--no-git', '--package-manager', 'npm', '--adminium', tarball], {
  cwd: WORK,
});
for (const file of ['package.json', 'adminium.config.ts', '.env', '.gitignore', 'Dockerfile', 'data/sample.sqlite']) {
  if (!existsSync(join(demo, file))) die(`new did not create ${file}`);
}
const dotenv = readFileSync(join(demo, '.env'), 'utf8');
if (!/^ADMINIUM_SECRET=[0-9a-f]{64}$/m.test(dotenv)) die('.env has no generated secret');
if (!/^DATABASE_URL=sqlite:\.\/data\/sample\.sqlite$/m.test(dotenv)) die('.env does not point at the sample');
if (!existsSync(join(demo, 'node_modules/@adminiumjs/adminium/package.json'))) die('the project did not install Adminium');
if (!existsSync(join(demo, 'node_modules/esbuild/package.json'))) die('the project did not install esbuild');
log('✓ new created the project, the sample database and the secret, and installed');

// ── 3. build and check ───────────────────────────────────────────────────────

/** The project's own code: a hook with a message the rehearsal changes, and an action. */
const hookSource = (version) =>
  [
    "import { defineHook } from '@adminiumjs/adminium';",
    '',
    'export default defineHook({',
    "  table: 'contacts',",
    '  beforeUpdate({ values, reject }) {',
    `    if (values.company === 'Blocked Inc') reject('Version ${version} blocks this company.');`,
    '  },',
    '});',
    '',
  ].join('\n');
writeFileSync(join(demo, 'hooks/contacts.ts'), hookSource('one'));
writeFileSync(
  join(demo, 'actions/top-score.ts'),
  [
    "import { defineAction } from '@adminiumjs/adminium';",
    '',
    'export default defineAction({',
    "  table: 'contacts',",
    "  label: 'Top score',",
    "  icon: 'star',",
    '  async run({ record, db }) {',
    '    await db.table(\'contacts\').update(record.id, { health_score: 100 });',
    '    return { message: `Scored ${String(record.full_name)}` };',
    '  },',
    '});',
    '',
  ].join('\n'),
);

/** The project's browser code: a page on the kit, whose heading the rehearsal changes, a cell and a card. */
const pageSource = (heading) =>
  [
    "import { Card, DataTable, Page, definePage, useRecords } from '@adminiumjs/adminium/ui';",
    '',
    'export default definePage({',
    "  title: 'Revenue',",
    "  icon: 'chart-line',",
    "  nav: { group: 'library' },",
    '  component: function Revenue() {',
    "    const contacts = useRecords('main', 'contacts', { limit: 5 });",
    '    return (',
    `      <Page description="${heading}">`,
    '        <Card title="Contacts" padded={false}>',
    "          <DataTable loading={contacts.isLoading} rows={contacts.data} columns={[{ key: 'full_name', label: 'Name' }]} />",
    '        </Card>',
    '      </Page>',
    '    );',
    '  },',
    '});',
    '',
  ].join('\n');
// `new` makes no pages/ folder: dev writes the page files into it.
mkdirSync(join(demo, 'pages'), { recursive: true });
writeFileSync(join(demo, 'pages/revenue.tsx'), pageSource('Version one'));
writeFileSync(
  join(demo, 'widgets/flag-cell.tsx'),
  [
    "import { defineWidget } from '@adminiumjs/adminium/ui';",
    '',
    'export default defineWidget({',
    "  kind: 'cell',",
    "  component: ({ value }) => <strong data-project-flag=\"\">{value ? String(value) : '—'}</strong>,",
    '});',
    '',
  ].join('\n'),
);
writeFileSync(
  join(demo, 'widgets/sales.tsx'),
  [
    "import { Stat, defineWidget } from '@adminiumjs/adminium/ui';",
    '',
    'export default defineWidget({',
    "  kind: 'card',",
    "  title: 'Sales',",
    "  component: ({ config }) => <Stat label={String(config.label ?? 'Orders')} value=\"12\" />,",
    '});',
    '',
  ].join('\n'),
);

run('npm', ['run', 'build'], { cwd: demo });
if (!existsSync(join(demo, '.adminium/build/config.mjs'))) die('build wrote no config.mjs');
for (const bundle of ['server/hooks/contacts.mjs', 'server/actions/top-score.mjs']) {
  if (!existsSync(join(demo, '.adminium/build', bundle))) die(`build wrote no ${bundle}`);
}
for (const folder of ['client/pages', 'client/widgets']) {
  const built = existsSync(join(demo, '.adminium/build', folder)) ? readdirSync(join(demo, '.adminium/build', folder)) : [];
  if (!built.some((file) => file.endsWith('.js'))) die(`build wrote nothing into ${folder}`);
}
const checked = spawnSync('npm', ['run', 'check'], { cwd: demo, encoding: 'utf8' });
if (checked.status !== 0) die(`npm run check exited ${String(checked.status)}:\n${checked.stdout}${checked.stderr}`);
if (!checked.stdout.includes('1 hook(s) and 1 action(s) load')) die(`check did not load the hook and the action:\n${checked.stdout}`);
if (!checked.stdout.includes('1 page(s) and 2 widget(s) build')) die(`check did not build the page and the widgets:\n${checked.stdout}`);
log('✓ build bundles the hook, the action, the page and the widgets, and check passes');

// ── 4. dev ───────────────────────────────────────────────────────────────────

log(`▸ npm run dev (port ${DEV_PORT})`);
const dev = background('npm', ['run', 'dev', '--', '--port', String(DEV_PORT), '--host', '127.0.0.1'], demo);
await waitForHealth(DEV_PORT, dev.output);
await waitFor(() => /Database "main": generated \d+ page/.test(dev.output()), 'the sample pages', dev.output);
const page = await fetch(`http://127.0.0.1:${DEV_PORT}/`);
if (!(await page.text()).includes('<div id="root">')) die('dev did not serve the dashboard');
log('✓ dev serves the dashboard and generated the sample pages');

const pagesDir = join(demo, 'pages');
await waitFor(() => existsSync(join(demo, 'schema/main.json')), 'schema/main.json', dev.output);
const pageFiles = () => readdirSync(pagesDir).filter((file) => file.endsWith('.json')).sort();
const readPage = (file) => JSON.parse(readFileSync(join(pagesDir, file), 'utf8'));
const writePage = (file, doc) => writeFileSync(join(pagesDir, file), `${JSON.stringify(doc, null, 2)}\n`);
const crudFiles = pageFiles().filter((file) => readPage(file).template === 'page-crud');
if (crudFiles.length < 4) die(`dev wrote ${crudFiles.length} CRUD page files; the rehearsal needs 4`);
log(`✓ dev wrote ${pageFiles().length} page files and schema/main.json`);

const boots = () => (dev.output().match(/^Project: /gm) ?? []).length;
/** The page `eject` turns into code in dev, checked again in start. */
let ejected = null;

/** Sign in: the first time by creating the owner, after that with a password. */
const OWNER = { email: 'owner@example.com', password: 'rehearsal-password-1', name: 'Owner' };
async function signIn(api, first) {
  const response = first
    ? await fetch(`${api}/setup/super-admin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(OWNER),
      })
    : await fetch(`${api}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: OWNER.email, password: OWNER.password }),
      });
  if (!response.ok) die(`signing in answered ${response.status}: ${await response.text()}`);
  const cookie = response.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .find((pair) => pair.startsWith('adminium_session='));
  if (cookie === undefined) die('signing in set no session cookie');
  // Node's fetch sends Sec-Fetch headers, so the server asks for the session's CSRF token too.
  const csrfToken = first
    ? (await response.json()).data.csrfToken
    : (await (await fetch(`${api}/bootstrap`, { headers: { cookie } })).json()).data.csrfToken;
  /** One API call; `expect` is the status wanted, 2xx by default. */
  const call = async (method, path, body, expect) => {
    const answer = await fetch(`${api}${path}`, {
      method,
      headers: {
        cookie,
        'x-adminium-csrf': csrfToken,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await answer.text();
    if (expect === undefined ? !answer.ok : answer.status !== expect) {
      die(`${method} ${path} answered ${answer.status}: ${text}`);
    }
    return JSON.parse(text);
  };
  /** A GET of any path on the server, such as a built file, with the session. */
  call.raw = (path) => fetch(new URL(path, api), { headers: { cookie } });
  return call;
}

/** The React page and widgets, as the bootstrap lists them and the server serves them. */
async function checkClientCode(call, origin) {
  const client = (await call('GET', '/bootstrap')).data.project?.client;
  const revenue = client?.pages.find((entry) => entry.slug === 'revenue');
  if (revenue === undefined) die(`the bootstrap does not list pages/revenue.tsx: ${JSON.stringify(client)}`);
  const widgets = client.widgets.map((widget) => `${widget.id}:${widget.kind}`).sort();
  if (widgets.join(' ') !== 'project.flag-cell:cell project.sales:card') {
    die(`the bootstrap lists the widgets as ${widgets.join(', ')}`);
  }
  const served = await call.raw(revenue.module.url);
  if (!served.ok || !/javascript/.test(served.headers.get('content-type') ?? '')) {
    die(`${revenue.module.url} answered ${served.status} ${served.headers.get('content-type')}`);
  }
  const bytes = Buffer.from(await served.arrayBuffer());
  const integrity = `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
  if (integrity !== revenue.module.integrity) die(`${revenue.module.url} does not match its integrity`);
  const anonymous = await fetch(`${origin}${revenue.module.url}`);
  if (anonymous.status !== 401) die(`${revenue.module.url} answered ${anonymous.status} without a session`);
  return revenue;
}

{
  const [file] = crudFiles;
  const doc = readPage(file);
  doc.title.fallback = 'Edited in the folder';
  const before = boots();
  const savedAt = Date.now();
  writePage(file, doc);
  await waitFor(() => dev.output().includes(`Applied pages/${file}.`), `pages/${file} to be applied`, dev.output, 10);
  if (boots() !== before) die('saving a page file restarted the server');
  log(`✓ a saved page file was applied in ${Date.now() - savedAt} ms, without a restart`);
}

{
  const devCall = await signIn(`http://127.0.0.1:${DEV_PORT}/api/v1`, true);
  const [connection] = (await devCall('GET', '/connections')).connections;
  const contact = `/data/${connection.id}/main.contacts/1`;
  const blocked = async () =>
    (await devCall('PATCH', contact, { values: { company: 'Blocked Inc' } }, 422)).error.message;
  if ((await blocked()) !== 'Version one blocks this company.') die('the hook did not refuse the edit with its message');
  log('✓ the hook refused an edit, with its own message');

  const before = boots();
  const savedAt = Date.now();
  writeFileSync(join(demo, 'hooks/contacts.ts'), hookSource('two'));
  await waitFor(() => dev.output().includes('Rebuilt 2 hook and action file(s).'), 'the hooks to be rebuilt', dev.output, 20);
  let message = '';
  for (const deadline = Date.now() + 10_000; Date.now() < deadline && message !== 'Version two blocks this company.'; ) {
    message = await blocked();
    if (message !== 'Version two blocks this company.') await sleep(250);
  }
  if (message !== 'Version two blocks this company.') die(`the edited hook is not in force; the server said "${message}"`);
  if (boots() !== before) die('editing a hook restarted the server');
  log(`✓ an edited hook was in force ${Date.now() - savedAt} ms later, without a restart`);

  const [action] = (await devCall('GET', '/project/actions')).data;
  if (action?.id !== 'top-score' || action.table !== 'main.contacts') die(`the action was not listed: ${JSON.stringify(action)}`);
  const ran = await devCall('POST', '/project/actions/top-score', { database: 'main', table: 'main.contacts', ids: ['1'] });
  if (!ran.data.message.startsWith('Scored ')) die(`the action answered ${JSON.stringify(ran.data)}`);
  if ((await devCall('GET', contact)).data.health_score !== 100) die('the action did not change the record');
  log('✓ the action ran on a record, through the API');

  const devOrigin = `http://127.0.0.1:${DEV_PORT}`;
  const row = (await devCall('GET', '/pages')).data.find((entry) => entry.slug === 'revenue');
  if (row?.origin !== 'project') die(`pages/revenue.tsx has no project page row: ${JSON.stringify(row)}`);
  await devCall('PATCH', `/pages/${row.id}`, { title: 'Renamed in Studio' }, 409);
  const first = await checkClientCode(devCall, devOrigin);
  log('✓ the React page has a page row Studio will not edit, and its file is served with its integrity');

  const beforeEdit = boots();
  const editedAt = Date.now();
  writeFileSync(join(demo, 'pages/revenue.tsx'), pageSource('Version two'));
  await waitFor(() => dev.output().includes('Rebuilt 1 page(s) and 2 widget(s)'), 'the page to be rebuilt', dev.output, 30);
  let url = first.module.url;
  for (const deadline = Date.now() + 10_000; Date.now() < deadline && url === first.module.url; ) {
    url = (await devCall('GET', '/bootstrap')).data.project.client.pages.find((entry) => entry.slug === 'revenue').module.url;
    if (url === first.module.url) await sleep(250);
  }
  if (url === first.module.url) die('the rebuilt page is not listed under a new URL');
  if (!(await (await devCall.raw(url)).text()).includes('Version two')) die('the new URL does not serve the edited page');
  if (boots() !== beforeEdit) die('editing a page restarted the server');
  log(`✓ an edited React page was listed under a new URL ${Date.now() - editedAt} ms later, without a restart`);

  const ejectFile = crudFiles[3];
  const slug = ejectFile.replace(/\.json$/, '');
  const original = (await devCall('GET', '/pages')).data.find((entry) => entry.slug === slug);
  const bootsBeforeEject = boots();
  run(join(demo, 'node_modules/.bin/adminium'), ['eject', slug], { cwd: demo });
  if (existsSync(join(pagesDir, ejectFile)) || !existsSync(join(pagesDir, `${slug}.tsx`))) {
    die(`eject did not replace pages/${ejectFile} with pages/${slug}.tsx`);
  }
  let adopted;
  for (const deadline = Date.now() + 30_000; Date.now() < deadline; ) {
    adopted = (await devCall('GET', '/pages')).data.find((entry) => entry.slug === slug);
    const built = (await devCall('GET', '/bootstrap')).data.project.client.pages.some((entry) => entry.slug === slug);
    if (adopted?.origin === 'project' && built) break;
    await sleep(250);
  }
  if (adopted?.origin !== 'project' || adopted.id !== original.id) {
    die(`the ejected page did not keep its row: ${JSON.stringify(adopted)}`);
  }
  if ((await devCall('GET', `/pages/${adopted.id}`)).canCreate !== true) die('the ejected page lost its table');
  await devCall('POST', `/connections/${connection.id}/generate`, {});
  const rows = (await devCall('GET', '/pages')).data.filter((entry) => entry.slug === slug);
  if (rows.length !== 1 || rows[0].id !== original.id || rows[0].origin !== 'project') {
    die(`regeneration changed the ejected page: ${JSON.stringify(rows)}`);
  }
  if (existsSync(join(pagesDir, ejectFile))) die('regeneration wrote the ejected page file back');
  if (boots() !== bootsBeforeEject) die('eject restarted the server');
  ejected = { slug, id: original.id };
  log(`✓ eject turned pages/${ejectFile} into code that kept its row and table, through a regeneration`);
}

const bootsBefore = boots();
const config = join(demo, 'adminium.config.ts');
writeFileSync(config, `${readFileSync(config, 'utf8')}// edited by the rehearsal\n`);
await waitFor(() => dev.output().includes('adminium.config.ts changed, restarting Adminium'), 'a restart', dev.output);
await waitFor(() => boots() > bootsBefore, 'the second boot', dev.output);
await waitForHealth(DEV_PORT, dev.output);
log('✓ an edit to adminium.config.ts restarted the server');

await stopGroup(dev);
if (!(await portIsFree(DEV_PORT))) die(`port ${DEV_PORT} is still taken after stopping dev`);
log('✓ Ctrl-C stopped dev and freed the port');

// ── 5. start ─────────────────────────────────────────────────────────────────

log(`▸ npm start (port ${START_PORT})`);
const start = background('npm', ['start', '--', '--port', String(START_PORT), '--host', '127.0.0.1'], demo);
await waitForHealth(START_PORT, start.output);
if (!start.output().includes(`Project: ${demo}`)) die('start did not run as the project');
if (start.output().includes('built it first')) die('start rebuilt although the build was current');
log('✓ start serves the project from its build');

// A server: the owner dev created, an API key, and Studio edits made through the API.
const call = await signIn(`http://127.0.0.1:${START_PORT}/api/v1`, false);
{
  const [connection] = (await call('GET', '/connections')).connections;
  const refused = await call('PATCH', `/data/${connection.id}/main.contacts/1`, { values: { company: 'Blocked Inc' } }, 422);
  if (refused.error.message !== 'Version two blocks this company.') die('start did not load the edited hook');
  const overview = (await call('GET', '/project/overview')).data;
  if (overview.hooks[0]?.source !== 'hooks/contacts.ts' || overview.actions[0]?.id !== 'top-score') {
    die(`Studio's project overview is wrong: ${JSON.stringify(overview)}`);
  }
  const codePages = overview.pages.map((entry) => entry.slug).sort();
  if (codePages.join(' ') !== [ejected.slug, 'revenue'].sort().join(' ') || overview.widgets.length !== 2) {
    die(`Studio's project overview lists the pages and widgets wrong: ${JSON.stringify(overview)}`);
  }
  await checkClientCode(call, `http://127.0.0.1:${START_PORT}`);
  const ejectedRow = (await call('GET', '/pages')).data.find((row) => row.slug === ejected.slug);
  if (ejectedRow?.origin !== 'project' || ejectedRow.id !== ejected.id) die(`start lost the ejected page: ${JSON.stringify(ejectedRow)}`);
  log('✓ start runs the edited hook, serves the page and the widgets, keeps the ejected page, and Studio lists them all');
}
const slugOf = (file) => file.replace(/\.json$/, '');
const pageBySlug = async (slug) => (await call('GET', '/pages')).data.find((row) => row.slug === slug);
const renameOnServer = async (file, title) => {
  const row = await pageBySlug(slugOf(file));
  await call('PATCH', `/pages/${row.id}`, { title });
};
const statusOf = async (file) =>
  (await call('GET', '/project/status')).data.entries.find((entry) => entry.path === `pages/${file}`)?.status ??
  'in-sync';
let current = start;
const restartStart = async () => {
  await stopGroup(current, 'SIGTERM');
  current = background('npm', ['start', '--', '--port', String(START_PORT), '--host', '127.0.0.1'], demo);
  await waitForHealth(START_PORT, current.output);
};

const serverFile = crudFiles[1];
await renameOnServer(serverFile, 'Edited on the server');
if (readPage(serverFile).title.fallback === 'Edited on the server') die('the server wrote a project file');
if ((await statusOf(serverFile)) !== 'changed-on-server') die(`pages/${serverFile} is not flagged as changed on the server`);
log('✓ a Studio edit on the server is kept and flagged, and no file is written');

const adminRole = (await call('GET', '/roles')).roles.find((role) => role.slug === 'admin');
const { key } = await call('POST', '/api-keys', { name: 'rehearsal pull', roleId: adminRole.id });
run('npm', ['run', 'pull', '--', '--from', `http://127.0.0.1:${START_PORT}`], {
  cwd: demo,
  env: { ...process.env, ADMINIUM_API_KEY: key },
});
if (readPage(serverFile).title.fallback !== 'Edited on the server') die('pull --from did not write the server edit');
log('✓ pull --from wrote the server edit into the folder, with an Admin API key');

await restartStart();
if ((await statusOf(serverFile)) !== 'in-sync') die('the flag did not clear once the pulled file was deployed');
log('✓ deploying the pulled file cleared the flag');

const conflictFile = crudFiles[2];
await renameOnServer(conflictFile, 'Server side');
{
  const doc = readPage(conflictFile);
  doc.title.fallback = 'Project side';
  writePage(conflictFile, doc);
}
await restartStart();
if ((await statusOf(conflictFile)) !== 'conflict') die(`pages/${conflictFile} is not a conflict after the redeploy`);
if ((await pageBySlug(slugOf(conflictFile))).title !== 'Server side') die('the redeploy replaced a page changed on the server');
await call('POST', '/project/resolve', { path: `pages/${conflictFile}`, keep: 'project' });
if ((await pageBySlug(slugOf(conflictFile))).title !== 'Project side') die('keeping the project copy did not apply the file');
if ((await statusOf(conflictFile)) !== 'in-sync') die('the conflict is still listed after it was settled');
log('✓ a page changed on both sides is a conflict, kept until the project copy was chosen');

await stopGroup(current, 'SIGTERM');

// ── 6. new in an existing folder ─────────────────────────────────────────────

const app = join(WORK, 'existing-app');
mkdirSync(app);
const appPackage = { name: 'existing-app', version: '1.0.0', scripts: { dev: 'vite', build: 'vite build' } };
writeFileSync(join(app, 'package.json'), `${JSON.stringify(appPackage, null, 2)}\n`);
writeFileSync(join(app, 'README.md'), '# Existing app\n');
run(cli, ['new', '--yes', '--no-install', '--no-git'], { cwd: app });
const merged = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
if (merged.scripts.dev !== 'vite' || merged.scripts['adminium:dev'] !== 'adminium dev') {
  die(`package.json scripts were not merged as expected: ${JSON.stringify(merged.scripts)}`);
}
if (readFileSync(join(app, 'README.md'), 'utf8') !== '# Existing app\n') die('new changed an existing README');
log('✓ new added a project to an existing app without changing its files');

log('\nThe project rehearsal passed.');
