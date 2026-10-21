// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The customer's pay page: a THIRD build, run after the dashboard's, into the
 * same `dist`, all of it under `dist/pay/`.
 *
 * Its own build, never an entry of the dashboard's: entries of one Rollup run
 * share chunks, and the pay page's content policy lets scripts, styles and
 * fonts load from `/pay/assets/` only. So every file this build writes is
 * under `pay/` (the server serves `/pay/assets/*` itself, and `/pay/<token>`
 * with `pay/index.html`), it reads only its own small vocabulary, and not one
 * dashboard file is reachable from the page.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
    assetsDir: 'pay/assets',
    // Fonts are files of their own, never inlined (a data: font would need a wider policy).
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { pay: join(here, 'pay/index.html') },
      output: {
        entryFileNames: 'pay/assets/[name]-[hash].js',
        chunkFileNames: 'pay/assets/[name]-[hash].js',
        assetFileNames: 'pay/assets/[name]-[hash][extname]',
      },
    },
  },
});
