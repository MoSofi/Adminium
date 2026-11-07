// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVE AS APP AS A PERSON: WHAT THE SAVER REACHES, AND NOTHING MORE.
 *
 *  - another person's own view never travels and is never named, so it
 *    never holds a save up;
 *  - a table the saver does not read never travels: asked for, the save is
 *    refused; left to the default, only the tables they read go in, with
 *    their pages and public endpoints; the inventory never names it, an
 *    endpoint's address included;
 *  - only the saver's own views may be made shared views of the app;
 *  - a save whose record of what it carried cannot be read is downloaded
 *    again by nobody, and never takes the saves list down;
 *  - a workspace file says, per caller, whether "Download again" packs it.
 *
 * Every person here is a staff member without table rights of their own
 * beyond those named: never an admin who reads everything.
 */
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { appSavesRepo, publicEndpointsRepo, usersRepo, viewsRepo, workspacesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { createSaveService, missingRight, type SaveRights } from '../src/apps/save/service.js';
import { tableOfEnvelope } from '../src/apps/save/inventory.js';
import { createWorkspaceSaveService } from '../src/apps/save/workspace.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { runGeneration } from '../src/generate/run.js';
import { AppError, errorEnvelope } from '../src/errors.js';
import type { FileStore } from '../src/files/store.js';
import { appSaveRoutes } from '../src/routes/apps/save.js';
import { ENGINES, installHarness, type Dialect, type Harness } from './app-install-harness.js';
import { tableId } from './app-save-source.js';

function library(): FileStore {
  const kept = new Map<string, Buffer>();
  return {
    write: async (input: { id: string; bytes: Buffer | string }) => {
      const bytes = Buffer.from(input.bytes);
      kept.set(input.id, bytes);
      return { storageKey: input.id, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), destinationId: null, storage: 'memory' };
    },
    read: async (file: { storageKey: string }) => Readable.from([kept.get(file.storageKey) ?? Buffer.alloc(0)]),
  } as unknown as FileStore;
}

type People = Record<string, ReadonlySet<string>>;

async function serve(h: Harness, dialect: Dialect, people: People) {
  const service = createSaveService({
    meta: h.meta,
    storage: library(),
    masterSecret: 'a-test-master-secret-of-enough-length',
    adminiumVersion: '0.3.49',
    dialectOf: async (id) => (id === h.connectionId ? dialect : null),
    displayName: async () => 'Corner shop',
    dataDb: async (connectionId) => (await h.manager.data(connectionId)).db,
  });
  const Fastify = (await import('fastify')).default;
  const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('rbac', { require: () => async () => {} } as never);
  app.addHook('onRequest', async (request) => {
    const who = request.headers['x-test-user'];
    const grants = typeof who === 'string' ? people[who] : undefined;
    if (grants === undefined) return;
    Object.assign(request, { user: { id: who, name: who, email: `${String(who)}@corner.test` }, can: async (grant: string) => grants.has('*') || grants.has(grant) });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send(errorEnvelope(error.code, error.message, 'req_test', error.details));
    return reply.status(500).send(errorEnvelope('INTERNAL', String(error), 'req_test'));
  });
  const workspaces = createWorkspaceSaveService({ meta: h.meta, save: service, adminiumVersion: '0.3.49', masterSecret: 'a-test-master-secret-of-enough-length', dialectOf: async (id) => (id === h.connectionId ? dialect : null), displayName: async () => 'Corner shop' });
  await app.register(appSaveRoutes({ meta: h.meta, service, workspaces }));
  await app.ready();
  return { service, app };
}

/** A clerks' table no manager of apps reads, a till table, and the pages Adminium makes for them. */
async function shop(h: Harness): Promise<{ wages: string; orders: string; ordersPage: string; wagesPage: string }> {
  await h.run('CREATE TABLE wages (id INTEGER PRIMARY KEY, person VARCHAR(80) NOT NULL, amount INTEGER)');
  await h.run('CREATE TABLE orders (id INTEGER PRIMARY KEY, wage_id INTEGER REFERENCES wages(id), note VARCHAR(200))');
  await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: h.connectionId });
  await runGeneration({ manager: h.manager, meta: h.meta, connectionId: h.connectionId, createdBy: null });
  const wages = await tableId(h, 'wages');
  const orders = await tableId(h, 'orders');
  const pages = await h.meta.db.selectFrom('adminium_pages').select(['id', 'config']).where('connectionId', '=', h.connectionId).execute();
  const pageOf = (table: string) => pages.find((page) => tableOfEnvelope(typeof page.config === 'string' ? JSON.parse(page.config) : page.config) === table)!.id;
  return { wages, orders, ordersPage: pageOf(orders), wagesPage: pageOf(wages) };
}

const as = (who: string) => ({ 'x-test-user': who });

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`save as app as a person [${dialect}]`, () => {
    let harness: Harness | null = null;
    afterEach(async () => {
      await harness?.close();
      harness = null;
    });

    it('never holds a save up on another person\'s view, and never names it', async () => {
      harness = await installHarness(dialect);
      const h = harness;
      const { ordersPage } = await shop(h);
      const user = async (name: string) => (await usersRepo(h.meta).create({ email: `${name}-${dialect}@corner.test`, name, status: 'active' })).id;
      const [owner, clerk] = [await user('owner'), await user('June Clerk')];
      const views = viewsRepo(h.meta);
      const mine = await views.create({ pageId: ordersPage, userId: owner, name: 'Mine', config: { v: 1 } });
      const theirs = await views.create({ pageId: ordersPage, userId: clerk, name: 'My open orders', config: { v: 1, filters: [{ column: 'note', op: 'eq', value: 'June only' }] } });
      const { app } = await serve(h, dialect, { [owner]: new Set(['*']) });
      const body = { connectionId: h.connectionId, key: 'corner-shop', name: 'Corner shop', answers: { shareViews: [mine.id] } };

      const planned = await app.inject({ method: 'POST', url: '/apps/save/plan', headers: as(owner), payload: body });
      expect(planned.statusCode, planned.body).toBe(200);
      expect(planned.json().plan.ready, planned.body).toBe(true);
      expect(planned.body).not.toContain('My open orders');
      expect(planned.body).not.toContain('June');

      const saved = await app.inject({ method: 'POST', url: '/apps/save', headers: as(owner), payload: body });
      expect(saved.statusCode, saved.body).toBe(200);
      const file = await app.inject({ method: 'GET', url: `/apps/save/${String(saved.json().save.id)}/file`, headers: as(owner) });
      const { gunzipSync } = await import('node:zlib');
      const text = gunzipSync(file.rawPayload).toString('utf8');
      expect(text).toContain('"Mine"');
      expect(text).not.toContain('My open orders');
      expect(text).not.toContain('June only');

      // Nor may their view be made one of the app by its id.
      const shared = await app.inject({ method: 'POST', url: '/apps/save/plan', headers: as(owner), payload: { ...body, answers: { shareViews: [theirs.id] } } });
      expect(shared.statusCode, shared.body).toBe(409);
      expect(shared.json().error.details).toMatchObject({ reason: 'SAVE_VIEW_NOT_YOURS' });
      expect(shared.body).not.toContain('My open orders');
    });

    it('carries only the tables a manager of apps reads, and refuses one they ask for and do not read', async () => {
      harness = await installHarness(dialect);
      const h = harness;
      const { wages, orders, wagesPage } = await shop(h);
      await publicEndpointsRepo(h.meta).create({
        connectionId: h.connectionId,
        ref: 'staff_wages',
        origin: 'custom',
        definition: JSON.stringify({ path: '/staff_wages', source: wages, filters: [], pagination: { default_limit: 20, max_limit: 100, order: 'id.asc' }, rate_limit: { requests: 30, window: '1m' }, response: { shape: 'object', envelope: 'data' }, methods: ['GET'], select: ['id'], auth: { role: 'anon' } }),
      });
      const manager = (await usersRepo(h.meta).create({ email: `manager-${dialect}@corner.test`, name: 'Manager', status: 'active' })).id;
      const { app } = await serve(h, dialect, { [manager]: new Set(['system:manifests:manage', `table:${h.connectionId}:${orders}:read`]) });
      const base = { connectionId: h.connectionId, key: 'corner-shop', name: 'Corner shop' };

      // The inventory never names the unread table, its page or its endpoint's address.
      const inventory = await app.inject({ method: 'GET', url: `/apps/save/inventory?connectionId=${h.connectionId}`, headers: as(manager) });
      expect(inventory.statusCode, inventory.body).toBe(200);
      expect(inventory.body).not.toContain('wages');
      expect(inventory.json().inventory.publicEndpoints).toEqual([]);

      // Left to the default: only orders goes in, and nothing names wages.
      const planned = await app.inject({ method: 'POST', url: '/apps/save/plan', headers: as(manager), payload: base });
      expect(planned.statusCode, planned.body).toBe(200);
      expect(planned.json().plan.counts.tables).toBe(1);
      expect(planned.json().plan.counts.pages).toBe(1);
      expect(planned.body).not.toContain('wages');
      const saved = await app.inject({ method: 'POST', url: '/apps/save', headers: as(manager), payload: base });
      expect(saved.statusCode, saved.body).toBe(200);
      const file = await app.inject({ method: 'GET', url: `/apps/save/${String(saved.json().save.id)}/file`, headers: as(manager) });
      const { gunzipSync } = await import('node:zlib');
      expect(gunzipSync(file.rawPayload).toString('utf8')).not.toContain('wages');

      // Asked for by id, the table, its page or its endpoint: refused.
      for (const include of [{ tables: [wages, orders] }, { pages: [wagesPage] }, { publicEndpoints: (await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).map((one) => one.id) }]) {
        const refused = await app.inject({ method: 'POST', url: '/apps/save/plan', headers: as(manager), payload: { ...base, include } });
        expect(refused.statusCode, JSON.stringify(include)).toBe(409);
        expect(refused.json().error.details).toMatchObject({ reason: 'SAVE_TABLE_NOT_YOURS' });
        expect(refused.body).not.toContain('wages');
        const made = await app.inject({ method: 'POST', url: '/apps/save', headers: as(manager), payload: { ...base, version: '2.0.0', include } });
        expect(made.statusCode).toBe(409);
      }
    });

    it('downloads a save whose record cannot be read for nobody, and still lists every save', async () => {
      harness = await installHarness(dialect);
      const h = harness;
      const { orders } = await shop(h);
      await h.run(`INSERT INTO orders (id, wage_id, note) VALUES (1, NULL, 'Two loaves')`);
      const owner = (await usersRepo(h.meta).create({ email: `o-${dialect}@corner.test`, name: 'Owner', status: 'active' })).id;
      const cy = (await usersRepo(h.meta).create({ email: `cy-${dialect}@corner.test`, name: 'Cy', status: 'active' })).id;
      const base = `table:${h.connectionId}:${orders}`;
      const { app } = await serve(h, dialect, { [owner]: new Set(['*']), [cy]: new Set(['system:manifests:manage', `${base}:read`]) });
      const saved = await app.inject({ method: 'POST', url: '/apps/save', headers: as(owner), payload: { connectionId: h.connectionId, key: 'corner-shop', name: 'Corner shop' } });
      expect(saved.statusCode, saved.body).toBe(200);
      const good = saved.json().save.id as string;
      const fileId = (await appSavesRepo(h.meta).findById(good))!.fileId;
      await h.meta.db
        .insertInto('adminium_app_saves')
        .values({ id: 'asv_damaged', appKey: 'corner-shop', version: '1.0.1', lineage: 'l', connectionId: h.connectionId, label: 'Corner shop', savedBy: owner, savedAt: Date.now() + 1000, integrity: 'sha512-x', bytes: 1, fileId, carried: JSON.stringify({ rows: 'all of them' }) } as never)
        .execute();

      const listed = await app.inject({ method: 'GET', url: '/apps/saves', headers: as(owner) });
      expect(listed.statusCode, listed.body).toBe(200);
      const downloadable = Object.fromEntries((listed.json().saves as { id: string; downloadable: boolean }[]).map((one) => [one.id, one.downloadable]));
      expect(downloadable).toEqual({ asv_damaged: false, [good]: true });
      // Its own saver included: nobody can say what it carries.
      const refused = await app.inject({ method: 'GET', url: '/apps/save/asv_damaged/file', headers: as(owner) });
      expect(refused.statusCode).toBe(403);
      expect(refused.json().error.details).toMatchObject({ reason: 'SAVE_DOWNLOAD_NOT_YOURS' });
      const all: SaveRights = { userId: owner, can: async () => true, readsWhole: async () => true, permissions: async () => ({ superAdmin: true }) };
      expect(await missingRight({ connectionId: h.connectionId, savedBy: owner, carried: 'unknown' }, all)).toMatch(/cannot read what it carries/);

      // A workspace file says per caller whether it can be packed again.
      const workspace = await workspacesRepo(h.meta).create({ name: 'Corner', connectionIds: [h.connectionId] });
      const withRows = { connectionId: h.connectionId, key: 'corner-whole', name: 'Corner whole', rows: { [orders]: { mode: 'starting' } } };
      const whole = await app.inject({ method: 'POST', url: `/workspaces/${workspace.id}/save`, headers: as(owner), payload: { apps: [withRows] } });
      expect(whole.statusCode, whole.body).toBe(200);
      const wholeId = whole.json().save.id as string;
      const workspaceRow = async (who: string) => ((await app.inject({ method: 'GET', url: '/apps/saves', headers: as(who) })).json().workspaces as { id: string; downloadable: boolean }[]).find((one) => one.id === wholeId);
      expect(await workspaceRow(owner)).toMatchObject({ downloadable: true });
      // Cy reads orders but does not export it: the rows inside are not hers to take.
      expect(await workspaceRow(cy)).toMatchObject({ downloadable: false });
      expect((await app.inject({ method: 'GET', url: `/workspaces/save/${wholeId}/file`, headers: as(cy) })).statusCode).toBe(403);
    });
  });
}
