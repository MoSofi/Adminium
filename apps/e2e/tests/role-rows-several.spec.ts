// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Several reaches for one action, in the Roles page's "Rows" dialog.
 *
 * An app may give one role two reaches for a read, any one enough: an
 * account manager reads every won deal, and an open one while he is listed
 * on it. The dialog cannot draw that as one choice, so it says each reach in
 * words, one line each, under a sentence that says any one is enough and the
 * app set them; there is nothing to pick there, and the actions it does draw
 * stay the dialog's. A listing that counts only while a column of it is
 * empty says so where the table says whose its rows are.
 *
 * Here on the seeded Northwind orders, made to say whose their rows are for
 * the length of the file (the customer in `customer_id`, or anyone a customer
 * row lists while its region is empty), with a role saved through the API as
 * an app's install writes it. Shown with the mouse and with the keyboard,
 * right to left in Arabic, at 390 wide, and dark.
 */
import { expect, test, type Page } from '@playwright/test';

import { seededConnectionId, signIn } from './helpers.js';

const ROLE = 'E2E several reaches';
const SLUG = 'e2e-several-reaches';
const ARABIC = /[؀-ۿ]/;

type Override = { op: string; tableName: string; columnName?: string; value: unknown; status?: string };

let connectionId = '';
let orders = '';
let customers = '';
let kept: Override[] = [];
let roleId = '';

async function tables(page: Page): Promise<{ id: string; name: string }[]> {
  const res = await page.request.get(`/api/v1/connections/${connectionId}/schema`);
  expect(res.ok(), await res.text()).toBe(true);
  const body = (await res.json()) as { tables?: { id: string; name: string }[]; model?: { tables: { id: string; name: string }[] }; data?: { tables: { id: string; name: string }[] } };
  return body.tables ?? body.model?.tables ?? body.data?.tables ?? [];
}

async function putOverrides(page: Page, overrides: Override[]): Promise<void> {
  const res = await page.request.put(`/api/v1/connections/${connectionId}/overrides`, { data: { overrides } });
  expect(res.ok(), await res.text()).toBe(true);
}

async function openRows(page: Page): Promise<void> {
  await page.goto('/settings/roles');
  await page.getByTestId(`roles-rows-${SLUG}`).click();
  await expect(page.getByTestId('roles-rows-tables')).toBeVisible();
}

async function setLocale(page: Page, value: 'ar_EG' | 'en_US'): Promise<void> {
  const res = await page.request.patch('/api/v1/me/prefs', { data: { locale: value } });
  expect(res.ok(), await res.text()).toBe(true);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  connectionId = await seededConnectionId(page);
  const all = await tables(page);
  orders = all.find((table) => table.name === 'orders')!.id;
  customers = all.find((table) => table.name === 'customers')!.id;
  const res = await page.request.get(`/api/v1/connections/${connectionId}/overrides`);
  const held = (await res.json()) as { overrides: (Override & { columnName: string | null })[] };
  kept = held.overrides.map((one) => ({ op: one.op, tableName: one.tableName, ...(one.columnName === null ? {} : { columnName: one.columnName }), value: one.value, ...(one.status === undefined ? {} : { status: one.status }) }));
  await putOverrides(page, [
    ...kept,
    { op: 'column.staff', tableName: orders, columnName: 'customer_id', value: { staff: true } },
    { op: 'column.staff', tableName: customers, columnName: 'contact_name', value: { staff: true } },
    {
      op: 'table.belongs',
      tableName: orders,
      value: { ways: [{ column: 'customer_id' }, { through: { table: customers, link: 'customer_id', on: 'customer_id', user: 'contact_name', while: { column: 'region', isNull: true } } }] },
    },
  ]);
  const made = await page.request.post('/api/v1/roles', { data: { name: ROLE } });
  expect(made.status(), await made.text()).toBe(201);
  roleId = ((await made.json()) as { id: string }).id;
  const grants = [`table:${connectionId}:${orders}:read`, `table:${connectionId}:${orders}:update`];
  const rows = { [`${connectionId}/${orders}`]: { read: [{ reach: 'all', while: { column: 'ship_country', in: ['Germany'] } }, { reach: 'own' }] } };
  const saved = await page.request.put(`/api/v1/roles/${roleId}/permissions`, { data: { grants, rows } });
  expect(saved.ok(), await saved.text()).toBe(true);
  await page.close();
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  await setLocale(page, 'en_US').catch(() => undefined);
  if (roleId !== '') await page.request.delete(`/api/v1/roles/${roleId}`).catch(() => undefined);
  await putOverrides(page, kept);
  await page.close();
});

test('says each reach in words with nothing to pick, keeps the actions it draws, and says when a listing counts', async ({ page }) => {
  await signIn(page);
  await openRows(page);
  const card = page.getByTestId(`roles-rows-table-${orders}`);
  await expect(card).toContainText('while region is empty');
  const several = page.getByTestId(`roles-rows-${orders}-read-several`);
  await expect(several).toContainText('Any one of these is enough.');
  await expect(page.getByTestId(`roles-rows-${orders}-read-sentence`).getByRole('listitem')).toHaveText(['Every row, only while ship_country is Germany.', 'Only rows that belong to this person.']);
  await expect(page.getByTestId(`roles-rows-${orders}-read`)).toHaveCount(0);
  await expect(page.getByTestId(`roles-rows-${orders}-update`)).toBeVisible();
  // Tried as a person: counted whole, both reaches together.
  await page.getByTestId('roles-rows-person').selectOption({ index: 1 });
  await expect(page.getByTestId(`roles-rows-${orders}-count`)).toContainText(/would see \d+ of \d+/);
});

test('is walked with the keyboard: the reaches take no stop, the next choice does, and Escape closes', async ({ page }) => {
  await signIn(page);
  await openRows(page);
  await page.getByTestId('roles-rows-person').focus();
  const update = page.getByTestId(`roles-rows-${orders}-update`);
  let reached = false;
  for (let step = 0; step < 40 && !reached; step += 1) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate((id) => document.querySelector(`[data-testid="roles-rows-${id}-read-several"]`)?.contains(document.activeElement) ?? false, orders);
    expect(inside).toBe(false);
    reached = await update.evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('roles-rows-tables')).toHaveCount(0);
});

test('reads right to left in Arabic', async ({ page }) => {
  await signIn(page);
  await setLocale(page, 'ar_EG');
  try {
    await openRows(page);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const several = page.getByTestId(`roles-rows-${orders}-read-several`);
    await expect(several).toContainText(ARABIC);
    await expect(several).toContainText('يكفي');
    expect(await several.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
    await expect(page.getByTestId(`roles-rows-table-${orders}`)).toContainText('ما دام');
  } finally {
    await setLocale(page, 'en_US');
  }
});

test('fits 390 wide, dark, without the page scrolling sideways', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', storageState: test.info().project.use.storageState as string });
  const page = await context.newPage();
  try {
    // Signed in by the saved session: at 390 wide the primary navigation is a drawer, so there is no bar to wait for.
    await openRows(page);
    const list = page.getByTestId(`roles-rows-${orders}-read-sentence`);
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await list.scrollIntoViewIfNeeded();
    const box = await list.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Dark: the words are light on a dark dialog, not the light theme's ink.
    const [ink, ground] = await list.evaluate((el) => {
      const luminance = (color: string): number => {
        const [r, g, b] = (color.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).map(Number);
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      let node: Element | null = el;
      let background = 'rgba(0, 0, 0, 0)';
      while (node !== null && /rgba\(0, 0, 0, 0\)|transparent/.test(background)) {
        background = getComputedStyle(node).backgroundColor;
        node = node.parentElement;
      }
      return [luminance(getComputedStyle(el).color), luminance(background)];
    });
    expect(ink).toBeGreaterThan(ground);
  } finally {
    await context.close();
  }
});
