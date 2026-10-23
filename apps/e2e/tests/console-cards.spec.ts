// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's console cards, as a browser draws them: a table card's headings in
 * the reader's language, a chart's "Show data" and a board's headings writing
 * a money column as money, and a dashboard drawn whole without the card of a
 * part that is off. Each in English, light and wide, and in Arabic, right to
 * left, dark and 390 pixels wide, with the keyboard.
 *
 * THE PAGES are real pages over Northwind's `orders`, made through the pages
 * API, and every read of rows, figures and facts is the real server's. Freight
 * is made money the way an app's manifest declares a column money (a
 * `column.semanticType` rule, put through the connection's own rules route and
 * put back after), so the server's column facts and the chart's answer say so
 * for real. The board is the page's envelope read as a board with the stored
 * form of an app's `config.board`, as `board-content.spec.ts` reads it.
 *
 * THE PART THAT IS OFF: a card says its part (`module`), and the page's own
 * reply is handed to the dashboard as the server serves it while that part is
 * off, without the card. The words that make an app's parts are read from the
 * release to come, which the server under test is not yet, so no manifest
 * that says them installs here; which cards the server serves, to whom, and
 * what a layout saved meanwhile keeps, is proved against the whole server on
 * three engines (`apps/server/test/console-cards.test.ts`).
 */
import { expect, test, type Page } from '@playwright/test';

import { seededConnectionId, signIn as signInAsOwner } from './helpers.js';

const DASH_SLUG = 'e2e-console-cards';
const BOARD_SLUG = 'e2e-console-board';

interface Override {
  op: string;
  tableName: string;
  columnName: string | null;
  value: unknown;
  status?: string;
}

async function pageIdOf(page: Page, slug: string): Promise<string | undefined> {
  const reply = await page.request.get('/api/v1/pages');
  const { data } = (await reply.json()) as { data: { id: string; slug: string }[] };
  return data.find((entry) => entry.slug === slug)?.id;
}

async function tableId(page: Page, slug: string): Promise<string> {
  const one = await page.request.get(`/api/v1/pages/${String(await pageIdOf(page, slug))}`);
  return ((await one.json()) as { data: { source: { table: string } } }).data.source.table;
}

async function removePage(page: Page, slug: string): Promise<void> {
  const id = await pageIdOf(page, slug);
  if (id !== undefined) await page.request.delete(`/api/v1/pages/${id}`).catch(() => undefined);
}

async function makePage(page: Page, slug: string, title: string, template: string, connectionId: string, table: string, body: Record<string, unknown> | null): Promise<string> {
  await removePage(page, slug);
  const made = await page.request.post('/api/v1/pages', { data: { slug, title, template, navGroup: 'workspace', connectionId, table } });
  expect(made.ok(), await made.text()).toBe(true);
  const id = ((await made.json()) as { data: { id: string } }).data.id;
  if (body !== null) {
    const stored = await page.request.patch(`/api/v1/pages/${id}/config`, { data: { config: body } });
    expect(stored.ok(), await stored.text()).toBe(true);
  }
  return id;
}

async function rules(page: Page, connectionId: string): Promise<Override[]> {
  const reply = await page.request.get(`/api/v1/connections/${connectionId}/overrides`);
  expect(reply.ok(), await reply.text()).toBe(true);
  return ((await reply.json()) as { overrides: Override[] }).overrides.map(({ op, tableName, columnName, value, status }) => ({ op, tableName, columnName, value, ...(status === undefined ? {} : { status }) }));
}

async function putRules(page: Page, connectionId: string, overrides: Override[]): Promise<void> {
  const reply = await page.request.put(`/api/v1/connections/${connectionId}/overrides`, { data: { overrides } });
  expect(reply.ok(), await reply.text()).toBe(true);
}

const card = (page: Page, key: string) => page.locator(`[data-grid-item="${key}"]`);
const column = (page: Page, label: string) => page.locator('[data-board-column]').filter({ has: page.getByText(label, { exact: true }) });

const COMBOS = [
  { name: 'English, light, wide', theme: 'light', locale: null, width: 1280, dir: 'ltr', headings: ['Order', 'Ship to', 'Freight'] },
  { name: 'Arabic, dark, 390 wide', theme: 'dark', locale: 'ar_EG', width: 390, dir: 'rtl', headings: ['الطلب', 'يُشحن إلى', 'أجرة الشحن'] },
] as const;

test.describe.configure({ mode: 'serial' });

test.describe('an app’s console cards', () => {
  let connectionId = '';
  let dashId = '';
  let boardId = '';
  let boardBody: Record<string, unknown> = {};
  let before: Override[] = [];

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    connectionId = await seededConnectionId(page);
    const orders = await tableId(page, 'orders');
    const shippers = await tableId(page, 'shippers');
    const [schema, name] = orders.includes('.') ? (orders.split('.') as [string, string]) : [undefined, orders];
    const source = { name, type: 'table', ...(schema === undefined || schema === 'main' ? {} : { schema }) };
    // Freight is money, as an app declares a column money: the rule its install writes.
    before = await rules(page, connectionId);
    await putRules(page, connectionId, [...before.filter((rule) => !(rule.op === 'column.semanticType' && rule.columnName === 'freight')), { op: 'column.semanticType', tableName: orders, columnName: 'freight', value: { semanticType: 'money' } }]);
    dashId = await makePage(page, DASH_SLUG, 'Console cards', 'page-dashboard', connectionId, orders, {
      layout: {
        version: 1,
        items: [
          {
            i: 'by-shipper',
            widget: 'chart-bar',
            x: 0,
            y: 0,
            w: 6,
            h: 6,
            config: {
              title: 'Freight by shipper',
              titles: { 'ar-EG': 'أجرة الشحن حسب الشركة' },
              series: [{ label: 'Orders', labels: { 'ar-EG': 'الطلبات' } }, { label: 'Freight', labels: { 'ar-EG': 'أجرة الشحن' } }],
              binding: { kind: 'table-query', connectionId, source, shape: 'categorical', groupBy: ['ship_via'], aggregations: [{ fn: 'count', alias: 'orders' }, { fn: 'sum', column: 'freight', alias: 'freight' }], limit: 10 },
            },
          },
          {
            i: 'inbox',
            widget: 'kpi-stat-card',
            x: 6,
            y: 0,
            w: 3,
            h: 3,
            module: 'inbox',
            config: { title: 'Unclaimed enquiries', titles: { 'ar-EG': 'استفسارات لم يتسلّمها أحد' }, deltaMode: 'none', showSparkline: false, binding: { kind: 'table-query', connectionId, source, shape: 'metric+delta', aggregations: [{ fn: 'count', alias: 'n' }] } },
          },
          {
            i: 'orders',
            widget: 'kpi-stat-card',
            x: 9,
            y: 0,
            w: 3,
            h: 3,
            config: { title: 'Orders', titles: { 'ar-EG': 'الطلبات' }, deltaMode: 'none', showSparkline: false, binding: { kind: 'table-query', connectionId, source, shape: 'metric+delta', aggregations: [{ fn: 'count', alias: 'n' }] } },
          },
          {
            i: 'latest',
            widget: 'data-grid',
            x: 6,
            y: 3,
            w: 6,
            h: 6,
            config: {
              title: 'Latest orders',
              titles: { 'ar-EG': 'أحدث الطلبات' },
              binding: { kind: 'table-query', connectionId, source, shape: 'record-list', select: ['order_id', 'ship_name', 'freight'], orderBy: [{ column: 'order_id', dir: 'desc' }], limit: 5 },
              columns: [
                { name: 'order_id', label: 'Order', labels: { 'ar-EG': 'الطلب', 'de-DE': 'Bestellung' }, logicalType: 'integer' },
                { name: 'ship_name', label: 'Ship to', labels: { 'ar-EG': 'يُشحن إلى' } },
                { name: 'freight', label: 'Freight', labels: { 'ar-EG': 'أجرة الشحن' }, logicalType: 'decimal', display: { kind: 'currency' }, align: 'end' },
              ],
            },
          },
        ],
      },
    });
    boardId = await makePage(page, BOARD_SLUG, 'Orders by shipper', 'page-crud', connectionId, orders, null);
    boardBody = {
      templateVersion: 1,
      toolbar: [],
      overlays: [],
      layout: {
        version: 1,
        items: [
          {
            i: 'board-1',
            widget: 'kanban-board',
            x: 0,
            y: 0,
            w: 12,
            h: 16,
            config: {
              title: 'Orders',
              statusColumn: 'ship_via',
              titleColumn: 'ship_name',
              columnsFrom: { table: shippers, key: 'shipper_id', label: 'company_name', order: 'shipper_id' },
              totals: [{ column: 'freight', fn: 'sum' }],
              card: { amount: 'freight' },
              binding: { kind: 'table-query', connectionId, source, shape: 'record-list', select: ['order_id', 'ship_name', 'ship_via', 'freight'], orderBy: [{ column: 'order_id', dir: 'asc' }], limit: 200 },
            },
          },
        ],
      },
    };
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await removePage(page, DASH_SLUG);
    await removePage(page, BOARD_SLUG);
    if (connectionId !== '') await putRules(page, connectionId, before);
    await page.request.patch('/api/v1/me/prefs', { data: { theme: null, locale: null } }).catch(() => undefined);
    await page.close();
  });

  test.afterEach(async ({ page }) => {
    await page.request.patch('/api/v1/me/prefs', { data: { theme: null, locale: null } }).catch(() => undefined);
  });

  /** Signed in, in the combo's language, theme and width; a language changed elsewhere is drawn from the second load on. */
  async function open(page: Page, combo: (typeof COMBOS)[number], slug: string): Promise<void> {
    await signInAsOwner(page);
    await page.setViewportSize({ width: combo.width, height: 900 });
    await page.request.patch('/api/v1/me/prefs', { data: { theme: combo.theme, locale: combo.locale } });
    await page.goto(`/p/${slug}`);
    if (combo.locale !== null) {
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar-EG');
      await page.reload();
    }
    await expect(page.locator('html')).toHaveAttribute('dir', combo.dir);
  }

  async function nothingSideways(page: Page): Promise<void> {
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways).toBeLessThanOrEqual(1);
  }

  for (const combo of COMBOS) {
    test(`a table card’s headings are the reader’s: ${combo.name}`, async ({ page }) => {
      await open(page, combo, DASH_SLUG);
      const latest = card(page, 'latest');
      await expect(latest.getByRole('columnheader')).toHaveText([...combo.headings]);
      // Its rows are the server's, the freight written as money: two decimals. The column names no currency and
      // neither does Northwind's connection, so no symbol is guessed (there used to be a "$" default).
      await expect(latest.getByRole('row').nth(1)).toContainText(/\d[.,٫]\d{2}(?!\d)/);
      await nothingSideways(page);
    });

    test(`a chart’s “Show data” writes the freight as money and the count as a number, by keyboard: ${combo.name}`, async ({ page }) => {
      await open(page, combo, DASH_SLUG);
      const chart = card(page, 'by-shipper');
      const toggle = chart.getByRole('button', { name: combo.locale === null ? /show data/i : /عرض البيانات|show data/i });
      await toggle.focus();
      await expect(toggle).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      const first = chart.getByRole('table').locator('tbody tr').first();
      const cells = await first.locator('th, td').allTextContents();
      expect(cells).toHaveLength(3);
      // The count: a plain figure. The freight: money, two decimals. The column names no currency, so no
      // symbol is guessed (the chart table used to default to "$"). Arabic writes its own digits: ٤٦٣٫٨٩.
      expect(cells[1]).not.toMatch(/\$/);
      expect(cells[2]).not.toMatch(/\$/);
      expect(cells[2]).toMatch(/[\d٠-٩][.,٫][\d٠-٩]{2}(?![\d٠-٩])/);
      await nothingSideways(page);
    });

    test(`a board’s heading writes a money column’s total as money: ${combo.name}`, async ({ page }) => {
      await page.route(`**/api/v1/pages/${boardId}*`, async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const response = await route.fetch();
        const body = (await response.json()) as { data: Record<string, unknown> };
        body.data = { ...body.data, template: 'page-board', config: boardBody };
        await route.fulfill({ response, json: body });
      });
      await open(page, combo, BOARD_SLUG);
      const speedy = column(page, 'Speedy Express');
      await expect(speedy).toBeVisible();
      // A money total: two decimals, no guessed currency symbol (the board's column names none).
      await expect(speedy.locator('[data-part="column-total"]')).toContainText(/\d[.,٫]\d{2}(?!\d)/);
      await nothingSideways(page);
    });

    test(`a card of a part that is off is not drawn, and the page is whole: ${combo.name}`, async ({ page }) => {
      // The page as the server serves it while the card's part (the Inbox) is off: without the card.
      await page.route(`**/api/v1/pages/${dashId}*`, async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const response = await route.fetch();
        const body = (await response.json()) as { data: { config: { layout: { items: { module?: string }[] } } } };
        body.data.config.layout.items = body.data.config.layout.items.filter((item) => item.module !== 'inbox');
        await route.fulfill({ response, json: body });
      });
      await open(page, combo, DASH_SLUG);
      await expect(card(page, 'orders')).toBeVisible();
      await expect(card(page, 'latest').getByRole('columnheader').first()).toHaveText(combo.headings[0]);
      await expect(card(page, 'by-shipper')).toBeVisible();
      await expect(card(page, 'inbox')).toHaveCount(0);
      await expect(page.getByText(combo.locale === null ? 'Unclaimed enquiries' : 'استفسارات لم يتسلّمها أحد')).toHaveCount(0);
      // No card says it failed.
      await expect(page.locator('main').getByRole('button', { name: /try again|retry|إعادة/i })).toHaveCount(0);
      await nothingSideways(page);
      // With the part on (the server's own reply, every card) the card is there.
      await page.unroute(`**/api/v1/pages/${dashId}*`);
      await page.reload();
      await expect(card(page, 'inbox')).toBeVisible();
      await expect(card(page, 'inbox')).toContainText(combo.locale === null ? 'Unclaimed enquiries' : 'استفسارات لم يتسلّمها أحد');
    });
  }
});
