// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/imports` and `/exports` (09 §11) — that the two data-io screens still
 * arrive, now that their bodies are behind a dynamic import.
 *
 * Neither route had coverage at any level: `dataio.test.tsx` mounts the two
 * page components directly, so it proves the components render and says nothing
 * about the ROUTE — and a route whose body is lazy fails in ways a direct mount
 * cannot see (a bad specifier, a missing default, a Suspense boundary in the
 * wrong place). That is precisely the change `data-io/routes.tsx` just made:
 * both bodies moved out of the entry chunk, which is also what made the
 * `page-wizard` template's own lazy binding real rather than nominal.
 *
 * The assertions are deliberately shallow — the page frame, and one control
 * that only exists inside the lazily-loaded body. Anything deeper belongs with
 * the wizard's own suite; this one answers "did the chunk arrive and mount".
 */
import { expect, test } from '@playwright/test';

import { signIn } from './helpers.js';

test.describe('data-io routes load their bodies', () => {
  test('/imports renders the wizard behind its Suspense boundary', async ({ page }) => {
    await signIn(page);
    await page.goto('/imports');

    // The frame paints first: the surface and its topbar title are outside the
    // Suspense boundary on purpose, so a navigation never looks like it failed.
    await expect(page.getByRole('heading', { name: 'Import data' })).toBeVisible();

    // …and the body follows. The step rail is inside the lazy chunk.
    await expect(page.getByText('Map columns')).toBeVisible();
    await expect(page.getByText('Drop a CSV file to import')).toBeVisible();
  });

  test('/exports renders the exports manager behind its Suspense boundary', async ({ page }) => {
    await signIn(page);
    await page.goto('/exports');

    await expect(page.getByRole('heading', { name: 'Data exports' })).toBeVisible();
    await expect(page.getByText('Exports are kept for 30 days, then expire.')).toBeVisible();
  });
});
