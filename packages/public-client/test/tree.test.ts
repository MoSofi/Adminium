// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An order with its lines, through the client: one POST carrying the rows
 * below the order, a quote on its own route, a change saved only at the
 * price shown, the refusals read back by row, and a retry key minted here.
 */
import { describe, expect, it, vi } from 'vitest';

import { PUBLIC_ERROR_CODES, PublicApiError, createPublicClient, newClientKey } from '../src/index.js';

function over(handler: (url: string, init?: RequestInit) => Response | unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init === undefined ? {} : { init }) });
    const out = handler(String(url), init);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const client = createPublicClient({ baseUrl: 'https://x', publishableKey: 'adm_pub_k', fetch: fetch as unknown as typeof globalThis.fetch, humanCheck: false })!;
  return { client, calls };
}

const refusal = (status: number, code: string, params: Record<string, unknown>) =>
  new Response(JSON.stringify({ error: { code, params, message: 'nope' } }), { status, headers: { 'content-type': 'application/json' } });

const ORDER = {
  values: { email: 'ada@example.com', name: 'Ada' },
  children: { order_items: [{ values: { menu_item_id: 1, qty: 2 }, children: { order_item_modifiers: [{ values: { modifier_id: 2 } }] } }] },
};

describe('a create with its child rows', () => {
  it('sends the rows below the order in one POST, with the price shown, and reads the rows back', async () => {
    const { client, calls } = over(() =>
      new Response(JSON.stringify({ data: { id: 7, total: '34.64' }, children: { order_items: [{ data: { id: 70, line_total: '32.00' } }] }, rank: 3 }), { status: 201 }),
    );
    const made = await client.createTree('orders', { ...ORDER, expect: { total: '34.64' } });
    expect(calls[0]!.url).toBe('https://x/api/v1/public/records/orders');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ ...ORDER, expect: { total: '34.64' } });
    expect(made).toEqual({ data: { id: 7, total: '34.64' }, children: { order_items: [{ data: { id: 70, line_total: '32.00' } }] }, rank: 3, replayed: false });
  });

  it('knows a retry answered with the order already made', async () => {
    const { client } = over(() => ({ data: { id: 7 }, children: {}, replayed: true }));
    expect((await client.createTree('orders', ORDER)).replayed).toBe(true);
  });

  it('quotes on the dry-run route, with no proof, and a change on its own', async () => {
    const { client, calls } = over((url) =>
      url.endsWith('/7/dry-run') ? { data: { qty: 3, line_total: '6.00' } } : { data: { total: '34.64' }, children: {}, capacity: [{ pool: '1', state: 'available' }], exact: true },
    );
    const quote = await client.quote('orders', ORDER);
    expect(calls[0]!.url).toBe('https://x/api/v1/public/records/orders/dry-run');
    expect(quote).toEqual({ data: { total: '34.64' }, children: {}, capacity: [{ pool: '1', state: 'available' }], exact: true });
    expect(await client.quoteChange('lines', '7', { qty: 3 })).toEqual({ qty: 3, line_total: '6.00' });
    expect(calls[1]!.url).toBe('https://x/api/v1/public/records/lines/7/dry-run');
  });

  it('sends the price shown with a change', async () => {
    const { client, calls } = over(() => ({ data: { qty: 3 } }));
    await client.update('lines', '7', { qty: 3 }, { expect: { total: '6.00' } });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ values: { qty: 3 }, expect: { total: '6.00' } });
    await client.update('lines', '7', { qty: 4 });
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ values: { qty: 4 } });
  });

  it('reads a refusal by its row, a new price, and a sold-out row', async () => {
    for (const code of ['PUBLIC_PRICE_CHANGED', 'PUBLIC_SOLD_OUT', 'PUBLIC_NO_ROOM']) expect(PUBLIC_ERROR_CODES).toContain(code);
    const refused = await over(() =>
      refusal(400, 'PUBLIC_WRITE_REFUSED', { child: 'order_item_modifiers', index: 0, path: ['order_items', 0, 'order_item_modifiers', 0], column: 'modifier_id', reason: 'not-offered' }),
    )
      .client.createTree('orders', ORDER)
      .catch((error: unknown) => error as PublicApiError);
    expect(refused.refused).toEqual({ child: 'order_item_modifiers', index: 0, path: ['order_items', 0, 'order_item_modifiers', 0], column: 'modifier_id', reason: 'not-offered', group: null });
    expect(refused.priceChanged).toBeNull();
    const priced = await over(() => refusal(409, 'PUBLIC_PRICE_CHANGED', { total: '90.00', lines: { tickets: [{ data: { price: '45.00' } }] } }))
      .client.createTree('orders', ORDER)
      .catch((error: unknown) => error as PublicApiError);
    expect(priced.priceChanged).toEqual({ total: '90.00', lines: { tickets: [{ data: { price: '45.00' } }] } });
    const gone = await over(() => refusal(409, 'PUBLIC_SOLD_OUT', { child: 'tickets', index: 1, path: ['tickets', 1] }))
      .client.createTree('orders', ORDER)
      .catch((error: unknown) => error as PublicApiError);
    expect(gone.code).toBe('PUBLIC_SOLD_OUT');
    expect(gone.soldOut).toEqual({ child: 'tickets', index: 1, path: ['tickets', 1] });
    expect(gone.refused).toBeNull();
  });

  it('mints a retry key of 32 random bytes, a new one each time', () => {
    const a = newClientKey();
    const b = newClientKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
});
