// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A move whose effect moves a column other rows follow brings them into step
 * in the same write, on every engine: a stay's check-out turns its room to
 * cleaning, and the room's tasks — which copy the room's state and follow it
 * — say cleaning too. A quote of the check-out writes none of it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const ROOM_STATES = ['ready', 'occupied', 'cleaning'];

function manifest(): Record<string, unknown> {
  return invoicingManifest([
    {
      ref: 'rooms',
      columns: [id, { ref: 'number', type: 'text', maxLength: 8 }, { ref: 'status', type: 'enum', enum: ROOM_STATES, default: 'ready' }],
      states: { column: 'status', initial: 'ready', moves: { ready: ['occupied'], occupied: ['cleaning'], cleaning: ['ready'] } },
    },
    {
      ref: 'room_tasks',
      columns: [
        id,
        { ref: 'room_id', type: 'fk', references: 'rooms' },
        { ref: 'room_status', type: 'enum', enum: ROOM_STATES, nullable: true, rules: { copy: { via: 'room_id', from: 'status', mode: 'always', follow: true } } },
      ],
    },
    {
      ref: 'stays',
      columns: [id, { ref: 'room_id', type: 'fk', references: 'rooms', nullable: true }, { ref: 'status', type: 'enum', enum: ['booked', 'in_house', 'departed'], default: 'booked' }],
      states: {
        column: 'status',
        initial: 'booked',
        moves: { booked: ['in_house'], in_house: ['departed'] },
        effects: [{ on: { to: 'departed' }, via: 'room_id', set: { status: 'cleaning' } }],
      },
    },
  ]);
}

describe.each(LEGS)('an effect that moves a followed column — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
    w = await writerFor(h);
  }, 180_000);
  afterAll(async () => h?.close());

  const status = async (id: unknown) => (await h!.rows(`select room_status from ${h!.real('room_tasks')} where id = ${String(id)}`))[0]!['room_status'];

  it.skipIf(!available)("brings the room's tasks into step with the room the check-out turned to cleaning", async () => {
    const room = await w.create('rooms', { number: '101', status: 'ready' });
    await w.update('rooms', room['id'], { status: 'occupied' });
    const task = await w.create('room_tasks', { room_id: room['id'] });
    expect(await status(task['id'])).toBe('occupied');
    const stay = await w.create('stays', { room_id: room['id'], status: 'booked' });
    await w.update('stays', stay['id'], { status: 'in_house' });
    // A quote of the check-out moves nothing.
    await w.writes.update({ target: w.targetOf('stays'), pk: { id: stay['id'] }, values: { status: 'departed' }, context: w.desk, announce: async () => {}, mode: 'dry' }).catch(() => null);
    expect(await status(task['id'])).toBe('occupied');
    await w.update('stays', stay['id'], { status: 'departed' });
    expect((await h!.rows(`select status from ${h!.real('rooms')} where id = ${String(room['id'])}`))[0]!['status']).toBe('cleaning');
    expect(await status(task['id'])).toBe('cleaning');
  });
});
