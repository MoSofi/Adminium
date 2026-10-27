// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A campaign sent by the marketer it is for: a role holding the campaigns'
 * grant (`settings.manage`) and not the Admin, invited and signed in once.
 *
 *  1. The rail offers "Email templates" to the marketer; the campaign's
 *     editor shows the locked footer of a marketing e-mail.
 *  2. The send dialog to a table's people: 1a (the breakdown, the existing
 *     customers' switch), 1b (the review, one person at a time, Undo), 1c
 *     (the sender's refusals with their fix links) and 1d (masked
 *     addresses). An app that declares a people table needs Adminium
 *     0.3.37, which this server (0.3.36) refuses to install, so these
 *     answers of the audience routes come from the test (`page.route`); the
 *     server's own refusals, breakdown and 409 are proven by its tests.
 *  3. A real send to the workspace's people at one an hour: the run's
 *     "Sending · 1 of n", Pause, "Paused", Go on, and Stop sending through
 *     its confirm (the focus on "Keep sending").
 *  4. The send log of that run, read from its ledger: the summary, a
 *     filter, the search.
 *
 * Screenshots (desktop, phone, dark, Arabic) go to `E2E_SHOTS` when it is set.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';

import { BASE_URL } from './constants.js';
import { signIn } from './helpers.js';

const MARKETER = { email: 'e2e-campaigner@adminium.local', name: 'Cam Paigner', password: 'adminium-e2e-campaigner-pass' };
const ROLE = 'E2E campaigns';
const SHOTS = process.env['E2E_SHOTS'] ?? '';

let marketer: { id: string; cookies: Awaited<ReturnType<BrowserContext['cookies']>> } | undefined;
let roleId = '';
let campaignId = '';

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

// ── what a CRM's Contacts would answer (see the header) ─────────────────────

const CONTACTS = {
  connectionId: 'conn_crm',
  table: 'tbl_contacts',
  label: 'Contacts',
  appKey: 'crm',
  appName: 'Sales CRM',
  kind: 'people',
  consentPurpose: 'newsletter',
  addresses: 'readable',
  existingCustomers: { offered: true, on: true, at: Date.UTC(2026, 6, 2, 10), by: { id: 'someone-else', name: 'Dana Whitlock' } },
};

interface Audience {
  addresses?: 'readable' | 'masked';
  awaitingReview?: number;
  refusals?: string[];
}

function breakdown(existing: boolean, awaitingReview: number) {
  return { rows: 1252, recipients: existing ? 470 : 412, consent: 412, existingCustomers: 58, doNotEmail: 9, notAgreed: 819, awaitingReview, notMarked: 0, sample: 0, reservedDomain: 0, noAddress: 0 };
}

async function routeAudience(page: Page, audience: () => Audience): Promise<void> {
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/v1/email-audience/tables', (route) => json(route, { tables: [{ ...CONTACTS, addresses: audience().addresses ?? 'readable' }] }));
  await page.route('**/api/v1/email-audience/people-tables', (route) => json(route, { tables: [{ connectionId: 'conn_crm', table: 'tbl_contacts', label: 'Contacts', appName: 'Sales CRM', canEmail: true }] }));
  await page.route('**/api/v1/email-audience/views?*', (route) => json(route, { views: [{ id: 'view_n', name: 'North territory', shared: true, refused: null }] }));
  await page.route('**/api/v1/email-audience/review?*', (route) =>
    json(route, {
      purpose: 'newsletter',
      total: 3,
      people: [
        { key: '4', name: 'Ruth Adeyemi', address: 'ruth.adeyemi@fernwayclinics.example', tickedBy: 'Dana Whitlock', tickedAt: Date.UTC(2025, 10, 3) },
        { key: '5', name: 'Ines Vaughan', address: 'ines.vaughan@junoanalytics.example', tickedBy: 'Priya Raman', tickedAt: Date.UTC(2025, 10, 3) },
        { key: '6', name: 'Tomas Reidy', address: 't.reidy@nordwind.example', tickedBy: 'Sam Okonjo', tickedAt: Date.UTC(2025, 10, 3) },
      ],
    }),
  );
  await page.route('**/api/v1/email-audience/review/answer', (route) => json(route, { event: { id: 'cev_1', state: 'yes', at: Date.now() } }));
  await page.route('**/api/v1/email-templates/*/audience/preview', async (route) => {
    const body = route.request().postDataJSON() as { audience: { kind: string; existingCustomers?: boolean }; ratePerHour?: number };
    if (body.audience.kind !== 'table') return route.continue();
    const now = audience();
    const b = breakdown(body.audience.existingCustomers === true, now.awaitingReview ?? 0);
    return json(route, {
      total: 1252,
      skipped: 1252 - b.recipients,
      unfilled: [],
      estimateMinutes: body.ratePerHour === undefined ? null : Math.ceil((b.recipients / body.ratePerHour) * 60),
      breakdown: b,
      variables: [],
      refusals: now.refusals ?? [],
      sender: 'news@gmail.com',
    });
  });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage({ baseURL: BASE_URL, storageState: test.info().project.use.storageState as string });
  await signIn(page);
  const roles = ((await (await page.request.get('/api/v1/roles')).json()) as { roles: { id: string; name: string }[] }).roles;
  for (const one of roles) if (one.name === ROLE) await page.request.delete(`/api/v1/roles/${one.id}`);
  const made = await page.request.post('/api/v1/roles', { data: { name: ROLE } });
  expect(made.status(), await made.text()).toBe(201);
  roleId = ((await made.json()) as { id: string }).id;
  const granted = await page.request.put(`/api/v1/roles/${roleId}/permissions`, { data: { grants: ['system:settings:manage'] } });
  expect(granted.ok(), await granted.text()).toBe(true);
  const users = (await (await page.request.get('/api/v1/users?q=e2e-campaigner')).json()) as { users?: { id: string; email: string }[] };
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
  // The campaign, made by the marketer: a marketing e-mail.
  const created = await own.request.post('/api/v1/email-templates', { data: { kind: 'campaign', name: 'July news', starter: null } });
  expect(created.status(), await created.text()).toBe(201);
  campaignId = ((await created.json()) as { id: string }).id;
  await context.close();
  await page.close();
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage({ baseURL: BASE_URL, storageState: test.info().project.use.storageState as string });
  await signIn(page);
  if (campaignId !== '') await page.request.delete(`/api/v1/email-templates/${campaignId}`).catch(() => undefined);
  if (marketer !== undefined) await page.request.delete(`/api/v1/users/${marketer.id}`).catch(() => undefined);
  if (roleId !== '') await page.request.delete(`/api/v1/roles/${roleId}`).catch(() => undefined);
  await page.close();
});

test('the rail offers the marketer Email templates; a marketing e-mail shows its locked footer', async ({ browser }) => {
  const { page, close } = await asMarketer(browser);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Email templates' }).click();
  await expect(page).toHaveURL(/\/email-templates/);
  const patched = await page.request.patch(`/api/v1/email-templates/${campaignId}`, { data: { category: 'marketing' } });
  expect(patched.ok(), await patched.text()).toBe(true);
  await page.goto(`/email-templates/${campaignId}`);
  await expect(page.getByTestId('email-locked-footer')).toContainText('Unsubscribe from');
  await page.getByTestId('email-section-footer').click();
  await expect(page.getByTestId('email-locked-rows')).toContainText('Added to every marketing mail. You can’t remove them.');
  await shot(page, 'footer-desktop');
  await close();
});

test('the send dialog to a table: the breakdown, the review, the refusals and masked addresses', async ({ browser }) => {
  const { page, close } = await asMarketer(browser);
  const audience: Audience = {};
  await routeAudience(page, () => audience);
  await page.goto(`/email-templates/${campaignId}`);
  await page.getByTestId('email-send').click();
  const dialog = page.getByRole('dialog', { name: 'Send campaign' });
  await expect(dialog.getByTestId('email-send-breakdown-consent')).toContainText('may be e-mailed for the Newsletter');
  await expect(dialog.getByText('Where the law allows it. Dana Whitlock turned this on for Contacts on')).toBeVisible();
  await dialog.getByRole('switch', { name: 'Also existing customers who didn’t tick' }).click();
  await expect(dialog.getByTestId('email-send-breakdown-existing')).toContainText('+ 58');
  await expect(dialog.getByTestId('email-send-estimate')).toHaveText('About 5 hours for 470 people.');
  await expect(dialog.getByTestId('email-campaign-count')).toHaveText('470 recipients · 782 skipped');
  await shot(page, 'send-1a-desktop');

  // 1b: three ticked before records were kept.
  audience.awaitingReview = 3;
  await dialog.getByRole('radio', { name: 'Surveys' }).click();
  await dialog.getByRole('radio', { name: 'Newsletter' }).click();
  await expect(dialog.getByTestId('email-send-review-card')).toBeVisible();
  await expect(dialog.getByTestId('email-campaign-send')).toBeDisabled();
  await dialog.getByTestId('email-send-review-card').scrollIntoViewIfNeeded();
  await shot(page, 'send-1b-desktop');
  await dialog.getByTestId('email-send-review-open').click();
  const review = page.getByRole('dialog', { name: 'Review the 3' });
  await review.getByTestId('email-review-confirm').first().click();
  await expect(review.getByTestId('email-review-count')).toHaveText('1 confirmed · 0 left out · 2 to decide');
  await review.getByTestId('email-review-undo').click();
  await review.getByTestId('email-review-leave-out').first().click();
  await expect(review.getByTestId('email-review-answer')).toHaveText('Left out');
  await shot(page, 'send-1b-review-desktop');
  audience.awaitingReview = 0;
  await review.getByTestId('email-review-done').click();
  await expect(dialog.getByTestId('email-send-review-card')).toHaveCount(0);

  // 1c: the sender is not ready.
  audience.refusals = ['no-postal-address', 'free-mail-from', 'no-dmarc', 'no-public-address'];
  await dialog.getByRole('radio', { name: 'Surveys' }).click();
  const refusals = dialog.getByTestId('email-send-refusals');
  await expect(refusals.getByTestId('email-send-refusal')).toHaveCount(4);
  await expect(refusals.getByRole('link', { name: 'Add address' })).toHaveAttribute('href', '/studio/settings#marketing-postal-address');
  await expect(refusals).toContainText('news@gmail.com can’t send marketing mail. Use an address at your own domain.');
  await expect(dialog.getByTestId('email-campaign-send')).toBeDisabled();
  await refusals.scrollIntoViewIfNeeded();
  await expect(refusals).toBeVisible();
  await shot(page, 'send-1c-desktop');

  // 1d: addresses masked: nothing about the table shows.
  audience.refusals = [];
  audience.addresses = 'masked';
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByTestId('email-send').click();
  await expect(dialog.getByTestId('email-send-refused')).toHaveText('You see the addresses in Contacts masked, so you can’t send to it.');
  await expect(dialog.getByTestId('email-send-breakdown')).toHaveCount(0);
  await dialog.getByTestId('email-send-refused').scrollIntoViewIfNeeded();
  await shot(page, 'send-1d-desktop');
  await close();
});

test('phone, dark and Arabic: the send dialog', async ({ browser }) => {
  const audience: Audience = {};
  const phone = await asMarketer(browser, { viewport: { width: 375, height: 812 } });
  await routeAudience(phone.page, () => audience);
  await phone.page.goto(`/email-templates/${campaignId}`);
  await phone.page.getByTestId('email-send').click();
  await expect(phone.page.getByTestId('email-send-breakdown')).toBeVisible();
  await shot(phone.page, 'send-1a-phone');
  await phone.close();

  const dark = await asMarketer(browser, { colorScheme: 'dark' });
  await routeAudience(dark.page, () => audience);
  await dark.page.goto(`/email-templates/${campaignId}`);
  await dark.page.getByTestId('email-send').click();
  await expect(dark.page.getByTestId('email-send-breakdown')).toBeVisible();
  await shot(dark.page, 'send-1a-dark');
  await dark.close();

  const arabic = await asMarketer(browser);
  expect((await arabic.page.request.patch('/api/v1/me/prefs', { data: { locale: 'ar_EG' } })).ok()).toBe(true);
  try {
    await routeAudience(arabic.page, () => audience);
    await arabic.page.goto(`/email-templates/${campaignId}`);
    await expect(arabic.page.locator('html')).toHaveAttribute('dir', 'rtl');
    await arabic.page.getByTestId('email-send').click();
    await expect(arabic.page.getByTestId('email-send-breakdown')).toContainText('يمكن مراسلتهم');
    await shot(arabic.page, 'send-1a-arabic');
  } finally {
    await arabic.page.request.patch('/api/v1/me/prefs', { data: { locale: 'en_US' } });
    await arabic.close();
  }
});

test('a real send at one an hour: Sending, Pause, Paused, Go on, and Stop through its confirm', async ({ browser }) => {
  const { page, close } = await asMarketer(browser);
  await page.goto(`/email-templates/${campaignId}`);
  await page.getByTestId('email-send').click();
  const dialog = page.getByRole('dialog', { name: 'Send campaign' });
  await dialog.getByRole('radio', { name: 'Workspace users' }).click();
  await expect(dialog.getByTestId('email-campaign-count')).toContainText('recipients');
  await dialog.getByTestId('email-send-rate').fill('1');
  await dialog.getByTestId('email-campaign-send').click();
  await expect(page.getByText('Campaign sent!')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // The first batch hands one over; the rest wait for the next hour.
  await expect(page.getByTestId('email-run-count')).toHaveText(/^Sending · 1 of \d+$/, { timeout: 60_000 });
  await expect(page.getByTestId('email-run-strip')).toHaveText('Changes you make now apply to the next send, not this one.');
  await shot(page, 'run-sending-desktop');
  await page.getByTestId('email-run-pause').click();
  await expect(page.getByTestId('email-run-count')).toHaveText(/^Paused · 1 of \d+$/);
  await shot(page, 'run-paused-desktop');
  await page.getByTestId('email-run-resume').click();
  await expect(page.getByTestId('email-run-count')).toHaveText(/^Sending · 1 of \d+$/);
  await page.getByTestId('email-run-stop').click();
  const confirm = page.getByRole('alertdialog', { name: 'Stop for good?' });
  await expect(confirm.getByTestId('email-run-keep')).toBeFocused();
  await shot(page, 'run-stop-confirm-desktop');
  await confirm.getByTestId('email-run-stop-confirm').click();
  await expect(page.getByText(/^Stopped\. \d+ (person|people) won’t get it\.$/)).toBeVisible();
  await expect(page.getByTestId('email-run-chip')).toHaveCount(0);
  await close();
});

test('the send log of that run: the summary, a filter and the search, on desktop, phone, dark and Arabic', async ({ browser }) => {
  const { page, close } = await asMarketer(browser);
  await page.goto(`/email-templates/${campaignId}`);
  await page.getByTestId('email-view-log').click();
  const log = page.getByTestId('email-send-log');
  await expect(log.getByTestId('email-log-summary-sent')).toHaveText('Sent1');
  // Stopped for good: the rest were not sent, and say so.
  await expect(log.getByTestId('email-log-summary-waiting')).toContainText('Not sent');
  await shot(page, 'log-desktop');
  await log.getByRole('radio', { name: 'Sent', exact: true }).click();
  await expect(log.getByRole('table', { name: 'Send log' }).getByTestId('email-log-row')).toHaveCount(1);
  await log.getByRole('radio', { name: 'Not sent' }).click();
  await expect(log.getByRole('table', { name: 'Send log' }).getByTestId('email-log-state').first()).toHaveText('Not sent — the send was stopped');
  await log.getByRole('radio', { name: 'All' }).click();
  await log.getByTestId('email-log-search').fill('no-such-person');
  await expect(log.getByText('Nobody in this state.').first()).toBeVisible();
  await close();

  const phone = await asMarketer(browser, { viewport: { width: 375, height: 812 } });
  await phone.page.goto(`/email-templates/${campaignId}`);
  await phone.page.getByTestId('email-view-log').click();
  await expect(phone.page.getByTestId('email-log-item').first()).toBeVisible();
  await shot(phone.page, 'log-phone');
  await phone.close();

  const dark = await asMarketer(browser, { colorScheme: 'dark' });
  await dark.page.goto(`/email-templates/${campaignId}`);
  await dark.page.getByTestId('email-view-log').click();
  await expect(dark.page.getByTestId('email-log-summary')).toBeVisible();
  await shot(dark.page, 'log-dark');
  await dark.close();

  const arabic = await asMarketer(browser);
  expect((await arabic.page.request.patch('/api/v1/me/prefs', { data: { locale: 'ar_EG' } })).ok()).toBe(true);
  try {
    await arabic.page.goto(`/email-templates/${campaignId}`);
    await arabic.page.getByTestId('email-view-log').click();
    await expect(arabic.page.getByTestId('email-log-summary')).toContainText('أُرسل');
    await shot(arabic.page, 'log-arabic');
  } finally {
    await arabic.page.request.patch('/api/v1/me/prefs', { data: { locale: 'en_US' } });
    await arabic.close();
  }
});
