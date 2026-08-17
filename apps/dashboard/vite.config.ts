/**
 * Vite 7 config for the dashboard SPA (09-generated-app.md §2.1).
 *
 * Dev: `/api` and `/ws` proxy to the Fastify server on :4600 (its default
 * ADMINIUM_PORT) so cookies stay same-origin. Prod: `vite build` emits to
 * `dist/`; `apps/server`'s static plugin serves it when `buildServer()` gets
 * `staticRoot: 'apps/dashboard/dist'` (SPA fallback included) — see
 * apps/server/src/plugins/static.ts.
 */
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Backend the dev server proxies to. Defaults to :4600, so nothing changes
 * without the override — it exists so the live source can be pointed at an
 * alternate instance (the throwaway `e2e-app` on :4620, a colleague's box)
 * without editing this file. `ADMINIUM_DEV_PORT` does the same for the SPA.
 */
const API_HOST = process.env.ADMINIUM_DEV_API ?? '127.0.0.1:4600';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.ADMINIUM_DEV_PORT ?? 5173),
    proxy: {
      '/api': { target: `http://${API_HOST}`, changeOrigin: false },
      '/ws': { target: `ws://${API_HOST}`, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
