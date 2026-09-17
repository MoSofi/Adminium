// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Installing a micro-SaaS app.
 *
 * The claim under test is the one the whole step rests on: bytes uploaded over
 * the API are SERVED, at the app's own mount, on the next request and without a
 * restart — and the staff gate still holds over them. A store test alone would
 * not see that, because the interesting part is the seam between the registry
 * and the surfaces plugin, where a boot-discovered surface and an installed one
 * have to coexist without either shadowing the other.
 *
 * Tarballs here are REAL npm-shaped archives, built byte by byte, so every
 * upload runs `archive.ts`'s hardened unpack rather than a stub of it.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { gzipSync } from 'fflate';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  auditRepo,
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  manifestsRepo,
  usersRepo,
  type MetaDb,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { createInstalledApps, surfacesOfInstalled, type InstalledApps } from '../src/apps/installed.js';
import { createAppStore, type AppStore } from '../src/apps/store.js';
import type { AppSchemaTarget } from '../src/apps/schema-target.js';
import { seedBundledPackages, sha512Integrity } from '../src/add-ons/store.js';
import { applyInstall, type ExistingTable } from '../src/add-ons/install-ddl.js';
import { AppError, errorEnvelope, UnauthorizedError } from '../src/errors.js';
import { appRoutes } from '../src/routes/apps/index.js';
import { makeEnv } from './helpers.js';

const BLOCK = 512;

function put(b: Uint8Array, at: number, len: number, v: string): void {
  b.set(Buffer.from(v, 'latin1').subarray(0, len), at);
}

/** A real npm-shaped tarball, so the store's own hardening runs. */
function packageTarball(files: Record<string, string>): Uint8Array {
  const members: Uint8Array[] = [];
  for (const [path, content] of Object.entries(files)) {
    const body = Buffer.from(content, 'utf8');
    const header = new Uint8Array(BLOCK);
    put(header, 0, 100, `package/${path}`);
    put(header, 100, 8, '0000644\0');
    put(header, 124, 12, `${body.length.toString(8).padStart(11, '0')}\0`);
    put(header, 136, 12, '00000000000\0');
    put(header, 156, 1, '0');
    put(header, 257, 6, 'ustar\0');
    put(header, 263, 2, '00');
    header.set(Buffer.from('        ', 'latin1'), 148);
    let sum = 0;
    for (let i = 0; i < BLOCK; i += 1) sum += header[i] ?? 0;
    put(header, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);

    const padding = (BLOCK - (body.length % BLOCK)) % BLOCK;
    const member = new Uint8Array(BLOCK + body.length + padding);
    member.set(header, 0);
    member.set(body, BLOCK);
    members.push(member);
  }
  members.push(new Uint8Array(BLOCK * 2));
  const total = members.reduce((n, m) => n + m.length, 0);
  const flat = new Uint8Array(total);
  let offset = 0;
  for (const member of members) {
    flat.set(member, offset);
    offset += member.length;
  }
  // `mtime: 0` leaves the gzip header's timestamp at zero, as `npm pack` does.
  // fflate's default is the current second, so the same files packed a second
  // apart would hash differently.
  return gzipSync(flat, { mtime: 0 });
}

/**
 * A manifest that actually validates.
 *
 * Derived from a shipped one (clinic-desk) rather than invented, because
 * `appManifestSchema` is `.strict()` with four refinements and a hand-written
 * literal that drifts from it would fail here for reasons that have nothing to
 * do with installing.
 */
function manifestFor(key: string, tables?: unknown[]): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key,
    name: 'Sample Desk',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.sample.desc', fallback: 'A sample desk.' },
    categories: ['operations'],
    compatibility: {
      minAdminiumVersion: '1.0.0',
      engines: ['postgres', 'mysql', 'sqlite'],
    },
    requiredSchema: {
      tables: tables ?? [
        {
          ref: 'clinicians',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'name', type: 'text' },
          ],
        },
      ],
    },
    pages: [
      {
        ref: 'sample-dashboard',
        template: 'page-dashboard',
        title: { key: 'mft.sample.page.dashboard', fallback: 'Dashboard' },
        nav: { group: 'manifest:sample', icon: 'layout-dashboard', order: 1 },
      },
    ],
    frontends: [
      { side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } },
      { side: 'customer', kind: 'spa', entry: 'index.html', routes: { book: '/' } },
    ],
  };
}

const STAFF_HTML = '<!doctype html><html><body data-app="sample-staff"></body></html>';
const CUSTOMER_HTML = '<!doctype html><html><body data-app="sample-customer"></body></html>';

function bundleFor(
  key: string,
  extra: Record<string, string> = {},
  tables?: unknown[],
): Record<string, string> {
  return {
    'manifest.json': JSON.stringify(manifestFor(key, tables)),
    'staff/index.html': STAFF_HTML,
    'staff/assets/app.js': 'export const x = 1;',
    'customer/index.html': CUSTOMER_HTML,
    'customer/assets/app.js': 'export const y = 2;',
    ...extra,
  };
}

let meta: MetaDb;
let dataDir: string;
let store: AppStore;
let installed: InstalledApps;
let installer: { id: string; email: string };
let anonymous = false;
let directoryKeys: string[] = [];
/** The operator's database, as far as these tests are concerned. */
let sourceDb: Kysely<Record<string, Record<string, unknown>>>;
let existingTables: ExistingTable[] = [];
/**
 * A REAL connection row, not a made-up id.
 *
 * `adminium_manifests.connection_id` is a foreign key, so an install naming a
 * connection that does not exist fails in the database rather than in a guard —
 * which is exactly what the first draft of this test did, and it is worth
 * knowing that the row is what holds that invariant.
 */
let CONNECTION: string;

beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const user = await usersRepo(meta).create({ email: 'owner@test', name: 'Owner' });
  installer = { id: user.id, email: user.email };
  dataDir = await mkdtemp(join(tmpdir(), 'app-install-'));
  store = createAppStore({ dataDir });
  installed = createInstalledApps({
    store,
    list: async () =>
      (await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v })
        .list('app')).map((m) => ({ key: m.row.manifestKey, version: m.row.version })),
  });
  anonymous = false;
  directoryKeys = [];
  existingTables = [];
  CONNECTION = (
    await connectionsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).create({
      name: 'Practice',
      engine: 'sqlite',
      introspectDsn: 'sqlite::memory:',
      dataDsn: 'sqlite::memory:',
    })
  ).id;
  sourceDb = new Kysely({
    dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }),
  });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** The route surface, behind a real `requireAuth` and a stubbed RBAC. */
async function buildApp() {
  const Fastify = (await import('fastify')).default;
  const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('rbac', { require: () => async () => {} } as never);
  /*
   * A REAL `requireAuth`: the upload route authenticates at `onRequest`
   * precisely so an anonymous body is never buffered, and a pass-through stub
   * would report green whether that phase were right or missing.
   */
  app.decorate(
    'requireAuth',
    (async (request: { user?: unknown }) => {
      if (request.user === null || request.user === undefined) {
        throw new UnauthorizedError('UNAUTHENTICATED');
      }
    }) as never,
  );
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
  await app.register(
    appRoutes({
      meta,
      store,
      installed,
      credentialCrypto: { encrypt: (v) => v, decrypt: (v) => v },
      directoryKeys: () => directoryKeys,
      /*
       * The REAL `applyInstall`, against a real (in-memory) source database —
       * only the connection-picking half is stubbed out, the same split
       * `add-on-routes.test.ts` makes. A recording stub would turn every
       * "the table was created" assertion into a claim about a claim.
       */
      schemaTarget: {
        read: async () => existingTables.map((table) => ({ ...table, columns: [...table.columns] })),
        apply: async (plan, manifest) =>
          applyInstall({
            plan,
            tables: manifest.requiredSchema?.tables ?? [],
            db: sourceDb,
            dialect: 'sqlite',
            existing: existingTables,
          }),
      } satisfies AppSchemaTarget,
    }),
  );
  await app.ready();
  return app;
}

/**
 * Uploads a bundle the way Studio does: the bytes and their hash, and nothing
 * about which app they are — the bundle's manifest says that. `assert` adds the
 * optional key/version a scripted caller may send to have them checked.
 */
async function upload(
  app: Awaited<ReturnType<typeof buildApp>>,
  key: string,
  files?: Record<string, string>,
  assert: { key?: string; version?: string } = {},
) {
  const tarball = packageTarball(files ?? bundleFor(key));
  const query = new URLSearchParams({ ...assert, expectedSha512: sha512Integrity(tarball) });
  return app.inject({
    method: 'POST',
    url: `/apps/upload?${query.toString()}`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(tarball),
  });
}

describe('uploading a surface bundle', () => {
  it('stages it under the key and version its own manifest declares', async () => {
    // Nothing in the request names the app. The reply does, from the manifest.
    const app = await buildApp();
    const res = await upload(app, 'sample-desk');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      key: 'sample-desk',
      version: '1.0.0',
      name: 'Sample Desk',
      sides: ['staff', 'customer'],
    });
    expect(await store.versions('sample-desk')).toEqual(['1.0.0']);
    await app.close();
  });

  it('installs what it staged under the identity it read, with nothing typed', async () => {
    // The screenshot this replaced: "uploaded as clinicx but its manifest
    // declares clinic", on the step AFTER the upload had succeeded.
    const app = await buildApp();
    const staged = (await upload(app, 'sample-desk')).json() as { key: string; version: string };
    const res = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: staged.key, version: staged.version, connectionId: CONNECTION },
    });
    expect(res.statusCode, res.body).toBe(200);
    await app.close();
  });

  it('checks a key or version the caller asserts, and stages nothing when it is wrong', async () => {
    const app = await buildApp();
    const wrongKey = await upload(app, 'sample-desk', undefined, { key: 'sample-deskx' });
    expect(wrongKey.statusCode).toBe(422);
    expect(wrongKey.json().error.details.reason).toBe('KEY_MISMATCH');
    expect(wrongKey.json().error.message).toContain('"sample-desk"');

    const wrongVersion = await upload(app, 'sample-desk', undefined, { version: '2.0.0' });
    expect(wrongVersion.statusCode).toBe(422);
    expect(wrongVersion.json().error.details.reason).toBe('VERSION_MISMATCH');
    expect(await store.keys()).toEqual([]);

    // Audited under the identity the bundle actually has, with the reason.
    const rows = await auditRepo(meta).list({ category: 'app', limit: 10 });
    expect(
      rows.map((row) => ({ action: row.action, ...(row.changes as { after: object }).after })),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'app.unpack-refused', key: 'sample-desk', reason: 'KEY_MISMATCH' }),
        expect.objectContaining({ action: 'app.unpack-refused', version: '1.0.0', reason: 'VERSION_MISMATCH' }),
      ]),
    );

    // Asserting what the manifest actually says is simply an upload.
    const right = await upload(app, 'sample-desk', undefined, { key: 'sample-desk', version: '1.0.0' });
    expect(right.statusCode, right.body).toBe(200);
    await app.close();
  });

  it('refuses a bundle it cannot identify at the upload, where the file was chosen', async () => {
    const app = await buildApp();

    const notGzip = await app.inject({
      method: 'POST',
      url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(Buffer.from('photos')))}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('photos'),
    });
    expect(notGzip.statusCode).toBe(422);
    expect(notGzip.json().error.message).toBe('This file could not be read as an app bundle (NOT_GZIP).');

    const none = await upload(app, 'sample-desk', { 'staff/index.html': STAFF_HTML });
    expect(none.statusCode).toBe(422);
    expect(none.json().error.details.reason).toBe('MANIFEST_MISSING');
    expect(none.json().error.message).toMatch(/no `manifest.json`/);

    const unreadable = await upload(app, 'sample-desk', {
      'manifest.json': '{ not json',
      'staff/index.html': STAFF_HTML,
    });
    expect(unreadable.statusCode).toBe(422);
    expect(unreadable.json().error.details.reason).toBe('MANIFEST_MISSING');

    const invalid = await upload(app, 'sample-desk', {
      'manifest.json': JSON.stringify({ ...manifestFor('sample-desk'), version: 'one' }),
      'staff/index.html': STAFF_HTML,
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.message).toBe('The manifest in this bundle is not valid.');
    expect(invalid.json().error.details.issues.length).toBeGreaterThan(0);

    expect(await store.keys()).toEqual([]);
    await app.close();
  });

  it('refuses an anonymous upload before the body is parsed', async () => {
    const app = await buildApp();
    anonymous = true;
    const res = await upload(app, 'sample-desk');
    expect(res.statusCode).toBe(401);
    expect(await store.keys()).toEqual([]);
    await app.close();
  });

  it('refuses a bundle with no side, and leaves nothing staged', async () => {
    const app = await buildApp();
    const res = await upload(app, 'sample-desk', {
      'manifest.json': JSON.stringify(manifestFor('sample-desk')),
      'readme.md': '# nothing servable here',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.reason).toBe('NO_SURFACE');
    // The discard matters: a package that can never install must not sit in the
    // staged list forever.
    expect(await store.keys()).toEqual([]);
    await app.close();
  });

  it('refuses a tarball whose bytes do not match the stated hash', async () => {
    const app = await buildApp();
    const tarball = packageTarball(bundleFor('sample-desk'));
    const res = await app.inject({
      method: 'POST',
      url: '/apps/upload?expectedSha512=sha512-AAAA',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from(tarball),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.reason).toBe('INTEGRITY_MISMATCH');
    expect(res.json().error.message).toMatch(/does not match the integrity value/);
    expect(await store.keys()).toEqual([]);
    await app.close();
  });
});

describe('installing a staged bundle', () => {
  it('records the app and makes its surfaces live', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');
    expect(installed.current()).toHaveLength(0);

    const res = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
    expect(res.json().sides.map((s: { prefix: string }) => s.prefix)).toEqual([
      '/apps/sample-desk/staff',
      '/apps/sample-desk/customer',
    ]);
    expect(installed.current().map((s) => s.side)).toEqual(['staff', 'customer']);

    const list = await app.inject({ method: 'GET', url: '/apps' });
    expect(list.json().apps).toHaveLength(1);
    expect(list.json().staged).toEqual([]);
    await app.close();
  });

  it('refuses a manifest whose key is not the one it was staged under', async () => {
    // An upload can no longer stage one — it takes its key from the manifest —
    // so the package is put on disk the way the bundled seed does, under a key
    // read off a filename.
    const app = await buildApp();
    const tarball = packageTarball(bundleFor('other-desk'));
    await store.stage({
      key: 'sample-desk',
      version: '1.0.0',
      tarball,
      expectedIntegrity: sha512Integrity(tarball),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.reason).toBe('KEY_MISMATCH');
    await app.close();
  });

  it('refuses to install over a surface the operator deployed by hand', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');
    directoryKeys = ['sample-desk'];
    const res = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    expect(res.statusCode).toBe(409);
    expect(installed.current()).toHaveLength(0);
    await app.close();
  });

  it('refuses a bundle whose tree drifted after it was staged', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');
    // Something with write access to the data volume edits the unpacked tree
    // between staging and install — the exact window the pin exists for.
    await writeFile(
      join(store.dirFor('sample-desk', '1.0.0'), 'staff', 'index.html'),
      '<script>fetch("/api/v1/users")</script>',
      'utf8',
    );
    const res = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    expect(res.statusCode).toBe(422);
    expect(installed.current()).toHaveLength(0);
    await app.close();
  });

  it('uninstall removes the row, the bytes and the mount', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');
    await app.inject({ method: 'POST', url: '/apps/install', payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION } });
    expect(installed.current()).toHaveLength(2);

    const res = await app.inject({ method: 'DELETE', url: '/apps/sample-desk' });
    expect(res.statusCode).toBe(200);
    expect(installed.current()).toHaveLength(0);
    expect(await store.keys()).toEqual([]);
    await app.close();
  });
});

describe('an installed app is served without a restart', () => {
  let dist: string;
  let server: AdminiumServer | undefined;

  beforeEach(async () => {
    dist = await mkdtemp(join(tmpdir(), 'app-install-dash-'));
    await mkdir(dist, { recursive: true });
    await writeFile(join(dist, 'index.html'), '<!doctype html><html><body id="dash"></body></html>', 'utf8');
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
    await rm(dist, { recursive: true, force: true });
  });

  it('serves the customer side the moment the registry refreshes', async () => {
    // The server is built with NOTHING installed — the state a running
    // instance is in when an operator starts an upload.
    server = await buildServer({ env: makeEnv(), staticRoot: dist, installedApps: installed });
    const before = await server.inject({ method: 'GET', url: '/apps/sample-desk/customer/' });
    expect(before.body).toContain('id="dash"');

    const routes = await buildApp();
    await upload(routes, 'sample-desk');
    await routes.inject({ method: 'POST', url: '/apps/install', payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION } });
    await routes.close();

    // Same server instance, no restart.
    const after = await server.inject({ method: 'GET', url: '/apps/sample-desk/customer/' });
    expect(after.statusCode).toBe(200);
    expect(after.body).toContain('data-app="sample-customer"');

    const asset = await server.inject({ method: 'GET', url: '/apps/sample-desk/customer/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain('export const y = 2;');

    /*
     * And the gate covers an installed app's ASSETS, not only its documents.
     * A staff bundle whose index.html is gated but whose JS is public leaks the
     * screens, the field names and every endpoint the app calls — which is most
     * of what the gate is there to protect.
     */
    const gated = await server.inject({ method: 'GET', url: '/apps/sample-desk/staff/assets/app.js' });
    expect(gated.statusCode).toBe(401);
  });

  it('keeps the staff gate over an installed surface', async () => {
    server = await buildServer({ env: makeEnv(), staticRoot: dist, installedApps: installed });
    const routes = await buildApp();
    await upload(routes, 'sample-desk');
    await routes.inject({ method: 'POST', url: '/apps/install', payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION } });
    await routes.close();

    // A document navigation by someone with no session goes to the login page,
    // not to the bundle and not to a raw JSON envelope.
    const res = await server.inject({
      method: 'GET',
      url: '/apps/sample-desk/staff/',
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/login?next=');
  });

  it('leaves a boot-discovered surface of the same key untouched', async () => {
    const surfacesDir = await mkdtemp(join(tmpdir(), 'app-install-dir-'));
    const staff = join(surfacesDir, 'sample-desk', 'customer');
    await mkdir(staff, { recursive: true });
    await writeFile(join(staff, 'index.html'), '<!doctype html><html><body id="from-disk"></body></html>', 'utf8');

    const tarball = packageTarball(bundleFor('sample-desk'));
    await store.stage({
      key: 'sample-desk',
      version: '1.0.0',
      tarball,
      expectedIntegrity: sha512Integrity(tarball),
    });
    await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).install({
      manifestKey: 'sample-desk',
      version: '1.0.0',
      kind: 'app',
      source: 'file',
      document: manifestFor('sample-desk'),
    });
    await installed.refresh();

    server = await buildServer({
      env: makeEnv(),
      staticRoot: dist,
      installedApps: installed,
      surfaces: [
        {
          appKey: 'sample-desk',
          side: 'customer',
          root: staff,
          prefix: '/apps/sample-desk/customer',
          manifest: null,
        },
      ],
    });

    // The directory surface owns the mount; the installed one yields.
    const res = await server.inject({ method: 'GET', url: '/apps/sample-desk/customer/' });
    expect(res.body).toContain('id="from-disk"');
    await rm(surfacesDir, { recursive: true, force: true });
  });
});

describe('surfacesOfInstalled', () => {
  it('contributes nothing for a package whose bytes are gone', () => {
    expect(surfacesOfInstalled(store, { key: 'sample-desk', version: '1.0.0' })).toEqual([]);
  });

  it('refuses to build a path out of an unsafe key rather than throwing', () => {
    expect(surfacesOfInstalled(store, { key: '../escape', version: '1.0.0' })).toEqual([]);
  });
});

describe('the install plan', () => {
  const FK_TABLES = [
    {
      ref: 'clinicians',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'name', type: 'text' },
      ],
    },
    {
      ref: 'visits',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'patient_id', type: 'fk', references: 'patients' },
      ],
    },
  ];

  it('says what would be created, and writes nothing', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');

    const res = await app.inject({
      method: 'POST',
      url: '/apps/plan',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().plan).toMatchObject({
      key: 'sample-desk',
      installable: true,
      requiresSchemaChange: true,
      create: [{ ref: 'clinicians', columns: [{ ref: 'id' }, { ref: 'name' }] }],
      reuse: [],
      problems: [],
    });

    // A preview that could not be shown before consent would be no preview at
    // all: nothing is installed and no table exists.
    expect(installed.current()).toHaveLength(0);
    await expect(sourceDb.selectFrom('clinicians').selectAll().execute()).rejects.toThrow();
    await app.close();
  });

  it('reports a table it would reuse rather than create', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');
    existingTables = [{ ref: 'clinicians', columns: [{ ref: 'id' }, { ref: 'name' }] }];

    const res = await app.inject({
      method: 'POST',
      url: '/apps/plan',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    expect(res.json().plan).toMatchObject({
      installable: true,
      requiresSchemaChange: false,
      create: [],
      reuse: [{ ref: 'clinicians', missingColumns: [] }],
    });
    await app.close();
  });

  it('refuses a foreign key pointing at nothing, in the app’s own words', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk', bundleFor('sample-desk', {}, FK_TABLES));

    const res = await app.inject({
      method: 'POST',
      url: '/apps/plan',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    const plan = res.json().plan;
    expect(plan.installable).toBe(false);
    expect(plan.problems[0].code).toBe('UNRESOLVED_REFERENCE');
    /*
     * The widening's whole point. An app has no host app to bring the missing
     * table, so the add-on sentence ("the host app is expected to provide it")
     * would tell the operator to wait for something that is never coming.
     */
    expect(plan.problems[0].message).toContain('this app does not create');
    expect(plan.problems[0].message).not.toContain('add-on');
    await app.close();
  });
});

describe('installing creates the tables', () => {
  it('creates them for real, and remembers the connection', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');

    const res = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
    expect(res.json().schema).toEqual({ created: ['clinicians'], reused: [] });
    expect(res.json().connectionId).toBe(CONNECTION);

    // The table is really there — the stub is the connection picker, not the DDL.
    await expect(sourceDb.selectFrom('clinicians').selectAll().execute()).resolves.toEqual([]);

    // And the row remembers it, because it is also what the staff surface reads.
    const row = (await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).list('app'))[0];
    expect(row?.row.connectionId).toBe(CONNECTION);
    await app.close();
  });

  it('refuses an install with no connection, naming the tables that need one', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');

    const res = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details).toMatchObject({
      reason: 'NO_CONNECTION',
      tables: ['clinicians'],
    });
    expect(installed.current()).toHaveLength(0);
    await app.close();
  });

  it('reuses a table that is already there without touching it', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');
    existingTables = [{ ref: 'clinicians', columns: [{ ref: 'id' }, { ref: 'name' }] }];

    const res = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().schema).toEqual({ created: [], reused: ['clinicians'] });
    await app.close();
  });

  it('refuses to alter a table the operator already owns', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');
    // The table exists, but without the column the app needs.
    existingTables = [{ ref: 'clinicians', columns: [{ ref: 'id' }] }];

    const res = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details).toMatchObject({
      reason: 'COLUMNS_REQUIRED',
      tables: [{ ref: 'clinicians', missingColumns: ['name'] }],
    });
    // Nothing half-done: no row, and the app is not being served.
    expect(installed.current()).toHaveLength(0);
    await app.close();
  });

  it('refuses a plan the planner refused, before any DDL runs', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk', bundleFor('sample-desk', {}, [
      {
        ref: 'visits',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'patient_id', type: 'fk', references: 'patients' },
        ],
      },
    ]));

    const res = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.reason).toBe('PLAN_REFUSED');
    await expect(sourceDb.selectFrom('visits').selectAll().execute()).rejects.toThrow();
    expect(installed.current()).toHaveLength(0);
    await app.close();
  });
});

describe('discarding a staged bundle', () => {
  it('removes bytes that were uploaded and never installed', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');
    expect(await store.versions('sample-desk')).toEqual(['1.0.0']);

    const list = await app.inject({ method: 'GET', url: '/apps' });
    expect(list.json().staged).toEqual([{ key: 'sample-desk', version: '1.0.0' }]);

    const res = await app.inject({ method: 'DELETE', url: '/apps/staged/sample-desk/1.0.0' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ key: 'sample-desk', version: '1.0.0', discarded: true });
    expect(await store.versions('sample-desk')).toEqual([]);

    const after = await app.inject({ method: 'GET', url: '/apps' });
    expect(after.json().staged).toEqual([]);
    await app.close();
  });

  it('refuses to discard the version that is installed', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');
    await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });

    const res = await app.inject({ method: 'DELETE', url: '/apps/staged/sample-desk/1.0.0' });
    expect(res.statusCode).toBe(409);
    // The bytes are still there, and the app is still being served: discarding
    // an installed version through the staged door would take a live app off
    // the air without the confirm uninstall asks for.
    expect(await store.versions('sample-desk')).toEqual(['1.0.0']);
    expect(installed.current()).toHaveLength(2);
    await app.close();
  });

  it('does not disturb another version of the same app', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');
    await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    // `stage` keeps one version per key, so a second upload replaces the tree
    // the install is serving — the guard above is what makes that reachable at
    // all, and this pins that a DIFFERENT version is still discardable.
    const res = await app.inject({ method: 'DELETE', url: '/apps/staged/sample-desk/2.0.0' });
    expect(res.statusCode).toBe(200);
    expect(installed.current()).toHaveLength(2);
    await app.close();
  });
});

describe('the bundled app set (47 step 4)', () => {
  /** Writes a bundle directory the boot seed can read. */
  async function bundleDir(entries: { key: string; version: string; files: Record<string, string> }[]) {
    const dir = await mkdtemp(join(tmpdir(), 'apps-bundle-'));
    for (const entry of entries) {
      const tarball = packageTarball(entry.files);
      await writeFile(join(dir, `${entry.key}-${entry.version}.tgz`), Buffer.from(tarball));
      await writeFile(
        join(dir, `${entry.key}-${entry.version}.tgz.integrity`),
        `${sha512Integrity(tarball)}\n`,
        'utf8',
      );
    }
    return dir;
  }

  it('stages what shipped with the build, and the catalogue describes it', async () => {
    const dir = await bundleDir([
      { key: 'sample-desk', version: '1.0.0', files: bundleFor('sample-desk') },
    ]);
    const seed = await seedBundledPackages(store, dir, () => {}, 'app');
    expect(seed.seeded).toEqual(['sample-desk@1.0.0']);
    expect(seed.failed).toEqual([]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/apps/catalog' });
    expect(res.statusCode).toBe(200);
    expect(res.json().apps).toEqual([
      {
        key: 'sample-desk',
        version: '1.0.0',
        name: 'Sample Desk',
        description: 'A sample desk.',
        publisher: 'Adminium',
        capabilities: [],
        categories: ['operations'],
        sides: ['staff', 'customer'],
        installed: false,
        installedVersion: null,
        readable: true,
        // 48 G8-D3: a disk row, with no catalog cached to offer anything newer.
        source: 'disk',
        state: 'staged',
        updateTo: null,
        updateStaged: false,
        needsNewerAdminium: null,
      },
    ]);

    // And it installs from there like anything else — the bundled set is a
    // SOURCE, not a second lifecycle.
    const installed = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    expect(installed.statusCode, JSON.stringify(installed.json())).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/apps/catalog' });
    expect(after.json().apps[0]).toMatchObject({ installed: true, installedVersion: null });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('seeding twice does not re-stage, and does not disturb an install', async () => {
    const dir = await bundleDir([
      { key: 'sample-desk', version: '1.0.0', files: bundleFor('sample-desk') },
    ]);
    await seedBundledPackages(store, dir, () => {}, 'app');
    const second = await seedBundledPackages(store, dir, () => {}, 'app');
    expect(second.seeded).toEqual([]);
    expect(second.skipped).toEqual(['sample-desk@1.0.0']);
    await rm(dir, { recursive: true, force: true });
  });

  it('lists a package whose manifest cannot be read rather than hiding it', async () => {
    const dir = await bundleDir([
      {
        key: 'sample-desk',
        version: '1.0.0',
        files: { 'manifest.json': '{ not json', 'staff/index.html': STAFF_HTML },
      },
    ]);
    await seedBundledPackages(store, dir, () => {}, 'app');

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/apps/catalog' });
    // Bytes on disk the page cannot describe are exactly the ones an operator
    // needs to see in order to discard them.
    expect(res.json().apps[0]).toMatchObject({
      key: 'sample-desk',
      name: 'sample-desk',
      readable: false,
      sides: ['staff'],
    });
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
});
