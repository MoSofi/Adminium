// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant on an app's own staff address: a SECOND build, run after the
 * dashboard's, into the same `dist`.
 *
 * Two things come out of it, both under `/assets/milo/` (a path a staff host
 * already passes through to the dashboard's build, and a customer host
 * refuses):
 *
 *  - `loader.js`: the small script the server adds to a staff side's page for
 *    a person who may use the assistant. No React, no imports, a fixed name
 *    (the server's tag names it).
 *  - `panel.html` and its chunks: the dashboard's own panel as a document of
 *    its own, which the loader opens in a frame on the first press.
 *
 * `emptyOutDir` stays false (the dashboard's build is already there) and
 * nothing of `public/` is copied a second time. The fonts the panel's
 * stylesheet names are emitted under the same content-hashed names the
 * dashboard's build gave them, so there is no second copy of any of them.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const LOCALES = ['en-US', 'ar-EG', 'cs-CZ', 'da-DK', 'de-DE', 'fr-FR', 'zh-CN', 'zh-TW'];

/** The button's one sentence in every language the dashboard has, read from the catalogues at build time. */
function openLabels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const locale of LOCALES) {
    const common = JSON.parse(readFileSync(join(here, '..', '..', 'packages', 'i18n', 'locales', locale, 'common.json'), 'utf8')) as { shell?: { assistant?: { open?: unknown } } };
    const text = common.shell?.assistant?.open;
    if (typeof text !== 'string') throw new Error(`vite.milo.config: ${locale}/common.json has no shell.assistant.open`);
    out[locale] = text;
  }
  return out;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: false,
  define: { __MILO_OPEN_LABELS__: JSON.stringify(openLabels()) },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: { panel: join(here, 'assets/milo/panel.html'), loader: join(here, 'src/assistant/staff/loader.ts') },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'loader' ? 'assets/milo/loader.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
