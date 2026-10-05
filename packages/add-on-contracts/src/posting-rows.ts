// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `posting-rows@1` — the rows a ledger gains when a host row reaches a point.
 *
 * An add-on that keeps a ledger (stock, a card's value) provides this
 * contract once. Adminium calls `rows(input)` with everything the answer may
 * depend on — the source lines and their mapped inputs, the rows it read for
 * the action, the add-on's settings, the time — and writes what comes back
 * itself, inside the save that fired the point. The provider reads nothing,
 * writes nothing and keeps no clock: the same input gives the same output.
 *
 * The call is synchronous. A returned promise, a throw, an output over the
 * limits or a row outside the ledger's declared writes fails the save.
 */
import { z } from 'zod';

/** A value as it crosses the call: text, a number, a yes/no. Decimals travel as text. */
export type PostingScalar = string | number | boolean;
const scalar = z.union([z.string(), z.number(), z.boolean()]);

/** The most rows one answer may hold. */
export const POSTING_ROWS_MAX = 500;

export const POSTING_PHASES = ['reserve', 'post', 'reverse'] as const;
export type PostingPhase = (typeof POSTING_PHASES)[number];

/** Why the call is made: to name locks, to write, to answer a dry run, or to say what is left. */
export const POSTING_MODES = ['peek', 'save', 'dry', 'words'] as const;
export type PostingMode = (typeof POSTING_MODES)[number];

export const POSTING_ORIGINS = ['staff', 'public', 'system'] as const;
export type PostingOrigin = (typeof POSTING_ORIGINS)[number];

/** Why a provider refuses a line. Adminium maps each to what staff and the public are told. */
export const POSTING_REASONS = [
  'out-of-stock',
  'expired',
  'not-valid',
  'inactive',
  'void',
  'empty',
  'used-up',
  'over-limit',
  'needs-customer',
  'needs-batch',
  'refund-over',
  'not-allowed',
] as const;
export type PostingReason = (typeof POSTING_REASONS)[number];

/** What a provider tells staff about a line without refusing it. */
export const POSTING_NOTES = ['not-linked', 'short', 'batch-unknown', 'to-check', 'cost-to-check', 'no-supplier'] as const;
export type PostingNote = (typeof POSTING_NOTES)[number];

/** One use a price question recorded, handed to the posting that records uses. */
export interface PostingUse {
  offer: string | null;
  code: string | null;
  voucher: string | null;
  amount: string;
  units?: number;
  customer?: string;
}

export interface PostingLine {
  /** The line's key as text; `''` when the posting is for a whole row. */
  line: string;
  /** The line's table, in its stored form; `''` for a whole row. */
  lineTable: string;
  inputs: Record<string, PostingScalar | { table: string; row: string } | null>;
  multipliers: Record<string, number>;
  round: number;
}

export interface PostingInput {
  contract: 'posting-rows@1';
  ledger: string;
  action: string;
  posting: string;
  phase: PostingPhase;
  mode: PostingMode;
  origin: PostingOrigin;
  /** An ISO instant, and the venue's own date and zone. */
  now: string;
  today: string;
  zone: string;
  currency: string | null;
  /** The row whose point fired, its table in the stored form. */
  source: { table: string; row: string };
  /** At least one; one per source line of this call. */
  lines: PostingLine[];
  /** The action's declared reads, by name. Decimals are text. */
  reads: Record<string, Record<string, PostingScalar | null>[]>;
  /** The add-on's settings row. */
  settings: Record<string, PostingScalar | null>;
  /** What this round has written so far, by table: handed on a reverse, and on a post that follows a reserve. */
  written: Record<string, Record<string, PostingScalar | null>[]>;
  /** Only for the posting a host's price rule names as recording its uses. */
  uses?: PostingUse[];
  /** The add-on's installed version. */
  version: string;
}

export type PlannedRow =
  | { op: 'insert'; table: string; label?: string; line: string; values: Record<string, PostingScalar | { '@row': string } | null> }
  | { op: 'update'; table: string; line: string; key: Record<string, PostingScalar>; set: Record<string, PostingScalar | null> };

export interface PostingRefusal {
  line: string;
  reason: PostingReason;
  left?: string;
  item?: string;
}

export interface PostingWords {
  line: string;
  state: 'in' | 'low' | 'out';
  left?: string;
  exact?: string;
  after?: string;
  batch?: string;
  expires?: string;
  cause?: 'stock' | 'portions';
  /** The line that runs out first, and whether the batch it would take expires soon. */
  first?: { item: string; unit: string };
  soon?: boolean;
}

export interface PostingOutput {
  /** In insert order; at most `POSTING_ROWS_MAX`. */
  rows: PlannedRow[];
  /** Amounts Adminium asked the provider to decide, each within the bounds the action declares. */
  decides?: { line: string; input: string; value: string }[];
  /** Any refusal fails the save. Ignored on a reverse: what was written is always given back. */
  refusals?: PostingRefusal[];
  /** Told to staff; never a refusal. */
  notes?: { line: string; note: PostingNote; item?: string }[];
  /** Mode `words` only. */
  words?: PostingWords[];
}

/** What an add-on's server file exports under `rows`. Synchronous. */
export interface PostingRowsProvider {
  rows(input: PostingInput): PostingOutput;
}

// ── the shape Adminium checks before it reads an answer ──────────────────────

const decimalText = z.string().regex(/^-?\d+(\.\d+)?$/, 'a decimal as text');
const lineKey = z.string().max(64);

const plannedRowSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('insert'),
      table: z.string().min(1).max(64),
      label: z.string().min(1).max(64).optional(),
      line: lineKey,
      values: z.record(z.string(), z.union([scalar, z.null(), z.object({ '@row': z.string().min(1).max(64) }).strict()])),
    })
    .strict(),
  z
    .object({
      op: z.literal('update'),
      table: z.string().min(1).max(64),
      line: lineKey,
      key: z.record(z.string(), scalar).refine((key) => Object.keys(key).length >= 1, { message: 'an update names the row by its key' }),
      set: z.record(z.string(), z.union([scalar, z.null()])).refine((set) => Object.keys(set).length >= 1, { message: 'an update sets a column' }),
    })
    .strict(),
]);

export const postingOutputSchema = z
  .object({
    rows: z.array(plannedRowSchema).max(POSTING_ROWS_MAX),
    decides: z.array(z.object({ line: lineKey, input: z.string().min(1).max(40), value: decimalText }).strict()).max(POSTING_ROWS_MAX).optional(),
    refusals: z
      .array(z.object({ line: lineKey, reason: z.enum(POSTING_REASONS), left: decimalText.optional(), item: z.string().max(200).optional() }).strict())
      .max(POSTING_ROWS_MAX)
      .optional(),
    notes: z.array(z.object({ line: lineKey, note: z.enum(POSTING_NOTES), item: z.string().max(200).optional() }).strict()).max(POSTING_ROWS_MAX).optional(),
    words: z
      .array(
        z
          .object({
            line: lineKey,
            state: z.enum(['in', 'low', 'out']),
            left: decimalText.optional(),
            exact: decimalText.optional(),
            after: decimalText.optional(),
            batch: z.string().max(120).optional(),
            expires: z.string().max(40).optional(),
            cause: z.enum(['stock', 'portions']).optional(),
            first: z.object({ item: z.string().max(200), unit: z.string().max(40) }).strict().optional(),
            soon: z.boolean().optional(),
          })
          .strict(),
      )
      .max(POSTING_ROWS_MAX)
      .optional(),
  })
  .strict();

/** What a ledger lets its provider write, as the manifest declares it: per table, the columns of an insert and of an update. */
export interface PostingWriteScope {
  insert?: readonly string[] | undefined;
  update?: { by: readonly string[]; set: readonly string[] } | undefined;
}

/**
 * Every row of an answer that is outside what the ledger declares: a table
 * it does not write, a column it does not list, an update keyed by other
 * columns. Adminium runs the same check before the first write.
 */
export function rowsOutsideWrites(output: PostingOutput, writes: Readonly<Record<string, PostingWriteScope>>): string[] {
  const out: string[] = [];
  output.rows.forEach((row, i) => {
    const scope = writes[row.table];
    if (scope === undefined) {
      out.push(`rows.${String(i)}: "${row.table}" is not a table the ledger writes`);
      return;
    }
    if (row.op === 'insert') {
      if (scope.insert === undefined) out.push(`rows.${String(i)}: "${row.table}" takes no insert`);
      else for (const column of Object.keys(row.values)) if (!scope.insert.includes(column)) out.push(`rows.${String(i)}: "${row.table}.${column}" is not a column an insert may give`);
      return;
    }
    if (scope.update === undefined) {
      out.push(`rows.${String(i)}: "${row.table}" takes no update`);
      return;
    }
    const by = [...scope.update.by].sort().join(',');
    if (Object.keys(row.key).sort().join(',') !== by) out.push(`rows.${String(i)}: a row of "${row.table}" is named by ${by}`);
    for (const column of Object.keys(row.set)) if (!scope.update.set.includes(column)) out.push(`rows.${String(i)}: "${row.table}.${column}" is not a column an update may set`);
  });
  return out;
}
