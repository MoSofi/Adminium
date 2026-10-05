// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A small add-on that installs like an app and uses none of the rules a
 * ledger needs: tables with ordinary column rules (a capped balance, a list
 * of choices), a generated page, a screen of its own, two roles and an
 * option list. What the install's writers are tested on.
 */
const pk = { ref: 'id', type: 'int', role: 'pk' } as const;

export function stockKitManifest(): Record<string, unknown> {
  return {
    kind: 'add-on',
    manifestVersion: 1,
    key: 'stock-kit',
    name: 'Stock kit',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'stock.description', fallback: 'Keeps stock.' },
    categories: ['data'],
    compatibility: { minAdminiumVersion: '0.3.18' },
    addOn: {
      attaches: [{ app: '*', range: '*' }],
      connect: { kind: 'none' },
      hostApi: 1,
      pages: [{ ref: 'stock-kit-count', title: { key: 'stock.count', fallback: 'Count' }, icon: 'clipboard', client: 'dist/client.js' }],
    },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'items',
          columns: [
            pk,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'zone', type: 'text', maxLength: 32, nullable: true, rules: { options: { list: 'zones' } } },
            { ref: 'opening', type: 'decimal', scale: 2, default: 0 },
            // What was taken, never more than was there.
            { ref: 'taken', type: 'decimal', scale: 2, default: 0, rules: { rollup: { from: 'takes', via: 'item_id', sum: 'qty', cap: true, balance: { column: 'left', of: 'opening' } } } },
            { ref: 'left', type: 'decimal', scale: 2, default: 0 },
          ],
        },
        {
          ref: 'takes',
          columns: [pk, { ref: 'item_id', type: 'fk', references: 'items' }, { ref: 'qty', type: 'decimal', scale: 2, default: 1 }],
        },
      ],
    },
    optionLists: { zones: { label: { 'en-US': 'Zones' }, values: [{ value: 'shelf', label: 'Shelf' }, { value: 'cellar' }] } },
    pages: [{ ref: 'stock-kit-items', template: 'page-crud', title: { key: 'stock.items', fallback: 'Items' }, nav: { group: 'manage', icon: 'box', order: 1 }, bindings: { main: 'items' } }],
    roles: [
      { key: 'manager', name: 'Stock manager', permissions: ['table:@items:read', 'table:@items:update', 'table:@takes:read', 'table:@takes:create', 'page:@stock-kit-items:view', 'page:@stock-kit-count:view', 'addOn:stock-kit:settings'] },
      { key: 'reader', name: 'Stock reader', permissions: ['table:@items:read', 'page:@stock-kit-items:view'] },
    ],
  };
}
