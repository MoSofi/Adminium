// SPDX-License-Identifier: AGPL-3.0-only
import { ADD_ON_INSTALL_FLOOR } from '../src/index.js';

/** A stock add-on with one table that carries rules, a generated page, a code page and a role. */
export const KIT = {
  kind: 'add-on',
  manifestVersion: 1,
  key: 'kit',
  name: 'Kit',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'kit.description', fallback: 'Keeps stock.' },
  categories: ['data'],
  compatibility: { minAdminiumVersion: ADD_ON_INSTALL_FLOOR },
  addOn: {
    attaches: [{ app: '*', range: '*' }],
    connect: { kind: 'none' },
    hostApi: 1,
    pages: [{ ref: 'kit-count', title: { key: 'kit.count', fallback: 'Count' }, icon: 'clipboard', client: 'pages/count.js' }],
  },
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'items',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'name', type: 'text', maxLength: 80 },
          { ref: 'sku', type: 'text', maxLength: 40, nullable: true, rules: { normalize: 'trim' } },
          { ref: 'on_hand', type: 'decimal', scale: 2, default: 0 },
        ],
      },
    ],
  },
  pages: [{ ref: 'kit-items', template: 'page-crud', title: { key: 'kit.items', fallback: 'Items' }, nav: { group: 'manage', icon: 'box', order: 1 }, bindings: { main: 'items' } }],
  roles: [{ key: 'manager', name: 'Stock manager', permissions: ['table:@items:read', 'table:@items:update', 'page:@kit-items:view', 'page:@kit-count:view', 'addOn:kit:settings'] }],
} as const;
