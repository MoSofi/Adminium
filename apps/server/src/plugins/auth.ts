/**
 * `auth` plugin (08-server-api.md §1.2, §2.1): resolves the signed
 * `adminium_session` cookie (or an `Authorization: Bearer adm_…` API key —
 * stub for the key-management routes) to a principal on every request and
 * decorates `request.user` / `request.session` / `request.apiKey`.
 *
 * Exposes:
 * - `app.authContext` — meta handle + derived keys + delivery hooks, `null`
 *   when the server boots without a meta DB (wave-1 compatible);
 * - `app.requireMeta` — preHandler: 503 META_NOT_CONFIGURED without meta;
 * - `app.requireAuth` — preHandler: 401 UNAUTHENTICATED (no/invalid/revoked
 *   token) or 401 SESSION_EXPIRED (session existed but idle/absolute timed out).
 */
import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  apiKeysRepo,
  sessionsRepo,
  usersRepo,
  type ApiKey,
  type MetaDb,
  type Session,
  type User,
} from '@adminium/meta';

import type { Env } from '../config/env.js';
import { AppError, UnauthorizedError } from '../errors.js';
import {
  hashToken,
  readSessionCookie,
  resolveSessionByToken,
} from '../auth/sessions.js';
import { totpEncryptionKey } from '../auth/totp.js';

/** Payload handed to the reset-delivery hook (email transport lands later). */
export interface PasswordResetDelivery {
  userId: string;
  email: string;
  /** Plaintext single-use token — never stored, never logged. */
  token: string;
  expiresAt: number;
}

export interface AuthContext {
  meta: MetaDb;
  env: Env;
  /** HKDF-derived AES key for TOTP secrets at rest. */
  totpKey: Buffer;
  /** Test/email hook: receives plaintext reset tokens on `password/forgot`. */
  deliverResetToken: ((delivery: PasswordResetDelivery) => void) | undefined;
}

export interface AuthPluginOptions {
  env: Env;
  metaDb?: MetaDb | null | undefined;
  deliverResetToken?: ((delivery: PasswordResetDelivery) => void) | undefined;
}

/** API keys are Stripe-style `adm_…` bearer tokens (07-meta-store.md §3.7). */
const API_KEY_PREFIX = 'adm_';

declare module 'fastify' {
  interface FastifyRequest {
    /** Active-session user; `null` for anonymous or API-key principals. */
    user: User | null;
    /** The resolved live session row backing `user`. */
    session: Session | null;
    /** API-key principal (bearer) — RBAC wiring is the rbac plugin's. */
    apiKey: ApiKey | null;
    /** True when a session token was presented but timed out (§1.4). */
    sessionExpired: boolean;
  }
  interface FastifyInstance {
    authContext: AuthContext | null;
    requireMeta: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp<AuthPluginOptions>(
  async (app, opts) => {
    const meta = opts.metaDb ?? null;
    const context: AuthContext | null =
      meta === null
        ? null
        : {
            meta,
            env: opts.env,
            totpKey: totpEncryptionKey(opts.env.ADMINIUM_SECRET),
            deliverResetToken: opts.deliverResetToken,
          };

    app.decorate('authContext', context);
    app.decorateRequest('user', null);
    app.decorateRequest('session', null);
    app.decorateRequest('apiKey', null);
    app.decorateRequest('sessionExpired', false);

    app.decorate('requireMeta', async () => {
      if (context === null) {
        throw new AppError(
          503,
          'META_NOT_CONFIGURED',
          'No meta store is configured — authentication is unavailable.',
        );
      }
    });

    app.decorate('requireAuth', async (request: FastifyRequest) => {
      if (request.user !== null && request.session !== null) return;
      if (request.sessionExpired) throw new UnauthorizedError('SESSION_EXPIRED');
      throw new UnauthorizedError('UNAUTHENTICATED');
    });

    if (context === null) return;

    app.addHook('onRequest', async (request) => {
      const now = Date.now();

      // API-key bearer stub (§8): resolves the principal; RBAC comes later.
      const authorization = request.headers.authorization;
      if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
        const bearer = authorization.slice('Bearer '.length).trim();
        if (bearer.startsWith(API_KEY_PREFIX)) {
          const key = await apiKeysRepo(context.meta).findValidByTokenHash(hashToken(bearer), now);
          if (key !== null) {
            request.apiKey = key;
            await apiKeysRepo(context.meta).touchLastUsed(key.id, now);
          }
          return;
        }
      }

      const token = readSessionCookie(request);
      if (token === null) return;

      const resolution = await resolveSessionByToken(context.meta, token, now);
      if (resolution.state === 'expired') {
        request.sessionExpired = true;
        return;
      }
      if (resolution.state !== 'active') return;

      const user = await usersRepo(context.meta).findById(resolution.session.userId);
      if (user === null || user.status !== 'active') return;

      request.user = user;
      request.session = resolution.session;
      // Sliding idle window: throttled to one write per minute by the repo.
      await sessionsRepo(context.meta).touch(resolution.session.id, now);
    });
  },
  { name: 'adminium-auth', fastify: '5.x', dependencies: ['adminium-core'] },
);
