// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The UI walk the E2E specs share (11-electron.md §6, 11-T20): first-run wizard
 * → demo database → app shell → data grid → chart. Selectors are role/label
 * based, matching the repo's Playwright convention (apps/e2e/tests/helpers.ts)
 * and pinned to the real wizard/steps components (apps/dashboard/src/desktop/
 * setup/**) and the studio generate step it reuses.
 */

import { expect, type Page } from '@playwright/test';

export interface AdminAccount {
  name: string;
  email: string;
  password: string;
}

/** The demo persona (research/BRIEF.md §4), reused as the super-admin account. */
export const DEMO_ADMIN: AdminAccount = {
  name: 'Ava Reyes',
  email: 'ava@adminium.io',
  password: 'desktop-e2e-password',
};

/**
 * §6 first-run, end to end, with the demo database:
 *   Step 1 (data location, default dir) → Step 2 (demo card) →
 *   Step 3 (super-admin, single-user stays on) → Step 4 (generate) → app shell.
 */
export async function completeFirstRunDemo(page: Page, admin: AdminAccount = DEMO_ADMIN): Promise<void> {
  // Step 1 — Welcome & data location. Continue keeps the default <userData>/data.
  await expect(page.getByRole('heading', { name: 'Welcome to Adminium' })).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 2 — Your first database: the demo card (enabled only when the build
  // ships the seed script, which the packaged/built app always does).
  const demoCard = page.getByRole('radio', { name: /Explore the demo database/ });
  await expect(demoCard, 'the demo card must be enabled — the build must ship the demo seed').toBeEnabled({
    timeout: 30_000,
  });
  await demoCard.click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 3 — Your account. "Skip login on this computer" stays checked (default),
  // so relaunches auto-login (§5) — which the crash/WAL test relies on.
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.getByLabel('Your name').fill(admin.name);
  await page.getByLabel('Email').fill(admin.email);
  // getByRole, not getByLabel: the required marker renders "Password*" as the
  // label's TEXT (asterisk aria-hidden), and getByLabel matches raw label text
  // while the ROLE name uses the accname algorithm — which strips aria-hidden.
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(admin.password);
  await page.getByRole('textbox', { name: 'Confirm password' }).fill(admin.password);
  await page.getByRole('button', { name: 'Create account and continue' }).click();

  // Step 4 — Generate. create + introspect run first; the BYO enrich step is
  // skipped (generation is never gated on it), so "Generate dashboard" appears
  // once the demo database is built and introspected.
  const generate = page.getByRole('button', { name: 'Generate dashboard' });
  await expect(generate).toBeVisible({ timeout: 180_000 });
  await generate.click();
  await expect(page.getByText('Your dashboard is ready')).toBeVisible({ timeout: 180_000 });
  await page.getByRole('button', { name: 'Open your app' }).click();

  await waitForAppShell(page);
}

/**
 * The app shell is up — the Primary nav is visible. True after the wizard's
 * "Open your app", and after a relaunch's boot-token auto-login (§5).
 */
export async function waitForAppShell(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible({ timeout: 90_000 });
}

/** Open the demo Employees data page and assert its grid renders rows (UI read). */
export async function openEmployeesGrid(page: Page): Promise<void> {
  // Exact name, because the generated nav holds THREE Employees links —
  // "Employees Dashboard" (Workspace section, listed first), "Employees" (the
  // page-crud grid this walk needs) and "Employees Directory" (org chart).
  // `/Employees/…first()` lands on the dashboard, which renders stat cards and
  // charts but no grid, so the row wait below would time out.
  // apps/server/test/desktop-demo.test.ts pins this contract locally: exactly
  // one generated page is titled "Employees", and it is the page-crud one.
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Employees', exact: true })
    .click();
  // Wrong-page guard — without it, landing anywhere grid-less surfaces as an
  // opaque "no rows" timeout (the exact failure mode the exact match fixes).
  await expect(page, 'the "Employees" nav link must open the CRUD page').toHaveURL(/\/p\/employees$/);
  await expect(page.getByRole('rowgroup').getByRole('row').first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Navigate to a generated dashboard and assert a chart renders.
 *
 * Charts are accessible, titled SVGs (`role="img"`, named by their title) once
 * widget-data resolves — the same assertion the Northwind suite makes
 * (apps/e2e/tests/generated-app.spec.ts). The demo domain is engineered to
 * trigger chart widgets (§6 / research/ia-mapping.md §3.1). In the desktop
 * runtime any geo widget resolves to the choropleth GRID (no map tiles, §7), so
 * this never depends on a network fetch.
 */
export async function assertChartRenders(page: Page): Promise<void> {
  const dashboard = page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: /Dashboard|Overview/ })
    .first();
  if ((await dashboard.count()) > 0) {
    await dashboard.click().catch(() => undefined);
  }
  await expect(page.getByRole('img', { name: /.+/ }).first()).toBeVisible({ timeout: 60_000 });
}
