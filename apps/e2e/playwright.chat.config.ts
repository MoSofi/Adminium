// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Playwright config for the live chat window's spec alone. The spec composes
 * its own server (`tests/chatWorld.ts`) on `E2E_PORT` (4876 when unset), so
 * a person's reply can go through the chat's own store: no shared server,
 * no sign-in project. Build first (`pnpm build`).
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /chat-window\.spec\.ts/,
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
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // The owner's website is an https page the browser's router serves, and the chat's server is on
        // this machine: Chrome's local-network check would refuse the loader from a public page.
        launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessRespectPreflightResults'] },
      },
    },
  ],
});
