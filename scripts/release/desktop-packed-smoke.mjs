// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The packed desktop app, started as a person starts it and walked through the
 * one road everything else stands on: Start → "Build an app" → the project is
 * made (the engine's own `new`, run by the app's program as Node, its packages
 * fetched by the npm the app carries) → the Designer → one turn with a scripted
 * model → a version is saved → quit.
 *
 * Every fault the packaging trials found was invisible to a build made from the
 * sources: a file the archive cannot serve, a native library the signed app may
 * not load, a program the app cannot start as Node. This runs the PACKED app,
 * on the system it was packed for, before anything is published.
 *
 *   node scripts/release/desktop-packed-smoke.mjs [--app <path to the packed app>]
 *
 * It needs the network once (the registry, for the new project's packages) and
 * the engine version the app pins to be on npm. Exit 0: it worked. Anything
 * else: what stopped, with the app's last log lines.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = join(repo, 'apps', 'desktop', 'dist');

/** The packed app's own program, where electron-builder leaves it unpacked on each system. */
export function packedProgram(platform = process.platform, root = dist, exists = existsSync, list = readdirSync) {
  const folders = exists(root) ? list(root) : [];
  if (platform === 'darwin') {
    const folder = folders.find((name) => /^mac(-arm64|-universal)?$/.test(name) && exists(join(root, name, 'Adminium.app')));
    return folder === undefined ? null : join(root, folder, 'Adminium.app', 'Contents', 'MacOS', 'Adminium');
  }
  if (platform === 'win32') {
    const folder = folders.find((name) => /^win(-arm64)?-unpacked$/.test(name));
    return folder === undefined ? null : join(root, folder, 'Adminium.exe');
  }
  const folder = folders.find((name) => /^linux(-arm64)?-unpacked$/.test(name));
  if (folder === undefined) return null;
  // The product's file name on Linux is electron-builder's `executableName`.
  return ['adminium', 'Adminium', '@adminiumdesktop'].map((name) => join(root, folder, name)).find((path) => exists(path)) ?? null;
}

const STEP_MS = 10 * 60_000;

async function main() {
  const named = process.argv.indexOf('--app');
  const program = named === -1 ? packedProgram() : resolve(process.argv[named + 1] ?? '');
  if (program === null || !existsSync(program)) {
    console.error(`[packed smoke] no packed app found${program === null ? ` under ${dist}` : ` at ${program}`}. Pack it first (electron-builder).`);
    process.exit(2);
  }
  // Playwright and the scripted model are the end-to-end suite's own.
  const fromE2e = createRequire(join(repo, 'apps', 'e2e', 'package.json'));
  const { _electron: electron } = fromE2e('@playwright/test');
  const { createDesignerModelServer } = await import(pathToFileURL(join(repo, 'apps', 'e2e', 'scripts', 'fake-llm.mjs')).href);

  const home = mkdtempSync(join(tmpdir(), 'adminium-smoke-home-'));
  const userData = mkdtempSync(join(tmpdir(), 'adminium-smoke-data-'));
  const files = {
    'manifest/tables/jobs.json': { ref: 'jobs', label: { 'en-US': 'Job' }, labelPlural: { 'en-US': 'Jobs' }, keyField: 'title', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'title', type: 'text', maxLength: 120, default: 'Untitled', label: { 'en-US': 'Title' } }] },
    'manifest/pages/repair-desk-jobs.json': { ref: 'repair-desk-jobs', template: 'page-crud', title: { key: 'repair-desk.jobs', fallback: 'Jobs' }, nav: { group: 'main', icon: 'list-checks', order: 1 }, bindings: { rows: 'jobs' } },
    'manifest/roles.json': [{ key: 'staff', name: 'Repair desk staff', permissions: ['table:@jobs:read', 'table:@jobs:create', 'table:@jobs:update', 'page:@repair-desk-jobs:view'] }],
  };
  const model = createDesignerModelServer({ appKey: 'repair-desk', appName: 'Repair desk', files: Object.fromEntries(Object.entries(files).map(([file, value]) => [file, JSON.stringify(value, null, 2)])) });
  await new Promise((done) => model.listen(0, '127.0.0.1', done));
  // The model, where the app keeps one: in its own folder, never in a project.
  writeFileSync(join(userData, 'models.json'), JSON.stringify({ version: 1, storage: 'plain', values: { ADMINIUM_AI_OLLAMA_BASE_URL: `http://localhost:${String(model.address().port)}`, ADMINIUM_AI_MODEL: 'ollama/fake' } }));

  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  Object.assign(env, { HOME: home, USERPROFILE: home, ADMINIUM_DISABLE_UPDATES: '1' });

  const step = (words) => console.log(`[packed smoke] ${words}`);
  let app;
  let failed = null;
  try {
    app = await electron.launch({ executablePath: program, args: [`--user-data-dir=${userData}`], env, timeout: 120_000 });
    let page = await app.firstWindow();
    await page.getByRole('heading', { name: 'What would you like to do?' }).waitFor({ timeout: 120_000 });
    step('Start is shown, from inside the archive.');

    await page.locator('[data-choice="build"]').click();
    await page.getByLabel('Name').fill('Smoke Kitchen');
    const started = Date.now();
    const next = app.waitForEvent('window', { timeout: STEP_MS });
    await page.getByRole('button', { name: 'Create' }).click();
    page = await next;
    await page.getByRole('heading', { name: 'What do you want to build?' }).waitFor({ timeout: STEP_MS });
    const root = join(home, 'Adminium', 'smoke-kitchen');
    for (const needed of ['adminium.config.ts', 'package.json', 'node_modules', '.env']) if (!existsSync(join(root, needed))) throw new Error(`the new project has no ${needed}`);
    step(`A project was made and its packages fetched in ${String(Math.round((Date.now() - started) / 1000))} s; the Designer is open.`);

    await page.getByRole('button', { name: 'Model: fake' }).waitFor({ timeout: 60_000 });
    await page.getByRole('textbox', { name: 'Describe your app' }).fill('A repair desk: jobs and parts.');
    await page.keyboard.press('Enter');
    await page.getByText('The app has a jobs table now. It is applied and saved.').waitFor({ timeout: STEP_MS });
    step('A turn ran with the scripted model and was applied.');

    // A version needs git: the system's, or none. With none the app says so, and that is not this smoke's failure.
    const version = page.getByRole('button', { name: /^Version v1/ });
    const off = page.getByRole('button', { name: 'Versions: off' });
    await version.or(off).first().waitFor({ timeout: 60_000 });
    step((await version.count()) > 0 ? 'A version was saved (v1).' : 'This machine has no git: versions are off, and the page says so.');
    if (!existsSync(join(root, 'apps', 'repair-desk', 'manifest', 'tables', 'jobs.json'))) throw new Error('the turn left no file in the project');
    // And nothing of the model is in the project's own file.
    if (/ADMINIUM_AI_/.test(readFileSync(join(root, '.env'), 'utf8'))) throw new Error('a model line was written into the project’s .env');
  } catch (error) {
    failed = error;
  } finally {
    await app?.close().catch(() => undefined);
    model.close();
  }

  if (failed !== null) {
    console.error(`[packed smoke] STOPPED: ${failed instanceof Error ? failed.message : String(failed)}`);
    // The app's own logs say what a window could not.
    const logs = [join(userData, 'logs'), join(home, 'Library', 'Logs', 'Adminium')].find((folder) => existsSync(folder));
    if (logs !== undefined) {
      for (const name of readdirSync(logs)) console.error(`──── ${name} (last lines)\n${readFileSync(join(logs, name), 'utf8').split('\n').slice(-40).join('\n')}`);
    }
    process.exit(1);
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
  step('ok.');
  process.exit(0);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
