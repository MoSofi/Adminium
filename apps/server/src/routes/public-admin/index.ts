// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Managing the public surface (28-public-surface.md §3.3, 28-T13's server half).
 *
 * Scopes, keys and the runtime off switch, all behind
 * `system:api-keys:manage`. Not `manifests.manage`: that key is reserved with
 * no enforcement point and is not grantable (`rbac/permissions.ts`), so using
 * it would mean nobody could do this at all.
 *
 * ── WHY THIS IS A SEPARATE NAMESPACE FROM `routes/public` ──────────────────
 * Everything about the two is opposite. This one is session-authenticated,
 * returns the dashboard's error envelope, and shows scope-compile issues IN
 * FULL because the operator is the person who has to fix them. That one is
 * anonymous, returns bare codes, and deliberately cannot tell an unknown
 * resource from a forbidden one. Keeping them in one file would put those two
 * policies one `if` apart.
 *
 * ── SCOPES ARE COMPILED BEFORE THEY ARE STORED ─────────────────────────────
 * A scope that cannot compile is never written. The alternative — store now,
 * fail at request time — moves the error from the person who caused it to an
 * anonymous visitor who cannot read it, and turns a typo into an outage.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  overridesRepo,
  publicKeysRepo,
  publicScopesRepo,
  settingsRepo,
  snapshotsRepo,
  type MetaDb,
  type PublicKey,
  type PublicScope,
  connectionTenantConfig,
} from '@adminium/meta';
import type { DatabaseModel } from '@adminium/engine';
import type { DsnCrypto } from '@adminium/meta';

import type { Env } from '../../config/env.js';
import { applyOverrides } from '../../connections/effective-schema.js';
import { SnapshotView } from '../../crud/identifiers.js';
import { ConflictError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  generatePublishableKey,
  openPublishableKey,
  rotatePublishableKey,
  sealPublishableKey,
} from '../../public-api/keys.js';
import { compileScope, ScopeCompileError } from '../../public-api/scope.js';
import {
  publicApiStateBody,
  publicApiStateReply,
  publicKeyCreateBody,
  publicKeyCreateReply,
  publicKeyIdParams,
  publicKeyListReply,
  publicKeyOkReply,
  publicKeyRevealReply,
  publicScopeCreateBody,
  publicScopeIdParams,
  publicScopeListReply,
  publicScopeUpdateBody,
  type PublicKeyDto,
  type PublicScopeDto,
} from './schema.js';

export interface PublicAdminRoutesDeps {
  meta: MetaDb;
  env: Env;
  crypto: DsnCrypto;
  /** Drops the cached `publicApi.enabled` so a toggle takes effect at once. */
  invalidateGate?: (() => void) | undefined;
  /** Drops a cached resolved key so a scope edit takes effect at once. */
  invalidateResolver?: ((keyId?: string) => void) | undefined;
}

function scopeToDto(row: PublicScope, keyCount: number): PublicScopeDto {
  return {
    id: row.id,
    connectionId: row.connectionId,
    side: row.side === 'staff' ? 'staff' : 'customer',
    name: row.name,
    timezone: row.timezone,
    document: row.document,
    proposedFromManifest: row.proposedFromManifest,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    keyCount,
  };
}

/** Strips `tokenHash` and `tokenEncrypted` — no secret leaves this mapper. */
function keyToDto(row: PublicKey): PublicKeyDto {
  let origins: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.origins);
    if (Array.isArray(parsed)) origins = parsed.filter((o): o is string => typeof o === 'string');
  } catch {
    origins = [];
  }
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopeId: row.scopeId,
    side: row.side === 'staff' ? 'staff' : 'customer',
    appKey: row.appKey,
    origins,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function publicAdminRoutes(deps: PublicAdminRoutesDeps): FastifyPluginAsyncZod {
  const { meta, env, crypto } = deps;
  const scopes = publicScopesRepo(meta);
  const keys = publicKeysRepo(meta);
  const settings = settingsRepo(meta);
  const snapshots = snapshotsRepo(meta);
  const overrides = overridesRepo(meta);

  /** Column existence for the connection, so a scope is checked against reality. */
  async function columnsFor(connectionId: string) {
    const snapshot = await snapshots.latest(connectionId);
    if (snapshot === null) return undefined;
    const active = await overrides.listForConnection(connectionId, { status: 'active' });
    const view = new SnapshotView(connectionId, applyOverrides(snapshot.schema as DatabaseModel, active));
    return (table: string) => {
      try {
        return new Set(view.table(table).columns.keys());
      } catch {
        return null;
      }
    };
  }

  /** Compile or throw a 422 carrying every issue — see the header. */
  async function compileOrThrow(connectionId: string, document: string): Promise<{ timezone: string }> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(document);
    } catch {
      throw new ValidationFailedError('The scope document is not valid JSON.', {});
    }
    try {
      /*
       * The connection's tenant config is passed here for the same reason it
       * is passed at resolve time (28-T34): a scope that omits `timezone`
       * INHERITS it. Without this, authoring refused every such scope with
       * "no time zone is configured" while the connection plainly had one —
       * inheritance that works at read time and not at write time is a feature
       * an operator can never actually use.
       */
      const inherited = (await connectionTenantConfig(meta, connectionId)) ?? undefined;
      const compiled = compileScope(parsed, await columnsFor(connectionId), inherited);
      return { timezone: compiled.timezone };
    } catch (error) {
      if (error instanceof ScopeCompileError) {
        throw new ValidationFailedError('The scope document did not compile.', {
          issues: error.issues.map((i) => ({ ...i })),
        });
      }
      throw error;
    }
  }

  return async (app) => {
    /* ---------------------------------------------------------- the switch */

    app.get(
      '/public-api',
      {
        preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
        schema: { response: { 200: publicApiStateReply } },
      },
      async () => ({
        enabled: (await settings.get('publicApi.enabled')) === true,
        // Level 1 is an env var and a restart. The page must SAY that rather
        // than render a toggle that silently does nothing.
        registered: env.ADMINIUM_PUBLIC_API_ORIGINS !== undefined,
        origins: [...(env.ADMINIUM_PUBLIC_API_ORIGINS ?? [])],
      }),
    );

    app.put(
      '/public-api',
      {
        preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
        schema: { body: publicApiStateBody, response: { 200: publicApiStateReply } },
      },
      async (request) => {
        const before = (await settings.get('publicApi.enabled')) === true;
        await settings.set('publicApi.enabled', request.body.enabled, {
          updatedBy: (request as unknown as { user?: { id?: string } }).user?.id ?? null,
        });
        // Without this the flip appears not to work for up to the cache TTL,
        // which reads as a broken control and invites a second click.
        deps.invalidateGate?.();
        await app.rbac.audit(request, {
          category: 'system',
          action: 'public-api.toggle',
          changes: { before: { enabled: before }, after: { enabled: request.body.enabled } },
        });
        return {
          enabled: request.body.enabled,
          registered: env.ADMINIUM_PUBLIC_API_ORIGINS !== undefined,
          origins: [...(env.ADMINIUM_PUBLIC_API_ORIGINS ?? [])],
        };
      },
    );

    /* ----------------------------------------------------------- scopes */

    app.get(
      '/public-scopes',
      {
        preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
        schema: { response: { 200: publicScopeListReply } },
      },
      async () => {
        const all = await keys.list();
        const counts = new Map<string, number>();
        for (const k of all) counts.set(k.scopeId, (counts.get(k.scopeId) ?? 0) + 1);
        // `keyCount` is what a delete would break, so the list carries it
        // rather than making the page discover it from a failed request.
        return { scopes: (await scopes.list()).map((r) => scopeToDto(r, counts.get(r.id) ?? 0)) };
      },
    );

    app.post(
      '/public-scopes',
      {
        preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
        schema: { body: publicScopeCreateBody, response: { 201: publicScopeListReply } },
      },
      async (request, reply) => {
        const { timezone } = await compileOrThrow(request.body.connectionId, request.body.document);
        const row = await scopes.create({
          connectionId: request.body.connectionId,
          side: request.body.side,
          name: request.body.name,
          // The CANONICAL zone the compiler resolved, not what was typed.
          timezone,
          document: request.body.document,
          createdBy: (request as unknown as { user?: { id?: string } }).user?.id ?? null,
        });
        await app.rbac.audit(request, {
          category: 'system',
          action: 'public-scope.create',
          changes: { after: { scopeId: row.id, name: row.name, side: row.side, timezone } },
        });
        return reply.status(201).send({ scopes: [scopeToDto(row, 0)] });
      },
    );

    app.patch(
      '/public-scopes/:id',
      {
        preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
        schema: {
          params: publicScopeIdParams,
          body: publicScopeUpdateBody,
          response: { 200: publicScopeListReply },
        },
      },
      async (request) => {
        const row = await scopes.findById(request.params.id);
        if (row === null) throw new NotFoundError('Scope not found.', { id: request.params.id });

        const patch: { name?: string; document?: string; timezone?: string } = {};
        if (request.body.name !== undefined) patch.name = request.body.name;
        if (request.body.document !== undefined) {
          const { timezone } = await compileOrThrow(row.connectionId, request.body.document);
          patch.document = request.body.document;
          patch.timezone = timezone;
        }
        await scopes.update(row.id, patch);
        // Every key on this scope is now stale in the resolver's cache.
        for (const k of await keys.listByScope(row.id)) deps.invalidateResolver?.(k.id);

        await app.rbac.audit(request, {
          category: 'system',
          action: 'public-scope.update',
          changes: { before: { name: row.name }, after: { scopeId: row.id, ...patch } },
        });
        const after = await scopes.findById(row.id);
        const count = (await keys.listByScope(row.id)).length;
        return { scopes: after === null ? [] : [scopeToDto(after, count)] };
      },
    );

    app.delete(
      '/public-scopes/:id',
      {
        preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
        schema: { params: publicScopeIdParams, response: { 200: publicKeyOkReply } },
      },
      async (request) => {
        const row = await scopes.findById(request.params.id);
        if (row === null) throw new NotFoundError('Scope not found.', { id: request.params.id });
        const removed = await scopes.remove(row.id);
        if (!removed) {
          // The repo refuses while a key still points at it, so the operator
          // sees what they are about to break instead of a driver error.
          throw new ConflictError(
            'Delete or revoke the keys that use this scope first.',
            'CONFLICT',
            { id: row.id },
          );
        }
        await app.rbac.audit(request, {
          category: 'system',
          action: 'public-scope.delete',
          changes: { before: { scopeId: row.id, name: row.name } },
        });
        return { ok: true as const };
      },
    );

    /* ------------------------------------------------------------- keys */

    app.get(
      '/public-keys',
      {
        preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
        schema: { response: { 200: publicKeyListReply } },
      },
      async () => ({ keys: (await keys.list()).map(keyToDto) }),
    );

    app.post(
      '/public-keys',
      {
        preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
        schema: { body: publicKeyCreateBody, response: { 201: publicKeyCreateReply } },
      },
      async (request, reply) => {
        const scope = await scopes.findById(request.body.scopeId);
        if (scope === null) throw new NotFoundError('Scope not found.', { id: request.body.scopeId });

        const generated = generatePublishableKey();
        const row = await keys.create({
          name: request.body.name,
          prefix: generated.prefix,
          tokenHash: generated.tokenHash,
          tokenEncrypted: sealPublishableKey(crypto, generated.token),
          scopeId: scope.id,
          // The key inherits the SCOPE's side; it is not separately settable,
          // because a key whose side disagrees with its scope is meaningless.
          side: scope.side,
          // The app binding is what `surface-config.json` serves the key by
          // (29 D10). Stored as given: a binding may be minted before the
          // surface's first build lands in the surfaces directory.
          ...(request.body.appKey === undefined ? {} : { appKey: request.body.appKey }),
          ...(request.body.origins === undefined ? {} : { origins: request.body.origins }),
          createdBy: (request as unknown as { user?: { id?: string } }).user?.id ?? null,
          expiresAt: request.body.expiresAt ?? null,
        });
        await app.rbac.audit(request, {
          category: 'system',
          action: 'public-key.create',
          changes: {
            after: {
              keyId: row.id,
              name: row.name,
              prefix: row.prefix,
              scopeId: scope.id,
              ...(row.appKey === null ? {} : { appKey: row.appKey }),
            },
          },
        });
        return reply.status(201).send({ key: keyToDto(row), token: generated.token });
      },
    );

    app.get(
      '/public-keys/:id/reveal',
      {
        preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
        schema: { params: publicKeyIdParams, response: { 200: publicKeyRevealReply } },
      },
      async (request) => {
        const row = await keys.findById(request.params.id);
        if (row === null) throw new NotFoundError('Key not found.', { id: request.params.id });
        // Audited as a READ, deliberately: re-reading a secret is the whole
        // difference from `adm_sk_`, and it should leave a trail.
        await app.rbac.audit(request, {
          category: 'system',
          action: 'public-key.reveal',
          changes: { after: { keyId: row.id, prefix: row.prefix } },
        });
        return { token: openPublishableKey(crypto, row.tokenEncrypted) };
      },
    );

    app.post(
      '/public-keys/:id/rotate',
      {
        preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
        schema: { params: publicKeyIdParams, response: { 200: publicKeyCreateReply } },
      },
      async (request) => {
        const row = await keys.findById(request.params.id);
        if (row === null) throw new NotFoundError('Key not found.', { id: request.params.id });
        if (row.revokedAt !== null) {
          throw new ConflictError('This key is revoked; create a new one.', 'CONFLICT', { id: row.id });
        }
        const next = rotatePublishableKey();
        await keys.rotate(row.id, {
          prefix: next.prefix,
          tokenHash: next.tokenHash,
          tokenEncrypted: sealPublishableKey(crypto, next.token),
        });
        deps.invalidateResolver?.(row.id);
        await app.rbac.audit(request, {
          category: 'system',
          action: 'public-key.rotate',
          changes: { before: { prefix: row.prefix }, after: { keyId: row.id, prefix: next.prefix } },
        });
        const after = await keys.findById(row.id);
        return { key: keyToDto(after ?? row), token: next.token };
      },
    );

    app.delete(
      '/public-keys/:id',
      {
        preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
        schema: { params: publicKeyIdParams, response: { 200: publicKeyOkReply } },
      },
      async (request) => {
        const row = await keys.findById(request.params.id);
        if (row === null) throw new NotFoundError('Key not found.', { id: request.params.id });
        if (row.revokedAt !== null) {
          throw new ConflictError('This key is already revoked.', 'CONFLICT', { id: row.id });
        }
        await keys.revoke(row.id, app.rbac.now());
        deps.invalidateResolver?.(row.id);
        await app.rbac.audit(request, {
          category: 'system',
          action: 'public-key.revoke',
          changes: { before: { keyId: row.id, name: row.name, prefix: row.prefix } },
        });
        return { ok: true as const };
      },
    );
  };
}
