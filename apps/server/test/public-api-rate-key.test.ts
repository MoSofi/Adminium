// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public limiter's bucket key behind a proxy (28-public-surface.md D18/O8).
 *
 * ── WHY THIS EXISTS SEPARATELY FROM `rate-limit.test.ts` ───────────────────
 * That suite proves the same property for the LOGIN bucket, which is a
 * different limiter: `plugins/core.ts`'s `RATE_BUCKETS`, keyed by
 * `principalKey`. The public namespace deliberately does not use it — a
 * publishable key never becomes an rbac principal (D3), so a `keyBy: 'public'`
 * branch there would silently fall through to `ip:` — and it carries its own
 * `createPublicRateLimiter` with its own ladder,
 * `pubs:<session>` → `pub:<keyId>:ip:<ip>` → `pub:<keyId>`. Two limiters, two
 * key builders; proving one says nothing about the other.
 *
 * ── WHY IT MATTERS MORE HERE THAN ANYWHERE ELSE ────────────────────────────
 * This is the surface that answers strangers with no credential worth the name,
 * so per-IP counting is the only thing standing between an anonymous endpoint
 * and both enumeration and denial of service. D18 made `ADMINIUM_TRUST_PROXY` a
 * hard requirement for that reason. O8 then found that D18's premise — "behind
 * the shipped Caddy" — was false for all fifteen marketplace stacks, which
 * published Adminium's port directly and proxied nothing; the fix put Caddy in
 * front and turned the flag on, and this is the assertion that the combination
 * actually buys what it claims.
 *
 * The mechanism under test is `trustProxy: 1` in `app.ts` — a hop COUNT, never
 * a bare `true`. With `true`, proxy-addr returns the left-most, fully
 * client-supplied `X-Forwarded-For` entry, and rotating the header hands out a
 * fresh bucket per request. With `1`, `request.ip` is the right-most entry, the
 * one Caddy itself appended, which no client can move.
 *
 * The limiter runs BEFORE the key is resolved (`routes/public/index.ts`), so an
 * unverified key is enough to drive it — which is deliberate there, and
 * convenient here.
 */

import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { PUBLIC_LIMITS } from '../src/public-api/limiter.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

/** A syntactically valid publishable key that resolves to nothing. */
const KEY = `adm_pub_${'a'.repeat(32)}`;
const ORIGIN = 'https://shop.example.com';
const READ_MAX = PUBLIC_LIMITS['public-read'].max;

function memoryStore(meta: MetaDb): MetaStoreHandle {
  return {
    meta,
    url: 'sqlite::memory:',
    engine: 'sqlite',
    source: 'embedded',
    close: async () => Promise.resolve(),
  };
}

/** Bound to 0.0.0.0 with the flag ON — the fleet's shipped topology after O8. */
async function composeBehindProxy(meta: MetaDb): Promise<ComposedServer> {
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv({
      ADMINIUM_PUBLIC_API_ORIGINS: ORIGIN,
      ADMINIUM_TRUST_PROXY: 'on',
      HOST: '0.0.0.0',
    }),
    metaStore: memoryStore(meta),
    manager: new ConnectionManager({
      meta,
      crypto: dsnCryptoFromSecret(TEST_SECRET),
      metaDsn: null,
    }),
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
  return composed;
}

let open: { close: () => Promise<void> } | undefined;

afterEach(async () => {
  await open?.close();
  open = undefined;
});

/**
 * A composed server with the public surface actually SERVING. Both env origins
 * and the `publicApi.enabled` row have to be on — two independent switches, and
 * the row defaults false, so without it every route answers 503 and the limiter
 * is never reached.
 */
async function serving(): Promise<ComposedServer['app']> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await settingsRepo(meta).set('publicApi.enabled', true);
  const composed = await composeBehindProxy(meta);
  open = {
    close: async () => {
      await composed.app.close();
      await meta.db.destroy();
    },
  };
  return composed.app;
}

/** One public read, arriving as it would behind Caddy. */
async function read(app: ComposedServer['app'], forwardedFor: string) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/public/records/anything',
    headers: {
      authorization: `Bearer ${KEY}`,
      origin: ORIGIN,
      'x-forwarded-for': forwardedFor,
    },
  });
}

describe('the public bucket keys on the address the proxy wrote', () => {
  it('rotating X-Forwarded-For cannot mint fresh public buckets', async () => {
    const app = await serving();

    // What arrives behind Caddy: the attacker's junk on the left, changing
    // every request, and the genuine peer Caddy appended on the right.
    const spoofed = (i: number) => read(app, `10.0.0.${String(i % 250)}, 198.51.100.7`);

    for (let attempt = 1; attempt <= READ_MAX; attempt += 1) {
      const res = await spoofed(attempt);
      expect(res.statusCode, `attempt ${String(attempt)} of ${String(READ_MAX)}`).not.toBe(429);
    }

    const limited = await spoofed(READ_MAX + 1);
    expect(limited.statusCode).toBe(429);
    expect(limited.json<{ error: { code: string } }>().error.code).toBe('PUBLIC_RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('a genuinely different peer still gets its own allowance', async () => {
    // The converse, and the reason this is a hop count rather than "ignore the
    // header": a limiter that collapsed every caller into one bucket would pass
    // the test above while starving every real customer.
    const app = await serving();

    for (let attempt = 1; attempt <= READ_MAX + 1; attempt += 1) {
      await read(app, '10.0.0.1, 198.51.100.7');
    }
    expect((await read(app, '10.0.0.1, 198.51.100.7')).statusCode).toBe(429);

    // Same forged left-hand entry, different real peer — untouched.
    const other = await read(app, '10.0.0.1, 203.0.113.9');
    expect(other.statusCode).not.toBe(429);
  });
});
