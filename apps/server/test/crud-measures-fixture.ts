// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The invoices/invoice_items fixture the derived-column suites read
 * (36-derived-columns.md). Deliberately shaped like the schema the feature
 * was specified against: a parent carrying a 0-100 `tax_rate` percent, a
 * child carrying `qty`, `rate` and `discount_pct`, and a `line_total` that is
 * already NET of the discount — so the gross is never stored and the discount
 * total can only be reached by folding an EXPRESSION.
 *
 * COLUMN NAMES ARE LOAD-BEARING HERE. The server re-runs the classifier over
 * whatever an adapter introspects, so `semantics` written into a fixture model
 * are silently discarded — the only way to make a test column masked or secret
 * is to name it something the §7.1/§7.2 rules recognise. `contact_email` and
 * `payer_account_number` are masked (PII), `legacy_token` is secret
 * (credential vocabulary). That is what lets one fixture exercise both refusal
 * polarities: a secret column is invisible (422 when named), a masked one
 * degrades to `null` + `_masked`.
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

import { recordingDialect, type SqlSink } from './sql-recorder.js';

export function seedSqlite(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(`
    CREATE TABLE invoices (
      invoice_id INTEGER PRIMARY KEY,
      number TEXT NOT NULL,
      tax_rate NUMERIC NOT NULL DEFAULT 0,
      contact_email TEXT,
      legacy_token TEXT,
      api_secret TEXT
    );
    CREATE TABLE invoice_items (
      item_id INTEGER PRIMARY KEY,
      invoice_id INTEGER REFERENCES invoices(invoice_id),
      -- No physical FK: SQLite requires a UNIQUE target, and the relation this
      -- column exists for is declared in the MODEL below. It is deliberately
      -- NOT named like a credential while its TARGET is: an inbound FK whose
      -- base-side correlate is a SECRET column is the D16 defect.
      legacy_ref TEXT,
      qty NUMERIC,
      rate NUMERIC,
      discount_pct NUMERIC,
      -- Masked by the classifier's payment-id rule. It is here to be a MASKED
      -- NUMERIC factor, not because an invoice line would carry one.
      payer_account_number NUMERIC,
      line_total NUMERIC
    );
    INSERT INTO invoices VALUES
      (7, 'INV-007', 8.00, 'ada@example.test', 'L-7', 'sk_live_7'),
      (8, 'INV-008', 8.00, NULL, 'L-8', NULL),
      (9, 'INV-009', 0, NULL, 'L-9', NULL);
    -- Invoice 7 mirrors the real seed: gross 1300.0000, net 1266.00.
    INSERT INTO invoice_items VALUES
      (1, 7, 'L-7', 2.00, 500.00, 0.00, 400.00, 1000.00),
      (2, 7, 'L-7', 1.00, 300.00, 11.3333, 150.00, 266.00),
      (3, 8, 'L-8', 3.00, 40.00, 0.00, 30.00, 120.00);
    -- Invoice 9 deliberately has NO line items: the empty-fold lattice.
  `);
  return db;
}

function fakeModel(): DatabaseModel {
  return parseDatabaseModel({
    dialect: 'postgres',
    name: 'invdb',
    defaultSchema: 'main',
    schemas: ['main'],
    tables: [
      {
        schema: 'main',
        name: 'invoices',
        primaryKey: ['invoice_id'],
        columns: [
          { name: 'invoice_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          { name: 'number', logicalType: 'varchar', nullable: false },
          { name: 'tax_rate', logicalType: 'decimal', nullable: false },
          { name: 'contact_email', logicalType: 'text', nullable: true },
          { name: 'legacy_token', logicalType: 'text', nullable: true },
          { name: 'api_secret', logicalType: 'text', nullable: true },
        ],
      },
      {
        schema: 'main',
        name: 'invoice_items',
        primaryKey: ['item_id'],
        columns: [
          { name: 'item_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          {
            name: 'invoice_id',
            logicalType: 'integer',
            nullable: true,
            references: { tableId: 'main.invoices', column: 'invoice_id' },
          },
          {
            name: 'legacy_ref',
            logicalType: 'text',
            nullable: true,
            references: { tableId: 'main.invoices', column: 'legacy_token' },
          },
          { name: 'qty', logicalType: 'decimal', nullable: true },
          { name: 'rate', logicalType: 'decimal', nullable: true },
          { name: 'discount_pct', logicalType: 'decimal', nullable: true },
          { name: 'payer_account_number', logicalType: 'decimal', nullable: true },
          { name: 'line_total', logicalType: 'decimal', nullable: true },
        ],
      },
    ],
    relations: [
      {
        id: 'fk_items_invoices',
        kind: 'declared-fk',
        cardinality: 'one-to-many',
        from: { tableId: 'main.invoice_items', columns: ['invoice_id'] },
        to: { tableId: 'main.invoices', columns: ['invoice_id'] },
      },
      {
        id: 'fk_items_invoices_legacy',
        kind: 'declared-fk',
        cardinality: 'one-to-many',
        from: { tableId: 'main.invoice_items', columns: ['legacy_ref'] },
        to: { tableId: 'main.invoices', columns: ['legacy_token'] },
      },
    ],
  });
}

export function makeFakeRegistry(
  sqlite: BetterSqlite3.Database,
  sink?: SqlSink,
): AdapterRegistry<AdapterProvider> {
  const capabilities = adapterCapabilitiesSchema.parse({});
  const makeAdapter = (role: string): DatabaseAdapter =>
    ({
      dialect: 'postgres',
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
      introspect: async () => fakeModel(),
      count: async () => ({ value: 0, capped: false }),
      sample: async () => [],
      query: async () => ({ rows: [], columns: [] }),
      mutate: async () => ({ affected: 0, returning: null }),
      close: async () => undefined,
    }) as unknown as DatabaseAdapter;

  const registry = new AdapterRegistry<AdapterProvider>();
  registry.register({
    dialect: 'postgres',
    create: (config) => makeAdapter(config.role) as never,
    createQueryEngine: () => {
      const base = new SqliteDialect({ database: sqlite });
      return {
        dialect: sink === undefined ? base : recordingDialect(base, sink),
        identifiers: { quote: (identifier: string) => `"${identifier}"`, maxLength: 63 },
        serializers: {},
        destroy: async () => undefined,
      };
    },
  });
  return registry;
}
