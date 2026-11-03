// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `upload()`: one file a guest sends for a file column. The body is the file
 * with its own type, the entry and the column in the query; a visitor with no
 * session solves the human check BEFORE sending (a refused body still cost
 * its sending), a signed-in one sends without and solves only when refused;
 * a refusal of the file itself comes back as `PUBLIC_UPLOAD_REFUSED` with why.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { PUBLIC_ERROR_CODES, PublicApiError, createPublicClient } from '../src/index.js';

const CHALLENGE = { id: 'eyJ2IjoxfQ~sig', salt: 'c2FsdA', difficulty: 8, expiresAt: 0 };
const TAKEN = { id: 'q'.repeat(32), name: 'poster.pdf', size: 4, kind: 'pdf' };

function holds(header: string | undefined): boolean {
  if (header === undefined || !header.startsWith(`${CHALLENGE.id}.`)) return false;
  const nonce = header.slice(CHALLENGE.id.length + 1);
  return createHash('sha256').update(`${CHALLENGE.salt}${nonce}`).digest()[0] === 0;
}

/** A server that asks every upload for a proof unless `excused`, and answers the file taken. */
function serve(opts: { excused?: boolean; refuse?: { status: number; reason: string } } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init === undefined ? {} : { init }) });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (String(url).includes('/challenge')) return json(200, { data: CHALLENGE });
    if (String(url).endsWith('/claim')) return json(200, { data: { session: 'adm_pubs_tok', expiresAt: Date.now() + 60_000 } });
    const proof = ((init?.headers ?? {}) as Record<string, string>)['x-adminium-proof'];
    if (opts.excused !== true && !holds(proof)) return json(403, { error: { code: 'PUBLIC_PROOF_REQUIRED', message: 'no' } });
    if (opts.refuse !== undefined) return json(opts.refuse.status, { error: { code: 'PUBLIC_UPLOAD_REFUSED', message: 'no', params: { reason: opts.refuse.reason } } });
    return json(200, { data: TAKEN });
  });
  const client = createPublicClient({ baseUrl: 'https://x', publishableKey: 'adm_pub_k', fetch: fetch as unknown as typeof globalThis.fetch })!;
  const route = (url: string) => (url.includes('/challenge') ? `challenge?${new URL(url).searchParams.get('purpose') ?? ''}` : new URL(url).pathname.replace('/api/v1/public/', ''));
  return { client, calls, route };
}

const file = new Blob(['%PDF'], { type: 'application/pdf' });

describe("a guest's file for a column", () => {
  it('solves the check first with no session, and sends the file as the body with its type', async () => {
    const { client, calls, route } = serve();
    expect(await client.upload('shop_orders', 'order_lines.artwork', file, 'poster.pdf')).toEqual(TAKEN);
    expect(calls.map((c) => route(c.url))).toEqual(['challenge?upload', 'uploads']);
    const sent = calls[1]!;
    expect(new URL(sent.url).searchParams.toString()).toBe('ref=shop_orders&column=order_lines.artwork&name=poster.pdf');
    expect(sent.init?.method).toBe('POST');
    expect(sent.init?.body).toBe(file);
    const headers = sent.init?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/pdf');
    expect(holds(headers['x-adminium-proof'])).toBe(true);
  });

  it('sends without a proof when signed in, and solves one only when refused', async () => {
    const excused = serve({ excused: true });
    await excused.client.claim({ email: 'ada@example.com' });
    await excused.client.upload('shop_orders', 'brief', file);
    expect(excused.calls.map((c) => excused.route(c.url))).toEqual(['claim', 'uploads']);

    const asked = serve();
    await asked.client.claim({ email: 'ada@example.com' });
    expect(await asked.client.upload('shop_orders', 'brief', file)).toEqual(TAKEN);
    expect(asked.calls.map((c) => asked.route(c.url))).toEqual(['claim', 'uploads', 'challenge?upload', 'uploads']);
  });

  it('says why a file was not taken', async () => {
    expect(PUBLIC_ERROR_CODES).toContain('PUBLIC_UPLOAD_REFUSED');
    const { client } = serve({ refuse: { status: 413, reason: 'too-big' } });
    const refused = await client.upload('shop_orders', 'brief', file).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(PublicApiError);
    expect(refused).toMatchObject({ code: 'PUBLIC_UPLOAD_REFUSED', status: 413, params: { reason: 'too-big' } });
  });
});
