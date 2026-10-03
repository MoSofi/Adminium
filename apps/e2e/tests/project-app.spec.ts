// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app in a project folder, run from the folder, end to end: `adminium new`
 * → `adminium app new` → `adminium dev` → the app's pages and its own screen
 * in a browser → a table part edited → the screen's code edited → a column
 * narrowed and the question answered in Studio. One `dev` process throughout:
 * nothing here may restart the server.
 *
 * The rules underneath (the build, apply in place, removal, the supervisor)
 * have their own tests on three database engines; this file proves they are
 * wired to what a person sees with the real CLI and a real browser.
 */
import { expect, test } from '@playwright/test';

import { gridRows } from './helpers.js';
import { ProjectHarness, projectStatePath, PROJECT_OWNER, PROJECT_URL } from './projectHarness.js';

const anonymous = { cookies: [], origins: [] };

let project: ProjectHarness;

test.describe.configure({ mode: 'serial' });
test.use({ baseURL: PROJECT_URL, storageState: projectStatePath() });

test.beforeAll(async ({ playwright }, testInfo) => {
  testInfo.setTimeout(240_000);
  project = await ProjectHarness.create({}, ['react', 'react-dom']);
  // The starter, with a staff screen of its own. Its packages are linked in above.
  const made = project.cli(['app', 'new', 'repairs', '--staff', '--no-install']);
  expect(made.status, `${made.stdout}${made.stderr}`).toBe(0);
  await project.dev();

  const request = await playwright.request.newContext({ baseURL: PROJECT_URL, storageState: anonymous });
  const owner = await request.post('/api/v1/setup/super-admin', { data: PROJECT_OWNER });
  expect(owner.status(), await owner.text()).toBe(201);
  await request.storageState({ path: projectStatePath() });
  await request.dispose();
});

test.afterAll(async () => {
  await project?.close();
});

// eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('project server output', { body: project.output(), contentType: 'text/plain' });
  }
});

test('dev installs the app from its folder: its page is in the dashboard and its screen is served', async ({ page }) => {
  await expect.poll(() => project.output()).toContain('App "repairs" installed from apps/repairs.');
  await expect.poll(() => project.output()).toContain('App "repairs": its sample data was added.');

  // A page the manifest declares, over the table the install made, with the sample rows.
  await page.goto('/p/repairs-items');
  await expect(gridRows(page).filter({ hasText: 'Welcome to your app' })).toBeVisible();

  // The app's own screen, built by dev and served from the build folder.
  await page.goto('/apps/repairs/staff/');
  await expect(page.getByText('Welcome to your app')).toBeVisible();
  await expect(page.getByLabel('New item')).toBeVisible();

  // Studio says where it comes from, and offers nothing the folder decides.
  await page.goto('/studio/apps');
  await expect(page.getByText('From the folder')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Uninstall' })).toHaveCount(0);
});

test('a table part edited in the folder changes the open page, with no restart', async ({ page }) => {
  await page.goto('/p/repairs-items');
  await expect(gridRows(page).filter({ hasText: 'Welcome to your app' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Colour' })).toHaveCount(0);

  project.editJson('apps/repairs/manifest/tables/items.json', (table) => {
    (table['columns'] as unknown[]).push({ ref: 'colour', type: 'text', maxLength: 40, nullable: true, label: { 'en-US': 'Colour' } });
  });

  // The page was not reloaded by the test: the server told the dashboard, and the column is there.
  await expect(page.getByRole('columnheader', { name: 'Colour' })).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => project.output()).toContain('App "repairs" applied from apps/repairs.');
  expect(project.boots()).toBe(1);
});

test('an edited screen reloads the open side, with no restart', async ({ page }) => {
  await page.goto('/apps/repairs/staff/');
  await expect(page.getByLabel('New item')).toBeVisible();
  // Gone the moment the page reloads.
  await page.evaluate(() => {
    (window as unknown as { leftByTheTest?: boolean }).leftByTheTest = true;
  });

  project.write('apps/repairs/staff/src/App.tsx', project.read('apps/repairs/staff/src/App.tsx').replace('New item', 'What needs fixing?'));

  await expect(page.getByLabel('What needs fixing?')).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() => (window as unknown as { leftByTheTest?: boolean }).leftByTheTest)).toBeUndefined();
  // Only the screen changed: nothing was applied again, and nothing restarted.
  expect((project.output().match(/applied from apps\/repairs/g) ?? []).length).toBe(1);
  expect(project.boots()).toBe(1);
});

test('a column that now holds less is counted, and the question is answered in Studio', async ({ page }) => {
  project.editJson('apps/repairs/manifest/tables/items.json', (table) => {
    const title = (table['columns'] as { ref: string; maxLength?: number }[]).find((column) => column.ref === 'title');
    if (title !== undefined) title.maxLength = 12;
  });
  await expect.poll(() => project.output(), { timeout: 60_000 }).toContain('no longer declares');

  await page.goto('/studio/apps');
  await expect(page.getByText('apps/repairs/ no longer declares these, and they hold data. Nothing was removed.')).toBeVisible();
  await expect(page.getByText(/repairs_items\.title holds less than it did: \d+ rows? do(es)? not fit/)).toBeVisible();

  await page.getByRole('button', { name: 'Keep the data' }).click();
  await expect(page.getByRole('button', { name: 'Keep the data' })).toHaveCount(0);
  // The rows are as they were.
  await page.goto('/p/repairs-items');
  await expect(gridRows(page).filter({ hasText: 'Edit manifest/tables/items.json to change this table' })).toBeVisible();
  expect(project.boots()).toBe(1);
});
