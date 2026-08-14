/**
 * Playwright config for the DESKTOP `_electron` suite (11-electron.md §7 +
 * acceptance criteria, task 11-T20).
 *
 * SEPARATE from `playwright.config.ts` (the 3-engine server/dashboard matrix) on
 * purpose, and this is the whole gating story:
 *
 *  - Different `testDir` (`tests-desktop/`, not `tests/`) and a `desktop-e2e`
 *    project, so the two suites never pick up each other's specs.
 *  - No `webServer`: these specs launch the BUILT Electron app themselves
 *    (`apps/desktop/out/main/index.js`) — there is no server to boot here.
 *  - Run via `pnpm --filter @adminium/e2e e2e:desktop` (turbo task
 *    `@adminium/e2e#e2e:desktop`), NOT via `pnpm test`. apps/e2e has no `test`
 *    script, so — exactly like the engine legs — the desktop suite stays out of
 *    the repo-wide `pnpm test` gate and cannot turn it red.
 *
 * PREREQUISITES (CI): a display and a built desktop app. A third one — native
 * modules rebuilt for Electron's ABI in the desktop app's node_modules — no
 * longer applies now that `better-sqlite3` (>= 13) and `argon2` (>= 0.44) are
 * both Node-API and load unrebuilt under Electron. See
 * `tests-desktop/helpers/paths.ts` for the full history and why the CI rebuild
 * step is kept as a no-op.
 */

import { defineConfig } from '@playwright/test';

const isCI = process.env['CI'] !== undefined && process.env['CI'] !== '';

export default defineConfig({
  testDir: './tests-desktop',
  // One Electron app at a time: the specs launch (and the crash test relaunches)
  // real apps that each own an isolated data dir; parallel apps would contend.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // A launch + first-run generation (+ a relaunch, for the crash test) is minutes.
  timeout: 300_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results-desktop',
  reporter: isCI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-desktop' }]]
    : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'desktop-e2e' }],
});
