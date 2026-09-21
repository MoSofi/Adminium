// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Template fit, end to end: a page says what it needs, and offers to go get it.
 *
 * Two passes over the create screen, each one a whole flow an operator can
 * finish without knowing their own schema:
 *
 *  - the WRONG TABLE (the most common real failure): a calendar over
 *    `customers`, which has no date. The screen names what is missing and
 *    offers tables that already fit; choosing one ends the flow with nothing
 *    written to the database.
 *  - NO TABLE AT ALL: the calendar gets a table of its own. The exact CREATE is
 *    shown before it runs, the page is bound to the new table, and the
 *    calendar it produces can take an event — writable, not a picture of one.
 *
 * Runs on every engine job, because "create a table with a timestamp" is the
 * operation whose type round trip differed per dialect (a SQLite timestamp
 * used to read back as text, and the calendar refused its own new table).
 *
 * DRIFT. This suite shares one seeded dataset. Nothing here alters a Northwind
 * table; the one table it creates is `e2e_`-prefixed like the schema-design
 * suite's, and uniquely named so a retry on the same instance does not collide.
 */
import { expect, test, type Page } from '@playwright/test';

import { ENGINE } from './constants.js';
import { signIn } from './helpers.js';

/** Reach the create screen with a template chosen and the table picker ready. */
async function startCalendar(page: Page): Promise<void> {
  await signIn(page);
  await page.goto('/studio/pages/new');
  await page.getByTestId('studio-pages-template').selectOption('page-calendar');
  await expect(page.getByTestId('studio-pages-create-table')).toBeEnabled();
}

/** The picker's id for a Northwind table — the schema half differs per engine. */
async function tableIdFor(page: Page, name: string): Promise<string> {
  const values = await page
    .getByTestId('studio-pages-create-table')
    .locator('option')
    .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  const id = values.find((value) => value.endsWith(`.${name}`));
  if (id === undefined) throw new Error(`no ${name} table in the picker: ${values.join(', ')}`);
  return id;
}

test.describe(`template fit [${ENGINE}]`, () => {
  // East of UTC, where a timestamp's UTC day is the PREVIOUS day for an event
  // near midnight — so a calendar that files instants by their UTC prefix, or
  // a composer that writes a bare date into a timestamp, fails here even on a
  // UTC machine. Postgres only: it returns instants, which any viewer zone
  // must read right. SQLite returns a naive timestamp as the SERVER's wall
  // clock, which reads right only in the server's own zone, and MySQL is not
  // rehearsed with a split zone.
  if (ENGINE === 'postgres') test.use({ timezoneId: 'Asia/Tokyo' });

  test('a table with no date is explained, and a table that fits is offered first', async ({ page }) => {
    await startCalendar(page);
    const picker = page.getByTestId('studio-pages-create-table');
    await picker.selectOption(await tableIdFor(page, 'customers'));

    const panel = page.getByTestId('studio-pages-fit');
    await expect(panel).toBeVisible();
    // In the operator's words, not the composer's.
    await expect(panel).toContainText('a date on each row');
    await expect(page.getByTestId('studio-pages-create-submit')).toBeDisabled();

    // Remedy 0: another table already fits — offered before anything that writes.
    const offers = page.getByTestId('studio-pages-fit-alternatives');
    await expect(offers).toBeVisible();
    const ordersId = await tableIdFor(page, 'orders');
    const useOrders = offers.getByTestId(`studio-pages-fit-use-${ordersId}`);
    await expect(useOrders).toBeVisible();
    await useOrders.click();

    // Choosing it ends the flow: the panel is gone and Create is live.
    await expect(panel).toHaveCount(0);
    await expect(picker).toHaveValue(ordersId);
    await page.getByTestId('studio-pages-title').fill('Order dates');
    await expect(page.getByTestId('studio-pages-create-submit')).toBeEnabled();
  });

  test('with no table at all, a new one is created, bound, and takes an event', async ({ page }) => {
    const suffix = Date.now().toString(36);
    const table = `e2e_visits_${suffix}`;
    const slug = `e2e-visits-${suffix}`;

    await startCalendar(page);
    await page.getByTestId('studio-pages-create-new-table').click();
    const setup = page.getByTestId('studio-pages-fit-table');
    await expect(setup).toBeVisible();
    const name = page.getByTestId('studio-pages-fit-table-name');
    await name.fill(table);

    const review = page.getByTestId('studio-pages-fit-table-plan');
    await expect(review).toBeEnabled();
    await review.click();
    // The exact statement, before anything runs.
    const plan = page.getByTestId('studio-pages-fit-table-plan-review');
    await expect(plan).toContainText(/create table/i);
    await expect(plan).toContainText(table);
    await page.getByTestId('studio-pages-fit-table-confirm').click();

    // Bound to the new table, which fits — so no panel and a live Create.
    await expect(setup).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('studio-pages-create-table')).toHaveValue(new RegExp(`\\.${table}$`));
    await expect(page.getByTestId('studio-pages-fit')).toHaveCount(0);
    await page.getByTestId('studio-pages-title').fill('E2E visits');
    await page.getByTestId('studio-pages-slug').fill(slug);
    await page.getByTestId('studio-pages-create-submit').click();
    await expect(page).toHaveURL(/\/studio\/pages$/);

    // The page is a calendar, not the "no table" notice.
    await page.goto(`/p/${slug}`);
    await expect(page.locator('[data-part="page-calendar"]')).toBeVisible();
    await expect(page.getByTestId('page-empty-layout')).toHaveCount(0);

    // And it is writable: the agenda's composer inserts into the new table.
    const created = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/api/v1/data/'),
    );
    await page.getByRole('button', { name: 'Add event' }).click();
    await page.getByRole('textbox').last().fill('First visit');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    expect((await created).status()).toBe(201);

    // The widget-data cache holds a read for up to 30 s, so the new event is
    // polled for across reloads rather than expected on the next frame.
    //
    // On TODAY's agenda — the day it was added on. The composer writes the
    // viewer's midnight as an instant and the calendar files an instant by
    // its day in the viewer's zone; either half getting the zone wrong moves
    // the event to yesterday (it used to land on the previous day at 10 PM
    // on postgres, east of UTC).
    const todaysAgenda = page.locator('[data-part="calendar-agenda"]');
    await expect(async () => {
      await page.reload();
      await expect(
        todaysAgenda.locator('[data-part="agenda-event"]', { hasText: 'First visit' }),
      ).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 45_000, intervals: [5_000] });
    // And the month grid files it on the same day: today in the BROWSER's zone.
    const today = await page.evaluate(() => {
      const now = new Date();
      const pad = (n: number): string => String(n).padStart(2, '0');
      return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    });
    await expect(page.getByRole('gridcell', { name: today }).getByText('First visit')).toBeVisible();
  });
});
