// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `me` routes (08-server-api.md §2.2), mounted under /api/v1 by app.ts:
 * GET/PATCH /me (profile) and GET/PATCH /me/prefs (preference axes, §7.2).
 * All of them require a live session and a configured meta store.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { AppError } from '../../errors.js';
import type { AuthContext } from '../../plugins/auth.js';
import {
  getMeHandler,
  getMePrefsHandler,
  patchMeHandler,
  patchMePrefsHandler,
} from './handlers.js';
import { mePatchBody, mePrefsPatchBody, mePrefsReply, meReply } from './schema.js';

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = (): AuthContext => {
    if (app.authContext === null) {
      throw new AppError(503, 'META_NOT_CONFIGURED', 'No meta store is configured.');
    }
    return app.authContext;
  };

  const guarded = { preHandler: [app.requireMeta, app.requireAuth] };

  app.get(
    '/me',
    { ...guarded, schema: { response: { 200: meReply } } },
    async (request) => getMeHandler(ctx(), request),
  );

  app.patch(
    '/me',
    { ...guarded, schema: { body: mePatchBody, response: { 200: meReply } } },
    async (request) => patchMeHandler(ctx(), request, request.body),
  );

  app.get(
    '/me/prefs',
    { ...guarded, schema: { response: { 200: mePrefsReply } } },
    async (request) => getMePrefsHandler(ctx(), request),
  );

  app.patch(
    '/me/prefs',
    { ...guarded, schema: { body: mePrefsPatchBody, response: { 200: mePrefsReply } } },
    async (request) => patchMePrefsHandler(ctx(), request, request.body),
  );
};
