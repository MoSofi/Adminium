// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH ROWS A LIMITED UPDATE REACHES (`writableFrom`), judged on the stored
 * row alone: the pure half. The doors that call it are tested through the
 * server in `app-role-pii-limits.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { assertMovedFrom, changesRow, mergeLimits, movedFromSeen, type UpdateLimit } from '../src/rbac/update-limits.js';

const LIMIT: UpdateLimit = { writable: ['status'], writableFrom: { status: ['booked', 'roomed'], floor: [1, 2] } };
const refusal = (run: () => void) => {
  try {
    run();
  } catch (error) {
    return error as { code?: string; statusCode?: number; details?: Record<string, unknown> };
  }
  return null;
};

describe('the rows a limited update reaches', () => {
  it('a row whose columns each hold a listed value is reached; a number may be stored as text', () => {
    expect(refusal(() => assertMovedFrom(LIMIT, 'visits', { status: 'roomed', floor: 2 }))).toBeNull();
    expect(refusal(() => assertMovedFrom(LIMIT, 'visits', { status: 'booked', floor: '1' }))).toBeNull();
  });

  it('a row with one column outside its list is not, and the refusal names that column and its list', () => {
    expect(refusal(() => assertMovedFrom(LIMIT, 'visits', { status: 'seen', floor: 1 }))).toMatchObject({
      code: 'COLUMN_FORBIDDEN',
      statusCode: 403,
      details: { table: 'visits', column: 'status', reason: 'update-from', writableFrom: ['booked', 'roomed'] },
    });
    expect(refusal(() => assertMovedFrom(LIMIT, 'visits', { status: 'booked', floor: 3 }))?.details).toMatchObject({ column: 'floor' });
    expect(refusal(() => assertMovedFrom(LIMIT, 'visits', { status: 'booked', floor: null }))?.details).toMatchObject({ column: 'floor' });
  });

  it('a row that could not be read, or was read without the column, is not reached', () => {
    expect(refusal(() => assertMovedFrom(LIMIT, 'visits', null))?.code).toBe('COLUMN_FORBIDDEN');
    expect(refusal(() => assertMovedFrom(LIMIT, 'visits', undefined))?.code).toBe('COLUMN_FORBIDDEN');
    expect(refusal(() => assertMovedFrom(LIMIT, 'visits', { status: 'booked' }))?.details).toMatchObject({ column: 'floor' });
  });

  it('no limit, or a limit that names no rows, reaches every row', () => {
    expect(refusal(() => assertMovedFrom(null, 'visits', null))).toBeNull();
    expect(refusal(() => assertMovedFrom({ writable: ['status'] }, 'visits', { status: 'seen' }))).toBeNull();
  });

  it('what the row was judged by goes with the change as what it must still hold', () => {
    expect(movedFromSeen(LIMIT, { status: 'roomed', floor: 2, note: 'x' })).toEqual({ status: 'roomed', floor: 2 });
    expect(movedFromSeen({ writable: ['status'] }, { status: 'roomed' })).toBeNull();
    expect(movedFromSeen(null, { status: 'roomed' })).toBeNull();
  });

  it('two limits as one: a column both judge by takes either list; one only one judges by is not judged', () => {
    const merged = mergeLimits([LIMIT, { writable: ['note'], writableFrom: { status: ['ready'] } }]);
    expect(merged.writableFrom).toEqual({ status: ['booked', 'roomed', 'ready'] });
    expect(mergeLimits([LIMIT, { writable: ['note'] }]).writableFrom).toBeUndefined();
  });

  it('two limits as one judge each changed column by the limits that reach this row', () => {
    // One role moves a visit until it is seen; another writes a note on any visit. Together: neither more.
    const moves: UpdateLimit = { writable: ['status'], writableValues: { status: ['roomed', 'ready', 'seen'] }, writableFrom: { status: ['booked', 'roomed'] } };
    const notes: UpdateLimit = { writable: ['note'] };
    const merged = mergeLimits([moves, notes]);
    const seen = { status: 'seen', note: 'x' };
    // The note on a seen visit: the notes role reaches it.
    expect(refusal(() => assertMovedFrom(merged, 'visits', seen, { note: 'y' }))).toBeNull();
    // The status of a seen visit: only the moves role writes it, and it does not reach this row.
    expect(refusal(() => assertMovedFrom(merged, 'visits', seen, { status: 'ready' }))?.details).toMatchObject({ column: 'status', reason: 'update-from', writableFrom: ['booked', 'roomed'] });
    // …named with every value any of the roles reaches a row from.
    expect(refusal(() => assertMovedFrom(mergeLimits([moves, { writable: ['note'], writableFrom: { status: ['ready'] } }]), 'visits', seen, { status: 'ready' }))?.details).toMatchObject({ writableFrom: ['booked', 'roomed', 'ready'] });
    expect(refusal(() => assertMovedFrom(merged, 'visits', seen, { note: 'y', status: 'ready' }))?.details).toMatchObject({ column: 'status' });
    // A column sent as the row holds it is no change, so nothing is asked of it.
    expect(refusal(() => assertMovedFrom(merged, 'visits', seen, { note: 'y', status: 'seen' }))).toBeNull();
    // Where the moves role reaches the row, both columns go.
    expect(refusal(() => assertMovedFrom(merged, 'visits', { status: 'roomed', note: 'x' }, { note: 'y', status: 'ready' }))).toBeNull();
    // Two roles with a "from" each: a column is not lent to the other role's rows.
    const late = mergeLimits([moves, { writable: ['note'], writableFrom: { status: ['ready'] } }]);
    expect(refusal(() => assertMovedFrom(late, 'visits', { status: 'ready', note: 'x' }, { note: 'y' }))).toBeNull();
    expect(refusal(() => assertMovedFrom(late, 'visits', { status: 'ready', note: 'x' }, { status: 'seen' }))?.details).toMatchObject({ column: 'status' });
    // A row no limit reaches is refused whatever is sent, even nothing.
    expect(refusal(() => assertMovedFrom(late, 'visits', { status: 'seen' }, {}))?.details).toMatchObject({ reason: 'update-from' });
    // A value only the role that does not reach the row allows is not lent either.
    const values = mergeLimits([moves, { writable: ['status'], writableValues: { status: ['cancelled'] } }]);
    expect(refusal(() => assertMovedFrom(values, 'visits', seen, { status: 'cancelled' }))).toBeNull();
    expect(refusal(() => assertMovedFrom(values, 'visits', seen, { status: 'ready' }))?.details).toMatchObject({ column: 'status' });
    // What the change is held to: every column any of the limits judges by.
    expect(movedFromSeen(late, { status: 'ready', note: 'x' })).toEqual({ status: 'ready' });
    expect(movedFromSeen(merged, { status: 'seen', note: 'x' })).toEqual({ status: 'seen' });
  });

  it('a row sent back as it stands is no change of it', () => {
    expect(changesRow({ status: 'roomed', floor: '2' }, { status: 'roomed', floor: 2 })).toBe(false);
    expect(changesRow({ status: 'ready' }, { status: 'roomed' })).toBe(true);
    expect(changesRow({ extra: 1 }, { status: 'roomed' })).toBe(true);
    expect(changesRow({}, { status: 'roomed' })).toBe(false);
    expect(changesRow({ status: 'roomed' }, null)).toBe(true);
  });
});
