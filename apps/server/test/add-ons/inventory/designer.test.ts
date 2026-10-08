// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT ADMINIUM DESIGNER WRITES FOR A SUPPLIES APP, RUN ON INVENTORY AS BUILT.
 *
 * A clinic's visits and the supplies each one used. The rule on the supplies
 * table is the one the Designer's tool writes from Inventory's own manifest —
 * nothing here names an input by hand — and it is then run the whole way: a
 * visit marked seen takes its supplies from the shelf, and one put back to
 * booked gives them back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ledgersOf } from '../../../src/designer/add-on-lines.js';
import { hostActions, declaredLedgers, hostPostingIssue, ledgerParts } from '../../../src/project/apps/ledger-parts.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';
import { item, movementsOf, n, opening, place, pointOf } from './world.js';

const inventory = builtAddOn('inventory');
/** The supplies table as the model writes it first: its key and its link to the visit, nothing about stock. */
const bare = { ref: 'visit_supplies', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'visit_id', type: 'fk', references: 'visits' }] };
const made =
  inventory === null
    ? null
    : ledgerParts({
        addOn: 'inventory',
        document: inventory.manifest,
        ledger: 'stock',
        action: 'use-item',
        table: bare,
        via: 'visit_id',
        when: { post: { column: 'status', in: ['seen'] }, reverse: { column: 'status', from: ['seen'], in: ['booked', 'cancelled'] } },
      });
const posting = made !== null && made.ok ? made.posting : null;
const HOSTS = {
  clinic_visits: { columns: "patient VARCHAR(80) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'booked'", postings: [] },
  clinic_visit_supplies: {
    columns: 'visit_id INT NOT NULL, item_id INT, qty DECIMAL(12,3) NOT NULL, FOREIGN KEY (visit_id) REFERENCES clinic_visits(id)',
    postings: posting === null ? [] : [posting],
  },
};

describe('what the tool reads of Inventory', () => {
  const run = inventory !== null;

  it.skipIf(!run)('the ledger is listed with the actions an app\'s rows use, in the add-on\'s own names', () => {
    const ledger = declaredLedgers(inventory!.manifest).find((one) => one.id === 'stock')!;
    expect([...hostActions(inventory!.manifest, ledger)].sort()).toEqual(['adopt', 'hold', 'return', 'use', 'use-item']);
    const [line] = ledgersOf(inventory!.manifest);
    expect(line).toContain('stock — ');
    expect(line).toContain('use-item (item: link to items, quantity: number; optional place, batch, kind, reason, note, strict)');
    expect(line).toContain('use (what: your row, or a link column to one, quantity: number; optional place, batch, kind)');
    expect(line).toContain('hold (what: your row, or a link column to one, quantity: number; optional place, batch, kind; holds until a time you give)');
    // Its own documents are not offered to an app's rows.
    expect(line).not.toContain('receive (');
    expect(line).not.toContain('count (');
  });

  it.skipIf(!run)('the rule for a line that names an item: a link into items, a quantity, the two mapped', () => {
    expect(made!.ok, made!.ok ? '' : made!.problem).toBe(true);
    if (!made!.ok) return;
    expect(made!.added).toEqual([
      { column: 'item_id', type: 'int', links: 'inventory.items' },
      { column: 'qty', type: 'decimal, scale 3' },
    ]);
    expect(made!.posting).toEqual({
      id: 'stock',
      into: { addOn: 'inventory', ledger: 'stock', action: 'use-item' },
      via: 'visit_id',
      post: { on: { column: 'status', in: ['seen'] } },
      reverse: { on: { column: 'status', from: ['seen'], in: ['booked', 'cancelled'] } },
      map: { item: 'item_id', quantity: 'qty' },
    });
    expect(made!.addOn).toEqual({ key: 'inventory', name: 'Inventory', range: `>=${inventory!.version}` });
    // The role that picks an item reads what says which item it is, and no cost.
    const items = made!.grants.find((grant) => grant.table === 'items')!;
    expect(items.readable).toContain('name');
    expect(items.readable).not.toContain('cost_avg');
    expect(hostPostingIssue(made!.posting, inventory!.manifest)).toBeNull();
  });

  it.skipIf(!run)('a rule edited by hand is held to Inventory\'s own inputs', () => {
    if (posting === null) throw new Error('no rule was made');
    expect(hostPostingIssue({ ...posting, map: { item: 'item_id', amount: 'qty' } }, inventory!.manifest)).toBe(
      '"amount" is not an input of inventory/stock/use-item. Its inputs are item, quantity, place (optional), batch (optional), kind (optional), reason (optional), note (optional), strict (optional). Call post_to_ledger for this table again; do not edit the rule by hand.',
    );
    expect(hostPostingIssue({ ...posting, into: { ...posting.into, action: 'take' } }, inventory!.manifest)).toContain('inventory/stock has no action "take".');
  });
});

describe.each(LEGS)('a visit\'s supplies come off the shelf — %s', (dialect, available) => {
  const run = available && inventory !== null && posting !== null;
  let w: Writing;
  let room: number;
  let gloves: number;
  let visit: number;

  beforeAll(async () => {
    if (!run) return;
    w = await writing(await installBuilt(dialect, inventory, {}, HOSTS));
    room = await place(w, 'Treatment room');
    gloves = await item(w, 'Gloves, nitrile, L');
    await opening(w, room, [{ item_id: gloves, qty_typed: 10, unit_cost: 0.08 }]);
    await w.h.rows("INSERT INTO clinic_visits (patient) VALUES ('Mara Lindqvist')");
    visit = n((await w.h.rows('select id from clinic_visits'))[0]?.['id']);
  }, 240_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('a line of a booked visit takes nothing yet', async () => {
    await w.create('clinic_visit_supplies', { visit_id: visit, item_id: gloves, qty: 2 });
    expect(n((await pointOf(w, gloves, room))['on_hand'])).toBe(10);
  });

  it.skipIf(!run)('marking the visit seen takes its supplies, under a receipt that names the visit', async () => {
    await w.update('clinic_visits', visit, { status: 'seen' });
    expect(n((await pointOf(w, gloves, room))['on_hand'])).toBe(8);
    expect((await movementsOf(w, gloves)).at(-1)).toMatch(/^(used|sold) -2$/);
    const receipts = await w.rowsOf('postings', `source_table = '${w.storedName('clinic_visits')}' and source_row = '${String(visit)}'`);
    expect(receipts.map((row) => `${String(row['action'])} ${String(row['phase'])} ${String(row['posting'])}`)).toEqual(['use-item post stock']);
    expect(w.refused).toEqual([]);
  });

  it.skipIf(!run)('putting the visit back to booked gives them back', async () => {
    await w.update('clinic_visits', visit, { status: 'booked' });
    expect(n((await pointOf(w, gloves, room))['on_hand'])).toBe(10);
  });
});
