// SPDX-License-Identifier: AGPL-3.0-only
/**
 * automationsRepo + automationRunsRepo (42-automations-and-workflow-logs.md
 * §3.2, 42-T03). The behaviours worth pinning are the ones a later change
 * could quietly break:
 *
 *  - `begin` is exactly-once through a UNIQUE index, not a check-then-insert
 *    (D6) — and it returns NULL rather than throwing, because "someone else
 *    already fired this" is the normal answer for three of the four producers.
 *  - `advance` never touches what a person authored, so a poll every minute
 *    does not move `updated_at`.
 *  - retention keeps a failed run twice as long (D23 / 07 §8) and never
 *    sweeps work that has not happened yet.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyMigrations,
  automationRunsRepo,
  automationsRepo,
  connectionsRepo,
  type Automation,
  type AutomationGraph,
  type AutomationTrace,
  type AutomationTrigger,
  type AutomationTriggerEvent,
  type DsnCrypto,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const DAY = 86_400_000;

const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

const RECORD_TRIGGER: AutomationTrigger = {
  kind: 'record',
  event: 'created',
  connectionId: 'cnx_1',
  table: 'public.users',
  watch: true,
};

const GRAPH: AutomationGraph = {
  version: 1,
  nodes: [{ id: 'n1', kind: 'trigger', title: 'When a user signs up' }],
};

const EVENT: AutomationTriggerEvent = {
  event: 'record.created',
  origin: 'dashboard',
  hops: 0,
  record: { connectionId: 'cnx_1', table: 'public.users', pk: { id: 7 }, label: 'Jordan' },
  snapshot: { id: 7, email: '•••' },
  occurredAt: T0,
};

const TRACE: AutomationTrace = {
  version: 1,
  steps: [
    { nodeId: 'n1', name: 'Trigger', kind: 'trigger', status: 'ok', startedAt: T0, durationMs: 1, log: null },
  ],
  resume: null,
};

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`automations repos [${dialect.name}]`, () => {
    let t: TestDb;
    let rules: ReturnType<typeof automationsRepo>;
    let runs: ReturnType<typeof automationRunsRepo>;
    let connectionId: string;

    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
      // The row's `connection_id` carries a real FK (0006) — a rule belongs to
      // a source and dies with it.
      connectionId = (
        await connectionsRepo(t.meta, testCrypto).create({
          name: 'northwind',
          engine: 'postgres',
          introspectDsn: 'postgres://ro@localhost/northwind',
        })
      ).id;
      rules = automationsRepo(t.meta);
      runs = automationRunsRepo(t.meta);
    });
    afterEach(async () => {
      await t.destroy();
    });

    async function makeRule(patch: Partial<Parameters<typeof rules.create>[0]> = {}): Promise<Automation> {
      return rules.create(
        {
          connectionId,
          name: 'Welcome new signups',
          trigger: RECORD_TRIGGER,
          graph: GRAPH,
          ...patch,
        },
        T0,
      );
    }

    it('creates paused by default and round-trips the trigger and the graph', async () => {
      const rule = await makeRule();
      expect(rule.enabled).toBe(false);
      const read = await rules.findById(rule.id);
      expect(read?.trigger).toEqual({ ...RECORD_TRIGGER });
      expect(read?.graph.nodes[0]).toMatchObject({ kind: 'trigger', title: 'When a user signs up' });
      expect(read?.timeSavedMinutes).toBeNull();
    });

    it('indexes enabled rules by (connection, table, event) and by watching', async () => {
      const enabled = await makeRule({ enabled: true });
      await makeRule(); // paused — never matches
      await makeRule({
        enabled: true,
        trigger: { ...RECORD_TRIGGER, event: 'deleted', watch: true },
      });
      await makeRule({
        enabled: true,
        trigger: { ...RECORD_TRIGGER, table: 'public.orders', watch: false },
      });

      const matched = await rules.listEnabledFor('cnx_1', 'public.users', 'created');
      expect(matched.map((r) => r.id)).toEqual([enabled.id]);

      // `deleted` cannot be watched (no tombstones) and an off switch is off.
      const watching = await rules.listWatching();
      expect(watching.map((r) => r.trigger.kind === 'record' && r.trigger.table)).toEqual([
        'public.users',
      ]);
    });

    it('lists due schedule rules only, and never a record rule with a stale next_run_at', async () => {
      const scheduled = await makeRule({
        enabled: true,
        trigger: {
          kind: 'schedule',
          connectionId: 'cnx_1',
          schedule: { kind: 'interval', everyMinutes: '15' },
        },
        nextRunAt: T0 - 1,
      });
      const notYet = await makeRule({
        enabled: true,
        trigger: {
          kind: 'schedule',
          connectionId: 'cnx_1',
          schedule: { kind: 'interval', everyMinutes: '15' },
        },
        nextRunAt: T0 + DAY,
      });
      // A record rule can never be due, whatever the column says.
      await makeRule({ enabled: true, nextRunAt: T0 - 1 });

      const due = await rules.listDue(T0);
      expect(due.map((r) => r.id)).toEqual([scheduled.id]);
      expect(due.map((r) => r.id)).not.toContain(notYet.id);
    });

    it('advance moves the engine columns and leaves updated_at alone', async () => {
      const rule = await makeRule();
      await rules.advance(rule.id, {
        lastRunAt: T0 + 60_000,
        nextRunAt: T0 + 900_000,
        watchCursor: { column: 'created_at', value: T0, frontierPk: { id: 7 } },
      });
      const read = await rules.findById(rule.id);
      expect(read).toMatchObject({ lastRunAt: T0 + 60_000, nextRunAt: T0 + 900_000 });
      expect(read?.watchCursor).toEqual({ column: 'created_at', value: T0, frontierPk: { id: 7 } });
      expect(read?.updatedAt).toBe(T0);
    });

    it('begin is exactly-once: the second producer of an occurrence gets null (D6)', async () => {
      const rule = await makeRule({ enabled: true });
      const key = `${rule.id}:{"id":7}`;
      const first = await runs.begin(
        { automationId: rule.id, dedupeKey: key, origin: 'dashboard', triggerEvent: EVENT, wakeAt: T0 + 60_000 },
        T0,
      );
      expect(first).toMatchObject({ status: 'pending', origin: 'dashboard', wakeAt: T0 + 60_000 });

      // The watch poller sees the same row a minute later and computes the
      // SAME key — which is why a dashboard-made record fires once, not twice.
      const second = await runs.begin(
        { automationId: rule.id, dedupeKey: key, origin: 'watch', triggerEvent: { ...EVENT, origin: 'watch' } },
        T0 + 60_000,
      );
      expect(second).toBeNull();
    });

    it('walks a run pending → running → waiting → succeeded and keeps the trace', async () => {
      const rule = await makeRule({ enabled: true });
      const run = await runs.begin(
        { automationId: rule.id, dedupeKey: null, origin: 'watch', triggerEvent: EVENT },
        T0,
      );
      if (!run) throw new Error('expected a run');

      expect(await runs.start(run.id)).toBe(true);
      // At-least-once delivery must not restart a run already walking.
      expect(await runs.start(run.id)).toBe(false);

      expect(await runs.wait(run.id, { wakeAt: T0 + 2 * DAY, trace: TRACE })).toBe(true);
      expect(await runs.findById(run.id)).toMatchObject({ status: 'waiting', wakeAt: T0 + 2 * DAY });

      expect(await runs.start(run.id)).toBe(true);
      await runs.finish(run.id, { status: 'succeeded', trace: TRACE, durationMs: 42 }, T0 + 3 * DAY);
      const done = await runs.findById(run.id);
      expect(done).toMatchObject({
        status: 'succeeded',
        durationMs: 42,
        wakeAt: null,
        finishedAt: T0 + 3 * DAY,
      });
      expect(done?.trace?.steps[0]?.name).toBe('Trigger');
    });

    it('skips a pending run for undo, and refuses to skip one that already started (D7)', async () => {
      const rule = await makeRule({ enabled: true });
      const make = async (key: string) =>
        runs.begin(
          { automationId: rule.id, dedupeKey: key, origin: 'dashboard', triggerEvent: EVENT, wakeAt: T0 + 60_000 },
          T0,
        );
      const undoable = await make('a');
      const started = await make('b');
      if (!undoable || !started) throw new Error('expected two runs');
      await runs.start(started.id);

      const pending = await runs.listPending('dashboard');
      expect(pending.map((r) => r.id)).toEqual([undoable.id]);
      expect(pending[0]?.triggerEvent.record?.pk).toEqual({ id: 7 });

      expect(await runs.skipPending(undoable.id, { trace: TRACE })).toBe(true);
      expect(await runs.skipPending(started.id, { trace: TRACE })).toBe(false);
      expect((await runs.findById(undoable.id))?.status).toBe('skipped');
    });

    it('lists newest first through a keyset cursor and counts the comp’s three filters', async () => {
      const rule = await makeRule({ enabled: true });
      const statuses = ['succeeded', 'failed', 'succeeded', 'waiting', 'pending'] as const;
      const ids: string[] = [];
      for (const [i, status] of statuses.entries()) {
        const run = await runs.begin(
          { automationId: rule.id, dedupeKey: `k${i}`, origin: 'watch', triggerEvent: EVENT },
          T0 + i * 1000,
        );
        if (!run) throw new Error('expected a run');
        ids.push(run.id);
        if (status === 'succeeded' || status === 'failed') {
          await runs.start(run.id);
          await runs.finish(run.id, { status, trace: TRACE, durationMs: 10 * (i + 1) }, T0 + i * 1000 + 5);
        } else if (status === 'waiting') {
          await runs.start(run.id);
          await runs.wait(run.id, { wakeAt: T0 + DAY, trace: TRACE });
        }
      }

      const page1 = await runs.list({ since: T0 - DAY, limit: 2 });
      expect(page1.map((r) => r.id)).toEqual([ids[4], ids[3]]);
      const last = page1[1];
      if (!last) throw new Error('expected a second row');
      const page2 = await runs.list({
        since: T0 - DAY,
        limit: 2,
        before: { startedAt: last.startedAt, id: last.id },
      });
      expect(page2.map((r) => r.id)).toEqual([ids[2], ids[1]]);

      // "Running" is the comp's word for pending + waiting + running (D9).
      expect(await runs.counts({ since: T0 - DAY })).toEqual({
        all: 5,
        success: 2,
        failed: 1,
        running: 2,
      });
      expect(await runs.list({ since: T0 - DAY, filter: 'failed' })).toHaveLength(1);

      const stats = await runs.stats(T0 - DAY, T0 + DAY);
      expect(stats).toMatchObject({ runs: 5, succeeded: 2, failed: 1 });
      // 10, 20 and 30 ms of finished work — waits contribute nothing.
      expect(stats.avgDurationMs).toBe(20);

      const perRule = await runs.perRule(T0 - DAY);
      expect(perRule.get(rule.id)).toEqual({ runs: 5, succeeded: 2, failed: 1 });
    });

    it('retention keeps a failed run twice as long and never sweeps future work (D23)', async () => {
      const rule = await makeRule({ enabled: true });
      const at = T0 + 200 * DAY;
      const add = async (key: string, age: number, status: 'succeeded' | 'failed' | null) => {
        const run = await runs.begin(
          { automationId: rule.id, dedupeKey: key, origin: 'watch', triggerEvent: EVENT },
          at - age * DAY,
        );
        if (!run) throw new Error('expected a run');
        if (status) {
          await runs.start(run.id);
          await runs.finish(run.id, { status, trace: TRACE, durationMs: 1 }, at - age * DAY + 5);
        }
        return run.id;
      };
      const oldSuccess = await add('a', 91, 'succeeded');
      const oldFailure = await add('b', 91, 'failed');
      const ancientFailure = await add('c', 181, 'failed');
      const freshSuccess = await add('d', 3, 'succeeded');
      const stillPending = await add('e', 400, null);

      expect(await runs.gc(at, 90)).toBe(2);
      const survivors = await Promise.all(
        [oldSuccess, oldFailure, ancientFailure, freshSuccess, stillPending].map((id) =>
          runs.findById(id),
        ),
      );
      expect(survivors.map((r) => r !== null)).toEqual([false, true, false, true, true]);
    });

    it('cascades runs when the rule is deleted', async () => {
      const rule = await makeRule({ enabled: true });
      const run = await runs.begin(
        { automationId: rule.id, dedupeKey: 'x', origin: 'watch', triggerEvent: EVENT },
        T0,
      );
      if (!run) throw new Error('expected a run');
      expect(await rules.remove(rule.id)).toBe(true);
      expect(await runs.findById(run.id)).toBeNull();
    });
  });
}
