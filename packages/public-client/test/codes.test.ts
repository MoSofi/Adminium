// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A code a guest typed, sent with a read: in a header, never in the URL a
 * log or a proxy keeps — for a list, one row, and a parent limit's rows.
 */
import { describe, expect, it, vi } from 'vitest';

import { createPublicClient } from '../src/index.js';

function over(answer: unknown) {
  const asked: { url: string; headers: Record<string, string> }[] = [];
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    asked.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { client: createPublicClient({ baseUrl: 'https://x', publishableKey: 'adm_pub_k', fetch: fetch as unknown as typeof globalThis.fetch })!, asked };
}

describe('a typed code on a read', () => {
  it('travels in a header on a list, a row and availability, and never in the URL', async () => {
    const list = over({ data: [{ id: 3 }], cursor: null });
    await list.client.list('ticket_types_unlocked', { code: ' bloom-early ' });
    expect(list.asked[0]!.url).toBe('https://x/api/v1/public/records/ticket_types_unlocked');
    expect(list.asked[0]!.headers['x-adminium-code']).toBe('bloom-early');

    const one = over({ data: { id: 3 } });
    await one.client.get('ticket_types_unlocked', '3', undefined, { code: 'BLOOMEARLY' });
    expect(one.asked[0]!.url).toBe('https://x/api/v1/public/records/ticket_types_unlocked/3');
    expect(one.asked[0]!.headers['x-adminium-code']).toBe('BLOOMEARLY');

    const types = over({ data: [] });
    await types.client.parentAvailability('tickets_availability', { under: '1', code: 'BLOOMEARLY' });
    expect(types.asked[0]!.url).toBe('https://x/api/v1/public/availability/tickets_availability?under=1');
    expect(types.asked[0]!.headers['x-adminium-code']).toBe('BLOOMEARLY');
  });

  it('sends no header without a code', async () => {
    const list = over({ data: [], cursor: null });
    await list.client.list('ticket_types', { code: '  ' });
    await list.client.list('ticket_types');
    for (const call of list.asked) expect(call.headers).not.toHaveProperty('x-adminium-code');
  });
});
