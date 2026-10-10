// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Build and Share in the desktop app: a project is built on this computer only,
 * or shared on the network with the Designer off, never both. Share is never
 * started without an owner password (another device has nothing else to sign
 * in with), the port is kept, and "Go back to building" is this computer only
 * again.
 *
 * Everything here is asked over loopback: the server does listen on every
 * network while shared, and nothing in this spec reaches it from one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { ProjectHarness } from '../tests/projectHarness.js';
import { closeDesktop, launchDesktop } from './helpers/launch.js';

const FIRST_PORT = process.env['E2E_PORT'] === undefined || process.env['E2E_PORT'] === '' ? 4700 : Number(process.env['E2E_PORT']);
const OWNER = { email: 'ava@example.com', password: 'correct horse battery staple' };

let project: ProjectHarness;
let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let sharedPort = 0;

test.describe.configure({ mode: 'serial' });

const entry = (): { state: string; sharePort: number | null } =>
  (JSON.parse(readFileSync(join(userDataDir, 'config.json'), 'utf8')) as { projects: Array<{ path: string; state: string; sharePort: number | null }> }).projects.find((found) => found.path === project.root) ?? { state: 'none', sharePort: null };
const mark = (): { port: number; mode: string } => JSON.parse(readFileSync(join(project.root, '.adminium', 'running.json'), 'utf8')) as { port: number; mode: string };
/** What a device with no cookie gets from the project's server. */
const from = async (playwright: { request: { newContext: () => Promise<import('@playwright/test').APIRequestContext> } }, run: (client: import('@playwright/test').APIRequestContext, origin: string) => Promise<number>): Promise<number> => {
  const client = await playwright.request.newContext();
  try {
    return await run(client, `http://127.0.0.1:${String(mark().port)}`);
  } finally {
    await client.dispose();
  }
};

// eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(300_000);
  project = await ProjectHarness.create({}, ['react', 'react-dom']);
  ({ app, userDataDir } = await launchDesktop({ env: { ADMINIUM_DESKTOP_E2E_PROJECT: project.root, ADMINIUM_DESKTOP_E2E_PORT: String(FIRST_PORT), ADMINIUM_DISABLE_UPDATES: '1' } }));
  page = await app.firstWindow();
});

test.afterAll(async () => {
  if (app !== undefined) await closeDesktop(app, userDataDir);
  await project?.close();
});

test('Share first asks how the owner signs in from other devices, and only then shares', async ({ playwright }) => {
  test.setTimeout(240_000);
  await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible({ timeout: 180_000 });
  expect(mark().mode).toBe('design');
  await page.getByRole('radio', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Choose how you sign in from other devices');
  await expect(dialog).toContainText('Share · 1 of 2');
  await dialog.getByLabel(/Your email/).fill(OWNER.email);
  await dialog.getByLabel(/^Password/).fill(OWNER.password);
  await dialog.getByLabel(/The same password again/).fill(OWNER.password);
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog).toContainText('Before you share');
  await expect(dialog).toContainText('Share · 2 of 2');
  // Nothing was put on the network by setting a password.
  expect(mark().mode).toBe('design');

  await dialog.getByRole('button', { name: 'Share now' }).click();
  await expect(page.getByRole('heading', { name: 'Demo is shared' })).toBeVisible({ timeout: 120_000 });
  // The app's own page, from the disk: the project's Designer is off.
  expect(new URL(page.url()).protocol).toBe('file:');
  sharedPort = mark().port;
  expect(mark().mode).toBe('start');
  expect(entry()).toMatchObject({ state: 'shared', sharePort: sharedPort });

  // Another device: the Designer is not there, and the owner signs in with what was just chosen.
  expect(await from(playwright, async (client, origin) => (await client.get(`${origin}/api/v1/designer/state`)).status())).not.toBe(200);
  expect(await from(playwright, async (client, origin) => (await client.post(`${origin}/api/v1/auth/login`, { headers: { origin }, data: { email: OWNER.email, password: 'wrong password entirely' } })).status())).toBe(401);
  expect(await from(playwright, async (client, origin) => (await client.post(`${origin}/api/v1/auth/login`, { headers: { origin }, data: OWNER })).status())).toBe(200);
});

test('the sharing details show an address or say there is no network, and open the project’s dashboard', async () => {
  test.setTimeout(120_000);
  // On a machine with a network: the addresses and the code. On one without (some CI): the sentence that says so.
  await expect(page.getByText('Open this on another device').or(page.getByText(/This computer is not on a network/))).toBeVisible();
  await expect(page.getByText(/Traffic on your local network is not encrypted/)).toBeVisible();

  await page.getByRole('button', { name: 'Open the dashboard' }).click();
  await page.waitForURL(new RegExp(`^http://127\\.0\\.0\\.1:${String(sharedPort)}/`), { timeout: 60_000 });
  // The owner has a password now: on this computer too, the dashboard asks for it.
  await page.getByLabel(/email/i).first().fill(OWNER.email);
  await page.getByLabel(/password/i).first().fill(OWNER.password);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'This project is shared on your network.' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Sharing details' }).click();
  await expect(page.getByRole('heading', { name: 'Demo is shared' })).toBeVisible({ timeout: 60_000 });
});

test('"Go back to building" asks first, then it is this computer only again with the Designer on', async ({ playwright }) => {
  test.setTimeout(240_000);
  await page.getByRole('button', { name: 'Go back to building' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('People using it on other devices will be disconnected.');
  await dialog.getByRole('button', { name: 'Keep sharing' }).click();
  await expect(dialog).toBeHidden();
  expect(mark().mode).toBe('start');

  await page.getByRole('button', { name: 'Go back to building' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Go back to building' }).click();
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120_000 });
  await expect.poll(() => mark().mode, { timeout: 60_000 }).toBe('design');
  expect(entry()).toMatchObject({ state: 'building', sharePort: sharedPort });
  expect(await from(playwright, async (client, origin) => (await client.get(`${origin}/api/v1/healthz`)).status())).toBe(200);
});

test('shared a second time: no password is asked again, and the port is the one it had', async () => {
  test.setTimeout(240_000);
  const share = page.getByRole('radio', { name: 'Share' });
  await expect(share).toBeVisible({ timeout: 60_000 });
  await share.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Share · 1 of 1');
  await dialog.getByRole('button', { name: 'Share now' }).click();
  await expect(page.getByRole('heading', { name: 'Demo is shared' })).toBeVisible({ timeout: 120_000 });
  expect(mark().port).toBe(sharedPort);
});
