// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The local-bridge seed store and pairing code (`src/bridge/store.ts`).
 *
 * These are the properties the bridge's safety argument rests on — single-use,
 * expiring, bounded, and a code that cannot be brute-forced or timed — so they
 * are pinned directly rather than inferred from route behaviour.
 */
import { describe, expect, it } from 'vitest';

import {
  PAIRING_CODE_LENGTH,
  createBridgeStore,
  createPairingCode,
  pairingCodeMatches,
} from '../src/bridge/store.js';

const SEED = { dsn: 'postgres://u:p@localhost:5432/shop', engine: 'postgres' };

describe('createBridgeStore', () => {
  it('round-trips a parked seed', () => {
    const store = createBridgeStore();
    const ticket = store.put(SEED);
    expect(store.take(ticket)).toMatchObject(SEED);
  });

  it('is single-use — redeeming consumes the ticket', () => {
    // The site hands over one DSN for one wizard run. A replayable ticket would
    // let anyone who saw the URL in a browser history re-read the credential.
    const store = createBridgeStore();
    const ticket = store.put(SEED);
    expect(store.take(ticket)).not.toBeNull();
    expect(store.take(ticket)).toBeNull();
  });

  it('returns null for a ticket it never issued', () => {
    expect(createBridgeStore().take('not-a-ticket')).toBeNull();
  });

  it('issues unguessable, distinct tickets', () => {
    const store = createBridgeStore();
    const tickets = new Set(Array.from({ length: 50 }, () => store.put(SEED)));
    expect(tickets.size).toBe(50);
    for (const ticket of tickets) expect(ticket.length).toBeGreaterThanOrEqual(32);
  });

  it('expires a seed nobody redeemed', () => {
    let clock = 1_000;
    const store = createBridgeStore({ ttlMs: 500, now: () => clock });
    const ticket = store.put(SEED);
    clock += 501;
    expect(store.take(ticket)).toBeNull();
    expect(store.size()).toBe(0);
  });

  it('keeps a seed that is still inside its window', () => {
    let clock = 1_000;
    const store = createBridgeStore({ ttlMs: 500, now: () => clock });
    const ticket = store.put(SEED);
    clock += 499;
    expect(store.take(ticket)).not.toBeNull();
  });

  it('evicts oldest-first past the cap, so a loop cannot grow the heap', () => {
    const store = createBridgeStore({ max: 3 });
    const first = store.put(SEED);
    store.put(SEED);
    store.put(SEED);
    store.put(SEED); // pushes the cap
    expect(store.size()).toBe(3);
    expect(store.take(first)).toBeNull();
  });

  it('carries a null engine through when the site could not infer one', () => {
    const store = createBridgeStore();
    const ticket = store.put({ dsn: 'x', engine: null });
    expect(store.take(ticket)?.engine).toBeNull();
  });
});

describe('createPairingCode', () => {
  it('is the advertised length', () => {
    expect(createPairingCode()).toHaveLength(PAIRING_CODE_LENGTH);
  });

  it('avoids the characters people mistype off a terminal', () => {
    // No O/0, no I/1/L: the code is read from a screen and typed into a web
    // page, so an ambiguous glyph is a support ticket.
    const drawn = Array.from({ length: 200 }, () => createPairingCode()).join('');
    expect(drawn).not.toMatch(/[O0I1L]/);
  });

  it('does not repeat itself', () => {
    const codes = new Set(Array.from({ length: 200 }, () => createPairingCode()));
    expect(codes.size).toBe(200);
  });

  it('draws from the whole alphabet rather than a biased prefix', () => {
    // Rejection sampling exists so that `byte % 31` cannot over-weight the
    // first few letters. 200 codes is 1600 characters — every one of the 31
    // symbols should show up.
    const seen = new Set(Array.from({ length: 200 }, () => createPairingCode()).join(''));
    expect(seen.size).toBe(31);
  });
});

describe('pairingCodeMatches', () => {
  it('accepts the code as printed', () => {
    expect(pairingCodeMatches('ABCD2345', 'ABCD2345')).toBe(true);
  });

  it('accepts it lower-cased or padded, because it is typed by hand', () => {
    expect(pairingCodeMatches('abcd2345', 'ABCD2345')).toBe(true);
    expect(pairingCodeMatches('  ABCD2345 ', 'ABCD2345')).toBe(true);
  });

  it('rejects a wrong code', () => {
    expect(pairingCodeMatches('ABCD2346', 'ABCD2345')).toBe(false);
  });

  it('rejects a length mismatch without throwing', () => {
    // timingSafeEqual throws on unequal lengths — the guard must come first, or
    // a short guess is a 500 instead of a 403.
    expect(pairingCodeMatches('ABC', 'ABCD2345')).toBe(false);
    expect(pairingCodeMatches('ABCD2345678', 'ABCD2345')).toBe(false);
  });

  it('rejects an empty submission', () => {
    expect(pairingCodeMatches('', '')).toBe(false);
    expect(pairingCodeMatches('', 'ABCD2345')).toBe(false);
  });
});
