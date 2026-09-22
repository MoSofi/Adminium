// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a cross-origin BROWSER needs from `/api/v1/public/*`, beyond
 * `Access-Control-Allow-Origin`.
 *
 * ── THE DEFECTS ────────────────────────────────────────────────────────────
 * `@adminiumjs/public-client`'s `signOut()` is `DELETE /public/session` with
 * an `Authorization` and a session header, so a browser preflights it. There
 * was no `OPTIONS /public/session`, and the preflight every other path answers
 * named `GET, POST, PATCH, OPTIONS`: no DELETE. A cross-origin `signOut()` had
 * never passed a preflight. The client drops its session locally either way,
 * so the only symptom was a server-side session that outlived its sign-out.
 *
 * And no response set `Access-Control-Expose-Headers`. `Retry-After` is not a
 * CORS-safelisted response header, so a cross-origin page could read a 429's
 * body but not how long to wait: the client's `retryAfterSeconds` was always
 * null there.
 *
 * And an error answered before the gate ran carried no CORS headers at all: a
 * schema rejection, and the core `public` bucket's refusal. The page saw a
 * CORS error in place of the code.
 *
 * ── WHY `inject` CAN PROVE IT ──────────────────────────────────────────────
 * `inject` has no same-origin policy, so it cannot show a browser refusing a
 * response. What it can show is the headers the browser decides from, and
 * those are asserted exactly. The sweep below reads the server's own route
 * tree, so a public path added next year without a preflight fails here
 * rather than in a storefront's console.
 *
 * Every request carries a syntactically valid key that resolves to nothing:
 * the gate still runs in full up to the key lookup, which is all the
 * CORS headers and the flood guard need.
 */

import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { buildLogger } from '../src/app.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { RATE_BUCKETS } from '../src/plugins/core.js';
import { isPublicNamespacePath, PUBLIC_ERROR_CODES } from '../src/routes/public/index.js';
import { concreteUrl, makeEnv, routeTable, TEST_SECRET } from './helpers.js';

/** Syntactically valid, resolves to nothing — see the header. */
const KEY = `adm_pub_${'a'.repeat(32)}`;
const SESSION = `adm_pubs_${'b'.repeat(32)}`;
const ORIGIN = 'https://shop.example.com';
const FOREIGN = 'https://evil.example.com';

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
 * A serving instance: loopback bind so the namespace registers without
 * `ADMINIUM_TRUST_PROXY`, and `publicApi.enabled` set because the row defaults
 * false and every gated route would otherwise stop at the 503. `openapi`
 * collects the spec, as `scripts/openapi.mjs` does; `logger` replaces the
 * silent default.
 */
async function serving(
  opts: { openapi?: boolean; logger?: ReturnType<typeof buildLogger> } = {},
): Promise<ComposedServer['app']> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await settingsRepo(meta).set('publicApi.enabled', true);
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv({ ADMINIUM_PUBLIC_API_ORIGINS: ORIGIN, HOST: '127.0.0.1' }),
    metaStore: memoryStore(meta),
    manager: new ConnectionManager({
      meta,
      crypto: dsnCryptoFromSecret(TEST_SECRET),
      metaDsn: null,
    }),
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: opts.logger ?? false,
    telemetry: false,
    ...(opts.openapi === true ? { openapi: true } : {}),
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
  return composed.app;
}

/** A comma-separated CORS header as a set of upper-cased tokens. */
function tokens(header: string | string[] | number | undefined): Set<string> {
  if (typeof header !== 'string') return new Set();
  return new Set(header.split(',').map((t) => t.trim().toUpperCase()).filter((t) => t !== ''));
}

/** What a browser sends before `signOut()`. */
function signOutPreflight(app: ComposedServer['app'], origin: string) {
  return app.inject({
    method: 'OPTIONS',
    url: '/api/v1/public/session',
    headers: {
      origin,
      'access-control-request-method': 'DELETE',
      'access-control-request-headers': 'authorization, x-adminium-public-session',
    },
  });
}

/**
 * Every registered public path and its methods, from the server's own tree.
 * `routeTable` rebuilds nested paths from `printRoutes`: read line by line,
 * the tree shows five of the ten public paths.
 */
function publicRouteTable(app: ComposedServer['app']): Map<string, Set<string>> {
  return new Map([...routeTable(app)].filter(([url]) => isPublicNamespacePath(url)));
}

describe('a cross-origin signOut() passes its preflight', () => {
  it('answers OPTIONS /public/session with DELETE and the session header allowed', async () => {
    const app = await serving();
    const res = await signOutPreflight(app, ORIGIN);

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(tokens(res.headers['access-control-allow-methods']).has('DELETE')).toBe(true);
    const allowedHeaders = tokens(res.headers['access-control-allow-headers']);
    expect(allowedHeaders.has('AUTHORIZATION')).toBe(true);
    expect(allowedHeaders.has('X-ADMINIUM-PUBLIC-SESSION')).toBe(true);
    // Uncredentialed, always: an admin cookie must never ride along.
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('still refuses the preflight from an origin that is not listed', async () => {
    const app = await serving();
    const res = await signOutPreflight(app, FOREIGN);

    expect(res.statusCode).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-methods']).toBeUndefined();
  });

  it('lets the DELETE itself through the gate, readable cross-origin', async () => {
    const app = await serving();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/public/session',
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${KEY}`,
        'x-adminium-public-session': SESSION,
      },
    });

    // The key resolves to nothing, so the gate's own 401 — past the origin
    // check, with the headers a browser needs to read it.
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('PUBLIC_KEY_INVALID');
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(tokens(res.headers['access-control-expose-headers']).has('RETRY-AFTER')).toBe(true);
  });
});

describe('every public path answers a preflight naming its methods', () => {
  it('holds for every path the server registered under the namespace', async () => {
    const app = await serving();

    // The registration list, not a hand-written one (see the header).
    const methodsByUrl = publicRouteTable(app);

    // An empty or partial parse would pass everything below. The nested
    // paths are the ones a line-by-line read drops.
    expect(methodsByUrl.get('/api/v1/public/session')?.has('DELETE')).toBe(true);
    expect(methodsByUrl.get('/api/v1/public/records/:ref/:id')?.has('PATCH')).toBe(true);
    expect(methodsByUrl.has('/api/v1/public/documents/:id/email')).toBe(true);
    expect(methodsByUrl.size).toBeGreaterThanOrEqual(10);

    const gaps: string[] = [];
    for (const [url, methods] of methodsByUrl) {
      /*
       * Every one needs it, GETs included: the client always sends
       * `Authorization`, which is not a safelisted request header, so even a
       * read is preflighted.
       */
      if (!methods.has('OPTIONS')) {
        gaps.push(`${url}: no OPTIONS route`);
        continue;
      }
      const res = await app.inject({
        method: 'OPTIONS',
        url: concreteUrl(url, 'cors-probe'),
        headers: { origin: ORIGIN, 'access-control-request-method': 'GET' },
      });
      if (res.statusCode !== 204) {
        gaps.push(`${url}: preflight answered ${String(res.statusCode)}`);
        continue;
      }
      const allowed = tokens(res.headers['access-control-allow-methods']);
      for (const method of methods) {
        // HEAD is Fastify's own twin of each GET, and a CORS simple method.
        if (method === 'HEAD' || method === 'OPTIONS') continue;
        if (!allowed.has(method)) gaps.push(`${url}: ${method} is not in Allow-Methods`);
      }
    }
    expect(gaps, `a browser cannot call these:\n${gaps.join('\n')}`).toEqual([]);
  });
});

describe('a cross-origin caller can read Retry-After', () => {
  it('exposes it on the 429 the gate answers', async () => {
    const app = await serving();

    /*
     * Until the gate itself refuses, not a fixed count: which rung trips
     * first is `limiter.ts`'s business, and every rung answers through the
     * same gate. The ceiling sits under the core `public` bucket (600/min per
     * address), whose own 429 never reaches the gate.
     */
    let limited;
    for (let attempt = 1; attempt <= 550; attempt += 1) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/public/config',
        headers: { origin: ORIGIN, authorization: `Bearer ${KEY}` },
      });
      if (res.statusCode === 429) {
        limited = res;
        break;
      }
      // Anything else here means the gate refused for another reason, and
      // the loop would never reach a limit.
      expect(res.statusCode, `attempt ${String(attempt)}`).toBe(401);
    }

    expect(limited, 'the gate never answered 429').toBeDefined();
    expect(limited!.json<{ error: { code: string } }>().error.code).toBe('PUBLIC_RATE_LIMITED');
    expect(Number(limited!.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited!.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(tokens(limited!.headers['access-control-expose-headers']).has('RETRY-AFTER')).toBe(true);
  });

  it('exposes nothing to an origin that is not listed', async () => {
    const app = await serving();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/public/config',
      headers: { origin: FOREIGN, authorization: `Bearer ${KEY}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-expose-headers']).toBeUndefined();
  });
});

/*
 * The plugin's error handler answers what never reached the gate, so it has
 * to emit the same headers itself. Without them a cross-origin page saw a
 * CORS error where the code should have been.
 */
describe('an error answered before the gate is readable cross-origin', () => {
  /** The public envelope: `{ error: { code, message } }` and nothing else. */
  function expectPublicEnvelope(res: { json: <T>() => T }): string {
    const body = res.json<{ error: { code: string } }>();
    expect(Object.keys(body)).toEqual(['error']);
    expect(PUBLIC_ERROR_CODES as readonly string[]).toContain(body.error.code);
    return body.error.code;
  }

  it('carries the headers on a schema rejection', async () => {
    const app = await serving();
    // `limit=500` against the 200 ceiling fails validation before the
    // handler, so the gate never runs.
    const bad = (origin: string) =>
      app.inject({
        method: 'GET',
        url: '/api/v1/public/records/anything?limit=500',
        headers: { origin, authorization: `Bearer ${KEY}` },
      });

    const listed = await bad(ORIGIN);
    expect(listed.statusCode).toBe(400);
    expect(expectPublicEnvelope(listed)).toBe('PUBLIC_QUERY_REFUSED');
    expect(listed.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(tokens(listed.headers['access-control-expose-headers']).has('RETRY-AFTER')).toBe(true);
    expect(listed.headers['access-control-allow-credentials']).toBeUndefined();

    // Still the public envelope for an unlisted origin, and still no headers.
    const foreign = await bad(FOREIGN);
    expect(foreign.statusCode).toBe(400);
    expect(expectPublicEnvelope(foreign)).toBe('PUBLIC_QUERY_REFUSED');
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
    expect(foreign.headers['access-control-expose-headers']).toBeUndefined();
  });

  it('answers the core bucket refusal as the gate answers its own 429', async () => {
    const app = await serving();
    const read = () =>
      app.inject({
        method: 'GET',
        url: '/api/v1/public/config',
        headers: { origin: ORIGIN, authorization: `Bearer ${KEY}` },
      });

    /*
     * Every request draws down the core `public` bucket, including the ones
     * the gate refuses, so request `max + 1` is the bucket's own refusal in
     * `onRequest`, answered by the plugin's error handler. It used to go out
     * as 503 `PUBLIC_UPSTREAM_UNAVAILABLE`.
     */
    const { max } = RATE_BUCKETS.public;
    let fromGate: unknown;
    for (let attempt = 1; attempt <= max; attempt += 1) {
      const res = await read();
      expect([401, 429], `attempt ${String(attempt)}`).toContain(res.statusCode);
      if (res.statusCode === 429) fromGate = res.json();
    }
    // The gate's limits sit under the bucket's, so it has refused by now.
    expect(fromGate, 'the gate never answered 429').toBeDefined();

    const refused = await read();
    expect(refused.statusCode).toBe(429);
    expect(expectPublicEnvelope(refused)).toBe('PUBLIC_RATE_LIMITED');
    // Word for word: which limit refused is not the caller's business.
    expect(refused.json()).toEqual(fromGate);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(refused.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(tokens(refused.headers['access-control-expose-headers']).has('RETRY-AFTER')).toBe(true);
  });

  it('logs no warn for the bucket refusal, and still warns for a schema rejection', async () => {
    const lines: string[] = [];
    const stream = { write: (line: string) => void lines.push(line) };
    const app = await serving({ logger: buildLogger(makeEnv(), { pretty: false, stream }) });
    const read = (query = '') =>
      app.inject({
        method: 'GET',
        url: `/api/v1/public/records/anything${query}`,
        headers: { origin: ORIGIN, authorization: `Bearer ${KEY}` },
      });

    // The first request of the bucket's allowance, and the warn that stays:
    // a real failure is still logged in full.
    const rejected = await read('?limit=500');
    expect(rejected.statusCode).toBe(400);

    const { max } = RATE_BUCKETS.public;
    for (let attempt = 2; attempt <= max; attempt += 1) await read();
    const refused = await read();
    expect(refused.statusCode).toBe(429);

    type Line = { level: number; msg?: string; reqId?: string; res?: { statusCode?: number } };
    const logged = lines.map((line) => JSON.parse(line) as Line);
    const warned = logged.filter((l) => l.level === 40 && l.msg === 'public API request failed');
    expect(warned.map((l) => l.reqId)).toEqual([rejected.headers['x-request-id']]);
    // Still on the record, at info, with its status.
    const completed = logged.find(
      (l) => l.reqId === refused.headers['x-request-id'] && l.msg === 'request completed',
    );
    expect(completed?.level).toBe(30);
    expect(completed?.res?.statusCode).toBe(429);
  });
});

describe('every public operation documents its 429', () => {
  it('lists 429 in the response schema of every public route', async () => {
    /*
     * Every public route runs the gate, and the gate and the core bucket can
     * both answer 429 on any of them. `GET /public/config` and
     * `DELETE /public/session` left it out, so the spec said a caller would
     * never see it there. Read from the live spec, not `openapi.json`, so a
     * stale artifact cannot pass this.
     */
    const app = await serving({ openapi: true });
    const spec = app.swagger() as {
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    };

    const operations: string[] = [];
    const missing: string[] = [];
    for (const [path, byMethod] of Object.entries(spec.paths)) {
      if (!isPublicNamespacePath(path)) continue;
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        const operation = byMethod[method];
        if (operation === undefined) continue;
        operations.push(`${method.toUpperCase()} ${path}`);
        if (operation.responses?.['429'] === undefined) {
          missing.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    // An empty read would pass the assertion below.
    expect(operations).toContain('DELETE /api/v1/public/session');
    expect(operations.length).toBeGreaterThanOrEqual(11);
    expect(missing, `no 429 documented on:\n${missing.join('\n')}`).toEqual([]);
  });
});
