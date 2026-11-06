// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVE WORKSPACE AND WORKSPACE FILES, END TO END.
 *
 *  - A workspace of two databases saves as one file, "Download again" packs
 *    the same bytes, and the file installs on a fresh server into a new
 *    workspace that holds both databases.
 *  - An install that stops part way keeps what it installed; after a reload,
 *    running the row again installs the rest and skips the finished app.
 *  - A newer file is an update of the copies already here.
 *  - An older Adminium refuses the file as "needs Adminium X", and every
 *    upload refusal refuses the whole file, or only its app, as it should.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appSavesRepo, appUpdatesRepo, manifestsRepo, settingsRepo, workspaceInstallsRepo, workspaceSavesRepo, workspacesRepo } from '@adminium/meta';
import { WORKSPACE_FILE_FLOOR } from '@adminium/manifest';
import { afterEach, describe, expect, it } from 'vitest';

import { readAddOnTarball } from '../src/add-ons/archive.js';
import { sha512Integrity } from '../src/add-ons/store.js';
import { createAppInstallService } from '../src/apps/install-service.js';
import { createSaveService, type SaveRights } from '../src/apps/save/service.js';
import { createWorkspaceSaveService, packWorkspaceFile } from '../src/apps/save/workspace.js';
import { createWorkspaceInstaller } from '../src/apps/workspace-install.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { runCli } from '../src/cli/run.js';
import type { CliRuntime } from '../src/cli/runtime.js';
import { AppError, errorEnvelope } from '../src/errors.js';
import { appSaveRoutes } from '../src/routes/apps/save.js';
import { runGeneration } from '../src/generate/run.js';
import { packageTarball } from './app-bundle-helpers.js';
import { ENGINES, installHarness, type Dialect, type Harness } from './app-install-harness.js';
import { memoryLibrary } from './app-save-rules.helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

const HOST: SaveRights = { userId: null, can: async () => true, readsWhole: async () => true, permissions: async () => ({ superAdmin: true }) };
const identity = { encrypt: (v: string) => v, decrypt: (v: string) => v };

const SHOP: Record<Dialect, string> = {
  sqlite: 'CREATE TABLE orders (id INTEGER PRIMARY KEY, status VARCHAR(40), total DECIMAL(10,2))',
  postgres: 'CREATE TABLE orders (id SERIAL PRIMARY KEY, status VARCHAR(40), total DECIMAL(10,2))',
  mysql: 'CREATE TABLE orders (id INT AUTO_INCREMENT PRIMARY KEY, status VARCHAR(40), total DECIMAL(10,2))',
};

interface Source {
  h: Harness;
  archive: string;
  workspaceId: string;
  library: ReturnType<typeof memoryLibrary>;
  service: ReturnType<typeof createWorkspaceSaveService>;
}

/** A server with two databases in one workspace: the harness's own (`Clinic`) and an SQLite `Archive`. */
async function source(dialect: Dialect, open: Harness[]): Promise<Source> {
  const library = memoryLibrary();
  const h = await installHarness(dialect, { library, full: true });
  open.push(h);
  await h.run(SHOP[dialect]);
  await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: h.connectionId });
  await runGeneration({ manager: h.manager, meta: h.meta, connectionId: h.connectionId, createdBy: null });
  const archive = await h.otherConnection('Archive');
  await archive.run('CREATE TABLE letters (id INTEGER PRIMARY KEY, subject VARCHAR(120))');
  await runGeneration({ manager: h.manager, meta: h.meta, connectionId: archive.id, createdBy: null });
  const workspace = await workspacesRepo(h.meta).create({ name: 'Corner Shop', connectionIds: [h.connectionId, archive.id] });
  const engines = new Map<string, Dialect>([[h.connectionId, dialect], [archive.id, 'sqlite']]);
  const dialectOf = async (id: string) => engines.get(id) ?? null;
  const save = createSaveService({
    meta: h.meta,
    storage: library,
    masterSecret: 'a-test-master-secret-of-enough-length',
    adminiumVersion: '0.3.49',
    dialectOf,
    displayName: async () => 'Corner shop, Leith',
    dataDb: async (connectionId) => (await h.manager.data(connectionId)).db,
  });
  const service = createWorkspaceSaveService({ meta: h.meta, save, adminiumVersion: '0.3.49', masterSecret: 'a-test-master-secret-of-enough-length', dialectOf, displayName: async () => 'Corner shop, Leith' });
  return { h, archive: archive.id, workspaceId: workspace.id, library, service };
}

/** A fresh server with the same two databases, empty. */
async function target(dialect: Dialect, open: Harness[]): Promise<{ h: Harness; archive: string }> {
  const h = await installHarness(dialect, { library: memoryLibrary(), full: true });
  open.push(h);
  const archive = await h.otherConnection('Archive');
  return { h, archive: archive.id };
}

/** A raw body, as the dashboard sends a file. */
async function post(h: Harness, url: string, bytes: Uint8Array) {
  return h.inject({ method: 'POST', url, payload: Buffer.from(bytes), headers: { 'content-type': 'application/octet-stream' } } as unknown as Parameters<Harness['inject']>[0]);
}

async function upload(h: Harness, bytes: Uint8Array, expected = sha512Integrity(bytes)) {
  return post(h, `/apps/upload-workspace?expectedSha512=${encodeURIComponent(expected)}`, bytes);
}

type FileDto = {
  id: string;
  state: string;
  name: string;
  label: string;
  workspace: { mode: string; workspaceId?: string } | null;
  apps: { key: string; name: string; version: string; state: string; suggested: string | null; sides: string[]; route: string; refusal: { reason: string; message: string } | null; database: { name: string; engine: string } | null }[];
};
const fileOf = (reply: { body: string }): FileDto => (JSON.parse(reply.body) as { workspaceFile: FileDto }).workspaceFile;

describe.each(ENGINES)('save workspace and install it, on %s', (dialect, available) => {
  const open: Harness[] = [];
  afterEach(async () => {
    for (const h of open.splice(0)) await h.close();
  });

  it.runIf(available)('saves two databases as one file and installs it on a fresh server into a new workspace', async () => {
    const src = await source(dialect, open);
    const plan = await src.service.plan(src.workspaceId, {}, HOST);
    expect(plan.apps.map((app) => [app.key, app.database.name, app.plan.version])).toEqual([
      ['archive', 'Archive', '1.0.0'],
      ['clinic', 'Clinic', '1.0.0'],
    ]);
    expect(plan.ready, JSON.stringify(plan.apps.map((app) => app.plan.check))).toBe(true);
    expect(plan.filename).toBe('corner-shop.workspace.tgz');
    expect(plan.workspaces).toEqual(['Corner Shop']);

    const saved = await src.service.save(src.workspaceId, {}, HOST);
    expect(saved.apps.map((app) => `${app.key}@${app.version}`)).toEqual(['archive@1.0.0', 'clinic@1.0.0']);
    const members = readAddOnTarball(saved.tarball).map((entry) => entry.path).sort();
    expect(members).toEqual(['apps/archive-1.0.0.tgz', 'apps/clinic-1.0.0.tgz', 'manifest.json', 'workspace.json']);
    const stub = JSON.parse(new TextDecoder().decode(readAddOnTarball(saved.tarball).find((entry) => entry.path === 'manifest.json')!.bytes)) as unknown;
    expect(stub).toEqual({ key: 'corner-shop', compatibility: { minAdminiumVersion: WORKSPACE_FILE_FLOOR } });
    // Download again: the same bytes, packed from the stored document and the apps' kept files.
    const again = await src.service.file(saved.id, HOST);
    expect(again?.filename).toBe('corner-shop.workspace.tgz');
    expect(Buffer.from(again!.bytes).equals(Buffer.from(saved.tarball))).toBe(true);
    // Each inner file is an ordinary save of its own, the next one a version on.
    const after = await src.service.plan(src.workspaceId, {}, HOST);
    expect(after.apps.map((app) => [app.plan.version, app.lastSaved])).toEqual([['1.0.1', '1.0.0'], ['1.0.1', '1.0.0']]);

    const dst = await target(dialect, open);
    const staged = await upload(dst.h, saved.tarball);
    expect(staged.statusCode, staged.body).toBe(200);
    const file = fileOf(staged);
    expect(file).toMatchObject({ name: 'Corner Shop', label: 'Corner shop, Leith', state: 'staged', workspace: null });
    expect(file.apps.every((app) => app.sides.includes('staff') || app.sides.length === 0)).toBe(true);
    expect(file.apps.map((app) => [app.key, app.state, app.route, app.suggested])).toEqual([
      ['archive', 'pending', 'install', dst.archive],
      ['clinic', 'pending', 'install', dst.h.connectionId],
    ]);

    const installed = await dst.h.inject({
      method: 'POST',
      url: `/apps/workspace/${file.id}/install`,
      payload: { workspace: { mode: 'create', name: 'Corner Shop' }, apps: [{ key: 'archive', connectionId: dst.archive }, { key: 'clinic', connectionId: dst.h.connectionId }] },
    });
    expect(installed.statusCode, installed.body).toBe(200);
    const done = fileOf(installed);
    expect(done.state).toBe('done');
    expect(done.apps.map((app) => app.state)).toEqual(['installed', 'installed']);
    const workspace = (await workspacesRepo(dst.h.meta).list()).find((one) => one.name === 'Corner Shop')!;
    expect(workspace.connectionIds.sort()).toEqual([dst.archive, dst.h.connectionId].sort());
    expect(done.workspace).toMatchObject({ mode: 'create', workspaceId: workspace.id });
    const copies = (await manifestsRepo(dst.h.meta, identity).list('app')).map((m) => [m.row.manifestKey, m.row.connectionId]);
    expect(copies.sort()).toEqual([['archive', dst.archive], ['clinic', dst.h.connectionId]].sort());
    expect((await dst.h.rows('SELECT COUNT(*) AS n FROM orders')).length).toBe(1);

    // Installed and finished: the file is off the open list, and a second run is refused.
    const listed = await dst.h.inject({ method: 'GET', url: '/apps/workspace-files' });
    expect((JSON.parse(listed.body) as { workspaceFiles: unknown[] }).workspaceFiles).toEqual([]);
    const twice = await dst.h.inject({ method: 'POST', url: `/apps/workspace/${file.id}/install`, payload: { apps: [] } });
    expect(twice.statusCode).toBe(409);
    expect(twice.body).toContain('WORKSPACE_INSTALL_FINISHED');
  });

  it.runIf(available)('stops part way, keeps what it installed, and installs the rest after a reload', async () => {
    const src = await source(dialect, open);
    const saved = await src.service.save(src.workspaceId, {}, HOST);
    const dst = await target(dialect, open);
    const file = fileOf((await upload(dst.h, saved.tarball)));

    // A run whose second install fails in a way that is no refusal: the run stops there.
    const manifests = manifestsRepo(dst.h.meta, identity);
    let fail = true;
    const forced = createWorkspaceInstaller({
      meta: dst.h.meta,
      stagedIntegrity: async (key, version) => (await dst.h.deps.store.verifyTree(key, version)).integrity,
      discardStaged: (key, version) => dst.h.deps.store.removeVersion(key, version),
      copiesOf: async (key) => (await manifests.listByKey(key)).filter((m) => m.row.kind === 'app').map((m) => ({ installId: m.row.id, connectionId: m.row.connectionId, version: m.row.version })),
      install: async ({ key, version, connectionId, answers }) => {
        if (key === 'clinic' && fail) {
          fail = false;
          throw new Error('the database went away');
        }
        const reply = await dst.h.inject({ method: 'POST', url: '/apps/install', payload: { ...answers, key, version, connectionId } });
        if (reply.statusCode !== 200) throw new AppError(reply.statusCode, 'INSTALL', reply.body);
      },
      update: async () => undefined,
      connectionExists: async () => true,
    });
    const body = { workspace: { mode: 'create' as const, name: 'Corner Shop' }, apps: [{ key: 'archive', connectionId: dst.archive }, { key: 'clinic', connectionId: dst.h.connectionId }] };
    const stopped = await forced.run(file.id, body, { userId: null, managesConnections: true });
    expect(stopped.state).toBe('stopped');
    expect(stopped.apps.map((app) => [app.key, app.state])).toEqual([['archive', 'installed'], ['clinic', 'stopped']]);
    expect(stopped.apps[1]!.error).toContain('the database went away');
    // Every database chosen joined the workspace, the stopped one's too.
    const workspace = (await workspacesRepo(dst.h.meta).list()).find((one) => one.name === 'Corner Shop')!;
    expect(workspace.connectionIds.sort()).toEqual([dst.archive, dst.h.connectionId].sort());
    const archiveInstall = (await manifests.listByKey('archive'))[0]!.row;

    // After a reload: the open list still offers it, stopped, and the same row installs the rest.
    const listed = (JSON.parse((await dst.h.inject({ method: 'GET', url: '/apps/workspace-files' })).body) as { workspaceFiles: FileDto[] }).workspaceFiles;
    expect(listed.map((one) => [one.id, one.state])).toEqual([[file.id, 'stopped']]);
    expect(listed[0]!.apps.find((app) => app.key === 'clinic')!.refusal).toMatchObject({ reason: 'STOPPED' });
    const rest = await dst.h.inject({ method: 'POST', url: `/apps/workspace/${file.id}/install`, payload: { apps: [{ key: 'clinic', connectionId: dst.h.connectionId }] } });
    expect(rest.statusCode, rest.body).toBe(200);
    const done = fileOf(rest);
    expect(done.state).toBe('done');
    expect(done.apps.map((app) => [app.key, app.state])).toEqual([['archive', 'installed'], ['clinic', 'installed']]);
    // The finished app was not installed again; the workspace made on the first run was kept, not made twice.
    expect((await manifests.listByKey('archive'))[0]!.row).toMatchObject({ id: archiveInstall.id, installedAt: archiveInstall.installedAt });
    expect((await workspacesRepo(dst.h.meta).list()).filter((one) => one.name === 'Corner Shop')).toHaveLength(1);
  });

  /**
   * An update inside "Install the rest" that stops: clinic 1.0.0 runs on the
   * engine's own database, the newer file asks for it on a second database
   * too, and the update of the copy here stops. The run stops (never a
   * refusal), the newer file stays, and running the row again finishes the
   * update before it installs on the second database.
   */
  async function updateStops(open: Harness[], moved: boolean) {
    const src = await source(dialect, open);
    const first = await src.service.save(src.workspaceId, {}, HOST);
    const dst = await target(dialect, open);
    const one = fileOf(await upload(dst.h, first.tarball));
    const here = [{ key: 'archive', connectionId: dst.archive }, { key: 'clinic', connectionId: dst.h.connectionId }];
    expect(fileOf(await dst.h.inject({ method: 'POST', url: `/apps/workspace/${one.id}/install`, payload: { apps: here } })).state).toBe('done');

    const second = await src.service.save(src.workspaceId, {}, HOST);
    const file = fileOf(await upload(dst.h, second.tarball));
    const branch = await dst.h.otherConnection('Branch');
    const manifests = manifestsRepo(dst.h.meta, identity);
    const copyHere = (await manifests.listByKey('clinic'))[0]!;
    const updates: string[] = [];
    let stop = true;
    const forced = createWorkspaceInstaller({
      meta: dst.h.meta,
      stagedIntegrity: async (key, version) => (await dst.h.deps.store.verifyTree(key, version)).integrity,
      discardStaged: (key, version) => dst.h.deps.store.removeVersion(key, version),
      copiesOf: async (key) => (await manifests.listByKey(key)).filter((m) => m.row.kind === 'app').map((m) => ({ installId: m.row.id, connectionId: m.row.connectionId, version: m.row.version, status: m.row.status })),
      install: async () => {
        throw new Error('the run should stop before any install');
      },
      update: async ({ key, connectionId }) => {
        updates.push(key);
        if (key === 'clinic' && stop) {
          stop = false;
          if (moved) {
            // The version moved and what it brings stopped at the pages: the record the real update leaves.
            const reply = await dst.h.inject({ method: 'POST', url: `/apps/clinic/update?connectionId=${connectionId!}`, payload: {} });
            expect(reply.statusCode, reply.body).toBe(200);
            const tables = ((copyHere.document as { requiredSchema?: { tables?: { ref: string }[] } }).requiredSchema?.tables ?? []).map((table) => table.ref);
            await appUpdatesRepo(dst.h.meta).begin({ manifestId: copyHere.row.id, fromVersion: '1.0.0', toVersion: '1.0.1', fromTables: tables });
            await appUpdatesRepo(dst.h.meta).stopped(copyHere.row.id, 'pages');
          }
          throw new AppError(409, 'APP_UPDATE_INCOMPLETE', 'Updating "clinic" to 1.0.1 stopped at the pages step: the database went away.', { stage: 'pages', from: '1.0.0', to: '1.0.1' });
        }
        const reply = await dst.h.inject({ method: 'POST', url: `/apps/${key}/update?connectionId=${connectionId!}`, payload: {} });
        if (reply.statusCode !== 200) throw new AppError(reply.statusCode, 'UPDATE', reply.body);
      },
      connectionExists: async () => true,
    });
    const apps = [{ key: 'archive', connectionId: dst.archive }, { key: 'clinic', connectionId: branch.id }];
    const stopped = await forced.run(file.id, { apps }, { userId: null, managesConnections: true });
    return { dst, file, branch, manifests, copyHere, stopped, updates, apps };
  }

  it.runIf(available)('stops on an update that stopped before its version moved, and the next run finishes it', async () => {
    const { dst, file, branch, manifests, stopped, updates, apps } = await updateStops(open, false);
    expect(stopped.state).toBe('stopped');
    expect(stopped.apps.map((app) => [app.key, app.state, app.reason])).toEqual([['archive', 'updated', undefined], ['clinic', 'stopped', 'APP_UPDATE_INCOMPLETE']]);
    expect(updates).toEqual(['archive', 'clinic']);
    expect((await manifests.listByKey('clinic')).map((m) => m.row.version)).toEqual(['1.0.0']);
    expect(await dst.h.deps.store.versions('clinic')).toContain('1.0.1');

    // Install the rest, through the route: the update runs again, then the second database gets its copy.
    const rest = await dst.h.inject({ method: 'POST', url: `/apps/workspace/${file.id}/install`, payload: { apps } });
    expect(rest.statusCode, rest.body).toBe(200);
    const done = fileOf(rest);
    expect(done.state).toBe('done');
    expect(done.apps.map((app) => [app.key, app.state])).toEqual([['archive', 'updated'], ['clinic', 'updated']]);
    const copies = (await manifests.listByKey('clinic')).map((m) => [m.row.connectionId, m.row.version]);
    expect(copies.sort()).toEqual([[branch.id, '1.0.1'], [dst.h.connectionId, '1.0.1']].sort());
  });

  it.runIf(available)('finishes an update that moved its version and stopped, before it installs the next copy', async () => {
    const { dst, file, branch, manifests, copyHere, stopped, apps } = await updateStops(open, true);
    expect(stopped.state).toBe('stopped');
    expect(stopped.apps.find((app) => app.key === 'clinic')).toMatchObject({ state: 'stopped', reason: 'APP_UPDATE_INCOMPLETE' });
    expect(await appUpdatesRepo(dst.h.meta).find(copyHere.row.id)).toMatchObject({ toVersion: '1.0.1', stoppedAt: 'pages' });

    const rest = await dst.h.inject({ method: 'POST', url: `/apps/workspace/${file.id}/install`, payload: { apps } });
    expect(rest.statusCode, rest.body).toBe(200);
    const done = fileOf(rest);
    expect(done.state).toBe('done');
    expect(done.apps.find((app) => app.key === 'clinic')!.state).toBe('updated');
    // The stopped update was finished, not skipped as "already at its version".
    expect(await appUpdatesRepo(dst.h.meta).find(copyHere.row.id)).toBeNull();
    const copies = (await manifests.listByKey('clinic')).map((m) => [m.row.connectionId, m.row.version]);
    expect(copies.sort()).toEqual([[branch.id, '1.0.1'], [dst.h.connectionId, '1.0.1']].sort());
  });

  it.runIf(available)('keeps the newer file when the row is thrown away while its update is waiting', async () => {
    const { dst, file, manifests } = await updateStops(open, false);
    const gone = await dst.h.inject({ method: 'DELETE', url: `/apps/workspace/${file.id}/install` });
    expect(fileOf(gone).state).toBe('discarded');
    // The update that stopped still needs 1.0.1, so it stays, and the app's own update finishes it.
    expect(await dst.h.deps.store.versions('clinic')).toContain('1.0.1');
    const finished = await dst.h.inject({ method: 'POST', url: `/apps/clinic/update?connectionId=${dst.h.connectionId}`, payload: {} });
    expect(finished.statusCode, finished.body).toBe(200);
    expect((await manifests.listByKey('clinic')).map((m) => m.row.version)).toEqual(['1.0.1']);
  });
});

describe.each(ENGINES)('a workspace deleted between runs, on %s', (dialect, available) => {
  const open: Harness[] = [];
  afterEach(async () => {
    for (const h of open.splice(0)) await h.close();
  });

  it.runIf(available)('never makes a deleted workspace again: the rest install with none, and the review says so', async () => {
    const src = await source(dialect, open);
    const saved = await src.service.save(src.workspaceId, {}, HOST);
    const dst = await target(dialect, open);
    const file = fileOf(await upload(dst.h, saved.tarball));
    const installed: string[] = [];
    const installer = createWorkspaceInstaller({
      meta: dst.h.meta,
      stagedIntegrity: async (key, version) => (await dst.h.deps.store.verifyTree(key, version)).integrity,
      discardStaged: async () => undefined,
      copiesOf: async () => [],
      install: async ({ key }) => {
        installed.push(key);
      },
      update: async () => undefined,
      connectionExists: async () => true,
    });
    const actor = { userId: null, managesConnections: true };
    const first = await installer.run(file.id, { workspace: { mode: 'create', name: 'Corner Shop' }, apps: [{ key: 'archive', connectionId: dst.archive }] }, actor);
    const made = first.workspaceChoice?.workspaceId;
    expect(made).toBeDefined();
    expect(await workspacesRepo(dst.h.meta).remove(made!)).toBe(true);

    // The review reads it as gone before the next run.
    const review = fileOf(await dst.h.inject({ method: 'GET', url: `/apps/workspace/${file.id}/install` }));
    expect(review.workspace).toEqual({ mode: 'none', name: 'Corner Shop', gone: true });

    // "Install the rest", still asking to create it: none is made, and the row keeps saying why.
    const rest = await installer.run(file.id, { workspace: { mode: 'create', name: 'Corner Shop' }, apps: [{ key: 'clinic', connectionId: dst.h.connectionId }] }, actor);
    expect(rest.state).toBe('done');
    expect(rest.workspaceChoice).toEqual({ mode: 'none', name: 'Corner Shop', gone: true });
    expect(installed).toEqual(['archive', 'clinic']);
    expect(await workspacesRepo(dst.h.meta).list()).toEqual([]);
    expect(await workspacesRepo(dst.h.meta).forConnection(dst.h.connectionId)).toEqual([]);
    const after = fileOf(await dst.h.inject({ method: 'GET', url: `/apps/workspace/${file.id}/install` }));
    expect(after.workspace).toEqual({ mode: 'none', name: 'Corner Shop', gone: true });
  });
});

describe('workspace files on one engine', () => {
  const open: Harness[] = [];
  afterEach(async () => {
    for (const h of open.splice(0)) await h.close();
  });

  it('installs a newer file as an update of the copies here', async () => {
    const src = await source('sqlite', open);
    const first = await src.service.save(src.workspaceId, {}, HOST);
    const dst = await target('sqlite', open);
    const one = fileOf((await upload(dst.h, first.tarball)));
    const apps = [{ key: 'archive', connectionId: dst.archive }, { key: 'clinic', connectionId: dst.h.connectionId }];
    expect(fileOf(await dst.h.inject({ method: 'POST', url: `/apps/workspace/${one.id}/install`, payload: { apps } })).state).toBe('done');

    const second = await src.service.save(src.workspaceId, {}, HOST);
    const two = fileOf((await upload(dst.h, second.tarball)));
    expect(two.apps.map((app) => [app.key, app.version, app.route])).toEqual([
      ['archive', '1.0.1', 'update'],
      ['clinic', '1.0.1', 'update'],
    ]);
    const updated = fileOf(await dst.h.inject({ method: 'POST', url: `/apps/workspace/${two.id}/install`, payload: { apps } }));
    expect(updated.apps.map((app) => [app.key, app.state])).toEqual([['archive', 'updated'], ['clinic', 'updated']]);
    expect((await manifestsRepo(dst.h.meta, identity).list('app')).map((m) => m.row.version).sort()).toEqual(['1.0.1', '1.0.1']);
    // No workspace was asked for: none is made.
    expect(await workspacesRepo(dst.h.meta).list()).toEqual([]);

    // The same file again: each app is already at its version on its database, so it counts as installed.
    const three = fileOf((await upload(dst.h, second.tarball)));
    const same = fileOf(await dst.h.inject({ method: 'POST', url: `/apps/workspace/${three.id}/install`, payload: { apps } }));
    expect(same.apps.map((app) => app.state)).toEqual(['installed', 'installed']);
  });

  it('puts databases in a workspace only for someone who manages connections', async () => {
    const src = await source('sqlite', open);
    const saved = await src.service.save(src.workspaceId, {}, HOST);
    const dst = await target('sqlite', open);
    const file = fileOf((await upload(dst.h, saved.tarball)));
    const installer = createWorkspaceInstaller({
      meta: dst.h.meta,
      stagedIntegrity: async () => null,
      discardStaged: async () => undefined,
      copiesOf: async () => [],
      install: async () => undefined,
      update: async () => undefined,
      connectionExists: async () => true,
    });
    await expect(installer.run(file.id, { workspace: { mode: 'create', name: 'Mine' }, apps: [] }, { userId: null, managesConnections: false })).rejects.toMatchObject({ statusCode: 403 });
    // The lock was given back: a run with no workspace goes ahead.
    const run = await installer.run(file.id, { workspace: { mode: 'none' }, apps: [] }, { userId: null, managesConnections: false });
    expect(run.workspaceChoice).toEqual({ mode: 'none' });
  });

  it('finishes an app whose install stopped part way, though its row is already there', async () => {
    const src = await source('sqlite', open);
    const saved = await src.service.save(src.workspaceId, {}, HOST);
    const dst = await target('sqlite', open);
    const file = fileOf(await upload(dst.h, saved.tarball));
    const manifests = manifestsRepo(dst.h.meta, identity);
    const copies = async (key: string) => (await manifests.listByKey(key)).filter((m) => m.row.kind === 'app').map((m) => ({ installId: m.row.id, connectionId: m.row.connectionId, version: m.row.version, status: m.row.status }));
    // An install that stops part way leaves its row `installing`; installing it again is what finishes it.
    let stopped = false;
    const installs: string[] = [];
    const installer = createWorkspaceInstaller({
      meta: dst.h.meta,
      stagedIntegrity: async (key, version) => (await dst.h.deps.store.verifyTree(key, version)).integrity,
      discardStaged: (key, version) => dst.h.deps.store.removeVersion(key, version),
      copiesOf: async (key) => (key === 'clinic' && stopped ? [{ installId: 'man_half', connectionId: dst.h.connectionId, version: '1.0.0', status: 'installing' }] : copies(key)),
      install: async ({ key, version, connectionId, answers }) => {
        installs.push(key);
        if (key === 'clinic' && !stopped) {
          stopped = true;
          throw new AppError(409, 'APP_INSTALL_INCOMPLETE', 'Installing "clinic" stopped at the tables step.');
        }
        const reply = await dst.h.inject({ method: 'POST', url: '/apps/install', payload: { ...answers, key, version, connectionId } });
        if (reply.statusCode !== 200) throw new AppError(reply.statusCode, 'INSTALL', reply.body);
      },
      update: async () => undefined,
      connectionExists: async () => true,
    });
    const actor = { userId: null, managesConnections: true };
    const first = await installer.run(file.id, { apps: [{ key: 'archive', connectionId: dst.archive }, { key: 'clinic', connectionId: dst.h.connectionId }] }, actor);
    expect(first.apps.map((app) => [app.key, app.state])).toEqual([['archive', 'installed'], ['clinic', 'stopped']]);
    // Install the rest: the half-made install is no copy, so it is installed again, not counted as there.
    const rest = await installer.run(file.id, { apps: [{ key: 'clinic', connectionId: dst.h.connectionId }] }, actor);
    expect(rest.state).toBe('done');
    expect(installs).toEqual(['archive', 'clinic', 'clinic']);
    expect((await copies('clinic')).map((copy) => copy.status)).toEqual(['installed']);
  });

  it('gives each copy its own update answers, and never installs an app with none', async () => {
    const src = await source('sqlite', open);
    const saved = await src.service.save(src.workspaceId, {}, HOST);
    const dst = await target('sqlite', open);
    const file = fileOf(await upload(dst.h, saved.tarball));
    const copies = new Map([
      ['clinic', [{ installId: 'man_a', connectionId: 'con_a', version: '0.9.0' }, { installId: 'man_b', connectionId: 'con_b', version: '0.9.0' }]],
      ['archive', [{ installId: 'man_c', connectionId: 'con_c', version: '0.9.0' }]],
    ]);
    const calls: unknown[] = [];
    const installer = createWorkspaceInstaller({
      meta: dst.h.meta,
      stagedIntegrity: async (key, version) => (await dst.h.deps.store.verifyTree(key, version)).integrity,
      discardStaged: async () => undefined,
      copiesOf: async (key) => copies.get(key) ?? [],
      install: async ({ key, connectionId, answers }) => {
        calls.push(['install', key, connectionId, answers]);
      },
      update: async ({ key, installId, answers }) => {
        calls.push(['update', key, installId, answers]);
        for (const copy of copies.get(key) ?? []) if (copy.installId === installId) copy.version = '1.0.0';
      },
      connectionExists: async () => true,
    });
    const actor = { userId: null, managesConnections: false };

    // Two copies: each takes its own answers; one given none is updated with none, never with another's.
    const first = await installer.run(file.id, { apps: [{ key: 'clinic', connectionId: dst.h.connectionId, update: { publicAccess: true }, updates: { man_a: { publicAccess: true, roleGrants: true } } }] }, actor);
    expect(calls).toEqual([
      ['update', 'clinic', 'man_a', { publicAccess: true, roleGrants: true }],
      ['update', 'clinic', 'man_b', {}],
      // Named without install answers: the safe ones, public access not allowed.
      ['install', 'clinic', dst.h.connectionId, { publicAccess: false }],
    ]);
    // The archive was not named in this run: it waits, though an earlier run could have given it a place.
    expect(first.apps.map((app) => [app.key, app.state])).toEqual([['archive', 'pending'], ['clinic', 'updated']]);
    expect(first.state).toBe('staged');

    // Its only copy takes the single set.
    calls.length = 0;
    const rest = await installer.run(file.id, { apps: [{ key: 'archive', connectionId: dst.archive, update: { publicAccess: true } }] }, actor);
    expect(calls).toEqual([
      ['update', 'archive', 'man_c', { publicAccess: true }],
      ['install', 'archive', dst.archive, { publicAccess: false }],
    ]);
    expect(rest.state).toBe('done');
  });

  it('refuses a workspace file whose own list would carry an id or a secret of this server', async () => {
    const src = await source('sqlite', open);
    // A key pasted into the workspace's name: in workspace.json, and in the stub manifest's key made from it.
    await settingsRepo(src.h.meta).set('llm.apiKey', 'corner-assistant-key-not-real-0001');
    await workspacesRepo(src.h.meta).rename(src.workspaceId, 'Shop corner-assistant-key-not-real-0001');
    const secret = await src.service.save(src.workspaceId, {}, HOST).catch((error: unknown) => error);
    expect(secret).toMatchObject({ statusCode: 409, details: { reason: 'WORKSPACE_FILE_LEAKS' } });
    expect((secret as { details: { leaks: unknown[] } }).details.leaks).toContainEqual({ kind: 'secret', file: 'workspace.json', line: 3 });
    expect(JSON.stringify(secret)).not.toContain('corner-assistant-key-not-real-0001');
    // A database's id in it.
    await workspacesRepo(src.h.meta).rename(src.workspaceId, `Shop ${src.archive}`);
    await expect(src.service.save(src.workspaceId, {}, HOST)).rejects.toMatchObject({ details: { reason: 'WORKSPACE_FILE_LEAKS', leaks: [{ kind: 'id', file: 'workspace.json', line: 3 }] } });
    // Refused whole: no app's version was used up.
    expect(await appSavesRepo(src.h.meta).list()).toEqual([]);
    expect(await workspaceSavesRepo(src.h.meta).list()).toEqual([]);
  });

  it('runs one install at a time per row', async () => {
    const src = await source('sqlite', open);
    const saved = await src.service.save(src.workspaceId, {}, HOST);
    const dst = await target('sqlite', open);
    const file = fileOf((await upload(dst.h, saved.tarball)));
    expect(await workspaceInstallsRepo(dst.h.meta).lock(file.id, 'another-run')).toBe(true);
    const busy = await dst.h.inject({ method: 'POST', url: `/apps/workspace/${file.id}/install`, payload: { apps: [] } });
    expect(busy.statusCode).toBe(409);
    expect(busy.body).toContain('WORKSPACE_INSTALL_RUNNING');
  });

  it('keeps its lock while a long run goes on, and stops if another run took the row', async () => {
    const src = await source('sqlite', open);
    const saved = await src.service.save(src.workspaceId, {}, HOST);
    const dst = await target('sqlite', open);
    const file = fileOf(await upload(dst.h, saved.tarball));
    const repo = workspaceInstallsRepo(dst.h.meta);
    const manifests = manifestsRepo(dst.h.meta, identity);
    let clock = Date.now();
    const intruders: boolean[] = [];
    const installed: string[] = [];
    const installerWith = (heartbeatMs: number, during: () => Promise<void>) =>
      createWorkspaceInstaller({
        meta: dst.h.meta,
        stagedIntegrity: async (key, version) => (await dst.h.deps.store.verifyTree(key, version)).integrity,
        discardStaged: (key, version) => dst.h.deps.store.removeVersion(key, version),
        copiesOf: async (key) => (await manifests.listByKey(key)).filter((m) => m.row.kind === 'app').map((m) => ({ installId: m.row.id, connectionId: m.row.connectionId, version: m.row.version })),
        install: async ({ key, version, connectionId, answers }) => {
          // Each install takes twenty minutes: longer than the age at which a lock counts as left.
          clock += 20 * 60_000;
          await during();
          installed.push(key);
          const reply = await dst.h.inject({ method: 'POST', url: '/apps/install', payload: { ...answers, key, version, connectionId } });
          if (reply.statusCode !== 200) throw new AppError(reply.statusCode, 'INSTALL', reply.body);
        },
        update: async () => undefined,
        connectionExists: async () => true,
        now: () => clock,
        heartbeatMs,
      });
    const apps = [{ key: 'archive', connectionId: dst.archive }, { key: 'clinic', connectionId: dst.h.connectionId }];
    const actor = { userId: null, managesConnections: true };

    // Taken over after the first app (the run's own lock left to go stale): the run stops before the next.
    const overtaken = installerWith(3_600_000, async () => {
      if (installed.length === 0) expect(await repo.lock(file.id, 'intruder', clock)).toBe(true);
    });
    await expect(overtaken.run(file.id, { apps }, actor)).rejects.toMatchObject({ statusCode: 409, details: { reason: 'WORKSPACE_INSTALL_RUNNING' } });
    expect(installed).toEqual(['archive']);
    await repo.unlock(file.id, 'intruder');

    // Kept fresh: a second run asking while each app works is refused, and the lock is given back at the end.
    const kept = installerWith(10, async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      intruders.push(await repo.lock(file.id, 'intruder', clock));
    });
    const run = await kept.run(file.id, { apps }, actor);
    expect(run.state).toBe('done');
    expect(installed).toEqual(['archive', 'clinic']);
    expect(intruders).toEqual([false]);
    expect((await repo.findById(file.id))?.runLock).toBeNull();
  });

  it('throws a staged file away, with the app files nothing installed', async () => {
    const src = await source('sqlite', open);
    const saved = await src.service.save(src.workspaceId, {}, HOST);
    const dst = await target('sqlite', open);
    const file = fileOf((await upload(dst.h, saved.tarball)));
    expect(await dst.h.deps.store.versions('clinic')).toEqual(['1.0.0']);
    const gone = await dst.h.inject({ method: 'DELETE', url: `/apps/workspace/${file.id}/install` });
    expect(fileOf(gone).state).toBe('discarded');
    expect(await dst.h.deps.store.versions('clinic')).toEqual([]);
  });

  it('saves only databases of the workspace, each once, with unique keys, and server settings from one at most', async () => {
    const src = await source('sqlite', open);
    const stranger = await src.h.otherConnection('Stranger');
    await expect(src.service.plan(src.workspaceId, { apps: [{ connectionId: stranger.id, key: 'stranger', name: 'Stranger' }] }, HOST)).rejects.toMatchObject({ details: { reason: 'WORKSPACE_SAVE_NOT_MEMBER' } });
    await expect(
      src.service.plan(src.workspaceId, { apps: [{ connectionId: src.archive, key: 'same', name: 'A' }, { connectionId: src.h.connectionId, key: 'same', name: 'B' }] }, HOST),
    ).rejects.toMatchObject({ details: { reason: 'WORKSPACE_SAVE_DUPLICATE_KEY' } });
    await expect(src.service.plan(src.workspaceId, { instanceFrom: stranger.id }, HOST)).rejects.toMatchObject({ details: { reason: 'WORKSPACE_SAVE_INSTANCE_FROM' } });
    // A database left out is simply not in the file.
    const one = await src.service.plan(src.workspaceId, { apps: [{ connectionId: src.archive, key: 'archive', name: 'Archive' }] }, HOST);
    expect(one.apps.map((app) => app.key)).toEqual(['archive']);
    // No server settings unless asked, even when an app's own body asks.
    const asked = await src.service.save(src.workspaceId, { apps: [{ connectionId: src.archive, key: 'archive', name: 'Archive', include: { instance: true } }] }, HOST);
    const inner = readAddOnTarball(readAddOnTarball(asked.tarball).find((entry) => entry.path === 'apps/archive-1.0.0.tgz')!.bytes);
    expect(JSON.parse(new TextDecoder().decode(inner.find((entry) => entry.path === 'manifest.json')!.bytes))).not.toHaveProperty('instance');
  });
});

describe('workspace file refusals', () => {
  const open: Harness[] = [];
  afterEach(async () => {
    for (const h of open.splice(0)) await h.close();
  });

  /** A real file's parts, to build crafted files from. */
  async function parts() {
    const src = await source('sqlite', open);
    const saved = await src.service.save(src.workspaceId, {}, HOST);
    const entries = new Map(readAddOnTarball(saved.tarball).map((entry) => [entry.path, entry.bytes]));
    const document = JSON.parse(new TextDecoder().decode(entries.get('workspace.json')!)) as Record<string, unknown> & { apps: Record<string, unknown>[] };
    const dst = await target('sqlite', open);
    return { saved, entries, document, dst };
  }

  const pack = (members: Record<string, string | Uint8Array>) => packageTarball(members);
  const reasonOf = (reply: { body: string }) => (JSON.parse(reply.body) as { error: { details?: { reason?: string } } }).error.details?.reason;

  it('refuses each thing that is wrong with the whole file, and stages nothing', async () => {
    const { entries, document, dst } = await parts();
    const stub = entries.get('manifest.json')!;
    const archive = entries.get('apps/archive-1.0.0.tgz')!;
    const clinic = entries.get('apps/clinic-1.0.0.tgz')!;
    const json = (doc: unknown) => `${JSON.stringify(doc)}\n`;
    const whole = { 'workspace.json': json(document), 'manifest.json': stub, 'apps/archive-1.0.0.tgz': archive, 'apps/clinic-1.0.0.tgz': clinic };
    const cases: [string, Uint8Array, string][] = [
      ['no workspace.json', pack({ 'manifest.json': stub, 'apps/archive-1.0.0.tgz': archive }), 'WORKSPACE_FILE_MISSING'],
      ['unreadable workspace.json', pack({ ...whole, 'workspace.json': '{' }), 'WORKSPACE_FILE_INVALID'],
      ['a field the format does not have', pack({ ...whole, 'workspace.json': json({ ...document, extra: true }) }), 'WORKSPACE_FILE_INVALID'],
      ['no stub manifest', pack({ 'workspace.json': json(document), 'apps/archive-1.0.0.tgz': archive, 'apps/clinic-1.0.0.tgz': clinic }), 'WORKSPACE_FILE_INVALID'],
      ['a member nothing names', pack({ ...whole, 'apps/other-1.0.0.tgz': archive }), 'WORKSPACE_FILE_EXTRA'],
      ['a file outside apps/', pack({ ...whole, 'notes.txt': 'hello' }), 'WORKSPACE_FILE_EXTRA'],
      ['a named member missing', pack({ 'workspace.json': json(document), 'manifest.json': stub, 'apps/archive-1.0.0.tgz': archive }), 'WORKSPACE_FILE_MEMBER_MISSING'],
      ['a fingerprint that does not match', pack({ ...whole, 'apps/clinic-1.0.0.tgz': archive }), 'WORKSPACE_FILE_INTEGRITY'],
      [
        'a key the app file does not have',
        pack({ ...whole, 'workspace.json': json({ ...document, apps: [document.apps[0], { ...document.apps[1], file: 'apps/clinic-1.0.0.tgz', key: 'clinic', integrity: document.apps[0]!['integrity'] }] }), 'apps/clinic-1.0.0.tgz': archive }),
        'WORKSPACE_FILE_APP_MISMATCH',
      ],
      ['the same key twice', pack({ ...whole, 'workspace.json': json({ ...document, apps: [document.apps[0], document.apps[0]] }) }), 'WORKSPACE_FILE_INVALID'],
      ['a floor above this server', pack({ ...whole, 'workspace.json': json({ ...document, minAdminiumVersion: '9.0.0' }) }), 'REQUIRES_NEWER_ADMINIUM'],
      ['a newer format', pack({ ...whole, 'workspace.json': json({ v: 2, minAdminiumVersion: '9.1.0' }) }), 'REQUIRES_NEWER_ADMINIUM'],
      ['not gzip at all', new TextEncoder().encode('plain text'), 'NOT_GZIP'],
    ];
    // A workspace file inside a workspace file.
    const nested = pack(whole);
    const nestedDoc = { ...document, apps: [{ ...document.apps[0], integrity: sha512Integrity(nested) }] };
    cases.push(['a workspace file inside', pack({ 'workspace.json': json(nestedDoc), 'manifest.json': stub, 'apps/archive-1.0.0.tgz': nested }), 'WORKSPACE_FILE_NESTED']);
    // Nine apps: more members than a workspace file may hold.
    const nine: Record<string, string | Uint8Array> = { 'workspace.json': json(document), 'manifest.json': stub };
    for (let n = 0; n < 9; n += 1) nine[`apps/app-${String(n)}-1.0.0.tgz`] = archive;
    cases.push(['nine apps', pack(nine), 'TOO_MANY_ENTRIES']);

    for (const [what, bytes, reason] of cases) {
      const reply = await upload(dst.h, bytes);
      expect(reply.statusCode, `${what}: ${reply.body}`).toBe(422);
      expect(reasonOf(reply), what).toBe(reason);
    }
    const mismatch = await upload(dst.h, pack(whole), sha512Integrity(pack({ ...whole, 'notes.txt': 'x' })));
    expect(reasonOf(mismatch)).toBe('INTEGRITY_MISMATCH');
    // Nothing reached the store, and no row was made.
    expect(await dst.h.deps.store.keys()).toEqual([]);
    expect(await workspaceInstallsRepo(dst.h.meta).listOpen()).toEqual([]);
  });

  it('refuses a file where two apps carry the server settings', async () => {
    const { entries, document, dst } = await parts();
    const withInstance = (bytes: Uint8Array): Uint8Array => {
      const inner = readAddOnTarball(bytes);
      const manifest = JSON.parse(new TextDecoder().decode(inner.find((entry) => entry.path === 'manifest.json')!.bytes)) as Record<string, unknown>;
      return pack(Object.fromEntries(inner.map((entry) => [entry.path, entry.path === 'manifest.json' ? JSON.stringify({ ...manifest, instance: { settings: {} } }) : entry.bytes])));
    };
    const archive = withInstance(entries.get('apps/archive-1.0.0.tgz')!);
    const clinic = withInstance(entries.get('apps/clinic-1.0.0.tgz')!);
    const doc = { ...document, apps: [{ ...document.apps[0], integrity: sha512Integrity(archive) }, { ...document.apps[1], integrity: sha512Integrity(clinic) }] };
    const reply = await upload(dst.h, pack({ 'workspace.json': JSON.stringify(doc), 'manifest.json': entries.get('manifest.json')!, 'apps/archive-1.0.0.tgz': archive, 'apps/clinic-1.0.0.tgz': clinic }));
    expect(reasonOf(reply)).toBe('WORKSPACE_FILE_TWO_INSTANCES');
  });

  it('refuses one app on its row and stages the others', async () => {
    const { entries, document, dst } = await parts();
    // The archive app asks for an Adminium this server is not.
    const inner = readAddOnTarball(entries.get('apps/archive-1.0.0.tgz')!);
    const manifest = JSON.parse(new TextDecoder().decode(inner.find((entry) => entry.path === 'manifest.json')!.bytes)) as Record<string, unknown>;
    const newer = pack(Object.fromEntries(inner.map((entry) => [entry.path, entry.path === 'manifest.json' ? JSON.stringify({ ...manifest, compatibility: { minAdminiumVersion: '9.0.0' } }) : entry.bytes])));
    const doc = { ...document, apps: [{ ...document.apps[0], integrity: sha512Integrity(newer) }, document.apps[1]] };
    const reply = await upload(dst.h, pack({ 'workspace.json': JSON.stringify(doc), 'manifest.json': entries.get('manifest.json')!, 'apps/archive-1.0.0.tgz': newer, 'apps/clinic-1.0.0.tgz': entries.get('apps/clinic-1.0.0.tgz')! }));
    expect(reply.statusCode, reply.body).toBe(200);
    const file = fileOf(reply);
    expect(file.apps.map((app) => [app.key, app.state, app.refusal?.reason ?? null])).toEqual([
      ['archive', 'refused', 'REQUIRES_NEWER_ADMINIUM'],
      ['clinic', 'pending', null],
    ]);
    expect(await dst.h.deps.store.keys()).toEqual(['clinic']);
    // The refused app is not installed; the other is, and the file is done.
    const run = fileOf(await dst.h.inject({ method: 'POST', url: `/apps/workspace/${file.id}/install`, payload: { apps: [{ key: 'archive', connectionId: dst.archive }, { key: 'clinic', connectionId: dst.h.connectionId }] } }));
    expect(run.apps.map((app) => [app.key, app.state])).toEqual([['archive', 'refused'], ['clinic', 'installed']]);
    expect(run.state).toBe('done');
  });

  it('answers a workspace file sent to the app upload, and an older Adminium says what it needs', async () => {
    const { saved, entries, dst } = await parts();
    const asApp = await post(dst.h, `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(saved.tarball))}`, saved.tarball);
    expect(asApp.statusCode).toBe(422);
    expect(reasonOf(asApp)).toBe('IS_WORKSPACE_FILE');

    // An Adminium before workspace files reads the stub as an app manifest: it fails, and its floor is what it says.
    const older = createAppInstallService({ ...dst.h.deps, serverVersion: '0.3.40' });
    let refused: unknown;
    try {
      older.appManifestFrom(Buffer.from(entries.get('manifest.json')!), null);
    } catch (error) {
      refused = error;
    }
    expect(refused).toMatchObject({ details: { reason: 'REQUIRES_NEWER_ADMINIUM', minAdminiumVersion: WORKSPACE_FILE_FLOOR } });
    expect((refused as Error).message).toContain(`needs Adminium ${WORKSPACE_FILE_FLOOR}`);
  });

  it('packs the same bytes from the same parts', async () => {
    const doc = { name: 'Corner Shop', savedAt: '2026-11-04T10:00:00.000Z', minAdminiumVersion: '0.3.49' };
    const inner = new Map([['apps/a-1.0.0.tgz', new Uint8Array([1, 2, 3])]]);
    const one = await packWorkspaceFile('{}\n', doc, inner);
    const two = await packWorkspaceFile('{}\n', doc, inner);
    expect(Buffer.from(one).equals(Buffer.from(two))).toBe(true);
  });
});

describe('Save workspace: the routes and the command', () => {
  const open: Harness[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    for (const h of open.splice(0)) await h.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('plans, saves, lists and downloads again through the routes', async () => {
    const src = await source('sqlite', open);
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
    const save = createSaveService({ meta: src.h.meta, storage: src.library, masterSecret: 'a-test-master-secret-of-enough-length', adminiumVersion: '0.3.49', dialectOf: async () => 'sqlite', displayName: async () => 'Corner shop, Leith' });
    await app.register(appSaveRoutes({ meta: src.h.meta, service: save, workspaces: src.service }));
    await app.ready();
    try {
      const planned = await app.inject({ method: 'POST', url: `/workspaces/${src.workspaceId}/save/plan`, payload: {} });
      expect(planned.statusCode, planned.body).toBe(200);
      const plan = (JSON.parse(planned.body) as { plan: { ready: boolean; filename: string; apps: { key: string; database: { name: string }; plan: { version: string; check: unknown[] } }[] } }).plan;
      expect(plan).toMatchObject({ ready: true, filename: 'corner-shop.workspace.tgz' });
      expect(plan.apps.map((one) => [one.key, one.database.name, one.plan.version])).toEqual([['archive', 'Archive', '1.0.0'], ['clinic', 'Clinic', '1.0.0']]);

      const saved = await app.inject({ method: 'POST', url: `/workspaces/${src.workspaceId}/save`, payload: { label: 'Leith' } });
      expect(saved.statusCode, saved.body).toBe(200);
      const reply = (JSON.parse(saved.body) as { save: { id: string; integrity: string; bytes: number; filename: string; apps: { key: string }[] } }).save;
      expect(reply.apps.map((one) => one.key)).toEqual(['archive', 'clinic']);

      const file = await app.inject({ method: 'GET', url: `/workspaces/save/${reply.id}/file` });
      expect(file.statusCode).toBe(200);
      expect(file.headers['content-disposition']).toBe('attachment; filename="corner-shop.workspace.tgz"');
      expect(file.headers['x-adminium-integrity']).toBe(reply.integrity);
      expect(sha512Integrity(file.rawPayload)).toBe(reply.integrity);
      expect(file.rawPayload.byteLength).toBe(reply.bytes);

      const listed = JSON.parse((await app.inject({ method: 'GET', url: '/apps/saves' })).body) as { saves: { key: string }[]; workspaces: { id: string; name: string; label: string; appSaveIds: string[] }[] };
      expect(listed.saves.map((one) => one.key).sort()).toEqual(['archive', 'clinic']);
      expect(listed.workspaces).toMatchObject([{ id: reply.id, name: 'Corner Shop', label: 'Leith', filename: 'corner-shop.workspace.tgz' }]);
      expect(listed.workspaces[0]!.appSaveIds).toHaveLength(2);

      const missing = await app.inject({ method: 'GET', url: '/workspaces/save/wss_nope/file' });
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('lists the workspaces and saves one from the command line', async () => {
    const src = await source('sqlite', open);
    const dir = mkdtempSync(join(tmpdir(), 'workspace-save-cli-'));
    dirs.push(dir);
    const runtime = { metaStore: { meta: src.h.meta }, manager: src.h.manager, close: async () => {} } as unknown as CliRuntime;
    const deps = fakeDeps({ cwd: dir, runtime });

    const listed = fakeIo();
    expect(await runCli(['workspace', 'list'], { io: listed, deps })).toBe(0);
    expect(listed.stdout()).toContain(`${src.workspaceId}  Corner Shop`);
    expect(listed.stdout()).toContain('Archive, Clinic');

    const planned = fakeIo();
    expect(await runCli(['workspace', 'save', '--workspace', 'corner shop', '--plan'], { io: planned, deps }), planned.stderr()).toBe(0);
    expect(planned.stdout()).toContain('Corner Shop: 2 app(s)');
    expect(existsSync(join(dir, 'corner-shop.workspace.tgz'))).toBe(false);

    const io = fakeIo();
    expect(await runCli(['workspace', 'save', '--workspace', src.workspaceId, '--out', 'shop.workspace.tgz'], { io, deps }), io.stderr()).toBe(0);
    const bytes = readFileSync(join(dir, 'shop.workspace.tgz'));
    expect(io.stdout()).toContain(`Fingerprint: ${sha512Integrity(bytes)}`);
    expect(readAddOnTarball(bytes).map((entry) => entry.path).sort()).toEqual(['apps/archive-1.0.0.tgz', 'apps/clinic-1.0.0.tgz', 'manifest.json', 'workspace.json']);

    const unknown = fakeIo();
    expect(await runCli(['workspace', 'save', '--workspace', 'nowhere'], { io: unknown, deps })).not.toBe(0);
    expect(unknown.stderr()).toContain('There is no workspace "nowhere"');
    const bare = fakeIo();
    expect(await runCli(['workspace', 'save'], { io: bare, deps: fakeDeps({}) })).not.toBe(0);
    expect(bare.stderr()).toContain('--workspace');
  });
});
