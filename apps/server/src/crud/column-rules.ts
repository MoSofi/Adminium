// SPDX-License-Identifier: AGPL-3.0-only
/**
 * COLUMN RULES — what Adminium fills in, and what it refuses, on every write.
 *
 * Pure functions over the `EffectiveTable` a write target already carries
 * (`ResolvedTable.table`). Two steps, run by `crud/write-service.ts` on either
 * side of the project's before hooks:
 *
 *     caller prepares → FILL → before hooks → CHECK → statement
 *
 * so a hook sees filled values and may change them, and whatever is stored has
 * passed the check regardless of who last touched it.
 *
 * ── THE FAILURE THIS EXISTS FOR ────────────────────────────────────────────
 *
 * A table whose `created_at` is NOT NULL with no database default could not
 * take a row from the dashboard at all: the form hid the column (a classifier
 * tag, not a fact about who fills it), nothing on the server put a value
 * there, and the database's refusal arrived as HTTP 500 with no column named.
 * Three separate holes, one symptom. This module closes the middle one.
 *
 * ── WHAT IS *NOT* HERE, DELIBERATELY ───────────────────────────────────────
 *
 * There is **no server-side "required" preflight**. A NOT NULL column can be
 * filled by a trigger Adminium cannot see, so refusing an absent value here
 * would refuse writes that succeed today. The database decides; its refusal is
 * translated into a named field error by `crud/db-errors.ts`.
 *
 * What {@link checkRow} does hold are the CHEAP CERTAINTIES — a value outside
 * a database enum, a non-number in a numeric column, a non-boolean in a
 * boolean, unparseable JSON, a malformed uuid. Each of them turns a 500 into a
 * 422 naming the column, and none of them refuses a write that succeeds today,
 * because **every shape check is gated on what the target engine itself
 * enforces**: SQLite stores `'abc'` in an `integer` column and any string
 * in a `uuid` column, and a dialect-blind check would start refusing that.
 *
 * The one place a check is stricter than the engine is enum membership, which
 * reads the SNAPSHOT's values on all three. A value added to the enum since
 * the last introspection is refused until the connection is introspected
 * again — accepted because the snapshot is already the sole authority for
 * every other identifier decision on this path (allow-listing, masking), and
 * because the alternative is the 500 this phase removes.
 */

import { randomUUID } from 'node:crypto';

import type { Dialect, EnumDef, LogicalType } from '@adminium/engine';

import type { ColumnValidation, EffectiveColumn, TableCapacityRule } from '../connections/effective-schema.js';
import { isNowType, renderNow } from './instants.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import type { Row } from './mask.js';
import type { WriteAction, WriteActor } from './write-context.js';

/** Every reason a value can be refused, on the server and in the dialog. */
export type IssueCode =
  | 'required'
  | 'not-allowed'
  | 'invalid'
  | 'format'
  | 'too-short'
  | 'too-long'
  | 'too-small'
  | 'too-large'
  | 'out-of-range';

/** `n` carries the bound a message needs ("Use at most {n} characters"). */
export interface FieldIssue {
  code: IssueCode;
  n?: number;
}

/** What `details.fields` on a 422 carries: one issue per column. */
export type FieldIssues = Record<string, FieldIssue>;

/**
 * How a column gets a value nobody typed.
 *
 * `database` and `none` write nothing and exist to be *said*: `database` means
 * "a trigger or an expression fills this, leave it alone", `none` switches an
 * implicit fill off. Both arrive from an explicit `column.default` rule
 * (phase C); phase A produces only the implicit fills below.
 */
export type FillKind = 'now' | 'uuid' | 'literal' | 'current-user' | 'database' | 'none';

export interface ColumnFill {
  column: string;
  logicalType: LogicalType;
  kind: FillKind;
  /** `literal` only. */
  text?: string;
  /** `current-user` only. */
  userField?: 'id' | 'name';
  /** Also fills on an update (an `updated_at`). */
  onUpdate: boolean;
  /** No rule row says this — it follows from the column's own facts. */
  implicit: boolean;
}

export interface ColumnCheck {
  column: string;
  logicalType: LogicalType;
  /** Values the DATABASE fixes: a native enum, MySQL `enum()`, a parsed CHECK. */
  enumValues?: readonly string[];
  /**
   * Values an ADMIN fixed, with `column.options` (D19). Distinct from
   * `enumValues` because the two are refused for different reasons and the
   * route refuses to set this one where the database already decides.
   *
   * A rule that names a LIST by key is resolved when the VIEW is built, not
   * here: the view's stamp carries the lists' revision, so an edited list is in
   * force on the next request and no write pays a meta-store read.
   */
  options?: readonly string[];
  /** An admin's `column.required` — the one "required" the server enforces. */
  requiredByRule?: boolean;
  /** An admin's `column.validation`. */
  validation?: ColumnValidation;
}

/** `column.copy`, resolved against the snapshot: where the value comes from. */
export interface ColumnCopy {
  column: string;
  /** This table's foreign-key column. */
  via: string;
  /** The linked table and the column `via` matches. */
  toTable: string;
  toColumn: string;
  /** The linked table's column to copy. */
  from: string;
  mode: 'default' | 'always';
}

/** `column.sequence`. */
export interface ColumnSequence {
  column: string;
  logicalType: LogicalType;
  start: number;
}

/** `column.code`. */
export interface ColumnCode {
  column: string;
  prefix: string;
  length: number;
}

/** A parent's total this table's rows feed (`column.rollup` on the parent). */
export interface RollupInto {
  /** The parent table's id, and its single-column key. */
  parent: string;
  parentKey: string;
  /** The parent's total column. */
  column: string;
  /** This table's column linking to the parent. */
  via: string;
  sum: string;
  times?: string;
  /** Child rows whose column holds a value are left out of the total. */
  unlessSet?: string;
  /** Decimal places the total keeps. */
  scale: number;
}

export interface TableRules {
  fills: ColumnFill[];
  checks: ColumnCheck[];
  /** The columns Adminium decides; absent on a table with none. */
  copies?: ColumnCopy[];
  sequences?: ColumnSequence[];
  codes?: ColumnCode[];
  /** Parent totals kept in step when this table's rows change. */
  rollupsInto?: RollupInto[];
  /** The booking guard on this table. */
  capacity?: TableCapacityRule;
  /** Columns whose zone-less wall times are read on the venue's clock. */
  venueLocal?: string[];
}

/** Whether any column of the table is decided by Adminium (copied, numbered, coded). */
export function hasDecided(rules: TableRules | null): boolean {
  return (rules?.copies?.length ?? 0) + (rules?.sequences?.length ?? 0) + (rules?.codes?.length ?? 0) > 0;
}

export interface FillContext {
  dialect: Dialect;
  /** ONE instant for the whole row: a `created_at` and an `updated_at` that
   *  differ by a microsecond describe a row edited the moment it was written. */
  now: Date;
  actor: WriteActor | null;
}

// --- deriving the rules ------------------------------------------------------

/**
 * Memoized per `ResolvedTable`, which is rebuilt whenever the snapshot or the
 * override set moves (`routes/data/index.ts` stamps the view). The memo holds
 * only what the table itself decides — an option list is a separate store and
 * resolves at check time.
 */
const CACHE = new WeakMap<ResolvedTable, TableRules | null>();

function enumValuesOf(column: EffectiveColumn, enums: readonly EnumDef[]): readonly string[] | undefined {
  if (column.enumRef === null) return undefined;
  return enums.find((e) => e.id === column.enumRef)?.values;
}

/**
 * The implicit fills of D5: nothing is stored to ask for them, and each holds
 * only when the database has no default of its own and the column is not
 * generated.
 *
 * The TYPE is checked as well as the tag. The classifier tags `created-at` by
 * NAME alone (`created`, `creation_date`, `inserted_at`), so a `varchar`
 * column that happens to be called `created` would otherwise be filled with an
 * ISO string nobody asked for.
 */
/**
 * The fill an admin asked for, if any. It wins over the implicit one whole —
 * `none` and `database` included, which is how an implicit fill is switched
 * off (D14).
 */
function explicitFillFor(column: EffectiveColumn): ColumnFill | null {
  const rule = column.fill;
  if (rule === undefined) return null;
  return {
    column: column.name,
    logicalType: column.logicalType,
    kind: rule.kind,
    ...(rule.text === undefined ? {} : { text: rule.text }),
    ...(rule.userField === undefined ? {} : { userField: rule.userField }),
    onUpdate: rule.onUpdate === true,
    implicit: false,
  };
}

function implicitFillFor(column: EffectiveColumn): ColumnFill | null {
  if (column.isGenerated) return null;
  if (column.default !== null) return null;
  const base = { column: column.name, logicalType: column.logicalType, implicit: true } as const;
  const semantic = column.semantics?.primary ?? null;
  if (semantic === 'created-at' && isNowType(column.logicalType)) {
    return { ...base, kind: 'now', onUpdate: false };
  }
  if (semantic === 'updated-at' && isNowType(column.logicalType)) {
    return { ...base, kind: 'now', onUpdate: true };
  }
  if (column.isPrimaryKey && column.logicalType === 'uuid') {
    return { ...base, kind: 'uuid', onUpdate: false };
  }
  return null;
}

/** The types whose shape {@link checkRow} can judge at all. */
function checkableType(logicalType: LogicalType): boolean {
  switch (logicalType) {
    case 'integer':
    case 'bigint':
    case 'decimal':
    case 'float':
    case 'boolean':
    case 'json':
    case 'uuid':
    case 'enum':
      return true;
    default:
      return false;
  }
}

/**
 * The fills and checks in force for one table, or `null` when there is nothing
 * to do — which is the common case and the reason a table with no rules pays
 * nothing.
 *
 * `target.table.table` is an `EffectiveTable` on every real path; a harness
 * that builds a `ResolvedTable` by hand may leave it empty, and an empty table
 * has no rules, which is exactly "no behaviour change".
 */
export function tableRulesFor(target: { view: SnapshotView; table: ResolvedTable }): TableRules | null {
  const cached = CACHE.get(target.table);
  if (cached !== undefined) return cached;
  const columns: readonly EffectiveColumn[] = target.table.table?.columns ?? [];
  const enums: readonly EnumDef[] = target.view?.model?.enums ?? [];
  const fills: ColumnFill[] = [];
  const checks: ColumnCheck[] = [];
  const copies: ColumnCopy[] = [];
  const sequences: ColumnSequence[] = [];
  const codes: ColumnCode[] = [];
  const venueLocal: string[] = [];
  for (const column of columns) {
    if (column.venueLocal === true) venueLocal.push(column.name);
    // A secret column is refused by the write path long before this, and a
    // fill that named one would be a way to write it sideways.
    if (target.table.columns.get(column.name)?.secret === true) continue;
    const fill = explicitFillFor(column) ?? implicitFillFor(column);
    if (fill !== null) fills.push(fill);
    if (column.copy !== undefined) {
      // Through a relation the snapshot still has; one it lost copies nothing.
      const relation = target.view?.model?.relations.find(
        (r) =>
          r.through === null &&
          r.from.tableId === target.table.id &&
          r.from.columns.length === 1 &&
          r.from.columns[0] === column.copy?.via,
      );
      if (relation !== undefined) {
        copies.push({
          column: column.name,
          via: column.copy.via,
          toTable: relation.to.tableId,
          toColumn: relation.to.columns[0] as string,
          from: column.copy.from,
          mode: column.copy.mode ?? 'default',
        });
      }
    }
    if (column.sequence !== undefined) {
      sequences.push({ column: column.name, logicalType: column.logicalType, start: column.sequence.start ?? 1 });
    }
    if (column.code !== undefined) {
      codes.push({ column: column.name, prefix: column.code.prefix ?? '', length: column.code.length });
    }
    const values = enumValuesOf(column, enums);
    /*
     * The answers this column accepts, from the rule.
     *
     * Inline values are the rule's own; a NAMED list resolves through the view,
     * which carried the values in when it was built and whose stamp moves when a
     * list is edited. A list the view does not know — deleted since, or a
     * key that never existed — contributes NOTHING: the column goes back to
     * accepting anything, rather than refusing every write because of a list
     * somebody removed.
     */
    const options =
      column.options === undefined
        ? undefined
        : 'values' in column.options
          ? column.options.values.map((item) => item.value)
          : target.view?.optionLists?.get(column.options.list);
    const check: ColumnCheck = { column: column.name, logicalType: column.logicalType };
    if (values !== undefined) check.enumValues = values;
    if (options !== undefined) check.options = options;
    if (column.requiredByRule === true) check.requiredByRule = true;
    if (column.validation !== undefined) check.validation = column.validation;
    // A check with nothing to say is still cheap, but keeping it out is what
    // makes "this table has no rules" provable.
    if (
      values !== undefined ||
      options !== undefined ||
      check.requiredByRule === true ||
      check.validation !== undefined ||
      checkableType(column.logicalType)
    ) {
      checks.push(check);
    }
  }
  // The totals this table's rows feed, read off the parents that name it.
  const rollupsInto: RollupInto[] = [];
  for (const parent of target.view?.model?.tables ?? []) {
    if (parent.primaryKey.length !== 1) continue;
    for (const column of parent.columns as EffectiveColumn[]) {
      const rollup = column.rollup;
      if (rollup === undefined || rollup.from !== target.table.id) continue;
      rollupsInto.push({
        parent: parent.id,
        parentKey: parent.primaryKey[0] as string,
        column: column.name,
        via: rollup.via,
        sum: rollup.sum,
        ...(rollup.times === undefined ? {} : { times: rollup.times }),
        ...(rollup.unlessSet === undefined ? {} : { unlessSet: rollup.unlessSet }),
        scale: column.numericScale ?? 2,
      });
    }
  }
  const capacity = target.table.table?.capacity;
  const decided = copies.length + sequences.length + codes.length > 0;
  const rules =
    fills.length === 0 &&
    checks.length === 0 &&
    !decided &&
    rollupsInto.length === 0 &&
    capacity === undefined &&
    venueLocal.length === 0
      ? null
      : {
          fills,
          checks,
          ...(decided ? { copies, sequences, codes } : {}),
          ...(rollupsInto.length === 0 ? {} : { rollupsInto }),
          ...(capacity === undefined ? {} : { capacity }),
          ...(venueLocal.length === 0 ? {} : { venueLocal }),
        };
  CACHE.set(target.table, rules);
  return rules;
}

// --- filling -----------------------------------------------------------------

function fillValue(fill: ColumnFill, ctx: FillContext): unknown {
  switch (fill.kind) {
    case 'now':
      return renderNow({ logicalType: fill.logicalType }, ctx.dialect, ctx.now);
    case 'uuid':
      return randomUUID();
    case 'literal':
      return fill.text ?? null;
    case 'current-user':
      return (fill.userField === 'name' ? ctx.actor?.label : ctx.actor?.id) ?? null;
    default:
      // `database` and `none` write nothing.
      return null;
  }
}

/**
 * The values with every absent fillable column filled in.
 *
 * A SUPPLIED VALUE ALWAYS WINS, including an explicit `null`: the fill fires
 * on an absent KEY, not on an empty one, so "clear this column" stays a thing
 * a caller can say.
 *
 * Returns the SAME OBJECT when nothing was added, so the "no rules, no change"
 * claim is provable by identity rather than by deep equality.
 */
export function fillRow(
  rules: TableRules | null,
  action: WriteAction,
  values: Row,
  ctx: FillContext,
): Row {
  if (rules === null || action === 'delete') return values;
  let out: Row | null = null;
  for (const fill of rules.fills) {
    if (fill.kind === 'database' || fill.kind === 'none') continue;
    if (action === 'update' && !fill.onUpdate) continue;
    if (Object.prototype.hasOwnProperty.call(values, fill.column)) continue;
    const value = fillValue(fill, ctx);
    if (value === null) continue;
    out ??= { ...values };
    out[fill.column] = value;
  }
  return out ?? values;
}

// --- checking ----------------------------------------------------------------

/**
 * What each engine refuses on its own. SQLite's dynamic typing accepts almost
 * anything, so checking a shape it tolerates would refuse a write that
 * succeeds there today.
 */
function enforces(dialect: Dialect, what: 'number' | 'boolean' | 'json' | 'uuid'): boolean {
  if (dialect === 'sqlite') return false;
  // MySQL has no uuid type — the column is char/varchar and takes any string.
  if (what === 'uuid') return dialect === 'postgres';
  return true;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Numbers arrive as strings from a raw API caller, from an automation's
 * resolved values and from every CSV cell, and all three succeed today.
 */
function numberIssue(value: unknown): FieldIssue | null {
  if (typeof value === 'number') return Number.isFinite(value) ? null : { code: 'invalid' };
  if (typeof value === 'bigint') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return { code: 'invalid' };
    return Number.isFinite(Number(trimmed)) ? null : { code: 'invalid' };
  }
  return { code: 'invalid' };
}

const BOOLEANISH = new Set(['true', 'false', 't', 'f', 'yes', 'no', 'on', 'off', '0', '1']);

function booleanIssue(value: unknown): FieldIssue | null {
  if (typeof value === 'boolean') return null;
  if (value === 0 || value === 1) return null;
  if (typeof value === 'string' && BOOLEANISH.has(value.trim().toLowerCase())) return null;
  return { code: 'invalid' };
}

function jsonIssue(value: unknown): FieldIssue | null {
  if (typeof value !== 'string') return null; // an object is serialized by the driver
  try {
    JSON.parse(value);
    return null;
  } catch {
    return { code: 'invalid' };
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * Digits, spaces and the punctuation a written phone number uses — including
 * an area code in brackets at the START, "(415) 555-0132", the usual way to
 * write a North American number (it was refused there, and only there).
 */
const PHONE = /^\+?\(?[0-9][0-9\s().-]{4,}$/;

/**
 * The rules an ADMIN typed (D26). Never a classifier's guess: enforcing a
 * guessed format would start refusing imports of old data that has always been
 * in the table.
 */
function validationIssue(rules: ColumnValidation, value: unknown): FieldIssue | null {
  if (typeof value === 'string') {
    const text = value.trim();
    if (rules.minLength !== undefined && text.length < rules.minLength) {
      return { code: 'too-short', n: rules.minLength };
    }
    if (rules.maxLength !== undefined && text.length > rules.maxLength) {
      return { code: 'too-long', n: rules.maxLength };
    }
    if (text !== '' && rules.format !== undefined) {
      const ok =
        rules.format === 'email'
          ? EMAIL.test(text)
          : rules.format === 'phone'
            ? PHONE.test(text)
            : URL.canParse(text);
      if (!ok) return { code: 'format' };
    }
  }
  if (rules.min !== undefined || rules.max !== undefined) {
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (Number.isFinite(n)) {
      if (rules.min !== undefined && n < rules.min) return { code: 'too-small', n: rules.min };
      if (rules.max !== undefined && n > rules.max) return { code: 'too-large', n: rules.max };
    }
  }
  return null;
}

function issueFor(check: ColumnCheck, value: unknown, dialect: Dialect): FieldIssue | null {
  if (value === null || value === undefined) return null;
  if (check.validation !== undefined) {
    const issue = validationIssue(check.validation, value);
    if (issue !== null) return issue;
  }
  if (check.options !== undefined) {
    // An admin's list. The database knows nothing about it, so this check is
    // the only thing between a typo and a column full of near-misses.
    if (!check.options.includes(String(value))) return { code: 'not-allowed' };
  }
  if (check.enumValues !== undefined) {
    return check.enumValues.includes(String(value)) ? null : { code: 'not-allowed' };
  }
  switch (check.logicalType) {
    case 'integer':
    case 'bigint':
    case 'decimal':
    case 'float':
      return enforces(dialect, 'number') ? numberIssue(value) : null;
    case 'boolean':
      return enforces(dialect, 'boolean') ? booleanIssue(value) : null;
    case 'json':
      return enforces(dialect, 'json') ? jsonIssue(value) : null;
    case 'uuid':
      if (!enforces(dialect, 'uuid')) return null;
      return typeof value === 'string' && !UUID.test(value) ? { code: 'invalid' } : null;
    default:
      return null;
  }
}

/**
 * The issues in one row, or `null` when there are none.
 *
 * Only SUPPLIED keys are judged, on a create as much as on an update: what an
 * absent key means is the database's business (a default, a trigger, a NOT
 * NULL refusal), and pre-judging it is the preflight this module refuses to
 * have.
 */
export function checkRow(
  rules: TableRules | null,
  action: WriteAction,
  values: Row,
  ctx: { dialect: Dialect },
): FieldIssues | null {
  if (rules === null) return null;
  let issues: FieldIssues | null = null;
  const add = (column: string, issue: FieldIssue): void => {
    issues ??= {};
    issues[column] ??= issue;
  };
  // What Adminium decides is filled as surely as a default: a running
  // number is claimed only after this check, so it is absent here.
  const filled = new Set([
    ...rules.fills.filter((f) => f.kind !== 'none').map((f) => f.column),
    ...(rules.copies ?? []).map((c) => c.column),
    ...(rules.sequences ?? []).map((c) => c.column),
    ...(rules.codes ?? []).map((c) => c.column),
  ]);
  for (const check of rules.checks) {
    const supplied = Object.prototype.hasOwnProperty.call(values, check.column);
    /*
     * The ONE "required" the server enforces: an admin's explicit rule (D26).
     * A NOT NULL column is still the database's business — a trigger may fill
     * it, and refusing here would refuse writes that succeed today (D15).
     *
     * On a create an absent key is a missing answer; on an update it means
     * "not part of this change", so only a supplied empty one is refused. A
     * column something fills is never asked for.
     */
    if (check.requiredByRule === true && !filled.has(check.column)) {
      const value = supplied ? values[check.column] : undefined;
      const empty = value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
      if (empty && (action === 'create' || supplied)) add(check.column, { code: 'required' });
    }
    if (!supplied) continue;
    const issue = issueFor(check, values[check.column], ctx.dialect);
    if (issue !== null) add(check.column, issue);
  }
  return issues;
}
