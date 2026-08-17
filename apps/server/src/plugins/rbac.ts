// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `rbac` plugin (08-server-api.md §5, M2-T05): decorates
 *
 * - `request.can(permission)` — lazy, per-request-cached allow/deny against
 *   the resolved permission set (union of role grants; super-admin bypass;
 *   deny-by-default),
 * - `app.rbac.require(permission)` — route `preHandler` that throws
 *   `ForbiddenError` with the missing permission in `details` and writes an
 *   `rbac`-category `permission.denied` audit entry,
 * - `app.rbac.audit(request, entry)` — actor/ip/ua/request-id-stamped audit
 *   append for the mutating routes in this wave,
 * - the API-key request-auth path: `Authorization: Bearer adm_sk_…` →
 *   hashed lookup → `request.apiKeyPrincipal` acting with the key's role
 *   (§2.16), with a throttled `last_used_at` touch.
 *
 * Session users arrive as `request.user` from `plugins/auth.ts`; this plugin
 * only *reads* that decoration (structurally — see rbac/principal.ts).
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  apiKeysRepo,
  auditRepo,
  type AuditEntryInput,
  type MetaDb,
} from '@adminium/meta';

import { ForbiddenError, UnauthorizedError } from '../errors.js';
import {
  API_KEY_TOUCH_INTERVAL_MS,
  hashApiKey,
  parseBearerApiKey,
} from '../rbac/api-keys.js';
import { parsePermission } from '../rbac/permissions.js';
import { getPrincipal, type ApiKeyPrincipal } from '../rbac/principal.js';
import {
  permissionSetAllows,
  resolvePermissionSet,
  type PermissionSet,
} from '../rbac/resolver.js';

/** Audit fields the caller provides; actor/ip/ua/request-id come from the request. */
export type RequestAuditInput = Omit<
  AuditEntryInput,
  'actorKind' | 'actorId' | 'actorLabel' | 'ip' | 'userAgent' | 'requestId'
>;

export interface RbacDecoration {
  meta: MetaDb;
  /** Route guard: 401 without a principal, 403 (+ audit) without the grant. */
  require(permission: string): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Resolve (and per-request cache) the acting principal's permission set. */
  resolve(request: FastifyRequest): Promise<PermissionSet>;
  /** Append an audit entry stamped with the request's actor + transport info. */
  audit(request: FastifyRequest, entry: RequestAuditInput): Promise<void>;
  now(): number;
}

declare module 'fastify' {
  interface FastifyInstance {
    rbac: RbacDecoration;
  }
  interface FastifyRequest {
    /** Set by the rbac plugin when a valid `adm_sk_…` bearer key is presented. */
    apiKeyPrincipal: ApiKeyPrincipal | null;
    /** Allow/deny check against the resolved permission set (cached per request). */
    can(permission: string): Promise<boolean>;
    /** @internal per-request resolution cache — use `request.can()` instead. */
    rbacResolution: PermissionSet | null;
  }
}

export interface RbacPluginOptions {
  meta: MetaDb;
  /** Injectable clock (tests: last-used throttling, key expiry). */
  now?: () => number;
}

export const rbacPlugin = fp<RbacPluginOptions>(
  async (app, opts) => {
    const { meta } = opts;
    const now = opts.now ?? Date.now;
    const audit = auditRepo(meta);
    const apiKeys = apiKeysRepo(meta);

    app.decorateRequest('apiKeyPrincipal', null);
    app.decorateRequest('rbacResolution', null);

    async function resolve(request: FastifyRequest): Promise<PermissionSet> {
      // `!= null` (not `!== null`): routes registered in encapsulation
      // contexts created BEFORE this plugin (e.g. bootstrap, inside
      // buildServer) never get the decorator default, so the property reads
      // `undefined` there — which must mean "not resolved yet", not a cache hit.
      if (request.rbacResolution != null) return request.rbacResolution;
      const principal = getPrincipal(request);
      if (principal === null) {
        throw new UnauthorizedError();
      }
      const set = await resolvePermissionSet(meta, principal);
      request.rbacResolution = set;
      return set;
    }

    app.decorateRequest('can', async function can(this: FastifyRequest, permission: string) {
      if (getPrincipal(this) === null) return false;
      return permissionSetAllows(await resolve(this), permission);
    });

    async function auditFromRequest(request: FastifyRequest, entry: RequestAuditInput): Promise<void> {
      const principal = getPrincipal(request);
      await audit.append(
        {
          ...entry,
          actorKind: principal?.kind ?? 'system',
          actorId: principal?.id ?? null,
          actorLabel: principal?.label ?? 'Adminium',
          ip: request.ip ?? null,
          userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
          requestId: request.id,
        },
        now(),
      );
    }

    function require(permission: string) {
      if (parsePermission(permission) === null) {
        // Fail at registration time, not per-request: a guard on a permission
        // outside the grammar is a programming error, not a client 403.
        throw new Error(`rbac.require(): invalid permission ${JSON.stringify(permission)}`);
      }
      return async (request: FastifyRequest): Promise<void> => {
        const set = await resolve(request); // throws 401 when unauthenticated
        if (permissionSetAllows(set, permission)) return;
        await auditFromRequest(request, {
          category: 'rbac',
          action: 'permission.denied',
          changes: { after: { permission, method: request.method, url: request.url } },
        });
        throw new ForbiddenError('You do not have the required permission.', 'FORBIDDEN', {
          permission,
        });
      };
    }

    app.decorate('rbac', { meta, require, resolve, audit: auditFromRequest, now });

    // API-key request-auth path (§2.16): only engages for Bearer adm_sk_* —
    // cookie sessions and other bearer schemes pass through untouched.
    app.addHook('onRequest', async (request) => {
      const key = parseBearerApiKey(request.headers.authorization);
      if (key === null) return;
      const at = now();
      const row = await apiKeys.findValidByTokenHash(hashApiKey(key), at);
      if (row === null) {
        throw new UnauthorizedError('UNAUTHENTICATED', 'Invalid, expired, or revoked API key.');
      }
      request.apiKeyPrincipal = { kind: 'api-key', id: row.id, label: row.name, roleId: row.roleId };
      if (row.lastUsedAt === null || at - row.lastUsedAt >= API_KEY_TOUCH_INTERVAL_MS) {
        await apiKeys.touchLastUsed(row.id, at);
      }
    });
  },
  { name: 'adminium-rbac', fastify: '5.x' },
);
