// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A small add-on that keeps a ledger, and an app whose orders post into it:
 * what the ledger and posting checks are run against.
 */
import { ADD_ON_INSTALL_FLOOR } from '../src/index.js';

const pk = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, extra: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, ...extra });

/** The receipt table, as Adminium writes one. */
export const RECEIPTS = {
  ref: 'postings',
  columns: [
    pk,
    text('source_table', 128, { rules: { tableRef: true } }),
    text('source_row', 64),
    text('source_line', 64),
    text('line_table', 128, { rules: { tableRef: true } }),
    text('ledger', 40),
    text('action', 40),
    text('posting', 40),
    { ref: 'phase', type: 'enum', enum: ['reserve', 'post', 'reverse'] },
    { ref: 'round', type: 'int' },
    { ref: 'state', type: 'enum', enum: ['planned', 'unplanned'] },
    { ref: 'rows', type: 'int' },
    text('add_on_version', 40),
    { ref: 'origin', type: 'enum', enum: ['staff', 'public', 'system'] },
    text('by', 64),
    { ref: 'at', type: 'timestamptz' },
    { ref: 'held_until', type: 'timestamptz', nullable: true },
  ],
};

export const LEDGER = {
  id: 'units',
  receipts: 'postings',
  refusal: 'stock',
  writes: {
    entries: { insert: ['account_id', 'amount', 'kind', 'note'] },
    holds: { insert: ['account_id', 'amount', 'state'], update: { by: ['id'], set: ['state'] } },
  },
  actions: {
    use: {
      inputs: { account: 'link', quantity: 'decimal', note: 'text?' },
      phases: ['reserve', 'post', 'reverse'],
      reads: [
        { as: 'accounts', table: 'accounts', by: [{ column: 'id', from: 'input.account' }] },
        { as: 'mine', table: 'holds', by: [{ column: 'receipt_id', from: 'receipt.id' }] },
      ],
      locks: [{ read: 'accounts', column: 'id', table: 'accounts' }],
      holds: true,
      unavailable: { allow: { read: 'accounts', column: 'allow_below' } },
    },
    count: {
      inputs: { account: 'link', quantity: 'decimal' },
      phases: ['post', 'reverse'],
      reads: [{ as: 'accounts', table: 'accounts', by: [{ column: 'id', from: 'input.account' }] }],
      locks: [{ read: 'accounts', column: 'id', table: 'accounts' }],
      writes: ['entries'],
    },
  },
};

export const LEDGER_KIT = {
  kind: 'add-on',
  manifestVersion: 1,
  key: 'ledger-kit',
  name: 'Ledger kit',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'kit.description', fallback: 'Keeps units.' },
  categories: ['data'],
  compatibility: { minAdminiumVersion: ADD_ON_INSTALL_FLOOR },
  addOn: {
    attaches: [{ app: '*', range: '*' }],
    connect: { kind: 'none' },
    provides: [{ contract: 'posting-rows', version: 1, server: 'dist/server.js' }],
    ledgers: [LEDGER],
  },
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'accounts',
        columns: [
          pk,
          text('name', 80),
          { ref: 'opening', type: 'decimal', scale: 3, default: 0 },
          { ref: 'taken', type: 'decimal', scale: 3, default: 0, rules: { rollup: { from: 'entries', via: 'account_id', sum: 'amount', cap: true, capUnless: { column: 'allow_below' }, balance: { column: 'balance', of: 'opening' } } } },
          { ref: 'balance', type: 'decimal', scale: 3, default: 0 },
          { ref: 'allow_below', type: 'bool', default: false },
          { ref: 'reorder_at', type: 'decimal', scale: 3, default: 0 },
          { ref: 'low', type: 'int', nullable: true, rules: { formula: { if: [{ lte: ['balance', 'reorder_at'] }, 1, 0] }, announce: true } },
        ],
      },
      {
        ref: 'entries',
        columns: [
          pk,
          { ref: 'account_id', type: 'fk', references: 'accounts', index: true },
          { ref: 'amount', type: 'decimal', scale: 3 },
          text('kind', 20, { nullable: true }),
          text('note', 200, { nullable: true }),
          { ref: 'receipt_id', type: 'fk', references: 'postings', nullable: true },
        ],
      },
      {
        ref: 'holds',
        columns: [
          pk,
          { ref: 'account_id', type: 'fk', references: 'accounts' },
          { ref: 'amount', type: 'decimal', scale: 3 },
          { ref: 'state', type: 'enum', enum: ['held', 'taken', 'released'], default: 'held' },
          { ref: 'receipt_id', type: 'fk', references: 'postings', nullable: true },
        ],
      },
      RECEIPTS,
      {
        ref: 'requests',
        states: { column: 'status', initial: 'draft', moves: { draft: ['sent', 'cancelled'], sent: ['done', 'cancelled'], done: [{ to: 'filed', planned: true }] } },
        postings: [
          {
            id: 'request',
            into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' },
            reserve: { on: { to: ['sent'] } },
            post: { on: { to: ['done'] } },
            reverse: { on: { to: ['cancelled'], from: ['sent'] } },
            map: { account: 'account_id', quantity: 'quantity' },
            heldUntil: 'hold_until',
          },
        ],
        columns: [
          pk,
          { ref: 'status', type: 'enum', enum: ['draft', 'sent', 'done', 'filed', 'cancelled'], default: 'draft' },
          { ref: 'account_id', type: 'fk', references: 'accounts' },
          { ref: 'quantity', type: 'decimal', scale: 3 },
          { ref: 'hold_until', type: 'timestamptz', nullable: true },
        ],
      },
    ],
  },
} as const;

/** An app whose order lines post into the kit's ledger through their order. */
export const LEDGER_HOST = {
  kind: 'app',
  manifestVersion: 1,
  key: 'ledger-host',
  name: 'Ledger host',
  version: '0.3.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'host.description', fallback: 'Takes orders.' },
  categories: ['commerce'],
  compatibility: { minAdminiumVersion: ADD_ON_INSTALL_FLOOR },
  pages: [{ ref: 'orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
  frontends: [{ side: 'staff', kind: 'none' }],
  addOns: {
    suggests: [{ key: 'ledger-kit', range: '>=1.0.0', reason: { 'en-US': 'Keeps units.' } }],
    features: [{ id: 'units', label: { 'en-US': 'Units' }, requires: ['ledger-kit'] }],
  },
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'orders',
        states: { column: 'status', initial: 'placed', moves: { placed: ['ready', 'cancelled'], ready: ['picked_up', 'cancelled'], picked_up: ['ready'] } },
        columns: [
          pk,
          { ref: 'status', type: 'enum', enum: ['placed', 'ready', 'picked_up', 'cancelled'], default: 'placed' },
          { ref: 'hold_until', type: 'timestamptz', nullable: true },
          text('buyer_email', 200, { nullable: true }),
          text('buyer_key', 64, { nullable: true, rules: { customerKey: { of: 'buyer_email' } } }),
        ],
      },
      {
        ref: 'order_lines',
        postings: [
          {
            id: 'line',
            into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' },
            needs: 'units',
            via: 'order_id',
            reserve: { on: { create: true } },
            post: { on: { to: ['picked_up'] } },
            reverse: { on: { to: ['cancelled'], from: ['placed', 'ready'] } },
            map: { account: 'account_id', quantity: 'qty' },
            heldUntil: { parent: 'hold_until' },
            unlessSet: 'voided_at',
          },
        ],
        columns: [
          pk,
          { ref: 'order_id', type: 'fk', references: 'orders' },
          { ref: 'account_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'ledger-kit', table: 'accounts' } } },
          { ref: 'qty', type: 'decimal', scale: 3, default: 1 },
          { ref: 'voided_at', type: 'timestamptz', nullable: true },
          text('buyer_note', 200, { nullable: true, rules: { plainText: { digits: 4, max: 80 } } }),
        ],
      },
      {
        ref: 'visits',
        postings: [
          {
            id: 'visit',
            into: { addOn: 'ledger-kit', ledger: 'units', action: 'count' },
            post: { on: { column: 'status', in: ['seen'] } },
            reverse: { on: { column: 'voided_at', set: true } },
            map: { account: 'account_id', quantity: { value: '1' } },
          },
        ],
        columns: [
          pk,
          text('status', 20, { default: 'booked' }),
          { ref: 'account_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'ledger-kit', table: 'accounts' } } },
          { ref: 'voided_at', type: 'timestamptz', nullable: true },
        ],
      },
    ],
  },
} as const;
