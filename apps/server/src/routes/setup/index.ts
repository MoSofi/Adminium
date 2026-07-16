/**
 * First-run setup resource (M10-T04): `GET /api/v1/setup/state` and
 * `POST /api/v1/setup/super-admin`. The dashboard's first-run wizard is one
 * front door onto `createSetupService`; the `adminium init` CLI wizard is the
 * other. All logic lives in the service — this module only translates HTTP.
 *
 * SECURITY. These are the only unauthenticated routes that can create a user,
 * so the once-only property is what matters:
 *
 *  - `POST /setup/super-admin` succeeds at most once per instance, EVER. The
 *    guarantee is the `system.superAdminCreatedAt` PRIMARY KEY claim taken
 *    inside `createFirstSuperAdmin`'s transaction (@adminium/meta), so a
 *    concurrent double-submit resolves to exactly one 201 + one 409 rather
 *    than two super admins. Once claimed the route answers 409 forever —
 *    including after every user is later deleted, which must not re-open an
 *    unauthenticated super-admin factory.
 *  - `rateLimitBucket` marks it for the §6 limiter alongside `auth/login`: it
 *    is credential-facing and unauthenticated.
 *  - Failures are never enumerable: an already-set-up instance returns the
 *    same 409 regardless of the email or password submitted.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { AppError, ConflictError, ValidationFailedError } from '../../errors.js';
import { createSession, setSessionCookie } from '../../auth/sessions.js';
import type { AuthContext } from '../../plugins/auth.js';
import { SetupClosedError, WeakPasswordError, type SetupService } from '../../setup/service.js';
import { toUserView } from '../auth/handlers.js';
import { RATE_LIMIT_BUCKETS } from '../auth/index.js';
import {
  setupStateReply,
  setupSuperAdminBody,
  setupSuperAdminReply,
  type SetupStateReply,
  type SetupSuperAdminReply,
} from './schema.js';

export interface SetupRoutesDeps {
  /** Built over the same meta store the rest of the app uses. */
  service: SetupService;
}

export function setupRoutes(deps: SetupRoutesDeps): FastifyPluginAsyncZod {
  const { service } = deps;

  return async (app) => {
    /** Non-null under requireMeta — the preHandler 503s before handlers run. */
    const ctx = (): AuthContext => {
      if (app.authContext === null) {
        throw new AppError(503, 'META_NOT_CONFIGURED', 'No meta store is configured.');
      }
      return app.authContext;
    };

    app.get(
      '/setup/state',
      {
        preHandler: [app.requireMeta],
        schema: { response: { 200: setupStateReply } },
      },
      async (): Promise<SetupStateReply> => {
        const state = await service.state();
        return {
          data: { required: state.required, passwordMinLength: state.passwordMinLength },
        };
      },
    );

    app.post(
      '/setup/super-admin',
      {
        preHandler: [app.requireMeta],
        config: { rateLimitBucket: RATE_LIMIT_BUCKETS.login },
        schema: { body: setupSuperAdminBody, response: { 201: setupSuperAdminReply } },
      },
      async (request, reply): Promise<SetupSuperAdminReply> => {
        const body = request.body;

        let user;
        try {
          user = await service.createSuperAdmin({
            email: body.email,
            password: body.password,
            name: body.name,
            consent: body.consent,
          });
        } catch (error) {
          if (error instanceof SetupClosedError) {
            // 409 — the terminal state. Identical for a second submit, a lost
            // race, and a probe against a long-running instance.
            throw new ConflictError(
              'Setup has already been completed. Sign in instead.',
              'CONFLICT',
            );
          }
          if (error instanceof WeakPasswordError) {
            throw new ValidationFailedError(error.message, {
              in: 'body',
              issues: [{ path: 'password', message: error.message, code: 'too_small' }],
            });
          }
          throw error;
        }

        // Land the wizard signed in — re-typing the credentials you just chose
        // is friction with no security value (you proved nothing by knowing it).
        const userAgent = request.headers['user-agent'];
        const { token } = await createSession(ctx().meta, user.id, {
          ip: request.ip,
          userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
        });
        setSessionCookie(reply, token, request);

        void reply.status(201);
        return { data: { user: toUserView(user) } };
      },
    );
  };
}
