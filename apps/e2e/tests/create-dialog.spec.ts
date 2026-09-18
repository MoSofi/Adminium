// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CREATE DIALOG ITSELF, as somebody meets it.
 *
 * The designer's spec proves a designed form reaches the dialog and the
 * layouts' spec proves the arrangements. This one proves the plain, DERIVED
 * dialog every generated page has on its first day, and the two moments that
 * decide whether it is usable: a refusal that lands on the field that caused it
 * rather than on a banner over a dialog whose fields all look fine, and an Undo
 * that really removes the row.
 *
 * Both halves of the refusal are here on purpose — the one the browser can see
 * (a required field left empty, nothing sent) and the one only the database can
 * (a key that is already taken). The second one is a UNIQUE violation, which
 * this build answers as a conflict with a sentence rather than a marked field:
 * what is pinned here is what the dialog owes somebody either way, which is to
 * stay open with every value they typed still in it.
 *
 * It runs on whichever engine the suite was started against, because "what
 * fills this column" and "what the database refuses" are the two questions the
 * three engines answer differently.
 */
import { expect, test, type Page } from '@playwright/test';

import { seededConnectionId, signIn } from './helpers.js';

/** Shippers: a small table whose key this fixture does not issue for you. */
const PAGE = 'shippers';
const NAME = 'Overnight Freight';

/** The table's qualified id — `main.` on SQLite, `public.` on the others. */
async function shippersTable(page: Page): Promise<string> {
  const reply = await page.request.get('/api/v1/pages');
  const { data } = (await reply.json()) as { data: { id: string; slug: string }[] };
  const id = String(data.find((entry) => entry.slug === PAGE)?.id);
  const one = await page.request.get(`/api/v1/pages/${id}`);
  const body = (await one.json()) as { data: { source: { table: string } } };
  return body.data.source.table;
}

async function rowCount(page: Page, connection: string, table: string): Promise<number> {
  const rows = await page.request.get(
    `/api/v1/data/${connection}/${encodeURIComponent(table)}?limit=200`,
  );
  const body = (await rows.json()) as { data: unknown[] };
  return body.data.length;
}

test.describe('the create dialog', () => {
  test('refuses on the field — from the browser and from the database', async ({ page }) => {
    await signIn(page);
    await page.goto(`/p/${PAGE}`);

    await page.getByRole('button', { name: /New row/ }).click();
    const form = page.getByRole('dialog');
    await expect(form).toBeVisible();

    const submit = form.getByRole('button', { name: /^(Create|Add) / });

    // ── The browser's half: nothing is sent while a required field is empty.
    await submit.click();
    await expect(form).toBeVisible();
    const marked = form.locator('[aria-invalid="true"]');
    await expect(marked.first()).toBeVisible();

    // ── The database's half: a key that is already taken. Only the database
    //    can know, and whatever it says, the dialog must stay open with the
    //    typing in it — a refusal must never cost somebody what they just
    //    entered.
    await form.getByLabel(/^Shipper Id/).fill('1');
    await form.getByLabel(/^Company Name/).fill(NAME);
    await submit.click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(form).toBeVisible();
    await expect(form.getByLabel(/^Company Name/)).toHaveValue(NAME);
    await expect(form.getByLabel(/^Shipper Id/)).toHaveValue('1');

    await form.getByRole('button', { name: /Cancel/ }).click();
    await expect(form).toBeHidden();
  });

  test('creates a row, and Undo takes it away again', async ({ page }) => {
    await signIn(page);
    const connection = await seededConnectionId(page);
    const table = await shippersTable(page);
    const before = await rowCount(page, connection, table);
    await page.goto(`/p/${PAGE}`);

    await page.getByRole('button', { name: /New row/ }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel(/^Shipper Id/).fill('941');
    await form.getByLabel(/^Company Name/).fill(NAME);
    await form.getByRole('button', { name: /^(Create|Add) / }).click();
    await expect(form).toBeHidden({ timeout: 20_000 });

    await expect(page.getByRole('cell', { name: NAME })).toBeVisible();
    expect(await rowCount(page, connection, table)).toBe(before + 1);

    // Undo is a real delete of the row just made, not a visual retraction.
    await page.getByRole('button', { name: /^Undo$/ }).click();
    await expect
      .poll(async () => rowCount(page, connection, table), { message: 'undo removes the created row' })
      .toBe(before);
  });
});
