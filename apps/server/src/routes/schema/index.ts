/**
 * Schema routes (08-server-api.md §2.5, 05 §11, M3-T05/T06):
 *
 * - `GET /connections/:id/schema` — active snapshot with overrides APPLIED
 *   (`?raw=true` returns the untouched introspection result),
 * - `GET /connections/:id/schema/snapshots[/:snapshotId]` — history,
 * - `GET /connections/:id/schema/diff` — previous vs latest (or `from`/`to`),
 * - `GET/PUT /connections/:id/schema/overrides` (+ the 05 §11
 *   `/connections/:id/overrides` alias) — validated against the active
 *   snapshot; unknown identifiers → 422.
 *
 * Reads require an authenticated principal (the v1 closed grant set has no
 * `schema.read`); override writes require `system:schema:remap`.
 */

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { diffModels, type DatabaseModel } from '@adminium/engine';
import {
  MetaValidationError,
  overridesRepo,
  snapshotsRepo,
  validateOverrideInput,
  type MetaDb,
  type SchemaSnapshot,
} from '@adminium/meta';

import { ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { applyOverrides } from '../../connections/effective-schema.js';
import type { ConnectionManager } from '../../connections/manager.js';
import {
  overridesPutBody,
  overridesReply,
  type OverridesPutBody,
  schemaConnParams,
  schemaDiffQuery,
  schemaDiffReply,
  schemaGetQuery,
  schemaReply,
  snapshotListReply,
  snapshotParams,
} from './schema.js';

export const SCHEMA_REMAP = 'system:schema:remap';

export interface SchemaRoutesDeps {
  manager: ConnectionManager;
  meta: MetaDb;
}

export function schemaRoutes(deps: SchemaRoutesDeps): FastifyPluginAsyncZod {
  const { manager, meta } = deps;
  const snapshots = snapshotsRepo(meta);
  const overrides = overridesRepo(meta);

  return async (app) => {
    /** 401 without a principal; no grant needed beyond a session (see header note). */
    async function requireSession(request: FastifyRequest): Promise<void> {
      await app.rbac.resolve(request);
    }

    async function mustLatest(connectionId: string): Promise<SchemaSnapshot> {
      await manager.mustFind(connectionId);
      const latest = await snapshots.latest(connectionId);
      if (latest === null) {
        throw new NotFoundError('No schema snapshot yet — run introspection first.', { connectionId });
      }
      return latest;
    }

    async function schemaPayload(connectionId: string, snapshot: SchemaSnapshot, raw: boolean) {
      if (raw) {
        return {
          connectionId,
          snapshotId: snapshot.id,
          checksum: snapshot.checksum,
          createdAt: snapshot.createdAt,
          source: snapshot.source,
          model: snapshot.schema,
          appliedOverrides: 0,
        };
      }
      const active = await overrides.listForConnection(connectionId, { status: 'active' });
      return {
        connectionId,
        snapshotId: snapshot.id,
        checksum: snapshot.checksum,
        createdAt: snapshot.createdAt,
        source: snapshot.source,
        model: applyOverrides(snapshot.schema as DatabaseModel, active),
        appliedOverrides: active.length,
      };
    }

    app.get(
      '/connections/:id/schema',
      {
        preHandler: requireSession,
        schema: { params: schemaConnParams, querystring: schemaGetQuery, response: { 200: schemaReply } },
      },
      async (request) => {
        const snapshot = await mustLatest(request.params.id);
        return schemaPayload(request.params.id, snapshot, request.query.raw === true);
      },
    );

    app.get(
      '/connections/:id/schema/snapshots',
      {
        preHandler: requireSession,
        schema: { params: schemaConnParams, response: { 200: snapshotListReply } },
      },
      async (request) => {
        await manager.mustFind(request.params.id);
        const list = await snapshots.listForConnection(request.params.id);
        return {
          snapshots: list.map((s) => ({
            id: s.id,
            source: s.source,
            engineVersion: s.engineVersion,
            checksum: s.checksum,
            isActive: s.isActive,
            createdAt: s.createdAt,
            createdBy: s.createdBy,
          })),
        };
      },
    );

    app.get(
      '/connections/:id/schema/snapshots/:snapshotId',
      {
        preHandler: requireSession,
        schema: { params: snapshotParams, querystring: schemaGetQuery, response: { 200: schemaReply } },
      },
      async (request) => {
        await manager.mustFind(request.params.id);
        const snapshot = await snapshots.findById(request.params.snapshotId);
        if (snapshot === null || snapshot.connectionId !== request.params.id) {
          throw new NotFoundError('Snapshot not found.', { snapshotId: request.params.snapshotId });
        }
        return schemaPayload(request.params.id, snapshot, request.query.raw === true);
      },
    );

    app.get(
      '/connections/:id/schema/diff',
      {
        preHandler: requireSession,
        schema: { params: schemaConnParams, querystring: schemaDiffQuery, response: { 200: schemaDiffReply } },
      },
      async (request) => {
        const latest = await mustLatest(request.params.id);
        const to =
          request.query.to === undefined ? latest : await snapshots.findById(request.query.to);
        const from =
          request.query.from === undefined
            ? to === null
              ? null
              : await snapshots.previous(request.params.id, to.id)
            : await snapshots.findById(request.query.from);
        if (to === null || to.connectionId !== request.params.id) {
          throw new NotFoundError('`to` snapshot not found.', { snapshotId: request.query.to });
        }
        if (from === null) {
          // Nothing before the latest — empty diff.
          return {
            from: null,
            to: to.id,
            diff: diffModels(to.schema as DatabaseModel, to.schema as DatabaseModel),
          };
        }
        if (from.connectionId !== request.params.id) {
          throw new NotFoundError('`from` snapshot not found.', { snapshotId: request.query.from });
        }
        return {
          from: from.id,
          to: to.id,
          diff: diffModels(from.schema as DatabaseModel, to.schema as DatabaseModel),
        };
      },
    );

    const getOverridesOpts = {
      preHandler: requireSession,
      schema: { params: schemaConnParams, response: { 200: overridesReply } },
    } as const;
    const getOverridesHandler = async (request: { params: { id: string } }) => {
      await manager.mustFind(request.params.id);
      const rows = await overrides.listForConnection(request.params.id);
      return {
        overrides: rows.map((o) => ({
          id: o.id,
          op: o.op,
          tableName: o.tableName,
          columnName: o.columnName,
          value: o.value,
          origin: o.origin,
          status: o.status,
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
        })),
      };
    };
    app.get('/connections/:id/schema/overrides', getOverridesOpts, getOverridesHandler);
    app.get('/connections/:id/overrides', getOverridesOpts, getOverridesHandler);

    const putOverridesOpts = {
      preHandler: app.rbac.require(SCHEMA_REMAP),
      schema: { params: schemaConnParams, body: overridesPutBody, response: { 200: overridesReply } },
    } as const;
    const putOverridesHandler = async (request: FastifyRequest) => {
      const connectionId = (request.params as { id: string }).id;
      const body = request.body as OverridesPutBody;
      const snapshot = await mustLatest(connectionId);
      const model = snapshot.schema as DatabaseModel;
      const tables = new Map(model.tables.map((t) => [t.id, t]));

      // Validate every op against the vocabulary AND the active snapshot
      // (unknown identifiers → 422, §2.5) before any write.
      for (const item of body.overrides) {
        try {
          validateOverrideInput({ connectionId, ...item, columnName: item.columnName ?? null });
        } catch (error) {
          if (error instanceof MetaValidationError) {
            throw new ValidationFailedError(error.message, { issues: error.issues, item });
          }
          throw error;
        }
        const table = tables.get(item.tableName);
        if (table === undefined) {
          throw new ValidationFailedError(`Unknown table ${JSON.stringify(item.tableName)}.`, {
            table: item.tableName,
          });
        }
        if (item.columnName != null && !table.columns.some((c) => c.name === item.columnName)) {
          throw new ValidationFailedError(
            `Unknown column ${JSON.stringify(item.columnName)} on ${item.tableName}.`,
            { table: item.tableName, column: item.columnName },
          );
        }
        if (item.op === 'relation.add') {
          const target = tables.get(String(item.value.toTable));
          if (target === undefined || !target.columns.some((c) => c.name === item.value.toColumn)) {
            throw new ValidationFailedError('relation.add target does not exist in the snapshot.', {
              toTable: item.value.toTable,
              toColumn: item.value.toColumn,
            });
          }
        }
      }

      // Unmask escalation guard (security decision 2026-07-23): `schema:remap`
      // is a grantable key a non-super-admin admin can hold. Turning PII masking
      // ON (a `column.pii` op with masked:true) is always allowed — it only
      // increases privacy. Turning it OFF exposes real PII to every reader, so
      // it requires Super Admin (which still lets a Super Admin correct a
      // classifier false-positive, while a delegated remapper cannot silently
      // unmask).
      // Only an EXPLICIT masked:false override can unmask a PII column: omitting
      // an override from this full replace reverts the column to the
      // classifier's default (still masked for genuinely-PII columns), so the
      // explicit-false check is the complete guard.
      const unmasking = body.overrides.some(
        (item) => item.op === 'column.pii' && item.value['masked'] === false,
      );
      if (unmasking) {
        const set = await app.rbac.resolve(request);
        if (!set.superAdmin) {
          throw new ForbiddenError('Turning PII masking off requires Super Admin.');
        }
      }

      const before = await overrides.listForConnection(connectionId);
      const rows = await overrides.replaceForConnection(
        connectionId,
        body.overrides.map((item) => ({
          op: item.op,
          tableName: item.tableName,
          columnName: item.columnName ?? null,
          value: item.value,
          ...(item.status !== undefined ? { status: item.status } : {}),
        })),
      );
      await app.rbac.audit(request, {
        category: 'schema',
        action: 'schema.overrides.replace',
        connectionId,
        changes: { before: { count: before.length }, after: { count: rows.length } },
      });
      return {
        overrides: rows.map((o) => ({
          id: o.id,
          op: o.op,
          tableName: o.tableName,
          columnName: o.columnName,
          value: o.value,
          origin: o.origin,
          status: o.status,
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
        })),
      };
    };
    app.put('/connections/:id/schema/overrides', putOverridesOpts, putOverridesHandler as never);
    app.put('/connections/:id/overrides', putOverridesOpts, putOverridesHandler as never);
  };
}
