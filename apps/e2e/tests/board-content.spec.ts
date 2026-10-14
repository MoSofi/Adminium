// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a board page says beyond its columns, and a card that is the whole
 * team's, as a browser draws them.
 *
 * THE BOARD. Northwind's orders by the shipper that carries them: one column
 * a row of `shippers`, headed by the shipper's name, its phone as the badge,
 * the server's count and two totals of freight; each card with its
 * customer's name looked up through the link, its freight, the days since it
 * was ordered as the SERVER counted them (the browser's clock is set a year
 * wrong and the cards do not move), and the day it is wanted; the page's own
 * note above the columns, which opens the page it names. The page is a real
 * page over `orders`, made through the pages API; its envelope is handed to
 * the dashboard as a board with the stored form of an app's `config.board`
 * (Northwind has no table a board page can be made over, and the words are
 * read from the release to come, which the server under test is not yet, so
 * no manifest that says them installs here; the install's own path is proved
 * on three engines in `apps/server/test/app-board-columns.test.ts`). Every
 * read of rows, counts, totals, names and days is the real server's.
 *
 * Northwind has no staff column, so a card's person is not drawn here: the
 * names a reader is told are proved against the whole server
 * (`row-limit-board-names.test.ts`) and the drawing in the widgets' unit tests.
 *
 * THE WHOLE TEAM'S CARD. A dashboard card of `kind: 'team-figures'` answers
 * the signed-in owner (no row limit holds them) for real. The refusal a
 * person held to some rows gets is the server's on three engines; here its
 * exact reply is put in place of the card's answer, to see what the card
 * then says: in English and Arabic, light and dark, wide and at 390.
 */
import { expect, test, type Page } from '@playwright/test';

import { seededConnectionId, signIn as signInAsOwner } from './helpers.js';

const BOARD_SLUG = 'e2e-board-content';
const TEAM_SLUG = 'e2e-team-figures';

async function tableId(page: Page, slug: string): Promise<string> {
  const reply = await page.request.get('/api/v1/pages');
  const { data } = (await reply.json()) as { data: { id: string; slug: string }[] };
  const one = await page.request.get(`/api/v1/pages/${String(data.find((entry) => entry.slug === slug)?.id)}`);
  return ((await one.json()) as { data: { source: { table: string } } }).data.source.table;
}

async function removePage(page: Page, slug: string): Promise<void> {
  const reply = await page.request.get('/api/v1/pages');
  const { data } = (await reply.json()) as { data: { id: string; slug: string }[] };
  const found = data.find((entry) => entry.slug === slug);
  if (found !== undefined) await page.request.delete(`/api/v1/pages/${found.id}`).catch(() => undefined);
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

const column = (page: Page, label: string) => page.locator('[data-board-column]').filter({ has: page.getByText(label, { exact: true }) });

test.describe.configure({ mode: 'serial' });

test.describe('a board page’s headings, cards and note', () => {
  let boardId = '';
  let boardBody: Record<string, unknown> = {};
  /** The real page's envelope, read as a board with the stored board body: the one reply of this spec that is not the server's own. */
  async function signIn(page: Page): Promise<void> {
    await page.route(`**/api/v1/pages/${boardId}*`, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const response = await route.fetch();
      const body = (await response.json()) as { data: Record<string, unknown> };
      body.data = { ...body.data, template: 'page-board', config: boardBody };
      await route.fulfill({ response, json: body });
    });
    await signInAsOwner(page);
  }

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const connectionId = await seededConnectionId(page);
    const orders = await tableId(page, 'orders');
    const shippers = await tableId(page, 'shippers');
    const [schema, name] = orders.includes('.') ? (orders.split('.') as [string, string]) : [undefined, orders];
    const source = { name, type: 'table', ...(schema === undefined || schema === 'main' ? {} : { schema }) };
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
              columnsFrom: { table: shippers, key: 'shipper_id', label: 'company_name', order: 'shipper_id', badge: { column: 'phone' } },
              totals: [
                { column: 'freight', fn: 'sum' },
                { column: 'freight', fn: 'avg' },
              ],
              card: { link: 'customer_id.company_name', amount: 'freight', daysSince: { column: 'order_date', warnFrom: 14, alertFrom: 30 }, date: 'required_date' },
              note: { text: 'Columns come from Shippers', texts: { 'ar-EG': 'الأعمدة تأتي من شركات الشحن' }, href: '/p/shippers' },
              binding: {
                kind: 'table-query',
                connectionId,
                source,
                shape: 'record-list',
                select: ['order_id', 'ship_name', 'ship_via', 'customer_id', 'freight', 'order_date', 'required_date'],
                lookups: ['adm_card_link:customer_id.company_name'],
                daysSince: ['adm_card_days:order_date'],
                orderBy: [{ column: 'order_date', dir: 'asc' }],
                limit: 200,
              },
            },
          },
        ],
      },
    };
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await removePage(page, BOARD_SLUG);
    await page.request.patch('/api/v1/me/prefs', { data: { theme: null, locale: null } }).catch(() => undefined);
    await page.close();
  });

  test.afterEach(async ({ page }) => {
    await page.request.patch('/api/v1/me/prefs', { data: { theme: null, locale: null } }).catch(() => undefined);
  });

  test('heads each column with its row’s badge, the server’s count and both totals, and draws each card’s facts', async ({ page }) => {
    await signIn(page);
    await page.goto(`/p/${BOARD_SLUG}`);
    const speedy = column(page, 'Speedy Express');
    await expect(speedy).toBeVisible();
    // The badge is the shipper's own phone, read with the column.
    await expect(speedy.locator('[data-part="column-badge"]')).toHaveText('(503) 555-9831');
    // Two totals of the same column are each named, and never cut: the whole text is there to read.
    const total = speedy.locator('[data-part="column-total"]');
    await expect(total).toContainText('·');
    expect(await total.getAttribute('title')).toBe(await total.textContent());
    // The count is the server's: more than the cards a column draws can be.
    const count = Number(await speedy.locator('[data-part="column-count"]').textContent());
    expect(count).toBeGreaterThan(0);

    const card = speedy.locator('[role="button"]').filter({ hasText: /\d days/ }).first();
    await expect(card).toBeVisible();
    // The days the server counted, the day the order is wanted, and the customer's name looked up through the link.
    await expect(card.getByText(/ days$/)).toBeVisible();
    await expect(card.getByText(/\b199\d\b/)).toBeVisible();
    const connectionId = await seededConnectionId(page);
    const customers = await tableId(page, 'customers');
    const names = ((await (await page.request.get(`/api/v1/data/${connectionId}/${encodeURIComponent(customers)}?select=company_name&limit=200`)).json()) as { data: { company_name: string }[] }).data.map((row) => row.company_name);
    const text = (await card.textContent()) ?? '';
    expect(names.some((name) => text.includes(name)), text).toBe(true);
  });

  test('counts a card’s days by the server’s clock: a browser a year ahead draws the same figure', async ({ page }) => {
    await signIn(page);
    await page.goto(`/p/${BOARD_SLUG}`);
    const first = page.locator('[data-board-column] [role="button"]').filter({ hasText: /\d days/ }).first();
    await expect(first).toBeVisible();
    const before = await first.getByText(/ days$/).textContent();
    // The same page with the browser's clock a year on.
    await page.clock.install({ time: new Date(Date.now() + 366 * 86_400_000) });
    await page.reload();
    const again = page.locator('[data-board-column] [role="button"]').filter({ hasText: /\d days/ }).first();
    await expect(again).toBeVisible();
    expect(await again.getByText(/ days$/).textContent()).toBe(before);
  });

  test('the note is above the columns and opens the page it names, by keyboard', async ({ page }) => {
    await signIn(page);
    await page.goto(`/p/${BOARD_SLUG}`);
    const note = page.getByTestId('board-note');
    await expect(note).toHaveText('Columns come from Shippers');
    const link = note.getByRole('button');
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/p\/shippers$/);
  });

  test('reads right to left in Arabic, in the dark, with the note in the reader’s language', async ({ page }) => {
    await signIn(page);
    await page.request.patch('/api/v1/me/prefs', { data: { theme: 'dark', locale: 'ar_EG' } });
    await page.goto(`/p/${BOARD_SLUG}`);
    // A language changed elsewhere reaches this browser at its next load: the first load takes the new language in, the second is drawn in it.
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar-EG');
    await page.reload();
    await expect(page.getByTestId('board-note')).toHaveText('الأعمدة تأتي من شركات الشحن');
    await expect(page.locator('[data-widget="kanban-board"]')).toHaveAttribute('dir', 'rtl');
    // The first column (by the shippers' own order) is at the start side: the right.
    const boxes = await page.locator('[data-board-column]').evaluateAll((nodes) => nodes.slice(0, 2).map((node) => node.getBoundingClientRect().left));
    expect(boxes[0]).toBeGreaterThan(boxes[1] as number);
    await expect(page.locator('[data-part="column-badge"]').first()).toBeVisible();
  });

  test('at 390 wide the board scrolls inside itself and the page does not', async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/p/${BOARD_SLUG}`);
    await expect(page.getByTestId('board-note')).toBeVisible();
    await expect(page.locator('[data-part="column-total"]').first()).toBeVisible();
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways).toBeLessThanOrEqual(1);
  });
});

test.describe('a card that is the whole team’s', () => {
  const REFUSAL = { code: 'TEAM_FIGURE_WHOLE_ONLY', message: 'This figure is the whole team’s. It is not shown to you, because your role reads only some of the rows it is worked out from.', statusCode: 403 };

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const connectionId = await seededConnectionId(page);
    const orders = await tableId(page, 'orders');
    const [schema, name] = orders.includes('.') ? (orders.split('.') as [string, string]) : [undefined, orders];
    const source = { name, type: 'table', ...(schema === undefined || schema === 'main' ? {} : { schema }) };
    await makePage(page, TEAM_SLUG, 'Team figures', 'page-dashboard', connectionId, orders, {
      layout: {
        version: 1,
        items: [
          {
            i: 'whole',
            widget: 'kpi-stat-card',
            x: 0,
            y: 0,
            w: 4,
            h: 3,
            config: {
              title: 'Team freight',
              // No staff column in Northwind: the owner test is refused for the real owner too, so the card under test is the refusal's.
              binding: { kind: 'team-figures', connectionId, source, shape: 'single-metric', team: { owner: 'employee_id', figures: [{ key: 'freight', fn: 'sum', column: 'freight' }] } },
            },
          },
        ],
      },
    });
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await removePage(page, TEAM_SLUG);
    await page.request.patch('/api/v1/me/prefs', { data: { theme: null, locale: null } }).catch(() => undefined);
    await page.close();
  });

  /** The card's own answer replaced by the refusal the server gives somebody held to some rows; every other card and request is real. */
  async function refused(page: Page): Promise<void> {
    await page.route('**/api/v1/widget-data/batch', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { results: Record<string, unknown> };
      if ('whole' in body.results) body.results['whole'] = { ok: false, error: REFUSAL };
      await route.fulfill({ response, json: body });
    });
  }

  for (const combo of [
    { name: 'English, light, wide', prefs: { theme: 'light', locale: null }, width: 1280, title: 'For the whole team only' },
    { name: 'Arabic, dark, 390 wide', prefs: { theme: 'dark', locale: 'ar_EG' }, width: 390, title: 'للفريق كله فقط' },
  ] as const) {
    test(`says the figure is the whole team’s and shows none: ${combo.name}`, async ({ page }) => {
      await signInAsOwner(page);
      await page.setViewportSize({ width: combo.width, height: 844 });
      await page.request.patch('/api/v1/me/prefs', { data: combo.prefs });
      await refused(page);
      await page.goto(`/p/${TEAM_SLUG}`);
      // As above: a language changed elsewhere is drawn from the second load on.
      if (combo.prefs.locale !== null) {
        await expect(page.locator('html')).toHaveAttribute('lang', 'ar-EG');
        await page.reload();
      }
      const main = page.locator('main');
      await expect(main.getByText(combo.title)).toBeVisible();
      // No figure, no "try again", no error frame.
      await expect(main.getByRole('button', { name: /try again|retry|إعادة/i })).toHaveCount(0);
      await expect(main.getByText(/\d{3,}/)).toHaveCount(0);
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(sideways).toBeLessThanOrEqual(1);
      await page.request.patch('/api/v1/me/prefs', { data: { theme: null, locale: null } });
    });
  }
});
