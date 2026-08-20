// SPDX-License-Identifier: AGPL-3.0-only
/**
 * 28-T09 — a publishable key is inert on every route that is not the public
 * namespace (28-public-surface.md D3, acceptance criterion 1).
 *
 * ── WHY THIS TEST IS THE LOAD-BEARING ONE ──────────────────────────────────
 * The whole off switch rests on one property: an `adm_pub_` token can never
 * become an `RbacPrincipal`, so it is refused everywhere by construction rather
 * than by an allow-list somebody maintains. §3.5 makes that claim explicitly,
 * and the plan notes a competing design that asserted the same property while
 * ALSO shipping an eleven-prefix route allow-list — a contradiction that went
 * unnoticed until a reviewer read both halves.
 *
 * So this enumerates the SERVER'S OWN ROUTE TREE and presents the token to
 * every route in it. A hand-written path list would pass forever while a new
 * route added next year quietly accepted the key. That is criterion 1's actual
 * requirement — "asserted by a test that enumerates the registration list, not
 * a hand-written path list" — and it is why this composes the widest topology
 * it can rather than a minimal one.
 *
 * ── WHAT "INERT" MEANS HERE, AND WHY THE OBVIOUS TEST IS WRONG ─────────────
 * The first version of this asserted "no 2xx". It failed on six routes —
 * `/healthz`, `/readyz`, `/system/info`, `/setup/state`, `/branding`,
 * `/i18n/manifest` — every one of which is deliberately unauthenticated: the
 * login page needs branding and translations before anyone has a session, and
 * setup must answer before an account exists. Those 200s were not the key being
 * honoured; they were routes that ignore credentials entirely.
 *
 * So the assertion is DIFFERENTIAL: every route is called twice, once with the
 * token and once without, and the two statuses must MATCH. That is the property
 * actually worth holding — the token buys nothing, anywhere — and it needs no
 * exemption list, which matters because an exemption list is the thing a future
 * route would be quietly added to.
 */

import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { generatePublishableKey } from '../src/public-api/keys.js';
import { isPublicNamespacePath, PUBLIC_NAMESPACE_PREFIX } from '../src/routes/public/index.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

function memoryStore(meta: MetaDb): MetaStoreHandle {
  return {
    meta,
    url: 'sqlite::memory:',
    engine: 'sqlite',
    source: 'embedded',
    close: async () => Promise.resolve(),
  };
}

/**
 * The widest topology, so every conditionally-registered resource is present —
 * the same argument `audit-coverage.test.ts` makes for its sweep. A narrower
 * compose would let a route escape by simply not existing in the suite.
 *
 * `HOST` is loopback so the public namespace itself registers without
 * `ADMINIUM_TRUST_PROXY` (D21) — the point is to prove the key is refused
 * everywhere ELSE while the public routes are genuinely present.
 */
async function composeWidest(meta: MetaDb): Promise<ComposedServer> {
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv({
      ADMINIUM_RUNTIME: 'desktop',
      ADMINIUM_BOOT_TOKEN: 'a'.repeat(64),
      ADMINIUM_BRIDGE_ORIGINS: 'https://adminium.dev',
      ADMINIUM_PUBLIC_API_ORIGINS: 'https://shop.example.com',
      HOST: '127.0.0.1',
    }),
    metaStore: memoryStore(meta),
    manager: new ConnectionManager({
      meta,
      crypto: dsnCryptoFromSecret(TEST_SECRET),
      metaDsn: null,
    }),
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetDataContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => {
      /* never relocates */
    },
  });
  await composed.app.ready();
  return composed;
}

/** Fill `:params` with a value that is syntactically fine and matches nothing. */
function concreteUrl(url: string): string {
  return url
    .replace(/:[A-Za-z0-9_]+\*?/g, 'zzz-isolation-probe')
    .replace(/\/\*$/, '/zzz-isolation-probe');
}

/**
 * Assert the ANONYMOUS namespace is absent, while tolerating the admin routes
 * that manage it — those are always registered, because an operator must be
 * able to author a scope and see why the surface is off.
 */
function expectNoPublicNamespace(tree: string): void {
  // The exact namespace, with its trailing slash. `not.toContain('/config')`
  // was the first attempt and matched `/api/v1/llm/config` — the same class of
  // loose-prefix mistake `PUBLIC_NAMESPACE_PREFIX` exists to prevent.
  expect(tree).not.toContain(PUBLIC_NAMESPACE_PREFIX);
  // The management routes are a different thing and MUST still be there.
  expect(tree).toContain('/api/v1/public-keys');
}

let open: { close: () => Promise<void> } | undefined;

afterEach(async () => {
  await open?.close();
  open = undefined;
});

describe('28-T09 — publishable keys are inert outside /api/v1/public', () => {
  it('is refused by every registered route in the whole tree', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const composed = await composeWidest(meta);
    open = {
      close: async () => {
        await composed.app.close();
        await meta.db.destroy();
      },
    };

    const { token } = generatePublishableKey();

    /*
     * The route tree as the SERVER sees it. `printRoutes` is the registration
     * list; parsing it is what makes this test enumerate rather than assume.
     */
    const tree = composed.app.printRoutes({ commonPrefix: false });
    const urls = new Set<string>();
    for (const line of tree.split('\n')) {
      const match = /^[^a-zA-Z/]*(\/\S*)\s+\((.+)\)\s*$/.exec(line);
      if (match === null) continue;
      const [, url, methods] = match;
      if (url === undefined || methods === undefined) continue;
      for (const method of methods.split(',').map((m) => m.trim())) {
        if (method === 'HEAD' || method === 'OPTIONS') continue;
        urls.add(`${method} ${url}`);
      }
    }

    // The sweep must actually have seen a real tree; an empty parse would pass
    // every assertion below and prove nothing.
    expect(urls.size).toBeGreaterThan(80);

    const acted: string[] = [];
    let probe = 0;
    for (const entry of urls) {
      /*
       * A FRESH SOURCE ADDRESS PER PAIR.
       *
       * Several routes share the `auth-login` bucket (login, the password
       * routes, `setup/super-admin`), and it is keyed by IP with max 5. Sweeping
       * the whole tree twice from one address exhausts it partway through, so
       * `/auth/login` answered 422 to the first call of its pair and 429 to the
       * second — a difference caused entirely by the limiter's state, not by the
       * token. Both calls in a pair share an address so the pair stays
       * comparable; pairs do not, so no bucket carries across routes.
       */
      probe += 1;
      const remoteAddress = `10.1.${String(Math.floor(probe / 250))}.${String(probe % 250)}`;
      const [method, url] = entry.split(' ') as [string, string];
      // EXACT namespace, not a loose prefix. `/api/v1/public-keys` starts with
      // `/api/v1/public` and is an ADMIN route — skipping it here would stop
      // this test checking that a publishable key cannot mint another one.
      if (isPublicNamespacePath(url)) continue; // the one namespace it MAY reach

      const body =
        method === 'GET' || method === 'DELETE'
          ? {}
          : { headers: { 'content-type': 'application/json' }, payload: {} };

      const withKey = await composed.app.inject({
        method: method as 'GET',
        url: concreteUrl(url),
        remoteAddress,
        ...body,
        headers: { ...(body.headers ?? {}), authorization: `Bearer ${token}` },
      });
      const without = await composed.app.inject({
        method: method as 'GET',
        url: concreteUrl(url),
        remoteAddress,
        ...body,
      });

      // The token must change NOTHING. A route that is public stays public; a
      // route that refuses keeps refusing, with the same status.
      if (withKey.statusCode !== without.statusCode) {
        acted.push(
          `${entry} -> ${String(without.statusCode)} without the key, ${String(withKey.statusCode)} with it`,
        );
      }
      // And it must never make a route fall over — a 500 means the token
      // reached a handler that then choked on it.
      if (withKey.statusCode >= 500 && without.statusCode < 500) {
        acted.push(`${entry} -> 500 only when the key is present`);
      }
    }

    expect(acted, `an adm_pub_ token CHANGED the outcome on these routes:\n${acted.join('\n')}`).toEqual([]);
  }, 60_000);

  it('registers the public namespace it is allowed to reach', async () => {
    // The converse of the sweep above. Without this, a compose that failed to
    // register the public routes at all would make the isolation test pass
    // vacuously — which is the M10/M11 orphaned-route failure exactly.
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const composed = await composeWidest(meta);
    open = {
      close: async () => {
        await composed.app.close();
        await meta.db.destroy();
      },
    };

    const tree = composed.app.printRoutes({ commonPrefix: false });
    expect(tree).toContain('/api/v1/public/config');
    expect(tree).toContain('/api/v1/public/records/');
  }, 60_000);
});

describe('the public envelope never leaks the dashboard\'s', () => {
  it('answers a schema rejection with a code, not VALIDATION_FAILED + requestId + details', async () => {
    /*
     * FOUND BY PROBING A LIVE INSTANCE, not by a test — every unit test built a
     * request that was already valid. `limit=500` against the 200 ceiling was
     * rejected by Zod BEFORE the handler ran, so it fell through to the global
     * error handler and answered with the dashboard envelope: prose, a
     * `requestId`, and a `details.issues` list naming the offending field.
     *
     * That breaks both contracts at once — §3.6 says the wire carries codes,
     * and §3.2 says failures must not be distinguishable, while "this field
     * exists but your value is wrong" is information. A scoped
     * `setErrorHandler` on the public plugin is the fix.
     */
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const composed = await composeWidest(meta);
    open = {
      close: async () => {
        await composed.app.close();
        await meta.db.destroy();
      },
    };

    const res = await composed.app.inject({
      method: 'GET',
      url: '/api/v1/public/records/anything?limit=500',
      headers: {
        origin: 'https://shop.example.com',
        authorization: `Bearer ${generatePublishableKey().token}`,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('PUBLIC_QUERY_REFUSED');
    // None of the dashboard envelope's shape may appear.
    expect(res.body).not.toContain('VALIDATION_FAILED');
    expect(res.body).not.toContain('requestId');
    expect(res.body).not.toContain('details');
    expect(res.body).not.toContain('limit');
  }, 60_000);
});

describe('28-T08 — the off switch', () => {
  it('does not register the namespace at all when the origin list is unset', async () => {
    // Level 1: no door to probe, rather than a door that refuses (§3.5).
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const runService = createRunService({ meta });
    const composed = await composeServer({
      env: makeEnv({ HOST: '127.0.0.1' }), // no ADMINIUM_PUBLIC_API_ORIGINS
      metaStore: memoryStore(meta),
      manager: new ConnectionManager({
        meta,
        crypto: dsnCryptoFromSecret(TEST_SECRET),
        metaDsn: null,
      }),
      runService,
      applyService: createApplyService({ meta, runService }),
      allowed: { templates: [], widgets: [], widgetDataContracts: {} },
      logger: false,
      telemetry: false,
      onMetaRelocated: () => {},
    });
    await composed.app.ready();
    open = {
      close: async () => {
        await composed.app.close();
        await meta.db.destroy();
      },
    };

    expectNoPublicNamespace(composed.app.printRoutes({ commonPrefix: false }));
  }, 60_000);

  it('refuses to register on a non-loopback bind without TRUST_PROXY, and says why (D18/D21)', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const runService = createRunService({ meta });
    const composed = await composeServer({
      env: makeEnv({
        ADMINIUM_PUBLIC_API_ORIGINS: 'https://shop.example.com',
        // The shipped Docker default — and the exact case D18 was written for.
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
      allowed: { templates: [], widgets: [], widgetDataContracts: {} },
      logger: false,
      telemetry: false,
      onMetaRelocated: () => {},
    });
    await composed.app.ready();
    open = {
      close: async () => {
        await composed.app.close();
        await meta.db.destroy();
      },
    };

    expectNoPublicNamespace(composed.app.printRoutes({ commonPrefix: false }));
  }, 60_000);
});
