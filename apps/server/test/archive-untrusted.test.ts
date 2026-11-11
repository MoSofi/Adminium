// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An export file is untrusted input: hand-made exports that try to decide what
 * only the server or the person may decide. Each is built from a real export
 * (`createArchive --export`), changed member by member with the manifest's
 * sizes and digests made to match, since an export is unsigned.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type MetaDb } from '@adminium/meta';
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { createArchive } from '../src/archive/create.js';
import { ARCHIVE_MANIFEST, ArchiveFormatError, isExcludedProjectPath, type ArchiveManifest } from '../src/archive/format.js';
import { restoreArchive, type RestoreArchiveOptions } from '../src/archive/restore.js';
import { CRYPTO, PASSWORD_HASH, SECRET, SIGNING, makeDirs, makeStore, seedInstance, type Dirs, type EngineName } from './archive.helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function store(engine: EngineName, migrated: boolean): Promise<MetaDb> {
  const made = await makeStore(engine, migrated);
  cleanups.push(made.destroy);
  return made.meta;
}

async function dirs(): Promise<Dirs> {
  const made = await makeDirs();
  cleanups.push(made.cleanup);
  return made;
}

interface Exported {
  dirs: Dirs;
  archive: string;
}

/** A real export of the seeded instance. */
async function exported(): Promise<Exported> {
  const meta = await store('sqlite', true);
  const here = await dirs();
  await seedInstance(meta, here);
  const archive = join(here.root, 'export.zip');
  await createArchive({ meta, outPath: archive, dataDir: here.dataDir, projectRoot: here.projectRoot, kind: 'export', secret: SECRET, dsnCrypto: CRYPTO, signing: SIGNING });
  return { dirs: here, archive };
}

const entryFor = (path: string, data: Uint8Array) => ({ path, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });

/** The export's members, changed through `edit`, re-zipped beside it. */
class HandMade {
  readonly files: Record<string, Uint8Array>;
  readonly manifest: ArchiveManifest;

  constructor(bytes: Uint8Array) {
    this.files = unzipSync(bytes);
    this.manifest = JSON.parse(Buffer.from(this.files[ARCHIVE_MANIFEST] as Uint8Array).toString('utf8')) as ArchiveManifest;
  }

  /** A member, listed in the manifest with its size and digest. */
  put(path: string, data: Uint8Array): void {
    this.files[path] = data;
    this.manifest.entries = this.manifest.entries.filter((entry) => entry.path !== path);
    this.manifest.entries.push(entryFor(path, data));
  }

  addProject(rel: string, text: string): void {
    this.put(`adminium-archive/project/${rel}`, strToU8(text));
    this.manifest.project?.files.push(rel);
  }

  removeProject(rel: string): void {
    const path = `adminium-archive/project/${rel}`;
    delete this.files[path];
    this.manifest.entries = this.manifest.entries.filter((entry) => entry.path !== path);
    if (this.manifest.project !== null) this.manifest.project.files = this.manifest.project.files.filter((file) => file !== rel);
  }

  /** A meta table's rows, as objects, changed through `change` and written back. */
  table(table: string, change: (rows: Record<string, unknown>[], dump: { columns: string[]; kinds: Record<string, string> }) => void): void {
    const path = `adminium-archive/meta/${table}.json`;
    const dump = JSON.parse(Buffer.from(this.files[path] as Uint8Array).toString('utf8')) as { columns: string[]; kinds: Record<string, string>; rows: unknown[][] };
    const rows = dump.rows.map((cells) => Object.fromEntries(dump.columns.map((column, index) => [column, cells[index]])));
    change(rows, dump);
    dump.rows = rows.map((row) => dump.columns.map((column) => row[column] ?? null));
    this.put(path, strToU8(JSON.stringify(dump)));
    this.manifest.meta = this.manifest.meta.map((entry) => (entry.path === path ? { ...entry, rows: dump.rows.length } : entry));
  }

  async write(out: string): Promise<string> {
    this.files[ARCHIVE_MANIFEST] = strToU8(JSON.stringify(this.manifest));
    await writeFile(out, zipSync(this.files as Zippable));
    return out;
  }
}

async function handMade(src: Exported, name: string, edit: (zip: HandMade) => void): Promise<string> {
  const zip = new HandMade(await readFile(src.archive));
  edit(zip);
  return zip.write(join(src.dirs.root, `${name}.zip`));
}

interface Target {
  meta: MetaDb;
  dirs: Dirs;
}

async function target(engine: EngineName = 'sqlite'): Promise<Target> {
  return { meta: await store(engine, false), dirs: await dirs() };
}

function importOptions(archive: string, to: Target, extra: Partial<RestoreArchiveOptions> = {}): RestoreArchiveOptions {
  return {
    inPath: archive,
    meta: to.meta,
    dataDir: to.dirs.dataDir,
    projectRoot: to.dirs.projectRoot,
    secret: SECRET,
    dsnCrypto: CRYPTO,
    signing: SIGNING,
    expect: 'export',
    blockLoopback: true,
    owner: async ({ candidates }) => Promise.resolve({ userId: candidates[0]?.id ?? '', passwordHash: PASSWORD_HASH }),
    ...extra,
  };
}

async function expectRefused(promise: Promise<unknown>, message: RegExp): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ArchiveFormatError);
  expect((error as Error).message).toMatch(message);
}

/** Every regular file under `dir`, relative. */
async function tree(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory()) out.push(...(await tree(join(dir, entry.name), `${rel}/`)));
    else out.push(rel);
  }
  return out;
}

describe('a project path the writer never carries', () => {
  const planted = [
    // A planted `core.fsmonitor` runs on the Designer's next `git add -A`.
    '.adminium/designer/versions.git/config',
    '.adminium/approved-builds.json',
    '.git/hooks/pre-commit',
    'apps/shop/.git/config',
    'node_modules/left-pad/index.js',
    'apps/shop/node_modules/x/index.js',
    // Lands in the data dir when it is `<project>/data`, as the desktop app's is.
    'data/secret',
    '.env',
    'apps/shop/.env.local',
    'apps/.designer-live.json',
    // The same folders as a case-insensitive file system reads them.
    '.GIT/hooks/pre-commit',
    'Node_Modules/x.js',
    '.Adminium/approved-builds.json',
    'Data/meta.db',
    '.ENV',
  ];

  it('is named by one rule the writer and the restore share', () => {
    for (const rel of planted) expect(isExcludedProjectPath(rel), rel).toBe(true);
    for (const rel of ['adminium.config.ts', 'apps/shop/manifest.json', '.env.example', 'apps/data/x.json', 'hooks/on-boot.ts', 'database/seed.sql']) {
      expect(isExcludedProjectPath(rel), rel).toBe(false);
    }
  });

  it('refuses the whole export, with nothing written, for each one', async () => {
    const src = await exported();
    for (const [index, rel] of planted.entries()) {
      const archive = await handMade(src, `plant-${String(index)}`, (zip) => zip.addProject(rel, 'planted\n'));
      const dest = await target();
      await mkdir(dest.dirs.projectRoot, { recursive: true });
      await expectRefused(restoreArchive(importOptions(archive, dest)), /never carries/);
      expect(await dest.meta.db.introspection.getTables()).toEqual([]);
      expect(await tree(dest.dirs.projectRoot)).toEqual([]);
    }
  });

  it('refuses a project path inside the data dir, whatever the data dir is called', async () => {
    const src = await exported();
    const archive = await handMade(src, 'instance', (zip) => zip.addProject('instance/files/x', 'planted\n'));
    const dest = await target();
    await expectRefused(restoreArchive(importOptions(archive, dest, { dataDir: join(dest.dirs.projectRoot, 'instance') })), /inside the data dir/);
    expect(await dest.meta.db.introspection.getTables()).toEqual([]);
  });
});
