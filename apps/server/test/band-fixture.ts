// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A shop whose prices fall in bands: a line's quantity among its product's
 * price breaks (coasters 1/4/8/12, flyers 1/25/250/1000, a sign with none),
 * and an order's delivery band by the weight its lines add up to (0–2,
 * 2–10, 10–30 kg; past 30 kg the delivery is quoted by hand). A crate whose
 * weight is past its top band is refused instead, and a crate item's size is
 * picked from a formula of the item. Installed by the real installer.
 */
import { installInvoicing, invoicingManifest, type Dialect, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });
const money = (ref: string, rules?: Record<string, unknown>) => ({ ref, type: 'decimal', scale: 2, nullable: true, ...(rules === undefined ? {} : { rules }) });
const kg = (ref: string, rules?: Record<string, unknown>) => ({ ref, type: 'decimal', scale: 3, nullable: true, ...(rules === undefined ? {} : { rules }) });
const fk = (ref: string, references: string, more: Record<string, unknown> = {}) => ({ ref, type: 'fk', references, ...more });

/** The quantity break a line falls in: its own product's breaks only. */
export const BREAK = { table: 'breaks', min: 'min_qty', value: 'qty', scope: [{ column: 'product_id', equals: 'product_id' }] };
/** The delivery band an order's weight falls in; past the top one, quoted by hand. */
export const WEIGHT_BAND = { table: 'weight_bands', min: 'min_kg', max: 'max_kg', value: 'weight', over: 'empty' };

export function bandShopManifest(): Record<string, unknown> {
  const manifest = invoicingManifest([
    { ref: 'products', columns: [id, text('name'), money('price'), kg('weight_kg')] },
    { ref: 'breaks', columns: [id, fk('product_id', 'products'), { ref: 'min_qty', type: 'int' }, { ref: 'multiplier', type: 'decimal', scale: 4 }] },
    { ref: 'weight_bands', columns: [id, text('name', 40), kg('min_kg'), kg('max_kg'), money('price')] },
    {
      ref: 'orders',
      columns: [
        id,
        text('email', 254),
        kg('weight', { rollup: { from: 'lines', via: 'order_id', sum: 'weight' } }),
        fk('band_id', 'weight_bands', { nullable: true, rules: { band: WEIGHT_BAND } }),
        money('delivery_price', { copy: { via: 'band_id', from: 'price', mode: 'always' } }),
        money('subtotal', { rollup: { from: 'lines', via: 'order_id', sum: 'line_total' } }),
        money('total', { formula: { add: [{ coalesce: ['subtotal', 0] }, { coalesce: ['delivery_price', 0] }] } }),
      ],
    },
    {
      ref: 'lines',
      columns: [
        id,
        fk('order_id', 'orders'),
        fk('product_id', 'products'),
        { ref: 'qty', type: 'int', rules: { validation: { min: 1, max: 5000 } } },
        money('unit_price', { copy: { via: 'product_id', from: 'price', mode: 'always' } }),
        kg('unit_weight', { copy: { via: 'product_id', from: 'weight_kg', mode: 'always' } }),
        fk('break_id', 'breaks', { nullable: true, rules: { band: BREAK } }),
        { ref: 'multiplier', type: 'decimal', scale: 4, nullable: true, rules: { copy: { via: 'break_id', from: 'multiplier', mode: 'always' } } },
        money('line_total', { formula: { round: [{ mul: [{ coalesce: ['unit_price', 0] }, 'qty', { coalesce: ['multiplier', 1] }] }, 2] } }),
        kg('weight', { formula: { mul: ['qty', { coalesce: ['unit_weight', 0] }] } }),
      ],
    },
    { ref: 'sizes', columns: [id, text('label', 20), kg('min_kg')] },
    {
      ref: 'crates',
      columns: [
        id,
        text('label', 40),
        kg('weight', { rollup: { from: 'crate_items', via: 'crate_id', sum: 'weight' } }),
        fk('band_id', 'weight_bands', { nullable: true, rules: { band: { ...WEIGHT_BAND, over: 'refuse' } } }),
        money('delivery_price', { copy: { via: 'band_id', from: 'price', mode: 'always' } }),
        // The crate's charge: its delivery and a handling fee, worked out again when the band moves its delivery.
        money('charge', { formula: { add: [{ coalesce: ['delivery_price', 0] }, 2.5] } }),
      ],
    },
    {
      ref: 'crate_items',
      columns: [
        id,
        fk('crate_id', 'crates'),
        kg('kg_each', { validation: { min: 0, max: 100 } }),
        { ref: 'count', type: 'int', default: 1, rules: { validation: { min: 1, max: 50 } } },
        kg('weight', { formula: { mul: [{ coalesce: ['kg_each', 0] }, 'count'] } }),
        // A size picked from a formula of the item itself.
        fk('size_id', 'sizes', { nullable: true, rules: { band: { table: 'sizes', min: 'min_kg', value: 'weight' } } }),
        text('size', 20),
      ],
    },
  ]);
  const crateItems = ((manifest['requiredSchema'] as { tables: { ref: string; columns: Record<string, unknown>[] }[] }).tables.find((t) => t.ref === 'crate_items'))!;
  crateItems.columns.find((c) => c['ref'] === 'size')!['rules'] = { copy: { via: 'size_id', from: 'label', mode: 'always' } };
  manifest['key'] = 'banded';
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'orders' };
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  manifest['publicAccess'] = [
    { table: 'products', methods: ['GET'], select: ['id', 'name', 'price'] },
    {
      table: 'orders',
      methods: ['POST'],
      writable: ['email'],
      humanCheck: true,
      select: ['id', 'weight', 'band_id', 'delivery_price', 'subtotal', 'total'],
      children: {
        lines: { via: 'order_id', writable: ['product_id', 'qty'], select: ['id', 'break_id', 'multiplier', 'line_total', 'weight'], min: 1, max: 20 },
      },
      dryRun: true,
      expect: 'total',
    },
    {
      table: 'crates',
      methods: ['POST'],
      writable: ['label'],
      humanCheck: true,
      select: ['id', 'weight', 'band_id', 'delivery_price'],
      children: { crate_items: { via: 'crate_id', writable: ['kg_each', 'count'], select: ['id', 'weight', 'size_id', 'size'], min: 1, max: 20 } },
      dryRun: true,
    },
  ];
  return manifest;
}

/** The products, their breaks, the delivery bands and the crate sizes. */
export async function bandShop(dialect: Dialect, manifest: Record<string, unknown> = bandShopManifest()): Promise<InvoicingHarness & { reply: Record<string, unknown> }> {
  const h = await installInvoicing(dialect, manifest);
  await h.rows(
    `INSERT INTO ${h.real('products')} (id, name, price, weight_kg) VALUES ` +
      `(1, 'Coaster', 4.00, 0.050), (2, 'Sign', 20.00, 0.500), (3, 'Box of paper', 2.00, 0.100), (4, 'Flyer', 0.50, 0.001)`,
  );
  await h.rows(
    `INSERT INTO ${h.real('breaks')} (id, product_id, min_qty, multiplier) VALUES ` +
      `(1, 1, 1, 1.0000), (2, 1, 4, 0.9000), (3, 1, 8, 0.8500), (4, 1, 12, 0.8000), ` +
      `(5, 4, 1, 1.0000), (6, 4, 25, 0.8000), (7, 4, 250, 0.6000), (8, 4, 1000, 0.4000)`,
  );
  await h.rows(`INSERT INTO ${h.real('weight_bands')} (id, name, min_kg, max_kg, price) VALUES (1, 'Small', 0, 2, 4.50), (2, 'Medium', 2, 10, 9.00), (3, 'Large', 10, 30, 16.40)`);
  await h.rows(`INSERT INTO ${h.real('sizes')} (id, label, min_kg) VALUES (1, 'S', 0), (2, 'M', 5), (3, 'L', 20)`);
  // Rows written with their ids: Postgres's counters are moved past them.
  if (dialect === 'postgres') {
    for (const ref of ['products', 'breaks', 'weight_bands', 'sizes']) {
      await h.rows(`SELECT setval(pg_get_serial_sequence('${h.real(ref)}', 'id'), (SELECT max(id) FROM ${h.real(ref)}))`);
    }
  }
  return h;
}
