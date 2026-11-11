// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Export everything" from Studio (security review S17): the route pair
 * `POST /export/zip` → `GET /export/zip` → `GET /export/zip/:id`, the rules
 * of the file it serves, and `adminium import-zip` reading that file back into
 * a fresh instance on each engine, with the owner's way in.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import {
  createFirstSuperAdmin,
  createSqliteMetaDb,
  firstRun,
  probeAdminiumTables,
  rolesRepo,
  usersRepo,
  type MetaDb,
} from '@adminium/meta';
import { unzipSync } from 'fflate';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../src/app.js';
import { createArchive, type CreateArchiveOptions, type CreateArchiveResult } from '../src/archive/create.js';
import { ARCHIVE_MANIFEST, ARCHIVE_SIGNATURE, type ArchiveManifest } from '../src/archive/format.js';
import { restoreArchive } from '../src/archive/restore.js';
import { hashPassword } from '../src/auth/passwords.js';
import { askExportOwner, importExportFile, writeProjectEnv } from '../src/cli/commands/archive/commands.js';
import { CliUsageError } from '../src/cli/exit.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { ConnectionManager } from '../src/connections/manager.js';
import {
  EXPORT_DOWNLOAD_TTL_MS,
  EXPORT_EVERYTHING_DIR,
  createExportEverything,
  exportFileName,
  type ExportEverything,
} from '../src/export/everything.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { AVAILABLE, CRYPTO, SECRET, SIGNING, makeDirs, makeStore, seedInstance, type Dirs, type EngineName, type Seeded } from './archive.helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';
import { makeEnv } from './helpers.js';

const NEW_PASSWORD = 'a-new-password-for-the-owner';

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function freshDirs(): Promise<Dirs> {
  const made = await makeDirs();
  cleanups.push(made.cleanup);
  return made;
}

// ── the rules, on the service ──────────────────────────────────────────────

describe('Export everything: the file’s rules', () => {
  let meta: MetaDb;
  let dirs: Dirs;
  let clock: number;
  let service: ExportEverything;
  /** Whether this test made a service for the afterEach to stop. */
  let made = false;
  /** Gates the writer: the export stays "preparing" until `release()`. */
  let gate: { release: () => void; wait: Promise<void> };
  const A = { userId: 'usr_a', sessionId: 'ses_a1' };
  const A2 = { userId: 'usr_a', sessionId: 'ses_a2' };
  const B = { userId: 'usr_b', sessionId: 'ses_b1' };

  const newGate = (): typeof gate => {
    let release = (): void => undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { release, wait };
  };

  beforeAll(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    cleanups.push(async () => meta.db.destroy());
  });

  afterEach(async () => {
    if (!made) return;
    made = false;
    gate.release();
    await service.settled();
    service.close();
  });

  const make = async (): Promise<void> => {
    made = true;
    dirs = await freshDirs();
    clock = Date.UTC(2026, 10, 10, 9, 0, 0);
    gate = newGate();
    const build = async (opts: CreateArchiveOptions): Promise<CreateArchiveResult> => {
      opts.onProgress?.(0.4);
      await gate.wait;
      return createArchive(opts);
    };
    service = createExportEverything({
      meta,
      dataDir: dirs.dataDir,
      projectRoot: null,
      secret: SECRET,
      dsnCrypto: CRYPTO,
      signing: SIGNING,
      appName: async () => 'Hollis Bakery',
      now: () => clock,
      build,
    });
  };

  it('names the file after the instance and the day', () => {
    expect(exportFileName('Hollis Bakery', Date.UTC(2026, 10, 10))).toBe('hollis-bakery-2026-11-10.zip');
    expect(exportFileName('Café Lune!', Date.UTC(2026, 0, 2))).toBe('cafe-lune-2026-01-02.zip');
    expect(exportFileName('مخبز', Date.UTC(2026, 0, 2))).toBe('adminium-2026-01-02.zip');
  });

  it('makes one export at a time on the instance', async () => {
    await make();
    const first = await service.start(A);
    expect(first).toMatchObject({ state: 'preparing' });
    expect((await service.current(A))?.state).toBe('preparing');
    // While it is being made, nobody starts another, its own session included.
    await expect(service.start(B)).rejects.toThrow(/being made already/);
    await expect(service.start(A)).rejects.toThrow(/being made already/);
    gate.release();
    await service.settled();
    expect(await service.current(A)).toMatchObject({ state: 'ready', fileName: 'hollis-bakery-2026-11-10.zip' });
    // Waiting for A's download: B is refused; A asking again throws its own file away.
    await expect(service.start(B)).rejects.toThrow(/waits for its download/);
    const firstFile = join(dirs.dataDir, EXPORT_EVERYTHING_DIR, `${first.id}.zip`);
    expect((await readdir(join(dirs.dataDir, EXPORT_EVERYTHING_DIR))).includes(`${first.id}.zip`)).toBe(true);
    gate = newGate();
    const second = await service.start(A);
    expect(second.id).not.toBe(first.id);
    await expect(readFile(firstFile)).rejects.toThrow();
  });

  it('binds the id to the user and the session, and hands the file out once', async () => {
    await make();
    const started = await service.start(A);
    gate.release();
    await service.settled();
    // Not before it is made, not to another session of the same person, not to another person.
    expect(await service.current(A2)).toBeNull();
    expect(await service.current(B)).toBeNull();
    expect(await service.take(started.id, A2)).toBe('unknown');
    expect(await service.take(started.id, B)).toBe('unknown');
    expect(await service.take('0'.repeat(32), A)).toBe('unknown');
    const taken = await service.take(started.id, A);
    if (typeof taken === 'string') throw new Error(`expected the file, got ${taken}`);
    expect(taken.fileName).toBe('hollis-bakery-2026-11-10.zip');
    expect((await readFile(taken.path)).subarray(0, 2).toString()).toBe('PK');
    // Once: the same session asking again hears that it is gone, and the page shows "Download everything" again.
    expect(await service.take(started.id, A)).toBe('gone');
    expect(await service.current(A)).toBeNull();
    await taken.release();
    expect(await readdir(join(dirs.dataDir, EXPORT_EVERYTHING_DIR))).toEqual([]);
  });

  it('expires a waiting file after ten minutes and removes it', async () => {
    await make();
    const started = await service.start(A);
    gate.release();
    await service.settled();
    expect(EXPORT_DOWNLOAD_TTL_MS).toBe(10 * 60_000);
    clock += EXPORT_DOWNLOAD_TTL_MS - 1;
    expect((await service.current(A))?.state).toBe('ready');
    clock += 1;
    expect(await service.current(A)).toEqual({ id: started.id, state: 'expired' });
    expect(await service.take(started.id, A)).toBe('gone');
    expect(await readdir(join(dirs.dataDir, EXPORT_EVERYTHING_DIR))).toEqual([]);
    // An expired file holds nobody up.
    gate = newGate();
    expect((await service.start(B)).state).toBe('preparing');
  });

  it('says why when the file could not be made, and leaves nothing behind', async () => {
    await make();
    const failing = createExportEverything({
      meta,
      dataDir: dirs.dataDir,
      projectRoot: null,
      secret: SECRET,
      dsnCrypto: CRYPTO,
      signing: SIGNING,
      appName: async () => 'x',
      build: async (opts) => {
        await writeFile(`${opts.outPath}.part`, 'half');
        throw new Error('disk full');
      },
    });
    const started = await failing.start(A);
    await failing.settled();
    expect(await failing.current(A)).toEqual({ id: started.id, state: 'failed', message: 'The file could not be made. The server’s log says why.' });
    expect(await readdir(join(dirs.dataDir, EXPORT_EVERYTHING_DIR))).toEqual([]);
    failing.close();
  });

  it('removes what an earlier process left behind', async () => {
    await make();
    const leftovers = join(dirs.dataDir, EXPORT_EVERYTHING_DIR);
    await mkdir(join(leftovers, '.archive-tmp-abc'), { recursive: true });
    await writeFile(join(leftovers, `${'a'.repeat(32)}.zip`), 'old');
    await service.sweep();
    await expect(readdir(leftovers)).rejects.toThrow();
  });
});

// ── the route pair, on a composed server ───────────────────────────────────

interface Signed {
  cookie: string;
  write: Record<string, string>;
}

let server: ComposedServer;
let sourceMeta: MetaDb;
let sourceDirs: Dirs;
let seeded: Seeded;
/** The file the route served, on disk: the import tests read it. */
let exported: string;

async function signIn(email: string): Promise<Signed> {
  const login = await server.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: ADMIN_PASSWORD } });
  expect(login.statusCode, login.body).toBe(200);
  const cookie = sessionCookie(login.headers['set-cookie']);
  const boot = await server.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie } });
  const csrf = (boot.json() as { data: { csrfToken: string } }).data.csrfToken;
  return { cookie, write: { cookie, 'x-csrf-token': csrf } };
}

async function compose(meta: MetaDb, dataDir: string): Promise<ComposedServer> {
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv({ ADMINIUM_SECRET: SECRET, ADMINIUM_DATA_DIR: dataDir, HOST: '127.0.0.1' }),
    metaStore: { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
    manager: new ConnectionManager({ meta, crypto: CRYPTO, metaDsn: null }),
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
  });
  await composed.app.ready();
  await composed.jobs.worker.stop();
  composed.jobs.scheduler.stop();
  return composed;
}

/** Ask until the file is ready; a deadline keeps a stuck export from hanging the suite. */
async function untilReady(who: Signed): Promise<{ id: string; fileName: string; bytes: number }> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const res = await server.app.inject({ method: 'GET', url: '/api/v1/export/zip', headers: { cookie: who.cookie } });
    expect(res.statusCode, res.body).toBe(200);
    const view = (res.json() as { export: { id: string; state: string; percent: number; fileName: string; bytes: number } | null }).export;
    expect(view).not.toBeNull();
    if (view?.state === 'ready') return view;
    expect(view?.state).toBe('preparing');
    expect(view?.percent).toBeGreaterThanOrEqual(0);
    if (Date.now() > deadline) throw new Error('the export never became ready');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('the route pair', () => {
  let ava: Signed;
  let bo: Signed;

  beforeAll(async () => {
    sourceMeta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(sourceMeta);
    sourceDirs = await freshDirs();
    seeded = await seedInstance(sourceMeta, sourceDirs);
    // Ava can sign in; Bo is a second Super Admin; Cy is an Admin, not a Super Admin.
    await usersRepo(sourceMeta).updatePassword(seeded.admin.id, await adminPasswordHash());
    const roles = rolesRepo(sourceMeta);
    const all = await sourceMeta.db.selectFrom('adminium_roles').select(['id', 'slug']).execute();
    const roleId = (slug: string): string => String(all.find((role) => role.slug === slug)?.id);
    const boUser = await usersRepo(sourceMeta).create({ email: 'bo@example.com', name: 'Bo', passwordHash: await adminPasswordHash() });
    await roles.assignToUser(boUser.id, roleId('super-admin'));
    const cyUser = await usersRepo(sourceMeta).create({ email: 'cy@example.com', name: 'Cy', passwordHash: await adminPasswordHash() });
    await roles.assignToUser(cyUser.id, roleId('admin'));
    // A file a crash left behind, before this boot.
    await mkdir(join(sourceDirs.dataDir, EXPORT_EVERYTHING_DIR), { recursive: true });
    await writeFile(join(sourceDirs.dataDir, EXPORT_EVERYTHING_DIR, `${'b'.repeat(32)}.zip`), 'left by a crash');
    server = await compose(sourceMeta, sourceDirs.dataDir);
    cleanups.push(async () => server.app.close());
    ava = await signIn('ava@example.com');
    bo = await signIn('bo@example.com');
  });

  it('removed the leftovers of an earlier process at boot', async () => {
    expect(await readdir(join(sourceDirs.dataDir, EXPORT_EVERYTHING_DIR)).catch(() => [])).toEqual([]);
  });

  it('answers only a Super Admin in a signed-in session', async () => {
    const nobody = await server.app.inject({ method: 'POST', url: '/api/v1/export/zip' });
    expect(nobody.statusCode).toBe(401);
    const cy = await signIn('cy@example.com');
    for (const req of [
      { method: 'POST' as const, url: '/api/v1/export/zip', headers: cy.write },
      { method: 'GET' as const, url: '/api/v1/export/zip', headers: { cookie: cy.cookie } },
      { method: 'GET' as const, url: `/api/v1/export/zip/${'c'.repeat(32)}`, headers: { cookie: cy.cookie } },
    ]) {
      const res = await server.app.inject(req);
      expect(res.statusCode, `${req.method} ${req.url}`).toBe(403);
      expect(res.json()).toMatchObject({ error: { details: { reason: 'SUPER_ADMIN' } } });
    }
    const idle = await server.app.inject({ method: 'GET', url: '/api/v1/export/zip', headers: { cookie: ava.cookie } });
    expect(idle.json()).toEqual({ export: null });
  });

  it('makes the file, sends it once to the session that asked, then deletes it', async () => {
    // A body asking for secrets is not read: the route has no such choice.
    const start = await server.app.inject({ method: 'POST', url: '/api/v1/export/zip', headers: ava.write, payload: { includeSecrets: true } });
    expect(start.statusCode, start.body).toBe(202);
    const started = (start.json() as { export: { id: string; state: string } }).export;
    expect(started.state).toBe('preparing');
    expect(started.id).toMatch(/^[0-9a-f]{32}$/);

    const ready = await untilReady(ava);
    expect(ready.id).toBe(started.id);
    expect(ready.fileName).toMatch(/^adminium-\d{4}-\d{2}-\d{2}\.zip$/);

    // Another Super Admin's session, and Ava's own other session, find nothing; nor does a second export start.
    expect((await server.app.inject({ method: 'GET', url: `/api/v1/export/zip/${started.id}`, headers: { cookie: bo.cookie } })).statusCode).toBe(404);
    const ava2 = await signIn('ava@example.com');
    expect((await server.app.inject({ method: 'GET', url: `/api/v1/export/zip/${started.id}`, headers: { cookie: ava2.cookie } })).statusCode).toBe(404);
    const busy = await server.app.inject({ method: 'POST', url: '/api/v1/export/zip', headers: bo.write });
    expect(busy.statusCode).toBe(409);
    expect(busy.json()).toMatchObject({ error: { details: { reason: 'BUSY' } } });

    const download = await server.app.inject({ method: 'GET', url: `/api/v1/export/zip/${started.id}`, headers: { cookie: ava.cookie } });
    expect(download.statusCode, download.body).toBe(200);
    expect(download.headers['content-type']).toBe('application/zip');
    expect(download.headers['content-disposition']).toBe(`attachment; filename="${ready.fileName}"`);
    expect(download.headers['cache-control']).toBe('no-store');
    expect(download.rawPayload.length).toBe(ready.bytes);
    exported = join(sourceDirs.root, ready.fileName);
    await writeFile(exported, download.rawPayload);

    // Once.
    const again = await server.app.inject({ method: 'GET', url: `/api/v1/export/zip/${started.id}`, headers: { cookie: ava.cookie } });
    expect(again.statusCode).toBe(410);
    expect((await server.app.inject({ method: 'GET', url: '/api/v1/export/zip', headers: { cookie: ava.cookie } })).json()).toEqual({ export: null });
    // The temp file is gone, and the next export may start.
    await expect.poll(async () => readdir(join(sourceDirs.dataDir, EXPORT_EVERYTHING_DIR))).toEqual([]);
    const audit = await sourceMeta.db.selectFrom('adminium_audit_log').select(['action', 'actorId']).where('action', 'like', 'export.everything.%').execute();
    expect(audit.map((row) => row.action).sort()).toEqual(['export.everything.download', 'export.everything.start']);
    expect(new Set(audit.map((row) => row.actorId))).toEqual(new Set([seeded.admin.id]));
  });

  it('holds the archive’s contents without password hashes, secrets, API keys or tokens', async () => {
    const members = unzipSync(new Uint8Array(await readFile(exported)));
    const manifest = JSON.parse(Buffer.from(members[ARCHIVE_MANIFEST] as Uint8Array).toString()) as ArchiveManifest;
    expect(manifest.kind).toBe('export');
    expect(manifest.secrets).toEqual({ policy: 'omitted', check: null });
    expect(members[ARCHIVE_SIGNATURE]).toBeUndefined();
    // The archive's contents: people, pages, the upload, the SQLite source.
    expect(manifest.meta.map((entry) => entry.table)).toEqual(expect.arrayContaining(['adminium_users', 'adminium_pages', 'adminium_files', 'adminium_connections']));
    expect(manifest.files.map((file) => file.id)).toEqual([seeded.fileId]);
    expect(manifest.databases.map((db) => db.connectionId)).toEqual([seeded.sqliteConnectionId]);
    for (const table of ['adminium_sessions', 'adminium_password_resets', 'adminium_api_keys', 'adminium_public_keys']) {
      expect(manifest.meta.some((entry) => entry.table === table), table).toBe(false);
    }
    const everything = Object.entries(members)
      .filter(([path]) => !path.endsWith('.sqlite') && !path.includes('/files/'))
      .map(([, bytes]) => Buffer.from(bytes).toString('latin1'))
      .join('\n');
    expect(everything).not.toContain('$argon2');
    expect(everything).not.toContain('enc:v1:');
    expect(everything).not.toContain(seeded.sessionTokenHash);
    expect(everything).not.toContain('f'.repeat(64)); // the reset token's hash
    expect(everything).not.toContain('e'.repeat(64)); // the API key's hash
    expect(everything).not.toContain('pw@127.0.0.1'); // a connection string
  });
});

// ── import-zip, on a fresh instance of each engine ─────────────────────────

const ENGINES: EngineName[] = ['sqlite', 'postgres', 'mysql'];

describe.each(ENGINES)('adminium import-zip on a fresh %s instance', (engine) => {
  it.skipIf(!AVAILABLE[engine])('restores the export, and its owner signs in with the password the import gave', async () => {
    const target = await makeStore(engine, false);
    cleanups.push(target.destroy);
    const here = await freshDirs();
    const io = fakeIo({ interactive: false });
    const result = await restoreArchive({
      inPath: exported,
      meta: target.meta,
      dataDir: here.dataDir,
      projectRoot: here.projectRoot,
      secret: SECRET,
      dsnCrypto: CRYPTO,
      signing: SIGNING,
      expect: 'export',
      blockLoopback: false,
      owner: askExportOwner(io, { ownerEmail: 'ava@example.com', passwordStdin: true, readStdin: async () => NEW_PASSWORD }),
    });
    expect(result.owner?.email).toBe('ava@example.com');
    expect(result.files).toBe(1);
    expect(result.databases).toBe(1);

    const app = await buildServer({ env: makeEnv({ ADMINIUM_SECRET: SECRET }), logger: false, metaDb: target.meta });
    try {
      const owner = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'ava@example.com', password: NEW_PASSWORD } });
      expect(owner.statusCode, owner.body).toBe(200);
      // Her old password did not travel, and the others came without one.
      const old = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'ava@example.com', password: ADMIN_PASSWORD } });
      expect(old.statusCode).toBe(401);
      const other = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'bo@example.com', password: ADMIN_PASSWORD } });
      expect(other.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});

describe('the owner’s way in', () => {
  async function freshTarget(): Promise<{ meta: MetaDb; dirs: Dirs }> {
    const target = await makeStore('sqlite', false);
    cleanups.push(target.destroy);
    return { meta: target.meta, dirs: await freshDirs() };
  }

  const restore = (meta: MetaDb, dirs: Dirs, owner: Parameters<typeof askExportOwner>[1], io = fakeIo({ interactive: false })) =>
    restoreArchive({
      inPath: exported,
      meta,
      dataDir: dirs.dataDir,
      projectRoot: dirs.projectRoot,
      secret: SECRET,
      dsnCrypto: CRYPTO,
      signing: SIGNING,
      expect: 'export',
      blockLoopback: false,
      owner: askExportOwner(io, owner),
    });

  it('gives the person named by --owner the password', async () => {
    const { meta, dirs } = await freshTarget();
    const result = await restore(meta, dirs, { ownerEmail: 'BO@example.com', passwordStdin: true, readStdin: async () => NEW_PASSWORD });
    expect(result.owner?.email).toBe('bo@example.com');
    const bo = await usersRepo(meta).findByEmail('bo@example.com');
    expect(bo?.passwordHash).toMatch(/^\$argon2id\$/);
    expect((await usersRepo(meta).findByEmail('ava@example.com'))?.passwordHash).toBeNull();
  });

  it('asks in a terminal: who, then the password twice', async () => {
    const { meta, dirs } = await freshTarget();
    const io = fakeIo({ interactive: true, selections: [1], answers: [NEW_PASSWORD, NEW_PASSWORD] });
    const result = await restore(meta, dirs, { ownerEmail: undefined, passwordStdin: false }, io);
    expect(result.owner?.email).toBe('bo@example.com');
  });

  it('writes nothing when there is no password to give, a wrong person or a short password', async () => {
    const { meta, dirs } = await freshTarget();
    await expect(restore(meta, dirs, { ownerEmail: 'ava@example.com', passwordStdin: false })).rejects.toThrow(/on standard input \(--password-stdin\)/);
    await expect(restore(meta, dirs, { ownerEmail: 'cy@example.com', passwordStdin: true, readStdin: async () => NEW_PASSWORD })).rejects.toThrow(/not a Super Admin in this export/);
    await expect(restore(meta, dirs, { ownerEmail: 'ava@example.com', passwordStdin: true, readStdin: async () => 'short' })).rejects.toThrow(/at least 10 characters/);
    // Two Super Admins, no --owner and no terminal: refused, rather than one picked for the operator.
    let read = false;
    const unnamed = restore(meta, dirs, {
      ownerEmail: undefined,
      passwordStdin: true,
      readStdin: async () => {
        read = true;
        return NEW_PASSWORD;
      },
    });
    await expect(unnamed).rejects.toBeInstanceOf(CliUsageError);
    await expect(unnamed).rejects.toThrow(/2 Super Admins \(ava@example\.com, bo@example\.com\)\. Name the one who gets the new password with --owner/);
    expect(read).toBe(false);
    const mismatch = fakeIo({ interactive: true, selections: [0], answers: [NEW_PASSWORD, 'something-else-entirely'] });
    await expect(restore(meta, dirs, { ownerEmail: undefined, passwordStdin: false }, mismatch)).rejects.toThrow(/not the same/);
    expect((await probeAdminiumTables(meta)).present).toEqual([]);
    expect(await readdir(dirs.dataDir)).toEqual([]);
  });

  it('runs through `adminium import-zip <file> --password-stdin`', async () => {
    const dirs = await freshDirs();
    const io = fakeIo({ interactive: false });
    const deps = fakeDeps({ env: { ADMINIUM_SECRET: SECRET, ADMINIUM_DATA_DIR: dirs.dataDir }, cwd: dirs.root });
    const code = await importExportFile({ io, deps }, exported, {
      dryRun: false,
      dataDir: undefined,
      metaUrl: undefined,
      projectDir: dirs.projectRoot,
      ownerEmail: 'ava@example.com',
      passwordStdin: true,
      readStdin: async () => NEW_PASSWORD,
    });
    expect(code).toBe(0);
    expect(io.stdout()).toContain('ava@example.com signs in with the password just given.');
    // The instance the CLI wrote is the built-in store in that data dir: sign in there.
    const { openMetaStore } = await import('../src/meta/store.js');
    const store = await openMetaStore({ dataDir: dirs.dataDir, secret: SECRET });
    try {
      const app = await buildServer({ env: makeEnv({ ADMINIUM_SECRET: SECRET }), logger: false, metaDb: store.meta });
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'ava@example.com', password: NEW_PASSWORD } });
      expect(login.statusCode, login.body).toBe(200);
      await app.close();
    } finally {
      await store.close();
    }
  });

  it('gives the only Super Admin the password with no --owner and no terminal', async () => {
    const source = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(source);
    cleanups.push(async () => source.db.destroy());
    await createFirstSuperAdmin(source, { email: 'dee@example.com', name: 'Dee', passwordHash: await hashPassword(ADMIN_PASSWORD) });
    const dirs = await freshDirs();
    const single = join(dirs.root, 'single-export.zip');
    await createArchive({ meta: source, outPath: single, dataDir: dirs.dataDir, projectRoot: null, kind: 'export', secret: SECRET, dsnCrypto: CRYPTO, signing: SIGNING });
    const { meta, dirs: there } = await freshTarget();
    const result = await restoreArchive({
      inPath: single,
      meta,
      dataDir: there.dataDir,
      projectRoot: null,
      secret: SECRET,
      dsnCrypto: CRYPTO,
      signing: SIGNING,
      expect: 'export',
      blockLoopback: false,
      owner: askExportOwner(fakeIo({ interactive: false }), { ownerEmail: undefined, passwordStdin: true, readStdin: async () => NEW_PASSWORD }),
    });
    expect(result.owner?.email).toBe('dee@example.com');
  });

  it('is never asked for a full archive, whose people keep their passwords', async () => {
    const source = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(source);
    cleanups.push(async () => source.db.destroy());
    const hash = await hashPassword(ADMIN_PASSWORD);
    await createFirstSuperAdmin(source, { email: 'dee@example.com', name: 'Dee', passwordHash: hash });
    const dirs = await freshDirs();
    const archive = join(dirs.root, 'full.zip');
    await createArchive({ meta: source, outPath: archive, dataDir: dirs.dataDir, projectRoot: null, kind: 'full', secret: SECRET, dsnCrypto: CRYPTO, signing: SIGNING });
    const { meta, dirs: there } = await freshTarget();
    let asked = false;
    const result = await restoreArchive({
      inPath: archive,
      meta,
      dataDir: there.dataDir,
      projectRoot: null,
      secret: SECRET,
      dsnCrypto: CRYPTO,
      signing: SIGNING,
      expect: 'full',
      blockLoopback: false,
      owner: async () => {
        asked = true;
        throw new Error('not for a full archive');
      },
    });
    expect(asked).toBe(false);
    expect(result.owner).toBeNull();
    expect((await usersRepo(meta).findByEmail('dee@example.com'))?.passwordHash).toBe(hash);
  });
});

describe('`import-zip --json`: what an app that imports the file reads', () => {
  const run = async (dirs: Dirs, opts: Partial<Parameters<typeof importExportFile>[2]>, file = exported) => {
    const io = fakeIo({ interactive: false });
    const deps = fakeDeps({ env: { ADMINIUM_SECRET: SECRET, ADMINIUM_DATA_DIR: dirs.dataDir }, cwd: dirs.root });
    const code = await importExportFile({ io, deps }, file, { dryRun: false, dataDir: undefined, metaUrl: undefined, projectDir: dirs.projectRoot, json: true, ...opts });
    const lines = io.stdout().trim().split('\n');
    // One line, and nothing else on standard output for the app to trip over.
    expect(lines).toHaveLength(1);
    return { code, out: JSON.parse(lines[0] ?? '') as Record<string, unknown> };
  };

  it('a dry run says what the file holds and who may be given the first password, and writes no one in', async () => {
    const dirs = await freshDirs();
    const { code, out } = await run(dirs, { dryRun: true });
    expect(code).toBe(0);
    expect(out).toMatchObject({ ok: true, dryRun: true, kind: 'export', files: 1, databases: 1, passwordMinLength: 10, owner: null });
    expect(out.people).toBeGreaterThanOrEqual(2);
    expect(out.pages).toBeGreaterThanOrEqual(1);
    expect((out.owners as { email: string }[]).map((owner) => owner.email)).toEqual(['ava@example.com', 'bo@example.com']);
    // Nothing of the export is in the data dir: no person to sign in as, no file.
    expect((await readdir(dirs.dataDir)).filter((name) => name !== 'meta.db' && !name.startsWith('meta.db-'))).toEqual([]);
  });

  it('a project folder that came in the file gets the .env its config reads, as `new` writes one, and none of the file’s', async () => {
    const dirs = await freshDirs();
    await mkdir(dirs.projectRoot, { recursive: true });
    await writeFile(join(dirs.projectRoot, '.env.example'), 'ADMINIUM_SECRET=\nDATABASE_URL=\nSTRIPE_KEY=sk_test_example\n');
    await writeFile(join(dirs.projectRoot, '.env'), 'ADMINIUM_SECRET=kept\n');
    const written = writeProjectEnv(dirs.projectRoot, {
      projectDatabases: [
        { key: 'main', name: 'Shop', file: join(dirs.projectRoot, 'data', 'databases', 'shop.sqlite') },
        { key: 'warehouse', name: 'Warehouse', file: null },
      ],
    });
    expect(written).toEqual(['DATABASE_URL', 'WAREHOUSE_DATABASE_URL', 'STRIPE_KEY']);
    const env = await readFile(join(dirs.projectRoot, '.env'), 'utf8');
    expect(env).toMatch(/^ADMINIUM_SECRET=kept$/m);
    expect(env).toMatch(/^DATABASE_URL=sqlite:\.\/data\/databases\/shop\.sqlite$/m);
    expect(env).toMatch(/^WAREHOUSE_DATABASE_URL=$/m);
    // A name from .env.example, never its value.
    expect(env).toMatch(/^STRIPE_KEY=$/m);
    expect(env).not.toContain('sk_test_example');
  });

  it('the import itself names who was given the password', async () => {
    const dirs = await freshDirs();
    const { code, out } = await run(dirs, { ownerEmail: 'bo@example.com', passwordStdin: true, readStdin: async () => NEW_PASSWORD });
    expect(code).toBe(0);
    expect(out).toMatchObject({ ok: true, dryRun: false, owner: 'bo@example.com' });
    // The connection that came without its string, by name: the app says which to finish.
    expect(out.drafts).toContain('Warehouse');
  });

  it('a refusal is JSON too: a short password, and a full archive, which names its own command', async () => {
    const short = await run(await freshDirs(), { ownerEmail: 'ava@example.com', passwordStdin: true, readStdin: async () => 'short' });
    expect(short.code).toBe(1);
    expect(short.out).toMatchObject({ ok: false, refused: 'refused' });
    expect(short.out.message).toMatch(/at least 10 characters/);

    const source = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(source);
    cleanups.push(async () => source.db.destroy());
    await createFirstSuperAdmin(source, { email: 'dee@example.com', name: 'Dee', passwordHash: await hashPassword(ADMIN_PASSWORD) });
    const dirs = await freshDirs();
    const archive = join(dirs.root, 'full.zip');
    await createArchive({ meta: source, outPath: archive, dataDir: dirs.dataDir, projectRoot: null, kind: 'full', secret: SECRET, dsnCrypto: CRYPTO, signing: SIGNING });
    const full = await run(await freshDirs(), { dryRun: true }, archive);
    expect(full.code).toBe(1);
    expect(full.out).toMatchObject({ ok: false, refused: 'full-archive' });
    expect(full.out.hint).toContain('adminium archive restore');
  });
});
