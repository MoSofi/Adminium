// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0023 (schema authoring): `adminium_schema_changes` lands with its
 * ledger semantics, and `can_ddl` / `diagram_layout` land on
 * `adminium_connections` with pre-wave rows reading as "never probed" rather
 * than as "no".
 *
 * Runs the real migration list split at 0022/0023 on every available dialect,
 * because the two ALTERs and the FK are where a portable-DDL mistake shows up
 * and sqlite alone would not find it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALL_MIGRATIONS,
  applyMigrations,
  connectionsRepo,
  schemaChangesRepo,
  type StepOutcome,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const PRE_0023 = ALL_MIGRATIONS.filter((m) => m.name < '0023_schema_authoring');

const crypto = { encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => v.slice(4) };

const step = (over: Partial<StepOutcome> = {}): StepOutcome => ({
  id: 'add-column-1',
  kind: 'add-column',
  table: 'public.orders',
  column: 'note',
  hazard: 'safe',
  outcome: 'pending',
  sql: ['ALTER TABLE "public"."orders" ADD COLUMN "note" text'],
  error: null,
  durationMs: null,
  ...over,
});

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0023_schema_authoring [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('adds can_ddl and diagram_layout; a pre-wave row reads null, not false', async () => {
      // Ends exactly where 0023 begins — not "0023 is last", which every later
      // wave would invalidate.
      expect(PRE_0023.at(-1)?.name).toBe('0022_studio_namespace');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0023 });

      await t.meta.db
        .insertInto('adminium_connections')
        .values({
          id: 'con_pre0023',
          name: 'legacy',
          engine: 'postgres',
          sourceKind: 'dsn',
          introspectDsnEncrypted: 'enc:postgres://legacy',
          settings: '{}',
          status: 'connected',
          readOnly: t.meta.dialect === 'postgres' ? false : 0,
          createdAt: T0,
          updatedAt: T0,
        } as never)
        .execute();

      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });

      const repo = connectionsRepo(t.meta, crypto);
      const row = await repo.findById('con_pre0023');
      // "we never asked" and "we asked and the answer was no" lead to different
      // UI; a default of false would erase the difference.
      expect(row?.canDdl).toBeNull();
      expect(row?.diagramLayout).toBeNull();
    });

    it('persists a probe’s canDdl through recordTestResult', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const repo = connectionsRepo(t.meta, crypto);
      const created = await repo.create(
        {
          name: 'src',
          engine: 'postgres',
          sourceKind: 'dsn',
          introspectDsn: 'postgres://x',
          createdBy: null,
        } as never,
        T0,
      );

      await repo.recordTestResult(created.id, { ok: true, canDdl: true }, T0 + 1);
      expect((await repo.findById(created.id))?.canDdl).toBe(true);

      await repo.recordTestResult(created.id, { ok: true, canDdl: false }, T0 + 2);
      expect((await repo.findById(created.id))?.canDdl).toBe(false);
    });

    it('records an apply ledger-first: the row says running before any step lands', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const connections = connectionsRepo(t.meta, crypto);
      const connection = await connections.create(
        { name: 'src', engine: 'postgres', sourceKind: 'dsn', introspectDsn: 'postgres://x', createdBy: null } as never,
        T0,
      );
      const repo = schemaChangesRepo(t.meta);

      const started = await repo.start(
        {
          connectionId: connection.id,
          planChecksum: 'abc123',
          hazard: 'safe',
          steps: [step(), step({ id: 'add-index-2', kind: 'add-index' })],
        },
        T0,
      );
      expect(started.status).toBe('running');
      expect(started.finishedAt).toBeNull();
      expect(started.steps).toHaveLength(2);

      // A killed worker leaves exactly this, and the next plan surfaces it.
      expect((await repo.unfinishedFor(connection.id))?.id).toBe(started.id);

      await repo.recordSteps(started.id, [
        step({ outcome: 'succeeded', durationMs: 12 }),
        step({ id: 'add-index-2', kind: 'add-index', outcome: 'pending' }),
      ]);
      const midway = await repo.findById(started.id);
      expect(midway?.steps[0]?.outcome).toBe('succeeded');
      // `pending` is a distinct fact from `failed`: it is what a re-apply completes.
      expect(midway?.steps[1]?.outcome).toBe('pending');

      await repo.finish(
        started.id,
        {
          status: 'partial',
          steps: [
            step({ outcome: 'succeeded', durationMs: 12 }),
            step({ id: 'add-index-2', kind: 'add-index', outcome: 'failed', error: 'lock timeout' }),
          ],
          error: 'lock timeout',
        },
        T0 + 500,
      );

      const done = await repo.findById(started.id);
      expect(done?.status).toBe('partial');
      expect(done?.finishedAt).toBe(T0 + 500);
      expect(done?.error).toBe('lock timeout');
      // …and it is no longer an unfinished apply.
      expect(await repo.unfinishedFor(connection.id)).toBeNull();
    });

    it('lists a connection’s applies newest first', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const connections = connectionsRepo(t.meta, crypto);
      const connection = await connections.create(
        { name: 'src', engine: 'postgres', sourceKind: 'dsn', introspectDsn: 'postgres://x', createdBy: null } as never,
        T0,
      );
      const repo = schemaChangesRepo(t.meta);
      const first = await repo.start(
        { connectionId: connection.id, planChecksum: 'one', hazard: 'safe', steps: [step()] },
        T0,
      );
      const second = await repo.start(
        { connectionId: connection.id, planChecksum: 'two', hazard: 'lossy', steps: [step()] },
        T0 + 1000,
      );
      const list = await repo.listForConnection(connection.id);
      expect(list.map((c) => c.id)).toEqual([second.id, first.id]);
    });

    it('cascades the ledger when its connection is deleted', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const connections = connectionsRepo(t.meta, crypto);
      const connection = await connections.create(
        { name: 'src', engine: 'postgres', sourceKind: 'dsn', introspectDsn: 'postgres://x', createdBy: null } as never,
        T0,
      );
      const repo = schemaChangesRepo(t.meta);
      await repo.start(
        { connectionId: connection.id, planChecksum: 'one', hazard: 'safe', steps: [step()] },
        T0,
      );
      await connections.delete(connection.id);
      expect(await repo.listForConnection(connection.id)).toEqual([]);
    });

    it('refuses an empty plan checksum — a ledger row that names no plan is unusable', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const repo = schemaChangesRepo(t.meta);
      await expect(
        repo.start({ connectionId: 'con_x', planChecksum: '', hazard: 'safe', steps: [] }),
      ).rejects.toThrow(/checksum/);
    });
  });
}
