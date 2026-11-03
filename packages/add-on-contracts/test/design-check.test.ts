// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `design-check@1`: the shape of an answer, the check Adminium makes of it
 * against the question, the features matched to what a line pays for, and
 * the conformance suite run against a checker small enough to read.
 */
import { describe, expect, it } from 'vitest';

import { CHECK_HOST_REASONS, CHECK_REASONS, checkAnswerIssues, checkOutputSchema, featureRefusals, hasContractVersion, type CheckInput, type CheckOutput, type DesignCheckProvider } from '../src/index.js';
import { checkQuestion, designCheckConformance } from '../src/testing/index.js';

/** Each part has a limit; a logo is the paid feature "logo". */
const checker: DesignCheckProvider = {
  check(input) {
    return {
      lines: input.lines.map((line) => {
        const parts = line.rows['parts'] ?? [];
        const refusals: CheckOutput['lines'][number]['refusals'] = [];
        for (const part of parts) {
          const text = String(line.design[`part_${String(part['name'])}`] ?? '');
          if (text.length > Number(part['max'])) refusals.push({ part: String(part['name']), reason: 'too-long' });
        }
        const used = line.files.some((file) => file.column === 'logo' && file.size > 0) ? ['logo'] : [];
        return { key: line.key, ok: refusals.length === 0, used, refusals };
      }),
    };
  },
};

const parts = { parts: [{ name: 'top', max: 20 }] };
const question = (over: Partial<CheckInput> = {}): CheckInput =>
  checkQuestion(
    [
      { key: '1', design: { id: 1, part_top: 'Happy birthday' }, rows: parts },
      { key: '2', design: { id: 2, part_top: 'x'.repeat(40) }, rows: parts },
      { key: '3', design: { id: 3, part_top: 'Ada' }, rows: parts, paid: ['logo'], files: [{ column: 'logo', kind: 'image/png', size: 2048 }] },
    ],
    over,
  );

describe('design-check@1', () => {
  it('is a registered contract at version 1', () => {
    expect(hasContractVersion('design-check', 1)).toBe(true);
    expect(hasContractVersion('design-check', 2)).toBe(false);
  });

  it('keeps its own reasons apart from the ones Adminium gives', () => {
    expect(CHECK_REASONS.filter((reason) => (CHECK_HOST_REASONS as readonly string[]).includes(reason))).toEqual([]);
  });

  it('reads a well-formed answer and refuses one with an invented reason or a stray key', () => {
    expect(checkOutputSchema.safeParse(checker.check(question())).success).toBe(true);
    expect(checkOutputSchema.safeParse({ lines: [{ key: '1', ok: false, used: [], refusals: [{ reason: 'too-ugly' }] }] }).success).toBe(false);
    expect(checkOutputSchema.safeParse({ lines: [{ key: '1', ok: true, used: [], refusals: [], price: '0' }] }).success).toBe(false);
  });

  it('finds a line missing, invented or answered twice, a feature named twice, and a verdict that contradicts its refusals', () => {
    const asked = question();
    const issues = checkAnswerIssues(asked, {
      lines: [
        { key: '1', ok: true, used: ['logo', 'logo'], refusals: [] },
        { key: '1', ok: true, used: [], refusals: [] },
        { key: '9', ok: true, used: [], refusals: [] },
        { key: '2', ok: true, used: [], refusals: [{ reason: 'too-long' }] },
      ],
    });
    expect(issues).toEqual([
      'lines.0.used: a feature is named twice',
      'lines.1: "1" is answered twice',
      'lines.2: "9" is not a line of the question',
      'lines.3: a design that stands has no refusals',
      'lines: the line "3" has no answer',
    ]);
    expect(checkAnswerIssues(asked, { lines: [{ key: '1', ok: true, used: [], refusals: [] }, { key: '2', ok: false, used: [], refusals: [] }, { key: '3', ok: true, used: [], refusals: [] }] })).toEqual([
      'lines.1: a design that does not stand says why',
    ]);
  });

  it('matches the features used to the features paid, both ways', () => {
    expect(featureRefusals(['logo'], ['logo'])).toEqual([]);
    expect(featureRefusals([], ['logo'])).toEqual([{ feature: 'logo', reason: 'feature-not-paid' }]);
    expect(featureRefusals(['logo'], [])).toEqual([{ feature: 'logo', reason: 'feature-not-used' }]);
  });
});

designCheckConformance(checker, {
  cases: [
    {
      name: 'a short line stands, a long one is refused, a logo is used',
      input: question(),
      expect: { '1': { ok: true, used: [] }, '2': { ok: false, reasons: ['too-long'] }, '3': { ok: true, used: ['logo'] } },
    },
  ],
});
