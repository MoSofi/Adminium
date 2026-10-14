// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Parts card's content, as a browser draws it: in the install check, and
 * on an installed app's own page.
 *
 * What only a browser can show: a part that waits for an add-on drawn inside
 * that add-on's box; the roles the ticks leave with nothing to open, said at
 * once and gone when a tick brings them a part; "Will make N tables, N roles,
 * N rules" following the ticks; a tick reached and pressed from the keyboard;
 * and all of it right to left in Arabic, dark, and at 390 pixels with nothing
 * to scroll sideways.
 *
 * The parts are handed to the page by this test, in the reply of the real
 * server's own plan (and, for the app page, of its parts read): the bundle this
 * suite installs has no parts, and an app made of parts with two add-ons would
 * put tables into the database every spec shares. What the server answers for
 * such a manifest (`modules`, `whole`, each part's `rules` and `needs`) is
 * proved against the whole server on three engines (`apps/server/test/
 * app-parts-left-out.test.ts`, `app-modules-counts.test.ts`). Every other
 * request of this spec is the real server's. Nothing is installed by the
 * check: it is cancelled.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { APP_KEY, APP_VERSION, REUSE_CHOICES, appBundle } from './appBundle.js';
import { seededConnectionId, signIn } from './helpers.js';
import { textIn } from './localeText.js';

const en = (text: string) => ({ 'en-US': text });

/** The CRM's parts as the plan gives them: two always on, one waiting for an add-on the check leaves unticked. */
const MODULES = [
  { id: 'selling', label: en('Selling'), default: 'always', needs: [], leftOut: false, tables: ['deals'], roles: ['Sales rep'], rules: 3 },
  { id: 'accounts', label: en('Accounts'), default: 'always', needs: [], leftOut: false, tables: ['companies'], roles: ['Marketer'], rules: 0 },
  { id: 'inbox', label: en('Inbox'), default: 'on', needs: [], leftOut: false, tables: ['enquiries'], roles: ['Marketer'], rules: 1 },
  { id: 'jobs', label: en('Jobs on site'), default: 'off', needs: [], leftOut: false, tables: ['jobs'], roles: ['Field crew', 'Operations manager'], rules: 2 },
  { id: 'quotes', label: en('Quotes'), default: 'on', needs: ['invoices'], leftOut: false, tables: ['quotes'], roles: ['Sales rep'], rules: 4 },
  { id: 'supply', label: en('Supply'), default: 'on', needs: ['inventory'], leftOut: true, tables: [], roles: ['Operations manager'], rules: 0 },
];
const WHOLE = {
  roles: [
    { name: 'CRM admin', parts: [] },
    { name: 'Sales rep', parts: ['selling', 'quotes'] },
    { name: 'Marketer', parts: ['accounts', 'inbox'] },
    { name: 'Field crew', parts: ['jobs'] },
    { name: 'Operations manager', parts: ['jobs', 'supply'] },
  ],
  rules: 1,
};

/** An add-on row of the plan: Invoices & Receipts installed and ticked (two tables), Inventory absent and not ticked. */
function addOn(key: string, name: string, ticked: boolean, tables: number): Record<string, unknown> {
  return {
    key,
    name,
    need: 'feature',
    range: '>=1.0.0',
    reason: en(`${name} for the CRM.`),
    checked: ticked,
    features: [{ id: key === 'invoices' ? 'quotes' : 'supply', label: en(key === 'invoices' ? 'Quotes' : 'Supply') }],
    state: ticked ? 'installed' : 'absent',
    source: 'bundled',
    installedVersion: ticked ? '1.0.0' : null,
    offeredVersion: '1.0.0',
    satisfiesRange: true,
    staged: true,
    enabled: true,
    action: ticked ? 'attach' : 'install',
    usedBy: [],
    plan: { addOnKey: key, version: '1.0.0', installable: true, touchesData: tables > 0, create: Array.from({ length: tables }, (_, i) => ({ ref: `${key}_${String(i)}`, columns: [] })), reuse: [], problems: [], requiresSchemaChange: tables > 0 },
    problems: [],
  };
}

async function setPrefs(page: Page, theme: string | null, locale: string | null): Promise<void> {
  const reply = await page.request.patch('/api/v1/me/prefs', { data: { theme, locale } });
  expect(reply.ok(), `prefs → ${String(reply.status())}`).toBe(true);
}

/**
 * The card, and everything in it, lies inside the window: nothing of it is
 * past either edge, and it does not scroll inside itself. (Only the card: at
 * 390 the install wizard's step bar, which this work does not touch, is wider
 * than the window; said in the hand-back.)
 */
async function fitsTheWidth(page: Page, card: string): Promise<void> {
  const sizes = await page.evaluate((selector) => {
    const element = document.querySelector(selector) as HTMLElement | null;
    const width = document.documentElement.clientWidth;
    if (element === null) return { card: -1, out: ['no card'] };
    const out = [element, ...element.querySelectorAll('*')]
      .filter((one) => {
        const box = one.getBoundingClientRect();
        return box.width > 0 && (box.right > width + 1 || box.left < -1);
      })
      .slice(0, 5)
      .map((one) => `${one.tagName.toLowerCase()}.${String(one.getAttribute('class') ?? '').slice(0, 80)} [${one.getAttribute('data-part') ?? ''}]`);
    return { card: element.scrollWidth - element.clientWidth, out };
  }, card);
  expect(sizes.card, 'the card overflows its own width').toBeLessThanOrEqual(1);
  expect(sizes.out, 'something of the card is past the window’s edge').toEqual([]);
}

/** No serious or critical axe finding inside the card. */
async function sweep(page: Page, within: string, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include(within).analyze();
  expect(results.passes.length, `${label}: axe analysed nothing`).toBeGreaterThan(3);
  const blocking = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`), label).toEqual([]);
}

const COMBOS = [
  { theme: 'light', locale: 'en-US', pref: null, dir: 'ltr', width: 1280 },
  { theme: 'dark', locale: 'ar-EG', pref: 'ar_EG', dir: 'rtl', width: 390 },
] as const;

test.describe.configure({ mode: 'serial' });

test.describe('the Parts card’s content', () => {
  test.afterEach(async ({ page }) => {
    await page.request.patch('/api/v1/me/prefs', { data: { theme: null, locale: null } }).catch(() => undefined);
  });
  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.request.delete(`/api/v1/apps/${APP_KEY}`).catch(() => undefined);
    await page.request.patch('/api/v1/me/prefs', { data: { theme: null, locale: null } }).catch(() => undefined);
    await page.close();
  });

  for (const combo of COMBOS) {
    test(`the install check: parts under their add-on, who is left with nothing, what it will make — ${combo.theme}, ${combo.dir}, ${String(combo.width)} wide`, async ({ page }) => {
      test.setTimeout(120_000);
      const tx = textIn(combo.locale);
      await signIn(page);
      // After signing in: at 390 the menu is a drawer, and the sign-in check looks for it on the page.
      await page.setViewportSize({ width: combo.width, height: 900 });
      await setPrefs(page, combo.theme, combo.pref);
      await page.route('**/api/v1/apps/plan', async (route) => {
        const reply = await route.fetch();
        const body = (await reply.json()) as { plan: Record<string, unknown> };
        body.plan['modules'] = MODULES;
        body.plan['whole'] = WHOLE;
        body.plan['addOns'] = [addOn('invoices', 'Invoices & Receipts', true, 2), addOn('inventory', 'Inventory', false, 3)];
        await route.fulfill({ response: reply, json: body });
      });

      await page.goto('/studio/apps');
      await expect(page.getByRole('heading', { name: tx('studio:hostedApps.title') })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.getAttribute('dir') ?? 'ltr')).toBe(combo.dir);
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(combo.theme);
      await page.getByRole('button', { name: tx('studio:hostedApps.installed.install') }).click();
      const bundle = appBundle('create');
      await page.locator('input[type="file"]').setInputFiles({ name: `${APP_KEY}-${APP_VERSION}.tgz`, mimeType: 'application/gzip', buffer: bundle.buffer });
      await page.getByLabel(tx('studio:hostedApps.install.bundle.integrity')).fill(bundle.integrity);
      await page.getByRole('button', { name: tx('studio:hostedApps.install.upload') }).click();
      await page.getByRole('radio', { name: /northwind/i }).click();
      await page.getByRole('button', { name: tx('studio:hostedApps.install.continue') }).click();

      const card = page.getByTestId('install-parts');
      await expect(card).toBeVisible();
      // Quotes sits in the Invoices & Receipts box, which is ticked under Add-ons; Supply in Inventory's, which is not.
      const invoices = card.locator('[data-part-addon="invoices"]');
      const inventory = card.locator('[data-part-addon="inventory"]');
      await expect(invoices.getByText(tx('studio:appParts.groupTicked'))).toBeVisible();
      await expect(inventory.getByText(tx('studio:appParts.groupWaiting'))).toBeVisible();
      const quotes = invoices.getByRole('checkbox', { name: tx('studio:appParts.installTick', { part: 'Quotes' }) });
      await expect(quotes).toHaveAttribute('aria-checked', 'true');
      const supply = inventory.getByRole('checkbox', { name: tx('studio:appParts.installTick', { part: 'Supply' }) });
      await expect(supply).toHaveAttribute('aria-checked', 'false');
      await expect(supply).toBeDisabled();
      await expect(inventory.getByText(tx('studio:appParts.installWaiting', { addOns: 'Inventory' }))).toBeVisible();

      // Jobs is off and Supply waits: the field crew and the operations manager are left with nothing.
      const stranded = card.locator('[data-part="stranded"]');
      await expect(stranded).toBeVisible();
      await expect(stranded).toContainText('Field crew');
      await expect(stranded).toContainText('Operations manager');
      const willMake = card.locator('[data-part="will-make"]');
      const before = (await willMake.textContent()) ?? '';
      if (combo.locale === 'en-US') {
        await expect(card).toContainText('6 parts. Selling and Accounts are always part of it.');
        await expect(stranded).toHaveText('Field crew and Operations manager are left with nothing to open with these parts.');
        // One table of the app's own, two of the add-on ticked; the admin, the rep, the marketer; 1 + 3 + 1 + 4 rules.
        await expect(willMake).toHaveText(`${tx('studio:appParts.willMake')}3 tables, 3 roles, 9 rules`);
      }
      await fitsTheWidth(page, '[data-testid="install-parts"]');
      await sweep(page, '[data-testid="install-parts"]', `install check, ${combo.theme}, ${combo.dir}`);

      // The keyboard: from Inbox's tick, Tab reaches Jobs on site's, and Space ticks it.
      await card.getByRole('checkbox', { name: tx('studio:appParts.installTick', { part: 'Inbox' }) }).focus();
      await page.keyboard.press('Tab');
      const jobs = card.getByRole('checkbox', { name: tx('studio:appParts.installTick', { part: 'Jobs on site' }) });
      await expect(jobs).toBeFocused();
      await page.keyboard.press('Space');
      await expect(jobs).toHaveAttribute('aria-checked', 'true');
      // Jobs brings the field crew and the operations manager a part: nobody is left with nothing, and the figures follow.
      await expect(stranded).toHaveCount(0);
      await expect(willMake).not.toHaveText(before);
      if (combo.locale === 'en-US') await expect(willMake).toHaveText(`${tx('studio:appParts.willMake')}3 tables, 5 roles, 11 rules`);

      await page.getByRole('button', { name: tx('studio:hostedApps.install.cancel') }).click();
      await page.unroute('**/api/v1/apps/plan');
    });
  }

  test('an installed app’s page: its parts under the add-on each is built on, and the roles left with nothing — Arabic, dark, 390 wide', async ({ page }) => {
    test.setTimeout(120_000);
    const tx = textIn('ar-EG');
    await signIn(page);
    const connectionId = await seededConnectionId(page);
    const bundle = appBundle('reuse');
    const query = new URLSearchParams({ key: APP_KEY, version: APP_VERSION, expectedSha512: bundle.integrity });
    const staged = await page.request.post(`/api/v1/apps/upload?${query.toString()}`, { headers: { 'content-type': 'application/octet-stream' }, data: bundle.buffer });
    expect(staged.ok(), await staged.text()).toBe(true);
    const installed = await page.request.post('/api/v1/apps/install', { data: { key: APP_KEY, version: APP_VERSION, connectionId, choices: REUSE_CHOICES } });
    expect(installed.ok(), await installed.text()).toBe(true);

    const part = (over: Record<string, unknown>) => ({ default: 'on', switch: true, on: true, waiting: [], needs: [], leftOut: false, pages: 1, tables: 1, rules: 0, roles: [], ...over });
    await page.route(`**/api/v1/apps/${APP_KEY}/parts`, (route) =>
      route.fulfill({
        json: {
          parts: [
            part({ id: 'selling', label: 'المبيعات', default: 'always', roles: [{ slug: 'crm-rep', name: 'Sales rep', members: 4 }] }),
            part({ id: 'jobs', label: 'الأعمال في الموقع', default: 'off', switch: false, on: false, roles: [{ slug: 'crm-crew', name: 'Field crew', members: 2 }] }),
            part({ id: 'quotes', label: 'عروض الأسعار', needs: [{ key: 'invoices', name: 'Invoices & Receipts' }], roles: [{ slug: 'crm-rep', name: 'Sales rep', members: 4 }] }),
            part({ id: 'supply', label: 'التوريد', on: false, leftOut: true, needs: [{ key: 'inventory', name: 'Inventory' }], waiting: [{ key: 'inventory', name: 'Inventory' }] }),
          ],
        },
      }),
    );
    await page.setViewportSize({ width: 390, height: 900 });
    await setPrefs(page, 'dark', 'ar_EG');
    await page.goto(`/studio/apps/${APP_KEY}`);
    const card = page.getByTestId('app-parts');
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('rtl');
    const invoices = card.locator('[data-part-addon="invoices"]');
    const inventory = card.locator('[data-part-addon="inventory"]');
    await expect(invoices.getByText('عروض الأسعار')).toBeVisible();
    await expect(invoices.getByText(tx('studio:appParts.groupConnected'))).toBeVisible();
    await expect(inventory.getByText('التوريد')).toBeVisible();
    await expect(inventory.getByText(tx('studio:appParts.groupNotConnected'))).toBeVisible();
    await expect(inventory.getByText(tx('studio:appParts.leftOut', { addOns: 'Inventory' }))).toBeVisible();
    // Jobs is off: the field crew is left with nothing; the rep still has Selling.
    const stranded = card.locator('[data-part="stranded"]');
    await expect(stranded).toContainText('Field crew');
    await expect(stranded).not.toContainText('Sales rep');
    await fitsTheWidth(page, '[data-testid="app-parts"]');
    await sweep(page, '[data-testid="app-parts"]', 'app page, dark, rtl');
    // The switch of an off part is reached and pressed from the keyboard, and asks first.
    const jobs = card.getByRole('switch', { name: tx('studio:appParts.switch', { part: 'الأعمال في الموقع' }) });
    await jobs.focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('part-on-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('part-on-dialog')).toHaveCount(0);
    await page.unroute(`**/api/v1/apps/${APP_KEY}/parts`);
  });
});
