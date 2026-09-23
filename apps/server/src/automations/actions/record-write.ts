// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CREATE RECORD and UPDATE FIELD — the owner's "create a row in the
 * beneficiaries table" and "mark it as a no-show".
 *
 * --- Through the CRUD layer, never around it ------------------------------
 *
 * The temptation is an INSERT: the runner already holds a Kysely handle. What
 * that would skip is every rule the product's own write path enforces —
 * identifier resolution against the snapshot, the system-table guard, write
 * coercion, the project's hooks, the audit row, and the fan-out that lets
 * ANOTHER rule react. So these go through the write service
 * (`crud/write-service.ts`), and end in `afterRecordWrite` with
 * `origin: 'automation'` and `hops + 1`, which is what makes the loop guard
 * able to see them at all.
 *
 * --- `{ now: true }` is a marker, not a timestamp -------------------------
 *
 * There is no single JS value that writes "now" correctly on Postgres, MySQL
 * and SQLite (the `$generate` lesson). So a value the operator marked as
 * "Now" stays a marker in the stored rule and is resolved HERE, against the
 * column it is being written to, through the same coercion the generated
 * defaults use. Everything else is a literal, with `{{record.x}}` tokens
 * substituted first (D16).
 *
 * --- A rule's writes are not undoable -------------------------------------
 *
 * By spec. Nobody holds a token for them and none is issued: an undo token
 * belongs to the person who made a change, and nobody made this one.
 */

import type { Kysely } from 'kysely';
import { type AutomationAction, type AutomationWriteValue, type RecordRef } from '@adminium/meta';

import type { SourceDatabase } from '../../connections/manager.js';
import { afterRecordWrite } from '../../crud/after-record-write.js';
import type { ResolvedTable } from '../../crud/identifiers.js';
import { maskRow, type Row } from '../../crud/mask.js';
import { pkLabel } from '../../crud/records.js';
import {
  HookFailedError,
  HookRejectedError,
  createWriteService,
  type RecordWriteService,
  type WriteContext,
  type WriteTarget,
} from '../../crud/write-service.js';
import { writeStores } from '../../crud/write-stores.js';
import { normalizeWriteValue } from '../../crud/write-values.js';
import { substitute } from '../templating.js';
import { pairsOf } from '../trace.js';
import { ActionFailure, type ActionContext, type ActionResult } from './types.js';

type CreateAction = Extract<AutomationAction, { kind: 'record.create' }>;
type UpdateAction = Extract<AutomationAction, { kind: 'record.update' }>;

/** Adminium's own tables are never a rule's target (the existing guard). */
function assertWritable(table: ResolvedTable): void {
  if (table.id.includes('adminium_')) {
    throw new ActionFailure(`${table.id} is one of Adminium's own tables and cannot be written.`);
  }
  if (table.readOnly) throw new ActionFailure(`${table.id} is read-only.`);
}

/**
 * The dialect's own "now", written the way `crud/write-values.ts` says this
 * column's values are spelled. A `timestamptz` takes a zoned instant; a naive
 * `timestamp` takes the server-local wall clock, which is what the read side
 * hands back and therefore what an echo must write.
 */
function nowValueFor(table: ResolvedTable, column: string, at: number): unknown {
  const resolved = table.columns.get(column);
  const instant = new Date(at);
  if (resolved === undefined) return instant.toISOString();
  if (resolved.logicalType === 'date') return instant.toISOString().slice(0, 10);
  return normalizeWriteValue(resolved, instant.toISOString());
}

/** Resolve the authored values against this table: tokens, `now`, coercion. */
export function resolveValues(
  values: Record<string, AutomationWriteValue>,
  table: ResolvedTable,
  ctx: ActionContext,
): Row {
  const out: Row = {};
  for (const [column, value] of Object.entries(values)) {
    const resolved = table.columns.get(column);
    if (resolved === undefined) {
      throw new ActionFailure(`${table.id} has no column ${JSON.stringify(column)}.`);
    }
    if (resolved.secret || resolved.masked) {
      // A rule may not write into a column the product hides from the person
      // who wrote the rule — they could not have seen what they were
      // overwriting (asymmetry, kept on the write side).
      throw new ActionFailure(`${column} is a protected column and cannot be written by a rule.`);
    }
    out[column] =
      typeof value === 'string'
        ? normalizeWriteValue(resolved, substitute(value, ctx.tokens))
        : nowValueFor(table, column, ctx.now);
  }
  return out;
}

/** The service a run writes through; one without hooks in unit tests of one step. */
function writesOf(ctx: ActionContext): RecordWriteService {
  return ctx.writes ?? createWriteService(writeStores(ctx.meta));
}

/** A rule's write is one hop deeper than the event that started the run. */
function writeContext(ctx: ActionContext): WriteContext {
  return {
    origin: 'automation',
    hops: ctx.hops + 1,
    actor: { kind: 'automation', id: ctx.rule.id, label: ctx.rule.name },
    request: null,
  };
}

/** A failed statement, or a hook's refusal, is this step's failure. */
function failStep(error: unknown): never {
  throw new ActionFailure(error instanceof Error ? error.message : String(error));
}

async function asStep<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof HookRejectedError || error instanceof HookFailedError) failStep(error);
    throw error;
  }
}

function sourceOf(ctx: ActionContext) {
  if (ctx.source === null) {
    throw new ActionFailure('This step needs a record, and this run has none.');
  }
  return ctx.source;
}

// --- create ----------------------------------------------------------------

function createTargetOf(action: CreateAction, ctx: ActionContext): ResolvedTable {
  const source = sourceOf(ctx);
  if (action.table === null || action.table === '') {
    throw new ActionFailure('This step has no table.');
  }
  const table = source.view.table(action.table);
  assertWritable(table);
  return table;
}

export async function runCreateAction(
  action: CreateAction,
  ctx: ActionContext,
): Promise<ActionResult> {
  const source = sourceOf(ctx);
  const table = createTargetOf(action, ctx);
  const values = resolveValues(action.values, table, ctx);
  const target: WriteTarget = { ...source, table };
  const entityOf = (inserted: Row): RecordRef => {
    const pk = Object.fromEntries(table.primaryKey.map((c) => [c, inserted[c]]));
    return { connectionId: source.connectionId, table: table.id, pk, label: pkLabel(table, pk) };
  };

  const inserted = await asStep(() =>
    writesOf(ctx).create({
      target,
      values,
      context: writeContext(ctx),
      mapError: failStep,
      announce: (row) =>
        announce(ctx, { table, action: 'create', entity: entityOf(row), before: null, after: row }),
    }),
  );
  return { log: ctx.text.createOk(entityOf(inserted).label) };
}

export function dryRunCreateAction(action: CreateAction, ctx: ActionContext): ActionResult {
  const table = createTargetOf(action, ctx);
  return { log: ctx.text.writeWould(pairsOf(resolveValues(action.values, table, ctx))) };
}

// --- update ----------------------------------------------------------------

export async function runUpdateAction(
  action: UpdateAction,
  ctx: ActionContext,
): Promise<ActionResult> {
  const source = sourceOf(ctx);
  assertWritable(source.table);
  const values = resolveValues(action.values, source.table, ctx);
  if (Object.keys(values).length === 0) throw new ActionFailure('This step sets no values.');

  const before = source.row;
  await asStep(() =>
    writesOf(ctx).update({
      target: source,
      pk: source.record.pk as Row,
      values,
      before,
      context: writeContext(ctx),
      mapError: failStep,
      announce: async (outcome) => {
        const after = outcome.after ?? before;
        // The run's own view of the record moves with the write, so a
        // condition AFTER this step sees what this step did — which is exactly
        // what C.3's `gt 1` count depends on.
        source.row = after;
        await announce(ctx, {
          table: source.table,
          action: 'update',
          entity: source.record,
          before,
          after,
        });
      },
    }),
  );
  return { log: ctx.text.updateOk(pairsOf(maskRow(values, source.table, false))) };
}

export function dryRunUpdateAction(action: UpdateAction, ctx: ActionContext): ActionResult {
  const source = sourceOf(ctx);
  assertWritable(source.table);
  const values = resolveValues(action.values, source.table, ctx);
  return { log: ctx.text.writeWould(pairsOf(maskRow(values, source.table, false))) };
}

// --- the fan-out -----------------------------------------------------------

async function announce(
  ctx: ActionContext,
  input: {
    table: ResolvedTable;
    action: 'create' | 'update';
    entity: RecordRef;
    before: Row | null;
    after: Row | null;
  },
): Promise<void> {
  if (ctx.app === undefined || ctx.source === null) return;
  await afterRecordWrite(ctx.app, {
    request: null,
    actor: { id: ctx.rule.id, label: ctx.rule.name },
    auditCategory: 'automation',
    meta: ctx.meta,
    connectionId: ctx.source.connectionId,
    table: input.table,
    action: input.action,
    entity: input.entity,
    before: input.before,
    after: input.after,
    origin: 'automation',
    ruleId: ctx.rule.id,
    // One deeper than the event that started this run — the loop guard's
    // whole arithmetic.
    hops: ctx.hops + 1,
    occurredAt: ctx.now,
  });
}

/** Kysely handle type, re-exported so the runner can build an `ActionSource`. */
export type SourceDb = Kysely<SourceDatabase>;
