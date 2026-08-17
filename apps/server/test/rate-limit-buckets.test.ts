// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The §6 buckets that are NOT declared on a route (08-server-api.md §6,
 * `plugins/core.ts`): the general `/api/` default, the widget-data /
 * exports-imports / LLM / file-bytes rules, the two stream exemptions, and
 * principal keying.
 *
 * These are asserted through `x-ratelimit-limit` on a single reply rather than
 * by exhausting a 300/min window 301 times: the header is the plugin's own
 * report of the budget it attached, so it proves the wiring — which bucket a
 * url landed in — without a slow loop that would only re-test the counter the
 * sibling suite (rate-limit.test.ts) already exhausts.
 */
import fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { corePlugin, RATE_BUCKETS } from '../src/plugins/core.js';
import { makeEnv } from './helpers.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** A core-only app with `ok` probes at the urls under test. */
async function probeApp(routes: readonly { method: 'GET' | 'POST'; url: string }[]): Promise<void> {
  app = fastify({ logger: false });
  await app.register(corePlugin, { env: makeEnv() });
  for (const route of routes) {
    app.route({ method: route.method, url: route.url, handler: async () => ({ ok: true }) });
  }
  await app.ready();
}

/** The budget the limiter attached, or null when the route is unlimited. */
async function budget(method: 'GET' | 'POST', url: string): Promise<number | null> {
  const res = await app!.inject({ method, url });
  const limit = res.headers['x-ratelimit-limit'];
  return limit === undefined ? null : Number(limit);
}

describe('the general /api/ default (§6 row 1)', () => {
  it('buckets every unmarked /api/ route at 300/min and leaves the SPA alone', async () => {
    await probeApp([
      { method: 'GET', url: '/api/v1/anything' },
      { method: 'POST', url: '/api/v1/users' },
      // `global: false` is deliberate: a global limiter would bucket the
      // @fastify/static wildcard and every SPA asset.
      { method: 'GET', url: '/assets/app.js' },
      { method: 'GET', url: '/' },
    ]);

    expect(await budget('GET', '/api/v1/anything')).toBe(300);
    expect(await budget('POST', '/api/v1/users')).toBe(300);
    expect(await budget('GET', '/assets/app.js')).toBeNull();
    expect(await budget('GET', '/')).toBeNull();
  });

  it('exempts the two long-lived streams', async () => {
    // The limiter is an onRequest hook, so it fires on the UPGRADE. A network
    // flap or a laptop wake reconnects every open tab at once and would 429 a
    // client out of realtime entirely. `/ws` also hangs off the ROOT app, not
    // the api prefix, which is why the match is on the url suffix.
    await probeApp([
      { method: 'GET', url: '/api/v1/events' },
      { method: 'GET', url: '/ws' },
    ]);

    expect(await budget('GET', '/api/v1/events')).toBeNull();
    expect(await budget('GET', '/ws')).toBeNull();
  });
});

describe('the url-matched buckets', () => {
  it('routes each §6 surface to its own budget', async () => {
    await probeApp([
      { method: 'POST', url: '/api/v1/widget-data/query' },
      { method: 'POST', url: '/api/v1/widget-data/batch' },
      { method: 'POST', url: '/api/v1/exports' },
      { method: 'POST', url: '/api/v1/imports' },
      { method: 'POST', url: '/api/v1/imports/:id/run' },
      { method: 'POST', url: '/api/v1/llm/runs' },
      { method: 'POST', url: '/api/v1/llm/runs/:id/execute' },
      { method: 'GET', url: '/api/v1/llm/models' },
      { method: 'POST', url: '/api/v1/branding/logo' },
      { method: 'POST', url: '/api/v1/imports/upload' },
      { method: 'GET', url: '/api/v1/exports/:id/download' },
      { method: 'GET', url: '/api/v1/imports/:id/error-report' },
      // Neighbours that must NOT be swept up: replaying an LLM run costs no
      // provider call, listing imports is an ordinary read, and `run` fires on
      // an import the `data-io` bucket already paid for.
      { method: 'POST', url: '/api/v1/llm/runs/:id/apply' },
      { method: 'GET', url: '/api/v1/imports' },
    ]);

    expect(await budget('POST', '/api/v1/widget-data/query')).toBe(RATE_BUCKETS['widget-data'].max);
    expect(await budget('POST', '/api/v1/widget-data/batch')).toBe(RATE_BUCKETS['widget-data'].max);
    expect(await budget('POST', '/api/v1/exports')).toBe(RATE_BUCKETS['data-io'].max);
    expect(await budget('POST', '/api/v1/imports')).toBe(RATE_BUCKETS['data-io'].max);
    expect(await budget('POST', '/api/v1/imports/1/run')).toBe(RATE_BUCKETS.api.max);
    expect(await budget('POST', '/api/v1/llm/runs')).toBe(RATE_BUCKETS.llm.max);
    expect(await budget('POST', '/api/v1/llm/runs/1/execute')).toBe(RATE_BUCKETS.llm.max);
    expect(await budget('GET', '/api/v1/llm/models')).toBe(RATE_BUCKETS.llm.max);

    // The §6 "files" row has no `files` route group to live on, so it lands
    // on the four surfaces that actually move file bytes.
    for (const [method, url] of [
      ['POST', '/api/v1/branding/logo'],
      ['POST', '/api/v1/imports/upload'],
      ['GET', '/api/v1/exports/1/download'],
      ['GET', '/api/v1/imports/1/error-report'],
    ] as const) {
      expect(await budget(method, url), `${method} ${url}`).toBe(RATE_BUCKETS['file-bytes'].max);
    }

    expect(await budget('POST', '/api/v1/llm/runs/1/apply')).toBe(RATE_BUCKETS.api.max);
    expect(await budget('GET', '/api/v1/imports')).toBe(RATE_BUCKETS.api.max);
  });

  it('lets a declared marker win over the url table', async () => {
    app = fastify({ logger: false });
    await app.register(corePlugin, { env: makeEnv() });
    app.post(
      '/api/v1/widget-data/query',
      { config: { rateLimitBucket: 'search' } },
      async () => ({ ok: true }),
    );
    await app.ready();
    expect(await budget('POST', '/api/v1/widget-data/query')).toBe(RATE_BUCKETS.search.max);
  });

  it('still fails the BOOT on an unknown declared bucket', async () => {
    const boot = fastify({ logger: false });
    await boot.register(corePlugin, { env: makeEnv() });
    expect(() =>
      // The typed union stops this at compile time; the cast is what a route
      // registered from JS, or through a cast of its own, would do.
      boot.get('/api/v1/typo', { config: { rateLimitBucket: 'serach' as 'search' } }, async () => ({
        ok: true,
      })),
    ).toThrow(/unknown rate-limit bucket "serach"/);
    await boot.close();
  });
});

describe('principal keying', () => {
  it('gives each principal its own budget, and anonymous callers the ip', async () => {
    // `search` is 60/min per principal. The stub stands in for authPlugin's
    // resolver, which is an INSTANCE onRequest hook — instance hooks run
    // before route-level ones, which is exactly why the limiter can see a
    // principal at all. This test would fail if that ordering ever flipped.
    app = fastify({ logger: false });
    await app.register(corePlugin, { env: makeEnv() });
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id === 'string') {
        (request as unknown as { user: { id: string } }).user = { id };
      }
    });
    app.get('/api/v1/search', { config: { rateLimitBucket: 'search' } }, async () => ({ ok: true }));
    await app.ready();

    const search = (userId?: string) =>
      app!.inject({
        method: 'GET',
        url: '/api/v1/search',
        ...(userId === undefined ? {} : { headers: { 'x-test-user-id': userId } }),
      });

    for (let attempt = 1; attempt <= RATE_BUCKETS.search.max; attempt += 1) {
      expect((await search('user_ava')).statusCode, `attempt ${String(attempt)}`).toBe(200);
    }
    expect((await search('user_ava')).statusCode).toBe(429);

    // Same ip, different account: a shared office NAT is not one budget.
    expect((await search('user_noah')).statusCode).toBe(200);
    // …and a signed-out visitor falls back to the ip, which is a REAL
    // behaviour change for the public routes — see the module header.
    expect((await search()).statusCode).toBe(200);
  });
});
