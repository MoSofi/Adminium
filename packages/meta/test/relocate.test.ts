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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MetaStoreNotEmptyError,
  applyMigrations,
  assertMetaStoreEmpty,
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
