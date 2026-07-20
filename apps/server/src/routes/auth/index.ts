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
  disable2faHandler,
  enroll2faHandler,
  forgotPasswordHandler,
  loginHandler,
  logoutHandler,
  resetPasswordHandler,
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
  authResetBody,
  authSessionReply,
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
