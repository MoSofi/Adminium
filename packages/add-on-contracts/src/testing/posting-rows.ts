// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `posting-rows@1` conformance suite.
 *
 * Run by each add-on's own tests against its provider and its own case
 * table, and by Adminium against its test ledger. A case is an input and
 * what the answer must hold; the suite adds what every provider owes whatever
 * its cases say: an answer of the declared shape, inside the ledger's
 * writes, the same for the same input, and a reverse that never refuses.
 */
import { describe, expect, it } from 'vitest';

import { postingOutputSchema, rowsOutsideWrites, type PostingInput, type PostingOutput, type PostingRefusal, type PostingRowsProvider, type PostingWriteScope } from '../posting-rows.js';

export interface PostingRowsCase {
  name: string;
  input: PostingInput;
  /** What the answer must hold: its rows in order (a subset of each row's keys), or its refusals. */
  expect: { rows?: readonly Record<string, unknown>[]; refusals?: readonly Partial<PostingRefusal>[] };
}

export interface PostingRowsConformanceOptions {
  /** Each ledger the provider serves, by id: the tables and columns it may write. */
  ledgers: Readonly<Record<string, { writes: Readonly<Record<string, PostingWriteScope>> }>>;
  cases: readonly PostingRowsCase[];
}

/** Registers the suite's tests for one provider. Call it inside a test file. */
export function postingRowsConformance(provider: PostingRowsProvider, options: PostingRowsConformanceOptions): void {
  const answer = (input: PostingInput): PostingOutput => {
    const output = provider.rows(structuredClone(input));
    expect(typeof (output as { then?: unknown } | null)?.then, 'the call is synchronous: it returns the answer, never a promise').not.toBe('function');
    return output;
  };

  describe('posting-rows@1', () => {
    it('is a provider with a synchronous `rows`', () => {
      expect(typeof provider.rows).toBe('function');
    });

    for (const one of options.cases) {
      describe(one.name, () => {
        it('answers in the declared shape', () => {
          const parsed = postingOutputSchema.safeParse(answer(one.input));
          expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
        });

        it('writes only what its ledger declares', () => {
          const ledger = options.ledgers[one.input.ledger];
          expect(ledger, `the case names the ledger "${one.input.ledger}"`).toBeDefined();
          expect(rowsOutsideWrites(answer(one.input), ledger!.writes)).toEqual([]);
        });

        it('gives the same answer to the same input', () => {
          expect(answer(one.input)).toEqual(answer(one.input));
        });

        it('answers a peek as it answers the save', () => {
          if (one.input.mode !== 'save') return;
          expect(answer({ ...one.input, mode: 'peek' })).toEqual(answer(one.input));
        });

        it('never refuses a reverse', () => {
          if (one.input.phase !== 'reverse') return;
          expect(answer(one.input).refusals ?? []).toEqual([]);
        });

        it('holds what the case expects', () => {
          const output = answer(one.input);
          if (one.expect.rows !== undefined) {
            expect(output.rows).toHaveLength(one.expect.rows.length);
            one.expect.rows.forEach((row, i) => expect(output.rows[i]).toMatchObject(row));
          }
          if (one.expect.refusals !== undefined) {
            expect(output.refusals ?? []).toHaveLength(one.expect.refusals.length);
            one.expect.refusals.forEach((refusal, i) => expect((output.refusals ?? [])[i]).toMatchObject(refusal));
          }
        });
      });
    }
  });
}
