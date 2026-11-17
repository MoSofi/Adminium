// SPDX-License-Identifier: AGPL-3.0-only
/**
 * When the reach card cannot tell whether strangers come through a proxy
 * (`forms/reach.ts`, `proxyUncheckedOf`): only while no proxy is trusted and
 * the request in hand came with no header a proxy adds.
 */
import { describe, expect, it } from 'vitest';

import { proxyUncheckedOf } from '../src/forms/reach.js';

const straight = { headers: {} };
const viaProxy = { headers: { 'x-forwarded-for': '203.0.113.9' } };
const viaForwarded = { headers: { forwarded: 'for=203.0.113.9' } };

describe('whether the reach card can tell how strangers come in', () => {
  it('cannot, for a request that came straight while no proxy is trusted', () => {
    expect(proxyUncheckedOf({ trustProxy: false }, straight)).toBe(true);
  });

  it('can, for a request that came through a proxy: the answer is then proxy-hidden', () => {
    expect(proxyUncheckedOf({ trustProxy: false }, viaProxy)).toBe(false);
    expect(proxyUncheckedOf({ trustProxy: false }, viaForwarded)).toBe(false);
  });

  it('can, while the server trusts its proxy, whichever way the request came', () => {
    expect(proxyUncheckedOf({ trustProxy: true }, straight)).toBe(false);
    expect(proxyUncheckedOf({ trustProxy: true }, viaProxy)).toBe(false);
  });
});
