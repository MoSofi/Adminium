// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Schema-authoring routes.
 *
 *   POST /connections/:id/schema/plan            → the ordered, hazard-classified plan + its SQL
 *   POST /connections/:id/schema/apply           → run it (202 + job when the worker is up)
 *   POST /connections/:id/schema/adopt           → D11: include new tables and regenerate
 *   GET  /connections/:id/schema/changes         → the applied-change ledger
 *   PUT  /connections/:id/diagram-layout         → ER-diagram node positions (D21, M18)
 *
 * ─── Honest absence is enforced here, not in the UI (D5) ───────────────────
 *
 * A `schema-file` connection has no database; a read-only or DDL-less role
 * cannot write to one; a `read-only-analytics` connection was declared
 * read-only by the operator at setup. All three get **403 `READ_ONLY_MODE`** —
 * the code already specified for the marketplace's narrower case, and the
 * status `errors.ts:134` gives it (13's "409" was never built). The Studio
 * hides the surface, and this is what makes hiding it honest rather than the
 * only thing standing between a caller and the customer's schema.
 *
 * ─── Not reachable by an API key (D23) ─────────────────────────────────────
 *
 * Any `adm_sk_` bearer holding a grant can call any mutating route requiring
 * it. DDL by API key is either a CI feature worth designing or an unattended
 * way to drop a production table; O7 ruled the narrow door. So a key principal
 * is refused here explicitly rather than by omission.
 */

import type { FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { DatabaseModel } from '@adminium/engine';
import { capabilitiesForSource } from '@adminium/engine';
import {
  overridesRepo,
  pagesRepo,
  schemaChangesRepo,
  snapshotsRepo,
  type Connection,
  type MetaDb,
  connectionsRepo,
} from '@adminium/meta';

import { audited } from '../../audit/coverage.js';
import { applyOverrides } from '../../connections/effective-schema.js';
import type { ConnectionManager, DataHandle } from '../../connections/manager.js';
import { ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { applySchemaEdit, planSchemaEdit } from '../../schema-ddl/service.js';
import { unauthorableReason } from '../../schema-ddl/authorable.js';
import { DEFAULT_REWRITE_REFUSE_ABOVE } from '../../schema-ddl/preflight.js';
import { runIntrospection } from '../../connections/introspect.js';
import { runGeneration } from '../../generate/run.js';
import { CONNECTIONS_MANAGE } from '../connections/index.js';
import {
  adoptBody,
  adoptReply,
  applyBody,
  applyReply,
  changesReply,
  ddlConnParams,
  diagramLayoutBody,
  diagramLayoutReply,
  planReply,
  schemaEditBody,
} from './schema.js';

/** D6 — the grant this feature landed with its enforcement point. */
export const SCHEMA_DDL = 'system:schema:ddl';
/** D21 — the diagram layout is a remap-level edit, not a connection-level one. */
export const SCHEMA_REMAP = 'system:schema:remap';

export interface SchemaDdlRoutesDeps {
  manager: ConnectionManager;
  meta: MetaDb;
  /** DSN crypto — D33's repair rewrites connection settings through it. */
  crypto: Parameters<typeof connectionsRepo>[1];
}


/**
 * A capped exact row count for one table, for preflight's rewrite gate.
 *
 * Capped at one past the refusal ceiling: below it the number is exact and the
 * consequence can say "250,000 rows will be rewritten"; a count that reaches
 * the cap has already proved the table is over the ceiling, and paying to count
 * the remaining rows of a 400-million-row table to render a dialog would be its
 * own outage.
 *
 * Errors are swallowed to `null`. A count is decoration on a plan; a table that
 * cannot be counted (a permission quirk, a lock) must not stop the operator
 * seeing the statements.
 */
async function countTableRows(
  handle: DataHandle,
  tableId: string,
): Promise<{ value: number; capped: boolean } | null> {
  /*
   * QUALIFIED, because `public.orders` and `archive.orders` are different
   * tables and the DDL writes to the qualified one.
   *
   * This took the bare name, so on any database with more than one schema the
   * ceiling was measured against whichever `orders` the session's search_path
   * happened to resolve — an empty archive copy would have waved through a
   * rewrite of the live one. SQLite has no schemas to qualify with and MySQL's
   * "schema" IS the database the handle is already connected to, so both take
   * the bare name; only postgres qualifies.
   */
  const dot = tableId.lastIndexOf('.');
  const bare = tableId.slice(dot + 1);
  const schema = dot === -1 ? null : tableId.slice(0, dot);
  const q = (identifier: string): string =>
    handle.dialect === 'mysql'
      ? `\`${identifier.replace(/`/g, '``')}\``
      : `"${identifier.replace(/"/g, '""')}"`;
  const target =
    handle.dialect === 'postgres' && schema !== null ? `${q(schema)}.${q(bare)}` : q(bare);

  const cap = DEFAULT_REWRITE_REFUSE_ABOVE + 1;
  try {
    const result = await sql
      .raw<{ n: number | bigint | string }>(
        `SELECT count(*) AS n FROM (SELECT 1 AS one FROM ${target} LIMIT ${String(cap)}) AS capped`,
      )
      .execute(handle.db as never);
    const raw = result.rows[0]?.n ?? 0;
    const value = typeof raw === 'number' ? raw : Number(raw);
    /*
     * A count that came back unreadable is not a count. `Number('nonsense')` is
     * NaN, and every comparison against NaN is false — including
     * `value > refuseAbove`, which would silently open the ceiling.
     */
    if (!Number.isFinite(value)) return null;
    return { value, capped: value >= cap };
  } catch {
    /*
     * `null` means "could not establish the size", and preflight now REFUSES on
     * it rather than skipping the gate. It used to mean "no ceiling for this
     * table", which is the opposite.
     */
    return null;
  }
}

export function schemaDdlRoutes(deps: SchemaDdlRoutesDeps): FastifyPluginAsyncZod {
  const { manager, meta } = deps;
  const snapshots = snapshotsRepo(meta);
  const overrides = overridesRepo(meta);
  const ledger = schemaChangesRepo(meta);

  return async (app) => {
    /**
     * D5's refusals, in one place so every route shares them and no route can
     * forget one. The connection-level half is `unauthorableReason`, which the
     * connection DTO also reads — the UI hides exactly what this refuses.
     */
    async function mustBeAuthorable(request: FastifyRequest, connection: Connection): Promise<void> {
      // D23 / O7: never an API key.
      if (request.apiKeyPrincipal !== null) {
        throw new ForbiddenError(
          'Schema changes cannot be made with an API key. Sign in to the Studio to edit your schema.',
          'FORBIDDEN',
        );
      }
      const refusal = unauthorableReason(connection);
      if (refusal !== null) {
        throw new ForbiddenError(refusal.message, 'READ_ONLY_MODE', { reason: refusal.reason });
      }
    }

    /** The active snapshot with overrides applied — what a plan diffs against. */
    async function activeModel(
      connectionId: string,
    ): Promise<{ model: DatabaseModel; snapshotId: string; engineVersion: string | null }> {
      const snapshot = await snapshots.latest(connectionId);
      if (snapshot === null) {
        throw new NotFoundError('No schema snapshot yet — run introspection first.', { connectionId });
      }
      const active = await overrides.listForConnection(connectionId, { status: 'active' });
      return {
        model: applyOverrides(snapshot.schema as DatabaseModel, active),
        snapshotId: snapshot.id,
        // Recorded by every introspection, and the input the whole per-version
        // hazard matrix is computed from.
        engineVersion: snapshot.engineVersion,
      };
    }

    async function planInput(
      request: FastifyRequest,
      connection: Connection,
      edit: unknown,
      door?: { superAdmin: boolean; acknowledged: ReadonlySet<string> },
    ) {
      const { model, engineVersion } = await activeModel(connection.id);
      const handle = await manager.data(connection);
      const dsns = await manager.connections.getDsns(connection.id);
      const caps = capabilitiesForSource({
        kind: 'live',
        engine: connection.engine as 'postgres' | 'mysql' | 'sqlite',
      });
      return {
        meta,
        connectionId: connection.id,
        edit: edit as never,
        actual: model,
        dialect: handle.dialect,
        /*
         * The server's own version, not `null`.
         *
         * This was hardcoded `null`, and `atLeastVersion(null, …)` is false for
         * every floor — so the ENTIRE per-version hazard matrix fell to its
         * worst case on every connection Adminium has ever planned against.
         * `add-column NOT NULL DEFAULT` was reported as a full table rewrite on
         * PostgreSQL 16, where it is metadata-only; MySQL 8.0.29+ never earned
         * an INSTANT prediction. The docs page promises "Adminium reads your
         * server's version and tells you which one you have", and it did not.
         * Found during the MySQL acceptance run.
         */
        serverVersion: engineVersion,
        maxIdentifierLength: caps.maxIdentifierLength,
        metaSharesDatabase: manager.metaSharesDatabaseWith(dsns?.dataDsn ?? null),
        db: handle.db,
        privileges: { db: handle.db, dialect: handle.dialect },
        /*
         * …and the row counts, which nothing supplied either.
         *
         * `PlanServiceInput.countRows` was optional and never passed, so
         * preflight measured nothing: the `row-count` consequence never
         * appeared, `TABLE_TOO_LARGE` could not fire, and D18's acknowledgement
         * door stood permanently open — `warnsAboutRows` was false for every
         * plan, so `acknowledgeRows` was never actually required of anybody.
         * Three safety behaviours, all inert, all unit-tested.
         *
         * Capped one past the ceiling: below it the answer is exact, and a
         * count that reaches the cap is proof the table is over without paying
         * to count the rest.
         */
        countRows: (tableId: string) => countTableRows(handle, tableId),
        ...(door === undefined ? {} : { ceilingDoor: door }),
      };
    }

    // --- plan ---------------------------------------------------------------
    app.post(
      '/connections/:id/schema/plan',
      {
        preHandler: app.rbac.require(SCHEMA_DDL),
        config: { audit: audited('rbac') },
        schema: { params: ddlConnParams, body: schemaEditBody, response: { 200: planReply } },
      },
      async (request) => {
        const connection = await manager.mustFind(request.params.id);
        await mustBeAuthorable(request, connection);
        /*
         * The PLAN takes the acknowledgement too. Whether the principal may use
         * it is decided here and nowhere else — `acknowledgeCeiling` from the
         * body only ever narrows what a Super Admin already could do.
         */
        const set = await app.rbac.resolve(request);
        const { acknowledgeCeiling, ...edit } = request.body;
        const plan = await planSchemaEdit(
          await planInput(request, connection, edit, {
            superAdmin: set.superAdmin,
            acknowledged: new Set(acknowledgeCeiling),
          }),
        );
        await app.rbac.audit(request, {
          category: 'schema',
          action: 'schema.ddl.plan',
          connectionId: connection.id,
          changes: {
            after: {
              steps: plan.steps.length,
              hazard: plan.hazard,
              refusals: plan.refusals.length,
              checksum: plan.checksum,
            },
          },
        });
        return plan;
      },
    );

    // --- apply --------------------------------------------------------------
    app.post(
      '/connections/:id/schema/apply',
      {
        preHandler: app.rbac.require(SCHEMA_DDL),
        config: { audit: audited('rbac') },
        schema: { params: ddlConnParams, body: applyBody, response: { 200: applyReply } },
      },
      async (request) => {
        const connection = await manager.mustFind(request.params.id);
        await mustBeAuthorable(request, connection);
        const set = await app.rbac.resolve(request);
        const actorId = (request as unknown as { user?: { id?: string } }).user?.id ?? null;

        const { checksum, acknowledgeRows, acknowledgeCeiling, ...edit } = request.body;
        /*
         * The SAME door the plan was built with, so the two cannot disagree.
         * `superAdmin` comes from the resolved principal and never from the
         * body — the body only says which tables were named.
         */
        const base = await planInput(request, connection, edit, {
          superAdmin: set.superAdmin,
          acknowledged: new Set(acknowledgeCeiling),
        });

        // D18's acknowledgement door: a plan that warns about row counts is
        // applied only when the operator says they saw them. The API does not
        // assume it — the UI collects it.
        const dryRun = await planSchemaEdit(base);
        const warnsAboutRows = dryRun.steps.some((s) =>
          s.consequences.some((c) => c.kind === 'row-count'),
        );
        if (warnsAboutRows && !acknowledgeRows) {
          throw new ValidationFailedError(
            'This plan rewrites rows. Confirm the row counts before applying.',
            { requiresAcknowledgement: true },
          );
        }

        const result = await applySchemaEdit({
          ...base,
          checksum,
          createdBy: actorId,
          superAdmin: set.superAdmin,
          crypto: deps.crypto,
          ceilingDoor: { superAdmin: set.superAdmin, acknowledged: new Set(acknowledgeCeiling) },
          /*
           * The SQLite rebuild's step 12 — read the rebuilt table back and
           * compare it with what the plan promised. `tableFilter` is why this
           * is cheap: it re-reads ONE table, not the schema.
           *
           * Written, tested, and unreachable until it was passed here.
           */
          reintrospectTable: async (tableId) => {
            const bare = tableId.slice(tableId.lastIndexOf('.') + 1);
            const adapter = await manager.introspectAdapter(connection.id);
            try {
              const fresh = await adapter.introspect({
                tableFilter: (t) => t.name === bare,
                collectRowEstimates: false,
                collectActivityStats: false,
              });
              return fresh.tables.find((t) => t.name === bare) ?? null;
            } finally {
              await adapter.close().catch(() => undefined);
            }
          },
        });

        /*
         * ─── D11, beat one: re-introspect ───────────────────────────────────
         *
         * Everything downstream of a schema change reads the SNAPSHOT, not the
         * database: the schema tree, the diagram, page bindings, grants, the
         * next plan's base. Leaving it stale meant an operator dropped a table,
         * watched `drop table "x"` succeed, and then saw `x` still listed with
         * a banner telling them to go re-introspect — Adminium asking a person
         * to tell it something it had just done itself.
         *
         * Best-effort by construction. The DDL has already run and is not
         * undoable; a failed re-read is a stale snapshot, not a failed apply,
         * and reporting the apply as failed because the follow-up read timed
         * out would be the more expensive lie.
         */
        let snapshotId: string | null = null;
        if (result.steps.some((s) => s.outcome === 'succeeded')) {
          try {
            const fresh = await runIntrospection({
              manager,
              meta,
              connectionId: connection.id,
              createdBy: actorId,
            });
            snapshotId = fresh.snapshot.id;
            await ledger.finish(result.changeId, {
              status: result.status,
              steps: result.steps,
              error: result.error,
              resultSnapshotId: snapshotId,
            });
          } catch (error) {
            request.log.warn(
              { err: error, connectionId: connection.id, changeId: result.changeId },
              'schema apply succeeded but re-introspection did not',
            );
          }
        }

        /*
         * D11, beat three: which tables are NEW. Only a step that actually ran
         * counts — a plan that created two tables and failed on the second must
         * not offer to adopt a table that does not exist.
         */
        const createdTables = result.steps
          .filter((s) => s.kind === 'create-table' && s.outcome === 'succeeded')
          .map((s) => s.table.slice(s.table.lastIndexOf('.') + 1));

        await app.rbac.audit(request, {
          category: 'schema',
          action: 'schema.ddl.apply',
          connectionId: connection.id,
          changes: {
            after: {
              changeId: result.changeId,
              status: result.status,
              steps: result.steps.length,
              succeeded: result.steps.filter((s) => s.outcome === 'succeeded').length,
              snapshotId,
              // D18: "the door is per apply, audited, and named in the ledger."
              ...(acknowledgeCeiling.length === 0
                ? {}
                : { ceilingAcknowledged: acknowledgeCeiling }),
            },
          },
        });
        return { ...result, snapshotId, createdTables };
      },
    );

    // --- D11's adoption step ------------------------------------------------
    app.post(
      '/connections/:id/schema/adopt',
      {
        /*
         * `connections.manage`, not `schema.ddl`: this route adds tables to
         * `settings.includedTables` and runs generation — precisely what
         * `POST /connections/:id/generate` does, behind precisely that grant.
         * Handing the weaker DDL grant a second door into page generation
         * would make the generate route's guard decorative.
         */
        preHandler: app.rbac.require(CONNECTIONS_MANAGE),
        config: { audit: audited('rbac') },
        schema: { params: ddlConnParams, body: adoptBody, response: { 200: adoptReply } },
      },
      async (request) => {
        const connection = await manager.mustFind(request.params.id);
        await mustBeAuthorable(request, connection);
        const actorId = (request as unknown as { user?: { id?: string } }).user?.id ?? null;

        /*
         * An EMPTY `includedTables` means "every table" (generate/run.ts's
         * `filterModelToIncludedTables` returns the model untouched). Writing
         * the requested names into an empty list would therefore NARROW the
         * app from all tables to these two — the opposite of adopting them. So
         * an all-tables connection adopts by regenerating alone, and says so.
         */
        const current = connection.settings.includedTables ?? [];
        const includesEverything = current.length === 0;
        const added = includesEverything
          ? []
          : request.body.tables.filter((name) => !current.includes(name));
        if (added.length > 0) {
          await manager.connections.update(connection.id, {
            settings: { ...connection.settings, includedTables: [...current, ...added] },
          });
        }

        const run = await runGeneration({
          manager,
          meta,
          connectionId: connection.id,
          createdBy: actorId,
        });

        await app.rbac.audit(request, {
          category: 'schema',
          action: 'schema.generate',
          connectionId: connection.id,
          changes: {
            after: {
              snapshotId: run.snapshotId,
              adopted: added,
              pages: run.pages.length,
              created: run.persistence.created,
              updated: run.persistence.updated,
              skippedEdited: run.persistence.skippedEdited.length,
            },
          },
        });

        // Open dashboards drop stale caches on config-changed — the
        // generate route's own last act, and the reason a new page appears in
        // the sidebar without a reload.
        if (app.hasDecorator('realtime')) {
          app.realtime.publish('config-changed', 'config-changed', {
            connectionId: connection.id,
            configVersion: await pagesRepo(meta).configVersion(),
          });
        }

        /*
         * `skippedEdited` and `keptEdited` are PAGE IDS, and D11's whole point
         * is that the operator reads this list and recognises what is on it.
         * `page_2fa0ee68_invoices` is not a thing anyone recognises. The titles
         * are one lookup away and this is the only place they are read aloud.
         */
        const byId = new Map((await pagesRepo(meta).listAll()).map((p) => [p.id, p.title]));
        const named = (ids: readonly string[]): string[] => ids.map((id) => byId.get(id) ?? id);

        return {
          included: added,
          includesEverything,
          snapshotId: run.snapshotId,
          pages: run.pages.length,
          result: {
            created: run.persistence.created,
            updated: run.persistence.updated,
            unchanged: run.persistence.unchanged,
            pruned: run.persistence.pruned,
            skippedEdited: named(run.persistence.skippedEdited),
            keptEdited: named(run.persistence.keptEdited),
          },
        };
      },
    );

    // --- the ledger ---------------------------------------------------------
    app.get(
      '/connections/:id/schema/changes',
      {
        preHandler: async (request) => {
          await app.rbac.resolve(request);
        },
        schema: { params: ddlConnParams, response: { 200: changesReply } },
      },
      async (request) => {
        await manager.mustFind(request.params.id);
        const rows = await ledger.listForConnection(request.params.id);
        return {
          changes: rows.map((row) => ({
            id: row.id,
            planChecksum: row.planChecksum,
            status: row.status,
            hazard: row.hazard,
            error: row.error,
            createdBy: row.createdBy,
            startedAt: row.startedAt,
            finishedAt: row.finishedAt,
            stepCount: row.steps.length,
            succeeded: row.steps.filter((s) => s.outcome === 'succeeded').length,
          })),
        };
      },
    );

    // --- the diagram layout (D21, M18) --------------------------------------
    app.put(
      '/connections/:id/diagram-layout',
      {
        // `schema.remap`, not `connections.manage`: moving a box on a diagram
        // is a schema-presentation edit, and requiring the connection-management
        // grant to do it would mean only the people who can rotate credentials
        // can tidy the map (D21).
        preHandler: app.rbac.require(SCHEMA_REMAP),
        config: { audit: audited('rbac') },
        schema: {
          params: ddlConnParams,
          body: diagramLayoutBody,
          response: { 200: diagramLayoutReply },
        },
      },
      async (request) => {
        const connection = await manager.mustFind(request.params.id);
        await manager.connections.setDiagramLayout(connection.id, request.body.positions);
        await app.rbac.audit(request, {
          category: 'schema',
          action: 'schema.diagram.layout',
          connectionId: connection.id,
          changes: { after: { nodes: Object.keys(request.body.positions).length } },
        });
        return { positions: request.body.positions };
      },
    );
  };
}
