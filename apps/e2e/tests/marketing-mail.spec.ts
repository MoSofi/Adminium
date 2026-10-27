// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The marketing mail settings and the do-not-email list, walked by the
 * marketer they are for: a role holding the e-mail screens' grant
 * (`settings.manage`) and nothing else, invited and signed in once.
 *
 *  1. Email templates ⋯ → "Do-not-email list": the entries, "Add addresses"
 *     with one address per line, and no "Remove" (the Super Admin's alone).
 *  2. Workspace settings › Senders: the "Marketing mail" block under each
 *     sender; "Make a key" shows the DNS record; the postal address and the
 *     reply address saved through the page's one review.
 *  3. The bounce card: Mailgun's signing key saved and never shown back.
 *  4. The Super Admin removes an entry, through its confirm.
 *
 * Screenshots (desktop, phone, dark, Arabic) go to `E2E_SHOTS` when it is set.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { BASE_URL } from './constants.js';
import { signIn } from './helpers.js';

const MARKETER = { email: 'e2e-marketer@adminium.local', name: 'Mo Marketer', password: 'adminium-e2e-marketer-pass' };
const ROLE = 'E2E marketing';
const SHOTS = process.env['E2E_SHOTS'] ?? '';
const ORIGIN = 'https://crm.meridian.example';

let marketer: { id: string; cookies: Awaited<ReturnType<BrowserContext['cookies']>> } | undefined;
let roleId = '';
let before: { senders: unknown; publicOrigin: unknown } | undefined;

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS === '') return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

async function asMarketer(browser: Browser, options: { viewport?: { width: number; height: number }; colorScheme?: 'light' | 'dark' } = {}): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: marketer!.cookies, origins: [] }, viewport: options.viewport ?? { width: 1440, height: 900 }, colorScheme: options.colorScheme ?? 'light' });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage({ baseURL: BASE_URL, storageState: test.info().project.use.storageState as string });
  await signIn(page);
  // Two senders at the business's own domain and a public mailbox; a public address for the notice links.
  const email = (await (await page.request.get('/api/v1/settings/email')).json()) as { data: { senders: unknown; publicOrigin: unknown } };
  before = { senders: email.data.senders, publicOrigin: email.data.publicOrigin };
  const put = await page.request.put('/api/v1/settings/email', {
    data: { senders: [{ name: 'Meridian News', address: 'news@meridian.example' }, { name: 'Gmail', address: 'meridian.news@gmail.com' }], publicOrigin: ORIGIN },
  });
  expect(put.ok(), await put.text()).toBe(true);
  // What the list holds before the marketer looks.
  const added = await page.request.post('/api/v1/consent/stop-list', { data: { addresses: ['marta.kovac@cobaltlegal.example', 't.reidy@nordwind.example'] } });
  expect(added.ok(), await added.text()).toBe(true);

  // The marketer: a role with the e-mail screens' grant alone.
  const roles = ((await (await page.request.get('/api/v1/roles')).json()) as { roles: { id: string; name: string }[] }).roles;
  for (const one of roles) if (one.name === ROLE) await page.request.delete(`/api/v1/roles/${one.id}`);
  const made = await page.request.post('/api/v1/roles', { data: { name: ROLE } });
  expect(made.status(), await made.text()).toBe(201);
  roleId = ((await made.json()) as { id: string }).id;
  const granted = await page.request.put(`/api/v1/roles/${roleId}/permissions`, { data: { grants: ['system:settings:manage'] } });
  expect(granted.ok(), await granted.text()).toBe(true);
  const users = (await (await page.request.get('/api/v1/users?q=e2e-marketer')).json()) as { users?: { id: string; email: string }[] };
  for (const user of users.users ?? []) if (user.email === MARKETER.email) await page.request.delete(`/api/v1/users/${user.id}`);
  const invited = await page.request.post('/api/v1/users', { data: { email: MARKETER.email, name: MARKETER.name, roleIds: [roleId] } });
  expect(invited.status(), await invited.text()).toBe(201);
  const { invite, user } = (await invited.json()) as { invite: { token: string }; user: { id: string } };
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const own = await context.newPage();
  expect((await own.request.post('/api/v1/auth/password/reset', { data: { token: invite.token, newPassword: MARKETER.password } })).ok()).toBe(true);
  await own.goto('/login');
  const login = (): Promise<number> =>
    own.evaluate(async ([address, password]) => (await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: address, password }) })).status, [MARKETER.email, MARKETER.password] as const);
  let status = await login();
  if (status === 429) {
    await own.waitForTimeout(61_000);
    status = await login();
  }
  expect(status, 'the marketer signs in').toBe(200);
  marketer = { id: user.id, cookies: await context.cookies() };
  await context.close();
  await page.close();
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage({ baseURL: BASE_URL, storageState: test.info().project.use.storageState as string });
  await signIn(page);
  if (before !== undefined) await page.request.put('/api/v1/settings/email', { data: before }).catch(() => undefined);
  if (marketer !== undefined) await page.request.delete(`/api/v1/users/${marketer.id}`).catch(() => undefined);
  if (roleId !== '') await page.request.delete(`/api/v1/roles/${roleId}`).catch(() => undefined);
  const listed = (await (await page.request.get('/api/v1/consent/stop-list?limit=200')).json()) as { data: { entries: { id: string; address: string | null }[] } };
  for (const entry of listed.data.entries) if (entry.address?.endsWith('.example') === true) await page.request.delete(`/api/v1/consent/stop-list/${entry.id}`).catch(() => undefined);
  await page.close();
});

test('the marketer reads and adds to the do-not-email list, and removes nobody', async ({ browser }) => {
  const { page, close } = await asMarketer(browser);
  await page.goto('/email-templates');
  await page.getByTestId('email-actions-menu').click();
  await page.getByRole('menuitem', { name: 'Do-not-email list' }).click();
  await expect(page).toHaveURL(/\/email-templates\/do-not-email$/);
  await expect(page.getByRole('heading', { name: 'Do-not-email list' })).toBeVisible();
  await expect(page.getByTestId('dne-row').filter({ hasText: 'marta.kovac@cobaltlegal.example' })).toContainText('Added by hand');
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);

  await page.getByTestId('dne-add').click();
  const dialog = page.getByRole('dialog', { name: 'Add addresses' });
  await dialog.getByRole('textbox', { name: 'Addresses' }).fill('front.desk@harborfinch.example\np.lowe@junoanalytics.example');
  await shot(page, 'dne-add-desktop');
  await dialog.getByTestId('dne-add-confirm').click();
  await expect(page.getByText('2 addresses added')).toBeVisible();
  await expect(page.getByTestId('dne-row').filter({ hasText: 'p.lowe@junoanalytics.example' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search addresses' }).fill('nordwind');
  await expect(page.getByTestId('dne-row')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Search addresses' }).fill('');
  await expect(page.getByTestId('dne-row')).toHaveCount(4);
  await shot(page, 'dne-desktop');
  await close();
});

test('the marketer makes a key, sets the postal and reply addresses, and saves Mailgun\'s signing key', async ({ browser }) => {
  const { page, close } = await asMarketer(browser);
  await page.goto('/studio/settings#senders');
  const news = page.locator('[data-part="marketing-mail"][data-sender="news@meridian.example"]');
  await expect(news.getByText('Marketing mail', { exact: true })).toBeVisible();
  await expect(page.locator('[data-part="marketing-mail"][data-sender="meridian.news@gmail.com"]')).toContainText('Can’t send marketing mail: use your own domain.');
  await news.getByRole('button', { name: 'Make a key' }).click();
  await expect(news.getByText(/^adminium\._domainkey\.meridian\.example TXT "v=DKIM1; k=rsa; p=/)).toBeVisible();
  await expect(news.locator('[data-part="dkim-state"]')).toContainText(/Not found yet|DNS could not be asked/);

  // One postal address and one reply address per install: in the first own-domain sender's block (here the SMTP From's).
  await expect(page.getByLabel('Postal address')).toHaveCount(1);
  await expect(news.getByLabel('Postal address')).toHaveCount(0);
  await page.getByLabel('Postal address').fill('Meridian Workplace Ltd, 4 Wharf Lane, Leeds LS1 4BR, United Kingdom');
  await page.getByLabel('Replies to marketing mail go to').fill('hello@meridian.example');
  await page.getByRole('button', { name: 'Save changes' }).click();
  const review = page.getByRole('dialog', { name: 'Save workspace settings' });
  await expect(review).toContainText('Postal address');
  await expect(review).toContainText('Replies to marketing mail go to');
  await review.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Workspace settings updated')).toBeVisible();
  await news.scrollIntoViewIfNeeded();
  await shot(page, 'settings-senders-desktop');

  const card = page.locator('[data-part="bounce-card"]');
  await card.getByRole('radio', { name: 'Mailgun' }).click();
  await expect(card.getByTestId('notice-address')).toContainText(`${ORIGIN}/api/v1/email/notices/mailgun/`);
  await card.getByLabel('Signing key').fill('made-up-mailgun-signing-secret-for-tests');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByRole('button', { name: 'Replace' })).toBeVisible();
  await expect(card).not.toContainText('made-up-mailgun-signing-secret-for-tests');
  await card.getByRole('radio', { name: 'Postmark' }).click();
  await expect(card.locator('[data-part="made-credentials"]')).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await shot(page, 'bounce-card-desktop');
  await close();
});

test('phone, dark and Arabic', async ({ browser }) => {
  const phone = await asMarketer(browser, { viewport: { width: 375, height: 812 } });
  await phone.page.goto('/email-templates/do-not-email');
  await expect(phone.page.getByTestId('dne-row').first()).toBeVisible();
  await shot(phone.page, 'dne-phone');
  await phone.page.goto('/studio/settings#senders');
  await expect(phone.page.locator('[data-part="marketing-mail"]').first()).toBeVisible();
  await shot(phone.page, 'settings-phone');
  await phone.close();

  const dark = await asMarketer(browser, { colorScheme: 'dark' });
  await dark.page.goto('/email-templates/do-not-email');
  await expect(dark.page.getByTestId('dne-row').first()).toBeVisible();
  await shot(dark.page, 'dne-dark');
  await dark.page.goto('/studio/settings#bounces');
  await expect(dark.page.locator('[data-part="bounce-card"]')).toBeVisible();
  await shot(dark.page, 'settings-dark');
  await dark.close();

  const arabic = await asMarketer(browser);
  expect((await arabic.page.request.patch('/api/v1/me/prefs', { data: { locale: 'ar_EG' } })).ok()).toBe(true);
  try {
    await arabic.page.goto('/email-templates/do-not-email');
    await expect(arabic.page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(arabic.page.getByRole('heading', { name: 'قائمة عدم المراسلة' })).toBeVisible();
    await shot(arabic.page, 'dne-arabic');
    await arabic.page.goto('/studio/settings#senders');
    await expect(arabic.page.getByText('الرسائل التسويقية').first()).toBeVisible();
    await shot(arabic.page, 'settings-arabic');
  } finally {
    await arabic.page.request.patch('/api/v1/me/prefs', { data: { locale: 'en_US' } });
    await arabic.close();
  }
});

test('the Super Admin removes an entry through its confirm', async ({ page }) => {
  await signIn(page);
  await page.goto('/email-templates/do-not-email');
  const row = page.getByTestId('dne-row').filter({ hasText: 't.reidy@nordwind.example' });
  await row.getByRole('button', { name: 'Remove' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Remove from the list?' });
  await expect(confirm).toContainText('They will get marketing mail again only if they agree again.');
  await shot(page, 'dne-remove-confirm');
  await confirm.getByTestId('dne-remove-confirm').click();
  await expect(page.getByText('t.reidy@nordwind.example is off the list.')).toBeVisible();
  await expect(row).toHaveCount(0);
});
