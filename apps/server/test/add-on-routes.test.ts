// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/api/v1/add-ons` (26-T06) — and 26 acceptance #8, which has never had a test.
 *
 * ─── Acceptance #8 is the point of the first block ─────────────────────────
 *
 * "Every route is reachable through `compose.ts` — asserted by a
 * composeServer-level test that fails if a route is exported but unregistered.
 * This is the M10/M11 failure mode and it has recurred twice." Nothing in the
 * repo enforced that: `m10-regressions.test.ts` checks a hard-coded URL list,
 * `audit-coverage.test.ts` only sees routes that ARE registered, and the
 * OpenAPI check reads the built spec. All three are blind to a route module
 * that exists and is never registered — which is exactly how the M10 gap
 * shipped green.
 *
 * So the first block composes the REAL server and asks it what it serves.
 *
 * ─── The rest exercise the lifecycle against a real store ─────────────────
 *
 * The add-on store is not mocked: install reads a manifest out of a staged
 * package and re-verifies its tree pin first, so a test with a fake store would
 * skip the one step that makes installing safe.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { gzipSync } from 'fflate';
import {
  auditRepo,
  createSqliteMetaDb,
  firstRun,
  jobsRepo,
  manifestsRepo,
  usersRepo,
  type MetaDb,
} from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AddOnManifest, InstallPlan } from '@adminium/manifest';

import type { CatalogClient } from '../src/add-ons/catalog.js';
import { applyInstall } from '../src/add-ons/install-ddl.js';
import { createAddOnStore, sha512Integrity, type AddOnStore } from '../src/add-ons/store.js';
import { AppError, errorEnvelope, UnauthorizedError } from '../src/errors.js';
import { addOnRoutes } from '../src/routes/add-ons/index.js';

const BLOCK = 512;

function put(b: Uint8Array, at: number, len: number, v: string): void {
  b.set(Buffer.from(v, 'latin1').subarray(0, len), at);
}

/** A real npm-shaped tarball, so the store's own hardening runs. */
function packageTarball(files: Record<string, string>): Uint8Array {
  const members: Uint8Array[] = [];
  for (const [path, content] of Object.entries(files)) {
    const body = Buffer.from(content, 'utf8');
    const h = new Uint8Array(BLOCK);
    put(h, 0, 100, `package/${path}`);
    put(h, 100, 8, '0000644\0');
    put(h, 124, 12, `${body.length.toString(8).padStart(11, '0')}\0`);
    put(h, 136, 12, '00000000000\0');
    put(h, 156, 1, '0');
    put(h, 257, 6, 'ustar\0');
    put(h, 263, 2, '00');
    h.set(Buffer.from('        ', 'latin1'), 148);
    let sum = 0;
    for (let i = 0; i < BLOCK; i += 1) sum += h[i] ?? 0;
    put(h, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
    const pad = (BLOCK - (body.length % BLOCK)) % BLOCK;
    const m = new Uint8Array(BLOCK + body.length + pad);
    m.set(h, 0);
    m.set(body, BLOCK);
    members.push(m);
  }
  const out = new Uint8Array(members.reduce((n, m) => n + m.byteLength, 0) + BLOCK * 2);
  let at = 0;
  for (const m of members) {
    out.set(m, at);
    at += m.byteLength;
  }
  return gzipSync(out);
}

/** A valid add-on manifest; `requiredSchema` is the interesting variable. */
function manifestFor(
  key: string,
  requiredSchema?: unknown,
  attaches = ['printing'],
  connect: Record<string, unknown> = { kind: 'none' },
  settings?: unknown[],
  capabilities?: string[],
  networkAllow: string[] = ['express.api.dhl.com'],
) {
  return {
    kind: 'add-on',
    manifestVersion: 1,
    key,
    name: key,
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: `addon.${key}.line`, fallback: 'x' },
    categories: ['data'],
    compatibility: { minAdminiumVersion: '1.0.0', requires: [] },
    ...(capabilities === undefined ? {} : { capabilities }),
    addOn: {
      attaches: attaches.map((app) => ({ app, range: '^1.0.0' })),
      provides: [],
      consumes: [],
      slots: [{ slot: 'settings.add-on.panel', client: 'dist/client.js', order: 10 }],
      events: [],
      connect,
      scopes: [],
      network: { allow: networkAllow },
    },
    ...(requiredSchema === undefined ? {} : { requiredSchema }),
    ...(settings === undefined ? {} : { settings }),
  };
}

const crypto = {
  encrypt: (v: string) => `enc:${Buffer.from(v, 'utf8').toString('base64')}`,
  decrypt: (v: string) => Buffer.from(v.slice(4), 'base64').toString('utf8'),
};

let meta: MetaDb;
let dataDir: string;
let store: AddOnStore;
/**
 * A REAL user row, not a fake id.
 *
 * `adminium_manifests.installed_by` carries an FK to `adminium_users`, so
 * installing as a principal that does not exist fails at the insert. In
 * production the caller is authenticated and the row is always there; a test
 * that invented an id would be exercising a state the server cannot reach.
 */
let installer: { id: string; email: string };

beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const user = await usersRepo(meta).create({ email: 'owner@test', name: 'Owner' });
  installer = { id: user.id, email: user.email };
  dataDir = await mkdtemp(join(tmpdir(), 'add-on-routes-'));
  store = createAddOnStore({ dataDir });
  sourceDb = new Kysely({
    dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }),
  });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** Stages a package the way a verified download would have. */
async function stage(
  key: string,
  requiredSchema?: unknown,
  attaches?: string[],
  connect?: Record<string, unknown>,
  settings?: unknown[],
  capabilities?: string[],
  networkAllow?: string[],
): Promise<void> {
  const tarball = packageTarball({
    'manifest.json': JSON.stringify(
      manifestFor(key, requiredSchema, attaches, connect, settings, capabilities, networkAllow),
    ),
    'package.json': JSON.stringify({ name: `@adminiumjs/add-on-${key}` }),
    'dist/client.js': 'export const register = () => {};',
  });
  await store.stage({
    key,
    version: '1.0.0',
    tarball,
    expectedIntegrity: sha512Integrity(tarball),
  });
}

/**
 * The route plugin under test, driven directly.
 *
 * `app.rbac.require` is stubbed to a pass-through: RBAC itself is covered by
 * `rbac-permissions.test.ts` and `users-routes.test.ts`, and what these assert
 * is the lifecycle behind the guard. The guard's PRESENCE is asserted
 * separately, below, by reading the registered routes.
 */
const created: string[] = [];
/** Flipped by the anonymous sweep, so one app can be driven both ways. */
let anonymous = false;
/** The operator's database, as far as these tests are concerned. */
let sourceDb: Kysely<Record<string, Record<string, unknown>>>;

async function buildApp(
  existingTables: { ref: string; columns: { ref: string }[] }[] = [],
  catalog?: Partial<CatalogClient>,
  opts: { schemaTarget?: boolean } = {},
) {
  created.length = 0;
  const Fastify = (await import('fastify')).default;
  const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('rbac', { require: () => async () => {} } as never);
  /*
   * A REAL `requireAuth`, not a pass-through.
   *
   * The RBAC stub above is deliberate — RBAC has its own suites and what this
   * file asserts is the lifecycle behind the guard. Authentication is
   * different, and it is different because of what happened without it: both
   * GET routes shipped with NO preHandler at all for a fortnight, and a
   * pass-through stub here would have kept reporting green after the fix as
   * happily as before it. So this one refuses when there is no user, and the
   * sweep below drives every registered route with none.
   */
  app.decorate(
    'requireAuth',
    (async (request: { user?: unknown }) => {
      if (request.user === null || request.user === undefined) {
        throw new UnauthorizedError('UNAUTHENTICATED');
      }
    }) as never,
  );
  // The real §1.4 envelope, so `details` reaches the assertions below the way
  // it reaches a client. Without it an `AppError`'s details are dropped and a
  // test could only see the status code.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send(errorEnvelope(error.code, error.message, 'req_test', error.details));
    }
    return reply.status(500).send(errorEnvelope('INTERNAL', String(error), 'req_test'));
  });
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    (request as { user?: unknown }).user = anonymous ? null : installer;
  });
  // Registered under the REAL prefix, so every URL in this file is the URL
  // production serves — including the bundle URLs the list reply hands out,
  // which are absolute and would otherwise only resolve by coincidence.
  await app.register(
    addOnRoutes({
      meta,
      store,
      credentialCrypto: crypto,
      ...(opts.schemaTarget === false
        ? {}
        : {
            schemaTarget: {
              read: async () => existingTables.map((t) => ({ ...t, columns: [...t.columns] })),
              /**
               * The REAL `applyInstall`, against a real (in-memory) source
               * database — only the connection-picking half is stubbed out.
               *
               * A recording stub would have made the uninstall test's
               * `tablesKept: true` a claim about a claim. With tables that
               * actually exist, D5 is asserted by looking for them afterwards.
               */
              apply: async (plan: InstallPlan, manifest: AddOnManifest) => {
                const result = await applyInstall({
                  plan,
                  tables: manifest.requiredSchema?.tables ?? [],
                  db: sourceDb,
                  dialect: 'sqlite',
                  existing: existingTables.map((t) => ({
                    ref: t.ref,
                    columns: t.columns.map((c) => ({ ...c, isPrimaryKey: c.ref === 'id' })),
                  })),
                });
                created.push(...result.created);
                return result;
              },
            },
          }),
      ...(catalog === undefined
        ? {}
        : {
            catalog: {
              isEnabled: async () => true,
              networkFeaturesAllowed: () => true,
              ...catalog,
            } as CatalogClient,
          }),
    }),
    { prefix: '/api/v1' },
  );
  await app.ready();
  return app;
}

describe('26 acceptance #8: every add-on route is reachable through compose.ts', () => {
  it('registers all four routes, each behind the permission it claims', async () => {
    // Reads the real route table rather than a hard-coded URL list, so a module
    // that stops being registered fails here — the M10/M11 failure mode, which
    // no existing ratchet in this repo can see.
    const app = await buildApp();
    // The route TREE, not a hard-coded URL list: a module that stops being
    // registered disappears from it, which is the M10/M11 failure mode no
    // existing ratchet in this repo can see.
    const printed = app.printRoutes({ commonPrefix: false });

    expect(printed).toContain('/add-ons');
    expect(printed).toMatch(/GET.*HEAD.*POST|POST/);
    expect(printed).toContain(':key');
    expect(printed).toContain('plan');
    // Every verb §5.1 specifies is actually served.
    for (const verb of ['GET', 'POST', 'PATCH', 'DELETE']) {
      expect(printed, `${verb} is not served`).toContain(verb);
    }
    await app.close();
  });

  it('EVERY add-on route declares a guard — none is guarded by prose alone', async () => {
    /*
     * THE DEFECT THIS EXISTS FOR (found by the 26-T15 round trip, 2026-08-31).
     *
     * `GET /add-ons` and `GET /add-ons/:key/bundle/*` both carried a docblock
     * saying "authenticated" and NO `preHandler`. This server has no ambient
     * auth hook — every route guards itself — so a route that names no guard
     * has none, and both served to anybody who asked: the full installed
     * inventory with each add-on's version, connection state, egress
     * allow-list and bundle URL, and then the bundle bytes themselves.
     *
     * Nothing could have caught it. The route-tree test above sees a route's
     * URL and verb, never its guards; the RBAC suites test the guard, not who
     * is wearing one; and the routes this file exercises all pass through a
     * stubbed authenticated request. So the question is asked HERE, of the
     * registered route options, where "did anybody remember" is answerable.
     */
    const Fastify = (await import('fastify')).default;
    const probe = Fastify();
    probe.setValidatorCompiler((await import('fastify-type-provider-zod')).validatorCompiler);
    probe.setSerializerCompiler((await import('fastify-type-provider-zod')).serializerCompiler);
    probe.decorate('rbac', { require: () => async () => {} } as never);
    probe.decorate('requireAuth', async () => {});

    const unguarded: string[] = [];
    probe.addHook('onRoute', (route) => {
      if (route.method === 'HEAD') return;
      const guards = route.preHandler;
      const count = Array.isArray(guards) ? guards.length : guards === undefined ? 0 : 1;
      if (count === 0) unguarded.push(`${String(route.method)} ${route.url}`);
    });
    await probe.register(
      addOnRoutes({ meta, store, credentialCrypto: crypto }),
      { prefix: '/api/v1' },
    );
    await probe.ready();
    expect(unguarded).toEqual([]);
    await probe.close();
  });

  it('refuses an anonymous caller on the two routes a HOST reads', async () => {
    // The behavioural half. `GET /add-ons` and the bundle route are the two a
    // connected host calls on every page load, and they are the two that were
    // open — which is also why connected add-on mode is a HOSTED build only:
    // it needs a session, and only a hosted surface has one.
    await stage('holiday-calendars');
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing'] },
    });
    anonymous = true;
    try {
      for (const url of [
        '/api/v1/add-ons',
        '/api/v1/add-ons/holiday-calendars/bundle/dist/client.js',
      ]) {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(401);
      }
    } finally {
      anonymous = false;
    }
    await app.close();
  });

  it('is registered by the composition root itself, not only by this test', async () => {
    // The assertion that actually closes acceptance #8: `compose.ts` names the
    // module. A route module that exists and is never composed is the exact
    // shape of the M10 gap, and it is invisible to every other ratchet here.
    const { readFile } = await import('node:fs/promises');
    const compose = await readFile(new URL('../src/compose.ts', import.meta.url), 'utf8');
    expect(compose).toContain("from './routes/add-ons/index.js'");
    expect(compose).toMatch(/api\.register\(\s*\n?\s*addOnRoutes\(/);
  });
});

describe('GET /add-ons', () => {
  it('is empty on a fresh instance rather than an error', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/add-ons' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ addOns: [] });
    await app.close();
  });

  it('survives one drifted bundle file instead of 500ing the whole list', async () => {
    /*
     * `toDto` used to read and re-hash every bundle of every add-on to produce
     * an integrity value the pin already held. `AddOnStoreError` is a plain
     * `Error`, so one tampered or truncated file rendered as 500 INTERNAL and
     * took the entire list down — for every add-on and every user, and for
     * every reply that goes through `toDto`: install, upgrade, connect, patch.
     *
     * "Somebody edited a package on the data volume" is the signal §5.4 exists
     * to raise. It has to arrive as a missing integrity on ONE bundle, not as
     * an internal fault on all of them.
     */
    await stage('holiday-calendars');
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing'] },
    });
    expect((await app.inject({ method: 'GET', url: '/api/v1/add-ons' })).statusCode).toBe(200);

    // Drift: the pin file goes, so the recorded hash cannot be read.
    const { rm: removeFile } = await import('node:fs/promises');
    await removeFile(`${store.dirFor('holiday-calendars', '1.0.0')}.pin.json`, { force: true });

    const res = await app.inject({ method: 'GET', url: '/api/v1/add-ons' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { addOns: { key: string; bundles: unknown[] }[] };
    expect(body.addOns[0]?.key).toBe('holiday-calendars');
    // The add-on is still listed; the bundle it cannot vouch for is not offered.
    expect(body.addOns[0]?.bundles).toEqual([]);
    await app.close();
  });

  it('never carries a credential, only whether one exists', async () => {
    await stage('holiday-calendars');
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing'] },
    });
    const installed = await manifestsRepo(meta, crypto).findByKey('holiday-calendars');
    await manifestsRepo(meta, crypto).setCredential(installed!.row.id, {
      kind: 'api-key',
      secret: { apiKey: 'hunter2' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/add-ons' });
    const body = res.json() as { addOns: Array<{ connected: boolean }> };
    expect(body.addOns[0]?.connected).toBe(true);
    // 24 D15: the secret must appear nowhere in a browser-facing reply.
    expect(res.payload).not.toContain('hunter2');
    expect(res.payload).not.toContain('enc:');
    await app.close();
  });
});

describe('POST /add-ons — install', () => {
  it('installs an add-on that touches no data', async () => {
    await stage('holiday-calendars');
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { addOn: { key: string; attachments: unknown[] }; plan: { touchesData: boolean } };
    expect(body.addOn.key).toBe('holiday-calendars');
    expect(body.addOn.attachments).toEqual([{ attachedTo: 'printing', enabled: true }]);
    expect(body.plan.touchesData).toBe(false);
    await app.close();
  });

  it('installs when the host already has every table the add-on needs', async () => {
    // The intended shape for an add-on attaching to a host's existing data —
    // no DDL, so it needs nothing 26-T02 has not built yet.
    await stage('shipping-dhl', {
      tables: [
        {
          ref: 'shipments',
          columns: [
            { ref: 'id', type: 'id', role: 'pk' },
            { ref: 'tracking', type: 'text' },
          ],
        },
      ],
    });
    const app = await buildApp([
      { ref: 'shipments', columns: [{ ref: 'id' }, { ref: 'tracking' }] },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'shipping-dhl', version: '1.0.0', attachTo: ['printing'] },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { plan: { reuse: unknown[] } }).plan.reuse).toHaveLength(1);
    await app.close();
  });

  it('creates the tables it needs BEFORE the manifest row exists (26-T02)', async () => {
    // The ordering is the point. MySQL has no transactional DDL, so DDL failing
    // after the row was written would leave an add-on registered against tables
    // that are not there — which is worse than not installing at all.
    await stage('shipping-dhl', {
      tables: [{ ref: 'shipments', columns: [{ ref: 'id', type: 'id', role: 'pk' }] }],
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'shipping-dhl', version: '1.0.0', attachTo: ['printing'] },
    });
    expect(res.statusCode, res.payload).toBe(200);
    expect(created).toEqual(['shipments']);
    expect(await manifestsRepo(meta, crypto).findByKey('shipping-dhl')).not.toBeNull();
    await app.close();
  });

  it('refuses when tables must be created and no data source is wired in', async () => {
    // The degraded composition, stated rather than silently succeeding: routes
    // registered without a `schemaTarget` can still list, plan and install
    // add-ons that bring no tables, and must refuse the ones that do.
    await stage('shipping-dhl', {
      tables: [{ ref: 'shipments', columns: [{ ref: 'id', type: 'id', role: 'pk' }] }],
    });
    const app = await buildApp(undefined, undefined, { schemaTarget: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'shipping-dhl', version: '1.0.0', attachTo: ['printing'] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.payload).toContain('ADD_ON_DDL_REQUIRED');
    expect(res.payload).toContain('shipments');
    // And nothing was written.
    expect(await manifestsRepo(meta, crypto).findByKey('shipping-dhl')).toBeNull();
    await app.close();
  });

  it('refuses to ADD COLUMNS to a table the operator already owns', async () => {
    // A partial match is a different conversation from a create: the table is
    // the operator's, and altering it is theirs to decide.
    await stage('shipping-dhl', {
      tables: [
        {
          ref: 'shipments',
          columns: [
            { ref: 'id', type: 'id', role: 'pk' },
            { ref: 'tracking', type: 'text' },
          ],
        },
      ],
    });
    const app = await buildApp([{ ref: 'shipments', columns: [{ ref: 'id' }] }]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'shipping-dhl', version: '1.0.0', attachTo: ['printing'] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.payload).toContain('ADD_ON_COLUMNS_REQUIRED');
    expect(res.payload).toContain('tracking');
    expect(created).toEqual([]);
    await app.close();
  });

  it('refuses a host the manifest does not claim to attach to', async () => {
    await stage('holiday-calendars', undefined, ['hr', 'clinic']);
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing'] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.payload).toContain('does not declare');
    await app.close();
  });

  it('refuses a package that is not staged at all', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'never-downloaded', version: '1.0.0', attachTo: [] },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('refuses a staged tree that was modified after it was verified', async () => {
    // The TOCTOU close: the data volume is shared writable state, so install
    // re-checks the per-file pin before parsing a byte.
    await stage('holiday-calendars');
    await writeFile(
      join(store.dirFor('holiday-calendars', '1.0.0'), 'dist', 'client.js'),
      'globalThis.pwned = true;',
    );
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing'] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.payload).toContain('no longer matches');
    await app.close();
  });

  it('refuses a second install of the same key', async () => {
    await stage('holiday-calendars');
    const app = await buildApp();
    const payload = { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing'] };
    expect((await app.inject({ method: 'POST', url: '/api/v1/add-ons', payload })).statusCode).toBe(200);
    const again = await app.inject({ method: 'POST', url: '/api/v1/add-ons', payload });
    expect(again.statusCode).toBe(409);
    await app.close();
  });
});

describe('PATCH /add-ons/:key — enable and disable per host', () => {
  it('disables on one host and leaves the other running', async () => {
    await stage('holiday-calendars', undefined, ['printing', 'maker']);
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing', 'maker'] },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/add-ons/holiday-calendars',
      payload: { attachedTo: 'maker', enabled: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { addOn: { attachments: Array<{ attachedTo: string; enabled: boolean }> } };
    expect(body.addOn.attachments).toEqual([
      { attachedTo: 'maker', enabled: false },
      { attachedTo: 'printing', enabled: true },
    ]);
    await app.close();
  });

  it('404s on a host the add-on is not attached to', async () => {
    await stage('holiday-calendars');
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing'] },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/add-ons/holiday-calendars',
      payload: { attachedTo: 'maker', enabled: false },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('DELETE /add-ons/:key — uninstall (24 D16 / 26 D5)', () => {
  it('removes the add-on and its package, and says the tables were kept', async () => {
    await stage('holiday-calendars');
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing'] },
    });

    const res = await app.inject({ method: 'DELETE', url: '/api/v1/add-ons/holiday-calendars' });
    expect(res.statusCode).toBe(200);
    // Stated back to the caller because it is the promise the confirm made.
    expect(res.json()).toEqual({
      key: 'holiday-calendars',
      tablesKept: true,
      packageRemoved: true,
    });

    expect(await manifestsRepo(meta, crypto).findByKey('holiday-calendars')).toBeNull();
    expect(await store.keys()).toEqual([]);
    await app.close();
  });

  it('really does KEEP the tables it created — D5, checked in the database', async () => {
    // `tablesKept: true` above is a claim. This is the claim checked: install
    // creates `shipments` for real, uninstall removes the add-on and its
    // package, and the table and its rows are still there afterwards.
    await stage('shipping-dhl', {
      tables: [{ ref: 'shipments', columns: [{ ref: 'id', type: 'id', role: 'pk' }] }],
    });
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'shipping-dhl', version: '1.0.0', attachTo: ['printing'] },
    });
    await sourceDb.insertInto('shipments').values({ id: 's1' }).execute();

    const res = await app.inject({ method: 'DELETE', url: '/api/v1/add-ons/shipping-dhl' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { tablesKept: boolean }).tablesKept).toBe(true);

    const rows = await sourceDb.selectFrom('shipments').selectAll().execute();
    expect(rows).toHaveLength(1);
    await app.close();
  });

  it('404s on an add-on that is not installed', async () => {
    const app = await buildApp();
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/add-ons/absent' })).statusCode).toBe(404);
    await app.close();
  });
});

describe('26-T11: bundle serving with SRI (§5.4)', () => {
  /** Installs `holiday-calendars` and returns its listed bundle. */
  async function installAndList(app: Awaited<ReturnType<typeof buildApp>>) {
    await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing'] },
    });
    const list = (await app.inject({ method: 'GET', url: '/api/v1/add-ons' })).json() as {
      addOns: Array<{ bundles: Array<{ path: string; url: string; integrity: string }> }>;
    };
    return list.addOns[0]!.bundles[0]!;
  }

  it('tells a host where the bundle is and what to pin it to', async () => {
    await stage('holiday-calendars');
    const app = await buildApp();
    const bundle = await installAndList(app);

    expect(bundle.path).toBe('dist/client.js');
    expect(bundle.url).toBe('/api/v1/add-ons/holiday-calendars/bundle/dist/client.js');
    expect(bundle.integrity).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
    await app.close();
  });

  it('serves the bundle, and the integrity header matches what the list promised', async () => {
    // The property that matters: what a host is told to pin and what the server
    // actually serves are derived from ONE recorded hash, so they cannot drift.
    await stage('holiday-calendars');
    const app = await buildApp();
    const bundle = await installAndList(app);

    const res = await app.inject({ method: 'GET', url: bundle.url });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe('export const register = () => {};');
    expect(res.headers['x-adminium-integrity']).toBe(bundle.integrity);
    expect(res.headers['content-type']).toContain('text/javascript');

    // And the value really is the SRI of the bytes served.
    const { createHash } = await import('node:crypto');
    const expected = `sha256-${createHash('sha256').update(res.rawPayload).digest('base64')}`;
    expect(bundle.integrity).toBe(expected);
    await app.close();
  });

  it('REFUSES a bundle edited on disk after install — "checked on read"', async () => {
    // The whole point of §5.4. Without it, anything with write access to the
    // data volume could swap the JavaScript a host page executes, and the
    // integrity value the host was given earlier would simply be wrong.
    await stage('holiday-calendars');
    const app = await buildApp();
    const bundle = await installAndList(app);

    await writeFile(
      join(store.dirFor('holiday-calendars', '1.0.0'), 'dist', 'client.js'),
      'globalThis.pwned = true;',
    );

    const res = await app.inject({ method: 'GET', url: bundle.url });
    expect(res.statusCode).toBe(422);
    expect(res.payload).toContain('no longer matches');
    expect(res.payload).not.toContain('pwned');
    await app.close();
  });

  it('serves only paths the MANIFEST declares, not everything in the package', async () => {
    await stage('holiday-calendars');
    const app = await buildApp();
    await installAndList(app);

    for (const file of ['package.json', 'manifest.json', 'dist/other.js']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/add-ons/holiday-calendars/bundle/${file}`,
      });
      expect(res.statusCode, file).toBe(404);
    }
    await app.close();
  });

  it('refuses a traversal in the bundle path', async () => {
    await stage('holiday-calendars');
    const app = await buildApp();
    await installAndList(app);
    for (const file of ['../../../etc/passwd', '..%2f..%2fetc%2fpasswd', 'dist/../package.json']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/add-ons/holiday-calendars/bundle/${file}`,
      });
      expect([404, 400], file).toContain(res.statusCode);
      expect(res.payload).not.toContain('root:');
    }
    await app.close();
  });

  it('404s for an add-on that is not installed', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/add-ons/absent/bundle/dist/client.js',
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('26-T07: connect and disconnect (§5.1, D2, D5)', () => {
  /** The DHL shape: two secret settings and two ordinary ones. */
  const DHL_SETTINGS = [
    { key: 'api_key', type: 'string', secret: true, label: { key: 'a', fallback: 'API key' } },
    { key: 'account_number', type: 'string', secret: true, label: { key: 'b', fallback: 'Account' } },
    { key: 'demo_transport', type: 'boolean', default: true, label: { key: 'c', fallback: 'Demo' } },
  ];

  async function installDhl(app: Awaited<ReturnType<typeof buildApp>>) {
    await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'shipping-dhl', version: '1.0.0', attachTo: ['printing'] },
    });
  }

  it('stores an api-key credential and reports connected', async () => {
    await stage('shipping-dhl', undefined, undefined, { kind: 'api-key' }, DHL_SETTINGS);
    const app = await buildApp();
    await installDhl(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons/shipping-dhl/connect',
      payload: { credentials: { api_key: 'hunter2', account_number: '4711' } },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { addOn: { connected: boolean } }).addOn.connected).toBe(true);

    // 24 D15, asserted on the actual reply bytes rather than on a field name.
    expect(res.payload).not.toContain('hunter2');
    expect(res.payload).not.toContain('4711');

    // And the plaintext is nowhere in the row either.
    const raw = await meta.db.selectFrom('adminium_add_on_credentials').selectAll().executeTakeFirstOrThrow();
    expect(JSON.stringify(raw)).not.toContain('hunter2');
    await app.close();
  });

  it('refuses a credential field the manifest does not declare', async () => {
    // A store that accepts whatever it is sent is one nobody can audit, and a
    // typo'd key would sit there forever looking like a configured secret.
    await stage('shipping-dhl', undefined, undefined, { kind: 'api-key' }, DHL_SETTINGS);
    const app = await buildApp();
    await installDhl(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons/shipping-dhl/connect',
      payload: { credentials: { api_key: 'k', account_number: '1', sneaky: 'x' } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.payload).toContain('sneaky');
    await app.close();
  });

  it('refuses a partial credential rather than storing half of one', async () => {
    await stage('shipping-dhl', undefined, undefined, { kind: 'api-key' }, DHL_SETTINGS);
    const app = await buildApp();
    await installDhl(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons/shipping-dhl/connect',
      payload: { credentials: { api_key: 'k' } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.payload).toContain('account_number');
    expect(await manifestsRepo(meta, crypto).credentialStatus(
      (await manifestsRepo(meta, crypto).findByKey('shipping-dhl'))!.row.id,
    )).toBeNull();
    await app.close();
  });

  it('never asks a non-secret setting to be sent as a credential', async () => {
    // `demo_transport` is ordinary configuration, not a secret — sending it
    // here is the same mistake as sending an unknown key.
    await stage('shipping-dhl', undefined, undefined, { kind: 'api-key' }, DHL_SETTINGS);
    const app = await buildApp();
    await installDhl(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons/shipping-dhl/connect',
      payload: { credentials: { api_key: 'k', account_number: '1', demo_transport: 'true' } },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it("says an add-on that needs no connection needs no connection", async () => {
    await stage('holiday-calendars');
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing'] },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons/holiday-calendars/connect',
      payload: { credentials: {} },
    });
    expect(res.statusCode).toBe(422);
    expect(res.payload).toContain('needs no connection');
    await app.close();
  });

  it('points an OAuth add-on at the OAuth flow rather than refusing vaguely', async () => {
    // An oauth2 connect must declare where it authorizes (§5.6) — the
    // validator refuses one that does not, which is why this fixture carries
    // both URLs rather than only the kind.
    await stage('import-canva', undefined, undefined, {
      kind: 'oauth2',
      authorizeUrl: 'https://api.canva.com/oauth/authorize',
      tokenUrl: 'https://api.canva.com/oauth/token',
    },
      undefined,
      // `oauth2` also requires the `oauth-connect` capability — the validator
      // ties the connect kind to the consent the operator granted.
      ['oauth-connect'],
    );
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'import-canva', version: '1.0.0', attachTo: ['printing'] },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons/import-canva/connect',
      payload: { credentials: {} },
    });
    expect(res.statusCode).toBe(422);
    expect(res.payload).toContain('connect/oauth/start');
    await app.close();
  });

  it('runs the OAuth flow end to end, and the reply carries no secret', async () => {
    // Acceptance #2: all three kinds work, and the add-on never sees the
    // client secret. Asserted on the reply bytes and the stored row.
    await stage(
      'import-canva',
      undefined,
      undefined,
      {
        kind: 'oauth2',
        authorizeUrl: 'https://api.canva.com/oauth/authorize',
        tokenUrl: 'https://api.canva.com/oauth/token',
      },
      undefined,
      ['oauth-connect', 'outbound-http'],
      ['api.canva.com'],
    );
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'import-canva', version: '1.0.0', attachTo: ['printing'] },
    });

    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons/import-canva/connect/oauth/start',
      payload: {
        clientId: 'client-123',
        clientSecret: 'shhh-secret',
        redirectUri: 'https://adminium.example/cb',
      },
    });
    expect(started.statusCode).toBe(200);
    const { state, authorizeUrl } = started.json() as { state: string; authorizeUrl: string };
    expect(authorizeUrl).toContain('code_challenge_method=S256');
    // The browser is sent the challenge, never the verifier or the secret.
    expect(started.payload).not.toContain('shhh-secret');
    expect(authorizeUrl).not.toContain('code_verifier');

    // The token exchange goes out through the guarded client, so the fetch is
    // stubbed at the global — the allow-list is what decides it is permitted.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof globalThis.fetch;
    try {
      const done = await app.inject({
        method: 'POST',
        url: '/api/v1/add-ons/import-canva/connect/oauth/complete',
        payload: { state, code: 'auth-code-1' },
      });
      expect(done.statusCode).toBe(200);
      expect((done.json() as { addOn: { connected: boolean } }).addOn.connected).toBe(true);
      // 24 D15 + acceptance #2, on the actual bytes.
      expect(done.payload).not.toContain('shhh-secret');
      expect(done.payload).not.toContain('rt-1');
      expect(done.payload).not.toContain('at-1');
    } finally {
      globalThis.fetch = realFetch;
    }

    // Stored encrypted: no plaintext anywhere in the row.
    const raw = await meta.db.selectFrom('adminium_add_on_credentials').selectAll().executeTakeFirstOrThrow();
    expect(JSON.stringify(raw)).not.toContain('shhh-secret');
    expect(JSON.stringify(raw)).not.toContain('rt-1');
    expect(raw.kind).toBe('oauth2');
    await app.close();
  });

  it('refuses a replayed or unknown state', async () => {
    await stage(
      'import-canva',
      undefined,
      undefined,
      {
        kind: 'oauth2',
        authorizeUrl: 'https://api.canva.com/oauth/authorize',
        tokenUrl: 'https://api.canva.com/oauth/token',
      },
      undefined,
      ['oauth-connect', 'outbound-http'],
      ['api.canva.com'],
    );
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'import-canva', version: '1.0.0', attachTo: ['printing'] },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons/import-canva/connect/oauth/complete',
      payload: { state: 'never-issued', code: 'c' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.payload).toContain('UNKNOWN_STATE');
    await app.close();
  });

  it('refuses to start an OAuth flow for a non-OAuth add-on', async () => {
    await stage('holiday-calendars');
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons',
      payload: { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing'] },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons/holiday-calendars/connect/oauth/start',
      payload: { clientId: 'a', clientSecret: 'b', redirectUri: 'https://x.example/cb' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.payload).toContain('does not connect over OAuth');
    await app.close();
  });

  it('re-connecting rotates the credential rather than duplicating it', async () => {
    await stage('shipping-dhl', undefined, undefined, { kind: 'api-key' }, DHL_SETTINGS);
    const app = await buildApp();
    await installDhl(app);
    const payload = { credentials: { api_key: 'old', account_number: '1' } };
    await app.inject({ method: 'POST', url: '/api/v1/add-ons/shipping-dhl/connect', payload });
    await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons/shipping-dhl/connect',
      payload: { credentials: { api_key: 'rotated', account_number: '1' } },
    });

    const repo = manifestsRepo(meta, crypto);
    const installed = (await repo.findByKey('shipping-dhl'))!;
    expect((await repo.getCredential(installed.row.id))?.secret).toEqual({
      api_key: 'rotated',
      account_number: '1',
    });
    expect(await meta.db.selectFrom('adminium_add_on_credentials').selectAll().execute()).toHaveLength(1);
    await app.close();
  });

  it('D5: disconnect deletes the keys and keeps everything else', async () => {
    await stage('shipping-dhl', undefined, undefined, { kind: 'api-key' }, DHL_SETTINGS);
    const app = await buildApp();
    await installDhl(app);
    await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons/shipping-dhl/connect',
      payload: { credentials: { api_key: 'k', account_number: '1' } },
    });

    const res = await app.inject({ method: 'DELETE', url: '/api/v1/add-ons/shipping-dhl/connect' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      key: 'shipping-dhl',
      credentialsDeleted: true,
      tablesKept: true,
    });

    // The add-on is still installed, still attached, and now disconnected —
    // which is the whole of 24 D16 in one assertion.
    const still = await manifestsRepo(meta, crypto).findByKey('shipping-dhl');
    expect(still).not.toBeNull();
    expect(still!.attachments).toHaveLength(1);
    expect(await meta.db.selectFrom('adminium_add_on_credentials').selectAll().execute()).toEqual([]);

    const list = (await app.inject({ method: 'GET', url: '/api/v1/add-ons' })).json() as {
      addOns: Array<{ connected: boolean }>;
    };
    expect(list.addOns[0]?.connected).toBe(false);
    await app.close();
  });

  it('audits the field NAMES on connect, never the values', async () => {
    await stage('shipping-dhl', undefined, undefined, { kind: 'api-key' }, DHL_SETTINGS);
    const app = await buildApp();
    await installDhl(app);
    await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons/shipping-dhl/connect',
      payload: { credentials: { api_key: 'hunter2', account_number: '4711' } },
    });

    const rows = await auditRepo(meta).list({ category: 'add-on', limit: 20 });
    const connected = rows.find((r) => r.action === 'add-on.connected');
    expect(connected?.changes).toMatchObject({
      after: { key: 'shipping-dhl', fields: ['api_key', 'account_number'] },
    });
    // The row exists to say a connection was made — not to record the secret a
    // second time, in a table with different retention.
    expect(JSON.stringify(rows)).not.toContain('hunter2');
    await app.close();
  });

  it('404s connecting an add-on that is not installed', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/add-ons/absent/connect',
      payload: { credentials: {} },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('32-T09: acquisition routes (§4.3)', () => {
  /** A tarball built the way the sideload route expects to receive one. */
  function tarballFor(key: string) {
    return packageTarball({
      'manifest.json': JSON.stringify(manifestFor(key)),
      'package.json': JSON.stringify({ name: `@adminiumjs/add-on-${key}` }),
      'dist/client.js': 'export const register = () => {};',
    });
  }

  describe('GET /add-ons/catalog — browse', () => {
    it('lists what is on disk with NO network call at all', async () => {
      // The property that makes this page work on an air-gapped install: browse
      // is a disk read, never an inline fetch.
      await stage('holiday-calendars');
      const fetchCatalog = vi.fn();
      const app = await buildApp([], { fetchCatalog: fetchCatalog as never });

      const res = await app.inject({ method: 'GET', url: '/api/v1/add-ons/catalog' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        addOns: Array<{ key: string; state: string; source: string }>;
        catalogFetchedAt: number | null;
      };
      expect(body.addOns).toEqual([
        expect.objectContaining({ key: 'holiday-calendars', state: 'staged', source: 'bundled' }),
      ]);
      expect(body.catalogFetchedAt).toBeNull();
      expect(fetchCatalog).not.toHaveBeenCalled();
      await app.close();
    });

    it('reports an installed add-on as installed, not staged', async () => {
      await stage('holiday-calendars');
      const app = await buildApp();
      await app.inject({
        method: 'POST',
        url: '/api/v1/add-ons',
        payload: { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing'] },
      });
      const body = (await app.inject({ method: 'GET', url: '/api/v1/add-ons/catalog' })).json() as {
        addOns: Array<{ state: string; upgradeTo: string | null }>;
      };
      expect(body.addOns[0]?.state).toBe('installed');
      expect(body.addOns[0]?.upgradeTo).toBeNull();
      await app.close();
    });

    it('merges the last cached catalog in, and flags a newer version', async () => {
      await stage('holiday-calendars');
      const app = await buildApp();
      await app.inject({
        method: 'POST',
        url: '/api/v1/add-ons',
        payload: { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing'] },
      });
      await store.writeCatalogCache(
        {
          schemaVersion: 1,
          generatedAt: '2026-08-29T00:00:00Z',
          addOns: [
            {
              key: 'holiday-calendars',
              npmPackage: '@adminiumjs/add-on-holiday-calendars',
              version: '1.2.0',
              integrity: 'sha512-AAAA',
              provides: [],
              attaches: [{ app: 'printing' }],
              categories: [],
              capabilities: [],
              connect: { kind: 'none' },
              network: { allow: [] },
              name: { en_US: 'Holiday Calendars' },
              tagline: { en_US: 'x' },
            },
            {
              key: 'shipping-dhl',
              npmPackage: '@adminiumjs/add-on-shipping-dhl',
              version: '1.0.0',
              integrity: 'sha512-BBBB',
              provides: [],
              attaches: [{ app: 'printing' }],
              categories: [],
              capabilities: [],
              connect: { kind: 'api-key' },
              network: { allow: [] },
              name: { en_US: 'DHL Shipping' },
              tagline: { en_US: 'y' },
            },
          ],
        },
        1_700_000_000_000,
      );

      const body = (await app.inject({ method: 'GET', url: '/api/v1/add-ons/catalog' })).json() as {
        addOns: Array<{ key: string; state: string; source: string; upgradeTo: string | null }>;
        catalogFetchedAt: number | null;
      };
      expect(body.catalogFetchedAt).toBe(1_700_000_000_000);
      const hc = body.addOns.find((a) => a.key === 'holiday-calendars');
      expect(hc?.state).toBe('installed');
      expect(hc?.upgradeTo).toBe('1.2.0');
      // Never downloaded, so it needs the network — labelled honestly.
      const dhl = body.addOns.find((a) => a.key === 'shipping-dhl');
      expect(dhl).toMatchObject({ state: 'available', source: 'catalog' });
      await app.close();
    });
  });

  describe('refresh and download refuse when the catalog is off (D8)', () => {
    it('refuses a refresh with a reason, not a silent no-op', async () => {
      const app = await buildApp([], { isEnabled: async () => false });
      const res = await app.inject({ method: 'POST', url: '/api/v1/add-ons/catalog/refresh' });
      expect(res.statusCode).toBe(422);
      expect(res.payload).toContain('CATALOG_DISABLED');
      await app.close();
    });

    it('refuses a download and points at the sideload path instead', async () => {
      const app = await buildApp([], { isEnabled: async () => false });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/add-ons/download',
        payload: { key: 'shipping-dhl', version: '1.0.0' },
      });
      expect(res.statusCode).toBe(422);
      expect(res.payload).toContain('Upload the package instead');
      await app.close();
    });

    it('enqueues a download when the catalog is on', async () => {
      const app = await buildApp([], {});
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/add-ons/download',
        payload: { key: 'shipping-dhl', version: '1.0.0' },
      });
      expect(res.statusCode).toBe(200);
      const { jobId } = res.json() as { jobId: string };
      const job = await jobsRepo(meta).findById(jobId);
      expect(job?.kind).toBe('add-on-download');
      // Enqueued through the repo, never `POST /jobs` — the kind is
      // internal-only precisely so its payload cannot be hand-crafted.
      expect(job?.payload).toMatchObject({ key: 'shipping-dhl', version: '1.0.0' });
      await app.close();
    });

    it('collapses two downloads of the same version into one job', async () => {
      const app = await buildApp([], {});
      const payload = { key: 'shipping-dhl', version: '1.0.0' };
      const a = (await app.inject({ method: 'POST', url: '/api/v1/add-ons/download', payload })).json() as { jobId: string };
      const b = (await app.inject({ method: 'POST', url: '/api/v1/add-ons/download', payload })).json() as { jobId: string };
      expect(b.jobId).toBe(a.jobId);
      await app.close();
    });
  });

  describe('POST /add-ons/upload — the sideload path (D4)', () => {
    it('verifies and unpacks a correct tarball, with no network involved', async () => {
      const app = await buildApp();
      const tarball = tarballFor('holiday-calendars');
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/add-ons/upload?key=holiday-calendars&version=1.0.0&expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.from(tarball),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ key: 'holiday-calendars', version: '1.0.0', files: 3 });
      // It went through the SAME store path a download would use.
      await expect(store.verifyTree('holiday-calendars', '1.0.0')).resolves.toBeDefined();
      await app.close();
    });

    it('refuses a tarball whose hash does not match the operator-supplied one', async () => {
      const app = await buildApp();
      const tarball = tarballFor('holiday-calendars');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/add-ons/upload?key=holiday-calendars&version=1.0.0&expectedSha512=sha512-AAAAwrong',
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.from(tarball),
      });
      expect(res.statusCode).toBe(422);
      expect(await store.keys()).toEqual([]);
      await app.close();
    });

    it('audits a refused upload as a verify refusal', async () => {
      const app = await buildApp();
      const tarball = tarballFor('holiday-calendars');
      await app.inject({
        method: 'POST',
        url: '/api/v1/add-ons/upload?key=holiday-calendars&version=1.0.0&expectedSha512=sha512-AAAAwrong',
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.from(tarball),
      });
      const rows = await auditRepo(meta).list({ category: 'add-on', limit: 10 });
      expect(rows.map((r) => r.action)).toEqual(['add-on.verify-refused']);
      await app.close();
    });

    it('refuses an empty body with a message naming npm pack', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/add-ons/upload?key=x-thing&version=1.0.0&expectedSha512=sha512-AAAA',
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.alloc(0),
      });
      expect(res.statusCode).toBe(422);
      await app.close();
    });
  });

  describe('PUT /add-ons/catalog — the online switch (32 §4.4, D8, O1)', () => {
    it('turns browsing on and says what the effective state is', async () => {
      const app = await buildApp([], {});
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/add-ons/catalog',
        payload: { enabled: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ onlineEnabled: true, vetoed: false });
      await app.close();
    });

    it('reports VETOED when the environment overrules the setting', async () => {
      /*
       * `ADMINIUM_NETWORK_FEATURES=off` and desktop air-gap mode outrank the
       * stored boolean (O1). An operator can switch this on and have it stay
       * off, and the reply has to say so — a toggle that springs back with no
       * explanation reads as a broken page rather than as a policy.
       */
      const app = await buildApp([], { networkFeaturesAllowed: () => false });
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/add-ons/catalog',
        payload: { enabled: true },
      });
      expect(res.json()).toEqual({ onlineEnabled: false, vetoed: true });
      await app.close();
    });

    it('is not vetoed when switching OFF, because off is what the veto wants', async () => {
      const app = await buildApp([], { networkFeaturesAllowed: () => false });
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/add-ons/catalog',
        payload: { enabled: false },
      });
      expect(res.json()).toEqual({ onlineEnabled: false, vetoed: false });
      await app.close();
    });

    it('persists, so the browse reply agrees with what was set', async () => {
      const app = await buildApp([], {});
      await app.inject({
        method: 'PUT',
        url: '/api/v1/add-ons/catalog',
        payload: { enabled: true },
      });
      const browse = await app.inject({ method: 'GET', url: '/api/v1/add-ons/catalog' });
      expect((browse.json() as { onlineEnabled: boolean }).onlineEnabled).toBe(true);
      await app.close();
    });

    it('records the change in the audit trail', async () => {
      const app = await buildApp([], {});
      await app.inject({
        method: 'PUT',
        url: '/api/v1/add-ons/catalog',
        payload: { enabled: true },
      });
      const rows = await auditRepo(meta).list({ category: 'add-on', limit: 20 });
      const row = rows.find((r) => r.action === 'add-on.catalog-toggled');
      expect(row, 'the toggle is not audited').toBeTruthy();
      await app.close();
    });
  });

  describe('DELETE /add-ons/staged/:key/:version — declining is not a dead end', () => {
    it('discards a staged package that was never installed', async () => {
      await stage('holiday-calendars');
      const app = await buildApp();
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/add-ons/staged/holiday-calendars/1.0.0',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ key: 'holiday-calendars', version: '1.0.0', discarded: true });
      expect(await store.keys()).toEqual([]);

      const rows = await auditRepo(meta).list({ category: 'add-on', limit: 10 });
      expect(rows.map((r) => r.action)).toContain('add-on.deleted');
      await app.close();
    });

    it('refuses to discard the version that is INSTALLED', async () => {
      // That path is uninstall, which has different consequences and its own
      // confirm — discarding it here would delete a running add-on's code.
      await stage('holiday-calendars');
      const app = await buildApp();
      await app.inject({
        method: 'POST',
        url: '/api/v1/add-ons',
        payload: { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing'] },
      });
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/add-ons/staged/holiday-calendars/1.0.0',
      });
      expect(res.statusCode).toBe(409);
      expect(await store.keys()).toEqual(['holiday-calendars']);
      await app.close();
    });
  });

  describe('POST /add-ons/:key/upgrade (26-T17)', () => {
    /** Stages a second, newer version of an already-installed add-on. */
    async function stageNewer(key: string, version: string, attaches = ['printing']) {
      const tarball = packageTarball({
        'manifest.json': JSON.stringify({
          ...manifestFor(key, undefined, attaches),
          version,
        }),
        'package.json': '{}',
        'dist/client.js': 'export const register = () => { /* v2 */ };',
      });
      await store.stage({
        key,
        version,
        tarball,
        expectedIntegrity: sha512Integrity(tarball),
      });
    }

    it('bumps the version in place, keeping attachments and the credential', async () => {
      // An upgrade is not a reinstall: the hosts it is mounted on and the key
      // it was given both survive it.
      await stage('holiday-calendars', undefined, ['printing', 'maker']);
      const app = await buildApp();
      await app.inject({
        method: 'POST',
        url: '/api/v1/add-ons',
        payload: { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing', 'maker'] },
      });
      const repo = manifestsRepo(meta, crypto);
      const before = (await repo.findByKey('holiday-calendars'))!;
      await repo.setCredential(before.row.id, { kind: 'api-key', secret: { k: 'v' } });

      await stageNewer('holiday-calendars', '1.1.0', ['printing', 'maker']);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/add-ons/holiday-calendars/upgrade',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ from: '1.0.0', to: '1.1.0', pruned: ['1.0.0'] });

      const after = (await repo.findByKey('holiday-calendars'))!;
      expect(after.row.version).toBe('1.1.0');
      expect(after.attachments).toHaveLength(2);
      expect(await repo.getCredential(after.row.id)).not.toBeNull();
      // D11: the old directory goes only AFTER the upgrade verified.
      expect(await store.versions('holiday-calendars')).toEqual(['1.1.0']);
      await app.close();
    });

    it('refuses when the newer version dropped a host this instance uses', async () => {
      // Upgrading into it would leave an attachment the manifest no longer
      // claims to support.
      await stage('holiday-calendars', undefined, ['printing', 'maker']);
      const app = await buildApp();
      await app.inject({
        method: 'POST',
        url: '/api/v1/add-ons',
        payload: { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing', 'maker'] },
      });
      await stageNewer('holiday-calendars', '2.0.0', ['printing']);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/add-ons/holiday-calendars/upgrade',
      });
      expect(res.statusCode).toBe(422);
      expect(res.payload).toContain('maker');
      // Unchanged, and the staged version is still there to retry or discard.
      const repo = manifestsRepo(meta, crypto);
      expect((await repo.findByKey('holiday-calendars'))!.row.version).toBe('1.0.0');
      await app.close();
    });

    it('404s when nothing newer is staged', async () => {
      await stage('holiday-calendars');
      const app = await buildApp();
      await app.inject({
        method: 'POST',
        url: '/api/v1/add-ons',
        payload: { key: 'holiday-calendars', version: '1.0.0', attachTo: ['printing'] },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/add-ons/holiday-calendars/upgrade',
      });
      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it('404s for an add-on that is not installed', async () => {
      const app = await buildApp();
      const res = await app.inject({ method: 'POST', url: '/api/v1/add-ons/absent/upgrade' });
      expect(res.statusCode).toBe(404);
      await app.close();
    });
  });
});

describe('GET /add-ons/:key/plan — the consent dialog document', () => {
  it('shows what installing would do BEFORE anything is installed', async () => {
    await stage('shipping-dhl', {
      tables: [
        {
          ref: 'shipments',
          columns: [
            { ref: 'id', type: 'id', role: 'pk' },
            { ref: 'order_id', type: 'fk', references: 'orders' },
          ],
        },
      ],
    });
    const app = await buildApp([{ ref: 'orders', columns: [{ ref: 'id' }] }]);
    const res = await app.inject({ method: 'GET', url: '/api/v1/add-ons/shipping-dhl/plan' });
    expect(res.statusCode).toBe(200);
    const { plan } = res.json() as {
      plan: { create: Array<{ ref: string }>; references: Array<{ resolution: string }>; requiresSchemaChange: boolean };
    };
    expect(plan.create.map((t) => t.ref)).toEqual(['shipments']);
    expect(plan.references[0]?.resolution).toBe('host');
    expect(plan.requiresSchemaChange).toBe(true);
    // Nothing was installed by asking.
    expect(await manifestsRepo(meta, crypto).findByKey('shipping-dhl')).toBeNull();
    await app.close();
  });

  it('renders a plan even when the add-on cannot be installed here', async () => {
    // The dialog has to be able to show WHY, so a refusal is data, not a throw.
    await stage('design-studio', {
      tables: [
        {
          ref: 'artwork_designs',
          columns: [
            { ref: 'id', type: 'id', role: 'pk' },
            { ref: 'job_id', type: 'fk', references: 'jobs' },
          ],
        },
      ],
    });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/add-ons/design-studio/plan' });
    expect(res.statusCode).toBe(200);
    const { plan } = res.json() as { plan: { installable: boolean; problems: Array<{ code: string }> } };
    expect(plan.installable).toBe(false);
    expect(plan.problems[0]?.code).toBe('UNRESOLVED_REFERENCE');
    await app.close();
  });
});
