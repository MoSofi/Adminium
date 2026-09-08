// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two time-driven producers (42-automations-and-workflow-logs.md 42-T06,
 * 42-T07): the watch poller that sees rows Adminium did not write, and the
 * schedule scanner that asks "which rows match right now?".
 *
 * The assertions that matter are the ones about NOT firing twice and NOT
 * missing a row, because both failures are silent: a duplicate welcome email
 * looks like a mail-server hiccup, and a skipped sign-up looks like nothing
 * at all.
 */

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  auditRepo,
  automationRunsRepo,
  automationsRepo,
  jobsRepo,
  type Automation,
  type AutomationGraph,
  type AutomationTrigger,
  type CreateAutomationInput,
  type EnqueueJobInput,
  type Job,
} from '@adminium/meta';

import { AutomationMatcher } from '../src/automations/matcher.js';
import { nextTickFor, scanDueSchedules } from '../src/automations/schedule.js';
import { pollWatchedTables } from '../src/automations/watch.js';
import { boundValue } from '../src/automations/relative-time.js';
import { makeAutomationsRegistry, seedAutomationsSqlite } from './automations-fixture.js';
import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';

const T0 = Date.UTC(2026, 8, 8, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 3_600_000;

const GRAPH: AutomationGraph = {
  version: 1,
  nodes: [{ id: 'n1', kind: 'trigger', title: 'Trigger' }],
};

const iso = (at: number): string => new Date(at).toISOString();

describe('42 — the watch poller and the schedule scanner', () => {
  let sqlite: BetterSqlite3.Database;
  let t: DataTestContext;
  let connectionId: string;
  let matcher: AutomationMatcher;
  let now: number;

  async function enqueue(input: EnqueueJobInput): Promise<Job> {
    return jobsRepo(t.meta).enqueue({ ...input, kind: 'noop-progress' }, now);
  }

  beforeEach(async () => {
    now = T0;
    sqlite = seedAutomationsSqlite();
    const dispatcher = {
      onRecordEvent: async (event: never) => matcher.onRecordEvent(event),
      onUndo: async (refs: never) => matcher.onUndo(refs),
      onRulesChanged: async () => matcher.onRulesChanged(),
    };
    t = await buildDataTestApp({
      registry: makeAutomationsRegistry(sqlite),
      automations: dispatcher as never,
      now: () => now,
    });
    matcher = new AutomationMatcher({ meta: t.meta, enqueue, now: () => now });
    connectionId = await createConnectionViaApi(t, 'sqlite:/tmp/fixture.db', 'fixture', 'sqlite');
    await introspectViaApi(t, connectionId);
    for (const table of ['main.users', 'main.appointments']) {
      await t.grantTable(t.roles.admin, connectionId, table, {
        read: true,
        create: true,
        update: true,
        delete: true,
      });
    }
  });

  afterEach(async () => {
    await t.app.close();
    sqlite.close();
  });

  async function makeRule(patch: Partial<CreateAutomationInput>): Promise<Automation> {
    const trigger: AutomationTrigger = {
      kind: 'record',
      event: 'created',
      connectionId,
      table: 'main.users',
      watch: true,
    };
    const rule = await automationsRepo(t.meta).create(
      { connectionId, name: 'Rule', trigger, graph: GRAPH, enabled: true, ...patch },
      now,
    );
    await matcher.refresh();
    return rule;
  }

  const watchDeps = () => ({ meta: t.meta, manager: t.manager, enqueue, now: () => now });
  const scanDeps = () => ({ meta: t.meta, manager: t.manager, enqueue, now: () => now });
  const listRuns = () => automationRunsRepo(t.meta).list({ since: T0 - 10 * HOUR });

  // --- the watch poller ----------------------------------------------------

  it('a first tick records where it is and fires for nothing (no history replay)', async () => {
    sqlite
      .prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
      .run(1, 'old@acme.io', iso(T0 - HOUR));
    const rule = await makeRule({});

    expect(await pollWatchedTables(watchDeps())).toMatchObject({ runsStarted: 0 });
    expect(await listRuns()).toHaveLength(0);
    const stored = await automationsRepo(t.meta).findById(rule.id);
    expect(stored?.watchCursor).toMatchObject({
      column: 'created_at',
      value: iso(T0 - HOUR),
      frontierPk: { id: 1 },
    });
  });

  it('picks up a row inserted OUTSIDE the API, exactly once across ticks', async () => {
    await makeRule({});
    await pollWatchedTables(watchDeps()); // establish the cursor

    // The customer's own application writes its own users table.
    sqlite
      .prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
      .run(7, 'jordan@acme.io', iso(T0 + MINUTE));

    now = T0 + 2 * MINUTE;
    expect(await pollWatchedTables(watchDeps())).toMatchObject({ runsStarted: 1 });
    now = T0 + 3 * MINUTE;
    expect(await pollWatchedTables(watchDeps())).toMatchObject({ runsStarted: 0 });

    const runs = await listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'pending', origin: 'watch', wakeAt: null });
    expect(runs[0]?.triggerEvent.record?.pk).toEqual({ id: 7 });
  });

  it('a dashboard create plus a later poll is ONE run (the shared key, D4)', async () => {
    await makeRule({});
    await pollWatchedTables(watchDeps());

    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connectionId}/main.users`,
      headers: asUser(t.users.admin),
      payload: { values: { id: 7, email: 'jordan@acme.io', created_at: iso(T0 + MINUTE) } },
    });
    expect(res.statusCode).toBe(201);
    expect(await listRuns()).toHaveLength(1);

    now = T0 + 2 * MINUTE;
    expect(await pollWatchedTables(watchDeps())).toMatchObject({ runsStarted: 0 });
    const runs = await listRuns();
    expect(runs).toHaveLength(1);
    // The dashboard's run keeps its undo delay; the poller did not make a
    // second one at delay 0.
    expect(runs[0]).toMatchObject({ origin: 'dashboard', wakeAt: T0 + 60_000 });
  });

  it('does not lose rows that share the cursor value to the millisecond', async () => {
    await makeRule({});
    await pollWatchedTables(watchDeps());

    const stamp = iso(T0 + MINUTE);
    const insert = sqlite.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)');
    for (const id of [10, 11, 12]) insert.run(id, `u${id}@acme.io`, stamp);

    now = T0 + 2 * MINUTE;
    expect(await pollWatchedTables({ ...watchDeps(), batch: 2 })).toMatchObject({ runsStarted: 2 });
    // The third row shares the cursor's exact value; a `>` cursor would drop
    // it for ever.
    now = T0 + 3 * MINUTE;
    expect(await pollWatchedTables({ ...watchDeps(), batch: 2 })).toMatchObject({ runsStarted: 1 });
    expect(await listRuns()).toHaveLength(3);
  });

  it('never watches a delete rule, and never a paused one', async () => {
    await makeRule({
      trigger: { kind: 'record', event: 'deleted', connectionId, table: 'main.users', watch: true },
    });
    await makeRule({ enabled: false });
    expect(await pollWatchedTables(watchDeps())).toMatchObject({ rulesPolled: 0 });
  });

  it('honours the trigger’s `when` on a watched row', async () => {
    await makeRule({
      trigger: {
        kind: 'record',
        event: 'created',
        connectionId,
        table: 'main.users',
        watch: true,
        when: [{ left: { field: 'status' }, op: 'is', right: 'trial' }],
      },
    });
    await pollWatchedTables(watchDeps());
    const insert = sqlite.prepare(
      'INSERT INTO users (id, email, status, created_at) VALUES (?, ?, ?, ?)',
    );
    insert.run(20, 'a@acme.io', 'new', iso(T0 + MINUTE));
    insert.run(21, 'b@acme.io', 'trial', iso(T0 + 2 * MINUTE));

    now = T0 + 3 * MINUTE;
    expect(await pollWatchedTables(watchDeps())).toMatchObject({ runsStarted: 1 });
    const runs = await listRuns();
    expect(runs[0]?.triggerEvent.record?.pk).toEqual({ id: 21 });
  });

  // --- the schedule scanner ------------------------------------------------

  it('computes the next tick for both schedule kinds', () => {
    expect(nextTickFor({ kind: 'interval', everyMinutes: '15' }, T0)).toBe(T0 + 15 * MINUTE);
    const daily = nextTickFor(
      { kind: 'daily', time: '09:00', timezone: 'UTC', dayOfWeek: null, dayOfMonth: null },
      T0,
    );
    expect(daily).toBe(Date.UTC(2026, 8, 9, 9, 0, 0));
  });

  it('scans for-each rows once per record across four ticks (the reminder, C.2)', async () => {
    const insert = sqlite.prepare(
      'INSERT INTO appointments (appointment_id, patient_id, patient_email, starts_at, status) VALUES (?, ?, ?, ?, ?)',
    );
    // 90 minutes out and scheduled — inside the two-hour window.
    insert.run(1, 100, 'p1@acme.io', iso(T0 + 90 * MINUTE), 'scheduled');
    // Four hours out — outside it.
    insert.run(2, 101, 'p2@acme.io', iso(T0 + 4 * HOUR), 'scheduled');
    // Inside the window but already cancelled.
    insert.run(3, 102, 'p3@acme.io', iso(T0 + 30 * MINUTE), 'cancelled');

    const rule = await makeRule({
      name: 'Appointment reminder',
      trigger: {
        kind: 'schedule',
        connectionId,
        schedule: { kind: 'interval', everyMinutes: '15' },
        forEach: {
          table: 'main.appointments',
          once: true,
          where: [
            { left: { field: 'starts_at' }, op: 'within_next', right: { amount: 2, unit: 'hours' } },
            { left: { field: 'status' }, op: 'is', right: 'scheduled' },
          ],
        },
      },
      nextRunAt: T0,
    });

    let started = 0;
    for (let tick = 0; tick < 4; tick += 1) {
      now = T0 + tick * 15 * MINUTE;
      started += (await scanDueSchedules(scanDeps())).runsStarted;
    }
    expect(started).toBe(1);

    const runs = await listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ automationId: rule.id, origin: 'schedule' });
    expect(runs[0]?.triggerEvent.record?.pk).toEqual({ appointment_id: 1 });
    // The tick advanced every time, so the rule is not stuck in the past.
    const stored = await automationsRepo(t.meta).findById(rule.id);
    expect(stored?.nextRunAt).toBe(T0 + 4 * 15 * MINUTE);
  });

  it('without `once`, every tick that matches is its own occurrence', async () => {
    sqlite
      .prepare(
        'INSERT INTO appointments (appointment_id, patient_id, starts_at, status) VALUES (?, ?, ?, ?)',
      )
      .run(1, 100, iso(T0 - 45 * MINUTE), 'scheduled');

    await makeRule({
      trigger: {
        kind: 'schedule',
        connectionId,
        schedule: { kind: 'interval', everyMinutes: '60' },
        forEach: {
          table: 'main.appointments',
          once: false,
          where: [
            {
              left: { field: 'starts_at' },
              op: 'more_than_ago',
              right: { amount: 30, unit: 'minutes' },
            },
          ],
        },
      },
      nextRunAt: T0,
    });

    now = T0;
    expect((await scanDueSchedules(scanDeps())).runsStarted).toBe(1);
    now = T0 + HOUR;
    expect((await scanDueSchedules(scanDeps())).runsStarted).toBe(1);
    expect(await listRuns()).toHaveLength(2);
  });

  it('a bare tick makes one run with no record', async () => {
    await makeRule({
      trigger: {
        kind: 'schedule',
        connectionId: null,
        schedule: { kind: 'interval', everyMinutes: '60' },
      },
      connectionId: null,
      nextRunAt: T0,
    });
    expect((await scanDueSchedules(scanDeps())).runsStarted).toBe(1);
    const runs = await listRuns();
    expect(runs[0]?.triggerEvent).toMatchObject({ event: 'schedule.tick', record: null });
  });

  it('caps a runaway scan and says so in the audit log', async () => {
    const insert = sqlite.prepare(
      'INSERT INTO appointments (appointment_id, patient_id, starts_at, status) VALUES (?, ?, ?, ?)',
    );
    for (let id = 1; id <= 6; id += 1) insert.run(id, id, iso(T0 + 10 * MINUTE), 'scheduled');

    await makeRule({
      trigger: {
        kind: 'schedule',
        connectionId,
        schedule: { kind: 'interval', everyMinutes: '60' },
        forEach: {
          table: 'main.appointments',
          once: true,
          where: [
            { left: { field: 'starts_at' }, op: 'within_next', right: { amount: 2, unit: 'hours' } },
          ],
        },
      },
      nextRunAt: T0,
    });

    const result = await scanDueSchedules({ ...scanDeps(), page: 2, cap: 4 });
    expect(result).toMatchObject({ runsStarted: 4, capped: 1 });
    const entries = await auditRepo(t.meta).list({ limit: 50 });
    expect(entries.filter((e) => e.action === 'automation.scan-capped')).toHaveLength(1);
  });

  it('the four relative operators each select the right rows', async () => {
    const insert = sqlite.prepare(
      'INSERT INTO appointments (appointment_id, patient_id, starts_at, status) VALUES (?, ?, ?, ?)',
    );
    insert.run(1, 1, iso(T0 - 5 * HOUR), 'scheduled'); // long past
    insert.run(2, 2, iso(T0 - 10 * MINUTE), 'scheduled'); // just past
    insert.run(3, 3, iso(T0 + 10 * MINUTE), 'scheduled'); // soon
    insert.run(4, 4, iso(T0 + 5 * HOUR), 'scheduled'); // far ahead

    const scan = async (op: string, amount: number, unit: string): Promise<number[]> => {
      const rule = await makeRule({
        trigger: {
          kind: 'schedule',
          connectionId,
          schedule: { kind: 'interval', everyMinutes: '60' },
          forEach: {
            table: 'main.appointments',
            once: true,
            where: [{ left: { field: 'starts_at' }, op, right: { amount, unit } } as never],
          },
        },
        nextRunAt: now,
      });
      await scanDueSchedules(scanDeps());
      const runs = await automationRunsRepo(t.meta).list({ since: T0 - 10 * HOUR, automationId: rule.id });
      return runs
        .map((run) => Number(run.triggerEvent.record?.pk['appointment_id']))
        .sort((a, b) => a - b);
    };

    expect(await scan('within_next', 1, 'hours')).toEqual([3]);
    expect(await scan('within_last', 1, 'hours')).toEqual([2]);
    expect(await scan('more_than_ago', 1, 'hours')).toEqual([1]);
    expect(await scan('more_than_ahead', 1, 'hours')).toEqual([4]);
  });

  it('binds an instant the way the column’s own values are spelled', () => {
    const column = { name: 'starts_at', logicalType: 'timestamptz' } as never;
    expect(boundValue(column, T0, 'sqlite')).toBe('2026-09-08T12:00:00.000Z');
    expect(boundValue(column, T0, 'postgres')).toBe('2026-09-08T12:00:00.000Z');
    const naive = { name: 'starts_at', logicalType: 'timestamp' } as never;
    expect(boundValue(naive, T0, 'sqlite')).toBe('2026-09-08T12:00:00.000Z');
    // A naive column carries the SERVER-LOCAL wall clock (crud/write-values.ts).
    expect(boundValue(naive, T0, 'postgres')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
