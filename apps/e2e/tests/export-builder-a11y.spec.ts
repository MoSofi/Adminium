// SPDX-License-Identifier: AGPL-3.0-only
/**
 * axe over the Export Builder's states (41-export-builder.md T20): step 1,
 * step 2 with its browser, step 3 with the sample, and the phone-width
 * column sheet. Same rules and the same blocking set as `a11y.spec.ts`.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { signIn } from './helpers.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);

async function expectNoBlockingViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = results.violations.filter((violation) => BLOCKING.has(violation.impact ?? ''));
  const report = blocking
    .map(
      (violation) =>
        `${violation.impact}: ${violation.id} — ${violation.help}\n` +
        violation.nodes
          .slice(0, 3)
          .map((node) => `    ${String(node.target.join(' '))}`)
          .join('\n'),
    )
    .join('\n');
  expect(blocking, `${label} has ${String(blocking.length)} blocking violations:\n${report}`).toEqual([]);
}

test.describe('the export builder is accessible', () => {
  test('every step and the phone sheet', async ({ page }) => {
    await signIn(page);
    await page.goto('/exports/new');
    await expect(page.getByTestId('export-builder-table-orders')).toBeVisible();
    await expectNoBlockingViolations(page, 'step 1 — source');

    await page.getByTestId('export-builder-table-orders').click();
    await expect(page.getByTestId('export-builder-start-from')).toBeVisible();
    await expectNoBlockingViolations(page, 'step 1 — start from');

    await page.getByTestId('export-builder-next').click();
    await expect(page.getByTestId('export-builder-columns')).toBeVisible();
    await page.getByTestId('export-builder-calc-toggle').click();
    await expect(page.getByTestId('export-builder-calc')).toBeVisible();
    await expectNoBlockingViolations(page, 'step 2 — columns, browser and calculated forms');

    await page.getByTestId('export-builder-follow-customer_id').click();
    await expect(page.getByTestId('export-builder-crumb-back')).toBeVisible();
    await expectNoBlockingViolations(page, 'step 2 — a followed link');
    await page.getByTestId('export-builder-crumb-back').click();

    await page.getByTestId('export-builder-next').click();
    await expect(page.getByTestId('export-builder-sample-table')).toBeVisible();
    await expectNoBlockingViolations(page, 'step 3 — preview');
    await page.getByTestId('export-builder-tab-raw').click();
    await expect(page.getByTestId('export-builder-sample-raw')).toBeVisible();
    await expectNoBlockingViolations(page, 'step 3 — raw file');
  });

  test('the phone-width column sheet', async ({ page }) => {
    // Sign in at desktop width — the shell's primary navigation is what the
    // helper waits for, and a phone viewport folds it away — then narrow.
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/exports/new');
    await page.getByTestId('export-builder-table-orders').click();
    await page.getByTestId('export-builder-next').click();
    await expect(page.getByTestId('export-builder-columns')).toBeVisible();
    await page.getByTestId('export-builder-open-sheet').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('export-builder-browser')).toBeVisible();
    await expectNoBlockingViolations(page, 'the column sheet');
  });
});
