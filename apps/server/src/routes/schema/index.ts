// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Schema routes:
 *
 * - `GET /connections/:id/schema` — active snapshot with overrides APPLIED
 *   (`?raw=true` returns the untouched introspection result),
 * - `GET /connections/:id/schema/snapshots[/:snapshotId]` — history,
 * - `GET /connections/:id/schema/diff` — previous vs latest (or `from`/`to`),
 * - `GET/PUT /connections/:id/schema/overrides` (+ the
 * `/connections/:id/overrides` alias) — validated against the active
 * snapshot; unknown identifiers → 422.
 *
 * Reads require an authenticated principal (the v1 closed grant set has no
 * `schema.read`); override writes require `system:schema:remap`.
 */

import { isDeepStrictEqual } from 'node:util';

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { diffModels, type DatabaseModel } from '@adminium/engine';
import { rulesReading } from '@adminium/manifest';

import {
  MetaValidationError,
  optionListsRepo,
  overridesRepo,
  snapshotsRepo,
  validateOverrideInput,
  type MetaDb,
  type SchemaOverride,
  type SchemaSnapshot,
} from '@adminium/meta';

import { ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { outboxWrittenColumns } from '../../outbox/moves.js';
import { shareCodesOn } from '../../public-api/share-codes.js';
import { bookingRuleIssue, capacityRuleIssue, columnRuleIssue, keptColumnIssue, statesRuleIssue } from '../../connections/column-rules-validation.js';
import { applyOverrides, columnPolicyFor } from '../../connections/effective-schema.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { unauthorableReason } from '../../schema-ddl/authorable.js';
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

    async function schemaPayload(
      connectionId: string,
      snapshot: SchemaSnapshot,
      raw: boolean,
      locale?: string | undefined,
    ) {
      // `mustLatest` already loaded the connection, but only to prove
      // it exists; the authorability answer needs the row itself.
      const connection = await manager.mustFind(connectionId);
      const refusal = unauthorableReason(connection);
      const schemaAuthoring = { authorable: refusal === null, reason: refusal?.reason ?? null };
      if (raw) {
        return {
          connectionId,
          snapshotId: snapshot.id,
          checksum: snapshot.checksum,
          createdAt: snapshot.createdAt,
          source: snapshot.source,
          model: snapshot.schema,
          appliedOverrides: 0,
          schemaAuthoring,
        };
      }
      const active = await overrides.listForConnection(connectionId, { status: 'active' });
      return {
        connectionId,
        snapshotId: snapshot.id,
        checksum: snapshot.checksum,
        createdAt: snapshot.createdAt,
        source: snapshot.source,
        model: applyOverrides(snapshot.schema as DatabaseModel, active, {
          ...(locale === undefined ? {} : { defaultLocale: locale }),
        }),
        appliedOverrides: active.length,
        schemaAuthoring,
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
        return schemaPayload(request.params.id, snapshot, request.query.raw === true, request.query.locale);
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
        return schemaPayload(request.params.id, snapshot, request.query.raw === true, request.query.locale);
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
      /*
       * The workspace's option lists, read ONCE for the whole document: a rule
       * may name a list that exists, and whether it does is a question about
       * the store rather than about the snapshot.
       */
      const storedLists = await optionListsRepo(meta).list();
      const knownLists = new Set(storedLists.map((list) => list.key));
      const listValues = new Map(storedLists.map((list) => [list.key, list.items.map((item) => item.value)]));

      // Validate every op against the vocabulary AND the active snapshot
      // (unknown identifiers → 422) before any write. The four column RULES
      // are checked against the column they name as well: a rule the
      // engine cannot keep is worse than no rule, because the form would
      // promise it.
      // One kind of booking guard per table: a limit per slot, or no overlap
      // per person — never both, which would ask one write two questions.
      const guarded = (op: string) =>
        new Set(body.overrides.filter((o) => o.op === op && o.status !== 'disabled').map((o) => o.tableName));
      const capacityTables = guarded('table.capacity');
      for (const tableName of guarded('table.booking')) {
        if (capacityTables.has(tableName)) {
          throw new ValidationFailedError('A table has a capacity or a booking rule, not both.', { table: tableName });
        }
      }
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
        if (
          item.op === 'column.default' ||
          item.op === 'column.options' ||
          item.op === 'column.required' ||
          item.op === 'column.requiredWhen' ||
          item.op === 'column.validation' ||
          item.op === 'column.copy' ||
          item.op === 'column.sequence' ||
          item.op === 'column.code' ||
          item.op === 'column.rollup' ||
          item.op === 'column.venueLocal' ||
          item.op === 'column.stamp' ||
          item.op === 'column.format' ||
          item.op === 'column.formula' ||
          item.op === 'column.scale' ||
          item.op === 'column.normalize' ||
          item.op === 'column.bounds'
        ) {
          const column = table.columns.find((c) => c.name === item.columnName);
          // `columnName` was proved above; this is for the type checker.
          if (column !== undefined) {
            // The rules saved beside it on the same table, which some rules are judged against.
            const related = {
              rules: body.overrides
                .filter((other) => other !== item && other.tableName === item.tableName && other.status !== 'disabled')
                .map((other) => ({ op: other.op, columnName: other.columnName ?? null, value: other.value })),
              lists: listValues,
            };
            const issue = columnRuleIssue(item.op, item.value, column, model, knownLists, related);
            if (issue !== null) {
              throw new ValidationFailedError(issue, {
                table: item.tableName,
                column: item.columnName,
                op: item.op,
              });
            }
          }
        }
        if (item.op === 'table.capacity') {
          const issue = capacityRuleIssue(item.value, table, model);
          if (issue !== null) throw new ValidationFailedError(issue, { table: item.tableName, op: item.op });
        }
        if (item.op === 'table.booking') {
          const issue = bookingRuleIssue(item.value, table, model);
          if (issue !== null) throw new ValidationFailedError(issue, { table: item.tableName, op: item.op });
        }
        if (item.op === 'table.states') {
          const issue = statesRuleIssue(item.value, table, model);
          if (issue !== null) throw new ValidationFailedError(issue, { table: item.tableName, op: item.op });
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

      /*
       * THE OUTBOX'S OWN COLUMNS take no rule that decides or refuses what
       * Adminium writes there — the manifest check an app is held to. A rule
       * already there is not newly refused: only one this save brings in.
       */
      const written = await outboxWrittenColumns(meta, connectionId);
      for (const item of body.overrides) {
        if (item.status === 'disabled' || item.columnName == null) continue;
        const column = written.get(`${item.tableName}\u0000${item.columnName}`);
        if (column === undefined || !column.ops.has(item.op)) continue;
        const kept = before.some(
          (row) => row.status === 'active' && row.op === item.op && row.tableName === item.tableName && row.columnName === item.columnName && isDeepStrictEqual(row.value, item.value),
        );
        if (kept) continue;
        throw new ValidationFailedError(`"${item.columnName}" is the outbox's ${column.name}, which Adminium writes, so it takes no such rule.`, {
          table: item.tableName,
          column: item.columnName,
          op: item.op,
        });
      }
      // Nor a rule of another column that reads one where the read can refuse Adminium's own write.
      for (const item of body.overrides) {
        if (item.status === 'disabled' || item.columnName == null) continue;
        const shaped = item.op === 'column.requiredWhen' ? { requiredWhen: item.value } : item.op === 'column.copy' ? { copy: item.value } : item.op === 'column.bounds' || item.op === 'column.formula' ? item.value : undefined;
        for (const { rule, reads } of rulesReading(shaped)) {
          const column = written.get(`${item.tableName}\u0000${reads}`);
          if (column === undefined || reads === item.columnName) continue;
          const kept = before.some(
            (row) => row.status === 'active' && row.op === item.op && row.tableName === item.tableName && row.columnName === item.columnName && isDeepStrictEqual(row.value, item.value),
          );
          if (kept) continue;
          throw new ValidationFailedError(
            `"${item.columnName}" has a ${rule} rule that reads "${reads}", the outbox's ${column.name}, which Adminium writes as it sends, so its own writes would be refused.`,
            { table: item.tableName, column: item.columnName, op: item.op },
          );
        }
      }

      /*
       * The same guard for a secret. A column is shown once `column.secret`
       * says it is none (`effective-schema.ts`, `settleSecrets`; a `code`
       * rule by itself shows nothing): that shows a value no reader saw
       * before, so a save that makes any column stop being a secret requires
       * Super Admin. Judged on the whole model before and after, so a
       * `secret: false` an app installed and this save keeps opens nothing
       * new.
       */
      const secretsUnder = (rows: readonly SchemaOverride[]): Set<string> => {
        const out = new Set<string>();
        for (const table of applyOverrides(model, rows).tables) {
          for (const name of columnPolicyFor(table).secret) out.add(`${table.id}\u0000${name}`);
        }
        return out;
      };
      // Each row with the origin the save keeps for it (below): whose word it is decides a secret.
      const origins = new Map<string, SchemaOverride['origin'][]>();
      for (const row of before) {
        const key = `${row.op}|${row.tableName}|${row.columnName ?? ''}`;
        origins.set(key, [...(origins.get(key) ?? []), row.origin]);
      }
      const proposed = body.overrides.map(
        (item) =>
          ({
            ...item,
            columnName: item.columnName ?? null,
            status: item.status ?? 'active',
            origin: origins.get(`${item.op}|${item.tableName}|${item.columnName ?? ''}`)?.shift() ?? 'user',
          }) as unknown as SchemaOverride,
      );
      /*
       * A rule that lands a column kept from readers (a secret, personal data,
       * a shared link's code) in one that is not — a copy, a stamp's copy, a
       * formula — shows it past every guard above. Refused when the save
       * brings it, or when the save makes its source kept while it lands it
       * in the open; one that was already so is left for its owner to fix.
       */
      const afterSave = applyOverrides(model, proposed);
      const beforeSave = applyOverrides(model, before);
      const codes = await shareCodesOn(meta, connectionId);
      for (const item of proposed) {
        if (item.status === 'disabled' || item.columnName === null) continue;
        if (item.op !== 'column.copy' && item.op !== 'column.stamp' && item.op !== 'column.formula') continue;
        const at = { table: item.tableName, column: item.columnName };
        const issue = keptColumnIssue(item.op, item.value, at, afterSave, codes);
        if (issue === null) continue;
        const kept = before.some(
          (row) => row.status === 'active' && row.op === item.op && row.tableName === item.tableName && row.columnName === item.columnName && isDeepStrictEqual(row.value, item.value),
        );
        if (kept && keptColumnIssue(item.op, item.value, at, beforeSave, codes) !== null) continue;
        throw new ValidationFailedError(issue, { table: item.tableName, column: item.columnName, op: item.op });
      }
      const stillSecret = secretsUnder(proposed);
      if ([...secretsUnder(before)].some((key) => !stillSecret.has(key)) && !(await app.rbac.resolve(request)).superAdmin) {
        throw new ForbiddenError('Showing a column that is kept secret requires Super Admin.');
      }
      /*
       * WHERE EACH RULE CAME FROM SURVIVES A SAVE.
       *
       * This is a full replace: every row is deleted and the body re-inserted.
       * The body's `origin` was accepted and then dropped, so saving any rule
       * rewrote every LLM proposal, every auto rule and every rule an app wrote
       * into the operator's own — and an app's uninstall could no longer tell
       * its rules from the operator's. The origin (and the run that proposed
       * it) is kept from the STORED row the item matches, by op, table and
       * column. It is never taken from the client: a client-sent `app` would
       * let anyone with this permission mark a rule for an app's uninstall to
       * delete. A rule with no stored twin is the operator's.
       */
      const provenance = new Map<string, { origin: SchemaOverride['origin']; llmRunId: string | null }[]>();
      for (const row of before) {
        const key = `${row.op}|${row.tableName}|${row.columnName ?? ''}`;
        const queue = provenance.get(key) ?? [];
        queue.push({ origin: row.origin, llmRunId: row.llmRunId });
        provenance.set(key, queue);
      }
      const rows = await overrides.replaceForConnection(
        connectionId,
        body.overrides.map((item) => {
          const kept = provenance.get(`${item.op}|${item.tableName}|${item.columnName ?? ''}`)?.shift();
          return {
            op: item.op,
            tableName: item.tableName,
            columnName: item.columnName ?? null,
            value: item.value,
            ...(item.status !== undefined ? { status: item.status } : {}),
            ...(kept === undefined ? {} : { origin: kept.origin, llmRunId: kept.llmRunId }),
          };
        }),
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
