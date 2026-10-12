// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Designer's preview on an app with sides of its own, end to end.
 *
 * `adminium app new --staff --customer` in a project folder, then
 * `adminium design`: the app is installed from its folder, and a session on
 * it opens the build page with no model at all. The address bar follows the
 * customer side from page to page and takes a typed page with nothing loaded
 * again; a staff side reloaded on a deep page stays on it; each side keeps
 * the page it was on while another is looked at. An element of the screen
 * can be pointed at: the click picks it, and reaches nothing of the screen.
 * A part of it can be dragged over: its picture waits with the next message.
 *
 * No turn runs here. What a turn does to the preview is `designer.spec.ts`'s,
 * on the dashboard side, the only side its app has.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { ProjectHarness, PROJECT_URL } from './projectHarness.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);
const APP_KEY = 'repairs';
/** A session nobody started from Home: `ds_` and 24 characters. */
const SESSION = `ds_${'e2esides'.padEnd(24, '0')}`;

type Marked = { leftByTheTest?: boolean };

let project: ProjectHarness;

test.describe.configure({ mode: 'serial' });
test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1600, height: 900 } });

// eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(240_000);
  project = await ProjectHarness.create({}, ['react', 'react-dom', '@adminiumjs/public-client']);
  const made = project.cli(['app', 'new', APP_KEY, '--staff', '--customer', '--no-install']);
  expect(made.status, `${made.stdout}${made.stderr}`).toBe(0);
  // The session as the Designer keeps one, written by hand: no model is asked for anything.
  const now = Date.now();
  project.write(
    `.adminium/designer/sessions/${SESSION}/session.json`,
    `${JSON.stringify({ id: SESSION, appKey: APP_KEY, title: 'Repairs', target: 'auto', connectionId: 'none', model: 'none', createdAt: now, updatedAt: now, turns: 0, version: null, createdApp: false, tokens: { in: 0, out: 0 } }, null, 2)}\n`,
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

test('the address follows a customer side and takes a typed page; a staff side reloaded on a deep page stays; an element can be pointed at', async ({ page }, testInfo) => {
  testInfo.setTimeout(240_000);
  const link = await project.design();
  await expect.poll(() => project.output(), { timeout: 60_000 }).toContain(`App "${APP_KEY}" installed from apps/${APP_KEY}.`);
  // The link signs the owner in and leaves the address; then the session, by its own address.
  await page.goto(link);
  await expect.poll(() => new URL(page.url()).hash, { timeout: 30_000 }).toBe('');
  await page.goto(`${PROJECT_URL}/design/${SESSION}`);

  const sides = page.getByRole('radiogroup', { name: 'Side' });
  const frameAt = (side: string): string | undefined =>
    page
      .frames()
      .map((frame) => new URL(frame.url() === '' ? 'about:blank' : frame.url()).pathname)
      .find((path) => path.startsWith(`/apps/${APP_KEY}/${side}`));

  // The staff side is the first of the app's own, and its pages are nav.json's.
  await expect(sides.getByRole('radio', { name: 'Staff' })).toBeChecked({ timeout: 60_000 });
  const staff = page.frameLocator('iframe[title="Staff"]');
  const staffAddress = page.getByRole('combobox', { name: 'Address on the staff side' });
  await expect(staff.getByLabel('New item')).toBeVisible({ timeout: 60_000 });
  await expect(staffAddress).toBeEditable({ timeout: 15_000 });
  await expect(staffAddress).toHaveValue('/');
  await staffAddress.click();
  const pages = page.getByRole('listbox', { name: 'Pages on this side' });
  await expect(pages.getByRole('option', { name: /\/done/ })).toContainText('Done');
  await staffAddress.fill('done');
  await page.keyboard.press('Enter');
  await expect(staffAddress).toHaveValue('/done');
  await expect(staff.getByRole('link', { name: /^Done/ })).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => frameAt('staff')).toBe(`/apps/${APP_KEY}/staff/done`);

  // Reloaded there, the side comes back to that page, not to its first.
  await staff.locator('body').evaluate(() => {
    (window as unknown as Marked).leftByTheTest = true;
  });
  await page.getByRole('button', { name: 'Reload the preview' }).click();
  await expect.poll(() => staff.locator('body').evaluate(() => (window as unknown as Marked).leftByTheTest ?? null), { timeout: 30_000 }).toBeNull();
  await expect(staff.getByRole('link', { name: /^Done/ })).toHaveAttribute('aria-current', 'page');
  await expect(staff.getByLabel('New item')).toHaveCount(0);
  await expect(staffAddress).toHaveValue('/done');
  await expect.poll(() => frameAt('staff')).toBe(`/apps/${APP_KEY}/staff/done`);

  // The customer side: a visitor, on the first page.
  await sides.getByRole('radio', { name: 'Customer' }).click();
  const customer = page.frameLocator('iframe[title="Customer"]');
  const address = page.getByRole('combobox', { name: 'Address on the customer side' });
  await expect(page.getByLabel('Seen as: visitor. A visitor, not signed in.')).toBeVisible();
  await expect(customer.getByRole('heading', { name: 'What can we do for you?' })).toBeVisible({ timeout: 60_000 });
  await expect(address).toBeEditable({ timeout: 15_000 });
  await expect(address).toHaveValue('/');
  await customer.locator('body').evaluate(() => {
    (window as unknown as Marked).leftByTheTest = true;
  });

  // Two pages gone to by the side's own links: the bar reads each.
  const nav = customer.getByRole('navigation', { name: 'Pages' });
  await nav.getByRole('link', { name: 'Send a request' }).click();
  await expect(customer.getByLabel('What do you need?')).toBeVisible();
  await expect(address).toHaveValue('/request');
  await nav.getByRole('link', { name: 'On offer' }).click();
  await expect(customer.getByRole('heading', { name: 'What can we do for you?' })).toBeVisible();
  await expect(address).toHaveValue('/');

  // A typed page: the side goes there with nothing loaded again (the mark would be gone).
  await address.click();
  const opened = page.getByRole('listbox', { name: 'Pages you have opened' });
  await expect(opened.getByRole('option', { name: /\/request/ })).toBeVisible();
  const swept = await new AxeBuilder({ page }).withTags(TAGS).exclude('iframe').analyze();
  expect(swept.violations.filter((violation) => BLOCKING.has(violation.impact ?? '')).map((violation) => `${String(violation.impact)}: ${violation.id}`)).toEqual([]);
  await address.fill('request/');
  await page.keyboard.press('Enter');
  await expect(address).toHaveValue('/request');
  await expect(customer.getByLabel('What do you need?')).toBeVisible();
  expect(await customer.locator('body').evaluate(() => (window as unknown as Marked).leftByTheTest)).toBe(true);

  // A reload of the preview opens the side on that page.
  await page.getByRole('button', { name: 'Reload the preview' }).click();
  await expect.poll(() => customer.locator('body').evaluate(() => (window as unknown as Marked).leftByTheTest ?? null), { timeout: 30_000 }).toBeNull();
  await expect(customer.getByLabel('What do you need?')).toBeVisible();
  await expect(address).toHaveValue('/request');
  await expect.poll(() => frameAt('customer')).toBe(`/apps/${APP_KEY}/customer/request`);

  // Each side keeps the page it was on.
  await sides.getByRole('radio', { name: 'Staff' }).click();
  await expect(staff.getByRole('link', { name: /^Done/ })).toHaveAttribute('aria-current', 'page', { timeout: 60_000 });
  await expect(staffAddress).toHaveValue('/done');
  await sides.getByRole('radio', { name: 'Customer' }).click();
  await expect(customer.getByLabel('What do you need?')).toBeVisible({ timeout: 60_000 });
  await expect(address).toHaveValue('/request');

  // Pointing at an element: the click picks it and reaches nothing of the screen. The link is not followed.
  const pick = page.getByRole('button', { name: 'Pick an element on the page' });
  await expect(pick).toBeEnabled({ timeout: 15_000 });
  await pick.click();
  await expect(pick).toHaveAttribute('aria-pressed', 'true');
  await nav.getByRole('link', { name: 'On offer' }).click();
  const chip = page.getByRole('group', { name: 'Picked element' });
  await expect(chip).toContainText('On offer');
  await expect(chip).toContainText('/request');
  await expect(pick).toHaveAttribute('aria-pressed', 'false');
  await expect(address).toHaveValue('/request');
  await expect(customer.getByLabel('What do you need?')).toBeVisible();
  // The chip waits above the box, where the person says what to change, and can be taken off.
  await expect(page.getByRole('textbox', { name: 'Message to Adminium Designer' })).toBeFocused();
  await chip.getByRole('button', { name: 'Take the picked element off' }).click();
  await expect(chip).toHaveCount(0);

  // Escape ends pointing with nothing picked, and the screen's own links work again.
  await pick.click();
  await expect(pick).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(pick).toHaveAttribute('aria-pressed', 'false');
  await nav.getByRole('link', { name: 'On offer' }).click();
  await expect(address).toHaveValue('/');
  await expect(chip).toHaveCount(0);

  // A picture of a part of the page: dragged over the frame, drawn by the page in it, and waiting with the next message.
  const shot = page.getByRole('button', { name: 'Take a picture of a part of the page' });
  await expect(shot).toBeEnabled();
  await shot.click();
  const layer = page.locator('[data-part="shot-overlay"]');
  const over = await layer.boundingBox();
  if (over === null) throw new Error('the layer a picture is dragged on is not there');
  await page.mouse.move(over.x + 40, over.y + 30);
  await page.mouse.down();
  await page.mouse.move(over.x + 440, over.y + 260, { steps: 4 });
  await page.mouse.up();
  const files = page.getByRole('list', { name: 'Attached files' });
  await expect(files.getByText('screenshot.jpg')).toBeVisible({ timeout: 20_000 });
  await expect(shot).toHaveAttribute('aria-pressed', 'false');
  await expect(layer).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message to Adminium Designer' })).toBeFocused();
  // The part dragged over, at twice its size, with the page's own words and colours in it: not one flat colour.
  const drawn = await files.locator('img').evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d');
    context?.drawImage(img, 0, 0);
    const data = context?.getImageData(0, 0, canvas.width, canvas.height).data ?? new Uint8ClampedArray();
    const colours = new Set<number>();
    for (let at = 0; at < data.length; at += 4 * 97) colours.add(((data[at] ?? 0) >> 4 << 8) | ((data[at + 1] ?? 0) >> 4 << 4) | ((data[at + 2] ?? 0) >> 4));
    return { width: img.naturalWidth, height: img.naturalHeight, colours: colours.size };
  });
  expect([drawn.width, drawn.height]).toEqual([800, 460]);
  expect(drawn.colours).toBeGreaterThan(2);
  await files.getByRole('button', { name: 'Take screenshot.jpg off' }).click();

  // Escape ends the drag with nothing taken.
  await shot.click();
  await expect(layer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(shot).toHaveAttribute('aria-pressed', 'false');
  await expect(layer).toHaveCount(0);
  await expect(files).toHaveCount(0);

  // A staff side, in the dashboard's own frame for an app, draws itself the same way.
  await sides.getByRole('radio', { name: 'Staff' }).click();
  await expect(shot).toBeEnabled({ timeout: 60_000 });
  await shot.click();
  const staffLayer = await layer.boundingBox();
  if (staffLayer === null) throw new Error('the layer a picture is dragged on is not there');
  await page.mouse.move(staffLayer.x + 300, staffLayer.y + 200);
  await page.mouse.down();
  await page.mouse.move(staffLayer.x + 20, staffLayer.y + 20, { steps: 4 });
  await page.mouse.up();
  await expect(files.getByText('screenshot.jpg')).toBeVisible({ timeout: 20_000 });
});
