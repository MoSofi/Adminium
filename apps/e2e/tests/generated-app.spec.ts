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

  // M9-T05 finding, now fixed: the `q=` quick search compiles per-dialect
  // (apps/server/src/crud/filters.ts compileQuickSearch → compileILike) —
  // postgres `ILIKE`, mysql/sqlite `LOWER(...) LIKE LOWER(...)`. Runs on every
  // engine (was postgres-only when it emitted `ILIKE` unconditionally, which
  // is a syntax error on sqlite/mysql).
  test('(c3) quick search narrows the grid', async ({ page }) => {
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
    // A second, un-masked field proves the record's data rendered. Assert the
    // contact name, NOT the city: city is masked-by-default PII (••• like
    // phone/fax/address). Pre-fix, masked values leaked anyway because the
    // pk-less rowIdOf() fell back to JSON.stringify(row) as the drawer title;
    // now the title is the clean PK ("ALFKI") and masked fields stay masked.
    await expect(drawer).toContainText('Maria Anders');
  });

  // The generator now emits the pk-id column as a *hidden* column spec
  // (packages/engine/src/generate/crud.ts listColumns appends the missing PK
  // columns; DataGrid filters hidden specs out of the grid), so page-crud
  // resolves BOTH the create form's (required, no-default) PK field and row
  // ids (rowIdOf) from `config.columns` — closing the M9-T05 create/row-click
  // gap. The final q= quick-search verification now works on every engine (the
  // ILIKE-only compile was fixed — see c3).
  //
  // Create previously 403'd on sqlite: `ConnectionManager.testDsn` derives
  // `connection.readOnly` from the introspect-role probe, and the sqlite
  // adapter's `#detectReadOnly()` conflated the introspect handle's forced
  // read-only OPEN MODE with the connection's writability. Fixed in
  // packages/adapter-sqlite/src/index.ts: read-only DETECTION now reflects the
  // connection (config `mode: 'readonly'`, file `W_OK`, `PRAGMA query_only`),
  // not the forced open mode — so writable sqlite/mysql connections allow CRUD.
  test('(c5) create a customer via the modal wizard', async ({ page }) => {
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

    // Scope to the grid quick-search (the topbar hosts a second, palette
    // searchbox — `page.getByRole('searchbox')` alone is ambiguous).
    await gridSearch(page, /customers/).fill('E2E Markets');
    await expect(gridRows(page)).toHaveCount(1);
  });

  test('(c6) row click opens the record detail drawer', async ({ page }) => {
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

  // M9-T05 finding, now fixed: time-bucketed widget queries compile per dialect
  // (apps/server/src/widget-data/compiler.ts bucketExpr → date_trunc / strftime
  // / DATE_FORMAT), and rolling-window bounds bind as a UTC string on
  // mysql/sqlite instead of a `Date` (better-sqlite3 rejects `Date`). The hero
  // timeseries chart and the "New … (30d)" KPI — which returned 500 on
  // sqlite/mysql — now resolve on every engine.
  test('(d2) hero timeseries chart resolves on every engine', async ({ page }) => {
    await signIn(page);
    await navLink(page, /Dashboard/).first().click();
    await expect(page.getByRole('img', { name: /per Month/i })).toBeVisible();
  });
});
