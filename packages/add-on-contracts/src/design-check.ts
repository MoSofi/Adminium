// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `design-check@1` — whether a shopper's design may be ordered as it is.
 *
 * An add-on that keeps designs (what a shopper typed, chose and uploaded on a
 * ready-made design and a base) provides this contract once. Adminium asks it
 * inside every save of an order line that names a design, and inside the dry
 * run, with each such line's design row, the rows the add-on declared it
 * reads for one (its ready-made design, that design's parts, the base, its
 * areas, its priced features), the features the line pays for, and what is
 * known of each file the design holds. The add-on answers, for every line,
 * whether the design stands, which priced features it uses, and why it does
 * not when it does not.
 *
 * Adminium checks the answer itself: every line answered once, the features
 * used equal to the features paid (a logo needs "Add a logo"; "Add a logo"
 * needs a logo), and any refusal refuses the save. Nothing is taken on trust.
 *
 * The provider reads nothing, writes nothing and keeps no clock, and it has
 * no fonts: a rule about how much text fits is arithmetic on declared sizes.
 * The same input gives the same output. The call is synchronous.
 */
import { z } from 'zod';

import type { PostingScalar } from './posting-rows.js';

/** The most lines one question carries, and the most rows Adminium reads for one line's design. */
export const CHECK_LINES_MAX = 200;
export const CHECK_ROWS_MAX = 400;
/** The most reads an add-on declares, and the most files one design hands in. */
export const CHECK_READS_MAX = 8;
export const CHECK_FILES_MAX = 24;
/** The most feature codes one line pays for or one design uses. */
export const CHECK_FEATURES_MAX = 32;

/** `save` checks a design being ordered; `dry` checks it for a quote, the same way. */
export const CHECK_MODES = ['save', 'dry'] as const;
export type CheckMode = (typeof CHECK_MODES)[number];

/** Why a design does not stand, as the add-on says it. Adminium decides what each is called, in every language. */
export const CHECK_REASONS = [
  'too-long',
  'required-empty',
  'font-not-allowed',
  'size-out-of-range',
  'colour-not-allowed',
  'choice-not-allowed',
  'part-locked',
  'file-missing',
  'file-kind',
  'design-unknown',
  'format-unknown',
] as const;
export type CheckReason = (typeof CHECK_REASONS)[number];

/**
 * Why Adminium itself refuses a line with a design: a feature used and not
 * paid for, one paid for and not used, one paid twice, a design that reads
 * more rows than a check may, an add-on that cannot be asked, an answer that
 * is not one.
 */
export const CHECK_HOST_REASONS = ['feature-not-paid', 'feature-not-used', 'feature-paid-twice', 'design-too-large', 'check-unavailable', 'check-failed'] as const;
export type CheckHostReason = (typeof CHECK_HOST_REASONS)[number];

type Scalar = PostingScalar | null;

/** One file the design holds, as Adminium knows it: never its bytes. */
export interface CheckFile {
  /** The design's column that holds it. */
  column: string;
  /** Its type, as stored (`image/png`, `application/pdf`); empty when the file is not there. */
  kind: string;
  /** Its size in bytes; 0 when the file is not there. */
  size: number;
}

export interface CheckLine {
  /** The line's key as text. */
  key: string;
  /** The design row the line names, as stored. */
  design: Record<string, Scalar>;
  /** The rows each of the add-on's declared reads found for this design, by the read's id. */
  rows: Record<string, Record<string, Scalar>[]>;
  /** The feature codes the line pays for, each once, sorted. */
  paid: string[];
  files: CheckFile[];
}

export interface CheckInput {
  contract: 'design-check@1';
  mode: CheckMode;
  lines: CheckLine[];
  /** The add-on's settings row. */
  settings: Record<string, Scalar>;
  /** The add-on's installed version. */
  version: string;
}

export interface CheckRefusal {
  /** The part of the design it is about (a ready-made design's part, a base's area), when it is about one. */
  part?: string;
  reason: CheckReason;
}

export interface CheckAnswer {
  key: string;
  ok: boolean;
  /** The feature codes the design uses, each once. */
  used: string[];
  refusals: CheckRefusal[];
}

export interface CheckOutput {
  /** One entry for every line of the input, and no other. */
  lines: CheckAnswer[];
}

/** What an add-on's server file exports under `check`. Synchronous. */
export interface DesignCheckProvider {
  check(input: CheckInput): CheckOutput;
}

// ── the shape Adminium checks before it reads an answer ──────────────────────

/** A feature code, and a part's name: short words a page can show and a log can keep. */
const word = z.string().min(1).max(64);

export const checkOutputSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            key: z.string().max(64),
            ok: z.boolean(),
            used: z.array(word).max(CHECK_FEATURES_MAX),
            refusals: z.array(z.object({ part: word.optional(), reason: z.enum(CHECK_REASONS) }).strict()).max(64),
          })
          .strict(),
      )
      .max(CHECK_LINES_MAX),
  })
  .strict();

/**
 * What is wrong with an answer for this input, beyond its shape: a line
 * missing, invented or answered twice, a feature named twice, a design said
 * to stand with refusals, or said not to stand with none. Adminium runs the
 * same check before it reads an answer; the features' match to what was paid
 * is judged after, as a refusal of the line, not as a fault of the answer.
 */
export function checkAnswerIssues(input: CheckInput, output: CheckOutput): string[] {
  const out: string[] = [];
  const wanted = new Set(input.lines.map((line) => line.key));
  const seen = new Set<string>();
  for (const [i, line] of output.lines.entries()) {
    if (!wanted.has(line.key)) out.push(`lines.${String(i)}: "${line.key}" is not a line of the question`);
    else if (seen.has(line.key)) out.push(`lines.${String(i)}: "${line.key}" is answered twice`);
    seen.add(line.key);
    if (new Set(line.used).size !== line.used.length) out.push(`lines.${String(i)}.used: a feature is named twice`);
    if (line.ok && line.refusals.length > 0) out.push(`lines.${String(i)}: a design that stands has no refusals`);
    if (!line.ok && line.refusals.length === 0) out.push(`lines.${String(i)}: a design that does not stand says why`);
  }
  for (const key of wanted) if (!seen.has(key)) out.push(`lines: the line "${key}" has no answer`);
  return out;
}

/**
 * Adminium's own refusals of an answered line: the features the design uses
 * against the features the line pays for, as sets — a feature used and not
 * paid for, one paid for and not used. A code paid for twice is told apart
 * before the question is asked.
 */
export function featureRefusals(paid: readonly string[], used: readonly string[]): { feature: string; reason: 'feature-not-paid' | 'feature-not-used' }[] {
  const has = new Set(paid);
  const uses = new Set(used);
  return [...[...uses].filter((code) => !has.has(code)).map((feature) => ({ feature, reason: 'feature-not-paid' as const })), ...[...has].filter((code) => !uses.has(code)).map((feature) => ({ feature, reason: 'feature-not-used' as const }))];
}
