// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A picture made with AI, end to end.
 *
 * `adminium app new --customer` in a project folder; its customer screen draws one spot, Hero, empty.
 * `adminium design` runs on a fake model that speaks Ollama's protocol from this process, and also
 * answers Ollama's picture route (`/v1/models`, `/v1/images/generations`) with small real PNGs: the
 * server's real picture code is called over real HTTP, as it would call a local Ollama.
 *
 *  1. The dialog's "Make one" tab says no service is chosen; the owner (who may set up AI) chooses
 *     Ollama and its picture model.
 *  2. The tab names the service and model, fills the words in from the spot, and says it costs nothing
 *     (made on this computer); Make makes two pictures; a picture's details say the words it was made
 *     from; "Use for Hero" and Apply write it, credited "Made with AI".
 *
 * It proves the wiring, never what a real service makes: that is the owner's live smoke run
 * (`packages/llm/src/pictures/pictures.live.smoke.test.ts`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { createDesignerModelServer } from '../scripts/fake-llm.mjs';
import { ProjectHarness, PROJECT_URL } from './projectHarness.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);
const APP_KEY = 'crumb';
const SESSION = `ds_${'e2emade'.padEnd(24, '0')}`;
const SPOTS = { hero: { label: 'Hero', shape: 'wide', shows: 'the bakery’s best cake', search: 'lemon drizzle cake', file: null, alt: '', decorative: false } };
/** Where the run's pictures of the tab are kept, for the owner to look at. */
const SHOTS = process.env['E2E_SHOTS'];

let project: ProjectHarness;
let model: Server;

test.describe.configure({ mode: 'serial' });
test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1600, height: 900 } });

// eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(240_000);
  project = await ProjectHarness.create({}, ['react', 'react-dom', '@adminiumjs/public-client']);
  const made = project.cli(['app', 'new', APP_KEY, '--customer', '--no-install']);
  expect(made.status, `${made.stdout}${made.stderr}`).toBe(0);
  const screenFile = join('apps', APP_KEY, 'customer', 'src', 'App.tsx');
  const starter = readFileSync(join(project.root, screenFile), 'utf8');
  const withSpot = starter.replace('import { APP_NAME, Link, en,', 'import { APP_NAME, Link, Picture, en,').replace('</header>', '</header>\n      <Picture spot="hero" className="hero-picture" />');
  expect(withSpot).toContain('<Picture spot="hero"');
  project.write(screenFile, withSpot);
  project.write(`apps/${APP_KEY}/assets/pictures/spots.json`, `${JSON.stringify(SPOTS, null, 2)}\n`);
  model = createDesignerModelServer({ appKey: APP_KEY, files: {}, reply: 'Done.' });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  const now = Date.now();
  project.write(
    `.adminium/designer/sessions/${SESSION}/session.json`,
    `${JSON.stringify({ id: SESSION, appKey: APP_KEY, title: 'Crumb & Co.', target: 'auto', connectionId: 'env:ollama', model: 'fake', createdAt: now, updatedAt: now, turns: 0, version: null, createdApp: false, tokens: { in: 0, out: 0 } }, null, 2)}\n`,
  );
  project.write(`.adminium/designer/sessions/${SESSION}/events.jsonl`, '');
});

test.afterAll(async () => {
  await project?.close();
  await new Promise<void>((resolve) => (model === undefined ? resolve() : model.close(() => resolve())));
});

// eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) await testInfo.attach('design server output', { body: project.output(), contentType: 'text/plain' });
});

async function noBlocking(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).exclude('iframe').analyze();
  const blocking = results.violations.filter((violation) => BLOCKING.has(violation.impact ?? ''));
  expect(blocking, `${label}: ${blocking.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('; ')}`).toEqual([]);
}

test('a picture is made with AI for a spot, chosen, applied and credited as made', async ({ page }) => {
  test.setTimeout(300_000);
  const link = await project.designWithFakePictures({ ADMINIUM_AI_OLLAMA_BASE_URL: `http://localhost:${String((model.address() as AddressInfo).port)}`, ADMINIUM_AI_MODEL: 'ollama/fake' });
  await expect.poll(() => project.output(), { timeout: 60_000 }).toContain(`App "${APP_KEY}" installed from apps/${APP_KEY}.`);
  await page.goto(link);
  await expect.poll(() => new URL(page.url()).hash, { timeout: 30_000 }).toBe('');
  await page.goto(`${PROJECT_URL}/design/${SESSION}`);

  const customer = page.frameLocator('iframe[title="Customer"]');
  const heroFrame = customer.getByRole('button', { name: /Hero · wide/ });
  await expect(heroFrame).toBeVisible({ timeout: 60_000 });
  await heroFrame.click();
  const dialog = page.getByRole('dialog', { name: 'Pictures' });
  await expect(dialog).toBeVisible();

  // 1. No service yet: the owner chooses Ollama's picture model.
  await dialog.getByRole('tab', { name: 'Make one' }).click();
  await expect(dialog.getByText('Choose a picture service to make pictures here.')).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Choose a service' }).click();
  await expect(dialog.getByRole('radio', { name: /Ollama/ })).toBeChecked();
  await dialog.getByLabel('Model').selectOption('x/flux2-klein');
  await dialog.getByRole('button', { name: 'Save' }).click();

  // 2. The service, the words from the spot, what it costs; Make.
  await expect(dialog.getByText('Ollama · x/flux2-klein')).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole('textbox', { name: 'What the picture shows' })).toHaveValue(/^lemon drizzle cake, /);
  await expect(dialog.locator('[data-part="make-cost"]')).toHaveText('Made on this computer. It costs nothing. You can make 20 more today.');
  await noBlocking(page, 'the Make one tab');
  if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, 'make-one-tab.png') });
  await dialog.getByRole('button', { name: 'Make', exact: true }).click();
  const grid = dialog.getByRole('listbox', { name: 'Pictures made for Hero' });
  await expect(grid.getByRole('option')).toHaveCount(2, { timeout: 60_000 });
  await grid.getByRole('option').first().press('Enter');
  const details = dialog.getByRole('region', { name: 'Hero' });
  await expect(details.getByText('Made from these words')).toBeVisible();
  await noBlocking(page, 'a made picture’s details');
  if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, 'made-picture-details.png') });
  await details.getByRole('button', { name: 'Use for Hero' }).click();
  const changes = dialog.getByRole('region', { name: 'What changes' });
  await expect(changes.getByText('Made with AI')).toBeVisible();
  await expect(changes.getByRole('textbox', { name: 'Describe the picture for people who cannot see it' })).toHaveValue('lemon drizzle cake');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });

  const spots = JSON.parse(readFileSync(join(project.root, 'apps', APP_KEY, 'assets', 'pictures', 'spots.json'), 'utf8')) as Record<string, { file: string | null }>;
  expect(spots['hero']?.file).toMatch(/^[\w-]+\.png$/);
  const credits = JSON.parse(readFileSync(join(project.root, 'apps', APP_KEY, 'assets', 'pictures', 'CREDITS.json'), 'utf8')) as { licenceCode?: string; licence: string; creator: string; words?: string }[];
  expect(credits.find((line) => line.licenceCode === 'made')).toMatchObject({ licence: 'Made with AI', creator: 'Ollama · x/flux2-klein' });
  await expect(customer.getByRole('img', { name: 'lemon drizzle cake' })).toBeVisible({ timeout: 60_000 });
  if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, 'made-picture-applied.png') });
});
