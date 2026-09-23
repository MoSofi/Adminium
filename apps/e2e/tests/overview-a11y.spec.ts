// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's Overview under axe — the composed `page-dashboard` of the POS
 * Overview design (P2), card family by card family, in light and dark, in
 * English and in Arabic (right to left), at the tablet width it was drawn for
 * and at a phone's.
 *
 * WHAT IS UNDER TEST. Not Point of Sale itself — that is another repository —
 * but everything of the Overview this repository draws: the day control in the
 * page toolbar, the grid, and each card family (KPI cards, bars over time, a
 * donut, a ranking, a mini-table), fed by the widget-data batch over real rows.
 * The fixture app (`appBundle('overview')`) lays those families out over
 * Northwind's own `orders` and `products`, used as they are, so nothing is
 * created in the dataset every spec shares.
 *
 * THE STATES. Ready (populated, with one card windowed to the chosen day —
 * empty on Northwind's 1990s dates, so the empty state is drawn for real),
 * the day picker open, loading (the batch held), and a failed batch (every
 * card's error frame).
 *
 * THE SWEEP ASSERTS IT ANALYSED SOMETHING: a floor on `passes` per state and a
 * count of states at the end.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { APP_KEY, APP_VERSION, appBundle } from './appBundle.js';
import { seededConnectionId, signIn } from './helpers.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);
const PAGE = '/p/e2e-dashboard';

/** A number as the page may print it: Western or Arabic-Indic digits. */
function exactly(value: number): RegExp {
  const western = String(value);
  const arabic = western.replace(/\d/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]!);
  return new RegExp(`^\\s*(${western}|${arabic})\\s*$`);
}

const COMBOS = [
  { theme: 'light', locale: null, dir: 'ltr' },
  { theme: 'dark', locale: null, dir: 'ltr' },
  { theme: 'light', locale: 'ar_EG', dir: 'rtl' },
  { theme: 'dark', locale: 'ar_EG', dir: 'rtl' },
] as const;
const WIDTHS = [
  { name: 'tablet', width: 1360, height: 860 },
  { name: 'phone', width: 390, height: 844 },
] as const;

interface Sweep {
  states: number;
  minor: number;
  failures: string[];
}

async function sweep(page: Page, label: string, tally: Sweep, testInfo: TestInfo): Promise<void> {
  // Entrance transitions settle; a skeleton's shimmer never does, so it is left running.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.passes.length, `${label}: axe analysed nothing`).toBeGreaterThan(10);
  const blocking = results.violations.filter((violation) => BLOCKING.has(violation.impact ?? ''));
  const lesser = results.violations.filter((violation) => !BLOCKING.has(violation.impact ?? ''));
  tally.states += 1;
  tally.minor += lesser.length;
  if (lesser.length > 0) {
    testInfo.annotations.push({
      type: 'axe-lesser',
      description: `${label}: ${lesser.map((v) => `${String(v.impact)}:${v.id}`).join(', ')}`,
    });
  }
  const report = blocking
    .map(
      (v) =>
        `${String(v.impact)}: ${v.id} — ${v.help}\n` +
        v.nodes
          .slice(0, 4)
          .map((n) => `    ${n.target.join(' ')}\n      ${n.html.slice(0, 200)}`)
          .join('\n'),
    )
    .join('\n');
  if (blocking.length > 0) tally.failures.push(`${label} — ${String(blocking.length)} blocking:\n${report}`);
}

/** The cards' own titles are the fixture's data, the same in every language. */
async function expectCards(page: Page): Promise<void> {
  for (const title of ['Orders', 'Freight by month', 'Orders by country', 'Most in stock', 'Latest orders']) {
    await expect(page.locator('main').getByText(title, { exact: true }).first()).toBeVisible();
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('an app’s Overview under axe', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const connectionId = await seededConnectionId(page);
    const bundle = appBundle('overview');
    const query = new URLSearchParams({ key: APP_KEY, version: APP_VERSION, expectedSha512: bundle.integrity });
    const uploaded = await page.request.post(`/api/v1/apps/upload?${query.toString()}`, {
      headers: { 'content-type': 'application/octet-stream' },
      data: bundle.buffer,
    });
    expect(uploaded.ok(), await uploaded.text()).toBe(true);
    // Northwind made both tables, so the check step asks; the answer is to use them as they are.
    const installed = await page.request.post('/api/v1/apps/install', {
      data: {
        key: APP_KEY,
        version: APP_VERSION,
        connectionId,
        choices: { orders: { action: 'reuse' }, products: { action: 'reuse' } },
      },
    });
    expect(installed.ok(), await installed.text()).toBe(true);
    const reply = (await installed.json()) as { schema: { created: string[] }; pages: { warnings: unknown[] } };
    expect(reply.schema.created, 'the Overview fixture creates nothing').toEqual([]);
    expect(reply.pages.warnings).toEqual([]);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.request.delete(`/api/v1/apps/${APP_KEY}`).catch(() => undefined);
    await page.request.patch('/api/v1/me/prefs', { data: { theme: null, locale: null } }).catch(() => undefined);
    await page.close();
  });

  test.afterEach(async ({ page }) => {
    await page.request.patch('/api/v1/me/prefs', { data: { theme: null, locale: null } }).catch(() => undefined);
  });

  for (const combo of COMBOS) {
    const name = `${combo.theme}${combo.dir === 'rtl' ? ', Arabic (rtl)' : ''}`;
    test(`every state, ${name}`, async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      const tally: Sweep = { states: 0, minor: 0, failures: [] };
      await signIn(page);
      // The Orders card counts the fixture's own rows, however many this dataset has.
      const connectionId = await seededConnectionId(page);
      const tables = (await (await page.request.get(`/api/v1/connections/${connectionId}/schema`)).json()) as {
        model: { tables: { id: string; name: string }[] };
      };
      const ordersId = tables.model.tables.find((table) => table.name === 'orders')!.id;
      const listed = await page.request.get(`/api/v1/data/${connectionId}/${encodeURIComponent(ordersId)}?limit=200`);
      expect(listed.ok(), await listed.text()).toBe(true);
      const rows = ((await listed.json()) as { data: unknown[] }).data;
      expect(rows.length, 'the dataset has fewer than 200 orders, so one page is all of them').toBeLessThan(200);
      const COUNT = exactly(rows.length);
      const prefs = await page.request.patch('/api/v1/me/prefs', { data: { theme: combo.theme, locale: combo.locale } });
      expect(prefs.ok()).toBe(true);

      for (const size of WIDTHS) {
        const at = (label: string): string => `${name} · ${size.name} · ${label}`;
        await page.setViewportSize({ width: size.width, height: size.height });

        // ── ready ────────────────────────────────────────────────────────
        await page.goto(PAGE);
        await expectCards(page);
        const probe = await page.evaluate(() => ({
          theme: document.documentElement.getAttribute('data-theme'),
          dir: document.documentElement.getAttribute('dir'),
        }));
        expect(probe, at('theme and direction')).toEqual({ theme: combo.theme, dir: combo.dir });
        // The populated cards say so: the count of the fixture's orders.
        await expect(page.locator('main').getByText(COUNT).first()).toBeVisible();
        await sweep(page, at('ready'), tally, testInfo);

        // ── the day picker, open ─────────────────────────────────────────
        await page.locator('[data-part=day-pick]').click();
        await expect(page.locator('[data-radix-popper-content-wrapper] input[type=date]')).toBeVisible();
        await sweep(page, at('day picker open'), tally, testInfo);
        await page.keyboard.press('Escape');

        // ── loading: the batch held until the sweep is done ──────────────
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => (release = resolve));
        await page.route('**/api/v1/widget-data/batch', async (route) => {
          await held;
          await route.continue().catch(() => undefined);
        });
        await page.goto(PAGE);
        await expect(page.locator('main').getByText('Freight by month', { exact: true }).first()).toBeVisible();
        // Nothing has answered yet: no card has a number to show.
        await expect(page.locator('main').getByText(COUNT)).toHaveCount(0);
        await sweep(page, at('loading'), tally, testInfo);
        release();
        await page.unroute('**/api/v1/widget-data/batch');

        // ── a failed batch: every card's error frame ─────────────────────
        await page.route('**/api/v1/widget-data/batch', (route) =>
          route.fulfill({
            status: 500,
            json: { error: { code: 'INTERNAL', message: 'The data could not be read.', requestId: 'req_a11y' } },
          }),
        );
        await page.goto(PAGE);
        await expect(page.locator('main').getByText('Freight by month', { exact: true }).first()).toBeVisible();
        await expect(page.getByText(COUNT)).toHaveCount(0);
        await page.waitForTimeout(500);
        await sweep(page, at('failed'), tally, testInfo);
        await page.unroute('**/api/v1/widget-data/batch');
      }

      testInfo.annotations.push({
        type: 'axe-summary',
        description: `${name}: ${String(tally.states)} states, ${String(tally.minor)} lesser`,
      });
      expect(tally.states, 'a state was skipped').toBe(8);
      expect(tally.failures.join('\n\n')).toBe('');
    });
  }
});
