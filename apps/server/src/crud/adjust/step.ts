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
import type { WriteAction, WriteContext, WriteTarget } from '../write-context.js';
import { bindWriteValue, booleanOf, sameValue } from '../write-values.js';
import { adjustWords, refusalOf, type RefusedCode } from './answers.js';
import { checkAdjust } from './check.js';
import { AdjustTooLarge, adjustCodeOf, adjustLineOf, loadCodes, loadLines, loadOffers, loadOrder, loadPerson, type LoadedCode, type LoadedLine } from './load.js';
import { frozenNow, touched, type CompiledAdjust } from './rule.js';

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
  /** The connection's currency, for a table whose places follow it. */
  currency(target: WriteTarget): Promise<string | null>;
  /** A customer's key in a connection; absent on a service built without one. */
  customerKey: CustomerKeyOf | undefined;
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

const empty = (value: unknown): boolean => value === null || value === undefined || value === '';
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
      const written = [...own.inputs.uses, ...own.inputs.lines, ...(stateColumn === undefined ? [] : [stateColumn])];
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
    const order = input.order ?? (await loadOrder(trx, target.table, adjust, input.key));
    if (order === undefined) return null;

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
      locale: input.locale ?? 'en-US',
      lines: handed,
      codes: codes.map((code) => adjustCodeOf(adjuster, code)),
      customer: person,
      guest: person === null && origin === 'public',
      staff: storedStaff(adjust, order, places),
      offers,
      settings,
      explain: false,
      version: adjuster.version,
    };

    let answer: AdjustOutput;
    try {
      answer = callDecider('adjust', decider, question, { shape: adjustOutputSchema }) as AdjustOutput;
    } catch (error) {
      if (error instanceof DeciderFailed) throw new AdjustFailed(error.cause, error.detail);
      throw error;
    }
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
    const issue = checkAdjust(question, answer, { offers: new Set(offerKeys.keys()), codes: new Set(codeKeys.keys()), vouchers: new Set(voucherKeys.keys()) });
    if (issue !== null) throw new AdjustFailed('check', issue.slice(0, 200));

    // A code, or a reduction staff gave, that does not stand refuses the write: on the column it was typed into.
    const refused = answer.refused[0] as RefusedCode | undefined;
    if (refused !== undefined) {
      const typedIn = codes.find((code) => code.typed === refused.typed);
      const at = typedIn === undefined ? undefined : codeAt(view, adjust, typedIn);
      // What staff gave is refused on its own column; a code on the column it was typed into, with the row it is on.
      if (refused.reason === 'over-ceiling' || adjust.codes === undefined || at === undefined) throw refusalOf(origin, refused, adjust.rule.order.staff?.value ?? adjust.rule.order.discount);
      throw refusalOf(origin, refused, adjust.codes.typed, at);
    }

    // Each row's reduction, where it differs from what is stored — with the row's formulas that read it. A row that is no line any more gives its reduction back.
    const reduced = new Map(answer.lines.map((line) => [line.key, line.discount]));
    const zero = ratioText({ n: 0n, d: 1n }, places);
    const differs = (stored: unknown, wanted: string): boolean => (empty(stored) ? !sameDecimal(wanted, zero, places) : !sameDecimal(stored, wanted, places));
    let changedLines = 0;
    const outLines: AdjustResult['lines'] = [];
    const orderSet: Row = {};
    for (const row of rows) {
      const wanted = row.line ? (reduced.get(row.key) ?? zero) : zero;
      if (row.line) outLines.push({ table: row.table.id, key: row.table.primaryKey.map((column) => String(row.row[column])).join('/'), line: row.key, discount: wanted });
      if (!differs(row.row[row.part.discount], wanted)) continue;
      changedLines += 1;
      // The order is its own line: its reduction is written with the order's, below.
      if (row.part.self) {
        orderSet[row.part.discount] = wanted;
        continue;
      }
      const lineTarget: WriteTarget = { ...target, table: row.table };
      const lineRules = kit.rulesOf(lineTarget);
      const worked = touchedFormulas(lineRules?.formulas ?? [], [row.part.discount]);
      await kit.update(lineTarget, { [row.part.discount]: wanted, ...evaluateAll(worked, { ...row.row, [row.part.discount]: wanted }, lineRules?.currencyColumn, currency) }, pkOf(row.table, row.row));
    }

    // The order's own reduction, with its formulas that read one; and the links each typed code found.
    if (differs(order[adjust.rule.order.discount], answer.order.discount)) orderSet[adjust.rule.order.discount] = answer.order.discount;
    if (Object.keys(orderSet).length > 0) {
      const worked = touchedFormulas(rules?.formulas ?? [], Object.keys(orderSet));
      await kit.update(target, { ...orderSet, ...evaluateAll(worked, { ...order, ...orderSet }, rules?.currencyColumn, currency) }, pkOf(target.table, order));
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
        await writeApplied(trx, input, answer.applied, { table: refOf(target.table.id), row: String(order[adjust.key]) }, { now, locale: question.locale, places }, {
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
    return { applied: answer.applied, told: answer.told ?? [], uses: answer.uses, discount: answer.order.discount, lines: outLines, changedLines, codes };
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
    if (gone.length > 0) await trx.deleteFrom(table.id as never).where(sql.ref(pk), 'in', gone as never).execute();
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

  return { peek, run };
}
