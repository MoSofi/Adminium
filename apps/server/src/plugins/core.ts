/**
 * `core` plugin (08-server-api.md §1.2): cookie support (signed with
 * ADMINIUM_SECRET) and the same-origin CORS default — no CORS headers are
 * emitted unless ADMINIUM_CORS_ORIGINS opts specific origins in (§7 item 4).
 * Helmet and rate-limit join in a later wave; request-id, redaction, and the
 * error envelope live in `app.ts` because they attach at instance creation.
 */
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fp from 'fastify-plugin';

import type { Env } from '../config/env.js';

export interface CorePluginOptions {
  env: Env;
}

export const corePlugin = fp<CorePluginOptions>(
  async (app, { env }) => {
    await app.register(fastifyCookie, {
      secret: env.ADMINIUM_SECRET,
      hook: 'onRequest',
    });

    const origins = env.ADMINIUM_CORS_ORIGINS;
    if (origins !== undefined && origins.length > 0) {
      await app.register(fastifyCors, {
        origin: [...origins],
        credentials: true,
      });
    }
  },
  { name: 'adminium-core', fastify: '5.x' },
);
