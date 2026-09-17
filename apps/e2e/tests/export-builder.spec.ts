// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Export Builder end to end (acceptance 1, 4, 5, 6, 8): choose
 * Northwind's `orders`, add the suggested customer company name (a linked
 * value) and a fold over `order_details`, read the sample, export, and
 * parse the downloaded file — on whichever engine the run is on.
 */
import { expect, test } from '@playwright/test';

import { signIn } from './helpers.js';

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] as string;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out;
}

test.describe('the export builder', () => {
  test('builds a file with a linked value and a fold, previews it, and downloads it', async ({ page }) => {
    await signIn(page);
    await page.goto('/exports');
    await page.getByTestId('exports-new').click();
    await expect(page).toHaveURL(/\/exports\/new$/);
    await expect(page.getByRole('heading', { name: 'New export' })).toBeVisible();

    // Step 1 — the table list, with counts, and the start-from card.
    await page.getByTestId('export-builder-table-orders').click();
    await expect(page.getByTestId('export-builder-start-from')).toBeVisible();
    await expect(page.getByTestId('export-builder-step-suffix')).toHaveText('orders');
    await page.getByTestId('export-builder-next').click();

    // Step 2 — the suggested linked value, then a fold over the line items.
    await expect(page.getByTestId('export-builder-columns')).toBeVisible();
    await page.getByTestId('export-builder-suggest-s:link:customer_id').click();
    await expect(page.getByTestId('export-builder-row-customer_id__company_name')).toBeVisible();
    await page.getByTestId('export-builder-fold-col-order_details-unit_price').click();
    await page.getByTestId('export-builder-fold-col-order_details-quantity').click();
    await page.getByTestId('export-builder-fold-add-order_details').click();
    await expect(page.getByTestId('export-builder-row-order_details__unit_price')).toBeVisible();
    await expect(page.getByTestId('export-builder-header-order_details__unit_price')).toHaveValue('Sum of unit price × quantity');
    await page.getByTestId('export-builder-next').click();

    // Step 3 — the sample is the file: headers in order, the joined company name in a cell.
    const table = page.getByTestId('export-builder-sample-table');
    await expect(table).toBeVisible();
    const headers = await table.locator('thead th').allTextContents();
    expect(headers).toContain('Customer company name');
    expect(headers).toContain('Sum of unit price × quantity');
    await expect(table.locator('tbody tr').first()).toBeVisible();
    await page.getByTestId('export-builder-tab-raw').click();
    const firstRaw = page.getByTestId('export-builder-sample-raw').locator('div').first();
    await expect(firstRaw).toContainText('Customer company name');
    await expect(page.getByTestId('export-builder-summary-rail')).toContainText('Kept for 30 days');

    // Export — the started card, then the download.
    await page.getByTestId('export-builder-next').click();
    await expect(page.getByTestId('export-builder-started')).toBeVisible();
    const download = page.getByTestId('export-builder-download');
    await expect(download).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('export-builder-progress-label')).toContainText('Ready');
    const href = await download.getAttribute('href');
    expect(href).toMatch(/\/api\/v1\/exports\/.+\/download$/);
    const response = await page.request.get(href as string);
    expect(response.ok()).toBe(true);
    const text = (await response.text()).replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
    const header = parseCsvLine(lines[0] as string);
    expect(header).toEqual(headers);
    const companyAt = header.indexOf('Customer company name');
    const sumAt = header.indexOf('Sum of unit price × quantity');
    const firstRow = parseCsvLine(lines[1] as string);
    expect(firstRow[companyAt]?.length).toBeGreaterThan(0);
    expect(firstRow[sumAt]).toMatch(/^\d+(\.\d+)?$/);

    // …and the row landed on Data exports.
    await page.goto('/exports');
    await expect(page.getByTestId('exports-list')).toContainText('orders-');
  });

  test('a failed-looking round trip: the builder opens pre-filled from an export', async ({ page }) => {
    await signIn(page);
    // Any finished export will do to prove the prefill; the previous test made one.
    const list = await page.request.get('/api/v1/exports');
    const rows = (await list.json()).data as { id: string; status: string; source: { columns?: unknown[] } }[];
    const row = rows.find((entry) => Array.isArray(entry.source.columns));
    test.skip(row === undefined, 'no builder-made export to reopen');
    await page.goto(`/exports/new?basedOn=${row!.id}`);
    await expect(page.getByTestId('export-builder-based-on')).toBeVisible();
    await expect(page.getByTestId('export-builder-step-suffix')).toHaveText('orders');
    await page.getByTestId('export-builder-next').click();
    await expect(page.getByTestId('export-builder-row-customer_id__company_name')).toBeVisible();
  });

  /**
   * The remaining done-when: "pointer drag verified in real Chrome". Every
   * other reorder assertion in this repo is a jsdom call into
   * `model.moveColumn`/`dropOn` (`model.test.ts`), which proves the reducer and
   * nothing about dnd-kit — the sensor, the 4px activation distance, the
   * `onDragMove` half-test that picks before/after, and the comp's insertion
   * line (D12) are all browser-only. The in-app Browser pane cannot see them
   * (its rAF never ticks, so a dnd-kit drag never moves); Playwright's Chromium
   * can, so the pointer path is pinned here rather than walked by hand once.
   */
  test('reorders a column by pointer drag, drawing the insertion line (D12)', async ({ page }) => {
    await signIn(page);
    await page.goto('/exports/new');
    await page.getByTestId('export-builder-table-orders').click();
    await page.getByTestId('export-builder-next').click();
    await expect(page.getByTestId('export-builder-columns')).toBeVisible();

    // The first two rows of the table's own columns, whatever they are.
    const rows = page.locator('[data-testid^="export-builder-row-"]');
    await expect(rows.first()).toBeVisible();
    const idOf = async (index: number): Promise<string> =>
      (await rows.nth(index).getAttribute('data-testid'))!.replace('export-builder-row-', '');
    const [first, second] = [await idOf(0), await idOf(1)];
    expect(first).not.toEqual(second);

    const handle = page.getByTestId(`export-builder-handle-${first}`);
    const target = page.getByTestId(`export-builder-row-${second}`);
    const grip = (await handle.boundingBox())!;
    const drop = (await target.boundingBox())!;

    // At rest neither class is on the page. Asserted so the two mid-drag
    // expectations below cannot pass vacuously: a throwaway control making the
    // identical pointer MOVES without pressing left both absent, which is what
    // makes their presence evidence that the sensor actually engaged.
    await expect(page.getByTestId(`export-builder-row-${first}`)).not.toHaveClass(/opacity-\[\.42\]/);
    await expect(target).not.toHaveClass(/after:absolute/);

    // Press, cross the 4px activation distance, then settle past the second
    // row's midpoint so `onDragMove` resolves the half as "after".
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 8, { steps: 4 });
    await page.mouse.move(grip.x + grip.width / 2, drop.y + drop.height * 0.9, { steps: 12 });

    // Mid-drag: the dragged row dims to .42 and the target carries the comp's
    // 3px accent bar (a ::after pseudo-element, so the class is the assertion).
    await expect(page.getByTestId(`export-builder-row-${first}`)).toHaveClass(/opacity-\[\.42\]/);
    await expect(target).toHaveClass(/after:absolute/);

    await page.mouse.up();

    // The drop landed: the two rows swapped, and the mono index followed.
    await expect(rows.nth(0)).toHaveAttribute('data-testid', `export-builder-row-${second}`);
    await expect(rows.nth(1)).toHaveAttribute('data-testid', `export-builder-row-${first}`);
    await expect(page.getByTestId(`export-builder-row-${first}`)).not.toHaveClass(/opacity-\[\.42\]/);
    await expect(target).not.toHaveClass(/after:absolute/);
  });
});
