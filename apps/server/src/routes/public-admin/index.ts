// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Managing the public surface (server half).
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
  LivePublicKeysError,
  overridesRepo,
  publicApiStateRepo,
  publicEndpointsRepo,
  publicRequestStatsRepo,
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
  SERVER_KEY_SEALED_SENTINEL,
} from '../../public-api/keys.js';
import { compileScope, ScopeCompileError, type ScopeIssue } from '../../public-api/scope.js';
import { derivedDocumentIssues, parseAccess } from '../../public-api/derive.js';
import { METHOD_ACTION, PUBLIC_METHODS } from '../../public-api/endpoint.js';
import {
  createEndpointService,
  EndpointChanged,
  KeyCreateRefused,
  PublicApiContended,
  type EndpointService,
} from '../../public-api/endpoint-service.js';
import { createPublicViews, type PublicViews } from '../../public-api/runtime.js';
import { registerEndpointRoutes } from './endpoints.js';
import {
  publicApiStatsQuery,
  publicApiStatsReply,
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
  /** Drops the cached `publicApi.docsEnabled` so the docs switch takes effect at once. */
  invalidateDocsGate?: (() => void) | undefined;
  /** Drops a cached resolved key so a scope edit takes effect at once. */
  invalidateResolver?: ((keyId?: string) => void) | undefined;
  /**
   * Any successful write through these routes — the things that change what a
   * key may call. The `/api-docs` catalogue listens.
   */
  onChange?: (() => void) | undefined;
  /** The schema views the public routes read; built here when absent (route tests). */
  views?: PublicViews | undefined;
  /** The endpoint service, shared with the app installer; built here when absent (route tests). */
  service?: EndpointService | undefined;
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

/** What `GET /public-keys` works out per key beyond its own row. */
interface KeyExtras {
  connectionId: string | null;
  access: PublicKeyDto['access'];
  issues: ScopeIssue[];
}

const NO_EXTRAS: KeyExtras = { connectionId: null, access: [], issues: [] };

/** Strips `tokenHash` and `tokenEncrypted` — no secret leaves this mapper. */
function keyToDto(row: PublicKey, extras: KeyExtras = NO_EXTRAS): PublicKeyDto {
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
    connectionId: extras.connectionId,
    kind: row.kind === 'server' ? 'server' : 'browser',
    access: extras.access,
    issues: extras.issues.map((i) => ({ ...i })),
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
  const endpoints = publicEndpointsRepo(meta);
  const state = publicApiStateRepo(meta);
  const views = deps.views ?? createPublicViews(meta);
  const tenantConfigOf = async (connectionId: string) =>
    (await connectionTenantConfig(meta, connectionId)) ?? undefined;
  const service =
    deps.service ??
    createEndpointService({
      meta,
      viewFor: views.viewFor,
      tenantConfigOf,
      invalidate: (keyId) => deps.invalidateResolver?.(keyId),
    });

  /*
   * Every change to what a key may do advances the shared revision, so other
   * processes drop their cached keys within one gate refresh.
   */
  const bump = async (): Promise<void> => {
    await state.bump(Date.now());
  };

  /** A derived scope belongs to its key: the scope routes answer as if it did not exist. */
  const handWritten = (row: PublicScope | null): PublicScope | null =>
    row === null || row.derivedForKey !== null ? null : row;

  /**
   * The Access cell and the health of every key, in one pass per connection.
   * A derived key's grants are projected through the endpoint rows; a key on
   * a hand-written scope is projected from its resources, so the page has one
   * code path either way.
   */
  async function keyExtras(rows: readonly PublicKey[]): Promise<Map<string, KeyExtras>> {
    const out = new Map<string, KeyExtras>();
    const scopeById = new Map((await scopes.list()).map((sc) => [sc.id, sc]));
    const endpointCache = new Map<string, Map<string, { ref: string; methods: Set<string> }>>();
    const endpointsOf = async (connectionId: string) => {
      const cached = endpointCache.get(connectionId);
      if (cached !== undefined) return cached;
      const map = new Map<string, { ref: string; methods: Set<string> }>();
      for (const e of await endpoints.listByConnection(connectionId)) {
        let methods: string[] = [];
        try {
          const parsed = JSON.parse(e.definition) as { methods?: unknown };
          if (Array.isArray(parsed.methods)) methods = parsed.methods.filter((m): m is string => typeof m === 'string');
        } catch {
          methods = [];
        }
        map.set(e.id, { ref: e.ref, methods: new Set(methods) });
      }
      endpointCache.set(connectionId, map);
      return map;
    };
    const at = Date.now();
    for (const row of rows) {
      const scope = scopeById.get(row.scopeId);
      if (scope === undefined) {
        out.set(row.id, NO_EXTRAS);
        continue;
      }
      let document: unknown = null;
      try {
        document = JSON.parse(scope.document);
      } catch {
        document = null;
      }
      const access: PublicKeyDto['access'] = [];
      if (row.access !== null) {
        const eps = await endpointsOf(scope.connectionId);
        for (const [endpointId, granted] of Object.entries(parseAccess(row.access))) {
          const ep = eps.get(endpointId);
          access.push({
            endpointId,
            ref: ep?.ref ?? null,
            path: ep === undefined ? null : `/${ep.ref}`,
            methods: ep === undefined ? [] : granted.filter((m) => ep.methods.has(m)),
            suspended: ep === undefined ? [...granted] : granted.filter((m) => !ep.methods.has(m)),
          });
        }
      } else if (typeof document === 'object' && document !== null) {
        const resources = (document as { resources?: { ref?: unknown; actions?: unknown }[] }).resources ?? [];
        for (const r of resources) {
          if (typeof r.ref !== 'string') continue;
          const actions = Array.isArray(r.actions) ? r.actions : [];
          access.push({
            endpointId: null,
            ref: r.ref,
            path: `/${r.ref}`,
            methods: PUBLIC_METHODS.filter((m) => actions.includes(METHOD_ACTION[m])),
            suspended: [],
          });
        }
      }
      // Health is worth computing only for a key that could be serving.
      const live = row.revokedAt === null && (row.expiresAt === null || row.expiresAt > at);
      let issues: ScopeIssue[] = [];
      if (live) {
        const view = await views.viewFor(scope.connectionId);
        const inherited = await tenantConfigOf(scope.connectionId);
        if (scope.derivedForKey !== null) {
          issues = derivedDocumentIssues(document, view, inherited);
        } else {
          try {
            compileScope(document, lookupFor(view), inherited);
          } catch (error) {
            if (error instanceof ScopeCompileError) issues = [...error.issues];
            else throw error;
          }
        }
      }
      out.set(row.id, { connectionId: scope.connectionId, access, issues });
    }
    return out;
  }

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

  /** Column existence from a view already in hand — the resolver's own lookup. */
  function lookupFor(view: SnapshotView | null) {
    if (view === null) return undefined;
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
       * is passed at resolve time: a scope that omits `timezone` INHERITS it.
       * Without this, authoring refused every such scope with "no time zone is
       * configured" while the connection plainly had one — inheritance that
       * works at read time and not at write time is a feature an operator can
       * never actually use.
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
    if (deps.onChange !== undefined) {
      const onChange = deps.onChange;
      app.addHook('onResponse', async (request, reply) => {
        if (request.method !== 'GET' && request.method !== 'HEAD' && reply.statusCode < 400) onChange();
      });
    }

    /* ---------------------------------------------------------- the switch */

    const stateOf = async () => ({
      enabled: (await settings.get('publicApi.enabled')) === true,
      // Level 1 is an env var and a restart. The page must SAY that rather
      // than render a toggle that silently does nothing.
      registered: env.ADMINIUM_PUBLIC_API_ORIGINS !== undefined,
      origins: [...(env.ADMINIUM_PUBLIC_API_ORIGINS ?? [])],
      docsEnabled: (await settings.get('publicApi.docsEnabled')) === true,
    });

    app.get(
      '/public-api',
      {
        preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
        schema: { response: { 200: publicApiStateReply } },
      },
      async () => stateOf(),
    );

    /*
     * Both switches apply on the request, with no Save and no review:
     * this is the kill switch of the one internet-facing surface. A
     * switch the body does not name is left exactly as it is.
     */
    app.put(
      '/public-api',
      {
        preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
        schema: { body: publicApiStateBody, response: { 200: publicApiStateReply } },
      },
      async (request) => {
        const before = await stateOf();
        const updatedBy = (request as unknown as { user?: { id?: string } }).user?.id ?? null;
        const { enabled, docsEnabled } = request.body;
        if (enabled !== undefined) {
          await settings.set('publicApi.enabled', enabled, { updatedBy });
          // Without this the flip appears not to work for up to the cache TTL,
          // which reads as a broken control and invites a second click.
          deps.invalidateGate?.();
        }
        if (docsEnabled !== undefined) {
          await settings.set('publicApi.docsEnabled', docsEnabled, { updatedBy });
          deps.invalidateDocsGate?.();
        }
        const after = await stateOf();
        if (enabled !== undefined) {
          await app.rbac.audit(request, {
            category: 'system',
            action: 'public-api.toggle',
            changes: { before: { enabled: before.enabled }, after: { enabled: after.enabled } },
          });
        }
        if (docsEnabled !== undefined) {
          await app.rbac.audit(request, {
            category: 'system',
            action: 'public-api.docs-toggle',
            changes: { before: { docsEnabled: before.docsEnabled }, after: { docsEnabled: after.docsEnabled } },
          });
        }
        return after;
      },
    );

    app.get(
      '/public-api/stats',
      {
        preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
        schema: { querystring: publicApiStatsQuery, response: { 200: publicApiStatsReply } },
      },
      async (request) => {
        const since = Date.now() - 24 * 3_600_000;
        const { connectionId } = request.query;
        // One connection's keys, when the page is scoped to one.
        let keyIds: string[] | undefined;
        if (connectionId !== undefined) {
          const onConnection = new Set(
            (await scopes.listByConnection(connectionId)).map((scope) => scope.id),
          );
          keyIds = (await keys.list()).filter((k) => onConnection.has(k.scopeId)).map((k) => k.id);
        }
        const totals = await publicRequestStatsRepo(meta).totals(
          keyIds === undefined ? { since } : { since, keyIds },
        );
        return { requests24h: totals.requests, errors24h: totals.errors };
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
        // A derived scope is its key's, not the operator's.
        return {
          scopes: (await scopes.list())
            .filter((r) => r.derivedForKey === null)
            .map((r) => scopeToDto(r, counts.get(r.id) ?? 0)),
        };
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
        const row = handWritten(await scopes.findById(request.params.id));
        if (row === null) throw new NotFoundError('Scope not found.', { id: request.params.id });

        const patch: { name?: string; document?: string; timezone?: string } = {};
        if (request.body.name !== undefined) patch.name = request.body.name;
        if (request.body.document !== undefined) {
          const { timezone } = await compileOrThrow(row.connectionId, request.body.document);
          patch.document = request.body.document;
          patch.timezone = timezone;
        }
        await scopes.update(row.id, patch);
        await bump();
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
        const row = handWritten(await scopes.findById(request.params.id));
        if (row === null) throw new NotFoundError('Scope not found.', { id: request.params.id });
        // Inert keys (revoked or expired) go with the scope; listed up front
        // only so the audit row names what was cleared.
        const at = app.rbac.now();
        const inertKeys = await keys.listInert({ scopeId: row.id }, at);
        try {
          await scopes.remove(row.id, at);
        } catch (error) {
          if (error instanceof LivePublicKeysError) {
            // A live key is a shipped public surface: the operator revokes it
            // on purpose and sees what breaks, rather than as a side effect.
            throw new ConflictError(
              'Revoke the publishable keys that use this scope first.',
              'PUBLIC_KEYS_LIVE',
              { keys: error.keys },
            );
          }
          throw error;
        }
        await bump();
        await app.rbac.audit(request, {
          category: 'system',
          action: 'public-scope.delete',
          changes: {
            before: {
              scopeId: row.id,
              name: row.name,
              ...(inertKeys.length === 0
                ? {}
                : { publicKeys: inertKeys.map((k) => ({ keyId: k.id, prefix: k.prefix })) }),
            },
          },
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
      async () => {
        const rows = await keys.list();
        const extras = await keyExtras(rows);
        return { keys: rows.map((row) => keyToDto(row, extras.get(row.id))) };
      },
    );

    app.post(
      '/public-keys',
      {
        preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
        schema: { body: publicKeyCreateBody, response: { 201: publicKeyCreateReply } },
      },
      async (request, reply) => {
        const body = request.body;
        const actorId = (request as unknown as { user?: { id?: string } }).user?.id ?? null;
        const byScope = body.scopeId !== undefined;
        const byAccess = body.connectionId !== undefined || body.access !== undefined;
        if (byScope === byAccess) {
          throw new ValidationFailedError(
            'Name either a scope, or a connection and the endpoints the key may call.',
            { issues: [{ code: 'KEY_SHAPE_INVALID', message: 'send scopeId, or connectionId with access' }] },
          );
        }
        const kind = body.kind ?? 'browser';
        if (kind === 'server' && byScope) {
          throw new ValidationFailedError('A server key is made from endpoints.', {
            issues: [{ code: 'KEY_SHAPE_INVALID', message: 'send connectionId with access for a server key' }],
          });
        }
        const generated = generatePublishableKey(kind);
        const secret = {
          prefix: generated.prefix,
          tokenHash: generated.tokenHash,
          // A server key is shown once and stored hash-only: there is nothing
          // to reveal later, which is what makes "copy it now" true.
          tokenEncrypted: kind === 'server' ? SERVER_KEY_SEALED_SENTINEL : sealPublishableKey(crypto, generated.token),
        };

        if (byAccess) {
          // Endpoints × methods, and Adminium writes the scope for the caller.
          if (body.connectionId === undefined || body.access === undefined) {
            throw new ValidationFailedError('A key made from endpoints needs a connection and its access.', {
              issues: [{ code: 'KEY_SHAPE_INVALID', message: 'send connectionId with access' }],
            });
          }
          let created;
          try {
            created = await service.createKey({
              connectionId: body.connectionId,
              name: body.name,
              access: body.access.map((a) => ({
                ref: a.ref,
                methods: a.methods,
                ...(a.source === undefined ? {} : { source: a.source }),
                ...(a.selectHash === undefined ? {} : { selectHash: a.selectHash }),
              })),
              secret,
              ...(body.appKey === undefined ? {} : { appKey: body.appKey }),
              ...(body.origins === undefined ? {} : { origins: body.origins }),
              expiresAt: body.expiresAt ?? null,
              actorId,
              kind,
            });
          } catch (error) {
            if (error instanceof KeyCreateRefused) {
              throw new ValidationFailedError('The key could not be made from those endpoints.', {
                issues: error.issues.map((i) => ({ ...i })),
              });
            }
            if (error instanceof EndpointChanged) {
              throw new ConflictError(
                'Some endpoints changed since the page loaded them; reload and review.',
                'PUBLIC_ENDPOINT_CHANGED',
                { refs: [...error.refs] },
              );
            }
            if (error instanceof PublicApiContended) {
              throw new ConflictError('The public API changed meanwhile; try again.', 'CONFLICT');
            }
            throw error;
          }
          const row = created.key;
          await app.rbac.audit(request, {
            category: 'system',
            action: 'public-key.create',
            changes: {
              after: {
                keyId: row.id,
                name: row.name,
                prefix: row.prefix,
                scopeId: row.scopeId,
                connectionId: body.connectionId,
                access: body.access.map((a) => ({ ref: a.ref, methods: a.methods })),
                ...(row.appKey === null ? {} : { appKey: row.appKey }),
              },
            },
          });
          const extras = await keyExtras([row]);
          return reply.status(201).send({ key: keyToDto(row, extras.get(row.id)), token: generated.token });
        }

        // A derived scope is its key's alone: a second key riding it would
        // inherit grants nobody gave it.
        const scope = handWritten(await scopes.findById(body.scopeId as string));
        if (scope === null) throw new NotFoundError('Scope not found.', { id: body.scopeId });

        const row = await keys.create({
          name: body.name,
          prefix: secret.prefix,
          tokenHash: secret.tokenHash,
          tokenEncrypted: secret.tokenEncrypted,
          scopeId: scope.id,
          // The key inherits the SCOPE's side; it is not separately settable,
          // because a key whose side disagrees with its scope is meaningless.
          side: scope.side,
          // The app binding is what `surface-config.json` serves the key by
          // . Stored as given: a binding may be minted before the
          // surface's first build lands in the surfaces directory.
          ...(body.appKey === undefined ? {} : { appKey: body.appKey }),
          ...(body.origins === undefined ? {} : { origins: body.origins }),
          createdBy: actorId,
          expiresAt: body.expiresAt ?? null,
        });
        await bump();
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
        const extras = await keyExtras([row]);
        return reply.status(201).send({ key: keyToDto(row, extras.get(row.id)), token: generated.token });
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
        // Checked BEFORE the audit row and the decrypt: a server key was
        // stored hash-only, and "revealing" its empty sentinel would audit a
        // read that returned nothing and then fail blaming the secret.
        if (row.kind === 'server') {
          throw new ConflictError('A server key is shown once, when it is made; there is nothing to reveal.', 'CONFLICT', {
            id: row.id,
          });
        }
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
        // Rotation keeps the kind: a server key rotates to a new `adm_srv_`,
        // still shown once.
        const kind = row.kind === 'server' ? 'server' : 'browser';
        const next = rotatePublishableKey(kind);
        await keys.rotate(row.id, {
          prefix: next.prefix,
          tokenHash: next.tokenHash,
          tokenEncrypted: kind === 'server' ? SERVER_KEY_SEALED_SENTINEL : sealPublishableKey(crypto, next.token),
        });
        deps.invalidateResolver?.(row.id);
        await bump();
        await app.rbac.audit(request, {
          category: 'system',
          action: 'public-key.rotate',
          changes: { before: { prefix: row.prefix }, after: { keyId: row.id, prefix: next.prefix } },
        });
        const after = (await keys.findById(row.id)) ?? row;
        const extras = await keyExtras([after]);
        return { key: keyToDto(after, extras.get(after.id)), token: next.token };
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
        await bump();
        await app.rbac.audit(request, {
          category: 'system',
          action: 'public-key.revoke',
          changes: { before: { keyId: row.id, name: row.name, prefix: row.prefix } },
        });
        return { ok: true as const };
      },
    );

    /* -------------------------------------------------------- endpoints */

    registerEndpointRoutes(app, { service, viewFor: views.viewFor, endpoints });
  };
}
