// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page's pictures, end to end: picture spots filled from the picture dialog, with no turn.
 *
 * `adminium app new --customer` in a project folder; its customer screen draws two spots, Hero and
 * Team, both empty (wireframes). `adminium design` runs as `scripts/picture-design.mjs` starts it,
 * with Openverse answered by a fake in the server's own process (the safe fetch's seams; no flag or
 * variable points a server anywhere but the real sources).
 *
 *  1. The Hero wireframe's own "Choose a picture" opens the dialog on Hero, searched with its words;
 *     a picture's details say its licence; Apply writes it with its credit and saves a version, and
 *     the preview draws it.
 *  2. Pointing at the Team wireframe asks what was meant; "Change the picture…" opens the dialog on
 *     Team; a picture uploaded from the computer is applied, with "ask me to choose" after each design.
 *  3. The next turn changes the screen and leaves both pictures alone: no card, no note. Then the
 *     same again with "leave placeholders".
 *
 * The model speaks Ollama's protocol from this process. It proves the wiring, never that a real model
 * keeps a person's pictures: that is the server suite's (`designer-picture-dialog.test.ts`).
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
const APP_KEY = 'crispy';
/** A session nobody started from Home: `ds_` and 24 characters. */
const SESSION = `ds_${'e2epictures'.padEnd(24, '0')}`;
/** A 4×3 PNG, as a person's own picture. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGM4UWEDRww4OQBiHhHR6R4GfQAAAABJRU5ErkJggg==', 'base64');
const SPOTS = {
  hero: { label: 'Hero', shape: 'wide', shows: 'the shop’s best dish', search: 'fried chicken', file: null, alt: '', decorative: false },
  team: { label: 'Team', shape: 'wide', shows: 'the people who cook', search: 'kitchen team', file: null, alt: '', decorative: false },
};

let project: ProjectHarness;
let model: Server;

test.describe.configure({ mode: 'serial' });
test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1600, height: 900 } });

const spots = (): Record<string, { file: string | null; alt: string }> => JSON.parse(readFileSync(join(project.root, 'apps', APP_KEY, 'assets', 'pictures', 'spots.json'), 'utf8')) as Record<string, { file: string | null; alt: string }>;

// eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(240_000);
  project = await ProjectHarness.create({}, ['react', 'react-dom', '@adminiumjs/public-client']);
  const made = project.cli(['app', 'new', APP_KEY, '--customer', '--no-install']);
  expect(made.status, `${made.stdout}${made.stderr}`).toBe(0);
  // The screen draws the two spots under its header, as the Designer writes them.
  const screenFile = join('apps', APP_KEY, 'customer', 'src', 'App.tsx');
  const starter = readFileSync(join(project.root, screenFile), 'utf8');
  const withSpots = starter
    .replace("import { APP_NAME, Link, en,", "import { APP_NAME, Link, Picture, en,")
    .replace('</header>', '</header>\n      <Picture spot="hero" className="hero-picture" />\n      <Picture spot="team" className="team-picture" />');
  expect(withSpots).toContain('<Picture spot="team"');
  project.write(screenFile, withSpots);
  project.write(`apps/${APP_KEY}/assets/pictures/spots.json`, `${JSON.stringify(SPOTS, null, 2)}\n`);
  // The next turn writes the screen again with a line more, and keeps both spots on it.
  model = createDesignerModelServer({
    appKey: APP_KEY,
    files: { 'customer/src/App.tsx': withSpots.replace('<Picture spot="team" className="team-picture" />', '<Picture spot="team" className="team-picture" />\n      <p className="muted">Fresh every day.</p>') },
    reply: 'The welcome line is under the pictures.',
  });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  // The session as the Designer keeps one, written by hand, on the model above.
  const now = Date.now();
  project.write(
    `.adminium/designer/sessions/${SESSION}/session.json`,
    `${JSON.stringify({ id: SESSION, appKey: APP_KEY, title: 'Crispy Bites', target: 'auto', connectionId: 'env:ollama', model: 'fake', createdAt: now, updatedAt: now, turns: 0, version: null, createdApp: false, tokens: { in: 0, out: 0 } }, null, 2)}\n`,
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

/** A turn sent from the box, and its reply waited for. */
async function turn(page: Page, message: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Message to Adminium Designer' }).fill(message);
  await page.keyboard.press('Enter');
  const reply = page.getByText('The welcome line is under the pictures.');
  // The style asks for its font once: left out, nothing is fetched (its answer is kept with the look).
  const addNothing = page.getByRole('button', { name: 'Send — add nothing' });
  const deselect = page.getByRole('group', { name: 'The design needs a few things. Add them?' }).getByRole('button', { name: 'Deselect all' });
  await expect(reply.or(deselect).first()).toBeVisible({ timeout: 120_000 });
  if (await deselect.isVisible()) {
    await deselect.click();
    await addNothing.click();
  }
  await expect(reply.last()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 60_000 });
}

test('spots are filled from search and from an upload, and the next turn leaves them alone in either mode', async ({ page }) => {
  test.setTimeout(360_000);
  const link = await project.designWithFakePictures({ ADMINIUM_AI_OLLAMA_BASE_URL: `http://localhost:${String((model.address() as AddressInfo).port)}`, ADMINIUM_AI_MODEL: 'ollama/fake' });
  await expect.poll(() => project.output(), { timeout: 60_000 }).toContain(`App "${APP_KEY}" installed from apps/${APP_KEY}.`);
  await page.goto(link);
  await expect.poll(() => new URL(page.url()).hash, { timeout: 30_000 }).toBe('');
  await page.goto(`${PROJECT_URL}/design/${SESSION}`);

  // The customer side: two wireframes, each with its own way to the dialog.
  await expect(page.getByRole('radiogroup', { name: 'Side' }).getByRole('radio', { name: 'Customer' })).toBeChecked({ timeout: 60_000 });
  const customer = page.frameLocator('iframe[title="Customer"]');
  const heroFrame = customer.getByRole('button', { name: /Hero · wide/ });
  await expect(heroFrame).toBeVisible({ timeout: 60_000 });

  // 1. Hero, from a search with its own words.
  await heroFrame.click();
  const dialog = page.getByRole('dialog', { name: 'Pictures' });
  await expect(dialog).toBeVisible();
  const grid = dialog.getByRole('listbox', { name: 'Pictures for Hero' });
  await expect(grid.getByRole('option')).toHaveCount(6, { timeout: 30_000 });
  await expect(dialog.getByRole('searchbox', { name: 'Search words' })).toHaveValue('fried chicken');
  await noBlocking(page, 'the picture dialog');
  await grid.getByRole('option').first().press('Enter');
  const details = dialog.getByRole('region', { name: 'fried chicken 1' });
  await expect(details.getByText('Credit needed')).toBeVisible();
  await details.getByRole('button', { name: 'Use for Hero' }).click();
  const changes = dialog.getByRole('region', { name: 'What changes' });
  await expect(changes.getByRole('textbox', { name: 'Describe the picture for people who cannot see it' })).toHaveValue('fried chicken 1');
  await changes.getByRole('textbox', { name: 'Describe the picture for people who cannot see it' }).fill('Fried chicken on a board');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expect(page.getByText(/^Pictures saved as v\d+\.$/)).toBeVisible({ timeout: 60_000 });
  expect(spots()['hero']).toMatchObject({ alt: 'Fried chicken on a board' });
  expect(spots()['hero']?.file).toMatch(/^[\w-]+\.png$/);
  expect(readFileSync(join(project.root, 'apps', APP_KEY, 'assets', 'pictures', 'CREDITS.json'), 'utf8')).toContain('Maker 1');
  await expect(customer.getByRole('img', { name: 'Fried chicken on a board' })).toBeVisible({ timeout: 60_000 });

  // 2. Team, pointed at: what was meant is asked; a picture from the computer goes in, and pictures are asked for after each design.
  await page.getByRole('button', { name: 'Pick an element on the page' }).click();
  await customer.getByRole('button', { name: /Team · wide/ }).click();
  const menu = page.getByRole('menu', { name: 'Team' });
  await expect(menu.getByRole('menuitem', { name: 'Change the picture…' })).toBeFocused();
  await menu.getByRole('menuitem', { name: 'Change the picture…' }).click();
  await expect(dialog.getByRole('listbox', { name: 'Pictures for Team' })).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('tab', { name: 'Upload' }).click();
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'our-team.png', mimeType: 'image/png', buffer: PNG });
  const own = dialog.getByRole('region', { name: 'our-team.png' });
  await expect(own.getByText('Your picture')).toBeVisible({ timeout: 30_000 });
  await own.getByRole('button', { name: 'Use for Team' }).click();
  await dialog.getByRole('radio', { name: 'ask me to choose' }).click();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expect.poll(() => spots()['team']?.file ?? null, { timeout: 30_000 }).toMatch(/^[\w-]+\.png$/);
  const filled = spots();
  expect(JSON.parse(readFileSync(join(project.root, 'apps', APP_KEY, 'look.json'), 'utf8'))).toMatchObject({ pictures: 'choose' });

  // 3. The next turn changes the screen and leaves both pictures as they are: no card, no note.
  await turn(page, 'Add a welcome line under the pictures.');
  await expect(customer.getByText('Fresh every day.')).toBeVisible({ timeout: 60_000 });
  expect(spots()).toEqual(filled);
  await expect(page.getByRole('group', { name: 'Choose the pictures' })).toHaveCount(0);
  await expect(page.locator('[data-part="pictures-note"]')).toHaveCount(0);
  await expect(page.getByText(/took your picture/)).toHaveCount(0);

  // Then placeholders after each design, from the chip under the reply, and the same turn again.
  const chip = page.locator('[data-part="pictures-chip"]');
  await expect(chip).toHaveText('Pictures');
  await chip.click();
  await dialog.getByRole('radio', { name: 'leave placeholders' }).click();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expect.poll(() => (JSON.parse(readFileSync(join(project.root, 'apps', APP_KEY, 'look.json'), 'utf8')) as { pictures?: string }).pictures, { timeout: 30_000 }).toBe('placeholders');
  await turn(page, 'Add the welcome line again.');
  expect(spots()).toEqual(filled);
  await expect(page.getByRole('group', { name: 'Choose the pictures' })).toHaveCount(0);
  await expect(page.locator('[data-part="pictures-note"]')).toHaveCount(0);
});
