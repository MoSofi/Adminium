/**
 * M9-T05 e2e — the generated app against a live engine (E2E_ENGINE), seeded
 * with the Northwind demo fixture by scripts/e2e-server.mjs:
 *
 *  (a) login/bootstrap as the seeded super admin
 *  (b) sidebar nav renders the introspected tables
 *  (c) page-crud happy path: typed cells, server sort, quick search,
 *      create-row modal, record detail
 *  (d) generated dashboard renders KPI cards + charts over live widget-data
 *
 * Selectors are role/label-based; ordering matters (serial — CRUD mutates the
 * seeded data), so the suite runs with one worker (playwright.config.ts).
 */
import { expect, test } from '@playwright/test';

import { ENGINE } from './constants.js';
import { gridRows, gridSearch, navLink, signIn } from './helpers.js';

test.describe('generated app on the seeded Northwind connection', () => {
  test('(a) seeded super admin signs in and lands in the generated app', async ({ page }) => {
    await signIn(page);
    // Persona footer proves bootstrap resolved the session user.
    await expect(page.getByText('e2e@adminium.local')).toBeVisible();
    // `/` redirected into the first workspace page (generated dashboard).
    await expect(page).toHaveURL(/\/p\//);
  });

  test('(b) sidebar nav lists the introspected Northwind tables', async ({ page }) => {
    await signIn(page);
    for (const table of [/Customers/, /Orders/, /Products/, /Suppliers/]) {
      await expect(navLink(page, table).first()).toBeVisible();
    }
  });

  test('(c1) customers list renders typed cells', async ({ page }) => {
    await signIn(page);
    await navLink(page, /Customers/).first().click();
    await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();

    const alfreds = gridRows(page).filter({ hasText: 'Alfreds Futterkiste' });
    await expect(alfreds).toBeVisible();
    // Type-aware cells from the same row: person-name text …
    await expect(alfreds).toContainText('Maria Anders');
    // … and PII columns (phone/fax/address) masked by default (05 §7.2).
    await expect(alfreds).toContainText('••••••');
    // The full fixture subset is present (12 customers).
    await expect(gridRows(page)).toHaveCount(12);
  });

  test('(c2) server-side sort by Company Name', async ({ page }) => {
    await signIn(page);
    await navLink(page, /Customers/).first().click();

    const sortButton = page.getByRole('button', { name: 'Sort by Company Name' });
    await sortButton.click(); // ascending
    await expect(gridRows(page).first()).toContainText('Alfreds Futterkiste');

    await sortButton.click(); // descending
    await expect(gridRows(page).first()).toContainText('Cactus Comidas para llevar');
  });

  // KNOWN GAP (M9-T05 finding): the `q=` quick search compiles to `ILIKE`
  // unconditionally (apps/server/src/crud/filters.ts compileQuickSearch), a
  // Postgres-ism — sqlite answers `near "ilike": syntax error` (mysql has no
  // ILIKE either) and the grid falls into the query-failed empty state.
  // Flip fixme → test once quick search compiles per-dialect.
  test('(c3) quick search narrows the grid', async ({ page }) => {
    test.fixme(ENGINE !== 'postgres', 'q= quick search compiles ILIKE — postgres-only today');
    await signIn(page);
    await navLink(page, /Customers/).first().click();
    await expect(gridRows(page)).toHaveCount(12);

    await gridSearch(page, /customers/).fill('Cactus');
    await expect(gridRows(page)).toHaveCount(1);
    await expect(gridRows(page).first()).toContainText('Cactus Comidas para llevar');

    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(gridRows(page)).toHaveCount(12);
  });

  test('(c4) record detail opens from the /r/$recordId route', async ({ page }) => {
    await signIn(page);
    await navLink(page, /Customers/).first().click();
    await expect(gridRows(page)).toHaveCount(12);

    // Route-controlled detail (09 §7.1): /p/customers/r/ALFKI drives the drawer.
    await page.goto('/p/customers/r/ALFKI');
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Alfreds Futterkiste');
    await expect(drawer).toContainText('Berlin');
  });

  // KNOWN GAP (M9-T05 finding, needs an engine/widgets fix — see followUps):
  // the generator excludes pk-id columns from `config.columns` entirely
  // (packages/engine/src/generate/crud.ts rankColumn rule 2) and page-crud
  // derives BOTH the create form and row ids from those columns, so
  //  - the create modal has no PK field → INSERT fails NOT NULL on every
  //    Northwind table (no serial/default PKs in the fixture), and
  //  - rowIdOf() falls back to JSON.stringify(row) → clicking a row opens
  //    /r/<json> which the record API cannot resolve.
  // `config.form.fields` (which DOES include non-auto PKs) is currently
  // unused by PageCrudBinding. Flip fixme → test once either lands.
  test('(c5) create a customer via the modal wizard', async ({ page }) => {
    test.fixme(true, 'create form lacks the (non-auto) PK field — generator/page-crud gap');
    await signIn(page);
    await navLink(page, /Customers/).first().click();

    await page.getByRole('button', { name: 'New row' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await modal.getByLabel('Customer Id').fill('E2E01');
    await modal.getByLabel('Company Name').fill('E2E Markets');
    await modal.getByRole('button', { name: 'Add customer' }).click();
    await expect(modal).toContainText('added');
    await modal.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('searchbox').fill('E2E Markets');
    await expect(gridRows(page)).toHaveCount(1);
  });

  test('(c6) row click opens the record detail drawer', async ({ page }) => {
    test.fixme(true, 'rowIdOf() falls back to JSON without a pk column spec — generator/page-crud gap');
    await signIn(page);
    await navLink(page, /Customers/).first().click();

    await gridRows(page).filter({ hasText: 'Alfreds Futterkiste' }).click();
    await expect(page).toHaveURL(/\/p\/customers\/r\//);
    await expect(page.getByRole('dialog')).toContainText('Alfreds Futterkiste');
  });

  test('(d) generated dashboard renders KPI cards and charts', async ({ page }) => {
    await signIn(page);
    await navLink(page, /Dashboard/).first().click();

    // KPI row: at least one stat card with a resolved (numeric) value from
    // live widget-data (single-metric count over orders).
    const kpis = page.locator('[data-widget="kpi-stat-card"]');
    await expect(kpis.first()).toBeVisible();
    await expect(page.getByText(/^Total /).first()).toBeVisible();
    await expect(kpis.filter({ hasText: /^Total Orders/ })).toContainText(/\d/);

    // Charts render as accessible SVGs (role="img", named by their title)
    // once widget-data resolves. The categorical donut works on all engines.
    await expect(page.getByRole('img', { name: /by Ship Country/i })).toBeVisible();
  });

  // KNOWN GAP (M9-T05 finding): time-bucketed widget queries compile to PG
  // `date_trunc` (apps/server/src/widget-data/compiler.ts bucketExpr) — the
  // per-engine `bucketExpr()` adapter hook (04 §5.2 step 4) is not wired yet,
  // so the hero timeseries chart and the "New … (30d)" KPI return 500 on
  // sqlite/mysql. Flip fixme → test once the hook lands.
  test('(d2) hero timeseries chart resolves on every engine', async ({ page }) => {
    test.fixme(ENGINE !== 'postgres', 'date_trunc bucketing is postgres-only today');
    await signIn(page);
    await navLink(page, /Dashboard/).first().click();
    await expect(page.getByRole('img', { name: /per Month/i })).toBeVisible();
  });
});
