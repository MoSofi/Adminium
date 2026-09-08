// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Storage-destination routes and the migrate job (37-files-and-storage.md
 * Appendix C, D16, D20, 37-T12).
 *
 * Two behaviours carry most of the weight here and both are easy to get wrong
 * in a way no type catches: the secret must never come back out, and a
 * destination that still holds files must refuse to be deleted with a COUNT
 * rather than with a constraint violation.
 *
 * The migrate job is exercised against two real drivers (this server's disk →
 * an in-process S3 stub), not a mock, because its correctness is entirely
 * about the ORDER of copy / verify / flip / delete — and a mocked driver would
 * happily agree with whatever order the code chose.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import {
  createSqliteMetaDb,
  destinationsRepo,
  filesRepo,
  firstRun,
  jobsRepo,
  newId,
  permissionsRepo,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type User,
} from '@adminium/meta';

import { rbacPlugin } from '../src/plugins/rbac.js';
import { createDestinationResolver } from '../src/files/destinations.js';
import { FILES_DIR } from '../src/files/drivers/local.js';
import { createSpool } from '../src/files/spool.js';
import { createFileStore, type FileStore } from '../src/files/store.js';
import { createJobRegistry, type JobRegistry } from '../src/jobs/registry.js';
import { FILES_MIGRATE_KIND, registerFilesMigrateHandler } from '../src/jobs/files-migrate.js';
import { storageRoutes } from '../src/routes/storage/index.js';
import { TEST_STORAGE_CRYPTO } from './helpers/file-store.js';
import { startS3Stub, type S3Stub } from './helpers/s3-stub.js';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200, 0x20)]);

describe('storage routes', () => {
  let meta: MetaDb;
  let app: FastifyInstance;
  let dataDir: string;
  let stub: S3Stub;
  let storage: FileStore;
  let registry: JobRegistry;
  let admin: User;
  let plain: User;

  const asUser = (user: User) => ({ 'x-test-user-id': user.id });

  const s3Config = () => ({
    endpoint: stub.endpoint,
    region: 'us-east-1',
    bucket: stub.bucket,
    prefix: 'adminium',
    forcePathStyle: true,
  });
  const s3Secret = { accessKeyId: 'minioadmin', secretAccessKey: 'a-very-secret-key' };

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    dataDir = await mkdtemp(join(tmpdir(), 'adminium-storage-routes-'));
    stub = await startS3Stub();

    const users = usersRepo(meta);
    const roles = rolesRepo(meta);
    const superAdminRole = await roles.findBySlug('super-admin');
    const viewerRole = await roles.findBySlug('viewer');
    if (superAdminRole === null || viewerRole === null) throw new Error('missing built-in roles');
    admin = await users.create({ email: 'ava@adminium.test', name: 'Ava', status: 'active' });
    plain = await users.create({ email: 'noah@adminium.test', name: 'Noah', status: 'active' });
    await roles.assignToUser(admin.id, superAdminRole.id);
    await roles.assignToUser(plain.id, viewerRole.id);

    const resolver = createDestinationResolver({
      repo: destinationsRepo(meta, TEST_STORAGE_CRYPTO),
      localRoot: resolve(dataDir, FILES_DIR),
    });
    storage = createFileStore({
      spool: createSpool({ dataDir }),
      destinations: resolver,
      files: filesRepo(meta),
    });
    registry = createJobRegistry();
    registerFilesMigrateHandler(registry, { meta, storage, storageCrypto: TEST_STORAGE_CRYPTO });

    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id !== 'string') return;
      const user = await users.findById(id);
      if (user !== null) {
        (request as unknown as { user: { id: string; name: string; email: string } }).user = {
          id: user.id,
          name: user.name,
          email: user.email,
        };
      }
    });
    await app.register(rbacPlugin, { meta });
    await app.register(
      async (api) => {
        await api.register(
          storageRoutes({
            meta,
            storageCrypto: TEST_STORAGE_CRYPTO,
            destinations: resolver,
            enqueue: (input) => jobsRepo(meta).enqueue(input),
          }),
        );
      },
      { prefix: '/api/v1' },
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await stub.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  async function create(over: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/storage/destinations',
      headers: asUser(admin),
      payload: { name: 'Spaces', driver: 's3', config: s3Config(), secret: s3Secret, ...over },
    });
  }

  it('requires storage.manage for the whole group', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/storage/destinations', headers: asUser(plain) });
    expect(res.statusCode).toBe(403);
  });

  it('creates a destination and never hands the secret back', async () => {
    const created = await create();
    expect(created.statusCode).toBe(201);
    expect(created.json().data.hasSecret).toBe(true);
    expect(created.payload).not.toContain('a-very-secret-key');

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/storage/destinations',
      headers: asUser(admin),
    });
    expect(listed.payload).not.toContain('a-very-secret-key');
    expect(listed.json().data[0].fileCount).toBe(0);
  });

  it('refuses an s3 destination with no credential', async () => {
    const res = await create({ secret: undefined });
    expect(res.statusCode).toBe(422);
    expect(res.payload).toContain('access key');
  });

  it('keeps the stored secret when a PATCH does not send one', async () => {
    const id = (await create()).json().data.id as string;
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/storage/destinations/${id}`,
      headers: asUser(admin),
      payload: { name: 'Spaces (nyc3)' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().data.name).toBe('Spaces (nyc3)');
    expect(renamed.json().data.hasSecret).toBe(true);
    // The credential still opens the bucket — proved by a probe, not by a field.
    const tested = await app.inject({
      method: 'POST',
      url: `/api/v1/storage/destinations/${id}/test`,
      headers: asUser(admin),
    });
    expect(tested.json().data.ok).toBe(true);
  });

  it('records a probe verdict and answers 200 even when it fails', async () => {
    const id = (
      await create({ name: 'Broken', config: { ...s3Config(), endpoint: 'http://127.0.0.1:1' } })
    ).json().data.id as string;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/storage/destinations/${id}/test`,
      headers: asUser(admin),
    });
    // A failure is a successful ANSWER — a 4xx would route the provider's own
    // message through an error boundary that discards it.
    expect(res.statusCode).toBe(200);
    expect(res.json().data.ok).toBe(false);
    expect(typeof res.json().data.error).toBe('string');

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/storage/destinations',
      headers: asUser(admin),
    });
    expect(after.json().data[0].status).toBe('error');
    expect(after.json().data[0].lastError).toBe(res.json().data.error);
  });

  it('tests a DRAFT before it has ever been saved', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/storage/destinations/test',
      headers: asUser(admin),
      payload: { driver: 's3', config: s3Config(), secret: s3Secret },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.ok).toBe(true);
    // Nothing was stored: the point is finding out BEFORE saving credentials.
    expect(await destinationsRepo(meta, TEST_STORAGE_CRYPTO).isEmpty()).toBe(true);
  });

  it('sets a default and refuses to make a disabled one the default', async () => {
    const id = (await create()).json().data.id as string;
    const promoted = await app.inject({
      method: 'POST',
      url: `/api/v1/storage/destinations/${id}/default`,
      headers: asUser(admin),
    });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json().data.isDefault).toBe(true);

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/storage/destinations/${id}`,
      headers: asUser(admin),
      payload: { disabled: true },
    });
    const refused = await app.inject({
      method: 'POST',
      url: `/api/v1/storage/destinations/${id}/default`,
      headers: asUser(admin),
    });
    expect(refused.statusCode).toBe(409);
  });

  it('refuses to delete a destination that still holds files, naming the count', async () => {
    const id = (await create()).json().data.id as string;
    for (const name of ['a.pdf', 'b.pdf']) {
      await storage.write({ id: newId('file'), kind: 'upload', filename: name, mime: 'application/pdf', bytes: PDF, destinationId: id });
      await filesRepo(meta).create({
        filename: name,
        mime: 'application/pdf',
        sizeBytes: PDF.byteLength,
        sha256: 'a'.repeat(64),
        kind: 'upload',
        destinationId: id,
      });
    }

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/storage/destinations/${id}`,
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(409);
    expect(res.payload).toContain('2 file(s)');
  });

  it('deletes an empty destination', async () => {
    const id = (await create()).json().data.id as string;
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/storage/destinations/${id}`,
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(200);
    expect(await destinationsRepo(meta, TEST_STORAGE_CRYPTO).isEmpty()).toBe(true);
  });

  describe('migrate', () => {
    /** Drive the job the way the worker does: claim → parse → run. */
    async function runMigrate(jobId: string): Promise<{ moved: number; failed: number; publicRefsAffected: number }> {
      const jobs = jobsRepo(meta);
      const claimed = await jobs.claim('test-worker');
      if (claimed === null || claimed.id !== jobId) throw new Error('the migrate job was not claimable');
      const entry = registry.get(FILES_MIGRATE_KIND);
      if (entry === undefined) throw new Error('files.migrate is not registered');
      const result = (await entry.run(entry.schema.parse(claimed.payload), {
        jobId: claimed.id,
        kind: claimed.kind,
        attempt: 1,
        maxAttempts: 3,
        signal: new AbortController().signal,
        progress: () => undefined,
        log: () => undefined,
      })) as { moved: number; failed: number; publicRefsAffected: number };
      await jobs.complete(claimed.id);
      return result;
    }

    it('moves every file, verifies it, and leaves the source empty', async () => {
      const id = (await create({ config: { ...s3Config(), publicBaseUrl: 'https://cdn.example.com/files' } })).json()
        .data.id as string;

      // Five files on this server's disk, written through the real store.
      const written = [];
      for (let i = 0; i < 5; i += 1) {
        const fileId = newId('file');
        const bytes = Buffer.concat([PDF, Buffer.from(String(i))]);
        const stored = await storage.write({ id: fileId, kind: 'upload', filename: `f${String(i)}.pdf`, mime: 'application/pdf', bytes });
        written.push(
          await filesRepo(meta).create({
            id: fileId,
            filename: `f${String(i)}.pdf`,
            mime: 'application/pdf',
            sizeBytes: stored.sizeBytes,
            sha256: stored.sha256,
            kind: 'upload',
            storageKey: stored.storageKey,
            destinationId: null,
          }),
        );
      }
      expect(await readdir(resolve(dataDir, FILES_DIR))).toHaveLength(5);

      const started = await app.inject({
        method: 'POST',
        url: '/api/v1/storage/migrate',
        headers: asUser(admin),
        payload: { from: null, to: id },
      });
      expect(started.statusCode).toBe(202);

      const result = await runMigrate(started.json().data.jobId as string);
      expect(result).toMatchObject({ failed: 0 });
      expect(result.moved).toBe(5);
      // The counter is about the SOURCE, not the target: a reference minted
      // from a destination's `publicBaseUrl` keeps pointing at that base after
      // its object has moved away, and the job cannot rewrite values inside a
      // customer's table (D20). This move came OFF the local disk, which
      // publishes no base, so nothing is stranded and the count is zero.
      expect(result.publicRefsAffected).toBe(0);

      // Rows flipped, bytes in the bucket, source disk empty.
      for (const file of written) {
        const after = await filesRepo(meta).findById(file.id);
        expect(after?.destinationId).toBe(id);
        expect(after?.storage).toBe('s3');
        expect(stub.objects.has(after?.storageKey ?? '')).toBe(true);
      }
      expect(await readdir(resolve(dataDir, FILES_DIR))).toEqual([]);

      // …and the bytes still read back through the seam.
      const chunks: Buffer[] = [];
      const moved = await filesRepo(meta).findById(written[0]!.id);
      for await (const chunk of await storage.read(moved!)) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks)).toEqual(Buffer.concat([PDF, Buffer.from('0')]));
    });

    it('counts the references a move off a PUBLIC destination strands', async () => {
      const published = (
        await create({ name: 'CDN', config: { ...s3Config(), publicBaseUrl: 'https://cdn.example.com/files' } })
      ).json().data.id as string;
      const plainLocal = null;

      const fileId = newId('file');
      const stored = await storage.write({
        id: fileId,
        kind: 'upload',
        filename: 'poster.pdf',
        mime: 'application/pdf',
        bytes: PDF,
        destinationId: published,
      });
      await filesRepo(meta).create({
        id: fileId,
        filename: 'poster.pdf',
        mime: 'application/pdf',
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        kind: 'upload',
        storageKey: stored.storageKey,
        destinationId: published,
      });

      const started = await app.inject({
        method: 'POST',
        url: '/api/v1/storage/migrate',
        headers: asUser(admin),
        payload: { from: published, to: plainLocal },
      });
      expect(started.statusCode).toBe(202);
      const result = await runMigrate(started.json().data.jobId as string);

      expect(result.moved).toBe(1);
      // THIS is the case the counter exists for: a `https://cdn.example.com/…`
      // value sitting in a customer's column now names an object that is no
      // longer there, and the job will not rewrite the customer's table.
      expect(result.publicRefsAffected).toBe(1);
      expect((await filesRepo(meta).findById(fileId))?.destinationId).toBeNull();
    });

    it('refuses a migrate with nothing to move, and one to the same place', async () => {
      const id = (await create()).json().data.id as string;
      const empty = await app.inject({
        method: 'POST',
        url: '/api/v1/storage/migrate',
        headers: asUser(admin),
        payload: { from: null, to: id },
      });
      expect(empty.statusCode).toBe(409);

      const same = await app.inject({
        method: 'POST',
        url: '/api/v1/storage/migrate',
        headers: asUser(admin),
        payload: { from: id, to: id },
      });
      expect(same.statusCode).toBe(422);
    });

    it('refuses an unknown destination before a single byte moves', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storage/migrate',
        headers: asUser(admin),
        payload: { from: null, to: 'dest_01M1Q00000000000000000000' },
      });
      expect(res.statusCode).toBe(422);
    });

    it('leaves the source untouched when the copy does not verify', async () => {
      const id = (await create()).json().data.id as string;
      const fileId = newId('file');
      const stored = await storage.write({ id: fileId, kind: 'upload', filename: 'corrupt.pdf', mime: 'application/pdf', bytes: PDF });
      await filesRepo(meta).create({
        id: fileId,
        filename: 'corrupt.pdf',
        mime: 'application/pdf',
        sizeBytes: stored.sizeBytes,
        // A row whose recorded hash does not match its bytes — exactly what a
        // silently truncated copy would look like on landing.
        sha256: 'f'.repeat(64),
        kind: 'upload',
        storageKey: stored.storageKey,
        destinationId: null,
      });

      const started = await app.inject({
        method: 'POST',
        url: '/api/v1/storage/migrate',
        headers: asUser(admin),
        payload: { from: null, to: id },
      });
      const result = await runMigrate(started.json().data.jobId as string);

      expect(result.moved).toBe(0);
      expect(result.failed).toBe(1);
      // THE IMPORTANT HALF: the row still points at the source and the source
      // bytes are still there. A verification that ran after the delete would
      // have destroyed them.
      expect((await filesRepo(meta).findById(fileId))?.destinationId).toBeNull();
      expect(await readdir(resolve(dataDir, FILES_DIR))).toContain(stored.storageKey);
    });
  });
});
