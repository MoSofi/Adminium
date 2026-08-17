// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Playwright config for the @adminium/ui visual-regression matrix
 * (03-component-library.md §10). Runs vrt/vrt.spec.ts against the static
 * Storybook build served by the zero-dep server in scripts/serve-static.mjs.
 *
 * Baselines live in vrt/__screenshots__/ and are canonical for LINUX
 * rendering only (CI container). The snapshot path template deliberately
 * omits the {platform} suffix so CI and the Docker update flow share one
 * baseline set; regenerating on macOS/Windows produces font-rasterization
 * diffs and must not be committed — see vrt/RTL-AUDIT.md and the update
 * flow below.
 *
 * Update flow:
 *   pnpm vrt          # compare against committed baselines
 *   pnpm vrt:update   # re-capture baselines (run inside the CI container /
 *                     # Docker on non-Linux hosts), then commit the diff
 *   VRT_FRESH=1 pnpm vrt   # force a storybook rebuild first
 */
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env['VRT_PORT'] ?? 6106);

export default defineConfig({
  testDir: './vrt',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
  expect: {
    toHaveScreenshot: {
      // §10: tight ratio — token/layout drift must surface
      maxDiffPixelRatio: 0.001,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    // §10 determinism: end-states for nb-* keyframes, no JS-driven motion
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: `node scripts/ensure-storybook.mjs && node scripts/serve-static.mjs storybook-static ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.json`,
    reuseExistingServer: !process.env['CI'],
    timeout: 300_000, // includes a cold storybook build
  },
});
