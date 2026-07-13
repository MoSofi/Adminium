/**
 * `static` plugin (08-server-api.md §1.2): serves a dashboard build directory
 * when one exists, with an SPA fallback to `index.html` for non-`/api/*`
 * GET/HEAD requests (the fallback itself lives in the app's not-found handler,
 * keyed off the `spaRoot` decoration). When the directory is absent — the
 * dashboard ships M4 — the plugin cleanly no-ops and the server still boots.
 */
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import fastifyStatic from '@fastify/static';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    /** Absolute dashboard-build root being served, or null when disabled. */
    spaRoot: string | null;
  }
}

export interface StaticPluginOptions {
  /** Candidate dashboard build directory; must contain `index.html`. */
  root?: string | undefined;
}

export const staticPlugin = fp<StaticPluginOptions>(
  async (app, opts) => {
    let root: string | null = null;

    if (opts.root !== undefined && opts.root !== '') {
      const absolute = resolve(opts.root);
      try {
        const entry = await stat(join(absolute, 'index.html'));
        if (entry.isFile()) root = absolute;
      } catch {
        // Directory or index.html absent → serve nothing (no-op).
      }
    }

    app.decorate('spaRoot', root);

    if (root !== null) {
      app.log.info({ root }, 'serving dashboard build');
      await app.register(fastifyStatic, {
        root,
        // Wildcard route; missing files fall through to the not-found handler,
        // which applies the SPA fallback for non-/api paths.
        wildcard: true,
      });
    }
  },
  { name: 'adminium-static', fastify: '5.x' },
);
