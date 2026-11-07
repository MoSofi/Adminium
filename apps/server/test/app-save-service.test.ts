// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVE AS APP: the service and its routes.
 *
 * The version a save takes and refuses, the lineage it keeps, who may save
 * rows, the file's fingerprint, the copy kept for "Download again", and every
 * reply field through a real inject (the serializer drops a field the reply
 * schema does not declare).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';

import { WORD_FLOORS, type AppManifest } from '@adminium/manifest';
import { appSavesRepo, emailTemplatesRepo, filesRepo, newId, usersRepo, viewsRepo, workspacesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run.js';
import type { CliRuntime } from '../src/cli/runtime.js';
import { minimumVersion } from '../src/apps/save/convert.js';
import { createSaveService, nextVersion, packManifest, type SaveRights } from '../src/apps/save/service.js';
import { createWorkspaceSaveService } from '../src/apps/save/workspace.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { runGeneration } from '../src/generate/run.js';
import { AppError, errorEnvelope } from '../src/errors.js';
import type { FileStore } from '../src/files/store.js';
import { appSaveRoutes } from '../src/routes/apps/save.js';
import { ENGINES, installHarness, type Dialect, type Harness } from './app-install-harness.js';
import { tableId } from './app-save-source.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

/** A library that keeps the bytes in memory. */
function library(): FileStore & { kept: Map<string, Buffer> } {
  const kept = new Map<string, Buffer>();
  return {
    kept,
    write: async (input: { id: string; bytes: Buffer | string }) => {
      const bytes = Buffer.from(input.bytes);
      kept.set(input.id, bytes);
      return { storageKey: input.id, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), destinationId: null, storage: 'memory' };
    },
    read: async (file: { storageKey: string }) => Readable.from([kept.get(file.storageKey) ?? Buffer.alloc(0)]),
  } as unknown as FileStore & { kept: Map<string, Buffer> };
}

const ALL: SaveRights = { userId: null, can: async () => true, readsWhole: async () => true, permissions: async () => ({ superAdmin: true }) };

/** People the routes know by an `x-test-user` header, each with the grants they hold (`*` for every one). */
type People = Record<string, ReadonlySet<string>>;

async function serve(h: Harness, dialect: Dialect, files: FileStore, people: People = {}) {
  const service = createSaveService({
    meta: h.meta,
    storage: files,
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

async function shopTables(h: Harness): Promise<void> {
  await h.run('CREATE TABLE customers (id INTEGER PRIMARY KEY, name VARCHAR(80) NOT NULL)');
  await h.run('CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), note VARCHAR(200))');
  await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: h.connectionId });
  // The pages Adminium generates for them: an app needs at least one.
  await runGeneration({ manager: h.manager, meta: h.meta, connectionId: h.connectionId, createdBy: null });
}

describe.each(ENGINES)('save as app: the service on %s', (dialect, available) => {
  let harness: Harness | null = null;
  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  it.runIf(available)('plans a first save at 1.0.0 with a new lineage, and labels it with the deployment name', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    await shopTables(h);
    const { service } = await serve(h, dialect, library());
    const plan = await service.plan({ connectionId: h.connectionId, key: 'corner-shop', name: 'Corner shop' }, ALL);
    expect(plan).toMatchObject({ key: 'corner-shop', version: '1.0.0', lineage: 'new', label: 'Corner shop' });
  });

  it.runIf(available)('takes the next version, keeps the lineage, and refuses a saved or older version', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    await shopTables(h);
    const { service } = await serve(h, dialect, library());
    await appSavesRepo(h.meta).create({ appKey: 'corner-shop', version: '1.0.3', lineage: 'lin-corner-shop-1', connectionId: h.connectionId, label: 'Corner shop', savedBy: null, integrity: 'sha512-x', bytes: 10 });
    const plan = await service.plan({ connectionId: h.connectionId, key: 'corner-shop', name: 'Corner shop' }, ALL);
    expect(plan).toMatchObject({ version: '1.0.4', lineage: 'kept' });
    await expect(service.plan({ connectionId: h.connectionId, key: 'corner-shop', name: 'Corner shop', version: '1.0.3' }, ALL)).rejects.toMatchObject({ details: { reason: 'APP_VERSION_SAVED' } });
    await expect(service.plan({ connectionId: h.connectionId, key: 'corner-shop', name: 'Corner shop', version: '1.0.1' }, ALL)).rejects.toMatchObject({ details: { reason: 'APP_VERSION_OLDER' } });
  });

  it.runIf(available)('refuses a key another database saved', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    await shopTables(h);
    const other = await h.otherConnection('elsewhere');
    const { service } = await serve(h, dialect, library());
    await appSavesRepo(h.meta).create({ appKey: 'corner-shop', version: '1.0.0', lineage: 'lin-corner-shop-1', connectionId: other.id, label: 'Elsewhere', savedBy: null, integrity: 'sha512-x', bytes: 10 });
    await expect(service.plan({ connectionId: h.connectionId, key: 'corner-shop', name: 'Corner shop' }, ALL)).rejects.toMatchObject({ details: { reason: 'APP_KEY_SAVED_ELSEWHERE' } });
  });

  it.runIf(available)('saves rows only for a person who reads, exports and reaches the whole table', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    await shopTables(h);
    const { service } = await serve(h, dialect, library());
    const ordersId = dialect === 'mysql' ? (await h.rows('SELECT DATABASE() AS db'))[0]!['db'] + '.orders' : dialect === 'postgres' ? 'public.orders' : 'main.orders';
    const request = { connectionId: h.connectionId, key: 'corner-shop', name: 'Corner shop', rows: { [String(ordersId)]: { mode: 'starting' as const } } };
    const readsOnly: SaveRights = { userId: null, can: async (grant) => !grant.endsWith(':export'), readsWhole: async () => true, permissions: async () => ({ superAdmin: true }) };
    await expect(service.plan(request, readsOnly)).rejects.toMatchObject({ details: { reason: 'SAVE_ROWS_NOT_YOURS' } });
    const part: SaveRights = { userId: null, can: async () => true, readsWhole: async () => false, permissions: async () => ({ superAdmin: true }) };
    await expect(service.plan(request, part)).rejects.toMatchObject({ details: { reason: 'SAVE_ROWS_NOT_YOURS' } });
    const pii: SaveRights = { userId: null, can: async (grant) => !grant.endsWith(':read_pii'), readsWhole: async () => true, permissions: async () => ({ superAdmin: true }) };
    await expect(service.plan({ ...request, answers: { personalColumns: [`${String(ordersId)}.note`] } }, pii)).rejects.toMatchObject({ details: { reason: 'SAVE_ROWS_NOT_YOURS' } });

    // The file's own rows are no Files library file: saving them needs no managing files.
    await h.run(`INSERT INTO orders (id, note) VALUES (1, 'first')`);
    const noFiles: SaveRights = { userId: null, can: async (grant) => grant !== 'system:files:manage', readsWhole: async () => true, permissions: async () => ({ superAdmin: true }) };
    const saved = await service.save(request, noFiles);
    expect(saved.version).toBe('1.0.0');
    expect((await appSavesRepo(h.meta).findById(saved.id))?.carried).toMatchObject({ files: false, rows: { [String(ordersId)]: ['note'] } });
  });
});

describe.each(ENGINES)('save as app: what a database could include, on %s', (dialect, available) => {
  let harness: Harness | null = null;
  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  it.runIf(available)('lists the tables with their links, the generated pages with their tables, and what the saver may do', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    await shopTables(h);
    const { service } = await serve(h, dialect, library());
    const inventory = await service.inventory(h.connectionId, ALL);
    const byName = new Map(inventory.tables.map((table) => [table.name, table]));
    expect([...byName.keys()].sort()).toEqual(['customers', 'orders']);
    const customers = byName.get('customers')!;
    expect(byName.get('orders')!.links).toEqual([{ column: 'customer_id', to: customers.id, required: false }]);
    expect(customers).toMatchObject({ columns: 2, rowsAllowed: true, personalAllowed: true });
    expect(inventory.pages.length).toBeGreaterThan(0);
    expect(inventory.pages.every((page) => page.generated)).toBe(true);
    expect(new Set(inventory.pages.map((page) => page.tableId).filter((id) => id !== null))).toEqual(new Set([customers.id, byName.get('orders')!.id]));
    expect(inventory).toMatchObject({ views: [], roles: [], automations: [], emailTemplates: [], payments: false, instance: true });

    // A person who may not export: the structure goes, the rows may not.
    const noExport: SaveRights = { userId: null, can: async (grant) => !grant.endsWith(':export') && grant !== 'system:settings:manage', readsWhole: async () => true, permissions: async () => ({ superAdmin: true }) };
    const theirs = await service.inventory(h.connectionId, noExport);
    expect(theirs.tables.every((table) => !table.rowsAllowed)).toBe(true);
    expect(theirs.instance).toBe(false);
    await expect(service.inventory('conn_missing', ALL)).rejects.toMatchObject({ statusCode: 404 });
  });

  it.runIf(available)('shows the saver only what they may see: tables, columns, row counts and views', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    await shopTables(h);
    const { service } = await serve(h, dialect, library());
    const everything = await service.inventory(h.connectionId, ALL);
    const customers = everything.tables.find((table) => table.name === 'customers')!;
    const orders = everything.tables.find((table) => table.name === 'orders')!;
    const ordersPage = everything.pages.find((page) => page.tableId === orders.id)!;
    const customersPage = everything.pages.find((page) => page.tableId === customers.id)!;
    const me = await usersRepo(h.meta).create({ email: `me-${dialect}@corner.test`, name: 'Me', status: 'active' });
    const other = await usersRepo(h.meta).create({ email: `other-${dialect}@corner.test`, name: 'Rosa Okafor', status: 'active' });
    const views = viewsRepo(h.meta);
    await views.create({ pageId: ordersPage.id, userId: me.id, name: 'Mine', config: { v: 1 } });
    await views.create({ pageId: ordersPage.id, userId: null, name: 'Shared', config: { v: 1 } });
    await views.create({ pageId: ordersPage.id, userId: other.id, name: 'Their secret plan', config: { v: 1 } });
    await views.create({ pageId: customersPage.id, userId: null, name: 'Customers shared', config: { v: 1 } });

    // Reads orders only, sees none of its note, and reads only part of its rows.
    const rights: SaveRights = {
      userId: me.id,
      can: async (grant) => grant.startsWith(`table:${h.connectionId}:${orders.id}:`) && !grant.endsWith(':read_pii'),
      readsWhole: async () => false,
      permissions: async () => ({ readLimits: { limited: [{ grant: `table:${h.connectionId}:${orders.id}:read`, limit: { readable: ['customer_id'] } }], unlimited: new Set() } }),
    };
    const theirs = await service.inventory(h.connectionId, rights);
    expect(theirs.tables.map((table) => table.name)).toEqual(['orders']);
    expect(theirs.tables[0]).toMatchObject({ columns: 2, rows: null, rowsExact: false, rowsAllowed: false, links: [], personalAllowed: false });
    expect(JSON.stringify(theirs)).not.toContain('customers');
    expect(JSON.stringify(theirs)).not.toContain('"note"');
    expect(theirs.pages.map((page) => page.id)).toEqual([ordersPage.id]);
    expect(theirs.views.map((view) => view.name).sort()).toEqual(['Mine', 'Shared']);
    expect(theirs.views.every((view) => view.ownerId === null || view.ownerId === me.id)).toBe(true);
    expect(JSON.stringify(theirs)).not.toContain('Rosa Okafor');
    expect(JSON.stringify(theirs)).not.toContain('Their secret plan');

    // The whole table read: its estimate shows.
    const whole = await service.inventory(h.connectionId, { ...rights, readsWhole: async () => true });
    expect(whole.tables[0]!.rows).toBe(orders.rows);
  });
});

describe('save as app: the routes', () => {
  let harness: Harness | null = null;
  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  it('declares every field of the plan, the save, the list and the download', async () => {
    harness = await installHarness('sqlite');
    const h = harness;
    await shopTables(h);
    const files = library();
    const { app } = await serve(h, 'sqlite', files, { owner: new Set(['*']) });

    const planned = await app.inject({ method: 'POST', url: '/apps/save/plan', payload: { connectionId: h.connectionId, key: 'corner-shop', name: 'Corner shop' } });
    expect(planned.statusCode, planned.body).toBe(200);
    const plan = planned.json().plan as Record<string, unknown>;
    expect(Object.keys(plan).sort()).toEqual(['check', 'counts', 'key', 'label', 'lineage', 'minAdminiumVersion', 'problems', 'ready', 'version']);
    expect(plan['ready'], JSON.stringify(plan)).toBe(true);

    const saved = await app.inject({ method: 'POST', url: '/apps/save', payload: { connectionId: h.connectionId, key: 'corner-shop', name: 'Corner shop', icon: 'shopping-bag' } });
    expect(saved.statusCode, saved.body).toBe(200);
    const save = saved.json().save as { id: string; integrity: string; bytes: number; filename: string };
    expect(save).toMatchObject({ key: 'corner-shop', version: '1.0.0', filename: 'corner-shop-1.0.0.tgz' });
    expect(save.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);

    const again = await app.inject({ method: 'POST', url: '/apps/save', payload: { connectionId: h.connectionId, key: 'corner-shop', name: 'Corner shop', version: '1.0.0' } });
    expect(again.statusCode).toBe(409);

    const list = await app.inject({ method: 'GET', url: '/apps/saves' });
    expect(list.statusCode).toBe(200);
    expect(list.json().saves).toEqual([expect.objectContaining({ id: save.id, key: 'corner-shop', version: '1.0.0', connectionId: h.connectionId, label: 'Corner shop', downloadable: true, integrity: save.integrity, bytes: save.bytes })]);
    expect(Object.keys(list.json().saves[0]).sort()).toEqual(['bytes', 'connectionId', 'description', 'downloadable', 'icon', 'id', 'integrity', 'key', 'label', 'name', 'savedAt', 'savedBy', 'savedByName', 'version']);
    expect(list.json().saves[0]).toMatchObject({ name: 'Corner shop', description: null, icon: 'shopping-bag', savedBy: null, savedByName: null });

    // The inventory lists what its reader may read: one who reads every table sees them all.
    const inventory = await app.inject({ method: 'GET', url: `/apps/save/inventory?connectionId=${h.connectionId}`, headers: { 'x-test-user': 'owner' } });
    expect(inventory.statusCode, inventory.body).toBe(200);
    expect(Object.keys(inventory.json().inventory).sort()).toEqual([
      'automations', 'connectionId', 'documents', 'emailTemplates', 'instance', 'invoiceLayouts', 'pages', 'payments', 'publicEndpoints', 'reports', 'roles', 'scheduledReports', 'tables', 'views',
    ]);
    expect(Object.keys(inventory.json().inventory.tables[0]).sort()).toEqual(['columns', 'id', 'links', 'name', 'personal', 'personalAllowed', 'rows', 'rowsAllowed', 'rowsExact', 'secretLike']);

    const download = await app.inject({ method: 'GET', url: `/apps/save/${save.id}/file` });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toBe('attachment; filename="corner-shop-1.0.0.tgz"');
    const bytes = download.rawPayload;
    expect(`sha512-${createHash('sha512').update(bytes).digest('base64')}`).toBe(save.integrity);
    // The copy is in the Files library, and the package holds the manifest.
    const row = (await appSavesRepo(h.meta).findById(save.id))!;
    expect(await filesRepo(h.meta).findById(row.fileId!)).toMatchObject({ kind: 'export', filename: 'corner-shop-1.0.0.tgz' });
    expect(gunzipSync(bytes).toString('latin1')).toContain('package/manifest.json');
    // The icon is in the file, as a self-made app's own word.
    expect(gunzipSync(bytes).toString('utf8')).toContain('"icon": "shopping-bag"');
    expect((await app.inject({ method: 'POST', url: '/apps/save/plan', payload: { connectionId: h.connectionId, key: 'corner-shop', name: 'Corner shop', icon: 'Not An Icon' } })).statusCode).not.toBe(200);

    expect((await app.inject({ method: 'GET', url: '/apps/save/asv_missing/file' })).statusCode).toBe(404);
  });

  it('downloads a file again only for someone who holds every right its save needed', async () => {
    harness = await installHarness('sqlite');
    const h = harness;
    await shopTables(h);
    await h.run(`INSERT INTO customers (id, name) VALUES (1, 'Ann Customer')`);
    await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: h.connectionId });
    const customersId = await tableId(h, 'customers');
    const base = `table:${h.connectionId}:${customersId}`;
    const user = async (name: string) => (await usersRepo(h.meta).create({ email: `${name}@corner.test`, name, status: 'active' })).id;
    const [ann, bob, cy] = [await user('ann'), await user('bob'), await user('cy')];
    const people: People = {
      [ann]: new Set(['*']),
      // Manages apps, and nothing of the table.
      [bob]: new Set(['system:manifests:manage']),
      // Reads and exports the customers.
      [cy]: new Set(['system:manifests:manage', `${base}:read`, `${base}:export`]),
    };
    const { app } = await serve(h, 'sqlite', library(), people);
    const as = (who: string) => ({ 'x-test-user': who });
    const withRows = { connectionId: h.connectionId, key: 'corner-shop', name: 'Corner shop', rows: { [customersId]: { mode: 'starting' } } };

    // Bob may not make it.
    expect((await app.inject({ method: 'POST', url: '/apps/save', headers: as(bob), payload: withRows })).statusCode).toBe(409);
    const saved = await app.inject({ method: 'POST', url: '/apps/save', headers: as(ann), payload: withRows });
    expect(saved.statusCode, saved.body).toBe(200);
    const id = (saved.json().save as { id: string }).id;
    expect((await appSavesRepo(h.meta).findById(id))?.carried).toEqual({ rows: { [customersId]: ['name'] }, personal: [], files: false, instance: false });

    // Nor download it again: it carries rows he may not read.
    const refused = await app.inject({ method: 'GET', url: `/apps/save/${id}/file`, headers: as(bob) });
    expect(refused.statusCode, refused.body).toBe(403);
    expect(refused.json().error.details).toMatchObject({ reason: 'SAVE_DOWNLOAD_NOT_YOURS' });
    const listed = (who: string) => app.inject({ method: 'GET', url: '/apps/saves', headers: as(who) }).then((reply) => (reply.json().saves as { id: string; downloadable: boolean }[]).find((one) => one.id === id)?.downloadable);
    expect(await listed(bob)).toBe(false);
    // Cy reads and exports the table: the same rights the save needed.
    expect((await app.inject({ method: 'GET', url: `/apps/save/${id}/file`, headers: as(cy) })).statusCode).toBe(200);
    expect(await listed(cy)).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/apps/save/${id}/file`, headers: as(ann) })).statusCode).toBe(200);

    // A save from before the record was kept is its saver's alone.
    await appSavesRepo(h.meta).create({ appKey: 'older-shop', version: '1.0.0', lineage: 'lin-older-shop-1', connectionId: h.connectionId, label: 'Corner shop', savedBy: ann, integrity: 'sha512-x', bytes: 1, fileId: (await appSavesRepo(h.meta).findById(id))!.fileId });
    const older = (await appSavesRepo(h.meta).listForKey('older-shop'))[0]!.id;
    expect((await app.inject({ method: 'GET', url: `/apps/save/${older}/file`, headers: as(cy) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/apps/save/${older}/file`, headers: as(ann) })).statusCode).toBe(200);

    // The workspace file asks the same of each app inside.
    const workspace = await workspacesRepo(h.meta).create({ name: 'Corner', connectionIds: [h.connectionId] });
    const whole = await app.inject({ method: 'POST', url: `/workspaces/${workspace.id}/save`, headers: as(ann), payload: { apps: [{ ...withRows, key: 'corner-whole' }] } });
    expect(whole.statusCode, whole.body).toBe(200);
    const wholeId = (whole.json().save as { id: string }).id;
    expect((await app.inject({ method: 'GET', url: `/workspaces/save/${wholeId}/file`, headers: as(bob) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/workspaces/save/${wholeId}/file`, headers: as(cy) })).statusCode).toBe(200);
  });

  it('asks managing files only when a Files library file travels, and asks it again of whoever downloads it', async () => {
    harness = await installHarness('sqlite');
    const h = harness;
    await shopTables(h);
    const files = library();
    const fileId = newId('file');
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
    const stored = await files.write({ id: fileId, kind: 'upload', filename: 'terms.pdf', mime: 'application/pdf', bytes: pdf });
    await filesRepo(h.meta).create({ id: fileId, filename: 'terms.pdf', mime: 'application/pdf', sizeBytes: pdf.length, sha256: stored.sha256, storageKey: stored.storageKey, storage: 'memory', destinationId: null, kind: 'upload', attachedAt: Date.now() });
    await emailTemplatesRepo(h.meta).upsert('news', 'en_US', {
      name: 'News',
      subject: 'News from the shop',
      blocks: [{ id: 'text-1', block: 'email.text', data: { text: 'Hello' }, style: {} }],
      enabled: true,
      kind: 'campaign',
      category: 'marketing',
      attachments: [{ id: 'att-terms', kind: 'file', fileId }],
    });
    const user = async (name: string) => (await usersRepo(h.meta).create({ email: `${name}@corner.test`, name, status: 'active' })).id;
    const [ann, dee] = [await user('ann'), await user('dee')];
    const { app } = await serve(h, 'sqlite', files, { [ann]: new Set(['*']), [dee]: new Set(['system:manifests:manage']) });
    const payload = { connectionId: h.connectionId, key: 'corner-news', name: 'Corner news', include: { emailTemplates: ['news'] } };

    const refused = await app.inject({ method: 'POST', url: '/apps/save', headers: { 'x-test-user': dee }, payload });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error.details).toMatchObject({ reason: 'SAVE_FILES_NOT_YOURS' });
    const saved = await app.inject({ method: 'POST', url: '/apps/save', headers: { 'x-test-user': ann }, payload });
    expect(saved.statusCode, saved.body).toBe(200);
    const id = (saved.json().save as { id: string }).id;
    expect((await appSavesRepo(h.meta).findById(id))?.carried).toEqual({ rows: {}, personal: [], files: true, instance: false });
    expect((await app.inject({ method: 'GET', url: `/apps/save/${id}/file`, headers: { 'x-test-user': dee } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/apps/save/${id}/file`, headers: { 'x-test-user': ann } })).statusCode).toBe(200);
  });
});

describe('save as app: the version and the package', () => {
  it('stamps the minimum Adminium at the file\'s word floors, and at the running version for a page\'s own config', () => {
    const page = { ref: 'orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'records', icon: 'list', order: 1 } };
    const plain = { pages: [page] } as unknown as AppManifest;
    const arranged = { pages: [{ ...page, envelope: { v: 1, kind: 'page', template: 'page-crud', config: {} } }], provenance: { lineage: 'l', savedAt: 'x', adminiumVersion: '0.3.48', label: 'x' } } as unknown as AppManifest;
    expect(minimumVersion(plain, '0.4.0')).toBe('0.0.0');
    // A build running below the floor of the words it writes still stamps the floor.
    expect(minimumVersion(arranged, '0.3.48')).toBe(WORD_FLOORS['page.envelope']);
    expect(minimumVersion(arranged, '0.4.0')).toBe('0.4.0');
  });

  it('numbers versions from 1.0.0, then the patch after the highest', () => {
    expect(nextVersion([])).toBe('1.0.0');
    expect(nextVersion([{ version: '1.0.9' }, { version: '1.0.10' }, { version: '1.0.2' }])).toBe('1.0.11');
  });

  it('packs the same manifest and files into the same bytes', async () => {
    const files = new Map([['seeds/orders.json', new TextEncoder().encode('{"rows":[]}')]]);
    const a = await packManifest({ key: 'x' }, files);
    const b = await packManifest({ key: 'x' }, files);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    await expect(packManifest({ key: 'x' }, new Map([['../escape', new Uint8Array(1)]]))).rejects.toThrow(/outside the package/);
  });
});

describe('save as app: the command', () => {
  let harness: Harness | null = null;
  let dir: string | null = null;
  afterEach(async () => {
    await harness?.close();
    harness = null;
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('prints the plan, writes nothing with --plan, then writes the file and its fingerprint', async () => {
    harness = await installHarness('sqlite');
    const h = harness;
    await shopTables(h);
    dir = mkdtempSync(join(tmpdir(), 'app-save-cli-'));
    const runtime = { metaStore: { meta: h.meta }, close: async () => {} } as unknown as CliRuntime;
    const deps = fakeDeps({ cwd: dir, runtime });

    const planned = fakeIo();
    expect(await runCli(['app', 'save', '--connection', h.connectionId, '--key', 'corner-shop', '--plan'], { io: planned, deps })).toBe(0);
    expect(planned.stdout()).toContain('corner-shop 1.0.0 (first save)');
    expect(existsSync(join(dir, 'corner-shop-1.0.0.tgz'))).toBe(false);
    expect(await appSavesRepo(h.meta).listForKey('corner-shop')).toEqual([]);

    const io = fakeIo();
    expect(await runCli(['app', 'save', '--connection', h.connectionId, '--key', 'corner-shop'], { io, deps }), io.stderr()).toBe(0);
    const bytes = readFileSync(join(dir, 'corner-shop-1.0.0.tgz'));
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    expect(io.stdout()).toContain(`Fingerprint: ${integrity}`);
    const [save] = await appSavesRepo(h.meta).listForKey('corner-shop');
    // Recorded for the next version and the lineage, with no copy kept: the command wrote the file itself.
    expect(save).toMatchObject({ version: '1.0.0', integrity, fileId: null });
  });

  it('asks for --connection and --key', async () => {
    const io = fakeIo();
    expect(await runCli(['app', 'save', '--key', 'x'], { io, deps: fakeDeps({}) })).not.toBe(0);
    expect(io.stderr()).toContain('--connection and --key');
  });
});
