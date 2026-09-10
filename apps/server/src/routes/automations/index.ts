// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Automation rules (`/api/v1/automations`, 42-automations-and-workflow-
 * logs.md §3.1, 42-T14). Every route is behind
 * `system:automations:manage` — one key this wave, gating reads and writes
 * alike (D1).
 *
 * --- The save is where authority is checked (D2) --------------------------
 *
 * A run executes as the SYSTEM principal: it writes records without a
 * per-table grant check, because there is no user standing behind it. What
 * keeps that honest is this route. Every save re-resolves, FOR THE SAVING
 * USER, `read` on the trigger table, `create` on every table a Create-record
 * step names and `update` on the record table for an Update-field step, and
 * refuses with a 403 that names the table. A rule can never make its author
 * more powerful than they were when they saved it.
 *
 * (Re-validating on a later role change is a residual, §10. Today, revoking
 * somebody's table access does not disarm the rules they already wrote —
 * which is why the key is seeded to super-admin only.)
 *
 * --- Enabling is a second, softer gate (D12) ------------------------------
 *
 * A half-built rule saves fine; it just cannot be switched on. `POST` with
 * "Enable immediately" stores it PAUSED and says so in the reply, and
 * `PATCH { enabled: true }` on an unfinished rule is a 422 naming the first
 * unfinished step — which is what the card's toggle snapping back and the
 * toast are built on.
 */

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  automationRunsRepo,
  automationsRepo,
  emailTemplatesRepo,
  pagesRepo,
  rolesRepo,
  type Automation,
  type EnqueueJobInput,
  type Job,
  type MetaDb,
} from '@adminium/meta';

import { audited, auditExempt } from '../../audit/coverage.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { AppError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { addressableTables, childTablesFor } from '../../connections/child-tables.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import type { ResolvedTable } from '../../crud/identifiers.js';
import { pkLabel } from '../../crud/records.js';
import type { Row } from '../../crud/mask.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { nextTickFor } from '../../automations/schedule.js';
import { walkRule, type RunnerDeps } from '../../automations/runner.js';
import { firstIncompleteNode, requiredGrants, resolveRule } from '../../automations/validate.js';
import { watchColumnFor } from '../../automations/watch-columns.js';
import { isDateColumn } from '../../automations/relative-time.js';
import {
  automationCreateBody,
  automationDeleteReply,
  automationIdParams,
  automationPatchBody,
  automationSourcesReply,
  automationStatsQuery,
  automationStatsReply,
  automationTestBody,
  automationTestReply,
  automationsListQuery,
  automationsListReply,
  ruleViewSchema,
  type RuleView,
} from './schema.js';
import { dayBoundsFor, DAY_MS } from './time.js';

export interface AutomationsRoutesDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  secret: string;
  enqueue(input: EnqueueJobInput): Promise<Job>;
  /** Rebuild the matcher's index after every rule write (§3.3). */
  onRulesChanged?: (() => Promise<void> | void) | undefined;
  now?: (() => number) | undefined;
  blockLoopback?: boolean | undefined;
  /** Test seam for the dry run's transport and outbound HTTP. */
  runner?: Partial<RunnerDeps> | undefined;
}

const THIRTY_DAYS = 30 * DAY_MS;
const SEVEN_DAYS = 7 * DAY_MS;

export function automationsRoutes(deps: AutomationsRoutesDeps): FastifyPluginAsyncZod {
  const { meta, manager } = deps;
  const now = deps.now ?? Date.now;
  const rules = automationsRepo(meta);
  const runs = automationRunsRepo(meta);

  /** Live template keys — an archived one may not be named by a step (39 D4). */
  async function liveTemplateKeys(): Promise<Set<string>> {
    const rows = await emailTemplatesRepo(meta).list({ kind: 'template', archived: false });
    return new Set(rows.filter((row) => row.enabled).map((row) => row.key));
  }

  async function viewFor(connectionId: string | null) {
    if (connectionId === null) return null;
    try {
      return await loadSnapshotView(meta, connectionId);
    } catch {
      throw new ValidationFailedError('That connection has no schema snapshot yet.', {
        connectionId,
      });
    }
  }

  async function toView(rule: Automation, stats: Map<string, { runs: number; succeeded: number; failed: number }>): Promise<RuleView> {
    const incomplete = firstIncompleteNode(rule.graph);
    const period = stats.get(rule.id) ?? { runs: 0, succeeded: 0, failed: 0 };
    const finished = period.succeeded + period.failed;
    return ruleViewSchema.parse({
      id: rule.id,
      connectionId: rule.connectionId,
      name: rule.name,
      description: rule.description,
      enabled: rule.enabled,
      trigger: rule.trigger,
      graph: rule.graph,
      timeSavedMinutes: rule.timeSavedMinutes,
      nextRunAt: rule.nextRunAt,
      valid: incomplete === null,
      incompleteNodeId: incomplete?.id ?? null,
      stats: {
        runs30d: period.runs,
        successRate30d: finished === 0 ? null : period.succeeded / finished,
        lastRunAt: rule.lastRunAt,
      },
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    });
  }

  /** D2 — the SAVING USER must already hold every grant the rule will use. */
  async function assertAuthorGrants(
    request: FastifyRequest,
    rule: { trigger: Automation['trigger']; graph: Automation['graph']; connectionId: string | null },
  ): Promise<void> {
    for (const { permission, table } of requiredGrants(rule.trigger, rule.graph, rule.connectionId)) {
      if (await request.can(permission)) continue;
      throw new ForbiddenError(
        `You do not have access to ${table}, so this rule cannot use it.`,
        'TABLE_FORBIDDEN',
        { permission, table },
      );
    }
  }

  async function validateOrThrow(input: {
    trigger: Automation['trigger'];
    graph: Automation['graph'];
    connectionId: string | null;
  }): Promise<void> {
    resolveRule(input.trigger, input.graph, {
      view: await viewFor(input.connectionId),
      templateKeys: await liveTemplateKeys(),
      blockLoopback: deps.blockLoopback ?? process.env['NODE_ENV'] === 'production',
    });
  }

  /** A schedule rule's first tick; record rules park at null. */
  function firstTick(trigger: Automation['trigger'], at: number): number | null {
    return trigger.kind === 'schedule' ? nextTickFor(trigger.schedule, at) : null;
  }

  async function changed(): Promise<void> {
    await deps.onRulesChanged?.();
  }

  return async (app) => {
    const guard = app.rbac.require(PERMISSIONS.automationsManage);

    app.get(
      '/automations',
      {
        preHandler: guard,
        config: { audit: auditExempt('read-only rule list') },
        schema: { querystring: automationsListQuery, response: { 200: automationsListReply } },
      },
      async (request) => {
        const rows = await rules.list(
          request.query.connectionId === undefined ? {} : { connectionId: request.query.connectionId },
        );
        const stats = await runs.perRule(now() - THIRTY_DAYS);
        return { rules: await Promise.all(rows.map((row) => toView(row, stats))) };
      },
    );

    // --- static segments, registered before the `:id` matcher ---------------

    app.get(
      '/automations/sources',
      {
        preHandler: guard,
        config: { audit: auditExempt('read-only source catalogue') },
        schema: { response: { 200: automationSourcesReply } },
      },
      async (request) => {
        const connections = await manager.connections.list();
        const out: (typeof automationSourcesReply)['_output']['connections'] = [];
        for (const connection of connections) {
          let view;
          try {
            view = await loadSnapshotView(meta, connection.id);
          } catch {
            // Never introspected: it has no tables to offer, and saying so by
            // omission is better than an empty card with a spinner.
            continue;
          }
          const pages = await pagesRepo(meta).listForConnection(connection.id);
          // Resolved before the loop: every table's child edges are checked
          // against the same set (`child-tables.ts` says why).
          const offered = addressableTables(view.model);
          const tables = [];
          for (const table of view.model.tables) {
            const resolved = view.table(`${table.schema}.${table.name}`);
            if (resolved.table.system === true) continue;
            const permission = (action: string): string =>
              `table:${connection.id}:${resolved.id}:${action}`;
            const page = pages.find((row) => sourceTableOf(row) === resolved.id);
            tables.push({
              id: resolved.id,
              label: resolved.table.label ?? resolved.name,
              canRead: await request.can(permission('read')),
              canCreate: await request.can(permission('create')),
              canUpdate: await request.can(permission('update')),
              watch: {
                created: watchColumnFor(resolved, 'created')?.column ?? null,
                updated: watchColumnFor(resolved, 'updated')?.column ?? null,
              },
              columns: [...resolved.columns.values()].map((column) => ({
                name: column.name,
                label:
                  resolved.table.columns.find((c) => c.name === column.name)?.label ?? column.name,
                logicalType: column.logicalType,
                isPk: column.isPrimaryKey,
                pii: column.masked || column.secret,
                emailLike:
                  resolved.table.columns.find((c) => c.name === column.name)?.semantics?.flags
                    .pii === 'email',
                dateLike: isDateColumn(column),
              })),
              // 34 §3.7 step 3's picker seed — only edges a mapping can store.
              children: childTablesFor(view.model, resolved.id, offered),
              pageSlug: page?.slug ?? null,
            });
          }
          out.push({
            id: connection.id,
            name: connection.name,
            dialect: connection.engine,
            timezone: connection.timezone ?? 'UTC',
            tables,
          });
        }
        const templates = await emailTemplatesRepo(meta).list({ kind: 'template', archived: false });
        const roles = await rolesRepo(meta).list();
        return {
          connections: out,
          templates: templates
            .filter((row) => row.enabled && row.locale === 'en_US')
            .map((row) => ({ key: row.key, name: row.name })),
          roles: roles.map((role) => ({ id: role.id, name: role.name })),
        };
      },
    );

    app.get(
      '/automations/stats',
      {
        preHandler: guard,
        config: { audit: auditExempt('read-only KPI strip') },
        schema: { querystring: automationStatsQuery, response: { 200: automationStatsReply } },
      },
      async (request) => {
        const at = now();
        const { todayStart, yesterdayStart } = dayBoundsFor(at, request.query.tz);
        const all = await rules.list();
        const [today, yesterday] = await Promise.all([
          runs.stats(todayStart, at),
          runs.stats(yesterdayStart, todayStart),
        ]);
        const rate = (period: { succeeded: number; failed: number }): number | null => {
          const finished = period.succeeded + period.failed;
          return finished === 0 ? null : period.succeeded / finished;
        };
        // "Time saved" is runs × the rule's own minutes (F6), which is why it
        // is computed here rather than stored: the number an operator typed
        // applies to every run the rule has ever made, including past ones.
        const savedFor = async (from: number): Promise<number> => {
          const perRule = await runs.perRule(from);
          let total = 0;
          for (const rule of all) {
            if (rule.timeSavedMinutes === null) continue;
            total += (perRule.get(rule.id)?.succeeded ?? 0) * rule.timeSavedMinutes;
          }
          return total;
        };
        return {
          activeRules: all.filter((rule) => rule.enabled).length,
          rulesCreated7d: all.filter((rule) => rule.createdAt >= at - SEVEN_DAYS).length,
          runsToday: today.runs,
          runsYesterday: yesterday.runs,
          successToday: rate(today),
          successYesterday: rate(yesterday),
          timeSavedMinutes30d: await savedFor(at - THIRTY_DAYS),
          timeSavedMinutesPrev30d: 0,
        };
      },
    );

    // --- one rule ------------------------------------------------------------

    app.get(
      '/automations/:id',
      {
        preHandler: guard,
        config: { audit: auditExempt('read-only rule detail') },
        schema: { params: automationIdParams, response: { 200: ruleViewSchema } },
      },
      async (request) => {
        const rule = await rules.findById(request.params.id);
        if (rule === null) throw new NotFoundError('No such rule.', { id: request.params.id });
        return toView(rule, await runs.perRule(now() - THIRTY_DAYS));
      },
    );

    app.post(
      '/automations',
      {
        preHandler: guard,
        config: { audit: audited('rbac') },
        schema: { body: automationCreateBody, response: { 201: ruleViewSchema } },
      },
      async (request, reply) => {
        const body = request.body;
        await validateOrThrow(body);
        await assertAuthorGrants(request, body);
        const at = now();
        // D12 — "Enable immediately" is honoured only when the rule is
        // complete; a rule whose action still needs a template is stored
        // paused, and the modal's success copy tells the truth.
        const complete = firstIncompleteNode(body.graph) === null;
        const rule = await rules.create(
          {
            connectionId: body.connectionId,
            name: body.name,
            description: body.description ?? null,
            trigger: body.trigger,
            graph: body.graph,
            enabled: body.enabled && complete,
            timeSavedMinutes: body.timeSavedMinutes ?? null,
            nextRunAt: body.enabled && complete ? firstTick(body.trigger, at) : null,
            createdBy: request.user?.id ?? null,
          },
          at,
        );
        await app.rbac.audit(request, {
          category: 'automation',
          action: 'automation.create',
          connectionId: rule.connectionId,
          changes: { after: { id: rule.id, name: rule.name, enabled: rule.enabled } },
        });
        await changed();
        return reply.status(201).send(await toView(rule, new Map()));
      },
    );

    app.patch(
      '/automations/:id',
      {
        preHandler: guard,
        config: { audit: audited('rbac') },
        schema: {
          params: automationIdParams,
          body: automationPatchBody,
          response: { 200: ruleViewSchema },
        },
      },
      async (request) => {
        const rule = await rules.findById(request.params.id);
        if (rule === null) throw new NotFoundError('No such rule.', { id: request.params.id });
        const body = request.body;
        const next = {
          trigger: body.trigger ?? rule.trigger,
          graph: body.graph ?? rule.graph,
          connectionId: rule.connectionId,
        };
        if (body.trigger !== undefined || body.graph !== undefined) {
          await validateOrThrow(next);
          await assertAuthorGrants(request, next);
        }

        const incomplete = firstIncompleteNode(next.graph);
        if (body.enabled === true && incomplete !== null) {
          throw new AppError(
            422,
            'AUTOMATION_INCOMPLETE',
            `Finish “${incomplete.title}” before switching this rule on.`,
            { nodeId: incomplete.id, nodeTitle: incomplete.title },
          );
        }

        const at = now();
        const enabled = body.enabled ?? rule.enabled;
        const updated = await rules.update(
          rule.id,
          {
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.description === undefined ? {} : { description: body.description }),
            ...(body.trigger === undefined ? {} : { trigger: body.trigger }),
            ...(body.graph === undefined ? {} : { graph: body.graph }),
            ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
            ...(body.timeSavedMinutes === undefined ? {} : { timeSavedMinutes: body.timeSavedMinutes }),
            // A rule that has just been switched on (or whose schedule
            // changed) needs a tick; one switched off parks at null so
            // `listDue` never sees it again.
            nextRunAt: enabled ? firstTick(next.trigger, at) : null,
          },
          at,
        );
        if (updated === null) throw new NotFoundError('No such rule.', { id: rule.id });
        await app.rbac.audit(request, {
          category: 'automation',
          action:
            body.enabled === undefined
              ? 'automation.update'
              : body.enabled
                ? 'automation.enable'
                : 'automation.disable',
          connectionId: updated.connectionId,
          changes: { before: { enabled: rule.enabled }, after: { id: updated.id, enabled: updated.enabled } },
        });
        await changed();
        return toView(updated, await runs.perRule(now() - THIRTY_DAYS));
      },
    );

    app.delete(
      '/automations/:id',
      {
        preHandler: guard,
        config: { audit: audited('rbac') },
        schema: { params: automationIdParams, response: { 200: automationDeleteReply } },
      },
      async (request) => {
        const rule = await rules.findById(request.params.id);
        if (rule === null) throw new NotFoundError('No such rule.', { id: request.params.id });
        // The FK cascades the runs; the history goes with the rule, which the
        // confirm modal says out loud.
        await rules.remove(rule.id);
        await app.rbac.audit(request, {
          category: 'automation',
          action: 'automation.delete',
          connectionId: rule.connectionId,
          changes: { before: { id: rule.id, name: rule.name } },
        });
        await changed();
        return { deleted: true as const };
      },
    );

    app.post(
      '/automations/:id/duplicate',
      {
        preHandler: guard,
        config: { audit: audited('rbac') },
        schema: { params: automationIdParams, response: { 201: ruleViewSchema } },
      },
      async (request, reply) => {
        const rule = await rules.findById(request.params.id);
        if (rule === null) throw new NotFoundError('No such rule.', { id: request.params.id });
        const at = now();
        const copy = await rules.create(
          {
            connectionId: rule.connectionId,
            name: `${rule.name} (copy)`.slice(0, 120),
            description: rule.description,
            trigger: rule.trigger,
            graph: rule.graph,
            // Always paused: two live rules doing the same thing is never what
            // "duplicate" meant.
            enabled: false,
            timeSavedMinutes: rule.timeSavedMinutes,
            nextRunAt: null,
            createdBy: request.user?.id ?? null,
          },
          at,
        );
        await app.rbac.audit(request, {
          category: 'automation',
          action: 'automation.duplicate',
          connectionId: copy.connectionId,
          changes: { after: { id: copy.id, from: rule.id } },
        });
        await changed();
        return reply.status(201).send(await toView(copy, new Map()));
      },
    );

    app.post(
      '/automations/:id/test',
      {
        preHandler: guard,
        config: { audit: audited('rbac') },
        schema: {
          params: automationIdParams,
          body: automationTestBody,
          response: { 200: automationTestReply },
        },
      },
      async (request) => {
        const rule = await rules.findById(request.params.id);
        if (rule === null) throw new NotFoundError('No such rule.', { id: request.params.id });
        // The ON-SCREEN document, not the stored one (D14): Test acts on what
        // the person is looking at, which is why it needs no save first.
        const trigger = request.body.trigger;
        const graph = request.body.graph;
        await validateOrThrow({ trigger, graph, connectionId: rule.connectionId });
        await assertAuthorGrants(request, { trigger, graph, connectionId: rule.connectionId });

        const at = now();
        const sample = await pickSample(trigger, rule.connectionId, request.body.sampleRecordId);
        const outcome = await walkRule(
          {
            meta,
            manager,
            secret: deps.secret,
            now,
            ...deps.runner,
            // No `app`: a dry run must not reach `afterRecordWrite` at all.
            app: undefined,
          },
          {
            rule: { ...rule, trigger, graph },
            runId: `test:${rule.id}`,
            event: {
              event: 'test',
              origin: 'test',
              ruleId: null,
              hops: 0,
              record: sample?.ref ?? null,
              snapshot: null,
              occurredAt: at,
            },
            dryRun: true,
          },
        );
        await app.rbac.audit(request, {
          category: 'automation',
          action: 'automation.test',
          connectionId: rule.connectionId,
          changes: { after: { id: rule.id, steps: outcome.trace.steps.length } },
        });
        return {
          trace: outcome.trace,
          sample:
            sample === null
              ? null
              : { table: sample.ref.table, pk: sample.ref.pk, label: sample.ref.label },
        };
      },
    );

  };

  /**
   * The record a dry run walks over: the one the caller chose, else the newest
   * row of the trigger table. An empty table has none, and the toast says so
   * rather than the Test button doing nothing (D14).
   */
  async function pickSample(
    trigger: Automation['trigger'],
    connectionId: string | null,
    chosen: string | undefined,
  ): Promise<{ ref: { connectionId: string; table: string; pk: Row; label: string } } | null> {
    const tableId =
      trigger.kind === 'record' ? trigger.table : (trigger.forEach?.table ?? null);
    if (tableId === null || connectionId === null) return null;
    const view = await loadSnapshotView(meta, connectionId);
    const table: ResolvedTable = view.table(tableId);
    const { db } = await manager.data(connectionId);

    let query = db.selectFrom(table.id).selectAll().limit(1);
    if (chosen !== undefined && table.primaryKey.length === 1) {
      query = query.where(db.dynamic.ref(table.primaryKey[0] as string), '=', chosen as never);
    } else {
      for (const column of table.primaryKey) query = query.orderBy(db.dynamic.ref(column), 'desc');
    }
    const row = (await query.executeTakeFirst()) as Row | undefined;
    if (row === undefined) {
      throw new AppError(422, 'NO_SAMPLE_RECORD', 'No record to test with — add one first.', {
        table: table.id,
      });
    }
    const pk = Object.fromEntries(table.primaryKey.map((c) => [c, row[c]]));
    return { ref: { connectionId, table: table.id, pk, label: pkLabel(table, pk) } };
  }
}

/** `config.source.table`, the same read three other modules make. */
function sourceTableOf(page: { config: unknown }): string | null {
  const source = (page.config as { source?: { table?: unknown } } | null)?.source;
  return typeof source?.table === 'string' && source.table.length > 0 ? source.table : null;
}
