// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Playwright config for the landing page's spec alone. The spec composes its
 * own server (`tests/landingWorld.ts`) on `E2E_PORT` (4902 when unset): no
 * shared server, no first-run server, no sign-in project. Build first
 * (`pnpm build`).
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /landing-page\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: [['list']],
  timeout: 90_000,
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
