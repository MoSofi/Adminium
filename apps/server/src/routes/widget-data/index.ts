/**
 * Widget-data API (04-widget-registry.md §5.2, M4-T04 subset):
 *
 * - `POST /api/v1/widget-data/query` — one descriptor → one shaped payload;
 * - `POST /api/v1/widget-data/batch` — ≤40 `{ instanceId, descriptor }`
 *   items resolved in parallel with per-item error isolation, so a
 *   dashboard loads in one round trip and one failing widget never takes
 *   the page down (acceptance criterion #6).
 *
 * Pipeline per item: Zod validation (route schema) → snapshot identifier
 * resolution → per-table RBAC read check (403 TABLE_FORBIDDEN + audit on
 * denial) → PII column refusal (403 COLUMN_FORBIDDEN, in the compiler) →
 * dynamic-Kysely execution on the data connection → §3 envelope shaping →
 * 30 s in-memory cache keyed on descriptor+params+connection+role scope.
 */

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { overridesRepo, snapshotsRepo, type MetaDb } from '@adminium/meta';
import type { DatabaseModel } from '@adminium/engine';
import type { QueryDescriptor } from '@adminium/engine/config';

import { AppError, ForbiddenError, NotFoundError } from '../../errors.js';
import { applyOverrides } from '../../connections/effective-schema.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { SnapshotView } from '../../crud/identifiers.js';
import { canReadPii } from '../../crud/mask.js';
import type { Row } from '../../crud/mask.js';
import { WidgetDataCache, cacheKeyOf } from '../../widget-data/cache.js';
import { compileWidgetQuery, resolveSource } from '../../widget-data/compiler.js';
import { shapeRows, toNumber, type ShapedPayload } from '../../widget-data/shapers.js';
import { widgetBatchBody, widgetBatchReply, widgetQueryBody, widgetQueryReply } from './schema.js';

export interface WidgetDataRoutesDeps {
  manager: ConnectionManager;
  meta: MetaDb;
  /** Injectable for TTL tests; a fresh 30 s cache otherwise. */
  cache?: WidgetDataCache | undefined;
  /** Injectable clock for `window` bounds (tests). */
  now?: (() => Date) | undefined;
}

interface QueryOutcome {
  result: ShapedPayload;
  cached: boolean;
}

export function widgetDataRoutes(deps: WidgetDataRoutesDeps): FastifyPluginAsyncZod {
  const { manager, meta } = deps;
  const cache = deps.cache ?? new WidgetDataCache();
  const snapshots = snapshotsRepo(meta);
  const overrides = overridesRepo(meta);
  const viewCache = new Map<string, { stamp: string; view: SnapshotView }>();

  // Same snapshot-view resolution as routes/data — stamped on snapshot id +
  // active-override set so remaps/masks invalidate immediately.
  async function viewFor(connectionId: string): Promise<SnapshotView> {
    const snapshot = await snapshots.latest(connectionId);
    if (snapshot === null) {
      throw new NotFoundError('No schema snapshot — introspect the connection first.', {
        connectionId,
      });
    }
    const active = await overrides.listForConnection(connectionId, { status: 'active' });
    const last = active.at(-1);
    const stamp = `${snapshot.id}:${String(active.length)}:${last?.id ?? ''}:${String(last?.updatedAt ?? 0)}`;
    const cached = viewCache.get(connectionId);
    if (cached !== undefined && cached.stamp === stamp) return cached.view;
    const view = new SnapshotView(connectionId, applyOverrides(snapshot.schema as DatabaseModel, active));
    viewCache.set(connectionId, { stamp, view });
    return view;
  }

  return async (app) => {
    async function runDescriptor(
      request: FastifyRequest,
      descriptor: QueryDescriptor,
      params: Record<string, unknown> | undefined,
    ): Promise<QueryOutcome> {
      const connectionId = descriptor.connectionId;
      await manager.mustFind(connectionId);
      const view = await viewFor(connectionId);

      // Identifier resolution FIRST, then RBAC on the resolved name (08 §5.2).
      const table = resolveSource(view, descriptor);
      const permission = `table:${connectionId}:${table.id}:read`;
      if (!(await request.can(permission))) {
        await app.rbac.audit(request, {
          category: 'rbac',
          action: 'permission.denied',
          connectionId,
          changes: { after: { permission, method: request.method, url: request.url } },
        });
        throw new ForbiddenError('You do not have access to this table.', 'TABLE_FORBIDDEN', {
          permission,
        });
      }

      const unmasked = await canReadPii(request);
      const resolution = await app.rbac.resolve(request);
      const roleScope = `${[...resolution.roleIds].sort().join(',')}${resolution.superAdmin ? '+sa' : ''}:${unmasked ? 'pii' : 'masked'}`;
      const key = cacheKeyOf({ descriptor, params: params ?? null, connectionId, roleScope });
      const hit = cache.get(key);
      if (hit !== undefined) return { result: hit as ShapedPayload, cached: true };

      const { db, dialect } = await manager.data(connectionId);
      const compiled = compileWidgetQuery({
        db,
        view,
        descriptor,
        params,
        canReadPii: unmasked,
        dialect,
        now: deps.now,
      });

      const startedAt = Date.now();
      const rows = (await compiled.query.execute()) as Row[];
      const priorRows =
        compiled.prior === null ? undefined : ((await compiled.prior.execute()) as Row[]);
      let total: number | undefined;
      if (compiled.count !== null) {
        const countRow = (await compiled.count.executeTakeFirst()) as { total?: unknown } | undefined;
        total = toNumber(countRow?.total);
      }
      const result = shapeRows({ compiled, rows, priorRows, total, canReadPii: unmasked, connectionId });

      // Execution metrics for the Studio slow-query panel (04 §5.2) — the
      // structured log line is the v1 sink.
      request.log.info(
        {
          widgetData: {
            connectionId,
            table: compiled.table.id,
            shape: compiled.shape,
            ms: Date.now() - startedAt,
            rows: rows.length,
          },
        },
        'widget-data query',
      );

      cache.set(key, result, connectionId, compiled.table.id);
      return { result, cached: false };
    }

    app.post(
      '/widget-data/query',
      { schema: { body: widgetQueryBody, response: { 200: widgetQueryReply } } },
      async (request) => {
        await app.rbac.resolve(request); // 401 without a principal
        return runDescriptor(request, request.body.descriptor, request.body.params);
      },
    );

    app.post(
      '/widget-data/batch',
      { schema: { body: widgetBatchBody, response: { 200: widgetBatchReply } } },
      async (request) => {
        await app.rbac.resolve(request); // 401 without a principal
        const { requests, params } = request.body;
        const settled = await Promise.all(
          requests.map(async (item) => {
            try {
              const outcome = await runDescriptor(request, item.descriptor, params);
              return {
                instanceId: item.instanceId,
                value: { ok: true as const, result: outcome.result, cached: outcome.cached },
              };
            } catch (error) {
              if (error instanceof AppError) {
                return {
                  instanceId: item.instanceId,
                  value: {
                    ok: false as const,
                    error: { code: error.code, message: error.message, statusCode: error.statusCode },
                  },
                };
              }
              // Never leak raw driver/SQL text to widgets (04 §4 error state).
              request.log.error({ err: error }, 'widget-data batch item failed');
              return {
                instanceId: item.instanceId,
                value: {
                  ok: false as const,
                  error: { code: 'INTERNAL', message: 'The widget query failed.', statusCode: 500 },
                },
              };
            }
          }),
        );
        const results: Record<string, (typeof settled)[number]['value']> = {};
        for (const item of settled) results[item.instanceId] = item.value;
        return { results };
      },
    );
  };
}
