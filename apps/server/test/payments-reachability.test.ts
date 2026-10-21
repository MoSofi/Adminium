// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Can customers reach this server?" names the first fact that rules online
 * payments out, in a fixed order, and never calls anyone to find out.
 */
import { describe, expect, it } from 'vitest';

import { onlinePaymentsPossible, reachability, type ReachabilityFacts } from '../src/payments/reachability.js';

const base: ReachabilityFacts = {
  networkFeatures: true,
  desktop: false,
  publicOrigin: 'https://admin.crumbandco.de',
  trustProxy: true,
  forwarded: true,
};

describe('reachability', () => {
  it.each([
    [{ networkFeatures: false }, 'network-off'],
    [{ desktop: true }, 'desktop'],
    [{ publicOrigin: null }, 'not-set'],
    [{ publicOrigin: 'http://localhost:4600' }, 'this-computer'],
    [{ publicOrigin: 'http://127.0.0.1:4600' }, 'this-computer'],
    [{ publicOrigin: 'http://[::1]:4600' }, 'this-computer'],
    [{ publicOrigin: 'http://192.168.1.20:4600' }, 'private-network'],
    [{ publicOrigin: 'https://10.0.0.5' }, 'private-network'],
    [{ publicOrigin: 'https://bakery.local' }, 'dot-local'],
    [{ publicOrigin: 'http://admin.crumbandco.de' }, 'not-https'],
    [{ trustProxy: false }, 'proxy-hidden'],
    [{}, 'reachable'],
  ] as const)('%o → %s', (overrides, state) => {
    expect(reachability({ ...base, ...overrides }).state).toBe(state);
  });

  it('puts the operator switch first: an off switch wins over everything', () => {
    expect(reachability({ ...base, networkFeatures: false, desktop: true, publicOrigin: null }).state).toBe('network-off');
  });

  it('finds no proxy problem when nothing was forwarded', () => {
    expect(reachability({ ...base, trustProxy: false, forwarded: false }).state).toBe('reachable');
  });

  it('warns about a port other than 443 (PayPal delivers to 443 only)', () => {
    expect(reachability({ ...base, publicOrigin: 'https://admin.crumbandco.de:8443' }).notPort443).toBe(true);
    expect(reachability(base).notPort443).toBe(false);
  });

  it('offers online payments only when reachable', () => {
    expect(onlinePaymentsPossible(reachability(base))).toBe(true);
    expect(onlinePaymentsPossible(reachability({ ...base, publicOrigin: 'http://192.168.1.20:4600' }))).toBe(false);
  });

  it('reports the address it judged', () => {
    expect(reachability({ ...base, publicOrigin: 'https://Admin.CrumbAndCo.de/' }).origin).toBe('https://admin.crumbandco.de');
  });
});
