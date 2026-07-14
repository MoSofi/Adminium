import { expect, type Page } from '@playwright/test';

import { ADMIN_EMAIL, ADMIN_PASSWORD } from './constants.js';

/** Sign in as the seeded super admin and wait for the app shell. */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
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
