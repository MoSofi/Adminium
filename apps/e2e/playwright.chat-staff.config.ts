// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Playwright config for the live chat add-on's staff spec alone. The spec
 * composes its own server (`tests/liveChatStaffWorld.ts`) on `E2E_PORT`
 * (4880 when unset): no shared server, no sign-in project. Build first
 * (`pnpm build`), and say where the add-on's package is (`LIVE_CHAT_PACKAGE`
 * or `ADD_ONS_REPO`): without it the spec is skipped.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /live-chat-staff\.spec\.ts/,
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
