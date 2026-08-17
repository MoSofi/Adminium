// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M9-T05 e2e (e): Studio connect-wizard happy path in DSN mode — postgres
 * engine only (the wizard drives a live test+introspect+generate against the
 * same Northwind database the boot script created).
 *
 * Runs LAST (alphabetical file order + single worker): generation for the
 * second connection appends nav items, which would break the strict-mode
 * selectors of the earlier specs if it ran first.
 */
import { expect, test } from '@playwright/test';

import { ENGINE, wizardDsn } from './constants.js';
import { signIn } from './helpers.js';

test.describe('studio connect wizard (DSN mode)', () => {
  test.skip(ENGINE !== 'postgres', 'wizard happy path runs on the postgres matrix leg only');

  test('(e) connect → test → tables → meta → generate → open app', async ({ page }) => {
    await signIn(page);
    await page.goto('/studio/connect');
    await expect(page.getByRole('heading', { name: 'New connection' })).toBeVisible();

    // Step 1 — intent (default "full admin" is fine).
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // Step 2 — source, DSN mode (the default input mode).
    await page.getByLabel('Connection name').fill('wizard-e2e');
    await page.getByLabel('Connection string').fill(wizardDsn());
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // Step 3 — test + introspect auto-runs; the log ends in "Ready".
    await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // Step 4 — table inclusion (defaults persist on Continue).
    await expect(page.getByRole('heading', { name: 'Choose your tables' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // Step 5 — meta placement: superuser DSN → same-db card is enabled.
    await page.getByRole('radio', { name: /Same database/ }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // Step 6 — Enrich with AI (M6): Continue stays disabled until a path is
    // chosen; this leg keeps the heuristic baseline (mirrors the enrich-step
    // interaction of llm-enrichment.spec.ts, which takes the BYO path).
    await expect(page.getByRole('heading', { name: 'Enrich with AI' })).toBeVisible();
    await page.getByRole('radio', { name: /Skip — use heuristics only/ }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // Step 7 — generate → success → into the app.
    await page.getByRole('button', { name: 'Generate dashboard' }).click();
    await expect(page.getByText('Your dashboard is ready')).toBeVisible({ timeout: 120_000 });
    await page.getByRole('button', { name: 'Open your app' }).click();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  });
});
