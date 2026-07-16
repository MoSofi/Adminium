import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const i18nSrc = (rel: string): string =>
  fileURLToPath(new URL(`../../packages/i18n/src/${rel}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolve the @adminium/i18n workspace package from source in tests: no
    // build step needed, and the dep-free `/registry` leaf (locale registry)
    // stays importable even before the package's runtime deps land.
    alias: [
      { find: '@adminium/i18n/registry', replacement: i18nSrc('locales.ts') },
      { find: '@adminium/i18n/resources', replacement: i18nSrc('resources/index.ts') },
      { find: '@adminium/i18n/react', replacement: i18nSrc('react.tsx') },
      { find: '@adminium/i18n', replacement: i18nSrc('index.ts') },
    ],
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Paired with the `asyncUtilTimeout` bump in src/test/setup.ts — see the
    // rationale there. Under `turbo run test` this suite shares the CPU with the
    // (now much larger) @adminium/widgets suite, so a correct render can take
    // several seconds. The enclosing test budget has to exceed the async-util
    // budget, or the timeout it reports is the misleading one.
    testTimeout: 20_000,
  },
});
