/**
 * The desktop boot-token exchange (11-electron.md §2.2 step 8, §5).
 *
 * The assertions that matter here are about ORDER and ABSENCE — the token must
 * be out of the URL before the request goes out, and must never appear anywhere
 * afterwards — so most of this suite is written against a recorded sequence of
 * effects rather than a final return value.
 */
import { describe, expect, it, vi } from 'vitest';

import { BOOT_TOKEN_PARAM, exchangeBootToken, stripBootToken } from './bootToken.js';

const TOKEN = 'a1b2c3'.repeat(10) + 'abcd';

interface Harness {
  deps: Parameters<typeof exchangeBootToken>[0];
  /** Every `replaceState` url, in order. */
  replaced: string[];
  /** Every fetch, in order, with the url as seen when it was issued. */
  calls: Array<{ url: string; init: RequestInit | undefined; urlAtCallTime: string }>;
}

function harness(
  search: string,
  respond: () => Promise<Response> = () => Promise.resolve(new Response('{}', { status: 200 })),
): Harness {
  const location = { search, pathname: '/', hash: '' };
  const replaced: string[] = [];
  const calls: Harness['calls'] = [];

  const history = {
    replaceState: (_data: unknown, _unused: string, url?: string | URL | null) => {
      const next = String(url ?? '');
      replaced.push(next);
      // Model the browser: `replaceState` really does rewrite `location`.
      const mark = next.indexOf('?');
      location.search = mark === -1 ? '' : next.slice(mark);
    },
  };

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init, urlAtCallTime: location.search });
    return respond();
  }) as unknown as typeof globalThis.fetch;

  return { deps: { location, history, fetch }, replaced, calls };
}

describe('stripBootToken', () => {
  it('removes the token and keeps everything else, in order', () => {
    expect(stripBootToken(`?${BOOT_TOKEN_PARAM}=${TOKEN}`)).toBe('');
    expect(stripBootToken(`?${BOOT_TOKEN_PARAM}=${TOKEN}&tab=open`)).toBe('?tab=open');
    expect(stripBootToken(`?tab=open&${BOOT_TOKEN_PARAM}=${TOKEN}&sort=asc`)).toBe(
      '?tab=open&sort=asc',
    );
  });

  it('leaves a token-free query alone', () => {
    expect(stripBootToken('?tab=open')).toBe('?tab=open');
    expect(stripBootToken('')).toBe('');
  });
});

describe('exchangeBootToken', () => {
  it('does nothing at all without a token — every browser tab, every reload', async () => {
    const h = harness('?tab=open');

    expect(await exchangeBootToken(h.deps)).toBe('absent');
    expect(h.calls).toHaveLength(0);
    // No history rewrite either: a non-desktop boot must not have its URL touched.
    expect(h.replaced).toHaveLength(0);
  });

  it('strips the token from the URL BEFORE issuing the exchange', async () => {
    const h = harness(`?${BOOT_TOKEN_PARAM}=${TOKEN}`);

    expect(await exchangeBootToken(h.deps)).toBe('exchanged');

    // THE order assertion. While the token sits in `location`, every request the
    // page makes carries it in `Referer` — including this one, which is the one
    // request guaranteed to reach a log. Erase, then spend.
    expect(h.replaced).toEqual(['/']);
    expect(h.calls[0]?.urlAtCallTime).toBe('');
  });

  it('sends the token in the body, and nowhere else', async () => {
    const h = harness(`?${BOOT_TOKEN_PARAM}=${TOKEN}&returnTo=/p/orders`);

    await exchangeBootToken(h.deps);

    const call = h.calls[0];
    expect(call?.url).toBe('/api/v1/auth/desktop-session');
    expect(call?.init?.method).toBe('POST');
    expect(call?.init?.credentials).toBe('same-origin');
    expect(JSON.parse(String(call?.init?.body))).toEqual({ bootToken: TOKEN });
    // Not in the URL it posts to, and no referrer to leak it into.
    expect(call?.url).not.toContain(TOKEN);
    expect(call?.init?.referrerPolicy).toBe('no-referrer');
    // The rest of the query survives the strip — a deep link still works.
    expect(h.replaced).toEqual(['/?returnTo=/p/orders']);
  });

  it('strips the token even when the server refuses it', async () => {
    const h = harness(`?${BOOT_TOKEN_PARAM}=${TOKEN}`, () =>
      Promise.resolve(new Response('{"error":{"code":"INVALID_CREDENTIALS"}}', { status: 401 })),
    );

    // A replayed or stale token (§5) still must not stay in the address bar —
    // the strip is unconditional, and only the outcome differs.
    expect(await exchangeBootToken(h.deps)).toBe('refused');
    expect(h.replaced).toEqual(['/']);
  });

  it('reports a refusal when auto-login is disabled, without throwing', async () => {
    const h = harness(`?${BOOT_TOKEN_PARAM}=${TOKEN}`, () =>
      Promise.resolve(
        new Response('{"error":{"code":"DESKTOP_AUTOLOGIN_DISABLED"}}', { status: 403 }),
      ),
    );

    // §5: "Require login on this device" ⇒ the SPA shows the standard login. The
    // caller does nothing special — the router's own guard sends an
    // unauthenticated user to /login, which is exactly the right screen.
    expect(await exchangeBootToken(h.deps)).toBe('refused');
  });

  it('survives a server that is not there, and still strips the token', async () => {
    const h = harness(`?${BOOT_TOKEN_PARAM}=${TOKEN}`, () =>
      Promise.reject(new TypeError('Failed to fetch')),
    );

    // Boot must never depend on this call succeeding: a rejected promise here
    // would take out `main.tsx`'s `start()` and paint nothing at all.
    await expect(exchangeBootToken(h.deps)).resolves.toBe('unreachable');
    expect(h.replaced).toEqual(['/']);
  });

  it('ignores an empty token rather than posting one', async () => {
    const h = harness(`?${BOOT_TOKEN_PARAM}=`);

    expect(await exchangeBootToken(h.deps)).toBe('absent');
    expect(h.calls).toHaveLength(0);
  });
});
