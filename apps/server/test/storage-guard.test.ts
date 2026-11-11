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
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
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
import type { HostLookup } from '../src/net/address-guard.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { storageRoutes } from '../src/routes/storage/index.js';
import { fakeDeps, fakeIo, TEST_SECRET } from './cli-helpers.js';
import { TEST_STORAGE_CRYPTO } from './helpers/file-store.js';
import { startS3Stub, type S3Stub } from './helpers/s3-stub.js';

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

// ── G6: S3 and WebDAV endpoints, looked up and checked ─────────────────────

/** A lookup that answers from a table, counting what it was asked; a name not in it does not resolve. */
function answers(table: Record<string, readonly string[] | (() => readonly string[])>): HostLookup & { asked: string[] } {
  const asked: string[] = [];
  const lookup = async (host: string): Promise<readonly string[]> => {
    asked.push(host);
    const answer = table[host];
    if (answer === undefined) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    return typeof answer === 'function' ? answer() : answer;
  };
  return Object.assign(lookup, { asked });
}

const ENDPOINT_NAMES = {
  'meta.storage.test': ['169.254.169.254'],
  'alibaba.storage.test': ['100.100.100.200'],
  'v6meta.storage.test': ['fd00:ec2::254'],
  'lan.storage.test': ['10.0.0.5'],
  'me.storage.test': ['127.0.0.1'],
  'public.storage.test': ['203.0.113.10'],
};

describe('S3 and WebDAV endpoints at every way in', () => {
  let meta: MetaDb;
  let stub: S3Stub;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    stub = await startS3Stub();
  });

  afterEach(async () => {
    await stub.close();
  });

  const s3 = (endpoint: string) => ({
    name: 'Bucket',
    driver: 's3',
    config: { endpoint, region: 'us-east-1', bucket: stub.bucket, prefix: 'adminium', forcePathStyle: true },
    secret: { accessKeyId: 'AK', secretAccessKey: 'SK' },
  });
  const dav = (url: string) => ({ name: 'Share', driver: 'webdav', config: { url, prefix: 'adminium' } });

  const metadataEndpoints = [
    'http://meta.storage.test',
    'http://alibaba.storage.test',
    'http://v6meta.storage.test',
    'http://169.254.169.254',
    'http://[::ffff:a9fe:a9fe]',
    'http://0xa9fea9fe',
    'http://2852039166',
    'http://[64:ff9b::a9fe:a9fe]',
    'http://metadata.google.internal.',
  ];

  async function harness(over: { blockLoopback?: boolean; blockPrivate?: boolean; lookup?: HostLookup } = {}) {
    const resolver = createDestinationResolver({
      repo: destinationsRepo(meta, TEST_STORAGE_CRYPTO),
      localRoot: join(data, 'files'),
      blockLoopback: over.blockLoopback ?? false,
      blockPrivate: over.blockPrivate ?? false,
      lookup: over.lookup ?? answers(ENDPOINT_NAMES),
    });
    return { resolver, ...(await storageApp(meta, resolver)) };
  }

  it.each(['open', 'strict'])('%s refuses cloud metadata, in every spelling, at save and at both test routes', async (policy) => {
    const { app, admin } = await harness({ blockPrivate: policy === 'strict' });
    try {
      for (const endpoint of metadataEndpoints) {
        for (const payload of [s3(endpoint), dav(`${endpoint}/dav`)]) {
          const created = await app.inject({ method: 'POST', url: '/api/v1/storage/destinations', headers: admin, payload });
          expect(created.statusCode, `${payload.driver} ${endpoint}`).toBe(422);
          expect(created.payload).toContain('blocked address range');
          const tested = await app.inject({ method: 'POST', url: '/api/v1/storage/destinations/test', headers: admin, payload });
          expect(tested.statusCode, `${payload.driver} ${endpoint}`).toBe(422);
        }
      }
      expect(await destinationsRepo(meta, TEST_STORAGE_CRYPTO).isEmpty()).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('refuses a stored row whose name now answers with metadata, at its test route and at every request', async () => {
    let target = '127.0.0.1';
    const lookup = answers({ 'bucket.storage.test': () => [target] });
    const { app, admin, resolver } = await harness({ lookup });
    try {
      const port = new URL(stub.endpoint).port;
      const created = await app.inject({ method: 'POST', url: '/api/v1/storage/destinations', headers: admin, payload: s3(`http://bucket.storage.test:${port}`) });
      expect(created.statusCode).toBe(201);
      const id = created.json().data.id as string;
      const driver = await resolver.driverFor(id);
      const path = join(tree, 'payload.txt');
      await writeFile(path, 'hello');
      // The name resolves nowhere but in the test's table: these reach the stub only at the address checked.
      await driver.put('upload/2026/11/a.txt', { path, sizeBytes: 5, mime: 'text/plain', sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' });
      expect(stub.log.at(-1)).toMatchObject({ method: 'PUT', status: 200, unchunked: true, payloadHashMatched: true });
      const seen = stub.log.length;

      target = '169.254.169.254';
      await expect(driver.open('upload/2026/11/a.txt')).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('blocked address range') });
      await expect(driver.head('upload/2026/11/a.txt')).rejects.toMatchObject({ statusCode: 422 });
      const tested = await app.inject({ method: 'POST', url: `/api/v1/storage/destinations/${id}/test`, headers: admin });
      expect(tested.statusCode).toBe(422);
      expect(stub.log.length).toBe(seen);
    } finally {
      await app.close();
    }
  });

  it('looks the name up for every request: an answer that changes cannot move a request already checked', async () => {
    const answersSeen: string[][] = [];
    let call = 0;
    // The first answer of each request is what the request dials; a later lookup never happens for it.
    const lookup = answers({
      'bucket.storage.test': () => {
        call += 1;
        const answer = call % 2 === 1 ? ['127.0.0.1'] : ['169.254.169.254'];
        answersSeen.push(answer);
        return answer;
      },
    });
    const { app, admin, resolver } = await harness({ lookup });
    try {
      const port = new URL(stub.endpoint).port;
      const created = await app.inject({ method: 'POST', url: '/api/v1/storage/destinations', headers: admin, payload: s3(`http://bucket.storage.test:${port}`) });
      // The save looked it up once (answer 1: this test's server).
      expect(created.statusCode).toBe(201);
      const driver = await resolver.driverFor(created.json().data.id as string);
      // Request 1: answer 2 is metadata, refused before anything is sent.
      await expect(driver.head('upload/x')).rejects.toThrow('blocked address range');
      // Request 2: answer 3 is the test server again, and that is where it goes.
      await expect(driver.head('upload/x')).resolves.toBeNull();
      expect(stub.log.map((entry) => entry.method)).toEqual(['HEAD']);
      expect(lookup.asked).toHaveLength(3);
    } finally {
      await app.close();
    }
  });

  it('keeps the TLS server name: an https endpoint is dialled at the checked address, introduced by its name', async () => {
    const hellos: Buffer[] = [];
    const tls = createTcpServer((socket) => {
      socket.once('data', (chunk: Buffer) => {
        hellos.push(chunk);
        socket.destroy();
      });
    });
    await new Promise<void>((done) => tls.listen(0, '127.0.0.1', done));
    try {
      const port = (tls.address() as AddressInfo).port;
      const { app, admin, resolver } = await harness({ lookup: answers({ 'secure.storage.test': ['127.0.0.1'] }) });
      try {
        const created = await app.inject({ method: 'POST', url: '/api/v1/storage/destinations', headers: admin, payload: dav(`https://secure.storage.test:${String(port)}/dav`) });
        expect(created.statusCode).toBe(201);
        const driver = await resolver.driverFor(created.json().data.id as string);
        await expect(driver.head('upload/x')).rejects.toThrow();
        // The ClientHello carries the server name in the clear.
        expect(hellos).toHaveLength(1);
        expect(hellos[0]?.includes(Buffer.from('secure.storage.test'))).toBe(true);
      } finally {
        await app.close();
      }
    } finally {
      await new Promise<void>((done) => tls.close(() => done()));
    }
  });

  it('a name that cannot be looked up gets its own code and status, at save, test and request', async () => {
    const { app, admin, resolver } = await harness({ lookup: answers({ 'later.storage.test': ['203.0.113.10'] }) });
    try {
      for (const payload of [s3('https://nowhere.storage.test'), dav('https://nowhere.storage.test/dav')]) {
        const created = await app.inject({ method: 'POST', url: '/api/v1/storage/destinations', headers: admin, payload });
        expect(created.statusCode).toBe(502);
        expect(created.json()).toMatchObject({ code: 'HOST_LOOKUP_FAILED', message: expect.stringContaining('Could not look up nowhere.storage.test') });
        const tested = await app.inject({ method: 'POST', url: '/api/v1/storage/destinations/test', headers: admin, payload });
        expect(tested.statusCode).toBe(502);
        expect(tested.json().code).toBe('HOST_LOOKUP_FAILED');
      }
      const row = await destinationsRepo(meta, TEST_STORAGE_CRYPTO).create({ name: 'Gone', driver: 'webdav', config: { url: 'https://gone.storage.test/dav', prefix: 'a' }, createdBy: null }, Date.now());
      await expect((await resolver.driverFor(row.id)).head('upload/x')).rejects.toMatchObject({ statusCode: 502, code: 'HOST_LOOKUP_FAILED' });
    } finally {
      await app.close();
    }
  });

  it('refuses this machine by name in production, and lets it through on a desktop or dev server', async () => {
    const production = await harness({ blockLoopback: true });
    try {
      const refused = await production.app.inject({ method: 'POST', url: '/api/v1/storage/destinations', headers: production.admin, payload: dav('http://me.storage.test/dav') });
      expect(refused.statusCode).toBe(422);
      expect(refused.payload).toContain('Loopback');
    } finally {
      await production.app.close();
    }
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const desktop = await harness({ blockLoopback: false });
    try {
      const allowedHere = await desktop.app.inject({ method: 'POST', url: '/api/v1/storage/destinations', headers: desktop.admin, payload: dav('http://me.storage.test/dav') });
      expect(allowedHere.statusCode).toBe(201);
    } finally {
      await desktop.app.close();
    }
  });

  it('refuses the ADMINIUM_STORAGE_URL seed at a metadata address, and adminium start stops on it', async () => {
    const lookup = answers(ENDPOINT_NAMES);
    for (const url of ['s3://files?endpoint=http://meta.storage.test&accessKey=AK&secretKey=SK', 'webdav://u:p@169.254.169.254/dav', 's3://files?endpoint=http://0xa9fea9fe&accessKey=AK&secretKey=SK']) {
      await expect(storageSeedRefusal({ ADMINIUM_STORAGE_URL: url }, { lookup }), url).resolves.toMatchObject({ variable: 'ADMINIUM_STORAGE_URL', message: expect.stringContaining('blocked address range') });
      const warnings: string[] = [];
      const seeded = await seedStorageDestination({ meta, crypto: TEST_STORAGE_CRYPTO, env: { ADMINIUM_STORAGE_URL: url }, lookup, log: () => undefined, warn: (line) => warnings.push(line) });
      expect(seeded.kind, url).toBe('refused');
    }
    await expect(storageSeedRefusal({ AWS_ENDPOINT_URL_S3: 'http://169.254.169.254', BUCKET_NAME: 'b', AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 's' }, { lookup })).resolves.toMatchObject({ variable: 'AWS_ENDPOINT_URL_S3' });
    // A name that cannot be looked up is not a reason to stop the boot: it may resolve next time.
    await expect(storageSeedRefusal({ ADMINIUM_STORAGE_URL: 's3://files?endpoint=https://nowhere.storage.test&accessKey=AK&secretKey=SK' }, { lookup })).resolves.toBeNull();
    expect(await destinationsRepo(meta, TEST_STORAGE_CRYPTO).isEmpty()).toBe(true);

    const io = fakeIo();
    const deps = fakeDeps({ env: { ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_DATA_DIR: data, ADMINIUM_STORAGE_URL: 's3://files?endpoint=http://169.254.169.254&accessKey=AK&secretKey=SK' } });
    await expect(runCli(['start', '--skip-migrate'], { io, deps })).resolves.toBe(78);
    expect(io.stderr()).toContain('ADMINIUM_STORAGE_URL');
    expect(io.stderr()).toContain('blocked address range');
    expect(deps.startServer).not.toHaveBeenCalled();
  });
});
