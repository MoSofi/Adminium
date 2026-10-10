// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A project folder in the desktop app: the app's own server
 * child serves the folder as a terminal would, and the window opens Adminium
 * Designer on it, signed in.
 *
 * The folder is opened through the test seam (`ADMINIUM_DESKTOP_E2E_PROJECT`),
 * which only an unpackaged build reads: the app has no screen to pick a folder
 * on yet, and the question that comes before a folder's code may run has none
 * either. This spec is the folder AFTER that question: prepared, and trusted.
 *
 * The model is the scripted one the browser's Designer spec uses, on this
 * process.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { createDesignerModelServer } from '../scripts/fake-llm.mjs';
import { ProjectHarness } from '../tests/projectHarness.js';
import { closeDesktop, keepModels, launchDesktop, newUserDataDir, readExternalOpens, stubExternalOpen } from './helpers/launch.js';

const APP_KEY = 'repair-desk';
/** Inside the run's own ports when it was given any; else in the product's range. */
const FIRST_PORT = process.env['E2E_PORT'] === undefined || process.env['E2E_PORT'] === '' ? 4780 : Number(process.env['E2E_PORT']) + 80;

let project: ProjectHarness;
let model: Server;
let app: ElectronApplication;
let page: Page;
let userDataDir: string;

test.describe.configure({ mode: 'serial' });

// eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(300_000);
  project = await ProjectHarness.create({}, ['react', 'react-dom']);
  // What the model writes into the bare app: the same three files the browser's Designer spec has it write.
  const files = {
    'manifest/tables/jobs.json': {
      ref: 'jobs',
      label: { 'en-US': 'Job' },
      labelPlural: { 'en-US': 'Jobs' },
      keyField: 'title',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'title', type: 'text', maxLength: 120, default: 'Untitled', label: { 'en-US': 'Title' } },
        { ref: 'status', type: 'enum', enum: ['open', 'done'], default: 'open', label: { 'en-US': 'Status' } },
      ],
    },
    [`manifest/pages/${APP_KEY}-jobs.json`]: {
      ref: `${APP_KEY}-jobs`,
      template: 'page-crud',
      title: { key: `${APP_KEY}.jobs`, fallback: 'Jobs' },
      nav: { group: 'main', icon: 'list-checks', order: 1 },
      bindings: { rows: 'jobs' },
    },
    'manifest/roles.json': [
      { key: 'staff', name: 'Repair desk staff', permissions: ['table:@jobs:read', 'table:@jobs:create', 'table:@jobs:update', `page:@${APP_KEY}-jobs:view`] },
    ],
  };
  model = createDesignerModelServer({ appKey: APP_KEY, appName: 'Repair desk', files: Object.fromEntries(Object.entries(files).map(([file, value]) => [file, JSON.stringify(value, null, 2)])) });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  const modelUrl = `http://localhost:${String((model.address() as AddressInfo).port)}`;

  // The model, where the app keeps it: with the app, for every project, and never in a project's `.env`.
  userDataDir = newUserDataDir();
  keepModels(userDataDir, { ADMINIUM_AI_OLLAMA_BASE_URL: modelUrl, ADMINIUM_AI_MODEL: 'ollama/fake' });
  // A name the app decides itself: a folder from somewhere else may say anything of it.
  appendFileSync(join(project.root, '.env'), 'ADMINIUM_TRUST_PROXY=true\n');

  ({ app } = await launchDesktop({
    userDataDir,
    env: {
      ADMINIUM_DESKTOP_E2E_PROJECT: project.root,
      ADMINIUM_DESKTOP_E2E_PORT: String(FIRST_PORT),
      ADMINIUM_DISABLE_UPDATES: '1',
    },
  }));
  page = await app.firstWindow();
});

test.afterAll(async () => {
  if (app !== undefined) await closeDesktop(app, userDataDir);
  await new Promise<void>((resolve) => (model === undefined ? resolve() : model.close(() => resolve())));
  await project?.close();
});

const mark = (): { pid: number; port: number; mode: string; by: string } =>
  JSON.parse(readFileSync(join(project.root, '.adminium', 'running.json'), 'utf8')) as { pid: number; port: number; mode: string; by: string };

test('opens the folder in the Designer, signed in, on this machine only', async () => {
  await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible({ timeout: 180_000 });
  // The one-use token signed the project's owner in and left the address.
  const url = new URL(page.url());
  expect(url.hash).toBe('');
  expect(url.hostname).toBe('127.0.0.1');
  expect(Number(url.port)).toBeGreaterThanOrEqual(FIRST_PORT);
  expect(Number(url.port)).toBeLessThan(FIRST_PORT + 20);
  await expect(page.getByRole('button', { name: 'Model: fake' })).toBeVisible();
  // What the folder's .env said of a name the app decides was not obeyed, and the page says which.
  await expect(page.getByRole('note')).toContainText('ADMINIUM_TRUST_PROXY');
  expect(await page.evaluate(() => typeof (window as unknown as { adminiumDesktop?: unknown }).adminiumDesktop)).toBe('object');

  // The folder is served, and says who serves it.
  expect(mark()).toMatchObject({ port: Number(url.port), mode: 'design', by: 'desktop' });
  // Its data is its own: the store is in the folder, not in the app's data folder.
  expect(existsSync(join(project.root, 'data', 'meta.db'))).toBe(true);
  expect(existsSync(join(userDataDir, 'data', 'meta.db'))).toBe(false);
  // The classic workspace's own routes are not this server's.
  const statuses = await page.evaluate(async () => Promise.all(['/api/v1/desktop/lan-share', '/api/v1/system/info'].map(async (path) => (await fetch(path)).status)));
  expect(statuses).toEqual([404, 200]);
});

test('a second server on the same folder is refused, and told where the first is', async () => {
  const second = project.cli(['start', '--port', String(FIRST_PORT + 19), '--host', '127.0.0.1']);
  expect(second.status).not.toBe(0);
  expect(`${second.stdout}${second.stderr}`).toContain(`This project is already running (in the Adminium app), on port ${String(mark().port)}.`);
});

test('a request builds an app, saves a version and shows it', async () => {
  test.setTimeout(240_000);
  await page.getByRole('textbox', { name: 'Describe your app' }).fill('A repair desk: jobs and parts.');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/design\/ds_[0-9a-z]{24}$/);
  await expect(page.getByText('The app has a jobs table now. It is applied and saved.')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/^Saved as v1$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Version v1: v1' })).toBeVisible();

  // The preview is a frame, and the window's rule lets a frame be on the app's own origin: the owner's dashboard is in it.
  const frame = page.frameLocator('iframe[title="Dashboard"]');
  await expect(frame.getByRole('button', { name: 'Set your password' })).toBeVisible({ timeout: 60_000 });
  // No frame has the app's bridge.
  expect(await frame.locator('body').evaluate(() => typeof (window as unknown as { adminiumDesktop?: unknown }).adminiumDesktop)).toBe('undefined');
});

test('"Open in a new tab" hands the system’s browser a link that signs the owner in there, once', async ({ playwright }) => {
  await stubExternalOpen(app);
  await page.getByRole('button', { name: /Open in a new tab/ }).first().click();
  await expect.poll(() => readExternalOpens(app), { timeout: 15_000 }).toHaveLength(1);
  const [link] = await readExternalOpens(app);
  const url = new URL(link ?? '');
  // The app's own address, in the one shape it is ever handed over in: with a one-use token after #.
  expect(url.origin).toBe(new URL(page.url()).origin);
  expect(url.hash).toMatch(/^#designToken=[0-9a-f]{64}$/);
  // No window was made for it, and this one did not move.
  expect(app.windows()).toHaveLength(1);

  // What that browser does with it: it holds no cookie of this server.
  const exchange = async (): Promise<number> => {
    const browser = await playwright.request.newContext();
    const reply = await browser.post(`${url.origin}/api/v1/auth/design-session`, { headers: { origin: url.origin }, data: { designToken: url.hash.slice('#designToken='.length) } });
    await browser.dispose();
    return reply.status();
  };
  expect(await exchange()).toBe(200);
  expect(await exchange()).toBe(401);
});

test('the build page’s first bar holds the project’s button and Build | Share, and still fits at the window’s smallest', async () => {
  // The seam opened this folder, so its name is the folder's own.
  const bar = page.locator('header').first();
  await expect(bar.getByRole('button', { name: 'Project: Demo' })).toBeVisible();
  await expect(bar.getByRole('radiogroup', { name: 'Build or share' })).toBeVisible();

  const measure = async (): Promise<{ width: number; overflow: number; clipped: string[] }> =>
    bar.evaluate((header) => {
      const box = header.getBoundingClientRect();
      const clipped: string[] = [];
      for (const control of header.querySelectorAll('a, button, [role="radiogroup"]')) {
        const at = control.getBoundingClientRect();
        if (at.width === 0) continue;
        if (at.left < box.left - 0.5 || at.right > box.right + 0.5) clipped.push((control.getAttribute('aria-label') ?? control.textContent ?? '').trim().slice(0, 40));
      }
      return { width: Math.round(box.width), overflow: header.scrollWidth - header.clientWidth, clipped };
    });

  const sizes = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const before = win?.getContentSize() ?? [0, 0];
    win?.setContentSize(1024, 700);
    return { before, after: win?.getContentSize() ?? [0, 0] };
  });
  expect(sizes.after[0]).toBe(1024);
  await expect.poll(async () => (await measure()).width).toBe(1024);
  const small = await measure();
  expect(small.clipped).toEqual([]);
  expect(small.overflow).toBeLessThanOrEqual(0);
  // Every control of the bar is still there to press.
  for (const name of ['Project: Demo', 'Switch to dark theme', 'Language']) await expect(bar.getByRole('button', { name })).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Open Dashboard' })).toBeVisible();

  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(size[0] ?? 1440, size[1] ?? 900);
  }, sizes.before);
});

test('quitting in the middle of a turn asks first, and “keep working” keeps the app', async () => {
  test.setTimeout(240_000);
  // The native question, answered "Keep working" and written down.
  await app.evaluate(({ dialog }) => {
    const asked: string[] = [];
    (globalThis as unknown as { askedOnQuit: string[] }).askedOnQuit = asked;
    dialog.showMessageBox = ((...args: unknown[]) => {
      const options = (args.length === 2 ? args[1] : args[0]) as { message: string; buttons: string[] };
      asked.push(`${options.message} [${options.buttons.join(' | ')}]`);
      return Promise.resolve({ response: 1, checkboxChecked: false });
    }) as typeof dialog.showMessageBox;
  });

  await page.getByRole('textbox', { name: 'Message to Adminium Designer' }).fill('Write them again, exactly as they are.');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 });
  await app.evaluate(({ app: electronApp }) => {
    electronApp.quit();
  });

  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { askedOnQuit: string[] }).askedOnQuit), { timeout: 15_000 })
    .toEqual(['The Designer is in the middle of a turn. [Quit anyway | Keep working]']);
  // Still here, and the turn it was in the middle of ends as it would have.
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 120_000 });
  // (The same files written again change nothing, so no second version: the answer itself is what shows the turn ended.)
  await expect(page.getByText('The app has a jobs table now. It is applied and saved.')).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByRole('textbox', { name: 'Message to Adminium Designer' })).toBeEditable();
  expect(mark().by).toBe('desktop');
});

test('with nothing running it quits without a question, and the folder is free again', async () => {
  const before = await app.evaluate(() => (globalThis as unknown as { askedOnQuit: string[] }).askedOnQuit.length);
  const pid = mark().pid;
  const gone = new Promise<void>((resolve) => app.process().once('exit', () => resolve()));
  await app.evaluate(({ app: electronApp }) => {
    electronApp.quit();
  });
  await Promise.race([gone, new Promise((_, reject) => setTimeout(() => reject(new Error('the app did not quit within 30 s')), 30_000))]);
  expect(before).toBe(1);
  expect(existsSync(join(project.root, '.adminium', 'running.json'))).toBe(false);
  expect(() => process.kill(pid, 0)).toThrow();
});
