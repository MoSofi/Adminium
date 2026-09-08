// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0028 (42-automations-and-workflow-logs.md §3.2, 42-T01): the two
 * tables migration 0006 created and nothing ever used gain the six runtime
 * columns an engine needs.
 *
 * Runs the real migration list split at 0027/0028 on every available dialect.
 * The interesting case is the pre-wave row: `adminium_automations` and
 * `adminium_automation_runs` have shipped since 0006, so an installed meta
 * store may hold rows written before this wave — they must read back with
 * every new column at its default, `origin` included (a NOT NULL column added
 * to an existing table is exactly where SQLite, Postgres and MySQL disagree
 * if the default is missing).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALL_MIGRATIONS,
  applyMigrations,
  automationRunsRepo,
  automationsRepo,
  type AutomationGraph,
  type AutomationTrigger,
  type AutomationTriggerEvent,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const PRE_0028 = ALL_MIGRATIONS.filter((m) => m.name < '0028_automations_runtime');

const LEGACY_TRIGGER: AutomationTrigger = {
  kind: 'record',
  event: 'created',
  connectionId: 'cnx_legacy',
  table: 'public.users',
  watch: true,
};
const LEGACY_GRAPH: AutomationGraph = {
  version: 1,
  nodes: [{ id: 'n1', kind: 'trigger', title: 'When a user signs up' }],
};
const LEGACY_EVENT: AutomationTriggerEvent = {
  event: 'record.created',
  origin: 'dashboard',
  hops: 0,
  record: null,
  snapshot: null,
  occurredAt: T0,
};

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0028_automations_runtime [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('upgrades pre-wave rows: every new column at its default, origin NOT NULL', async () => {
      // Ends exactly where 0028 begins — not "0027 is last", which the next
      // wave would invalidate.
      expect(PRE_0028.at(-1)?.name).toBe('0027_invoice_documents');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0028 });

      await t.meta.db
        .insertInto('adminium_automations')
        .values({
          id: 'auto_PRE0028',
          connectionId: null,
          name: 'A rule from before the engine existed',
          description: null,
          enabled: t.meta.dialect === 'postgres' ? false : 0,
          trigger: JSON.stringify(LEGACY_TRIGGER),
          graph: JSON.stringify(LEGACY_GRAPH),
          lastRunAt: null,
          createdBy: null,
          createdAt: T0,
          updatedAt: T0,
        } as never)
        .execute();
      await t.meta.db
        .insertInto('adminium_automation_runs')
        .values({
          id: 'arun_PRE0028',
          automationId: 'auto_PRE0028',
          jobId: null,
          status: 'succeeded',
          triggerEvent: JSON.stringify(LEGACY_EVENT),
          trace: null,
          error: null,
          startedAt: T0,
          finishedAt: T0 + 40,
        } as never)
        .execute();

      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });

      const rule = await automationsRepo(t.meta).findById('auto_PRE0028');
      expect(rule).toMatchObject({ nextRunAt: null, watchCursor: null, timeSavedMinutes: null });

      const run = await automationRunsRepo(t.meta).findById('arun_PRE0028');
      expect(run).toMatchObject({
        dedupeKey: null,
        wakeAt: null,
        durationMs: null,
        // The default, not NULL — the column is NOT NULL on all three engines.
        origin: 'dashboard',
      });
    });

    it('enforces the dedupe key with an index, and exempts NULL (D6)', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
      const runs = automationRunsRepo(t.meta);
      const rule = await automationsRepo(t.meta).create(
        { connectionId: null, name: 'R', trigger: LEGACY_TRIGGER, graph: LEGACY_GRAPH },
        T0,
      );
      const begin = (dedupeKey: string | null) =>
        runs.begin(
          {
            automationId: rule.id,
            dedupeKey,
            origin: 'watch',
            triggerEvent: { ...LEGACY_EVENT, origin: 'watch' },
          },
          T0,
        );

      expect(await begin('once')).not.toBeNull();
      expect(await begin('once')).toBeNull();
      // NULLs are exempt from unique on all three dialects.
      expect(await begin(null)).not.toBeNull();
      expect(await begin(null)).not.toBeNull();
    });
  });
}
