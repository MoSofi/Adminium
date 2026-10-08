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

describe.each(LEGS)('Inventory\'s other automations — %s', (dialect, available) => {
  const run = available && inventory !== null;
  let w: Writing;
  let rules: Automation[];
  let room: number;
  let supplier: number;
  const t = (ref: string) => w.real(ref);
  const ruleNamed = (start: string) => rules.find((rule) => rule.name.startsWith(start))!;
  /** One walk of a rule over a row, at a moment; picked up where an earlier walk waited when that walk is handed in. */
  const walk = async (rule: Automation, id: unknown, at: number, waited?: { trace: { resume: number[] } }) =>
    walkRule(
      { meta: w.h.meta, manager: w.h.manager, secret: 'x'.repeat(40), writes: w.writes, now: () => at } as never,
      {
        rule,
        runId: `run_${rule.id}_${String(id)}`,
        event: { event: 'record.updated', origin: 'dashboard', hops: 0, record: { connectionId: w.h.connectionId, table: (rule.trigger as { table?: string; forEach?: { table: string } }).table ?? (rule.trigger as { forEach: { table: string } }).forEach.table, pk: { id }, label: 'a row' }, snapshot: {}, occurredAt: at } as never,
        ...(waited === undefined ? {} : { resume: waited.trace.resume, trace: waited.trace as never }),
      },
    );
  const statusOf = async (order: unknown) => (await w.h.rows(`select status, sent_how from ${t('purchase_orders')} where id = ${String(order)}`))[0]!;

  beforeAll(async () => {
    if (!run) return;
    w = await writing(await installBuilt(dialect, inventory));
    rules = await automationsRepo(w.h.meta).listManagedBy('inventory', w.h.connectionId);
    room = await place(w, 'Treatment room');
    supplier = n((await w.create('suppliers', { name: 'Medisupply Direct', email: 'desk@medisupply-direct.dev', lead_days: 2 })).row['id']);
  }, 240_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('an order marked to send by itself is sent fifteen minutes after its last line — not while a line is newer than that', async () => {
    const rule = ruleNamed('Send an order 15 minutes');
    const gloves = await item(w, 'Gloves, nitrile, L');
    const order = (await w.create('purchase_orders', { supplier_id: supplier, place_id: room, auto_send: true })).row['id'];
    await w.create('po_lines', { po_id: order, item_id: gloves, packs: 2, pack_size: 100, price: '9.00' });
    const now = Date.now();
    const first = await walk(rule, order, now);
    expect(first.kind, JSON.stringify(first).slice(0, 500)).toBe('waiting');
    expect((first as { wakeAt: number }).wakeAt - now).toBe(15 * 60_000);
    // Woken too early (a line was added a moment ago): it ends without sending.
    const early = await walk(rule, order, now + 60_000, first as never);
    expect(early.kind).toBe('finished');
    expect(await statusOf(order)).toMatchObject({ status: 'draft' });
    // Woken sixteen minutes on, with no line since: the order goes, by email, and its units count as on order.
    const late = await walk(rule, order, now + 16 * 60_000, first as never);
    expect(late, JSON.stringify(late).slice(0, 700)).toMatchObject({ kind: 'finished', status: 'succeeded' });
    expect(await statusOf(order)).toMatchObject({ status: 'sent', sent_how: 'email' });
    expect(n((await pointOf(w, gloves, room))['on_order'])).toBe(200);
    // Once sent it is not a draft any more: a second walk sends nothing again.
    const again = await walk(rule, order, now + 40 * 60_000, first as never);
    expect(again.kind).toBe('finished');
    expect(n((await pointOf(w, gloves, room))['on_order'])).toBe(200);
  });

  it.skipIf(!run)('an order whose supplier has no address is not sent by itself', async () => {
    const rule = ruleNamed('Send an order 15 minutes');
    const quiet = n((await w.create('suppliers', { name: 'Market stall', lead_days: 1 })).row['id']);
    const swabs = await item(w, 'Alcohol swab');
    const order = (await w.create('purchase_orders', { supplier_id: quiet, place_id: room, auto_send: true })).row['id'];
    await w.create('po_lines', { po_id: order, item_id: swabs, packs: 1, pack_size: 200, price: '4.00' });
    const now = Date.now();
    const first = await walk(rule, order, now);
    await walk(rule, order, now + 16 * 60_000, first as never);
    expect(await statusOf(order)).toMatchObject({ status: 'draft' });
  });

  it.skipIf(!run)('a batch that runs out within thirty days is told to the manager, with its day and what is left written as a person writes them', async () => {
    const rule = ruleNamed('Expiring within 30 days');
    const vaccine = await item(w, 'Flu vaccine, single dose', { tracks_batches: true });
    const day = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    await opening(w, room, [{ item_id: vaccine, qty_typed: 8, unit_cost: 9.8, batch_code: 'FV26A', expires_on: day }]);
    const level = (await w.h.rows(`select id from ${t('levels')} where item_id = ${String(vaccine)} and batch_code = 'FV26A'`))[0]!['id'];
    const before = (await w.h.meta.db.selectFrom('adminium_notifications').select(['title']).execute()).length;
    const told = await walk(rule, level, Date.now());
    expect(told, JSON.stringify(told).slice(0, 700)).toMatchObject({ kind: 'finished', status: 'succeeded' });
    const notices = await w.h.meta.db.selectFrom('adminium_notifications').select(['title', 'body']).execute();
    expect(notices.length - before).toBe(1);
    // "8", not "8.000"; the day, not the instant of its midnight — on every database.
    expect(notices.at(-1)).toEqual({ title: `Flu vaccine, single dose, batch FV26A, expires ${day}`, body: '8 left in Treatment room.' });
  });
});
