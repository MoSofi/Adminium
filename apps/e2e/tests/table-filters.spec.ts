// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE TOOLBAR'S FILTERS, END TO END.
 *
 * The unit tests prove the condition each menu sends and the card that defines
 * them. What only a browser can prove is the chain between: a filter defined in
 * Studio has to survive the save, reach the page's toolbar, narrow rows the
 * server actually returned, ride into a SAVED VIEW, and come back on a reload
 * as the same question. Every link in that chain has crossed a process
 * boundary, and each one has been broken at some point by a change that every
 * unit test still passed.
 *
 * Northwind has no enum column, so the choice columns here are made the way an
 * admin makes them: a `column.options` rule fixing the values two text columns
 * accept. Both the rule and the page config are put back at the end — this
 * suite shares its instance with every other spec.
 */
import { expect, test, type Page } from '@playwright/test';

import { seededConnectionId, signIn } from './helpers.js';

/** Values that exist in the seeded data, so a filter narrows rather than empties. */
const COUNTRIES = ['Germany', 'France', 'UK'];
const TITLES = ['Owner', 'Sales Agent', 'Sales Representative'];

interface Override {
  op: string;
  tableName: string;
  columnName: string | null;
  value: unknown;
  /** Only an ACTIVE override reaches the effective schema. */
  status?: string;
}

async function readOverrides(page: Page, connection: string): Promise<Override[]> {
  const reply = await page.request.get(`/api/v1/connections/${connection}/schema/overrides`);
  const { overrides } = (await reply.json()) as { overrides: (Override & { status: string })[] };
  return overrides.map((row) => ({
    op: row.op,
    tableName: row.tableName,
    columnName: row.columnName,
    value: row.value,
    status: row.status,
  }));
}

async function writeOverrides(page: Page, connection: string, overrides: Override[]): Promise<void> {
  const reply = await page.request.put(`/api/v1/connections/${connection}/schema/overrides`, {
    data: { overrides },
  });
  expect(reply.status(), await reply.text()).toBe(200);
}

async function pageIdOf(page: Page, slug: string): Promise<string> {
  const reply = await page.request.get('/api/v1/pages');
  const { data } = (await reply.json()) as { data: { id: string; slug: string }[] };
  const found = data.find((entry) => entry.slug === slug);
  expect(found, `the seed generates a ${slug} page`).toBeDefined();
  return String(found?.id);
}

/** The table's qualified id — `main.` on SQLite, `public.` on the others. */
async function tableOf(page: Page, id: string): Promise<string> {
  const reply = await page.request.get(`/api/v1/pages/${id}`);
  const body = (await reply.json()) as { data: { source: { table: string } } };
  return body.data.source.table;
}

test('a filter defined in Studio narrows the table and rides into a saved view', async ({ page }) => {
  await signIn(page);
  const connection = await seededConnectionId(page);
  const before = await readOverrides(page, connection);
  const customers = await pageIdOf(page, 'customers');
  const table = await tableOf(page, customers);
  const configReply = await page.request.get(`/api/v1/pages/${customers}`);
  const storedConfig = ((await configReply.json()) as { data: { config?: Record<string, unknown> } }).data
    .config;

  try {
    // ── An admin fixes what two columns accept, which is what makes them
    //    choice columns — and therefore filterable with a menu.
    await writeOverrides(page, connection, [
      ...before,
      {
        op: 'column.options',
        tableName: table,
        columnName: 'country',
        value: { values: COUNTRIES.map((value) => ({ value })) },
        status: 'active',
      },
      {
        op: 'column.options',
        tableName: table,
        columnName: 'contact_title',
        value: { values: TITLES.map((value) => ({ value })) },
        status: 'active',
      },
    ]);

    // ── Define the two filters in Studio ──────────────────────────────────
    await page.goto(`/studio/pages/${customers}`);
    const card = page.getByTestId('filters-card');
    await expect(card).toBeVisible();

    // Both columns are choices now, so the card opens on them already — the
    // derivation, which is what makes filters exist on a page nobody has
    // configured. The editing here is what gets STORED.
    await expect(card.getByTestId('filters-control-country')).toBeVisible();
    // The second one asks for several at once — the same menu, more ticks.
    await card.getByTestId('filters-control-contact_title').selectOption('any-of');
    await card.getByTestId('filters-name-country').fill('Country');

    await page.getByTestId('studio-pages-save').click();
    /*
     * Wait for the SAVE, not for the button.
     *
     * A successful save leaves the editor, so "the button is disabled" is a
     * state that exists for however long the navigation takes — on a slower
     * runner the screen is already gone and the assertion fails on an element
     * that is not there. The stored config is the thing this test depends on,
     * and asking the server for it is not a race.
     */
    await expect
      .poll(async () => {
        const reply = await page.request.get(`/api/v1/pages/${customers}`);
        const body = (await reply.json()) as { data: { config?: { filters?: unknown[] } } };
        return body.data.config?.filters?.length ?? 0;
      }, { message: 'the page stores the two filters' })
      .toBe(2);

    // ── The page's toolbar now asks those questions ───────────────────────
    await page.goto('/p/customers');
    const bar = page.getByTestId('filter-bar');
    await expect(bar).toBeVisible();
    // The name the page gave it, not the column's.
    await expect(bar.getByTestId('filter-open-country')).toContainText('Country');

    const rows = page.getByRole('row');
    const total = await rows.count();

    await bar.getByTestId('filter-open-country').click();
    await page.getByTestId('filter-row-country-Germany').click();
    await expect(bar).toContainText('Country: Germany');
    await expect
      .poll(async () => rows.count(), { message: 'the filter narrows the table' })
      .toBeLessThan(total);

    await bar.getByTestId('filter-open-contact_title').click();
    await page.getByTestId('filter-row-contact_title-Sales Representative').click();
    // "Any of" stays open: choosing three values must not be three journeys.
    await page.getByTestId('filter-row-contact_title-Owner').click();
    await page.keyboard.press('Escape');
    const narrowed = await rows.count();

    // ── A saved view remembers the question ───────────────────────────────
    await page.locator('[data-part="view-switcher-trigger"]').click();
    await page.getByRole('menuitem', { name: /Save current as view/ }).click();
    await page.getByLabel('View name').fill('German owners');
    await page.getByRole('button', { name: 'Save view' }).click();

    await page.reload();
    // A reload starts on the base view — a saved view is a question you ASK
    // again, not one the page keeps asking.
    await expect(page.getByTestId('filter-bar')).not.toContainText('Country: Germany');

    await page.locator('[data-part="view-switcher-trigger"]').click();
    await page.getByRole('menuitem', { name: 'German owners' }).click();
    // The whole question comes back — both filters, not just the first.
    await expect(page.getByTestId('filter-bar')).toContainText('Country: Germany');
    await expect.poll(async () => rows.count()).toBe(narrowed);

    // ── And a way back out ────────────────────────────────────────────────
    await page.getByTestId('filter-clear').click();
    await expect(page.getByTestId('filter-bar')).not.toContainText('Country: Germany');
    await expect.poll(async () => rows.count()).toBe(total);
  } finally {
    const views = await page.request.get(`/api/v1/pages/${customers}/views`);
    for (const view of ((await views.json()) as { data: { views: { id: string }[] } }).data.views) {
      await page.request.delete(`/api/v1/pages/${customers}/views/${view.id}`);
    }
    await writeOverrides(page, connection, before);
    await page.request.patch(`/api/v1/pages/${customers}/config`, {
      data: { config: { ...(storedConfig ?? {}), filters: undefined } },
    });
  }
});
