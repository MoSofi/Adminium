// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Signing in by an emailed link, a row shared by link, a person's own files,
 * an add-on's settings and the documents door — as a page uses them.
 *
 * What a caller depends on and cannot see: a used link is an ordinary `false`
 * or `null`, never an exception; the session a link opens is verified; the
 * fragment's `to` is only ever a path; a file comes back with the session it
 * was asked with; a documents page carries its next cursor, and a reused
 * render says so.
 */
import { describe, expect, it, vi } from 'vitest';

import { PublicApiError, createPublicClient, linkFromFragment, type PublicClient } from '../src/index.js';

type Handler = (url: string, init?: RequestInit) => unknown;

function stub(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init === undefined ? {} : { init }) });
    const out = handler(String(url), init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const err = (status: number, code: string, params?: Record<string, unknown>) =>
  new Response(JSON.stringify({ error: { code, message: 'nope', ...(params === undefined ? {} : { params }) } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const TOKEN = 'a'.repeat(43);

function client(handler: Handler): { c: PublicClient; calls: { url: string; init?: RequestInit }[] } {
  const s = stub(handler);
  return { c: createPublicClient({ baseUrl: 'https://studio.example.com', publishableKey: 'adm_pub_x', fetch: s.fetch, humanCheck: false })!, calls: s.calls };
}

const header = (init: RequestInit | undefined, name: string) => (init?.headers as Record<string, string> | undefined)?.[name];

describe('the link fragment', () => {
  it('reads the token, and keeps `to` only as a path under the app', () => {
    expect(linkFromFragment(`#${TOKEN}`)).toEqual({ token: TOKEN, to: null });
    expect(linkFromFragment(`#${TOKEN}&to=invoices/INV-2042`)).toEqual({ token: TOKEN, to: 'invoices/INV-2042' });
    expect(linkFromFragment(`${TOKEN}&to=/proposals/7`)).toEqual({ token: TOKEN, to: 'proposals/7' });
    for (const to of ['//evil.example', 'https://evil.example', 'a/../b', 'a b', '%2e%2e']) {
      expect(linkFromFragment(`#${TOKEN}&to=${to}`), to).toEqual({ token: TOKEN, to: null });
    }
    expect(linkFromFragment('#')).toBeNull();
    expect(linkFromFragment('#not a token')).toBeNull();
  });
});

describe('signing in by link', () => {
  it('asks for a link by address, and answers what the server answered', async () => {
    const { c, calls } = client(() => json(202, { data: { sentTo: 'a•••@e•••.com' } }));
    expect(await c.requestLink({ email: 'ada@example.com', lang: 'fr' })).toEqual({ sentTo: 'a•••@e•••.com' });
    expect(calls[0]!.url).toBe('https://studio.example.com/api/v1/public/claim/link');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ email: 'ada@example.com', lang: 'fr' });
    await c.requestLink({ email: 'ada@example.com' });
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ email: 'ada@example.com' });
  });

  it('solves the human check when the server asks for it', async () => {
    let asked = 0;
    const s = stub((url, init) => {
      if (url.includes('/challenge')) return { data: { id: 'x~y', salt: 'salt', difficulty: 1, expiresAt: Date.now() + 60_000 } };
      asked += 1;
      return header(init, 'x-adminium-proof') === undefined ? err(403, 'PUBLIC_PROOF_REQUIRED') : json(202, { data: { sentTo: 'a' } });
    });
    const c = createPublicClient({ baseUrl: 'https://x', publishableKey: 'adm_pub_x', fetch: s.fetch })!;
    await c.resendLink(TOKEN);
    expect(asked).toBe(2);
  });

  it('greets by first name, and reads a used link as null', async () => {
    let used = false;
    const { c } = client(() => (used ? err(410, 'LINK_EXPIRED') : { data: { firstName: 'Ada' } }));
    expect(await c.peekLink(TOKEN)).toBe('Ada');
    used = true;
    expect(await c.peekLink(TOKEN)).toBeNull();
    // Anything else still throws.
    const broken = client(() => err(503, 'PUBLIC_UPSTREAM_UNAVAILABLE')).c;
    await expect(broken.peekLink(TOKEN)).rejects.toBeInstanceOf(PublicApiError);
  });

  it('opens a verified session once, and carries it on every request after', async () => {
    const { c, calls } = client((url) =>
      url.endsWith('/claim/link/verify') ? { data: { session: 'adm_pubs_1', expiresAt: 42, level: 'verified' } } : { data: [], page: { limit: 50, offset: 0, total: null } },
    );
    expect(await c.openLink(TOKEN)).toBe(true);
    expect(c.session()).toEqual({ level: 'verified', expiresAt: 42 });
    await c.list('invoices');
    expect(header(calls[1]!.init, 'x-adminium-public-session')).toBe('adm_pubs_1');
    const used = client(() => err(410, 'LINK_EXPIRED')).c;
    expect(await used.openLink(TOKEN)).toBe(false);
    expect(used.isClaimed()).toBe(false);
    await expect(client(() => err(429, 'PUBLIC_RATE_LIMITED')).c.openLink(TOKEN)).rejects.toBeInstanceOf(PublicApiError);
  });

  it('takes the code on another device: wrong is a result, locked throws', async () => {
    let answer: Response | unknown = err(403, 'PUBLIC_CODE_WRONG', { triesLeft: 3 });
    const { c } = client(() => answer);
    expect(await c.verifyLinkCode({ email: 'ada@example.com', code: '000000' })).toEqual({ ok: false, triesLeft: 3 });
    answer = err(403, 'PUBLIC_CODE_WRONG');
    expect(await c.verifyLinkCode({ email: 'ada@example.com', code: '000000' })).toEqual({ ok: false, triesLeft: 0 });
    answer = { data: { session: 'adm_pubs_2', expiresAt: 7, level: 'verified' } };
    expect(await c.verifyLinkCode({ email: 'ada@example.com', code: '123456' })).toEqual({ ok: true, level: 'verified', expiresAt: 7, ended: false });
    expect(c.session()).toEqual({ level: 'verified', expiresAt: 7 });
    answer = err(403, 'PUBLIC_CLAIM_LOCKED');
    await expect(c.verifyLinkCode({ email: 'ada@example.com', code: '1' })).rejects.toMatchObject({ code: 'PUBLIC_CLAIM_LOCKED' });
  });
});

describe('a row shared by link', () => {
  it('opens, or says the code is unknown or the link closed', async () => {
    let answer: unknown = { data: { session: 'adm_pubs_3', expiresAt: 9 } };
    const { c } = client(() => answer);
    expect(await c.openShared('ABCD EFGH JKMN PQRS')).toBe('opened');
    expect(c.session()).toEqual({ level: 'lookup', expiresAt: 9 });
    answer = err(404, 'PUBLIC_REF_NOT_FOUND');
    expect(await c.openShared('x')).toBe('unknown');
    answer = err(410, 'LINK_EXPIRED');
    expect(await c.openShared('x')).toBe('closed');
    answer = err(503, 'PUBLIC_UPSTREAM_UNAVAILABLE');
    await expect(c.openShared('x')).rejects.toBeInstanceOf(PublicApiError);
  });
});

describe('a person’s own file', () => {
  it('comes back as a Blob, with its name and whether it opens inline', async () => {
    const { c, calls } = client(
      () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-disposition': `inline; filename="logo.png"; filename*=UTF-8''l%C3%B6go.png` },
        }),
    );
    const signal = new AbortController().signal;
    const got = await c.file('deliverable_versions', 7, 'file', signal);
    expect(calls[0]!.url).toBe('https://studio.example.com/api/v1/public/files/deliverable_versions/7/file');
    expect(calls[0]!.init?.signal).toBe(signal);
    expect(got.inline).toBe(true);
    expect(got.filename).toBe('lögo.png');
    expect(new Uint8Array(await got.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const plain = await client(() => new Response('x', { status: 200 })).c.file('r', '1', 'f');
    expect(plain).toMatchObject({ filename: null, inline: false });
  });

  it('refuses as the surface refuses, and says when the network did not answer', async () => {
    await expect(client(() => err(404, 'PUBLIC_REF_NOT_FOUND')).c.file('r', 1, 'f')).rejects.toMatchObject({ code: 'PUBLIC_REF_NOT_FOUND', status: 404 });
    const down = createPublicClient({
      baseUrl: 'https://x',
      publishableKey: 'adm_pub_x',
      fetch: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    })!;
    await expect(down.file('r', 1, 'f')).rejects.toMatchObject({ code: 'PUBLIC_NETWORK_UNAVAILABLE' });
    await expect(down.file('r', 1, 'f')).rejects.toThrow(/offline/);
    const odd = createPublicClient({
      baseUrl: 'https://x',
      publishableKey: 'adm_pub_x',
      fetch: (async () => {
        throw 'string failure';
      }) as unknown as typeof fetch,
    })!;
    await expect(odd.file('r', 1, 'f')).rejects.toThrow(/string failure/);
  });
});

describe('an add-on’s settings', () => {
  it('reads the settings a verified session may see', async () => {
    const { c, calls } = client(() => ({ data: { settings: { payment_instructions: 'IBAN' } } }));
    const signal = new AbortController().signal;
    expect(await c.addOnSettings('invoices', signal)).toEqual({ payment_instructions: 'IBAN' });
    expect(calls[0]!.url).toBe('https://studio.example.com/api/v1/public/add-ons/invoices/settings');
    expect(await c.addOnSettings('invoices')).toEqual({ payment_instructions: 'IBAN' });
  });

  it('says a found session must be verified first', async () => {
    const error = await client(() => err(403, 'PUBLIC_CLAIM_LEVEL')).c.addOnSettings('invoices').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PublicApiError);
    expect((error as PublicApiError).needsVerifiedSession).toBe(true);
    expect(new PublicApiError('PUBLIC_REF_NOT_FOUND', 404, 'x').needsVerifiedSession).toBe(false);
  });
});

describe('the documents door', () => {
  it('pages a row’s documents by kind, with the next cursor', async () => {
    const { c, calls } = client(() => json(200, { data: [{ id: 'doc_1' }] }, { 'x-next-cursor': 'abc' }));
    const signal = new AbortController().signal;
    const page = await c.documents.list({ ref: 'invoices', id: 42, kind: 'invoice', limit: 10, cursor: 'xyz', signal });
    expect(page).toEqual({ data: [{ id: 'doc_1' }], next: 'abc' });
    expect(calls[0]!.url).toBe('https://studio.example.com/api/v1/public/documents?ref=invoices&id=42&kind=invoice&limit=10&cursor=xyz');
    expect(calls[0]!.init?.signal).toBe(signal);
    expect(await c.documents.list({})).toEqual({ data: [{ id: 'doc_1' }], next: 'abc' });
    expect(calls[1]!.url).toBe('https://studio.example.com/api/v1/public/documents');
    // The older form still answers the first page as an array.
    expect(await c.documents.list()).toEqual([{ id: 'doc_1' }]);
    expect(await c.documents.list(new AbortController().signal)).toEqual([{ id: 'doc_1' }]);
    const last = await client(() => ({ data: [] })).c.documents.list({ kind: 'receipt' });
    expect(last).toEqual({ data: [], next: null });
  });

  it('draws for a row by kind and period, and says when the one drawn before is reused', async () => {
    let status = 201;
    const { c, calls } = client(() => json(status, { data: { id: 'doc_2' } }));
    expect(await c.documents.render({ kind: 'statement', ref: 'clients', id: 7, period: '12m' })).toEqual({ id: 'doc_2', reused: false });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ kind: 'statement', ref: 'clients', id: 7, period: '12m' });
    status = 200;
    expect(await c.documents.render({ kind: 'statement', ref: 'clients', id: 7, period: '12m' })).toEqual({ id: 'doc_2', reused: true });
    await expect(client(() => err(403, 'PUBLIC_CLAIM_LEVEL')).c.documents.render({ kind: 'invoice', ref: 'invoices', id: 1 })).rejects.toMatchObject({
      needsVerifiedSession: true,
    });
  });
});
