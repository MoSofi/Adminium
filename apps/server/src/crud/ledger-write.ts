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
import { postingOutputSchema, type PostingOutput } from '@adminium/add-on-contracts';
import type { LedgerAction } from '@adminium/manifest';
import type { Kysely } from 'kysely';

import { callDecider, DeciderFailed, type InstalledDecider } from '../add-ons/decide.js';
import type { SourceDatabase } from '../connections/manager.js';
import { ConflictError, PostingRefusedError, ValidationFailedError } from '../errors.js';
import type { LedgerRuntime, ResolvedLedger } from '../ledgers/registry.js';
import { heldNames, LockMoved, type NamedLock } from './capacity/locks.js';
import type { ClimbStart, HeldBalances } from './climb.js';
import type { ColumnCode, TableRules } from './column-rules.js';
import { readDbRefusal, writeConflict } from './db-errors.js';
import { isUniqueViolation } from './decided-columns.js';
import type { ResolvedTable } from './identifiers.js';
import { firedPoints, postingScope, type DeclaredPosting, type PostingPhaseName } from './ledger-points.js';
import { LedgerTooLarge, ledgerSettings, lockNames, mapInputs, runReads, type LineInputs, type MappedLine, type ReadContext, type ScalarRow } from './ledger-reads.js';
import { phaseDue, receiptsOfSource, roundOf, roundRows } from './ledger-receipts.js';
import type { Row } from './mask.js';
import { instantOf, RecordLocked, StateMoveRefused } from './states.js';
import type { WriteClock } from './write-clock.js';
import type { WriteContext, WriteTarget } from './write-context.js';

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
      for (const column of given) if (!scope.update.set.includes(column)) return fail('scope-table', `${at}: "${row.table}.${column}" is not a column an update may set`);
    }

    // 3. Nothing Adminium decides, and never the receipt's own link.
    for (const column of given) {
      if (column === RECEIPT_LINK) return fail('scope-op', `${at}: "${RECEIPT_LINK}" is written by Adminium`);
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
  notes: { line: string; note: string; item?: string | undefined }[];
  written: { table: ResolvedTable; row: Row; before: Row | null }[];
  /** Each amount Adminium decided, and the column of the source row it was written to. */
  decided: { line: string; input: string; column: string; value: string }[];
}

/** One phase of one rule of a table, named: what `post` runs for a stored row. */
export interface OnePhase {
  posting: string;
  phase: PostingPhaseName;
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
}

const ORIGINS: Readonly<Record<string, 'staff' | 'public' | 'system'>> = { public: 'public', automation: 'system', import: 'system', hook: 'system', action: 'system' };
/** Who a write is, as an add-on is told: a customer, the system, or staff. */
export const postingOrigin = (context: Pick<WriteContext, 'origin'>): 'staff' | 'public' | 'system' => ORIGINS[context.origin] ?? 'staff';

const refused = (reason: string, call: Pick<PostingCall, 'ledger' | 'posting'> | null, more: Record<string, unknown> = {}): PostingRefusedError =>
  new PostingRefusedError(REFUSAL_WORDS[reason] ?? 'The add-on refused this.', { reason, ...(call === null ? {} : { ledger: call.ledger.id, posting: call.posting.id }), ...more });

const REFUSAL_WORDS: Readonly<Record<string, string>> = {
  'add-on-unavailable': 'The add-on this depends on cannot be asked right now, so this cannot be saved.',
  'planner-failed': 'The add-on this depends on did not answer as it should, so nothing was saved.',
  'too-large': 'This is more than can be posted in one save.',
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
    };
  }
  return out;
}

/** The refusals an operator can act on: each leaves one audit row. An add-on's own "no" (out of stock) leaves none. */
const AUDITED: ReadonlySet<string> = new Set(['planner-failed', 'too-large', 'add-on-unavailable', 'hooked', 'guarded']);

const callKey = (call: { posting: { id: string }; phase: string }): string => `${call.posting.id}|${call.phase}`;
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
    if (scope === null || scope.postings.length === 0) return null;
    const ledgers = kit.ledgers;
    // No add-on runtime: nothing can be told idle from live, so every rule is watched (and a point that fires is refused).
    if (ledgers === undefined) return [];
    await ledgers.refresh?.();
    const addOns = new Set<string>();
    for (const posting of scope.postings) if (ledgers.resolve(target.view, target.table, posting).state !== 'idle') addOns.add(posting.into.addOn);
    return addOns.size === 0 ? null : [...addOns].sort();
  }

  /** The calls a write fires on a row that is its own source, from what is installed as memory holds it now. */
  function callsFor(input: { target: WriteTarget; rules: TableRules | null; action: 'create' | 'update'; before: Row | null; after: Row; only?: OnePhase | undefined }): PostingCall[] {
    const scope = postingScope(input.rules);
    if (scope === null) return [];
    const { only } = input;
    // One phase of one rule, asked for by name (a hold let go by the clock): no point is crossed, and none is needed.
    const fired =
      only === undefined
        ? firedPoints(scope, input.before, input.after, input.action, input.rules?.states?.column).filter((point) => point.role === 'source')
        : scope.postings.filter((posting) => posting.id === only.posting).map((posting) => ({ posting, phase: only.phase, role: 'source' as const }));
    if (fired.length === 0) return [];
    const ledgers = kit.ledgers;
    // A server with no add-on runtime cannot tell an idle rule from a live one: a write that fires one is refused, never written unposted.
    if (ledgers === undefined) throw refused('add-on-unavailable', null);
    const { target } = input;
    const calls: PostingCall[] = [];
    for (const point of fired) {
      const state = ledgers.resolve(target.view, target.table, point.posting);
      if (state.state === 'idle') continue;
      if (!('ledger' in state) || state.ledger === undefined || !('action' in state) || state.action === undefined) {
        // Switched off with nothing to ask: nothing starts, and nothing is refused.
        if (state.state === 'off') continue;
        // What was taken is always let go, even when not so much as its receipt can be written.
        if (point.phase === 'reverse') continue;
        throw refused('add-on-unavailable', null, { posting: point.posting.id });
      }
      // An off rule starts no round; whether one is open to give back is read under the locks.
      if (state.state === 'off' && point.phase !== 'reverse') continue;
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
      });
    }
    return calls;
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

  /** The calls this write fires on a row that is its own source; null when it hands nothing to any ledger now. */
  async function peek(input: { target: WriteTarget; rules: TableRules | null; action: 'create' | 'update'; before: Row | null; after: Row; context: WriteContext; only?: OnePhase | undefined }): Promise<Peek | null> {
    if (postingScope(input.rules) === null) return null;
    await kit.ledgers?.refresh?.();
    const live = callsFor(input);
    if (live.length === 0) return null;
    const ledgers = kit.ledgers!;
    const { target } = input;
    // Every table the plans may write, and each ledger's receipts: the role must hold them before a transaction is open.
    const tables = new Map<string, WriteTarget>();
    const judged = new Set<string>();
    for (const call of live) {
      // An action that narrows the ledger's list writes only those tables: the others are not in its way.
      const narrowed = call.action.writes === undefined ? null : new Set(call.action.writes);
      for (const [tableId, scope] of [...call.ledger.writes, [call.ledger.receipts.id, null] as const]) {
        const written = tables.get(tableId) ?? (await kit.withRights({ ...target, table: target.view.table(tableId) }));
        tables.set(tableId, written);
        const once = `${call.ledger.id}\u0000${tableId}`;
        if (scope === null || judged.has(once) || (narrowed !== null && !narrowed.has(call.ledger.refOf(tableId)))) continue;
        judged.add(once);
        await refuseUnwritable(call, written, scope, input.context);
      }
    }
    return {
      calls: live,
      tables,
      addOns: [...new Set(live.map((call) => call.ledger.addOn))].sort(),
      async names(row) {
        const out = new Map<string, NamedLock>();
        for (const call of live) {
          // Asked of nobody, it writes no row of the add-on's: there is nothing of it to stand on.
          if (call.decider === null) continue;
          const settings = await ledgerSettings(call.ledger, target.db);
          const mapped = mapOrRefuse(call, target, row, settings, ledgers);
          const source = { table: ledgers.refOf(target.view.connectionId, target.table.id), row: keyText(target.table, row) };
          const receipts = await receiptsOfSource(target.db, call.ledger, source);
          const round = roundOf(receipts, call.posting.id, '');
          const roundIds = [round.reserved?.id, round.posted?.id].filter((id): id is string | number => id !== undefined);
          const lines = [{ line: '', lineTable: '', inputs: mapped.inputs, multipliers: mapped.multipliers, round: round.round }];
          const reads = await readOrRefuse(target.db, call, { lines, source, settings, receiptIds: roundIds });
          for (const name of lockNames(target.view.connectionId, call.ledger, call.action, reads)) out.set(name, { name, busy: 'CAPACITY_BUSY' });
          // A table it writes keeps a limit: the pools its rows will take from are named too — from the plan, asked once here with nothing held.
          const limited = [...call.ledger.writes.keys()].filter((tableId) => (call.action.writes === undefined || call.action.writes.includes(call.ledger.refOf(tableId))) && kit.limited(tables.get(tableId)!));
          // (A round nobody planned is given back unasked.)
          const nobody = call.phase === 'reverse' && [round.reserved, round.posted].every((receipt) => receipt === null || receipt.state === 'unplanned');
          if (limited.length === 0 || !phaseDue(round, call.phase) || nobody) continue;
          let plan: PostingOutput;
          try {
            const written = call.phase === 'reverse' || (call.phase === 'post' && round.reserved !== null) ? await roundRows(target.db, call.ledger, roundIds) : {};
            plan = askPlanner(call, 'peek', { target, context: input.context, at: new Date(), source, lines, reads, settings, written });
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
      },
    };
  }

  /** The add-on's code, asked for its plan. A failure of the code is the plan's failure, with the cause the audit keeps. */
  function askPlanner(
    call: PostingCall,
    mode: 'peek' | 'save',
    input: { target: WriteTarget; context: WriteContext; at: Date; source: { table: string; row: string }; lines: readonly unknown[]; reads: Record<string, ScalarRow[]>; settings: ScalarRow; written: Record<string, ScalarRow[]> },
  ): PostingOutput {
    const planInput = {
      contract: 'posting-rows@1' as const,
      ledger: call.ledger.id,
      action: call.posting.into.action,
      posting: call.posting.id,
      phase: call.phase,
      mode,
      origin: postingOrigin(input.context),
      now: input.at.toISOString(),
      today: input.at.toISOString().slice(0, 10),
      zone: input.target.timezone ?? 'UTC',
      currency: null,
      source: input.source,
      lines: input.lines,
      reads: input.reads,
      settings: input.settings,
      written: input.written,
      version: call.ledger.version,
    };
    try {
      return callDecider('rows', call.decider!, planInput, { shape: postingOutputSchema }) as PostingOutput;
    } catch (error) {
      if (error instanceof DeciderFailed) throw new PlanFailed(call, error.cause, error.detail);
      throw error;
    }
  }

  function mapOrRefuse(call: PostingCall, target: WriteTarget, row: Row, settings: ScalarRow, ledgers: LedgerRuntime): MappedLine {
    const mapped = mapInputs({ posting: call.posting, action: call.action, table: target.table, tableRef: ledgers.refOf(target.view.connectionId, target.table.id), row, settings });
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
    input: { target: WriteTarget; rules: TableRules | null; action: 'create' | 'update'; before: Row | null; row: Row; context: WriteContext; clock: WriteClock; only?: OnePhase | undefined },
  ): Promise<PostedOutcome[]> {
    const { target, context, clock } = input;
    /** The row that posts, as it stands: an amount decided for it by one call is what the next one reads. */
    let row = input.row;
    const fired = callsFor({ target, rules: input.rules, action: input.action, before: input.before, after: row, only: input.only });
    if (fired.length === 0) return [];
    const known = new Set((peeked?.calls ?? []).map(callKey));
    for (const call of fired) if (!known.has(callKey(call))) throw new LockMoved(`posting ${callKey(call)}`);
    const ledgers = kit.ledgers!;
    const within: WriteTarget = { ...target, db: trx };
    const source = { table: ledgers.refOf(target.view.connectionId, target.table.id), row: keyText(target.table, row) };
    const held = heldNames(trx);
    const settingsOf = new Map<string, ScalarRow>();
    const outcomes: PostedOutcome[] = [];
    const writtenRows: { rules: TableRules | null; record: Row; before: Row | null }[] = [];

    for (const call of fired) {
      const { ledger, posting, phase } = call;
      // Receipts first: the first statement on one of the add-on's tables, so the add-on is asked about once more.
      const now = await ledgers.versionNow(ledger.addOn);
      if (call.decider !== null && (now === null || now.status !== 'installed' || now.version !== call.decider.version)) throw writeConflict();
      const receipts = await receiptsOfSource(trx, ledger, source);
      const round = roundOf(receipts, posting.id, '');
      if (!phaseDue(round, phase)) continue;
      // Switched off: nothing new starts. A round that is open is still given back.
      if (call.off && phase !== 'reverse') continue;
      const at = clock.locked(trx);
      const receiptsTarget: WriteTarget = { ...(peeked?.tables.get(ledger.receipts.id) ?? { ...target, table: ledger.receipts }), db: trx };
      // How long what this call takes is kept for: a hold, or a payment decided as the row is made — let go by the clock if nothing closes it first.
      const kept = (phase === 'reserve' && call.action.holds === true) || (phase === 'post' && input.action === 'create' && call.action.decides !== undefined);
      const receiptBase = {
        source_table: source.table,
        source_row: source.row,
        source_line: '',
        line_table: '',
        ledger: ledger.id,
        action: posting.into.action,
        posting: posting.id,
        phase,
        round: round.round,
        add_on_version: ledger.version,
        origin: postingOrigin(context),
        by: context.actor?.id ?? context.actor?.kind ?? 'system',
        // As an instant in text: every engine's driver takes that, and none of them a Date the same way.
        at: at.toISOString(),
        held_until: kept && typeof posting.heldUntil === 'string' ? instantText(row[posting.heldUntil]) : null,
      };
      /** What the round kept until a time is kept no longer: it was taken for good, or given back. */
      const close = async (): Promise<void> => {
        if (phase === 'reserve') return;
        for (const open of phase === 'reverse' ? [round.reserved, round.posted] : [round.reserved]) {
          if (open !== null && open.heldUntil !== null) await kit.updateRaw(receiptsTarget, { held_until: null }, { [ledger.receipts.primaryKey[0] ?? 'id']: open.id });
        }
      };
      const outcome: PostedOutcome = { addOn: ledger.addOn, ledger: ledger.id, action: posting.into.action, posting: posting.id, phase, round: round.round, rows: 0, version: ledger.version, state: 'planned', source, notes: [], written: [], decided: [] };

      // A round nobody planned wrote nothing: giving it back writes nothing either, and nobody is asked.
      const unplanned = [round.reserved, round.posted].filter((receipt): receipt is NonNullable<typeof receipt> => receipt !== null);
      if (phase === 'reverse' && unplanned.every((receipt) => receipt.state === 'unplanned')) {
        for (const receipt of unplanned) await kit.updateRaw(receiptsTarget, { state: 'planned', rows: 0 }, { [ledger.receipts.primaryKey[0] ?? 'id']: receipt.id });
        await writeReceipt(receiptsTarget, ledger, { ...receiptBase, state: 'planned', rows: 0 });
        await close();
        outcomes.push(outcome);
        continue;
      }

      let settings = settingsOf.get(ledger.addOn);
      if (settings === undefined) settingsOf.set(ledger.addOn, (settings = await ledgerSettings(ledger, trx)));

      if (call.decider === null) {
        // The add-on cannot be asked. What was taken is always given back, to be worked out when it can answer.
        if (phase !== 'reverse') {
          // Something new is taken only when every row it would take from says it may be taken unasked.
          const allow = call.action.unavailable?.allow;
          if (allow === undefined) throw refused('add-on-unavailable', call);
          const mapped = mapOrRefuse(call, target, row, settings, ledgers);
          const reads = await readOrRefuse(trx, call, { lines: [{ line: '', inputs: mapped.inputs }], source, settings, receiptIds: [] });
          const asked = reads[allow.read] ?? [];
          if (asked.length === 0 || !asked.every((found) => yes(found[allow.column]))) throw refused('add-on-unavailable', call);
        }
        await writeReceipt(receiptsTarget, ledger, { ...receiptBase, state: 'unplanned', rows: 0 });
        await close();
        outcomes.push({ ...outcome, state: 'unplanned' });
        continue;
      }

      const mapped = mapOrRefuse(call, target, row, settings, ledgers);
      const lines = [{ line: '', lineTable: '', inputs: mapped.inputs, multipliers: mapped.multipliers, round: round.round }];
      const roundIds = [round.reserved?.id, round.posted?.id].filter((id): id is string | number => id !== undefined);
      const reads = await readOrRefuse(trx, call, { lines, source, settings, receiptIds: roundIds });
      // What this call stands on must be what the save locked: a row that moved in between starts the save again.
      for (const name of lockNames(target.view.connectionId, ledger, call.action, reads)) if (!held.has(name)) throw new LockMoved(name);
      // What the round wrote so far: handed when it is given back, and when what was held is taken.
      const written = phase === 'reverse' || (phase === 'post' && round.reserved !== null) ? await roundRows(trx, ledger, roundIds) : {};

      const plan = askPlanner(call, 'save', { target, context, at, source, lines, reads, settings, written });
      // A refusal fails the save — but never a giving back: what was written is always given back.
      const first = phase === 'reverse' ? undefined : plan.refusals?.[0];
      if (first !== undefined) throw refused(first.reason, call, { ...(first.left === undefined ? {} : { left: first.left }), ...(first.item === undefined ? {} : { item: first.item }) });

      const manifest = ledgers.manifestOf(target.view.connectionId, ledger.addOn);
      const facts = tableFacts(kit, within, ledger, manifest ?? {});
      const writes = Object.fromEntries([...ledger.writes].map(([tableId, scope]) => [ledger.refOf(tableId), scope]));
      const checked = checkOutput({ writes, action: call.action, tables: facts, reads, lines, written, mapped: new Set(Object.keys(posting.map)) }, plan);
      if (!checked.ok) throw new PlanFailed(call, checked.cause, checked.detail);

      // The receipt, before any row it stands for: its own key is what stops the same phase written twice.
      // A plan with nothing in it leaves no receipt — unless the round holds something: taking what was held is then recorded, and its time let go.
      if (plan.rows.length === 0 && (plan.decides ?? []).length === 0 && phase !== 'reverse' && round.reserved === null) {
        outcome.notes = (plan.notes ?? []).map((note: { line: string; note: string; item?: string | undefined }) => ({ ...note }));
        outcomes.push(outcome);
        continue;
      }
      const receipt = await writeReceipt(receiptsTarget, ledger, { ...receiptBase, state: 'planned', rows: plan.rows.length });
      await close();
      const receiptId = receipt[ledger.receipts.primaryKey[0] ?? 'id'];

      // The plan's rows, written as Adminium's own: the tables' own defaults, formulas and checks apply.
      const labels = new Map<string, unknown>();
      const inserts: { target: WriteTarget; rules: TableRules | null; values: Row; label: string | undefined }[] = [];
      const updates: { target: WriteTarget; rules: TableRules | null; key: Row; set: Row; before: Row }[] = [];
      for (const planRow of plan.rows) {
        const table = ledger.table(planRow.table)!;
        // As the peek resolved it: nothing waits on the pool from inside the transaction.
        const rowTarget: WriteTarget = { ...(peeked?.tables.get(table.id) ?? { ...target, table }), db: trx };
        if (planRow.op === 'insert') {
          inserts.push({ target: rowTarget, rules: kit.rulesOf(rowTarget), values: { ...planRow.values, [RECEIPT_LINK]: receiptId }, label: planRow.label });
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
      // What was decided, written to the row that posted — read here, after its own totals were settled, so "what is due" was what the
      // other payments left. The row's own cap still judges it (a payment above what is due is the host's refusal, as ever).
      const decisions = plan.decides ?? [];
      if (decisions.length > 0) {
        const set: Row = {};
        for (const decision of decisions) {
          const column = posting.map[decision.input];
          if (typeof column !== 'string') throw new PlanFailed(call, 'scope-decides', `"${decision.input}" is mapped to no column of the row`);
          // Only a plain column of the row takes a decided amount: never its key, its state, or anything a rule of the table works out.
          const own = input.rules;
          if (target.table.primaryKey.includes(column) || own?.states?.column === column || (own?.numbered ?? []).includes(column) || (own?.formulas ?? []).some((formula) => formula.column === column)) {
            throw new PlanFailed(call, 'scope-decides', `"${column}" is not a column an amount can be decided into`);
          }
          set[column] = decision.value;
          outcome.decided.push({ line: decision.line, input: decision.input, column, value: decision.value });
        }
        row = (await kit.decide(within, Object.fromEntries(target.table.primaryKey.map((column) => [column, row[column]])), set, row)) ?? row;
      }
      const settleStarts = writtenRows.splice(0).flatMap((item) => kit.starts(item.rules, [{ record: item.record, before: item.before }]));
      try {
        // One settle a call: each total once, each cap judged once against what was held.
        await kit.settle(within, settleStarts, balances);
      } catch (error) {
        if (error instanceof ConflictError && error.code === 'BALANCE_EXCEEDED') {
          throw refused(ledger.refusal === 'stock' ? 'out-of-stock' : 'over-limit', call, phase === 'reverse' ? { phase: 'reverse' } : {});
        }
        throw error;
      }
      outcome.rows = plan.rows.length;
      outcome.notes = (plan.notes ?? []).map((note: { line: string; note: string; item?: string | undefined }) => ({ ...note }));
      outcomes.push(outcome);
    }
    return outcomes;
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
            ...(error instanceof PlanFailed ? { cause: error.cause, detail: error.detail } : {}),
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

  return { watched, peek, postStep, audited };
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
