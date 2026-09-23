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
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  appTablesRepo,
  auditRepo,
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  manifestsRepo,
  pagesRepo,
  settingsRepo,
  snapshotsRepo,
  usersRepo,
  type MetaDb,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { createInstalledApps, surfacesOfInstalled, type InstalledApps } from '../src/apps/installed.js';
import { createAppStore, type AppStore } from '../src/apps/store.js';
import type { AppSchemaTarget } from '../src/apps/schema-target.js';
import { seedBundledPackages, sha512Integrity } from '../src/add-ons/store.js';
import { AddOnInstallError, applyInstall, type ExistingTable } from '../src/add-ons/install-ddl.js';
import { AppError, errorEnvelope, UnauthorizedError } from '../src/errors.js';
import { appRoutes } from '../src/routes/apps/index.js';
import { packageTarball } from './app-bundle-helpers.js';
import type { EditBody } from '../src/schema-ddl/programmatic.js';

/** Every schema edit the installer asked the (fake) target to make. */
const editCalls: EditBody[] = [];
/** What the fake target's edits are planned against. */
const EMPTY_MODEL = { tables: [], relations: [], enums: [] } as never;
import { makeEnv } from './helpers.js';

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
      minAdminiumVersion: '0.1.0',
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
/** Every table-name set a plan asked the live database for. */
let readNames: Set<string>[] = [];
/** When set, the fake target fails right after creating this table (once). */
let failAfterTable: string | null = null;
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
        .list('app')).map((m) => ({ key: m.row.manifestKey, version: m.row.version, status: m.row.status })),
  });
  anonymous = false;
  directoryKeys = [];
  existingTables = [];
  readNames = [];
  failAfterTable = null;
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
async function buildApp(serverVersion = '0.3.0') {
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
      // Pinned so a declared minimum is asserted against a version this file
      // states, not against whatever the build happens to be.
      serverVersion,
      /*
       * The REAL `applyInstall`, against a real (in-memory) source database —
       * only the connection-picking half is stubbed out, the same split
       * `add-on-routes.test.ts` makes. A recording stub would turn every
       * "the table was created" assertion into a claim about a claim.
       */
      schemaTarget: {
        read: async (_connectionId, names) => {
          readNames.push(new Set(names));
          return {
            tables: existingTables.map((table) => ({ ...table, columns: [...table.columns] })),
            dialect: 'sqlite' as const,
          };
        },
        edit: async (_connectionId, build) => {
          editCalls.push(build(EMPTY_MODEL));
          return { changeId: 'chg_test', status: 'applied' } as never;
        },
        planEdit: () => Promise.reject(new Error('no schema editor in this suite')),
        apply: async (plan, manifest, _connectionId, _existing, onCreated) =>
          applyInstall({
            plan,
            tables: manifest.requiredSchema?.tables ?? [],
            db: sourceDb,
            dialect: 'sqlite',
            existing: existingTables,
            onCreated: async (ref) => {
              await onCreated?.(ref);
              // Fault injection: the database gives out after this table.
              if (failAfterTable === ref) {
                failAfterTable = null;
                throw new AddOnInstallError('DDL_FAILED', 'the connection dropped', 'visits');
              }
            },
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

  it('opens the staff screens where the manifest asks, unless the operator already chose', async () => {
    const app = await buildApp();
    const manifest = manifestFor('sample-desk');
    manifest['frontends'] = [
      { side: 'staff', kind: 'spa', entry: 'index.html', placement: 'external' },
      { side: 'customer', kind: 'spa', entry: 'index.html' },
    ];
    await upload(app, 'sample-desk', { ...bundleFor('sample-desk'), 'manifest.json': JSON.stringify(manifest) });
    const payload = { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION };
    expect((await app.inject({ method: 'POST', url: '/apps/install', payload })).statusCode).toBe(200);
    expect((await settingsRepo(meta).get('surfaces.apps'))['sample-desk']?.staff).toBe('external');

    // The operator moves it back in; a reinstall leaves their choice alone.
    await settingsRepo(meta).set('surfaces.apps', { 'sample-desk': { staff: 'internal' } });
    expect((await app.inject({ method: 'DELETE', url: '/apps/sample-desk' })).statusCode).toBe(200);
    await settingsRepo(meta).set('surfaces.apps', { 'sample-desk': { staff: 'internal' } });
    await upload(app, 'sample-desk', { ...bundleFor('sample-desk'), 'manifest.json': JSON.stringify(manifest) });
    expect((await app.inject({ method: 'POST', url: '/apps/install', payload })).statusCode).toBe(200);
    expect((await settingsRepo(meta).get('surfaces.apps'))['sample-desk']?.staff).toBe('internal');
    await app.close();
  });

  it('refuses a bundle that needs a newer Adminium, and stages nothing', async () => {
    /*
     * `/apps/download` has checked the declared minimum since the app feed
     * grew the field, and this route never did — so the release the
     * catalogue refuses installed without a word as a file, which is the
     * route an operator reaches for precisely when the catalogue has said no.
     */
    const app = await buildApp('0.2.9');
    const files = {
      ...bundleFor('sample-desk'),
      'manifest.json': JSON.stringify({
        ...manifestFor('sample-desk'),
        compatibility: { minAdminiumVersion: '0.3.0', engines: ['sqlite'] },
      }),
    };
    const res = await upload(app, 'sample-desk', files);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      message: expect.stringContaining('needs Adminium 0.3.0 or later; this server is 0.2.9'),
      details: {
        reason: 'REQUIRES_NEWER_ADMINIUM',
        minAdminiumVersion: '0.3.0',
        serverVersion: '0.2.9',
      },
    });
    expect(await store.keys()).toEqual([]);

    const rows = await auditRepo(meta).list({ category: 'app', limit: 10 });
    expect(
      rows.map((row) => ({ action: row.action, ...(row.changes as { after: object }).after })),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'app.unpack-refused',
          key: 'sample-desk',
          reason: 'REQUIRES_NEWER_ADMINIUM',
        }),
      ]),
    );
    await app.close();
  });

  it('names the Adminium it needs, not "not valid", when a newer manifest uses fields this server lacks', async () => {
    const app = await buildApp('0.2.9');
    const newer = {
      ...manifestFor('sample-desk'),
      compatibility: { minAdminiumVersion: '0.4.0', engines: ['sqlite'] },
      // A field a later release adds; every block here is strict.
      fieldFromTheFuture: { enabled: true },
    };
    const res = await upload(app, 'sample-desk', { ...bundleFor('sample-desk'), 'manifest.json': JSON.stringify(newer) });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('needs Adminium 0.4.0 or later; this server is 0.2.9');
    expect(res.json().error.details).toMatchObject({ reason: 'REQUIRES_NEWER_ADMINIUM' });

    // The same unknown field on a manifest this server CAN take is plainly invalid.
    const broken = { ...newer, compatibility: { minAdminiumVersion: '0.1.0', engines: ['sqlite'] } };
    const res2 = await upload(app, 'sample-desk', { ...bundleFor('sample-desk'), 'manifest.json': JSON.stringify(broken) });
    expect(res2.statusCode).toBe(422);
    expect(res2.json().error.message).toContain('is not valid');
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

  it('uninstall still completes when the files cannot be removed, and says so in the audit', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');
    await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    const spy = vi.spyOn(store, 'removeKey').mockRejectedValueOnce(new Error('EBUSY'));
    const res = await app.inject({ method: 'DELETE', url: '/apps/sample-desk' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ key: 'sample-desk', uninstalled: true, dropped: [] });
    expect(installed.current()).toHaveLength(0);
    const [entry] = await meta.db
      .selectFrom('adminium_audit_log')
      .select(['changes'])
      .where('action', '=', 'app.uninstalled')
      .execute();
    const changes = typeof entry?.changes === 'string' ? JSON.parse(entry.changes) : entry?.changes;
    expect(changes).toMatchObject({ after: { key: 'sample-desk', filesRemoved: false } });
    spy.mockRestore();
    await app.close();
  });

  it("uninstall forgets the app's placement and domains, and nothing else's", async () => {
    // Left behind, a host mapped to a key nothing serves makes the domains
    // editor refuse EVERY later save — including the one mapping that host to
    // the app installed in its place (a sandboxy droplet, clients → pos).
    const app = await buildApp();
    await upload(app, 'sample-desk');
    await app.inject({ method: 'POST', url: '/apps/install', payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION } });
    const settings = settingsRepo(meta);
    await settings.set('surfaces.apps', {
      'sample-desk': { staff: 'external', name: 'Desk' },
      other: { staff: 'internal' },
    });
    await settings.set('surfaces.domains', {
      'desk.example.com': { appKey: 'sample-desk', side: 'customer' },
      'staff.example.com': { appKey: 'sample-desk', side: 'staff' },
      'other.example.com': { appKey: 'other', side: 'customer' },
    });

    const res = await app.inject({ method: 'DELETE', url: '/apps/sample-desk' });
    expect(res.statusCode).toBe(200);
    expect(await settings.get('surfaces.apps')).toEqual({ other: { staff: 'internal' } });
    expect(await settings.get('surfaces.domains')).toEqual({
      'other.example.com': { appKey: 'other', side: 'customer' },
    });
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

  it('asks what to do with a table that is already there, and reuses it when told to', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');
    existingTables = [{ ref: 'clinicians', columns: [{ ref: 'id' }, { ref: 'name' }] }];

    // The name is taken and nothing records it as this app's: the check step asks.
    const asked = await app.inject({
      method: 'POST',
      url: '/apps/plan',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    expect(asked.json().plan).toMatchObject({
      installable: false,
      problems: [expect.objectContaining({ code: 'TABLE_TAKEN', table: 'clinicians' })],
      tables: [expect.objectContaining({ ref: 'clinicians', class: 'taken', action: 'undecided' })],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/apps/plan',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION, choices: { clinicians: { action: 'reuse' } } },
    });
    expect(res.json().plan).toMatchObject({
      installable: true,
      requiresSchemaChange: false,
      create: [],
      reuse: [{ ref: 'clinicians', missingColumns: [] }],
    });
    await app.close();
  });

  it('refuses a page whose form or layout names what the app never declared', async () => {
    const app = await buildApp();
    const manifest = manifestFor('sample-desk');
    manifest['pages'] = [
      {
        ref: 'sample-clinicians',
        template: 'page-crud',
        title: { key: 'mft.sample.page.clinicians', fallback: 'Clinicians' },
        nav: { group: 'manage', icon: 'users', order: 1 },
        bindings: { rows: 'clinicians' },
        config: { form: { v: 2, sections: [{ id: 'who', fields: [{ column: 'name' }, { column: 'grade' }] }] } },
      },
      {
        ref: 'sample-overview',
        template: 'page-dashboard',
        title: { key: 'mft.sample.page.overview', fallback: 'Overview' },
        nav: { group: 'manage', icon: 'gauge', order: 0 },
        config: {
          layout: {
            version: 1,
            items: [{ i: 'k', widget: 'kpi-stat', x: 0, y: 0, w: 3, h: 2, config: { query: { source: { name: 'invoices' }, shape: 'scalar' } } }],
          },
        },
      },
    ];
    await upload(app, 'sample-desk', { ...bundleFor('sample-desk'), 'manifest.json': JSON.stringify(manifest) });
    const res = await app.inject({
      method: 'POST',
      url: '/apps/plan',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    const plan = res.json().plan;
    expect(plan.installable).toBe(false);
    expect(plan.problems.filter((p: { code: string }) => p.code === 'PAGE_FORM_INVALID')).toEqual([
      { code: 'PAGE_FORM_INVALID', table: 'sample-clinicians', message: 'The page "sample-clinicians": "clinicians" has no column "grade".' },
      {
        code: 'PAGE_FORM_INVALID',
        table: 'sample-overview',
        message: 'The page "sample-overview": its layout reads "invoices", which is not a table of the app.',
      },
    ]);
    await app.close();
  });

  it('refuses a role that would hand out the console', async () => {
    const app = await buildApp();
    const manifest = manifestFor('sample-desk');
    manifest['roles'] = [{ key: 'desk', name: 'Desk', permissions: ['table:@clinicians:read', 'system:users:manage'] }];
    await upload(app, 'sample-desk', { ...bundleFor('sample-desk'), 'manifest.json': JSON.stringify(manifest) });
    const plan = (
      await app.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION } })
    ).json().plan;
    expect(plan.installable).toBe(false);
    expect(plan.problems).toContainEqual({
      code: 'ROLE_INVALID',
      table: 'desk',
      message: 'The role "desk": "system:users:manage" gives a console permission, which an app cannot.',
    });
    await app.close();
  });

  it('reads only the tables the manifest names, and its foreign keys point at', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk', bundleFor('sample-desk', {}, FK_TABLES));
    await app.inject({
      method: 'POST',
      url: '/apps/plan',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    expect(readNames.at(-1)).toEqual(new Set(['clinicians', 'visits', 'patients']));
    await app.close();
  });

  it('refuses an install whose database changed since the reviewed plan (SCHEMA_DRIFT)', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');
    const planned = await app.inject({
      method: 'POST',
      url: '/apps/plan',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    const checksum = planned.json().plan.checksum as string;
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);

    // Somebody creates the table between the check and the click.
    existingTables = [{ ref: 'clinicians', columns: [{ ref: 'id' }, { ref: 'name' }] }];
    const res = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION, planChecksum: checksum },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SCHEMA_DRIFT');
    expect(installed.current()).toHaveLength(0);

    // The re-checked plan — now asking about the table that appeared — installs.
    const again = await app.inject({
      method: 'POST',
      url: '/apps/plan',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION, choices: { clinicians: { action: 'reuse' } } },
    });
    const ok = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: {
        key: 'sample-desk',
        version: '1.0.0',
        connectionId: CONNECTION,
        planChecksum: again.json().plan.checksum,
        choices: { clinicians: { action: 'reuse' } },
      },
    });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  it("refuses on the check step a page slug another app holds here (no takeover)", async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');
    const first = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    expect(first.statusCode).toBe(200);

    // A different app declaring the same page, on the same database.
    existingTables = [];
    await upload(app, 'other-desk');
    const res = await app.inject({
      method: 'POST',
      url: '/apps/plan',
      payload: { key: 'other-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    const plan = res.json().plan;
    expect(plan.installable).toBe(false);
    expect(plan.problems).toContainEqual(
      expect.objectContaining({ code: 'PAGE_SLUG_TAKEN', table: 'sample-dashboard' }),
    );
    expect(plan.problems.find((p: { code: string }) => p.code === 'PAGE_SLUG_TAKEN').message).toContain(
      '"sample-desk"',
    );
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

describe('an install that stops part way', () => {
  const TWO = [
    { ref: 'clinicians', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text' }] },
    {
      ref: 'visits',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'clinician_id', type: 'fk', references: 'clinicians' },
      ],
    },
  ];

  it('says where it stopped, serves nothing, and finishes when posted again', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk', bundleFor('sample-desk', {}, TWO));
    failAfterTable = 'clinicians';

    const body = { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION };
    const res = await app.inject({ method: 'POST', url: '/apps/install', payload: body });
    expect(res.statusCode).toBe(409);
    const error = res.json().error;
    expect(error.code).toBe('APP_INSTALL_INCOMPLETE');
    expect(error.details).toMatchObject({ stage: 'tables', table: 'visits', created: ['clinicians'], pending: ['visits'] });
    expect(error.message).toContain('Install it again');

    // Recorded, audited, and not served.
    const row = await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).findByKey('sample-desk');
    expect(row?.row.status).toBe('installing');
    expect(installed.current()).toHaveLength(0);
    const audit = await meta.db
      .selectFrom('adminium_audit_log')
      .select(['action'])
      .where('action', '=', 'app.install-failed')
      .execute();
    expect(audit).toHaveLength(1);

    // The same POST resumes: the first table is found, still this app's own.
    existingTables = [{ ref: 'clinicians', columns: [{ ref: 'id', isPrimaryKey: true }, { ref: 'name' }] }];
    const again = await app.inject({ method: 'POST', url: '/apps/install', payload: body });
    expect(again.statusCode).toBe(200);
    const done = await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).findByKey('sample-desk');
    expect(done?.row.status).toBe('installed');
    expect(done?.row.id).toBe(row?.row.id);
    expect(installed.current().map((s) => s.appKey)).toContain('sample-desk');

    const records = await appTablesRepo(meta).forInstall(CONNECTION, 'sample-desk');
    expect(records.map((r) => [r.ref, r.state, r.owned])).toEqual([
      ['clinicians', 'created', true],
      ['visits', 'created', true],
    ]);
    await app.close();
  });

  it('records a table it found as adopted, never as its own', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');
    existingTables = [{ ref: 'clinicians', columns: [{ ref: 'id' }, { ref: 'name' }] }];
    const res = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION, choices: { clinicians: { action: 'reuse' } } },
    });
    expect(res.statusCode).toBe(200);
    const [record] = await appTablesRepo(meta).forInstall(CONNECTION, 'sample-desk');
    expect(record).toMatchObject({ ref: 'clinicians', state: 'adopted', owned: false });
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

  it('reuses a table that is already there, when told to, without touching it', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');
    existingTables = [{ ref: 'clinicians', columns: [{ ref: 'id' }, { ref: 'name' }] }];
    editCalls.length = 0;

    const res = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION, choices: { clinicians: { action: 'reuse' } } },
    });
    expect(editCalls).toEqual([]);
    expect(res.statusCode).toBe(200);
    expect(res.json().schema).toEqual({ created: [], reused: ['clinicians'] });
    await app.close();
  });

  it('asks first, then adapts a reused table by adding the column it lacks (nullable)', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk');
    // The table exists, but without the column the app needs.
    existingTables = [{ ref: 'clinicians', columns: [{ ref: 'id' }] }];
    editCalls.length = 0;

    const unanswered = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    expect(unanswered.statusCode).toBe(422);
    expect(unanswered.json().error.details.problems).toEqual([
      expect.objectContaining({ code: 'TABLE_TAKEN', table: 'clinicians' }),
    ]);
    // Nothing half-done: no row, and the app is not being served.
    expect(installed.current()).toHaveLength(0);
    expect(editCalls).toEqual([]);

    // "Use it and keep its data": the missing column is added through the
    // schema editor's own door — always nullable, because the table has rows.
    const res = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION, choices: { clinicians: { action: 'reuse' } } },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(editCalls).toEqual([
      {
        addColumns: [
          { table: 'clinicians', column: expect.objectContaining({ name: 'name', logicalType: 'text', nullable: true }) },
        ],
        alterColumns: [],
      },
    ]);
    await app.close();
  });

  it('offers the missing columns on the preview, and blocks the ones it cannot type', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk', bundleFor('sample-desk', {}, [
      {
        ref: 'clinicians',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'name', type: 'text' },
          { ref: 'fee', type: 'money' },
          { ref: 'tier', type: 'enum', enum: ['junior', 'senior'] },
          { ref: 'clinic_id', type: 'fk', references: 'clinicians' },
        ],
      },
    ]));
    existingTables = [{ ref: 'clinicians', columns: [{ ref: 'id' }, { ref: 'name' }] }];

    const res = await app.inject({
      method: 'POST',
      url: '/apps/plan',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION, choices: { clinicians: { action: 'reuse' } } },
    });
    expect(res.statusCode, res.body).toBe(200);
    const edit = res.json().plan.missingColumnsEdit;
    expect(edit.addColumns.map((entry: { column: { name: string } }) => entry.column.name)).toEqual([
      'fee',
      'tier',
    ]);
    // Money is the installer's own decimal(19,4), never a float.
    expect(edit.addColumns[0].column).toMatchObject({
      logicalType: 'decimal',
      numericPrecision: 19,
      numericScale: 4,
    });
    // An enum is as wide as the installer makes one — 32, which the
    // workflow-status rule reads — not a width only an update would add.
    expect(edit.addColumns[1].column).toMatchObject({ logicalType: 'varchar', maxLength: 32 });
    // An enum's values ride the override channel after the column exists.
    expect(edit.values).toEqual([{ table: 'clinicians', column: 'tier', values: ['junior', 'senior'] }]);
    // A foreign key's type is its target's — not guessed.
    expect(edit.blocked).toEqual([{ table: 'clinicians', column: 'clinic_id', reason: 'foreign-key' }]);
    await app.close();
  });

  it('writes the manifest\'s pages on install, and the preview names the unbound ones', async () => {
    const app = await buildApp();
    const tables = [
      {
        ref: 'visits',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'reason', type: 'text' },
          { ref: 'starts_at', type: 'timestamptz' },
        ],
      },
    ];
    const pages = [
      {
        ref: 'sample-day',
        template: 'page-calendar',
        title: { key: 'mft.sample.page.day', fallback: 'Day' },
        nav: { group: 'manifest:sample', icon: 'calendar', order: 1 },
        bindings: { rows: 'visits' },
      },
      {
        ref: 'sample-list',
        template: 'page-crud',
        title: { key: 'mft.sample.page.list', fallback: 'List' },
        nav: { group: 'library', icon: 'table', order: 2 },
      },
    ];
    await upload(app, 'sample-desk', {
      ...bundleFor('sample-desk', {}, tables),
      'manifest.json': JSON.stringify({ ...manifestFor('sample-desk', tables), pages }),
    });

    const preview = await app.inject({
      method: 'POST',
      url: '/apps/plan',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    expect(preview.json().plan.pageWarnings.map((w: { page: string; code: string }) => [w.page, w.code])).toEqual([
      ['sample-list', 'PAGE_UNBOUND'],
    ]);

    // What the real schema target does after creating the tables: re-read them.
    await snapshotsRepo(meta).create({
      connectionId: CONNECTION,
      source: 'introspection',
      checksum: 'sha-sample',
      schema: {
        dialect: 'sqlite',
        name: 'practice',
        defaultSchema: 'main',
        schemas: ['main'],
        tables: [
          {
            schema: 'main',
            name: 'visits',
            columns: [
              { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
              { name: 'reason', logicalType: 'text' },
              { name: 'starts_at', logicalType: 'timestamp' },
            ],
            primaryKey: ['id'],
          },
        ],
        relations: [],
        enums: [],
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    expect(res.statusCode, res.body).toBe(200);
    // An unbound page does not refuse the install: it is created and reported.
    expect(res.json().pages).toMatchObject({
      created: ['sample-day', 'sample-list'],
      warnings: [{ page: 'sample-list', reason: 'PAGE_UNBOUND' }],
    });
    const day = await pagesRepo(meta).findBySlug(CONNECTION, 'sample-day');
    expect((day?.config as { source: { table: string } }).source.table).toBe('main.visits');
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

describe('one app’s own settings', () => {
  const WITH_SETTINGS = {
    'manifest.json': JSON.stringify({
      ...manifestFor('sample-desk'),
      settings: [
        { key: 'business_type', type: 'enum', enum: ['restaurant', 'retail'], default: 'restaurant' },
        { key: 'tables', type: 'number', min: 1, max: 200 },
      ],
    }),
  };

  async function installedApp() {
    const app = await buildApp();
    await upload(app, 'sample-desk', bundleFor('sample-desk', WITH_SETTINGS));
    const res = await app.inject({
      method: 'POST',
      url: '/apps/install',
      payload: { key: 'sample-desk', version: '1.0.0', connectionId: CONNECTION },
    });
    expect(res.statusCode, res.body).toBe(200);
    return app;
  }

  it('reads with defaults, writes only what was sent, and checks values against the manifest', async () => {
    const app = await installedApp();
    const read = await app.inject({ method: 'GET', url: '/apps/sample-desk/settings' });
    expect(read.json()).toEqual({
      key: 'sample-desk',
      name: null,
      placement: 'internal',
      connectionId: null,
      off: [],
      values: { business_type: 'restaurant', tables: null },
      domains: {},
      declared: [
        { key: 'business_type', type: 'enum', enum: ['restaurant', 'retail'] },
        { key: 'tables', type: 'number', min: 1, max: 200 },
      ],
    });

    const patched = await app.inject({
      method: 'PATCH',
      url: '/apps/sample-desk/settings',
      payload: { name: 'Till', off: ['customer'], values: { business_type: 'retail', tables: 12 } },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json()).toMatchObject({ name: 'Till', placement: 'internal', off: ['customer'] });
    expect(patched.json().values).toEqual({ business_type: 'retail', tables: 12 });
    expect(await settingsRepo(meta).get('surfaces.apps')).toEqual({ 'sample-desk': { name: 'Till', off: ['customer'] } });

    // Only what was sent moves.
    await app.inject({ method: 'PATCH', url: '/apps/sample-desk/settings', payload: { placement: 'external' } });
    expect(await settingsRepo(meta).get('surfaces.apps')).toEqual({
      'sample-desk': { name: 'Till', off: ['customer'], staff: 'external' },
    });

    for (const values of [{ business_type: 'cinema' }, { tables: 0 }, { tables: 'many' }]) {
      const bad = await app.inject({ method: 'PATCH', url: '/apps/sample-desk/settings', payload: { values } });
      expect(bad.statusCode, JSON.stringify(values)).toBe(422);
    }
    const noConnection = await app.inject({
      method: 'PATCH',
      url: '/apps/sample-desk/settings',
      payload: { connectionId: 'con_nope' },
    });
    expect(noConnection.statusCode).toBe(422);

    // Null goes back to the default.
    const cleared = await app.inject({
      method: 'PATCH',
      url: '/apps/sample-desk/settings',
      payload: { name: null, off: [], values: { business_type: null } },
    });
    expect(cleared.json()).toMatchObject({ name: null, off: [], values: { business_type: 'restaurant', tables: 12 } });
    await app.close();
  });

  it('switches the app off and on, and says so in the list', async () => {
    const app = await installedApp();
    const off = await app.inject({ method: 'POST', url: '/apps/sample-desk/disable' });
    expect(off.json()).toEqual({ key: 'sample-desk', status: 'disabled' });
    const list = (await app.inject({ method: 'GET', url: '/apps' })).json();
    expect(list.apps[0].status).toBe('disabled');
    expect(list.apps[0].sides.map((s: { state: string }) => s.state)).toEqual(['disabled', 'disabled']);
    // Switched off, not removed: its files still serve the "not available" answer.
    expect(installed.current().map((s) => s.appKey)).toContain('sample-desk');

    // Asking twice is not an error.
    expect((await app.inject({ method: 'POST', url: '/apps/sample-desk/disable' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/apps/sample-desk/enable' })).json().status).toBe('installed');
    const back = (await app.inject({ method: 'GET', url: '/apps' })).json();
    expect(back.apps[0].sides.map((s: { state: string; openUrl: string }) => [s.state, s.openUrl])).toEqual([
      ['on', '/apps/sample-desk/staff/'],
      ['on', '/apps/sample-desk/customer/'],
    ]);
    await app.close();
  });

  it('refuses a switch on an install that stopped part way', async () => {
    const app = await installedApp();
    const row = (await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).list('app'))[0]!;
    await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).setStatus(row.row.id, 'installing');
    expect((await app.inject({ method: 'POST', url: '/apps/sample-desk/disable' })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/apps/sample-desk/enable' })).statusCode).toBe(409);
    await app.close();
  });

  it('maps this app’s hosts and leaves every other app’s alone', async () => {
    const app = await installedApp();
    await settingsRepo(meta).set('surfaces.domains', { 'other.example.test': { appKey: 'other', side: 'customer' } });
    const put = await app.inject({
      method: 'PUT',
      url: '/apps/sample-desk/domains',
      payload: { domains: { 'Shop.Example.Test': { side: 'customer' } } },
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json()).toEqual({ domains: { 'shop.example.test': { side: 'customer' } } });
    expect(await settingsRepo(meta).get('surfaces.domains')).toEqual({
      'other.example.test': { appKey: 'other', side: 'customer' },
      'shop.example.test': { appKey: 'sample-desk', side: 'customer' },
    });

    const taken = await app.inject({
      method: 'PUT',
      url: '/apps/sample-desk/domains',
      payload: { domains: { 'other.example.test': { side: 'customer' } } },
    });
    expect(taken.statusCode).toBe(422);
    expect(taken.body).toContain('host_taken');

    // An empty list unmaps this app's hosts, and only them.
    await app.inject({ method: 'PUT', url: '/apps/sample-desk/domains', payload: { domains: {} } });
    expect(await settingsRepo(meta).get('surfaces.domains')).toEqual({
      'other.example.test': { appKey: 'other', side: 'customer' },
    });
    await app.close();
  });

  it('shows the app’s tables and its own activity, newest first', async () => {
    const app = await installedApp();
    await app.inject({ method: 'POST', url: '/apps/sample-desk/disable' });
    const overview = (await app.inject({ method: 'GET', url: '/apps/sample-desk/overview' })).json();
    expect(overview.connection).toMatchObject({ id: CONNECTION });
    expect(overview.tables.map((t: { ref: string; table: string }) => [t.ref, t.table])).toEqual([
      ['clinicians', 'clinicians'],
    ]);
    expect(overview.activity.map((a: { action: string }) => a.action)).toEqual([
      'app.disabled',
      'app.installed',
      'app.staged',
    ]);
    await app.close();
  });

  it('keeps an instance a host still opens', async () => {
    const app = await installedApp();
    const put = await app.inject({
      method: 'PUT',
      url: '/apps/sample-desk/instances',
      payload: { instances: [{ slug: 'north', connectionId: CONNECTION }] },
    });
    expect(put.statusCode, put.body).toBe(200);
    await app.inject({
      method: 'PUT',
      url: '/apps/sample-desk/domains',
      payload: { domains: { 'north.example.test': { side: 'customer', instance: 'north' } } },
    });
    const drop = await app.inject({ method: 'PUT', url: '/apps/sample-desk/instances', payload: { instances: [] } });
    expect(drop.statusCode).toBe(422);
    expect(drop.body).toContain('instance_in_use');
    await app.close();
  });
});
