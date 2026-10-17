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
 * --- A value from the settings row, a day so many days on ----------------
 *
 * `{ setting }` is what a column of the app's settings row holds when the
 * step runs, read as the rule reads the connection (`ruleSettingReader`): a
 * private table, a secret or a personal column hold nothing. A staff column
 * so filled names somebody who signs in, or is left empty and the log says
 * so: a person since suspended or removed is never handed a row. `{ daysAfter }`
 * is a day so many days after a date of the record (or after the run), on
 * the business's calendar (the connection's zone, as an outbox's due is): a
 * moment keeps its own wall time, or `at`; a date that is empty leaves the
 * value empty, and the log says so.
 *
 * --- A rule's writes are not undoable -------------------------------------
 *
 * By spec. Nobody holds a token for them and none is issued: an undo token
 * belongs to the person who made a change, and nobody made this one.
 */

import type { Kysely } from 'kysely';
import { connectionTenantConfig, usersRepo, type AutomationAction, type AutomationWriteValue, type RecordRef } from '@adminium/meta';

import type { SourceDatabase } from '../../connections/manager.js';
import { afterRecordWrite } from '../../crud/after-record-write.js';
import { slotInstant } from '../../crud/capacity-guard.js';
import type { ResolvedColumn, ResolvedTable } from '../../crud/identifiers.js';
import { venueClock, wallTimeToInstant } from '../../crud/venue-time.js';
import { addDays, dayOf, type SettingReader } from '../../outbox/timing.js';
import { ruleSettingReader } from '../setting-operands.js';
import { keptRow, type Row } from '../../crud/mask.js';
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
import { isOwnTable } from '../validate.js';
import { madeRowOf } from '../step-rows.js';
import { ActionFailure, type ActionContext, type ActionResult } from './types.js';
import { announceEffects } from '../../states/effects.js';
import { tellPostings } from '../../ledgers/announce.js';

type CreateAction = Extract<AutomationAction, { kind: 'record.create' }>;
type UpdateAction = Extract<AutomationAction, { kind: 'record.update' }>;

/** Adminium's own tables are never a rule's target (the existing guard). */
export function assertWritable(table: ResolvedTable): void {
  if (isOwnTable(table)) {
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
export function nowValueFor(table: ResolvedTable, column: string, at: number): unknown {
  const resolved = table.columns.get(column);
  const instant = new Date(at);
  if (resolved === undefined) return instant.toISOString();
  if (resolved.logicalType === 'date') return instant.toISOString().slice(0, 10);
  return normalizeWriteValue(resolved, instant.toISOString());
}

type SettingRef = { table: string; column: string };
type DaysAfter = { column?: string | undefined; now?: true | undefined; days: number; setting?: SettingRef | undefined; at?: string | undefined };

/**
 * A number of days a setting holds, from 1 to 3650, or null: an empty value,
 * and a 0 a settings row starts with, are no number the business set (as an
 * amount read from a setting, `setting-operands.ts`).
 */
function wholeDays(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : null;
}

/** A wall time on the venue's clock, `HH:MM:SS`. */
function wallTimeOf(clock: { minute: number; second: number }): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(clock.minute / 60))}:${pad(clock.minute % 60)}:${pad(clock.second)}`;
}

/** What a step's values read beyond the record: the settings row, the business's clock. Each read once a step. */
interface ValueReads {
  setting: () => SettingReader;
  zone: () => Promise<string>;
}

function readsOf(ctx: ActionContext): ValueReads {
  let reader: SettingReader | null = null;
  let zone: Promise<string> | null = null;
  return {
    setting: () => {
      const source = sourceOf(ctx);
      reader ??= ruleSettingReader(ctx.meta, source.db, source.view);
      return reader;
    },
    zone: () => (zone ??= connectionTenantConfig(ctx.meta, sourceOf(ctx).connectionId).then((tenant) => tenant?.timezone ?? 'UTC')),
  };
}

/** Whether a column of a table holds a staff member. */
const holdsStaff = (table: ResolvedTable, column: string): boolean => (table.table as ResolvedTable['table'] | undefined)?.columns?.some((candidate) => candidate.name === column && candidate.staff === true) === true;

/**
 * A day so many days after a date of the record, or after the run, as `into`
 * takes it: a day for a date, the moment on the venue's clock for a moment
 * (`at`, else the wall time it counts from, else midnight). Null when the
 * date it counts from is empty.
 */
async function daysAfterValue(after: DaysAfter, into: ResolvedColumn, ctx: ActionContext, reads: ValueReads): Promise<unknown> {
  const source = sourceOf(ctx);
  const zone = await reads.zone();
  let day: string | null = null;
  let wall: string | null = null;
  if (after.now === true) {
    const clock = venueClock(new Date(ctx.now), zone);
    day = clock.day;
    wall = wallTimeOf(clock);
  } else {
    const name = after.column ?? '';
    const from = source.table.columns.get(name);
    if (from === undefined) throw new ActionFailure(`${source.table.id} has no column ${JSON.stringify(name)}.`);
    // A day worked out from a protected date tells it: no rule counts from one.
    if (from.secret || from.masked) throw new ActionFailure(`${name} is a protected column, so no rule counts days from it.`);
    const value = source.row[name];
    if (from.logicalType === 'date') day = dayOf(from, value, zone);
    else {
      const instant = value === null || value === undefined ? null : slotInstant(value);
      if (instant !== null) {
        const clock = venueClock(instant, zone);
        day = clock.day;
        wall = wallTimeOf(clock);
      }
    }
  }
  if (day === null) return null;
  const held = after.setting === undefined ? null : wholeDays(await reads.setting()({ table: after.setting.table, column: after.setting.column }));
  const on = addDays(day, held ?? after.days);
  if (into.logicalType === 'date') return on;
  const instant = wallTimeToInstant(`${on}T${after.at ?? wall ?? '00:00'}`, zone);
  return instant === null ? null : normalizeWriteValue(into, instant.toISOString());
}

/**
 * Resolve the authored values against this table: tokens, `now`, the
 * settings row, days on, coercion. What a value left empty was left empty
 * for is added to `notes`, for the run's log.
 */
export async function resolveValues(
  values: Record<string, AutomationWriteValue>,
  table: ResolvedTable,
  ctx: ActionContext,
  notes: string[] = [],
): Promise<Row> {
  const out: Row = {};
  const reads = readsOf(ctx);
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
    if (typeof value === 'string') {
      out[column] = normalizeWriteValue(resolved, substitute(value, ctx.tokens));
    } else if ('setting' in value) {
      const held = await reads.setting()({ table: value.setting.table, column: value.setting.column });
      let given: unknown = held === undefined || held === null || (typeof held === 'string' && held.trim() === '') ? null : held;
      // A list or an object a text column keeps as JSON is written as it was kept.
      if (given !== null && typeof given === 'object' && !(given instanceof Date)) given = JSON.stringify(given);
      // A person is handed a row only while they sign in: nobody, somebody removed or suspended, leaves it empty.
      if (holdsStaff(table, column)) {
        const user = given === null ? null : await usersRepo(ctx.meta).findById(String(given));
        if (user === null || user.status !== 'active') {
          notes.push(ctx.text.settingNobody(column, `${value.setting.column}`));
          given = null;
        }
      }
      out[column] = given === null ? null : normalizeWriteValue(resolved, given);
    } else if ('daysAfter' in value) {
      const after = value.daysAfter;
      const day = await daysAfterValue(after, resolved, ctx, reads);
      if (day === null && after.column !== undefined) notes.push(ctx.text.noDateFrom(column, after.column));
      out[column] = day;
    } else {
      out[column] = nowValueFor(table, column, ctx.now);
    }
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

export function sourceOf(ctx: ActionContext) {
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
  const table = createTargetOf(action, ctx);
  const notes: string[] = [];
  const made = await createRowWhole(ctx, table, await resolveValues(action.values, table, ctx, notes));
  return {
    log: [ctx.text.createOk(made.ref.label), ...notes].join(' · '),
    // Named: the row as it now stands (its key, its defaults, its numbers) is kept for the steps after this one.
    ...(action.name === undefined ? {} : { made: madeRowOf(action.name, table, made.ref.pk, made.row) }),
  };
}

/**
 * One row, made the way a rule makes one: through the write service, as the
 * rule, one hop deeper, announced so another rule may react. `values` are
 * already what the columns take. The door of "create a record" and of a step
 * an add-on gives: neither writes around it.
 */
export async function createRow(ctx: ActionContext, table: ResolvedTable, values: Row): Promise<RecordRef> {
  return (await createRowWhole(ctx, table, values)).ref;
}

/** {@link createRow}, with the row as the database returned it. */
async function createRowWhole(ctx: ActionContext, table: ResolvedTable, values: Row): Promise<{ ref: RecordRef; row: Row }> {
  const source = sourceOf(ctx);
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
  return { ref: entityOf(inserted), row: inserted };
}

export async function dryRunCreateAction(action: CreateAction, ctx: ActionContext): Promise<ActionResult> {
  const table = createTargetOf(action, ctx);
  const notes: string[] = [];
  const values = await resolveValues(action.values, table, ctx, notes);
  if (action.name === undefined) return { log: [ctx.text.writeWould(pairsOf(values)), ...notes].join(' · ') };
  // A test run makes nothing: the steps after this read a stand-in, the values this step would write and a key that says so.
  const pk = Object.fromEntries(table.primaryKey.map((column) => [column, values[column] ?? `(new ${action.name ?? ''})`]));
  return { log: [ctx.text.createStandIn(action.name, pairsOf(values)), ...notes].join(' · '), made: madeRowOf(action.name, table, pk, { ...values, ...pk }, true) };
}

// --- update ----------------------------------------------------------------

export async function runUpdateAction(
  action: UpdateAction,
  ctx: ActionContext,
): Promise<ActionResult> {
  const source = sourceOf(ctx);
  assertWritable(source.table);
  const notes: string[] = [];
  const values = await resolveValues(action.values, source.table, ctx, notes);
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
        // The rows this move moved too, as changes of their own made by the same rule.
        if (ctx.app !== undefined && ctx.source !== null) {
          await announceEffects(ctx.app, {
            connectionId: ctx.source.connectionId,
            view: source.view,
            effects: outcome.effects,
            origin: 'automation',
            actor: { id: ctx.rule.id, label: ctx.rule.name },
            auditCategory: 'automation',
            meta: ctx.meta,
            // As the rule's own write is: the loop guard reads both.
            ruleId: ctx.rule.id,
            hops: ctx.hops + 1,
          });
          // What the step handed to a ledger, told as the rule's doing too.
          await tellPostings(ctx.app, { connectionId: ctx.source.connectionId, view: source.view, postings: outcome.postings, origin: 'automation', actor: { id: ctx.rule.id, label: ctx.rule.name }, ruleId: ctx.rule.id, hops: ctx.hops + 1 });
        }
      },
    }),
  );
  return { log: [ctx.text.updateOk(pairsOf(keptRow(values, source.table))), ...notes].join(' · ') };
}

export async function dryRunUpdateAction(action: UpdateAction, ctx: ActionContext): Promise<ActionResult> {
  const source = sourceOf(ctx);
  assertWritable(source.table);
  const notes: string[] = [];
  const values = await resolveValues(action.values, source.table, ctx, notes);
  return { log: [ctx.text.writeWould(pairsOf(keptRow(values, source.table))), ...notes].join(' · ') };
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
    ...(ctx.via === undefined ? {} : { via: ctx.via }),
  });
}

/** Kysely handle type, re-exported so the runner can build an `ActionSource`. */
export type SourceDb = Kysely<SourceDatabase>;
