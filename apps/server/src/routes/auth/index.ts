/**
 * Auth routes (08-server-api.md §2.1), mounted under /api/v1 by app.ts.
 *
 * Every route runs `requireMeta` (503 META_NOT_CONFIGURED when the server
 * boots without a meta DB); session-bound routes add `requireAuth`. The
 * credential-facing routes carry `config.rateLimitBucket` markers — the
 * rate-limit plugin (§6) keys its buckets off them when it lands.
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

/** §6 rate-limit bucket markers (5/min login+verify, 3/hour forgot). */
export const RATE_LIMIT_BUCKETS = {
  login: 'auth-login',
  forgot: 'auth-password-forgot',
} as const;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** §6 bucket key the rate-limit plugin will attach to (hook point). */
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
