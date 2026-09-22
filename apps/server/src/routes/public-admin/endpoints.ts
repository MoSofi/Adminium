// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Managing public ENDPOINTS: the list the keys page and its
 * sheet read, the builder's check and save, rename and delete.
 *
 * Everything that decides anything lives in `public-api/endpoint.ts` and
 * `endpoint-service.ts`; these handlers translate between the wire and those,
 * and write the audit rows. Every refusal reaches the operator in full — the
 * issues, and the live keys a change would break — for the reason the scope
 * routes give: the operator is the one person who can fix it.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { publicEndpointsRepo } from '@adminium/meta';

import { columnPolicyFor } from '../../connections/effective-schema.js';
import type { SnapshotView } from '../../crud/identifiers.js';
import { ConflictError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { auditExempt, audited } from '../../audit/coverage.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  effectiveEndpoints,
  parseDefinition,
  PUBLIC_METHODS,
  type EffectiveEndpoint,
  type PublicEndpointDefinition,
} from '../../public-api/endpoint.js';
import {
  EndpointInUse,
  EndpointNotFound,
  EndpointRefTaken,
  EndpointSaveRefused,
  PublicApiContended,
  selectHash,
  type EndpointService,
  type KeyRef,
} from '../../public-api/endpoint-service.js';
import type { ScopeIssue } from '../../public-api/scope.js';
import {
  publicEndpointCheckBody,
  publicEndpointCheckReply,
  publicEndpointDeleteReply,
  publicEndpointListReply,
  publicEndpointParams,
  publicEndpointRenameBody,
  publicEndpointSaveBody,
  publicEndpointSaveReply,
  publicEndpointsQuery,
} from './schema.js';

export interface EndpointRoutesDeps {
  service: EndpointService;
  viewFor: (connectionId: string) => Promise<SnapshotView | null>;
  endpoints: ReturnType<typeof publicEndpointsRepo>;
}

function endpointToDto(e: EffectiveEndpoint) {
  return {
    id: e.id,
    ref: e.ref,
    path: `/${e.ref}`,
    origin: e.origin,
    stored: e.stored,
    definition: e.text,
    source: e.definition?.source ?? null,
    methods: e.definition === null ? [] : [...e.definition.methods],
    selectHash: e.definition === null ? null : selectHash(e.definition),
    issues: e.issues.map((i) => ({ ...i })),
  };
}

function sourcesOf(view: SnapshotView) {
  const out = [];
  for (const table of view.model.tables) {
    if (table.system || table.excluded === true) continue;
    const policy = columnPolicyFor(table);
    out.push({
      id: table.id,
      label: table.label ?? table.name,
      kind: table.kind,
      rowCountEstimate: table.rowCountEstimate ?? null,
      icon: table.icon ?? null,
      columns: table.columns
        .filter((c) => !policy.secret.has(c.name))
        .map((c) => ({ name: c.name, type: c.logicalType, primaryKey: c.isPrimaryKey, pii: policy.masked.has(c.name) })),
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Parse the pane's text, or answer 422 with the shape issues. */
function definitionOrThrow(text: string): PublicEndpointDefinition {
  const parsed = parseDefinition(text);
  if (!parsed.ok) {
    throw new ValidationFailedError('The endpoint definition is not valid.', { issues: parsed.issues, keys: [] });
  }
  return parsed.definition;
}

const refs = (keys: readonly KeyRef[]) => keys.map(({ id, name, prefix, scopeId }) => ({ id, name, prefix, scopeId }));

function refusal(issues: readonly ScopeIssue[], keys: readonly KeyRef[]): ValidationFailedError {
  return new ValidationFailedError('The endpoint definition did not compile.', {
    issues: issues.map((i) => ({ ...i })),
    keys: refs(keys),
  });
}

/** The service's typed failures, as the dashboard's envelope. */
function translate(error: unknown): unknown {
  if (error instanceof EndpointSaveRefused) return refusal(error.issues, error.keys);
  if (error instanceof EndpointInUse) {
    return new ConflictError('Revoke the keys that use this endpoint first.', 'PUBLIC_KEYS_LIVE', { keys: refs(error.keys) });
  }
  if (error instanceof EndpointNotFound) return new NotFoundError('Endpoint not found.');
  if (error instanceof EndpointRefTaken) return new ConflictError('Another endpoint already uses that path.', 'CONFLICT');
  if (error instanceof PublicApiContended) return new ConflictError('The public API changed meanwhile; try again.', 'CONFLICT');
  return error;
}

const actorOf = (request: unknown): string | null =>
  (request as { user?: { id?: string } }).user?.id ?? null;

type ZodApp = Parameters<FastifyPluginAsyncZod>[0];

export function registerEndpointRoutes(app: ZodApp, deps: EndpointRoutesDeps): void {
  const api = app;
  const { service, viewFor, endpoints } = deps;

  api.get(
    '/public-endpoints',
    {
      preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
      schema: { querystring: publicEndpointsQuery, response: { 200: publicEndpointListReply } },
    },
    async (request) => {
      const { connectionId } = request.query;
      const view = await viewFor(connectionId);
      const { endpoints: list, unaddressable } = effectiveEndpoints(view, await endpoints.listByConnection(connectionId));
      return {
        snapshot: view !== null,
        endpoints: list.map(endpointToDto),
        methods: [...PUBLIC_METHODS],
        sources: view === null ? [] : sourcesOf(view),
        unaddressable,
      };
    },
  );

  api.post(
    '/public-endpoints/check',
    {
      preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
      config: { audit: auditExempt('a dry run: compiles a definition and writes nothing') },
      schema: { body: publicEndpointCheckBody, response: { 200: publicEndpointCheckReply } },
    },
    async (request) => {
      const parsed = parseDefinition(request.body.definition);
      if (!parsed.ok) return { issues: parsed.issues, keys: [], keysStillBroken: [], widened: [] };
      const check = await service.checkEndpoint({
        connectionId: request.body.connectionId,
        ref: request.body.ref,
        definition: parsed.definition,
      });
      return {
        issues: check.issues.map((i) => ({ ...i })),
        keys: refs(check.keys),
        keysStillBroken: refs(check.keysStillBroken),
        widened: check.widened,
      };
    },
  );

  api.put(
    '/public-endpoints/:connectionId/:ref',
    {
      preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
      config: { audit: audited('rbac') },
      schema: { params: publicEndpointParams, body: publicEndpointSaveBody, response: { 200: publicEndpointSaveReply } },
    },
    async (request) => {
      const { connectionId, ref } = request.params;
      const definition = definitionOrThrow(request.body.definition);
      const before = await endpoints.findByRef(connectionId, ref);
      // A ref that is today a generated default is stored as `generated`, so
      // deleting it later switches it off rather than reviving the default.
      let origin: 'generated' | 'custom' = 'custom';
      if (before === null) {
        const view = await viewFor(connectionId);
        const current = effectiveEndpoints(view, await endpoints.listByConnection(connectionId)).endpoints;
        if (current.some((e) => e.ref === ref && !e.stored)) origin = 'generated';
      }
      let saved;
      try {
        saved = await service.saveEndpoint({ connectionId, ref, definition, origin, actorId: actorOf(request) });
      } catch (error) {
        throw translate(error);
      }
      await app.rbac.audit(request, {
        category: 'system',
        action: 'public-endpoint.save',
        // The definition diff IS the record: an endpoint edit widens or
        // narrows every key that grants it.
        changes: {
          before: before === null ? null : { definition: before.definition },
          after: {
            endpointId: saved.endpoint.id,
            connectionId,
            ref,
            definition: saved.endpoint.definition,
            regenerated: saved.regenerated.map((k) => k.id),
          },
        },
      });
      const view = await viewFor(connectionId);
      const listed = effectiveEndpoints(view, await endpoints.listByConnection(connectionId)).endpoints;
      const row = listed.find((e) => e.ref === ref);
      if (row === undefined) throw new NotFoundError('Endpoint not found.');
      return {
        endpoint: endpointToDto(row),
        keysStillBroken: refs(saved.keysStillBroken),
        widened: saved.widened,
      };
    },
  );

  api.post(
    '/public-endpoints/:connectionId/:ref/rename',
    {
      preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
      config: { audit: audited('rbac') },
      schema: { params: publicEndpointParams, body: publicEndpointRenameBody, response: { 200: publicEndpointSaveReply } },
    },
    async (request) => {
      const { connectionId, ref } = request.params;
      let renamed;
      try {
        renamed = await service.renameEndpoint({ connectionId, ref, to: request.body.ref });
      } catch (error) {
        throw translate(error);
      }
      await app.rbac.audit(request, {
        category: 'system',
        action: 'public-endpoint.rename',
        changes: { before: { ref }, after: { endpointId: renamed.id, connectionId, ref: renamed.ref } },
      });
      const view = await viewFor(connectionId);
      const row = effectiveEndpoints(view, await endpoints.listByConnection(connectionId)).endpoints.find(
        (e) => e.ref === renamed.ref,
      );
      if (row === undefined) throw new NotFoundError('Endpoint not found.');
      return { endpoint: endpointToDto(row), keysStillBroken: [], widened: [] };
    },
  );

  api.delete(
    '/public-endpoints/:connectionId/:ref',
    {
      preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
      config: { audit: audited('rbac') },
      schema: { params: publicEndpointParams, response: { 200: publicEndpointDeleteReply } },
    },
    async (request) => {
      const { connectionId, ref } = request.params;
      let removed;
      try {
        removed = await service.removeEndpoint({ connectionId, ref });
      } catch (error) {
        throw translate(error);
      }
      await app.rbac.audit(request, {
        category: 'system',
        action: 'public-endpoint.delete',
        changes: {
          before: { endpointId: removed.before.id, connectionId, ref, definition: removed.before.definition },
          after: { outcome: removed.outcome },
        },
      });
      return { ok: true as const, outcome: removed.outcome };
    },
  );
}
