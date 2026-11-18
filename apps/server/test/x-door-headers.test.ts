// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `/x/` doors' shared headers (`routes/x-door/headers.ts`): a second door,
 * registered as its own plugin beside the forms door, gets the forms door's
 * headers on its own routes, `frame-ancestors` only where its own list says a
 * page is framed, `'self'` for its preview, and nothing leaks to a route
 * outside the doors.
 */
import { Readable } from 'node:stream';

import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSqliteMetaDb, firstRun, type MetaDb } from '@adminium/meta';

import type { FormsCatalog } from '../src/forms/catalog.js';
import { formsDoorRoutes } from '../src/routes/forms-door/index.js';
import { framedPageOf, xContentPolicy, xDoorHeaders } from '../src/routes/x-door/headers.js';
import { TEST_SECRET } from './helpers.js';

const HOST = 'forms.meridian.example';
const ORIGIN = `http://${HOST}`;

const catalog: FormsCatalog = {
  find: async () => ({ state: 'unavailable' }),
  byKey: async () => ({ state: 'unavailable' }),
  draft: async () => null,
  liveSlugs: async () => [],
  forget: () => true,
};

/** The headers the shared hook owns, as one answer carries them. */
function doorHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  return {
    csp: headers['content-security-policy'],
    referrer: headers['referrer-policy'],
    sniff: headers['x-content-type-options'],
    robots: headers['x-robots-tag'],
    frame: headers['x-frame-options'],
    cache: headers['cache-control'],
  };
}

describe('the /x/ doors’ shared headers', () => {
  let meta: MetaDb;
  let app: FastifyInstance | undefined;
  let websites: string[];

  /** A second door, as a chat door would be: its own plugin, its own page list, its own preview. */
  const otherDoor: FastifyPluginAsync = async (door) => {
    xDoorHeaders(door, {
      framed: framedPageOf([/^\/x\/chat\/[^/]+$/]),
      websites: async () => websites,
      previewing: (request) => (request.query as { preview?: unknown }).preview !== undefined,
    });
    door.get('/x/chat/:addOn', async () => 'page');
    door.get('/x/chat/api/:addOn/poll', async () => ({ messages: [] }));
    door.get('/x/chat/api/:addOn/broken', async (_request, reply) => reply.code(404).send({ error: 'not available' }));
  };

  /** A third door, as the pages door is: an answer it says may be indexed, and a file with headers of its own. */
  const indexingDoor: FastifyPluginAsync = async (door) => {
    xDoorHeaders(door, {
      framed: framedPageOf([]),
      websites: async () => websites,
      previewing: () => false,
      indexable: (request) => request.url === '/x/pages/live',
      ownHeaders: (request) => request.url.startsWith('/x/pages/api/live/pictures/'),
    });
    door.get('/x/pages/:slug', async () => 'page');
    door.get('/x/pages/api/live/pictures/:file', async (_request, reply) => reply.headers({ 'content-security-policy': "default-src 'none'; sandbox", 'cache-control': 'public, max-age=300, must-revalidate' }).send('png'));
  };

  async function start(opts: { trial?: boolean } = {}): Promise<void> {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('spaRoot', null);
    // The dashboard's own frame rule and, in trial mode, its stronger robots word: set before any door answers.
    app.addHook('onRequest', async (_request, reply) => {
      void reply.header('x-frame-options', 'SAMEORIGIN');
      if (opts.trial === true) void reply.header('x-robots-tag', 'noindex, nofollow');
    });
    await app.register(
      formsDoorRoutes({
        meta,
        catalog,
        secret: TEST_SECRET,
        storage: { read: async () => Readable.from([]) },
        websites: async () => websites,
        networkFeatures: true,
        desktop: false,
        trustProxy: false,
      }),
    );
    await app.register(otherDoor);
    await app.register(indexingDoor);
    // A dashboard route outside every door.
    app.get('/api/v1/elsewhere', async () => ({ ok: true }));
    await app.ready();
  }

  const get = (url: string) => app!.inject({ method: 'GET', url, headers: { host: HOST } });

  beforeEach(async () => {
    app = undefined;
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    websites = ['https://shop.example'];
  });

  afterEach(async () => {
    await app?.close();
    await meta.db.destroy();
  });

  it('gives a second door’s routes the forms door’s headers, byte for byte', async () => {
    await start();
    // The forms door's unframed answer, as the yardstick.
    const forms = doorHeaders((await get('/x/forms/api/nothing')).headers);
    expect(forms).toEqual({ csp: xContentPolicy(ORIGIN), referrer: 'no-referrer', sniff: 'nosniff', robots: 'noindex', frame: undefined, cache: 'no-store' });
    for (const url of ['/x/chat/sales', '/x/chat/api/sales/poll', '/x/chat/api/sales/poll?frame=1', '/x/chat/api/sales/broken']) {
      expect(doorHeaders((await get(url)).headers), url).toEqual(forms);
    }
  });

  it('frames a second door’s page for the listed websites only when its own list says so', async () => {
    await start();
    expect((await get('/x/chat/sales?frame=1')).headers['content-security-policy']).toBe(xContentPolicy(ORIGIN, ['https://shop.example']));
    // Not framed: no frame=1, a frame value that is not 1, an API path under the same prefix, a path the list does not hold.
    for (const url of ['/x/chat/sales', '/x/chat/sales?frame=true', '/x/chat/api/sales/poll?frame=1', '/x/chat/sales/more?frame=1']) {
      expect((await get(url)).headers['content-security-policy'], url).toBe(xContentPolicy(ORIGIN));
    }
    // The forms door's list does not reach the other door's pages, nor the other way round.
    expect((await get('/x/forms/showroom?frame=1')).headers['content-security-policy']).toBe(xContentPolicy(ORIGIN, ['https://shop.example']));
    websites = [];
    expect((await get('/x/chat/sales?frame=1')).headers['content-security-policy']).toBe(xContentPolicy(ORIGIN));
  });

  it('frames a second door’s preview by this host alone, whatever its list says', async () => {
    await start();
    expect((await get('/x/chat/sales?preview=1')).headers['content-security-policy']).toBe(xContentPolicy(ORIGIN, ["'self'"]));
    expect((await get('/x/chat/sales?preview=1&frame=1')).headers['content-security-policy']).toBe(xContentPolicy(ORIGIN, ["'self'"]));
  });

  it('keeps a trial’s stronger robots word on a second door', async () => {
    await start({ trial: true });
    expect((await get('/x/chat/sales')).headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('holds every door to Trusted Types with no policy, calls under /x/ only, and its own browsing group', async () => {
    await start();
    const policy = new Map(xContentPolicy(ORIGIN).split('; ').map((directive) => [directive.split(' ')[0], directive]));
    expect(policy.get('require-trusted-types-for')).toBe("require-trusted-types-for 'script'");
    expect(policy.get('trusted-types')).toBe("trusted-types 'none'");
    expect(policy.get('connect-src')).toBe(`connect-src ${ORIGIN}/x/`);
    expect(policy.get('script-src')).toBe(`script-src ${ORIGIN}/x/assets/`);
    expect(policy.get('img-src')).toBe("img-src 'self'");
    for (const url of ['/x/forms/api/nothing', '/x/chat/sales', '/x/pages/open-day']) {
      const res = await get(url);
      expect(res.headers['cross-origin-opener-policy'], url).toBe('same-origin');
      expect(res.headers['content-security-policy'], url).toBe(xContentPolicy(ORIGIN));
    }
  });

  it('leaves out noindex only for an answer its door says may be indexed, and a trial’s word wins over that', async () => {
    await start();
    expect((await get('/x/pages/live')).headers['x-robots-tag']).toBeUndefined();
    for (const url of ['/x/pages/elsewhere', '/x/forms/api/nothing', '/x/chat/sales']) expect((await get(url)).headers['x-robots-tag'], url).toBe('noindex');
    await app!.close();
    await start({ trial: true });
    expect((await get('/x/pages/live')).headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('keeps the policy and cache time of a file a door serves with its own', async () => {
    await start();
    const picture = await get('/x/pages/api/live/pictures/f1');
    expect(picture.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(picture.headers['cache-control']).toBe('public, max-age=300, must-revalidate');
    expect(picture.headers['x-content-type-options']).toBe('nosniff');
    expect(picture.headers['x-robots-tag']).toBe('noindex');
  });

  it('leaves a route outside the doors alone', async () => {
    await start();
    const elsewhere = await get('/api/v1/elsewhere');
    expect(elsewhere.headers['content-security-policy']).toBeUndefined();
    expect(elsewhere.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(elsewhere.headers['referrer-policy']).toBeUndefined();
  });
});
