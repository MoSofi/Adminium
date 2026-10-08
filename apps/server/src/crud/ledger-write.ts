// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN ADD-ON'S PLAN MAY WRITE — judged before the first row goes in.
 *
 * An add-on's code never writes. It answers a plan: rows to insert into the
 * ledger's own tables, rows of them to change, amounts it was asked to
 * decide. Adminium writes the plan itself — after four checks, each of which
 * fails the whole save with nothing written:
 *
 *  1. TABLE — every row is for a table the ledger declares it writes (and
 *     the action, when it narrows that list), with only the columns listed
 *     for an insert or an update, an update named by the declared key.
 *  2. ROW — every link a row carries, and every row an update names, is one
 *     this call was shown: a row one of its reads returned, a row this same
 *     plan inserts earlier, a link the host's row handed in, a link of a
 *     returned row to that same table, or a row its own round wrote. A plan
 *     cannot reach a row it was never given.
 *  3. OPERATION — no column Adminium decides (a total, a balance, a formula),
 *     never the receipt's own link, never a delete.
 *  4. DECIDES — an amount is given only for an input the action declares as
 *     decided and the host's rule maps, for a line of this call, between
 *     zero and the ceiling Adminium reads itself.
 *
 * Which check failed is written to the audit log and never told to the
 * person saving: to them the add-on's plan failed.
 */
import { postingOutputSchema, type PostingOutput, type PostingUse } from '@adminium/add-on-contracts';
import type { LedgerAction } from '@adminium/manifest';
import type { Kysely } from 'kysely';

import { callDecider, DeciderFailed, withDeciders, type InstalledDecider } from '../add-ons/decide.js';
import type { SourceDatabase } from '../connections/manager.js';
import { ConflictError, PostingRefusedError, ValidationFailedError } from '../errors.js';
import type { LedgerRuntime, ResolvedLedger } from '../ledgers/registry.js';
import { heldNames, LockMoved, type NamedLock } from './capacity/locks.js';
import { bindWriteValue } from './write-values.js';
import { judgePlanned } from './ledger-judge.js';
import type { ClimbStart, HeldBalances } from './climb.js';
import type { ColumnCode, RollupInto, TableRules } from './column-rules.js';
import { readDbRefusal, writeConflict } from './db-errors.js';
import { isUniqueViolation } from './decided-columns.js';
import { outboundKey } from '../documents/compose.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import { firedPoints, frozenColumns, lineTaken, ownPoint, postingScope, standsAt, type DeclaredPosting, type FiredPoint, type PostingPhaseName } from './ledger-points.js';
import { LedgerTooLarge, ledgerSettings, linesOf, lockNames, mapInputs, runReads, type LineInputs, type MappedLine, type ReadContext, type ScalarRow } from './ledger-reads.js';
import { openRounds, phaseDue, receiptsOfLine, receiptsOfSource, roundOf, roundRows, type Receipt, type RoundState } from './ledger-receipts.js';
import type { Row } from './mask.js';
import { instantOf, RecordLocked, StateMoveRefused } from './states.js';
import { sameValue } from './write-values.js';
import type { WriteClock } from './write-clock.js';
import type { WriteContext, WriteTarget } from './write-context.js';
import { venueClock } from './venue-time.js';

type Db = Kysely<SourceDatabase>;

type Scalar = string | number | boolean;

/** One row of a plan, as the contract shapes it. */
export type PlannedRow =
  | { op: 'insert'; table: string; label?: string | undefined; line: string; values: Record<string, Scalar | { '@row': string } | null> }
  | { op: 'update'; table: string; line: string; key: Record<string, Scalar>; set: Record<string, Scalar | null> };

export interface PlannedOutput {
  rows: PlannedRow[];
  decides?: { line: string; input: string; value: string }[] | undefined;
}

/** What the checks read of one of the ledger's tables, by the add-on's own name for it. */
export interface LedgerTableFacts {
  /** Its key columns. */
  key: readonly string[];
  /** Each column that links to another of the add-on's tables, and which. */
  links: Readonly<Record<string, string>>;
  /** The columns Adminium decides on it: a plan gives none of them. */
  decided: ReadonlySet<string>;
  /** Code columns a row the plan adds may bring a code for (`rules.code.givenByLedger`), each with its prefix and the column's width. */
  givenCodes?: ReadonlyMap<string, { prefix: string; max?: number | undefined }>;
}

export interface WriteScopeByRef {
  insert?: readonly string[] | undefined;
  update?: { by: readonly string[]; set: readonly string[] } | undefined;
}

export interface CheckInput {
  /** The ledger's `writes`, by the add-on's own table names. */
  writes: Readonly<Record<string, WriteScopeByRef>>;
  action: Pick<LedgerAction, 'inputs' | 'reads' | 'decides' | 'writes'>;
  tables: Readonly<Record<string, LedgerTableFacts>>;
  /** What the action's reads returned in this call, by read name. */
  reads: Readonly<Record<string, readonly ScalarRow[]>>;
  /** The lines of this call, with the inputs the host's rule mapped. */
  lines: readonly { line: string; inputs: LineInputs }[];
  /** What this round has written, by table. */
  written: Readonly<Record<string, readonly ScalarRow[]>>;
  /** The inputs the host's rule maps: a decision is taken only for one of them. */
  mapped: ReadonlySet<string>;
}

/** The four words the audit log knows a failed plan by. */
export type ScopeCause = 'scope-table' | 'scope-row' | 'scope-op' | 'scope-decides';
export type CheckResult = { ok: true } | { ok: false; cause: ScopeCause; detail: string };

/** The link a plan's rows carry back to their receipt: Adminium's own to write. */
export const RECEIPT_LINK = 'receipt_id';

const fail = (cause: ScopeCause, detail: string): CheckResult => ({ ok: false, cause, detail });
/** Whether a plan's key names the row a shown key names — as the database would match them, never as loosely as two values read alike ("0042" is not 42). */
const sameKey = (shown: unknown, given: unknown): boolean => shown !== null && shown !== undefined && given !== null && given !== undefined && typeof given !== 'object' && String(shown) === String(given);
const filled = (value: unknown): boolean => value !== null && value !== undefined && value !== '';

/** Decimal text compared as a number, with no float in between. */
export function compareDecimalText(a: string, b: string): -1 | 0 | 1 {
  const parts = (text: string): { negative: boolean; whole: string; fraction: string } => {
    const negative = text.startsWith('-');
    const [whole = '0', fraction = ''] = (negative ? text.slice(1) : text).split('.');
    return { negative, whole: whole.replace(/^0+(?=\d)/, ''), fraction };
  };
  const x = parts(a);
  const y = parts(b);
  const width = Math.max(x.fraction.length, y.fraction.length);
  const scaled = (p: { negative: boolean; whole: string; fraction: string }): bigint => BigInt(`${p.whole}${p.fraction.padEnd(width, '0')}` || '0') * (p.negative ? -1n : 1n);
  const left = scaled(x);
  const right = scaled(y);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Every row of a table this call was shown: by a read, or as what its round wrote. */
function shownRows(input: CheckInput, table: string): ScalarRow[] {
  const out: ScalarRow[] = [];
  for (const read of input.action.reads) if (read.table === table) out.push(...(input.reads[read.as] ?? []));
  out.push(...(input.written[table] ?? []));
  return out;
}

/** Every key of a table a plan's row may point at. */
function knownKeys(input: CheckInput, table: string): unknown[] {
  const facts = input.tables[table];
  const keyColumn = facts?.key.length === 1 ? facts.key[0]! : null;
  const keys: unknown[] = [];
  if (keyColumn !== null) for (const row of shownRows(input, table)) keys.push(row[keyColumn]);
  // A link the host's row handed in — to this table: the one a read of the action finds by its key from that input.
  const linked = new Set<string>();
  for (const read of input.action.reads) {
    if (read.table !== table) continue;
    for (const by of read.by) {
      if (by.column !== keyColumn) continue;
      for (const from of Array.isArray(by.from) ? by.from : [by.from]) if (from.startsWith('input.')) linked.add(from.slice('input.'.length));
    }
  }
  for (const line of input.lines) {
    for (const [name, type] of Object.entries(input.action.inputs)) {
      const value = line.inputs[name];
      if (linked.has(name) && (type === 'link' || type === 'link?') && filled(value) && typeof value !== 'object') keys.push(value);
    }
  }
  // A link of a row it was shown, to this same table.
  for (const [other, otherFacts] of Object.entries(input.tables)) {
    for (const [column, target] of Object.entries(otherFacts.links)) {
      if (target !== table) continue;
      for (const row of shownRows(input, other)) if (filled(row[column])) keys.push(row[column]);
    }
  }
  return keys;
}

/** A code as a ledger's answer may give one: what follows its prefix, in the letters and digits a code is typed in. */
const GIVEN_CODE = /^[0-9A-Z]{4,16}$/;

/** The four checks, in order, over one call's plan. */
export function checkOutput(input: CheckInput, output: PlannedOutput): CheckResult {
  const allowed = input.action.writes === undefined ? null : new Set(input.action.writes);
  const labels = new Map<string, string>();
  const known = new Map<string, unknown[]>();
  const keysOf = (table: string): unknown[] => {
    const hit = known.get(table);
    if (hit !== undefined) return hit;
    const found = knownKeys(input, table);
    known.set(table, found);
    return found;
  };

  for (const [i, row] of output.rows.entries()) {
    const at = `rows.${String(i)}`;
    // 1. The table, the operation it takes, the columns it lists.
    const scope = input.writes[row.table];
    if (scope === undefined || (allowed !== null && !allowed.has(row.table))) return fail('scope-table', `${at}: "${row.table}" is not a table this action writes`);
    const facts = input.tables[row.table];
    if (facts === undefined) return fail('scope-table', `${at}: "${row.table}" is not a table of the add-on here`);
    const given = row.op === 'insert' ? Object.keys(row.values) : Object.keys(row.set);
    if (row.op === 'insert') {
      if (scope.insert === undefined) return fail('scope-table', `${at}: "${row.table}" takes no insert`);
      for (const column of given) if (!scope.insert.includes(column)) return fail('scope-table', `${at}: "${row.table}.${column}" is not a column an insert may give`);
    } else {
      if (scope.update === undefined) return fail('scope-table', `${at}: "${row.table}" takes no update`);
      if (Object.keys(row.key).sort().join(',') !== [...scope.update.by].sort().join(',')) return fail('scope-table', `${at}: a row of "${row.table}" is named by ${scope.update.by.join(', ')}`);
      for (const column of given) if (!scope.update.set.includes(column)) return fail('scope-table', `${at}: "${row.table}.${column}" is not a column a change may give`);
    }

    // 3. Nothing Adminium decides, and never the receipt's own link.
    for (const column of given) {
      if (column === RECEIPT_LINK) return fail('scope-op', `${at}: "${RECEIPT_LINK}" is written by Adminium`);
      // A code its rule lets an added row bring: held to what a code is, and never written by a change.
      const givenCode = row.op === 'insert' ? facts.givenCodes?.get(column) : undefined;
      if (givenCode !== undefined) {
        const value: unknown = row.op === 'insert' ? row.values[column] : undefined;
        if (value === null || value === undefined) continue;
        // The prefix is part of the code (a card's code with no `GC-` could be a discount's word), and the whole of it fits the column.
        if (typeof value !== 'string' || !value.startsWith(givenCode.prefix) || !GIVEN_CODE.test(value.slice(givenCode.prefix.length)) || (givenCode.max !== undefined && value.length > givenCode.max)) {
          return fail('scope-op', `${at}: "${row.table}.${column}" is given a code that is not one: ${givenCode.prefix === '' ? '' : `"${givenCode.prefix}" and `}4 to 16 capital letters and digits`);
        }
        continue;
      }
      if (facts.decided.has(column)) return fail('scope-op', `${at}: "${row.table}.${column}" is a column Adminium decides`);
    }

    // 2. Every row it points at, or names, is one this call was shown.
    const values: Record<string, unknown> = row.op === 'insert' ? row.values : row.set;
    for (const [column, target] of Object.entries(facts.links)) {
      const value = values[column];
      if (!filled(value)) continue;
      if (typeof value === 'object' && value !== null) {
        const label = (value as { '@row': string })['@row'];
        // A row this same plan inserts EARLIER, into the table the link names.
        if (labels.get(label) !== target) return fail('scope-row', `${at}: "${column}" names "${label}", which no earlier row of "${target}" carries`);
        continue;
      }
      if (!keysOf(target).some((key) => sameKey(key, value))) return fail('scope-row', `${at}: "${row.table}.${column}" names a row of "${target}" this call was not shown`);
    }
    // A `{'@row'}` anywhere but in a link names nothing.
    for (const [column, value] of Object.entries(values)) {
      if (typeof value === 'object' && value !== null && facts.links[column] === undefined) return fail('scope-row', `${at}: "${row.table}.${column}" is no link, so it takes no "@row"`);
    }
    if (row.op === 'update') {
      const named = shownRows(input, row.table).some((shown) => Object.entries(row.key).every(([column, value]) => sameKey(shown[column], value)));
      if (!named) return fail('scope-row', `${at}: the row of "${row.table}" it changes is not one this call was shown`);
    } else if (row.label !== undefined) {
      if (labels.has(row.label)) return fail('scope-row', `${at}: the label "${row.label}" is given twice`);
      labels.set(row.label, row.table);
    }
  }

  // 4. What it was asked to decide, within the bounds Adminium reads itself.
  const lines = new Map(input.lines.map((line) => [line.line, line]));
  const once = new Set<string>();
  for (const [i, decided] of (output.decides ?? []).entries()) {
    const at = `decides.${String(i)}`;
    if (once.has(`${decided.line}\u0000${decided.input}`)) return fail('scope-decides', `${at}: "${decided.input}" is decided twice for one line`);
    once.add(`${decided.line}\u0000${decided.input}`);
    const bounds = (input.action.decides ?? []).filter((entry) => entry.input === decided.input);
    if (bounds.length === 0) return fail('scope-decides', `${at}: "${decided.input}" is not an input this action decides`);
    if (!input.mapped.has(decided.input)) return fail('scope-decides', `${at}: the rule maps no column to "${decided.input}"`);
    const line = lines.get(decided.line);
    if (line === undefined) return fail('scope-decides', `${at}: "${decided.line}" is not a line of this call`);
    if (!/^-?\d+(\.\d+)?$/.test(decided.value)) return fail('scope-decides', `${at}: the value is not a decimal`);
    if (compareDecimalText(decided.value, '0') < 0) return fail('scope-decides', `${at}: below zero`);
    // Every entry for the input must hold.
    for (const bound of bounds) {
      const ceilings: unknown[] = 'input' in bound.max ? [line.inputs[bound.max.input]] : (input.reads[bound.max.read] ?? []).map((row) => row[(bound.max as { column: string }).column]);
      if (ceilings.length === 0) return fail('scope-decides', `${at}: there is no ceiling to read for "${decided.input}"`);
      for (const ceiling of ceilings) {
        if (!filled(ceiling) || typeof ceiling === 'object' || !/^-?\d+(\.\d+)?$/.test(String(ceiling))) return fail('scope-decides', `${at}: the ceiling of "${decided.input}" is not a number`);
        if (compareDecimalText(decided.value, String(ceiling)) > 0) return fail('scope-decides', `${at}: above its ceiling`);
      }
    }
  }
  return { ok: true };
}

// ─── the writer ──────────────────────────────────────────────────────────────

/*
 * A SAVE THAT POSTS. Two halves, around the save's own lock call:
 *
 *  PEEK — before the transaction, on the pool, holding nothing. Which rules
 *  does this write fire; is each one's add-on there; what does each read;
 *  which rows of the add-on does it stand on. The names of those rows join
 *  the save's own locks, so two saves that take from the same item wait for
 *  each other and two that do not never do. Named again on every attempt.
 *
 *  POST — inside the transaction, after the host's own row is written and
 *  settled. For each call, in order: is this phase already done for this
 *  round (a save told twice writes once); read again under the locks; ask
 *  the add-on's code; check its plan; write a receipt, then the plan's rows,
 *  as Adminium's own writes with the tables' own rules; settle every total
 *  the rows move, once. Any refusal rolls the whole save back.
 */
export type { PostingState } from '../ledgers/registry.js';

/** One phase of one rule, for one source row, with the add-on that answers it. */
export interface PostingCall {
  posting: DeclaredPosting;
  phase: PostingPhaseName;
  ledger: ResolvedLedger;
  action: LedgerAction;
  /** The code that plans; null when the add-on cannot be asked. */
  decider: InstalledDecider | null;
  /** `off`: the owner switched the rule off — only an open round is given back. */
  off: boolean;
  /** Why it cannot be asked, when it cannot. */
  unavailable: string | null;
  /**
   * What the written row is to the rule: its `source`; the `parent` whose
   * lines of another table are all handed, in one call; or one `line`, handed
   * alone with the row its `via` names as the source.
   */
  role: 'source' | 'parent' | 'line';
  /** Where the lines are (`parent`), or where the line's parent is (`line`). */
  link?: { table: ResolvedTable; via: string; parentKey: string } | undefined;
  /**
   * A line made under a parent whose other lines already reached this phase:
   * it runs only when their receipts say so.
   */
  late?: boolean | undefined;
  /** Planning what an unplanned receipt of this phase stands for (see `OnePhase.catchUp`). */
  catchUp?: boolean | undefined;
  /** Giving back only what these receipts still keep until a time (see `OnePhase.kept`). */
  kept?: ReadonlySet<string> | undefined;
}

/** One row of a create with child rows: the root first. */
export interface TreeRowIn {
  target: WriteTarget;
  rules: TableRules | null;
  /** The root as prepared, a child as previewed — or each as written. */
  row: Row;
  /** The place, in the same list, of the row it was made under; null for the root. */
  parent?: number | null | undefined;
  path?: readonly (string | number)[] | undefined;
}

/** One line of a call: the row whose columns are mapped, and the row its `{parent}` mappings read. */
interface CallLine {
  /** Its key as a receipt writes it; `''` when the row is the source itself. */
  key: string;
  /** Its table's stored name; `''` when the row is the source itself. */
  ref: string;
  table: ResolvedTable;
  row: Row;
  parent: { table: ResolvedTable; row: Row } | null;
}

/**
 * What a price question recorded for one order, handed to the posting its
 * rule names as recording uses: before the locks, every row a use could be
 * of (so its locks are named); inside the save, the uses it really has.
 * `key` absent: any row of the table (a row not written yet has no key).
 */
export interface UsesFor {
  table: string;
  posting: string;
  key?: string | undefined;
  uses: readonly PostingUse[];
}

/** What a call stands on: the source row, and the lines it hands over. */
interface Gathered {
  source: { table: ResolvedTable; ref: string; row: Row; key: string };
  lines: CallLine[];
}

/** What one call did, for whoever the save answers and for the audit. */
export interface PostedOutcome {
  addOn: string;
  ledger: string;
  action: string;
  posting: string;
  phase: PostingPhaseName;
  round: number;
  rows: number;
  version: string;
  state: 'planned' | 'unplanned';
  source: { table: string; row: string };
  /** The source row itself: its table here and its key. */
  record?: { table: ResolvedTable; pk: Row } | undefined;
  /**
   * The rows whose announced figures the call's settle moved (an item that
   * turned low): each with the announced columns as they were before. Told
   * after the save, as a change of the row nobody made by hand.
   */
  announced?: { table: ResolvedTable; pk: Row; was: Row; changed: string[] }[] | undefined;
  /** The lines this call wrote a receipt for (`''`: the source row itself). */
  lines: string[];
  notes: { line: string; note: string; item?: string | undefined }[];
  written: { table: ResolvedTable; row: Row; before: Row | null }[];
  /** Each amount Adminium decided, and the column of the source row it was written to. */
  decided: { line: string; input: string; column: string; value: string }[];
  /**
   * A quote's answer (a dry run): what a save would be told. Nothing was
   * written to any table of the add-on, and a ledger's refusal is an answer
   * here, never a failure.
   */
  quote?: { state: 'ok' | 'refused' | 'unavailable'; reason?: string; line?: number; path?: (string | number)[]; left?: string; item?: string } | undefined;
  /** Which answer a customer hears of this ledger's own refusal: out of stock, or a refused card. */
  family?: 'stock' | 'value' | undefined;
  /** What is left as a customer may be told it (the owner's own setting), on a quote that was refused. */
  publicLeft?: string | undefined;
  /** The tables a refused quote's `left` and `item` were read from: told only to somebody who may read them all. */
  readers?: LedgerReaders | undefined;
}

/** The tables a figure of a ledger's refusal was read from. */
export interface LedgerReaders {
  connectionId: string;
  tables: readonly string[];
}

/** Where a refusal's figures come from, when it carries any: beside its details, never in them. */
export const readersOf = (error: unknown): LedgerReaders | undefined => (error as { ledgerReaders?: LedgerReaders } | null | undefined)?.ledgerReaders;

/** One phase of one rule of a table, named: what `post` runs for a stored row. */
export interface OnePhase {
  posting: string;
  phase: PostingPhaseName;
  /**
   * The catch-up: the phase went through while the add-on could not answer
   * and left a receipt nobody planned. It is planned now, against that same
   * receipt and its round — nothing new is started.
   */
  catchUp?: boolean | undefined;
  /**
   * The timed release: a giving back of only what THESE receipts (by id)
   * still keep until a time. A line whose hold was taken for good or given
   * back since they were read, or that never was among them, is left alone.
   */
  kept?: ReadonlySet<string> | undefined;
}

export interface Peek {
  calls: PostingCall[];
  /** The add-ons whose gates the save enters as a reader. */
  addOns: string[];
  /** The names this write stands on, from a fresh look: called once per attempt, before the transaction. */
  names(row: Row): Promise<NamedLock[]>;
  /**
   * Every table a plan may write, and each ledger's receipts, with what the
   * connection's role may do there — resolved before the transaction, where
   * it may wait on the pool. Inside it nothing asks again.
   */
  tables: ReadonlyMap<string, WriteTarget>;
}

/** What the writer takes from the write service it is built in. */
/**
 * The clock an add-on's code is handed: the instant, the venue's zone, and
 * TODAY AS THE VENUE'S CALENDAR READS IT. The instant's own date is UTC's —
 * at six in the evening in Portland it is already tomorrow there, and a
 * batch good until today would be judged expired.
 */
export function plannerClock(at: Date, timezone: string | undefined): { now: string; today: string; zone: string } {
  const zone = timezone ?? 'UTC';
  try {
    return { now: at.toISOString(), today: venueClock(at, zone).day, zone };
  } catch {
    // A stored zone no calendar knows (typed by hand long ago): the save is not stopped for it; UTC's day stands.
    return { now: at.toISOString(), today: at.toISOString().slice(0, 10), zone };
  }
}

export interface LedgerKit {
  ledgers: LedgerRuntime | undefined;
  rulesOf(target: WriteTarget): TableRules | null;
  withRights(target: WriteTarget): Promise<WriteTarget>;
  /** A planned row prepared as a create of the ledger's table: filled, decided, worked out and checked, with no hook. */
  prepare(target: WriteTarget, values: Row, context: WriteContext, clock: WriteClock): Promise<{ rules: TableRules | null; checked: Row; codes: readonly ColumnCode[] }>;
  /** The prepared row, written (a code that collides is made again). */
  insert(target: WriteTarget, checked: Row, codes: readonly ColumnCode[]): Promise<Row>;
  /** A row written exactly as given, with no rule of the table applied: a receipt, which only Adminium writes. */
  insertRaw(target: WriteTarget, values: Row): Promise<Row>;
  /** A row of a ledger table, held for the rest of the save; undefined when it is not there. */
  fetchHeld(target: WriteTarget, key: Row): Promise<Row | undefined>;
  /**
   * A planned change of a row held by its key, written as Adminium's own:
   * stamps, formulas and checks from the stored row, a state move judged as a
   * listed move whatever the saver's role. Answers the row as it stands after.
   */
  change(target: WriteTarget, set: Row, key: Row, before: Row, context: WriteContext, clock: WriteClock): Promise<Row | null>;
  /**
   * Amounts decided for the row that posted, written to its own columns: its
   * formulas worked out again, its totals settled. Answers the row after.
   */
  decide(target: WriteTarget, pk: Row, set: Row, before: Row): Promise<Row | null>;
  /** Whether a table keeps a limit its rows take from. */
  limited(target: WriteTarget): boolean;
  /** The names of the pools these rows would take from, read on the handle of each target with nothing held. */
  poolNames(rows: readonly { target: WriteTarget; row: Row; before: Row | null }[]): Promise<NamedLock[]>;
  /** The limits these rows take from, judged once under the save's locks, the rows already written. */
  judge(db: Db, rows: readonly { target: WriteTarget; pk: Row; row: Row; before: Row | null }[], context: WriteContext, clock: WriteClock): Promise<void>;
  /** A row of a table read as it is, holding nothing; undefined when it is not there. */
  fetch(target: WriteTarget, key: Row): Promise<Row | undefined>;
  /** A row of the add-on's that only Adminium writes (a receipt), changed as given. */
  updateRaw(target: WriteTarget, set: Row, key: Row): Promise<void>;
  /** Whether project code changes a row of the table before it is written. */
  hooked(target: WriteTarget, action: 'create' | 'update', context: WriteContext): Promise<boolean>;
  /** Refuses when the connection's role may not write these columns, or the totals a row of the table climbs into. */
  refuseUngranted(target: WriteTarget, action: 'create' | 'update', columns: readonly string[]): Promise<void>;
  starts(rules: TableRules | null, rows: readonly { record: Row | null; before: Row | null }[]): ClimbStart[];
  hold(target: WriteTarget, starts: readonly ClimbStart[]): Promise<HeldBalances>;
  settle(target: WriteTarget, starts: readonly ClimbStart[], held: HeldBalances): Promise<void>;
  /**
   * The rows that keep a copy of this one in step, brought into step: a row
   * an add-on's answer changed is followed as one a person changed is (an
   * order its last delivery closed reads closed on its lines and receipts).
   */
  follow(target: WriteTarget, rules: TableRules | null, before: Row, after: Row): Promise<void>;
}

const ORIGINS: Readonly<Record<string, 'staff' | 'public' | 'system'>> = { public: 'public', automation: 'system', import: 'system', hook: 'system', action: 'system' };
/** Who a write is, as an add-on is told: a customer, the system, or staff. */
export const postingOrigin = (context: Pick<WriteContext, 'origin'>): 'staff' | 'public' | 'system' => ORIGINS[context.origin] ?? 'staff';

const refused = (reason: string, call: Pick<PostingCall, 'ledger' | 'posting'> | null, more: Record<string, unknown> = {}): PostingRefusedError =>
  // `family`: which of the two answers a customer hears (out of stock, a refused card) when the reason is the ledger's own.
  new PostingRefusedError(REFUSAL_WORDS[reason] ?? 'The add-on refused this.', { reason, ...(call === null ? {} : { ledger: call.ledger.id, posting: call.posting.id, family: call.ledger.refusal }), ...more });

const REFUSAL_WORDS: Readonly<Record<string, string>> = {
  'add-on-unavailable': 'The add-on this depends on cannot be asked right now, so this cannot be saved.',
  'planner-failed': 'The add-on this depends on did not answer as it should, so nothing was saved.',
  'too-large': 'This is more than can be posted in one save.',
  'mapped-changed': 'What this row handed to the add-on is still open: put it back first, then change it.',
  'receipt-open': 'What this row handed to the add-on is still open: put it back first.',
  'card-pays-card': 'This cannot be paid for this way.',
  'one-at-a-time': 'This is saved one row at a time: it hands something to an add-on.',
  hooked: 'Project code changes a table the add-on keeps, so nothing can be posted to it inside a save.',
  guarded: 'A table the add-on keeps takes a lock of its own, so nothing can be posted to it inside a save.',
  'out-of-stock': 'There is not enough left.',
  'over-limit': 'This would go over a limit.',
};

/** A plan that failed, with the word the audit log keeps for why: never told to the person saving. */
export class PlanFailed extends PostingRefusedError {
  constructor(
    call: Pick<PostingCall, 'ledger' | 'posting'>,
    readonly cause: string,
    readonly detail: string,
  ) {
    super(REFUSAL_WORDS['planner-failed']!, { reason: 'planner-failed', ledger: call.ledger.id, posting: call.posting.id });
  }
}

/** A row's key as a receipt writes it; `''` for a row not written yet (it has no receipt to be found by). */
const keyText = (table: ResolvedTable, row: Row): string => (table.primaryKey.some((column) => row[column] === null || row[column] === undefined) ? '' : table.primaryKey.map((column) => String(row[column])).join('/'));

/** What the checks read of the ledger's tables, from the add-on's own manifest and the tables' rules here. */
function tableFacts(kit: LedgerKit, target: WriteTarget, ledger: ResolvedLedger, manifest: { requiredSchema?: { tables: readonly { ref: string; columns: readonly { ref: string; type: string; references?: string | undefined }[] }[] } | undefined }): Record<string, LedgerTableFacts> {
  const out: Record<string, LedgerTableFacts> = {};
  for (const declared of manifest.requiredSchema?.tables ?? []) {
    const table = ledger.table(declared.ref);
    if (table === null) continue;
    const rules = kit.rulesOf({ ...target, table });
    out[declared.ref] = {
      key: table.primaryKey,
      links: Object.fromEntries(declared.columns.flatMap((column) => (column.type === 'fk' && column.references !== undefined ? [[column.ref, column.references] as const] : []))),
      decided: new Set([...(rules?.readOnly ?? []), ...(rules?.numbered ?? [])]),
      givenCodes: new Map(
        (declared.columns as readonly { ref: string; maxLength?: number; rules?: { code?: { prefix?: string; givenByLedger?: true } } }[]).flatMap((column) => (column.rules?.code?.givenByLedger === true ? [[column.ref, { prefix: column.rules.code.prefix ?? '', max: column.maxLength }] as const] : [])),
      ),
    };
  }
  return out;
}

/** The refusals an operator can act on: each leaves one audit row. An add-on's own "no" (out of stock) leaves none. */
const AUDITED: ReadonlySet<string> = new Set(['planner-failed', 'too-large', 'add-on-unavailable', 'hooked', 'guarded']);

const callKey = (call: { posting: { id: string }; phase: string; role?: string; late?: boolean | undefined }): string => `${call.posting.id}|${call.phase}|${call.role ?? 'source'}${call.late === true ? '|late' : ''}`;
const NUMBER = /^-?\d+(\.\d+)?$/;
/** Whether a value sent is the value stored: a number is the same number however many zeros it is written with. */
const unchanged = (stored: unknown, sent: unknown): boolean =>
  sameValue(stored, sent) || (stored !== null && sent !== null && stored !== undefined && sent !== undefined && NUMBER.test(String(stored)) && NUMBER.test(String(sent)) && compareDecimalText(String(stored), String(sent)) === 0);
/** A yes, as a column of an add-on's row says one: a yes/no that is on, or a whole number that is 1. */
const yes = (value: unknown): boolean => value === true || value === 1 || value === '1';
/** A stored moment as an instant in text, or null. */
function instantText(value: unknown): string | null {
  const ms = instantOf(value);
  return ms === null ? null : new Date(ms).toISOString();
}

export function createLedgerWriter(kit: LedgerKit) {
  /**
   * The add-ons whose rules on this table are there to be asked — the table
   * is then written under one lock call, its row held, whatever the write
   * changes. Null when the table hands nothing to anybody here: it is
   * written exactly as a table with no rule is.
   */
  async function watched(target: WriteTarget, rules: TableRules | null): Promise<string[] | null> {
    const scope = postingScope(rules);
    if (scope === null) return null;
    const ledgers = kit.ledgers;
    // No add-on runtime: nothing can be told idle from live, so every rule is watched (and a point that fires is refused).
    if (ledgers === undefined) return [];
    await ledgers.refresh?.();
    const addOns = new Set<string>();
    for (const posting of [...scope.postings, ...scope.asLine]) if (ledgers.resolve(target.view, target.table, posting).state !== 'idle') addOns.add(posting.into.addOn);
    // The rules of the tables whose lines hang under this one's rows live on those tables.
    for (const line of scope.linePostings) {
      try {
        if (ledgers.resolve(target.view, target.view.table(line.child), line.posting).state !== 'idle') addOns.add(line.posting.into.addOn);
      } catch {
        // A table the model no longer has hands nothing over.
      }
    }
    return addOns.size === 0 ? null : [...addOns].sort();
  }

  /** The row a line's `via` names: its table and key, from the model's own link. */
  function parentOf(target: WriteTarget, via: string): { table: ResolvedTable; parentKey: string } | null {
    const link = (target.view.model?.relations ?? []).find((relation) => relation.through === null && relation.from.tableId === target.table.id && relation.from.columns.length === 1 && relation.from.columns[0] === via && relation.to.columns.length === 1);
    if (link === undefined) return null;
    try {
      return { table: target.view.table(link.to.tableId), parentKey: link.to.columns[0]! };
    } catch {
      return null;
    }
  }

  /**
   * The rows a line's rules name as its parent, held before the line itself:
   * a change of a line and its parent's move then meet on one row, in the
   * order every writer takes them. `rows`: the line as it is and as it will be.
   */
  async function holdParents(trx: Db, target: WriteTarget, rules: TableRules | null, rows: readonly (Row | null | undefined)[]): Promise<void> {
    const wanted = new Map<string, { table: ResolvedTable; column: string; key: unknown }>();
    for (const posting of postingScope(rules)?.asLine ?? []) {
      const parent = posting.via === undefined ? null : parentOf(target, posting.via);
      if (parent === null) continue;
      for (const row of rows) {
        const key = row?.[posting.via!];
        if (key !== null && key !== undefined) wanted.set(`${parent.table.id}\u0000${String(key)}`, { table: parent.table, column: parent.parentKey, key });
      }
    }
    // In one order for every writer: a line moved from one parent to another, and one moved back, never wait on each other crosswise.
    for (const name of [...wanted.keys()].sort()) {
      const { table, column, key } = wanted.get(name)!;
      await kit.fetchHeld({ ...target, table, db: trx }, { [column]: key });
    }
  }

  /** The calls a write of a row fires — as a source, as the parent of lines, as a line — from what is installed as memory holds it now. */
  function callsFor(input: { target: WriteTarget; rules: TableRules | null; action: 'create' | 'update'; before: Row | null; after: Row; only?: OnePhase | undefined; dry?: boolean | undefined }): PostingCall[] {
    const scope = postingScope(input.rules);
    if (scope === null) return [];
    const { only, target } = input;
    let fired: (FiredPoint & { late?: boolean })[];
    if (only !== undefined) {
      // One phase of one rule, asked for by name (a hold let go by the clock): no point is crossed, and none is needed.
      fired = [
        ...scope.postings.filter((posting) => posting.id === only.posting).map((posting) => ({ posting, phase: only.phase, role: 'source' as const })),
        ...scope.linePostings.filter((line) => line.posting.id === only.posting).map((line) => ({ posting: line.posting, phase: only.phase, role: 'parent' as const, lines: { child: line.child, via: line.via, parentKey: line.parentKey } })),
      ];
    } else {
      fired = firedPoints(scope, input.before, input.after, input.action, input.rules?.states?.column);
      // A line made later: the phases its parent's points fire are run for it when its siblings' round has reached them (judged on their receipts, under the locks).
      for (const posting of scope.asLine) {
        // …and so is one that joins its siblings by a change: moved under another parent, or no longer left out (un-voided).
        const joins =
          input.before !== null &&
          lineTaken(posting, input.after) &&
          (!lineTaken(posting, input.before) || (posting.via !== undefined && !sameValue(input.before[posting.via], input.after[posting.via])));
        if (input.action !== 'create' && !joins) continue;
        for (const phase of ['reserve', 'post'] as const) {
          const point = posting[phase]?.on;
          if (point === undefined || fired.some((other) => other.posting.id === posting.id && other.phase === phase && other.role === 'line')) continue;
          // A line made now answers for its own making itself; one that joins later missed even that.
          if (input.action === 'create' ? !ownPoint(point) : true) fired.push({ posting, phase, role: 'line', late: true });
        }
      }
    }
    if (fired.length === 0) return [];
    const ledgers = kit.ledgers;
    // A server with no add-on runtime cannot tell an idle rule from a live one: a write that fires one is refused, never written unposted.
    if (ledgers === undefined) {
      if (fired.every((point) => point.late === true) || input.dry === true) return [];
      throw refused('add-on-unavailable', null);
    }
    const calls: PostingCall[] = [];
    for (const point of fired) {
      // A rule lives on the table whose rows are mapped: the lines' table, for a rule through `via`.
      let link: PostingCall['link'];
      let owner = target.table;
      if (point.role === 'parent') {
        try {
          owner = target.view.table(point.lines!.child);
        } catch {
          continue;
        }
        link = { table: owner, via: point.lines!.via, parentKey: point.lines!.parentKey };
      } else if (point.role === 'line') {
        const parent = point.posting.via === undefined ? null : parentOf(target, point.posting.via);
        if (parent === null) {
          /*
           * The database keeps no link behind `via` (a column first made a
           * plain number, a link taken off by hand): the row this line hangs
           * under cannot be found, so its rule could never fire. A line saved
           * now would be one nothing is ever posted for — refused, where the
           * rule is there to be asked at all.
           */
          const stands = ledgers.resolve(target.view, target.table, point.posting).state;
          if (stands === 'idle' || stands === 'off' || input.dry === true) continue;
          throw refused('add-on-unavailable', null, { posting: point.posting.id, column: point.posting.via });
        }
        link = { table: parent.table, via: point.posting.via!, parentKey: parent.parentKey };
      }
      const state = ledgers.resolve(target.view, owner, point.posting);
      if (state.state === 'idle') continue;
      if (!('ledger' in state) || state.ledger === undefined || !('action' in state) || state.action === undefined) {
        // Switched off with nothing to ask: nothing starts, and nothing is refused.
        if (state.state === 'off') continue;
        // What was taken is always let go, even when not so much as its receipt can be written.
        if (point.phase === 'reverse' || point.late === true) continue;
        // A quote is answered, not failed: there is nothing here to answer with, so it says nothing of this rule.
        if (input.dry === true) continue;
        throw refused('add-on-unavailable', null, { posting: point.posting.id });
      }
      // An off rule starts no round; whether one is open to give back is read under the locks. (A quote says that it is off.)
      if (state.state === 'off' && point.phase !== 'reverse' && input.dry !== true) continue;
      // A phase the action does not have is asked of nobody.
      if (only !== undefined && !state.action.phases.includes(point.phase)) continue;
      calls.push({
        posting: point.posting,
        phase: point.phase,
        ledger: state.ledger,
        action: state.action,
        decider: 'decider' in state ? state.decider : null,
        off: state.state === 'off',
        unavailable: state.state === 'unavailable' ? state.cause : null,
        role: point.role,
        link,
        late: point.late,
        catchUp: only?.catchUp,
        kept: only?.kept,
      });
    }
    return calls;
  }

  /**
   * The source and the lines of a call, read on `db`: the pool before the
   * locks, the transaction under them — where the row a line's `via` names is
   * held (`held`), so a line and its parent's move meet on one row. Null
   * when the line's parent is not there. A line its rule leaves out
   * (`unlessSet`, `only`) is never handed over.
   */
  async function gather(db: Db, call: PostingCall, target: WriteTarget, row: Row, held: boolean): Promise<Gathered | null> {
    const ledgers = kit.ledgers!;
    const refOf = (table: ResolvedTable): string => ledgers.refOf(target.view.connectionId, table.id);
    if (call.role === 'source') {
      return { source: { table: target.table, ref: refOf(target.table), row, key: keyText(target.table, row) }, lines: [{ key: '', ref: '', table: target.table, row, parent: null }] };
    }
    const link = call.link!;
    if (call.role === 'parent') {
      let rows: Row[];
      try {
        rows = await linesOf(db, link.table, link.via, row[link.parentKey]);
      } catch (error) {
        if (error instanceof LedgerTooLarge) throw refused('too-large', call);
        throw error;
      }
      const parent = { table: target.table, row };
      return {
        source: { table: target.table, ref: refOf(target.table), row, key: keyText(target.table, row) },
        lines: rows.filter((line) => lineTaken(call.posting, line)).map((line) => ({ key: keyText(link.table, line), ref: refOf(link.table), table: link.table, row: line, parent })),
      };
    }
    const key = row[link.via];
    if (key === null || key === undefined) return null;
    const at: WriteTarget = { ...target, table: link.table, db };
    const found = held ? await kit.fetchHeld(at, { [link.parentKey]: key }) : await kit.fetch(at, { [link.parentKey]: key });
    if (found === undefined) return null;
    return {
      source: { table: link.table, ref: refOf(link.table), row: found, key: keyText(link.table, found) },
      lines: lineTaken(call.posting, row) ? [{ key: keyText(target.table, row), ref: refOf(target.table), table: target.table, row, parent: { table: link.table, row: found } }] : [],
    };
  }

  /** Whether the other lines of a late line's parent have reached the phase: their receipts say so. */
  function reached(receipts: readonly Receipt[], call: PostingCall, own: string, lineTable?: string): boolean {
    const others = new Set(receipts.filter((receipt) => receipt.posting === call.posting.id && receipt.sourceLine !== own && (lineTable === undefined || receipt.lineTable === lineTable)).map((receipt) => receipt.sourceLine));
    for (const line of others) {
      const round = roundOf(receipts, call.posting.id, line, lineTable);
      if (call.phase === 'reserve' ? round.reserved !== null || round.posted !== null : round.posted !== null) return true;
    }
    return false;
  }

  /** Whether the parent of a late line stands at the phase's own point now (see {@link standsAt}). */
  function parentStands(call: PostingCall, gathered: Gathered): boolean {
    const point = call.posting[call.phase]?.on;
    return point !== undefined && !ownPoint(point) && standsAt(point, gathered.source.row, gathered.source.table.table?.states?.column);
  }

  type Due = { line: CallLine; round: RoundState; mapped: MappedLine; pending?: Receipt | undefined; overtaken?: boolean | undefined };

  /** The lines of a call this phase is still owed for, each with its round and the inputs the rule maps. */
  function dueLines(call: PostingCall, gathered: Gathered, receipts: readonly Receipt[], settings: ScalarRow, target: WriteTarget): Due[] {
    const out: Due[] = [];
    for (const line of gathered.lines) {
      if (call.catchUp === true) {
        // The oldest receipt of this phase nobody planned, with the round it belongs to as it stood before it.
        const mine = receipts.filter((receipt) => receipt.posting === call.posting.id && receipt.sourceLine === line.key && receipt.lineTable === line.ref);
        const pending = mine.find((receipt) => receipt.phase === call.phase && receipt.state === 'unplanned');
        if (pending === undefined) continue;
        const inRound = mine.filter((receipt) => receipt.round === pending.round && receipt.id !== pending.id);
        // A hold or a taking that waited while its round went on without it — taken for good, or given back — has nothing left to do:
        // planned now, it would hold or take for a round that is over, with nothing to ever give it back.
        const overtaken = pending.phase !== 'reverse' && inRound.some((receipt) => receipt.phase === 'reverse' || (pending.phase === 'reserve' && receipt.phase === 'post'));
        const round = { round: pending.round, reserved: inRound.find((receipt) => receipt.phase === 'reserve') ?? null, posted: inRound.find((receipt) => receipt.phase === 'post') ?? null };
        out.push(overtaken ? { line, pending, overtaken, round, mapped: { inputs: {}, multipliers: {} } as MappedLine } : { line, pending, round, mapped: mapOrRefuse(call, target, line, settings) });
        continue;
      }
      const round = roundOf(receipts, call.posting.id, line.key, line.ref);
      if (!phaseDue(round, call.phase)) continue;
      // The clock gives back what is STILL kept until a time that had passed when it looked, read again here under the row's lock: a hold taken
      // for good a moment ago, a payment that stands, and the other lines of the same order are none of its business.
      if (call.kept !== undefined && ![round.reserved, round.posted].some((receipt) => receipt !== null && receipt.heldUntil !== null && call.kept!.has(String(receipt.id)))) continue;
      // A line made later runs a phase its parent has reached: the other lines' receipts say so — or the parent itself, standing at the
      // point (an order placed with no line yet, or with lines that handed nothing over, left no receipt to read it from).
      if (call.late === true && !reached(receipts, call, line.key, line.ref) && !parentStands(call, gathered)) continue;
      out.push({ line, round, mapped: mapOrRefuse(call, target, line, settings) });
    }
    return out;
  }

  /**
   * A table a plan may write is Adminium's to write inside another row's
   * save: nothing of it may need a step that cannot run there, and the
   * connection's role must be let write what the ledger lists.
   */
  async function refuseUnwritable(call: PostingCall, written: WriteTarget, scope: { insert?: readonly string[] | undefined; update?: { by: readonly string[]; set: readonly string[] } | undefined }, context: WriteContext): Promise<void> {
    const rules = kit.rulesOf(written);
    const ledgerContext: WriteContext = { ...context, origin: 'ledger' };
    // Project code that changes a row before it is written cannot run inside this save.
    if ((scope.insert !== undefined && (await kit.hooked(written, 'create', ledgerContext))) || (scope.update !== undefined && (await kit.hooked(written, 'update', ledgerContext)))) {
      throw refused('hooked', call, { table: written.table.name });
    }
    // A lock of its own (a day's bookings, a series' next number, a slot's pool) cannot be taken from inside it either.
    const pooled = (rules?.capacityRules ?? []).some((rule) => rule.kind === 'slot' || rule.kind === 'night');
    if (rules?.booking !== undefined || (rules?.gapless?.length ?? 0) > 0 || pooled) throw refused('guarded', call, { table: written.table.name });
    if (scope.insert !== undefined) await kit.refuseUngranted(written, 'create', [...scope.insert, RECEIPT_LINK].filter((column) => written.table.columns.has(column)));
    if (scope.update !== undefined) await kit.refuseUngranted(written, 'update', scope.update.set);
  }

  type Job = { call: PostingCall; gathered: () => Promise<Gathered | null>; lenient?: boolean };

  /** Every table the calls' plans may write, and each ledger's receipts, with what the role may do there — and nothing of them in the way of a save. */
  async function writable(calls: readonly PostingCall[], target: WriteTarget, context: WriteContext): Promise<Map<string, WriteTarget>> {
    const tables = new Map<string, WriteTarget>();
    const judged = new Set<string>();
    for (const call of calls) {
      // An action that narrows the ledger's list writes only those tables: the others are not in its way.
      const narrowed = call.action.writes === undefined ? null : new Set(call.action.writes);
      for (const [tableId, scope] of [...call.ledger.writes, [call.ledger.receipts.id, null] as const]) {
        const written = tables.get(tableId) ?? (await kit.withRights({ ...target, table: target.view.table(tableId) }));
        tables.set(tableId, written);
        const once = `${call.ledger.id}\u0000${tableId}`;
        if (scope === null || judged.has(once) || (narrowed !== null && !narrowed.has(call.ledger.refOf(tableId)))) continue;
        judged.add(once);
        await refuseUnwritable(call, written, scope, context);
      }
    }
    return tables;
  }

  /** The names the calls stand on, from a look on the pool with nothing held. */
  /**
   * The uses of a call whose rule is the one its order's price rule names:
   * `[]` when the price question recorded none; undefined for any other call.
   */
  const usesOf = (list: readonly UsesFor[] | undefined, call: PostingCall, source: Gathered['source']): readonly PostingUse[] | undefined | null => {
    // (The order's own rule, on the order's own row: a line's rule of the same name is not it.)
    if (call.role !== 'source' || source.table.table?.adjust?.uses !== call.posting.id) return undefined;
    // Null: the rule that records uses, in a save where nobody asked what the order used (its price rule is switched off, or not there).
    return list?.find((one) => one.posting === call.posting.id && one.table === source.table.id && (one.key === undefined || source.key === '' || one.key === source.key))?.uses ?? null;
  };
  /** A use is of rows the add-on keeps: what a read keyed by `uses.*` is given. */
  const usesRead = (uses: readonly PostingUse[] | undefined | null): { uses?: { offer: string | null; code: string | null; voucher: string | null }[] } =>
    uses === undefined || uses === null ? {} : { uses: uses.map((use) => ({ offer: use.offer, code: use.code, voucher: use.voucher })) };

  async function namesFor(jobs: readonly Job[], target: WriteTarget, context: WriteContext, tables: ReadonlyMap<string, WriteTarget>, usesFor?: readonly UsesFor[]): Promise<NamedLock[]> {
    const out = new Map<string, NamedLock>();
    for (const job of jobs) {
      const { call } = job;
      // Asked of nobody, it writes no row of the add-on's: there is nothing of it to stand on.
      if (call.decider === null) continue;
      const gathered = await job.gathered();
      if (gathered === null) continue;
      const settings = await ledgerSettings(call.ledger, target.db);
      const source = { table: gathered.source.ref, row: gathered.source.key };
      const receipts = gathered.source.key === '' ? [] : await receiptsOfSource(target.db, call.ledger, source);
      let due: Due[];
      try {
        due = dueLines(call, gathered, receipts, settings, target);
      } catch (error) {
        // A row previewed before it is written may lack what the save will fill: the save judges it, under its locks.
        if (job.lenient === true && error instanceof ValidationFailedError) continue;
        throw error;
      }
      if (due.length === 0) continue;
      const uses = usesOf(usesFor, call, gathered.source);
      // Nobody asked what the order used: nothing new is held or counted (what is held is still given back).
      if (uses === null && call.phase !== 'reverse') continue;
      // Nothing to hold: no row, and nothing to stand on.
      if (uses !== null && uses !== undefined && uses.length === 0 && call.phase === 'reserve') continue;
      const roundIds = due.flatMap((entry) => [entry.round.reserved?.id, entry.round.posted?.id]).filter((id): id is string | number => id !== undefined);
      const lines = due.map((entry) => ({ line: entry.line.key, lineTable: entry.line.ref, inputs: entry.mapped.inputs, multipliers: entry.mapped.multipliers, round: entry.round.round }));
      const reads = await readOrRefuse(target.db, call, { lines, source, settings, receiptIds: roundIds, ...usesRead(uses) });
      for (const name of lockNames(target.view.connectionId, call.ledger, call.action, reads)) out.set(name, { name, busy: 'CAPACITY_BUSY' });
      // A table it writes keeps a limit: the pools its rows will take from are named too — from the plan, asked once here with nothing held.
      const limited = [...call.ledger.writes.keys()].filter((tableId) => (call.action.writes === undefined || call.action.writes.includes(call.ledger.refOf(tableId))) && kit.limited(tables.get(tableId)!));
      // (A round nobody planned is given back unasked.)
      const asked = due.filter((entry) => !(call.phase === 'reverse' && [entry.round.reserved, entry.round.posted].every((receipt) => receipt === null || receipt.state === 'unplanned')));
      if (limited.length === 0 || asked.length === 0) continue;
      let plan: PostingOutput;
      try {
        const written = call.phase === 'reverse' || (call.phase === 'post' && due.some((entry) => entry.round.reserved !== null)) ? await roundRows(target.db, call.ledger, roundIds) : {};
        plan = askPlanner(call, 'peek', { target, context, at: new Date(), source, lines, reads, settings, written, uses: uses ?? undefined });
      } catch (error) {
        // Not a refusal yet: the save judges the plan under its locks, and fails there.
        if (error instanceof PlanFailed || error instanceof PostingRefusedError) continue;
        throw error;
      }
      const pooled: { target: WriteTarget; row: Row; before: Row | null }[] = [];
      for (const planRow of plan.rows) {
        const written = tables.get(call.ledger.table(planRow.table)?.id ?? '');
        if (written === undefined || !limited.includes(written.table.id)) continue;
        if (planRow.op === 'insert') pooled.push({ target: written, row: withoutLabels(planRow.values), before: null });
        else {
          const by = call.ledger.writes.get(written.table.id)?.update?.by ?? [];
          if (Object.keys(planRow.key).sort().join(',') !== [...by].sort().join(',')) continue;
          const before = await kit.fetch(written, planRow.key).catch(() => undefined);
          if (before !== undefined) pooled.push({ target: written, row: planRow.set, before });
        }
      }
      for (const lock of await kit.poolNames(pooled)) out.set(lock.name, lock);
    }
    return [...out.values()];
  }

  /** The calls this write fires on a row that is its own source; null when it hands nothing to any ledger now. */
  async function peek(input: { target: WriteTarget; rules: TableRules | null; action: 'create' | 'update'; before: Row | null; after: Row; context: WriteContext; only?: OnePhase | undefined; uses?: readonly UsesFor[] | undefined }): Promise<Peek | null> {
    if (postingScope(input.rules) === null) return null;
    await kit.ledgers?.refresh?.();
    const live = callsFor(input);
    if (live.length === 0) return null;
    const { target } = input;
    const tables = await writable(live, target, input.context);
    return {
      calls: live,
      tables,
      addOns: [...new Set(live.map((call) => call.ledger.addOn))].sort(),
      names: (row) => namesFor(live.map((call) => ({ call, gathered: () => gather(target.db, call, target, row, false) })), target, input.context, tables, input.uses),
    };
  }

  /**
   * Whether a row just made hands anything over, read from the row AS STORED.
   * A create looks before its locks, at the row as prepared; what the insert
   * itself fills (a copy read again from its parent as held, the person a
   * booking picked) is not in that look. Reads nothing: the rules only.
   */
  function firesAsStored(input: { target: WriteTarget; rules: TableRules | null; row: Row }): boolean {
    if (postingScope(input.rules) === null) return false;
    return callsFor({ target: input.target, rules: input.rules, action: 'create', before: null, after: input.row }).length > 0;
  }

  /** The add-on's code, asked for its plan. A failure of the code is the plan's failure, with the cause the audit keeps. */
  function askPlanner(
    call: PostingCall,
    mode: 'peek' | 'save' | 'dry',
    input: { target: WriteTarget; context: WriteContext; at: Date; source: { table: string; row: string }; lines: readonly unknown[]; reads: Record<string, ScalarRow[]>; settings: ScalarRow; written: Record<string, ScalarRow[]>; uses?: readonly PostingUse[] | undefined },
  ): PostingOutput {
    const planInput = {
      contract: 'posting-rows@1' as const,
      ledger: call.ledger.id,
      action: call.posting.into.action,
      posting: call.posting.id,
      phase: call.phase,
      mode,
      origin: postingOrigin(input.context),
      ...plannerClock(input.at, input.target.timezone),
      currency: null,
      source: input.source,
      lines: input.lines,
      reads: input.reads,
      settings: input.settings,
      written: input.written,
      // What the order's price question recorded: only for the rule that records it.
      ...(input.uses === undefined ? {} : { uses: [...input.uses] }),
      version: call.ledger.version,
    };
    try {
      return callDecider('rows', call.decider!, planInput, { shape: postingOutputSchema }) as PostingOutput;
    } catch (error) {
      if (error instanceof DeciderFailed) throw new PlanFailed(call, error.cause, error.detail);
      throw error;
    }
  }

  function mapOrRefuse(call: PostingCall, target: WriteTarget, line: CallLine, settings: ScalarRow): MappedLine {
    const linkRef = (table: ResolvedTable, column: string): string | null => {
      const at = outboundKey(target.view, table, column);
      return at === null ? null : kit.ledgers!.refOf(target.view.connectionId, at.tableId);
    };
    const mapped = mapInputs({ posting: call.posting, action: call.action, table: line.table, tableRef: kit.ledgers!.refOf(target.view.connectionId, line.table.id), row: line.row, parent: line.parent, settings, linkRef });
    // An amount Adminium is asked to decide is empty until it is decided.
    const decided = new Set((call.action.decides ?? []).map((entry) => entry.input));
    const missing = mapped.missing.filter((entry) => !decided.has(entry.input));
    if (missing.length > 0) {
      const fields = Object.fromEntries(missing.map((entry) => [entry.column ?? entry.input, { code: 'required' }]));
      throw new ValidationFailedError('A value this needs is missing.', { fields });
    }
    return mapped;
  }

  async function readOrRefuse(db: Db, call: PostingCall, context: Omit<ReadContext, 'ledger' | 'action'>): Promise<Record<string, ScalarRow[]>> {
    try {
      return await runReads(db, { ledger: call.ledger, action: call.action, ...context });
    } catch (error) {
      if (error instanceof LedgerTooLarge) throw refused('too-large', call);
      throw error;
    }
  }

  /**
   * The posting step of a save, on its transaction, after the host's row is
   * written and settled. The points are judged again here, on the row as it
   * was held and as it was written: a call the look before the locks did not
   * see stands on names nobody took, so the save starts again; one it saw
   * that no longer fires is dropped. Answers what each call did.
   */
  async function postStep(
    trx: Db,
    peeked: Peek | null,
    input: { target: WriteTarget; rules: TableRules | null; action: 'create' | 'update'; before: Row | null; row: Row; context: WriteContext; clock: WriteClock; only?: OnePhase | undefined; uses?: readonly UsesFor[] | undefined },
  ): Promise<PostedOutcome[]> {
    const { target } = input;
    /** The row that posts, as it stands: an amount decided for it by one call is what the next one reads. */
    let row = input.row;
    const fired = callsFor({ target, rules: input.rules, action: input.action, before: input.before, after: row, only: input.only });
    return runCalls(
      trx,
      peeked,
      fired.map((call) => ({ call, gathered: () => gather(trx, call, target, row, true) })),
      {
        target,
        context: input.context,
        clock: input.clock,
        creating: input.action === 'create',
        uses: input.uses,
        decided: (line, after) => {
          if (line.table.id === target.table.id && keyText(target.table, line.row) === keyText(target.table, row)) row = after;
        },
      },
    );
  }

  /** The calls of a save, run one after the other on its transaction. */
  async function runCalls(
    trx: Db,
    peeked: Pick<Peek, 'calls' | 'tables'> | null,
    jobs: readonly Job[],
    env: {
      target: WriteTarget;
      context: WriteContext;
      clock: WriteClock;
      creating: boolean;
      /** What each order's price question recorded, for the rule that records it. */
      uses?: readonly UsesFor[] | undefined;
      decided?: (line: CallLine, after: Row) => void;
      pathOf?: (line: CallLine) => readonly (string | number)[] | undefined;
      /**
       * The rows this save itself made, as `<table id>\u0000<key>`: a row of a
       * tree written a moment ago, on this transaction. Nobody else sees one
       * until the save commits, so a lock that would stand for it is not
       * asked for — it had no name when the locks were taken.
       */
      made?: ReadonlySet<string> | undefined;
      /**
       * A QUOTE. Everything a save would do up to its first write of the
       * add-on's: the reads (plain, holding nothing, under no named lock),
       * the plan (`mode: 'dry'`), the checks, the cap worked out in memory.
       * Nothing is inserted into any table of the add-on; an amount decided
       * is written to the quote's own row, which the quote rolls back.
       */
      dry?: boolean;
    },
  ): Promise<PostedOutcome[]> {
    const { target, context, clock } = env;
    const dry = env.dry === true;
    if (jobs.length === 0) return [];
    const known = new Set((peeked?.calls ?? []).map(callKey));
    // A line made later is looked for only under the locks: with nothing to run, nothing of it needs a name.
    if (!dry) for (const { call } of jobs) if (!known.has(callKey(call)) && call.late !== true) throw new LockMoved(`posting ${callKey(call)}`);
    const ledgers = kit.ledgers!;
    const within: WriteTarget = { ...target, db: trx };
    const held = heldNames(trx);
    const settingsOf = new Map<string, ScalarRow>();
    const outcomes: PostedOutcome[] = [];
    const writtenRows: { rules: TableRules | null; record: Row; before: Row | null }[] = [];
    const receiptKey = (ledger: ResolvedLedger): string => ledger.receipts.primaryKey[0] ?? 'id';

    for (const job of jobs) {
      const { call } = job;
      const { ledger, posting, phase } = call;
      const answer = (quote: NonNullable<PostedOutcome['quote']>, more: Partial<PostedOutcome> = {}): PostedOutcome => ({
        addOn: ledger.addOn, ledger: ledger.id, action: posting.into.action, posting: posting.id, phase, round: 0, rows: 0, version: ledger.version, state: 'planned', source: { table: '', row: '' }, lines: [], notes: [], written: [], decided: [], family: ledger.refusal, ...more, quote,
      });
      if (dry) {
        // A quote's ledger refusal is its answer; anything else it meets is an error, as for a save.
        try {
          const told = await runOne(job);
          if (told !== null) outcomes.push(told);
        } catch (error) {
          if (!(error instanceof PostingRefusedError)) throw error;
          const details = (error.details ?? {}) as { reason?: string; line?: number; path?: (string | number)[]; left?: string; item?: string };
          const reason = details.reason ?? 'planner-failed';
          const shown = (error as { publicLeft?: unknown }).publicLeft;
          const readers = readersOf(error);
          outcomes.push(answer({ state: reason === 'add-on-unavailable' ? 'unavailable' : 'refused', reason, ...(details.line === undefined ? {} : { line: details.line }), ...(details.path === undefined ? {} : { path: details.path }), ...(details.left === undefined ? {} : { left: details.left }), ...(details.item === undefined ? {} : { item: details.item }) }, { ...(typeof shown === 'string' ? { publicLeft: shown } : {}), ...(readers === undefined ? {} : { readers }) }));
        }
        continue;
      }
      const done = await runOne(job);
      if (done !== null) outcomes.push(done);
    }
    return outcomes;

    /** One call: what it did, or null when it had nothing to do. */
    async function runOne(job: Job): Promise<PostedOutcome | null> {
      const { call } = job;
      const { ledger, posting, phase } = call;
      /** A refusal that says what is left, with — beside it, for a public door alone — what the owner chose to show a customer of it. */
      const toldLeft = (left: string | undefined, settings: ScalarRow, error: PostingRefusedError): PostingRefusedError => {
        const declared = ((ledgers.manifestOf(target.view.connectionId, ledger.addOn)?.addOn as { words?: unknown } | undefined)?.words ?? []) as { ledger: string; action: string; showLeftBelow?: { setting: string } }[];
        const shown = publicLeft(settings, declared.find((one) => one.ledger === ledger.id && one.action === posting.into.action), left, 'low');
        if (shown !== undefined) Object.defineProperty(error, 'publicLeft', { value: shown, enumerable: false });
        // What is left, and of what, is read from the rows the action stands on: told to whoever may read those tables.
        // (Every table it reads or stands on: a figure may come from any of them. One that cannot be found here leaves nobody to tell.)
        const named = [...new Set([...call.action.locks.map((lock) => lock.table), ...call.action.reads.map((read) => read.table)])];
        const found = named.map((ref) => ledger.table(ref)?.id);
        const tables = found.every((id): id is string => id !== undefined) ? found : [];
        Object.defineProperty(error, 'ledgerReaders', { value: { connectionId: target.view.connectionId, tables } satisfies LedgerReaders, enumerable: false, configurable: true });
        return error;
      };
      const answer = (quote: NonNullable<PostedOutcome['quote']>, more: Partial<PostedOutcome> = {}): PostedOutcome => ({
        addOn: ledger.addOn, ledger: ledger.id, action: posting.into.action, posting: posting.id, phase, round: 0, rows: 0, version: ledger.version, state: 'planned', source: { table: '', row: '' }, lines: [], notes: [], written: [], decided: [], family: ledger.refusal, ...more, quote,
      });
      // The row itself as it stands now; for a line, its parent — held, as every writer of the parent's lines holds it.
      const gathered = await job.gathered();
      if (gathered === null) return null;
      const source = { table: gathered.source.ref, row: gathered.source.key };
      // Receipts first: the first statement on one of the add-on's tables — a change of those tables now waits for this save — and only
      // then is the add-on asked about once more: an update that began in another process before that read is seen here.
      const receipts = await receiptsOfSource(trx, ledger, source);
      const now = await ledgers.versionNow(ledger.addOn);
      if (call.decider !== null && (now === null || now.status !== 'installed' || now.version !== call.decider.version)) {
        if (dry) return answer({ state: 'unavailable', reason: 'add-on-unavailable' });
        throw writeConflict();
      }
      // Switched off: nothing new starts. A round that is open is still given back.
      if (call.off && phase !== 'reverse') return dry ? answer({ state: 'ok', reason: 'switched-off' }) : null;
      let settings = settingsOf.get(ledger.addOn);
      if (settings === undefined) settingsOf.set(ledger.addOn, (settings = await ledgerSettings(ledger, trx)));
      const due = dueLines(call, gathered, receipts, settings, target);
      if (due.length === 0) return null;
      const uses = usesOf(env.uses, call, gathered.source);
      // Nobody asked what the order used (its price rule is switched off, or not there): nothing new is held or counted, and what a
      // round already holds is left as it is — it is still given back when the order is.
      if (uses === null && phase !== 'reverse') return dry ? answer({ state: 'ok', reason: 'switched-off' }, { source }) : null;
      // Nothing to hold: no row, and no receipt. (An order that POSTS having used nothing still writes its receipt: from then on what it
      // used is recorded as nothing, and a code typed later is refused, never taken for free.)
      if (uses !== null && uses !== undefined && uses.length === 0 && phase === 'reserve') return dry ? answer({ state: 'ok' }, { source }) : null;
      // A line the look did not see run (a late line whose siblings' round opened since) stands on names nobody took.
      if (!dry && !known.has(callKey(call))) throw new LockMoved(`posting ${callKey(call)}`);
      const at = clock.locked(trx);
      const receiptsTarget: WriteTarget = { ...(peeked?.tables.get(ledger.receipts.id) ?? { ...target, table: ledger.receipts }), db: trx };
      // How long what this call takes is kept for: a hold, or a payment decided as the row is made — let go by the clock if nothing closes it first.
      // (A payment made for a row that already stands where its rules take things for good is not kept: there is nothing left to wait for.)
      const stands = (): boolean => {
        const scope = postingScope(kit.rulesOf({ ...within, table: gathered.source.table }));
        const column = gathered.source.table.table?.states?.column;
        return [...(scope?.postings ?? []), ...(scope?.linePostings ?? []).map((line) => line.posting)].some((rule) => rule.post !== undefined && !ownPoint(rule.post.on) && standsAt(rule.post.on, gathered.source.row, column));
      };
      const kept = (phase === 'reserve' && call.action.holds === true) || (phase === 'post' && env.creating && call.action.decides !== undefined && !stands());
      const keptUntil = (line: CallLine): string | null => {
        const mapping = posting.heldUntil;
        if (!kept || mapping === undefined) return null;
        if (typeof mapping === 'string') return instantText(line.row[mapping]);
        return 'parent' in mapping ? instantText(line.parent?.row[mapping.parent]) : null;
      };
      const receiptFor = (entry: { line: CallLine; round: RoundState }, state: 'planned' | 'unplanned', rows: number): Row => ({
        source_table: source.table,
        source_row: source.row,
        source_line: entry.line.key,
        line_table: entry.line.ref,
        ledger: ledger.id,
        action: posting.into.action,
        posting: posting.id,
        phase,
        round: entry.round.round,
        state,
        rows,
        add_on_version: ledger.version,
        origin: postingOrigin(context),
        by: context.actor?.id ?? context.actor?.kind ?? 'system',
        // As an instant in text: every engine's driver takes that, and none of them a Date the same way.
        at: at.toISOString(),
        held_until: keptUntil(entry.line),
      });
      /** A line's receipt for this phase: written now — or, catching up, the one nobody planned, planned at last. Its key. */
      const record = async (entry: Due, state: 'planned' | 'unplanned', rows: number): Promise<unknown> => {
        if (entry.pending !== undefined) {
          await kit.updateRaw(receiptsTarget, { state, rows, add_on_version: ledger.version }, { [receiptKey(ledger)]: entry.pending.id });
          return entry.pending.id;
        }
        return (await writeReceipt(receiptsTarget, ledger, receiptFor(entry, state, rows)))[receiptKey(ledger)];
      };
      /**
       * A payment given back while it was still only kept until a time: the
       * amount decided for it is taken off its row again, so what is due comes
       * back with the money. Adminium's own write, whether or not the add-on
       * can be asked what to give back.
       */
      const undecide = async (entry: Due): Promise<void> => {
        if (phase !== 'reverse' || entry.round.posted === null || entry.round.posted.heldUntil === null || call.action.decides === undefined) return;
        const set: Row = {};
        for (const bound of call.action.decides) {
          const column = posting.map[bound.input];
          if (typeof column === 'string') set[column] = null;
        }
        if (Object.keys(set).length === 0) return;
        const after = await kit.decide({ ...within, table: entry.line.table }, Object.fromEntries(entry.line.table.primaryKey.map((column) => [column, entry.line.row[column]])), set, entry.line.row);
        if (after !== null) env.decided?.(entry.line, after);
      };
      /** What a line's round kept until a time is kept no longer: it was taken for good, or given back. */
      const close = async (round: RoundState): Promise<void> => {
        if (phase === 'reserve') return;
        for (const open of phase === 'reverse' ? [round.reserved, round.posted] : [round.reserved]) {
          if (open !== null && open.heldUntil !== null) await kit.updateRaw(receiptsTarget, { held_until: null }, { [receiptKey(ledger)]: open.id });
        }
      };
      const outcome: PostedOutcome = {
        addOn: ledger.addOn, ledger: ledger.id, action: posting.into.action, posting: posting.id, phase, round: due[0]!.round.round, rows: 0, version: ledger.version, state: 'planned', source,
        record: { table: gathered.source.table, pk: Object.fromEntries(gathered.source.table.primaryKey.map((column) => [column, gathered.source.row[column]])) },
        lines: [], notes: [], written: [], decided: [],
      };
      const position = (key: string): number => gathered.lines.findIndex((line) => line.key === key);

      // A round nobody planned wrote nothing: giving it back writes nothing either, and nobody is asked.
      const asked: typeof due = [];
      for (const entry of due) {
        // What waited and was overtaken is closed as it stands: nothing written, nobody asked.
        if (entry.overtaken === true) {
          outcome.lines.push(entry.line.key);
          if (!dry) await record(entry, 'planned', 0);
          continue;
        }
        const open = [entry.round.reserved, entry.round.posted].filter((receipt): receipt is Receipt => receipt !== null);
        if (phase !== 'reverse' || !open.every((receipt) => receipt.state === 'unplanned')) {
          asked.push(entry);
          continue;
        }
        outcome.lines.push(entry.line.key);
        if (dry) continue;
        for (const receipt of open) await kit.updateRaw(receiptsTarget, { state: 'planned', rows: 0 }, { [receiptKey(ledger)]: receipt.id });
        await record(entry, 'planned', 0);
        await close(entry.round);
      }
      if (asked.length === 0) return dry ? answer({ state: 'ok' }, { source, lines: outcome.lines }) : outcome;
      const lines = asked.map((entry) => ({ line: entry.line.key, lineTable: entry.line.ref, inputs: entry.mapped.inputs, multipliers: entry.mapped.multipliers, round: entry.round.round }));
      const roundIds = asked.flatMap((entry) => [entry.round.reserved?.id, entry.round.posted?.id]).filter((id): id is string | number => id !== undefined);

      // What may not be paid this way at all: a row of the same parent that the rule names (a card may not pay for a card). Judged whoever plans.
      if (phase !== 'reverse') {
        for (const entry of posting.refuses ?? []) {
          const tableId = (entry as { table?: string }).table;
          const via = (entry as { via?: string }).via;
          if (tableId === undefined) {
            if (asked.some((item) => filled(item.line.row[entry.column]))) throw refused('card-pays-card', call);
            continue;
          }
          // A sibling table is found through its own link to the same parent: without one there is nothing to read it by.
          if (via === undefined) continue;
          let sibling: ResolvedTable;
          try {
            sibling = target.view.table(tableId);
          } catch {
            continue;
          }
          const parentKey = call.link?.parentKey ?? gathered.source.table.primaryKey[0] ?? 'id';
          let found: Row[];
          try {
            found = await linesOf(trx, sibling, via, gathered.source.row[parentKey]);
          } catch (error) {
            if (error instanceof LedgerTooLarge) throw refused('too-large', call);
            throw error;
          }
          if (found.some((other) => filled(other[entry.column]))) throw refused('card-pays-card', call);
        }
      }

      if (call.decider === null) {
        // The add-on cannot be asked. What was taken is always given back, to be worked out when it can answer.
        if (phase !== 'reverse') {
          // Something new is taken only when every row it would take from says it may be taken unasked.
          const allow = call.action.unavailable?.allow;
          if (allow === undefined) throw refused('add-on-unavailable', call);
          const reads = await readOrRefuse(trx, call, { lines, source, settings, receiptIds: [], ...usesRead(uses) });
          const said = reads[allow.read] ?? [];
          if (said.length === 0 || !said.every((found) => yes(found[allow.column]))) throw refused('add-on-unavailable', call);
        }
        // A quote says so: whether the save would go through unasked is the save's to find.
        if (dry) return phase === 'reverse' ? answer({ state: 'ok' }, { source }) : answer({ state: 'unavailable', reason: 'add-on-unavailable' }, { source });
        // Catching up with nobody to ask still: what waits goes on waiting.
        if (call.catchUp === true) throw refused('add-on-unavailable', call);
        for (const entry of asked) {
          // (The amount a kept payment decided comes off its row now: that needs nobody's answer.)
          await undecide(entry);
          await record(entry, 'unplanned', 0);
          await close(entry.round);
          outcome.lines.push(entry.line.key);
        }
        return { ...outcome, state: 'unplanned' };
      }

      const reads = await readOrRefuse(trx, call, { lines, source, settings, receiptIds: roundIds, ...usesRead(uses) });
      // What this call stands on must be what the save locked: a row that moved in between starts the save again. (A quote locks nothing.)
      if (!dry) {
        const own = new Set<string>();
        for (const lock of env.made === undefined ? [] : call.action.locks) {
          const at = ledger.table(lock.table);
          if (at === null || lock.column !== at.primaryKey[0]) continue;
          for (const key of env.made!) if (key.startsWith(`${at.id}\u0000`)) own.add(`${target.view.connectionId}|led|${ledger.addOn}|${lock.table}|${key.slice(at.id.length + 1)}`);
        }
        for (const name of lockNames(target.view.connectionId, ledger, call.action, reads)) if (!held.has(name) && !own.has(name)) throw new LockMoved(name);
      }
      // What the round wrote so far: handed when it is given back, and when what was held is taken.
      const written = phase === 'reverse' || (phase === 'post' && asked.some((entry) => entry.round.reserved !== null)) ? await roundRows(trx, ledger, roundIds) : {};
      const plan = askPlanner(call, dry ? 'dry' : 'save', { target, context, at, source, lines, reads, settings, written, uses: uses ?? undefined });
      // A refusal fails the save — but never a giving back: what was written is always given back.
      const first = phase === 'reverse' ? undefined : plan.refusals?.[0];
      if (first !== undefined) {
        throw toldLeft(first.left, settings, refused(first.reason, call, {
          ...(first.left === undefined ? {} : { left: first.left }),
          ...(first.item === undefined ? {} : { item: first.item }),
          // Which line of the rows it was handed, for a caller that sent several.
          ...(call.role === 'source' || position(first.line) < 0 ? {} : { line: position(first.line) }),
          ...(position(first.line) < 0 || env.pathOf?.(gathered.lines[position(first.line)]!) === undefined ? {} : { path: [...env.pathOf(gathered.lines[position(first.line)]!)!] }),
        }));
      }

      const manifest = ledgers.manifestOf(target.view.connectionId, ledger.addOn);
      const facts = tableFacts(kit, within, ledger, manifest ?? {});
      const writes = Object.fromEntries([...ledger.writes].map(([tableId, scope]) => [ledger.refOf(tableId), scope]));
      const checked = checkOutput({ writes, action: call.action, tables: facts, reads, lines, written, mapped: new Set(Object.keys(posting.map)) }, plan);
      if (!checked.ok) throw new PlanFailed(call, checked.cause, checked.detail);
      const byLine = new Map(asked.map((entry) => [entry.line.key, entry]));
      const stray = plan.rows.find((planRow) => !byLine.has(planRow.line));
      if (stray !== undefined) throw new PlanFailed(call, 'scope-row', `a row is for "${stray.line}", which is not a line of this call`);

      if (dry) {
        // The cap a save judges once its rows are in, worked out from what was read.
        const fits = judgePlanned(
          plan.rows.flatMap((planRow) => (planRow.op === 'insert' ? [{ table: planRow.table, line: planRow.line, values: planRow.values }] : [])),
          {
            rollups: (table) => {
              const found = ledger.table(table);
              return found === null ? [] : (kit.rulesOf({ ...within, table: found })?.rollupsInto ?? []);
            },
            rows: (tableId) => call.action.reads.flatMap((read) => (ledger.table(read.table)?.id === tableId ? (reads[read.as] ?? []) : [])),
          },
        );
        if (!fits.ok) {
          const at = position(fits.line);
          throw toldLeft(fits.left, settings, refused(ledger.refusal === 'stock' ? 'out-of-stock' : 'over-limit', call, {
            left: fits.left,
            ...(call.role === 'source' || at < 0 ? {} : { line: at }),
            ...(at < 0 || env.pathOf?.(gathered.lines[at]!) === undefined ? {} : { path: [...env.pathOf(gathered.lines[at]!)!] }),
          }));
        }
        // An amount decided shows in the quote's own figures: written to its row, and gone with the quote.
        const quoted = answer({ state: 'ok' }, { source, round: asked[0]!.round.round, rows: plan.rows.length, lines: asked.map((entry) => entry.line.key), notes: (plan.notes ?? []).map((note: { line: string; note: string; item?: string | undefined }) => ({ ...note })) });
        for (const entry of asked) {
          const mine = (plan.decides ?? []).filter((decision) => decision.line === entry.line.key);
          if (mine.length === 0) continue;
          const set: Row = {};
          for (const decision of mine) {
            const column = posting.map[decision.input];
            if (typeof column !== 'string') throw new PlanFailed(call, 'scope-decides', `"${decision.input}" is mapped to no column of the row`);
            set[column] = decision.value;
            quoted.decided.push({ line: decision.line, input: decision.input, column, value: decision.value });
          }
          const after = await kit.decide({ ...within, table: entry.line.table }, Object.fromEntries(entry.line.table.primaryKey.map((column) => [column, entry.line.row[column]])), set, entry.line.row);
          if (after !== null) env.decided?.(entry.line, after);
        }
        return quoted;
      }

      // The receipts, before any row they stand for: a receipt's own key is what stops the same phase written twice.
      // One per line the plan wrote or decided something for; a giving back and a taking of what was held are always recorded.
      const decisions = plan.decides ?? [];
      const receiptIds = new Map<string, unknown>();
      for (const entry of asked) {
        const rows = plan.rows.filter((planRow) => planRow.line === entry.line.key).length;
        const decided = decisions.some((decision) => decision.line === entry.line.key);
        // (An order asked what it used, where its record posts, is recorded even when it used nothing: that it used nothing is then closed.)
        const closes = uses !== undefined && uses !== null && phase === 'post';
        if (rows === 0 && !decided && phase !== 'reverse' && entry.round.reserved === null && entry.pending === undefined && !closes) continue;
        await undecide(entry);
        receiptIds.set(entry.line.key, await record(entry, 'planned', rows));
        await close(entry.round);
        outcome.lines.push(entry.line.key);
      }
      outcome.notes = (plan.notes ?? []).map((note: { line: string; note: string; item?: string | undefined }) => ({ ...note }));
      if (receiptIds.size === 0) return outcome;

      // The plan's rows, written as Adminium's own: the tables' own defaults, formulas and checks apply.
      const labels = new Map<string, unknown>();
      const inserts: { target: WriteTarget; rules: TableRules | null; values: Row; label: string | undefined }[] = [];
      const updates: { target: WriteTarget; rules: TableRules | null; key: Row; set: Row; before: Row }[] = [];
      for (const planRow of plan.rows) {
        const table = ledger.table(planRow.table)!;
        // As the peek resolved it: nothing waits on the pool from inside the transaction.
        const rowTarget: WriteTarget = { ...(peeked?.tables.get(table.id) ?? { ...target, table }), db: trx };
        if (planRow.op === 'insert') {
          inserts.push({ target: rowTarget, rules: kit.rulesOf(rowTarget), values: { ...planRow.values, [RECEIPT_LINK]: receiptIds.get(planRow.line) ?? null }, label: planRow.label });
          continue;
        }
        const before = (await kit.fetchHeld(rowTarget, planRow.key)) ?? null;
        if (before === null) throw new PlanFailed(call, 'scope-row', `a row of "${planRow.table}" the plan changes is not there`);
        updates.push({ target: rowTarget, rules: kit.rulesOf(rowTarget), key: planRow.key, set: planRow.set, before });
      }
      // Every total the plan's rows climb into, held top-down before any of them is written.
      // The saving call's actor stamps a planned row — but a guest is nobody: no row of a ledger is ever signed with a browser key's name.
      const ledgerContext: WriteContext = { ...context, origin: 'ledger', actor: context.actor?.kind === 'public' ? null : context.actor };
      const holdStarts = [
        ...inserts.flatMap((item) => kit.starts(item.rules, [{ record: withoutLabels(item.values), before: null }])),
        ...updates.flatMap((item) => kit.starts(item.rules, [{ record: { ...item.before, ...item.set }, before: item.before }])),
      ];
      const balances = await kit.hold(within, holdStarts);
      let writing: ResolvedTable = target.table;
      try {
        for (const item of inserts) {
          writing = item.target.table;
          // A link to a row of this same plan is filled as the rows go in.
          const ready = await kit.prepare(item.target, resolveLabels(item.values, labels), ledgerContext, clock);
          const inserted = await kit.insert(item.target, ready.checked, ready.codes);
          if (item.label !== undefined) labels.set(item.label, inserted[item.target.table.primaryKey[0] ?? 'id']);
          writtenRows.push({ rules: ready.rules, record: inserted, before: null });
          outcome.written.push({ table: item.target.table, row: inserted, before: null });
        }
        for (const item of updates) {
          writing = item.target.table;
          const after = (await kit.change(item.target, item.set, item.key, item.before, ledgerContext, clock)) ?? { ...item.before, ...item.set };
          writtenRows.push({ rules: item.rules, record: after, before: item.before });
          outcome.written.push({ table: item.target.table, row: after, before: item.before });
          await kit.follow(item.target, item.rules, item.before, after);
        }
      } catch (error) {
        // The plan's own row was refused by the table's rules or the database: the plan was wrong, not the person.
        if (error instanceof PostingRefusedError || error instanceof LockMoved) throw error;
        if (error instanceof ValidationFailedError || error instanceof StateMoveRefused || error instanceof RecordLocked || isUniqueViolation(error) || readDbRefusal(error, writing) !== null) throw new PlanFailed(call, 'scope-op', error instanceof Error ? error.message : String(error));
        throw error;
      }
      // The limits the plan's rows take from, judged once with every row of it written — under the pools' locks, named before the save began.
      const judged = outcome.written.filter((item) => kit.limited({ ...within, table: item.table }));
      if (judged.length > 0) {
        try {
          await kit.judge(
            trx,
            judged.map((item) => ({ target: { ...(peeked?.tables.get(item.table.id) ?? { ...target, table: item.table }), db: trx }, pk: Object.fromEntries(item.table.primaryKey.map((column) => [column, item.row[column]])), row: item.row, before: item.before })),
            context,
            clock,
          );
        } catch (error) {
          // The ledger's own limit said no: told as the ledger's refusal, about the row that was being saved.
          if (error instanceof ConflictError && error.code === 'CAPACITY_FULL') throw refused(ledger.refusal === 'stock' ? 'out-of-stock' : 'over-limit', call);
          throw error;
        }
      }
      // What was decided, written to the line it was decided for — read here, after the host's own totals were settled, so "what is due" was what
      // the other payments left. The row's own cap still judges it (a payment above what is due is the host's refusal, as ever).
      for (const entry of asked) {
        const mine = decisions.filter((decision) => decision.line === entry.line.key);
        if (mine.length === 0) continue;
        const set: Row = {};
        const own = kit.rulesOf({ ...within, table: entry.line.table });
        for (const decision of mine) {
          const column = posting.map[decision.input];
          if (typeof column !== 'string') throw new PlanFailed(call, 'scope-decides', `"${decision.input}" is mapped to no column of the row`);
          // Only a plain column of the row takes a decided amount: never its key, its state, or anything a rule of the table works out.
          if (entry.line.table.primaryKey.includes(column) || own?.states?.column === column || (own?.numbered ?? []).includes(column) || (own?.formulas ?? []).some((formula) => formula.column === column)) {
            throw new PlanFailed(call, 'scope-decides', `"${column}" is not a column an amount can be decided into`);
          }
          set[column] = decision.value;
          outcome.decided.push({ line: decision.line, input: decision.input, column, value: decision.value });
        }
        const after = await kit.decide({ ...within, table: entry.line.table }, Object.fromEntries(entry.line.table.primaryKey.map((column) => [column, entry.line.row[column]])), set, entry.line.row);
        // The row that posts, read again when it is the one decided for: the next call maps from it.
        if (after !== null) env.decided?.(entry.line, after);
      }
      const settleStarts = writtenRows.splice(0).flatMap((item) => kit.starts(item.rules, [{ record: item.record, before: item.before }]));
      // The rows the settle is about to move whose table announces a figure: read as they stand, to tell afterwards which figure moved.
      const watchedParents: { table: ResolvedTable; pk: Row; columns: string[]; was: Row }[] = [];
      for (const start of settleStarts) {
        let parent: ResolvedTable;
        try {
          parent = target.view.table(start.rollup.parent);
        } catch {
          continue;
        }
        const columns = (parent.table?.columns ?? []).filter((column) => column.announce === true).map((column) => column.name);
        if (columns.length === 0) continue;
        for (const key of start.keys) {
          const pk = { [start.rollup.parentKey]: key };
          if (watchedParents.some((seen) => seen.table.id === parent.id && String(seen.pk[start.rollup.parentKey]) === String(key))) continue;
          const stands = await kit.fetch({ ...within, table: parent }, pk);
          if (stands !== undefined) watchedParents.push({ table: parent, pk, columns, was: Object.fromEntries(columns.map((column) => [column, stands[column]])) });
        }
      }
      try {
        // One settle a call: each total once, each cap judged once against what was held.
        await kit.settle(within, settleStarts, balances);
      } catch (error) {
        if (error instanceof ConflictError && error.code === 'BALANCE_EXCEEDED') {
          throw refused(ledger.refusal === 'stock' ? 'out-of-stock' : 'over-limit', call, phase === 'reverse' ? { phase: 'reverse' } : {});
        }
        throw error;
      }
      for (const parent of watchedParents) {
        const now = await kit.fetch({ ...within, table: parent.table }, parent.pk);
        const changed = now === undefined ? [] : parent.columns.filter((column) => !unchanged(parent.was[column], now[column]));
        if (changed.length > 0) (outcome.announced ??= []).push({ table: parent.table, pk: parent.pk, was: parent.was, changed });
      }
      outcome.rows = plan.rows.length;
      return outcome;
    }
  }

  /** One receipt, written by Adminium alone. Its own key refuses the same phase of the same round twice: the save starts again. */
  async function writeReceipt(target: WriteTarget, ledger: ResolvedLedger, values: Row): Promise<Row> {
    try {
      return await kit.insertRaw({ ...target, table: ledger.receipts }, values);
    } catch (error) {
      if (isUniqueViolation(error)) throw writeConflict();
      throw error;
    }
  }

  /**
   * A CREATE WITH ITS CHILD ROWS. The root may be a source, and the parent of
   * lines; each child may be a line whose own making is a point. The lines
   * of one rule and phase are handed over in ONE call, whether the point is
   * the root's or each line's own. `rows`: the root first.
   */
  function treeJobs(rows: readonly TreeRowIn[], db: Db, held: boolean, dry = false): Job[] {
    const root = rows[0];
    if (root === undefined) return [];
    const ledgers = kit.ledgers;
    const refOf = (table: ResolvedTable): string => ledgers!.refOf(root.target.view.connectionId, table.id);
    const jobs: Job[] = [];
    const sourceOf = (item: TreeRowIn): Gathered['source'] => ({ table: item.target.table, ref: refOf(item.target.table), row: item.row, key: keyText(item.target.table, item.row) });
    const linesUnder = (call: PostingCall, parent: TreeRowIn, items: readonly TreeRowIn[]): CallLine[] =>
      items
        .filter((item) => lineTaken(call.posting, item.row))
        // A row not written yet has no key: its place among the rows stands for it, for this look only.
        .map((item) => ({ key: keyText(item.target.table, item.row) || `#${String(rows.indexOf(item))}`, ref: refOf(item.target.table), table: item.target.table, row: item.row, parent: { table: parent.target.table, row: parent.row } }));
    // The lines made with a row of the tree, by rule and phase: one call for all of them, whether the point is the parent's or each line's own.
    const grouped = new Map<string, { call: PostingCall; parent: TreeRowIn; items: TreeRowIn[] }>();
    for (const item of rows) {
      const above = item.parent === undefined || item.parent === null ? null : (rows[item.parent] ?? null);
      // (With no add-on runtime a rule that would fire refuses the tree here, as it refuses a single row.)
      for (const call of callsFor({ target: item.target, rules: item.rules, action: 'create', before: null, after: item.row, dry })) {
        if (call.role === 'source') {
          jobs.push({ call, gathered: () => gather(db, call, item.target, item.row, held), lenient: !held });
        } else if (call.role === 'parent') {
          // Its own points, for the lines made under it in this tree.
          const below = rows.filter((other) => other.parent === rows.indexOf(item) && other.target.table.id === call.link!.table.id);
          jobs.push({ call, gathered: async () => ({ source: sourceOf(item), lines: linesUnder(call, item, below) }), lenient: !held });
        } else if (above !== null && call.link?.table.id === above.target.table.id) {
          // A line of a row of this same tree. (A line made with its parent has no earlier sibling to join.)
          if (call.late === true) continue;
          const key = `${String(item.parent)}\u0000${item.target.table.id}\u0000${callKey(call)}`;
          const entry = grouped.get(key) ?? { call, parent: above, items: [] };
          entry.items.push(item);
          grouped.set(key, entry);
        } else {
          // A line of a row that is already there: handed over as a single create hands it.
          jobs.push({ call, gathered: () => gather(db, call, item.target, item.row, held), lenient: !held });
        }
      }
    }
    for (const { call, parent, items } of grouped.values()) jobs.push({ call, gathered: async () => ({ source: sourceOf(parent), lines: linesUnder(call, parent, items) }), lenient: !held });
    return jobs;
  }

  /** What a tree hands to any ledger, looked at before its locks: null when nothing. `rows`: the root as prepared, its children as previewed. */
  async function treePeek(rows: readonly TreeRowIn[], context: WriteContext, uses?: readonly UsesFor[]): Promise<{ calls: PostingCall[]; tables: Map<string, WriteTarget>; addOns: string[]; names(): Promise<NamedLock[]> } | null> {
    if (rows.every((item) => postingScope(item.rules) === null)) return null;
    await kit.ledgers?.refresh?.();
    const root = rows[0]!.target;
    const jobs = treeJobs(rows, root.db, false);
    if (jobs.length === 0) return null;
    const calls = jobs.map((job) => job.call);
    const tables = await writable(calls, root, context);
    return { calls, tables, addOns: [...new Set(calls.map((call) => call.ledger.addOn))].sort(), names: () => namesFor(jobs, root, context, tables, uses) };
  }

  /** The posting step of a tree, on its transaction, once every row of it is written and its totals settled. `rows`: as written. */
  async function treeStep(trx: Db, peeked: Pick<Peek, 'calls' | 'tables'> | null, rows: readonly TreeRowIn[], env: { context: WriteContext; clock: WriteClock; uses?: readonly UsesFor[] | undefined }): Promise<PostedOutcome[]> {
    if (rows.every((item) => postingScope(item.rules) === null)) return [];
    const paths = new Map(rows.map((item) => [`${item.target.table.id}\u0000${keyText(item.target.table, item.row)}`, item.path]));
    return runCalls(trx, peeked, treeJobs(rows, trx, true), {
      target: rows[0]!.target,
      context: env.context,
      clock: env.clock,
      creating: true,
      uses: env.uses,
      made: new Set(paths.keys()),
      pathOf: (line) => paths.get(`${line.table.id}\u0000${line.key}`),
    });
  }

  /** What a change would hand to each ledger, and what each would say: the posting step of a quote, on the quote's own handle. */
  async function quoteStep(trx: Db, input: { target: WriteTarget; rules: TableRules | null; action: 'create' | 'update'; before: Row | null; row: Row; context: WriteContext; clock: WriteClock; uses?: readonly UsesFor[] | undefined }): Promise<PostedOutcome[]> {
    if (postingScope(input.rules) === null) return [];
    await kit.ledgers?.refresh?.();
    const { target } = input;
    let row = input.row;
    const fired = callsFor({ target, rules: input.rules, action: input.action, before: input.before, after: row, dry: true });
    return runCalls(trx, null, fired.map((call) => ({ call, gathered: () => gather(trx, call, target, row, false) })), {
      target,
      context: input.context,
      clock: input.clock,
      creating: input.action === 'create',
      dry: true,
      uses: input.uses,
      decided: (line, after) => {
        if (line.table.id === target.table.id && keyText(target.table, line.row) === keyText(target.table, row)) row = after;
      },
    });
  }

  /** The same for a create with its child rows, once the quote has written them. */
  async function treeQuote(trx: Db, rows: readonly TreeRowIn[], env: { context: WriteContext; clock: WriteClock; uses?: readonly UsesFor[] | undefined }): Promise<PostedOutcome[]> {
    if (rows.every((item) => postingScope(item.rules) === null)) return [];
    await kit.ledgers?.refresh?.();
    const paths = new Map(rows.map((item) => [`${item.target.table.id}\u0000${keyText(item.target.table, item.row)}`, item.path]));
    return runCalls(trx, null, treeJobs(rows, trx, false, true), { target: rows[0]!.target, context: env.context, clock: env.clock, creating: true, dry: true, uses: env.uses, pathOf: (line) => paths.get(`${line.table.id}\u0000${line.key}`) });
  }

  /**
   * A PAYMENT KEPT UNTIL A TIME STANDS once the row it belongs to reaches a
   * posting state of its own: whatever rule's `post` point the row (or the
   * row its lines hang under) crosses, every `post` receipt of that row still
   * kept until a time is kept no longer — the clock will not give it back.
   * Read from the rules as declared, whether or not their add-on answers.
   */
  async function closeHeld(trx: Db, input: { target: WriteTarget; rules: TableRules | null; before: Row; row: Row }): Promise<void> {
    for (const { ledger, receipt } of await keptOf(trx, input)) {
      await kit.updateRaw({ ...input.target, table: ledger.receipts, db: trx }, { held_until: null }, { [ledger.receipts.primaryKey[0] ?? 'id']: receipt.id });
    }
  }

  /**
   * A HOLD'S END BROUGHT FORWARD by a statement of its own (a buyer's new
   * hold lets their old one go: `public-api/hold-replace.ts`). Where a rule
   * keeps what it holds until that column, the receipts of the row are
   * brought forward with it: the minute's job then gives the hold back, as
   * it does one whose time ran out. Without this the receipt would keep the
   * time it first read, and the old hold its stock until then.
   */
  async function holdEndMoved(trx: Db, input: { target: WriteTarget; rules: TableRules | null; row: Row; column: string; at: string }): Promise<void> {
    const scope = postingScope(input.rules);
    const ledgers = kit.ledgers;
    if (scope === null || ledgers === undefined) return;
    const { target } = input;
    const owners: { posting: DeclaredPosting; table: ResolvedTable }[] = scope.postings.filter((posting) => posting.heldUntil === input.column).map((posting) => ({ posting, table: target.table }));
    for (const line of scope.linePostings) {
      const mapping = line.posting.heldUntil;
      if (mapping === undefined || typeof mapping === 'string' || !('parent' in mapping) || mapping.parent !== input.column) continue;
      try {
        owners.push({ posting: line.posting, table: target.view.table(line.child) });
      } catch {
        // A table the model no longer has holds nothing.
      }
    }
    if (owners.length === 0) return;
    const source = { table: ledgers.refOf(target.view.connectionId, target.table.id), row: keyText(target.table, input.row) };
    for (const { posting, table } of owners) {
      const state = ledgers.resolve(target.view, table, posting);
      if (!('ledger' in state) || state.ledger === undefined) continue;
      const ledger = state.ledger;
      for (const receipt of await receiptsOfSource(trx, ledger, source)) {
        if (receipt.posting !== posting.id || receipt.heldUntil === null) continue;
        await kit.updateRaw({ ...target, table: ledger.receipts, db: trx }, { held_until: bindWriteValue(ledger.receipts.columns.get('held_until')!, input.at, target.dialect) }, { [ledger.receipts.primaryKey[0] ?? 'id']: receipt.id });
      }
    }
  }

  /** The payments of a row still kept until a time, when a change of it crosses a posting point of its own; none when it crosses none. */
  async function keptOf(db: Db, input: { target: WriteTarget; rules: TableRules | null; before: Row; row: Row }): Promise<{ ledger: ResolvedLedger; receipt: Receipt }[]> {
    const scope = postingScope(input.rules);
    const ledgers = kit.ledgers;
    if (scope === null || ledgers === undefined) return [];
    const { target } = input;
    const crossed = firedPoints(scope, input.before, input.row, 'update', input.rules?.states?.column).some((point) => point.phase === 'post' && point.role !== 'line');
    if (!crossed) return [];
    const source = { table: ledgers.refOf(target.view.connectionId, target.table.id), row: keyText(target.table, input.row) };
    const seen = new Set<string>();
    const owners: { posting: DeclaredPosting; table: ResolvedTable }[] = scope.postings.map((posting) => ({ posting, table: target.table }));
    for (const line of scope.linePostings) {
      try {
        owners.push({ posting: line.posting, table: target.view.table(line.child) });
      } catch {
        // A table the model no longer has kept nothing.
      }
    }
    const out: { ledger: ResolvedLedger; receipt: Receipt }[] = [];
    for (const { posting, table } of owners) {
      const state = ledgers.resolve(target.view, table, posting);
      if (!('ledger' in state) || state.ledger === undefined || seen.has(state.ledger.receipts.id)) continue;
      seen.add(state.ledger.receipts.id);
      for (const receipt of await receiptsOfSource(db, state.ledger, source)) {
        if (receipt.phase === 'post' && receipt.heldUntil !== null) out.push({ ledger: state.ledger, receipt });
      }
    }
    return out;
  }

  /**
   * THE GUARD. While a round is open for a row, what the round read of it is
   * frozen: a column the rule maps (its inputs, its multipliers, how long a
   * hold is kept, what leaves a line out, the link to its parent) may not
   * change, and the row may not go. Judged on the row as held, before the
   * statement. The receipts are read only when the change touches a frozen
   * column, or the row is going.
   */
  async function guard(trx: Db, input: { target: WriteTarget; rules: TableRules | null; action: 'update' | 'delete'; stood: Row; values?: Row | undefined }): Promise<void> {
    const scope = postingScope(input.rules);
    const ledgers = kit.ledgers;
    if (scope === null || ledgers === undefined) return;
    const { target, stood } = input;
    const moved = (columns: readonly string[]): string | undefined =>
      input.action === 'delete' ? undefined : columns.find((column) => Object.prototype.hasOwnProperty.call(input.values ?? {}, column) && !unchanged(stood[column], input.values![column]));
    const judge = async (posting: DeclaredPosting, owner: ResolvedTable, as: 'source' | 'line' | 'parent'): Promise<void> => {
      const frozen = frozenColumns(posting);
      const state = ledgers.resolve(target.view, owner, posting);
      if (!('ledger' in state) || state.ledger === undefined) return;
      // (An amount Adminium decided is frozen too: its own write of it passes no door, so nothing here stops that.)
      const column = moved(as === 'parent' ? frozen.parent : frozen.row);
      if (input.action === 'update' && column === undefined) return;
      const ref = ledgers.refOf(target.view.connectionId, target.table.id);
      const key = keyText(target.table, stood);
      const receipts = as === 'line' ? await receiptsOfLine(trx, state.ledger, { table: ref, row: key }) : await receiptsOfSource(trx, state.ledger, { table: ref, row: key });
      // A line may have been under another parent before: each source keeps its own rounds, and one open anywhere holds the line.
      const bySource = new Map<string, Receipt[]>();
      for (const receipt of receipts) {
        if (receipt.posting !== posting.id) continue;
        const group = `${receipt.sourceTable}\u0000${receipt.sourceRow}\u0000${receipt.lineTable}`;
        bySource.set(group, [...(bySource.get(group) ?? []), receipt]);
      }
      const open = [...bySource.values()].some((group) => openRounds(group).some((round) => as !== 'source' || round.line === ''));
      if (!open) return;
      throw refused(input.action === 'delete' ? 'receipt-open' : 'mapped-changed', { ledger: state.ledger, posting }, column === undefined ? {} : { column });
    };
    for (const posting of scope.postings) await judge(posting, target.table, 'source');
    for (const posting of scope.asLine) await judge(posting, target.table, 'line');
    for (const line of scope.linePostings) {
      let owner: ResolvedTable;
      try {
        owner = target.view.table(line.child);
      } catch {
        continue;
      }
      await judge(line.posting, owner, 'parent');
    }
  }

  /** The columns of a table whose change can matter to a posting: a point's own, and what an open round froze. */
  function watchedColumns(target: WriteTarget, rules: TableRules | null): Set<string> {
    const out = new Set<string>();
    const scope = postingScope(rules);
    if (scope === null) return out;
    const points = (posting: DeclaredPosting, own: boolean): void => {
      for (const phase of ['reserve', 'post', 'reverse'] as const) {
        const point = posting[phase]?.on;
        if (point === undefined || 'create' in point || ownPoint(point) !== own) continue;
        const column = 'to' in point ? rules?.states?.column : point.column;
        if (column !== undefined) out.add(column);
      }
    };
    for (const posting of scope.postings) {
      points(posting, false);
      points(posting, true);
      for (const column of frozenColumns(posting).row) out.add(column);
    }
    for (const posting of scope.asLine) {
      points(posting, true);
      for (const column of frozenColumns(posting).row) out.add(column);
    }
    for (const line of scope.linePostings) {
      points(line.posting, false);
      for (const column of frozenColumns(line.posting).parent) out.add(column);
    }
    void target;
    return out;
  }

  /**
   * A DOOR THAT WRITES MANY ROWS AT ONCE CANNOT POST — a bulk edit, an undo,
   * a form's child rows, a batch, an import's change of a stored row, a row
   * moved by another row's effect. Each row of such a write is looked at on
   * the pool before anything is written: a create that would hand something
   * over, a change that crosses a point or touches what an open round froze,
   * a delete of a row with an open round — refused, to be made one row at a
   * time. Answers a row's own issue for an import (the import goes on);
   * throws for every other door. `history`: rows brought in as they were (an
   * import's creates, sample rows) hand nothing over and are never refused.
   */
  async function refuseBatch(input: {
    target: WriteTarget;
    rules: TableRules | null;
    action: 'create' | 'update' | 'delete';
    context: WriteContext;
    rows: readonly { values: Row; match?: Row | undefined; record?: Row | null | undefined }[];
    history?: boolean | undefined;
    /** Said of the refusal, for a row moved by an effect. */
    effect?: string | undefined;
  }): Promise<(Record<string, { code: string }> | null)[]> {
    const { target, rules, action } = input;
    const none = input.rows.map(() => null);
    if (postingScope(rules) === null || (await watched(target, rules)) === null) return none;
    if (action === 'create' && input.history === true) return none;
    const columns = watchedColumns(target, rules);
    const out: (Record<string, { code: string }> | null)[] = [];
    const stop = (posting: string | undefined, column?: string): Record<string, { code: string }> => {
      // An import refuses the row and goes on; every other door refuses the write.
      if (input.context.origin === 'import') return { [column ?? 'row']: { code: 'one-at-a-time' } };
      throw new PostingRefusedError('This is saved one row at a time: it hands something to an add-on.', { reason: 'one-at-a-time', ...(posting === undefined ? {} : { posting }), ...(input.effect === undefined ? {} : { table: input.effect }) });
    };
    /** Whether a write of a row, as a single save, would hand anything over. */
    const fires = async (before: Row | null, after: Row): Promise<string | null> => {
      let calls: PostingCall[];
      try {
        calls = callsFor({ target, rules, action: action === 'create' ? 'create' : 'update', before, after });
      } catch (error) {
        if (error instanceof PostingRefusedError) return String((error.details as { posting?: string } | undefined)?.posting ?? '');
        throw error;
      }
      for (const call of calls) {
        if (call.late !== true) return call.posting.id;
        // A line that would join a round its siblings reached.
        const gathered = await gather(target.db, call, target, after, false);
        if (gathered === null || gathered.source.key === '') continue;
        const receipts = await receiptsOfSource(target.db, call.ledger, { table: gathered.source.ref, row: gathered.source.key });
        if (gathered.lines.some((line) => phaseDue(roundOf(receipts, call.posting.id, line.key, line.ref), call.phase) && (reached(receipts, call, line.key, line.ref) || parentStands(call, gathered)))) return call.posting.id;
      }
      return null;
    };
    for (const row of input.rows) {
      if (action === 'create') {
        const posting = await fires(null, row.values);
        out.push(posting === null ? null : stop(posting));
        continue;
      }
      // The stored row is read only when the write can matter to a posting.
      if (action === 'update' && !Object.keys(row.values).some((column) => columns.has(column))) {
        out.push(null);
        continue;
      }
      const stored = row.record !== undefined ? row.record : row.match === undefined ? null : ((await kit.fetch(target, row.match)) ?? null);
      if (stored === null) {
        out.push(null);
        continue;
      }
      if (action === 'update') {
        const posting = await fires(stored, { ...stored, ...row.values });
        if (posting !== null) {
          out.push(stop(posting));
          continue;
        }
        // A rule switched off hands nothing over, and a payment kept until a time must still be told the row now stands: only a single save tells it.
        if ((await keptOf(target.db, { target, rules, before: stored, row: { ...stored, ...row.values } })).length > 0) {
          out.push(stop(undefined));
          continue;
        }
      }
      try {
        await guard(target.db, { target, rules, action, stood: stored, values: row.values });
        out.push(null);
      } catch (error) {
        if (!(error instanceof PostingRefusedError)) throw error;
        const details = (error.details ?? {}) as { posting?: string; column?: string };
        out.push(stop(details.posting, details.column));
      }
    }
    return out;
  }

  /**
   * Runs a step of a save and, when a ledger refused it for a fault somebody
   * can act on, leaves one audit row saying which check failed — after the
   * save's own transaction is gone, and never in place of the refusal.
   */
  async function audited<T>(run: () => Promise<T>, about: { target: WriteTarget; context: WriteContext }): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const reason = error instanceof PostingRefusedError ? String((error.details as { reason?: unknown } | undefined)?.reason ?? '') : '';
      if (error instanceof PostingRefusedError && AUDITED.has(reason)) {
        const details = (error.details ?? {}) as { ledger?: string; posting?: string; table?: string };
        try {
          await kit.ledgers?.refused?.({
            connectionId: about.target.view.connectionId,
            table: about.target.table.id,
            reason,
            // The word for why, wherever the failed answer was a plan's or a price's.
            ...(typeof (error as { cause?: unknown }).cause === 'string' && typeof (error as { detail?: unknown }).detail === 'string' ? { cause: (error as unknown as PlanFailed).cause, detail: (error as unknown as PlanFailed).detail } : {}),
            ...(details.ledger === undefined ? {} : { ledger: details.ledger }),
            ...(details.posting === undefined ? {} : { posting: details.posting }),
            ...(details.table === undefined ? {} : { ledgerTable: details.table }),
            actor: about.context.actor,
          });
        } catch {
          // The refusal is what the caller must hear, whatever became of its record.
        }
      }
      throw error;
    }
  }

  return { watched, refuseBatch, peek, firesAsStored, postStep, closeHeld, holdEndMoved, quoteStep, treePeek, treeStep, treeQuote, guard, holdParents, audited };
}

const isLabel = (value: unknown): value is { '@row': string } => typeof value === 'object' && value !== null && '@row' in value;
/** A planned row without the links it carries to rows of its own plan: what its totals are read from before those rows are in. */
function withoutLabels(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([column, value]) => [column, isLabel(value) ? null : value]));
}
/** A planned row with each `@row` label replaced by the key of the row that carries it. */
function resolveLabels(row: Row, labels: ReadonlyMap<string, unknown>): Row {
  return Object.fromEntries(Object.entries(row).map(([column, value]) => [column, isLabel(value) ? (labels.get(value['@row']) ?? null) : value]));
}

// ─── words ───────────────────────────────────────────────────────────────────

/** The most rows one "what is left" question asks about. */
export const WORDS_IDS_MAX = 60;

/** The add-on cannot say what is left right now. The caller decides what a customer is shown instead; nothing is guessed here. */
export class WordsUnavailable extends Error {
  override readonly name = 'WordsUnavailable';
}

/** What is left of one row asked about, in the add-on's own words. */
export interface WordsLine {
  /** The row asked about, as it was asked. */
  id: string;
  state: 'in' | 'low' | 'out';
  left?: string | undefined;
  exact?: string | undefined;
  after?: string | undefined;
  batch?: string | undefined;
  expires?: string | undefined;
  cause?: 'stock' | 'portions' | undefined;
  first?: { item: string; unit: string } | undefined;
  soon?: boolean | undefined;
}

/**
 * WHAT IS LEFT of these rows — asked of a ledger's action with nothing
 * written: the pool only, no transaction, no named lock. Every row asked
 * about is one line of quantity one, in the input the add-on's words name;
 * the action's reads run once for all of them and its code is asked ONCE.
 * A line whose planned rows would not fit a cap reads as out. Answers one
 * line per row, in the order asked. An add-on that cannot answer, or whose
 * code fails, is thrown as `WordsUnavailable`.
 */
export async function planWords(
  ledgers: LedgerRuntime,
  input: { view: SnapshotView; db: Db; timezone?: string | undefined; addOn: string; words: string; tableRef: string; keys: readonly string[]; origin: 'staff' | 'public' | 'system'; now: Date; rollupsOf?: (table: ResolvedTable) => readonly RollupInto[] },
): Promise<WordsLine[]> {
  if (input.keys.length === 0) return [];
  if (input.keys.length > WORDS_IDS_MAX) throw new ValidationFailedError(`At most ${String(WORDS_IDS_MAX)} rows are asked about at once.`, { reason: 'too-many' });
  // What is installed, read again if it moved: nothing is open here, so the pool may be asked.
  await ledgers.refresh?.();
  const manifest = ledgers.manifestOf(input.view.connectionId, input.addOn);
  const declared = ((manifest?.addOn as { words?: unknown } | undefined)?.words ?? []) as { id: string; ledger: string; action: string; input: string; showLeftBelow?: { setting: string } }[];
  const words = declared.find((candidate) => candidate.id === input.words);
  const found = words === undefined ? null : (ledgers.actionOf?.(input.view, input.addOn, words.ledger, words.action) ?? null);
  if (words === undefined || found === null) throw new WordsUnavailable(`"${input.addOn}" cannot say what is left right now`);
  const { ledger, action, decider } = found;
  return withDeciders([input.addOn], async () => {
    const settings = await ledgerSettings(ledger, input.db);
    // One line a row: the row itself in the input the words name, one of it, and nothing else.
    const lines = input.keys.map((key) => {
      const inputs: LineInputs = {};
      for (const [name, type] of Object.entries(action.inputs)) {
        if (name === words.input) inputs[name] = type === 'rowRef' ? { table: input.tableRef, row: key } : key;
        else if (type === 'decimal') inputs[name] = '1';
        else if (type === 'number') inputs[name] = 1;
        else inputs[name] = null;
      }
      return { line: key, lineTable: input.tableRef, inputs, multipliers: {}, round: 1 };
    });
    const source = { table: input.tableRef, row: '' };
    let plan: PostingOutput;
    let reads: Record<string, ScalarRow[]>;
    try {
      reads = await runReads(input.db, { ledger, action, lines, source, settings, receiptIds: [] });
      plan = callDecider(
        'rows',
        decider,
        { contract: 'posting-rows@1', ledger: ledger.id, action: words.action, posting: words.id, phase: 'post', mode: 'words', origin: input.origin, ...plannerClock(input.now, input.timezone), currency: null, source, lines, reads, settings, written: {}, version: ledger.version },
        { shape: postingOutputSchema },
      ) as PostingOutput;
    } catch (error) {
      if (error instanceof DeciderFailed || error instanceof LedgerTooLarge) throw new WordsUnavailable(`"${input.addOn}" did not say what is left`);
      throw error;
    }
    const said = new Map((plan.words ?? []).map((line: { line: string }) => [line.line, line as unknown as Omit<WordsLine, 'id'> & { line: string }]));
    return input.keys.map((key) => {
      const one = said.get(key);
      if (one === undefined) throw new WordsUnavailable(`"${input.addOn}" said nothing of a row it was asked about`);
      // What the line would write, against the caps the reads show: over one, it is out whatever the add-on said.
      const fits = judgePlanned(
        plan.rows.flatMap((row) => (row.op === 'insert' && row.line === key ? [{ table: row.table, line: row.line, values: row.values }] : [])),
        {
          rollups: (table) => {
            const at = ledger.table(table);
            return at === null || input.rollupsOf === undefined ? [] : input.rollupsOf(at);
          },
          rows: (tableId) => action.reads.flatMap((read) => (ledger.table(read.table)?.id === tableId ? (reads[read.as] ?? []) : [])),
        },
      );
      const { line: _line, ...rest } = one;
      return fits.ok ? { ...rest, id: key } : forcedOut({ ...rest, id: key });
    });
  });
}

/**
 * A line the add-on called in, that a cap says is out: told as out, with
 * nothing of what the add-on worked out for a line it thought it had — how
 * many are left, the exact figure, the batch, the item it would take first.
 * When more is expected is still true, and still told.
 */
export function forcedOut(line: WordsLine): WordsLine {
  return { id: line.id, state: 'out', ...(line.after === undefined ? {} : { after: line.after }), ...(line.soon === undefined ? {} : { soon: line.soon }), ...(line.cause === undefined ? {} : { cause: line.cause }) };
}

/**
 * How many are left, as a customer may be told: only when the owner set a
 * "show how many are left below" above zero, the thing is not out, and what
 * is left (in whole ones) is below it. The same answer for a public refusal,
 * a public quote and the public "what is left".
 */
export function publicLeft(settings: Readonly<Record<string, unknown>>, words: { showLeftBelow?: { setting: string } | undefined } | undefined, left: string | undefined, state: 'in' | 'low' | 'out' | undefined): string | undefined {
  const column = words?.showLeftBelow?.setting;
  if (column === undefined || left === undefined || state === 'out') return undefined;
  const below = Number(settings[column]);
  const whole = Math.floor(Number(left));
  // Sold below nothing (a shop that sells whether or not the count is right): no figure, never a negative one.
  if (!Number.isFinite(below) || below <= 0 || !Number.isFinite(whole) || whole < 0 || whole >= below) return undefined;
  return String(whole);
}

// ─── what a door answers ─────────────────────────────────────────────────────

/** What a save or a quote says of one ledger, as a staff reply carries it. */
export interface PostingAnswer {
  ledger: string;
  state: 'ok' | 'refused' | 'unavailable';
  reason?: string;
  line?: number;
  path?: (string | number)[];
  notes?: { line: number; note: string }[];
  /** What is left and of what, on a refused quote — only for somebody who may read the ledger's rows (`ledgers/tell.ts`). */
  left?: string;
  item?: string;
}

/**
 * The calls of a save or a quote as its reply tells them. A save's are `ok`,
 * or `unavailable` for one let through while the add-on could not answer (a
 * refusal is the error itself); a quote's are whatever it was told. `left`
 * and `item` are not here: they are told only to a reader of the ledger's
 * own tables, by whoever knows the caller is one.
 */
export function postingAnswers(outcomes: readonly PostedOutcome[] | undefined): PostingAnswer[] | undefined {
  if (outcomes === undefined || outcomes.length === 0) return undefined;
  return outcomes.map((call) => {
    const notes = call.notes.map((note) => ({ line: Math.max(0, call.lines.indexOf(note.line)), note: note.note }));
    const quote = call.quote;
    return {
      ledger: call.ledger,
      state: quote?.state ?? (call.state === 'unplanned' ? 'unavailable' : 'ok'),
      ...(quote?.reason === undefined ? {} : { reason: quote.reason }),
      ...(quote?.line === undefined ? {} : { line: quote.line }),
      ...(quote?.path === undefined ? {} : { path: quote.path }),
      ...(notes.length === 0 ? {} : { notes }),
    };
  });
}
