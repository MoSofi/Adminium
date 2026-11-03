// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `column.band` on every engine this run can reach, through an app installed
 * by the real installer: a guest's order through the public create route
 * (and its quote), and staff writes through the write service.
 *
 * A line's quantity picks its own product's price break (each edge), a
 * product with no breaks leaves the link empty and the line at its plain
 * price; an order's weight, a total of its lines, picks the delivery band in
 * the order's settle — past the top band the delivery is left to quote, or,
 * on a crate, the create is refused. Staff adding or removing a line move
 * the band and the delivery price in the same write. Nobody writes the link.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { endpointIssues, type PublicEndpointDefinition } from '../src/public-api/endpoint.js';
import { solveProof } from '../src/public-api/proof.js';
import { bandShop } from './band-fixture.js';
import { LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { cents } from './order-tree-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Reply = Awaited<ReturnType<Served['get']>>;
type Tree = { data: Record<string, unknown>; children: Record<string, { data: Record<string, unknown> }[]> };

const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

describe.each(LEGS)('bands, on %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.9.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  /** A guest's create, with the human check solved (a quote asks none). */
  const post = async (url: string, payload: Record<string, unknown>) => {
    const address = fresh();
    let headers = served.headers();
    if (!url.endsWith('dry-run')) {
      const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=write', remoteAddress: address, headers });
      const c = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
      headers = served.headers(undefined, { 'x-adminium-proof': `${c.id}.${solveProof(c.salt, c.difficulty)}` });
    }
    return served.composed.app.inject({ method: 'POST', url: `/api/v1/public/records/${url}`, remoteAddress: address, headers, payload });
  };
  const order = (lines: [number, number][], more: Record<string, unknown> = {}) => ({
    values: { email: 'mia@example.com', ...((more['values'] as Record<string, unknown> | undefined) ?? {}) },
    children: { lines: lines.map(([product, qty]) => ({ values: { product_id: product, qty, ...((more['line'] as Record<string, unknown> | undefined) ?? {}) } })) },
  });
  const tree = (res: Reply) => res.json() as Tree;
  const error = (res: Reply) => (res.json() as { error: { code: string; params?: Record<string, unknown> } }).error;
  const stored = async (ref: string, key: unknown) => (await h.rows(`select * from ${h.real(ref)} where id = ${String(key)}`))[0]!;

  beforeAll(async () => {
    if (!available) return;
    h = await bandShop(dialect);
    served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId);
    w = await writerFor(h);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!available)("picks each coaster line's own break: 3 the 1-row, 4 the 4-row, 11 the 8-row, 12 the 12-row; a sign has none", async () => {
    const res = await post('banded_orders', order([[1, 3], [1, 4], [1, 11], [1, 12], [2, 3]]));
    expect(res.statusCode, res.body).toBe(201);
    const lines = tree(res).children['lines']!.map((line) => line.data);
    expect(lines.map((line) => num(line['break_id']))).toEqual([1, 2, 3, 4, null]);
    expect(lines.map((line) => num(line['multiplier']))).toEqual([1, 0.9, 0.85, 0.8, null]);
    // £4 a coaster: 12.00, 4 × 3.60, 11 × 3.40, 12 × 3.20; the sign at its plain £20 × 3.
    expect(lines.map((line) => cents(line['line_total']))).toEqual(['12.00', '14.40', '37.40', '38.40', '60.00']);
  });

  it.skipIf(!available)("picks a flyer's break at every edge: 24/25, 249/250, 999/1000", async () => {
    const res = await post('banded_orders', order([[4, 24], [4, 25], [4, 249], [4, 250], [4, 999], [4, 1000]]));
    expect(res.statusCode, res.body).toBe(201);
    const lines = tree(res).children['lines']!.map((line) => line.data);
    expect(lines.map((line) => num(line['break_id']))).toEqual([5, 6, 6, 7, 7, 8]);
    expect(lines.map((line) => cents(line['line_total']))).toEqual(['12.00', '10.00', '99.60', '75.00', '299.70', '200.00']);
    // Read back as stored.
    const row = await stored('lines', lines[3]!['id']);
    expect(num(row['break_id'])).toBe(7);
  });

  it.skipIf(!available)("picks the order's delivery band from its lines' summed weight; past 30 kg it is left to quote", async () => {
    // 299 boxes of 0.1 kg: 29.9 kg, the 10–30 band.
    const near = await post('banded_orders', order([[3, 299]]));
    expect(near.statusCode, near.body).toBe(201);
    expect(num(tree(near).data['weight'])).toBe(29.9);
    expect(num(tree(near).data['band_id'])).toBe(3);
    expect(cents(tree(near).data['delivery_price'])).toBe('16.40');
    expect(cents(tree(near).data['total'])).toBe('614.40');
    // 301: 30.1 kg, past every band. The link is empty, the price empty, the total the goods alone.
    const over = await post('banded_orders', order([[3, 301]]));
    expect(over.statusCode, over.body).toBe(201);
    expect(tree(over).data['band_id']).toBeNull();
    expect(tree(over).data['delivery_price']).toBeNull();
    expect(cents(tree(over).data['total'])).toBe('602.00');
    const row = await stored('orders', tree(over).data['id']);
    expect(row['band_id']).toBeNull();
    expect(row['delivery_price']).toBeNull();
    // Exactly on a bound: 2 kg is the 2–10 band (the greatest lower bound at or below), 30 kg the top band, inside it.
    const two = await post('banded_orders', order([[3, 20]]));
    expect(num(tree(two).data['band_id'])).toBe(2);
    const thirty = await post('banded_orders', order([[3, 300]]));
    expect(num(tree(thirty).data['band_id'])).toBe(3);
  });

  it.skipIf(!available)('refuses a crate past its top band with out-of-range, and writes nothing', async () => {
    const before = Number((await h.rows(`select count(*) as n from ${h.real('crates')}`))[0]!['n']);
    const res = await post('banded_crates', { values: { label: 'Heavy' }, children: { crate_items: [{ values: { kg_each: 10.1, count: 3 } }] } });
    expect(res.statusCode, res.body).toBe(400);
    expect(error(res).params).toMatchObject({ column: 'weight', reason: 'out-of-range' });
    expect(Number((await h.rows(`select count(*) as n from ${h.real('crates')}`))[0]!['n'])).toBe(before);
    // The quote refuses it the same way.
    const quote = await post('banded_crates/dry-run', { values: { label: 'Heavy' }, children: { crate_items: [{ values: { kg_each: 10.1, count: 3 } }] } });
    expect(quote.statusCode, quote.body).toBe(400);
    expect(error(quote).params).toMatchObject({ column: 'weight', reason: 'out-of-range' });
    // Within the band it goes through.
    const ok = await post('banded_crates', { values: { label: 'Fine' }, children: { crate_items: [{ values: { kg_each: 9.9, count: 3 } }] } });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(num(tree(ok).data['band_id'])).toBe(3);
    expect(cents(tree(ok).data['delivery_price'])).toBe('16.40');
    // The charge over the delivery is worked out again in the same settle.
    expect(cents((await stored('crates', tree(ok).data['id']))['charge'])).toBe('18.90');
  });

  it.skipIf(!available)('refuses staff a crate item that takes its crate past the top band, and keeps the item out', async () => {
    const crate = await w.create('crates', { label: 'Desk' });
    await w.create('crate_items', { crate_id: crate['id'], kg_each: 9, count: 3 });
    expect(num((await stored('crates', crate['id']))['band_id'])).toBe(3);
    // A line added by staff: the charge over the delivery the band copied is worked out again in the same write.
    expect(cents((await stored('crates', crate['id']))['charge'])).toBe('18.90');
    const refused = await w.create('crate_items', { crate_id: crate['id'], kg_each: 4, count: 1 }).then(
      () => null,
      (error: unknown) => error as { code?: string; details?: { fields?: Record<string, { code: string }> } },
    );
    expect(refused?.code).toBe('VALIDATION_FAILED');
    expect(refused?.details?.fields).toEqual({ weight: { code: 'out-of-range' } });
    const row = await stored('crates', crate['id']);
    expect([num(row['weight']), num(row['band_id'])]).toEqual([27, 3]);
    expect(Number((await h.rows(`select count(*) as n from ${h.real('crate_items')} where crate_id = ${String(crate['id'])}`))[0]!['n'])).toBe(1);
  });

  it.skipIf(!available)("picks a crate item's size from a formula of the item, and again when it changes", async () => {
    const res = await post('banded_crates', { values: { label: 'Mixed' }, children: { crate_items: [{ values: { kg_each: 1, count: 2 } }, { values: { kg_each: 2.5, count: 2 } }, { values: { kg_each: 7, count: 3 } }] } });
    expect(res.statusCode, res.body).toBe(201);
    const items = tree(res).children['crate_items']!.map((item) => item.data);
    expect(items.map((item) => [num(item['weight']), num(item['size_id']), item['size']])).toEqual([
      [2, 1, 'S'],
      [5, 2, 'M'],
      [21, 3, 'L'],
    ]);
    // Staff change the count: the size follows the weight.
    await w.update('crate_items', items[2]!['id'], { count: 1 });
    const row = await stored('crate_items', items[2]!['id']);
    expect([num(row['weight']), num(row['size_id']), row['size']]).toEqual([7, 2, 'M']);
  });

  it.skipIf(!available)('moves the band and the delivery price when staff add a line that takes the order from 9 kg to 11 kg, and back when it goes', async () => {
    const made = await post('banded_orders', order([[3, 90]]));
    expect(made.statusCode, made.body).toBe(201);
    const key = tree(made).data['id'];
    expect(num(tree(made).data['band_id'])).toBe(2);
    expect(cents(tree(made).data['total'])).toBe('189.00');
    const line = await w.create('lines', { order_id: key, product_id: 3, qty: 20 });
    let row = await stored('orders', key);
    expect(num(row['weight'])).toBe(11);
    expect(num(row['band_id'])).toBe(3);
    expect(cents(row['delivery_price'])).toBe('16.40');
    // 220.00 of paper and 16.40 delivery.
    expect(cents(row['total'])).toBe('236.40');
    // The line goes again: back to 9 kg, the 2–10 band.
    await w.writes.delete({ target: w.targetOf('lines'), pk: { id: line['id'] }, context: w.desk, announce: async () => {} });
    row = await stored('orders', key);
    expect(num(row['weight'])).toBe(9);
    expect(num(row['band_id'])).toBe(2);
    expect(cents(row['total'])).toBe('189.00');
  });

  it.skipIf(!available)("moves a line's break when staff change its quantity, and drops a link staff send", async () => {
    const made = await post('banded_orders', order([[1, 3]]));
    const line = tree(made).children['lines']![0]!.data;
    await w.update('lines', line['id'], { qty: 8 });
    let row = await stored('lines', line['id']);
    expect(num(row['break_id'])).toBe(3);
    expect(cents(row['line_total'])).toBe('27.20');
    // A link staff send is not theirs to write: the band picks it.
    await w.update('lines', line['id'], { break_id: 1, qty: 12 });
    row = await stored('lines', line['id']);
    expect(num(row['break_id'])).toBe(4);
    await w.update('lines', line['id'], { break_id: 1 });
    row = await stored('lines', line['id']);
    expect(num(row['break_id'])).toBe(4);
    const parent = await stored('orders', tree(made).data['id']);
    expect(cents(parent['subtotal'])).toBe('38.40');
    // The line becomes a sign, which has no breaks: the link empties, and the multiplier copied through it with it.
    await w.update('lines', line['id'], { product_id: 2 });
    row = await stored('lines', line['id']);
    expect([row['break_id'], row['multiplier'], cents(row['line_total'])]).toEqual([null, null, '240.00']);
  });

  it.skipIf(!available)('refuses a guest who names the link, on the order and on a line, as it refuses a lookup', async () => {
    const onOrder = await post('banded_orders', order([[1, 3]], { values: { band_id: 1 } }));
    expect(onOrder.statusCode, onOrder.body).toBe(400);
    const onLine = await post('banded_orders', order([[1, 3]], { line: { break_id: 1 } }));
    expect(onLine.statusCode, onLine.body).toBe(400);
  });

  it.skipIf(!available)('refuses an operator endpoint that lists the link as writable', async () => {
    const view = await loadSnapshotView(h.meta, h.connectionId);
    const def = (writable: string[]): PublicEndpointDefinition => ({
      path: '/lines',
      source: view.model.tables.find((table) => table.name === h.real('lines'))!.id,
      methods: ['GET', 'POST'],
      select: ['id', 'qty'],
      writable,
      filters: [],
      pagination: { default_limit: 20, max_limit: 200, order: 'id.desc' },
      auth: { role: 'anon' },
      rate_limit: { requests: 120, window: '1m' },
      response: { shape: 'object', envelope: 'data' },
    });
    const codes = (writable: string[]) => endpointIssues(def(writable), { ref: 'lines', view }).map((issue) => `${issue.code} ${issue.column ?? ''}`);
    expect(codes(['qty', 'break_id'])).toContain('ENDPOINT_WRITABLE_DECIDED break_id');
    expect(codes(['qty'])).not.toContain('ENDPOINT_WRITABLE_DECIDED qty');
  });

  it.skipIf(!available)('quotes the figures the save then stores', async () => {
    const body = order([[1, 11], [4, 250], [3, 95]]);
    const quote = await post('banded_orders/dry-run', body);
    expect(quote.statusCode, quote.body).toBe(200);
    const q = tree(quote);
    const saved = await post('banded_orders', { ...body, expect: { total: cents(q.data['total']) } });
    expect(saved.statusCode, saved.body).toBe(201);
    const s = tree(saved);
    const figures = (t: Tree) => [
      num(t.data['weight']),
      num(t.data['band_id']),
      cents(t.data['delivery_price']),
      cents(t.data['total']),
      t.children['lines']!.map((line) => [num(line.data['break_id']), cents(line.data['line_total'])]),
    ];
    expect(figures(q)).toEqual(figures(s));
    // 11 coasters (37.40), 250 flyers (75.00), 95 boxes (190.00); 0.55 + 0.25 + 9.5 = 10.3 kg, the 10–30 band.
    expect(figures(s)).toEqual([10.3, 3, '16.40', '318.80', [[3, '37.40'], [7, '75.00'], [null, '190.00']]]);
    const row = await stored('orders', s.data['id']);
    expect([num(row['band_id']), cents(row['total'])]).toEqual([3, '318.80']);
  });
});
