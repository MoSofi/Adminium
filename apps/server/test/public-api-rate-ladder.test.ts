// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public limiter counts only what it has verified.
 *
 * ── THE BUG THIS PINS ──────────────────────────────────────────────────────
 * The gate used to count every request ONCE, before anything was verified, on
 * a bucket named by the request itself: the first 16 characters of the token,
 * or the raw `x-adminium-public-session` header when one was sent. Both are the
 * caller's to vary. `parsePublicSessionToken` checks nothing but the `adm_pubs_`
 * prefix, so a fresh random session header on every attempt was a fresh
 * 5-a-minute `public-claim` bucket on every attempt, and claim brute force ran
 * at the core backstop (600 a minute), 120× the intended rate. Random
 * tokens did the same to the pre-resolution bucket, and grew the limiter's map
 * by one entry per request.
 *
 * ── WHAT EACH CASE WOULD HAVE CAUGHT ───────────────────────────────────────
 * Every case runs against a composed server with a key that RESOLVES and, where
 * it matters, a session row that verifies: the old code keyed on unverified
 * input, and only real rows can show that the new code keys on them instead.
 * `public-api-rate-key.test.ts` covers the other half of the identity, the
 * address the proxy wrote.
 */

import BetterSqlite3 from 'better-sqlite3';
import {
  createSqliteMetaDb,
  firstRun,
  publicKeysRepo,
  publicScopesRepo,
  publicSessionsRepo,
  settingsRepo,
  type MetaDb,
} from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { generatePublicSessionToken, generatePublishableKey } from '../src/public-api/keys.js';
import {
  PUBLIC_FAILED_RESOLUTION,
  PUBLIC_FLOOD_GUARD,
  PUBLIC_KEY_LIMITS,
  PUBLIC_LIMITS,
  createPublicRateLimiter,
  floodKeyFor,
  rateAddress,
  rateKeyFor,
} from '../src/public-api/limiter.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const ALLOWED = 'https://shop.example.com';
const READ_MAX = PUBLIC_LIMITS['public-read'].max;
const CLAIM_MAX = PUBLIC_LIMITS['public-claim'].max;
const FLOOD_MAX = PUBLIC_FLOOD_GUARD.max;

type App = ComposedServer['app'];

function memoryStore(meta: MetaDb): MetaStoreHandle {
  return {
    meta,
    url: 'sqlite::memory:',
    engine: 'sqlite',
    source: 'embedded',
    close: async () => Promise.resolve(),
  };
}

let open: { close: () => Promise<void> } | undefined;

afterEach(async () => {
  await open?.close();
  open = undefined;
});

/**
 * A serving instance, a live key, and a verified session on that key.
 *
 * Loopback bind with no proxy trust, so `request.ip` is the socket address and
 * `inject`'s `remoteAddress` stands in for a caller's network. The scope
 * declares no `claim`, so a claim that clears the gate answers 403
 * `PUBLIC_CLAIM_UNAVAILABLE` without needing a source database: anything but a
 * 429 means the limiter let it through.
 */
async function serving(): Promise<{ app: App; token: string; session: string }> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await settingsRepo(meta).set('publicApi.enabled', true);
  const manager = new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret(TEST_SECRET),
    metaDsn: null,
  });
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv({ ADMINIUM_PUBLIC_API_ORIGINS: ALLOWED, HOST: '127.0.0.1' }),
    metaStore: memoryStore(meta),
    manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => {
      /* never relocates */
    },
  });
  await composed.app.ready();
  open = {
    close: async () => {
      await composed.app.close();
      await meta.db.destroy();
    },
  };

  const connection = await manager.connections.create({
    name: 'Shop',
    engine: 'postgres',
    introspectDsn: 'postgres://ro@db.internal:5432/shop',
  });
  const scope = await publicScopesRepo(meta).create({
    connectionId: connection.id,
    side: 'customer',
    name: 'storefront',
    timezone: 'Europe/London',
    document: JSON.stringify({
      version: 1,
      side: 'customer',
      timezone: 'Europe/London',
      resources: [
        { ref: 'menu', table: 'public.menu_items', actions: ['read'], expose: ['id', 'name'] },
      ],
    }),
  });
  const { token, prefix, tokenHash } = generatePublishableKey();
  const key = await publicKeysRepo(meta).create({
    name: 'web',
    prefix,
    tokenHash,
    tokenEncrypted: 'sealed',
    scopeId: scope.id,
    side: 'customer',
  });
  const session = generatePublicSessionToken();
  await publicSessionsRepo(meta).create({
    keyId: key.id,
    tokenHash: session.tokenHash,
    grants: JSON.stringify({ ref: 'menu', column: 'id', value: 1 }),
    expiresAt: Date.now() + 3_600_000,
  });
  return { app: composed.app, token, session: session.token };
}

interface Call {
  token: string;
  session?: string;
  from?: string;
}

const headers = ({ token, session }: Call): Record<string, string> => ({
  origin: ALLOWED,
  authorization: `Bearer ${token}`,
  ...(session === undefined ? {} : { 'x-adminium-public-session': session }),
});

/** A `public-read`: the config route needs no source database. */
const read = (app: App, call: Call) =>
  app.inject({
    method: 'GET',
    url: '/api/v1/public/config',
    headers: headers(call),
    remoteAddress: call.from ?? '198.51.100.7',
  });

/** A `public-claim`. */
const claim = (app: App, call: Call) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/public/claim',
    headers: headers(call),
    payload: { match: { ref: 'A-1001', email: 'someone@example.com' } },
    remoteAddress: call.from ?? '198.51.100.7',
  });

/** A session header that passes the prefix check and verifies nothing. */
const forgedSession = (): string => generatePublicSessionToken().token;

const codeOf = (res: { json: () => unknown }): string | undefined =>
  (res.json() as { error?: { code?: string } }).error?.code;

describe('the rungs', () => {
  it('a claim never counts on a session rung, whatever session it names', () => {
    const anonymous = rateKeyFor('public-claim', { keyId: 'pbk_1', ip: '198.51.100.7' });
    expect(
      rateKeyFor('public-claim', { keyId: 'pbk_1', ip: '198.51.100.7', sessionId: 'pss_1' }),
    ).toBe(anonymous);
    expect(
      rateKeyFor('public-read', { keyId: 'pbk_1', ip: '198.51.100.7', sessionId: 'pss_1' }),
    ).toBe('public-read|pubs:pss_1');
  });

  it('counts an IPv6 caller by its /64, and a mapped IPv4 caller by its address', () => {
    expect(rateAddress('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(rateAddress('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(rateAddress('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    // Collapsing these to their /64 would put every IPv4 caller of a
    // dual-stack listener in ONE bucket.
    expect(rateAddress('::ffff:198.51.100.7')).toBe('198.51.100.7');
    expect(rateAddress('::ffff:c633:6407')).toBe('198.51.100.7');
    expect(rateAddress('198.51.100.7')).toBe('198.51.100.7');
    expect(floodKeyFor('2001:db8:1:2::9')).toBe(floodKeyFor('2001:db8:1:2:ffff::1'));
    expect(floodKeyFor('2001:db8:1:3::9')).not.toBe(floodKeyFor('2001:db8:1:2::9'));
  });

  it('the flood guard sits above everything one address can spend after resolution', () => {
    // Below this it would bind before the limits it guards: an address's
    // anonymous rung in all three classes, plus one claimed session's.
    const anonymous = Object.values(PUBLIC_LIMITS).reduce((sum, l) => sum + l.max, 0);
    const session = anonymous - CLAIM_MAX;
    expect(FLOOD_MAX).toBeGreaterThanOrEqual(anonymous + session);
  });
});

describe('the claim guard cannot be reset from the request', () => {
  it('a fresh random session header on every attempt does not buy another claim', async () => {
    const { app, token } = await serving();

    for (let attempt = 1; attempt <= CLAIM_MAX; attempt += 1) {
      const res = await claim(app, { token, session: forgedSession() });
      expect(res.statusCode, `attempt ${String(attempt)} of ${String(CLAIM_MAX)}`).toBe(403);
      expect(codeOf(res)).toBe('PUBLIC_CLAIM_UNAVAILABLE');
    }

    const limited = await claim(app, { token, session: forgedSession() });
    expect(limited.statusCode).toBe(429);
    expect(codeOf(limited)).toBe('PUBLIC_RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
  }, 60_000);

  it('nor does a session that verifies: claims ignore sessions entirely', async () => {
    const { app, token, session } = await serving();

    for (let attempt = 1; attempt <= CLAIM_MAX; attempt += 1) {
      expect((await claim(app, { token })).statusCode).toBe(403);
    }
    expect((await claim(app, { token, session })).statusCode).toBe(429);
  }, 60_000);

  it('nor does moving to another address in the same /64', async () => {
    const { app, token } = await serving();
    const from = (i: number) => `2001:db8:1:2::${i.toString(16)}`;

    for (let attempt = 1; attempt <= CLAIM_MAX; attempt += 1) {
      expect((await claim(app, { token, from: from(attempt) })).statusCode).toBe(403);
    }
    expect((await claim(app, { token, from: from(CLAIM_MAX + 1) })).statusCode).toBe(429);
    // A different /64 is a different caller.
    expect((await claim(app, { token, from: '2001:db8:1:3::1' })).statusCode).toBe(403);
  }, 60_000);
});

describe('the pre-resolution bucket is the address, not the token', () => {
  it('random token prefixes from one address share one bucket', async () => {
    const { app } = await serving();
    const randomToken = () => generatePublishableKey().token;

    // Tokens that resolve to nothing hit the failed-resolution bucket first
    // (30 a minute per address), before the 300 flood guard.
    const unresolvedMax = Math.min(FLOOD_MAX, PUBLIC_FAILED_RESOLUTION.max);
    for (let attempt = 1; attempt <= unresolvedMax; attempt += 1) {
      const res = await read(app, { token: randomToken() });
      expect(res.statusCode, `attempt ${String(attempt)} of ${String(unresolvedMax)}`).toBe(401);
    }

    const limited = await read(app, { token: randomToken() });
    expect(limited.statusCode).toBe(429);
    expect(codeOf(limited)).toBe('PUBLIC_RATE_LIMITED');

    // The converse: the bucket is the address's, so another address is untouched.
    expect((await read(app, { token: randomToken(), from: '203.0.113.9' })).statusCode).toBe(401);
  }, 60_000);
});

describe('a verified session keeps its own allowance', () => {
  it('reads past an exhausted anonymous rung on the same key and address', async () => {
    const { app, token, session } = await serving();

    for (let attempt = 1; attempt <= READ_MAX; attempt += 1) {
      const res = await read(app, { token });
      expect(res.statusCode, `attempt ${String(attempt)} of ${String(READ_MAX)}`).toBe(200);
    }
    expect((await read(app, { token })).statusCode).toBe(429);

    // A header that verifies nothing counts where an anonymous caller counts...
    expect((await read(app, { token, session: forgedSession() })).statusCode).toBe(429);
    // ...and the real session is on its own rung.
    expect((await read(app, { token, session })).statusCode).toBe(200);
  }, 60_000);
});

describe('the whole key', () => {
  it('trips across many addresses, each inside its own allowance', async () => {
    const { app, token } = await serving();
    const addresses = PUBLIC_KEY_LIMITS.read.max / READ_MAX;
    for (let n = 1; n <= addresses; n += 1) {
      for (let attempt = 1; attempt <= READ_MAX; attempt += 1) {
        const res = await read(app, { token, from: `198.51.100.${String(n)}` });
        expect(res.statusCode, `address ${String(n)}, attempt ${String(attempt)}`).toBe(200);
      }
    }
    // A fresh address, a fresh per-visitor allowance: the key as a whole is spent.
    const limited = await read(app, { token, from: '203.0.113.50' });
    expect(limited.statusCode).toBe(429);
    expect(codeOf(limited)).toBe('PUBLIC_RATE_LIMITED');
  }, 120_000);

  it('counts claims on the stricter write rung', async () => {
    const { app, token } = await serving();
    const addresses = PUBLIC_KEY_LIMITS.write.max / CLAIM_MAX;
    for (let n = 1; n <= addresses; n += 1) {
      for (let attempt = 1; attempt <= CLAIM_MAX; attempt += 1) {
        expect((await claim(app, { token, from: `198.51.100.${String(n)}` })).statusCode).toBe(403);
      }
    }
    expect((await claim(app, { token, from: '203.0.113.50' })).statusCode).toBe(429);
    // Reads are their own rung.
    expect((await read(app, { token, from: '203.0.113.50' })).statusCode).toBe(200);
  }, 120_000);

  it('adds nothing for a refused request, and reopens with its window', () => {
    let at = 1_000;
    const limiter = createPublicRateLimiter(() => at);
    expect(limiter.hitKey('pbk_1', 'write', 59).allowed).toBe(true);
    expect(limiter.hitKey('pbk_1', 'write', 2).allowed).toBe(false);
    expect(limiter.hitKey('pbk_1', 'write').allowed).toBe(true);
    expect(limiter.hitKey('pbk_1', 'write').allowed).toBe(false);
    expect(limiter.hitKey('pbk_2', 'write').allowed).toBe(true);
    at += PUBLIC_KEY_LIMITS.write.windowMs;
    expect(limiter.hitKey('pbk_1', 'write').allowed).toBe(true);
  });
});
