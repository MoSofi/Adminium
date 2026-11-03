// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `design-check@1` conformance suite.
 *
 * Run by a design checker's own tests against its own case table. A case is
 * a question and what the answer must hold; the suite adds what every checker
 * owes whatever its cases say: an answer of the declared shape, every line
 * answered once, a design that stands with no refusals and one that does not
 * with at least one, the same answer to the same question, and a dry run
 * answered as the save is.
 *
 * `checkQuestion` builds a question the way Adminium puts one, so a case
 * names only what it is about.
 */
import { describe, expect, it } from 'vitest';

import { checkAnswerIssues, checkOutputSchema, type CheckInput, type CheckLine, type CheckOutput, type CheckReason, type DesignCheckProvider } from '../design-check.js';

export interface DesignCheckCase {
  name: string;
  input: CheckInput;
  /** What the answer must hold, by line key: whether it stands, the features it uses (as a set), the reasons it is refused for (as a set). */
  expect: Readonly<Record<string, { ok: boolean; used?: readonly string[]; reasons?: readonly CheckReason[] }>>;
}

export interface DesignCheckConformanceOptions {
  cases: readonly DesignCheckCase[];
}

/** A question as Adminium puts one: lines filled in with nothing paid and no files unless the case says so. */
export function checkQuestion(lines: readonly (Partial<CheckLine> & Pick<CheckLine, 'key' | 'design'>)[], over: Partial<Omit<CheckInput, 'lines'>> = {}): CheckInput {
  return {
    contract: 'design-check@1',
    mode: 'save',
    settings: {},
    version: '1.0.0',
    ...over,
    lines: lines.map((line) => ({ rows: {}, paid: [], files: [], ...line })),
  };
}

/** Registers the suite's tests for one checker. Call it inside a test file. */
export function designCheckConformance(provider: DesignCheckProvider, options: DesignCheckConformanceOptions): void {
  const answer = (input: CheckInput): CheckOutput => {
    const output = provider.check(structuredClone(input));
    expect(typeof (output as { then?: unknown } | null)?.then, 'the call is synchronous: it returns the answer, never a promise').not.toBe('function');
    return output;
  };

  describe('design-check@1', () => {
    it('is a provider with a synchronous `check`', () => {
      expect(typeof provider.check).toBe('function');
    });

    for (const one of options.cases) {
      describe(one.name, () => {
        it('answers in the declared shape', () => {
          const parsed = checkOutputSchema.safeParse(answer(one.input));
          expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
        });

        it('answers every line once, with refusals exactly when a design does not stand', () => {
          expect(checkAnswerIssues(one.input, answer(one.input))).toEqual([]);
        });

        it('gives the same answer to the same question', () => {
          expect(answer(one.input)).toEqual(answer(one.input));
        });

        it('answers a dry run as it answers the save', () => {
          expect(answer({ ...one.input, mode: 'dry' })).toEqual(answer({ ...one.input, mode: 'save' }));
        });

        it('holds what the case expects', () => {
          const output = answer(one.input);
          for (const [key, wanted] of Object.entries(one.expect)) {
            const line = output.lines.find((candidate) => candidate.key === key);
            expect(line, `line ${key}`).toBeDefined();
            expect(line!.ok, `line ${key} stands`).toBe(wanted.ok);
            if (wanted.used !== undefined) expect([...line!.used].sort(), `line ${key} uses`).toEqual([...wanted.used].sort());
            if (wanted.reasons !== undefined) expect([...new Set(line!.refusals.map((refusal) => refusal.reason))].sort(), `line ${key} is refused for`).toEqual([...new Set(wanted.reasons)].sort());
          }
        });
      });
    }
  });
}
