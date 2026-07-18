/**
 * Table-label overrides through `runGeneration` (the sidebar-nav channel):
 * an active `llm.label` rename on a table must land in the PERSISTED
 * `adminium_pages.title` fallback — that column is what the bootstrap nav
 * serves (no `nav.<slug>` i18n keys exist, so the fallback IS the sidebar
 * text). Before M11 `runGeneration` handed the RAW parsed snapshot to
 * `generatePages` and every rename was lost.
 *
 * Offline: sqlite meta, a pre-seeded snapshot (no introspection), a manager
 * that only ever resolves the connection row.
 */
import BetterSqlite3 from 'better-sqlite3';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  llmOverridesRepo,
  overridesRepo,
  pagesRepo,
  snapshotsRepo,
  type MetaDb,
} from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { runGeneration } from '../src/generate/run.js';
import { TEST_SECRET } from './helpers.js';

/** sqlite-flavoured mini-Northwind: `main.*` ids, like the seeded e2e app. */
const SCHEMA_IR = {
  dialect: 'sqlite',
  name: 'northwind',
  defaultSchema: 'main',
  schemas: ['main'],
  tables: [
    {
      schema: 'main',
      name: 'orders',
      columns: [{ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }],
      primaryKey: ['id'],
    },
    {
      schema: 'main',
      name: 'order_details',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        {
          name: 'order_id',
          logicalType: 'integer',
          nullable: false,
          references: { tableId: 'main.orders', column: 'id' },
        },
        { name: 'unit_price', logicalType: 'decimal' },
      ],
      primaryKey: ['id'],
    },
  ],
  relations: [
    {
      id: 'rel_details_orders',
      kind: 'declared-fk',
      cardinality: 'one-to-many',
      from: { tableId: 'main.order_details', columns: ['order_id'] },
      to: { tableId: 'main.orders', columns: ['id'] },
    },
  ],
};

const LLM_TABLE_BUNDLE = {
  label: { en_US: 'Order lines', de_DE: 'Bestellpositionen' },
  icon: 'list',
};

describe('runGeneration — table-label override channel', () => {
  let meta: MetaDb;
  let manager: ConnectionManager;
  let connectionId: string;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const crypto = dsnCryptoFromSecret(TEST_SECRET);
    const connection = await connectionsRepo(meta, crypto).create({
      name: 'northwind',
      engine: 'sqlite',
      introspectDsn: 'sqlite:/tmp/never-opened.db',
    });
    connectionId = connection.id;
    await snapshotsRepo(meta).create({
      connectionId,
      source: 'introspection',
      schema: SCHEMA_IR,
      checksum: 'sha-northwind-1',
    });
    manager = new ConnectionManager({ meta, crypto, metaDsn: null, blockLoopback: false });
  });
  afterEach(async () => {
    await meta.db.destroy();
  });

  async function titleOf(slug: string): Promise<string | undefined> {
    const pages = await pagesRepo(meta).listForConnection(connectionId);
    return pages.find((p) => p.slug === slug)?.title;
  }

  it('an active llm.label rename lands in the persisted page title fallback', async () => {
    await llmOverridesRepo(meta).upsert({
      connectionId,
      field: 'label',
      tableName: 'main.order_details',
      value: LLM_TABLE_BUNDLE,
      confidence: 0.9,
    });

    const result = await runGeneration({ manager, meta, connectionId });
    expect(result.introspected).toBe(false); // seeded snapshot — never dialed
    expect(await titleOf('order-details')).toBe('Order lines');
    expect(await titleOf('orders')).toBe('Orders'); // untouched sibling stays heuristic
  });

  it('a user table.label beats the llm bundle even when the llm row is newer', async () => {
    await overridesRepo(meta).create(
      {
        connectionId,
        op: 'table.label',
        tableName: 'main.order_details',
        value: { label: 'Line items' },
      },
      1_000,
    );
    await llmOverridesRepo(meta).upsert(
      {
        connectionId,
        field: 'label',
        tableName: 'main.order_details',
        value: LLM_TABLE_BUNDLE,
        confidence: 0.9,
      },
      2_000, // newer than the user row — provenance must still win
    );

    await runGeneration({ manager, meta, connectionId });
    expect(await titleOf('order-details')).toBe('Line items');
  });

  it('without label overrides the titles are the pure heuristics (byte-identity guard)', async () => {
    await runGeneration({ manager, meta, connectionId });
    expect(await titleOf('order-details')).toBe('Order Details');
    expect(await titleOf('orders')).toBe('Orders');
  });
});
