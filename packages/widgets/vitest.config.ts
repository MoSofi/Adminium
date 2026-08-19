// SPDX-License-Identifier: AGPL-3.0-only
import { coverage } from '@adminium/config/vitest';
import { defineConfig } from 'vitest/config';

/**
 * Default environment is `node` so the pure layers (page-config leaf tests in
 * test/, registry metadata) run without a DOM — happy-dom's URL global breaks
 * `new URL(rel, import.meta.url)` file resolution in test/leaf-purity.test.ts.
 * React frame/host tests opt into happy-dom per file via the
 * `// @vitest-environment happy-dom` docblock (same pattern as @adminium/charts).
 *
 * testTimeout is raised above vitest's 5s default because the React tests mount
 * through `WidgetHost`, whose async widget resolution (the lazy component
 * barrel) is slow when the suite runs in parallel with the live-DB and server
 * suites on a shared CI runner — 5s was marginal and a `document-canvas` wait
 * flaked past it under load. The DOM-free leaf tests finish in milliseconds and
 * never approach this; it only buys headroom for the mounting tests, without
 * touching any assertion. (The media suite's tolerant `findByTestId` waits stay
 * bounded by the 1000ms async-util default — see src/test/setup.ts.)
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
        // 15-quality.md §1 exempts this package from a line-coverage floor —
      // screenshots and axe are the signal. Collected and reported, asserts nothing.
  coverage: coverage(),
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
