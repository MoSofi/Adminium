// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A storage endpoint cannot redirect the drivers to another address.
 *
 * The attack: an S3 or WebDAV endpoint on a server the admin controls answers
 * every request with `302` to the cloud metadata address, and the download
 * streams the instance's credentials back as the "file". The fake below is a
 * real HTTP server, and the "metadata" it points at is a second one that
 * counts its visitors, so the test proves nothing was followed rather than
 * trusting a mocked `fetch` (which never follows anything).
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { createSqliteMetaDb, destinationsRepo, firstRun, jobsRepo, rolesRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { HOST_DECIDED_ENV } from '../src/cli/start-project.js';
import { loadEnv } from '../src/config/env.js';
import { seedStorageDestination, storageSeedRefusal } from '../src/config/storage-seed.js';
import { createDestinationResolver, type DestinationResolver } from '../src/files/destinations.js';
import { FileDriverError, type FileDriver } from '../src/files/drivers/driver.js';
import { createS3Driver } from '../src/files/drivers/s3.js';
import { createWebdavDriver } from '../src/files/drivers/webdav.js';
import { storageRootRefusal, type StorageRootPolicy } from '../src/files/root-guard.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { storageRoutes } from '../src/routes/storage/index.js';
import { fakeDeps, fakeIo, TEST_SECRET } from './cli-helpers.js';
import { TEST_STORAGE_CRYPTO } from './helpers/file-store.js';

const CREDENTIALS = '{"AccessKeyId":"ASIA-STOLEN","SecretAccessKey":"stolen-secret"}';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

const close = (server: Server) => new Promise<void>((done) => server.close(() => done()));

let metadata: Server;
let metadataUrl: string;
let metadataHits: number;
let hostile: Server;
let hostileUrl: string;
let redirectTo: () => string;
let dir: string;

beforeEach(async () => {
  metadataHits = 0;
  metadata = createServer((_request, response) => {
    metadataHits += 1;
    response.writeHead(200, { 'content-type': 'application/json' }).end(CREDENTIALS);
  });
  metadataUrl = await listen(metadata);
  redirectTo = () => `${metadataUrl}/latest/meta-data/iam/security-credentials/instance-role`;
  hostile = createServer((request, response) => {
    request.resume();
    response.writeHead(302, { location: redirectTo() }).end();
  });
  hostileUrl = await listen(hostile);
  dir = await mkdtemp(join(tmpdir(), 'adminium-storage-guard-'));
});

afterEach(async () => {
  hostile.closeAllConnections();
  metadata.closeAllConnections();
  await close(hostile);
  await close(metadata);
  await rm(dir, { recursive: true, force: true });
});

const drivers: Record<string, () => FileDriver> = {
  s3: () =>
    createS3Driver({
      config: { endpoint: hostileUrl, region: 'us-east-1', bucket: 'b', prefix: 'adminium', forcePathStyle: true },
      credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
    }),
  webdav: () => createWebdavDriver({ config: { url: hostileUrl, prefix: 'adminium' } }),
};

describe.each(Object.keys(drivers))('%s driver behind an endpoint that redirects', (name) => {
  const driver = () => (drivers[name] as () => FileDriver)();

  it('reads a redirect as an error, not as the bytes it points at', async () => {
    const opened = driver().open('upload/2026/11/a.pdf');
    await expect(opened).rejects.toBeInstanceOf(FileDriverError);
    await expect(opened).rejects.toThrow(`redirect (HTTP 302 to ${metadataUrl})`);
    expect(metadataHits).toBe(0);
  });

  it('refuses the redirect on every verb', async () => {
    const path = join(dir, 'payload');
    await writeFile(path, 'hello');
    const d = driver();
    await expect(d.head('upload/2026/11/a.pdf')).rejects.toThrow('redirect');
    await expect(d.remove('upload/2026/11/a.pdf')).rejects.toThrow('redirect');
    await expect(
      d.put('upload/2026/11/a.pdf', { path, sizeBytes: 5, mime: 'application/pdf', sha256: 'x'.repeat(64) }),
    ).rejects.toThrow('redirect');
    expect(metadataHits).toBe(0);
  });

  it('fails the probe that the storage test routes run, naming the redirect', async () => {
    const result = await driver().probe();
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('redirect');
    expect(metadataHits).toBe(0);
  });

  it('never dials the metadata address itself', async () => {
    // Without the fix this dials 169.254.169.254 and hangs until the test's
    // own timeout; with it, the 302 is the answer.
    redirectTo = () => 'http://169.254.169.254/latest/meta-data/iam/security-credentials/';
    await expect(driver().open('upload/2026/11/a.pdf')).rejects.toThrow(
      'redirect (HTTP 302 to http://169.254.169.254)',
    );
  });
});

describe('a 3xx with nowhere to go', () => {
  it('is handed to the driver, so S3 says which endpoint the bucket needs', async () => {
    const body = '<?xml version="1.0" encoding="UTF-8"?><Error><Code>PermanentRedirect</Code><Message>The bucket you are attempting to access must be addressed using the specified endpoint.</Message><Endpoint>b.s3.eu-west-1.amazonaws.com</Endpoint></Error>';
    const fetchImpl: typeof fetch = async () => new Response(body, { status: 301, headers: { 'content-type': 'application/xml' } });
    const driver = createS3Driver({
      config: { region: 'us-east-1', bucket: 'b', prefix: 'adminium', forcePathStyle: false },
      credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
      fetchImpl,
    });
    await expect(driver.open('upload/2026/11/a.pdf')).rejects.toThrow('PermanentRedirect: The bucket you are attempting to access must be addressed');
    const probed = await driver.probe();
    expect(probed.ok ? '' : probed.error).toContain('PermanentRedirect');
  });
});

describe('webdav MKCOL', () => {
  it('still reads a 301 as "the collection exists", without following it', async () => {
    const seen: { method: string; redirect: RequestRedirect | undefined }[] = [];
    let puts = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      const method = init?.method ?? 'GET';
      seen.push({ method, redirect: init?.redirect });
      if (method === 'PUT') return new Response(null, { status: (puts += 1) === 1 ? 409 : 201 });
      return new Response(null, { status: 301, headers: { location: 'http://169.254.169.254/' } });
    };
    const path = join(dir, 'payload');
    await writeFile(path, 'hello');
    const driver = createWebdavDriver({ config: { url: 'https://dav.example.com', prefix: 'files' }, fetchImpl });
    await driver.put('upload/2026/11/a.pdf', { path, sizeBytes: 5, mime: 'application/pdf', sha256: 'x'.repeat(64) });
    expect(seen.filter((s) => s.method === 'MKCOL')).toHaveLength(3); // upload, upload/2026, upload/2026/11
    expect(seen.every((s) => s.redirect === 'manual')).toBe(true);
  });
});

// ── G5: a `local` destination's folder ─────────────────────────────────────

// Built while the file is collected: `it.each` reads the paths then.
const tree = realpathSync.native(mkdtempSync(join(tmpdir(), 'storage-roots-')));
const data = join(tree, 'data');
const elsewhere = join(tree, 'elsewhere');
const allowed = join(tree, 'allowed');
for (const folder of [elsewhere, allowed, ...['backups', 'files', 'tmp', 'add-ons', 'pre-restore-2026-11-11', 'databases'].map((d) => join(data, d))]) {
  mkdirSync(folder, { recursive: true });
}
const metaFile = join(data, 'meta.db');
writeFileSync(metaFile, '');
symlinkSync(join(data, 'backups'), join(tree, 'into-backups'));
symlinkSync(data, join(tree, 'into-data'));
symlinkSync(elsewhere, join(allowed, 'out'));
const roots: StorageRootPolicy = { own: { dataDir: data, metaFile } };
const pinned: StorageRootPolicy = { ...roots, dirs: [allowed] };

afterAll(() => {
  rmSync(tree, { recursive: true, force: true });
});

const refusedRoots = () => [
  { label: 'the meta store file', root: metaFile, reason: 'meta-store' },
  { label: 'the backups folder', root: join(data, 'backups'), reason: 'data-folder' },
  { label: 'a folder inside the default file storage', root: join(data, 'files', 'mine'), reason: 'data-folder' },
  { label: 'the upload spool', root: join(data, 'tmp'), reason: 'data-folder' },
  { label: 'the add-ons folder', root: join(data, 'add-ons'), reason: 'data-folder' },
  { label: 'a folder a restore moved aside', root: join(data, 'pre-restore-2026-11-11'), reason: 'data-folder' },
  { label: 'the data dir itself', root: data, reason: 'contains-data' },
  { label: 'a folder holding the data dir', root: tree, reason: 'contains-data' },
  { label: '/', root: parse(tree).root, reason: 'contains-data' },
  { label: 'a symlink into the backups folder', root: join(tree, 'into-backups'), reason: 'data-folder' },
  { label: 'a path that climbs into the data dir with ..', root: `${elsewhere}/../data/backups`, reason: 'data-folder' },
  { label: 'a symlink to the data dir', root: join(tree, 'into-data'), reason: 'contains-data' },
];

describe("a local root never lands on Adminium's own files", () => {
  it.each(refusedRoots())('refuses $label', ({ root, reason }) => {
    expect(storageRootRefusal(root, roots)?.details).toMatchObject({ reason });
  });

  it('accepts a folder of its own, existing or not, and the data dir\'s other folders', () => {
    expect(storageRootRefusal(join(elsewhere, 'uploads'), roots)).toBeNull();
    expect(storageRootRefusal(elsewhere, roots)).toBeNull();
    expect(storageRootRefusal(join(data, 'databases'), roots)).toBeNull();
  });

  it('says what is wrong and what to do', () => {
    expect(storageRootRefusal(join(data, 'backups'), roots)?.message).toBe(
      "This folder is one of Adminium's own (backups in its data directory). Choose a folder of its own for files.",
    );
    expect(storageRootRefusal(tree, roots)?.message).toBe("This folder holds Adminium's own data directory. Choose a folder of its own.");
  });
});

describe('ADMINIUM_STORAGE_DIRS', () => {
  const base = { ADMINIUM_SECRET: TEST_SECRET };

  it('parses absolute folders and refuses a relative one', () => {
    expect(loadEnv(base).ADMINIUM_STORAGE_DIRS).toBeUndefined();
    expect(loadEnv({ ...base, ADMINIUM_STORAGE_DIRS: ` ${allowed} , /srv/files ` }).ADMINIUM_STORAGE_DIRS).toEqual([allowed, '/srv/files']);
    expect(() => loadEnv({ ...base, ADMINIUM_STORAGE_DIRS: 'files' })).toThrow('ADMINIUM_STORAGE_DIRS');
  });

  it('is decided by the host, not by a project folder', () => {
    expect(HOST_DECIDED_ENV).toContain('ADMINIUM_STORAGE_DIRS');
    expect(HOST_DECIDED_ENV).toContain('ADMINIUM_NETWORK_POLICY');
  });

  it('accepts a folder inside, refuses one outside, and follows a symlink out', () => {
    expect(storageRootRefusal(join(allowed, 'uploads'), pinned)).toBeNull();
    expect(storageRootRefusal(elsewhere, pinned)?.details).toMatchObject({ reason: 'outside-storage-dirs', variable: 'ADMINIUM_STORAGE_DIRS' });
    expect(storageRootRefusal(join(allowed, 'out', 'uploads'), pinned)?.details).toMatchObject({ reason: 'outside-storage-dirs' });
    expect(storageRootRefusal(elsewhere, pinned)?.message).toContain(`ADMINIUM_STORAGE_DIRS: ${allowed}`);
  });

  it('never lets the own-files list go, even for a folder listed in it', () => {
    expect(storageRootRefusal(join(data, 'backups'), { ...roots, dirs: [data] })?.details).toMatchObject({ reason: 'data-folder' });
  });
});

// ── the storage routes, on a real resolver ─────────────────────────────────

async function storageApp(meta: MetaDb, resolver: DestinationResolver): Promise<{ app: FastifyInstance; admin: Record<string, string> }> {
  const users = usersRepo(meta);
  const roleRepo = rolesRepo(meta);
  const superAdmin = await roleRepo.findBySlug('super-admin');
  if (superAdmin === null) throw new Error('no super-admin role');
  const admin = await users.create({ email: 'ava@adminium.test', name: 'Ava', status: 'active' });
  await roleRepo.assignToUser(admin.id, superAdmin.id);
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (typeof id !== 'string') return;
    const user = await users.findById(id);
    if (user !== null) (request as unknown as { user: { id: string; name: string; email: string } }).user = { id: user.id, name: user.name, email: user.email };
  });
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(storageRoutes({ meta, storageCrypto: TEST_STORAGE_CRYPTO, destinations: resolver, enqueue: (input) => jobsRepo(meta).enqueue(input) }));
    },
    { prefix: '/api/v1' },
  );
  await app.ready();
  return { app, admin: { 'x-test-user-id': admin.id } };
}

describe('local roots at every way in', () => {
  let meta: MetaDb;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
  });

  const local = (root: string) => ({ name: 'Disk', driver: 'local', config: { root, prefix: 'adminium' } });

  it('refuses a root of its own at save, on a PATCH, and at both test routes; nothing is stored', async () => {
    const resolver = createDestinationResolver({ repo: destinationsRepo(meta, TEST_STORAGE_CRYPTO), localRoot: join(data, 'files'), roots: pinned });
    const { app, admin } = await storageApp(meta, resolver);
    try {
      for (const root of [join(data, 'backups'), tree, elsewhere, join(allowed, 'out')]) {
        const created = await app.inject({ method: 'POST', url: '/api/v1/storage/destinations', headers: admin, payload: local(root) });
        expect(created.statusCode, root).toBe(422);
        const tested = await app.inject({ method: 'POST', url: '/api/v1/storage/destinations/test', headers: admin, payload: local(root) });
        expect(tested.statusCode, root).toBe(422);
      }
      expect(await destinationsRepo(meta, TEST_STORAGE_CRYPTO).isEmpty()).toBe(true);

      const good = await app.inject({ method: 'POST', url: '/api/v1/storage/destinations', headers: admin, payload: local(join(allowed, 'uploads')) });
      expect(good.statusCode).toBe(201);
      const id = good.json().data.id as string;
      const patched = await app.inject({ method: 'PATCH', url: `/api/v1/storage/destinations/${id}`, headers: admin, payload: { config: { root: join(data, 'backups'), prefix: 'adminium' } } });
      expect(patched.statusCode).toBe(422);
      expect((await destinationsRepo(meta, TEST_STORAGE_CRYPTO).findById(id))?.config).toMatchObject({ root: join(allowed, 'uploads') });
    } finally {
      await app.close();
    }
  });

  it('refuses a row stored before the guard, when it is tested or read', async () => {
    const row = await destinationsRepo(meta, TEST_STORAGE_CRYPTO).create({ name: 'Old', driver: 'local', config: { root: join(data, 'backups'), prefix: 'a' }, createdBy: null }, Date.now());
    const resolver = createDestinationResolver({ repo: destinationsRepo(meta, TEST_STORAGE_CRYPTO), localRoot: join(data, 'files'), roots });
    const { app, admin } = await storageApp(meta, resolver);
    try {
      const tested = await app.inject({ method: 'POST', url: `/api/v1/storage/destinations/${row.id}/test`, headers: admin });
      expect(tested.statusCode).toBe(422);
      await expect(resolver.driverFor(row.id)).rejects.toMatchObject({ statusCode: 422 });
    } finally {
      await app.close();
    }
  });

  it('refuses the ADMINIUM_STORAGE_URL seed: no row, and the boot names it', async () => {
    const warnings: string[] = [];
    const seeded = await seedStorageDestination({
      meta,
      crypto: TEST_STORAGE_CRYPTO,
      env: { ADMINIUM_STORAGE_URL: `file://${join(data, 'backups')}` },
      roots,
      log: () => undefined,
      warn: (line) => warnings.push(line),
    });
    expect(seeded.kind).toBe('refused');
    expect(warnings.join('\n')).toContain("one of Adminium's own (backups");
    expect(await destinationsRepo(meta, TEST_STORAGE_CRYPTO).isEmpty()).toBe(true);
    await expect(storageSeedRefusal({ ADMINIUM_STORAGE_URL: `file://${elsewhere}` }, { roots: pinned })).resolves.toMatchObject({ variable: 'ADMINIUM_STORAGE_URL', message: expect.stringContaining('ADMINIUM_STORAGE_DIRS') });
    await expect(storageSeedRefusal({ ADMINIUM_STORAGE_URL: `file://${join(allowed, 'uploads')}` }, { roots: pinned })).resolves.toBeNull();
    await expect(storageSeedRefusal({ ADMINIUM_STORAGE_URL: 'not a url' }, { roots })).resolves.toBeNull();
  });

  it('adminium start fails on a seed in its own folders, and boots on one of its own', async () => {
    const env = { ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_DATA_DIR: data };
    const io = fakeIo();
    const refused = fakeDeps({ env: { ...env, ADMINIUM_STORAGE_URL: `file://${join(data, 'backups')}` } });
    await expect(runCli(['start', '--skip-migrate'], { io, deps: refused })).resolves.toBe(78);
    expect(io.stderr()).toContain('ADMINIUM_STORAGE_URL');
    expect(io.stderr()).toContain("Adminium's own");
    expect(refused.startServer).not.toHaveBeenCalled();
    const outside = fakeDeps({ env: { ...env, ADMINIUM_STORAGE_DIRS: allowed, ADMINIUM_STORAGE_URL: `file://${elsewhere}` } });
    await expect(runCli(['start', '--skip-migrate'], { io: fakeIo(), deps: outside })).resolves.toBe(78);
    const booted = fakeDeps({ env: { ...env, ADMINIUM_STORAGE_URL: `file://${join(elsewhere, 'uploads')}` } });
    await expect(runCli(['start', '--skip-migrate'], { io: fakeIo(), deps: booted })).resolves.toBe(0);
    expect(booted.startServer).toHaveBeenCalledOnce();
  });
});
