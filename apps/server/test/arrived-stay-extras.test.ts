// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rows of a stay whose nights are the stay's own (a parking spot kept for
 * it, `from`/`to` read through the stay) are judged as the stay is, on every
 * engine, the clock fixed: when an in-house guest stays on, their spot is
 * judged from the venue's today on — a night already slept (the spot given
 * twice last night, as the desk left it) is not judged again, while a night to
 * come the spot is taken by someone else refuses the extension. A booked
 * guest's spot is judged over every night, as before.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { houseManifest, houseTables, type Doc } from './house-moves.fixture.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const at = (when: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(when));
};

function withParking(): Doc {
  const tables = houseTables();
  tables.push(
    { ref: 'spots', columns: [id, { ref: 'name', type: 'text', maxLength: 20 }] },
    {
      ref: 'stay_parking',
      columns: [id, { ref: 'stay_id', type: 'fk', references: 'stays' }, { ref: 'spot_id', type: 'fk', references: 'spots' }],
      capacity: {
        kind: 'night',
        from: { via: 'stay_id', column: 'arrive' },
        to: { via: 'stay_id', column: 'depart' },
        countWhere: { via: 'stay_id', column: 'status', values: ['booked', 'in_house'] },
        pool: { via: 'spot_id', size: 1 },
        arrived: { states: ['in_house'], via: 'stay_id' },
      },
    },
  );
  return houseManifest(tables);
}

describe.each(LEGS)("a stay's extras are judged as the stay is — %s", (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let n = 0;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, withParking());
    w = await writerFor(h, 'Europe/London');
    await w.create('settings', {});
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });
  afterEach(() => vi.useRealTimers());

  /** Two stays of a type of three rooms sharing one spot last night (the 2nd), as the desk left them; the first in `status`. */
  async function doubleParked(status: string) {
    n += 1;
    at('2026-11-03T12:00:00Z');
    const type = await w.create('room_types', { name: `Double ${String(n)}` });
    const rooms = [];
    for (let i = 0; i < 3; i += 1) rooms.push(await w.create('rooms', { number: `${String(n)}${String(i)}`, room_type_id: type['id'] }));
    const spot = await w.create('spots', { name: `P${String(n)}` });
    const a = await w.create('stays', { guest: 'A', room_type_id: type['id'], room_id: rooms[0]!['id'], arrive: '2026-11-02', depart: '2026-11-04' });
    const b = await w.create('stays', { guest: 'B', room_type_id: type['id'], room_id: rooms[1]!['id'], arrive: '2026-11-01', depart: '2026-11-03' });
    await h.rows(`update ${h.real('stays')} set status = '${status}' where id = ${String(a['id'])}`);
    await h.rows(`update ${h.real('stays')} set status = 'in_house' where id = ${String(b['id'])}`);
    await h.rows(`insert into ${h.real('stay_parking')} (stay_id, spot_id) values (${String(a['id'])}, ${String(spot['id'])}), (${String(b['id'])}, ${String(spot['id'])})`);
    return { type, rooms, spot, a };
  }

  it.runIf(available)('lets an in-house guest stay on over a night already slept, and not over a night the spot is taken', async () => {
    const { type, rooms, spot, a } = await doubleParked('in_house');
    expect((await w.update('stays', a['id'], { depart: '2026-11-05' })).count).toBe(1);
    // Someone else has the spot on the 5th: staying on through it is refused.
    const c = await w.create('stays', { guest: 'C', room_type_id: type['id'], room_id: rooms[2]!['id'], arrive: '2026-11-05', depart: '2026-11-06' });
    await w.create('stay_parking', { stay_id: c['id'], spot_id: spot['id'] });
    await expect(w.update('stays', a['id'], { depart: '2026-11-06' })).rejects.toMatchObject({ code: 'CAPACITY_FULL', details: { pool: { at: '2026-11-05' } } });
  });

  it.runIf(available)("judges a booked guest's spot over every night, as before", async () => {
    const { a } = await doubleParked('booked');
    await expect(w.update('stays', a['id'], { depart: '2026-11-05' })).rejects.toMatchObject({ code: 'CAPACITY_FULL', details: { pool: { at: '2026-11-02' } } });
  });
});
