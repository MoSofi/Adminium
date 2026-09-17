// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Learns `system.publicOrigin` from a settings admin's ordinary writes
 * (security/public-origin.ts explains the setting and every condition).
 *
 * Sign-in and setup capture it too, from their own handlers, because neither
 * request carries a session yet. This hook covers the instance whose admins
 * are already signed in when it is upgraded: sessions last up to 30 days, and
 * the next thing those admins save should be enough.
 *
 * `preHandler`, so the CSRF verdict (`preValidation`, plugins/core.ts) has
 * already refused anything foreign by the time this runs. Registered at the
 * root before any route scope exists, so it reaches the routes `compose.ts`
 * adds later as well. It reads `request.user` and resolves the permission
 * itself rather than calling `request.can`, which routes registered before the
 * rbac plugin do not have (plugins/rbac.ts).
 */
import fp from 'fastify-plugin';

import { capturePublicOriginQuietly } from '../security/public-origin.js';

export const publicOriginPlugin = fp(
  async (app) => {
    const context = app.authContext;
    if (context === null) return;

    app.addHook('preHandler', async (request) => {
      if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
      const { user, session } = request;
      if (user === null || session === null) return;
      // A bearer credential is a script, even with a cookie beside it: its
      // `Origin` is whatever the script wrote.
      if (request.headers.authorization !== undefined) return;
      await capturePublicOriginQuietly(
        { meta: context.meta, allowedOrigins: app.csrfOrigins, user, log: request.log },
        request,
      );
    });
  },
  { name: 'adminium-public-origin', fastify: '5.x', dependencies: ['adminium-core', 'adminium-auth'] },
);
