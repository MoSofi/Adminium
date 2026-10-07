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
    expect(made).toEqual({ data: { id: 7, total: '34.64' }, children: { order_items: [{ data: { id: 70, line_total: '32.00' } }] }, rank: 3, replayed: false, link: null, applied: [], told: [], payment: null });
  });

  it('reads which reductions an order has, from the quote, the save and a changed price; and the minimum of a code under it', async () => {
    const applied = [
      { line: 'order_lines/1', name: 'Tote pair', kind: 'offer', amount: '15.00', typed: false },
      { line: null, name: 'Welcome 10', kind: 'code', amount: '4.95', typed: true },
      { line: null, name: 'Voucher', kind: 'voucher', amount: '5.00', typed: true, codeLast4: 'Q4XP' },
    ];
    const told = [{ column: 'order_codes/1/typed', note: 'better-offer-applied', name: 'Autumn 5' }];
    const { client } = over((url) => (url.endsWith('/dry-run') ? { data: { total: '48.11' }, exact: true, applied, told } : new Response(JSON.stringify({ data: { id: 7, total: '48.11' }, applied, told }), { status: 201 })));
    expect(await client.quote('orders', ORDER)).toMatchObject({ applied, told });
    expect(await client.createTree('orders', ORDER)).toMatchObject({ applied, told });
    // A gift card's payment: what it took and what is still to pay, and nothing else of the card.
    const paid = over((url) => (url.endsWith('/dry-run') ? { data: {}, exact: true, payment: { amount: '19.00', due: '29.11' } } : new Response(JSON.stringify({ data: { id: 8 }, payment: { amount: '19.00', due: '29.11' } }), { status: 201 })));
    expect((await paid.client.quote('orders', ORDER)).payment).toEqual({ amount: '19.00', due: '29.11' });
    expect((await paid.client.createTree('orders', ORDER)).payment).toEqual({ amount: '19.00', due: '29.11' });
    expect(await client.quoteChange('lines', '7', { qty: 3 })).toMatchObject({ applied, told });
    const priced = await over(() => refusal(409, 'PUBLIC_PRICE_CHANGED', { total: '53.46', lines: {}, applied: applied.slice(0, 1) }))
      .client.createTree('orders', ORDER)
      .catch((error: unknown) => error as PublicApiError);
    expect(priced.priceChanged).toEqual({ total: '53.46', lines: {}, applied: applied.slice(0, 1) });
    const under = await over(() => refusal(400, 'PUBLIC_WRITE_REFUSED', { child: 'order_codes', index: 0, path: ['order_codes', 0], column: 'typed', reason: 'needs-minimum', amount: '30.00' }))
      .client.createTree('orders', ORDER)
      .catch((error: unknown) => error as PublicApiError);
    expect(under.refused).toMatchObject({ column: 'typed', reason: 'needs-minimum', amount: '30.00' });
  });

  it('knows a retry answered with the order already made', async () => {
    const { client } = over(() => ({ data: { id: 7 }, children: {}, replayed: true }));
    expect((await client.createTree('orders', ORDER)).replayed).toBe(true);
  });

  it('quotes on the dry-run route, with no proof, and a change on its own', async () => {
    const { client, calls } = over((url) =>
      url.endsWith('/7/dry-run') ? { data: { qty: 3, line_total: '6.00' }, exact: false } : { data: { total: '34.64' }, children: {}, capacity: [{ pool: '1', state: 'available' }], exact: true },
    );
    const quote = await client.quote('orders', ORDER);
    expect(calls[0]!.url).toBe('https://x/api/v1/public/records/orders/dry-run');
    expect(quote).toEqual({ data: { total: '34.64' }, children: {}, capacity: [{ pool: '1', state: 'available' }], exact: true, nights: [], postings: [], applied: [], told: [], payment: null });
    // A change the app's own code runs for: the quote says the save may come out otherwise.
    expect(await client.quoteChange('lines', '7', { qty: 3 })).toEqual({ data: { qty: 3, line_total: '6.00' }, exact: false, nights: [], children: {}, postings: [], applied: [], told: [] });
    expect(calls[1]!.url).toBe('https://x/api/v1/public/records/lines/7/dry-run');
  });

  it("hands on a stay's nights, each with its rate, its rate before what was added, and tags", async () => {
    const nights = [
      { date: '2026-07-31', rate: '175.00', base: '150.00', tags: ['Weekend'] },
      { date: '2026-08-01', rate: '195.00', base: '150.00', tags: ['Weekend', 'August'] },
    ];
    const { client } = over((url) => (url.endsWith('/9/dry-run') ? { data: { room_total: '370.00' }, exact: true, nights } : { data: { room_total: '370.00' }, exact: true, nights }));
    expect((await client.quote('stays', { values: {} })).nights).toEqual(nights);
    expect((await client.quoteChange('stays', '9', { depart: '2026-08-02' })).nights).toEqual(nights);
  });

  it("hands on the rows a change moves below it, as the change would leave them", async () => {
    const children = { stay_extras: [{ data: { id: 4, extra_id: 2, nights: 3, line_total: '45.00' } }] };
    const { client } = over(() => ({ data: { room_total: '370.00' }, exact: true, children }));
    expect((await client.quoteChange('stays', '9', { depart: '2026-08-02' })).children).toEqual(children);
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
    expect(refused.refused).toEqual({ child: 'order_item_modifiers', index: 0, path: ['order_items', 0, 'order_item_modifiers', 0], column: 'modifier_id', reason: 'not-offered', group: null, amount: null });
    expect(refused.priceChanged).toBeNull();
    const priced = await over(() => refusal(409, 'PUBLIC_PRICE_CHANGED', { total: '90.00', lines: { tickets: [{ data: { price: '45.00' } }] } }))
      .client.createTree('orders', ORDER)
      .catch((error: unknown) => error as PublicApiError);
    expect(priced.priceChanged).toEqual({ total: '90.00', lines: { tickets: [{ data: { price: '45.00' } }] }, applied: [] });
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
