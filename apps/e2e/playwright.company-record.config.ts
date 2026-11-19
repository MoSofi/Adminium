// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Playwright config for the company record spec alone: an add-on's action and
 * the field notes on a declared companies table. The spec composes its own
 * server (`tests/companyRecordWorld.ts`) on `E2E_PORT` (4920 when unset): no
 * shared server, no sign-in project. Build first (`pnpm build`).
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /company-record\.spec\.ts/,
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
