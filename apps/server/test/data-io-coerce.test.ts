// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Import-time cell coercion (M7-T07, data-io/coerce.ts): strict per-type
 * parsing, the two §11.1 auto-resolutions (trim, empty→NULL when nullable),
 * and issue codes for everything that does not parse.
 */
import { describe, expect, it } from 'vitest';

import { coerceCell } from '../src/data-io/coerce.js';
import type { ResolvedColumn } from '../src/crud/identifiers.js';

function column(logicalType: ResolvedColumn['logicalType'], nullable = true): ResolvedColumn {
  return {
    name: 'col',
    logicalType,
    nullable,
    isPrimaryKey: false,
    masked: false,
    secret: false,
    textish: logicalType === 'text' || logicalType === 'varchar',
  };
}

describe('coerceCell', () => {
  it('maps empty cells to NULL for nullable columns, REQUIRED otherwise', () => {
    expect(coerceCell('', column('varchar'))).toEqual({ ok: true, value: null });
    expect(coerceCell('   ', column('integer'))).toEqual({ ok: true, value: null });
    const required = coerceCell('', column('varchar', false));
    expect(required.ok).toBe(false);
    if (!required.ok) expect(required.code).toBe('REQUIRED');
  });

  it('parses integers strictly (trimmed) and rejects garbage', () => {
    expect(coerceCell(' 42 ', column('integer'))).toEqual({ ok: true, value: 42 });
    expect(coerceCell('-7', column('bigint'))).toEqual({ ok: true, value: -7 });
    // Beyond double precision: digits pass through verbatim.
    expect(coerceCell('9007199254740993', column('bigint'))).toEqual({
      ok: true,
      value: '9007199254740993',
    });
    for (const bad of ['1.5', '1e3', 'x', '42abc']) {
      const result = coerceCell(bad, column('integer'));
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.code).toBe('BAD_NUMBER');
    }
  });

  it('parses decimals/floats and rejects non-numbers', () => {
    expect(coerceCell('1200.50', column('decimal'))).toEqual({ ok: true, value: 1200.5 });
    expect(coerceCell('1e3', column('float'))).toEqual({ ok: true, value: 1000 });
    expect(coerceCell('-0.5', column('decimal'))).toEqual({ ok: true, value: -0.5 });
    expect(coerceCell('.25', column('float'))).toEqual({ ok: true, value: 0.25 });
    expect(coerceCell('not-a-number', column('decimal')).ok).toBe(false);
  });

  it('rejects hex/binary/octal string literals that bare Number() would accept', () => {
    for (const bad of ['0x1f', '0b101', '0o17', 'Infinity', '-Infinity']) {
      const result = coerceCell(bad, column('decimal'));
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.code).toBe('BAD_NUMBER');
    }
  });

  it('parses the common boolean words in both directions', () => {
    for (const word of ['true', 'T', '1', 'yes', 'Y', 'on']) {
      expect(coerceCell(word, column('boolean'))).toEqual({ ok: true, value: true });
    }
    for (const word of ['false', 'F', '0', 'no', 'N', 'off']) {
      expect(coerceCell(word, column('boolean'))).toEqual({ ok: true, value: false });
    }
    const bad = coerceCell('maybe', column('boolean'));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('BAD_BOOLEAN');
  });

  it('normalizes dates to ISO (date keeps the date part) and flags bad ones', () => {
    expect(coerceCell('2026-07-17', column('date'))).toEqual({ ok: true, value: '2026-07-17' });
    const stamp = coerceCell('2026-07-17T10:30:00Z', column('timestamptz'));
    expect(stamp).toEqual({ ok: true, value: '2026-07-17T10:30:00.000Z' });
    expect(coerceCell('yesterday-ish', column('timestamp')).ok).toBe(false);
  });

  it('is timezone-independent: naive ISO forms pin to UTC, never server-local', () => {
    // Pin a far-from-UTC zone for the block (Node re-reads TZ on assignment).
    const priorTz = process.env['TZ'];
    process.env['TZ'] = 'Australia/Sydney';
    try {
      // A bare date NEVER shifts a calendar day, whatever the server TZ.
      expect(coerceCell('2024-03-15', column('date'))).toEqual({ ok: true, value: '2024-03-15' });
      // Naive timestamps keep their wall time, read as UTC.
      expect(coerceCell('2024-03-15 10:00', column('timestamp'))).toEqual({
        ok: true,
        value: '2024-03-15T10:00:00.000Z',
      });
      expect(coerceCell('2024-03-15T10:00:30.5', column('timestamptz'))).toEqual({
        ok: true,
        value: '2024-03-15T10:00:30.500Z',
      });
      // Explicit offsets are honored (unambiguous), normalized to UTC.
      expect(coerceCell('2024-03-15T10:00:00+02:00', column('timestamptz'))).toEqual({
        ok: true,
        value: '2024-03-15T08:00:00.000Z',
      });
    } finally {
      if (priorTz === undefined) delete process.env['TZ'];
      else process.env['TZ'] = priorTz;
    }
  });

  it('rejects locale-ambiguous and out-of-range dates as per-row issues', () => {
    for (const bad of ['03/15/2024', '15 Mar 2024', '2024-13-01', '2024-02-30', '20240315']) {
      const result = coerceCell(bad, column('date'));
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.code).toBe('BAD_DATE');
    }
  });

  it('validates JSON cells and passes exotic types through as strings', () => {
    expect(coerceCell('{"a":1}', column('json'))).toEqual({ ok: true, value: '{"a":1}' });
    const bad = coerceCell('{nope', column('json'));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('BAD_JSON');
    expect(coerceCell('  hello ', column('varchar'))).toEqual({ ok: true, value: 'hello' });
    expect(coerceCell('550e8400-e29b-41d4-a716-446655440000', column('uuid')).ok).toBe(true);
  });
});
