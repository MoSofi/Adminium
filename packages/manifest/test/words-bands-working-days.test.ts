// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The release that reads a band link, a date counted in working days, and a
 * formula rounded up or down: a manifest that uses one names it, so an older
 * Adminium says "needs a newer Adminium" instead of refusing an unknown key.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, WORD_FLOORS } from '../src/index.js';

function appWith(columns: unknown[]): Record<string, unknown> {
  return { kind: 'app', requiredSchema: { tables: [{ ref: 'lines', columns: [{ ref: 'id', type: 'int', role: 'pk' }, ...columns] }] } };
}

describe('the words of bands, working days, ceil and floor', () => {
  it('names each where it is used, at 0.3.43', () => {
    const words = installFloorWords(
      appWith([
        { ref: 'qty', type: 'int' },
        { ref: 'break_id', type: 'int', nullable: true, rules: { band: { table: 'breaks', min: 'min_qty', value: 'qty' } } },
        { ref: 'ready_on', type: 'date', nullable: true, rules: { stamp: { set: { addWorkingDays: { from: 'now', days: 3, weekdays: ['mon'] } }, on: 'create' } } },
        { ref: 'sheets', type: 'int', nullable: true, rules: { formula: { add: [1, { ceil: { div: ['qty', 4] } }] } } },
      ]),
    );
    expect(words).toEqual([
      { word: 'column.band', path: 'requiredSchema.tables.0.columns.2.rules.band' },
      { word: 'stamp.addWorkingDays', path: 'requiredSchema.tables.0.columns.3.rules.stamp.set.addWorkingDays' },
      { word: 'formula.ceilFloor', path: 'requiredSchema.tables.0.columns.4.rules.formula' },
    ].map((one) => expect.objectContaining(one)));
    expect(WORD_FLOORS['column.band']).toBe('0.3.43');
    expect(WORD_FLOORS['stamp.addWorkingDays']).toBe('0.3.43');
    expect(WORD_FLOORS['formula.ceilFloor']).toBe('0.3.43');
  });

  it('names nothing for a plain addDays stamp or a formula that only rounds', () => {
    const words = installFloorWords(
      appWith([
        { ref: 'qty', type: 'int' },
        { ref: 'due_on', type: 'date', nullable: true, rules: { stamp: { set: { addDays: { date: 'made_on', days: 3 } }, on: 'create' } } },
        { ref: 'half', type: 'decimal', scale: 2, nullable: true, rules: { formula: { round: [{ div: ['qty', 2] }, 2] } } },
      ]),
    ).map((one) => one.word);
    expect(words).not.toContain('column.band');
    expect(words).not.toContain('stamp.addWorkingDays');
    expect(words).not.toContain('formula.ceilFloor');
  });
});
