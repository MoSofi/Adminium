// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `withMetaSnapshot`: a dump of a store in use reads every table at ONE point
 * in time, on every dialect the machine can run.
 *
 * The writer is a second connection, as a running server is to `adminium
 * archive create`: a second better-sqlite3 handle on the same file (WAL, so the
 * writer is not held back and the test is about what the READER sees), and on
 * Postgres and MySQL another connection from the pool. The pair written is a
 * role and a grant of it, one transaction: the dump reads `adminium_roles`
 * before `adminium_role_permissions`, so a write landing between the two is
 * exactly a grant whose role is missing.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MetaRelocateError,
  createSqliteMetaDb,
  dumpMetaTable,
  firstRun,
  initMetaDb,
  metaColumnKinds,
  permissionsRepo,
  rolesRepo,
  withMetaSnapshot,
  type MetaDb,
  type MetaTableDump,
} from '../src/index.js';
import { TEST_DIALECTS } from './helpers/db.js';

interface Pair {
  /** Reads inside the snapshot. */
  reader: MetaDb;
  /** Writes on another connection. */
  writer: MetaDb;
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function pairFor(name: (typeof TEST_DIALECTS)[number]['name']): Promise<Pair> {
  if (name === 'sqlite') {
    const { default: BetterSqlite3 } = await import('better-sqlite3');
    const dir = await mkdtemp(join(tmpdir(), 'meta-snapshot-'));
    const file = join(dir, 'meta.db');
    const first = new BetterSqlite3(file);
    first.pragma('journal_mode = WAL');
    const reader = createSqliteMetaDb({ database: first });
    await initMetaDb(reader);
    await firstRun(reader);
    const writer = createSqliteMetaDb({ database: new BetterSqlite3(file) });
    await initMetaDb(writer);
    cleanups.push(async () => {
      await writer.db.destroy();
      await reader.db.destroy();
      await rm(dir, { recursive: true, force: true });
    });
    return { reader, writer };
  }
  const dialect = TEST_DIALECTS.find((d) => d.name === name);
  if (dialect === undefined) throw new Error(`no ${name} harness`);
  const made = await dialect.make();
  cleanups.push(made.destroy);
  await firstRun(made.meta);
  // One pool: the snapshot pins one of its connections, the writer gets another.
  return { reader: made.meta, writer: made.meta };
}

/** A role and its one grant, committed together. */
async function writeRoleWithGrant(meta: MetaDb, slug: string): Promise<string> {
  return meta.db.transaction().execute(async (trx) => {
    const scoped: MetaDb = { db: trx, dialect: meta.dialect };
    const role = await rolesRepo(scoped).create({ slug, name: slug });
    await permissionsRepo(scoped).grant(role.id, 'page', '*', { view: true, edit: false });
    return role.id;
  });
}

async function dumpRolesAndGrants(snapshot: MetaDb, between?: () => Promise<void>): Promise<{ roles: MetaTableDump; grants: MetaTableDump }> {
  const kinds = await metaColumnKinds(snapshot);
  const roles = await dumpMetaTable(snapshot, 'adminium_roles', kinds.get('adminium_roles') ?? new Map());
  await between?.();
  const grants = await dumpMetaTable(snapshot, 'adminium_role_permissions', kinds.get('adminium_role_permissions') ?? new Map());
  return { roles, grants };
}

const column = (dump: MetaTableDump, name: string): unknown[] => {
  const at = dump.columns.indexOf(name);
  return dump.rows.map((row) => row[at]);
};

/** Every grant's role is in the roles dump. */
function orphanGrants(dump: { roles: MetaTableDump; grants: MetaTableDump }): unknown[] {
  const roles = new Set(column(dump.roles, 'id'));
  return column(dump.grants, 'roleId').filter((roleId) => !roles.has(roleId));
}

describe.each(TEST_DIALECTS)('withMetaSnapshot ($name)', (dialect) => {
  it.skipIf(!dialect.available)('a write committed after the snapshot began is in no table of the dump', async () => {
    const { reader, writer } = await pairFor(dialect.name);
    let lateRole = '';
    const dump = await withMetaSnapshot(reader, (snapshot) =>
      dumpRolesAndGrants(snapshot, async () => {
        lateRole = await writeRoleWithGrant(writer, 'late-role');
      }),
    );
    expect(lateRole).not.toBe('');
    expect(column(dump.roles, 'id')).not.toContain(lateRole);
    expect(column(dump.grants, 'roleId')).not.toContain(lateRole);
    expect(orphanGrants(dump)).toEqual([]);

    // Outside the snapshot, the write is there: it did commit.
    const after = await withMetaSnapshot(reader, (snapshot) => dumpRolesAndGrants(snapshot));
    expect(column(after.roles, 'id')).toContain(lateRole);
    expect(column(after.grants, 'roleId')).toContain(lateRole);
  });

  it.skipIf(!dialect.available)('a writer running all through many dumps never leaves a grant without its role', async () => {
    const { reader, writer } = await pairFor(dialect.name);
    let stop = false;
    let written = 0;
    const writing = (async () => {
      while (!stop) {
        await writeRoleWithGrant(writer, `busy-${String(written)}`);
        written += 1;
        // better-sqlite3 answers synchronously: without a macrotask turn this loop would starve the reader's timer.
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();
    try {
      for (let round = 0; round < 15; round++) {
        const dump = await withMetaSnapshot(reader, (snapshot) =>
          // A pause between the two tables, so the writer gets its turn exactly where it would do harm.
          dumpRolesAndGrants(snapshot, () => new Promise((resolve) => setTimeout(resolve, 2))),
        );
        expect(orphanGrants(dump)).toEqual([]);
        // And no role of the writer's without its grant: both or neither.
        const granted = new Set(column(dump.grants, 'roleId'));
        const slugAt = dump.roles.columns.indexOf('slug');
        const idAt = dump.roles.columns.indexOf('id');
        for (const row of dump.roles.rows) {
          if (String(row[slugAt]).startsWith('busy-')) expect(granted.has(row[idAt])).toBe(true);
        }
      }
    } finally {
      stop = true;
      await writing;
    }
    expect(written).toBeGreaterThan(0);
  });

  it.skipIf(!dialect.available)('a failed read ends the transaction and leaves the store usable', async () => {
    const { reader } = await pairFor(dialect.name);
    await expect(
      withMetaSnapshot(reader, async (snapshot) => {
        await dumpRolesAndGrants(snapshot);
        throw new Error('the read broke');
      }),
    ).rejects.toThrow('the read broke');
    // The pinned connection went back with no transaction open: a write and a new snapshot both work.
    const id = await writeRoleWithGrant(reader, 'after-failure');
    const dump = await withMetaSnapshot(reader, (snapshot) => dumpRolesAndGrants(snapshot));
    expect(column(dump.roles, 'id')).toContain(id);
  });

  it.skipIf(!dialect.available || dialect.name === 'sqlite')('the snapshot is read only', async () => {
    const { reader } = await pairFor(dialect.name);
    await expect(withMetaSnapshot(reader, (snapshot) => rolesRepo(snapshot).create({ slug: 'inside', name: 'inside' }))).rejects.toThrow();
    expect(await rolesRepo(reader).findBySlug('inside')).toBeNull();
  });

  it.skipIf(!dialect.available)('is refused inside another transaction', async () => {
    const { reader } = await pairFor(dialect.name);
    await expect(
      reader.db.transaction().execute((trx) => withMetaSnapshot({ db: trx, dialect: reader.dialect }, async () => 1)),
    ).rejects.toBeInstanceOf(MetaRelocateError);
  });
});
