// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { makeEndpoint } from './fixtures.js';
import {
  authBadge,
  cardsFor,
  nounFor,
  requestUrl,
  sampleBody,
  schemaColumns,
  statusLine,
  statusTone,
} from './model.js';

describe('cardsFor', () => {
  it('draws GET as list + retrieve, and one card per other granted method, in order', () => {
    expect(cardsFor(makeEndpoint()).map((c) => [c.id, c.method, c.http, c.path])).toEqual([
      ['list', 'GET', 'GET', '/orders'],
      ['one', 'GET', 'GET', '/orders/:id'],
      ['create', 'POST', 'POST', '/orders'],
      ['update', 'PATCH', 'PATCH', '/orders/:id'],
      ['replace', 'PUT', 'PUT', '/orders/:id'],
      ['delete', 'DELETE', 'DELETE', '/orders/:id'],
      ['batch', 'BATCH', 'POST', '/orders/batch'],
    ]);
  });

  it('lists only the granted methods, and no retrieve card without a primary key', () => {
    const noKey = makeEndpoint({ methods: ['GET'], columns: [{ name: 'label', type: 'text', tags: [] }] });
    expect(cardsFor(noKey).map((c) => c.id)).toEqual(['list']);
    expect(cardsFor(makeEndpoint({ methods: ['PATCH'] })).map((c) => c.id)).toEqual(['update']);
  });
});

describe('schemaColumns', () => {
  it('reads list every selected column; writes list only the writable ones; delete lists none', () => {
    const ep = makeEndpoint();
    const [list, , create, , , del] = cardsFor(ep);
    expect(schemaColumns(ep, list!).map((c) => c.name)).toContain('order_id');
    expect(schemaColumns(ep, create!).map((c) => c.name)).not.toContain('order_id');
    expect(schemaColumns(ep, del!)).toEqual([]);
  });
});

describe('nounFor', () => {
  it('lower-cases the source label and picks the article from it', () => {
    expect(nounFor(makeEndpoint({ singular: 'Order' }), 'row')).toEqual({ singular: 'order', article: 'an' });
    expect(nounFor(makeEndpoint({ singular: 'Customer' }), 'row')).toEqual({ singular: 'customer', article: 'a' });
  });
  it('falls back to the localized word, never a stripped "s"', () => {
    expect(nounFor(makeEndpoint({ singular: null, ref: 'categories' }), 'row')).toEqual({ singular: 'row', article: 'a' });
  });
});

describe('authBadge', () => {
  it('names the level the endpoint really has', () => {
    expect(authBadge(makeEndpoint({ methods: ['GET'] }))).toBe('anon');
    expect(authBadge(makeEndpoint())).toBe('public');
    expect(authBadge(makeEndpoint({ auth: 'authenticated' }))).toBe('authenticated');
    expect(authBadge(makeEndpoint({ auth: 'service_role' }))).toBe('service');
  });
});

describe('sampleBody', () => {
  it('prefills the writable columns with type-shaped values and invents nothing', () => {
    const ep = makeEndpoint();
    const create = cardsFor(ep).find((c) => c.id === 'create')!;
    expect(sampleBody(ep, create)).toEqual({
      values: { customer_id: '', ship_name: '', freight: 0, shipped: false, order_date: null },
    });
    const batch = cardsFor(ep).find((c) => c.id === 'batch')!;
    expect(sampleBody(ep, batch)).toEqual({
      rows: [{ customer_id: '', ship_name: '', freight: 0, shipped: false, order_date: null }],
    });
    expect(sampleBody(ep, cardsFor(ep).find((c) => c.id === 'delete')!)).toBeUndefined();
  });
});

describe('requestUrl', () => {
  const ep = makeEndpoint();
  const [list, one] = cardsFor(ep);
  const base = 'https://admin.northwind.test';
  it('builds the real path under the records prefix, leaving empty params off', () => {
    expect(requestUrl(base, list!, { id: '', limit: '20', order: '' })).toBe(
      'https://admin.northwind.test/api/v1/public/records/orders?limit=20',
    );
    expect(requestUrl(base, list!, { id: '', limit: '', order: 'freight.asc' })).toBe(
      'https://admin.northwind.test/api/v1/public/records/orders?order=freight.asc',
    );
  });
  it('encodes an id and keeps :id until one is typed', () => {
    expect(requestUrl(base, one!, { id: '', limit: '', order: '' })).toBe(`${base}/api/v1/public/records/orders/:id`);
    expect(requestUrl(base, one!, { id: 'a/b', limit: '', order: '' })).toBe(`${base}/api/v1/public/records/orders/a%2Fb`);
  });
});

describe('the status line', () => {
  it('reads code + reason from the table, since fetch has no statusText over HTTP/2', () => {
    expect(statusLine(200)).toBe('200 OK');
    expect(statusLine(201)).toBe('201 Created');
    expect(statusLine(404)).toBe('404 Not Found');
    expect(statusLine(418)).toBe('418');
  });
  it('tones success, not-found and failure distinctly', () => {
    expect(statusTone(204)).toBe('pos');
    expect(statusTone(404)).toBe('muted');
    expect(statusTone(403)).toBe('danger');
  });
});
