// SPDX-License-Identifier: AGPL-3.0-only
/**
 * INVENTORY'S AUTOMATIONS, RUN.
 *
 * "Low stock" is the one that does something: when an item falls to its
 * reorder level it asks for a reorder — a row the stock ledger answers by
 * putting the item on a draft order for its first-choice supplier — waits a
 * minute, and tells the stock manager what became of it. This suite walks the
 * rule as the server's runner walks it, over a real install.
 */
import { automationsRepo, type Automation } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { walkRule } from '../../../src/automations/runner.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';
import { item, n, opening, place, pointOf } from './world.js';

const inventory = builtAddOn('inventory');

describe.each(LEGS)('Inventory\'s low-stock automation — %s', (dialect, available) => {
  const run = available && inventory !== null;
  let w: Writing;
  let low: Automation;
  let shop: number;
  let back: number;
  let supplier: number;
  let runs = 0;
  const t = (ref: string) => w.real(ref);
  const walk = async (pointId: unknown, resume?: { at: number[]; trace: unknown }) =>
    walkRule(
      { meta: w.h.meta, manager: w.h.manager, secret: 'x'.repeat(40), writes: w.writes } as never,
      {
        rule: low,
        runId: `run_${String((runs += resume === undefined ? 1 : 0))}`,
        event: { event: 'record.updated', origin: 'dashboard', hops: 0, record: { connectionId: w.h.connectionId, table: (low.trigger as { table: string }).table, pk: { id: pointId }, label: 'a stock point' }, snapshot: {}, occurredAt: Date.now() } as never,
        ...(resume === undefined ? {} : { resume: resume.at, trace: resume.trace as never }),
      },
    );
  /** An item at its level in the shop: ten opened, a level of five, six used. */
  const lowItem = async (name: string, withSupplier: boolean) => {
    const id = await item(w, name);
    if (withSupplier) await w.create('item_suppliers', { item_id: id, supplier_id: supplier, pack_size: 6, price: '12.00', rank: 'preferred' });
    await opening(w, shop, [{ item_id: id, qty_typed: 10, unit_cost: 2 }]);
    const point = await pointOf(w, id, shop);
    await w.update('stock_points', point['id'], { reorder_level: 5, reorder_qty: 12 });
    await w.create('uses', { item_id: id, qty: 6, place_id: shop });
    const now = await pointOf(w, id, shop);
    expect([n(now['available']), n(now['to_reorder'])], name).toEqual([4, 1]);
    return { id, point: now['id'] };
  };

  beforeAll(async () => {
    if (!run) return;
    w = await writing(await installBuilt(dialect, inventory));
    low = (await automationsRepo(w.h.meta).listManagedBy('inventory', w.h.connectionId)).find((rule) => rule.name.startsWith('Low stock'))!;
    shop = await place(w, 'Shop floor');
    back = await place(w, 'Back room');
    supplier = n((await w.create('suppliers', { name: 'Northgate Wholesale', email: 'orders@northgate.example', lead_days: 3 })).row['id']);
  }, 240_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('an item at its level is put on a draft order for its first-choice supplier, in whole packs, and the run waits a minute', async () => {
    const tote = await lowItem('Canvas tote, natural', true);
    const first = await walk(tote.point);
    expect(first.kind, JSON.stringify(first).slice(0, 600)).toBe('waiting');
    const requests = await w.h.rows(`select status, qty, po_line_id from ${t('reorder_requests')} where stock_point_id = ${String(tote.point)}`);
    expect(requests.map((request) => [request['status'], n(request['qty'])])).toEqual([['drafted', 12]]);
    const line = (await w.h.rows(`select l.packs, l.pack_size, o.status, o.supplier_name from ${t('po_lines')} l join ${t('purchase_orders')} o on o.id = l.po_id where l.item_id = ${String(tote.id)}`))[0]!;
    expect([n(line['packs']), n(line['pack_size']), line['status'], line['supplier_name']]).toEqual([2, 6, 'draft', 'Northgate Wholesale']);
    const point = (await w.h.rows(`select request_note, request_supplier from ${t('stock_points')} where id = ${String(tote.point)}`))[0]!;
    expect([point['request_note'], point['request_supplier']]).toEqual(['drafted', 'Northgate Wholesale']);

    // A minute on, the run picks up where it waited: neither "no supplier" nor "elsewhere", so the manager is told of the draft.
    const trace = (first as { trace: { resume: number[] } }).trace;
    const before = n((await w.h.meta.db.selectFrom('adminium_notifications').select((eb) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow()).c);
    const second = await walk(tote.point, { at: trace.resume, trace });
    expect(second, JSON.stringify(second).slice(0, 900)).toMatchObject({ kind: 'finished', status: 'succeeded' });
    const told = await w.h.meta.db.selectFrom('adminium_notifications').select(['title', 'body']).execute();
    // Told to whoever holds the manager's role: the person who installed the add-on, once.
    expect(told.length - before).toBe(1);
    expect(told.at(-1)).toEqual({ title: 'Canvas tote, natural is low in Shop floor', body: '4 left; the level is 5. It is on a draft order for Northgate Wholesale.' });
    // Run again for the same point while it is on a draft, nothing more is ordered.
    await walk(tote.point);
    expect(n((await w.h.rows(`select count(*) as c from ${t('po_lines')} where item_id = ${String(tote.id)}`))[0]!['c'])).toBe(1);
  });

  it.skipIf(!run)('with no supplier set nothing is drafted and the point says so', async () => {
    const mug = await lowItem('Mug, speckled', false);
    const first = await walk(mug.point);
    expect(first.kind, JSON.stringify(first).slice(0, 600)).toBe('waiting');
    const requests = await w.h.rows(`select status, po_line_id from ${t('reorder_requests')} where stock_point_id = ${String(mug.point)}`);
    expect(requests.map((request) => [request['status'], request['po_line_id'] ?? null])).toEqual([['needs_supplier', null]]);
    expect((await w.h.rows(`select request_note from ${t('stock_points')} where id = ${String(mug.point)}`))[0]!['request_note']).toBe('needs_supplier');
  });

  it.skipIf(!run)('with enough in another place nothing is drafted and the point names that place', async () => {
    const id = await item(w, 'Notebook, A5');
    await w.create('item_suppliers', { item_id: id, supplier_id: supplier, pack_size: 12, price: '26.40', rank: 'preferred' });
    await opening(w, shop, [{ item_id: id, qty_typed: 10, unit_cost: 2.2 }]);
    await opening(w, back, [{ item_id: id, qty_typed: 40, unit_cost: 2.2 }]);
    const point = await pointOf(w, id, shop);
    await w.update('stock_points', point['id'], { reorder_level: 5, reorder_qty: 24 });
    await w.create('uses', { item_id: id, qty: 6, place_id: shop });
    const first = await walk(point['id']);
    expect(first.kind, JSON.stringify(first).slice(0, 600)).toBe('waiting');
    const after = (await w.h.rows(`select request_note, request_elsewhere from ${t('stock_points')} where id = ${String(point['id'])}`))[0]!;
    expect([after['request_note'], after['request_elsewhere']]).toEqual(['elsewhere', 'Back room']);
    expect(n((await w.h.rows(`select count(*) as c from ${t('po_lines')} where item_id = ${String(id)}`))[0]!['c'])).toBe(0);
  });
});
