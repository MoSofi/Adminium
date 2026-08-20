// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Token → scope resolution (28-public-surface.md §3.2–§3.3).
 *
 * The theme is that EVERY failure returns `null`. Unknown prefix, wrong hash,
 * revoked, expired, missing scope, uncompilable scope — one outcome, because a
 * caller that can tell them apart has an oracle. The `onFailure` hook is where
 * the server keeps the reason it still needs for debugging.
 */

import { describe, expect, it, vi } from 'vitest';

import { generatePublishableKey, hashPublishableKey } from '../src/public-api/keys.js';
import {
  createPublicKeyResolver,
  type PublicKeyRow,
  type PublicScopeRow,
  type ResolveFailure,
} from '../src/public-api/resolve.js';

const SCOPE_DOC = JSON.stringify({
  version: 1,
  side: 'customer',
  timezone: 'Europe/London',
  resources: [
    { ref: 'menu', table: 'public.menu_items', actions: ['read'], expose: ['id', 'name'] },
  ],
});

function rows(token: string, over: Partial<PublicKeyRow> = {}) {
  const { prefix, tokenHash } = {
    prefix: token.slice(0, 16),
    tokenHash: hashPublishableKey(token),
  };
  const key: PublicKeyRow = {
    id: 'pbk_1',
    prefix,
    tokenHash,
    scopeId: 'psc_1',
    side: 'customer',
    origins: '[]',
    expiresAt: null,
    revokedAt: null,
    ...over,
  };
  const scope: PublicScopeRow = {
    id: 'psc_1',
    connectionId: 'conn_1',
    timezone: 'Europe/London',
    document: SCOPE_DOC,
  };
  return { key, scope };
}

function makeResolver(
  key: PublicKeyRow | null,
  scope: PublicScopeRow | null,
  onFailure?: (r: ResolveFailure, d: Record<string, unknown>) => void,
) {
  return createPublicKeyResolver({
    findKeysByPrefix: async () => (key === null ? [] : [key]),
    findScopeById: async () => scope,
    ...(onFailure === undefined ? {} : { onFailure }),
  });
}

describe('resolution succeeds for a live key', () => {
  it('returns the compiled scope, the connection and the side', async () => {
    const { token } = generatePublishableKey();
    const { key, scope } = rows(token);
    const resolved = await makeResolver(key, scope).resolve(token);
    expect(resolved).not.toBeNull();
    expect(resolved?.connectionId).toBe('conn_1');
    expect(resolved?.side).toBe('customer');
    expect(resolved?.scope.timezone).toBe('Europe/London');
    expect(resolved?.scope.byRef.get('menu')?.expose).toEqual(['id', 'name']);
  });

  it('caches, so a second resolve does not hit the store again', async () => {
    const { token } = generatePublishableKey();
    const { key, scope } = rows(token);
    const findKeysByPrefix = vi.fn(async () => [key]);
    const resolver = createPublicKeyResolver({
      findKeysByPrefix,
      findScopeById: async () => scope,
    });
    await resolver.resolve(token);
    await resolver.resolve(token);
    expect(findKeysByPrefix).toHaveBeenCalledTimes(1);
  });

  it('invalidate(keyId) drops just that key', async () => {
    const { token } = generatePublishableKey();
    const { key, scope } = rows(token);
    const findKeysByPrefix = vi.fn(async () => [key]);
    const resolver = createPublicKeyResolver({ findKeysByPrefix, findScopeById: async () => scope });
    await resolver.resolve(token);
    resolver.invalidate('pbk_1');
    await resolver.resolve(token);
    expect(findKeysByPrefix).toHaveBeenCalledTimes(2);
  });
});

describe('every failure looks identical to the caller', () => {
  const cases: Array<[string, ResolveFailure, () => Promise<unknown>]> = [
    [
      'unknown prefix',
      'no-prefix-match',
      async () => {
        const { token } = generatePublishableKey();
        const seen: ResolveFailure[] = [];
        const r = await makeResolver(null, null, (x) => seen.push(x)).resolve(token);
        return { r, seen };
      },
    ],
    [
      'wrong hash (prefix collision)',
      'hash-mismatch',
      async () => {
        const { token } = generatePublishableKey();
        const other = generatePublishableKey();
        const { key, scope } = rows(token, { tokenHash: other.tokenHash });
        const seen: ResolveFailure[] = [];
        const r = await makeResolver(key, scope, (x) => seen.push(x)).resolve(token);
        return { r, seen };
      },
    ],
    [
      'revoked',
      'not-live',
      async () => {
        const { token } = generatePublishableKey();
        const { key, scope } = rows(token, { revokedAt: 1 });
        const seen: ResolveFailure[] = [];
        const r = await makeResolver(key, scope, (x) => seen.push(x)).resolve(token);
        return { r, seen };
      },
    ],
    [
      'expired',
      'not-live',
      async () => {
        const { token } = generatePublishableKey();
        const { key, scope } = rows(token, { expiresAt: 1 });
        const seen: ResolveFailure[] = [];
        const r = await makeResolver(key, scope, (x) => seen.push(x)).resolve(token);
        return { r, seen };
      },
    ],
    [
      'scope row gone',
      'scope-missing',
      async () => {
        const { token } = generatePublishableKey();
        const { key } = rows(token);
        const seen: ResolveFailure[] = [];
        const r = await makeResolver(key, null, (x) => seen.push(x)).resolve(token);
        return { r, seen };
      },
    ],
    [
      'scope no longer compiles',
      'scope-uncompilable',
      async () => {
        const { token } = generatePublishableKey();
        const { key, scope } = rows(token);
        const seen: ResolveFailure[] = [];
        const r = await makeResolver(
          key,
          { ...scope, document: JSON.stringify({ version: 1, side: 'customer' }) },
          (x) => seen.push(x),
        ).resolve(token);
        return { r, seen };
      },
    ],
  ];

  it.each(cases)('%s → null, with the reason kept server-side only', async (_label, reason, run) => {
    const { r, seen } = (await run()) as { r: unknown; seen: ResolveFailure[] };
    expect(r).toBeNull();
    expect(seen).toContain(reason);
  });
});

describe('the schema moving under a scope takes it dark', () => {
  it('refuses when a column the scope names no longer exists', async () => {
    // A partially-valid authorization document is not a narrower one; it is an
    // unreviewed one. So the key stops working rather than serving what is left.
    const { token } = generatePublishableKey();
    const { key, scope } = rows(token);
    const seen: ResolveFailure[] = [];
    const resolver = createPublicKeyResolver({
      findKeysByPrefix: async () => [key],
      findScopeById: async () => scope,
      // `name` has been dropped from the table since the scope was authored.
      columnsOf: async () => () => new Set(['id']),
      onFailure: (r) => seen.push(r),
    });
    expect(await resolver.resolve(token)).toBeNull();
    expect(seen).toContain('scope-uncompilable');
  });
});

describe('origins', () => {
  it('parses a per-key narrowing list', async () => {
    const { token } = generatePublishableKey();
    const { key, scope } = rows(token, { origins: '["https://a.example"]' });
    const resolved = await makeResolver(key, scope).resolve(token);
    expect(resolved?.origins).toEqual(['https://a.example']);
  });

  it('a malformed origins column narrows to NOTHING, never to everything', async () => {
    const { token } = generatePublishableKey();
    const { key, scope } = rows(token, { origins: 'not json' });
    const resolved = await makeResolver(key, scope).resolve(token);
    // Empty means "not narrowed beyond the env allow-list", which is still the
    // outer bound — it must never be read as "any origin".
    expect(resolved?.origins).toEqual([]);
  });
});
