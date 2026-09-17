// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `static` plugin: serves a dashboard build directory when one exists, with an
 * SPA fallback to `index.html` for non-`/api/*` GET/HEAD requests (the
 * fallback itself lives in the app's not-found handler, keyed off the
 * `spaRoot` decoration). When the directory is absent — the dashboard ships M4
 * — the plugin serves nothing and the server still boots.
 *
 * Either way it decorates `reply.sendFile`. App surfaces send their files with
 * it (plugins/surfaces.ts, and the not-found handler's surface fallbacks), and
 * an API-only server serves them too.
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
    } else {
      // No dashboard, but app surfaces still send their files with
      // `reply.sendFile`, always passing their own root. So add the decorator
      // and nothing else: no route, no default root. Only one registration may
      // add it, which is why this is the `else`.
      await app.register(fastifyStatic, { serve: false });
    }
  },
  { name: 'adminium-static', fastify: '5.x' },
);
