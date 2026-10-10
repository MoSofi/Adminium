// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Open a folder" in the desktop app, for folders that are not ready to start
 * as they are: one with no data, one whose key is gone, one a terminal has,
 * one a newer Adminium wrote. What the spec holds first is the order: NOTHING
 * of a folder runs before the person said "Open" — its config file leaves a
 * mark the moment anything imports it — and nothing runs while a screen that
 * may still be answered "Close" is up.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { ProjectHarness } from '../tests/projectHarness.js';
import { closeDesktop, launchDesktop } from './helpers/launch.js';

/** The engine's own SQLite library, as far as this spec uses it (it ships no types of its own). */
interface Store {
  prepare(sql: string): { run(...values: unknown[]): unknown };
  close(): void;
}
const Database = createRequire(import.meta.url)('better-sqlite3') as new (file: string) => Store;

const FIRST_PORT = process.env['E2E_PORT'] === undefined || process.env['E2E_PORT'] === '' ? 4740 : Number(process.env['E2E_PORT']) + 40;

let project: ProjectHarness;
let home: string;
let userDataDir: string;
let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });

const ran = (): boolean => existsSync(join(project.root, 'RAN'));
const env = (): string => readFileSync(join(project.root, '.env'), 'utf8');
/** The SQLite file the project's address names. */
const databaseFile = (): string => resolve(project.root, (/^DATABASE_URL=sqlite:(.+)$/m.exec(env())?.[1] ?? '').trim());

const pickerAnswers = (folder: string): Promise<void> =>
  app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [picked] })) as typeof dialog.showOpenDialog;
  }, folder);

/** The project's row on Start. */
const row = () => page.locator(`[data-recent="${project.root}"]`).getByRole('button').first();

/** From the Designer back to Start. */
const closeProject = async (): Promise<void> => {
  await page.getByRole('button', { name: /^Project: / }).click();
  const next = app.waitForEvent('window');
  await page.getByRole('menuitem', { name: 'Close project' }).click();
  page = await next;
  await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => existsSync(join(project.root, '.adminium', 'running.json'))).toBe(false);
};

// eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(300_000);
  home = realpathSync(mkdtempSync(join(tmpdir(), 'adminium-desktop-home-')));
  project = await ProjectHarness.create({}, ['react', 'react-dom']);
  // The config file says so the moment anything builds and imports it.
  const config = join(project.root, 'adminium.config.ts');
  writeFileSync(config, `import { writeFileSync as __mark } from 'node:fs';\n__mark(${JSON.stringify(join(project.root, 'RAN'))}, 'x');\n${readFileSync(config, 'utf8')}`);
  // Its database where a project made in the app keeps it: inside its own data folder.
  writeFileSync(join(project.root, '.env'), env().replace(/^DATABASE_URL=.*$/m, 'DATABASE_URL=sqlite:./data/app.sqlite'));
  // A folder that arrives with the project and its key, and no data at all.
  rmSync(databaseFile(), { force: true });
  rmSync(join(project.root, 'data'), { recursive: true, force: true });
  ({ app, userDataDir } = await launchDesktop({ env: { HOME: home, USERPROFILE: home, ADMINIUM_DESKTOP_E2E_PORT: String(FIRST_PORT), ADMINIUM_DISABLE_UPDATES: '1' } }));
  page = await app.firstWindow();
});

test.afterAll(async () => {
  if (app !== undefined) await closeDesktop(app, userDataDir);
  await project?.close();
  if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

test('a folder with no data: nothing of it runs before "Open", and what was made for it is said before it starts', async () => {
  test.setTimeout(240_000);
  await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible({ timeout: 60_000 });
  await pickerAnswers(project.root);
  await page.getByRole('button', { name: /Open a folder/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Open this folder?');
  expect(ran()).toBe(false);

  await page.getByRole('dialog').getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText('This folder has the project but no data.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Adminium made an empty database.')).toBeVisible();
  await expect(page.getByText('The apps’ own tables are made again. Rows that were in the old data are not here.')).toBeVisible();
  // The file is there, empty; the key that came with the folder was kept; and still nothing of the folder has run.
  expect(existsSync(databaseFile())).toBe(true);
  expect(env()).toMatch(/^ADMINIUM_SECRET=\S+/m);
  expect(ran()).toBe(false);

  const next = app.waitForEvent('window');
  await page.getByRole('button', { name: 'Continue' }).click();
  page = await next;
  await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible({ timeout: 180_000 });
  expect(ran()).toBe(true);
  expect(existsSync(join(project.root, 'data', 'meta.db'))).toBe(true);
});

test('data whose key is gone stops and asks; "Start the data fresh" moves the old data aside and deletes nothing', async () => {
  test.setTimeout(240_000);
  await closeProject();
  // The key line is gone from .env (a folder zipped without it), the data is still there.
  writeFileSync(join(project.root, '.env'), env().replace(/^ADMINIUM_SECRET=.*\n?/m, ''));

  await row().click();
  await expect(page.getByRole('heading', { name: 'This project’s data is here, but its key is missing.' })).toBeVisible({ timeout: 30_000 });
  // No answer is chosen for the person, and without one there is no way on.
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  expect(env()).not.toContain('ADMINIUM_SECRET');

  await page.getByRole('radio', { name: /Start the data fresh, keep my apps/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Adminium made an empty database.')).toBeVisible({ timeout: 30_000 });
  const kept = readdirSync(project.root).filter((name) => name.startsWith('data.before-'));
  expect(kept).toHaveLength(1);
  expect(existsSync(join(project.root, kept[0] ?? '', 'meta.db'))).toBe(true);
  expect(env()).toMatch(/^ADMINIUM_SECRET=[0-9a-f]{64}$/m);

  const next = app.waitForEvent('window');
  await page.getByRole('button', { name: 'Continue' }).click();
  page = await next;
  await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible({ timeout: 180_000 });
});

test('a folder a terminal has is not started a second time: it says where, and "Look again" opens it once it is free', async () => {
  test.setTimeout(240_000);
  await closeProject();
  // This test's own process stands in for a terminal's server: it is certainly alive.
  mkdirSync(join(project.root, '.adminium'), { recursive: true });
  writeFileSync(join(project.root, '.adminium', 'running.json'), JSON.stringify({ pid: process.pid, port: 4712, mode: 'dev', by: 'cli', startedAt: new Date().toISOString() }));
  await row().click();
  await expect(page.getByRole('heading', { name: 'This project is already running' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/It is open in a terminal, on port/)).toContainText('4712');

  rmSync(join(project.root, '.adminium', 'running.json'));
  const next = app.waitForEvent('window');
  await page.getByRole('button', { name: 'Look again' }).click();
  page = await next;
  await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible({ timeout: 180_000 });
});

test('data a newer Adminium wrote is never started: the app says which, and offers its own update', async () => {
  test.setTimeout(240_000);
  await closeProject();
  const store = new Database(join(project.root, 'data', 'meta.db'));
  store.prepare("INSERT INTO adminium_migrations (name, checksum, applied_at, duration_ms, adminium_version) VALUES ('9999_from_the_future', 'x', ?, 1, '9.9.9')").run(Date.now());
  store.close();

  await row().click();
  await expect(page.getByRole('heading', { name: 'This project needs a newer Adminium.' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/It was last opened with Adminium/)).toContainText('9.9.9');
  // Not started: the folder is free, and stays so.
  expect(existsSync(join(project.root, '.adminium', 'running.json'))).toBe(false);
  // This build was started with updates off: it says so rather than pretending to look.
  await page.getByRole('button', { name: 'Update Adminium' }).click();
  await expect(page.getByText(/does not update itself|Looking for a newer Adminium/)).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible();
});

test('a folder that is not a project says so, and offers to make one inside it', async () => {
  const plain = join(home, 'Documents');
  mkdirSync(plain, { recursive: true });
  await pickerAnswers(plain);
  await page.getByRole('button', { name: /Open a folder/ }).click();
  await expect(page.getByText('This folder is not an Adminium project.')).toBeVisible();
  await page.getByRole('button', { name: 'Make a new project here' }).click();
  await expect(page.getByRole('heading', { name: 'Build an app' })).toBeVisible();
  await page.getByLabel('Name').fill('Bakery');
  await expect(page.getByRole('textbox', { name: 'Where to keep it' })).toHaveValue('~/Documents/bakery');
});
