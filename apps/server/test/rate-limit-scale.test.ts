// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `ADMINIUM_RATE_LIMIT_SCALE`: a test server widens every request limit by one
 * whole number, the API's buckets and the public API's alike. Unset, every
 * limit is a real server's, and the setting itself refuses anything that is
 * not a whole number from 1 to 1000. A production server ignores it.
 */
import fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { envSchema } from '../src/config/env.js';
import { rateLimitScale } from '../src/config/rate-limit-scale.js';
import { corePlugin, RATE_BUCKETS } from '../src/plugins/core.js';
import { createPublicRateLimiter, PUBLIC_KEY_LIMITS, PUBLIC_LIMITS } from '../src/public-api/limiter.js';
import { makeEnv } from './helpers.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function budgets(scale: number | undefined, warnings: string[] = []): Promise<{ api: number; login: number }> {
  app = fastify({ logger: { level: 'warn', stream: { write: (line: string) => warnings.push(line) } } });
  await app.register(corePlugin, { env: makeEnv(scale === undefined ? {} : { ADMINIUM_RATE_LIMIT_SCALE: String(scale) }) });
  app.get('/api/v1/anything', async () => ({ ok: true }));
  app.post('/api/v1/auth/login', { config: { rateLimitBucket: 'auth-login' } }, async () => ({ ok: true }));
  await app.ready();
  const limit = async (method: 'GET' | 'POST', url: string) => Number((await app!.inject({ method, url })).headers['x-ratelimit-limit']);
  return { api: await limit('GET', '/api/v1/anything'), login: await limit('POST', '/api/v1/auth/login') };
}

describe('request limits on a test server', () => {
  it('keeps a real server’s limits when unset, and says nothing', async () => {
    const warnings: string[] = [];
    expect(await budgets(undefined, warnings)).toEqual({ api: RATE_BUCKETS.api.max, login: RATE_BUCKETS['auth-login'].max });
    expect(warnings.join('')).not.toContain('request limits are multiplied');
  });

  it('multiplies every API bucket, and says so at boot', async () => {
    const warnings: string[] = [];
    expect(await budgets(20, warnings)).toEqual({ api: RATE_BUCKETS.api.max * 20, login: RATE_BUCKETS['auth-login'].max * 20 });
    expect(warnings.join('')).toContain('request limits are multiplied by 20: for test servers only');
  });

  it('multiplies the public API’s limits too, and refuses past the widened one', () => {
    const real = createPublicRateLimiter(() => 0);
    const wide = createPublicRateLimiter(() => 0, 3);
    expect(real.hitKey('key_1', 'read').limit).toBe(PUBLIC_KEY_LIMITS.read.max);
    expect(wide.hitKey('key_1', 'read').limit).toBe(PUBLIC_KEY_LIMITS.read.max * 3);

    const identity = { keyId: 'key_1', ip: '203.0.113.9' };
    const max = PUBLIC_LIMITS['public-claim'].max * 3;
    for (let n = 1; n <= max; n += 1) expect(wide.hit('public-claim', identity).allowed).toBe(true);
    expect(wide.hit('public-claim', identity).allowed).toBe(false);
  });

  it('is ignored on a production server, which says so and keeps its limits', async () => {
    expect(rateLimitScale({ ADMINIUM_RATE_LIMIT_SCALE: 20 }, 'production')).toEqual({ scale: 1, ignored: true });
    expect(rateLimitScale({ ADMINIUM_RATE_LIMIT_SCALE: 20 }, 'test')).toEqual({ scale: 20, ignored: false });
    expect(rateLimitScale({ ADMINIUM_RATE_LIMIT_SCALE: undefined }, 'production')).toEqual({ scale: 1, ignored: false });

    vi.stubEnv('NODE_ENV', 'production');
    try {
      const warnings: string[] = [];
      expect(await budgets(20, warnings)).toEqual({ api: RATE_BUCKETS.api.max, login: RATE_BUCKETS['auth-login'].max });
      expect(warnings.join('')).toContain('ADMINIUM_RATE_LIMIT_SCALE is ignored: NODE_ENV is production');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('takes only a whole number from 1 to 1000', () => {
    expect(makeEnv({ ADMINIUM_RATE_LIMIT_SCALE: '50' }).ADMINIUM_RATE_LIMIT_SCALE).toBe(50);
    expect(makeEnv({ ADMINIUM_RATE_LIMIT_SCALE: '' }).ADMINIUM_RATE_LIMIT_SCALE).toBeUndefined();
    for (const bad of ['0', '-2', '1.5', '1001', 'many']) {
      expect(envSchema.safeParse({ ADMINIUM_SECRET: makeEnv().ADMINIUM_SECRET, ADMINIUM_RATE_LIMIT_SCALE: bad }).success, bad).toBe(false);
    }
  });
});
