// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The generated app against a live engine (E2E_ENGINE), seeded
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

import { gridRows, gridSearch, navLink, recordPage, signIn, useOwnPrincipal } from './helpers.js';

/*
 * Its own principal, so its own `api` budget (constants.ts `OWN_PRINCIPALS`):
 * a dozen fast page loads, straight after the export and form specs, met the
 * rate-limit page on the shared one.
 */
const SIGNED_IN_AS = useOwnPrincipal('generated');

test.describe('generated app on the seeded Northwind connection', () => {
  test('(a) seeded super admin signs in and lands in the generated app', async ({ page }) => {
    await signIn(page);
    // Identity moved out of the sidebar persona footer and into the topbar
    // account menu, so the signed-in email is now behind a click rather than
    // permanently on screen. Opening the menu still proves what this asserted:
    // that bootstrap resolved the session user.
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByText(SIGNED_IN_AS)).toBeVisible();
    await page.keyboard.press('Escape');
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
    // … and PII columns (phone/fax/address) masked by default.
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

  // Found and fixed: the `q=` quick search compiles per-dialect
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

    // Route-controlled detail: /p/customers/r/ALFKI renders
    // the record PAGE. It drove a drawer over the list until the record got a
    // route of its own, so the list now unmounts behind it.
    await page.goto('/p/customers/r/ALFKI');
    const record = recordPage(page);
    await expect(record).toBeVisible();
    await expect(record).toContainText('Alfreds Futterkiste');
    // A second, un-masked field proves the record's data rendered. Assert the
    // contact name, NOT the city: city is masked-by-default PII (••• like
    // phone/fax/address). Pre-fix, masked values leaked anyway because the
    // pk-less rowIdOf() fell back to JSON.stringify(row) as the drawer title;
    // now the title is the clean PK ("ALFKI") and masked fields stay masked.
    await expect(record).toContainText('Maria Anders');
  });

  // The generator now emits the pk-id column as a *hidden* column spec
  // (packages/engine/src/generate/crud.ts listColumns appends the missing PK
  // columns; DataGrid filters hidden specs out of the grid), so page-crud
  // resolves BOTH the create form's (required, no-default) PK field and row
  // ids (rowIdOf) from `config.columns` — closing the create/row-click
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
  test('(c5) create a customer in the designed dialog', async ({ page }) => {
    await signIn(page);
    await navLink(page, /Customers/).first().click();

    await page.getByRole('button', { name: 'New row' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The dialog's own words: "New {entity}", "Create {entity}".
    await expect(dialog.getByRole('heading', { name: 'New customer' })).toBeVisible();
    await dialog.getByLabel('Customer Id').fill('E2E01');
    await dialog.getByLabel('Company Name').fill('E2E Markets');
    await dialog.getByRole('button', { name: 'Create customer' }).click();

    /*
     * The dialog CLOSES on success and the toast carries the Undo (D4). The
     * second "added — Done" panel is gone: it confirmed, in front of the grid
     * that now showed the row, something the toast had already said.
     */
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();

    // Scope to the grid quick-search (the topbar hosts a second, palette
    // searchbox — `page.getByRole('searchbox')` alone is ambiguous).
    await gridSearch(page, /customers/).fill('E2E Markets');
    await expect(gridRows(page)).toHaveCount(1);
  });

  /*
   * GATE D (plan 50 T26): the same dialog at every door. It was four different
   * containers — a two-phase modal for create and three 480px drawers for the
   * edits — so editing a row looked like a different operation from adding one.
   */
  test('(c5b) the SAME dialog edits from the grid and from the record page', async ({ page }) => {
    await signIn(page);
    await navLink(page, /Customers/).first().click();

    /*
     * From the grid, the way the product actually gets there: the row's eye
     * opens the PEEK — a preview, and deliberately still a drawer — and Edit
     * inside it opens the dialog. A row click navigates to the record page, so
     * the peek is the only in-place door.
     */
    // A SEEDED row, so this test stands on its own rather than on (c5)'s.
    const row = gridRows(page).filter({ hasText: 'Alfreds Futterkiste' }).first();
    await row.getByRole('button', { name: 'Peek' }).click();
    await page.getByRole('button', { name: /^Edit/ }).first().click();
    const fromGrid = page.getByRole('dialog').filter({ hasText: 'Edit customer' });
    await expect(fromGrid.getByRole('heading', { name: 'Edit customer' })).toBeVisible();
    await fromGrid.getByLabel('Company Name').fill('Alfreds Futterkiste GmbH');
    await fromGrid.getByRole('button', { name: 'Save changes' }).click();
    await expect(fromGrid).toBeHidden();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();

    // The PEEK is still open behind the dialog — it is a preview the person
    // came from, and closing it is theirs to do.
    await page.keyboard.press('Escape');

    // …and from the record page. (Which row it is does not matter — what
    // matters is that the door opens the same dialog.)
    await gridRows(page).filter({ hasText: 'Alfreds Futterkiste' }).first().click();
    await expect(page).toHaveURL(/\/p\/customers\/r\//);
    await recordPage(page).getByRole('button', { name: /^Edit/ }).first().click();
    const fromRecord = page.getByRole('dialog');
    await expect(fromRecord.getByRole('heading', { name: 'Edit customer' })).toBeVisible();
    await fromRecord.getByRole('button', { name: /Cancel/ }).click();
    await expect(fromRecord).toBeHidden();
  });

  test('(c6) row click opens the record page', async ({ page }) => {
    await signIn(page);
    await navLink(page, /Customers/).first().click();

    await gridRows(page).filter({ hasText: 'Alfreds Futterkiste' }).click();
    await expect(page).toHaveURL(/\/p\/customers\/r\//);
    await expect(recordPage(page)).toContainText('Alfreds Futterkiste');
  });

  // The ⌘K palette's async Records group hits
  // `GET /api/v1/search` (types=record, limit=3) and a selected hit navigates
  // to the record route. 'cactus' matches one customer's company_name AND the
  // orders rows shipping to it (ship_name carries the same string), so the
  // customer hit is pinned by its row-context subtitle — which also
  // proves the context ships end-to-end. PII columns (phone/address/city)
  // are masked and never match.
  test('(c7) ⌘K palette record search navigates to the record route', async ({ page }) => {
    await signIn(page);
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();

    await palette.getByRole('combobox').fill('cactus');
    const hit = palette
      .getByRole('option', { name: /Cactus Comidas para llevar/ })
      .filter({ hasText: 'contact_name Patricio Simpson' });
    await expect(hit).toBeVisible();
    await hit.click();

    await expect(page).toHaveURL(/\/p\/customers\/r\/CACTU/);
    await expect(recordPage(page)).toContainText('Cactus Comidas para llevar');

    // The visit lands in the palette's Recent group (localStorage).
    await page.keyboard.press('ControlOrMeta+k');
    await expect(
      page
        .getByRole('dialog', { name: 'Command palette' })
        .getByRole('group', { name: 'Recent' }),
    ).toBeVisible();
  });

  test('(d) generated dashboard renders KPI cards and charts', async ({ page }) => {
    await signIn(page);
    await navLink(page, /Dashboard/).first().click();

    // KPI row: at least one stat card with a resolved (numeric) value from
    // live widget-data (single-metric count over orders).
    //
    // The title is rendered by WidgetFrame's <h3>, NOT inside the card body:
    // `KpiStatCard` used to fall back to `config.title` when it had no
    // `metricLabel`, which printed the same string twice — once in the frame
    // header and once in the card. That fallback is gone, so filtering the card
    // by its title text matches nothing. Scope by the FRAME whose heading names
    // the metric, then assert the value inside that frame's card.
    const kpis = page.locator('[data-widget="kpi-stat-card"]');
    await expect(kpis.first()).toBeVisible();
    await expect(page.getByText(/^Total /).first()).toBeVisible();
    await expect(
      page
        .locator('[data-widget-frame]')
        .filter({ has: page.getByRole('heading', { name: /^Total Orders/ }) })
        .locator('[data-widget="kpi-stat-card"]'),
    ).toContainText(/\d/);

    // Charts render as accessible SVGs (role="img", named by their title)
    // once widget-data resolves. The categorical donut works on all engines.
    await expect(page.getByRole('img', { name: /by Ship Country/i })).toBeVisible();
  });

  // Found and fixed: time-bucketed widget queries compile per dialect
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
