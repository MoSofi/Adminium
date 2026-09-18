// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE THREE FIELDS THAT WRITE MORE THAN ONE VALUE, end to end.
 *
 * The unit tests pin the arithmetic and the reducers; the dialect suites pin
 * the transactions. What only a browser proves is the chain between: a document
 * saved in Studio reaching the dialog, the dialog's own arithmetic over values
 * nothing has saved, and the rows that actually land — plus the Undo that takes
 * them all back.
 *
 * The page's form is put back in a `finally`, because this suite shares its
 * instance with every other spec.
 */
import { expect, test, type Page } from '@playwright/test';

import { seededConnectionId, signIn } from './helpers.js';

interface Facts {
  children?: { relationId: string; label: string; columns: { spec: Record<string, unknown> }[] }[];
}

async function ordersPage(page: Page): Promise<{ id: string; config: Record<string, unknown>; facts: Facts }> {
  const list = await page.request.get('/api/v1/pages');
  const { data } = (await list.json()) as { data: { id: string; slug: string }[] };
  const id = String(data.find((entry) => entry.slug === 'orders')?.id);
  const reply = await page.request.get(`/api/v1/pages/${id}`);
  const body = (await reply.json()) as { data: { config?: Record<string, unknown> }; columnFacts?: Facts };
  return { id, config: body.data.config ?? {}, facts: body.columnFacts ?? {} };
}

test('a line-items field writes its rows with the parent, and Undo takes them back', async ({ page }) => {
  test.slow();
  await signIn(page);
  const connection = await seededConnectionId(page);
  const { id, config, facts } = await ordersPage(page);
  const child = facts.children?.find((entry) => entry.relationId.includes('order_details'));
  expect(child, 'orders holds order_details as child rows').toBeDefined();
  const relation = String(child?.relationId);

  await page.request.patch(`/api/v1/pages/${id}/config`, {
    data: {
      config: {
        ...config,
        form: {
          v: 2,
          preset: 'repeater-totals',
          sections: [
            { id: 'main', label: 'Order', columns: 2, fields: [{ column: 'order_id' }, { column: 'ship_name' }] },
            {
              id: 'lines',
              label: 'Line items',
              columns: 1,
              fields: [
                {
                  relation,
                  control: 'child-rows',
                  label: 'Line items',
                  span: 3,
                  columns: [
                    { column: 'product_id', width: '1fr' },
                    { column: 'quantity', width: '70px' },
                    { column: 'unit_price', width: '96px' },
                    { column: 'discount', width: '92px' },
                  ],
                  totals: {
                    row: { expr: { op: 'mul', args: [{ col: 'quantity' }, { col: 'unit_price' }] } },
                    rows: [
                      { label: 'Subtotal', of: 'sum' },
                      { label: 'Tax', of: 'rate', rate: '0.085' },
                      { label: 'Total', of: 'total' },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    },
  });

  const lines = async (): Promise<Record<string, unknown>[]> => {
    // Inside `smallint` on every engine: Northwind types this key 16-bit, and a
    // 90,000 that SQLite shrugs at is `out-of-range` on Postgres.
    // Asked for by KEY, not read and filtered: `order_details` has thousands of
    // rows and a capped page would miss the two this test just wrote.
    const where = encodeURIComponent(JSON.stringify({ column: 'order_id', op: 'eq', value: 30211 }));
    const reply = await page.request.get(
      `/api/v1/data/${connection}/${encodeURIComponent('order_details')}?limit=50&where=${where}`,
    );
    expect(reply.status(), await reply.text()).toBe(200);
    return ((await reply.json()) as { data: Record<string, unknown>[] }).data;
  };

  try {
    await page.goto('/p/orders');
    await page.getByRole('button', { name: /New row/ }).click();
    const form = page.getByRole('dialog');
    await expect(form.getByTestId('child-rows')).toBeVisible();

    await form.getByLabel(/^Order Id/).fill('30211');
    await form.getByLabel(/^Ship Name/).fill('Two lines');
    for (const [index, line] of [
      { product: '1', qty: '3', unit: '10.00' },
      { product: '2', qty: '1', unit: '5.50' },
    ].entries()) {
      await form.getByTestId('child-add').click();
      await form.getByLabel(`Product Id ${String(index + 1)}`).fill(line.product);
      await form.getByLabel(`Quantity ${String(index + 1)}`).fill(line.qty);
      await form.getByLabel(`Unit Price ${String(index + 1)}`).fill(line.unit);
      await form.getByLabel(`Discount ${String(index + 1)}`).fill('0');
    }

    // The totals are arithmetic over values NO DATABASE HAS SEEN. 3×10 + 1×5.50
    // = 35.50; the rate is taken off that subtotal, not off a running total.
    await expect(form.getByTestId('child-total-sum')).toHaveText('35.50');
    await expect(form.getByTestId('child-total-rate')).toHaveText('3.02');
    await expect(form.getByTestId('child-total-total')).toHaveText('38.52');

    await form.getByRole('button', { name: /^Create order/ }).click();
    await expect(form).toBeHidden({ timeout: 20_000 });

    const written = await lines();
    expect(written).toHaveLength(2);
    // The foreign key was never in the form and is on every row.
    expect(written.every((row) => String(row['order_id']) === '30211')).toBe(true);

    await page.getByRole('button', { name: /^Undo$/ }).click();
    await expect
      .poll(async () => (await lines()).length, { message: 'undo takes the lines with the parent' })
      .toBe(0);
  } finally {
    await page.request.patch(`/api/v1/pages/${id}/config`, { data: { config } });
  }
});

test('a calendar crosses out what is taken — and never the record being edited', async ({ page }) => {
  test.slow();
  await signIn(page);
  const { id, config } = await ordersPage(page);

  await page.request.patch(`/api/v1/pages/${id}/config`, {
    data: {
      config: {
        ...config,
        form: {
          v: 2,
          preset: 'split-pane',
          sections: [
            {
              id: 'when',
              label: 'When',
              columns: 1,
              fields: [{ column: 'order_date', control: 'calendar', availability: {} }],
            },
            { id: 'rest', label: 'Order', columns: 1, fields: [{ column: 'ship_name' }] },
          ],
        },
      },
    },
  });

  try {
    await page.goto('/p/orders');
    await page.getByRole('row').nth(1).getByRole('button', { name: 'Peek' }).click();
    await page.getByRole('button', { name: /^Edit/ }).first().click();
    const form = page.getByRole('dialog').filter({ hasText: 'Edit order' });
    await expect(form.getByTestId('calendar-control')).toBeVisible();
    await expect(form.getByTestId('form-split-layout')).toBeVisible();

    // The seeded orders cluster in their own month, so some days are held.
    await expect
      .poll(async () => form.locator('[data-testid^="calendar-day-"][disabled]').count(), {
        message: 'days other orders hold are crossed out',
      })
      .toBeGreaterThan(0);

    // …and the day THIS order holds is not one of them, or the one date it
    // already has would be the one date it could not keep.
    const own = form.locator('[data-testid^="calendar-day-"][aria-pressed="true"]');
    await expect(own).toHaveCount(1);
    await expect(own).toBeEnabled();
  } finally {
    await page.request.patch(`/api/v1/pages/${id}/config`, { data: { config } });
  }
});
