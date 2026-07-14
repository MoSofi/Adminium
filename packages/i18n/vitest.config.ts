import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    // Node by default (framework-free core); React tests opt into happy-dom
    // via `// @vitest-environment happy-dom` per the repo convention.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
