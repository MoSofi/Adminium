// SPDX-License-Identifier: AGPL-3.0-only
import react from '@vitejs/plugin-react';
import { coverage } from '@adminium/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
        // 15-quality.md §1 exempts this package from a line-coverage floor —
      // screenshots and axe are the signal. Collected and reported, asserts nothing.
  coverage: coverage(),
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
