// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PICTURE COLUMN, end to end against the built stack.
 *
 * A column is set to Picture in Studio; a new record chooses a picture
 * uploaded on the Files page, a second record chooses the first record's
 * picture, and each gets its own copy. Deleting the Files page original, and
 * then the first record, leaves every remaining record's picture in place.
 *
 * Its own page over the seeded employees table (`photo_path` is the fixture's
 * one text column a picture can live in), made here and removed at the end,
 * so the generated pages other specs share are never touched. Its own
 * principal (a super admin, so it can open the Files page), for its own `api`
 * budget.
 */
import { expect, test, type Page } from '@playwright/test';

import { BASE_URL, ownStorageStatePath } from './constants.js';
import { seededConnectionId, useOwnPrincipal } from './helpers.js';

useOwnPrincipal('pictures');

test.describe.configure({ mode: 'serial' });

/** A 1×1 PNG: a real signature, which is what the upload's content check reads. */
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

interface FileView {
  id: string;
  filename: string;
  attachedAt: number | null;
  deletedAt: number | null;
  entity: { connectionId: string; table: string; recordId: string } | null;
}

/** The seeded employees table's id as this engine names it, read off the page bound to it. */
async function employeesTable(page: Page): Promise<string> {
  const list = (await (await page.request.get('/api/v1/pages')).json()) as { data: { id: string; slug: string }[] };
  const employees = list.data.find((entry) => entry.slug === 'employees');
  expect(employees, 'the seed generates an employees page').toBeDefined();
  const body = (await (await page.request.get(`/api/v1/pages/${String(employees?.id)}`)).json()) as { data: { source: { table: string } } };
  return body.data.source.table;
}

/** The file a stored value names: its id, read out of the link the column keeps. */
function fileIdOf(value: unknown): string {
  const found = /file_[0-9A-HJKMNP-TV-Z]{26}/.exec(String(value));
  expect(found, `a file of ours in ${String(value)}`).not.toBeNull();
  return found![0];
}

test.describe('a picture column, and choosing a picture you already have', () => {
  const stamp = String(Date.now()).slice(-6);
  const slug = `staff-photos-${stamp}`;
  const first = { last: `Kowalski-${stamp}`, first: 'Ada' };
  const second = { last: `Novak-${stamp}`, first: 'Ben' };
  let pageId = '';
  let connectionId = '';
  let table = '';
  let library = '';
  const made: string[] = [];

  /** A context signed in as this file's own principal: the hooks get no fixture page. */
  const signedIn = (browser: import('@playwright/test').Browser) => browser.newContext({ baseURL: BASE_URL, storageState: ownStorageStatePath('pictures') });

  test.beforeAll(async ({ browser }) => {
    const context = await signedIn(browser);
    const page = await context.newPage();
    await page.goto('/');
    connectionId = await seededConnectionId(page);
    table = await employeesTable(page);
    const created = await page.request.post('/api/v1/pages', { data: { slug, title: 'Staff photos', template: 'page-crud', navGroup: 'workspace', connectionId, table } });
    expect(created.ok(), await created.text()).toBe(true);
    pageId = ((await created.json()) as { data: { id: string } }).data.id;
    // `photo_path` as plain text to start with: the person makes it a picture in Studio.
    const stored = await page.request.patch(`/api/v1/pages/${pageId}/config`, {
      data: {
        config: {
          columns: [
            { name: 'employee_id', label: 'Employee', logicalType: 'integer', primaryKey: true, hidden: true },
            { name: 'last_name', label: 'Last name', logicalType: 'varchar', isDisplay: true },
            { name: 'first_name', label: 'First name', logicalType: 'varchar' },
            { name: 'photo_path', label: 'Photo', logicalType: 'varchar', semantic: 'image-url' },
          ],
          pageSize: 25,
        },
      },
    });
    expect(stored.ok(), await stored.text()).toBe(true);
    // A picture uploaded on the Files page: the workspace's own, on no record.
    const uploaded = await page.request.post(`/api/v1/files?connectionId=${encodeURIComponent(connectionId)}&filename=crispy-hero-${stamp}.png`, {
      headers: { 'content-type': 'image/png' },
      data: PNG_BYTES,
    });
    expect(uploaded.status(), await uploaded.text()).toBe(201);
    library = ((await uploaded.json()) as { data: FileView }).data.id;
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    const context = await signedIn(browser);
    const page = await context.newPage();
    for (const key of made) await page.request.delete(`/api/v1/data/${encodeURIComponent(connectionId)}/${encodeURIComponent(table)}/${encodeURIComponent(key)}`);
    if (pageId !== '') await page.request.delete(`/api/v1/pages/${pageId}`);
    await page.request.delete(`/api/v1/files/${library}`);
    await context.close();
  });

  /** The employee rows this spec made, by last name, as the data route reads them. */
  async function rowOf(page: Page, last: string): Promise<Record<string, unknown>> {
    const where = encodeURIComponent(JSON.stringify({ column: 'last_name', op: 'eq', value: last }));
    const reply = await page.request.get(`/api/v1/data/${encodeURIComponent(connectionId)}/${encodeURIComponent(table)}?where=${where}`);
    expect(reply.ok(), await reply.text()).toBe(true);
    const rows = ((await reply.json()) as { data: Record<string, unknown>[] }).data;
    expect(rows, `one employee called ${last}`).toHaveLength(1);
    return rows[0]!;
  }

  /** New employee, with a picture chosen from a tab of the picker; answers the stored row. */
  async function createWithChosenPicture(page: Page, who: { last: string; first: string }, tab: string, tile: RegExp): Promise<Record<string, unknown>> {
    await page.goto(`/p/${slug}`);
    await page.getByRole('button', { name: /New/ }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/^Last name/).fill(who.last);
    await dialog.getByLabel(/^First name/).fill(who.first);
    // An engine whose key has no default asks for it.
    const key = dialog.getByLabel(/^Employee/);
    if ((await key.count()) > 0) await key.first().fill(String(800 + Math.floor(Math.random() * 190)));
    await dialog.getByRole('button', { name: 'Choose existing…' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose a picture' });
    await expect(picker).toBeVisible();
    await expect(picker.getByText('The record gets its own copy.')).toBeVisible();
    await picker.getByRole('tab', { name: tab }).click();
    const option = picker.getByRole('option', { name: tile });
    await expect(option).toBeVisible();
    await option.click();
    await expect(picker).toBeHidden();
    await expect(dialog.getByText('Saved with the record.')).toBeVisible();
    await dialog.getByRole('button', { name: /^Create/ }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const row = await rowOf(page, who.last);
    made.push(String(row['employee_id']));
    return row;
  }

  test('a column set to Picture in Studio gets the picture field', async ({ page }) => {
    await page.goto(`/studio/pages/${pageId}`);
    const holds = page.getByTestId('studio-pages-holds-photo_path');
    await expect(holds).toBeVisible();
    // The column's name says it holds picture links; it is offered as a hint while it holds Text.
    await expect(page.getByTestId('studio-pages-holds-hint-photo_path')).toBeVisible();
    await holds.getByRole('radio', { name: 'Picture' }).click();
    await expect(page.getByText('Pictures only. Untick the kinds this column should refuse.')).toBeVisible();
    await page.getByTestId('studio-pages-save').click();
    await expect
      .poll(async () => {
        const body = (await (await page.request.get(`/api/v1/pages/${pageId}`)).json()) as { data: { config: { columns: { name: string; file?: { accept?: string[] } }[] } } };
        return body.data.config.columns.find((column) => column.name === 'photo_path')?.file?.accept ?? [];
      }, { message: 'the page stores a picture column' })
      .toEqual(['png', 'jpeg', 'webp', 'gif']);
  });

  test('a new record chooses a picture from the Files page and keeps its own copy', async ({ page }) => {
    const row = await createWithChosenPicture(page, first, 'From the Files page', new RegExp(`^crispy-hero-${stamp}\\.png, `));
    const copy = fileIdOf(row['photo_path']);
    expect(copy).not.toBe(library);
    const held = (await (await page.request.get(`/api/v1/files/${copy}`)).json()) as { data: FileView };
    expect(held.data.entity?.recordId).toBe(String(row['employee_id']));
    // The original stays the Files page's.
    const original = (await (await page.request.get(`/api/v1/files/${library}`)).json()) as { data: FileView };
    expect(original.data.entity).toBeNull();
    expect(original.data.deletedAt).toBeNull();
  });

  test('a second record chooses the first record’s picture, and gets its own copy too', async ({ page }) => {
    const before = fileIdOf((await rowOf(page, first.last))['photo_path']);
    const row = await createWithChosenPicture(page, second, `Used in Staff photos`, new RegExp(`^${first.last}'s picture, crispy-hero-${stamp}\\.png$`));
    const copy = fileIdOf(row['photo_path']);
    expect(copy).not.toBe(before);
    expect(copy).not.toBe(library);
    // The first record's picture is still its own.
    expect(fileIdOf((await rowOf(page, first.last))['photo_path'])).toBe(before);
  });

  test('deleting the original on the Files page, then the first record, leaves every other picture in place', async ({ page }) => {
    const firstCopy = fileIdOf((await rowOf(page, first.last))['photo_path']);
    const secondCopy = fileIdOf((await rowOf(page, second.last))['photo_path']);

    await page.goto('/files');
    await page.getByTestId('files-preset-library').click();
    await page.getByTestId('files-view-list').click();
    const original = page.getByTestId('files-row').filter({ hasText: `crispy-hero-${stamp}.png` });
    await expect(original).toBeVisible();
    await original.getByRole('button', { name: `Delete crispy-hero-${stamp}.png` }).click();
    await expect(original).toBeHidden();
    expect(((await (await page.request.get(`/api/v1/files/${library}`)).json()) as { data: FileView }).data.deletedAt).not.toBeNull();
    for (const copy of [firstCopy, secondCopy]) expect((await page.request.get(`/api/v1/files/${copy}/content`)).status()).toBe(200);

    // The list shows both records' pictures.
    await page.goto(`/p/${slug}`);
    for (const copy of [firstCopy, secondCopy]) await expect(page.locator(`img[src*="${copy}"]`).first()).toBeVisible();

    const firstKey = made[0]!;
    const removed = await page.request.delete(`/api/v1/data/${encodeURIComponent(connectionId)}/${encodeURIComponent(table)}/${encodeURIComponent(firstKey)}?confirm=true`);
    expect(removed.ok(), await removed.text()).toBe(true);
    made.shift();
    expect((await page.request.get(`/api/v1/files/${secondCopy}/content`)).status()).toBe(200);
    await page.goto(`/p/${slug}`);
    await expect(page.locator(`img[src*="${secondCopy}"]`).first()).toBeVisible();
    await expect(page.locator(`img[src*="${firstCopy}"]`)).toHaveCount(0);
  });
});
