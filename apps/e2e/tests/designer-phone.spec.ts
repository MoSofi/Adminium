// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's phone side in the Designer, end to end.
 *
 * `adminium app new --mobile --no-install` in a project folder, then
 * `adminium design`. The phone side is approved (asking for one on a terminal
 * is the yes) and its packages are not there: the Phone side of the preview
 * says so, with the button that gets them. Then the packages "arrive" (a
 * stand-in for Expo is put where its command line would be: a test cannot
 * install 350 MB from npm), the button is pressed, and the preview shows the
 * phone app in its frame, reading the app's rows through the public API with
 * the customer's key. It is served on the preview's name only, never on the
 * Designer's own. "Open on a phone" shows what the door does and this
 * computer's addresses; the door itself is proved in the server's tests,
 * since opening it here would listen on the network.
 *
 * No turn runs, and no model is asked for anything.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { ProjectHarness, PROJECT_URL } from './projectHarness.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);
const APP_KEY = 'orders';
const SESSION = `ds_${'e2ephone'.padEnd(24, '0')}`;
const MOBILE = `apps/${APP_KEY}/mobile`;

/**
 * Expo's command line, stood in for: `export --output-dir <dir>` writes a page
 * that does what the starter does (reads the customer's config beside it, and
 * lists the app's rows through the public API), and nothing else is answered.
 */
const STUB_EXPO = `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
if (args[0] !== 'export') { console.error('stub expo: only export is stood in for'); process.exit(1); }
const out = args[args.indexOf('--output-dir') + 1];
mkdirSync(join(out, '_expo'), { recursive: true });
writeFileSync(join(out, '_expo', 'app.js'), [
  "const base = '/apps/${APP_KEY}/mobile/';",
  "const root = document.getElementById('root');",
  "fetch(base + 'surface-config.json', { cache: 'no-store' }).then((r) => r.json()).then(async (config) => {",
  "  const list = await fetch('/api/v1/public/records/' + config.tables.items + '?limit=50', { headers: { authorization: 'Bearer ' + config.publishableKey } }).then((r) => r.json());",
  "  if (!Array.isArray(list.data)) throw new Error(JSON.stringify(list) + ' for ' + JSON.stringify(config.tables));",
  "  const heading = document.createElement('h1'); heading.textContent = 'What can we do for you?'; root.append(heading);",
  "  for (const row of list.data) { const p = document.createElement('p'); p.textContent = row.title; root.append(p); }",
  "}).catch((error) => { root.textContent = 'failed: ' + String(error); });",
].join('\\n'));
writeFileSync(join(out, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Orders</title></head><body><div id="root"></div><script src="/apps/${APP_KEY}/mobile/_expo/app.js" defer></script></body></html>');
console.log('Exported: ' + out);
`;

let project: ProjectHarness;

test.describe.configure({ mode: 'serial' });
test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1600, height: 900 } });

// eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(240_000);
  project = await ProjectHarness.create({}, []);
  const made = project.cli(['app', 'new', APP_KEY, '--mobile', '--no-install']);
  expect(made.status, `${made.stdout}${made.stderr}`).toBe(0);
  // The project's own package list gained nothing: a phone side has its own.
  expect(made.stdout).not.toContain('Added to package.json');
  const now = Date.now();
  project.write(
    `.adminium/designer/sessions/${SESSION}/session.json`,
    `${JSON.stringify({ id: SESSION, appKey: APP_KEY, title: 'Orders', target: 'mobile', connectionId: 'none', model: 'none', createdAt: now, updatedAt: now, turns: 0, version: null, createdApp: false, tokens: { in: 0, out: 0 } }, null, 2)}\n`,
  );
  project.write(`.adminium/designer/sessions/${SESSION}/events.jsonl`, '');
});

test.afterAll(async () => {
  await project?.close();
});

// eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('design server output', { body: project.output(), contentType: 'text/plain' });
  }
});

test('the Phone side says what is missing, then shows the phone app once it is built, on the preview’s name only', async ({ page, request }, testInfo) => {
  testInfo.setTimeout(240_000);
  // As a project being designed has it: the public API answers this server's own pages (the harness names another origin for its own specs).
  const link = await project.design({ ADMINIUM_PUBLIC_API_ORIGINS: 'self' });
  await expect.poll(() => project.output(), { timeout: 60_000 }).toContain(`App "${APP_KEY}" installed from apps/${APP_KEY}.`);
  await page.goto(link);
  await expect.poll(() => new URL(page.url()).hash, { timeout: 30_000 }).toBe('');
  await page.goto(`${PROJECT_URL}/design/${SESSION}`);

  // The app has a dashboard and a phone app, and the phone app is what a session that asked for one opens on.
  const sides = page.getByRole('radiogroup', { name: 'Side' });
  await expect(sides.getByRole('radio', { name: 'Phone app' })).toBeChecked({ timeout: 60_000 });
  await expect(sides.getByRole('radio')).toHaveText(['Dashboard', 'Phone app']);
  await expect(page.getByLabel('Seen as: visitor. A visitor, not signed in.')).toBeVisible();
  // A phone app is one size and has no addresses.
  await expect(page.getByRole('radiogroup', { name: 'Size' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: /^Address on/ })).toHaveCount(0);

  // Approved on the terminal, and its packages were left out: said, with the way to get them.
  await expect(page.getByText('The phone app’s packages are not installed.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Get its packages' })).toBeEnabled();
  // Nothing of it is served meanwhile.
  expect((await request.get(`${PROJECT_URL.replace('127.0.0.1', 'localhost')}/apps/${APP_KEY}/mobile/`)).status()).toBe(404);

  // The packages arrive: Expo's command line (a stand-in), and the mark an install leaves, as the engine writes it.
  const dir = join(project.root, MOBILE);
  project.write(`${MOBILE}/node_modules/expo/bin/cli`, STUB_EXPO);
  project.write(`${MOBILE}/node_modules/expo/package.json`, `${JSON.stringify({ name: 'expo', version: '57.0.0' })}\n`);
  const hash = (file: string): string => (existsSync(join(dir, file)) ? createHash('sha256').update(readFileSync(join(dir, file))).digest('hex') : '-');
  project.write(`${MOBILE}/node_modules/.adminium/installed`, `${hash('package.json')}\n${hash('package-lock.json')}`);
  // The button on the Phone side is a person's yes outside a turn: with the packages there it has nothing to install, and builds.
  await page.getByRole('button', { name: 'Get its packages' }).click();

  // Built: the phone app in its frame, with the app's sample rows read through the public API.
  const phone = page.frameLocator('iframe[title="Phone app"]');
  await expect(phone.getByRole('heading', { name: 'What can we do for you?' })).toBeVisible({ timeout: 90_000 });
  await expect(phone.getByText('Welcome to your app')).toBeVisible();
  await expect(page.getByText('Drawn by the browser: close to the phone, not the phone. The Designer does not look at this side.')).toBeVisible();

  // Served on the preview's own name, and refused on the Designer's, where the owner's session is.
  const onPreview = await request.get(`${PROJECT_URL.replace('127.0.0.1', 'localhost')}/apps/${APP_KEY}/mobile/`);
  expect(onPreview.status()).toBe(200);
  expect(await onPreview.text()).toContain('<div id="root">');
  expect((await request.get(`${PROJECT_URL}/apps/${APP_KEY}/mobile/`)).status()).toBe(403);
  // The build's own mark and Expo's folder are no page's to read.
  expect((await request.get(`${PROJECT_URL.replace('127.0.0.1', 'localhost')}/apps/${APP_KEY}/mobile/adminium-phone.json`)).status()).toBe(404);

  // "Open on a phone": what it does, said before anything listens. Nothing is opened here.
  await page.getByRole('button', { name: 'Open on a phone' }).click();
  const dialog = page.getByRole('dialog', { name: 'Open on a phone' });
  await expect(dialog.getByText('Nothing is sent anywhere else.', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Show the code' })).toBeVisible();
  const swept = await new AxeBuilder({ page }).withTags(TAGS).exclude('iframe').analyze();
  expect(swept.violations.filter((violation) => BLOCKING.has(violation.impact ?? '')).map((violation) => `${String(violation.impact)}: ${violation.id}`)).toEqual([]);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);

  // The app got its phone key beside the customer key when it was applied: the API keys page lists both.
  await page.goto(`${PROJECT_URL}/studio/public-api`);
  await expect(page.getByText('PHONE APP', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Orders · phone app', { exact: true })).toBeVisible();
});
