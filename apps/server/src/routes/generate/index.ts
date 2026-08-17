// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Generation route (M4-T08 — "the zero manual config default"):
 *
 *   POST /api/v1/connections/:id/generate
 *
 * Loads the latest classified snapshot (running introspection first when the
 * connection has none), computes the v1 page set (`page-crud` per included
 * table + one `page-dashboard` per FK-cluster domain), persists it
 * idempotently to `adminium_pages`, audits the run, and publishes a
 * `config-changed` realtime event so open dashboards re-bootstrap
 * (09-generated-app.md §2.1 step 5).
 *
 * Guarded by `system:connections:manage` like the sibling connection routes.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { pagesRepo, type MetaDb } from '@adminium/meta';

import type { ConnectionManager } from '../../connections/manager.js';
import { runGeneration } from '../../generate/run.js';
import { CONNECTIONS_MANAGE } from '../connections/index.js';
import { generateBody, generateParams, generateReply } from './schema.js';

export interface GenerateRoutesDeps {
  manager: ConnectionManager;
  meta: MetaDb;
}

export function generateRoutes(deps: GenerateRoutesDeps): FastifyPluginAsyncZod {
  const { manager, meta } = deps;

  return async (app) => {
    app.post(
      '/connections/:id/generate',
      {
        preHandler: app.rbac.require(CONNECTIONS_MANAGE),
        schema: {
          params: generateParams,
          body: generateBody,
          response: { 200: generateReply },
        },
      },
      async (request) => {
        const connection = await manager.mustFind(request.params.id);
        const actorId =
          request.apiKeyPrincipal === null
            ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null)
            : null;

        const run = await runGeneration({
          manager,
          meta,
          connectionId: connection.id,
          createdBy: actorId,
          intent: request.body?.intent,
        });

        await app.rbac.audit(request, {
          category: 'schema',
          action: 'schema.generate',
          connectionId: connection.id,
          changes: {
            after: {
              snapshotId: run.snapshotId,
              intent: run.intent,
              pages: run.pages.length,
              created: run.persistence.created,
              updated: run.persistence.updated,
              unchanged: run.persistence.unchanged,
              pruned: run.persistence.pruned,
              skippedEdited: run.persistence.skippedEdited.length,
              keptEdited: run.persistence.keptEdited.length,
            },
          },
        });

        // Open dashboards drop stale caches on config-changed (09 §2.1).
        if (app.hasDecorator('realtime')) {
          app.realtime.publish('config-changed', 'config-changed', {
            connectionId: connection.id,
            configVersion: await pagesRepo(meta).configVersion(),
          });
        }

        return {
          pages: run.pages.length,
          navGroups: run.navGroups,
          snapshotId: run.snapshotId,
          introspected: run.introspected,
          intent: run.intent,
          result: run.persistence,
          llmPagesMaterialized: run.llmPagesMaterialized,
          warnings: run.warnings,
          durationMs: run.durationMs,
        };
      },
    );
  };
}
