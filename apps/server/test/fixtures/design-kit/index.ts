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
 *
 * With `{ checker: true }` the kit also answers whether a design may be
 * ordered (`design-check@1`): a design's words fill the parts of a ready-made
 * design, each part with its most characters, and a logo is a paid feature.
 * Its deciding file is {@link DESIGN_CHECK_SERVER}; its settings row says how
 * it misbehaves, for the tests of a check that throws, is slow or answers
 * nonsense. A shop built with `{ check: true }` asks it of every line that
 * names a design, and keeps the features a line pays for as its child rows.
 */
const pk = { ref: 'id', type: 'int', role: 'pk' } as const;

export const DESIGN_KIT = 'design-kit';
export const DESIGN_KIT_FLOOR = '0.3.43';
/** The kit's entries, by the refs their endpoints are stored under. */
export const BASES_REF = 'design_kit_bases';
export const DESIGNS_REF = 'design_kit_designs';
export const READY_REF = 'design_kit_ready';

const IDENTITY = { manifestVersion: 1, publisher: { id: 'adminium', name: 'Adminium' }, license: 'MIT' } as const;

/**
 * The kit's deciding file: one classic script, as an add-on ships it. A part
 * longer than its most characters is `too-long`, an empty part that must be
 * filled `required-empty`; a logo file in the design uses the feature
 * `logo` (and one that is not there is `file-missing`). Its settings row's
 * `misbehave` makes it throw, loop past its time, answer in no shape, or
 * leave a line out.
 */
export const DESIGN_CHECK_SERVER = `'use strict';
module.exports = {
  check: function (input) {
    var how = input.settings.misbehave;
    if (how === 'throw') throw new Error('the kit broke');
    if (how === 'slow') { for (;;) {} }
    if (how === 'shape') return { lines: 'none' };
    if (how === 'skip') return { lines: [] };
    return {
      lines: input.lines.map(function (line) {
        var words = {};
        try { words = JSON.parse(line.design.words || '{}'); } catch (e) { words = {}; }
        var refusals = [];
        (line.rows.parts || []).forEach(function (part) {
          var text = words[part.name];
          if ((text === undefined || text === null || text === '') && part.required) refusals.push({ part: part.name, reason: 'required-empty' });
          else if (typeof text === 'string' && text.length > Number(part.max_chars)) refusals.push({ part: part.name, reason: 'too-long' });
        });
        var used = [];
        line.files.forEach(function (file) {
          if (file.column !== 'logo') return;
          if (file.size > 0) used.push('logo');
          else refusals.push({ part: 'logo', reason: 'file-missing' });
        });
        return { key: line.key, ok: refusals.length === 0, used: used, refusals: refusals };
      }),
    };
  },
};
`;

/** The kit's tables and words for checking a design, added to its manifest by `{ checker: true }`. */
function withChecker(manifest: Record<string, unknown>): Record<string, unknown> {
  const schema = manifest['requiredSchema'] as { tables: { ref: string; columns: unknown[] }[] };
  const tables = schema.tables.map((table) =>
    table.ref === 'designs'
      ? {
          ...table,
          columns: [
            ...table.columns,
            { ref: 'ready_id', type: 'fk', references: 'ready', nullable: true },
            { ref: 'words', type: 'json', nullable: true },
            { ref: 'logo', type: 'text', maxLength: 64, nullable: true, rules: { file: { accept: ['png'], maxBytes: 1048576 } } },
          ],
        }
      : table,
  );
  return {
    ...manifest,
    requiredSchema: {
      ...schema,
      tables: [
        ...tables,
        // The parts of a ready-made design: each with its most characters, and whether it must be filled.
        { ref: 'ready_parts', columns: [pk, { ref: 'ready_id', type: 'fk', references: 'ready' }, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'max_chars', type: 'int' }, { ref: 'required', type: 'bool', default: false }] },
        // How the kit's code misbehaves, for the tests that need it to.
        { ref: 'settings', columns: [pk, { ref: 'misbehave', type: 'text', maxLength: 20, nullable: true }] },
      ],
    },
    addOn: {
      ...(manifest['addOn'] as Record<string, unknown>),
      settingsTable: 'settings',
      provides: [{ contract: 'design-check', version: 1, server: 'dist/check.js' }],
      checker: {
        design: 'designs',
        reads: [
          { id: 'ready', table: 'ready', by: { column: 'id', from: 'design.ready_id' } },
          { id: 'parts', table: 'ready_parts', by: { column: 'ready_id', from: 'ready.id' } },
          { id: 'base', table: 'bases', by: { column: 'id', from: 'design.base_id' } },
        ],
      },
    },
  };
}

/** The id of the kit's panel on a record that links to one of its designs. */
export const DESIGN_PANEL = 'design-kit-editor';

/** The kit's panel, added by `{ panel: true }`: its own screen on the record page of an order line that links to a design. */
function withPanel(manifest: Record<string, unknown>): Record<string, unknown> {
  return {
    ...manifest,
    addOn: {
      ...(manifest['addOn'] as Record<string, unknown>),
      panels: [{ id: DESIGN_PANEL, on: 'designs', client: 'dist/panel.js', title: { key: 'design-kit.panel.title', fallback: 'Design' }, titles: { 'de-DE': 'Entwurf' } }],
    },
  };
}

/** The kit's package files beside its manifest: its deciding file, and its panel's code. */
export const DESIGN_KIT_FILES: Record<string, string> = {
  'dist/check.js': DESIGN_CHECK_SERVER,
  'dist/panel.js': 'export default function DesignPanel() { return null; }\n',
};

export function designKitManifest(over: Record<string, unknown> = {}, opts: { checker?: boolean; panel?: boolean } = {}): Record<string, unknown> {
  let made = designKitBase(over);
  if (opts.checker === true) made = withChecker(made);
  if (opts.panel === true) made = withPanel(made);
  return made;
}

function designKitBase(over: Record<string, unknown>): Record<string, unknown> {
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

/**
 * The shop's design rule and the table of features a line pays for, added by
 * `{ check: true }`: a line that names a design is asked about; a guest's
 * order carries each line's paid features as rows under it.
 */
function withCheck(manifest: Record<string, unknown>): Record<string, unknown> {
  const schema = manifest['requiredSchema'] as { tables: Record<string, unknown>[] };
  const tables = schema.tables.map((table) =>
    table['ref'] === 'order_lines' ? { ...table, check: { by: { addOn: DESIGN_KIT }, design: 'design_id', paid: { table: 'line_features', via: 'line_id', feature: 'feature' } } } : table,
  );
  const entries = (manifest['publicAccess'] as Record<string, unknown>[]).map((entry) => {
    if (entry['table'] !== 'orders') return entry;
    const children = entry['children'] as { order_lines: Record<string, unknown> };
    return {
      ...entry,
      dryRun: true,
      children: { order_lines: { ...children.order_lines, children: { line_features: { via: 'line_id', writable: ['feature'], select: ['id', 'feature'], max: 4 } } } },
    };
  });
  return {
    ...manifest,
    requiredSchema: { ...schema, tables: [...tables, { ref: 'line_features', columns: [pk, { ref: 'line_id', type: 'fk', references: 'order_lines' }, { ref: 'feature', type: 'text', maxLength: 40 }] }] },
    publicAccess: entries,
  };
}

/** A shop that sells products in orders whose lines may name a design of the kit by its code. */
export function designShopManifest(key: 'printing' | 'maker', over: Record<string, unknown> = {}, opts: { check?: boolean } = {}): Record<string, unknown> {
  const made = designShopBase(key, over);
  return opts.check === true ? withCheck(made) : made;
}

function designShopBase(key: 'printing' | 'maker', over: Record<string, unknown>): Record<string, unknown> {
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
