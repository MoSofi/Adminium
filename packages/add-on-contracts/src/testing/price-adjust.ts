// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `price-adjust@1` conformance suite.
 *
 * Run by an adjuster's own tests against its own case table. A case is a
 * question and what the answer must hold; the suite adds what every adjuster
 * owes whatever its cases say: an answer of the declared shape, one reduction
 * per line and never more than the line, excluded lines untouched, an order
 * total that is the lines' sum, the same answer to the same question, and a
 * dry run that prices as the save does.
 */
import { describe, expect, it } from 'vitest';

import { adjustAnswerIssues, adjustOutputSchema, type AdjustApplied, type AdjustInput, type AdjustOutput, type PriceAdjustProvider } from '../price-adjust.js';

export interface PriceAdjustCase {
  name: string;
  input: AdjustInput;
  /** What the answer must hold: the order's reduction, each line's, what was applied (a subset of each entry's keys), what was refused. */
  expect: {
    order?: string;
    lines?: Readonly<Record<string, string>>;
    applied?: readonly Partial<AdjustApplied>[];
    refused?: readonly { typed: string; reason: string }[];
  };
}

export interface PriceAdjustConformanceOptions {
  cases: readonly PriceAdjustCase[];
}

/** Registers the suite's tests for one adjuster. Call it inside a test file. */
export function priceAdjustConformance(provider: PriceAdjustProvider, options: PriceAdjustConformanceOptions): void {
  const answer = (input: AdjustInput): AdjustOutput => {
    const output = provider.adjust(structuredClone(input));
    expect(typeof (output as { then?: unknown } | null)?.then, 'the call is synchronous: it returns the answer, never a promise').not.toBe('function');
    return output;
  };

  describe('price-adjust@1', () => {
    it('is a provider with a synchronous `adjust`', () => {
      expect(typeof provider.adjust).toBe('function');
    });

    for (const one of options.cases) {
      describe(one.name, () => {
        it('answers in the declared shape', () => {
          const parsed = adjustOutputSchema.safeParse(answer(one.input));
          expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
        });

        it('reduces each line once, never past its amount, and the order by their sum', () => {
          expect(adjustAnswerIssues(one.input, answer(one.input))).toEqual([]);
        });

        it('gives the same answer to the same question', () => {
          expect(answer(one.input)).toEqual(answer(one.input));
        });

        it('prices a dry run as it prices the save', () => {
          if (one.input.mode !== 'save' || one.input.point !== 'line') return;
          const saved = answer(one.input);
          const dry = answer({ ...one.input, mode: 'dry' });
          expect(dry.lines).toEqual(saved.lines);
          expect(dry.order).toEqual(saved.order);
        });

        it('says of every offer whether it applies, when asked', () => {
          if (!one.input.explain) return;
          const explained = new Set((answer(one.input).explain ?? []).map((entry) => entry.offer));
          for (const rows of Object.values(one.input.offers)) for (const row of rows) if (row['id'] !== undefined && row['id'] !== null) expect(explained, `offer ${String(row['id'])}`).toContain(String(row['id']));
        });

        it('holds what the case expects', () => {
          const output = answer(one.input);
          if (one.expect.order !== undefined) expect(output.order.discount).toBe(one.expect.order);
          for (const [key, discount] of Object.entries(one.expect.lines ?? {})) expect(output.lines.find((line) => line.key === key)?.discount, `line ${key}`).toBe(discount);
          if (one.expect.applied !== undefined) {
            expect(output.applied).toHaveLength(one.expect.applied.length);
            one.expect.applied.forEach((applied, i) => expect(output.applied[i]).toMatchObject(applied));
          }
          if (one.expect.refused !== undefined) expect(output.refused.map(({ typed, reason }) => ({ typed, reason }))).toEqual(one.expect.refused);
        });
      });
    }
  });
}
