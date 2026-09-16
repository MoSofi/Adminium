// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';

import { expect, type Page } from '@playwright/test';

import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  SEED_CONNECTION_NAME,
  dataDirPointerPath,
} from './constants.js';

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

/**
 * The id of the seeded `northwind` connection, read from the API.
 *
 * Deliberately not scraped out of the Studio hub. A test that navigates
 * `/studio` → a card → a tab is asserting the hub's markup on its way to
 * asserting something else, and it fails for a reason that has nothing to do
 * with its subject — which is exactly what happened: six schema-design specs
 * all failed on a `northwind` LINK that the hub does not render.
 */
export async function seededConnectionId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/connections');
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { connections: { id: string; name: string }[] };
  const found = body.connections.find((c) => c.name === SEED_CONNECTION_NAME);
  if (found === undefined) {
    throw new Error(
      `no connection named ${SEED_CONNECTION_NAME}; saw ${body.connections.map((c) => c.name).join(', ')}`,
    );
  }
  return found.id;
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

/**
 * The running server's data dir, from the pointer its boot script wrote.
 *
 * Only for a spec that must place a file where the server will read it; the
 * store's own routes are the way in everywhere else.
 */
export function serverDataDir(): string {
  try {
    return readFileSync(dataDirPointerPath(), 'utf8').trim();
  } catch {
    throw new Error(
      `no data-dir pointer at ${dataDirPointerPath()} — is this run using scripts/e2e-server.mjs?`,
    );
  }
}
