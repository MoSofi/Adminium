// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A person's e-mail consent on their record page, as a marketer who may
 * change customers and is not an Admin (no setting, no unmasked columns),
 * and a rule's e-mail step as a kind of mail, as the owner.
 *
 *  1. The record page shows "E-mail consent" below the tabs. An app that
 *     declares a people table needs Adminium 0.3.38, which this server
 *     (0.3.37) refuses to install, so the panel's reply is the server's own
 *     with `declared` set (`page.route`); everything else in it, and every
 *     write, is the server's. "Replied" says what it does, asks, writes, and
 *     its line shows with a toast; "Record consent" writes the purpose, how
 *     and note chosen, and its line and badge show. The dialog names the
 *     person and never an address.
 *  2. A rule's e-mail to the record's own address: "Kind of mail" starts as
 *     marketing mail about the newsletter, "Why you're writing" changes it,
 *     the canvas says it under the step, a later marketing mail says it is
 *     checked again, a step saved before steps could say reads as service
 *     mail, and what is saved carries the class and the purpose.
 *
 * Screenshots (desktop, phone, dark, Arabic) go to `E2E_SHOTS` when it is set.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { BASE_URL } from './constants.js';
import { recordPage, seededConnectionId, signIn } from './helpers.js';

const MARKETER = { email: 'e2e-consent@adminium.local', name: 'Mia Marketer', password: 'adminium-e2e-consent-pass' };
const ROLE = 'E2E consent';
const RULE = 'E2E kind of mail';
const SHOTS = process.env['E2E_SHOTS'] ?? '';

let marketer: { id: string; cookies: Awaited<ReturnType<BrowserContext['cookies']>> } | undefined;
let roleId = '';
let ruleId = '';
let connectionId = '';
let customers = '';

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS === '') return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

async function asMarketer(browser: Browser, options: { viewport?: { width: number; height: number }; colorScheme?: 'light' | 'dark' } = {}): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: marketer!.cookies, origins: [] }, viewport: options.viewport ?? { width: 1440, height: 900 }, colorScheme: options.colorScheme ?? 'light' });
  const page = await context.newPage();
  // The server's own panel, with `declared` set (see the header): a CRM's Contacts on 0.3.38.
  await page.route('**/api/v1/consent/panel', async (route) => {
    const answer = await route.fetch();
    const body = (await answer.json()) as { data?: Record<string, unknown> };
    await route.fulfill({ response: answer, json: body.data === undefined ? body : { data: { ...body.data, declared: true } } });
  });
  return { page, close: () => context.close() };
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage({ baseURL: BASE_URL, storageState: test.info().project.use.storageState as string });
  await signIn(page);
  connectionId = await seededConnectionId(page);
  const pages = (await (await page.request.get('/api/v1/pages')).json()) as { data: { id: string; slug: string }[] };
  const customersPage = pages.data.find((one) => one.slug === 'customers')!;
  const envelope = (await (await page.request.get(`/api/v1/pages/${customersPage.id}`)).json()) as { data: { source: { table: string } } };
  customers = envelope.data.source.table;

  const roles = ((await (await page.request.get('/api/v1/roles')).json()) as { roles: { id: string; name: string }[] }).roles;
  for (const one of roles) if (one.name === ROLE) await page.request.delete(`/api/v1/roles/${one.id}`);
  const made = await page.request.post('/api/v1/roles', { data: { name: ROLE } });
  expect(made.status(), await made.text()).toBe(201);
  roleId = ((await made.json()) as { id: string }).id;
  // Reads and changes customers, shown their personal columns masked; no setting, no Admin.
  const grants = [`page:${customersPage.id}:view`, `table:${connectionId}:${customers}:read`, `table:${connectionId}:${customers}:update`];
  const granted = await page.request.put(`/api/v1/roles/${roleId}/permissions`, { data: { grants } });
  expect(granted.ok(), await granted.text()).toBe(true);

  const users = (await (await page.request.get('/api/v1/users?q=e2e-consent')).json()) as { users?: { id: string; email: string }[] };
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

  // A rule of the owner's: send, wait three days, send; and a step saved before steps could say their kind.
  const mail = (id: string, more: Record<string, unknown>) => ({ id, kind: 'action', title: id === 'first' ? 'Thanks for visiting' : id === 'second' ? 'Your options' : 'Old receipt', onError: false, action: { kind: 'email', templateKey: null, to: null, vars: {}, ...more } });
  const rules = (await (await page.request.get('/api/v1/automations')).json()) as { rules: { id: string; name: string }[] };
  for (const one of rules.rules) if (one.name === RULE) await page.request.delete(`/api/v1/automations/${one.id}`);
  const rule = await page.request.post('/api/v1/automations', {
    data: {
      name: RULE,
      connectionId,
      enabled: false,
      trigger: { kind: 'record', event: 'created', connectionId, table: customers },
      graph: {
        version: 1,
        nodes: [
          { id: 't', kind: 'trigger', title: 'A customer is added' },
          mail('first', { to: { kind: 'field', column: 'contact_name' }, class: 'marketing', purpose: 'newsletter' }),
          { id: 'wait', kind: 'wait', title: 'Wait 3 days', amount: 3, unit: 'days' },
          mail('second', {}),
          mail('older', { to: { kind: 'field', column: 'contact_name' } }),
        ],
      },
    },
  });
  expect(rule.status(), await rule.text()).toBe(201);
  ruleId = ((await rule.json()) as { id: string }).id;
  await page.close();
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage({ baseURL: BASE_URL, storageState: test.info().project.use.storageState as string });
  await signIn(page);
  if (ruleId !== '') await page.request.delete(`/api/v1/automations/${ruleId}`).catch(() => undefined);
  if (marketer !== undefined) await page.request.delete(`/api/v1/users/${marketer.id}`).catch(() => undefined);
  if (roleId !== '') await page.request.delete(`/api/v1/roles/${roleId}`).catch(() => undefined);
  await page.close();
});

test('the marketer sees a customer\'s e-mail consent, presses Replied and records consent', async ({ browser }) => {
  const { page, close } = await asMarketer(browser);
  const panels: string[] = [];
  page.on('response', async (response) => {
    if (response.url().endsWith('/api/v1/consent/panel')) panels.push(await response.text().catch(() => ''));
  });
  await page.goto('/p/customers/r/BLONP');
  const panel = recordPage(page).getByTestId('consent-panel');
  await expect(panel.getByRole('heading', { name: 'E-mail consent' })).toBeVisible();
  await expect(panel.getByTestId('consent-badge-newsletter')).toHaveText(/Not asked|May be e-mailed/);
  // Northwind's customers keep no address: the panel says so, and offers no "They said no".
  await expect(panel.getByTestId('consent-no-address')).toHaveText('This record has no e-mail address yet.');
  await expect(panel.getByTestId('consent-said-no')).toHaveCount(0);
  await shot(page, 'panel-desktop');

  // "Replied": described, asked, written.
  const replied = panel.getByTestId('consent-replied');
  await expect(replied).toHaveAccessibleDescription('They replied to a marketing e-mail. This stops their e-mail sequences.');
  await replied.click();
  const confirm = page.getByRole('alertdialog', { name: 'Mark as replied?' });
  await expect(confirm).toContainText('This stops their e-mail sequences.');
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await shot(page, 'replied-confirm-desktop');
  await confirm.getByRole('button', { name: 'Mark as replied' }).click();
  await expect(page.getByText('Marked as replied. Their e-mail sequences stop.')).toBeVisible();
  await expect(panel.getByTestId('consent-history')).toContainText(`Replied — e-mail sequences stopped`);
  await expect(panel.getByTestId('consent-history')).toContainText(`by ${MARKETER.name}`);

  // "Record consent": the purpose, how and the note.
  await panel.getByTestId('consent-record').click();
  const dialog = page.getByRole('dialog', { name: 'Record consent' });
  await expect(dialog.getByTestId('consent-dialog-who')).toHaveText('Blondesddsl père et fils');
  await dialog.getByRole('radio', { name: 'Surveys' }).click();
  await dialog.getByRole('radio', { name: 'By phone' }).click();
  await expect(dialog.getByRole('radio', { name: 'By phone' })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByTestId('consent-dialog-note').fill('Rang the shop');
  // The chips' colour change takes 150 ms: the picture waits for it.
  await page.waitForTimeout(400);
  await shot(page, 'record-consent-desktop');
  await dialog.getByTestId('consent-dialog-save').click();
  await expect(page.getByText('Consent recorded: Surveys.')).toBeVisible();
  await expect(panel.getByTestId('consent-badge-surveys')).toHaveText('May be e-mailed');
  await expect(panel.getByTestId('consent-history')).toContainText(`Agreed by phone, recorded by ${MARKETER.name}`);
  await expect(panel.getByTestId('consent-history')).toContainText('“Rang the shop”');
  await shot(page, 'panel-after-desktop');
  // No reply the panel read carried an address.
  for (const body of panels) expect(body).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
  await close();
});

test('the panel on a phone, in dark, and in Arabic', async ({ browser }) => {
  const phone = await asMarketer(browser, { viewport: { width: 390, height: 844 } });
  await phone.page.goto('/p/customers/r/BLONP');
  const panel = recordPage(phone.page).getByTestId('consent-panel');
  await expect(panel).toBeVisible();
  const replied = await panel.getByTestId('consent-replied').boundingBox();
  // 44 px high, side by side with Record consent.
  expect(Math.round(replied?.height ?? 0)).toBe(44);
  await panel.scrollIntoViewIfNeeded();
  await shot(phone.page, 'panel-phone');
  await phone.close();

  const dark = await asMarketer(browser, { colorScheme: 'dark' });
  await dark.page.goto('/p/customers/r/BLONP');
  await expect(recordPage(dark.page).getByTestId('consent-panel')).toBeVisible();
  await shot(dark.page, 'panel-dark');
  await dark.close();

  const arabic = await asMarketer(browser);
  expect((await arabic.page.request.patch('/api/v1/me/prefs', { data: { locale: 'ar_EG' } })).ok()).toBe(true);
  try {
    await arabic.page.goto('/p/customers/r/BLONP');
    await expect(arabic.page.locator('html')).toHaveAttribute('dir', 'rtl');
    const shown = recordPage(arabic.page).getByTestId('consent-panel');
    await expect(shown.getByRole('heading', { name: 'موافقة البريد الإلكتروني' })).toBeVisible();
    await expect(shown.getByTestId('consent-replied')).toHaveText('تمّ الردّ');
    await expect(shown.getByRole('heading', { name: 'موافقة البريد الإلكتروني' })).toHaveCSS('letter-spacing', 'normal');
    await shot(arabic.page, 'panel-arabic');
  } finally {
    await arabic.page.request.patch('/api/v1/me/prefs', { data: { locale: 'en_US' } });
    await arabic.close();
  }
});

test('a rule\'s e-mail step says its kind of mail, and saves it', async ({ page }) => {
  await signIn(page);
  await page.goto(`/automations?rule=${ruleId}`);
  const node = (id: string) => page.getByTestId(`flow-node-${id}`);
  await expect(node('first').getByTestId('flow-node-mail-kind')).toHaveText('Marketing mail · Newsletter');
  // Saved before steps could say: it goes as service mail, and both the canvas and the step say so.
  await expect(node('older').getByTestId('flow-node-mail-kind')).toHaveText('Service mail');
  await node('older').click();
  await expect(page.getByTestId('email-class-unsaid')).toHaveText('Saved before mail had kinds: it goes as service mail until you choose.');
  // The step's settings open as a sheet over the canvas: closed before another step is picked.
  await page.keyboard.press('Escape');

  // The second e-mail goes to the record's own address: marketing about the newsletter, to begin with.
  await node('second').click();
  await page.getByTestId('email-to-kind').selectOption('field');
  const kind = page.getByTestId('email-class');
  await expect(kind.getByRole('radio', { name: 'Marketing mail' })).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('email-purpose').getByRole('radio', { name: 'Surveys' }).click();
  await expect(node('second').getByTestId('flow-node-mail-kind')).toHaveText('Marketing mail · Surveys');
  await expect(node('second').getByTestId('flow-node-recheck')).toHaveText('Checks consent and the do-not-email list again when it sends.');
  await expect(node('first').getByTestId('flow-node-recheck')).toHaveCount(0);
  await shot(page, 'step-desktop');
  await page.keyboard.press('Escape');
  await node('second').scrollIntoViewIfNeeded();
  await shot(page, 'step-canvas-desktop');
  const patched = page.waitForResponse((response) => response.url().endsWith(`/api/v1/automations/${ruleId}`) && response.request().method() === 'PATCH');
  await page.getByTestId('rule-save').click();
  expect((await patched).ok()).toBe(true);

  const saved = (await (await page.request.get(`/api/v1/automations/${ruleId}`)).json()) as { graph: { nodes: { id: string; action?: Record<string, unknown> }[] } };
  const actions = Object.fromEntries(saved.graph.nodes.map((one) => [one.id, one.action]));
  expect(actions['second']).toMatchObject({ to: { kind: 'field' }, class: 'marketing', purpose: 'surveys' });
  expect(actions['first']).toMatchObject({ class: 'marketing', purpose: 'newsletter' });
  expect(actions['older']).not.toHaveProperty('class');

  // Service mail has no purpose.
  await node('second').click();
  await page.getByTestId('email-class').getByRole('radio', { name: 'Service mail' }).click();
  await expect(page.getByTestId('email-purpose')).toHaveCount(0);
  await expect(node('second').getByTestId('flow-node-mail-kind')).toHaveText('Service mail');
});

test('the step on a phone, in dark, and in Arabic', async ({ browser }) => {
  const owner = { storageState: test.info().project.use.storageState as string, baseURL: BASE_URL };
  for (const [name, options] of [
    ['step-phone', { viewport: { width: 390, height: 844 } }],
    ['step-dark', { colorScheme: 'dark' as const }],
  ] as const) {
    const context = await browser.newContext({ ...owner, ...options });
    const page = await context.newPage();
    await page.goto(`/automations?rule=${ruleId}`);
    await page.getByTestId('flow-node-first').click();
    await expect(page.getByTestId('email-class')).toBeVisible();
    await shot(page, name);
    await context.close();
  }
  const context = await browser.newContext(owner);
  const page = await context.newPage();
  expect((await page.request.patch('/api/v1/me/prefs', { data: { locale: 'ar_EG' } })).ok()).toBe(true);
  try {
    await page.goto(`/automations?rule=${ruleId}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByTestId('flow-node-first').click();
    await expect(page.getByTestId('email-class').getByRole('radio', { name: 'بريد تسويقي' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('flow-node-first').getByTestId('flow-node-mail-kind')).toHaveText('بريد تسويقي · النشرة الإخبارية');
    await shot(page, 'step-arabic');
  } finally {
    await page.request.patch('/api/v1/me/prefs', { data: { locale: 'en_US' } });
    await context.close();
  }
});
