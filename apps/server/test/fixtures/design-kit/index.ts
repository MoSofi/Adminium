// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SMALL ADD-ON A SHOPPER DESIGNS WITH, AND TWO SHOPS THAT BIND IT.
 *
 * The kit keeps bases (what a design starts from) and designs (a shopper's
 * own, with personal words in `name_text` and a secret `code`). Its public
 * entries ride each app's own key, held to that app's rows by the `app`
 * column (`appColumn`). A design never ordered is let go 90 days after its
 * last change (`expire`).
 *
 * Each shop (`printing`, `maker`) sells products in orders with lines; a line
 * names the design it was made from by a link into the kit's designs
 * (`addOnLink`), filled only from the design's code the guest types
 * (`lookup`). A shop's customers are its people; a line's design holds a copy
 * of the customer's words, reached through the line's link.
 */
const pk = { ref: 'id', type: 'int', role: 'pk' } as const;

export const DESIGN_KIT = 'design-kit';
export const DESIGN_KIT_FLOOR = '0.3.43';
/** The kit's entries, by the refs their endpoints are stored under. */
export const BASES_REF = 'design_kit_bases';
export const DESIGNS_REF = 'design_kit_designs';
export const READY_REF = 'design_kit_ready';

const IDENTITY = { manifestVersion: 1, publisher: { id: 'adminium', name: 'Adminium' }, license: 'MIT' } as const;

export function designKitManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...IDENTITY,
    kind: 'add-on',
    key: DESIGN_KIT,
    name: 'Design kit',
    version: '1.0.0',
    description: { key: 'design-kit.description', fallback: 'Designs a shopper makes.' },
    categories: ['data'],
    compatibility: { minAdminiumVersion: DESIGN_KIT_FLOOR },
    addOn: { attaches: [{ app: 'printing', range: '*' }, { app: 'maker', range: '*' }], connect: { kind: 'none' } },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'bases',
          columns: [pk, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'app', type: 'text', maxLength: 32, nullable: true }],
        },
        {
          ref: 'designs',
          columns: [
            pk,
            { ref: 'code', type: 'text', maxLength: 24, rules: { code: { length: 16 } } },
            { ref: 'app', type: 'text', maxLength: 32, nullable: true },
            { ref: 'base_id', type: 'fk', references: 'bases', nullable: true },
            { ref: 'state', type: 'enum', enum: ['draft', 'ordered'], default: 'draft' },
            { ref: 'name_text', type: 'text', maxLength: 80, nullable: true },
            { ref: 'updated_at', type: 'timestamptz', nullable: true },
          ],
          expire: { after: 'updated_at', days: 90, unless: { column: 'state', equals: 'ordered' } },
        },
        // Ready-made designs a shop offers. A table anyone may add to is never one anyone may read: these live apart.
        {
          ref: 'ready',
          columns: [pk, { ref: 'title', type: 'text', maxLength: 80 }, { ref: 'app', type: 'text', maxLength: 32, nullable: true }],
        },
      ],
    },
    publicAccess: [
      // The bases a shop offers: each app reads its own.
      { table: 'bases', methods: ['GET'], select: ['id', 'name'], appColumn: 'app' },
      { table: 'ready', methods: ['GET'], select: ['id', 'title'], appColumn: 'app' },
      // A shopper saves a design; its code comes back, to be typed on an order's line.
      { table: 'designs', methods: ['POST'], writable: ['base_id', 'name_text'], select: ['id', 'code'], humanCheck: true, appColumn: 'app' },
    ],
    ...over,
  };
}

/** A shop that sells products in orders whose lines may name a design of the kit by its code. */
export function designShopManifest(key: 'printing' | 'maker', over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...IDENTITY,
    kind: 'app',
    key,
    name: key === 'printing' ? 'Print shop' : 'Maker shop',
    version: '1.0.0',
    description: { key: `mft.${key}.desc`, fallback: 'A shop.' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: DESIGN_KIT_FLOOR, engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'customers', keyField: 'name', columns: [pk, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'email', type: 'text', maxLength: 120, nullable: true }] },
        { ref: 'products', columns: [pk, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'price', type: 'decimal', scale: 2, default: 0 }] },
        {
          ref: 'orders',
          columns: [
            pk,
            { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
            { ref: 'name', type: 'text', maxLength: 80, nullable: true },
            { ref: 'email', type: 'text', maxLength: 120, nullable: true },
          ],
        },
        {
          ref: 'order_lines',
          columns: [
            pk,
            { ref: 'order_id', type: 'fk', references: 'orders' },
            { ref: 'product_id', type: 'fk', references: 'products', nullable: true },
            { ref: 'qty', type: 'int', default: 1 },
            { ref: 'design_code', type: 'text', maxLength: 40, nullable: true },
            {
              ref: 'design_id',
              type: 'int',
              nullable: true,
              rules: {
                addOnLink: { addOn: DESIGN_KIT, table: 'designs' },
                lookup: { from: 'design_code', table: { addOn: DESIGN_KIT, table: 'designs' }, column: 'code' },
              },
            },
          ],
        },
      ],
    },
    pages: [{ ref: `${key}-home`, template: 'page-dashboard', title: { key: `mft.${key}.page.home`, fallback: 'Home' }, nav: { group: 'manifest:sample', icon: 'layout-dashboard', order: 1 } }],
    frontends: [
      { side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } },
      { side: 'customer', kind: 'spa', entry: 'index.html', routes: { shop: '/' } },
    ],
    addOns: { requires: [{ key: DESIGN_KIT, range: '^1.0.0', reason: { 'en-US': 'Shoppers design their products.' } }] },
    people: [
      {
        table: 'customers',
        kind: 'people',
        email: 'email',
        name: 'name',
        copies: [
          { table: 'orders', column: 'email', holds: 'email', via: 'customer_id' },
          { table: 'orders', column: 'name', holds: 'name', via: 'customer_id' },
          { addOn: DESIGN_KIT, table: 'designs', column: 'name_text', holds: 'name', via: 'order_lines.design_id' },
        ],
      },
    ],
    publicAccess: [
      { table: 'products', methods: ['GET'], select: ['id', 'name', 'price'] },
      {
        table: 'orders',
        methods: ['POST'],
        writable: ['name', 'email'],
        humanCheck: true,
        select: ['id'],
        children: { order_lines: { via: 'order_id', writable: ['product_id', 'qty', 'design_code'], select: ['id', 'design_id'], min: 1, max: 12 } },
      },
    ],
    ...over,
  };
}
