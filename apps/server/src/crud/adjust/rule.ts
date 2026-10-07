// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PRICE RULE, AS A WRITE READS IT — pure: no database, no add-on, no clock.
 *
 * A table may say that an add-on lowers the price of its rows
 * (`table.adjust`): which rows are an order's lines, which columns hold a
 * line's price, its quantity and the reduction Adminium writes, which codes
 * were typed, who is buying, what staff took off by hand. This file turns the
 * stored rule into what the write path asks of it on every save:
 *
 *  - on the ORDER's table, the rule itself with its parts in order, the
 *    columns whose change asks the price again, and the columns only Adminium
 *    writes;
 *  - on every table whose rows are PART of an order — its lines, the codes
 *    typed on it, the money given back — which order that is, and which of
 *    its own columns the price depends on.
 *
 * Whether the rule is LIVE (the add-on that answers it installed, connected,
 * switched on) is not said here: that changes with no change of the model,
 * and is asked of the ledger registry on every write.
 */
import type { EffectiveModel, EffectiveTable, TableAdjust } from '../../connections/effective-schema.js';
import type { Row } from '../mask.js';
import { sameValue } from '../write-values.js';

type StoredPart = TableAdjust['lines'][number];
type What = { column: string; as: 'item' | 'category' | 'type' | 'tag' };

/** One kind of line an order has: rows of a child table, or the order row itself (a stay priced by the night). */
export interface AdjustPart {
  /** Its place in the rule's `lines`: what a line's key is prefixed with, so two parts never share one. */
  index: number;
  self: boolean;
  /** The table its rows are in: the order's own, for a part that is the order itself. */
  table: string;
  /** The column of a line that names its order; absent when the order is its own line. */
  via?: string;
  price: string;
  /** Absent: the quantity is 1 and `price` is the line's whole amount. */
  quantity?: string;
  /** The reduction of the line. Adminium's alone to write. */
  discount: string;
  what: What[];
  /** A line with this column filled is never reduced (a gift card being loaded). */
  excludes?: string;
  /** The link to the code that pays for the line. */
  paidBy?: string;
  /** Only such rows are lines. */
  only?: { column: string; eq: unknown } | { column: string; in: readonly unknown[] };
  /** A row with this column filled is no line (a voided one). */
  unlessSet?: string;
  /** A price by the night: the stay's dates, and the column that carries the nightly price. */
  nights?: { from: string; to: string; rate: string };
  /** The columns of a row of this part whose change asks the price again. */
  inputs: string[];
}

/** The price rule of an order's table. */
export interface CompiledAdjust {
  rule: TableAdjust;
  /** The add-on that answers. */
  addOn: string;
  /** The order's table and its one key column. */
  table: string;
  key: string;
  parts: AdjustPart[];
  /** Where the codes typed on an order are kept. */
  codes?: NonNullable<TableAdjust['codes']>;
  /** Where money given back is kept, and what Adminium decides of it. */
  refunds?: NonNullable<TableAdjust['refunds']>;
  /**
   * The order's own columns the price depends on, in two kinds. `uses`: who is
   * buying and what staff took off by hand — what decides WHICH reductions an
   * order has. `lines`: what the order's own line is worth (a stay's price
   * and dates), and its currency.
   */
  inputs: { uses: string[]; lines: string[] };
  /** The order's columns only Adminium writes: its reduction, who gave one by hand, whether the customer was proved. */
  decided: string[];
  /** The posting of this table that records what was used, when the rule names one. */
  uses?: string;
}

/** What a table's rows are to an order of another table. */
export interface AdjustParent {
  /** The order's table, the column of ITS key, and this table's column that names it. */
  order: string;
  orderKey: string;
  via: string;
  as: 'line' | 'codes' | 'refund';
  /** Which part of the rule, for a line. */
  part?: number;
  /** This table's columns whose change asks the order's price again. */
  inputs: string[];
  /** This table's columns only Adminium writes. */
  decided: string[];
  /** For the codes typed on an order: the column a code is typed into. */
  typed?: string;
}

const uniq = (columns: readonly (string | undefined)[]): string[] => [...new Set(columns.filter((column): column is string => column !== undefined))];

function partOf(order: Pick<EffectiveTable, 'id'>, stored: StoredPart, index: number): AdjustPart {
  if ('self' in stored) {
    return {
      index,
      self: true,
      table: order.id,
      price: stored.price,
      ...(stored.quantity === undefined ? {} : { quantity: stored.quantity }),
      discount: stored.discount,
      what: stored.what as What[],
      ...(stored.nights === undefined ? {} : { nights: stored.nights }),
      inputs: uniq([stored.price, stored.quantity, ...stored.what.map((what) => what.column), stored.nights?.from, stored.nights?.to]),
    };
  }
  return {
    index,
    self: false,
    table: stored.table,
    via: stored.via,
    price: stored.price,
    ...(stored.quantity === undefined ? {} : { quantity: stored.quantity }),
    discount: stored.discount,
    what: stored.what as What[],
    ...(stored.excludes === undefined ? {} : { excludes: stored.excludes.column }),
    ...(stored.paidBy === undefined ? {} : { paidBy: stored.paidBy.column }),
    ...(stored.only === undefined ? {} : { only: stored.only as NonNullable<AdjustPart['only']> }),
    ...(stored.unlessSet === undefined ? {} : { unlessSet: stored.unlessSet }),
    inputs: uniq([stored.via, stored.price, stored.quantity, ...stored.what.map((what) => what.column), stored.excludes?.column, stored.paidBy?.column, stored.only?.column, stored.unlessSet]),
  };
}

/** The price rule of a table, as declared; undefined for a table that has none, or whose rows cannot be named by one column. */
export function compileAdjust(table: Pick<EffectiveTable, 'id' | 'primaryKey' | 'adjust'> | undefined): CompiledAdjust | undefined {
  const rule = table?.adjust;
  if (table === undefined || rule === undefined || table.primaryKey.length !== 1) return undefined;
  const parts = rule.lines.map((stored, index) => partOf(table, stored, index));
  const { order } = rule;
  const self = parts.filter((part) => part.self);
  return {
    rule,
    addOn: rule.by.addOn,
    table: table.id,
    key: table.primaryKey[0]!,
    parts,
    ...(rule.codes === undefined ? {} : { codes: rule.codes }),
    ...(rule.refunds === undefined ? {} : { refunds: rule.refunds }),
    inputs: {
      uses: uniq([order.staff?.kind, order.staff?.value, order.staff?.reason, order.customer?.link]),
      lines: uniq([...self.flatMap((part) => part.inputs), typeof order.currency === 'string' ? order.currency : undefined]),
    },
    decided: uniq([order.discount, order.staff?.by, order.customer?.proved, ...self.map((part) => part.discount)]),
    ...(rule.uses === undefined ? {} : { uses: rule.uses }),
  };
}

/**
 * What a table's rows are to the orders of other tables: a line, a typed
 * code, money given back. Read off every price rule of the model that names
 * the table; a rule whose link to its order the model no longer has makes its
 * rows part of nothing.
 */
export function adjustParentsOf(model: Pick<EffectiveModel, 'tables' | 'relations'> | undefined, table: Pick<EffectiveTable, 'id'> | undefined): AdjustParent[] {
  // (A model with no list of tables — a table looked at on its own — has no order to be part of.)
  if (model === undefined || table === undefined || !Array.isArray(model.tables)) return [];
  const out: AdjustParent[] = [];
  for (const order of model.tables) {
    const compiled = compileAdjust(order);
    if (compiled === undefined) {
      // A rule that cannot be read as one (its orders have no one key) still names its rows: they ask, and are refused with it, never written unpriced.
      const stored = order.adjust;
      if (stored === undefined) continue;
      const unread = (via: string, as: AdjustParent['as'], inputs: (string | undefined)[]): AdjustParent => ({ order: order.id, orderKey: order.primaryKey[0] ?? '', via, as, inputs: uniq([via, ...inputs]), decided: [] });
      for (const part of stored.lines) if (!('self' in part) && part.table === table.id) out.push(unread(part.via, 'line', [part.price, part.quantity]));
      if (stored.codes?.table === table.id) out.push(unread(stored.codes.via, 'codes', [stored.codes.typed]));
      if (stored.refunds?.table === table.id) out.push(unread(stored.refunds.via, 'refund', []));
      continue;
    }
    const linked = (via: string): boolean =>
      (model.relations ?? []).some((relation) => relation.through === null && relation.from.tableId === table.id && relation.from.columns.length === 1 && relation.from.columns[0] === via && relation.to.tableId === order.id && relation.to.columns.length === 1 && relation.to.columns[0] === compiled.key);
    const base = (via: string) => ({ order: order.id, orderKey: compiled.key, via });
    for (const part of compiled.parts) {
      if (part.self || part.table !== table.id || part.via === undefined || !linked(part.via)) continue;
      out.push({ ...base(part.via), as: 'line', part: part.index, inputs: part.inputs, decided: [part.discount] });
    }
    const codes = compiled.codes;
    if (codes !== undefined && codes.table === table.id && linked(codes.via)) {
      out.push({ ...base(codes.via), as: 'codes', inputs: uniq([codes.via, codes.typed, codes.removed]), decided: [codes.code, codes.voucher], typed: codes.typed });
    }
    const refunds = compiled.refunds;
    if (refunds !== undefined && refunds.table === table.id && linked(refunds.via)) {
      out.push({ ...base(refunds.via), as: 'refund', inputs: uniq([refunds.via, refunds.against]), decided: uniq([refunds.amount, refunds.tax]) });
    }
  }
  return out;
}

const filled = (value: unknown): boolean => value !== null && value !== undefined && value !== '';
const among = (value: unknown, list: readonly unknown[]): boolean => list.some((candidate) => sameValue(value, candidate));

/**
 * Whether an order's price stands for good: it is in a state, holds a value,
 * or has a column filled from which the rule says the price is never worked
 * out again. Judged on the row as it is held.
 */
export function frozenNow(adjust: Pick<CompiledAdjust, 'rule'>, row: Row, stateColumn: string | undefined): boolean {
  const frozen = adjust.rule.frozen;
  if (frozen === undefined) return false;
  if ('to' in frozen) return stateColumn !== undefined && among(row[stateColumn], frozen.to);
  if ('in' in frozen) return among(row[frozen.column], frozen.in);
  return filled(row[frozen.column]);
}

/** Whether a row of a part's table is a line at all: not one its `unlessSet` column marks, and one its `only` takes. */
export function isLine(part: Pick<AdjustPart, 'only' | 'unlessSet'>, row: Row): boolean {
  if (part.unlessSet !== undefined && filled(row[part.unlessSet])) return false;
  const only = part.only;
  if (only === undefined) return true;
  return 'eq' in only ? sameValue(row[only.column], only.eq) : among(row[only.column], only.in);
}

/** A line's key as the add-on is handed it and as the rows of what was applied keep it: its part, then its own key. */
export const lineKey = (part: number, key: unknown): string => `p${String(part)}:${String(key)}`;

/** Which of a list of columns a change really moves: sent, and not what the row already holds (a form sends the whole row back). */
export function moved(inputs: readonly string[], values: Row | null | undefined, stored: Row | null | undefined): string[] {
  return touched(inputs, values).filter((column) => {
    if (stored === null || stored === undefined) return true;
    // Nothing typed is nothing kept: a form sends an empty box back as empty text.
    const [sent, kept] = [values![column] === '' ? null : values![column], stored[column] === '' ? null : stored[column]];
    if (sameValue(sent ?? null, kept ?? null)) return false;
    return plain(sent) === null || plain(sent) !== plain(kept);
  });
}

/**
 * A number as its digits, without the zeros after its last decimal: "10",
 * 10 and "10.00" are one amount. Never by its size — "007" is not "7" (a
 * code, a tag), and a key too long for a float is still its own.
 */
function plain(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null;
  const text = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** Which of a write's columns are among a list: what a change of a row touches of the price. */
export function touched(inputs: readonly string[], values: Row | null | undefined): string[] {
  if (values === null || values === undefined) return [];
  return inputs.filter((column) => Object.prototype.hasOwnProperty.call(values, column));
}
