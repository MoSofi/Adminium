// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public API end to end: the two switches, an endpoint made in the builder, a
 * key made in the sheet, every method on the wire, a revoke, and the public
 * `/api-docs` page with its playground.
 *
 * ── ITS OWN SOURCE ─────────────────────────────────────────────────────────
 * Northwind has no table whose primary key the SERVER can mint (every key is
 * a plain `smallint NOT NULL`), so a public insert — `POST` and a batch's
 * unkeyed rows — has nothing to run against there. This spec therefore makes
 * a small SQLite database of its own with an autoincrement key, registers it
 * as a second connection, and deletes it again at the end. The dialect matrix
 * of every write is the server suite's (`public-api-*.test.ts`, three
 * dialects); this spec proves the parts only a real browser and a real server
 * together can: the UI makes what the wire serves, and the page calls it.
 *
 * ── "CURL-EQUIVALENT" ──────────────────────────────────────────────────────
 * The wire requests come from a Playwright request context with NO cookies,
 * as a caller outside the dashboard would. A browser key needs an allowed
 * Origin; the e2e server registers `self`, so the instance's own origin is it.
 */
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type APIRequestContext, type Page, type PlaywrightWorkerArgs } from '@playwright/test';

import { BASE_URL, PORT, publicApiStorageStatePath } from './constants.js';
import { signIn } from './helpers.js';

test.describe.configure({ mode: 'serial' });
// Its own `api` budget (300/min per principal): see public-api-a11y.spec.ts.
test.use({ storageState: publicApiStorageStatePath() });

const SOURCE_NAME = 'e2e public api';
const SOURCE_FILE = join(tmpdir(), `adminium-e2e-public-api-${String(PORT)}.db`);
const KEY_NAME = 'E2E shop site';
const REF = 'e2e_notes';

let connectionId = '';

/**
 * The driver the boot script seeds with. Loaded through `require` with the
 * one method this spec calls typed here, because this package carries no
 * `@types/better-sqlite3` and a spec is not worth a dependency change.
 */
const BetterSqlite3 = createRequire(import.meta.url)('better-sqlite3') as new (file: string) => {
  exec: (sql: string) => void;
  close: () => void;
};
type Playwright = PlaywrightWorkerArgs['playwright'];

async function ok<T>(response: Awaited<ReturnType<APIRequestContext['get']>>, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as T;
}

/** Make the spec's own source, register it, and wait for its snapshot. */
async function makeSource(page: Page): Promise<string> {
  rmSync(SOURCE_FILE, { force: true });
  const db = new BetterSqlite3(SOURCE_FILE);
  try {
    db.exec(`CREATE TABLE notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      body VARCHAR(200) NOT NULL,
      done INTEGER NOT NULL DEFAULT 0
    )`);
    db.exec("INSERT INTO notes (body) VALUES ('first'), ('second')");
  } finally {
    db.close();
  }
  const created = await ok<{ id: string }>(
    await page.request.post('/api/v1/connections', {
      data: { name: SOURCE_NAME, engine: 'sqlite', dsn: `sqlite:${SOURCE_FILE}` },
    }),
    201,
  );
  await ok(await page.request.patch(`/api/v1/connections/${created.id}`, { data: { timezone: 'UTC' } }));
  const introspect = await page.request.post(`/api/v1/connections/${created.id}/introspect`);
  expect([200, 202]).toContain(introspect.status());
  await expect
    .poll(async () => ((await (await page.request.get(`/api/v1/connections/${created.id}`)).json()) as { snapshot: unknown }).snapshot, {
      timeout: 60_000,
    })
    .not.toBeNull();
  return created.id;
}

/** A caller outside the dashboard: no cookies, the instance's own origin. */
async function caller(playwright: Playwright, token: string): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { authorization: `Bearer ${token}`, origin: BASE_URL },
  });
}

async function anonymous(playwright: Playwright): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
}

test.describe('public API', () => {
  test.afterAll(async ({ browser }) => {
    // Leave the shared instance as the other specs expect it.
    const context = await browser.newContext({ baseURL: BASE_URL, storageState: publicApiStorageStatePath() });
    const page = await context.newPage();
    await signIn(page);
    await page.request.put('/api/v1/public-api', { data: { enabled: false, docsEnabled: false } });
    if (connectionId !== '') {
      for (const key of ((await (await page.request.get('/api/v1/public-keys')).json()) as { keys: { id: string; connectionId: string | null; revokedAt: number | null }[] }).keys) {
        if (key.connectionId === connectionId && key.revokedAt === null) await page.request.delete(`/api/v1/public-keys/${key.id}`);
      }
      await page.request.delete(`/api/v1/connections/${connectionId}`, { data: { confirmName: SOURCE_NAME } });
    }
    await context.close();
    rmSync(SOURCE_FILE, { force: true });
  });

  test('the settings card switches the API and its documentation page on the next request', async ({ page, playwright }) => {
    await signIn(page);
    await ok(await page.request.put('/api/v1/public-api', { data: { enabled: false, docsEnabled: false } }));
    await page.goto('/studio/settings');

    const api = page.getByRole('switch', { name: 'Public API' });
    const docs = page.getByRole('switch', { name: 'API documentation page' });
    await expect(api).toHaveAttribute('aria-checked', 'false');
    await expect(docs).toHaveAttribute('aria-checked', 'false');
    // Outside the Save form: no Save is needed, and none lights up.
    await expect(api.locator('xpath=ancestor::form')).toHaveCount(0);

    const stranger = await anonymous(playwright);
    expect((await stranger.get('/api/v1/api-docs')).status()).toBe(404);

    await docs.click();
    await expect(docs).toHaveAttribute('aria-checked', 'true');
    const on = await stranger.get('/api/v1/api-docs');
    expect(on.status()).toBe(200);
    expect(((await on.json()) as { apiEnabled: boolean }).apiEnabled).toBe(false);

    await api.click();
    await expect(api).toHaveAttribute('aria-checked', 'true');
    expect(((await (await stranger.get('/api/v1/api-docs')).json()) as { apiEnabled: boolean }).apiEnabled).toBe(true);

    await docs.click();
    await expect(docs).toHaveAttribute('aria-checked', 'false');
    expect((await stranger.get('/api/v1/api-docs')).status()).toBe(404);
    // The page is the ordinary not-found screen while it is off.
    const visitor = await (await page.context().browser()!.newContext({ baseURL: BASE_URL })).newPage();
    await visitor.goto('/api-docs');
    await expect(visitor.getByRole('heading', { name: 'This page went missing' })).toBeVisible();
    await visitor.context().close();
    await stranger.dispose();
  });

  test('builder → endpoint → key → every method on the wire → revoke', async ({ page, playwright }) => {
    await signIn(page);
    connectionId = await makeSource(page);
    await ok(await page.request.put('/api/v1/public-api', { data: { enabled: true } }));
    await page.goto(`/studio/public-api?connection=${connectionId}`);

    await page.getByRole('button', { name: 'Create key' }).first().click();
    const sheet = page.getByRole('dialog', { name: 'Create API key' });
    await expect(sheet).toBeVisible();

    // A new endpoint, made in the builder over the sheet.
    await sheet.getByRole('button', { name: 'New endpoint' }).first().click();
    const builder = page.getByRole('dialog', { name: /endpoint/i }).last();
    await builder.getByRole('textbox', { name: 'Route', exact: true }).fill(REF);
    await builder.getByRole('combobox', { name: 'Source table or view' }).selectOption({ label: 'notes (main.notes)' });
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'BATCH']) {
      const chip = builder.getByRole('button', { name: method, exact: true });
      if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
    }
    await builder.getByRole('button', { name: 'Create endpoint' }).click();
    await expect(builder).toBeHidden();

    // Back on the sheet: grant every method of the new endpoint, then create.
    await sheet.getByRole('textbox', { name: 'Filter endpoints' }).fill(REF);
    await sheet.getByRole('button', { name: new RegExp(`^/${REF}`) }).click();
    await sheet.getByRole('button', { name: 'Select all methods' }).click();
    await sheet.getByRole('textbox', { name: 'Key name' }).fill(KEY_NAME);
    await sheet.getByRole('button', { name: 'Create key' }).click();
    await expect(sheet).toBeHidden();

    const tokenText = page.getByText(/^adm_pub_[A-Za-z0-9_-]+$/);
    await expect(tokenText).toBeVisible();
    const token = (await tokenText.innerText({ timeout: 5_000 })).trim();

    const wire = await caller(playwright, token);
    const path = `/api/v1/public/records/${REF}`;

    // GET — list and one.
    const list = await ok<{ data: { id: number; body: string }[] }>(await wire.get(`${path}?limit=5`));
    expect(list.data.map((r) => r.body).sort()).toEqual(['first', 'second']);
    // POST — the server keys the row.
    const created = await ok<{ data: { id: number; body: string } }>(await wire.post(path, { data: { values: { body: 'third' } } }), 201);
    const id = created.data.id;
    expect((await ok<{ data: { body: string } }>(await wire.get(`${path}/${String(id)}`))).data.body).toBe('third');
    // PATCH — part of a row.
    await ok(await wire.patch(`${path}/${String(id)}`, { data: { values: { done: 1 } } }));
    // PUT — every writable column, or a refusal.
    expect((await wire.put(`${path}/${String(id)}`, { data: { values: { body: 'only body' } } })).status()).toBe(400);
    await ok(await wire.put(`${path}/${String(id)}`, { data: { values: { body: 'replaced', done: 0 } } }));
    // BATCH — an unkeyed row inserts, a keyed row updates, all in one go.
    const batch = await ok<{ data: { count: number } }>(
      await wire.post(`${path}/batch`, { data: { rows: [{ body: 'fourth' }, { id, body: 'batched' }] } }),
    );
    expect(batch.data.count).toBe(2);
    expect((await ok<{ data: { body: string } }>(await wire.get(`${path}/${String(id)}`))).data.body).toBe('batched');
    // DELETE — then the row is the one 404.
    await ok(await wire.delete(`${path}/${String(id)}`));
    expect((await wire.get(`${path}/${String(id)}`)).status()).toBe(404);

    // Revoke from the page; the very next request is refused.
    await page.reload();
    const row = page.getByRole('row').filter({ hasText: KEY_NAME });
    await row.getByRole('button', { name: 'Revoke' }).click();
    const confirm = page.getByRole('dialog', { name: `Revoke ${KEY_NAME}?` });
    await confirm.getByRole('textbox').fill(KEY_NAME);
    await confirm.getByRole('button', { name: 'Revoke key' }).click();
    await expect(page.getByRole('row').filter({ hasText: KEY_NAME })).toHaveCount(0);
    expect((await wire.get(path)).status()).toBe(401);
    await wire.dispose();
  });

  test('/api-docs lists what a live key can call, and its playground makes the real request', async ({ page, playwright }) => {
    await signIn(page);
    await ok(await page.request.put('/api/v1/public-api', { data: { enabled: true, docsEnabled: true } }));
    const { token } = await ok<{ token: string }>(
      await page.request.post('/api/v1/public-keys', {
        data: { name: 'E2E docs reader', connectionId, access: [{ ref: REF, methods: ['GET'] }] },
      }),
      201,
    );

    // Signed in on purpose: the playground must not send this session's cookie.
    const sent: { url: string; headers: Record<string, string> }[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/public/records/')) sent.push({ url: request.url(), headers: request.headers() });
    });
    await page.goto(`/api-docs?resource=${REF}`);
    await expect(page.getByRole('heading', { level: 1, name: REF })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('API live');
    // Only the granted method is listed: GET is its two cards.
    await expect(page.getByText('2 endpoints', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /PATCH/ })).toHaveCount(0);

    const send = page.getByRole('button', { name: 'Send request' });
    await expect(send).toBeDisabled();
    await page.getByLabel('Authorization').fill(token);
    await send.click();
    await expect(page.getByText('200 OK')).toBeVisible();
    await expect(page.getByText(/"first"/)).toBeVisible();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers['authorization']).toBe(`Bearer ${token}`);
    expect(sent[0]?.headers['cookie']).toBeUndefined();
    expect(page.url()).not.toContain(token);
    await expect(page.getByRole('tabpanel')).not.toContainText(token);

    // A stranger's view is the same page.
    const stranger = await anonymous(playwright);
    const catalogue = (await (await stranger.get('/api/v1/api-docs')).json()) as {
      connections: { endpoints: { ref: string; methods: string[] }[] }[];
    };
    expect(catalogue.connections.flatMap((c) => c.endpoints).find((e) => e.ref === REF)?.methods).toEqual(['GET']);
    await stranger.dispose();
  });
});
