// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A COMPANY'S PAGE, AS DRAWN, against a real server (`companyRecordWorld.ts`):
 *
 * - the company's record page shows "Fill in details" beside Edit; it opens
 *   a side sheet holding the add-on's code; Look up asks the register (the
 *   contract's demo); Fill in all writes the fields through the engine and
 *   closes the sheet; the record shows the filled values, each with "From
 *   Companies House · {date}" under it;
 * - an edit of one field hides its note, and only its;
 * - axe finds nothing at WCAG 2.1 AA on the page with its notes and with the
 *   sheet open, light and dark; in Arabic the page runs right to left; on a
 *   phone the sheet is the screen's full width and its buttons 44 px.
 *
 * Run alone, on its own port, after `pnpm build`:
 * `E2E_PORT=4920 pnpm --filter @adminium/e2e e2e:company-record`.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { startCompanyWorld, type CompanyWorld } from './companyRecordWorld.js';

/** WCAG 2.1 A/AA — the same rule set the Storybook sweep runs. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

let world: CompanyWorld;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  world = await startCompanyWorld();
});

test.afterAll(async () => {
  await world?.close();
});

async function signedIn(context: BrowserContext): Promise<void> {
  const [name, value] = world.cookie.split('=');
  await context.addCookies([{ name: name!, value: value!, domain: '127.0.0.1', path: '/' }]);
}

async function axe(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations.map((one) => `${one.id}: ${one.nodes.map((node) => node.target.join(' ')).join(', ')}`), label).toEqual([]);
}

const fields = (page: Page) => page.locator('[data-part="record-fields"]');
const noteUnder = (page: Page, column: string) => fields(page).locator(`[data-column="${column}"] [data-part="field-note"]`);
const today = () => new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short' }).format(new Date());

test('open a company, open the sheet, fill from the register, and see where each field came from', async ({ page, context }) => {
  await signedIn(context);
  await page.goto(world.recordUrl);
  const fill = page.getByRole('button', { name: 'Fill in details' });
  await expect(fill).toBeVisible();
  // Beside Edit, just before it.
  const hero = page.locator('[data-part="page-record"] button');
  const names = await hero.allTextContents();
  expect(names.indexOf('Edit') - names.indexOf('Fill in details')).toBe(1);

  await fill.click();
  const sheet = page.getByRole('dialog', { name: 'Fill in details' });
  await expect(sheet).toBeVisible();
  // The fill's own line under the host's header names the company.
  await expect(sheet).toContainText('Ouseburn Studio. Nothing changes until you press Fill in.');
  await axe(page, 'the sheet open, light');
  await sheet.getByRole('button', { name: 'Look up' }).click();
  await expect(sheet.getByText(/details found/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Fill in all' }).click();
  await expect(sheet).toBeHidden();
  // Focus is back on the button that opened it.
  await expect(fill).toBeFocused();

  // Written by the engine as the owner, and drawn with where each value came from.
  expect(world.company()).toMatchObject({ company_number: '98002264' });
  await expect(fields(page).locator('[data-column="company_number"]')).toContainText('98002264');
  await expect(noteUnder(page, 'company_number')).toHaveText(`From Companies House·${today()}`);
  await expect(noteUnder(page, 'address_lines')).toBeVisible();
  // A field the register gave nothing for has no note.
  await expect(noteUnder(page, 'about')).toHaveCount(0);
  await axe(page, 'the notes, light');
});

test('an edit of one field hides its note, and the others stay', async ({ page, context }) => {
  await signedIn(context);
  await page.goto(world.recordUrl);
  await expect(noteUnder(page, 'company_number')).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Company number').fill('98007777');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(fields(page).locator('[data-column="company_number"]')).toContainText('98007777');
  await expect(noteUnder(page, 'company_number')).toHaveCount(0);
  await expect(noteUnder(page, 'address_lines')).toBeVisible();
});

test('dark: axe finds nothing on the page with its notes, nor with the sheet open', async ({ browser }) => {
  await world.prefs({ theme: 'dark' });
  const context = await browser.newContext({ colorScheme: 'dark' });
  await signedIn(context);
  const page = await context.newPage();
  await page.goto(world.recordUrl);
  await expect(noteUnder(page, 'address_lines')).toBeVisible();
  await axe(page, 'the notes, dark');
  await page.getByRole('button', { name: 'Fill in details' }).click();
  await expect(page.getByRole('dialog', { name: 'Fill in details' })).toBeVisible();
  await axe(page, 'the sheet open, dark');
  await context.close();
  await world.prefs({ theme: null });
});

test('on a phone the sheet is the full width of the screen, and its close a 44 px target', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await signedIn(context);
  const page = await context.newPage();
  await page.goto(world.recordUrl);
  const fill = page.getByRole('button', { name: 'Fill in details' });
  expect((await fill.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await fill.click();
  const sheet = page.getByRole('dialog', { name: 'Fill in details' });
  await expect(sheet).toBeVisible();
  // Once it has slid in: from the screen's edge, its whole width.
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.x)).toBe(0);
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  expect(Math.round((await sheet.boundingBox())!.width)).toBe(width);
  const close = sheet.getByRole('button', { name: 'Close' });
  expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await close.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await axe(page, 'the sheet on a phone');
  await context.close();
});

test('in Arabic the page and the sheet run right to left, in the add-on\'s Arabic words', async ({ browser }) => {
  await world.prefs({ locale: 'ar_EG' });
  const context = await browser.newContext({ locale: 'ar-EG' });
  await signedIn(context);
  const page = await context.newPage();
  await page.goto(world.recordUrl);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const fill = page.getByRole('button', { name: 'املأ التفاصيل' });
  await expect(fill).toBeVisible();
  await expect(noteUnder(page, 'address_lines')).toContainText('سجل الشركات البريطاني');
  await fill.click();
  const sheet = page.getByRole('dialog', { name: 'املأ التفاصيل' });
  await expect(sheet).toBeVisible();
  // From the inline end: the left edge in right to left.
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.x)).toBe(0);
  await axe(page, 'Arabic, the sheet open');
  await context.close();
  await world.prefs({ locale: null });
});
