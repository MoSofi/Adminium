// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium archive create` against an instance that keeps writing: the meta
 * store is read at ONE point in time (`withMetaSnapshot`), on every engine.
 *
 * The write is a role and a grant of it, committed together, landing right
 * after the archive has read `adminium_roles` and before it reads
 * `adminium_role_permissions` — the gap where a table-by-table copy kept a
 * grant whose role it never saw. On Postgres and MySQL the write goes through
 * another pooled connection and is awaited there, so it has committed before
 * the second table is read. SQLite's store is one connection, held by the
 * snapshot for the whole dump: the write is queued behind it and lands after.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { permissionsRepo, rolesRepo, type MetaDb, type MetaTableDump } from '@adminium/meta';
import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { createArchive } from '../src/archive/create.js';
import { ARCHIVE_META_DIR } from '../src/archive/format.js';
import { AVAILABLE, CRYPTO, SECRET, SIGNING, makeDirs, makeStore, type EngineName } from './archive.helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function writeRoleWithGrant(meta: MetaDb, slug: string): Promise<string> {
  return meta.db.transaction().execute(async (trx) => {
    const scoped: MetaDb = { db: trx, dialect: meta.dialect };
    const role = await rolesRepo(scoped).create({ slug, name: slug });
    await permissionsRepo(scoped).grant(role.id, 'page', '*', { view: true, edit: false });
    return role.id;
  });
}

function tableOf(zip: Record<string, Uint8Array>, table: string): MetaTableDump {
  const member = zip[`${ARCHIVE_META_DIR}/${table}.json`];
  if (member === undefined) throw new Error(`the archive has no ${table}`);
  return JSON.parse(Buffer.from(member).toString('utf8')) as MetaTableDump;
}

const column = (dump: MetaTableDump, name: string): unknown[] => {
  const at = dump.columns.indexOf(name);
  return dump.rows.map((row) => row[at]);
};

describe('archive create reads the meta store at one point in time', () => {
  for (const engine of ['sqlite', 'postgres', 'mysql'] as EngineName[]) {
    it.skipIf(!AVAILABLE[engine])(`${engine}: a role and its grant written mid-dump are in neither table`, async () => {
      const store = await makeStore(engine, true);
      cleanups.push(store.destroy);
      const dirs = await makeDirs();
      cleanups.push(dirs.cleanup);
      const before = await writeRoleWithGrant(store.meta, 'before-archive');

      let late: Promise<string> | null = null;
      const result = await createArchive({
        meta: store.meta,
        outPath: join(dirs.root, 'out.zip'),
        dataDir: dirs.dataDir,
        projectRoot: null,
        kind: 'full',
        secret: SECRET,
        dsnCrypto: CRYPTO,
        signing: SIGNING,
        afterMetaTable: async (table) => {
          if (table !== 'adminium_roles') return;
          late = writeRoleWithGrant(store.meta, 'mid-dump');
          // Committed before the grants are read, where the pool has another connection to write with.
          if (engine !== 'sqlite') await late;
        },
      });
      expect(late).not.toBeNull();
      const lateId = await (late as unknown as Promise<string>);

      const zip = unzipSync(await readFile(result.path));
      const roles = tableOf(zip, 'adminium_roles');
      const grants = tableOf(zip, 'adminium_role_permissions');
      const roleIds = new Set(column(roles, 'id'));
      expect(roleIds.has(before)).toBe(true);
      expect(column(grants, 'roleId')).toContain(before);
      expect(roleIds.has(lateId)).toBe(false);
      expect(column(grants, 'roleId')).not.toContain(lateId);
      // No grant in the archive names a role the archive does not carry.
      expect(column(grants, 'roleId').filter((roleId) => !roleIds.has(roleId))).toEqual([]);
      // The write did land: the store has it, the archive is simply from before it.
      expect(await rolesRepo(store.meta).findById(lateId)).not.toBeNull();
    });
  }
});
