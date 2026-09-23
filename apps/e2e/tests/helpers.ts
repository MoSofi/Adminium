// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  BASE_URL,
  FAKE_LLM_URL,
  OWN_PRINCIPAL_PASSWORD,
  OWN_PRINCIPALS,
  SEED_CONNECTION_NAME,
  dataDirPointerPath,
  ownStorageStatePath,
  type OwnPrincipal,
} from './constants.js';

/**
 * Run this spec file as its own seeded super admin, so it spends its own `api`
 * budget (constants.ts `OWN_PRINCIPALS`). Call it at the top of the file: it
 * signs in once, as the file starts, and every test in the file reuses that
 * session. Returns the principal's email, for a test that asserts who it is.
 */
export function useOwnPrincipal(key: OwnPrincipal): string {
  const { email } = OWN_PRINCIPALS[key];
  test.beforeAll(async ({ browser }) => {
    // Room to sit out the login bucket once (below).
    test.setTimeout(150_000);
    // An empty state, stated: a context made here would otherwise load the very file it is about to write.
    const context = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const shell = page.getByRole('navigation', { name: 'Primary' });
    const refused = page.getByRole('alert').filter({ hasText: /Too many attempts/ });
    for (let attempt = 0; ; attempt += 1) {
      await page.goto('/login');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(OWN_PRINCIPAL_PASSWORD);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(shell.or(refused)).toBeVisible();
      if (await shell.isVisible()) break;
      /*
       * The 5/min `auth-login` bucket, which a run of just a file or two can
       * meet: the setup project's logins are then in the same minute. The
       * whole suite reaches these files minutes later; either way, wait it out
       * rather than weaken the limit.
       */
      expect(attempt, 'still refused a minute later').toBe(0);
      await page.waitForTimeout(61_000);
    }
    await context.storageState({ path: ownStorageStatePath(key) });
    await context.close();
  });
  test.use({ storageState: ownStorageStatePath(key) });
  return email;
}

/**
 * Land in the app shell as the seeded super admin.
 *
 * The `setup` project (auth.setup.ts) already signed in once and the
 * `chromium` project preloads that session via storageState, so the normal
 * path here is just "open / and see the shell" — the production 5/min
 * `auth-login` bucket is never in play. The UI-login fallback only runs
 * when the saved session is dead (fresh worker after a crash, expiry),
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

/**
 * On the new-page screen, bind to the seeded connection.
 *
 * With one connection the screen pre-selects it; with more it shows a Data
 * source picker and leaves the table picker disabled until one is chosen.
 * Earlier specs in a full run add connections of their own, so which of the
 * two a test meets depends on the order it runs in.
 */
export async function chooseSeededSource(page: Page): Promise<void> {
  const response = await page.request.get('/api/v1/connections');
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { connections: unknown[] };
  if (body.connections.length > 1) {
    await page.getByTestId('studio-pages-connection').selectOption(await seededConnectionId(page));
  }
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
 * Root of the `page-record` detail template.
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

/**
 * Point the instance at the scripted LLM (`scripts/fake-llm.mjs`) for one
 * spec, and take it away again.
 *
 * NOT SEEDED AT BOOT, on purpose. `llm.enabled` is bootstrap state for the
 * whole instance — it gates the ⌘K *Ask AI* affordance and the assistant
 * button — and the suite shares one server, so a spec that left a provider
 * configured would change what every spec after it renders. Each assistant
 * spec calls {@link configureFakeProvider} in `beforeAll` and
 * {@link clearProvider} in `afterAll`, the way `llm-enrichment.spec.ts` does.
 *
 * A LOOPBACK `baseUrl` is accepted for `openai-compatible` only because the
 * e2e server runs with `NODE_ENV` unset — the outbound guard refuses one in
 * production. The assertion below names that, so the day somebody sets
 * `NODE_ENV` the failure explains itself instead of looking like a flake.
 */
export async function configureFakeProvider(page: Page): Promise<void> {
  const res = await page.request.put('/api/v1/llm/config', {
    data: { provider: 'openai-compatible', baseUrl: FAKE_LLM_URL, model: 'fake', apiKey: 'fake-key' },
  });
  expect(
    res.ok(),
    `configuring the scripted provider → ${String(res.status())}. A 422 here usually means the ` +
      `e2e server was started with NODE_ENV set: the outbound guard refuses a loopback baseUrl ` +
      `outside development.`,
  ).toBeTruthy();
}

/** Remove it again — every assistant spec owes this in `afterAll` (trap 18). */
export async function clearProvider(page: Page): Promise<void> {
  const res = await page.request.put('/api/v1/llm/config', { data: { provider: null } });
  expect(res.ok(), `clearing the provider → ${String(res.status())}`).toBeTruthy();
}
