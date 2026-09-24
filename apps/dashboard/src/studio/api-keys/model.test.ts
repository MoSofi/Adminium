// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `model.ts` — the keys page's rules, one describe per rule the comp's
 * script carries ("Script rules carried verbatim").
 */
import { describe, expect, it } from 'vitest';

import type { EndpointDto, KeyAccess, SourceDto } from './apiKeysApi.js';
import {
  accessCounts,
  blankDefinition,
  bulk,
  coerceRef,
  expiresAtFor,
  filterEndpoints,
  footerSummary,
  maskKey,
  orderParts,
  parseDefinitionText,
  patchDefinition,
  patchNested,
  printDefinition,
  pruneSelection,
  rateLabel,
  relativeTime,
  scopeString,
  selectionCounts,
  setMethods,
  supportedMethods,
  toggleAll,
  toggleMethod,
  triState,
  unionMethods,
  type Selection,
} from './model.js';

const ep = (ref: string, methods: EndpointDto['methods'], source = `public.${ref}`): EndpointDto => ({
  id: null,
  ref,
  path: `/${ref}`,
  origin: 'generated',
  stored: false,
  definition: '{}',
  source,
  methods,
  selectHash: null,
  issues: [],
});

const customers = ep('customers', ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'BATCH']);
const orders = ep('orders', ['GET', 'PATCH']);
const invoices = ep('invoices', ['GET']);

describe('selection', () => {
  it('tri-state counts only the methods the endpoint offers', () => {
    expect(triState(undefined, orders.methods)).toBe('none');
    expect(triState(['GET'], orders.methods)).toBe('some');
    expect(triState(['PATCH', 'GET'], orders.methods)).toBe('all');
    expect(triState(['PUT'], orders.methods)).toBe('none');
  });

  it('toggle all turns every method on, unless all are on', () => {
    let s: Selection = {};
    s = toggleAll(s, orders);
    expect(s).toEqual({ orders: ['GET', 'PATCH'] });
    s = toggleAll(s, orders);
    expect(s).toEqual({});
    s = toggleAll({ orders: ['PATCH'] }, orders);
    expect(s).toEqual({ orders: ['GET', 'PATCH'] });
  });

  it('a method toggles, in method order; the last one off removes the ref', () => {
    let s: Selection = toggleMethod({}, 'orders', 'PATCH');
    s = toggleMethod(s, 'orders', 'GET');
    expect(s['orders']).toEqual(['GET', 'PATCH']);
    s = setMethods(s, 'orders', []);
    expect(s).toEqual({});
  });

  it('bulk actions touch the VISIBLE endpoints only', () => {
    const start: Selection = { invoices: ['GET'] };
    const visible = filterEndpoints([customers, orders, invoices], 'ord');
    expect(visible.map((e) => e.ref)).toEqual(['orders']);
    expect(bulk(start, visible, 'all')).toEqual({ invoices: ['GET'], orders: ['GET', 'PATCH'] });
    expect(bulk({ orders: ['GET'], invoices: ['GET'] }, visible, 'none')).toEqual({ invoices: ['GET'] });
    expect(bulk({}, [customers, orders], 'read')).toEqual({ customers: ['GET'], orders: ['GET'] });
  });

  it('the filter matches path and source, any case', () => {
    expect(filterEndpoints([customers, orders], 'PUBLIC.CUST').map((e) => e.ref)).toEqual(['customers']);
    expect(filterEndpoints([customers, orders], '  ')).toHaveLength(2);
  });

  it('counts permissions and the endpoints they are on', () => {
    expect(selectionCounts({ customers: ['GET', 'POST'], orders: ['GET'] })).toEqual({ permissions: 3, endpoints: 2 });
  });

  it('the footer names three paths in list order, then how many more', () => {
    const all = [customers, orders, invoices, ep('products', ['GET']), ep('shippers', ['GET'])];
    const s: Selection = { shippers: ['GET'], customers: ['GET'], orders: ['GET'], invoices: ['GET'], products: ['GET'] };
    expect(footerSummary(s, all)).toEqual({ paths: ['/customers', '/orders', '/invoices'], more: 2 });
    expect(footerSummary({}, all)).toBeNull();
  });

  it('a builder save prunes the draft to what the endpoint still offers', () => {
    expect(pruneSelection({ orders: ['GET', 'PUT'], gone: ['GET'] }, [orders])).toEqual({ orders: ['GET'] });
  });

  it('prints the scope string lower-cased', () => {
    expect(scopeString('customers', 'GET')).toBe('/customers:get');
  });
});

describe('key rows', () => {
  const access: KeyAccess[] = [
    { endpointId: 'a', ref: 'orders', path: '/orders', methods: ['PATCH', 'GET'], suspended: ['PUT'] },
    { endpointId: 'b', ref: 'invoices', path: '/invoices', methods: ['GET'], suspended: [] },
    { endpointId: 'c', ref: 'gone', path: null, methods: [], suspended: ['GET'] },
  ];
  it('badges are the union in method order; counts skip suspended grants', () => {
    expect(unionMethods(access)).toEqual(['GET', 'PATCH']);
    expect(accessCounts(access)).toEqual({ endpoints: 2, methods: 3 });
  });

  it('masks the key with its display prefix and twelve bullets', () => {
    expect(maskKey('adm_pub_4f2a91cd')).toBe('adm_pub_4f2a91cd••••••••••••');
  });

  it('prints relative times, or null for never', () => {
    const now = Date.UTC(2026, 8, 22, 12);
    expect(relativeTime(null, now, 'en-US')).toBeNull();
    expect(relativeTime(now - 2 * 60_000, now, 'en-US')).toBe('2 min. ago');
    expect(relativeTime(now - 86_400_000, now, 'en-US')).toBe('yesterday');
  });

  it('expiries are the comp’s three', () => {
    expect(expiresAtFor('never', 0)).toBeUndefined();
    expect(expiresAtFor('d30', 0)).toBe(30 * 86_400_000);
    expect(expiresAtFor('d90', 5)).toBe(5 + 90 * 86_400_000);
  });

  it('rate labels: k from a thousand, and the three windows', () => {
    expect(rateLabel(5000, '1m')).toBe('5k/min');
    expect(rateLabel(600, '1m')).toBe('600/min');
    expect(rateLabel(20, '1s')).toBe('20/s');
    expect(rateLabel(1500, '1h')).toBe('1.5k/hr');
  });
});

describe('definitions', () => {
  const doc = {
    auth: { role: 'anon' },
    path: '/orders',
    writable: ['status'],
    methods: ['PATCH', 'GET'],
    source: 'public.orders',
    select: ['id', 'status'],
    filters: [{ value: 'paid', column: 'status', op: 'eq' }],
    pagination: { order: 'id.desc', max_limit: 200, default_limit: 20 },
    rate_limit: { window: '1m', requests: 120 },
    response: { envelope: 'data', shape: 'object' },
    claim: { column: 'customer_id' },
  };

  it('prints in the server’s order, methods in method order — the pane compares this text', () => {
    const printed = printDefinition(doc);
    expect(Object.keys(JSON.parse(printed) as object)).toEqual([
      'path', 'source', 'methods', 'select', 'filters', 'pagination', 'auth', 'rate_limit', 'response', 'writable', 'claim',
    ]);
    expect(printed).toContain('"methods": [\n    "GET",\n    "PATCH"\n  ]');
    expect(printed).toContain('"pagination": {\n    "default_limit": 20,\n    "max_limit": 200,\n    "order": "id.desc"\n  }');
    expect(printed).toContain('{\n      "column": "status",\n      "op": "eq",\n      "value": "paid"\n    }');
    // A fixed point, so re-printing never makes a synced pane look dirty.
    expect(printDefinition(JSON.parse(printed) as Record<string, unknown>)).toBe(printed);
  });

  it('prints a calendar filter and a pinned change where the server does', () => {
    const pinned = {
      ...doc,
      writable_when: { status: ['booked'], starts_at: 'from-now' },
      writable_values: { status: ['cancelled'] },
      filters: [{ days: 7, op: 'from-today', column: 'starts_at' }],
    };
    const printed = printDefinition(pinned);
    expect(Object.keys(JSON.parse(printed) as object).slice(-3)).toEqual(['claim', 'writable_values', 'writable_when']);
    expect(printed).toContain('{\n      "column": "starts_at",\n      "op": "from-today",\n      "days": 7\n    }');
  });

  it('keeps an unknown key, at the end, for the server to refuse by name', () => {
    expect(Object.keys(JSON.parse(printDefinition({ ...doc, rls: true })) as object).at(-1)).toBe('rls');
  });

  it('a form edit patches its own key and keeps every advanced one', () => {
    const edited = patchNested(patchDefinition(doc, { select: ['id'] }), 'pagination', { default_limit: 50 });
    expect(edited['writable']).toEqual(['status']);
    expect(edited['claim']).toEqual({ column: 'customer_id' });
    expect(edited['pagination']).toEqual({ order: 'id.desc', max_limit: 200, default_limit: 50 });
  });

  it('parses the pane, or returns the parser’s message', () => {
    expect(parseDefinitionText('{"a":1}')).toEqual({ ok: true, doc: { a: 1 } });
    const bad = parseDefinitionText('{"a":');
    expect(bad.ok).toBe(false);
    expect(parseDefinitionText('[1]')).toEqual({ ok: false, error: 'A route definition is a JSON object.' });
  });

  it('splits an order, coerces a route, and knows what a source can support', () => {
    expect(orderParts('created_at.asc')).toEqual({ column: 'created_at', dir: 'asc' });
    expect(coerceRef('9 Order-Items!')).toBe('orderItems');
    expect(coerceRef('Mrr_rollup')).toBe('mrr_rollup');
    const view: SourceDto = { id: 'v', label: 'v', kind: 'view', rowCountEstimate: null, icon: null, columns: [] };
    const keyless: SourceDto = { ...view, kind: 'table', columns: [{ name: 'a', type: 'text', primaryKey: false, pii: false }] };
    expect(supportedMethods(view)).toEqual(['GET']);
    expect(supportedMethods(keyless)).toEqual(['GET', 'POST', 'BATCH']);
  });

  it('the blank is the comp’s, with anon', () => {
    const source: SourceDto = {
      id: 'public.orders',
      label: 'Orders',
      kind: 'table',
      rowCountEstimate: 10,
      icon: null,
      columns: [
        { name: 'email', type: 'text', primaryKey: false, pii: true },
        { name: 'order_id', type: 'integer', primaryKey: true, pii: false },
      ],
    };
    expect(blankDefinition(source)).toMatchObject({
      methods: ['GET'],
      select: ['order_id'],
      pagination: { default_limit: 20, max_limit: 200, order: 'order_id.desc' },
      auth: { role: 'anon' },
      rate_limit: { requests: 5000, window: '1m' },
      response: { shape: 'object', envelope: 'data' },
    });
  });
});
