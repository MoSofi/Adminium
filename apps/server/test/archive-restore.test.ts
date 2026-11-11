// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium archive create/restore` and the export variant (security review
 * S15): a round trip on each engine and across engines, what never travels,
 * and every way a restore refuses an archive.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { connectionsRepo, destinationsRepo, filesRepo, pagesRepo, sessionsRepo, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { createArchive } from '../src/archive/create.js';
import { ARCHIVE_MANIFEST, ARCHIVE_SIGNATURE, ArchiveFormatError, type ArchiveManifest } from '../src/archive/format.js';
import { archiveSigningKey, signManifest } from '../src/archive/mac.js';
import { restoreArchive, type RestoreArchiveOptions } from '../src/archive/restore.js';
import { isInstanceArchive } from '../src/archive/zip-read.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import {
  AVAILABLE,
  CRYPTO,
  OTHER_SECRET,
  PASSWORD_HASH,
  SECRET,
  SIGNING,
  makeDirs,
  makeStore,
  seedInstance,
  type Dirs,
  type EngineName,
  type Seeded,
  type Store,
} from './archive.helpers.js';
import { TEST_STORAGE_CRYPTO } from './helpers/file-store.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function store(engine: EngineName, migrated: boolean): Promise<Store> {
  const made = await makeStore(engine, migrated);
  cleanups.push(made.destroy);
  return made;
}

async function dirs(): Promise<Dirs> {
  const made = await makeDirs();
  cleanups.push(made.cleanup);
  return made;
}

interface Source {
  meta: MetaDb;
  dirs: Dirs;
  seeded: Seeded;
  archive: string;
  manifest: ArchiveManifest;
  warnings: string[];
}

async function source(engine: EngineName, kind: 'full' | 'export' = 'full'): Promise<Source> {
  const { meta } = await store(engine, true);
  const here = await dirs();
  const seeded = await seedInstance(meta, here);
  const archive = join(here.root, `out-${kind}.zip`);
  const result = await createArchive({
    meta,
    outPath: archive,
    dataDir: here.dataDir,
    projectRoot: here.projectRoot,
    kind,
    secret: SECRET,
    dsnCrypto: CRYPTO,
    signing: SIGNING,
  });
  return { meta, dirs: here, seeded, archive, manifest: result.manifest, warnings: result.warnings };
}

async function target(engine: EngineName, migrated = false): Promise<{ meta: MetaDb; dirs: Dirs }> {
  const { meta } = await store(engine, migrated);
  return { meta, dirs: await dirs() };
}

function restoreOptions(src: Source, to: { meta: MetaDb; dirs: Dirs }, extra: Partial<RestoreArchiveOptions> = {}): RestoreArchiveOptions {
  return {
    inPath: src.archive,
    meta: to.meta,
    dataDir: to.dirs.dataDir,
    projectRoot: to.dirs.projectRoot,
    secret: SECRET,
    dsnCrypto: CRYPTO,
    signing: SIGNING,
    expect: 'full',
    blockLoopback: true,
    ...extra,
  };
}

/** Rewrite an archive's members through `edit`, re-zipped; signing again when asked. */
async function rewrite(path: string, out: string, edit: (files: Record<string, Uint8Array>) => void, resign: string | null = null): Promise<void> {
  const files = unzipSync(await readFile(path));
  edit(files);
  if (resign !== null) {
    const manifest = files[ARCHIVE_MANIFEST] as Uint8Array;
    files[ARCHIVE_SIGNATURE] = strToU8(JSON.stringify(signManifest(manifest, archiveSigningKey({ ADMINIUM_SECRET: resign }))));
  }
  await writeFile(out, zipSync(files as Zippable));
}

function editManifest(files: Record<string, Uint8Array>, change: (manifest: ArchiveManifest) => void): void {
  const manifest = JSON.parse(Buffer.from(files[ARCHIVE_MANIFEST] as Uint8Array).toString('utf8')) as ArchiveManifest;
  change(manifest);
  files[ARCHIVE_MANIFEST] = strToU8(JSON.stringify(manifest));
}

const entryFor = (path: string, data: Uint8Array) => ({ path, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });

async function expectRefused(promise: Promise<unknown>, message: RegExp): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ArchiveFormatError);
  expect((error as Error).message).toMatch(message);
}

async function expectRoundTrip(src: Source, to: { meta: MetaDb; dirs: Dirs }): Promise<void> {
  const users = usersRepo(to.meta);
  const admin = await users.findByEmail('ava@example.com');
  expect(admin?.id).toBe(src.seeded.admin.id);
  const hash = await to.meta.db.selectFrom('adminium_users').select('passwordHash').where('id', '=', src.seeded.admin.id).executeTakeFirst();
  expect(hash?.passwordHash).toBe(PASSWORD_HASH);

  // Pages, by id, with their config.
  const page = await pagesRepo(to.meta).findById(src.seeded.pageId);
  expect(page?.title).toBe('Orders');
  expect(page?.config).toEqual({ v: 1, widgets: [] });

  // Sessions and tokens never travel: the cookie from before is refused.
  expect(await sessionsRepo(to.meta).findValidByTokenHash(src.seeded.sessionTokenHash)).toBeNull();
  for (const table of ['adminium_sessions', 'adminium_password_resets', 'adminium_api_keys'] as const) {
    const count = await to.meta.db.selectFrom(table).select((eb) => eb.fn.countAll().as('n')).executeTakeFirst();
    expect(Number(count?.n), table).toBe(0);
  }

  // Add-on trust and the Designer's live id never come back; a JSON setting keeps its shape.
  const settings = settingsRepo(to.meta);
  expect(await settings.get('addOns.deciderTrust')).toEqual({});
  expect(await settings.get('designer.liveId')).toBeNull();
  expect(await settings.get('designer.live')).toBe(false);
  expect(await settings.get('publicApi.enabled')).toBe(true);
  // The domain guard ran again: the bad host is gone, the good one stays.
  expect(Object.keys((await settings.get('surfaces.domains')) as object)).toEqual(['shop.example.com']);

  // The upload, byte for byte.
  const file = await filesRepo(to.meta).findById(src.seeded.fileId);
  expect(file?.filename).toBe('invoice.pdf');
  expect(await readFile(join(to.dirs.dataDir, 'files', src.seeded.fileId))).toEqual(src.seeded.fileBytes);

  // The SQLite source landed in the data dir and its DSN points there.
  const connections = connectionsRepo(to.meta, CRYPTO);
  const dsns = await connections.getDsns(src.seeded.sqliteConnectionId);
  const restoredDb = join(to.dirs.dataDir, 'databases', 'shop.sqlite');
  expect(dsns?.dataDsn).toBe(`sqlite:${restoredDb}`);
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(restoredDb, { readonly: true });
  expect(db.prepare('select name from products').get()).toEqual({ name: 'Teapot' });
  db.close();

  // The connection guard ran again: loopback in production loses its string.
  expect((await connections.getDsns(src.seeded.remoteConnectionId))?.dataDsn ?? null).toBeNull();

  // The project folder, less what is the machine's.
  expect(await readFile(join(to.dirs.projectRoot, 'apps', 'shop', 'site', 'index.html'), 'utf8')).toBe('<h1>Shop</h1>\n');
  expect(await readFile(join(to.dirs.projectRoot, 'adminium.config.ts'), 'utf8')).toBe('export default {};\n');
  const top = await readdir(to.dirs.projectRoot);
  expect(top.sort()).toEqual(['adminium.config.ts', 'apps']);
  expect(await readdir(join(to.dirs.projectRoot, 'apps'))).toEqual(['shop']);
}

const ENGINES: EngineName[] = ['sqlite', 'postgres', 'mysql'];
const PAIRS: [EngineName, EngineName][] = [
  ['sqlite', 'sqlite'],
  ['postgres', 'postgres'],
  ['mysql', 'mysql'],
  ['sqlite', 'postgres'],
  ['postgres', 'mysql'],
  ['mysql', 'sqlite'],
  ['postgres', 'sqlite'],
];

describe('archive round trip', () => {
  for (const [from, to] of PAIRS) {
    it.skipIf(!AVAILABLE[from] || !AVAILABLE[to])(`${from} → ${to}: people, pages, files, the SQLite source and the project folder come back`, async () => {
      const src = await source(from);
      expect(src.manifest.dialect).toBe(from);
      expect(src.warnings.some((w) => w.includes('linked.sqlite'))).toBe(true);
      const dest = await target(to);
      const result = await restoreArchive(restoreOptions(src, dest));
      expect(result.warnings.some((w) => w.includes('Warehouse'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('bad host'))).toBe(true);
      await expectRoundTrip(src, dest);
    });
  }
});

describe('what an archive holds', () => {
  it('leaves out sessions, tokens, add-on trust, the live id, .env, .adminium and node_modules', async () => {
    const src = await source('sqlite');
    const files = unzipSync(await readFile(src.archive));
    const names = Object.keys(files);
    expect(names[0]).toBe(ARCHIVE_MANIFEST);
    expect(names[1]).toBe(ARCHIVE_SIGNATURE);
    for (const table of ['adminium_sessions', 'adminium_password_resets', 'adminium_public_sessions', 'adminium_migrations']) {
      expect(names).not.toContain(`adminium-archive/meta/${table}.json`);
    }
    expect(names).toContain('adminium-archive/meta/adminium_api_keys.json');
    expect(names.filter((name) => name.startsWith('adminium-archive/project/')).sort()).toEqual([
      'adminium-archive/project/adminium.config.ts',
      'adminium-archive/project/apps/shop/manifest.json',
      'adminium-archive/project/apps/shop/site/index.html',
    ]);
    const settings = Buffer.from(files['adminium-archive/meta/adminium_settings.json'] as Uint8Array).toString('utf8');
    expect(settings).not.toContain('deciderTrust');
    expect(settings).not.toContain('live-1234');
    expect(settings).toContain('enc:v1:'); // the SMTP password, still sealed
    expect(Buffer.concat(Object.values(files).map((data) => Buffer.from(data))).toString('latin1')).not.toContain('sk-not-for-archives');
    expect(src.manifest.secrets.policy).toBe('encrypted');
    expect(src.manifest.external).toEqual([{ connectionId: src.seeded.remoteConnectionId, engine: 'postgres' }]);
  });

  it('the export carries no password hash, secret, key or token, and is unsigned', async () => {
    const src = await source('sqlite', 'export');
    const files = unzipSync(await readFile(src.archive));
    expect(Object.keys(files)).not.toContain(ARCHIVE_SIGNATURE);
    const all = Buffer.concat(Object.values(files).map((data) => Buffer.from(data))).toString('latin1');
    expect(all).not.toContain('enc:v1:');
    expect(all).not.toContain('$argon2id$');
    expect(Object.keys(files)).not.toContain('adminium-archive/meta/adminium_api_keys.json');
    expect(src.manifest.secrets).toEqual({ policy: 'omitted', check: null });
    expect(await isInstanceArchive(src.archive)).toBe(true);
  });
});

describe('restore refuses', () => {
  it('an unsigned archive', async () => {
    const src = await source('sqlite');
    const out = join(src.dirs.root, 'unsigned.zip');
    await rewrite(src.archive, out, (files) => {
      delete files[ARCHIVE_SIGNATURE];
    });
    await expectRefused(restoreArchive(restoreOptions({ ...src, archive: out }, await target('sqlite'))), /not signed/);
  });

  it('an archive with one byte changed', async () => {
    const src = await source('sqlite');
    const out = join(src.dirs.root, 'altered.zip');
    await rewrite(src.archive, out, (files) => {
      const page = files['adminium-archive/meta/adminium_pages.json'] as Uint8Array;
      const copy = Buffer.from(page);
      copy[copy.indexOf('Orders')] = 'X'.charCodeAt(0);
      files['adminium-archive/meta/adminium_pages.json'] = copy;
    });
    await expectRefused(restoreArchive(restoreOptions({ ...src, archive: out }, await target('sqlite'))), /changed after it was made/);
  });

  it('an altered manifest, and an archive signed with another key', async () => {
    const src = await source('sqlite');
    const altered = join(src.dirs.root, 'altered-manifest.zip');
    await rewrite(src.archive, altered, (files) => editManifest(files, (m) => m.leftOut.push('nothing')));
    await expectRefused(restoreArchive(restoreOptions({ ...src, archive: altered }, await target('sqlite'))), /changed after it was made|another key/);
    const other = archiveSigningKey({ ADMINIUM_SECRET: SECRET, ADMINIUM_ARCHIVE_KEY: 'k'.repeat(40) });
    await expectRefused(restoreArchive(restoreOptions(src, await target('sqlite'), { signing: other })), /another key/);
  });

  it('a member path that climbs out, even when signed', async () => {
    const src = await source('sqlite');
    const out = join(src.dirs.root, 'escape.zip');
    await rewrite(
      src.archive,
      out,
      (files) => {
        const data = strToU8('pwned');
        files['adminium-archive/project/../../evil.txt'] = data;
        editManifest(files, (m) => {
          m.project?.files.push('../../evil.txt');
          m.entries.push(entryFor('adminium-archive/project/../../evil.txt', data));
        });
      },
      SECRET,
    );
    await expectRefused(restoreArchive(restoreOptions({ ...src, archive: out }, await target('sqlite'))), /not allowed|not a readable/);
  });

  it('a symlink member', async () => {
    const src = await source('sqlite');
    const out = join(src.dirs.root, 'link.zip');
    await rewrite(src.archive, out, () => undefined, SECRET);
    // Mark the project's index.html as a symlink in the central directory (unix, S_IFLNK).
    const bytes = Buffer.from(await readFile(out));
    const name = Buffer.from('adminium-archive/project/apps/shop/site/index.html');
    for (let at = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); at >= 0; at = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), at + 4)) {
      const nameLength = bytes.readUInt16LE(at + 28);
      if (bytes.subarray(at + 46, at + 46 + nameLength).equals(name)) {
        bytes.writeUInt16LE((3 << 8) | 20, at + 4);
        bytes.writeUInt32LE((0o120777 << 16) >>> 0, at + 38);
      }
    }
    await writeFile(out, bytes);
    await expectRefused(restoreArchive(restoreOptions({ ...src, archive: out }, await target('sqlite'))), /not a regular file/);
  });

  it('a symlink already in the target, between the root and a file', async () => {
    const src = await source('sqlite');
    const dest = await target('sqlite');
    await mkdir(dest.dirs.projectRoot, { recursive: true });
    await symlink(dest.dirs.root, join(dest.dirs.projectRoot, 'apps'));
    await expectRefused(restoreArchive(restoreOptions(src, dest)), /symbolic link/);
  });

  it('a newer archive format', async () => {
    const src = await source('sqlite');
    const out = join(src.dirs.root, 'newer.zip');
    await rewrite(src.archive, out, (files) => editManifest(files, (m) => {
      m.formatVersion = 99;
    }), SECRET);
    await expectRefused(restoreArchive(restoreOptions({ ...src, archive: out }, await target('sqlite'))), /newer Adminium/);
  });

  it('a different ADMINIUM_SECRET, unless the secrets are dropped', async () => {
    const src = await source('sqlite');
    const keyed = archiveSigningKey({ ADMINIUM_SECRET: SECRET, ADMINIUM_ARCHIVE_KEY: 'operator-key-'.padEnd(40, 'x') });
    const signed = await createArchive({
      meta: src.meta,
      outPath: join(src.dirs.root, 'keyed.zip'),
      dataDir: src.dirs.dataDir,
      projectRoot: null,
      kind: 'full',
      secret: SECRET,
      dsnCrypto: CRYPTO,
      signing: keyed,
    });
    const otherCrypto = dsnCryptoFromSecret(OTHER_SECRET);
    const options = (dest: { meta: MetaDb; dirs: Dirs }, dropSecrets: boolean): RestoreArchiveOptions => ({
      ...restoreOptions({ ...src, archive: signed.path }, dest),
      projectRoot: null,
      secret: OTHER_SECRET,
      dsnCrypto: otherCrypto,
      signing: keyed,
      dropSecrets,
    });
    await expectRefused(restoreArchive(options(await target('sqlite'), false)), /different ADMINIUM_SECRET/);

    const dest = await target('sqlite');
    const result = await restoreArchive(options(dest, true));
    expect(result.sanitized.droppedSettings).toContain('email.smtp');
    expect(await settingsRepo(dest.meta).get('email.smtp')).toBeNull();
    // The SQLite source is re-pointed under the new secret; the person and their password still come back.
    expect((await connectionsRepo(dest.meta, otherCrypto).getDsns(src.seeded.sqliteConnectionId))?.dataDsn).toContain('databases/shop.sqlite');
    expect((await usersRepo(dest.meta).findByEmail('ava@example.com'))?.id).toBe(src.seeded.admin.id);
  });

  it('an instance that already has people in it', async () => {
    const src = await source('sqlite');
    const dest = await target('sqlite', true);
    await seedInstance(dest.meta, { ...dest.dirs, projectRoot: join(dest.dirs.root, 'other-project') });
    await expectRefused(restoreArchive(restoreOptions(src, dest)), /already has people/);
  });

  it('a full archive through import-zip, and an export through archive restore', async () => {
    const full = await source('sqlite');
    await expectRefused(restoreArchive(restoreOptions(full, await target('sqlite'), { expect: 'export' })), /full archive/);
    const exported = await source('sqlite', 'export');
    await expectRefused(restoreArchive(restoreOptions(exported, await target('sqlite'))), /is an export/);
  });

  it('writes nothing when a file in the way already exists', async () => {
    const src = await source('sqlite');
    const dest = await target('sqlite');
    await mkdir(dest.dirs.projectRoot, { recursive: true });
    await writeFile(join(dest.dirs.projectRoot, 'adminium.config.ts'), 'mine\n');
    await expectRefused(restoreArchive(restoreOptions(src, dest)), /already exists/);
    expect(await dest.meta.db.introspection.getTables()).toEqual([]);
  });
});

describe('restore never writes', () => {
  it('add-on trust or package copies, even from a signed archive that carries them', async () => {
    const src = await source('sqlite');
    const out = join(src.dirs.root, 'trust.zip');
    await rewrite(
      src.archive,
      out,
      (files) => {
        const path = 'adminium-archive/meta/adminium_settings.json';
        const dump = JSON.parse(Buffer.from(files[path] as Uint8Array).toString('utf8')) as { columns: string[]; rows: unknown[][] };
        const row = dump.columns.map((column) =>
          column === 'key' ? 'addOns.deciderTrust' : column === 'value' ? JSON.stringify({ 'evil@1.0.0': `sha512-${'B'.repeat(86)}==` }) : column === 'updatedAt' ? 1 : null,
        );
        dump.rows.push(row);
        const data = strToU8(JSON.stringify(dump));
        files[path] = data;
        editManifest(files, (m) => {
          m.entries = m.entries.map((entry) => (entry.path === path ? entryFor(path, data) : entry));
        });
      },
      SECRET,
    );
    const dest = await target('sqlite');
    const result = await restoreArchive(restoreOptions({ ...src, archive: out }, dest));
    expect(result.sanitized.droppedSettings).toContain('addOns.deciderTrust');
    expect(await settingsRepo(dest.meta).get('addOns.deciderTrust')).toEqual({});
  });
});

describe('restore checks storage destinations again', () => {
  it('looks every S3/WebDAV host up, applies the network policy and the folder rules, and switches off what fails', async () => {
    const { meta } = await store('sqlite', true);
    const here = await dirs();
    await seedInstance(meta, here);
    const allowed = join(here.root, 'allowed');
    const elsewhere = join(here.root, 'elsewhere');
    await mkdir(allowed, { recursive: true });
    await mkdir(elsewhere, { recursive: true });
    const repo = destinationsRepo(meta, TEST_STORAGE_CRYPTO);
    const make = async (name: string, driver: 'local' | 's3' | 'webdav', config: Record<string, unknown>) =>
      (await repo.create({ name, driver, config, createdBy: null, ...(driver === 's3' ? { secret: { accessKeyId: 'AK', secretAccessKey: 'SK' } } : {}) }, Date.now())).id;
    const ids = {
      trap: await make('Trap', 's3', { endpoint: 'https://bucket-trap.p75.test', region: 'us-east-1', bucket: 'b', prefix: 'a', forcePathStyle: true }),
      lan: await make('Lan', 'webdav', { url: 'https://nas.p75.test/dav', prefix: 'a' }),
      gone: await make('Gone', 'webdav', { url: 'https://gone.p75.test/dav', prefix: 'a' }),
      cloud: await make('Cloud', 's3', { endpoint: 'https://s3.p75.test', region: 'us-east-1', bucket: 'b', prefix: 'a', forcePathStyle: true }),
      outside: await make('Outside', 'local', { root: elsewhere, prefix: 'a' }),
      kept: await make('Kept', 'local', { root: join(allowed, 'up'), prefix: 'a' }),
    };
    const archive = join(here.root, 'storage.zip');
    await createArchive({ meta, outPath: archive, dataDir: here.dataDir, projectRoot: here.projectRoot, kind: 'full', secret: SECRET, dsnCrypto: CRYPTO, signing: SIGNING });

    const answers: Record<string, string[]> = {
      'bucket-trap.p75.test': ['203.0.113.9', '169.254.169.254'],
      'nas.p75.test': ['192.168.1.20'],
      's3.p75.test': ['203.0.113.10'],
    };
    const dest = await target('sqlite');
    const result = await restoreArchive({
      ...restoreOptions({ archive } as Source, dest),
      blockPrivate: true,
      lookup: async (host) => Promise.resolve(answers[host] ?? []),
      storageRoots: { own: { dataDir: dest.dirs.dataDir, metaFile: null }, dirs: [allowed] },
    });

    const off = async (id: string) => ((await destinationsRepo(dest.meta, TEST_STORAGE_CRYPTO).findById(id))?.disabled ?? false) === true;
    expect(await off(ids.trap)).toBe(true);
    expect(await off(ids.lan)).toBe(true);
    expect(await off(ids.gone)).toBe(true);
    expect(await off(ids.outside)).toBe(true);
    expect(await off(ids.cloud)).toBe(false);
    expect(await off(ids.kept)).toBe(false);
    const said = result.warnings.join('\n');
    expect(said).toMatch(/“Trap” is switched off \(.*blocked address/);
    expect(said).toMatch(/“Lan” is switched off \(.*ADMINIUM_NETWORK_POLICY=strict/);
    expect(said).toMatch(/“Gone” is switched off \(Could not look up gone\.p75\.test/);
    expect(said).toMatch(/“Outside” is switched off \(.*ADMINIUM_STORAGE_DIRS/);
  });
});

describe('--hold, --keep-api-keys, --dry-run', () => {
  it('--hold restores with mail off, the public API and customer sides off, and the Designer off', async () => {
    const src = await source('sqlite');
    const dest = await target('sqlite');
    await restoreArchive(restoreOptions(src, dest, { hold: true }));
    const settings = settingsRepo(dest.meta);
    expect(await settings.get('email.smtp')).toBeNull();
    expect(await settings.get('publicApi.enabled')).toBe(false);
    expect(await settings.get('designer.live')).toBe(false);
    const apps = (await settings.get('surfaces.apps')) as Record<string, { off?: string[] }>;
    expect(apps.shop?.off).toContain('customer');
  });

  it('--keep-api-keys keeps them', async () => {
    const src = await source('sqlite');
    const dest = await target('sqlite');
    await restoreArchive(restoreOptions(src, dest, { keepApiKeys: true }));
    const keys = await dest.meta.db.selectFrom('adminium_api_keys').select('name').execute();
    expect(keys.map((key) => key.name)).toEqual(['ci']);
  });

  it('--dry-run checks everything and writes nothing', async () => {
    const src = await source('sqlite');
    const dest = await target('sqlite');
    const result = await restoreArchive(restoreOptions(src, dest, { dryRun: true }));
    expect(result.dryRun).toBe(true);
    expect(await dest.meta.db.introspection.getTables()).toEqual([]);
    expect(await readdir(dest.dirs.dataDir)).toEqual([]);
  });
});

describe('the export variant through import-zip', () => {
  for (const engine of ENGINES) {
    it.skipIf(!AVAILABLE[engine])(`${engine}: people without passwords, no secrets, the first-run claim kept`, async () => {
      const src = await source(engine, 'export');
      const dest = await target(engine === 'sqlite' ? 'sqlite' : engine);
      const result = await restoreArchive(restoreOptions(src, dest, { expect: 'export', signing: archiveSigningKey({ ADMINIUM_SECRET: OTHER_SECRET }), secret: OTHER_SECRET, dsnCrypto: dsnCryptoFromSecret(OTHER_SECRET) }));
      expect(result.tables.length).toBeGreaterThan(10);
      const admin = await dest.meta.db.selectFrom('adminium_users').select(['id', 'passwordHash']).executeTakeFirst();
      expect(admin).toEqual({ id: src.seeded.admin.id, passwordHash: null });
      expect(await settingsRepo(dest.meta).get('system.superAdminCreatedAt')).not.toBeNull();
      expect(await settingsRepo(dest.meta).get('email.smtp')).toBeNull();
      expect((await pagesRepo(dest.meta).findById(src.seeded.pageId))?.title).toBe('Orders');
      expect(await readFile(join(dest.dirs.dataDir, 'files', src.seeded.fileId))).toEqual(src.seeded.fileBytes);
      expect((await connectionsRepo(dest.meta, dsnCryptoFromSecret(OTHER_SECRET)).getDsns(src.seeded.sqliteConnectionId))?.dataDsn).toContain('databases/shop.sqlite');
    });
  }
});

describe('archive → fresh instance, over HTTP', () => {
  it('signs in with the same password, refuses the cookie from before, and serves the same page', async () => {
    const { buildServer } = await import('../src/app.js');
    const { makeEnv } = await import('./helpers.js');
    const { ADMIN_EMAIL, ADMIN_PASSWORD, adminPasswordHash, login } = await import('./auth-helpers.js');
    const { createFirstSuperAdmin } = await import('@adminium/meta');

    const from = await store('sqlite', true);
    const here = await dirs();
    await createFirstSuperAdmin(from.meta, { email: ADMIN_EMAIL, name: 'Ava', passwordHash: await adminPasswordHash() });
    const page = await pagesRepo(from.meta).create({ slug: 'orders', type: 'dashboard', title: 'Orders', config: { v: 1, widgets: [] } });
    const env = (dataDir: string) => makeEnv({ ADMINIUM_SECRET: SECRET, ADMINIUM_DATA_DIR: dataDir });
    const before = await buildServer({ env: env(here.dataDir), logger: false, metaDb: from.meta });
    const { cookie } = await login(before);
    expect(cookie).not.toBeNull();
    expect((await before.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: cookie ?? '' } })).statusCode).toBe(200);
    await before.close();

    const archive = join(here.root, 'live.zip');
    await createArchive({ meta: from.meta, outPath: archive, dataDir: here.dataDir, projectRoot: null, kind: 'full', secret: SECRET, dsnCrypto: CRYPTO, signing: SIGNING });

    const to = await target('sqlite');
    await restoreArchive({ inPath: archive, meta: to.meta, dataDir: to.dirs.dataDir, projectRoot: null, secret: SECRET, dsnCrypto: CRYPTO, signing: SIGNING, expect: 'full', blockLoopback: true });
    // The restored instance boots as the whole server would.
    const { composeServer } = await import('../src/compose.js');
    const { ConnectionManager } = await import('../src/connections/manager.js');
    const { createRunService } = await import('../src/llm/run-service.js');
    const { createApplyService } = await import('../src/llm/apply-service.js');
    const runService = createRunService({ meta: to.meta });
    const composed = await composeServer({
      env: env(to.dirs.dataDir),
      metaStore: { meta: to.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
      manager: new ConnectionManager({ meta: to.meta, crypto: CRYPTO, metaDsn: null, blockLoopback: false }),
      runService,
      applyService: createApplyService({ meta: to.meta, runService }),
      allowed: null,
      logger: false,
      telemetry: false,
    });
    const after = composed.app;
    await after.ready();
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();
    try {
      expect((await after.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: cookie ?? '' } })).statusCode).toBe(401);
      const again = await login(after, ADMIN_EMAIL, ADMIN_PASSWORD);
      expect(again.res.statusCode).toBe(200);
      const pages = await after.inject({ method: 'GET', url: `/api/v1/pages/${page.id}`, headers: { cookie: again.cookie ?? '' } });
      expect(pages.statusCode).toBe(200);
      expect((pages.json() as { data: unknown }).data).toEqual({ v: 1, widgets: [] });
    } finally {
      await after.close();
    }
  });
});
