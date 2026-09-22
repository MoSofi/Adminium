// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An endpoint's own rate limit, and the failed-resolution bucket.
 */

import { describe, expect, it } from 'vitest';

import {
  createPublicRateLimiter,
  endpointRateKeyFor,
  PUBLIC_FAILED_RESOLUTION,
} from '../src/public-api/limiter.js';
import { createPublicKeyResolver } from '../src/public-api/resolve.js';
import { generatePublishableKey } from '../src/public-api/keys.js';
import { PUBLIC_ORIGIN, SOURCE_LEGS, type ServedSource, type SourceSpec } from './public-source-dialects.js';

const RATE = { max: 3, windowMs: 60_000 };
const visitor = (ip: string, extra: Record<string, unknown> = {}) =>
  ({ keyId: 'pbk_1', ref: 'orders', kind: 'browser' as const, ip, ...extra });

describe('the endpoint limiter', () => {
  it('counts per visitor for a browser key, and key-wide for a server key', () => {
    expect(endpointRateKeyFor(visitor('198.51.100.7'))).toBe('ep|pbk_1:orders:ip:198.51.100.7');
    expect(endpointRateKeyFor(visitor('198.51.100.7', { sessionId: 'pss_9' }))).toBe('ep|pbk_1:orders:s:pss_9');
    expect(endpointRateKeyFor(visitor('198.51.100.7', { kind: 'server' }))).toBe('ep|pbk_1:orders');

    const limiter = createPublicRateLimiter(() => 1_000);
    for (let i = 0; i < 3; i += 1) expect(limiter.hitEndpoint(visitor('198.51.100.7'), RATE).allowed).toBe(true);
    expect(limiter.hitEndpoint(visitor('198.51.100.7'), RATE).allowed).toBe(false);
    // One visitor exhausting it takes nobody else down.
    expect(limiter.hitEndpoint(visitor('203.0.113.9'), RATE).allowed).toBe(true);
    // Another ref of the same key is its own bucket.
    expect(limiter.hitEndpoint({ ...visitor('198.51.100.7'), ref: 'products' }, RATE).allowed).toBe(true);
  });

  it('a request is allowed only if its whole cost fits, and a refusal spends nothing', () => {
    let at = 1_000;
    const limiter = createPublicRateLimiter(() => at);
    const spec = { max: 10, windowMs: 60_000 };
    expect(limiter.hitEndpoint(visitor('a'), spec, 7).allowed).toBe(true);
    const refused = limiter.hitEndpoint(visitor('a'), spec, 4);
    expect(refused).toMatchObject({ allowed: false, remaining: 3 });
    // The refused 4 were not counted: 3 still fit.
    expect(limiter.hitEndpoint(visitor('a'), spec, 3).allowed).toBe(true);
    expect(limiter.hitEndpoint(visitor('a'), spec, 1).allowed).toBe(false);
    at += 60_000;
    expect(limiter.hitEndpoint(visitor('a'), spec, 10).allowed).toBe(true);
  });

  it('failed resolutions block an address after the ceiling, and only that address', () => {
    const limiter = createPublicRateLimiter(() => 1_000);
    for (let i = 0; i < PUBLIC_FAILED_RESOLUTION.max; i += 1) {
      expect(limiter.resolutionBlocked('198.51.100.7')).toBeNull();
      limiter.failedResolution('198.51.100.7');
    }
    expect(limiter.resolutionBlocked('198.51.100.7')?.allowed).toBe(false);
    expect(limiter.resolutionBlocked('2001:db8:1:2::1')).toBeNull();
  });

  it('keeps its maps bounded under key churn', () => {
    let at = 0;
    const limiter = createPublicRateLimiter(() => at);
    for (let i = 0; i < 120_000; i += 1) {
      at += 1;
      limiter.hitEndpoint({ ...visitor(`10.${String(i >> 16)}.${String((i >> 8) & 255)}.${String(i & 255)}`) }, RATE);
    }
    // Still answering, and a fresh visitor still gets a fresh allowance.
    expect(limiter.hitEndpoint(visitor('203.0.113.200'), RATE).allowed).toBe(true);
  });

  it('an unknown-token flood stops reaching the key store after the ceiling', async () => {
    let lookups = 0;
    const resolver = createPublicKeyResolver({
      findKeysByPrefix: async () => {
        lookups += 1;
        return Promise.resolve([]);
      },
      findScopeById: async () => Promise.resolve(null),
    });
    const limiter = createPublicRateLimiter(() => 1_000);
    // The gate's order: blocked? then resolve, then count the failure.
    for (let i = 0; i < 200; i += 1) {
      if (limiter.resolutionBlocked('198.51.100.7') !== null) continue;
      if ((await resolver.resolve(generatePublishableKey().token)) === null) limiter.failedResolution('198.51.100.7');
    }
    expect(lookups).toBe(PUBLIC_FAILED_RESOLUTION.max);
  });
});

const SPEC: SourceSpec = {
  ddl: {
    sqlite: ['CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body VARCHAR(100) NOT NULL)'],
    postgres: ['CREATE TABLE notes (id serial PRIMARY KEY, body varchar(100) NOT NULL)'],
    mysql: ['CREATE TABLE notes (id INT AUTO_INCREMENT PRIMARY KEY, body VARCHAR(100) NOT NULL)'],
  },
  seed: ["INSERT INTO notes (body) VALUES ('one')"],
};

describe('over the wire [sqlite]', () => {
  const leg = SOURCE_LEGS.find((l) => l.dialect === 'sqlite');
  it("an endpoint's own ceiling holds per visitor, and a batch spends its rows", async () => {
    const s: ServedSource = await (leg as NonNullable<typeof leg>).serve(SPEC);
    try {
      const list = await s.app.inject({ method: 'GET', url: `/api/v1/public-endpoints?connectionId=${s.connectionId}`, headers: { cookie: s.cookie } });
      const def = JSON.parse(
        (list.json() as { endpoints: { ref: string; definition: string }[] }).endpoints.find((e) => e.ref === 'notes')?.definition ?? '{}',
      ) as Record<string, unknown>;
      const save = await s.app.inject({
        method: 'PUT',
        url: `/api/v1/public-endpoints/${s.connectionId}/notes`,
        headers: { cookie: s.cookie },
        payload: { definition: JSON.stringify({ ...def, methods: ['GET', 'POST', 'BATCH'], rate_limit: { requests: 5, window: '1m' } }) },
      });
      expect(save.statusCode, save.body).toBe(200);
      const key = await s.app.inject({
        method: 'POST',
        url: '/api/v1/public-keys',
        headers: { cookie: s.cookie },
        payload: { name: 'Site', connectionId: s.connectionId, access: [{ ref: 'notes', methods: ['GET', 'BATCH'] }] },
      });
      const token = (key.json() as { token: string }).token;
      const call = (method: 'GET' | 'POST', url: string, from: string, payload?: unknown) =>
        s.app.inject({
          method,
          url: `/api/v1/public/records/${url}`,
          headers: { authorization: `Bearer ${token}`, origin: PUBLIC_ORIGIN, 'x-forwarded-for': from },
          ...(payload === undefined ? {} : { payload: payload as never }),
        });

      // A batch bigger than the whole window is refused outright, never a 429.
      const huge = await call('POST', 'notes/batch', '198.51.100.7', { rows: Array.from({ length: 6 }, () => ({ body: 'x' })) });
      expect(huge.statusCode).toBe(400);
      expect((huge.json() as { error: { params: unknown } }).error.params).toEqual({ max: 5 });

      const four = await call('POST', 'notes/batch', '198.51.100.7', { rows: Array.from({ length: 4 }, () => ({ body: 'x' })) });
      expect(four.statusCode, four.body).toBe(200);
      expect((await call('GET', 'notes', '198.51.100.7')).statusCode).toBe(200);
      const limited = await call('GET', 'notes', '198.51.100.7');
      expect(limited.statusCode).toBe(429);
      expect(limited.headers['retry-after']).toBeDefined();
    } finally {
      await s.close();
    }
  }, 90_000);
});
