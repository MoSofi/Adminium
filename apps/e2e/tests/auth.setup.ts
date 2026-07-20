/**
 * One real UI sign-in per run, saved as Playwright storageState.
 *
 * WHY: the suite performs ~16 logins seconds apart, and the production
 * `auth-login` bucket (08-server-api.md §6, plugins/core.ts RATE_BUCKETS)
 * allows 5/min per ip — successful logins included — so the 6th fresh UI
 * login 429s BY DESIGN. Rather than weakening the shipped limits for tests,
 * the suite exercises the real login form exactly once here and every test
 * reuses the resulting session cookie via `storageState` (playwright.config
 * `chromium` project depends on this `setup` project). `helpers.signIn()`
 * keeps a fresh-login fallback for a dead session (crashed worker, expiry) —
 * rare enough to stay far under the 5/min budget.
 */
import { expect, test as setup } from '@playwright/test';

import { ADMIN_EMAIL, ADMIN_PASSWORD, storageStatePath } from './constants.js';

setup('sign in once — every test reuses this session', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await page.context().storageState({ path: storageStatePath() });
});
