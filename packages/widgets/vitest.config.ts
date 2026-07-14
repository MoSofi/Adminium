import { defineConfig } from 'vitest/config';

/**
 * Default environment is `node` so the pure layers (page-config leaf tests in
 * test/, registry metadata) run without a DOM — happy-dom's URL global breaks
 * `new URL(rel, import.meta.url)` file resolution in test/leaf-purity.test.ts.
 * React frame/host tests opt into happy-dom per file via the
 * `// @vitest-environment happy-dom` docblock (same pattern as @adminium/charts).
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});
