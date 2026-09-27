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
 *
 * The other is U+0000 in text ({@link unstorableText}): Postgres refuses it
 * and MySQL and SQLite store it, so it is refused on all three, on every table
 * whether or not it has a rule. A value one engine cannot hold is not data
 * the other two should keep.
 */

import { randomUUID } from 'node:crypto';

import type { Dialect, EnumDef, LogicalType } from '@adminium/engine';
import { formulaColumns, weekdaysOf, type FormulaExpr } from '@adminium/manifest';

import type {
  ColumnCodeRule,
  ColumnRequiredWhen,
  ColumnStampRule,
  ColumnValidation,
  EffectiveColumn,
  EffectiveTable,
  LockedByReference,
  RuleSetting,
  StateParent,
  TableStatesRule,
  TableBookingRule,
  TableCapacityRule,
  EffectiveCapacityRule,
} from '../connections/effective-schema.js';
import { holdsNul } from '../security/nul-bytes.js';
import { codeLookupsOf, type CodeLookup } from './code-lookup.js';
import { isNowType, renderNow } from './instants.js';
import { booleanOf, sameValue } from './write-values.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import { ownedRules, type OwnedRule } from './capacity/rules.js';
import type { Row } from './mask.js';
import type { WriteAction, WriteActor, WriteOrigin } from './write-context.js';

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
  | 'out-of-range'
  | 'invalid-character'
  // A code typed that finds no code the venue offers; one whose uses are all taken.
  | 'unknown'
  | 'used-up';

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
export type FillKind = 'now' | 'uuid' | 'literal' | 'current-user' | 'database' | 'none' | 'from';

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
  /** `column.requiredWhen`: required only while another column of the row holds one of `in`. */
  requiredWhen?: ColumnRequiredWhen;
  /**
   * What the database stores in `requiredWhen.column` when a create leaves it
   * out: its literal default. Absent when it has none Adminium can read.
   */
  requiredWhenDefault?: unknown;
  /**
   * Whether `requiredWhen.column` is text MySQL compares as it does: without
   * case, accents or spaces at the end. `AWAY` is `away` to its queries, so it
   * is to the rule.
   */
  requiredWhenFolds?: boolean;
  /** An admin's `column.validation`. */
  validation?: ColumnValidation;
  /** Days of the week a price by the night reads (`fri,sat`): each word a day's three letters. */
  weekdays?: true;
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
  /** Kept in step when the linked row's column changes (`copy.follow`). */
  follow?: true;
}

/** `column.sequence`. */
export interface ColumnSequence {
  column: string;
  logicalType: LogicalType;
  start: number;
}

/**
 * `column.sequence` with `gapless`: the next number after the largest the
 * table (or the parent row, with `scope`) holds, taken inside the write that
 * creates the row — never from the meta store's counter, which allows gaps.
 */
export interface GaplessSequence {
  column: string;
  logicalType: LogicalType;
  start: number;
  startSetting?: RuleSetting;
  scope?: string;
  /** The text column written from the number in the same statement (`INV-0042`). */
  format?: { column: string; prefix?: string; prefixSetting?: RuleSetting; pad: number };
  /**
   * The unique indexes that refuse a number twice in the series (on the
   * number, or its text; with the scope column for a per-parent series). A
   * MySQL claim inside a caller's transaction steps past a duplicate of one.
   */
  uniqueKeys: string[];
  /** The row a per-parent series' `scope` points at: held while a number in its series is taken. */
  scopeParent?: { table: string; column: string };
}

/** The places a decimal keeps: a number, or the decimals of the row's currency. */
export type Scale = number | 'currency';

/** `column.formula`: a value worked out from the other columns of the same row. */
export interface ColumnFormula {
  column: string;
  expr: FormulaExpr;
  scale: Scale;
  /** The columns it reads directly. */
  reads: string[];
  /**
   * How large a number the column holds, when the database says: the digits
   * before the point of a `numeric(p, s)`, or an integer's largest value. A
   * result past it is refused before the statement, naming what it is worked
   * out from.
   */
  limit?: { digits: number } | { max: bigint };
  /** A joined text's longest (the column's length): cut there rather than refused. */
  maxLength?: number;
}

/** `column.bounds`, resolved: the other date is this row's, or read through a foreign key. */
export interface DateBound {
  column: string;
  notAfter?: 'today';
  notBefore?: { column: string; through?: { via: string; table: string; key: string } };
}

/** `column.default { kind: 'from' }`: a create's empty value, filled from elsewhere. */
export interface ColumnDefaultFrom {
  column: string;
  from: 'connection.currency' | RuleSetting;
}

/** `column.code`. */
export interface ColumnCode {
  column: string;
  prefix: string;
  length: number;
  /** A new code written by the change that sets one of these off (`crud/code-renew.ts`). */
  renew?: ColumnCodeRule['renew'];
}

/** `column.stamp`: what is written, and when. */
export interface ColumnStamp extends ColumnStampRule {
  column: string;
  logicalType: LogicalType;
}

/**
 * A balance a table keeps beside its totals: `of − Σminus − total`
 * (`balance = fee − waived − paid`).
 */
export interface TableBalance {
  column: string;
  of: string;
  minus: string[];
  /** The total whose rollup declares it. */
  total: string;
  scale: Scale;
  /**
   * The totals among `total` and `minus` whose rollup says `cap`: a write
   * that moves one of them may not take this balance below zero.
   */
  cappedBy: string[];
}

/** A parent's total this table's rows feed (`column.rollup` on the parent). */
export interface RollupInto {
  /** The parent table's id, and its single-column key. */
  parent: string;
  parentKey: string;
  /** The parent's total column. */
  column: string;
  /** The child table's id: the rows added up. */
  child: string;
  /** This table's column linking to the parent. */
  via: string;
  /** The column added up; empty for a count, which adds up no column. */
  sum: string;
  /** The child rows are counted instead (the stored rule's `count`). */
  count?: true;
  times?: string;
  /** Child rows whose column holds a value are left out of the total. */
  unlessSet?: string;
  /** Only child rows whose column equals the value are added up. */
  where?: { column: string; eq: string | number | boolean };
  /** Decimal places the total keeps. */
  scale: Scale;
  /** Every balance the parent keeps, worked out again once this total moves. */
  balances: TableBalance[];
  /**
   * The parent's formulas, in the order they are worked out: run between the
   * totals and the balances, so a balance is taken from the total a formula
   * has just worked out (`total = subtotal + tax`), never the one before.
   */
  formulas: ColumnFormula[];
  /** The parent's own `currency` column, which a `currency` scale reads. */
  currencyColumn?: string;
  /** The parent's formula columns that read this total, directly or through another formula. */
  derived: string[];
  /** Whether a balance this total is part of may not go below zero. */
  capped: boolean;
  /**
   * Every total the parent keeps (this one included), added up again before
   * a capped balance is read: what is stored may lag what the rows say.
   */
  siblings: RollupInto[];
  /**
   * The totals one table higher that add up what this one moves — its column,
   * the parent's formulas that read it, the parent's balances: a line's
   * options into the line, the line's amount into the order. A write climbs
   * them after this one settles, up to three rows high.
   */
  climbs: RollupInto[];
}

export interface TableRules {
  fills: ColumnFill[];
  checks: ColumnCheck[];
  /** The columns Adminium decides; absent on a table with none. */
  copies?: ColumnCopy[];
  sequences?: ColumnSequence[];
  codes?: ColumnCode[];
  /** Links filled from a code a person types (`crud/code-lookup.ts`): resolved first, before the copies. */
  codeLookups?: CodeLookup[];
  /** Values written when something happens (a check-in's time, who booked). */
  stamps?: ColumnStamp[];
  /** Parent totals kept in step when this table's rows change. */
  rollupsInto?: RollupInto[];
  /** This table's own totals, settled when one of its rows is created. */
  ownRollups?: RollupInto[];
  /** This table's balances, worked out again when their `of` or `minus` changes. */
  balances?: TableBalance[];
  /**
   * Columns only Adminium writes — totals, balances and formulas: dropped from
   * every writer's values.
   */
  readOnly?: string[];
  /**
   * A gapless running number and the text written from it: dropped from every
   * writer's values but an import's, which brings in history and its numbers.
   */
  numbered?: string[];
  /** Formula columns, in the order they are worked out (each after what it reads). */
  formulas?: ColumnFormula[];
  /** Every decimal with a scale rule: rounded to it on every write. */
  scales?: { column: string; scale: Scale }[];
  /** The table's own `currency` column, which a `currency` scale reads first. */
  currencyColumn?: string;
  /** Values a create fills from the connection, a settings row or an add-on's setting. */
  defaultsFrom?: ColumnDefaultFrom[];
  /** Numbers without gaps, taken inside the write. */
  gapless?: GaplessSequence[];
  /** Text stored trimmed, or trimmed and in lower case. */
  normalizes?: { column: string; how: 'trim' | 'email' | 'code' }[];
  /** Dates kept within dates: never after today, never before another date. */
  bounds?: DateBound[];
  /** A document's life (`table.states`), and the rows of other tables that lock it. */
  states?: TableStatesRule;
  lockedBy?: LockedByReference[];
  /** The parents whose state this table's rows are tied to. */
  stateParents?: StateParent[];
  /** Fingerprints: stamps of `hashOf`, sealed after everything else a write does. */
  seals?: ColumnStamp[];
  /** The booking guard on this table. */
  capacity?: TableCapacityRule;
  /** Every limit on this table, of every kind (the released slot rule too). */
  capacityRules?: EffectiveCapacityRule[];
  /** Limits of other tables whose rows belong to this table's rows (an order's tickets): its changes may move them. */
  capacityOwners?: OwnedRule[];
  /** Booking people on this table: no overlap per resource. */
  booking?: TableBookingRule;
  /** Columns whose zone-less wall times are read on the venue's clock. */
  venueLocal?: string[];
  /** The column priced night by night, and where its rate and adjustments are read. */
  perNight?: ColumnPerNight;
  /** Copies in other tables' rows that follow a column of this table's rows (an extra's nights, its stay's). */
  follows?: FollowOut[];
  /** This table's columns whose change can move a column a copy follows: the column, and what works it out. */
  followReads?: string[];
}

/** Whether any column of the table is decided by Adminium (copied, numbered, coded, stamped). */
export function hasDecided(rules: TableRules | null): boolean {
  return (rules?.copies?.length ?? 0) + (rules?.sequences?.length ?? 0) + (rules?.codes?.length ?? 0) + (rules?.stamps?.length ?? 0) > 0;
}

export interface FillContext {
  dialect: Dialect;
  /** ONE instant for the whole row: a `created_at` and an `updated_at` that
   *  differ by a microsecond describe a row edited the moment it was written. */
  now: Date;
  actor: WriteActor | null;
  /**
   * Whether the role may write a column on this write. A fill of a column it
   * may not — an `updated_at` stamp on a table granted `UPDATE (body)` only — is
   * left out rather than making the database refuse the whole write.
   */
  granted?: ((column: string) => boolean) | undefined;
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
    // A fill from elsewhere is read when the create runs (`defaultsFrom`), never here.
    onUpdate: rule.onUpdate === true && rule.kind !== 'from',
    implicit: false,
  };
}

function implicitFillFor(column: EffectiveColumn, dialect: Dialect | undefined): ColumnFill | null {
  if (column.isGenerated) return null;
  const base = { column: column.name, logicalType: column.logicalType, implicit: true } as const;
  const semantic = column.semantics?.primary ?? null;
  /*
   * A MySQL `DATETIME` the database fills with `CURRENT_TIMESTAMP` — one made
   * before Adminium stopped giving it that default, or an operator's own. It
   * keeps this server's wall clock, and every Adminium session is in UTC, so
   * the database would fill UTC's: hours off wherever the server is not in
   * UTC. Adminium fills the moment itself on its own creates (and, for an
   * `updated_at`, its updates).
   */
  if (dialect === 'mysql' && column.logicalType === 'timestamp' && column.default?.kind === 'now') {
    return { ...base, kind: 'now', onUpdate: semantic === 'updated-at' };
  }
  if (column.default !== null) return null;
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
  const stamps: ColumnStamp[] = [];
  const venueLocal: string[] = [];
  const gapless: GaplessSequence[] = [];
  const scales: { column: string; scale: Scale }[] = [];
  const defaultsFrom: ColumnDefaultFrom[] = [];
  const seals: ColumnStamp[] = [];
  const normalizes: { column: string; how: 'trim' | 'email' | 'code' }[] = [];
  const bounds: DateBound[] = [];
  const states = target.table.table?.states;
  const lockedBy = target.table.table?.lockedBy ?? [];
  const stateParents = target.table.table?.stateParents ?? [];
  for (const column of columns) {
    if (column.scale !== undefined) scales.push({ column: column.name, scale: column.scale });
    if (column.venueLocal === true) venueLocal.push(column.name);
    // A secret column is refused by the write path long before this, and a
    // fill that named one would be a way to write it sideways.
    if (target.table.columns.get(column.name)?.secret === true) continue;
    const fill = explicitFillFor(column) ?? implicitFillFor(column, target.view?.model?.dialect);
    if (fill !== null) fills.push(fill);
    if (column.fill?.kind === 'from' && column.fill.from !== undefined) defaultsFrom.push({ column: column.name, from: column.fill.from });
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
          ...(column.copy.follow === true ? { follow: true as const } : {}),
        });
      }
    }
    if (column.sequence?.gapless === true) {
      const format = columns.find((other) => other.format?.from === column.name);
      gapless.push({
        column: column.name,
        logicalType: column.logicalType,
        start: column.sequence.start ?? 1,
        ...(column.sequence.startSetting === undefined ? {} : { startSetting: column.sequence.startSetting }),
        ...(column.sequence.scope === undefined ? {} : { scope: column.sequence.scope }),
        uniqueKeys: seriesKeys(target.table.table, column.sequence.scope, [column.name, ...(format === undefined ? [] : [format.name])]),
        ...scopeParentOf(target, column.sequence.scope),
        ...(format?.format === undefined
          ? {}
          : {
              format: {
                column: format.name,
                ...(format.format.prefix === undefined ? {} : { prefix: format.format.prefix }),
                ...(format.format.prefixSetting === undefined ? {} : { prefixSetting: format.format.prefixSetting }),
                pad: format.format.pad ?? 0,
              },
            }),
      });
    } else if (column.sequence !== undefined) {
      sequences.push({ column: column.name, logicalType: column.logicalType, start: column.sequence.start ?? 1 });
    }
    if (column.code !== undefined) {
      codes.push({ column: column.name, prefix: column.code.prefix ?? '', length: column.code.length, ...(column.code.renew === undefined ? {} : { renew: column.code.renew }) });
    }
    if (column.stamp !== undefined) {
      const stamp = { ...column.stamp, column: column.name, logicalType: column.logicalType };
      // A fingerprint is sealed last, over the row as the whole write leaves it.
      if (typeof stamp.set === 'object' && 'hashOf' in stamp.set) seals.push(stamp);
      else stamps.push(stamp);
    }
    if (column.normalize !== undefined) normalizes.push({ column: column.name, how: column.normalize });
    if (column.bounds !== undefined) {
      const bound: DateBound = { column: column.name, ...(column.bounds.notAfter === undefined ? {} : { notAfter: column.bounds.notAfter }) };
      const before = column.bounds.notBefore;
      if (before !== undefined && before.via === undefined) bound.notBefore = { column: before.column };
      if (before?.via !== undefined) {
        const relation = target.view?.model?.relations.find(
          (r) => r.through === null && r.from.tableId === target.table.id && r.from.columns.length === 1 && r.from.columns[0] === before.via,
        );
        if (relation !== undefined) {
          bound.notBefore = { column: before.column, through: { via: before.via, table: relation.to.tableId, key: relation.to.columns[0] as string } };
        }
      }
      if (bound.notAfter !== undefined || bound.notBefore !== undefined) bounds.push(bound);
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
    if (column.requiredWhen !== undefined) {
      check.requiredWhen = column.requiredWhen;
      const other = columns.find((candidate) => candidate.name === column.requiredWhen?.column);
      const stored = literalDefault(other?.default, other?.logicalType);
      if (stored !== undefined) check.requiredWhenDefault = stored;
      if (target.view?.model?.dialect === 'mysql' && other !== undefined && other.enumRef === null && FOLDED_TEXT.has(other.logicalType)) {
        check.requiredWhenFolds = true;
      }
    }
    if (column.validation !== undefined) check.validation = column.validation;
    // A check with nothing to say is still cheap, but keeping it out is what
    // makes "this table has no rules" provable.
    if (
      values !== undefined ||
      options !== undefined ||
      check.requiredByRule === true ||
      check.requiredWhen !== undefined ||
      check.validation !== undefined ||
      checkableType(column.logicalType)
    ) {
      checks.push(check);
    }
  }
  // A column of days a price by the night reads: judged as days, so a stored value never stops the price.
  for (const name of weekdayColumns(target)) {
    const found = checks.find((check) => check.column === name);
    if (found !== undefined) found.weekdays = true;
    else checks.push({ column: name, logicalType: target.table.columns.get(name)?.logicalType ?? 'text', weekdays: true });
  }
  // The totals this table's rows feed, read off the parents that name it.
  const rollupsInto: RollupInto[] = [];
  // Built once per model, so each total knows the totals above it that climb from it.
  const model = target.view?.model?.tables === undefined ? undefined : modelRollups(target.view.model as { tables: readonly EffectiveTable[] });
  for (const totals of model?.values() ?? []) {
    rollupsInto.push(...totals.filter((rollup) => rollup.child === target.table.id));
  }
  // This table's own totals and balances: settled when one of its rows is
  // created or its `of`/`minus` changes, and written by nothing else.
  // A hand-built target may carry an empty table: it has no totals.
  const self = target.table.table?.columns === undefined ? undefined : target.table.table;
  const ownRollups: RollupInto[] = self === undefined ? [] : (model?.get(self.id) ?? rollupsOf(self));
  const balances = self === undefined ? [] : balancesOf(self);
  const formulas = self === undefined ? [] : formulasOf(self);
  const perNight = perNightOf(target);
  const follows = followsOf(target);
  const followReads = follows.length === 0 ? [] : followReadsOf(formulas, perNight, follows);
  const readOnly = [
    ...ownRollups.map((r) => r.column),
    ...balances.map((b) => b.column),
    ...formulas.map((f) => f.column),
    ...(perNight === undefined ? [] : [perNight.column]),
  ];
  const numbered = gapless.flatMap((sequence) => [sequence.column, ...(sequence.format === undefined ? [] : [sequence.format.column])]);
  const currencyColumn = columns.some((column) => column.name === 'currency') ? 'currency' : undefined;
  const capacity = target.table.table?.capacity;
  const capacityRules = target.table.table?.capacityRules;
  // A hand-built target may carry no model: nothing belongs to its rows.
  const capacityOwners = target.view?.model === undefined || target.table.table === undefined ? [] : ownedRules(target.view, target.table);
  const booking = target.table.table?.booking;
  const decided = copies.length + sequences.length + codes.length + stamps.length > 0;
  const codeLookups = codeLookupsOf(target.view, target.table.table);
  const rules =
    fills.length === 0 &&
    checks.length === 0 &&
    !decided &&
    rollupsInto.length === 0 &&
    ownRollups.length === 0 &&
    formulas.length === 0 &&
    scales.length === 0 &&
    defaultsFrom.length === 0 &&
    gapless.length === 0 &&
    seals.length === 0 &&
    normalizes.length === 0 &&
    codeLookups.length === 0 &&
    bounds.length === 0 &&
    states === undefined &&
    stateParents.length === 0 &&
    capacity === undefined &&
    capacityRules === undefined &&
    capacityOwners.length === 0 &&
    booking === undefined &&
    venueLocal.length === 0 &&
    perNight === undefined &&
    follows.length === 0
      ? null
      : {
          fills,
          checks,
          ...(decided ? { copies, sequences, codes, ...(stamps.length === 0 ? {} : { stamps }) } : {}),
          ...(rollupsInto.length === 0 ? {} : { rollupsInto }),
          ...(ownRollups.length === 0 ? {} : { ownRollups }),
          ...(readOnly.length === 0 ? {} : { readOnly }),
          ...(balances.length === 0 ? {} : { balances }),
          ...(formulas.length === 0 ? {} : { formulas }),
          ...(scales.length === 0 ? {} : { scales }),
          ...(currencyColumn === undefined ? {} : { currencyColumn }),
          ...(defaultsFrom.length === 0 ? {} : { defaultsFrom }),
          ...(gapless.length === 0 ? {} : { gapless, numbered }),
          ...(seals.length === 0 ? {} : { seals }),
          ...(normalizes.length === 0 ? {} : { normalizes }),
          ...(codeLookups.length === 0 ? {} : { codeLookups }),
          ...(bounds.length === 0 ? {} : { bounds }),
          ...(states === undefined ? {} : { states, ...(lockedBy.length === 0 ? {} : { lockedBy }) }),
          ...(stateParents.length === 0 ? {} : { stateParents }),
          ...(capacity === undefined ? {} : { capacity }),
          ...(capacityRules === undefined ? {} : { capacityRules }),
          ...(capacityOwners.length === 0 ? {} : { capacityOwners }),
          ...(booking === undefined ? {} : { booking }),
          ...(venueLocal.length === 0 ? {} : { venueLocal }),
          ...(perNight === undefined ? {} : { perNight }),
          ...(follows.length === 0 ? {} : { follows, followReads }),
        };
  CACHE.set(target.table, rules);
  return rules;
}

/** The balances a table keeps, each with the capped totals that guard it. */
function balancesOf(table: EffectiveTable): TableBalance[] {
  const capped = new Set(table.columns.filter((c) => c.rollup?.cap === true).map((c) => c.name));
  return table.columns.flatMap((column) => {
    const balance = column.rollup?.balance;
    if (balance === undefined) return [];
    const minus = balance.minus ?? [];
    return [
      {
        column: balance.column,
        of: balance.of,
        minus,
        total: column.name,
        scale: scaleOf(table.columns.find((c) => c.name === balance.column) ?? column),
        cappedBy: [column.name, ...minus].filter((name) => capped.has(name)),
      },
    ];
  });
}

/** The table and key a per-parent series' scope column points at, through a relation the snapshot has. */
function scopeParentOf(target: { view: SnapshotView; table: ResolvedTable }, scope: string | undefined): { scopeParent?: { table: string; column: string } } {
  if (scope === undefined) return {};
  const relation = target.view?.model?.relations.find(
    (r) => r.through === null && r.from.tableId === target.table.id && r.from.columns.length === 1 && r.from.columns[0] === scope,
  );
  return relation === undefined ? {} : { scopeParent: { table: relation.to.tableId, column: relation.to.columns[0] as string } };
}

/**
 * The names of the unique indexes that hold a series to one row per number:
 * over the number (or its text) alone, or with the scope column. An index
 * over other columns too would let a number repeat, so it does not count.
 */
function seriesKeys(table: EffectiveTable | undefined, scope: string | undefined, columns: readonly string[]): string[] {
  const allowed = new Set(scope === undefined ? [] : [scope]);
  const covers = (keyColumns: readonly string[]) =>
    keyColumns.every((column) => allowed.has(column) || columns.includes(column)) &&
    keyColumns.filter((column) => columns.includes(column)).length === 1;
  const names = new Set<string>();
  for (const unique of table?.uniques ?? []) if (unique.name !== null && covers(unique.columns)) names.add(unique.name);
  for (const index of table?.indexes ?? []) if (index.unique && !index.primary && covers(index.columns)) names.add(index.name);
  return [...names];
}

/**
 * The places a total or a balance keeps: its scale rule, else what the
 * database says (a table no app declared), else 2. SQLite reports no scale at
 * all, which is why an app's money columns carry the rule on every engine.
 */
function scaleOf(column: EffectiveColumn): Scale {
  return column.scale ?? column.numericScale ?? 2;
}

/** The places a formula's result is rounded to: its scale rule, else 0 for a whole number and 4 for a decimal. */
function formulaScale(column: EffectiveColumn): Scale {
  if (column.scale !== undefined) return column.scale;
  return column.logicalType === 'integer' || column.logicalType === 'bigint' ? 0 : 4;
}

/**
 * How large a number a formula column holds (see `ColumnFormula.limit`): a
 * 32-bit integer on every engine for an `integer` (SQLite would take more,
 * the other two would not), a 64-bit one for a `bigint`, and the declared
 * digits of a `numeric(p, s)`, which SQLite reports too.
 */
function limitOf(column: Pick<EffectiveColumn, 'logicalType' | 'numericPrecision' | 'numericScale'>): ColumnFormula['limit'] {
  if (column.logicalType === 'integer') return { max: 2_147_483_647n };
  if (column.logicalType === 'bigint') return { max: 9_223_372_036_854_775_807n };
  if (column.logicalType === 'decimal' && column.numericPrecision !== null && column.numericPrecision > 0) {
    return { digits: column.numericPrecision - (column.numericScale ?? 0) };
  }
  return undefined;
}

/** Whether a worked-out value fits the column's limit. */
function withinLimit(value: unknown, limit: NonNullable<ColumnFormula['limit']>): boolean {
  const text = String(value).trim().replace(/^[+-]/, '');
  if (!/^\d+(\.\d+)?$/.test(text)) return true;
  const whole = text.split('.')[0]!.replace(/^0+/, '');
  if ('digits' in limit) return whole.length <= limit.digits;
  return BigInt(whole === '' ? '0' : whole) <= limit.max;
}

/** A table's formulas, each after every formula column it reads. */
export function formulasOf(table: Pick<EffectiveTable, 'columns'>): ColumnFormula[] {
  const byName = new Map<string, EffectiveColumn>();
  for (const column of table.columns) if (column.formula !== undefined) byName.set(column.name, column);
  if (byName.size === 0) return [];
  // A cycle is refused where the rule is written; here it stops at the first repeat.
  const out: ColumnFormula[] = [];
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    const column = byName.get(name)!;
    const reads = formulaColumns(column.formula!);
    for (const read of reads) if (byName.has(read)) visit(read);
    const limit = limitOf(column);
    const lengths = [column.maxLength, column.validation?.maxLength].filter((n): n is number => typeof n === 'number' && n > 0);
    const joined = typeof column.formula === 'object' && 'join' in column.formula && lengths.length > 0 ? Math.min(...lengths) : undefined;
    out.push({
      column: name,
      expr: column.formula!,
      scale: formulaScale(column),
      reads,
      ...(limit === undefined ? {} : { limit }),
      ...(joined === undefined ? {} : { maxLength: joined }),
    });
  };
  for (const name of byName.keys()) visit(name);
  return out;
}

/** The formula columns that read `column`, directly or through another formula. */
export function derivedFrom(formulas: readonly ColumnFormula[], column: string): string[] {
  const out = new Set<string>();
  // In order, so a formula is seen after every formula it reads.
  for (const formula of formulas) {
    if (formula.reads.some((read) => read === column || out.has(read))) out.add(formula.column);
  }
  return [...out];
}

/** Every table's totals, per model: built once, so a total and the totals that climb from it are the same objects. */
const ROLLUPS = new WeakMap<object, Map<string, RollupInto[]>>();

/**
 * The totals of every table of a model, by table id, each knowing the totals
 * one table higher that add up what it moves (`RollupInto.climbs`).
 */
function modelRollups(model: { tables: readonly EffectiveTable[] }): Map<string, RollupInto[]> {
  const cached = ROLLUPS.get(model);
  if (cached !== undefined) return cached;
  const out = new Map<string, RollupInto[]>();
  for (const table of model.tables) {
    const totals = rollupsOf(table);
    if (totals.length > 0) out.set(table.id, totals);
  }
  const all = [...out.values()].flat();
  for (const rollup of all) {
    const moved = new Set([rollup.column, ...rollup.derived, ...rollup.balances.map((balance) => balance.column)]);
    rollup.climbs = all.filter(
      (above) =>
        above !== rollup &&
        above.child === rollup.parent &&
        [above.sum, above.times, above.unlessSet, above.where?.column].some((column) => column !== undefined && column !== '' && moved.has(column)),
    );
  }
  ROLLUPS.set(model, out);
  return out;
}

/** A table's totals, as the writes to its child rows settle them; none for a table without a one-column key. */
function rollupsOf(parent: EffectiveTable): RollupInto[] {
  if (parent.primaryKey?.length !== 1) return [];
  const balances = balancesOf(parent);
  const formulas = formulasOf(parent);
  const currencyColumn = parent.columns.some((column) => column.name === 'currency') ? 'currency' : undefined;
  const siblings: RollupInto[] = [];
  for (const column of parent.columns) {
    if (column.rollup !== undefined) {
      siblings.push(rollupOf(parent, column, column.rollup, balances, siblings, formulas, currencyColumn));
    }
  }
  return siblings;
}

/**
 * The balances a write to this total must keep at zero or above: those it is
 * part of that a capped total guards — as the total, as something taken off,
 * or as what the balance is worked out from (an invoice's total, lowered by
 * deleting a line after it was paid).
 */
export function guardedBy(rollup: Pick<RollupInto, 'column' | 'balances'> & { derived?: readonly string[] }): TableBalance[] {
  // Through the parent's formulas too: a line lowers the subtotal, the
  // subtotal the total a formula works out, and the balance is taken from it.
  const moves = new Set([rollup.column, ...(rollup.derived ?? [])]);
  return rollup.balances.filter(
    (balance) =>
      balance.cappedBy.length > 0 &&
      (balance.cappedBy.includes(rollup.column) || moves.has(balance.of) || balance.minus.some((column) => moves.has(column))),
  );
}

/** One of a parent's totals, as the writes to its child rows settle it. */
function rollupOf(
  parent: EffectiveTable,
  column: EffectiveColumn,
  rollup: NonNullable<EffectiveColumn['rollup']>,
  balances: TableBalance[],
  siblings: RollupInto[],
  formulas: ColumnFormula[],
  currencyColumn: string | undefined,
): RollupInto {
  const out: RollupInto = {
    parent: parent.id,
    parentKey: parent.primaryKey[0] as string,
    column: column.name,
    child: rollup.from,
    via: rollup.via,
    sum: rollup.sum ?? '',
    ...(rollup.count === true ? { count: true as const } : {}),
    ...(rollup.times === undefined ? {} : { times: rollup.times }),
    ...(rollup.unlessSet === undefined ? {} : { unlessSet: rollup.unlessSet }),
    ...(rollup.where === undefined ? {} : { where: rollup.where }),
    scale: scaleOf(column),
    balances,
    capped: false,
    siblings,
    climbs: [],
    formulas,
    ...(currencyColumn === undefined ? {} : { currencyColumn }),
    derived: derivedFrom(formulas, column.name),
  };
  out.capped = guardedBy(out).length > 0;
  return out;
}

/**
 * The values without the columns only Adminium writes: totals and balances
 * (the settle's), formulas (worked out after the hooks), and a gapless number
 * with its text (taken inside the write). A whole-row edit sends them back as
 * it read them; dropping them, rather than refusing the edit, keeps every form
 * working and the value Adminium's alone.
 *
 * An import is history, and keeps the numbers it brings: a studio moving its
 * past invoices keeps INV-0042 as INV-0042.
 */
export function withoutReadOnly(rules: TableRules | null, values: Row, origin?: WriteOrigin): Row {
  // An import brings in history: a stay's price as it was charged, not today's rates.
  const imported = origin === 'import' && rules?.perNight !== undefined ? rules.perNight.column : null;
  const dropped = [...(rules?.readOnly ?? []).filter((column) => column !== imported), ...(origin === 'import' ? [] : (rules?.numbered ?? []))];
  if (!dropped.some((column) => Object.prototype.hasOwnProperty.call(values, column))) return values;
  const out = { ...values };
  for (const column of dropped) delete out[column];
  return out;
}

/** Whether the table numbers its rows without gaps: undoing a create would hand its number out twice. */
export function numbersWithoutGaps(rules: TableRules | null): boolean {
  return (rules?.gapless?.length ?? 0) > 0;
}

// --- filling -----------------------------------------------------------------

function fillValue(fill: ColumnFill, ctx: FillContext): unknown {
  switch (fill.kind) {
    case 'now':
      return renderNow({ logicalType: fill.logicalType }, ctx.now);
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
    if (ctx.granted !== undefined && !ctx.granted(fill.column)) continue;
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

/** A yes or a no, in any spelling {@link booleanOf} reads — and the write path stores as the answer it names. */
function booleanIssue(value: unknown): FieldIssue | null {
  return booleanOf(value) === null ? { code: 'invalid' } : null;
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
  if (check.weekdays === true && weekdaysOf(value) === null) return { code: 'format' };
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

// --- text no engine keeps alike ----------------------------------------------

/**
 * The columns whose value holds U+0000, each refused `invalid-character`, or
 * `null` when none does.
 *
 * Postgres refuses the character in any text it is sent (and its escape in a
 * `jsonb` value), while MySQL and SQLite store it — so without this one
 * engine answered 500 and the other two kept a value that no Postgres copy,
 * export or later move of the data could hold. It is refused on every engine,
 * in every column, whatever type it has and whether or not the table has a
 * rule: no column takes it on all three. Raw bytes (a `Uint8Array`) are not
 * text and are not judged.
 */
export function unstorableText(values: Row, columns?: ReadonlyMap<string, { readonly logicalType: LogicalType }>): FieldIssues | null {
  let issues: FieldIssues | null = null;
  for (const [column, value] of Object.entries(values)) {
    if (holdsNul(value, columns?.get(column)?.logicalType === 'json')) (issues ??= {})[column] = { code: 'invalid-character' };
  }
  return issues;
}

/** Whether a column holds no answer: nothing, or only spaces. */
const blank = (value: unknown): boolean => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

/** Text columns MySQL compares by their collation, which ignores case (and, by default, accents). */
const FOLDED_TEXT: ReadonlySet<LogicalType> = new Set<LogicalType>(['text', 'varchar']);

/**
 * The value a literal database default stores, as the write path reads one:
 * `'away'::character varying` and `'away'` are `away` (MySQL 8 hands the bare
 * word), `true` is true, `3` is `3`. `undefined` for no default, or for one
 * worked out when the row is made (a clock, an expression).
 */
export function literalDefault(
  value: EffectiveColumn['default'] | undefined,
  /** The column's type: a text default is its text, even `true` or `a::b`. */
  logicalType?: string,
): unknown {
  if (value === null || value === undefined || value.kind !== 'literal') return undefined;
  const text = value.text.trim();
  const quoted = /^'((?:[^']|'')*)'(?:::.*)?$/s.exec(text);
  if (quoted !== null) return (quoted[1] ?? '').replace(/''/g, "'");
  if (logicalType !== undefined && !SCALAR_DEFAULT_TYPES.has(logicalType)) return value.text;
  const bare = text.replace(/::.*$/s, '');
  if (/^null$/i.test(bare)) return null;
  if (/^(true|false)$/i.test(bare)) return bare.toLowerCase() === 'true';
  return bare;
}

/** Types whose bare default is a number, a boolean or a typed NULL, not text. */
const SCALAR_DEFAULT_TYPES: ReadonlySet<string> = new Set(['boolean', 'integer', 'bigint', 'decimal', 'float']);

/** Whether two texts are one to a MySQL collation: no case, no accents, no spaces at the end. */
const foldedSame = (a: string, b: string): boolean => a.trimEnd().localeCompare(b.trimEnd(), 'en', { sensitivity: 'base' }) === 0;

/**
 * Whether a write changes a column: it sends it, and — when the stored row is
 * known — sends something other than what is stored. A whole-row form sends
 * every field back as it read it; one it did not change is no change.
 */
function changes(values: Row, stored: Row | null | undefined, column: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(values, column)) return false;
  if (stored === null || stored === undefined) return true;
  const [now, was] = [values[column], stored[column]];
  return !((blank(now) && blank(was)) || sameValue(now, was));
}

/** Whether a `requiredWhen` lists yes-or-no answers: its other column is read as a boolean. */
const readsBoolean = (when: ColumnRequiredWhen): boolean => when.in.some((listed) => typeof listed === 'boolean');

/**
 * The columns Adminium fills as surely as a default — nobody is asked for
 * them. A running number is claimed only after the check, so it is absent
 * there.
 */
function filledColumns(rules: TableRules): Set<string> {
  return new Set([
    ...rules.fills.filter((f) => f.kind !== 'none').map((f) => f.column),
    ...(rules.copies ?? []).map((c) => c.column),
    ...(rules.sequences ?? []).map((c) => c.column),
    ...(rules.codes ?? []).map((c) => c.column),
    ...(rules.stamps ?? []).map((c) => c.column),
    ...(rules.seals ?? []).map((c) => c.column),
    ...(rules.formulas ?? []).map((c) => c.column),
    ...(rules.numbered ?? []),
  ]);
}

/** Whether the other column's value is one the rule lists, as the database would compare it. */
export function requiredBy(check: Pick<ColumnCheck, 'requiredWhen' | 'requiredWhenFolds'>, value: unknown): boolean {
  const when = check.requiredWhen;
  if (when === undefined || blank(value)) return false;
  return when.in.some(
    (listed) => sameValue(value, listed) || (check.requiredWhenFolds === true && typeof value === 'string' && typeof listed === 'string' && foldedSame(value, listed)),
  );
}

/**
 * The issues in one row, or `null` when there are none.
 *
 * Only SUPPLIED keys are judged, on a create as much as on an update: what an
 * absent key means is the database's business (a default, a trigger, a NOT
 * NULL refusal), and pre-judging it is the preflight this module refuses to
 * have. The one exception is an admin's own "required" rule, which is asked
 * of the row as the write leaves it — `stored` is the row as it is, on an
 * update; on a create, a `requiredWhen`'s other column the write leaves out
 * is read as its database default.
 */
export function checkRow(
  rules: TableRules | null,
  action: WriteAction,
  values: Row,
  ctx: { dialect: Dialect; stored?: Row | null; columns?: ReadonlyMap<string, { readonly logicalType: LogicalType }> },
): FieldIssues | null {
  // Text no engine keeps alike is refused on a table with no rules too.
  let issues: FieldIssues | null = unstorableText(values, ctx.columns);
  if (rules === null) return issues;
  const add = (column: string, issue: FieldIssue): void => {
    issues ??= {};
    issues[column] ??= issue;
  };
  const filled = filledColumns(rules);
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
      if (blank(value) && (action === 'create' || supplied)) add(check.column, { code: 'required' });
    }
    /*
     * Required only while another column of the row holds a listed value (an
     * away event names who is away). Judged on the row as the write leaves
     * it, whenever the write touches either column: emptying this one, or
     * moving the other to a listed value over an empty one. A change to
     * neither leaves a row as it was, and is not judged.
     */
    const when = check.requiredWhen;
    if (when !== undefined && !filled.has(check.column)) {
      const sent = Object.prototype.hasOwnProperty.call(values, when.column);
      // A yes or a no the rule cannot read is no answer to it (SQLite keeps whatever it is given).
      if (sent && readsBoolean(when) && !blank(values[when.column]) && booleanOf(values[when.column]) === null) add(when.column, { code: 'invalid' });
      if (action === 'create' || changes(values, ctx.stored, check.column) || changes(values, ctx.stored, when.column)) {
        // A create that leaves the other column out gets the database's default there.
        const base = action === 'create' ? (sent || check.requiredWhenDefault === undefined ? {} : { [when.column]: check.requiredWhenDefault }) : (ctx.stored ?? {});
        const row = { ...base, ...values };
        if (blank(row[check.column]) && requiredBy(check, row[when.column])) add(check.column, { code: 'required' });
      }
    }
    if (!supplied) continue;
    const issue = issueFor(check, values[check.column], ctx.dialect);
    if (issue !== null) add(check.column, issue);
  }
  /*
   * A worked-out number the column cannot hold — the hours between two
   * moments centuries apart in a `numeric(6, 2)` — is refused here, on every
   * engine, rather than by the database (Postgres names no column, MySQL the
   * formula's, which nobody can edit, and SQLite keeps it). The columns it is
   * worked out from are named: the ones this write gave, else all of them.
   */
  for (const formula of rules.formulas ?? []) {
    const value = values[formula.column];
    if (formula.limit === undefined || value === null || value === undefined || withinLimit(value, formula.limit)) continue;
    const inputs = inputsOf(rules.formulas ?? [], formula);
    const given = inputs.filter((column) => Object.prototype.hasOwnProperty.call(values, column));
    for (const column of given.length > 0 ? given : inputs) add(column, { code: 'out-of-range' });
  }
  // A price by the night the column cannot hold, or a stay too long to price: its dates are named.
  const priced = rules.perNight;
  if (priced !== undefined) {
    for (const [column, issue] of Object.entries(priceIssuesOf(values) ?? {})) add(column, issue);
    const value = values[priced.column];
    if (priced.limit !== undefined && value !== null && value !== undefined && !withinLimit(value, priced.limit)) {
      const given = [priced.from, priced.to, priced.rate.via].filter((column) => Object.prototype.hasOwnProperty.call(values, column));
      for (const column of given.length > 0 ? given : [priced.to]) add(column, { code: 'out-of-range' });
    }
  }
  return issues;
}

// --- prices by the night, and copies that follow ------------------------------

/** `column.perNight`, resolved against the snapshot: where the night's rate and its adjustments are read. */
export interface ColumnPerNight {
  column: string;
  /** Date columns of the row: the first night, and the day after the last. */
  from: string;
  to: string;
  /** The row's foreign key, the table and key it points at, and the rate column there. */
  rate: { via: string; table: string; key: string; column: string };
  adjust?: {
    table: string;
    key: string;
    add: string;
    name: string;
    /** A foreign key of the adjustments to the rate's table; empty = every rate. */
    via?: string;
    weekdays?: string;
    from?: string;
    to?: string;
    where?: { column: string; eq: string | number | boolean };
  };
  scale: Scale;
  limit?: ColumnFormula['limit'];
}

/** A copy in another table's rows that follows a column of this table (`copy.follow`). */
export interface FollowOut {
  /** The child table's id, and its key. */
  child: string;
  childKey: string[];
  /** The child's foreign key to this table, and this table's column it matches. */
  via: string;
  key: string;
  /** The child's column, and this table's column it copies. */
  column: string;
  from: string;
}

const PRICE_ISSUES = Symbol('adminium.price-issues');

/** What pricing a row by the night refused (a stay too long to price), carried with its values to CHECK. */
export function attachPriceIssues<T extends Row>(values: T, issues: FieldIssues): T {
  (values as Record<symbol, unknown>)[PRICE_ISSUES] = issues;
  return values;
}

/** {@link attachPriceIssues}'s refusal, or undefined. */
export function priceIssuesOf(values: Row): FieldIssues | undefined {
  return (values as Record<symbol, unknown>)[PRICE_ISSUES] as FieldIssues | undefined;
}

/** A one-column foreign key of `tableId` through the model's relations: the table and key it points at. */
function linkOf(view: SnapshotView | undefined, tableId: string, column: string): { table: string; key: string } | undefined {
  const relation = view?.model?.relations.find(
    (r) => r.through === null && r.from.tableId === tableId && r.from.columns.length === 1 && r.from.columns[0] === column,
  );
  return relation === undefined ? undefined : { table: relation.to.tableId, key: relation.to.columns[0] as string };
}

/** This table's price by the night, resolved; undefined when it has none, or the snapshot lost a link it reads. */
function perNightOf(target: { view: SnapshotView; table: ResolvedTable }): ColumnPerNight | undefined {
  const column = (target.table.table?.columns ?? []).find((c) => c.perNight !== undefined);
  const rule = column?.perNight;
  if (column === undefined || rule === undefined) return undefined;
  const rate = linkOf(target.view, target.table.id, rule.rate.via);
  if (rate === undefined) return undefined;
  const limit = limitOf(column);
  const out: ColumnPerNight = {
    column: column.name,
    from: rule.from,
    to: rule.to,
    rate: { via: rule.rate.via, table: rate.table, key: rate.key, column: rule.rate.column },
    scale: column.scale ?? column.numericScale ?? 2,
    ...(limit === undefined ? {} : { limit }),
  };
  const adjust = rule.adjust;
  if (adjust !== undefined) {
    const table = target.view?.model?.tables.find((t) => t.id === adjust.table);
    const key = table?.primaryKey?.[0];
    if (table === undefined || key === undefined) return undefined;
    out.adjust = {
      table: adjust.table,
      key,
      add: adjust.add,
      name: adjust.name,
      ...(adjust.match.via === undefined ? {} : { via: adjust.match.via }),
      ...(adjust.match.weekdays === undefined ? {} : { weekdays: adjust.match.weekdays }),
      ...(adjust.match.from === undefined ? {} : { from: adjust.match.from }),
      ...(adjust.match.to === undefined ? {} : { to: adjust.match.to }),
      ...(adjust.where === undefined ? {} : { where: adjust.where }),
    };
  }
  return out;
}

/** The columns of this table a price by the night reads as days of the week (a rate rule's `weekdays`). */
function weekdayColumns(target: { view: SnapshotView; table: ResolvedTable }): string[] {
  const out = new Set<string>();
  for (const table of target.view?.model?.tables ?? []) {
    for (const column of table.columns ?? []) {
      const adjust = column.perNight?.adjust;
      if (adjust?.table === target.table.id && adjust.match.weekdays !== undefined) out.add(adjust.match.weekdays);
    }
  }
  return [...out];
}

/** The copies in other tables that follow a column of this table's rows. */
function followsOf(target: { view: SnapshotView; table: ResolvedTable }): FollowOut[] {
  const out: FollowOut[] = [];
  for (const table of target.view?.model?.tables ?? []) {
    for (const column of table.columns ?? []) {
      const copy = column.copy;
      if (copy?.follow !== true) continue;
      const link = linkOf(target.view, table.id, copy.via);
      if (link === undefined || link.table !== target.table.id) continue;
      out.push({ child: table.id, childKey: [...(table.primaryKey ?? [])], via: copy.via, key: link.key, column: column.name, from: copy.from });
    }
  }
  return out;
}

/** The columns whose change can move a followed column: each followed column, and what works it out (its formula's and its price's inputs). */
function followReadsOf(formulas: readonly ColumnFormula[], perNight: ColumnPerNight | undefined, follows: readonly FollowOut[]): string[] {
  const out = new Set<string>();
  const visit = (column: string): void => {
    if (out.has(column)) return;
    out.add(column);
    const formula = formulas.find((f) => f.column === column);
    for (const read of formula?.reads ?? []) visit(read);
    if (perNight?.column === column) for (const read of [perNight.from, perNight.to, perNight.rate.via]) visit(read);
  };
  for (const follow of follows) visit(follow.from);
  return [...out];
}

/**
 * The rules with every `requiredWhen` left out — what the outbox's own writes
 * to its own table are judged by. A rule that watches a column the outbox
 * writes (a note required once a message is `sent`) is refused where it is
 * made, by the manifest and by Studio; one kept from before, or written
 * around both, must not refuse the write that marks a message sent and leave
 * it stuck.
 */
export function withoutRequiredWhen(rules: TableRules | null): TableRules | null {
  if (rules === null || !rules.checks.some((check) => check.requiredWhen !== undefined)) return rules;
  return {
    ...rules,
    checks: rules.checks.map((check) => {
      if (check.requiredWhen === undefined) return check;
      const { requiredWhen: _when, requiredWhenDefault: _default, requiredWhenFolds: _folds, ...rest } = check;
      return rest;
    }),
  };
}

/** The columns a formula is worked out from, through the formulas it reads. */
function inputsOf(formulas: readonly ColumnFormula[], formula: ColumnFormula, seen = new Set<string>()): string[] {
  const out: string[] = [];
  for (const read of formula.reads) {
    const through = formulas.find((other) => other.column === read);
    if (through === undefined) {
      if (!out.includes(read)) out.push(read);
    } else if (!seen.has(read)) {
      seen.add(read);
      for (const column of inputsOf(formulas, through, seen)) if (!out.includes(column)) out.push(column);
    }
  }
  return out;
}

/**
 * What an UPDATE judged by a `requiredWhen` must still find in the row when it
 * runs: another writer may change the row between the read and the
 * statement. One writer moves an event to away, having read a person on it;
 * another empties the person, having read the event in the office. Each
 * passes on what it read, and together they leave an away event naming
 * nobody. So a write that moves the other column to a listed value over a
 * person it did not send asks that the person still be there (`filled`), and
 * one that empties the column over another column it did not send asks that
 * the other still hold none of the values (`unlisted`) — in the statement's
 * own WHERE, where the database compares them as it holds them. A row the
 * statement then misses is refused as the check would have refused it.
 */
export type RequiredGuard =
  | { column: string; kind: 'filled'; text: boolean }
  | { column: string; kind: 'unlisted'; other: string; values: readonly (string | number | boolean)[] };

const REQUIRED_GUARDS = Symbol('adminium.requiredGuards');

type Guarded = Row & { [REQUIRED_GUARDS]?: RequiredGuard[] };

/**
 * The guards an update's values need (see {@link RequiredGuard}); none on a
 * create or a delete. A column the write sends is written by it, so only one
 * it leaves out can be changed under it.
 */
export function requiredGuards(rules: TableRules | null, action: WriteAction, values: Row, stored: Row | null): RequiredGuard[] {
  if (rules === null || action !== 'update') return [];
  const filled = filledColumns(rules);
  const out: RequiredGuard[] = [];
  for (const check of rules.checks) {
    const when = check.requiredWhen;
    if (when === undefined || filled.has(check.column)) continue;
    const own = Object.prototype.hasOwnProperty.call(values, check.column);
    const other = Object.prototype.hasOwnProperty.call(values, when.column);
    if (!own && changes(values, stored, when.column) && requiredBy(check, values[when.column])) {
      out.push({ column: check.column, kind: 'filled', text: FOLDED_TEXT.has(check.logicalType) });
    } else if (!other && changes(values, stored, check.column) && blank(values[check.column])) {
      out.push({ column: check.column, kind: 'unlisted', other: when.column, values: when.in });
    }
  }
  return out;
}

/** The values with their guards attached (a copy; the symbol survives every spread on the way to the statement). */
export function attachRequiredGuards<T extends Row>(row: T, guards: readonly RequiredGuard[]): T {
  if (guards.length === 0) return row;
  const out = { ...row } as T & Guarded;
  out[REQUIRED_GUARDS] = [...guards];
  return out;
}

export function requiredGuardsOf(row: Row): RequiredGuard[] | undefined {
  return (row as Guarded)[REQUIRED_GUARDS];
}
