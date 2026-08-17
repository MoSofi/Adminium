// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two ends of §6 relation inference that live in the SERVER, not the
 * engine — both of which were open.
 *
 * `packages/engine/src/infer/relations.ts` implements 05 §6 rules 1–2 and has
 * its own thorough test file, but `applyInference` had no call site outside
 * those tests: every downstream consumer still received the empty
 * `relations: []` of an FK-less schema, so none of it did anything for a user.
 * And `relation.add` / `relation.remove` were applied only on the READ path
 * (`connections/effective-schema.ts`), so a relation a user accepted in the
 * Studio remap editor was visible in the schema browser and then absent from
 * the very next regeneration — the override→regeneration loop was open at the
 * regeneration end.
 *
 * These are wiring pins, deliberately asserted on OBSERVABLE output rather
 * than on "the function was called": the persisted snapshot for the first, and
 * a generated page envelope's column semantics for the second. `cust_ref` is
 * the tell throughout — an unrelated integer column renders `external-id`
 * (a mono string), and the same column with a relation behind it renders `fk`
 * (an entity chip that navigates).
 *
 * Offline: sqlite meta, a stubbed introspect adapter, no source database.
 */
import BetterSqlite3 from 'better-sqlite3';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  overridesRepo,
  pagesRepo,
  snapshotsRepo,
  type MetaDb,
} from '@adminium/meta';
import { parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SchemaOverride } from '@adminium/meta';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { applyAcceptedRelations, runGeneration } from '../src/generate/run.js';
import { TEST_SECRET } from './helpers.js';

/**
 * A schema that declares no foreign keys — MyISAM, legacy SQLite, most
 * ORM-generated MySQL. `orders.customer_id` names its target by convention
 * and nothing else; `orders.cust_ref` names nothing at all and is the control
 * column that must stay unrelated no matter what inference does.
 */
const FK_LESS_IR = {
  dialect: 'mysql' as const,
  name: 'shop',
  defaultSchema: 'main',
  schemas: ['main'],
  capabilities: { hasFKs: false },
  tables: [
    {
      schema: 'main',
      name: 'customers',
      primaryKey: ['id'],
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'name', logicalType: 'varchar', maxLength: 120 },
      ],
    },
    {
      schema: 'main',
      name: 'orders',
      primaryKey: ['id'],
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'customer_id', logicalType: 'integer', nullable: false },
        { name: 'cust_ref', logicalType: 'integer' },
        { name: 'total', logicalType: 'decimal' },
      ],
    },
  ],
};

function snapshotModel(): DatabaseModel {
  return parseDatabaseModel(FK_LESS_IR);
}

interface Harness {
  meta: MetaDb;
  manager: ConnectionManager;
  connectionId: string;
}

async function buildHarness(): Promise<Harness> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const crypto = dsnCryptoFromSecret(TEST_SECRET);
  const connection = await connectionsRepo(meta, crypto).create({
    name: 'shop',
    engine: 'sqlite',
    introspectDsn: 'sqlite:/tmp/never-opened.db',
  });
  const manager = new ConnectionManager({ meta, crypto, metaDsn: null, blockLoopback: false });
  return { meta, manager, connectionId: connection.id };
}

/** Shadow the real adapter factory — nothing here dials a database. */
function stubIntrospection(manager: ConnectionManager, model: DatabaseModel): void {
  const adapter = {
    probeCapabilities: async () => ({ serverVersion: 'test-1.0' }),
    introspect: async () => model,
    close: async () => undefined,
  };
  (manager as unknown as { introspectAdapter: () => Promise<unknown> }).introspectAdapter =
    async () => adapter;
}

describe('runIntrospection runs §6 inference before classification', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });
  afterEach(async () => {
    await h.meta.db.destroy();
  });

  it('persists inferred relations into the snapshot the whole server reads from', async () => {
    const raw = snapshotModel();
    expect(raw.relations).toEqual([]); // the adapter genuinely found none

    stubIntrospection(h.manager, raw);
    const { snapshot } = await runIntrospection({ ...h });

    const stored = snapshot.schema as unknown as DatabaseModel;
    const inferred = stored.relations.find((r) => r.kind === 'inferred-name');
    expect(inferred).toBeDefined();
    expect(inferred?.from).toEqual({ tableId: 'main.orders', columns: ['customer_id'] });
    expect(inferred?.to).toEqual({ tableId: 'main.customers', columns: ['id'] });
    expect(inferred?.confidence).toBeGreaterThanOrEqual(0.8);
    // `stats.relationCount` is what the Studio header counts — it must agree.
    expect(stored.stats.relationCount).toBe(stored.relations.length);
  });

  it('lets the classifier see them — the entire reason inference runs first', async () => {
    stubIntrospection(h.manager, snapshotModel());
    const { snapshot } = await runIntrospection({ ...h });

    const stored = snapshot.schema as unknown as DatabaseModel;
    const semanticOf = (name: string) =>
      stored.tables
        .find((t) => t.id === 'main.orders')
        ?.columns.find((c) => c.name === name)?.semantics?.primary;

    // Run inference AFTER classification (or not at all) and this is
    // `external-id`: a mono string instead of a chip that navigates.
    expect(semanticOf('customer_id')).toBe('fk');
    // The control column names no table, so nothing was fabricated for it.
    expect(semanticOf('cust_ref')).toBe('external-id');
  });

  it('infers nothing on a schema that declares its own foreign keys', async () => {
    const declared = parseDatabaseModel({
      ...FK_LESS_IR,
      capabilities: { hasFKs: true },
      tables: [
        FK_LESS_IR.tables[0] as unknown as Record<string, unknown>,
        {
          ...FK_LESS_IR.tables[1],
          columns: [
            { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
            {
              name: 'customer_id',
              logicalType: 'integer',
              nullable: false,
              references: { tableId: 'main.customers', column: 'id' },
            },
            { name: 'total', logicalType: 'decimal' },
          ],
        },
      ],
      relations: [
        {
          id: 'rel_orders_customers',
          kind: 'declared-fk',
          cardinality: 'one-to-many',
          from: { tableId: 'main.orders', columns: ['customer_id'] },
          to: { tableId: 'main.customers', columns: ['id'] },
        },
      ],
    });

    stubIntrospection(h.manager, declared);
    const { snapshot } = await runIntrospection({ ...h });

    const stored = snapshot.schema as unknown as DatabaseModel;
    expect(stored.relations.map((r) => r.kind)).toEqual(['declared-fk']);
  });
});

function row(
  op: string,
  tableName: string,
  value: Record<string, unknown>,
  createdAt: string,
): SchemaOverride {
  return {
    id: `ov_${op}_${createdAt}`,
    connectionId: 'c1',
    op,
    origin: 'user',
    status: 'active',
    tableName,
    columnName: null,
    value,
    createdAt,
  } as unknown as SchemaOverride;
}

describe('applyAcceptedRelations', () => {
  const model = snapshotModel();

  it('re-enters an accepted relation at confidence 1.0 with kind "override" (05 §6)', () => {
    const { model: out, warnings } = applyAcceptedRelations(model, [
      row(
        'relation.add',
        'main.orders',
        {
          fromColumn: 'cust_ref',
          toTable: 'main.customers',
          toColumn: 'id',
          cardinality: 'many-to-one',
        },
        '2026-08-17T00:00:00.000Z',
      ),
    ]);
    expect(warnings).toEqual([]);
    const added = out.relations.find((r) => r.kind === 'override');
    expect(added?.confidence).toBe(1);
    // `many-to-one` is the op vocabulary; the model only knows one-to-many.
    expect(added?.cardinality).toBe('one-to-many');
    expect(added?.from.columns).toEqual(['cust_ref']);
  });

  it('suppresses a relation the user removed, whatever kind it was', () => {
    const withRelation = parseDatabaseModel({
      ...FK_LESS_IR,
      relations: [
        {
          id: 'inferred-name:main.orders(customer_id)->main.customers(id)',
          kind: 'inferred-name',
          cardinality: 'one-to-many',
          from: { tableId: 'main.orders', columns: ['customer_id'] },
          to: { tableId: 'main.customers', columns: ['id'] },
          confidence: 0.9,
        },
      ],
    });
    const { model: out } = applyAcceptedRelations(withRelation, [
      row(
        'relation.remove',
        'main.orders',
        { fromColumn: 'customer_id', toTable: 'main.customers' },
        '2026-08-17T00:00:00.000Z',
      ),
    ]);
    expect(out.relations).toEqual([]);
    expect(out.stats.relationCount).toBe(0);
  });

  it('does not leave a duplicate edge when the accepted relation supersedes an inferred one', () => {
    const withRelation = parseDatabaseModel({
      ...FK_LESS_IR,
      relations: [
        {
          id: 'inferred-name:main.orders(customer_id)->main.customers(id)',
          kind: 'inferred-name',
          cardinality: 'one-to-many',
          from: { tableId: 'main.orders', columns: ['customer_id'] },
          to: { tableId: 'main.customers', columns: ['id'] },
          confidence: 0.65,
        },
      ],
    });
    const { model: out } = applyAcceptedRelations(withRelation, [
      row(
        'relation.add',
        'main.orders',
        {
          fromColumn: 'customer_id',
          toTable: 'main.customers',
          toColumn: 'id',
          cardinality: 'many-to-one',
        },
        '2026-08-17T00:00:00.000Z',
      ),
    ]);
    expect(out.relations).toHaveLength(1);
    expect(out.relations[0]?.kind).toBe('override');
  });

  it('drops a stale override with a warning instead of generating a page that cannot load', () => {
    const { model: out, warnings } = applyAcceptedRelations(model, [
      row(
        'relation.add',
        'main.orders',
        {
          fromColumn: 'cust_ref',
          toTable: 'main.suppliers', // dropped from the schema since the op was written
          toColumn: 'id',
          cardinality: 'many-to-one',
        },
        '2026-08-17T00:00:00.000Z',
      ),
    ]);
    expect(out.relations).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('main.suppliers');
  });

  it('leaves a model with no relation ops byte-identical', () => {
    const { model: out, warnings } = applyAcceptedRelations(model, [
      row('table.label', 'main.orders', { label: 'Sales' }, '2026-08-17T00:00:00.000Z'),
    ]);
    expect(out).toBe(model);
    expect(warnings).toEqual([]);
  });
});

/**
 * The read path lost its inline copy of these two ops when they moved into
 * the shared `applyRelationOverrides` — and it had NO coverage of them, so
 * nothing would have noticed the extraction going wrong. These are the pins
 * that make the two paths provably the same fold.
 */
describe('applyOverrides still folds relation ops (read path)', () => {
  const model = snapshotModel();

  it('adds an accepted relation and labels it, whichever row was written first', () => {
    const effective = applyOverrides(model, [
      // The label row is written BEFORE the add it refers to — which the old
      // inline switch could not honour, because it labelled a set that did
      // not contain the relation yet.
      row(
        'relation.label',
        'main.orders',
        { fromColumn: 'cust_ref', label: 'Billed to' },
        '2026-08-17T00:00:00.000Z',
      ),
      row(
        'relation.add',
        'main.orders',
        {
          fromColumn: 'cust_ref',
          toTable: 'main.customers',
          toColumn: 'id',
          cardinality: 'many-to-one',
        },
        '2026-08-17T00:00:01.000Z',
      ),
    ]);
    expect(effective.relations).toHaveLength(1);
    expect(effective.relations[0]?.kind).toBe('override');
    expect(effective.relations[0]?.label).toBe('Billed to');
  });

  it('honours a remove written after the add (§3.15 later-row-wins)', () => {
    const effective = applyOverrides(model, [
      row(
        'relation.add',
        'main.orders',
        {
          fromColumn: 'cust_ref',
          toTable: 'main.customers',
          toColumn: 'id',
          cardinality: 'many-to-one',
        },
        '2026-08-17T00:00:00.000Z',
      ),
      row(
        'relation.remove',
        'main.orders',
        { fromColumn: 'cust_ref', toTable: 'main.customers' },
        '2026-08-17T00:00:01.000Z',
      ),
    ]);
    expect(effective.relations).toEqual([]);
  });
});

describe('runGeneration — the override→regeneration loop', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildHarness();
    // Seed the snapshot directly: this suite is about the GENERATION end of
    // the loop, so the model deliberately carries no inferred relations.
    await snapshotsRepo(h.meta).create({
      connectionId: h.connectionId,
      source: 'introspection',
      schema: snapshotModel() as unknown as Record<string, unknown>,
      checksum: 'sha-shop-1',
    });
  });
  afterEach(async () => {
    await h.meta.db.destroy();
  });

  async function semanticOfCustRef(): Promise<string | undefined> {
    const pages = await pagesRepo(h.meta).listForConnection(h.connectionId);
    const orders = pages.find((p) => p.slug === 'orders');
    const config = orders?.config as { config?: { columns?: { name: string; semantic?: string }[] } };
    return config?.config?.columns?.find((c) => c.name === 'cust_ref')?.semantic;
  }

  it('an accepted relation.add reaches generatePages and turns the column into an FK chip', async () => {
    await overridesRepo(h.meta).create({
      connectionId: h.connectionId,
      op: 'relation.add',
      tableName: 'main.orders',
      value: {
        fromColumn: 'cust_ref',
        toTable: 'main.customers',
        toColumn: 'id',
        cardinality: 'many-to-one',
      },
    });

    const result = await runGeneration({ ...h });
    expect(result.introspected).toBe(false); // seeded snapshot — never dialed
    expect(await semanticOfCustRef()).toBe('fk');
  });

  it('without the override the same column generates as an external-id string', async () => {
    await runGeneration({ ...h });
    expect(await semanticOfCustRef()).toBe('external-id');
  });

  it('surfaces a stale override as a run warning rather than failing the run', async () => {
    await overridesRepo(h.meta).create({
      connectionId: h.connectionId,
      op: 'relation.add',
      tableName: 'main.orders',
      value: {
        fromColumn: 'cust_ref',
        toTable: 'main.suppliers',
        toColumn: 'id',
        cardinality: 'many-to-one',
      },
    });

    const result = await runGeneration({ ...h });
    expect(result.warnings.some((w) => w.includes('main.suppliers'))).toBe(true);
    expect(await semanticOfCustRef()).toBe('external-id');
  });
});
