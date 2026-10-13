// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Vite 7 config for the dashboard SPA.
 *
 * Dev: `/api` and `/ws` proxy to the Fastify server on :4600 (its default
 * ADMINIUM_PORT) so cookies stay same-origin. Prod: `vite build` emits to
 * `dist/`; `apps/server`'s static plugin serves it when `buildServer()` gets
 * `staticRoot: 'apps/dashboard/dist'` (SPA fallback included) — see
 * apps/server/src/plugins/static.ts.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The kit for an app's own screens (src/kit-host/): a further entry of this
 * same build, so the React that draws its parts is the very file the
 * dashboard loads, not a second copy, and a part that is heavy on both sides
 * (the map engine) can only ever be one file.
 *
 * Its own files go under `assets/kit/` with a hash in each name; what they
 * share with the dashboard stays where the dashboard has it. `kit.json` says
 * which file is the door, since nobody can guess a hash: the server reads it
 * and tells a staff side through its config.
 */
const KIT_SOURCE = '/src/kit-host/';
const inKit = (id: string): boolean => id.replaceAll('\\', '/').includes(KIT_SOURCE);

function kitManifest(): Plugin {
  return {
    name: 'adminium-kit-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.values(bundle);
      const entry = files.find((file) => file.type === 'chunk' && file.isEntry && file.name === 'kit');
      if (entry === undefined) this.error('The kit entry (src/kit-host/index.ts) is not in the build.');
      const styles = files.filter((file) => file.type === 'asset' && file.fileName.startsWith('assets/kit/') && file.fileName.endsWith('.css'));
      this.emitFile({
        type: 'asset',
        fileName: 'assets/kit/kit.json',
        source: `${JSON.stringify({ contract: 1, entry: entry.fileName.slice('assets/kit/'.length), styles: styles.length === 1 ? styles[0]!.fileName.slice('assets/kit/'.length) : null })}\n`,
      });
    },
  };
}

/**
 * Backend the dev server proxies to. Defaults to :4600, so nothing changes
 * without the override — it exists so the live source can be pointed at an
 * alternate instance (the throwaway `e2e-app` on :4620, a colleague's box)
 * without editing this file. `ADMINIUM_DEV_PORT` does the same for the SPA.
 */
const API_HOST = process.env.ADMINIUM_DEV_API ?? '127.0.0.1:4600';

export default defineConfig({
  plugins: [react(), tailwindcss(), kitManifest()],
  server: {
    port: Number(process.env.ADMINIUM_DEV_PORT ?? 5173),
    proxy: {
      '/api': { target: `http://${API_HOST}`, changeOrigin: false },
      '/ws': { target: `ws://${API_HOST}`, ws: true },
      // Installed apps' own screens are served by the server, not by this SPA.
      '/apps': { target: `http://${API_HOST}`, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: { index: join(here, 'index.html'), kit: join(here, 'src/kit-host/index.ts') },
      // The kit's entry is imported by other people's code: what it exports must stay exported.
      preserveEntrySignatures: 'exports-only',
      output: {
        entryFileNames: (chunk) => (chunk.name === 'kit' ? 'assets/kit/kit-[hash].js' : 'assets/[name]-[hash].js'),
        // A chunk holding any of the kit's own modules is the kit's: nothing of the dashboard reaches them.
        chunkFileNames: (chunk) => (chunk.moduleIds.some(inKit) ? 'assets/kit/[name]-[hash].js' : 'assets/[name]-[hash].js'),
        // The kit's sheet is told by its wrapper class, which no sheet of the dashboard names.
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith('.css')) && String(asset.source).includes('.adm-kit') ? 'assets/kit/[name]-[hash][extname]' : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
