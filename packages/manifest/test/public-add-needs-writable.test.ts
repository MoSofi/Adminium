// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An entry that adds or changes rows and leaves a browser nothing to set.
 * Found on a trial: `{ table: order_requests, methods: [POST], select: [id] }`
 * for an order form that sends six columns. The manifest validated, the app
 * was applied, and the endpoint could not be made ("declares "create" but
 * lists no writable columns"), which a person read when they came to allow
 * the app's public access. The validator says it now, at the entry, on the
 * endpoint's own condition (the server's `public-writable-parity.test.ts`
 * holds the two together against installed tables).
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';

type Doc = Record<string, unknown>;

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, more: Doc = {}) => ({ ref, type: 'text', maxLength: 120, nullable: true, ...more });

function shop(publicAccess: Doc[], more: Doc = {}): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A shop' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.0' },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'products', columns: [id, text('name')] },
        { ref: 'customers', columns: [id, text('email', { maxLength: 254, unique: true }), text('name')] },
        {
          ref: 'order_requests',
          columns: [
            id,
            { ref: 'product_id', type: 'fk', references: 'products', nullable: true },
            { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
            { ref: 'quantity', type: 'int', nullable: true },
            text('message'),
            { ref: 'status', type: 'enum', enum: ['new', 'seen'], default: 'new' },
            // Filled by Adminium: never a browser's, named or not.
            { ref: 'number', type: 'int', nullable: true, rules: { sequence: {} } },
            { ref: 'received_on', type: 'date', nullable: true, rules: { stamp: { set: 'today', on: { column: 'status', values: ['seen'] } } } },
            // Decided by a formula, and still offered by an endpoint that is told nothing.
            { ref: 'packs', type: 'int', nullable: true },
            { ref: 'pieces', type: 'int', nullable: true, rules: { formula: { mul: ['packs', 12] } } },
          ],
        },
        { ref: 'request_notes', columns: [id, { ref: 'request_id', type: 'fk', references: 'order_requests' }, text('note')] },
      ],
    },
    pages: [{ ref: 'home', template: 'page-crud', title: { key: 't', fallback: 'Home' }, nav: { group: 'records', icon: 'list', order: 1 } }],
    frontends: [
      { side: 'staff', kind: 'spa', placement: 'internal' },
      { side: 'customer', kind: 'spa' },
    ],
    publicAccess,
    ...more,
  };
}

/** What the validator says of entry `at`, at its `writable`. */
const said = (publicAccess: Doc[], at = publicAccess.length - 1, more: Doc = {}): string[] => {
  const result = validateManifest(shop(publicAccess, more));
  return (result.ok ? [] : result.issues).filter((issue) => issue.path === `publicAccess.${String(at)}.writable`).map((issue) => issue.message);
};
const LIST = 'so list the columns a browser may set in writable';
const WORKED = ": with no list it may set the columns the entry shows (select), and none of those is a browser's to set";

const SIGN_IN = { table: 'customers', methods: ['GET'], select: ['id', 'name'], claim: { match: ['email'] } };
const OWN = { claimedBy: { table: 'customers', column: 'customer_id' } };
const REQUESTS = { table: 'order_requests', methods: ['GET'], select: ['id', 'status'], ...OWN };
const UNDER = { visibleWith: { table: 'order_requests', via: 'request_id' } };

describe('an entry that adds rows and names nothing a browser may set', () => {
  it('is refused as the Designer wrote it, and validates once it lists what the form sends', () => {
    const written = { table: 'order_requests', methods: ['POST'], select: ['id'] };
    expect(said([written])).toEqual([`this entry adds rows, ${LIST}${WORKED}`]);
    const result = validateManifest(shop([{ ...written, writable: ['product_id', 'quantity', 'message'] }]));
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it('is refused with a list left empty, whatever else the entry fills', () => {
    const entry = { table: 'order_requests', methods: ['POST'], select: ['id'], writable: [] };
    expect(said([entry])).toEqual([`this entry adds rows, ${LIST}`]);
    expect(said([{ ...entry, defaults: { status: 'new' } }])).toEqual([`this entry adds rows, ${LIST}`]);
    expect(said([{ ...entry, children: { request_notes: { via: 'request_id', writable: ['note'], max: 3 } } }])).toEqual([`this entry adds rows, ${LIST}`]);
  });

  it('is left alone where the endpoint finds a column to offer in what the entry shows', () => {
    expect(said([{ table: 'order_requests', methods: ['POST'], select: ['id', 'message'] }])).toEqual([]);
    // No select: every column the table declares.
    expect(said([{ table: 'order_requests', methods: ['POST'] }])).toEqual([]);
    // A formula decides the column, and an endpoint told nothing offers it all the same: not this finding's to refuse.
    expect(said([{ table: 'order_requests', methods: ['POST'], select: ['id', 'pieces'] }])).toEqual([]);
  });

  it('counts out the key, what Adminium fills, what a filter holds and the column the rows are claimed by', () => {
    expect(said([{ table: 'order_requests', methods: ['POST'], select: ['id', 'number', 'received_on'] }])).toEqual([`this entry adds rows, ${LIST}${WORKED}`]);
    const filtered = { table: 'order_requests', methods: ['POST'], select: ['id', 'status'], filters: [{ column: 'status', op: 'eq', value: 'new' }] };
    expect(said([filtered])).toEqual([`this entry adds rows, ${LIST}${WORKED}`]);
    expect(said([{ ...filtered, select: ['id', 'status', 'message'] }])).toEqual([]);
    expect(said([SIGN_IN, { table: 'order_requests', methods: ['POST'], select: ['id', 'customer_id'], ...OWN }])).toEqual([`this entry adds rows, ${LIST}${WORKED}`]);
    expect(said([SIGN_IN, { table: 'order_requests', methods: ['POST'], select: ['id', 'customer_id', 'message'], ...OWN }])).toEqual([]);
  });

  it('holds an entry that changes rows to the same', () => {
    expect(said([SIGN_IN, { table: 'order_requests', methods: ['GET', 'PATCH'], select: ['id'], ...OWN }])).toEqual([`this entry changes rows, ${LIST}${WORKED}`]);
    expect(said([SIGN_IN, { table: 'order_requests', methods: ['POST', 'PATCH'], select: ['id', 'message'], writable: [], ...OWN }])).toEqual([`this entry adds and changes rows, ${LIST}`]);
    expect(said([SIGN_IN, { table: 'order_requests', methods: ['GET', 'PATCH'], select: ['id', 'message'], ...OWN }])).toEqual([]);
    // The sign-in itself: its claim is proved on the key.
    expect(said([{ ...SIGN_IN, methods: ['GET', 'PATCH'], select: ['id'] }])).toEqual([`this entry changes rows, ${LIST}${WORKED}`]);
  });

  it('asks a row seen with a parent once: it writes only what it names, and the older findings say so', () => {
    const notes = { table: 'request_notes', methods: ['POST'], select: ['id', 'note'], ...UNDER };
    // Named nothing: asked in the words that name the parent's link.
    expect(said([SIGN_IN, REQUESTS, notes])).toEqual(['this entry creates rows under "order_requests", so "request_id" is writable: the parent a create names']);
    expect(said([SIGN_IN, REQUESTS, { ...notes, methods: ['GET', 'PATCH'] }])).toEqual(['a change through an entry visible with a parent names what it may write']);
    // A list left empty on a change: neither of those speaks, so this one does.
    expect(said([SIGN_IN, REQUESTS, { ...notes, methods: ['GET', 'PATCH'], writable: [] }])).toEqual([`this entry changes rows, ${LIST}`]);
    expect(said([SIGN_IN, REQUESTS, { ...notes, writable: ['request_id', 'note'] }])).toEqual([]);
  });

  it('says nothing of an entry that only reads, only answers, or is a form\'s', () => {
    expect(said([{ table: 'products', methods: ['GET'], select: ['id'] }])).toEqual([]);
    expect(said([{ table: 'products', kind: 'availability', methods: ['GET', 'POST'] }])).toEqual([]);
    // A forms entry is no endpoint, and has said this of itself all along.
    expect(said([{ table: 'order_requests', key: 'forms', methods: ['POST'], writable: [] }])).toEqual(['a forms entry names the columns a form may fill (writable)']);
  });
});
