// SPDX-License-Identifier: AGPL-3.0-only
import { coverage, workers } from '@adminium/config/vitest';
import { defineConfig } from 'vitest/config';

/**
 * Default environment is `node` so the pure layers (utils/, demo/, geometry/)
 * run without a DOM. Component tests opt into happy-dom per file via the
 * `// @vitest-environment happy-dom` docblock (see src/components/charts.test.tsx).
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    ...workers(),
        // 15-quality.md §1 exempts this package from a line-coverage floor —
      // screenshots and axe are the signal. Collected and reported, asserts nothing.
  coverage: coverage(),
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
