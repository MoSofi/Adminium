/**
 * Auth routes (08-server-api.md §2.1), mounted under /api/v1 by app.ts.
 *
 * Every route runs `requireMeta` (503 META_NOT_CONFIGURED when the server
 * boots without a meta DB); session-bound routes add `requireAuth`. The
 * credential-facing routes carry `config.rateLimitBucket` markers — the §6
 * rate limiter in `plugins/core.ts` keys its buckets off them (limits live in
 * its `RATE_BUCKETS` table; an unknown marker fails the boot).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { AppError } from '../../errors.js';
import type { AuthContext } from '../../plugins/auth.js';
import {
  activate2faHandler,
  changePasswordHandler,
  disable2faHandler,
  enroll2faHandler,
  forgotPasswordHandler,
  listSessionsHandler,
  loginHandler,
  logoutHandler,
  resetPasswordHandler,
  revokeSessionHandler,
  sessionHandler,
  verify2faHandler,
} from './handlers.js';
import {
  auth2faActivateBody,
  auth2faActivateReply,
  auth2faDisableBody,
  auth2faEnrollReply,
  auth2faVerifyBody,
  authForgotBody,
  authLoginBody,
  authLoginChallengeReply,
  authLoginReply,
  authPasswordChangeBody,
  authResetBody,
  authSessionListReply,
  authSessionReply,
  authSessionRevokeParams,
  okReply,
} from './schema.js';

/**
 * §6 rate-limit bucket markers (5/min login+verify+reset, 3/hour forgot —
 * the limits themselves live in `RATE_BUCKETS`, plugins/core.ts).
 */
export const RATE_LIMIT_BUCKETS = {
  login: 'auth-login',
  forgot: 'auth-password-forgot',
  reset: 'auth-password-reset',
} as const;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** §6 bucket key the core plugin's rate limiter attaches to. */
    rateLimitBucket?: string;
  }
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Non-null under requireMeta — the preHandler 503s before handlers run. */
  const ctx = (): AuthContext => {
    if (app.authContext === null) {
      throw new AppError(503, 'META_NOT_CONFIGURED', 'No meta store is configured.');
    }
    return app.authContext;
  };

  app.post(
    '/auth/login',
    {
      preHandler: [app.requireMeta],
      config: { rateLimitBucket: RATE_LIMIT_BUCKETS.login },
      schema: {
        body: authLoginBody,
        response: { 200: authLoginReply, 202: authLoginChallengeReply },
      },
    },
    async (request, reply) => loginHandler(ctx(), request, reply, request.body),
  );

  app.post(
    '/auth/2fa/verify',
    {
      preHandler: [app.requireMeta],
      config: { rateLimitBucket: RATE_LIMIT_BUCKETS.login },
      schema: { body: auth2faVerifyBody, response: { 200: authLoginReply } },
    },
    async (request, reply) => verify2faHandler(ctx(), request, reply, request.body),
  );

  app.post(
    '/auth/logout',
    {
      preHandler: [app.requireMeta, app.requireAuth],
      schema: { response: { 200: okReply } },
    },
    async (request, reply) => logoutHandler(ctx(), request, reply),
  );

  app.get(
    '/auth/session',
    {
      preHandler: [app.requireMeta, app.requireAuth],
      schema: { response: { 200: authSessionReply } },
    },
    async (request) => sessionHandler(ctx(), request),
  );

  // The caller's own devices and credential (§2.1). Session-bound but NOT
  // RBAC-guarded: every one of them reads or writes the requesting account and
  // nothing else, so there is no grant that could gate them — the session IS
  // the authorization.

  app.get(
    '/auth/sessions',
    {
      preHandler: [app.requireMeta, app.requireAuth],
      schema: { response: { 200: authSessionListReply } },
    },
    async (request) => listSessionsHandler(ctx(), request),
  );

  app.delete(
    '/auth/sessions/:id',
    {
      preHandler: [app.requireMeta, app.requireAuth],
      schema: { params: authSessionRevokeParams, response: { 200: okReply } },
    },
    async (request, reply) => revokeSessionHandler(ctx(), request, reply, request.params),
  );

  app.post(
    '/auth/password/change',
    {
      preHandler: [app.requireMeta, app.requireAuth],
      // Shares the reset bucket: it is the same act (choosing a new password)
      // behind the same argon2 verify, and one budget across both doors is the
      // point of keying buckets by act rather than by route.
      config: { rateLimitBucket: RATE_LIMIT_BUCKETS.reset },
      schema: { body: authPasswordChangeBody, response: { 200: okReply } },
    },
    async (request, reply) => changePasswordHandler(ctx(), request, reply, request.body),
  );

  app.post(
    '/auth/password/forgot',
    {
      preHandler: [app.requireMeta],
      config: { rateLimitBucket: RATE_LIMIT_BUCKETS.forgot },
      schema: { body: authForgotBody, response: { 200: okReply } },
    },
    async (request) => forgotPasswordHandler(ctx(), request, request.body),
  );

  app.post(
    '/auth/password/reset',
    {
      preHandler: [app.requireMeta],
      // The token CONSUME side: single-use + 30-min TTL (§7 item 7) bounds a
      // token's lifetime, this bounds how fast one can be guessed within it.
      config: { rateLimitBucket: RATE_LIMIT_BUCKETS.reset },
      schema: { body: authResetBody, response: { 200: okReply } },
    },
    async (request) => resetPasswordHandler(ctx(), request, request.body),
  );

  app.post(
    '/auth/2fa/enroll',
    {
      preHandler: [app.requireMeta, app.requireAuth],
      schema: { response: { 200: auth2faEnrollReply } },
    },
    async (request) => enroll2faHandler(ctx(), request),
  );

  app.post(
    '/auth/2fa/activate',
    {
      preHandler: [app.requireMeta, app.requireAuth],
      schema: { body: auth2faActivateBody, response: { 200: auth2faActivateReply } },
    },
    async (request) => activate2faHandler(ctx(), request, request.body),
  );

  app.post(
    '/auth/2fa/disable',
    {
      preHandler: [app.requireMeta, app.requireAuth],
      schema: { body: auth2faDisableBody, response: { 200: okReply } },
    },
    async (request) => disable2faHandler(ctx(), request, request.body),
  );
};
