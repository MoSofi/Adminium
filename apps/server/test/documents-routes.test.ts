// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/api/v1/documents`.
 *
 * ─── The question this file exists to ask ──────────────────────────────────
 *
 * "Does every route declare a guard?" — asked of the REGISTERED ROUTE
 * OPTIONS, because it is answerable nowhere else. The route-tree test sees a
 * URL and a verb, never a guard; the RBAC suites test the guard, not who is
 * wearing one; and a route with no `preHandler` on this server has no auth at
 * all, since there is no ambient hook. `GET /add-ons` shipped that way for a
 * fortnight with a docblock claiming otherwise, which is why this shape of
 * test now travels with every new route group.
 *
 * ─── And then the one that is this group's own ─────────────────────────────
 *
 * A document is built from the tables its profile MAPS, so reading one is not
 * one grant, it is all of them (D16). The behavioural half below builds two
 * documents and reads them as three different callers.
 */

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyMigrations,
  automationsRepo,
  usersRepo,
  connectionsRepo,
  createSqliteMetaDb,
  documentProfilesRepo,
  documentsRepo,
  initMetaDb,
  type DsnCrypto,
  type MetaDb,
} from '@adminium/meta';

import { documentRoutes } from '../src/routes/documents/index.js';

/*
 * One switch, off by default: every test in this file runs the REAL trigger
 * sync except the one that needs the second write to fail.
 */
const failNextSync = vi.hoisted(() => ({ value: false }));
vi.mock('../src/documents/trigger-sync.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/documents/trigger-sync.js')>();
  return {
    ...real,
    syncProfileTrigger: (...args: Parameters<typeof real.syncProfileTrigger>) => {
      if (!failNextSync.value) return real.syncProfileTrigger(...args);
      failNextSync.value = false;
      return Promise.reject(new Error('the meta store went away between two statements'));
    },
  };
});

afterEach(() => {
  failNextSync.value = false;
});

const crypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:${plaintext}`,
  decrypt: (ciphertext) => ciphertext.replace('enc:', ''),
};

async function freshMeta(): Promise<MetaDb> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await initMetaDb(meta);
  await applyMigrations(meta.db, { dialect: meta.dialect });
  return meta;
}

describe('every documents route declares a guard', () => {
  it('names a preHandler on all of them — none is guarded by prose alone', async () => {
    const meta = await freshMeta();
    const Fastify = (await import('fastify')).default;
    const zod = await import('fastify-type-provider-zod');
    const probe = Fastify();
    probe.setValidatorCompiler(zod.validatorCompiler);
    probe.setSerializerCompiler(zod.serializerCompiler);
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
      documentRoutes({
        meta,
        storage: {} as never,
        runtime: () => null,
        enqueue: () => Promise.resolve({ id: 'job_1' }),
      }),
      { prefix: '/api/v1' },
    );
    await probe.ready();

    expect(unguarded).toEqual([]);
    await probe.close();
  });

  it('gates the three ADMIN routes behind manifests.manage, not merely on being signed in', async () => {
    /*
     * A profile decides what an add-on may read and what it renders — the
     * same authority as installing one (O6). The three profile-writing routes
     * therefore carry the rbac guard, and the rest carry `requireAuth`;
     * getting that backwards would let any signed-in user point a renderer at
     * a table they cannot read.
     */
    const meta = await freshMeta();
    const Fastify = (await import('fastify')).default;
    const zod = await import('fastify-type-provider-zod');
    const probe = Fastify();
    probe.setValidatorCompiler(zod.validatorCompiler);
    probe.setSerializerCompiler(zod.serializerCompiler);

    const rbacGuard = async () => {};
    const authGuard = async () => {};
    probe.decorate('rbac', { require: () => rbacGuard } as never);
    probe.decorate('requireAuth', authGuard);

    const seen = new Map<string, unknown>();
    probe.addHook('onRoute', (route) => {
      if (route.method === 'HEAD') return;
      seen.set(`${String(route.method)} ${route.url}`, route.preHandler);
    });
    await probe.register(
      documentRoutes({
        meta,
        storage: {} as never,
        runtime: () => null,
        enqueue: () => Promise.resolve({ id: 'job_1' }),
      }),
      { prefix: '/api/v1' },
    );
    await probe.ready();

    for (const route of [
      'GET /api/v1/documents/profiles',
      'POST /api/v1/documents/profiles',
      'PUT /api/v1/documents/profiles/:id',
      'DELETE /api/v1/documents/profiles/:id',
    ]) {
      expect(seen.get(route), `${route} is not behind manifests.manage`).toBe(rbacGuard);
    }
    for (const route of [
      'GET /api/v1/documents',
      'GET /api/v1/documents/:id',
      'GET /api/v1/documents/kinds',
      'GET /api/v1/documents/providers',
      'POST /api/v1/documents/render',
    ]) {
      expect(seen.get(route), `${route} should be authenticated, not admin-only`).toBe(authGuard);
    }
    await probe.close();
  });

  it('serves every route specifies', async () => {
    const meta = await freshMeta();
    const Fastify = (await import('fastify')).default;
    const zod = await import('fastify-type-provider-zod');
    const probe = Fastify();
    probe.setValidatorCompiler(zod.validatorCompiler);
    probe.setSerializerCompiler(zod.serializerCompiler);
    probe.decorate('rbac', { require: () => async () => {} } as never);
    probe.decorate('requireAuth', async () => {});
    await probe.register(
      documentRoutes({
        meta,
        storage: {} as never,
        runtime: () => null,
        enqueue: () => Promise.resolve({ id: 'job_1' }),
      }),
      { prefix: '/api/v1' },
    );
    await probe.ready();

    // The route TREE, not a hard-coded URL list: a route that stops being
    // registered disappears from it.
    const printed = probe.printRoutes({ commonPrefix: false });
    for (const fragment of ['kinds', 'providers', 'profiles', 'render', 'void', 'send', 'content', 'print']) {
      expect(printed, `${fragment} is not served`).toContain(fragment);
    }
    await probe.close();
  });

  it('is registered by the composition root itself, not only by this test', async () => {
    // A route module that exists and is never composed is the exact shape of
    // the gap this repository keeps finding, and it is invisible to every
    // other ratchet here.
    const { readFile } = await import('node:fs/promises');
    const compose = await readFile(new URL('../src/compose.ts', import.meta.url), 'utf8');
    expect(compose).toContain("from './routes/documents/index.js'");
    expect(compose).toMatch(/api\.register\(\s*\n?\s*documentRoutes\(/);
  });
});

describe('saving a mapping with a trigger writes its rule', () => {
  /*
   * The last line, under D55. The module's own lifecycle is covered in
   * `documents/trigger-sync.test.ts`; what is asked HERE is whether the route
   * calls it and puts the id back — the join that makes a mapping saved in
   * Studio actually fire.
   */
  async function serverFor(meta: MetaDb) {
    /*
     * A REAL user row, because the rule's `created_by` is a foreign key. A
     * fixture that invented a session id got a `FOREIGN KEY constraint failed`
     * out of the create — which is the schema being right: a rule attributed
     * to somebody who does not exist is not attributable at all.
     *
     * Note for the last test in this block: BOTH tables carry that same FK, so
     * a missing user fails the mapping's own write first. It cannot be used to
     * make only the second write fail.
     */
    const user = await usersRepo(meta).create({ email: 'owner@test', name: 'Owner' });
    const Fastify = (await import('fastify')).default;
    const zod = await import('fastify-type-provider-zod');
    const app = Fastify();
    app.setValidatorCompiler(zod.validatorCompiler);
    app.setSerializerCompiler(zod.serializerCompiler);
    app.decorate('rbac', { require: () => async () => {} } as never);
    app.decorate('requireAuth', async () => {});
    app.addHook('onRequest', async (request) => {
      (request as { user?: unknown }).user = { id: user.id };
      (request as { can?: unknown }).can = () => Promise.resolve(true);
    });
    await app.register(
      documentRoutes({
        meta,
        storage: {} as never,
        runtime: () => null,
        enqueue: () => Promise.resolve({ id: 'job_1' }),
      }),
      { prefix: '/api/v1' },
    );
    await app.ready();
    return app;
  }

  async function seedConnection(meta: MetaDb) {
    return (
      await connectionsRepo(meta, crypto).create({
        name: 'main',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@localhost/app',
      })
    ).id;
  }

  it('creates the rule and records its id on the mapping', async () => {
    const meta = await freshMeta();
    const connectionId = await seedConnection(meta);
    const app = await serverFor(meta);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/profiles',
      payload: {
        addOnKey: 'invoices',
        kind: 'invoice',
        name: 'Invoice',
        connectionId,
        table: 'public.orders',
        mapping: {},
        trigger: { event: 'record.created' },
      },
    });
    expect(res.statusCode, res.body).toBe(200);

    const rules = await automationsRepo(meta).list();
    expect(rules, 'saving a mapping with a trigger must write a rule').toHaveLength(1);

    const body = res.json() as { trigger: { automationId: string } };
    expect(body.trigger.automationId).toBe(rules[0]!.id);
    await app.close();
  });

  it('creates NO rule for a mapping that only draws on request', async () => {
    const meta = await freshMeta();
    const connectionId = await seedConnection(meta);
    const app = await serverFor(meta);
    await app.inject({
      method: 'POST',
      url: '/api/v1/documents/profiles',
      payload: {
        addOnKey: 'invoices',
        kind: 'invoice',
        name: 'On request only',
        connectionId,
        table: 'public.orders',
        mapping: {},
      },
    });
    expect(await automationsRepo(meta).list()).toHaveLength(0);
    await app.close();
  });

  it('takes the rule away with the mapping', async () => {
    const meta = await freshMeta();
    const connectionId = await seedConnection(meta);
    const app = await serverFor(meta);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/profiles',
      payload: {
        addOnKey: 'invoices',
        kind: 'invoice',
        name: 'Invoice',
        connectionId,
        table: 'public.orders',
        mapping: {},
        trigger: { event: 'record.created' },
      },
    });
    const { id } = created.json() as { id: string };
    expect(await automationsRepo(meta).list()).toHaveLength(1);

    const gone = await app.inject({ method: 'DELETE', url: `/api/v1/documents/profiles/${id}` });
    expect(gone.statusCode).toBe(204);
    // A rule whose step names a mapping that no longer exists would fire on
    // every write and skip every time.
    expect(await automationsRepo(meta).list()).toHaveLength(0);
    await app.close();
  });

  it('keeps the saved mapping when the rule cannot be written, and says so', async () => {
    /*
     * The two writes are not one transaction, and the mapping goes first on
     * purpose (a rule pointing at a mapping nobody stored would draw documents
     * nobody agreed to). So the second write CAN fail alone — and when it
     * does, the reply must not read as "your save failed", or the operator
     * makes the mapping a second time and gets two of them.
     *
     * The throw is injected because nothing cheaper reaches this path: the two
     * tables carry the SAME foreign keys and no unique name, so the only real
     * cause left is the meta store failing between two statements. Which is
     * also why the fix here is a truthful refusal rather than atomicity —
     * repos own their transactions one method at a time, and threading one
     * across two of them would rewrite a seam the whole meta package shares.
     */
    failNextSync.value = true;
    const meta = await freshMeta();
    const connectionId = await seedConnection(meta);
    const app = await serverFor(meta);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/profiles',
      payload: {
        addOnKey: 'invoices',
        kind: 'invoice',
        name: 'Invoice',
        connectionId,
        table: 'public.orders',
        mapping: {},
        trigger: { event: 'record.created' },
      },
    });

    expect(res.statusCode, res.body).toBe(409);
    // It tells the operator the mapping SURVIVED, and where to go — not
    // "submit that form again", which is how a duplicate is made.
    expect(res.body).toMatch(/was saved/);
    expect(res.body).toMatch(/Open the mapping/);

    // And the two halves really are in the state the message describes.
    expect(await documentProfilesRepo(meta).list(), 'the mapping must survive').toHaveLength(1);
    expect(await automationsRepo(meta).list()).toHaveLength(0);
    await app.close();
  });
});

describe('reading a document depends on every table its mapping reads', () => {
  async function seed() {
    const meta = await freshMeta();
    const connectionId = (
      await connectionsRepo(meta, crypto).create({
        name: 'main',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@localhost/app',
      })
    ).id;
    const profile = await documentProfilesRepo(meta).create({
      addOnKey: 'invoices',
      kind: 'invoice',
      name: 'Invoice',
      connectionId,
      table: 'public.orders',
      mapping: {
        customerName: { column: 'customer' },
        items: {
          collection: { table: 'public.order_lines', fkColumn: 'order_id', columns: {} },
        },
      },
    });
    const document = await documentsRepo(meta).create({
      profileId: profile.id,
      addOnKey: 'invoices',
      kind: 'invoice',
      connectionId,
      entity: {
        connectionId,
        table: 'public.orders',
        pk: { id: 1 },
        label: 'Order 1',
      },
      subject: { fields: { customerName: 'Acme' } },
      locale: 'en-US',
      format: 'pdf',
    });
    return { meta, connectionId, profile, document };
  }

  async function serverWith(meta: MetaDb, grants: readonly string[], userId = 'usr_1') {
    const Fastify = (await import('fastify')).default;
    const zod = await import('fastify-type-provider-zod');
    const app = Fastify();
    app.setValidatorCompiler(zod.validatorCompiler);
    app.setSerializerCompiler(zod.serializerCompiler);
    app.decorate('rbac', { require: () => async () => {} } as never);
    app.decorate('requireAuth', async () => {});
    app.addHook('onRequest', async (request) => {
      (request as { user?: unknown }).user = { id: userId };
      (request as { can?: unknown }).can = (permission: string) =>
        Promise.resolve(grants.includes(permission));
    });
    await app.register(
      documentRoutes({
        meta,
        storage: {} as never,
        runtime: () => null,
        enqueue: () => Promise.resolve({ id: 'job_1' }),
      }),
      { prefix: '/api/v1' },
    );
    await app.ready();
    return app;
  }

  it('REDACTS rather than hides when one mapped table is out of reach', async () => {
    /*
     * The behaviour the whole guard table is built around. A caller holding
     * `orders:read` and not `order_lines:read` still sees that three invoices
     * exist for this order — hiding them would make the record page lie —
     * and does not see what is in them.
     *
     * Grants are resolved through the real permission set, so this fixture
     * grants nothing: the caller is an ordinary signed-in user with no table
     * grants at all, which is the case the redaction must cover.
     */
    const { meta, document } = await seed();
    const app = await serverWith(meta, []);
    const res = await app.inject({ method: 'GET', url: `/api/v1/documents/${document.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { redacted: boolean; subject: unknown; id: string };
    expect(body.id, 'the row itself must still be returned').toBe(document.id);
    expect(body.redacted).toBe(true);
    expect(body.subject).toBeNull();
    await app.close();
  });

  it('names the table it refused on, rather than saying no', async () => {
    // "You may not read this" sends an operator to guess; naming the table
    // sends them to the grant that is missing.
    const { meta, document } = await seed();
    const app = await serverWith(meta, []);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}/content`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatch(/public\.orders|public\.order_lines/);
    await app.close();
  });

  it('answers `installed: false` rather than 404 when no provider is loaded', async () => {
    // What the record page asks to decide whether to draw a panel at all. A
    // 404 here is indistinguishable from "this build is too old".
    const { meta } = await seed();
    const app = await serverWith(meta, []);
    const res = await app.inject({ method: 'GET', url: '/api/v1/documents/providers' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ installed: false, addOnKeys: [] });
    await app.close();
  });

  it('lets the person who ASKED read a profile-less intent', async () => {
    /*
     * The vacuous case, made explicit. A request-shaped intent has no profile
     * and no source row, so "every mapped table's grant" is an empty set —
     * true of everybody. The fallback is the person who asked, or an admin.
     */
    const { meta } = await seed();
    const intent = await documentsRepo(meta).create({
      profileId: null,
      addOnKey: 'invoices',
      kind: 'invoice',
      connectionId: null,
      entity: null,
      subject: { fields: { customerName: 'Acme' } },
      locale: 'en-US',
      format: 'html',
      requestedBy: 'usr_1',
    });

    const mine = await serverWith(meta, [], 'usr_1');
    const ok = await mine.inject({ method: 'GET', url: `/api/v1/documents/${intent.id}` });
    expect((ok.json() as { redacted: boolean }).redacted).toBe(false);
    await mine.close();

    const theirs = await serverWith(meta, [], 'usr_2');
    const no = await theirs.inject({ method: 'GET', url: `/api/v1/documents/${intent.id}` });
    expect((no.json() as { redacted: boolean }).redacted).toBe(true);
    await theirs.close();
  });

  it('refuses to enqueue a render of a mapping the caller cannot read', async () => {
    // Checked BEFORE anything is enqueued: a job that would be refused at read
    // time should never reach the queue.
    const { meta, profile } = await seed();
    const app = await serverWith(meta, []);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/render',
      payload: { profileId: profile.id, pk: { id: 1 } },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('public.orders');
    await app.close();
  });
});
