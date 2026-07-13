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

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4600', changeOrigin: false },
      '/ws': { target: 'ws://127.0.0.1:4600', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
