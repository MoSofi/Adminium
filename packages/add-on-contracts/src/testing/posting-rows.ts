// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `posting-rows@1` conformance suite.
 *
 * Run by each add-on's own tests against its provider and its own case
 * table, and by Adminium against its test ledger. A case is an input and
 * what the answer must hold; the suite adds what every provider owes whatever
 * its cases say:
 *
 *  - an answer of the declared shape, given at once (never a promise);
 *  - rows inside what the ledger declares it writes;
 *  - the same answer for the same input, asked twice and asked again under
 *    another wall clock: the time is an input, and nothing is left to chance;
 *  - a peek that answers as the save does;
 *  - a reverse that never refuses, and that gives back what was written:
 *    every column the ledger sums comes to zero over a round;
 *  - a built file that reaches for no module, no process, no clock and no
 *    network.
 *
 * The checks are plain functions that answer what is wrong, in words;
 * {@link postingRowsConformance} registers them as tests.
 */
import { describe, expect, it } from 'vitest';

import {
  postingOutputSchema,
  rowsOutsideWrites,
  type PostingInput,
  type PostingOutput,
  type PostingRefusal,
  type PostingRowsProvider,
  type PostingScalar,
  type PostingWriteScope,
} from '../posting-rows.js';

export interface PostingRowsCase {
  name: string;
  input: PostingInput;
  /** What the answer must hold: its rows in order (a subset of each row's keys), or its refusals. */
  expect: { rows?: readonly Record<string, unknown>[]; refusals?: readonly Partial<PostingRefusal>[] };
}

export interface PostingRowsLedger {
  /** The tables and columns the provider may write. */
  writes: Readonly<Record<string, PostingWriteScope>>;
  /** Per table, the decimal columns that add up to a balance: over a round and its reverse each comes to zero. */
  sums?: Readonly<Record<string, readonly string[]>> | undefined;
}

export interface PostingRowsConformanceOptions {
  /** Each ledger the provider serves, by id. */
  ledgers: Readonly<Record<string, PostingRowsLedger>>;
  cases: readonly PostingRowsCase[];
  /** The text of the built file the add-on ships (`provides[].server`), when the tests can read it. */
  source?: string | undefined;
}

/** What a built deciding file may not name, and why. */
const FORBIDDEN: readonly [RegExp, string][] = [
  [/\brequire\s*\(/, 'it calls require(): the file is one script with everything inlined'],
  [/\bimport\s*\(/, 'it calls import(): the file is one script with everything inlined'],
  [/^\s*import\s[^;]*?from\s*['"]/m, 'it has an import statement: the file is a classic script, not a module'],
  [/^\s*export\s/m, 'it has an export statement: it assigns module.exports'],
  [/\bprocess\s*\./, 'it reads process: there is none where it runs'],
  [/\bnew\s+Date\b|\bDate\s*\.\s*now\b|\bglobalThis\s*\.\s*Date\b/, 'it reads the clock: the time is an input (now, today, zone)'],
  [/\bMath\s*\.\s*random\b/, 'it asks for a random number: the same input must give the same answer'],
  [/\bfetch\s*\(/, 'it calls fetch(): there is no network where it runs'],
];

/** Everything wrong with the built file's text. */
export function postingSourceIssues(source: string): string[] {
  return FORBIDDEN.filter(([pattern]) => pattern.test(source)).map(([, why]) => why);
}

/** A decimal written as text, as a whole number of the smallest step both hold. */
function scaled(text: string, places: number): bigint {
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const value = BigInt(whole + fraction.padEnd(places, '0'));
  return negative ? -value : value;
}

/** The sum of decimals written as text; null when one is not a decimal. */
function sumOf(values: readonly unknown[]): bigint | null {
  const texts = values.map((value) => (typeof value === 'number' ? String(value) : value));
  if (!texts.every((value): value is string => typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value))) return null;
  const places = Math.max(0, ...texts.map((text) => (text.split('.')[1] ?? '').length));
  return texts.reduce((sum, text) => sum + scaled(text, places), 0n);
}

/** Runs `run` with a wall clock that says something else on every reading. */
function underAnotherClock<T>(start: number, run: () => T): T {
  const RealDate = Date;
  let ticks = 0;
  const reading = (): number => start + (ticks += 1) * 86_400_000;
  class OtherDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(reading());
      else super(...(args as [number]));
    }
    static override now(): number {
      return reading();
    }
  }
  globalThis.Date = OtherDate as DateConstructor;
  try {
    return run();
  } finally {
    globalThis.Date = RealDate;
  }
}

/** The answer to one input, and why it is no answer when it is none. */
function ask(provider: PostingRowsProvider, input: PostingInput): { output: PostingOutput } | { problem: string } {
  let output: unknown;
  try {
    output = provider.rows(structuredClone(input));
  } catch (error) {
    return { problem: `it threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (output !== null && typeof output === 'object' && typeof (output as { then?: unknown }).then === 'function') {
    return { problem: 'it answered with a promise: the call is synchronous' };
  }
  const parsed = postingOutputSchema.safeParse(output);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { problem: `the answer is not of the declared shape: ${(first?.path ?? []).join('.')}: ${first?.message ?? ''}` };
  }
  return { output: parsed.data as PostingOutput };
}

/** What a round wrote, as the engine hands it back on a reverse: each inserted row, with a key of its own. */
function writtenBy(output: PostingOutput): Record<string, Record<string, PostingScalar | null>[]> {
  const written: Record<string, Record<string, PostingScalar | null>[]> = {};
  for (const row of output.rows) {
    if (row.op !== 'insert') continue;
    const list = (written[row.table] ??= []);
    const values: Record<string, PostingScalar | null> = { id: list.length + 1 };
    for (const [column, value] of Object.entries(row.values)) values[column] = value !== null && typeof value === 'object' ? null : value;
    list.push(values);
  }
  return written;
}

/**
 * Everything one case shows wrong with a provider, in words; empty when it
 * holds. Pure: it registers no test, so a suite can be tried on a provider
 * that is wrong on purpose.
 */
export function postingCaseIssues(provider: PostingRowsProvider, options: Pick<PostingRowsConformanceOptions, 'ledgers'>, one: PostingRowsCase): string[] {
  const issues: string[] = [];
  if (typeof (provider as Partial<PostingRowsProvider>).rows !== 'function') return ['the provider has no `rows`'];
  const ledger = options.ledgers[one.input.ledger];
  if (ledger === undefined) return [`the case names the ledger "${one.input.ledger}", which the suite was not told of`];
  const first = ask(provider, one.input);
  if ('problem' in first) return [first.problem];
  const { output } = first;

  issues.push(...rowsOutsideWrites(output, ledger.writes));

  // The same input, the same answer: asked again, and asked under two other wall clocks.
  const again = ask(provider, one.input);
  if ('problem' in again) issues.push(`asked again, ${again.problem}`);
  else if (JSON.stringify(again.output) !== JSON.stringify(output)) issues.push('the same input gave another answer the second time');
  for (const start of [946_684_800_000, 4_102_444_800_000]) {
    const other = underAnotherClock(start, () => ask(provider, one.input));
    if ('problem' in other) issues.push(`under another wall clock, ${other.problem}`);
    else if (JSON.stringify(other.output) !== JSON.stringify(output)) {
      issues.push('the answer changes with the wall clock: the time is an input (now, today, zone)');
      break;
    }
  }

  if (one.input.mode === 'save') {
    const peek = ask(provider, { ...one.input, mode: 'peek' });
    if ('problem' in peek) issues.push(`as a peek, ${peek.problem}`);
    else if (JSON.stringify(peek.output) !== JSON.stringify(output)) issues.push('a peek answers differently from the save');
  }

  if (one.input.phase === 'reverse') {
    if ((output.refusals ?? []).length > 0) issues.push('a reverse refuses: what was written is always given back');
  } else if ((output.refusals ?? []).length === 0 && one.input.mode !== 'words') {
    // What this case wrote, handed back: the reverse never refuses, and every summed column comes to zero.
    const written = writtenBy(output);
    const back = ask(provider, { ...one.input, phase: 'reverse', written });
    if ('problem' in back) issues.push(`reversing what it wrote, ${back.problem}`);
    else {
      if ((back.output.refusals ?? []).length > 0) issues.push('the reverse of what it wrote refuses: what was written is always given back');
      issues.push(...rowsOutsideWrites(back.output, ledger.writes).map((issue) => `the reverse: ${issue}`));
      for (const [table, columns] of Object.entries(ledger.sums ?? {})) {
        for (const column of columns) {
          const values = [...output.rows, ...back.output.rows].flatMap((row) => (row.op === 'insert' && row.table === table && row.values[column] !== undefined ? [row.values[column]] : []));
          const sum = sumOf(values);
          if (sum === null) issues.push(`"${table}.${column}" adds up to a balance: every row gives it as a decimal`);
          else if (sum !== 0n) issues.push(`over the round and its reverse "${table}.${column}" does not come to zero`);
        }
      }
    }
  }

  if (one.expect.rows !== undefined) {
    if (output.rows.length !== one.expect.rows.length) issues.push(`the case expects ${String(one.expect.rows.length)} rows; the answer has ${String(output.rows.length)}`);
    else one.expect.rows.forEach((row, i) => !holds(output.rows[i], row) && issues.push(`row ${String(i)} is not what the case expects`));
  }
  if (one.expect.refusals !== undefined) {
    const refusals = output.refusals ?? [];
    if (refusals.length !== one.expect.refusals.length) issues.push(`the case expects ${String(one.expect.refusals.length)} refusals; the answer has ${String(refusals.length)}`);
    else one.expect.refusals.forEach((refusal, i) => !holds(refusals[i], refusal) && issues.push(`refusal ${String(i)} is not what the case expects`));
  }
  return issues;
}

/** Whether `actual` holds everything `expected` names, at any depth. */
function holds(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (actual === null || typeof actual !== 'object') return false;
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((item, i) => holds(actual[i], item));
  return Object.entries(expected).every(([key, value]) => holds((actual as Record<string, unknown>)[key], value));
}

/** Registers the suite's tests for one provider. Call it inside a test file. */
export function postingRowsConformance(provider: PostingRowsProvider, options: PostingRowsConformanceOptions): void {
  describe('posting-rows@1', () => {
    it('is a provider with a synchronous `rows`', () => {
      expect(typeof provider.rows).toBe('function');
    });

    it('has at least one case for every ledger it serves', () => {
      const cased = new Set(options.cases.map((one) => one.input.ledger));
      expect(Object.keys(options.ledgers).filter((id) => !cased.has(id))).toEqual([]);
    });

    if (options.source !== undefined) {
      const source = options.source;
      it('ships a file that reaches for no module, no process, no clock and no network', () => {
        expect(postingSourceIssues(source)).toEqual([]);
      });
    }

    for (const one of options.cases) {
      it(one.name, () => {
        expect(postingCaseIssues(provider, options, one)).toEqual([]);
      });
    }
  });
}
