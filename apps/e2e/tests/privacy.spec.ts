// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Privacy & public pages, walked by the Super Admin (the one role that
 * holds `privacy.manage`):
 *
 *  1. Server settings → "Open privacy": the three tabs. The notice's
 *     address refuses `http://` as it is typed; an https one is saved.
 *  2. A person's data: find an address the install keeps (on the
 *     do-not-email list, with a consent entry), "Download everything", and
 *     the .zip arrives through the browser's own download.
 *  3. "Erase…": the dialog's What goes matches the server's own preview,
 *     "Erase for good" opens only to the typed address, and the page ends
 *     on "Erased. Saved in the audit log."; the download went with them.
 *  4. How long we keep things: the two fixed rows.
 *  5. Your websites: the reach card first, every line of the add box checked
 *     as typed, an add and a removal, the loader line; axe finds nothing on
 *     it or on the notice tab, in light, dark, Arabic and at a phone's width.
 *
 * No app on this server declares a people table (that needs Adminium
 * 0.3.38), so the person is found through what Adminium keeps itself.
 * Screenshots (desktop, 1024, 768, phone, dark, Arabic) go to `E2E_SHOTS`
 * when it is set.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';

import { BASE_URL } from './constants.js';
import { signIn } from './helpers.js';

const SHOTS = process.env['E2E_SHOTS'] ?? '';
const PERSON = 'marta.kovac@cobaltlegal.example';
const NOTICE = 'https://www.meridian.example/privacy';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** Axe over the page's body, every finding whatever its impact: the websites tab is new, and starts clean. */
async function noAxeFindings(page: Page, label: string): Promise<void> {
  await expect(page.getByTestId('privacy-page')).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(TAGS).include('[data-testid="privacy-page"]').analyze();
  expect(results.violations.map((v) => `${label}: ${String(v.impact)} ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

/** Take every listed website off, so the next run starts from none. */
async function clearWebsites(page: Page): Promise<void> {
  const listed = (await (await page.request.get('/api/v1/privacy/websites')).json()) as { data: { websites: { origin: string }[] } };
  for (const site of listed.data.websites) await page.request.post('/api/v1/privacy/websites/remove', { data: { origin: site.origin } });
}

let before: { businessName: string | null; noticeUrl: string | null } | undefined;

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS === '') return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

async function owner(browser: Browser, options: { viewport?: { width: number; height: number }; colorScheme?: 'light' | 'dark' } = {}): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: test.info().project.use.storageState as string,
    viewport: options.viewport ?? { width: 1440, height: 900 },
    colorScheme: options.colorScheme ?? 'light',
    acceptDownloads: true,
  });
  const page = await context.newPage();
  // The saved session is the Super Admin's; the sign-in check looks for the sidebar, which a narrow page hides in its drawer.
  if (options.viewport === undefined) await signIn(page);
  return { page, close: () => context.close() };
}

/** What the install keeps about the person: a do-not-email entry and a consent "yes" by their address. */
async function seedPerson(page: Page): Promise<void> {
  const added = await page.request.post('/api/v1/consent/stop-list', { data: { addresses: [PERSON] } });
  expect(added.ok(), await added.text()).toBe(true);
}

/** The erase dialog with the server's lists in, and its opening animation over. */
async function settled(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('erase-stays')).toBeVisible();
  await expect.poll(() => dialog.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
  // The overlay's fade ends with the dialog's.
  await page.waitForTimeout(300);
}

async function findPerson(page: Page): Promise<void> {
  await page.getByLabel('E-mail address').fill(PERSON);
  await page.getByTestId('privacy-person-find').click();
  await expect(page.getByTestId('privacy-result')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const { page, close } = await owner(browser);
  const notice = (await (await page.request.get('/api/v1/privacy/notice')).json()) as { data: { businessName: string | null; noticeUrl: string | null } };
  before = { businessName: notice.data.businessName, noticeUrl: notice.data.noticeUrl };
  const cleared = await page.request.put('/api/v1/privacy/notice', { data: { businessName: null, noticeUrl: null } });
  expect(cleared.ok(), await cleared.text()).toBe(true);
  await seedPerson(page);
  await clearWebsites(page);
  await close();
});

test.afterAll(async ({ browser }) => {
  const { page, close } = await owner(browser);
  if (before !== undefined) await page.request.put('/api/v1/privacy/notice', { data: before }).catch(() => undefined);
  await clearWebsites(page).catch(() => undefined);
  await close();
});

test('the notice: http:// is refused as typed, an https address is saved', async ({ browser }) => {
  const { page, close } = await owner(browser);
  await page.goto('/studio/settings');
  await page.getByRole('button', { name: 'Open privacy' }).click();
  await expect(page).toHaveURL(/\/studio\/privacy$/);
  await expect(page.getByRole('tab')).toHaveText(['Privacy notice', 'Your websites', 'A person’s data', 'How long we keep things']);
  // The reach card comes first, whatever this server's state.
  await expect(page.getByTestId('privacy-reach')).toBeVisible();
  await expect(page.getByTestId('privacy-notice-unset')).toBeVisible();
  await shot(page, 'notice-empty-desktop');

  await page.getByLabel('Business name').fill('Meridian Workplace Ltd');
  const address = page.getByLabel('Privacy notice address');
  await address.fill('http://www.meridian.example/privacy');
  await expect(page.getByText('Use an address that starts with https, such as https://www.example.com/privacy.')).toBeVisible();
  await expect(page.getByTestId('privacy-notice-save')).toBeDisabled();
  // The server refuses it too, whatever the page says.
  const refused = await page.request.put('/api/v1/privacy/notice', { data: { businessName: 'Meridian Workplace Ltd', noticeUrl: 'http://www.meridian.example/privacy' } });
  expect(refused.status()).toBe(422);

  await address.fill(NOTICE);
  await page.getByTestId('privacy-notice-save').click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(page.getByTestId('privacy-notice-unset')).toHaveCount(0);
  const saved = (await (await page.request.get('/api/v1/privacy/notice')).json()) as { data: { noticeUrl: string; ready: boolean } };
  expect(saved.data).toMatchObject({ noticeUrl: NOTICE, ready: true });
  await shot(page, 'notice-desktop');
  await close();
});

test('your websites: checked as typed, added, removed, and clean under axe', async ({ browser }) => {
  const { page, close } = await owner(browser);
  await page.goto('/studio/privacy');
  await noAxeFindings(page, 'notice');
  await page.getByRole('tab', { name: 'Your websites' }).click();
  await expect(page).toHaveURL(/tab=websites/);
  await expect(page.getByTestId('privacy-reach')).toBeVisible();
  await expect(page.getByTestId('privacy-websites-none')).toBeVisible();
  await noAxeFindings(page, 'websites, none');
  await shot(page, 'websites-empty-desktop');

  // The comp's sample: each line refused as typed, "Add" off.
  const field = page.getByLabel('Add a website');
  await field.fill(['http://events.meridian.example', 'https://*.meridian.example', 'https://events.meridian.example/forms'].join('\n'));
  const checks = page.getByTestId('privacy-websites-checks').getByRole('listitem');
  await expect(checks).toHaveText(['http://events.meridian.example · Use https://', 'https://*.meridian.example · One website per line, no *', 'https://events.meridian.example/forms · Just the address, no path']);
  await expect(page.getByTestId('privacy-websites-add')).toBeDisabled();
  await noAxeFindings(page, 'websites, refused lines');
  await shot(page, 'websites-refused-desktop');

  await field.fill('https://shop.meridian.example\nhttps://www.meridian.example/');
  await expect(checks).toHaveText(['https://shop.meridian.example · Ready to add', 'https://www.meridian.example/ · Ready to add']);
  await page.getByTestId('privacy-websites-add').click();
  const list = page.getByTestId('privacy-websites-list').getByRole('listitem');
  await expect(list).toHaveCount(2);
  await expect(list.first()).toContainText('https://shop.meridian.example');
  await expect(list.first()).toContainText('Added by');
  await expect(field).toHaveValue('');
  await expect(page.getByTestId('privacy-embed-line')).toContainText('/x/embed.js" async></script>');
  await noAxeFindings(page, 'websites, listed');
  await shot(page, 'websites-desktop');

  await page.getByRole('button', { name: 'Remove https://www.meridian.example' }).click();
  await expect(list).toHaveCount(1);
  await close();

  const dark = await owner(browser, { colorScheme: 'dark' });
  await dark.page.goto('/studio/privacy?tab=websites');
  await expect(dark.page.getByTestId('privacy-websites-list')).toBeVisible();
  await dark.page.getByLabel('Add a website').fill('http://events.meridian.example\nhttps://events.meridian.example');
  await noAxeFindings(dark.page, 'websites, dark');
  await shot(dark.page, 'websites-dark');
  await dark.page.goto('/studio/privacy');
  await noAxeFindings(dark.page, 'notice, dark');
  await dark.close();

  const phone = await owner(browser, { viewport: { width: 390, height: 844 } });
  await phone.page.goto('/studio/privacy?tab=websites');
  await expect(phone.page.getByTestId('privacy-websites-list')).toBeVisible();
  expect(await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await noAxeFindings(phone.page, 'websites, phone');
  await shot(phone.page, 'websites-phone');
  await phone.close();

  const arabic = await owner(browser);
  expect((await arabic.page.request.patch('/api/v1/me/prefs', { data: { locale: 'ar_EG' } })).ok()).toBe(true);
  try {
    await arabic.page.goto('/studio/privacy?tab=websites');
    await expect(arabic.page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(arabic.page.getByRole('tab', { name: 'مواقعك' })).toHaveAttribute('aria-selected', 'true');
    // The add box stays left to right.
    await expect(arabic.page.getByTestId('privacy-websites-field')).toHaveAttribute('dir', 'ltr');
    await arabic.page.getByTestId('privacy-websites-field').fill('http://events.meridian.example');
    await expect(arabic.page.getByTestId('privacy-websites-checks')).toContainText('استخدم https://');
    await noAxeFindings(arabic.page, 'websites, Arabic');
    await shot(arabic.page, 'websites-arabic');
  } finally {
    await arabic.page.request.patch('/api/v1/me/prefs', { data: { locale: 'en_US' } });
    await arabic.close();
  }
});

test('a person’s data: find, download (the file arrives), erase, keeping', async ({ browser }) => {
  const { page, close } = await owner(browser);
  await page.goto('/studio/privacy?tab=person');
  await findPerson(page);
  const result = page.getByTestId('privacy-result');
  await expect(result.getByTestId('privacy-source').filter({ hasText: 'Do-not-email list' })).toContainText('yes');
  await shot(page, 'person-results-desktop');

  // "Download everything": the .zip is made by a job, then fetched by its id.
  await page.getByTestId('privacy-download').click();
  const get = page.getByTestId('privacy-download-get').first();
  await expect(get).toBeVisible({ timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), get.click()]);
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const file = readFileSync(await download.path());
  expect(file.byteLength).toBeGreaterThan(100);
  expect(file.subarray(0, 2).toString('latin1')).toBe('PK');
  expect(file.includes(Buffer.from('stop-list'))).toBe(true);

  // The dialog's What goes is the server's own preview, counted.
  const preview = (await (await page.request.post('/api/v1/privacy/erase/preview', { data: { address: PERSON } })).json()) as { data: { goes: { kind: string; count: number }[] } };
  await page.getByTestId('privacy-erase').click();
  const dialog = page.getByRole('dialog', { name: 'Erase everything about this person?' });
  await expect(dialog.getByTestId('erase-stays')).toContainText('Their address stays on the do-not-email list as a code, so they’re never e-mailed again.');
  const goes = await dialog.getByTestId('erase-goes').innerText();
  for (const item of preview.data.goes) expect(goes).toContain(String(item.count));
  if (preview.data.goes.length === 0) expect(goes).toContain('Nothing in the apps’ tables or the mail');
  const confirm = dialog.getByLabel('Type the address to confirm');
  await expect(confirm).toBeFocused();
  await expect(dialog.getByTestId('erase-for-good')).toBeDisabled();
  await confirm.fill('marta.kovac@cobaltlegal');
  await expect(dialog.getByTestId('erase-for-good')).toBeDisabled();
  await confirm.fill(PERSON.toUpperCase());
  await expect(dialog.getByTestId('erase-for-good')).toBeEnabled();
  await settled(page);
  await shot(page, 'erase-dialog-desktop');
  await dialog.getByTestId('erase-for-good').click();
  await expect(page.getByTestId('privacy-erased')).toContainText('Erased. Saved in the audit log.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Their download went with them.
  await expect(page.getByTestId('privacy-download-get')).toHaveCount(0);
  await shot(page, 'erased-desktop');
  // The erasure is the audit log's newest entry.
  await page.getByRole('button', { name: 'Open the audit log' }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await expect(page.getByText('privacy.erase', { exact: true }).first()).toBeVisible();

  await page.goto('/studio/privacy?tab=keeping');
  const keeping = page.getByTestId('privacy-keeping');
  await expect(keeping.getByRole('rowheader')).toHaveText(['Consent history', 'Do-not-email list']);
  await expect(keeping).toContainText('Kept until the person is erased');
  await expect(keeping).toContainText('Kept for good');
  await shot(page, 'keeping-desktop');
  await close();
});

test('widths, dark and Arabic', async ({ browser }) => {
  const seed = await owner(browser);
  await seedPerson(seed.page);
  await seed.close();

  for (const [name, viewport] of [['1024', { width: 1024, height: 800 }], ['768', { width: 768, height: 1000 }], ['phone', { width: 390, height: 844 }]] as const) {
    const { page, close } = await owner(browser, { viewport });
    await page.goto('/studio/privacy');
    await expect(page.getByLabel('Privacy notice address')).toHaveValue(NOTICE);
    await shot(page, `notice-${name}`);
    await page.goto('/studio/privacy?tab=person');
    await findPerson(page);
    await shot(page, `person-results-${name}`);
    if (name === 'phone') {
      // No sideways scroll on the page itself; the tab bar scrolls on its own.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.getByTestId('privacy-erase').click();
      await settled(page);
      await shot(page, 'erase-dialog-phone');
    }
    await close();
  }

  const dark = await owner(browser, { colorScheme: 'dark' });
  await dark.page.goto('/studio/privacy?tab=person');
  await findPerson(dark.page);
  await shot(dark.page, 'person-results-dark');
  await dark.page.getByTestId('privacy-erase').click();
  await settled(dark.page);
  await shot(dark.page, 'erase-dialog-dark');
  await dark.close();

  const arabic = await owner(browser);
  expect((await arabic.page.request.patch('/api/v1/me/prefs', { data: { locale: 'ar_EG' } })).ok()).toBe(true);
  try {
    await arabic.page.goto('/studio/privacy?tab=person');
    await expect(arabic.page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(arabic.page.getByRole('tab', { name: 'بيانات شخص' })).toHaveAttribute('aria-selected', 'true');
    await arabic.page.getByLabel('عنوان البريد الإلكتروني').fill(PERSON);
    await arabic.page.getByTestId('privacy-person-find').click();
    await expect(arabic.page.getByTestId('privacy-result')).toBeVisible();
    await shot(arabic.page, 'person-results-arabic');
    await arabic.page.getByTestId('privacy-erase').click();
    await expect(arabic.page.getByRole('dialog', { name: 'مسح كل ما يخص هذا الشخص؟' })).toBeVisible();
    await arabic.page.getByLabel('اكتب العنوان للتأكيد').fill(PERSON);
    await settled(arabic.page);
    await shot(arabic.page, 'erase-dialog-arabic');
    await arabic.page.keyboard.press('Escape');
    await arabic.page.goto('/studio/privacy');
    await shot(arabic.page, 'notice-arabic');
    await arabic.page.goto('/studio/privacy?tab=keeping');
    await expect(arabic.page.getByText('يُحتفظ به حتى يُمسح الشخص')).toBeVisible();
    await shot(arabic.page, 'keeping-arabic');
  } finally {
    await arabic.page.request.patch('/api/v1/me/prefs', { data: { locale: 'en_US' } });
    await arabic.close();
  }
});
