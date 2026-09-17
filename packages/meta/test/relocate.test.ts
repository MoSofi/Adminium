// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whole-store copy, across every pair of dialects the machine can run.
 *
 * The pairing is the point. A copy engine tested only sqlite → sqlite proves
 * nothing about the two failures `repos/util.ts` warns about — better-sqlite3
 * refusing to bind a boolean, PG refusing a number for a boolean column — and
 * those are the failures that actually bite, because the meta schema maps one
 * logical `bool` onto three different physical types. So every available
 * dialect is used as both source and target, sqlite → sqlite included.
 */

import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MetaStoreNotEmptyError,
  applyMigrations,
  assertMetaStoreEmpty,
  parkAdminiumTables,
  probeAdminiumTables,
  connectionsRepo,
  copyMetaStore,
  countMetaRows,
  createFirstSuperAdmin,
  firstRun,
  pagesRepo,
  relocatableTables,
  sessionsRepo,
  settingsRepo,
  snakeToCamel,
  usersRepo,
  type MetaDb,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

/** Repos never see key material; the copy never decrypts. Reversible is enough. */
const crypto = {
  encrypt: (plaintext: string) => `enc:${plaintext}`,
  decrypt: (token: string) => token.slice(4),
};

/**
 * A store with something in every shape the copy has to survive: booleans, JSON
 * payloads, nulls, and FK chains three deep (users → sessions, connections →
 * pages). Returns the ids the assertions check back.
 */
async function seed(meta: MetaDb) {
  await firstRun(meta);
  const user = await createFirstSuperAdmin(meta, {
    email: 'owner@example.com',
    name: 'Owner',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$fake',
  });

  await sessionsRepo(meta).create({
    tokenHash: 'hash-of-a-session-token',
    userId: user.id,
    expiresAt: 1_800_000_000_000,
    ip: null,
    userAgent: 'vitest',
  });

  const connection = await connectionsRepo(meta, crypto).create({
    name: 'Primary',
    engine: 'postgres',
    introspectDsn: 'postgres://user:pw@localhost:5432/app',
    dataDsn: null,
    readOnly: true,
    settings: { intent: 'full-admin', includedTables: ['public.users'] },
    createdBy: user.id,
  });

  await settingsRepo(meta).set('telemetry.enabled', false, { updatedBy: user.id });

  const page = await pagesRepo(meta).create({
    connectionId: connection.id,
    slug: 'public-users-directory',
    type: 'page-directory',
    title: 'Users',
    config: { table: 'public.users', columns: ['id', 'email'] },
    origin: 'generated',
    createdBy: user.id,
  });

  return { user, connection, page };
}

describe('snakeToCamel', () => {
  it('matches the CamelCasePlugin mapping introspection has to be read through', () => {
    expect(snakeToCamel('introspect_dsn_encrypted')).toBe('introspectDsnEncrypted');
    expect(snakeToCamel('read_only')).toBe('readOnly');
    expect(snakeToCamel('last_latency_ms')).toBe('lastLatencyMs');
    expect(snakeToCamel('id')).toBe('id');
  });
});

const available = TEST_DIALECTS.filter((dialect) => dialect.available);

for (const source of available) {
  for (const target of available) {
    describe(`copyMetaStore [${source.name} → ${target.name}]`, () => {
      let from: TestDb;
      let to: TestDb;

      beforeEach(async () => {
        from = await source.make();
        to = await target.make();
        await seed(from.meta);
        await applyMigrations(to.meta.db, { dialect: to.meta.dialect });
      });
      afterEach(async () => {
        await from.destroy();
        await to.destroy();
      });

      it('moves every row of every table', async () => {
        const before = await countMetaRows(from.meta);
        const result = await copyMetaStore({ from: from.meta, to: to.meta });
        const after = await countMetaRows(to.meta);

        expect(result.totalRows).toBeGreaterThan(0);
        for (const table of relocatableTables()) {
          expect(after.get(table), table).toBe(before.get(table));
        }
        // The source is a MOVE's origin, not its casualty — nothing here writes
        // to it, so a failed relocation can always fall back.
        expect(await countMetaRows(from.meta)).toEqual(before);
      });

      it('round-trips booleans, JSON and nulls through the target dialect', async () => {
        const seeded = await seed2(from.meta);
        await copyMetaStore({ from: from.meta, to: to.meta });

        const connection = await connectionsRepo(to.meta, crypto).findById(seeded.connectionId);
        expect(connection).not.toBeNull();
        // `readOnly` is `boolean` on pg, `tinyint(1)` on mysql, `integer` on
        // sqlite. The repo's readBool only returns true for `true` or `1`, so
        // this fails loudly if the copy wrote the wrong physical shape.
        expect(connection?.readOnly).toBe(true);
        expect(connection?.settings).toEqual({
          intent: 'full-admin',
          includedTables: ['public.users'],
        });
        expect(connection?.dataDsnEncrypted).toBeNull();
        // Ciphertext has to survive byte-for-byte: a copy that re-encoded it
        // would leave the DSN permanently unrecoverable, and the connection
        // would fail only later, at the first query.
        expect(connection?.introspectDsnEncrypted).toBe(
          `enc:postgres://user:pw@localhost:5432/app`,
        );

        // A JSON payload whose value is a bare `false` — the shape most likely
        // to be flattened into a SQL boolean by an over-eager coercion.
        expect(await settingsRepo(to.meta).get('telemetry.enabled')).toBe(false);
      });

      it('preserves foreign-key chains, so the operator is still logged in', async () => {
        const seeded = await seed2(from.meta);
        await copyMetaStore({ from: from.meta, to: to.meta });

        const user = await usersRepo(to.meta).findByEmail('owner@example.com');
        expect(user?.id).toBe(seeded.userId);

        // The session is what makes a live relocation survivable: the operator
        // is mid-wizard, and a store that arrived without adminium_sessions
        // would bounce them to the login screen holding a cookie for a session
        // that no longer exists.
        const sessions = await to.meta.db
          .selectFrom('adminium_sessions')
          .selectAll()
          .where('userId', '=', seeded.userId)
          .execute();
        expect(sessions).toHaveLength(1);

        const pages = await pagesRepo(to.meta).listForConnection(seeded.connectionId);
        expect(pages.map((page) => page.slug)).toContain('public-users-directory');
      });

      it('refuses a target that already holds Adminium data', async () => {
        await copyMetaStore({ from: from.meta, to: to.meta });
        await expect(assertMetaStoreEmpty(to.meta)).rejects.toThrow(MetaStoreNotEmptyError);
      });

      it('accepts a freshly migrated target', async () => {
        await expect(assertMetaStoreEmpty(to.meta)).resolves.toBeUndefined();
      });

      it('reports progress for every relocatable table, empty ones included', async () => {
        // The wizard's status line is driven entirely by this callback. Firing
        // it only for tables that had rows would leave it parked on whichever
        // table happens to be populated while the other twenty-odd go by, and
        // a relocation that looks stuck is a relocation an operator kills.
        const seen: { table: string; rows: number }[] = [];
        const result = await copyMetaStore({
          from: from.meta,
          to: to.meta,
          onProgress: (table, rows) => seen.push({ table, rows }),
        });

        expect(seen.map((entry) => entry.table)).toEqual([...relocatableTables()]);
        expect(seen).toEqual(result.tables);
        // Both halves are represented, so this is not passing by vacuity.
        expect(seen.some((entry) => entry.rows === 0)).toBe(true);
        expect(seen.some((entry) => entry.rows > 0)).toBe(true);
        expect(seen.reduce((sum, entry) => sum + entry.rows, 0)).toBe(result.totalRows);

        // adminium_migrations is the target's OWN ledger, written by
        // applyMigrations. Copying the source's over it is what would make the
        // checksums describe a schema the target does not have.
        expect(relocatableTables()).not.toContain('adminium_migrations');
        const ledger = await to.meta.db
          .selectFrom('adminium_migrations')
          .selectAll()
          .execute();
        expect(ledger.length).toBeGreaterThan(0);
      });

      it('leaves tables that belong to another application alone', async () => {
        // A self-hoster's target database is very often not empty — it is the
        // app database, and Adminium is a guest in it. Introspection filters on
        // the adminium_ prefix for exactly this reason, and `assertMetaStoreEmpty`
        // counts adminium_ tables rather than "any table at all".
        await to.meta.db.schema
          .createTable('other_app_widgets')
          .addColumn('id', 'integer')
          .execute();
        await sql`insert into other_app_widgets (id) values (7)`.execute(to.meta.db);

        await expect(assertMetaStoreEmpty(to.meta)).resolves.toBeUndefined();
        const result = await copyMetaStore({ from: from.meta, to: to.meta });
        expect(result.totalRows).toBeGreaterThan(0);

        const survivors = await sql<{ id: number }>`select id from other_app_widgets`.execute(
          to.meta.db,
        );
        expect(survivors.rows.map((row) => Number(row.id))).toEqual([7]);
      });
    });
  }
}

/**
 * The ids `beforeEach`'s seed produced. Re-derived rather than threaded out of
 * `beforeEach`, so each test states what it depends on.
 */
async function seed2(meta: MetaDb): Promise<{
  userId: string;
  connectionId: string;
}> {
  const user = await usersRepo(meta).findByEmail('owner@example.com');
  const connections = await connectionsRepo(meta, crypto).list();
  return {
    userId: user?.id as string,
    connectionId: connections[0]?.id as string,
  };
}

/**
 * `probeAdminiumTables` answers the same question as `assertMetaStoreEmpty`
 * WITHOUT writing: a first-run wizard has to ask it of a database the operator
 * has only typed a string for, and migrating that database to find out would be
 * the write the question exists to avoid.
 */
for (const dialect of available) {
  describe(`probeAdminiumTables [${dialect.name}]`, () => {
    let db: TestDb;
    beforeEach(async () => {
      db = await dialect.make();
    });
    afterEach(async () => {
      await db.destroy();
    });

    it('finds nothing in a database Adminium has never touched — and migrates nothing', async () => {
      await expect(probeAdminiumTables(db.meta)).resolves.toEqual({ present: [], occupied: [] });
      // The point of the whole helper: asking did not create the tables.
      await expect(probeAdminiumTables(db.meta)).resolves.toEqual({ present: [], occupied: [] });
    });

    it('reports migrated-but-empty tables as present and unoccupied', async () => {
      await applyMigrations(db.meta.db, { dialect: db.meta.dialect });
      const probe = await probeAdminiumTables(db.meta);
      expect(probe.present.length).toBeGreaterThan(0);
      expect(probe.present).toContain('adminium_users');
      // Empty tables are what a relocation happily writes into, so they are not
      // an obstacle and must not be reported as one — INCLUDING the migration
      // ledger, which has rows the moment the schema exists and which a
      // relocation skips for exactly that reason.
      expect(probe.present).toContain('adminium_migrations');
      expect(probe.occupied).toEqual([]);
      await expect(assertMetaStoreEmpty(db.meta)).resolves.toBeUndefined();
    });

    it('reports the tables that actually hold rows — the ones a relocation refuses over', async () => {
      await applyMigrations(db.meta.db, { dialect: db.meta.dialect });
      await seed(db.meta);
      const probe = await probeAdminiumTables(db.meta);
      expect(probe.occupied.length).toBeGreaterThan(0);
      expect(probe.occupied.every((table) => probe.present.includes(table))).toBe(true);
      await expect(assertMetaStoreEmpty(db.meta)).rejects.toThrow(MetaStoreNotEmptyError);
    });
  });
}

/**
 * Parking: the second answer offered to someone whose target database already
 * runs an Adminium — keep what is there, and start beside it.
 */
for (const dialect of available) {
  describe(`parkAdminiumTables [${dialect.name}]`, () => {
    let db: TestDb;
    beforeEach(async () => {
      db = await dialect.make();
      await applyMigrations(db.meta.db, { dialect: db.meta.dialect });
      await seed(db.meta);
    });
    afterEach(async () => {
      await db.destroy();
    });

    it('leaves the database empty by the only definition that matters', async () => {
      const before = await probeAdminiumTables(db.meta);
      expect(before.occupied.length).toBeGreaterThan(0);

      await parkAdminiumTables(db.meta, '20260910');

      const after = await probeAdminiumTables(db.meta);
      expect(after.present).toEqual([]);
      expect(after.occupied).toEqual([]);
      // `assertMetaStoreEmpty` counts rows in tables it assumes EXIST, so it is
      // only askable after the schema is rebuilt — which is exactly the order
      // `relocateMetaStore` runs these in: park, migrate, then check.
      await applyMigrations(db.meta.db, { dialect: db.meta.dialect });
      await expect(assertMetaStoreEmpty(db.meta)).resolves.toBeUndefined();
    });

    it('keeps every row — this is a rename, not a drop', async () => {
      const users = await db.meta.db.selectFrom('adminium_users').selectAll().execute();
      expect(users.length).toBeGreaterThan(0);

      const { renamed } = await parkAdminiumTables(db.meta, '20260910');
      expect(renamed.some((entry) => entry.to === 'old_20260910_adminium_users')).toBe(true);

      const parked = await db.meta.db
        .selectFrom('old_20260910_adminium_users' as never)
        .selectAll()
        .execute();
      expect(parked).toHaveLength(users.length);
    });

    it('takes the parked names OUT of the adminium_ namespace', async () => {
      // Suffixing would leave `adminium_users_old_…`, which the probe — and so
      // the emptiness check, and so the relocation — still reads as occupied.
      const { renamed } = await parkAdminiumTables(db.meta, '20260910');
      expect(renamed.every((entry) => !entry.to.startsWith('adminium_'))).toBe(true);
    });

    it('moves the migration ledger too, or the next migrate would create nothing', async () => {
      const { renamed } = await parkAdminiumTables(db.meta, '20260910');
      expect(renamed.map((entry) => entry.from)).toContain('adminium_migrations');
      // The proof: a fresh migration run rebuilds the whole schema beside it.
      await applyMigrations(db.meta.db, { dialect: db.meta.dialect });
      const rebuilt = await probeAdminiumTables(db.meta);
      expect(rebuilt.present).toContain('adminium_users');
      expect(rebuilt.occupied).toEqual([]);
    });
  });
}
