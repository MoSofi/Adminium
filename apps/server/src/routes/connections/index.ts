// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Connections manager routes (08-server-api.md §2.4, M3-T04):
 * create (test + encrypt + meta-placement enforcement), list with health,
 * get/patch, type-to-confirm delete (pool disposal included), pre-create and
 * per-connection test, and introspection (202 job when the jobs worker is
 * wired; synchronous fallback otherwise).
 *
 * All routes are guarded by `system:connections:manage` — the v1 closed
 * grant set (meta SYSTEM_ACTION_KEYS) has no `connections.read`, so reads
 * share the manage grant until the grammar grows one.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { pagesRepo, snapshotsRepo, type Connection, type MetaDb } from '@adminium/meta';

import { ConflictError, ValidationFailedError } from '../../errors.js';
import { DsnSecretMismatchError } from '../../connections/crypto.js';
import { maskDsn } from '../../connections/dsn.js';
import {
  INTROSPECT_JOB_KIND,
  runIntrospection,
} from '../../connections/introspect.js';
import type { ConnectionManager, ConnectionTestSummary } from '../../connections/manager.js';
import {
  connectionCreateBody,
  connectionDeleteBody,
  connectionIdParams,
  connectionListReply,
  connectionPatchBody,
  connectionReply,
  connectionTestBody,
  connectionTestReply,
  introspectSyncReply,
  jobAcceptedReply,
  okReply,
  type ConnectionDto,
  type ConnectionTestReply,
} from './schema.js';

export const CONNECTIONS_MANAGE = 'system:connections:manage';

export interface ConnectionsRoutesDeps {
  manager: ConnectionManager;
  meta: MetaDb;
}

function testReply(summary: ConnectionTestSummary): ConnectionTestReply {
  return {
    ok: summary.ok,
    latencyMs: summary.latencyMs,
    serverVersion: summary.serverVersion,
    readOnly: summary.readOnly,
    privileges: summary.capabilities?.privileges ?? null,
    error: summary.error,
  };
}

/** Table count from the snapshot's normalized model (opaque to meta — 05 §2). */
function modelTableCount(schema: unknown): number | null {
  if (schema === null || typeof schema !== 'object') return null;
  const tables = (schema as { tables?: unknown }).tables;
  return Array.isArray(tables) ? tables.length : null;
}

export function connectionsRoutes(deps: ConnectionsRoutesDeps): FastifyPluginAsyncZod {
  const { manager, meta } = deps;
  const snapshots = snapshotsRepo(meta);
  const pages = pagesRepo(meta);

  return async (app) => {
    async function toDto(
      connection: Connection,
      pageCounts?: Readonly<Record<string, number>>,
    ): Promise<ConnectionDto> {
      // A DSN encrypted under a different ADMINIUM_SECRET must not take the
      // whole list down with it. Before this catch, one unreadable connection
      // 500'd `GET /connections` — so the Studio page that exists to show you
      // that something is wrong was the one page you could not open. The row
      // reports the truth instead: unreadable DSN, status `error`, and the
      // explanation in `lastError` where the UI already renders it.
      let dsns: Awaited<ReturnType<typeof manager.connections.getDsns>> = null;
      let secretMismatch: DsnSecretMismatchError | null = null;
      try {
        dsns = await manager.connections.getDsns(connection.id);
      } catch (error) {
        if (!(error instanceof DsnSecretMismatchError)) throw error;
        secretMismatch = error;
      }
      const latest = await snapshots.latest(connection.id);
      const counts = pageCounts ?? (await pages.countGeneratedByConnection());
      return {
        id: connection.id,
        name: connection.name,
        engine: connection.engine,
        sourceKind: connection.sourceKind,
        dsnMasked: maskDsn(dsns?.dataDsn ?? dsns?.introspectDsn ?? null),
        readOnly: connection.readOnly,
        // The stored row still says whatever it said when it last worked
        // (`connected`), which is a lie the moment the secret changes.
        status: secretMismatch === null ? connection.status : 'error',
        lastTestedAt: connection.lastTestedAt,
        lastLatencyMs: connection.lastLatencyMs,
        lastError: secretMismatch === null ? connection.lastError : secretMismatch.message,
        // The stored hint explains the stored `lastError`. Once the mismatch
        // message replaces that, the hint describes a failure the card is no
        // longer reporting, so it goes with it.
        lastErrorHint: secretMismatch === null ? connection.lastErrorHint : null,
        snapshot:
          latest === null
            ? null
            : { id: latest.id, createdAt: latest.createdAt, checksum: latest.checksum },
        // Included tables: explicit allowlist wins; else everything the last
        // introspection saw; null before the first snapshot (hub shows "—").
        tableCount:
          connection.settings.includedTables?.length ??
          (latest === null ? null : modelTableCount(latest.schema)),
        pageCount: counts[connection.id] ?? 0,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      };
    }

    app.get(
      '/connections',
      {
        preHandler: app.rbac.require(CONNECTIONS_MANAGE),
        schema: { response: { 200: connectionListReply } },
      },
      async () => {
        const connections = await manager.connections.list();
        // One grouped query for all cards — no per-connection page scans.
        const pageCounts = await pages.countGeneratedByConnection();
        return { connections: await Promise.all(connections.map(async (c) => toDto(c, pageCounts))) };
      },
    );

    app.post(
      '/connections',
      {
        preHandler: app.rbac.require(CONNECTIONS_MANAGE),
        schema: { body: connectionCreateBody, response: { 201: connectionReply } },
      },
      async (request, reply) => {
        const body = request.body;
        const introspectDsn = body.roles?.introspect ?? body.dsn ?? body.roles?.data;
        const dataDsn = body.roles?.data ?? body.dsn ?? introspectDsn;
        if (introspectDsn === undefined || dataDsn === undefined) {
          throw new ValidationFailedError('Provide `dsn` or `roles.data` (§2.4).', {});
        }

        // Test the data role — its probe drives read-only + meta placement.
        const summary = await manager.testDsn(body.engine, dataDsn);
        if (summary.ok) manager.enforceMetaPlacement(dataDsn, summary);

        const actorId =
          request.apiKeyPrincipal === null
            ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null)
            : null;
        const connection = await manager.connections.create({
          name: body.name,
          engine: body.engine,
          sourceKind: 'dsn',
          introspectDsn,
          dataDsn: dataDsn === introspectDsn ? null : dataDsn,
          readOnly: summary.readOnly,
          settings: body.settings ?? {},
          status: summary.ok ? 'connected' : 'error',
          createdBy: actorId,
        });
        await manager.connections.recordTestResult(connection.id, {
          ok: summary.ok,
          latencyMs: summary.latencyMs,
          error: summary.error?.message ?? null,
          errorHint: summary.error?.hint ?? null,
          readOnly: summary.readOnly,
        });
        await app.rbac.audit(request, {
          category: 'connection',
          action: 'connection.create',
          connectionId: connection.id,
          changes: {
            after: {
              name: body.name,
              engine: body.engine,
              dsnMasked: maskDsn(dataDsn),
              ok: summary.ok,
              readOnly: summary.readOnly,
            },
          },
        });
        const created = await manager.connections.findById(connection.id);
        return reply.status(201).send(await toDto(created ?? connection));
      },
    );

    app.post(
      '/connections/test',
      {
        preHandler: app.rbac.require(CONNECTIONS_MANAGE),
        schema: { body: connectionTestBody, response: { 200: connectionTestReply } },
      },
      async (request) => {
        // Capability probes only — never persists (§2.4).
        const summary = await manager.testDsn(request.body.engine, request.body.dsn);
        return testReply(summary);
      },
    );

    app.get(
      '/connections/:id',
      {
        preHandler: app.rbac.require(CONNECTIONS_MANAGE),
        schema: { params: connectionIdParams, response: { 200: connectionReply } },
      },
      async (request) => toDto(await manager.mustFind(request.params.id)),
    );

    app.patch(
      '/connections/:id',
      {
        preHandler: app.rbac.require(CONNECTIONS_MANAGE),
        schema: {
          params: connectionIdParams,
          body: connectionPatchBody,
          response: { 200: connectionReply },
        },
      },
      async (request) => {
        const connection = await manager.mustFind(request.params.id);
        const updated = await manager.connections.update(connection.id, {
          ...(request.body.name !== undefined ? { name: request.body.name } : {}),
          ...(request.body.settings !== undefined ? { settings: request.body.settings } : {}),
        });
        await app.rbac.audit(request, {
          category: 'connection',
          action: 'connection.update',
          connectionId: connection.id,
          changes: { before: { name: connection.name }, after: { name: updated?.name ?? connection.name } },
        });
        return toDto(updated ?? connection);
      },
    );

    app.delete(
      '/connections/:id',
      {
        preHandler: app.rbac.require(CONNECTIONS_MANAGE),
        schema: {
          params: connectionIdParams,
          body: connectionDeleteBody,
          response: { 200: okReply },
        },
      },
      async (request) => {
        const connection = await manager.mustFind(request.params.id);
        // Type-to-confirm contract (§2.4): the submitted name must match.
        if (request.body.confirmName !== connection.name) {
          throw new ConflictError('Type the connection name to confirm deletion.', 'CONFLICT', {
            expectedName: connection.name,
          });
        }
        await manager.dispose(connection.id);
        await manager.connections.delete(connection.id);
        await app.rbac.audit(request, {
          category: 'connection',
          action: 'connection.delete',
          connectionId: connection.id,
          changes: { before: { name: connection.name, engine: connection.engine } },
        });
        return { ok: true as const };
      },
    );

    app.post(
      '/connections/:id/test',
      {
        preHandler: app.rbac.require(CONNECTIONS_MANAGE),
        schema: { params: connectionIdParams, response: { 200: connectionTestReply } },
      },
      async (request) => {
        const connection = await manager.mustFind(request.params.id);
        const dsns = await manager.connections.getDsns(connection.id);
        if (dsns?.dataDsn == null) {
          throw new ValidationFailedError('Connection has no DSN to test.', { connectionId: connection.id });
        }
        const summary = await manager.testDsn(connection.engine, dsns.dataDsn);
        await manager.connections.recordTestResult(connection.id, {
          ok: summary.ok,
          latencyMs: summary.latencyMs,
          error: summary.error?.message ?? null,
          errorHint: summary.error?.hint ?? null,
          readOnly: summary.readOnly,
        });
        return testReply(summary);
      },
    );

    app.post(
      '/connections/:id/introspect',
      {
        preHandler: app.rbac.require(CONNECTIONS_MANAGE),
        schema: {
          params: connectionIdParams,
          response: { 200: introspectSyncReply, 202: jobAcceptedReply },
        },
      },
      async (request, reply) => {
        const connection = await manager.mustFind(request.params.id);
        const actorId =
          request.apiKeyPrincipal === null
            ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null)
            : null;

        // Async path (§2.4): enqueue when the jobs worker is wired.
        if (app.hasDecorator('jobs') && app.jobs.registry.has(INTROSPECT_JOB_KIND)) {
          const job = await app.jobs.enqueue({
            kind: INTROSPECT_JOB_KIND,
            // `userId` is the jobs owner convention (routes/jobs jobOwnerId) —
            // without it the enqueuing non-super-admin could not poll their
            // own job. `createdBy` is what the snapshot row records.
            payload: { connectionId: connection.id, createdBy: actorId, userId: actorId },
            dedupeKey: `introspect:${connection.id}`,
          });
          await app.rbac.audit(request, {
            category: 'schema',
            action: 'schema.introspect.enqueue',
            connectionId: connection.id,
            changes: { after: { jobId: job.id } },
          });
          return reply.status(202).send({ jobId: job.id });
        }

        // Synchronous fallback with the 05 §10 duration budget.
        const result = await runIntrospection({
          manager,
          meta,
          connectionId: connection.id,
          createdBy: actorId,
        });
        await app.rbac.audit(request, {
          category: 'schema',
          action: 'schema.introspect',
          connectionId: connection.id,
          changes: {
            after: {
              snapshotId: result.snapshot.id,
              noop: result.noop,
              proposedMasks: result.proposedMasks,
            },
          },
        });
        return reply.status(200).send({
          snapshotId: result.snapshot.id,
          noop: result.noop,
          proposedMasks: result.proposedMasks,
          checksum: result.snapshot.checksum,
        });
      },
    );
  };
}
