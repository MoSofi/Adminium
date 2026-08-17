// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    // Node by default (framework-free core); React tests opt into happy-dom
    // via `// @vitest-environment happy-dom` per the repo convention.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // Raised above vitest's 5s default for the same reason @adminium/widgets
    // raises it: `resources/parity.test.ts` compiles every ICU message of a
    // locale in ONE test (65 of them, ~1.4s for the whole file locally), and on
    // a cache-cold `verify` run — where a lockfile change invalidates nearly
    // every turbo hash and the whole monorepo rebuilds and retests at once —
    // a single locale exceeded 5s and failed as a timeout. The work is
    // deterministic and CPU-bound, so the budget was the only thing wrong.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
