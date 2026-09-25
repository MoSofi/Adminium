// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `TIMESTAMP` reader: on a UTC session a `TIMESTAMP` comes back as UTC wall
 * time, and that is the instant — whatever zone this process runs in. Every
 * other type is read as the driver would, `DATETIME` above all: it keeps the
 * server process's wall clock.
 */
import { describe, expect, it } from 'vitest';

import { readTimestampsAsUtc, type TypeCastField } from '../src/session.js';

const field = (type: string, text: string | null): TypeCastField => ({ type, string: () => text });
const untouched = Symbol('the driver reading');
const next = () => untouched;

describe('readTimestampsAsUtc', () => {
  it('reads a TIMESTAMP as the UTC instant it names', () => {
    const at = readTimestampsAsUtc(field('TIMESTAMP', '2026-07-27 23:00:00.123'), next) as Date;
    expect(at.toISOString()).toBe('2026-07-27T23:00:00.123Z');
  });

  it('keeps what a JavaScript date can of a microsecond fraction', () => {
    const at = readTimestampsAsUtc(field('TIMESTAMP', '2026-07-27 23:00:00.123456'), next) as Date;
    expect(at.toISOString()).toBe('2026-07-27T23:00:00.123Z');
  });

  it('reads a TIMESTAMP with no fraction', () => {
    const at = readTimestampsAsUtc(field('TIMESTAMP', '2026-01-05 07:30:00'), next) as Date;
    expect(at.toISOString()).toBe('2026-01-05T07:30:00.000Z');
  });

  it('passes NULL through', () => {
    expect(readTimestampsAsUtc(field('TIMESTAMP', null), next)).toBeNull();
  });

  it('gives a zero date as an invalid Date, as the driver does', () => {
    const at = readTimestampsAsUtc(field('TIMESTAMP', '0000-00-00 00:00:00'), next) as Date;
    expect(Number.isNaN(at.getTime())).toBe(true);
  });

  it.each(['DATETIME', 'DATE', 'TIME', 'VAR_STRING', 'LONGLONG', 'JSON'])('leaves a %s to the driver', (type) => {
    expect(readTimestampsAsUtc(field(type, '2026-07-27 23:00:00'), next)).toBe(untouched);
  });
});
