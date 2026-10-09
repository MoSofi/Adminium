// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A DOOR SAYS OF A PRICE — pure.
 *
 * A save, and a quote of one, answer which reductions an order has: one named
 * entry per reduction, in the reader's language. What an add-on answered line
 * by line is grouped here — a reduction on one line names the line; one spread
 * over several is one entry for the order, with their sum — and cut down to
 * what a reader may be told: a name, a kind, an amount, whether they typed it,
 * and for a voucher the last four characters of what was typed. Never an id,
 * a reason, or a whole code.
 */
import type { AdjustApplied } from '@adminium/add-on-contracts';
import { ratioText, toRatio } from '@adminium/manifest';

import { canonicalCode } from '../code-lookup.js';
import type { TreeWritten } from '../write-tree.js';
import { nameIn } from './listed.js';
import type { LoadedCode } from './load.js';
import type { AdjustedOrder } from './step.js';

export interface AppliedReply {
  /** Where the reduced line is; null for a reduction over several lines, or on the order itself. */
  line: string | null;
  name: string;
  kind: 'offer' | 'code' | 'voucher' | 'pack' | 'staff';
  amount: string;
  typed: boolean;
  codeLast4?: string;
}

export interface ToldReply {
  /** The column the code was typed into, as the reply names it. */
  column: string;
  note: 'better-offer-applied';
  name: string;
}

export { nameIn };

/** The shortest code whose last four are told: of anything shorter, four characters are the code. */
const LAST4_MIN = 8;


export interface AppliedSource {
  applied: readonly AdjustApplied[];
  told: readonly { typed: string; note: 'better-offer-applied'; name: string }[];
  codes: readonly Pick<LoadedCode, 'typed' | 'kind' | 'id'>[];
}

export interface AppliedOptions {
  locale: string;
  /** The decimals of the order's reduction. */
  places: number;
  /** A line's place as this reply names it (`order_lines/2`, `order_lines:41`), or null when it has none (the order itself). */
  lineOf(line: string): string | null;
  /** The column a typed code is named by, per typed value. */
  columnOf(typed: string): string;
}

/** The reductions of one priced order, as a reply carries them. */
export function appliedReply(source: AppliedSource, opts: AppliedOptions): { applied: AppliedReply[]; told: ToldReply[] } {
  const groups = new Map<string, { first: AdjustApplied; lines: Set<string>; sum: { n: bigint; d: bigint } }>();
  for (const entry of source.applied) {
    const id = JSON.stringify([entry.kind, entry.offer, entry.code, entry.voucher]);
    const amount = toRatio(entry.amount) ?? { n: 0n, d: 1n };
    const group = groups.get(id);
    if (group === undefined) groups.set(id, { first: entry, lines: new Set([entry.line]), sum: amount });
    else {
      group.lines.add(entry.line);
      group.sum = { n: group.sum.n * amount.d + amount.n * group.sum.d, d: group.sum.d * amount.d };
    }
  }
  const applied: AppliedReply[] = [];
  for (const { first, lines, sum } of groups.values()) {
    const [only] = lines;
    const typedAs = first.kind === 'voucher' || first.kind === 'pack' ? source.codes.find((code) => code.kind === 'voucher' && code.id !== null && code.id === first.voucher)?.typed : undefined;
    // (Of a code long enough that four characters are not most of it.)
    const canonical = typedAs === undefined ? '' : canonicalCode(typedAs);
    const last4 = canonical.length < LAST4_MIN ? undefined : canonical.slice(-4);
    applied.push({
      line: lines.size === 1 && only !== undefined ? opts.lineOf(only) : null,
      name: nameIn(first.name, opts.locale),
      kind: first.kind,
      amount: ratioText(sum, opts.places),
      typed: first.typed,
      ...(last4 === undefined || last4 === '' ? {} : { codeLast4: last4 }),
    });
  }
  return { applied, told: source.told.map((one) => ({ column: opts.columnOf(one.typed), note: one.note, name: one.name })) };
}

/** What a reply says of the price: the reductions, and a word beside a typed code that was not needed. */
export interface PriceAnswer {
  applied?: AppliedReply[];
  told?: ToldReply[];
  /** A save that gave money back: what was left to give, and what each payment may still be given. Staff only. */
  refund?: { refundable: string; taxRefundable?: string; payments: { key: string; took: string; givenBack: string; max: string }[] };
}

/**
 * The reply fields of a save, or a quote, in which a price was asked. A line
 * is named by its place in the request when the write was a row with the
 * rows below it (`order_lines/2`), else by its table and key
 * (`order_lines:41`); a typed code's column the same way. Nothing at all when
 * no price was asked. To a customer a reduction staff gave by hand has no
 * name (the page says its own word for one).
 */
export function priceAnswer(
  adjusted: readonly AdjustedOrder[] | undefined,
  opts: {
    locale: string;
    /** A table as this reader names it; null where they are told of no row but the ones they sent (a line then has no place: `null`). */
    nameOf(tableId: string): string | null;
    tree?: readonly TreeWritten[] | undefined;
    /** A customer is the reader: what staff took off by hand is told as such, never by the reason staff wrote beside it. */
    guest?: boolean | undefined;
  },
): PriceAnswer {
  if (adjusted === undefined || adjusted.length === 0) return {};
  const places = new Map<string, string>();
  for (const row of opts.tree ?? []) {
    if (row.node.at.length === 0) continue;
    const table = row.node.target.table;
    places.set(`${table.id}\u0000${table.primaryKey.map((column) => String(row.record[column])).join('/')}`, row.node.at.join('/'));
  }
  const applied: AppliedReply[] = [];
  const told: ToldReply[] = [];
  // Money given back moves no price: the save says what could be given, and nothing of reductions (the order's stand as they were).
  const back = adjusted.find((one) => one.refund !== undefined)?.refund;
  const priced = adjusted.filter((one) => one.refund === undefined);
  const refund = back === undefined || opts.guest === true ? {} : { refund: { refundable: back.refundable, ...(back.taxRefundable === undefined ? {} : { taxRefundable: back.taxRefundable }), payments: back.payments } };
  if (priced.length === 0) return refund;
  for (const one of priced) {
    const answer = appliedReply(one, {
      locale: opts.locale,
      places: one.places,
      lineOf: (line) => {
        const found = one.lines.find((candidate) => candidate.line === line);
        // The order is its own line: the reduction is the order's.
        if (found === undefined || found.table === one.table) return null;
        const place = places.get(`${found.table}\u0000${found.key}`);
        if (place !== undefined) return place;
        const named = opts.nameOf(found.table);
        return named === null ? null : `${named}:${found.key}`;
      },
      columnOf: (typed) => {
        const where = one.typed;
        if (where === undefined) return '';
        const key = where.rows.find((row) => row.typed === typed)?.key ?? null;
        const place = key === null ? undefined : places.get(`${where.table}\u0000${key}`);
        return place === undefined ? where.column : `${place}/${where.column}`;
      },
    });
    applied.push(...(opts.guest === true ? answer.applied.map((entry) => (entry.kind === 'staff' ? { ...entry, name: '' } : entry)) : answer.applied));
    told.push(...answer.told);
  }
  return { applied, ...(told.length === 0 ? {} : { told }), ...refund };
}
