// SPDX-License-Identifier: AGPL-3.0-only
/** The box office a buyer holds tickets in: orders held for a while, tickets counted against their type's places. */
import { invoicingManifest } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;
const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, more: Doc = {}) => ({ ref, type: 'text', maxLength, ...more });

export function boxOffice(): Doc {
  const manifest = invoicingManifest([
    { ref: 'settings', columns: [id, { ref: 'hold_minutes', type: 'int', default: 10 }] },
    {
      ref: 'customers',
      columns: [id, text('email', 254, { nullable: true, unique: true, rules: { normalize: 'email', validation: { format: 'email' } } }), text('name', 60, { nullable: true })],
    },
    { ref: 'ticket_types', columns: [id, text('name', 60), { ref: 'capacity', type: 'int', nullable: true }] },
    {
      ref: 'orders',
      columns: [
        id,
        { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
        text('email', 254, { rules: { validation: { format: 'email' } } }),
        text('name', 120),
        { ref: 'status', type: 'enum', enum: ['held', 'confirmed', 'expired'], default: 'held' },
        { ref: 'held_until', type: 'timestamptz', nullable: true, rules: { stamp: { set: { addMinutes: { minutes: { table: 'settings', column: 'hold_minutes' } } }, on: 'create' } } },
        text('link_token', 16, { nullable: true, rules: { code: { length: 16 } } }),
      ],
      states: {
        column: 'status',
        initial: 'held',
        moves: { held: ['confirmed', 'expired'] },
        timed: [{ from: 'held', to: 'expired', at: { column: 'held_until' } }],
      },
    },
    {
      ref: 'tickets',
      columns: [id, { ref: 'order_id', type: 'fk', references: 'orders' }, { ref: 'ticket_type_id', type: 'fk', references: 'ticket_types' }],
      capacity: {
        kind: 'parent',
        via: 'ticket_type_id',
        size: { column: 'capacity' },
        countWhere: { column: 'status', values: ['held', 'confirmed'], via: 'order_id' },
        hold: { column: 'held_until', states: ['held'], via: 'order_id' },
      },
    },
  ]);
  manifest['key'] = 'box';
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'orders' };
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  manifest['publicKeys'] = { link: {} };
  manifest['publicAccess'] = [
    { table: 'customers', methods: ['GET'], select: ['name', 'email'], writable: [], claim: { verify: 'email-link', email: 'email' }, humanCheck: true },
    { table: 'ticket_types', methods: ['GET'], select: ['id', 'name'] },
    {
      table: 'orders',
      methods: ['POST'],
      humanCheck: true,
      level: 'verified',
      select: ['id', 'status'],
      writable: ['email', 'name'],
      requires: ['email', 'name'],
      claimedBy: { table: 'customers', column: 'customer_id', optional: true },
      identity: { table: 'customers', email: 'email', link: 'customer_id', fill: { name: 'name' } },
      shareLink: 'link_token',
      anonymous: { perValue: { columns: ['email'], n: 20 } },
      children: { tickets: { via: 'order_id', writable: ['ticket_type_id'], select: ['id'], min: 1, max: 6 } },
    },
    { table: 'orders', key: 'link', methods: ['GET'], select: ['id', 'status'], claim: { by: 'token', column: 'link_token', own: true, address: 'email' } },
  ];
  return manifest;
}
