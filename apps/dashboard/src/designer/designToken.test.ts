// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

import { exchangeDesignToken, takeDesignToken } from './designToken.js';

const TOKEN = 'a'.repeat(64);

function fakeWindow(hash: string) {
  const replaced: string[] = [];
  return {
    replaced,
    win: {
      location: { hash, pathname: '/design', search: '?x=1' } as Location,
      history: { replaceState: (_state: unknown, _title: string, url: string) => replaced.push(url) } as unknown as History,
    },
  };
}

describe('the design link', () => {
  it('takes the token out of the address before anything else, and only a well-formed one', () => {
    const { win, replaced } = fakeWindow(`#designToken=${TOKEN}`);
    expect(takeDesignToken(win)).toBe(TOKEN);
    expect(replaced).toEqual(['/design?x=1']);
    expect(takeDesignToken(fakeWindow('#designToken=nope').win)).toBeNull();
    expect(takeDesignToken(fakeWindow('#section').win)).toBeNull();
  });

  it('exchanges it once, in a body, with no referrer, and says how it went', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await exchangeDesignToken({ fetch: fetch as unknown as typeof globalThis.fetch, win: fakeWindow(`#designToken=${TOKEN}`).win })).toBe('exchanged');
    expect(fetch).toHaveBeenCalledWith('/api/v1/auth/design-session', expect.objectContaining({ method: 'POST', body: JSON.stringify({ designToken: TOKEN }), referrerPolicy: 'no-referrer' }));
    const refused = vi.fn(async () => new Response('{}', { status: 401 }));
    expect(await exchangeDesignToken({ fetch: refused as unknown as typeof globalThis.fetch, win: fakeWindow(`#designToken=${TOKEN}`).win })).toBe('refused');
    expect(await exchangeDesignToken({ win: fakeWindow('').win })).toBe('absent');
  });
});
