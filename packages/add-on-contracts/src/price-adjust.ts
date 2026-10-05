// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `price-adjust@1` — what an order's lines are reduced by.
 *
 * An add-on that keeps offers, discount codes and vouchers provides this
 * contract once. Adminium calls `adjust(input)` with the order's lines, the
 * codes typed on it (each already looked up), who is buying when that was
 * proved, what staff took off by hand, and the offers it read; and writes
 * what comes back itself — one reduction per line, the rows that say what was
 * applied — inside the save.
 *
 * The provider reads nothing, writes nothing and keeps no clock: `now`,
 * `today`, `weekday`, `time` and `zone` are inputs. The same input gives the
 * same output. The call is synchronous.
 */
import { z } from 'zod';

import type { PostingScalar, PostingUse } from './posting-rows.js';

/** The most lines, typed codes and offers one question carries. */
export const ADJUST_LINES_MAX = 200;
export const ADJUST_CODES_MAX = 12;
export const ADJUST_OFFERS_MAX = 500;

/** `save` and `dry` price an order; `try` is staff's preview of an offer not yet saved; `refund` prices the lines kept. */
export const ADJUST_MODES = ['save', 'dry', 'try', 'refund'] as const;
export type AdjustMode = (typeof ADJUST_MODES)[number];

/** Why a typed code, or a reduction staff gave, is refused. Adminium decides what the public is told of each. */
export const ADJUST_REASONS = [
  'unknown',
  'used-up',
  'needs-minimum',
  'not-for-these-items',
  'needs-sign-in',
  'needs-customer',
  'over-ceiling',
  'expired',
  'inactive',
  'void',
  'not-yet',
  'over-limit',
] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

/** The reasons a guest is told by name; every other reason leaves as `unknown`. */
export const ADJUST_PUBLIC_REASONS = ['unknown', 'used-up', 'needs-minimum', 'not-for-these-items', 'needs-sign-in'] as const;

/** Why an offer did not apply, in staff's "why not" view. */
export const ADJUST_EXPLAIN_REASONS = [
  ...ADJUST_REASONS,
  'not-combinable',
  'outside-hours',
  'outside-days',
  'needs-quantity',
  'not-in-group',
  'not-first-order',
  'ended',
  'paused',
  'draft',
  'no-code-typed',
] as const;
export type ExplainReason = (typeof ADJUST_EXPLAIN_REASONS)[number];

export const ADJUST_KINDS = ['offer', 'code', 'voucher', 'pack', 'staff'] as const;
export type AdjustKind = (typeof ADJUST_KINDS)[number];

export interface AdjustLine {
  /** The line's key as text; the order's own key for a line that is the order itself. */
  key: string;
  /** Which line part of the host's rule the line belongs to, and its place in it. */
  part: number;
  index: number;
  /** Decimals as text, at `AdjustInput.scale`. `amount` is price × quantity. */
  price: string;
  quantity: string;
  amount: string;
  /** What the line sells, each as a table's stored name and a row's key. */
  what: { as: 'item' | 'category' | 'type' | 'tag'; table: string; row: string }[];
  /** No offer reduces it (a gift card being loaded). */
  excluded: boolean;
  /** The code that pays for the line, or null. */
  paidBy: string | null;
  /** False for a line being returned (mode `refund`). */
  kept: boolean;
  /** A stay's nights, each with its own price. */
  nights?: { date: string; price: string }[];
}

export interface AdjustCode {
  /** As the customer typed it. */
  typed: string;
  /** Which of the add-on's tables the row came from; null when no row was found. */
  kind: 'code' | 'voucher' | null;
  row: Record<string, PostingScalar | null> | null;
}

/** One use of an offer, a code or a voucher, recorded once where the order is posted. */
export type AdjustUse = PostingUse;

export interface AdjustInput {
  contract: 'price-adjust@1';
  mode: AdjustMode;
  /** `line`: a line was written; `post`: the order reached its posting point, and uses are reported. */
  point: 'line' | 'post';
  origin: 'staff' | 'public' | 'system';
  now: string;
  today: string;
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  time: string;
  zone: string;
  currency: string | null;
  /** The decimals of every amount. */
  scale: number;
  locale: string;
  lines: AdjustLine[];
  /** In the order typed. */
  codes: AdjustCode[];
  /** The buyer, when their identity was proved: a keyed hash, never an address. */
  customer: { key: string; groups: string[]; orders: number; uses: Record<string, number> } | null;
  /** True when no identity was proved. */
  guest: boolean;
  /** What staff took off by hand, with the ceiling Adminium read for whoever gave it. */
  staff: { kind: 'percent' | 'amount' | 'comp'; value: string; reason: string | null; ceiling: { percent: string; amount: string } | null; judge: boolean } | null;
  /** The adjuster's declared reads, by name. */
  offers: Record<string, Record<string, PostingScalar | null>[]>;
  /** The add-on's settings row. */
  settings: Record<string, PostingScalar | null>;
  /** The rows the order's own open round holds, so its own held use is not counted against it. */
  held?: Record<string, Record<string, PostingScalar | null>[]>;
  /** Mode `try` only: an offer not saved yet, considered with the stored ones. */
  draft?: Record<string, PostingScalar | null>;
  /** Whether to say, for every offer, whether it applies and why not. */
  explain: boolean;
  /** The add-on's installed version. */
  version: string;
}

export interface AdjustApplied {
  /** The line it reduces. */
  line: string;
  offer: string | null;
  code: string | null;
  voucher: string | null;
  /** What it is called: per locale, or one string. */
  name: Record<string, string> | string;
  kind: AdjustKind;
  amount: string;
  /** Whether the customer typed it. */
  typed: boolean;
  reason?: string;
}

export interface AdjustOutput {
  /** One entry for every line of the input, and no other: its reduction, as text, zero or more. */
  lines: { key: string; discount: string }[];
  /** The sum of the lines'. */
  order: { discount: string };
  applied: AdjustApplied[];
  /** Point `post` only. */
  uses: AdjustUse[];
  refused: { typed: string; reason: AdjustReason; params?: { amount?: string; max?: string; name?: string } }[];
  /** Said beside a typed code that was not needed. */
  told?: { typed: string; note: 'better-offer-applied'; name: string }[];
  /** With `explain`: every offer handed in (or `draft`). */
  explain?: { offer: string; applies: boolean; reason?: ExplainReason; amount?: string }[];
}

/** What an add-on's server file exports under `adjust`. Synchronous. */
export interface PriceAdjustProvider {
  adjust(input: AdjustInput): AdjustOutput;
}

// ── the shape Adminium checks before it reads an answer ──────────────────────

const amount = z.string().regex(/^\d+(\.\d+)?$/, 'an amount as text, zero or more');
const id = z.string().min(1).max(64);

export const adjustOutputSchema = z
  .object({
    lines: z.array(z.object({ key: z.string().max(64), discount: amount }).strict()).max(ADJUST_LINES_MAX),
    order: z.object({ discount: amount }).strict(),
    applied: z
      .array(
        z
          .object({
            line: z.string().max(64),
            offer: id.nullable(),
            code: id.nullable(),
            voucher: id.nullable(),
            name: z.union([z.string().max(200), z.record(z.string(), z.string().max(200))]),
            kind: z.enum(ADJUST_KINDS),
            amount,
            typed: z.boolean(),
            reason: z.string().max(200).optional(),
          })
          .strict(),
      )
      .max(ADJUST_LINES_MAX * 4),
    uses: z.array(z.object({ offer: id.nullable(), code: id.nullable(), voucher: id.nullable(), amount, units: z.number().int().min(0).optional(), customer: z.string().max(64).optional() }).strict()).max(ADJUST_OFFERS_MAX),
    refused: z
      .array(z.object({ typed: z.string().max(64), reason: z.enum(ADJUST_REASONS), params: z.object({ amount: amount.optional(), max: amount.optional(), name: z.string().max(200).optional() }).strict().optional() }).strict())
      .max(ADJUST_CODES_MAX + 1),
    told: z.array(z.object({ typed: z.string().max(64), note: z.literal('better-offer-applied'), name: z.string().max(200) }).strict()).max(ADJUST_CODES_MAX).optional(),
    explain: z.array(z.object({ offer: id, applies: z.boolean(), reason: z.enum(ADJUST_EXPLAIN_REASONS).optional(), amount: amount.optional() }).strict()).max(ADJUST_OFFERS_MAX + 1).optional(),
  })
  .strict();

/** An amount as a whole number of the smallest unit at `scale`, so sums are exact. */
function units(text: string, scale: number): bigint {
  const [whole = '0', fraction = ''] = text.split('.');
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt((fraction + '0'.repeat(scale)).slice(0, scale) || '0');
}

/**
 * What is wrong with an answer for this input, beyond its shape: a line
 * missing or invented, a reduction larger than its line or finer than the
 * scale, an excluded line reduced, an order total that is not the lines'
 * sum, uses reported where none are due, a reason a guest is never told.
 * Adminium runs the same check before it writes.
 */
export function adjustAnswerIssues(input: AdjustInput, output: AdjustOutput): string[] {
  const out: string[] = [];
  const wanted = new Map(input.lines.map((line) => [line.key, line]));
  const seen = new Set<string>();
  let sum = 0n;
  for (const [i, line] of output.lines.entries()) {
    const asked = wanted.get(line.key);
    if (asked === undefined) {
      out.push(`lines.${String(i)}: "${line.key}" is not a line of the question`);
      continue;
    }
    if (seen.has(line.key)) out.push(`lines.${String(i)}: "${line.key}" is answered twice`);
    seen.add(line.key);
    if ((line.discount.split('.')[1] ?? '').length > input.scale) out.push(`lines.${String(i)}: "${line.discount}" is finer than the order's ${String(input.scale)} decimals`);
    const reduction = units(line.discount, input.scale);
    if (reduction > units(asked.amount, input.scale)) out.push(`lines.${String(i)}: a reduction of ${line.discount} is more than the line's ${asked.amount}`);
    if (asked.excluded && reduction !== 0n) out.push(`lines.${String(i)}: "${line.key}" is excluded, so nothing reduces it`);
    sum += reduction;
  }
  for (const key of wanted.keys()) if (!seen.has(key)) out.push(`lines: the line "${key}" has no answer`);
  if (units(output.order.discount, input.scale) !== sum) out.push(`order.discount: ${output.order.discount} is not the sum of the lines' reductions`);
  if (input.point !== 'post' && output.uses.length > 0) out.push('uses: uses are reported only where the order is posted');
  for (const [i, applied] of output.applied.entries()) {
    if (!wanted.has(applied.line)) out.push(`applied.${String(i)}: "${applied.line}" is not a line of the question`);
    if (applied.kind === 'staff' && input.staff === null) out.push(`applied.${String(i)}: staff took nothing off this order`);
  }
  for (const [i, refused] of output.refused.entries()) {
    if (refused.reason === 'over-ceiling' && input.staff === null) out.push(`refused.${String(i)}: "over-ceiling" is said of a reduction staff gave, and there is none`);
    if (refused.reason === 'needs-sign-in' && !input.guest) out.push(`refused.${String(i)}: "needs-sign-in" is said to a guest, and this customer is known`);
    if (refused.reason === 'needs-customer' && input.origin !== 'staff') out.push(`refused.${String(i)}: "needs-customer" is said to staff`);
  }
  if (input.explain && output.explain === undefined) out.push('explain: the question asked why each offer applies or not');
  return out;
}
