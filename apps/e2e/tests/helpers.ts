// SPDX-License-Identifier: AGPL-3.0-only
import { expect, type Page } from '@playwright/test';

import { ADMIN_EMAIL, ADMIN_PASSWORD } from './constants.js';

/**
 * Land in the app shell as the seeded super admin.
 *
 * The `setup` project (auth.setup.ts) already signed in once and the
 * `chromium` project preloads that session via storageState, so the normal
 * path here is just "open / and see the shell" — the production 5/min
 * `auth-login` bucket (08 §6) is never in play. The UI-login fallback only
 * runs when the saved session is dead (fresh worker after a crash, expiry),
 * which stays far under the login budget.
 */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  const shell = page.getByRole('navigation', { name: 'Primary' });
  const email = page.getByLabel('Email');
  await expect(shell.or(email).first()).toBeVisible();
  if (await shell.isVisible()) return;

  await email.fill(ADMIN_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(shell).toBeVisible();
}

/** The sidebar nav link for a generated page (label may grow suffixes). */
export function navLink(page: Page, label: string | RegExp) {
  return page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: label });
}

/** Body rows of the page-crud data grid (header row lives outside the rowgroup). */
export function gridRows(page: Page) {
  return page.getByRole('rowgroup').getByRole('row');
}

/**
 * The grid's quick-search box. The topbar hosts a second (read-only, palette
 * trigger) searchbox, so scope by the table-derived placeholder — the schema
 * prefix differs per engine (main. / public. / adminium_e2e.).
 */
export function gridSearch(page: Page, table: string | RegExp) {
  return page.getByRole('searchbox', { name: table });
}

/**
 * Root of the `page-record` detail template (30-record-pages.md D1).
 *
 * The record used to open in a drawer over the list, so these assertions were
 * once `getByRole('dialog')`. It is its own route now — row click, the
 * /r/$recordId URL and a palette record hit all navigate here, unmounting the
 * list behind them — and the only dialogs the page owns are its create and
 * edit drawers.
 */
export function recordPage(page: Page) {
  return page.locator('[data-part="page-record"]');
}
