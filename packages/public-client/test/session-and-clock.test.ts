// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A session kept across a reload, and the server's clock.
 *
 * A sign-in link lands on a fresh page, and any reload starts a new client:
 * the page keeps what `session()` hands it and gives it back as the `session`
 * option, so the guest stays signed in; `onSessionChange` tells it when to
 * keep something new. `now()` is the server's clock however wrong the
 * device's is.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPublicClient, type HeldSession, type PublicClientOptions } from '../src/index.js';

type Handler = (url: string, init?: RequestInit) => Response | unknown;

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

const TOKEN = 't'.repeat(43);
const header = (init: RequestInit | undefined, name: string) => (init?.headers as Record<string, string> | undefined)?.[name];

function make(handler: Handler, more: Partial<PublicClientOptions> = {}) {
  const s = stub(handler);
  const c = createPublicClient({ baseUrl: 'https://studio.example.com', publishableKey: 'adm_pub_x', fetch: s.fetch, humanCheck: false, ...more })!;
  return { c, calls: s.calls };
}

const config = (now?: string) => ({
  data: { version: 1, side: 'customer', timezone: 'Europe/Dublin', currency: 'EUR', claim: null, documents: { create: false }, refs: {}, ...(now === undefined ? {} : { now }) },
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a session kept across a reload', () => {
  it('is held from the start and sent on every request', async () => {
    const kept: HeldSession = { token: TOKEN, level: 'verified', expiresAt: Date.now() + 60_000 };
    const { c, calls } = make(() => ({ data: [] }), { session: kept });
    expect(c.isClaimed()).toBe(true);
    expect(c.session()).toEqual(kept);
    await c.list('stays_verified');
    expect(header(calls[0]!.init, 'x-adminium-public-session')).toBe(TOKEN);
  });

  it('is not held once past its end, nor without a token', () => {
    expect(make(() => ({}), { session: { token: TOKEN, level: 'verified', expiresAt: Date.now() - 1 } }).c.session()).toBeNull();
    expect(make(() => ({}), { session: { token: '', level: 'verified', expiresAt: Date.now() + 60_000 } }).c.session()).toBeNull();
  });

  it('keeps a lookup session at lookup, never raised by being kept', () => {
    const { c } = make(() => ({}), { session: { token: TOKEN, level: 'lookup', expiresAt: Date.now() + 60_000 } });
    expect(c.session()?.level).toBe('lookup');
  });

  it('is ended on the server by signOut, and dropped', async () => {
    const changes: (HeldSession | null)[] = [];
    const { c, calls } = make(() => ({}), { session: { token: TOKEN, level: 'verified', expiresAt: Date.now() + 60_000 }, onSessionChange: (s) => changes.push(s) });
    await c.signOut();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://studio.example.com/api/v1/public/session');
    expect(calls[0]!.init?.method).toBe('DELETE');
    expect(header(calls[0]!.init, 'x-adminium-public-session')).toBe(TOKEN);
    expect(c.session()).toBeNull();
    expect(changes).toEqual([null]);
  });

  it('tells the page each new session to keep, with its token', async () => {
    const changes: (HeldSession | null)[] = [];
    const expiresAt = Date.now() + 120_000;
    const { c } = make(() => ({ data: { session: TOKEN, expiresAt } }), { onSessionChange: (s) => changes.push(s) });
    expect(await c.openLink('l'.repeat(43))).toBe(true);
    expect(changes).toEqual([{ token: TOKEN, level: 'verified', expiresAt }]);
    expect(c.session()).toEqual({ token: TOKEN, level: 'verified', expiresAt });
    c.adoptSession({ token: 'u'.repeat(43), expiresAt });
    expect(changes.at(-1)?.token).toBe('u'.repeat(43));
  });

  it('is dropped, and the page told, when the server says it was ended elsewhere', async () => {
    const changes: (HeldSession | null)[] = [];
    const { c } = make(
      () => new Response(JSON.stringify({ error: { code: 'PUBLIC_CLAIM_REQUIRED', message: 'x' } }), { status: 401, headers: { 'content-type': 'application/json', 'x-adminium-session-ended': 'elsewhere' } }),
      { session: { token: TOKEN, level: 'verified', expiresAt: Date.now() + 60_000 }, onSessionChange: (s) => changes.push(s) },
    );
    await expect(c.list('stays_verified')).rejects.toBeTruthy();
    expect(c.session()).toBeNull();
    expect(changes).toEqual([null]);
  });
});

describe("the server's clock", () => {
  it('is the device clock set right by what the config said', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-27T09:00:00.000Z'), toFake: ['Date'] });
    const { c } = make((url) => (url.endsWith('/config') ? config('2026-07-28T09:00:00.000Z') : {}));
    const cfg = await c.config();
    expect(cfg.now).toBe('2026-07-28T09:00:00.000Z');
    expect((await c.now()).toISOString()).toBe('2026-07-28T09:00:00.000Z');
    vi.setSystemTime(new Date('2026-07-27T09:05:00.000Z'));
    // The config is not asked again; the difference is kept.
    expect((await c.now()).toISOString()).toBe('2026-07-28T09:05:00.000Z');
  });

  it("is the device's own when the server says nothing, and a failed config is asked again", async () => {
    vi.useFakeTimers({ now: new Date('2026-07-27T09:00:00.000Z'), toFake: ['Date'] });
    let fail = true;
    const { c, calls } = make((url) => {
      if (url.endsWith('/config') && fail) return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
      return config();
    });
    expect((await c.now()).toISOString()).toBe('2026-07-27T09:00:00.000Z');
    fail = false;
    await c.config();
    expect(calls.filter((call) => call.url.endsWith('/config'))).toHaveLength(2);
    expect((await c.now()).toISOString()).toBe('2026-07-27T09:00:00.000Z');
  });
});

describe('a new link for a row', () => {
  it('asks for it with the session, and hands nothing back', async () => {
    const { c, calls } = make(() => new Response(JSON.stringify({ data: {} }), { status: 202, headers: { 'content-type': 'application/json' } }), {
      session: { token: TOKEN, level: 'verified', expiresAt: Date.now() + 60_000 },
    });
    await expect(c.newLink('stays_verified', 'WH/7')).resolves.toBeUndefined();
    expect(calls[0]!.url).toBe('https://studio.example.com/api/v1/public/records/stays_verified/WH%2F7/new-link');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(header(calls[0]!.init, 'x-adminium-public-session')).toBe(TOKEN);
  });

  it('throws the refusal it meets', async () => {
    const { c } = make(() => new Response(JSON.stringify({ error: { code: 'PUBLIC_LIMIT_REACHED', message: 'x' } }), { status: 409, headers: { 'content-type': 'application/json' } }));
    await expect(c.newLink('stays_verified', 7)).rejects.toMatchObject({ code: 'PUBLIC_LIMIT_REACHED', status: 409 });
  });
});
