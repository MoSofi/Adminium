// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pages a stranger sees at `/x/` (a form, a survey): a FOURTH build, run
 * after the pay page's, into the same `dist`, all of it under `dist/x/`.
 *
 * Its own build, never an entry of the dashboard's: entries of one Rollup run
 * share chunks, and the page's content policy lets scripts, styles and fonts
 * load from `/x/assets/` only. So every file this build writes is under `x/`
 * (the server serves `/x/assets/*` itself, and `/x/forms/<slug>` with
 * `x/index.html`), it reads only its own small vocabulary, and not one
 * dashboard file is reachable from the page.
 *
 * The website loader (`x/embed.js`, hand-written, no framework) is no chunk
 * of it: it is minified on its own (`websiteLoaderOf`) to `dist/x/embed.js`,
 * which the server serves at `/x/embed.js`. Its source keeps its comments;
 * what a website downloads is the small file.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, transformWithEsbuild, type Plugin } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

/** The loader as it is served: minified, its licence line kept on top. */
export async function websiteLoaderOf(source: string): Promise<string> {
  const { code } = await transformWithEsbuild(source, 'embed.js', { minify: true, legalComments: 'none', target: 'es2017' });
  return `/* SPDX-License-Identifier: AGPL-3.0-only */\n${code}`;
}

/** Writes the loader beside the page, minified. */
function websiteLoader(): Plugin {
  return {
    name: 'adminium-x-loader',
    apply: 'build',
    async closeBundle() {
      const out = join(here, 'dist', 'x');
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'embed.js'), await websiteLoaderOf(readFileSync(join(here, 'x', 'embed.js'), 'utf8')));
    },
  };
}

export default defineConfig({
  plugins: [react(), websiteLoader()],
  publicDir: false,
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
    assetsDir: 'x/assets',
    // Fonts are files of their own, never inlined (a data: font would need a wider policy).
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { x: join(here, 'x/index.html') },
      output: {
        entryFileNames: 'x/assets/[name]-[hash].js',
        chunkFileNames: 'x/assets/[name]-[hash].js',
        assetFileNames: 'x/assets/[name]-[hash][extname]',
      },
    },
  },
});
