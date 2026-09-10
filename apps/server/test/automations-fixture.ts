// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The fixture the automations suites read: the four tables the OWNER'S OWN
 * EXAMPLES need (42-automations-and-workflow-logs.md Appendix C), and nothing
 * else.
 *
 *   users                        the sign-up trigger, with a watchable
 *                                `created_at` and an `updated_at`
 *   offer_claims                 the related-records count ("did they claim
 *                                it?")
 *   special_offer_beneficiaries  the row the Claimed branch creates
 *   appointments                 the schedule scan, with a `starts_at` the
 *                                relative-time operators compare against
 *
 * COLUMN NAMES ARE LOAD-BEARING. The server re-runs the classifier over
 * whatever an adapter introspects, so `semantics` written into a fixture
 * model are discarded: `email` and `patient_email` are masked because the
 * classifier's PII rules say so, and `created_at` / `updated_at` are watchable
 * because r09/r10 recognise the names. Both facts are exactly what the
 * automations code branches on, so the fixture has to earn them the same way
 * a customer's database would.
 *
 * `notes` is a plain text column with no vocabulary hit — the one place a
 * test can write a value and read it back unmasked.
 *
 * THE FIXTURE DECLARES `sqlite`, not `postgres`. The other fake-adapter
 * suites in this directory claim postgres over a SQLite query engine, which
 * is harmless while nothing they exercise compiles per dialect. The
 * automations scanner does: `is` on a text column compiles to ILIKE, which a
 * postgres claim would emit into SQLite verbatim. A fixture that lies about
 * its dialect tests the wrong SQL.
 */

import BetterSqlite3 from 'better-sqlite3';
import { SqliteDialect } from 'kysely';

import {
  AdapterRegistry,
  adapterCapabilitiesSchema,
  parseDatabaseModel,
  type AdapterProvider,
  type DatabaseAdapter,
  type DatabaseModel,
} from '@adminium/engine/adapter';

export function seedAutomationsSqlite(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      full_name TEXT,
      status TEXT,
      notes TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE offer_claims (
      claim_id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      claimed_at TEXT
    );
    CREATE TABLE special_offer_beneficiaries (
      beneficiary_id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      claimed_at TEXT
    );
    CREATE TABLE appointments (
      appointment_id INTEGER PRIMARY KEY,
      patient_id INTEGER NOT NULL,
      patient_email TEXT,
      starts_at TEXT,
      status TEXT
    );
  `);
  return db;
}

const TIMESTAMP = 'timestamptz';

export function automationsModel(): DatabaseModel {
  return parseDatabaseModel({
    dialect: 'sqlite',
    name: 'fakedb',
    defaultSchema: 'main',
    schemas: ['main'],
    tables: [
      {
        schema: 'main',
        name: 'users',
        primaryKey: ['id'],
        columns: [
          { name: 'id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          { name: 'email', logicalType: 'varchar', nullable: false },
          { name: 'full_name', logicalType: 'varchar', nullable: true },
          { name: 'status', logicalType: 'varchar', nullable: true },
          { name: 'notes', logicalType: 'text', nullable: true },
          { name: 'created_at', logicalType: TIMESTAMP, nullable: true },
          { name: 'updated_at', logicalType: TIMESTAMP, nullable: true },
        ],
      },
      {
        schema: 'main',
        name: 'offer_claims',
        primaryKey: ['claim_id'],
        columns: [
          { name: 'claim_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          {
            name: 'user_id',
            logicalType: 'integer',
            nullable: false,
            references: { tableId: 'main.users', column: 'id' },
          },
          { name: 'claimed_at', logicalType: TIMESTAMP, nullable: true },
        ],
      },
      {
        schema: 'main',
        name: 'special_offer_beneficiaries',
        primaryKey: ['beneficiary_id'],
        columns: [
          { name: 'beneficiary_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          {
            name: 'user_id',
            logicalType: 'integer',
            nullable: false,
            references: { tableId: 'main.users', column: 'id' },
          },
          { name: 'claimed_at', logicalType: TIMESTAMP, nullable: true },
        ],
      },
      {
        schema: 'main',
        name: 'appointments',
        primaryKey: ['appointment_id'],
        columns: [
          { name: 'appointment_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          { name: 'patient_id', logicalType: 'integer', nullable: false },
          { name: 'patient_email', logicalType: 'varchar', nullable: true },
          { name: 'starts_at', logicalType: TIMESTAMP, nullable: true },
          { name: 'status', logicalType: 'varchar', nullable: true },
        ],
      },
    ],
    relations: [
      {
        id: 'fk_offer_claims_users',
        kind: 'declared-fk',
        cardinality: 'one-to-many',
        from: { tableId: 'main.offer_claims', columns: ['user_id'] },
        to: { tableId: 'main.users', columns: ['id'] },
      },
      /*
       * Two edges the child-table picker must NOT offer (34 §3.7 step 3).
       * The pipeline reads children with `where <fk> = row[primaryKey[0]]`, so
       * each of these is a join a stored mapping cannot express — and a picker
       * that offered one would fill a collection with the wrong rows and look
       * like it worked.
       */
      {
        id: 'fk_appointments_users_composite',
        kind: 'declared-fk',
        cardinality: 'one-to-many',
        from: { tableId: 'main.appointments', columns: ['patient_id', 'patient_email'] },
        to: { tableId: 'main.users', columns: ['id', 'email'] },
      },
      {
        id: 'fk_appointments_users_by_email',
        kind: 'declared-fk',
        cardinality: 'one-to-many',
        from: { tableId: 'main.appointments', columns: ['patient_email'] },
        // A unique column that is NOT the primary key.
        to: { tableId: 'main.users', columns: ['email'] },
      },
    ],
  });
}

export function makeAutomationsRegistry(
  sqlite: BetterSqlite3.Database,
): AdapterRegistry<AdapterProvider> {
  const capabilities = adapterCapabilitiesSchema.parse({});
  const makeAdapter = (role: string): DatabaseAdapter =>
    ({
      dialect: 'sqlite',
      capabilities,
      role,
      connect: async () => undefined,
      test: async () => ({
        ok: true,
        latencyMs: 1,
        serverVersion: 'FakeSQL 1.0',
        currentUser: 'fake',
        canWrite: true,
        ssl: false,
      }),
      probeCapabilities: async () => ({
        capabilities,
        privileges: { canReadSchema: true, canRead: true, canWrite: true, canDDL: true },
        serverVersion: 'FakeSQL 1.0',
        currentRole: { name: 'fake', readOnly: false },
      }),
      introspect: async () => automationsModel(),
      count: async () => ({ value: 0, capped: false }),
      sample: async () => [],
      query: async () => ({ rows: [], columns: [] }),
      mutate: async () => ({ affected: 0, returning: null }),
      close: async () => undefined,
    }) as unknown as DatabaseAdapter;

  const registry = new AdapterRegistry<AdapterProvider>();
  registry.register({
    dialect: 'sqlite',
    create: (config) => makeAdapter(config.role) as never,
    createQueryEngine: () => ({
      dialect: new SqliteDialect({ database: sqlite }),
      identifiers: { quote: (identifier: string) => `"${identifier}"`, maxLength: 63 },
      serializers: {},
      destroy: async () => undefined,
    }),
  });
  return registry;
}
