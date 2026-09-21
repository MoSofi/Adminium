// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Column-semantic overrides through `runGeneration` — the generation half.
 *
 * The sibling suite (`column-semantics-overrides.test.ts`) pins the overlay and
 * the single-page compose path. This one pins the pass that regenerates a whole
 * app, because that is the SHIPPED surface the overlay changes: a re-run over an
 * unchanged schema can now emit a page it did not emit before. That is the
 * point of the change, but it is a behaviour change, so it gets an explicit
 * before/after rather than being left implied.
 *
 * Offline: sqlite meta, a pre-seeded snapshot (no introspection), a manager that
 * only ever resolves the connection row — the same harness as
 * `generate-run-labels.test.ts`.
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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { runGeneration } from '../src/generate/run.js';
import { TEST_SECRET } from './helpers.js';

/**
 * One table whose date column is the right TYPE and the wrong NAME:
 * `r12-event-timestamp` only tags a timestamp whose name ends `_at`/`_date`/
 * `_on`/`_time`/`_ts`, so a bare `date` classifies `plain` and the calendar
 * archetype never triggers.
 */
const SCHEMA_IR = {
  dialect: 'sqlite',
  name: 'clinic',
  defaultSchema: 'main',
  schemas: ['main'],
  tables: [
    {
      schema: 'main',
      name: 'appointments',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'title', logicalType: 'text' },
        { name: 'date', logicalType: 'timestamp' },
      ],
      primaryKey: ['id'],
    },
  ],
};

describe('runGeneration — column-semantic override channel', () => {
  let meta: MetaDb;
  let manager: ConnectionManager;
  let connectionId: string;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const crypto = dsnCryptoFromSecret(TEST_SECRET);
    const connection = await connectionsRepo(meta, crypto).create({
      name: 'clinic',
      engine: 'sqlite',
      introspectDsn: 'sqlite:/tmp/never-opened.db',
    });
    connectionId = connection.id;
    await snapshotsRepo(meta).create({
      connectionId,
      source: 'introspection',
      schema: SCHEMA_IR,
      checksum: 'sha-clinic-1',
    });
    manager = new ConnectionManager({ meta, crypto, metaDsn: null, blockLoopback: false });
  });
  afterEach(async () => {
    await meta.db.destroy();
  });

  async function slugs(): Promise<string[]> {
    return (await pagesRepo(meta).listForConnection(connectionId)).map((p) => p.slug).sort();
  }

  async function tagTheDateColumn(): Promise<void> {
    await overridesRepo(meta).create(
      {
        connectionId,
        op: 'column.semanticType',
        tableName: 'main.appointments',
        columnName: 'date',
        value: { semanticType: 'event-timestamp' },
      },
      1_000,
    );
  }

  it('emits no calendar while the date column is only named "date"', async () => {
    const result = await runGeneration({ manager, meta, connectionId });
    expect(result.introspected).toBe(false); // seeded snapshot — never dialed
    // The control half: if generation emitted a calendar for every table, the
    // test below would pass while proving nothing.
    expect(await slugs()).not.toContain('appointments-calendar');
  });

  it('emits the calendar once the operator has tagged that column', async () => {
    await tagTheDateColumn();
    await runGeneration({ manager, meta, connectionId });

    const pages = await pagesRepo(meta).listForConnection(connectionId);
    const calendar = pages.find((p) => p.slug === 'appointments-calendar');
    expect(calendar?.type).toBe('page-calendar');

    // The page must bind the tagged column, not merely exist — an unbound
    // calendar is the blank rectangle this whole plan exists to answer.
    const config = calendar?.config as { config: { layout: { items: { widget: string; config: Record<string, unknown> }[] } } };
    const month = config.config.layout.items.find((item) => item.widget === 'calendar-month');
    expect(month?.config['startColumn']).toBe('date');
  });

  it('a disabled override changes nothing (the row must be active to count)', async () => {
    await tagTheDateColumn();
    const [staged] = await overridesRepo(meta).listForConnection(connectionId, {});
    await overridesRepo(meta).setStatus(staged!.id, 'disabled');

    await runGeneration({ manager, meta, connectionId });
    expect(await slugs()).not.toContain('appointments-calendar');
  });
});
