// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Playwright config for the Lead finder spec alone: the real add-on (from the add-ons checkout)
 * with its sources answered by the server's demo seam. The spec composes its own
 * server (`tests/leadFinderWorld.ts`) on `E2E_PORT` (4924 when unset): no
 * shared server, no sign-in project. Build first (`pnpm build`).
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /lead-finder\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: [['list']],
  timeout: 120_000,
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
