// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A stay whose guest has arrived (a night rule's `arrived` states) is judged
 * from the venue's today on, on every engine, the clock fixed: moved to a
 * room closed on a night already slept, it is not refused for that night —
 * but a room closed tonight or later still refuses it. A booked guest (not
 * arrived) is judged over all their nights, as before, and so is a quote of
 * the change. The venue's today, not the server's: across the night the
 * clocks go back (Europe/London, 25 October 2026), a moment past midnight in
 * London is already the 25th there while it is the 24th in UTC.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { houseManifest } from './house-moves.fixture.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const at = (when: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(when));
};

describe.each(LEGS)('a stay whose guest has arrived is judged from today on — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let n = 0;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, houseManifest());
    w = await writerFor(h, 'Europe/London');
    await w.create('settings', {});
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });
  afterEach(() => vi.useRealTimers());

  /** A type of `count` rooms, and a stay of it from `arrive` to `depart` in the first room, in `status` (set as the desk left it). */
  async function house(count: number, arrive: string, depart: string, status: string) {
    n += 1;
    const type = await w.create('room_types', { name: `Type ${String(n)}` });
    const rooms = [];
    for (let i = 0; i < count; i += 1) rooms.push(await w.create('rooms', { number: `${String(n)}${String(i)}`, room_type_id: type['id'] }));
    const stay = await w.create('stays', { guest: `Guest ${String(n)}`, room_type_id: type['id'], room_id: rooms[0]!['id'], arrive, depart });
    if (status !== 'booked') await h.rows(`update ${h.real('stays')} set status = '${status}' where id = ${String(stay['id'])}`);
    if (status === 'in_house') await h.rows(`update ${h.real('rooms')} set status = 'occupied' where id = ${String(rooms[0]!['id'])}`);
    return { rooms, stay };
  }
  const close = (room: unknown, from: string, to: string) => w.create('room_closures', { room_id: room, from_date: from, to_date: to });
  const roomOf = async (key: unknown) => String((await h.rows(`select room_id from ${h.real('stays')} where id = ${String(key)}`))[0]!['room_id']);

  it.runIf(available)('moves an in-house guest into a room closed on a night already slept, never one closed tonight', async () => {
    at('2026-10-21T10:00:00Z');
    const { rooms, stay } = await house(3, '2026-10-19', '2026-10-24', 'in_house');
    await close(rooms[1]!['id'], '2026-10-19', '2026-10-20');
    await close(rooms[2]!['id'], '2026-10-22', '2026-10-22');
    const moved = await w.update('stays', stay['id'], { room_id: rooms[1]!['id'] });
    expect(moved.count).toBe(1);
    expect(await roomOf(stay['id'])).toBe(String(rooms[1]!['id']));
    // A night to come is judged: the room closed on the 22nd is no room for them.
    await expect(w.update('stays', stay['id'], { room_id: rooms[2]!['id'] })).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
    // Staying on two more nights: the slept nights in a room closed then are not judged again.
    const longer = await w.update('stays', stay['id'], { depart: '2026-10-26' });
    expect(longer.count).toBe(1);
  });

  it.runIf(available)('judges a booked guest over every night, as before, and a quote alike', async () => {
    at('2026-10-21T10:00:00Z');
    const { rooms, stay } = await house(2, '2026-10-19', '2026-10-24', 'booked');
    await close(rooms[1]!['id'], '2026-10-19', '2026-10-20');
    await expect(w.update('stays', stay['id'], { room_id: rooms[1]!['id'] })).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
    const quote = w.writes.update({ target: w.targetOf('stays'), pk: { id: stay['id'] }, values: { room_id: rooms[1]!['id'] }, context: w.desk, mode: 'dry', announce: async () => {} });
    await expect(quote).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
    expect(await roomOf(stay['id'])).toBe(String(rooms[0]!['id']));
  });

  it.runIf(available)("reads today on the venue's clock across the night the clocks go back", async () => {
    // 23:30 UTC on the 24th is 00:30 on the 25th in London (still summer time, until 02:00): the 24th is slept.
    at('2026-10-24T23:30:00Z');
    const { rooms, stay } = await house(3, '2026-10-23', '2026-10-27', 'in_house');
    await close(rooms[1]!['id'], '2026-10-24', '2026-10-24');
    await close(rooms[2]!['id'], '2026-10-25', '2026-10-25');
    expect((await w.update('stays', stay['id'], { room_id: rooms[1]!['id'] })).count).toBe(1);
    await expect(w.update('stays', stay['id'], { room_id: rooms[2]!['id'] })).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
  });
});
