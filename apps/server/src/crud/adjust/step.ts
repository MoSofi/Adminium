// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PRICE QUESTION, ASKED INSIDE A SAVE.
 *
 * An order's price may be lowered by an add-on that keeps offers, codes and
 * vouchers. Whenever a save changes what that price depends on — a line
 * added, a code typed, a reduction given by hand — Adminium asks the add-on
 * again, in the save's own transaction, after its rows are written and
 * BEFORE its totals are worked out:
 *
 *  1. read the order as it now stands, its lines and the codes typed on it,
 *     the add-on's own rows it declared it reads, and — only for a customer
 *     whose identity was proved — what is known of them;
 *  2. ask the add-on's code, which touches no database and no clock;
 *  3. check the answer (`check.ts`): nothing of it is taken on trust;
 *  4. write it — each line's reduction, the order's, the links a typed code
 *     found, and the rows that say what was applied — as Adminium's own
 *     statements. Only what changed is written.
 *
 * The totals are then settled once, by the save itself, from the reductions
 * just written. A quote does the same on a transaction it rolls back, and
 * never writes what was applied. Any refusal undoes the whole save: an order
 * is never stored at a price nobody worked out.
 *
 * Every read is a plain read on the transaction's handle; the order row is
 * held by the save that calls.
 */
import { ADJUST_LINES_MAX, adjustOutputSchema, type AdjustApplied, type AdjustInput, type AdjustOutput, type AdjustUse, type PostingUse } from '@adminium/add-on-contracts';
import { ratioText, sameDecimal, toRatio } from '@adminium/manifest';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import { callDecider, DeciderFailed, type InstalledDecider } from '../../add-ons/decide.js';
import type { SourceDatabase } from '../../connections/manager.js';
import { AdjustRefusedError, PostingRefusedError, ValidationFailedError } from '../../errors.js';
import type { LedgerRuntime, ResolvedAdjuster } from '../../ledgers/registry.js';
import type { CustomerKeyOf } from '../../public-api/customer-key.js';
import type { TableRules } from '../column-rules.js';
import { readDbRefusal, writeConflict } from '../db-errors.js';
import { isUniqueViolation } from '../decided-columns.js';
import { evaluateAll, placesFor, touchedFormulas } from '../formulas.js';
import type { ResolvedTable } from '../identifiers.js';
import { labelColumnFor } from '../labels.js';
import { ledgerSettings, rowOut, type ScalarRow } from '../ledger-reads.js';
import { receiptsOfSource, roundOf, roundRows } from '../ledger-receipts.js';
import type { Row } from '../mask.js';
import { priceNights } from '../per-night.js';
import { venueClock } from '../venue-time.js';
import type { WriteClock } from '../write-clock.js';
import type { WriteAction, WriteActor, WriteContext, WriteTarget } from '../write-context.js';
import { bindWriteValue, booleanOf, sameValue } from '../write-values.js';
import { adjustWords, publicReason, refusalOf, type RefusedCode } from './answers.js';
import { checkAdjust } from './check.js';
import { orderFigures, type FiguredRow } from './figures.js';
import { refundShares } from './refund.js';
import { AdjustTooLarge, CODE_ROWS_MAX, adjustCodeOf, adjustLineOf, findCodes, loadCodes, loadLines, loadOffers, loadOrder, loadPerson, type LoadedCode, type LoadedLine } from './load.js';
import { frozenNow, moved, touched, type CompiledAdjust } from './rule.js';

type Db = Kysely<SourceDatabase>;

/** What the step takes from the write service it is built in. */
export interface AdjustKit {
  ledgers: LedgerRuntime | undefined;
  rulesOf(target: WriteTarget): TableRules | null;
  withRights(target: WriteTarget): Promise<WriteTarget>;
  /** Whether project code changes a row of the table before it is written. */
  hooked(target: WriteTarget, action: 'create' | 'update', context: WriteContext): Promise<boolean>;
  /** A row changed exactly as given: Adminium's own statement, with no rule of the table judging it. */
  update(target: WriteTarget, set: Row, key: Row): Promise<void>;
  /** Rows written exactly as given, in one statement. */
  insert(target: WriteTarget, rows: readonly Row[]): Promise<void>;
  /** The rows that hold these values, taken away: Adminium's own statement. */
  remove(target: WriteTarget, match: Row): Promise<void>;
  /** The connection's currency, for a table whose places follow it. */
  currency(target: WriteTarget): Promise<string | null>;
  /** Where the venue is: an offer of the lunch hour is judged on the venue's clock, whatever else the order's table reads of it. */
  zone(target: WriteTarget): Promise<string>;
  /** A customer's key in a connection; absent on a service built without one. */
  customerKey: CustomerKeyOf | undefined;
  /** The roles a writer holds, by slug; `any` for one no limit binds. Absent: nobody holds a role. */
  rolesOf: ((actor: WriteActor | null) => Promise<ReadonlySet<string> | 'any'>) | undefined;
}

/** What a user may take off by hand: the most their roles allow. `amount` null: no limit in money. */
interface Ceiling {
  percent: string;
  amount: string | null;
  comp: boolean;
}
const NO_LEAVE: Ceiling = { percent: '0', amount: '0', comp: false };
type Ratio = NonNullable<ReturnType<typeof toRatio>>;
const ZERO: Ratio = { n: 0n, d: 1n };
const more = (a: Ratio, b: Ratio): boolean => a.n * b.d > b.n * a.d;
const plus = (a: Ratio, b: Ratio): Ratio => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
/** A figure cut down to so many decimals: the most a limit gives is never said as more than it is. */
const floorTo = (value: Ratio, places: number): Ratio => {
  const factor = 10n ** BigInt(places);
  return { n: (value.n * factor) / value.d, d: factor };
};

/**
 * The limit of whoever holds these roles, read from the add-on's own table on
 * the save's transaction: the highest percent of their rows, the highest
 * amount (none at all when one row sets none), and leave to give a comp when
 * a row says so. No row is a limit of nothing.
 */
async function ceilingOf(trx: Db, adjuster: ResolvedAdjuster, roles: readonly string[], places: number): Promise<Ceiling> {
  const declared = adjuster.declared.ceilings;
  const table = declared === undefined ? null : adjuster.table(declared.table);
  if (declared === undefined || table === null || roles.length === 0) return NO_LEAVE;
  const rows = (await trx
    .selectFrom(table.id as never)
    .selectAll()
    .where(sql.ref(declared.role), 'in', roles as never)
    .execute()) as Row[];
  if (rows.length === 0) return NO_LEAVE;
  let percent: Ratio = ZERO;
  let amount: Ratio | null = ZERO;
  for (const row of rows) {
    // A figure that is no number, or less than nothing, raises no limit.
    const p = toRatio(row[declared.maxPercent]);
    if (p !== null && more(p, percent)) percent = p;
    if (empty(row[declared.maxAmount])) amount = null;
    else {
      const a = toRatio(row[declared.maxAmount]);
      if (amount !== null && a !== null && more(a, amount)) amount = a;
    }
  }
  return { percent: ratioText(percent, 2), amount: amount === null ? null : ratioText(amount, places), comp: declared.comp !== undefined && rows.some((row) => booleanOf(row[declared.comp!]) === true) };
}

/**
 * Whether a reduction by hand is more than a limit allows, judged on the
 * figure asked: the most the limit gives, as text, or null when it is within.
 * A percent is held to the limit's percent; an amount to the limit's amount —
 * and, where the limit names no amount, to what its percent of the goods
 * comes to (a role allowed ten percent is not allowed any sum). A comp needs
 * the leave to give one. What a percent COMES TO against an amount limit is
 * the add-on's to judge and the answer's check to hold: it depends on the
 * offers applied before it.
 */
function beyond(limit: Ceiling, kind: string, value: string, goods: Ratio, places: number): string | null {
  if (kind === 'comp') return limit.comp ? null : '0';
  const asked = toRatio(value);
  // A figure that is no number takes nothing off.
  if (asked === null) return null;
  const percent = toRatio(limit.percent) ?? ZERO;
  if (kind === 'percent') return more(asked, percent) ? limit.percent : null;
  if (limit.amount !== null) return more(asked, toRatio(limit.amount) ?? ZERO) ? limit.amount : null;
  const share: Ratio = { n: goods.n * percent.n, d: goods.d * percent.d * 100n };
  return more(asked, share) ? ratioText(floorTo(share, places), places) : null;
}

/** One order table whose price a write may move, with the add-on that answers it as it stands now. */
export interface AdjustFor {
  /** The order's table, as the connection's role may write it. */
  target: WriteTarget;
  adjust: CompiledAdjust;
  adjuster: ResolvedAdjuster;
  decider: InstalledDecider;
  /** Where what was applied is kept, as the role may write it. */
  applied: WriteTarget;
}

/** What a write may ask, looked at before its transaction. */
export interface AdjustPeek {
  orders: AdjustFor[];
  /** The add-ons whose gates the save enters as a reader. */
  addOns: string[];
}

/** One order priced again. */
export interface AdjustRun {
  for: AdjustFor;
  /** The order's key. */
  key: unknown;
  /** The order as this save just wrote it, when it is in hand (a row just made). */
  order?: Row | undefined;
  /** The order as it was held before this save's statement; null for an order the save itself makes. */
  stood: Row | null;
  /** Whether this save wrote something the price depends on: what a frozen order refuses. */
  touches: boolean;
  /** A quote writes the reductions on a transaction it rolls back, and never what was applied. */
  mode: 'save' | 'dry';
  context: WriteContext;
  clock: WriteClock;
  /** The reader's language, for a name the answer gives in several. */
  locale?: string | undefined;
  /** The save checks the price it was shown (`expect`): a code that no longer stands is held back for that check to answer. */
  expects?: boolean | undefined;
  /**
   * `post`: the rule that records what the order used fires in this save (it
   * is placed, or paid) — the add-on says which uses the order has, and the
   * save hands them to that rule. `line` otherwise: no use is recorded.
   */
  point?: 'line' | 'post' | undefined;
  /**
   * What of the order this save changes: `uses` — WHICH reductions it has (a
   * code typed, changed or taken off, a reduction by hand, its customer) — or
   * `lines`, what its lines are worth. Once what an order used is recorded,
   * the first is refused and the second priced under what was recorded.
   */
  changes?: 'uses' | 'lines' | undefined;
}

export interface AdjustResult {
  /** What was applied, line by line, as the add-on answered. */
  applied: AdjustApplied[];
  told: NonNullable<AdjustOutput['told']>;
  uses: AdjustUse[];
  /** The order's reduction. */
  discount: string;
  /** Each line with its reduction, by the line's own table and key. */
  lines: { table: string; key: string; line: string; discount: string }[];
  /** How many rows' reductions this call changed. */
  changedLines: number;
  /** The codes typed on the order, as they were looked up. */
  codes: LoadedCode[];
  /** What the call wrote on the order's own row: its reduction, and its formulas that read one. */
  wrote: Row;
  /** The decimals the order's reduction is kept at. */
  places: number;
  /** Where codes are typed on the order: the table, the column, and the row each typed value is on (null for one only tried). */
  typed?: { table: string; column: string; rows: { typed: string; key: string | null }[] };
  /** The rule that records what the order used, when this call was asked at its point: its `uses` are that rule's to write. */
  recorder?: string;
  /** A code's refusal held back for the save's price check (see `expects`): raised by the caller when the price is as expected without it. */
  heldBack?: Error;
  /** Money given back in this save: what the order is smaller by, what each payment may still be given, and what each refund row was decided to be. */
  refund?: RefundAnswer;
}

/** What a save that gives money back decided, for its door to say. */
export interface RefundAnswer {
  /** What was left to give back before this save's rows, and its tax. */
  refundable: string;
  taxRefundable?: string;
  /** The order's payments: what each took, what it had given back before, and the most it could be given now. */
  payments: { key: string; took: string; givenBack: string; max: string }[];
  rows: { key: string; amount: string; tax?: string }[];
}

/** A row of a write as its maker sent it: where it was in what was sent, and the row as written. */
export interface SentRow {
  node: { at: readonly (string | number)[]; target: { table: ResolvedTable } };
  record: Row;
}

/** What was kept of a stored order's reductions, read for a door to tell. */
export interface StoredFor {
  rows: Row[];
  columns: { line: string; offer: string; code: string; voucher: string; name: string; kind: string; amount: string; typed: string };
  codes: { typed: string; voucher: string }[];
  places: number;
  lineOf(line: string): string | null;
}

/** One order money is given back from, in a save that makes the refund rows. */
export interface AdjustRefund {
  for: AdjustFor;
  key: unknown;
  /** The order as held; it may be one whose price stands for good. */
  stood: Row | null;
  mode: 'save' | 'dry';
  context: WriteContext;
  clock: WriteClock;
  locale?: string | undefined;
  /** The rows the save has just written: its refund rows of this order are the ones decided. */
  made: readonly { table: string; row: Row }[];
}

/** What a question is put together from. */
interface AskInput {
  for: AdjustFor;
  /** The order as it stands. */
  order: Row;
  origin: 'staff' | 'public' | 'system';
  mode: AdjustInput['mode'];
  point: 'line' | 'post';
  /** The moment the question is judged at. */
  now: Date;
  locale: string;
  /** The rows the order's own open round holds. */
  held?: Record<string, ScalarRow[]> | undefined;
  /** Priced under what was recorded: only these offers, whatever became of them since. */
  only?: Set<string> | undefined;
  /** Codes tried in place of the ones typed on the order. */
  typed?: readonly string[] | undefined;
  /** A buyer supposed in place of the order's own customer: nobody is read. */
  buyer?: NonNullable<AdjustInput['customer']> | 'guest' | undefined;
  /** What staff took off, judged for whoever saves; absent: as the order keeps it, judged by nobody. */
  staff?: ((handed: AdjustInput['lines'], places: number) => Promise<AdjustInput['staff']>) | undefined;
  /** Every row the add-on reads, whatever its condition (the ended and the paused ones too). */
  everything?: boolean | undefined;
  /** How many of a line are kept, where some were given back: none at all is a line no longer kept. Absent: as stored. */
  keep?: ((line: LoadedLine) => Ratio | undefined) | undefined;
  explain?: boolean | undefined;
  /** An offer not saved yet, considered with the stored ones. */
  draft?: ScalarRow | undefined;
}

/** A question ready to be asked, with what was read for it. */
interface Asking {
  question: AdjustInput;
  /** The rows of every part of the order; those a part leaves out among them. */
  rows: LoadedLine[];
  codes: LoadedCode[];
  /** Typed values longer than any code is, cut to what may be said back: no code, and never handed to the add-on. */
  long: string[];
  /** The decimals the order's reduction is kept at. */
  places: number;
  currency: string | null;
  rules: TableRules | null;
  /** The rows read for this call, by key as text: an answer may name no other. */
  offerKeys: Map<string, unknown>;
  codeKeys: Map<string, unknown>;
  voucherKeys: Map<string, unknown>;
  /** The add-on asked, and its answer checked before anything is read from it. */
  ask(asked: AdjustInput): AdjustOutput;
}

/** A price tried on a stored order. */
export interface AdjustTry {
  /** The order's table, on the pool. */
  target: WriteTarget;
  /** The order, as stored: read once the caller is known to be allowed everything a try shows. */
  order(): Promise<Row>;
  /** Codes tried in place of the ones typed on the order; absent: the order's own. */
  typed?: readonly string[] | undefined;
  /** An offer not saved yet, by the columns of the add-on's offers table. */
  draft?: Row | undefined;
  explain?: boolean | undefined;
  buyer?: 'guest' | 'customer' | undefined;
  /** The moment the try is judged at; absent: now. */
  at?: Date | undefined;
  locale: string;
  /** Refuses a caller who may not read, or change, what a try shows: asked once, before anything of it is read. */
  may(needs: { read: string[]; update: string[] }): Promise<void>;
}

export interface AdjustTried {
  /** The order's own row as it would stand: its totals, formulas and balances worked out in memory. */
  order: Row;
  lines: { table: string; key: string; line: string; discount: string }[];
  applied: AdjustApplied[];
  told: NonNullable<AdjustOutput['told']>;
  /** The codes that do not stand, each with why: listed, never raised. */
  refused: { typed: string; reason: AdjustOutput['refused'][number]['reason']; params?: AdjustOutput['refused'][number]['params'] }[];
  explain?: (NonNullable<AdjustOutput['explain']>[number] & { name: string })[];
  codes: LoadedCode[];
  places: number;
  /** The add-on's table of offers, and the column an offer is named by. */
  offers: string;
  label?: string;
  /** Where codes are typed on the order. */
  typed?: { table: string; column: string };
}

/** One order a save priced: the answer, and which order it was. */
export interface AdjustedOrder extends AdjustResult {
  /** The order's table, and its key. */
  table: string;
  key: unknown;
}

/** An answer that never came, or was wrong: the save is refused, and the audit log keeps the word for why — never told to the person saving. */
export class AdjustFailed extends PostingRefusedError {
  constructor(
    readonly cause: string,
    readonly detail: string,
  ) {
    super('The add-on this depends on did not answer as it should, so nothing was saved.', { reason: 'planner-failed' });
  }
}

const unavailable = (): PostingRefusedError => new PostingRefusedError('The add-on this depends on cannot be asked right now, so this cannot be saved.', { reason: 'add-on-unavailable' });
const tooLarge = (): PostingRefusedError => new PostingRefusedError('This is more than can be priced in one save.', { reason: 'too-large' });

const ORIGINS: Readonly<Record<string, 'staff' | 'public' | 'system'>> = { public: 'public', automation: 'system', import: 'system', hook: 'system', action: 'system' };
/** Who a write is, as an add-on is told: a customer, the system, or staff. */
export const adjustOrigin = (context: Pick<WriteContext, 'origin'>): 'staff' | 'public' | 'system' => ORIGINS[context.origin] ?? 'staff';

/** The most refund rows of one order that are read: past so many the save is refused, never decided on a part of them. */
const REFUND_ROWS_MAX = 200;

/** The longest a typed code is handed on, as it was typed: what the add-on's answer may say back of one. */
const TYPED_MAX = 64;

/**
 * The language a name is kept in where the add-on's column holds one name and
 * not a name per language: one, whoever saves — a reply names a reduction in
 * its reader's language from the answer, never from the stored row.
 */
const STORED_LOCALE = 'en-US';

/** The reasons a code can come to be refused for between the price being shown and the save: what a price check answers in their place. */
const TURNS: ReadonlySet<string> = new Set(['used-up', 'over-limit', 'expired', 'inactive', 'void', 'not-yet']);

const empty = (value: unknown): boolean => value === null || value === undefined || value === '';
/** Whether a stored value is what a formula now works out: the same value, or the same number however it is written. */
const sameWorked = (stored: unknown, worked: unknown): boolean => {
  if (sameValue(stored ?? null, worked ?? null)) return true;
  const numeric = (value: unknown): boolean => !empty(value) && /^-?\d+(\.\d+)?$/.test(String(value));
  return numeric(stored) && numeric(worked) && Number(stored) === Number(worked);
};
/** Which row of an order's codes a typed code is on: what a refusal about it names. */
function codeAt(view: WriteTarget['view'], adjust: CompiledAdjust, code: LoadedCode): { table: string; key: string } | undefined {
  if (adjust.codes === undefined || code.row === null) return undefined;
  const table = view.table(adjust.codes.table);
  return { table: table.id, key: table.primaryKey.map((column) => String(code.row![column])).join('/') };
}
/** A row's values as each engine takes them: a moment for a column that keeps none of its zone is spelled the engine's way. */
const bound = (target: WriteTarget, row: Row): Row =>
  Object.fromEntries(Object.entries(row).map(([column, value]) => [column, target.table.columns.has(column) ? bindWriteValue(target.table.columns.get(column)!, value, target.dialect) : value]));
const pkOf = (table: ResolvedTable, row: Row): Row => Object.fromEntries(table.primaryKey.map((column) => [column, row[column]]));

/** A reduction staff gave by hand, as the order keeps it: handed in as stored and judged by nobody. */
function storedStaff(adjust: CompiledAdjust, order: Row, places: number): AdjustInput['staff'] {
  const staff = adjust.rule.order.staff;
  if (staff === undefined) return null;
  const kind = String(order[staff.kind] ?? '');
  const reason = empty(order[staff.reason]) ? null : String(order[staff.reason]);
  // A comp is the whole of the goods, whatever the value beside it says.
  if (kind === 'comp') return { kind: 'percent', value: '100', reason, ceiling: null, judge: false };
  if (kind !== 'percent' && kind !== 'amount') return null;
  const value = toRatio(order[staff.value]);
  if (value === null || value.n <= 0n) return null;
  return { kind, value: ratioText(value, kind === 'percent' ? 2 : places), reason, ceiling: null, judge: false };
}

/** A stored moment as an instant: a text with no zone is UTC, as every engine's column of moments is written. */
function instantOf(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' || value === '') return null;
  const text = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** How often the order's own open round used each offer: what a customer's count of uses leaves out for this order. */
function ownUses(adjuster: ResolvedAdjuster, held: Record<string, ScalarRow[]> | undefined): Record<string, number> {
  const uses = adjuster.declared.person?.uses;
  const out: Record<string, number> = {};
  if (uses === undefined || held === undefined) return out;
  for (const row of held[uses.table] ?? []) {
    if (empty(row[uses.offer]) || !uses.counted.some((state) => String(state) === String(row[uses.state]))) continue;
    out[String(row[uses.offer])] = (out[String(row[uses.offer])] ?? 0) + 1;
  }
  return out;
}

/**
 * A use the ledger refused under its lock — the last use of a code went to
 * another order a moment ago — is the code's own refusal: on the field it
 * was typed into, as "used up" (to a customer: not a valid code, and a guess
 * spent). Any other error is handed back as it is: an offer of the shop's
 * own that ran out in the same instant, or a refusal where the order used
 * two codes, stays the ledger's own.
 */
export function usesRefusal(error: unknown, adjusted: readonly AdjustedOrder[], origin: 'staff' | 'public' | 'system'): unknown {
  if (!(error instanceof PostingRefusedError)) return error;
  const details = (error.details ?? {}) as { posting?: unknown; reason?: unknown };
  const one = adjusted.find((order) => order.recorder !== undefined && order.recorder === details.posting);
  // Only a count that ran out, and only where the order used ONE code: with two, or none, nothing says whose count it was.
  if (one === undefined || one.typed === undefined || details.reason !== 'used-up') return error;
  const used = one.uses.filter((use) => use.code !== null || use.voucher !== null);
  if (used.length !== 1) return error;
  const code = one.codes.find((candidate) => candidate.id !== null && (used[0]!.code !== null ? candidate.kind === 'code' && candidate.id === used[0]!.code : candidate.kind === 'voucher' && candidate.id === used[0]!.voucher));
  if (code === undefined) return error;
  const key = one.typed.rows.find((row) => row.typed === code.typed)?.key ?? null;
  return refusalOf(origin, { typed: code.typed, reason: 'used-up' }, one.typed.column, key === null ? undefined : { table: one.typed.table, key });
}

export function createAdjuster(kit: AdjustKit) {
  /**
   * The order tables whose price this write may move — its own, when its rows
   * are orders; another's, when its rows are a line of one, a code typed on
   * one — each with the add-on that answers it. Null when nothing is asked:
   * no rule, a rule that reads as not there, or one the owner switched off.
   * A rule that should run and cannot be asked refuses the write here, before
   * anything is opened.
   */
  async function peek(input: { target: WriteTarget; rules: TableRules | null; action: WriteAction; values: Row | null; context: WriteContext }): Promise<AdjustPeek | null> {
    const { target, rules, action, values } = input;
    const tables = new Set<string>();
    const own = rules?.adjust;
    if (own !== undefined && action !== 'delete') {
      const frozen = own.rule.frozen;
      const stateColumn = frozen === undefined ? undefined : 'to' in frozen ? rules?.states?.column : frozen.column;
      // …and what its lines copy from it and keep in step (a stay's nights on its extras): a change of that moves their price.
      // …and what the rule that records its uses fires on: the save that crosses it asks which uses the order has.
      const recorder = own.uses === undefined ? undefined : (target.table.table?.postings ?? []).find((posting) => posting.id === own.uses);
      const points = recorder === undefined ? [] : [recorder.reserve, recorder.post].flatMap((point) => (point === undefined ? [] : 'column' in point.on ? [point.on.column] : 'to' in point.on ? [rules?.states?.column] : []));
      const written = [...own.inputs.uses, ...own.inputs.lines, ...(stateColumn === undefined ? [] : [stateColumn]), ...(rules?.followReads ?? []), ...points.filter((column): column is string => column !== undefined)];
      if (action === 'create' || touched(written, values).length > 0) tables.add(target.table.id);
    } else if (own === undefined && action !== 'delete' && target.table.table?.adjust !== undefined) {
      // A rule the table carries and that could not be read as one: asked about all the same, so it is refused and not passed by.
      tables.add(target.table.id);
    }
    for (const parent of rules?.adjustParents ?? []) {
      if (action !== 'update' || touched(parent.inputs, values).length > 0) tables.add(parent.order);
    }
    if (tables.size === 0) return null;
    const ledgers = kit.ledgers;
    await ledgers?.refresh?.();
    const orders: AdjustFor[] = [];
    for (const id of [...tables].sort()) {
      let table: ResolvedTable;
      try {
        table = id === target.table.id ? target.table : target.view.table(id);
      } catch {
        // An order table the model no longer has is asked nothing.
        continue;
      }
      const orderTarget: WriteTarget = id === target.table.id ? target : await kit.withRights({ ...target, table });
      // A server with no add-on runtime cannot tell a rule that is not there from a live one: the write is refused, never priced by nobody.
      if (ledgers?.adjuster === undefined) throw unavailable();
      const state = ledgers.adjuster(target.view, table);
      if (state.state === 'idle' || state.state === 'off') continue;
      if (state.state === 'unavailable') throw unavailable();
      // A rule that cannot be read as one (its table's rows have no one key) is never skipped: nobody would price the order.
      const adjust = kit.rulesOf(orderTarget)?.adjust;
      if (adjust === undefined) throw unavailable();
      const appliedTable = state.adjuster.table(state.adjuster.declared.applied.table);
      if (appliedTable === null) throw unavailable();
      const applied = await kit.withRights({ ...target, table: appliedTable });
      // Project code that changes a row before it is written cannot run inside this save.
      if ((await kit.hooked(applied, 'create', { ...input.context, origin: 'ledger' })) || (await kit.hooked(applied, 'update', { ...input.context, origin: 'ledger' }))) {
        throw new PostingRefusedError('Project code changes a table the add-on keeps, so nothing can be written to it inside a save.', { reason: 'hooked', table: appliedTable.name });
      }
      orders.push({ target: orderTarget, adjust, adjuster: state.adjuster, decider: state.decider, applied });
    }
    return orders.length === 0 ? null : { orders, addOns: [...new Set(orders.map((order) => order.adjuster.addOn))].sort() };
  }

  /**
   * The round the rule that records an order's uses keeps for it: the rows it
   * holds, and whether it has posted. Null when the rule records none, or the
   * ledger is not there to be read.
   */
  async function roundFor(db: Db, on: AdjustFor, order: Row): Promise<{ held: Record<string, ScalarRow[]> | undefined; closed: boolean; posting: string } | null> {
    const { adjust } = on;
    const table = on.target.table;
    const recorder = adjust.uses === undefined ? undefined : (table.table?.postings ?? []).find((posting) => posting.id === adjust.uses);
    if (recorder === undefined) return null;
    const recording = kit.ledgers!.resolve(on.target.view, table, recorder);
    if (!('ledger' in recording) || recording.ledger === undefined) return null;
    const source = { table: kit.ledgers!.refOf(on.target.connectionId, table.id), row: String(order[adjust.key]) };
    const round = roundOf(await receiptsOfSource(db, recording.ledger, source), recorder.id, '');
    const receipts = [round.reserved?.id, round.posted?.id].filter((id): id is string | number => id !== undefined);
    const held = receipts.length > 0 ? await roundRows(db, recording.ledger, receipts) : undefined;
    // (A record let through while the add-on could not be asked says nothing yet of what was used: it is not closed until it is worked out.)
    return { held, closed: round.posted !== null && round.posted.state !== 'unplanned', posting: recorder.id };
  }

  /**
   * What an order is priced under once its price is no longer open: the
   * offers it has — those applied to it now, and those its round recorded (one
   * that fell away with a line comes back with it) — as of the last time
   * anything was applied to it.
   */
  async function pinnedOf(db: Db, on: AdjustFor, order: Row, held: Record<string, ScalarRow[]> | undefined): Promise<{ only: Set<string>; at: Date | null }> {
    const { adjust, adjuster } = on;
    const stored = await storedApplied(db, on, { table: kit.ledgers!.refOf(on.target.connectionId, on.target.table.id), row: String(order[adjust.key]) });
    const columns = adjuster.declared.applied.columns;
    const only = new Set(stored.flatMap((row) => (empty(row[columns.offer]) ? [] : [String(row[columns.offer])])));
    const kept = adjuster.declared.person?.uses;
    if (kept !== undefined) for (const row of held?.[kept.table] ?? []) if (!empty(row[kept.offer])) only.add(String(row[kept.offer]));
    const times = stored.map((row) => instantOf(row[columns.at])).filter((at): at is Date => at !== null);
    return { only, at: times.length === 0 ? null : new Date(Math.max(...times.map((at) => at.getTime()))) };
  }

  /**
   * THE QUESTION, READ AND PUT TOGETHER — nothing is written here. The order's
   * lines, the codes on it (or the ones tried in their place), the rows the
   * add-on reads, who is buying, what staff took off: each a plain read on the
   * handle given, the pool or a save's transaction. What comes back is the
   * question, and the one way to ask it: the answer checked before anything is
   * read from it.
   */
  async function prepare(db: Db, input: AskInput): Promise<Asking> {
    const { adjust, adjuster, decider } = input.for;
    const target: WriteTarget = { ...input.for.target, db };
    const rules = kit.rulesOf(target);
    const view = target.view;
    const { order, origin, now, held } = input;
    const currency = await kit.currency(target);
    const scale = (rules?.scales ?? []).find((entry) => entry.column === adjust.rule.order.discount)?.scale ?? 2;
    const places = placesFor(scale, order, rules?.currencyColumn, currency);

    let rows: LoadedLine[];
    let codes: LoadedCode[];
    let settings: ScalarRow;
    let offers: Record<string, ScalarRow[]>;
    try {
      rows = await loadLines(db, view, adjust, order);
      // (Priced under what was recorded: its codes and offers are read whatever became of them since.)
      codes = input.typed !== undefined ? await findCodes(db, adjuster, input.typed) : await loadCodes(db, view, adjust, adjuster, order, { any: input.only !== undefined });
      settings = await ledgerSettings(adjuster, db);
      offers = await loadOffers(db, adjuster, {
        codes: codes.flatMap((code) => (code.kind === 'code' && code.id !== null ? [code.id] : [])),
        now: now.toISOString(),
        settings,
        ...(input.only === undefined ? {} : { only: input.only, everything: true }),
        ...(input.everything === true ? { everything: true } : {}),
      });
    } catch (error) {
      if (error instanceof AdjustTooLarge) throw tooLarge();
      throw error;
    }
    // A code typed longer than any code is: no code, said by Adminium — the add-on is never asked to say it back.
    const long = codes.filter((code) => code.typed.length > TYPED_MAX);
    if (long.length > 0 && adjust.codes !== undefined && input.mode !== 'try') throw refusalOf(origin, { typed: long[0]!.typed.slice(0, TYPED_MAX), reason: 'unknown' }, adjust.codes.typed, codeAt(view, adjust, long[0]!));
    // (A try fails for no code: such a one is left out, and listed.)
    if (long.length > 0) codes = codes.filter((code) => code.typed.length <= TYPED_MAX);
    // The add-on's tables were read on this handle: inside a save, a change of them now waits for it. Asked about once more, an update
    // that began in another process before those reads is seen here.
    const installed = await kit.ledgers!.versionNow(adjuster.addOn);
    if (installed === null || installed.status !== 'installed' || installed.version !== decider.version) throw writeConflict();

    const keyOf = kit.customerKey;
    const person =
      input.buyer !== undefined
        ? input.buyer === 'guest'
          ? null
          : input.buyer
        : keyOf === undefined
          ? null
          : await loadPerson(db, view, adjust, adjuster, order, { orderTable: target.table, keyOf: (address) => keyOf(target.connectionId, address), own: ownUses(adjuster, held) });

    const lines = rows.filter((row) => row.line);
    const zone = await kit.zone(target);
    const clock = venueClock(now, zone);
    const perNight = rules?.perNight;
    const refOf = (tableId: string): string => kit.ledgers!.refOf(target.connectionId, tableId);
    const handed: AdjustInput['lines'] = [];
    for (const [index, line] of lines.entries()) {
      const nights = line.part.nights !== undefined && perNight !== undefined && perNight.column === line.part.nights.rate ? (await priceNights(db, perNight, line.row, places)).nights : undefined;
      const keep = input.keep?.(line);
      handed.push(adjustLineOf({ view, line, index, places, refOf, nights, ...(keep === undefined ? {} : { quantity: keep, kept: keep.n > 0n }) }));
    }
    const staff = input.staff === undefined ? storedStaff(adjust, order, places) : await input.staff(handed, places);
    const mapped = adjust.rule.order.currency;
    const said = mapped === undefined ? null : typeof mapped === 'string' ? order[mapped] : 'value' in mapped ? mapped.value : 'setting' in mapped ? settings[mapped.setting] : null;
    const question: AdjustInput = {
      contract: 'price-adjust@1',
      mode: input.mode,
      point: input.point,
      origin,
      now: now.toISOString(),
      today: clock.day,
      weekday: new Date(`${clock.day}T00:00:00Z`).getUTCDay() as AdjustInput['weekday'],
      time: `${String(Math.floor(clock.minute / 60)).padStart(2, '0')}:${String(clock.minute % 60).padStart(2, '0')}`,
      zone,
      currency: empty(said) ? currency : String(said),
      scale: places,
      // (As a language is named in what an add-on keeps: `de-DE`.)
      locale: input.locale.replace('_', '-'),
      lines: handed,
      codes: codes.map((code) => adjustCodeOf(adjuster, code)),
      customer: person,
      guest: input.buyer === 'guest' || (person === null && origin === 'public'),
      staff,
      offers,
      settings,
      ...(held === undefined || Object.keys(held).length === 0 ? {} : { held }),
      ...(input.draft === undefined ? {} : { draft: input.draft }),
      explain: input.explain === true,
      version: adjuster.version,
    };

    // The rows read for this call: an answer may name no other.
    const first = adjuster.declared.offers[0];
    const offerKeys = new Map<string, unknown>();
    for (const read of adjuster.declared.offers) {
      if (first === undefined || read.table !== first.table) continue;
      const key = adjuster.table(read.table)?.primaryKey[0] ?? 'id';
      for (const row of offers[read.as] ?? []) offerKeys.set(String(row[key]), row[key]);
    }
    const rawKey = (code: LoadedCode): unknown => code.found?.[code.table?.primaryKey[0] ?? 'id'];
    const codeKeys = new Map(codes.flatMap((code) => (code.kind === 'code' && code.id !== null ? [[code.id, rawKey(code)] as const] : [])));
    const voucherKeys = new Map(codes.flatMap((code) => (code.kind === 'voucher' && code.id !== null ? [[code.id, rawKey(code)] as const] : [])));
    /** The add-on asked, and its answer checked before anything is read from it. */
    const ask = (asked: AdjustInput): AdjustOutput => {
      let said: AdjustOutput;
      try {
        said = callDecider('adjust', decider, asked, { shape: adjustOutputSchema }) as AdjustOutput;
      } catch (error) {
        if (error instanceof DeciderFailed) throw new AdjustFailed(error.cause, error.detail);
        throw error;
      }
      const issue = checkAdjust(asked, said, { offers: new Set(offerKeys.keys()), codes: new Set(codeKeys.keys()), vouchers: new Set(voucherKeys.keys()) });
      if (issue !== null) throw new AdjustFailed('check', issue.slice(0, 200));
      return said;
    };
    return { question, rows, codes, long: long.map((code) => code.typed.slice(0, TYPED_MAX)), places, currency, rules, offerKeys, codeKeys, voucherKeys, ask };
  }

  /**
   * One order priced again, on the save's transaction. Null when there is
   * nothing to price: the order is not there, or its price stands for good.
   */
  async function run(trx: Db, input: AdjustRun): Promise<AdjustResult | null> {
    const { adjust, adjuster } = input.for;
    const target: WriteTarget = { ...input.for.target, db: trx };
    const rules = kit.rulesOf(target);
    const view = target.view;
    const origin = adjustOrigin(input.context);

    // The price of an order that stands for good is never worked out again; a change of what it rests on is refused.
    const stands = input.stood !== null && frozenNow(adjust, input.stood, rules?.states?.column);
    if (stands) {
      if (input.touches) throw new AdjustRefusedError(adjustWords('frozen'), { reason: 'frozen' });
      // …but for one question: which uses it has, asked where the rule that records them fires after its price already stood (a
      // record caught up later). It is asked under what was applied to it, and its price does not move.
      if (input.point !== 'post') return null;
    }
    const read = input.order ?? (await loadOrder(trx, target.table, adjust, input.key));
    if (read === undefined) return null;
    let order: Row = read;

    // WHAT THE ORDER ALREADY USED. The rule that records it keeps a round for the order: what the round holds is the order's own, and
    // is not counted against it; once the round has POSTED, what the order used is closed — never recorded twice, never taken back
    // but by the rule's own way back.
    let held: Record<string, ScalarRow[]> | undefined;
    /** Priced under what was recorded: only the offers the order has, as of the moment they were applied. */
    let pinned: { only: Set<string>; at: Date | null } | null = null;
    /** The round has posted: what the order used is recorded, and is never recorded again. */
    let closed = false;
    const round = input.stood === null ? null : await roundFor(trx, input.for, order);
    if (round !== null) {
      held = round.held;
      closed = round.closed;
      if (closed && input.changes === 'uses') {
        throw new PostingRefusedError('What this order used is already recorded: its codes, what was taken off by hand and its customer stand as they are.', { reason: 'receipt-open', posting: round.posting });
      }
    }
    // An order whose price stands is not asked again, even for what it used: that is read off what was applied to it, and nothing moves.
    if (stands) return await recordedOf(trx, input, order);
    if (closed) pinned = await pinnedOf(trx, input.for, order, held);
    /** What this save decides of the order beside its reduction: whether its customer was proved, and who gave what was taken off by hand. */
    const stamps: Row = {};
    const actor = input.context.actor;
    /** A signed-in user saving now — never a rule's or an import's writer, whoever it runs as: the only writer who names a customer on their own word, or takes anything off by hand. */
    const giver = actor !== null && actor.kind === 'user' && actor.id !== null && input.context.origin !== 'automation' && input.context.origin !== 'import' ? actor : null;

    // WHO IS BUYING. The save that writes the customer's link says whether it was proved — by the door (a verified session of that very
    // customer) or by staff naming them; any other writer of the link (the address finder, an automation) leaves it unproved. A save that
    // does not write the link leaves the answer as it was stored: a later price is asked about the same customer.
    const customer = adjust.rule.order.customer;
    if (customer?.proved !== undefined) {
      const link = order[customer.link];
      const written = input.stood === null ? !empty(link) : !sameValue(link ?? null, input.stood[customer.link] ?? null);
      if (written) {
        const proof = input.context.adjust?.proved;
        const proved = !empty(link) && (giver !== null || (proof !== undefined && proof.table === target.table.id && proof.column === customer.link && !empty(proof.link) && String(proof.link) === String(link)));
        if (booleanOf(order[customer.proved]) !== proved) stamps[customer.proved] = proved;
        order = { ...order, [customer.proved]: proved };
      }
    }

    const now = pinned?.at ?? input.clock.locked(trx);
    const asking = await prepare(trx, {
      for: input.for,
      order,
      origin,
      mode: input.mode,
      // (What an order used is recorded once: priced again after that, it is asked about as a line is.)
      point: closed ? 'line' : (input.point ?? 'line'),
      now,
      locale: input.locale ?? input.context.adjust?.locale ?? 'en-US',
      held,
      only: pinned?.only,
      staff: async (handed, places) => {
        let staff = storedStaff(adjust, order, places);
        const byHand = adjust.rule.order.staff;
        if (byHand !== undefined) {
          const was = input.stood;
          const stoodStaff = was === null ? null : storedStaff(adjust, was, places);
          const changed = was === null ? staff !== null : moved([byHand.kind, byHand.value, byHand.reason], order, was).length > 0;
          const unsigned = staff !== null && empty(order[byHand.by]);
          /** The goods a reduction by hand is a share of, as the answer's check counts them. */
          const goods = handed.filter((line) => line.kept && !line.excluded).reduce<Ratio>((sum, line) => plus(sum, toRatio(line.amount) ?? ZERO), ZERO);
          const limitOf = async (who: WriteActor): Promise<Ceiling | null> => {
            const roles = (await kit.rolesOf?.(who)) ?? new Set<string>();
            // (No limit binds a Super Admin: nothing is read, nothing judged.)
            return roles === 'any' ? null : ceilingOf(trx, adjuster, [...roles], places);
          };
          if (changed || unsigned) {
            const notAllowed = (): Error => refusalOf(origin, { typed: '', reason: 'not-allowed' }, byHand.value);
            if (giver === null) throw notAllowed();
            const limit = await limitOf(giver);
            // Another user's reduction — or one nobody is on record as giving — is changed or taken away only by somebody who could have given it.
            const theirs = stoodStaff !== null && String(was![byHand.by] ?? '') !== giver.id;
            if (limit !== null && theirs && beyond(limit, String(was![byHand.kind]) === 'comp' ? 'comp' : stoodStaff.kind, stoodStaff.value, goods, places) !== null) throw notAllowed();
            if (staff !== null && limit !== null) {
              // A comp has a leave of its own: a limit of a hundred percent is not one.
              const max = beyond(limit, String(order[byHand.kind]) === 'comp' ? 'comp' : staff.kind, staff.value, goods, places);
              if (max !== null) throw refusalOf(origin, { typed: '', reason: 'over-ceiling', params: { max } }, byHand.value);
              if (String(order[byHand.kind]) !== 'comp') staff = { ...staff, ceiling: { percent: limit.percent, amount: limit.amount }, judge: true };
            }
            const by = staff === null ? null : giver.id;
            if (!sameValue(order[byHand.by] ?? null, by)) stamps[byHand.by] = by;
          } else if (staff !== null && giver !== null && String(order[byHand.by]) === giver.id && String(order[byHand.kind]) !== 'comp') {
            const limit = await limitOf(giver);
            if (limit !== null) staff = { ...staff, ceiling: { percent: limit.percent, amount: limit.amount }, judge: true };
          }
        }
        return staff;
      },
    });
    const { question, rows, codes, places, currency, offerKeys, codeKeys, voucherKeys, ask } = asking;
    const refOf = (tableId: string): string => kit.ledgers!.refOf(target.connectionId, tableId);
    const rawKey = (code: LoadedCode): unknown => code.found?.[code.table?.primaryKey[0] ?? 'id'];
    /** The refusal of the first thing an answer refused: what staff gave on its own column; a code on the column it was typed into, with the row it is on. */
    const refusalIn = (said: AdjustOutput): Error | null => {
      const refused = said.refused[0] as RefusedCode | undefined;
      if (refused === undefined) return null;
      const typedIn = codes.find((code) => code.typed === refused.typed);
      const at = typedIn === undefined ? undefined : codeAt(view, adjust, typedIn);
      if (refused.reason === 'over-ceiling' || adjust.codes === undefined || at === undefined) return refusalOf(origin, refused, adjust.rule.order.staff?.value ?? adjust.rule.order.discount);
      return refusalOf(origin, refused, adjust.codes.typed, at);
    };
    let answer = ask(question);
    // A code, or a reduction staff gave, that does not stand refuses the write.
    let refusal = refusalIn(answer);
    /**
     * In a save that checks the price it was shown, a code that stood when the
     * price was shown and does not now (its uses ran out, it ended) is not
     * refused yet: the order is priced without it, and the price check says the
     * price changed. Only when the price is the same without it — the code was
     * worth nothing — is the refusal raised after all, by the caller.
     */
    let heldBack: Error | undefined;
    /**
     * Which refusals a price check answers. At the desk: the ones that can
     * turn. For a customer: every refusal they would hear as "not a valid
     * code" — a code that never was is answered exactly as one that ran out,
     * so a price check sent on purpose tells the two apart no better than the
     * refusal itself does.
     */
    const answeredByCheck = (reason: string): boolean => (origin === 'public' ? publicReason(reason) === 'unknown' : TURNS.has(reason));
    let asked = question;
    // Each such code in its turn: a second one beside it is held back as the first was.
    for (let held = 0; refusal !== null && input.expects === true && input.mode === 'save' && held < question.codes.length; held += 1) {
      const turned = answer.refused[0];
      if (turned === undefined || turned.typed === '' || !answeredByCheck(turned.reason)) break;
      heldBack ??= refusal;
      asked = { ...asked, codes: asked.codes.filter((code) => code.typed !== turned.typed) };
      answer = ask(asked);
      refusal = refusalIn(answer);
    }
    if (refusal !== null) throw refusal;

    // Each row's reduction, where it differs from what is stored — with the row's formulas that read it. A row that is no line any more gives its reduction back.
    const reduced = new Map(answer.lines.map((line) => [line.key, line.discount]));
    const zero = ratioText({ n: 0n, d: 1n }, places);
    const differs = (stored: unknown, wanted: string): boolean => (empty(stored) ? !sameDecimal(wanted, zero, places) : !sameDecimal(stored, wanted, places));
    let changedLines = 0;
    const outLines: AdjustResult['lines'] = [];
    const orderSet: Row = { ...stamps };
    for (const row of rows) {
      const wanted = row.line ? (reduced.get(row.key) ?? zero) : zero;
      if (row.line) outLines.push({ table: row.table.id, key: row.table.primaryKey.map((column) => String(row.row[column])).join('/'), line: row.key, discount: wanted });
      const moved = differs(row.row[row.part.discount], wanted);
      // The order is its own line: its reduction is written with the order's, below.
      if (row.part.self) {
        if (!moved) continue;
        changedLines += 1;
        orderSet[row.part.discount] = wanted;
        continue;
      }
      const lineTarget: WriteTarget = { ...target, table: row.table };
      const lineRules = kit.rulesOf(lineTarget);
      const formulas = evaluateAll(touchedFormulas(lineRules?.formulas ?? [], [row.part.discount]), { ...row.row, [row.part.discount]: wanted }, lineRules?.currencyColumn, currency);
      // A row made with no reduction on it never had its net worked out from one: a formula that reads the reduction is brought in step even where the reduction stands.
      const stale = Object.entries(formulas).some(([column, value]) => !sameWorked(row.row[column], value));
      if (!moved && !stale) continue;
      changedLines += 1;
      await kit.update(lineTarget, { ...(moved ? { [row.part.discount]: wanted } : {}), ...formulas }, pkOf(row.table, row.row));
    }

    // The order's own reduction, with its formulas that read one; and the links each typed code found.
    if (differs(order[adjust.rule.order.discount], answer.order.discount)) orderSet[adjust.rule.order.discount] = answer.order.discount;
    let wrote: Row = {};
    if (Object.keys(orderSet).length > 0) {
      const worked = touchedFormulas(rules?.formulas ?? [], Object.keys(orderSet));
      wrote = { ...orderSet, ...evaluateAll(worked, { ...order, ...orderSet }, rules?.currencyColumn, currency) };
      await kit.update(target, wrote, pkOf(target.table, order));
    } else if (input.stood === null) {
      // An order the save itself makes, with nothing off: its formulas that read a reduction were worked out before the row had one
      // (a column's default is the database's to fill), so they are brought in step here — as a line's are, above. An order with lines
      // has its totals settled after this; one that is its own line (a stay) has nothing else that would.
      const reads = [adjust.rule.order.discount, ...adjust.parts.filter((part) => part.self).map((part) => part.discount)];
      const worked = evaluateAll(touchedFormulas(rules?.formulas ?? [], reads), order, rules?.currencyColumn, currency);
      const stale = Object.fromEntries(Object.entries(worked).filter(([column, value]) => !sameWorked(order[column], value)));
      if (Object.keys(stale).length > 0) {
        wrote = stale;
        await kit.update(target, wrote, pkOf(target.table, order));
      }
    }
    if (adjust.codes !== undefined) {
      const codesTarget: WriteTarget = { ...target, table: view.table(adjust.codes.table) };
      for (const code of codes) {
        if (code.row === null) continue;
        const wanted = { [adjust.codes.code]: code.kind === 'code' ? rawKey(code) : null, [adjust.codes.voucher]: code.kind === 'voucher' ? rawKey(code) : null };
        if (Object.entries(wanted).every(([column, value]) => sameValue(code.row![column] ?? null, value ?? null))) continue;
        await kit.update(codesTarget, wanted, pkOf(codesTarget.table, code.row));
      }
    }

    // What was applied, kept as rows of the add-on's own: only for a save, and only what changed.
    if (input.mode === 'save') {
      const key = (id: string | null, known: ReadonlyMap<string, unknown>): unknown => (id === null ? null : (known.get(id) ?? id));
      try {
        await writeApplied(trx, input, answer.applied, { table: refOf(target.table.id), row: String(order[adjust.key]) }, { now, locale: STORED_LOCALE, places }, {
          offer: (id) => key(id, offerKeys),
          code: (id) => key(id, codeKeys),
          voucher: (id) => key(id, voucherKeys),
        });
      } catch (error) {
        // The add-on's own table would not take what was applied (a column too short, a value it cannot hold): its fault, not the saver's.
        if (isUniqueViolation(error) || readDbRefusal(error, input.for.applied.table) !== null) throw new AdjustFailed('applied', error instanceof Error ? error.message.slice(0, 200) : 'the rows of what was applied could not be written');
        throw error;
      }
    }
    const typed =
      adjust.codes === undefined
        ? undefined
        : { table: view.table(adjust.codes.table).id, column: adjust.codes.typed, rows: codes.map((code) => ({ typed: code.typed, key: codeAt(view, adjust, code)?.key ?? null })) };
    return { applied: answer.applied, told: answer.told ?? [], uses: answer.uses, discount: answer.order.discount, lines: outLines, changedLines, codes, wrote, places, ...(typed === undefined ? {} : { typed }), ...(heldBack === undefined ? {} : { heldBack }), ...(question.point === 'post' && adjust.uses !== undefined ? { recorder: adjust.uses } : {}) };
  }

  /**
   * A PRICE TRIED, NOT SAVED. A stored order asked about as it stands — with
   * other codes in place of its own, a buyer supposed, an offer not saved yet
   * beside the stored ones — and its figures worked out in memory from the
   * answer. Plain reads on the pool and nothing else: no transaction, no
   * lock, no row written, no use recorded. A code that does not stand is
   * listed, never raised; an order whose price stands for good is tried like
   * any other.
   */
  async function tried(input: AdjustTry): Promise<AdjustTried> {
    const target = input.target;
    const db = target.db;
    const view = target.view;
    const rules = kit.rulesOf(target);
    const adjust = rules?.adjust;
    const noRule = (): Error => new ValidationFailedError('Nothing lowers the price of this table\'s rows, so there is nothing to try.', { reason: 'no-adjust' });
    if (target.table.table?.adjust === undefined) throw noRule();
    if (kit.ledgers?.adjuster === undefined) throw unavailable();
    await kit.ledgers.refresh?.();
    const state = kit.ledgers.adjuster(view, target.table);
    if (state.state === 'idle' || state.state === 'off') throw noRule();
    if (state.state === 'unavailable' || adjust === undefined) throw unavailable();
    const { adjuster, decider } = state;
    const appliedTable = adjuster.table(adjuster.declared.applied.table);
    const first = adjuster.declared.offers[0];
    const offersTable = first === undefined ? null : adjuster.table(first.table);
    if (appliedTable === null || offersTable === null) throw unavailable();
    const codesTable = adjust.codes === undefined ? null : view.table(adjust.codes.table);
    // Who may try: somebody who reads the order's lines and the codes typed on it, and may change the offers themselves.
    // …and, where they try codes of their own choosing, reads the add-on's codes and vouchers: a try says why a code does not stand.
    const looked = input.typed === undefined ? [] : [adjuster.table(adjuster.declared.codes.table), adjuster.table(adjuster.declared.vouchers.table)].flatMap((table) => (table === null ? [] : [table.id]));
    await input.may({ read: [...new Set([...adjust.parts.map((part) => view.table(part.table).id), ...(codesTable === null ? [] : [codesTable.id]), offersTable.id, ...looked])], update: [offersTable.id] });
    const types = adjuster.typesOf(offersTable.id);
    let draft: ScalarRow | undefined;
    if (input.draft !== undefined) {
      const unknown = Object.keys(input.draft).find((column) => !offersTable.columns.has(column));
      if (unknown !== undefined) throw new ValidationFailedError('An offer being tried holds only what an offer holds.', { fields: { [`draft.${unknown}`]: { code: 'unknown' } } });
      draft = rowOut(offersTable, input.draft, types);
    }
    const on: AdjustFor = { target, adjust, adjuster, decider, applied: { ...target, table: appliedTable } };
    const order = await input.order();
    const round = await roundFor(db, on, order);
    const asking = await prepare(db, {
      for: on,
      order,
      origin: 'staff',
      mode: 'try',
      point: 'line',
      now: input.at ?? new Date(),
      locale: input.locale,
      held: round?.held,
      typed: input.typed,
      // Nobody real is read: a guest, or a customer who is in no group and has ordered and used nothing.
      buyer: input.buyer === 'customer' ? { key: 'try', groups: [], orders: 0, uses: {} } : 'guest',
      everything: input.explain === true,
      explain: input.explain === true,
      draft,
    });
    const { question, rows, codes, places, currency, ask } = asking;
    // Each code that does not stand is listed and the order asked about without it: what is shown is the price the others give.
    const refused: AdjustTried['refused'] = asking.long.map((typed) => ({ typed, reason: 'unknown' as const }));
    let asked = question;
    let answer = ask(asked);
    for (let turn = 0; turn < question.codes.length; turn += 1) {
      const gone = new Set(answer.refused.filter((entry) => entry.typed !== '').map((entry) => entry.typed));
      if (gone.size === 0) break;
      for (const entry of answer.refused) if (entry.typed !== '') refused.push({ typed: entry.typed, reason: entry.reason, ...(entry.params === undefined ? {} : { params: entry.params }) });
      asked = { ...asked, codes: asked.codes.filter((code) => !gone.has(code.typed)) };
      answer = ask(asked);
    }
    // The figures, worked out as a save's settle would work them out, from copies.
    const reduced = new Map(answer.lines.map((line) => [line.key, line.discount]));
    const zero = ratioText(ZERO, places);
    const lines: AdjustTried['lines'] = [];
    // (A row two parts of the rule read — one table, told apart by a column — is one row: a line of one part, left out by the other.)
    const figured = new Map<string, FiguredRow>();
    const overlay: Row = { [adjust.rule.order.discount]: answer.order.discount };
    for (const row of rows) {
      const wanted = row.line ? (reduced.get(row.key) ?? zero) : zero;
      const key = row.table.primaryKey.map((column) => String(row.row[column])).join('/');
      if (row.line) lines.push({ table: row.table.id, key, line: row.key, discount: wanted });
      if (row.part.self) {
        overlay[row.part.discount] = wanted;
        continue;
      }
      const id = `${row.table.id}\u0000${String(row.part.via)}\u0000${key}`;
      const known = figured.get(id);
      if (known === undefined) figured.set(id, { table: row.table.id, via: row.part.via, rules: kit.rulesOf({ ...target, table: row.table }), row: row.row, overlay: { [row.part.discount]: wanted } });
      else if (row.line) known.overlay = { ...known.overlay, [row.part.discount]: wanted };
    }
    const figures = orderFigures({ order, orderRules: rules, rows: [...figured.values()], overlay, currency });
    const label = labelColumnFor(view, offersTable);
    const key = offersTable.primaryKey[0] ?? 'id';
    const named = new Map<string, unknown>();
    for (const read of adjuster.declared.offers) {
      if (first === undefined || read.table !== first.table || label === null) continue;
      for (const row of question.offers[read.as] ?? []) named.set(String(row[key]), row[label]);
    }
    if (draft !== undefined && label !== null && !empty(draft[label])) {
      named.set('draft', draft[label]);
      if (!empty(draft[key])) named.set(String(draft[key]), draft[label]);
    }
    return {
      order: figures.order,
      lines,
      applied: answer.applied,
      told: answer.told ?? [],
      refused,
      ...(answer.explain === undefined ? {} : { explain: answer.explain.map((entry) => ({ ...entry, name: empty(named.get(entry.offer)) ? '' : String(named.get(entry.offer)) })) }),
      codes,
      places,
      offers: offersTable.id,
      ...(label === null ? {} : { label }),
      ...(adjust.codes === undefined || codesTable === null ? {} : { typed: { table: codesTable.id, column: adjust.codes.typed } }),
    };
  }

  /**
   * MONEY GIVEN BACK. The refund rows of an order whose amount nobody decided
   * yet — the ones this save made — are decided here, after they are written
   * and before the save's totals: the order is priced again with what was
   * returned taken out (every refund's returned lines, this save's included),
   * under the offers it had and as of when they were applied; what it is
   * smaller by, less what earlier refunds gave back, is shared over the rows
   * (`refund.ts`). Nothing of the order is written, and an order whose price
   * stands is read like any other. Null when there is nothing to decide.
   */
  async function refund(trx: Db, input: AdjustRefund): Promise<AdjustResult | null> {
    const { adjust } = input.for;
    const rule = adjust.refunds;
    if (rule === undefined) return null;
    const target: WriteTarget = { ...input.for.target, db: trx };
    const view = target.view;
    const rules = kit.rulesOf(target);
    const origin = adjustOrigin(input.context);
    const order = input.stood ?? (await loadOrder(trx, target.table, adjust, input.key));
    if (order === undefined || order === null) return null;
    const table = view.table(rule.table);
    const pk = table.primaryKey[0] ?? 'id';
    const all = (await trx.selectFrom(table.id as never).selectAll().where(sql.ref(rule.via), '=', order[adjust.key] as never).orderBy(sql.ref(pk)).limit(REFUND_ROWS_MAX + 1).execute()) as Row[];
    if (all.length > REFUND_ROWS_MAX) throw tooLarge();
    // Only the rows this save made are decided. A refund already there is never decided again, moved to another order or payment, or
    // taken away: what was given back stands, and a mistake is set right by the host's own way (a refund of the refund, a void).
    const mine = new Set(input.made.filter((one) => one.table === table.id && String(one.row[rule.via] ?? '') === String(order[adjust.key])).map((one) => String(one.row[pk])));
    if (mine.size === 0) throw new AdjustRefusedError('Money given back stands as it was decided: it is not moved, changed or taken away.', { reason: 'not-allowed', column: rule.via });
    const fresh = all.filter((row) => mine.has(String(row[pk])));
    // A refund made while nobody could decide it (the rule was off, the add-on away) holds no amount: what it really gave back is
    // unknown here, so nothing more is given back from the order until it is set right — never a second refund on top of it.
    if (all.some((row) => !mine.has(String(row[pk])) && empty(row[rule.amount]))) throw new AdjustRefusedError('An earlier refund of this order holds no amount. Set it right before giving more back.', { reason: 'not-allowed', column: rule.amount });
    if (fresh.length === 0) return null;

    // What was returned, line by line: by every refund of the order, this save's included.
    const back = new Map<string, Ratio>();
    const returning = new Set<string>();
    let lineTable: string | null = null;
    if (rule.lines !== undefined) {
      const returns = view.table(rule.lines.table);
      lineTable = view.model.relations.find((r) => r.through === null && r.from.tableId === returns.id && r.from.columns.length === 1 && r.from.columns[0] === rule.lines!.line)?.to.tableId ?? null;
      // A rule whose returned lines point at nothing that can be read as a line cannot be worked out.
      if (lineTable === null) throw unavailable();
      const rows = (await trx
        .selectFrom(returns.id as never)
        .selectAll()
        .where(sql.ref(rule.lines.via), 'in', all.map((row) => row[pk]) as never)
        .limit(REFUND_ROWS_MAX * ADJUST_LINES_MAX + 1)
        .execute()) as Row[];
      if (rows.length > REFUND_ROWS_MAX * ADJUST_LINES_MAX) throw tooLarge();
      for (const row of rows) {
        const quantity = toRatio(row[rule.lines.quantity]) ?? ZERO;
        if (quantity.n * quantity.d <= 0n || empty(row[rule.lines.line])) continue;
        back.set(String(row[rule.lines.line]), plus(back.get(String(row[rule.lines.line])) ?? ZERO, quantity));
        returning.add(String(row[rule.lines.via]));
      }
    }
    const round = await roundFor(trx, input.for, order);
    const pinned = await pinnedOf(trx, input.for, order, round?.held);
    /** How many of each line are kept, by the line's key as the add-on is handed it. */
    const keeps = new Map<string, Ratio>();
    /** The returned lines that were found among the order's own. */
    const taken = new Set<string>();
    const asking = await prepare(trx, {
      for: input.for,
      order,
      origin,
      mode: 'refund',
      point: 'line',
      now: pinned.at ?? input.clock.locked(trx),
      locale: input.locale ?? input.context.adjust?.locale ?? 'en-US',
      held: round?.held,
      only: pinned.only,
      keep: (line) => {
        if (line.part.self || lineTable === null || line.table.id !== lineTable) return undefined;
        const at = line.table.primaryKey.map((column) => String(line.row[column])).join('/');
        const gone = back.get(at);
        if (gone === undefined) return undefined;
        taken.add(at);
        const had = line.part.quantity === undefined ? { n: 1n, d: 1n } : (toRatio(line.row[line.part.quantity]) ?? ZERO);
        // More of a line given back than there is of it.
        if (more(gone, had)) throw new AdjustRefusedError(adjustWords('refund-over'), { reason: 'refund-over', max: ratioText(had, 0) });
        const kept: Ratio = { n: had.n * gone.d - gone.n * had.d, d: had.d * gone.d };
        keeps.set(line.key, kept);
        return kept;
      },
    });
    const { question, rows, places, currency, ask } = asking;
    // A thing given back that is no line of this order — another order's, a voided one — gives nothing back: refused, never a refund of nothing.
    if ([...back.keys()].some((line) => !taken.has(line))) throw new AdjustRefusedError(adjustWords('refund-over'), { reason: 'refund-over', max: '0' });
    // (Priced under what it had: a code that would not stand today is not asked about again.)
    let asked = question;
    let answer = ask(asked);
    for (let turn = 0; turn < question.codes.length && answer.refused.some((entry) => entry.typed !== ''); turn += 1) {
      const gone = new Set(answer.refused.map((entry) => entry.typed));
      asked = { ...asked, codes: asked.codes.filter((code) => !gone.has(code.typed)) };
      answer = ask(asked);
    }
    // The order as it would be with the returned things gone.
    const reduced = new Map(answer.lines.map((line) => [line.key, line.discount]));
    const zero = ratioText(ZERO, places);
    const figured = new Map<string, FiguredRow>();
    const overlay: Row = { [adjust.rule.order.discount]: answer.order.discount };
    for (const row of rows) {
      const wanted = row.line ? (reduced.get(row.key) ?? zero) : zero;
      if (row.part.self) {
        overlay[row.part.discount] = wanted;
        continue;
      }
      const kept = row.line ? keeps.get(row.key) : undefined;
      // A line with a quantity keeps fewer; one that has none (it is one thing) is worth nothing once it is gone.
      const fewer: Row = kept === undefined ? {} : row.part.quantity !== undefined ? { [row.part.quantity]: ratioText(kept, kept.d === 1n || kept.n % kept.d === 0n ? 0 : 4) } : kept.n > 0n ? {} : { [row.part.price]: zero };
      const id = `${row.table.id}\u0000${String(row.part.via)}\u0000${row.table.primaryKey.map((column) => String(row.row[column])).join('/')}`;
      const known = figured.get(id);
      if (known === undefined) figured.set(id, { table: row.table.id, via: row.part.via, rules: kit.rulesOf({ ...target, table: row.table }), row: row.row, overlay: { [row.part.discount]: wanted, ...fewer } });
      else if (row.line) known.overlay = { ...known.overlay, [row.part.discount]: wanted, ...fewer };
    }
    const kept = orderFigures({ order, orderRules: rules, rows: [...figured.values()], overlay, currency }).order;

    // What earlier refunds gave back — in all, of tax, and to each payment.
    const decided = all.filter((row) => !mine.has(String(row[pk])));
    const sum = (rows: readonly Row[], column: string | undefined): Ratio => (column === undefined ? ZERO : rows.reduce<Ratio>((total, row) => plus(total, toRatio(row[column]) ?? ZERO), ZERO));
    const smaller = (column: string | undefined, gave: Ratio): Ratio => {
      if (column === undefined) return ZERO;
      const cost = toRatio(order[column]) ?? ZERO;
      const now = toRatio(kept[column]) ?? ZERO;
      return { n: (cost.n * now.d - now.n * cost.d) * gave.d - gave.n * cost.d * now.d, d: cost.d * now.d * gave.d };
    };
    const refundable = smaller(rule.of, sum(decided, rule.amount));
    const taxRefundable = rule.tax === undefined ? ZERO : smaller(rule.taxOf, sum(decided, rule.tax));
    const payments = new Map<string, { took: Ratio; givenBack: Ratio }>();
    /** Whether what the order's payments took can be read at all (the order adds them up). */
    let known = false;
    if (rule.against !== undefined) {
      const paid = view.model.relations.find((r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === rule.against && r.to.columns.length === 1);
      // What a payment took is the column the order adds its payments up by.
      // …the total a balance of the order is taken from (what is paid), before any other total over the same rows (tips).
      const totals = paid === undefined ? [] : (rules?.ownRollups ?? []).filter((rollup) => rollup.child === paid.to.tableId && rollup.count !== true && rollup.times === undefined);
      const total = totals.find((rollup) => (rules?.balances ?? []).some((balance) => balance.total === rollup.column)) ?? totals[0];
      if (paid !== undefined && total !== undefined) {
        known = true;
        const took = (await trx.selectFrom(paid.to.tableId as never).selectAll().where(sql.ref(total.via), '=', order[adjust.key] as never).orderBy(sql.ref(paid.to.columns[0]!)).limit(REFUND_ROWS_MAX + 1).execute()) as Row[];
        if (took.length > REFUND_ROWS_MAX) throw tooLarge();
        for (const one of took) {
          // Only a payment the order counts as paid (not a voided one, not one of another kind) can be given back to.
          if ((total.unlessSet !== undefined && !empty(one[total.unlessSet])) || (total.where !== undefined && !sameValue(one[total.where.column], total.where.eq))) continue;
          const key = String(one[paid.to.columns[0]!]);
          payments.set(key, { took: toRatio(one[total.sum]) ?? ZERO, givenBack: sum(decided.filter((row) => String(row[rule.against!] ?? '') === key), rule.amount) });
        }
      }
    }
    // A refund names a payment of THIS order that counts as paid, or none: another order's payment, or a voided one, is given nothing.
    if (known) {
      for (const row of fresh) {
        if (rule.against !== undefined && !empty(row[rule.against]) && !payments.has(String(row[rule.against]))) throw new AdjustRefusedError(adjustWords('refund-over'), { reason: 'refund-over', column: rule.against, max: '0' });
      }
    }
    // No more is given back than was paid in: what the payments took, less what refunds already gave back.
    const paidIn = [...payments.values()].reduce<Ratio>((total, one) => plus(total, one.took), ZERO);
    const gaveBack = sum(decided, rule.amount);
    const room: Ratio = { n: paidIn.n * gaveBack.d - gaveBack.n * paidIn.d, d: paidIn.d * gaveBack.d };
    const capped = known && more(refundable, room) ? (room.n * room.d < 0n ? ZERO : room) : refundable;
    const shares = refundShares({
      refundable: capped,
      taxRefundable,
      rows: fresh.map((row) => ({ key: String(row[pk]), against: rule.against === undefined || empty(row[rule.against]) ? null : String(row[rule.against]), returns: returning.has(String(row[pk])) })),
      payments,
      places,
    });
    if (shares.over !== undefined) throw new AdjustRefusedError(adjustWords('refund-over'), { reason: 'refund-over', max: shares.over.max });

    // Each row's amount and tax, with the row's own formulas that read them.
    const refundTarget: WriteTarget = { ...target, table };
    const refundRules = kit.rulesOf(refundTarget);
    for (const share of shares.rows) {
      const row = fresh.find((one) => String(one[pk]) === share.key)!;
      const set: Row = { [rule.amount]: share.amount, ...(rule.tax === undefined ? {} : { [rule.tax]: share.tax }) };
      await kit.update(refundTarget, { ...set, ...evaluateAll(touchedFormulas(refundRules?.formulas ?? [], Object.keys(set)), { ...row, ...set }, refundRules?.currencyColumn, currency) }, { [pk]: row[pk] });
    }
    const text = (value: Ratio): string => ratioText(value.n * value.d < 0n ? ZERO : value, places);
    return {
      applied: [],
      told: [],
      uses: [],
      discount: ratioText(toRatio(order[adjust.rule.order.discount]) ?? ZERO, places),
      lines: [],
      changedLines: 0,
      codes: [],
      wrote: {},
      places,
      refund: {
        refundable: text(refundable),
        ...(rule.tax === undefined ? {} : { taxRefundable: text(taxRefundable) }),
        payments: [...payments].map(([key, one]) => ({ key, took: text(one.took), givenBack: text(one.givenBack), max: text({ n: one.took.n * one.givenBack.d - one.givenBack.n * one.took.d, d: one.took.d * one.givenBack.d }) })),
        rows: shares.rows.map((share) => ({ key: share.key, amount: share.amount, ...(rule.tax === undefined ? {} : { tax: share.tax }) })),
      },
    };
  }

  /**
   * What was kept of the reductions a stored order took — its rows, the codes
   * typed on it that found a voucher, the decimals, and where each line was in
   * what its maker sent — for a door to tell (`stored.ts`). Null where the
   * table's price rule is not live (nothing is told of a rule that is not
   * there). Plain reads on the handle given.
   */
  async function reductions(target: WriteTarget, key: unknown, opts: { tree?: readonly SentRow[] | undefined }): Promise<StoredFor | null> {
    const on = await live(target);
    if (on === null) return null;
    const { adjust, adjuster } = on;
    const db = target.db;
    const declared = adjuster.declared.applied;
    // The order as stored: its key as the save wrote it (never as a caller spelled it), and its own currency for the decimals.
    const order = await loadOrder(db, target.table, adjust, key);
    const none: StoredFor = { rows: [], columns: { line: declared.source.line, ...declared.columns }, codes: [], places: 2, lineOf: () => null };
    if (order === undefined) return none;
    const rows = await storedApplied(db, on, { table: kit.ledgers!.refOf(target.connectionId, target.table.id), row: String(order[adjust.key]) });
    if (rows.length === 0) return none;
    // The last four of a voucher are those of what was typed on the order for it.
    const codes: { typed: string; voucher: string }[] = [];
    if (adjust.codes !== undefined && rows.some((row) => !empty(row[declared.columns.voucher]))) {
      // (The codes on it now, oldest first: one taken off again tells nothing.)
      const codesTable = target.view.table(adjust.codes.table);
      let query = db.selectFrom(codesTable.id as never).selectAll().where(sql.ref(adjust.codes.via), '=', order[adjust.key] as never);
      for (const column of codesTable.primaryKey) query = query.orderBy(sql.ref(column));
      for (const one of (await query.limit(CODE_ROWS_MAX).execute()) as Row[]) {
        const removed = adjust.codes.removed === undefined ? null : one[adjust.codes.removed];
        if (empty(one[adjust.codes.typed]) || empty(one[adjust.codes.voucher]) || !(empty(removed) || booleanOf(removed) === false)) continue;
        codes.push({ typed: String(one[adjust.codes.typed]), voucher: String(one[adjust.codes.voucher]) });
      }
    }
    const rules = kit.rulesOf(target);
    const scale = (rules?.scales ?? []).find((entry) => entry.column === adjust.rule.order.discount)?.scale ?? 2;
    const places = placesFor(scale, order, rules?.currencyColumn, await kit.currency(target));
    // A line's place in what the caller sent, where the rows of that write are in hand (a create answered again).
    const sent = new Map<string, string>();
    for (const row of opts.tree ?? []) {
      const table = row.node.target.table;
      if (row.node.at.length > 0) sent.set(`${table.id}\u0000${table.primaryKey.map((column) => String(row.record[column])).join('/')}`, row.node.at.join('/'));
    }
    const lineOf = (line: string): string | null => {
      const cut = line.indexOf(':');
      const part = cut <= 1 ? undefined : adjust.parts[Number(line.slice(1, cut))];
      if (part === undefined || part.self) return null;
      return sent.get(`${target.view.table(part.table).id}\u0000${line.slice(cut + 1)}`) ?? null;
    };
    return { rows, columns: { line: declared.source.line, ...declared.columns }, codes, places, lineOf };
  }

  /** An order table's own rule with its add-on as it stands now, when the rule is live; null otherwise. Refuses nothing. */
  async function live(target: WriteTarget): Promise<AdjustFor | null> {
    const adjust = kit.rulesOf(target)?.adjust;
    if (adjust === undefined || kit.ledgers?.adjuster === undefined) return null;
    await kit.ledgers.refresh?.();
    const state = kit.ledgers.adjuster(target.view, target.table);
    if (state.state !== 'live') return null;
    const appliedTable = state.adjuster.table(state.adjuster.declared.applied.table);
    return appliedTable === null ? null : { target, adjust, adjuster: state.adjuster, decider: state.decider, applied: await kit.withRights({ ...target, table: appliedTable }) };
  }

  /**
   * An order that is gone takes the rows of what was applied to it with it:
   * a later order given the same key would otherwise be shown reductions
   * nobody gave it.
   */
  async function forget(trx: Db, order: AdjustFor, key: unknown): Promise<void> {
    const declared = order.adjuster.declared.applied;
    await kit.remove({ ...order.applied, db: trx }, { [declared.source.table]: kit.ledgers!.refOf(order.target.connectionId, order.target.table.id), [declared.source.row]: String(key) });
  }

  /**
   * A DOOR THAT WRITES MANY ROWS AT ONCE ASKS NO PRICE — a bulk edit, an undo,
   * a form's child rows, a batch, an import's change of a stored row, a row
   * moved by another row's effect. A row of such a write that would move an
   * order's price — a line, a typed code or a refund made or taken away, a
   * change of what the price reads — is refused, to be made one row at a
   * time. Answers a row's own issue for an import (the import goes on);
   * throws for every other door. `history`: rows brought in as they were (an
   * import's creates, sample rows) keep the reductions they bring and are
   * never refused. A rule that reads as not there, or that the owner switched
   * off, refuses nothing.
   */
  async function refuseBatch(input: {
    target: WriteTarget;
    rules: TableRules | null;
    action: WriteAction;
    context: WriteContext;
    rows: readonly { values: Row }[];
    history?: boolean | undefined;
    effect?: string | undefined;
  }): Promise<(Record<string, { code: string }> | null)[]> {
    const { target, rules, action } = input;
    const none = input.rows.map(() => null);
    const own = rules?.adjust;
    const parents = rules?.adjustParents ?? [];
    if ((own === undefined && parents.length === 0) || (action === 'create' && input.history === true)) return none;
    /** The order tables a write of this row would ask about, with the column it turns on. */
    const asks = (values: Row): { table: string; column: string }[] => {
      const out: { table: string; column: string }[] = [];
      if (own !== undefined) {
        const state = rules?.states?.column;
        // (An import keeps the reductions its rows bring: on a row already stored that is a change of its price like any other.)
        const [input] = touched([...own.inputs.uses, ...own.inputs.lines, ...(action === 'update' ? own.decided : [])], values);
        // A new order that is its own line (a stay) is priced as it is made; an order moved to where its price stands is priced one last time;
        // and one that goes takes what was applied to it with it.
        const column =
          action === 'delete'
            ? own.key
            : (input ?? (action === 'create' ? (own.parts.some((part) => part.self) ? own.key : undefined) : state !== undefined && Object.prototype.hasOwnProperty.call(values, state) && frozenNow(own, values, state) ? state : undefined));
        if (column !== undefined) out.push({ table: target.table.id, column });
      }
      for (const parent of parents) {
        const [column] = action === 'update' ? touched([...parent.inputs, ...parent.decided], values) : [parent.via];
        if (column !== undefined) out.push({ table: parent.order, column });
      }
      return out;
    };
    const hits = input.rows.map((row) => asks(row.values));
    if (hits.every((hit) => hit.length === 0)) return none;
    await kit.ledgers?.refresh?.();
    const asked = new Map<string, boolean>();
    /** Whether an order table's rule is there to be asked: live, or one that should run and cannot. */
    const there = (id: string): boolean => {
      const known = asked.get(id);
      if (known !== undefined) return known;
      let answer = true;
      try {
        const state = kit.ledgers?.adjuster?.(target.view, id === target.table.id ? target.table : target.view.table(id));
        answer = state === undefined || (state.state !== 'idle' && state.state !== 'off');
      } catch {
        // An order table the model no longer has prices nothing.
        answer = false;
      }
      asked.set(id, answer);
      return answer;
    };
    return hits.map((hit) => {
      const found = hit.find((one) => there(one.table));
      if (found === undefined) return null;
      // An import refuses the row and goes on; every other door refuses the write.
      if (input.context.origin === 'import') return { [found.column]: { code: 'one-at-a-time' } };
      throw new PostingRefusedError('This is saved one row at a time: it changes what an order costs.', { reason: 'one-at-a-time', column: found.column, ...(input.effect === undefined ? {} : { table: input.effect }) });
    });
  }

  /**
   * A code typed on an order whose price rule reads as not there (its add-on
   * is not installed, or not connected to the app), or that the owner switched
   * off, is refused: taken in silence, the customer would be charged the full
   * price with a code on the order. Null when nothing is typed, or the rule is
   * there to judge it.
   */
  function inertCode(target: WriteTarget, rules: TableRules | null, values: Row, stored?: Row | null): string | null {
    for (const parent of rules?.adjustParents ?? []) {
      if (parent.typed === undefined || empty(values[parent.typed])) continue;
      // A code already on the order, sent back as it stands with something else of its row (taken off again, a note): nothing is typed.
      if (stored !== undefined && stored !== null && sameValue(stored[parent.typed] ?? null, values[parent.typed] ?? null)) continue;
      try {
        // (Not there at all, or switched off by the owner: either way nobody would price the order the code is typed on.)
        const state = kit.ledgers?.adjuster?.(target.view, target.view.table(parent.order)).state;
        if (state === 'idle' || state === 'off') return parent.typed;
      } catch {
        // An order table the model no longer has takes no code.
      }
    }
    return null;
  }

  /**
   * The rows that say what was applied to an order, brought in step with the
   * answer: a row for something no longer applied is taken away, one for
   * something new is made, and one whose amount or name moved is changed.
   * Nothing is written for what stayed as it was.
   */
  /**
   * What an order whose price stands used, read off the rows of what was
   * applied to it: one use for each offer, code and voucher, with the sum it
   * took off. Nobody is asked, and nothing of the order is written.
   */
  async function recordedOf(trx: Db, input: AdjustRun, order: Row): Promise<AdjustResult> {
    const { adjust, adjuster } = input.for;
    const target: WriteTarget = { ...input.for.target, db: trx };
    const rules = kit.rulesOf(target);
    const scale = (rules?.scales ?? []).find((entry) => entry.column === adjust.rule.order.discount)?.scale ?? 2;
    const places = placesFor(scale, order, rules?.currencyColumn, await kit.currency(target));
    const columns = adjuster.declared.applied.columns;
    const stored = await storedApplied(trx, input.for, { table: kit.ledgers!.refOf(target.connectionId, target.table.id), row: String(order[adjust.key]) });
    const keyOf = kit.customerKey;
    const person = keyOf === undefined ? null : await loadPerson(trx, target.view, adjust, adjuster, order, { orderTable: target.table, keyOf: (address) => keyOf(target.connectionId, address) });
    const text = (value: unknown): string | null => (empty(value) ? null : String(value));
    const sums = new Map<string, { use: AdjustUse; sum: { n: bigint; d: bigint } }>();
    for (const row of stored) {
      const use = { offer: text(row[columns.offer]), code: text(row[columns.code]), voucher: text(row[columns.voucher]) };
      const id = JSON.stringify([String(row[columns.kind] ?? ''), use.offer, use.code, use.voucher]);
      const amount = toRatio(row[columns.amount]) ?? ZERO;
      const known = sums.get(id);
      if (known === undefined) sums.set(id, { use: { ...use, amount: '0', ...(person === null ? {} : { customer: person.key }) }, sum: amount });
      else known.sum = plus(known.sum, amount);
    }
    const uses = [...sums.values()].map(({ use, sum }) => ({ ...use, amount: ratioText(sum, places) }));
    const discount = toRatio(order[adjust.rule.order.discount]) ?? ZERO;
    return { applied: [], told: [], uses, discount: ratioText(discount, places), lines: [], changedLines: 0, codes: [], wrote: {}, places, ...(adjust.uses === undefined ? {} : { recorder: adjust.uses }) };
  }

  /** The rows that say what was applied to an order, as stored, oldest first. */
  async function storedApplied(trx: Db, order: AdjustFor, source: { table: string; row: string }): Promise<Row[]> {
    const declared = order.adjuster.declared.applied;
    const table = order.applied.table;
    let query = trx
      .selectFrom(table.id as never)
      .selectAll()
      .where(sql.ref(declared.source.table), '=', source.table as never)
      .where(sql.ref(declared.source.row), '=', source.row as never);
    for (const column of table.primaryKey) query = query.orderBy(sql.ref(column));
    return (await query.execute()) as Row[];
  }

  /**
   * Every row a use of this order could be of, looked up before any lock:
   * the codes typed on it and the offers there to be asked about now — each
   * as a use of nothing. The rule that records uses names its locks from
   * them; the uses the order really has are a part of these, or the save
   * starts again.
   */
  async function candidates(db: Db, order: AdjustFor, input: { key?: unknown; typed?: readonly string[] | undefined }): Promise<PostingUse[]> {
    const { adjust, adjuster } = order;
    const view = order.target.view;
    let codes: LoadedCode[] = [];
    try {
      if (input.typed !== undefined) codes = await findCodes(db, adjuster, input.typed);
      else if (input.key !== undefined && input.key !== null) codes = await loadCodes(db, view, adjust, adjuster, { [adjust.key]: input.key });
      const settings = await ledgerSettings(adjuster, db);
      const offers = await loadOffers(db, adjuster, { codes: codes.flatMap((code) => (code.kind === 'code' && code.id !== null ? [code.id] : [])), now: new Date().toISOString(), settings });
      const first = adjuster.declared.offers[0];
      const out: PostingUse[] = [];
      const seen = new Set<string>();
      for (const read of adjuster.declared.offers) {
        if (first === undefined || read.table !== first.table) continue;
        const key = adjuster.table(read.table)?.primaryKey[0] ?? 'id';
        for (const row of offers[read.as] ?? []) {
          const id = String(row[key]);
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({ offer: id, code: null, voucher: null, amount: '0' });
        }
      }
      for (const code of codes) {
        if (code.id === null) continue;
        out.push(code.kind === 'voucher' ? { offer: null, code: null, voucher: code.id, amount: '0' } : { offer: null, code: code.id, voucher: null, amount: '0' });
      }
      // …and what the order already has, whatever became of it since: an offer paused yesterday is still one this order may be recorded as using.
      if (input.key !== undefined && input.key !== null) {
        const columns = adjuster.declared.applied.columns;
        const text = (value: unknown): string | null => (empty(value) ? null : String(value));
        for (const row of await storedApplied(db, order, { table: kit.ledgers!.refOf(order.target.connectionId, order.target.table.id), row: String(input.key) })) {
          const had = { offer: text(row[columns.offer]), code: text(row[columns.code]), voucher: text(row[columns.voucher]) };
          if (had.offer !== null || had.code !== null || had.voucher !== null) out.push({ ...had, amount: '0' });
        }
      }
      return out;
    } catch (error) {
      if (error instanceof AdjustTooLarge) throw tooLarge();
      throw error;
    }
  }

  async function writeApplied(
    trx: Db,
    input: AdjustRun,
    wanted: readonly AdjustApplied[],
    source: { table: string; row: string },
    at: { now: Date; locale: string; places: number },
    keys: { offer(id: string | null): unknown; code(id: string | null): unknown; voucher(id: string | null): unknown },
  ): Promise<void> {
    const declared = input.for.adjuster.declared.applied;
    const target: WriteTarget = { ...input.for.applied, db: trx };
    const table = target.table;
    const pk = table.primaryKey[0] ?? 'id';
    const c = declared.columns;
    const stored = await storedApplied(trx, input.for, source);
    const text = (value: unknown): string => (empty(value) ? '' : String(value));
    const idOf = (line: string, kind: string, offer: unknown, code: unknown, voucher: unknown): string => [line, kind, text(offer), text(code), text(voucher)].join('\u0000');
    // The whole name in every language where the column keeps one, else the name in the reader's language.
    const json = table.columns.get(c.name)?.logicalType === 'json' || input.for.adjuster.typesOf(table.id).get(c.name) === 'json';
    const nameOf = (name: AdjustApplied['name']): string => (json ? JSON.stringify(name) : typeof name === 'string' ? name : (name[at.locale] ?? Object.values(name)[0] ?? ''));
    const sameName = (kept: unknown, name: AdjustApplied['name']): boolean => {
      if (!json) return String(kept ?? '') === nameOf(name);
      // An engine that keeps json as text hands the text back; one that does not hands back what it parsed.
      let read = kept;
      if (typeof kept === 'string') {
        try {
          read = JSON.parse(kept);
        } catch {
          read = kept;
        }
      }
      return sameValue(read, name);
    };
    const byId = new Map<string, AdjustApplied>();
    for (const entry of wanted) byId.set(idOf(entry.line, entry.kind, entry.offer, entry.code, entry.voucher), entry);
    const kept = new Set<string>();
    const gone: unknown[] = [];
    for (const row of stored) {
      const id = idOf(String(row[declared.source.line] ?? ''), String(row[c.kind] ?? ''), row[c.offer], row[c.code], row[c.voucher]);
      const entry = byId.get(id);
      if (entry === undefined || kept.has(id)) {
        gone.push(row[pk]);
        continue;
      }
      kept.add(id);
      if (sameDecimal(row[c.amount], entry.amount, at.places) && sameName(row[c.name], entry.name) && text(row[c.reason]) === text(entry.reason) && booleanOf(row[c.typed]) === entry.typed) continue;
      await kit.update(target, bound(target, { [c.amount]: entry.amount, [c.name]: nameOf(entry.name), [c.reason]: entry.reason ?? null, [c.typed]: entry.typed }), { [pk]: row[pk] });
    }
    for (const key of gone) await kit.remove(target, { [pk]: key });
    const made = [...byId].filter(([id]) => !kept.has(id)).map(([, entry]) => ({
      [declared.source.table]: source.table,
      [declared.source.row]: source.row,
      [declared.source.line]: entry.line,
      [c.offer]: keys.offer(entry.offer),
      [c.code]: keys.code(entry.code),
      [c.voucher]: keys.voucher(entry.voucher),
      [c.name]: nameOf(entry.name),
      [c.kind]: entry.kind,
      [c.amount]: entry.amount,
      [c.reason]: entry.reason ?? null,
      [c.typed]: entry.typed,
      [c.at]: at.now.toISOString(),
    }));
    if (made.length > 0) await kit.insert(target, made.map((row) => bound(target, row)));
  }

  return { peek, run, tried, refund, reductions, live, forget, refuseBatch, inertCode, candidates };
}
