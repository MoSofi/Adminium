// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A limit's questions from a page: a strip of days of a slot limit, the rows
 * of a parent limit, the pools of a night limit with the earliest arrival —
 * each asked with only the parameters its kind takes — and a sold-out line
 * read off the refusal. The old `availability` call asks as it always has.
 */
import { describe, expect, it, vi } from 'vitest';

import { PUBLIC_ERROR_CODES, createPublicClient } from '../src/index.js';

function over(answer: (url: string) => Response | unknown) {
  const asked: string[] = [];
  const fetch = vi.fn(async (url: unknown) => {
    asked.push(String(url));
    const out = answer(String(url));
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { client: createPublicClient({ baseUrl: 'https://x', publishableKey: 'adm_pub_k', fetch: fetch as unknown as typeof globalThis.fetch })!, asked };
}

describe("a limit's questions", () => {
  it('asks a strip of days, the rows of a parent limit and the pools of a night limit, each with its own parameters', async () => {
    const days = over(() => ({ data: [{ date: '2026-07-28', open: 35, state: 'open' }] }));
    expect(await days.client.slotDays('orders_availability', { from: '2026-07-28', days: 3, party: 2 })).toEqual([{ date: '2026-07-28', open: 35, state: 'open' }]);
    expect(days.asked[0]).toBe('https://x/api/v1/public/availability/orders_availability?from=2026-07-28&days=3&party=2');

    const types = over(() => ({ data: [{ id: '1', state: 'on', left: 14 }, { id: '2', state: 'soon' }] }));
    expect(await types.client.parentAvailability('tickets_availability', { under: '7', qty: 2 })).toEqual([
      { id: '1', state: 'on', left: 14 },
      { id: '2', state: 'soon' },
    ]);
    expect(types.asked[0]).toBe('https://x/api/v1/public/availability/tickets_availability?under=7&qty=2');
    // A page of shows in one ask: the parents travel as one comma-separated value.
    await types.client.parentAvailability('tickets_availability', { under: ['7', '8', '11'] });
    expect(types.asked[1]).toBe('https://x/api/v1/public/availability/tickets_availability?under=7%2C8%2C11');

    const nights = over(() => ({ data: [{ pool: '1', state: 'full', earliest: '2026-08-03' }], earliest: '2026-08-03' }));
    expect(await nights.client.nightAvailability('stays_availability', { from: '2026-07-31', to: '2026-08-02', guests: 2, earliest: 10 })).toEqual({
      pools: [{ pool: '1', state: 'full', earliest: '2026-08-03' }],
      earliest: '2026-08-03',
    });
    expect(nights.asked[0]).toBe('https://x/api/v1/public/availability/stays_availability?from=2026-07-31&to=2026-08-02&guests=2&earliest=10');
    // A server that says no earliest: null, never undefined.
    const bare = over(() => ({ data: [] }));
    expect(await bare.client.nightAvailability('stays_availability', { from: '2026-07-31', to: '2026-08-02' })).toEqual({ pools: [], earliest: null });
  });

  it('reads a line out of stock and a refused card, and a quote\'s word from each ledger', async () => {
    expect(PUBLIC_ERROR_CODES).toEqual(expect.arrayContaining(['PUBLIC_OUT_OF_STOCK', 'PUBLIC_CARD_REFUSED']));
    const short = over(() => new Response(JSON.stringify({ error: { code: 'PUBLIC_OUT_OF_STOCK', params: { child: 'lines', index: 2, path: ['lines', 2], left: '3' }, message: 'x' } }), { status: 409 }));
    const error = (await short.client.create('orders', {}).catch((e: unknown) => e)) as { outOfStock: unknown; cardRefused: unknown };
    expect(error.outOfStock).toEqual({ child: 'lines', index: 2, path: ['lines', 2], left: '3' });
    expect(error.cardRefused).toBeNull();
    // A single row out of stock names no line; how many are left is told only when the server says.
    const one = over(() => new Response(JSON.stringify({ error: { code: 'PUBLIC_OUT_OF_STOCK', message: 'x' } }), { status: 409 }));
    expect(((await one.client.create('orders', {}).catch((e: unknown) => e)) as { outOfStock: unknown }).outOfStock).toEqual({});
    const card = over(() => new Response(JSON.stringify({ error: { code: 'PUBLIC_CARD_REFUSED', params: { reason: 'not-valid', column: 'card_code' }, message: 'x' } }), { status: 409 }));
    const refused = (await card.client.create('payments', {}).catch((e: unknown) => e)) as { outOfStock: unknown; cardRefused: unknown };
    expect(refused.cardRefused).toEqual({ column: 'card_code' });
    expect(refused.outOfStock).toBeNull();
    // A quote carries each ledger's answer; with none, an empty list.
    const quoted = over(() => ({ data: {}, capacity: [], exact: true, postings: [{ ledger: 'stock', state: 'refused', reason: 'out-of-stock', line: 1, path: ['lines', 1] }] }));
    expect((await quoted.client.quote('orders', { values: {} })).postings).toEqual([{ ledger: 'stock', state: 'refused', reason: 'out-of-stock', line: 1, path: ['lines', 1] }]);
    const plain = over(() => ({ data: {}, capacity: [], exact: true }));
    expect((await plain.client.quote('orders', { values: {} })).postings).toEqual([]);
    expect((await plain.client.quoteChange('orders', '1', {})).postings).toEqual([]);
  });

  it('reads which line was sold out, and knows the two new codes', async () => {
    expect(PUBLIC_ERROR_CODES).toEqual(expect.arrayContaining(['PUBLIC_SOLD_OUT', 'PUBLIC_NO_ROOM']));
    const refused = over(
      () =>
        new Response(JSON.stringify({ error: { code: 'PUBLIC_SOLD_OUT', params: { column: 'ticket_type_id', child: 'tickets', index: 1 }, message: 'That is sold out.' } }), {
          status: 409,
        }),
    );
    const error = await refused.client.create('orders', {}).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'PUBLIC_SOLD_OUT', status: 409 });
    expect((error as { soldOut: unknown }).soldOut).toEqual({ child: 'tickets', index: 1, column: 'ticket_type_id' });
    const room = over(() => new Response(JSON.stringify({ error: { code: 'PUBLIC_NO_ROOM', message: 'x' } }), { status: 409 }));
    const other = await room.client.create('stays', {}).catch((e: unknown) => e);
    expect(other).toMatchObject({ code: 'PUBLIC_NO_ROOM' });
    expect((other as { soldOut: unknown }).soldOut).toBeNull();
  });
});
