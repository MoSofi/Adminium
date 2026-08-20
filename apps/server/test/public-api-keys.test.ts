// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Publishable keys (28-public-surface.md §3.3, 28-T06) and the D4 prefix
 * narrowing.
 *
 * The tests that matter here are the NEGATIVE ones. A publishable key working
 * on the public surface is the easy half; the property the whole off switch
 * rests on is that it works NOWHERE ELSE, and that property is held by two
 * parsers disagreeing about a prefix. It is therefore exactly the kind of thing
 * a later "let's unify the key parsing" refactor would quietly undo.
 */

import { describe, expect, it } from 'vitest';

import { API_KEY_PREFIX, generateApiKey, parseBearerApiKey } from '../src/rbac/api-keys.js';
import {
  PUBLIC_SESSION_PREFIX,
  PUBLISHABLE_KEY_PREFIX,
  generatePublicSessionToken,
  generatePublishableKey,
  hashPublishableKey,
  keyIsLive,
  parseBearerPublishableKey,
  parsePublicSessionToken,
  rotatePublishableKey,
  tokenHashEquals,
} from '../src/public-api/keys.js';

describe('the two key namespaces cannot be confused (28 D3)', () => {
  it('an adm_pub_ token is invisible to the API-key parser', () => {
    // This single assertion is why an `adm_pub_` token is inert on all ~35
    // route groups: `parseBearerApiKey` returning null means the rbac plugin
    // never resolves a principal, so `request.can()` is false everywhere.
    const { token } = generatePublishableKey();
    expect(parseBearerApiKey(`Bearer ${token}`)).toBeNull();
  });

  it('an adm_sk_ token is invisible to the publishable parser', () => {
    // The converse matters too: a secret key pasted into a browser bundle must
    // not become usable on the public surface just because it is a valid key.
    const { key } = generateApiKey();
    expect(parseBearerPublishableKey(`Bearer ${key}`)).toBeNull();
  });

  it('neither prefix is a prefix of the other', () => {
    // The structural reason the two parsers can never both match. `adm_` — the
    // value `plugins/auth.ts` used to carry — IS a prefix of both, which is
    // precisely what D4 removed.
    expect(PUBLISHABLE_KEY_PREFIX.startsWith(API_KEY_PREFIX)).toBe(false);
    expect(API_KEY_PREFIX.startsWith(PUBLISHABLE_KEY_PREFIX)).toBe(false);
  });

  it('the session prefix is distinct from the key prefix, and not a prefix of it', () => {
    // `adm_pub_` vs `adm_pubs_`: a session token must not parse as a key.
    expect(parseBearerPublishableKey(`Bearer ${generatePublicSessionToken().token}`)).toBeNull();
    expect(PUBLIC_SESSION_PREFIX.startsWith(PUBLISHABLE_KEY_PREFIX)).toBe(false);
  });
});

describe('D4 — the loose adm_ prefix is gone', () => {
  it('a garbage adm_ bearer resolves to nothing on either parser', () => {
    // Before D4, ANY `adm_`-prefixed bearer bought an unconditional
    // `adminium_api_keys` lookup in an onRequest hook that runs before
    // route-level rate limiting — a free meta-store query per request.
    for (const junk of ['adm_', 'adm_x', 'adm_pu', 'adm_s', 'adm_live_deadbeef']) {
      expect(parseBearerApiKey(`Bearer ${junk}`)).toBeNull();
      expect(parseBearerPublishableKey(`Bearer ${junk}`)).toBeNull();
    }
  });

  it('the documented-but-nonexistent adm_live_ kind is not accepted by either', () => {
    // 08-server-api.md §2.16 still says `adm_live_`; no such prefix exists in
    // code. Pinned so the doc drift cannot become a real acceptance path.
    expect(parseBearerApiKey('Bearer adm_live_0123456789')).toBeNull();
    expect(parseBearerPublishableKey('Bearer adm_live_0123456789')).toBeNull();
  });
});

describe('token generation', () => {
  it('mints the documented shape', () => {
    const { token, prefix, tokenHash } = generatePublishableKey();
    expect(token).toMatch(/^adm_pub_[A-Za-z0-9]{40}$/);
    expect(prefix).toBe(token.slice(0, PUBLISHABLE_KEY_PREFIX.length + 8));
    expect(tokenHash).toBe(hashPublishableKey(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never repeats, and uses the whole alphabet', () => {
    // A modulo-biased generator would still pass a uniqueness check, so also
    // assert the alphabet is actually reachable across a decent sample.
    const seen = new Set<string>();
    const chars = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const { token } = generatePublishableKey();
      seen.add(token);
      for (const c of token.slice(PUBLISHABLE_KEY_PREFIX.length)) chars.add(c);
    }
    expect(seen.size).toBe(500);
    expect(chars.size).toBeGreaterThan(55);
  });

  it('rotation produces a different secret', () => {
    const before = generatePublishableKey();
    const after = rotatePublishableKey();
    expect(after.token).not.toBe(before.token);
    expect(after.tokenHash).not.toBe(before.tokenHash);
  });

  it('parses a session token from its own header', () => {
    const { token } = generatePublicSessionToken();
    expect(parsePublicSessionToken(token)).toBe(token);
    expect(parsePublicSessionToken('nope')).toBeNull();
    expect(parsePublicSessionToken(undefined)).toBeNull();
  });
});

describe('parsing is strict about the header', () => {
  it.each([
    ['no scheme', 'adm_pub_0123456789012345678901234567890123456789'],
    ['wrong scheme', 'Basic adm_pub_0123456789012345678901234567890123456789'],
    ['empty', ''],
  ])('refuses %s', (_label, header) => {
    expect(parseBearerPublishableKey(header)).toBeNull();
  });

  it('accepts case-insensitive scheme and surrounding whitespace', () => {
    const { token } = generatePublishableKey();
    expect(parseBearerPublishableKey(`  bearer ${token}  `)).toBe(token);
    expect(parseBearerPublishableKey(`BEARER ${token}`)).toBe(token);
  });
});

describe('hash comparison and liveness', () => {
  it('compares equal hashes and rejects unequal ones', () => {
    const a = hashPublishableKey('one');
    expect(tokenHashEquals(a, hashPublishableKey('one'))).toBe(true);
    expect(tokenHashEquals(a, hashPublishableKey('two'))).toBe(false);
  });

  it('does not throw on a length mismatch', () => {
    // `timingSafeEqual` throws rather than returning false when the buffers
    // differ in length, which would turn a malformed row into a 500.
    expect(() => tokenHashEquals('abc', hashPublishableKey('x'))).not.toThrow();
    expect(tokenHashEquals('abc', hashPublishableKey('x'))).toBe(false);
  });

  it('treats revoked and expired keys as dead, and a fresh key as live', () => {
    const now = 1_000_000;
    expect(keyIsLive({ revokedAt: null, expiresAt: null }, now)).toBe(true);
    expect(keyIsLive({ revokedAt: null, expiresAt: now + 1 }, now)).toBe(true);
    expect(keyIsLive({ revokedAt: now - 1, expiresAt: null }, now)).toBe(false);
    expect(keyIsLive({ revokedAt: null, expiresAt: now }, now)).toBe(false);
    expect(keyIsLive({ revokedAt: null, expiresAt: now - 1 }, now)).toBe(false);
  });
});
