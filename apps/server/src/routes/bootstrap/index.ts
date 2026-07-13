/**
 * Bootstrap resource (09-generated-app.md §2.1, 01-architecture.md §5):
 * `GET /api/v1/bootstrap` — the single round trip the SPA issues on a cold
 * load. Session-bound; 503 META_NOT_CONFIGURED when the server boots without
 * a meta store (same contract as auth/me).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { AppError } from '../../errors.js';
import type { AuthContext } from '../../plugins/auth.js';
import { bootstrapHandler } from './handlers.js';
import { bootstrapReply } from './schema.js';

export const bootstrapRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = (): AuthContext => {
    if (app.authContext === null) {
      throw new AppError(503, 'META_NOT_CONFIGURED', 'No meta store is configured.');
    }
    return app.authContext;
  };

  app.get(
    '/bootstrap',
    {
      preHandler: [app.requireMeta, app.requireAuth],
      schema: { response: { 200: bootstrapReply } },
    },
    async (request) => bootstrapHandler(ctx(), request),
  );
};
