// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A COLUMN'S VALUE IN AN AUTOMATION'S WORDS READS THE SAME ON EVERY DATABASE.
 *
 * "{{record.available}} left" is read by a person. SQLite hands a quantity as
 * a number, Postgres and MySQL as a text padded to the column's places, and a
 * date arrives as an instant from two of them: the notice said "4.000 left"
 * and "expires 2026-10-19T22:00:00.000Z" on some servers and not on others.
 */
import { describe, expect, it } from 'vitest';

import { substitute, tokensFor } from '../src/automations/templating.js';

const column = (logicalType: string) => ({ logicalType, masked: false, secret: false });
const table = { columns: new Map(Object.entries({ available: column('decimal'), level: column('decimal'), total: column('decimal'), expires_on: column('date'), name: column('text'), at: column('timestamptz') })) };
const said = (row: Record<string, unknown>) => substitute('{{record.available}} left of {{record.level}}; {{record.total}}; expires {{record.expires_on}}; {{record.name}}', tokensFor({ row, table: table as never, ruleName: 'r', recordLabel: 'l', now: 0 }));

describe('a column\'s value in an automation\'s words', () => {
  it('a quantity loses the zeros an engine pads it with; an amount kept to two places keeps them', () => {
    expect(said({ available: '4.000', level: '5.500', total: '12.50', expires_on: '2026-10-20', name: '4.000' })).toBe('4 left of 5.5; 12.50; expires 2026-10-20; 4.000');
    // As SQLite hands them: numbers already.
    expect(said({ available: 4, level: 5.5, total: 12.5, expires_on: '2026-10-20', name: 'x' })).toBe('4 left of 5.5; 12.5; expires 2026-10-20; x');
    expect(said({ available: '-0.250', level: '100.000', total: '0.00', expires_on: null, name: '' })).toBe('-0.25 left of 100; 0.00; expires ; ');
  });

  it('a date is its day, whether the engine hands a text or an instant; a moment stays a moment', () => {
    expect(said({ available: 1, level: 1, total: 1, expires_on: new Date(2026, 9, 20), name: 'x' })).toContain('expires 2026-10-20;');
    expect(said({ available: 1, level: 1, total: 1, expires_on: '2026-10-20 00:00:00', name: 'x' })).toContain('expires 2026-10-20;');
    const at = new Date('2026-10-20T09:30:00.000Z');
    expect(tokensFor({ row: { at }, table: table as never, ruleName: 'r', recordLabel: 'l', now: 0 })['record.at']).toBe('2026-10-20T09:30:00.000Z');
  });
});
