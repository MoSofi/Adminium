// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A small shop whose orders have buttons, installed for real: every form a
 * record page's action takes (a move with a time it sets and a value it asks
 * for, a write that moves nothing, a link to a page, a small form adding a
 * child row), a move kept for one role, a move only a ledger makes, a lock
 * that lets the action's columns through, and lines tied to the order's state.
 */
const id = { ref: 'id', type: 'int', role: 'pk' };

export type Doc = Record<string, unknown>;

export const ORDER_ACTIONS = [
  { id: 'send', label: { 'en-US': 'Send', 'de-DE': 'Senden' }, move: { to: 'sent' }, tone: 'primary', confirm: 'Send this order?', set: { sent_at: { now: true }, no_email: true } },
  { id: 'close', label: 'Close', move: { to: 'done' }, ask: ['reason'] },
  { id: 'cancel', label: 'Cancel', move: { to: 'cancelled' }, tone: 'danger', confirm: 'Cancel it?' },
  { id: 'settle', label: 'Settle', move: { to: 'settled' } },
  { id: 'send-again', label: 'Send again', set: { resent_at: { now: true }, resends: 1 }, in: ['sent'], ask: ['note'] },
  { id: 'open', label: 'Open the list', link: { page: 'shop-orders', param: 'order' }, in: ['sent', 'done'] },
  { id: 'add-line', label: 'Add a line', child: { table: 'order_lines', via: 'order_id', form: ['qty'] }, set: { kind: 'extra' }, in: ['draft', 'sent'] },
];

export function shopManifest(change?: (doc: { requiredSchema: { tables: Doc[] }; roles: Doc[] }) => void): Doc {
  const doc = {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A shop.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.18' },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'orders',
          columns: [
            id,
            { ref: 'customer', type: 'text', maxLength: 60 },
            { ref: 'status', type: 'enum', enum: ['draft', 'sent', 'done', 'cancelled', 'settled'], default: 'draft' },
            { ref: 'note', type: 'text', maxLength: 200, nullable: true },
            { ref: 'reason', type: 'text', maxLength: 200, nullable: true },
            { ref: 'no_email', type: 'bool', default: false },
            { ref: 'resends', type: 'int', default: 0 },
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
            { ref: 'resent_at', type: 'timestamptz', nullable: true },
          ],
          states: {
            column: 'status',
            initial: 'draft',
            moves: {
              draft: ['sent', 'cancelled'],
              sent: [{ to: 'done', roles: ['manager'] }, { to: 'cancelled', requires: { children: { order_lines: 1 } } }, { to: 'settled', planned: true }],
              // Settled by hand from done; from sent only a ledger's own row makes the move.
              done: ['settled'],
            },
            children: { order_lines: { via: 'order_id', createIn: ['draft'] } },
            lock: { when: ['sent', 'done'], except: ['note', 'reason', 'sent_at', 'no_email', 'resent_at', 'resends'] },
            actions: ORDER_ACTIONS,
          },
        },
        {
          ref: 'order_lines',
          columns: [
            id,
            { ref: 'order_id', type: 'fk', references: 'orders' },
            { ref: 'kind', type: 'enum', enum: ['item', 'extra'], default: 'item' },
            { ref: 'qty', type: 'int', default: 1 },
          ],
        },
      ],
    },
    roles: [{ key: 'manager', name: 'Manager', permissions: [] as string[] }],
    pages: [
      { ref: 'shop-orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'orders' } },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
  change?.(doc as never);
  return doc;
}
