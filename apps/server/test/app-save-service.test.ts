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
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';

import { appSavesRepo, filesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { createSaveService, nextVersion, packManifest, type SaveRights } from '../src/apps/save/service.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { runGeneration } from '../src/generate/run.js';
import { AppError, errorEnvelope } from '../src/errors.js';
import type { FileStore } from '../src/files/store.js';
import { appSaveRoutes } from '../src/routes/apps/save.js';
import { ENGINES, installHarness, type Dialect, type Harness } from './app-install-harness.js';

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

const ALL: SaveRights = { userId: null, can: async () => true, readsWhole: async () => true };

async function serve(h: Harness, dialect: Dialect, files: FileStore) {
  const service = createSaveService({
    meta: h.meta,
    storage: files,
    masterSecret: 'a-test-master-secret-of-enough-length',
    adminiumVersion: '0.3.49',
    dialectOf: async (id) => (id === h.connectionId ? dialect : null),
    displayName: async () => 'Corner shop',
  });
  const Fastify = (await import('fastify')).default;
  const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('rbac', { require: () => async () => {} } as never);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send(errorEnvelope(error.code, error.message, 'req_test', error.details));
    return reply.status(500).send(errorEnvelope('INTERNAL', String(error), 'req_test'));
  });
  await app.register(appSaveRoutes({ meta: h.meta, service }));
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
    const readsOnly: SaveRights = { userId: null, can: async (grant) => !grant.endsWith(':export'), readsWhole: async () => true };
    await expect(service.plan(request, readsOnly)).rejects.toMatchObject({ details: { reason: 'SAVE_ROWS_NOT_YOURS' } });
    const part: SaveRights = { userId: null, can: async () => true, readsWhole: async () => false };
    await expect(service.plan(request, part)).rejects.toMatchObject({ details: { reason: 'SAVE_ROWS_NOT_YOURS' } });
    const pii: SaveRights = { userId: null, can: async (grant) => !grant.endsWith(':read_pii'), readsWhole: async () => true };
    await expect(service.plan({ ...request, answers: { personalColumns: [`${String(ordersId)}.note`] } }, pii)).rejects.toMatchObject({ details: { reason: 'SAVE_ROWS_NOT_YOURS' } });
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
    const { app } = await serve(h, 'sqlite', files);

    const planned = await app.inject({ method: 'POST', url: '/apps/save/plan', payload: { connectionId: h.connectionId, key: 'corner-shop', name: 'Corner shop' } });
    expect(planned.statusCode, planned.body).toBe(200);
    const plan = planned.json().plan as Record<string, unknown>;
    expect(Object.keys(plan).sort()).toEqual(['check', 'counts', 'key', 'label', 'lineage', 'minAdminiumVersion', 'problems', 'ready', 'version']);
    expect(plan['ready'], JSON.stringify(plan)).toBe(true);

    const saved = await app.inject({ method: 'POST', url: '/apps/save', payload: { connectionId: h.connectionId, key: 'corner-shop', name: 'Corner shop' } });
    expect(saved.statusCode, saved.body).toBe(200);
    const save = saved.json().save as { id: string; integrity: string; bytes: number; filename: string };
    expect(save).toMatchObject({ key: 'corner-shop', version: '1.0.0', filename: 'corner-shop-1.0.0.tgz' });
    expect(save.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);

    const again = await app.inject({ method: 'POST', url: '/apps/save', payload: { connectionId: h.connectionId, key: 'corner-shop', name: 'Corner shop', version: '1.0.0' } });
    expect(again.statusCode).toBe(409);

    const list = await app.inject({ method: 'GET', url: '/apps/saves' });
    expect(list.statusCode).toBe(200);
    expect(list.json().saves).toEqual([expect.objectContaining({ id: save.id, key: 'corner-shop', version: '1.0.0', connectionId: h.connectionId, label: 'Corner shop', downloadable: true, integrity: save.integrity, bytes: save.bytes })]);

    const download = await app.inject({ method: 'GET', url: `/apps/save/${save.id}/file` });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toBe('attachment; filename="corner-shop-1.0.0.tgz"');
    const bytes = download.rawPayload;
    expect(`sha512-${createHash('sha512').update(bytes).digest('base64')}`).toBe(save.integrity);
    // The copy is in the Files library, and the package holds the manifest.
    const row = (await appSavesRepo(h.meta).findById(save.id))!;
    expect(await filesRepo(h.meta).findById(row.fileId!)).toMatchObject({ kind: 'export', filename: 'corner-shop-1.0.0.tgz' });
    expect(gunzipSync(bytes).toString('latin1')).toContain('package/manifest.json');

    expect((await app.inject({ method: 'GET', url: '/apps/save/asv_missing/file' })).statusCode).toBe(404);
  });
});

describe('save as app: the version and the package', () => {
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
