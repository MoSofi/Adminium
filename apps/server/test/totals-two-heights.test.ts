// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE ROW, HELD AT TWO HEIGHTS.
 *
 * A shelf adds up its own moves, and also what its bins add up; only the
 * second of those totals climbs on, to the room. A move that names both the
 * shelf and one of its bins reaches the shelf twice in one save: as the
 * parent of the move, and one height above the bin. It is held once at each,
 * each time reading only the links that height climbs through — and a link
 * the other height looked through must not read as a row that moved.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const sum = (from: string, via: string, column: string) => ({ type: 'decimal', scale: 2, default: 0, rules: { rollup: { from, via, sum: column } } });

function manifest(): Record<string, unknown> {
  return invoicingManifest([
    { ref: 'rooms', columns: [id, { ref: 'held', ...sum('shelves', 'room_id', 'in_bins') }] },
    {
      ref: 'shelves',
      columns: [
        id,
        { ref: 'room_id', type: 'fk', references: 'rooms' },
        // Its own moves: a total that climbs nowhere.
        { ref: 'moved', ...sum('moves', 'shelf_id', 'qty') },
        // What its bins hold: a total the room adds up.
        { ref: 'in_bins', ...sum('bins', 'shelf_id', 'held') },
      ],
    },
    { ref: 'bins', columns: [id, { ref: 'shelf_id', type: 'fk', references: 'shelves' }, { ref: 'held', ...sum('moves', 'bin_id', 'qty') }] },
    { ref: 'moves', columns: [id, { ref: 'shelf_id', type: 'fk', references: 'shelves' }, { ref: 'bin_id', type: 'fk', references: 'bins', nullable: true }, { ref: 'qty', type: 'decimal', scale: 2 }] },
  ]);
}

let open: InvoicingHarness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a row held at two heights, on ${dialect}`, () => {
    it('settles both of its totals in the one save, and is not taken for a row that moved', async () => {
      const h = await installInvoicing(dialect, manifest());
      open = h;
      const w = await writerFor(h);
      const room = await w.create('rooms', {});
      const shelf = await w.create('shelves', { room_id: room['id'] });
      const bin = await w.create('bins', { shelf_id: shelf['id'] });
      const figures = async () => {
        const [s] = await h.rows(`select moved, in_bins from ${h.real('shelves')} where id = ${String(shelf['id'])}`);
        const [b] = await h.rows(`select held from ${h.real('bins')} where id = ${String(bin['id'])}`);
        const [r] = await h.rows(`select held from ${h.real('rooms')} where id = ${String(room['id'])}`);
        return [Number(s!['moved']), Number(b!['held']), Number(s!['in_bins']), Number(r!['held'])];
      };
      // The move names the shelf and its bin: the shelf is its parent, and a height above the bin.
      await w.create('moves', { shelf_id: shelf['id'], bin_id: bin['id'], qty: 5 });
      expect(await figures()).toEqual([5, 5, 5, 5]);
      // A move on the shelf alone climbs one way only.
      const loose = await w.create('moves', { shelf_id: shelf['id'], qty: 2 });
      expect(await figures()).toEqual([7, 5, 5, 5]);
      // And a change of a move that names both settles both again.
      await w.update('moves', loose['id'], { bin_id: bin['id'] });
      expect(await figures()).toEqual([7, 7, 7, 7]);
    });
  });
}
