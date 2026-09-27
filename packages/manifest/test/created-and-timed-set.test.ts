// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a new row must meet to be created (`states.create`), the fixed values a
 * timed move writes with its move (`timed[].set`), and what an effect's move
 * of a linked row may wait for, in the manifest: what each takes and what
 * each refuses.
 */
import { describe, expect, it } from 'vitest';

import { statesSchema } from '../src/index.js';
import { issuesText, statesOf, tableOf, venue, type Doc } from './conditioned-moves-fixture.js';

/** The venue with a check-in record per ticket per day, created only for a valid ticket on its day. */
function withCheckIns(requires: Doc): Doc {
  const m = venue();
  const tables = (m['requiredSchema'] as { tables: Doc[] }).tables;
  tables.push({
    ref: 'check_ins',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'ticket_id', type: 'fk', references: 'tickets' },
      { ref: 'day', type: 'date' },
      { ref: 'status', type: 'enum', enum: ['in'], default: 'in' },
    ],
    states: { column: 'status', initial: 'in', moves: {}, create: { requires } },
  });
  return m;
}

describe('a create that waits for things', () => {
  it('takes a linked row, the row itself, the settings row and a window on the clock', () => {
    const m = withCheckIns({
      where: [{ column: 'day', isNull: false }],
      linked: [{ via: 'ticket_id', where: [{ column: 'status', eq: 'valid' }] }],
      time: { after: { via: 'ticket_id', column: 'valid_to', minus: { hours: 12 } }, before: { via: 'ticket_id', column: 'valid_to' } },
      setting: [{ table: 'settings', column: 'door_on', eq: true }],
    });
    expect(issuesText(m)).toBe('');
  });

  it('refuses an empty create, a link that is no link, a value the linked row cannot hold, a moment that is no date, and a setting not there', () => {
    expect(statesSchema.safeParse({ column: 'status', initial: 'in', moves: {}, create: { requires: {} } }).success).toBe(false);
    expect(statesSchema.safeParse({ column: 'status', initial: 'in', moves: {}, create: { requires: { children: { x: 1 } } } }).success).toBe(false);
    expect(issuesText(withCheckIns({ linked: [{ via: 'day', where: [{ column: 'status', eq: 'valid' }] }] }))).toContain('check_ins.day" does not point at a table');
    expect(issuesText(withCheckIns({ linked: [{ via: 'ticket_id', where: [{ column: 'status', eq: 'gone' }] }] }))).toContain('"gone" is not a value of "tickets.status"');
    expect(issuesText(withCheckIns({ time: { after: { via: 'ticket_id', column: 'door' } } }))).toContain('"tickets.door" is not a date or a timestamptz');
    expect(issuesText(withCheckIns({ setting: [{ table: 'settings', column: 'nope', eq: true }] }))).toContain('"settings" has no column "nope"');
  });

  it('parses on a table whose rows start in their only state', () => {
    expect(statesSchema.safeParse({ column: 'status', initial: 'in', moves: {}, create: { requires: { where: [{ column: 'day', isNull: false }] } } }).success).toBe(true);
  });
});

describe('a timed move that writes fixed values', () => {
  const timedWith = (set: Doc) => {
    const m = venue();
    const orders = tableOf(m, 'orders');
    (orders['columns'] as Doc[]).push({ ref: 'cancel_code', type: 'text', maxLength: 20, nullable: true });
    (statesOf(m, 'orders')['timed'] as Doc[])[0]!['set'] = set;
    return m;
  };

  it('takes columns of the row, and empty for a nullable one', () => {
    expect(issuesText(timedWith({ cancel_code: 'unpaid' }))).toBe('');
    expect(issuesText(timedWith({ cancel_code: null }))).toBe('');
  });

  it('refuses a column not there, the state, the key, a value it cannot hold, a column another rule writes, and none', () => {
    expect(issuesText(timedWith({ nope: 'x' }))).toContain('"orders" has no column "nope"');
    expect(issuesText(timedWith({ status: 'expired' }))).toContain('the state moves by the timed move itself');
    expect(issuesText(timedWith({ id: 3 }))).toContain('is the key');
    expect(issuesText(timedWith({ cancel_code: 5 }))).toContain('5 is not a value of "orders.cancel_code"');
    expect(issuesText(timedWith({ held_until: '2026-01-01T00:00:00Z' }))).toContain('is written by another rule already');
    expect(issuesText(timedWith({}))).toContain('a timed move sets 1 to 8 columns');
  });
});

describe("an effect's move of a linked row", () => {
  it('refuses a move of the linked row that waits for another row, and a chain of effects', () => {
    const waits = venue();
    const rooms = statesOf(waits, 'rooms');
    rooms['moves'] = { ready: ['occupied'], occupied: [{ to: 'cleaning', requires: { time: { after: { via: 'nope_id', column: 'x' } } } }], cleaning: ['ready'] };
    expect(issuesText(waits)).toContain('the move of "rooms" to "cleaning" waits for another row, so an effect cannot make it');
    const chain = venue();
    (tableOf(chain, 'rooms')['columns'] as Doc[]).push({ ref: 'stay_id', type: 'fk', references: 'stays', nullable: true });
    statesOf(chain, 'rooms')['effects'] = [{ on: { to: 'cleaning' }, via: 'stay_id', set: { status: 'departed' } }];
    expect(issuesText(chain)).toContain('an effect moves one row, never a chain');
  });

  it('still lets an effect make a move that waits for its own row', () => {
    const m = venue();
    statesOf(m, 'rooms')['moves'] = { ready: ['occupied'], occupied: [{ to: 'cleaning', requires: { where: [{ column: 'status', eq: 'occupied' }] } }], cleaning: ['ready'] };
    expect(issuesText(m)).toBe('');
  });
});
