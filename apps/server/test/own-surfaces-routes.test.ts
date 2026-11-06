// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's own screens as a file, both ways, through the real routes.
 *
 *  - Download packs a project app at a version never below its folder's,
 *    writes a higher one back first, carries the folder as `source/`
 *    without what runs, says where it was made, and keeps the file to fetch.
 *  - The file uploads and installs like any package; `source/` is never
 *    served.
 *  - Make it editable here copies that source into this server's project
 *    folder, and from then on the key is the folder's: a newer file of it is
 *    refused. It is refused, copying nothing, without a project folder, over
 *    a folder that exists, and while the app is on two databases.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditRepo, manifestsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { readAddOnTarball } from '../src/add-ons/archive.js';
import { sha512Integrity } from '../src/add-ons/store.js';
import type { FolderApp } from '../src/apps/app-files.js';
import { runCli } from '../src/cli/run.js';
import { ownSurfaceRoutes, type OwnSurfaceRoutesDeps } from '../src/routes/apps/own-surfaces.js';
import { packageTarball } from './app-bundle-helpers.js';
import { ENGINES, installHarness, type Harness } from './app-install-harness.js';
import { canBuildSides, tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';
import { TEST_SECRET } from './helpers.js';

const PLAIN = { encrypt: (v: string) => v, decrypt: (v: string) => v };

/** A self-made app with pages and no screens of its own: it checks and packs without a bundler. */
function shopManifest(version = '1.0.0', publisher = { id: 'local', name: 'Fernhill' }): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Fernhill Shop',
    version,
    publisher,
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'The shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.1.0' },
    requiredSchema: { prefixed: true, tables: [{ ref: 'items', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }] }] },
    pages: [{ ref: 'shop-items', template: 'page-crud', title: { key: 'i', fallback: 'Items' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'items' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
  };
}

const write = (root: string, path: string, body: string): void => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), body);
};

/** A project folder holding `apps/shop/`, with a file of each kind the source leaves out. */
function sourceProject(manifest: Record<string, unknown> = shopManifest()): string {
  const root = mkdtempSync(join(tmpdir(), 'own-surfaces-src-'));
  write(root, 'adminium.config.ts', 'export default {};\n');
  write(root, 'apps/shop/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  write(root, 'apps/shop/build.json', '{"steps":["rm -rf /"]}');
  write(root, 'apps/shop/vite.config.ts', 'export default {};');
  write(root, 'apps/shop/package.json', JSON.stringify({ name: 'shop', private: true, scripts: { postinstall: 'node evil.js' }, dependencies: { react: '18.3.1' } }));
  write(root, 'apps/shop/assets/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  write(root, 'apps/shop/.env', 'SECRET=1');
  write(root, 'apps/shop/seeds/sample.json', JSON.stringify({ format: 'adminium.sample/1', app: 'shop', tables: [] }));
  return root;
}

let open: Harness | null = null;
const folders: string[] = [];
async function closeOpen(): Promise<void> {
  await open?.close();
  open = null;
}
afterEach(async () => {
  await closeOpen();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

interface Reply {
  statusCode: number;
  body: string;
  rawPayload: Buffer;
  headers: Record<string, string | undefined>;
}

/** The harness's app routes, and these beside them. */
async function harness(dialect: Parameters<typeof installHarness>[0], extra: Partial<OwnSurfaceRoutesDeps> & { projectRoot: string | null; folder?: () => readonly FolderApp[] }) {
  const { folder, ...rest } = extra;
  const h = (open = await installHarness(dialect, {
    ...(folder === undefined ? {} : { folder }),
    routes: (deps) => [ownSurfaceRoutes({ meta: deps.meta, store: deps.store, adminiumVersion: '0.4.0', masterSecret: TEST_SECRET, displayName: async () => 'Fernhill main', ...rest })],
  }));
  const send = async (request: { method: 'GET' | 'POST'; url: string; payload?: unknown; headers?: Record<string, string> }): Promise<Reply> =>
    (await h.inject(request as never)) as unknown as Reply;
  const upload = async (tarball: Uint8Array): Promise<Reply> =>
    send({
      method: 'POST',
      url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from(tarball),
    });
  return { h, send, upload };
}

const reasonOf = (reply: Reply): unknown => (JSON.parse(reply.body) as { error: { details?: { reason?: unknown } } }).error.details?.reason;

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`an app's own screens as a file [${dialect}]`, () => {
    it('packs at a version never below the folder’s, writes a higher one back, and carries the source without what runs', async () => {
      const root = sourceProject();
      folders.push(root);
      const { h, send } = await harness(dialect, { projectRoot: root });

      const below = await send({ method: 'POST', url: '/project/apps/shop/pack', payload: { version: '0.9.0' } });
      expect(below.statusCode, below.body).toBe(422);
      expect(JSON.parse(below.body).error.details).toMatchObject({ reason: 'VERSION_BELOW', manifestVersion: '1.0.0' });

      const packed = await send({ method: 'POST', url: '/project/apps/shop/pack', payload: { version: '1.2.0' } });
      expect(packed.statusCode, packed.body).toBe(200);
      const reply = JSON.parse(packed.body) as { key: string; version: string; fileName: string; bytes: number; integrity: string; fileCount: number };
      expect(reply).toMatchObject({ key: 'shop', version: '1.2.0', fileName: 'shop-1.2.0.tgz' });
      // Written back first, so the file's name and its manifest agree.
      expect(JSON.parse(readFileSync(join(root, 'apps/shop/manifest.json'), 'utf8')).version).toBe('1.2.0');

      const file = await send({ method: 'GET', url: '/project/apps/shop/pack/1.2.0' });
      expect(file.statusCode).toBe(200);
      expect(file.headers['content-type']).toBe('application/gzip');
      expect(file.headers['content-disposition']).toBe('attachment; filename="shop-1.2.0.tgz"');
      const bytes = new Uint8Array(file.rawPayload);
      expect(bytes.byteLength).toBe(reply.bytes);
      expect(sha512Integrity(bytes)).toBe(reply.integrity);
      expect(file.headers['x-adminium-integrity']).toBe(reply.integrity);

      const entries = Object.fromEntries(readAddOnTarball(bytes).map((entry) => [entry.path, Buffer.from(entry.bytes).toString('utf8')]));
      const paths = Object.keys(entries).sort();
      expect(paths).toEqual(['manifest.json', 'seeds/sample.json', 'source/assets/logo.svg', 'source/lineage.json', 'source/manifest.json', 'source/package.json']);
      expect(reply.fileCount).toBe(paths.length);
      expect(JSON.parse(entries['source/package.json'] as string)).toEqual({ name: 'shop', private: true, dependencies: { react: '18.3.1' } });
      // Where it was made: the server's name, the running Adminium, a lineage kept in the folder.
      const manifest = JSON.parse(entries['manifest.json'] as string) as { version: string; provenance: Record<string, unknown>; compatibility: { minAdminiumVersion: string } };
      const lineage = (JSON.parse(readFileSync(join(root, 'apps/shop/lineage.json'), 'utf8')) as { lineage: string }).lineage;
      expect(manifest.version).toBe('1.2.0');
      expect(manifest.provenance).toMatchObject({ label: 'Fernhill main', adminiumVersion: '0.4.0', lineage });
      expect(manifest.compatibility.minAdminiumVersion).toBe('0.3.49');

      // The next Download keeps the lineage: a newer file of the same app.
      const again = await send({ method: 'POST', url: '/project/apps/shop/pack', payload: { version: '1.2.0' } });
      expect(again.statusCode, again.body).toBe(200);
      const second = new Uint8Array((await send({ method: 'GET', url: '/project/apps/shop/pack/1.2.0' })).rawPayload);
      const secondManifest = JSON.parse(Buffer.from(readAddOnTarball(second).find((entry) => entry.path === 'manifest.json')!.bytes).toString('utf8')) as { provenance: { lineage: string } };
      expect(secondManifest.provenance.lineage).toBe(lineage);

      expect((await send({ method: 'GET', url: '/project/apps/shop/pack/9.9.9' })).statusCode).toBe(404);
      const missing = await send({ method: 'POST', url: '/project/apps/nope/pack', payload: { version: '1.0.0' } });
      expect(missing.statusCode).toBe(404);
      expect(reasonOf(missing)).toBe('NOT_A_PROJECT_APP');
      const audits = await auditRepo(h.meta).list({ category: 'app' });
      // Each Download is said: what was packed, never what is in it.
      const said = audits.filter((entry) => entry.action === 'app.packed').map((entry) => entry.changes);
      expect(said).toHaveLength(2);
      expect(said).toContainEqual({ after: { key: 'shop', version: '1.2.0', integrity: reply.integrity, bytes: reply.bytes } });
    }, 120_000);

    it('refuses a file that would carry a secret of this server or an id of it, naming the file and the line', async () => {
      const root = sourceProject();
      folders.push(root);
      const envValue = 'shop-provider-key-not-real-8c41f07d';
      write(root, '.env', `SHOP_PROVIDER_KEY=${envValue}\n`);
      write(root, 'apps/shop/src/api.ts', `export const base = '/api';\n\nexport const key = '${envValue}';\n`);
      const { h, send } = await harness(dialect, { projectRoot: root, projectEnvFile: join(root, '.env') });
      write(root, 'apps/shop/seeds/notes.json', JSON.stringify({ from: h.connectionId }));

      const refused = await send({ method: 'POST', url: '/project/apps/shop/pack', payload: { version: '1.0.0' } });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.body).not.toContain(envValue);
      expect(refused.body).not.toContain(h.connectionId);
      const details = (JSON.parse(refused.body) as { error: { details: { reason: string; leaks: unknown[] } } }).error.details;
      expect(details.reason).toBe('PACK_LEAKS');
      expect(details.leaks).toEqual(
        expect.arrayContaining([
          { kind: 'secret', file: 'source/src/api.ts', line: 3 },
          { kind: 'id', file: 'seeds/notes.json', line: 1 },
        ]),
      );
      expect(details.leaks).toHaveLength(2);
      expect(existsSync(join(root, '.adminium/packs/shop-1.0.0.tgz'))).toBe(false);

      // Taken out, the same Download is made.
      write(root, 'apps/shop/src/api.ts', `export const base = '/api';\n`);
      write(root, 'apps/shop/seeds/notes.json', JSON.stringify({ from: 'the shop' }));
      const packed = await send({ method: 'POST', url: '/project/apps/shop/pack', payload: { version: '1.0.0' } });
      expect(packed.statusCode, packed.body).toBe(200);
    }, 120_000);

    it('refuses a catalog app, an app that fails its check, and a server with no project folder', async () => {
      const root = sourceProject(shopManifest('1.0.0', { id: 'adminium', name: 'Adminium' }));
      folders.push(root);
      const { send } = await harness(dialect, { projectRoot: root });
      const catalog = await send({ method: 'POST', url: '/project/apps/shop/pack', payload: { version: '1.0.0' } });
      expect(catalog.statusCode).toBe(422);
      expect(reasonOf(catalog)).toBe('CATALOG_SIDES');
      expect(existsSync(join(root, '.adminium/packs'))).toBe(false);

      write(root, 'apps/shop/manifest.json', JSON.stringify({ ...shopManifest(), pages: 'not a list' }));
      const failed = await send({ method: 'POST', url: '/project/apps/shop/pack', payload: { version: '1.0.0' } });
      expect(failed.statusCode).toBe(422);
      expect(JSON.parse(failed.body).error.details.reason).toBe('PACK_CHECK_FAILED');
      expect(JSON.parse(failed.body).error.details.problems.length).toBeGreaterThan(0);

      await closeOpen();
      const none = await harness(dialect, { projectRoot: null });
      const refused = await none.send({ method: 'POST', url: '/project/apps/shop/pack', payload: { version: '1.0.0' } });
      expect(refused.statusCode).toBe(404);
      expect(reasonOf(refused)).toBe('NO_PROJECT');
    }, 120_000);

    it('makes an installed file editable here: the source lands in apps/<key>/, and the key is the folder’s from then on', async () => {
      const source = sourceProject();
      const target = mkdtempSync(join(tmpdir(), 'own-surfaces-target-'));
      folders.push(source, target);
      // What the target's build lists: nothing, until the folder exists and is built.
      let built: FolderApp[] = [];
      const refreshed: string[] = [];
      const { h, send, upload } = await harness(dialect, {
        projectRoot: target,
        folder: () => built,
        refreshProject: async () => {
          refreshed.push('built');
        },
      });

      // The source server's Download.
      const sourceSide = await harness(dialect, { projectRoot: source });
      const made = await sourceSide.send({ method: 'POST', url: '/project/apps/shop/pack', payload: { version: '1.0.0' } });
      expect(made.statusCode, made.body).toBe(200);
      const file = new Uint8Array((await sourceSide.send({ method: 'GET', url: '/project/apps/shop/pack/1.0.0' })).rawPayload);
      await sourceSide.h.close();

      // It uploads and installs like any package.
      expect((await upload(file)).statusCode).toBe(200);
      const installed = await send({ method: 'POST', url: '/apps/install', payload: { key: 'shop', version: '1.0.0', connectionId: h.connectionId } });
      expect(installed.statusCode, installed.body).toBe(200);
      const listed = JSON.parse((await send({ method: 'GET', url: '/apps' })).body) as { apps: { key: string; sides: unknown[] }[] };
      // `source/` is never a side.
      expect(listed.apps.find((app) => app.key === 'shop')?.sides).toEqual([]);

      const offered = await send({ method: 'GET', url: '/apps/shop/editable' });
      expect(offered.statusCode, offered.body).toBe(200);
      expect(JSON.parse(offered.body)).toEqual({ state: 'offered', folder: 'apps/shop/' });

      const copied = await send({ method: 'POST', url: '/apps/shop/editable' });
      expect(copied.statusCode, copied.body).toBe(200);
      expect(JSON.parse(copied.body)).toEqual({ key: 'shop', folder: 'apps/shop/' });
      expect(refreshed).toEqual(['built']);
      expect(JSON.parse(readFileSync(join(target, 'apps/shop/manifest.json'), 'utf8')).key).toBe('shop');
      expect(readFileSync(join(target, 'apps/shop/assets/logo.svg'), 'utf8')).toContain('<svg');
      expect(existsSync(join(target, 'apps/shop/seeds/sample.json'))).toBe(true);
      expect(JSON.parse(readFileSync(join(target, 'apps/shop/package.json'), 'utf8')).scripts).toBeUndefined();
      // What runs never travelled, so it never lands.
      for (const left of ['build.json', 'vite.config.ts', '.env']) expect(existsSync(join(target, 'apps/shop', left)), left).toBe(false);
      // No half folder is left beside it.
      expect(readdirNames(join(target, 'apps'))).toEqual(['shop']);

      const row = (await manifestsRepo(h.meta, PLAIN).listByKey('shop'))[0]!;
      expect(row.row.source).toBe('folder');
      expect(JSON.parse((await send({ method: 'GET', url: '/apps/shop/editable' })).body)).toEqual({ state: 'refused', reason: 'FROM_FOLDER', folder: 'apps/shop/' });

      // Once the project's build lists it, a newer file of the key is refused.
      built = [{ key: 'shop', sourceDir: join(target, 'apps/shop'), buildDir: join(target, '.adminium/build/apps/shop') }];
      const newer = packageTarball({ 'manifest.json': JSON.stringify(shopManifest('1.1.0')) });
      const refused = await upload(newer);
      expect(refused.statusCode).toBe(422);
      expect(reasonOf(refused)).toBe('KEY_IN_PROJECT');
    }, 120_000);

    it('offers nothing for a file without source, and refuses with no project folder, over a folder that exists, and on two databases', async () => {
      const target = mkdtempSync(join(tmpdir(), 'own-surfaces-target-'));
      folders.push(target);
      const { h, send, upload } = await harness(dialect, { projectRoot: target });
      const plain = packageTarball({ 'manifest.json': JSON.stringify(shopManifest()) });
      expect((await upload(plain)).statusCode).toBe(200);
      expect((await send({ method: 'POST', url: '/apps/install', payload: { key: 'shop', version: '1.0.0', connectionId: h.connectionId } })).statusCode).toBe(200);
      expect(JSON.parse((await send({ method: 'GET', url: '/apps/shop/editable' })).body)).toEqual({ state: 'none', folder: 'apps/shop/' });
      const nothing = await send({ method: 'POST', url: '/apps/shop/editable' });
      expect(nothing.statusCode).toBe(422);
      expect(reasonOf(nothing)).toBe('NO_SOURCE');
      await closeOpen();

      // A file that carries source.
      const withSource = packageTarball({ 'manifest.json': JSON.stringify(shopManifest()), 'source/manifest.json': JSON.stringify(shopManifest()), 'source/build.json': '{}' });
      const noProject = await harness(dialect, { projectRoot: null });
      expect((await noProject.upload(withSource)).statusCode).toBe(200);
      expect((await noProject.send({ method: 'POST', url: '/apps/install', payload: { key: 'shop', version: '1.0.0', connectionId: noProject.h.connectionId } })).statusCode).toBe(200);
      expect(JSON.parse((await noProject.send({ method: 'GET', url: '/apps/shop/editable' })).body)).toEqual({ state: 'refused', reason: 'NO_PROJECT', folder: 'apps/shop/' });
      const noFolder = await noProject.send({ method: 'POST', url: '/apps/shop/editable' });
      expect(noFolder.statusCode).toBe(422);
      expect(reasonOf(noFolder)).toBe('NO_PROJECT');
      await closeOpen();

      const project = await harness(dialect, { projectRoot: target });
      expect((await project.upload(withSource)).statusCode).toBe(200);
      expect((await project.send({ method: 'POST', url: '/apps/install', payload: { key: 'shop', version: '1.0.0', connectionId: project.h.connectionId } })).statusCode).toBe(200);
      // A folder of the person's own is never written over.
      write(target, 'apps/shop/mine.txt', 'mine');
      expect(JSON.parse((await project.send({ method: 'GET', url: '/apps/shop/editable' })).body)).toEqual({ state: 'refused', reason: 'FOLDER_EXISTS', folder: 'apps/shop/' });
      const exists = await project.send({ method: 'POST', url: '/apps/shop/editable' });
      expect(exists.statusCode).toBe(422);
      expect(reasonOf(exists)).toBe('FOLDER_EXISTS');
      expect(readdirNames(join(target, 'apps/shop'))).toEqual(['mine.txt']);
      rmSync(join(target, 'apps'), { recursive: true, force: true });

      // On two databases: a folder holds the app once, so the others would be stuck.
      const other = await project.h.otherConnection('Kiln');
      expect((await project.send({ method: 'POST', url: '/apps/install', payload: { key: 'shop', version: '1.0.0', connectionId: other.id } })).statusCode).toBe(200);
      const [first] = await manifestsRepo(project.h.meta, PLAIN).listByKey('shop');
      const several = await project.send({ method: 'GET', url: '/apps/shop/editable', headers: { 'x-adminium-install': first!.row.id } });
      expect(JSON.parse(several.body)).toEqual({ state: 'refused', reason: 'SEVERAL_INSTALLS', folder: 'apps/shop/', installs: 2 });
      const refused = await project.send({ method: 'POST', url: '/apps/shop/editable', headers: { 'x-adminium-install': first!.row.id } });
      expect(refused.statusCode).toBe(422);
      expect(JSON.parse(refused.body).error.details).toMatchObject({ reason: 'SEVERAL_INSTALLS', installs: 2 });
      expect(existsSync(join(target, 'apps/shop'))).toBe(false);
      // Without a selector, two installs are never guessed between.
      expect((await project.send({ method: 'GET', url: '/apps/shop/editable' })).statusCode).toBe(409);
    }, 120_000);

    it('takes a file that says its lineage over a copy installed from one that said none', async () => {
      const { h, send, upload } = await harness(dialect, { projectRoot: null });
      expect((await upload(packageTarball({ 'manifest.json': JSON.stringify(shopManifest('1.0.0')) }))).statusCode).toBe(200);
      expect((await send({ method: 'POST', url: '/apps/install', payload: { key: 'shop', version: '1.0.0', connectionId: h.connectionId } })).statusCode).toBe(200);
      const said = { ...shopManifest('1.1.0'), compatibility: { minAdminiumVersion: '0.3.49' }, provenance: { lineage: 'abcdefgh12345678', savedAt: '2026-11-01T10:00:00.000Z', adminiumVersion: '0.3.49' } };
      const newer = await upload(packageTarball({ 'manifest.json': JSON.stringify(said) }));
      expect(newer.statusCode, newer.body).toBe(200);
      expect(JSON.parse(newer.body).route).toBe('update');
    }, 120_000);
  });
}

function readdirNames(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

describe.skipIf(!canBuildSides)('Download of an app with screens', () => {
  it('builds the screens and carries their source, never the build step or tool config', async () => {
    const root = tempProject('own-surfaces-sides-');
    folders.push(root);
    const io = fakeIo({ interactive: false });
    const deps = fakeDeps({ cwd: root, env: {} });
    deps.runProcess = () => ({ status: 0, stdout: '' });
    expect(await runCli(['app', 'new', 'repairs', '--staff'], { io, deps })).toBe(0);
    write(root, 'apps/repairs/staff/vite.config.ts', 'export default {};');
    write(root, 'apps/repairs/build.json', '{}');
    const { send } = await harness('sqlite', { projectRoot: root });
    const packed = await send({ method: 'POST', url: '/project/apps/repairs/pack', payload: { version: '0.1.0' } });
    expect(packed.statusCode, packed.body).toBe(200);
    const bytes = new Uint8Array((await send({ method: 'GET', url: '/project/apps/repairs/pack/0.1.0' })).rawPayload);
    const paths = readAddOnTarball(bytes).map((entry) => entry.path);
    expect(paths).toContain('staff/index.html');
    expect(paths.some((path) => path.startsWith('source/staff/src/'))).toBe(true);
    expect(paths.some((path) => path.startsWith('source/manifest/'))).toBe(true);
    expect(paths).not.toContain('source/build.json');
    expect(paths).not.toContain('source/staff/vite.config.ts');
    expect(paths.some((path) => path.startsWith('source/seeds/'))).toBe(false);
  }, 120_000);
});
