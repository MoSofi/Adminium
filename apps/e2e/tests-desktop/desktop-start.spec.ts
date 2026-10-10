// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app's own first screens: Start, New app, the question before a folder
 * is opened, and the recent list.
 *
 * These are drawn by the app's own page bundle, from the disk, before any
 * server runs. The system's folder picker cannot be driven from a test, so it
 * is stood in for in the main process (the picker's ANSWER is the only thing
 * replaced; everything that judges the folder is the app's own).
 *
 * The home folder is a temporary one, so "~/Adminium" is this run's.
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { ProjectHarness } from '../tests/projectHarness.js';
import { closeDesktop, launchDesktop } from './helpers/launch.js';

const FIRST_PORT = process.env['E2E_PORT'] === undefined || process.env['E2E_PORT'] === '' ? 4760 : Number(process.env['E2E_PORT']) + 60;

let project: ProjectHarness;
let home: string;
let userDataDir: string;
let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });

const launch = async (): Promise<void> => {
  ({ app, userDataDir } = await launchDesktop({
    ...(userDataDir === undefined ? {} : { userDataDir }),
    env: { HOME: home, USERPROFILE: home, ADMINIUM_DESKTOP_E2E_PORT: String(FIRST_PORT), ADMINIUM_DISABLE_UPDATES: '1' },
  }));
  page = await app.firstWindow();
};

/** The system's folder picker answers with `folder`. */
const pickerAnswers = (folder: string | null): Promise<void> =>
  app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (() => Promise.resolve(picked === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [picked] })) as typeof dialog.showOpenDialog;
  }, folder);

const config = (): { version: number; projects: Array<{ path: string; name: string; state: string; trusted: string | null }> } =>
  JSON.parse(readFileSync(join(userDataDir, 'config.json'), 'utf8')) as ReturnType<typeof config>;

// eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(300_000);
  home = realpathSync(mkdtempSync(join(tmpdir(), 'adminium-desktop-home-')));
  project = await ProjectHarness.create({}, ['react', 'react-dom']);
  // A model's name, so the Designer's Home has one to show; nothing here asks it anything.
  appendFileSync(join(project.root, '.env'), '\nADMINIUM_AI_OLLAMA_BASE_URL=http://localhost:9\nADMINIUM_AI_MODEL=ollama/fake\n');
  await launch();
});

test.afterAll(async () => {
  if (app !== undefined) await closeDesktop(app, userDataDir);
  await project?.close();
  if (home !== undefined) rmSync(home, { recursive: true, force: true });
});

test('opens on Start, from the disk, with nothing started', async () => {
  await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible({ timeout: 60_000 });
  expect(page.url()).toMatch(/^file:.*\/renderer\/app\/index\.html/);
  // A first launch: no recent project, no classic workspace.
  await expect(page.getByText('Welcome to Adminium.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent projects' })).toHaveCount(0);
  await expect(page.locator('[data-choice]')).toHaveCount(4);
  await expect(page.getByRole('button', { name: /Build an app/ })).toBeVisible();
  // No server, no data folder, no secret: nothing was chosen yet.
  expect(existsSync(join(userDataDir, 'data', 'meta.db'))).toBe(false);
  expect(existsSync(join(userDataDir, 'config.json'))).toBe(false);
});

test('New app proposes a folder of its own under ~/Adminium, and refuses one inside another project', async () => {
  await page.getByRole('button', { name: /Build an app/ }).click();
  const name = page.getByLabel('Name');
  await expect(name).toBeFocused();
  const where = page.getByRole('textbox', { name: 'Where to keep it' });
  await expect(where).toHaveValue('~/Adminium');
  await expect(page.getByRole('button', { name: 'Create' })).toBeDisabled();

  await name.fill('Juniper Kitchen');
  await expect(where).toHaveValue('~/Adminium/juniper-kitchen');
  await expect(page.getByRole('button', { name: 'Create' })).toBeEnabled();

  // "Change…" to a folder that is a project: main refuses, with the reason.
  const existing = join(home, 'Existing');
  mkdirSync(existing);
  writeFileSync(join(existing, 'adminium.config.ts'), 'export default {};\n');
  await pickerAnswers(existing);
  await page.getByRole('button', { name: 'Change…' }).click();
  await expect(page.getByRole('alert')).toHaveText('This folder is inside another project. Choose a folder outside it.');
  await expect(page.getByRole('button', { name: 'Create' })).toBeDisabled();
  // Nothing was made anywhere.
  expect(existsSync(join(home, 'Adminium'))).toBe(false);
  expect(existsSync(join(existing, 'juniper-kitchen'))).toBe(false);

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible();
});

test('a folder is opened only after the question, and Cancel opens nothing', async () => {
  await pickerAnswers(project.root);
  await page.getByRole('button', { name: /Open a folder/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Open this folder?')).toBeVisible();
  await expect(dialog).toContainText(project.root);
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  // Not served, not remembered.
  expect(existsSync(join(project.root, '.adminium', 'running.json'))).toBe(false);
  expect(existsSync(join(userDataDir, 'config.json'))).toBe(false);
});

test('"Open" serves the folder in the Designer and remembers what was agreed to', async () => {
  test.setTimeout(240_000);
  await pickerAnswers(project.root);
  await page.getByRole('button', { name: /Open a folder/ }).click();
  // The project gets a window on a cookie jar of its own: the Start window is replaced.
  const next = app.waitForEvent('window');
  await page.getByRole('dialog').getByRole('button', { name: 'Open' }).click();
  page = await next;
  await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible({ timeout: 180_000 });
  expect(new URL(page.url()).hostname).toBe('127.0.0.1');
  expect(app.windows()).toHaveLength(1);

  const saved = config();
  expect(saved.version).toBe(2);
  expect(saved.projects).toHaveLength(1);
  expect(saved.projects[0]).toMatchObject({ path: project.root, state: 'building' });
  expect(saved.projects[0]?.trusted).toMatch(/^[0-9a-f]{64}$/);
  // The first screens' calls are the app's own pages': a project's page is refused them.
  const refused = await page.evaluate(async () => {
    try {
      await (window as unknown as { adminiumDesktop: { start: { state: () => Promise<unknown> } } }).adminiumDesktop.start.state();
      return 'answered';
    } catch (error) {
      return String(error);
    }
  });
  expect(refused).toContain('UNTRUSTED_SENDER');
});

test('the next launch lists it under Recent projects and opens it without asking again', async () => {
  test.setTimeout(240_000);
  await closeDesktop(app, undefined);
  await launch();
  await expect(page.getByRole('heading', { name: 'Recent projects' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Welcome to Adminium.')).toHaveCount(0);
  const row = page.locator(`[data-recent="${project.root}"]`);
  await expect(row).toContainText('Building');
  await expect(row).toContainText('Opened today');

  const next = app.waitForEvent('window');
  await row.getByRole('button').first().click();
  page = await next;
  await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible({ timeout: 180_000 });
});
