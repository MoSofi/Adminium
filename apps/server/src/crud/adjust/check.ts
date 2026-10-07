// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ANSWER IS CHECKED BEFORE IT IS WRITTEN — pure.
 *
 * An add-on's code says by how much each line of an order is reduced. What it
 * says becomes money, so nothing of it is taken on trust. Beyond the shape
 * and what the contract's own check holds every answer to (one reduction a
 * line, never more than the line, an order total that is the lines' sum),
 * Adminium holds it to what only Adminium knows:
 *
 *  - every offer, code and voucher it names is a row READ FOR THIS CALL — an
 *    answer cannot spend a code nobody typed;
 *  - what it says was applied to a line adds up to that line's reduction;
 *  - what staff took off by hand is no more than the stored reduction comes
 *    to, and — in the save that gives it — no more than its giver may give;
 *  - a use is for the customer handed in, and for nobody else;
 *  - a refusal is about a code that was typed, and is one this caller can be
 *    given at all.
 *
 * One miss and the save is refused: nothing was written yet.
 */
import { adjustAnswerIssues, type AdjustInput, type AdjustOutput } from '@adminium/add-on-contracts';

/** What was read for the call an answer is checked against. */
export interface AdjustLoaded {
  /** The keys of the offer rows handed in (the rows of the add-on's first read's table). */
  offers: ReadonlySet<string>;
  /** The keys of the code rows and of the voucher rows the typed codes found. */
  codes: ReadonlySet<string>;
  vouchers: ReadonlySet<string>;
}

/** An amount as a whole number of the smallest unit at `scale`. */
function units(text: string, scale: number): bigint {
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const value = BigInt(whole || '0') * 10n ** BigInt(scale) + BigInt((fraction + '0'.repeat(scale)).slice(0, scale) || '0');
  return negative ? -value : value;
}

/** The longest an amount is written: longer text is no amount, and is never worked with. */
const AMOUNT_MAX = 32;

/** A percent of an amount, rounded UP to the unit: a bound, never a price. */
function percentUp(base: bigint, percent: string): bigint {
  const hundredths = units(percent, 2);
  return (base * hundredths + 9999n) / 10000n;
}

/**
 * What is wrong with an answer for this question, or null. The contract's own
 * check first, then what the rows read for the call say.
 */
export function checkAdjust(input: AdjustInput, output: AdjustOutput, loaded: AdjustLoaded): string | null {
  // Before any figure is worked with: an amount written longer than any amount is.
  const amounts = [output.order.discount, ...output.lines.map((line) => line.discount), ...output.applied.map((entry) => entry.amount), ...output.uses.map((use) => use.amount)];
  if (amounts.some((text) => text.length > AMOUNT_MAX)) return `an amount is written with more than ${String(AMOUNT_MAX)} characters`;
  const own = adjustAnswerIssues(input, output);
  if (own.length > 0) return own[0]!;
  const { scale } = input;
  const finer = (text: string): boolean => (text.split('.')[1] ?? '').length > scale;
  if (finer(output.order.discount)) return `order.discount: "${output.order.discount}" is finer than the order's ${String(scale)} decimals`;

  // What was applied names rows read for this call, and adds up, line by line, to the line's reduction.
  const perLine = new Map<string, bigint>();
  const once = new Set<string>();
  let staff = 0n;
  for (const [i, applied] of output.applied.entries()) {
    // One entry a line for each thing applied: two of one name would be kept as one row, and the rows would not add up.
    const name = [applied.line, applied.kind, applied.offer ?? '', applied.code ?? '', applied.voucher ?? ''].join('\u0000');
    if (once.has(name)) return `applied.${String(i)}: the same reduction is applied to "${applied.line}" twice`;
    once.add(name);
    // What is applied names what it is: an offer its offer, a code its code, a voucher or a pack its voucher.
    const named = applied.kind === 'offer' ? applied.offer : applied.kind === 'code' ? applied.code : applied.kind === 'staff' ? '' : applied.voucher;
    if (named === null) return `applied.${String(i)}: a reduction of kind "${applied.kind}" names no ${applied.kind === 'pack' ? 'voucher' : applied.kind}`;
    if (finer(applied.amount)) return `applied.${String(i)}: "${applied.amount}" is finer than the order's ${String(scale)} decimals`;
    const amount = units(applied.amount, scale);
    perLine.set(applied.line, (perLine.get(applied.line) ?? 0n) + amount);
    // An offer not saved yet, tried beside the stored ones, is named `draft`.
    if (applied.offer !== null && !loaded.offers.has(applied.offer) && !(applied.offer === 'draft' && input.draft !== undefined)) return `applied.${String(i)}: the offer "${applied.offer}" was not read for this order`;
    if (applied.code !== null && !loaded.codes.has(applied.code)) return `applied.${String(i)}: the code "${applied.code}" was not typed on this order`;
    if (applied.voucher !== null && !loaded.vouchers.has(applied.voucher)) return `applied.${String(i)}: the voucher "${applied.voucher}" was not typed on this order`;
    if (applied.kind === 'staff') {
      if (applied.offer !== null || applied.code !== null || applied.voucher !== null) return `applied.${String(i)}: a reduction staff gave names no offer, code or voucher`;
      staff += amount;
    }
  }
  for (const line of output.lines) {
    if ((perLine.get(line.key) ?? 0n) !== units(line.discount, scale)) return `lines: "${line.key}" is reduced by ${line.discount}, and what was applied to it does not add up to that`;
  }

  // What staff took off by hand: no more than the stored reduction comes to, and no more than its giver may give.
  if (staff > 0n) {
    const given = input.staff!;
    const goods = input.lines.filter((line) => line.kept && !line.excluded);
    const base = goods.reduce((sum, line) => sum + units(line.amount, scale), 0n);
    // A percent may be rounded line by line: one unit a line is let through.
    const slack = BigInt(goods.length);
    const allowed = (kind: string, value: string): bigint => (kind === 'amount' ? units(value, scale) : percentUp(base, kind === 'comp' ? '100' : value) + slack);
    if (staff > allowed(given.kind, given.value)) return `applied: staff took ${given.value} ${given.kind} off, and the answer applies more than that comes to`;
    if (given.judge && given.ceiling !== null) {
      // A percent is held to the giver's percent, and to their amount when they have one; an amount to their amount — and to what their
      // percent comes to when they have none (a role allowed ten percent is not allowed any sum).
      const byAmount = given.ceiling.amount === null || given.ceiling.amount === undefined ? null : units(given.ceiling.amount, scale);
      const byPercent = given.kind === 'amount' && byAmount !== null ? null : percentUp(base, given.ceiling.percent) + slack;
      if ((byPercent !== null && staff > byPercent) || (byAmount !== null && staff > byAmount)) return 'applied: the reduction staff gave is more than its giver may give, and the answer did not say so';
    }
  }

  // A use names rows read for this call, counts at least one, and is for the customer handed in.
  for (const [i, use] of output.uses.entries()) {
    if (finer(use.amount)) return `uses.${String(i)}: "${use.amount}" is finer than the order's ${String(scale)} decimals`;
    if (use.offer !== null && !loaded.offers.has(use.offer)) return `uses.${String(i)}: the offer "${use.offer}" was not read for this order`;
    if (use.code !== null && !loaded.codes.has(use.code)) return `uses.${String(i)}: the code "${use.code}" was not typed on this order`;
    if (use.voucher !== null && !loaded.vouchers.has(use.voucher)) return `uses.${String(i)}: the voucher "${use.voucher}" was not typed on this order`;
    if (use.units !== undefined && use.units < 1) return `uses.${String(i)}: a use counts one unit at least`;
    if (use.customer !== undefined && use.customer !== input.customer?.key) return `uses.${String(i)}: the use is for a customer other than the one handed in`;
  }

  // A refusal, and a word beside a code, is about a code that was typed — but the one about what staff gave, which names none.
  const typed = new Set(input.codes.map((code) => code.typed));
  for (const [i, refused] of output.refused.entries()) {
    if (refused.reason === 'over-ceiling') {
      if (input.staff === null || !input.staff.judge) return `refused.${String(i)}: "over-ceiling" is said in the save that gives a reduction, and this is not one`;
      if (refused.typed !== '') return `refused.${String(i)}: "over-ceiling" names no code`;
      continue;
    }
    if (!typed.has(refused.typed)) return `refused.${String(i)}: "${refused.typed}" was not typed on this order`;
    if (refused.reason === 'needs-customer' && input.customer !== null) return `refused.${String(i)}: "needs-customer" is said when nobody is named, and this order names its customer`;
  }
  for (const [i, told] of (output.told ?? []).entries()) {
    if (!typed.has(told.typed)) return `told.${String(i)}: "${told.typed}" was not typed on this order`;
  }

  // Why each offer applies or not: said only when asked, and then of every offer handed in.
  if (!input.explain && output.explain !== undefined) return 'explain: nobody asked why';
  if (input.explain) {
    const said = new Set((output.explain ?? []).map((entry) => entry.offer));
    for (const offer of loaded.offers) if (!said.has(offer)) return `explain: nothing is said of the offer "${offer}"`;
    if (input.draft !== undefined && !said.has('draft') && ![...said].some((offer) => String(input.draft?.['id'] ?? '') === offer)) return 'explain: nothing is said of the offer being tried';
  }
  return null;
}
