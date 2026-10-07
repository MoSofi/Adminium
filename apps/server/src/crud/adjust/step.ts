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
import { adjustOutputSchema, type AdjustApplied, type AdjustInput, type AdjustOutput, type AdjustUse } from '@adminium/add-on-contracts';
import { ratioText, sameDecimal, toRatio } from '@adminium/manifest';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import { callDecider, DeciderFailed, type InstalledDecider } from '../../add-ons/decide.js';
import type { SourceDatabase } from '../../connections/manager.js';
import { AdjustRefusedError, PostingRefusedError } from '../../errors.js';
import type { LedgerRuntime, ResolvedAdjuster } from '../../ledgers/registry.js';
import type { CustomerKeyOf } from '../../public-api/customer-key.js';
import type { TableRules } from '../column-rules.js';
import { readDbRefusal, writeConflict } from '../db-errors.js';
import { isUniqueViolation } from '../decided-columns.js';
import { evaluateAll, placesFor, touchedFormulas } from '../formulas.js';
import type { ResolvedTable } from '../identifiers.js';
import { ledgerSettings, type ScalarRow } from '../ledger-reads.js';
import type { Row } from '../mask.js';
import { priceNights } from '../per-night.js';
import { venueClock } from '../venue-time.js';
import type { WriteClock } from '../write-clock.js';
import type { WriteAction, WriteActor, WriteContext, WriteTarget } from '../write-context.js';
import { bindWriteValue, booleanOf, sameValue } from '../write-values.js';
import { adjustWords, publicReason, refusalOf, type RefusedCode } from './answers.js';
import { checkAdjust } from './check.js';
import { AdjustTooLarge, adjustCodeOf, adjustLineOf, loadCodes, loadLines, loadOffers, loadOrder, loadPerson, type LoadedCode, type LoadedLine } from './load.js';
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
  /** A code's refusal held back for the save's price check (see `expects`): raised by the caller when the price is as expected without it. */
  heldBack?: Error;
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
      const written = [...own.inputs.uses, ...own.inputs.lines, ...(stateColumn === undefined ? [] : [stateColumn]), ...(rules?.followReads ?? [])];
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
   * One order priced again, on the save's transaction. Null when there is
   * nothing to price: the order is not there, or its price stands for good.
   */
  async function run(trx: Db, input: AdjustRun): Promise<AdjustResult | null> {
    const { adjust, adjuster, decider } = input.for;
    const target: WriteTarget = { ...input.for.target, db: trx };
    const rules = kit.rulesOf(target);
    const view = target.view;
    const origin = adjustOrigin(input.context);

    // The price of an order that stands for good is never worked out again; a change of what it rests on is refused.
    if (input.stood !== null && frozenNow(adjust, input.stood, rules?.states?.column)) {
      if (input.touches) throw new AdjustRefusedError(adjustWords('frozen'), { reason: 'frozen' });
      return null;
    }
    const read = input.order ?? (await loadOrder(trx, target.table, adjust, input.key));
    if (read === undefined) return null;
    let order: Row = read;
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

    const currency = await kit.currency(target);
    const scale = (rules?.scales ?? []).find((entry) => entry.column === adjust.rule.order.discount)?.scale ?? 2;
    const places = placesFor(scale, order, rules?.currencyColumn, currency);

    let rows: LoadedLine[];
    let codes: LoadedCode[];
    let settings: ScalarRow;
    let offers: Record<string, ScalarRow[]>;
    const now = input.clock.locked(trx);
    try {
      rows = await loadLines(trx, view, adjust, order);
      codes = await loadCodes(trx, view, adjust, adjuster, order);
      settings = await ledgerSettings(adjuster, trx);
      offers = await loadOffers(trx, adjuster, { codes: codes.flatMap((code) => (code.kind === 'code' && code.id !== null ? [code.id] : [])), now: now.toISOString(), settings });
    } catch (error) {
      if (error instanceof AdjustTooLarge) throw tooLarge();
      throw error;
    }
    // A code typed longer than any code is: no code, said by Adminium — the add-on is never asked to say it back.
    const long = codes.find((code) => code.typed.length > TYPED_MAX);
    if (long !== undefined && adjust.codes !== undefined) throw refusalOf(origin, { typed: long.typed.slice(0, TYPED_MAX), reason: 'unknown' }, adjust.codes.typed, codeAt(view, adjust, long));
    // The add-on's tables were read on this transaction: a change of them now waits for this save. Asked about once more, an update that
    // began in another process before those reads is seen here.
    const installed = await kit.ledgers!.versionNow(adjuster.addOn);
    if (installed === null || installed.status !== 'installed' || installed.version !== decider.version) throw writeConflict();

    const keyOf = kit.customerKey;
    const person =
      keyOf === undefined ? null : await loadPerson(trx, view, adjust, adjuster, order, { orderTable: target.table, keyOf: (address) => keyOf(target.connectionId, address) });

    const lines = rows.filter((row) => row.line);
    const zone = target.timezone ?? 'UTC';
    const clock = venueClock(now, zone);
    const perNight = rules?.perNight;
    const refOf = (tableId: string): string => kit.ledgers!.refOf(target.connectionId, tableId);
    const handed: AdjustInput['lines'] = [];
    for (const [index, line] of lines.entries()) {
      const nights = line.part.nights !== undefined && perNight !== undefined && perNight.column === line.part.nights.rate ? (await priceNights(trx, perNight, line.row, places)).nights : undefined;
      handed.push(adjustLineOf({ view, line, index, places, refOf, nights }));
    }
    // WHO GAVE. A reduction by hand that this save sets, changes or takes away — or one that stands with nobody on record as its giver
    // (brought in by an import, written while the rule was off) — is the saver's: held to the most their roles allow, which Adminium
    // reads, judges the asked figure against itself, and hands in for the add-on to judge what it comes to. One that stands with its
    // giver on record is handed in as stored: judged by nobody when somebody else saves (a manager's 20 % stays when a cashier adds a
    // line), and held to its giver's own limit again when its giver does (the order may have grown since they gave it).
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
    const mapped = adjust.rule.order.currency;
    const said = mapped === undefined ? null : typeof mapped === 'string' ? order[mapped] : 'value' in mapped ? mapped.value : 'setting' in mapped ? settings[mapped.setting] : null;
    const question: AdjustInput = {
      contract: 'price-adjust@1',
      mode: input.mode,
      point: 'line',
      origin,
      now: now.toISOString(),
      today: clock.day,
      weekday: new Date(`${clock.day}T00:00:00Z`).getUTCDay() as AdjustInput['weekday'],
      time: `${String(Math.floor(clock.minute / 60)).padStart(2, '0')}:${String(clock.minute % 60).padStart(2, '0')}`,
      zone,
      currency: empty(said) ? currency : String(said),
      scale: places,
      // (As a language is named in what an add-on keeps: `de-DE`.)
      locale: (input.locale ?? input.context.adjust?.locale ?? 'en-US').replace('_', '-'),
      lines: handed,
      codes: codes.map((code) => adjustCodeOf(adjuster, code)),
      customer: person,
      guest: person === null && origin === 'public',
      staff,
      offers,
      settings,
      explain: false,
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
    return { applied: answer.applied, told: answer.told ?? [], uses: answer.uses, discount: answer.order.discount, lines: outLines, changedLines, codes, wrote, places, ...(typed === undefined ? {} : { typed }), ...(heldBack === undefined ? {} : { heldBack }) };
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
   * is not installed, or not connected to the app) is refused: taken in
   * silence, the customer would be charged the full price with a code on the
   * order. Null when nothing is typed, or the rule is there to judge it.
   */
  function inertCode(target: WriteTarget, rules: TableRules | null, values: Row): string | null {
    for (const parent of rules?.adjustParents ?? []) {
      if (parent.typed === undefined || empty(values[parent.typed])) continue;
      try {
        if (kit.ledgers?.adjuster?.(target.view, target.view.table(parent.order)).state === 'idle') return parent.typed;
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
    const stored = (await trx
      .selectFrom(table.id as never)
      .selectAll()
      .where(sql.ref(declared.source.table), '=', source.table as never)
      .where(sql.ref(declared.source.row), '=', source.row as never)
      .orderBy(sql.ref(pk))
      .execute()) as Row[];
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

  return { peek, run, live, forget, refuseBatch, inertCode };
}
