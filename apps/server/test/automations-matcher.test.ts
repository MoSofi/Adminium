// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The event seam and the matcher over the real HTTP path: a write through
 * `routes/data`, the bulk route and the public surface, and what the rule
 * engine hears.
 *
 * These are the assertions that would go quiet without noticing anything is
 * wrong, which is why they are here rather than as unit tests over the class:
 *
 *  - a write fires the rule ONCE, at the right time, with the right origin;
 *  - a rule's own write does not re-enter it, and a chain stops at three;
 *  - a dashboard create waits out the undo window, and an undo inside it
 *    cancels the run;
 *  - a bulk update of three rows is three EVENTS and still one audit row.
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
  type CreateAutomationInput,
  type AutomationTrigger,
  type EnqueueJobInput,
  type Job,
} from '@adminium/meta';

import { AutomationMatcher } from '../src/automations/matcher.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { UNDO_TTL_MS } from '../src/crud/undo.js';
import {
  makeAutomationsRegistry,
  seedAutomationsSqlite,
} from './automations-fixture.js';
import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';

const T0 = 1_750_000_000_000;

const GRAPH: AutomationGraph = {
  version: 1,
  nodes: [{ id: 'n1', kind: 'trigger', title: 'When a user signs up' }],
};

describe('42 — the event seam and the matcher', () => {
  let sqlite: BetterSqlite3.Database;
  let t: DataTestContext;
  let connectionId: string;
  let matcher: AutomationMatcher;
  let now: number;
  const enqueued: EnqueueJobInput[] = [];

  async function enqueue(input: EnqueueJobInput): Promise<Job> {
    enqueued.push(input);
    return jobsRepo(t.meta).enqueue({ ...input, kind: 'noop-progress' }, now);
  }

  beforeEach(async () => {
    now = T0;
    enqueued.length = 0;
    sqlite = seedAutomationsSqlite();
    // A placeholder so the matcher exists before the app that dispatches to it.
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
    for (const table of ['main.users', 'main.offer_claims', 'main.appointments']) {
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

  async function makeRule(patch: Partial<CreateAutomationInput> = {}): Promise<Automation> {
    const trigger: AutomationTrigger = {
      kind: 'record',
      event: 'created',
      connectionId,
      table: 'main.users',
      watch: true,
    };
    const rule = await automationsRepo(t.meta).create(
      { connectionId, name: 'Welcome new signups', trigger, graph: GRAPH, enabled: true, ...patch },
      now,
    );
    await matcher.refresh();
    return rule;
  }

  async function createUser(values: Record<string, unknown>): Promise<{ id: number; undoToken: string | null }> {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connectionId}/main.users`,
      headers: asUser(t.users.admin),
      payload: { values },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { id: number }; undoToken: string | null };
    return { id: body.data.id, undoToken: body.undoToken };
  }

  it('fires once for a dashboard create, delayed by the undo window (D7)', async () => {
    const rule = await makeRule();
    await createUser({ id: 1, email: 'jordan@acme.io', status: 'new' });

    const runs = await automationRunsRepo(t.meta).list({ since: T0 - 1000 });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      automationId: rule.id,
      status: 'pending',
      origin: 'dashboard',
      wakeAt: T0 + UNDO_TTL_MS,
    });
    // The trigger snapshot is masked at the boundary — `email` is PII.
    expect(runs[0]?.triggerEvent.snapshot?.['email']).toBeNull();
    expect(runs[0]?.triggerEvent.record?.pk).toEqual({ id: 1 });
    expect(enqueued[0]).toMatchObject({ runAt: T0 + UNDO_TTL_MS, maxAttempts: 1 });
  });

  it('does not fire a paused rule, or one on another table', async () => {
    await makeRule({ enabled: false });
    await createUser({ id: 1, email: 'a@acme.io' });
    expect(await automationRunsRepo(t.meta).list({ since: T0 - 1000 })).toHaveLength(0);

    await makeRule({
      trigger: {
        kind: 'record',
        event: 'created',
        connectionId,
        table: 'main.appointments',
        watch: true,
      },
    });
    await createUser({ id: 2, email: 'b@acme.io' });
    expect(await automationRunsRepo(t.meta).list({ since: T0 - 1000 })).toHaveLength(0);
  });

  it('honours the trigger’s `when` on the after-image', async () => {
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
    await createUser({ id: 1, email: 'a@acme.io', status: 'new' });
    expect(await automationRunsRepo(t.meta).list({ since: T0 - 1000 })).toHaveLength(0);

    // `is` compares case-insensitively (D18).
    await createUser({ id: 2, email: 'b@acme.io', status: 'Trial' });
    expect(await automationRunsRepo(t.meta).list({ since: T0 - 1000 })).toHaveLength(1);
  });

  it('fires an update rule only when the named column changes', async () => {
    await makeRule({
      trigger: {
        kind: 'record',
        event: 'updated',
        connectionId,
        table: 'main.users',
        watch: true,
        changedColumn: 'status',
      },
    });
    await createUser({ id: 1, email: 'a@acme.io', status: 'new', updated_at: '2026-09-08T10:00:00.000Z' });

    const patch = async (values: Record<string, unknown>) => {
      const res = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/data/${connectionId}/main.users/1`,
        headers: asUser(t.users.admin),
        payload: { values },
      });
      expect(res.statusCode).toBe(200);
    };

    await patch({ full_name: 'Jordan', updated_at: '2026-09-08T11:00:00.000Z' });
    expect(await automationRunsRepo(t.meta).list({ since: T0 - 1000 })).toHaveLength(0);

    await patch({ status: 'trial', updated_at: '2026-09-08T12:00:00.000Z' });
    const runs = await automationRunsRepo(t.meta).list({ since: T0 - 1000 });
    expect(runs).toHaveLength(1);
    // The occurrence key carries the change stamp, so a poller seeing the same
    // row a minute later collapses onto this run rather than making a second.
    expect(runs[0]?.dedupeKey).toContain('2026-09-08T12:00:00.000Z');
  });

  it('an undo inside the window skips the run it queued (D7)', async () => {
    await makeRule();
    const { undoToken } = await createUser({ id: 1, email: 'a@acme.io' });
    expect(undoToken).not.toBeNull();

    now = T0 + 10_000;
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/undo/${undoToken as string}`,
      headers: asUser(t.users.admin),
    });
    expect(res.statusCode).toBe(200);

    const runs = await automationRunsRepo(t.meta).list({ since: T0 - 1000 });
    expect(runs[0]).toMatchObject({ status: 'skipped', error: 'undone' });
  });

  it('a bulk update of three rows is three events and still ONE audit row (O7)', async () => {
    await makeRule({
      trigger: {
        kind: 'record',
        event: 'updated',
        connectionId,
        table: 'main.users',
        watch: false,
      },
    });
    for (const id of [1, 2, 3]) await createUser({ id, email: `u${id}@acme.io`, status: 'new' });

    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connectionId}/main.users/bulk`,
      headers: asUser(t.users.admin),
      payload: { action: 'update', ids: [1, 2, 3], values: { status: 'trial' } },
    });
    expect(res.statusCode).toBe(200);

    const runs = await automationRunsRepo(t.meta).list({ since: T0 - 1000 });
    expect(runs).toHaveLength(3);
    expect(runs.every((run) => run.origin === 'bulk')).toBe(true);
    // Bulk origin has no undo window — the token restores the rows wholesale.
    expect(runs.every((run) => run.wakeAt === null)).toBe(true);

    const entries = await auditRepo(t.meta).list({ limit: 100 });
    const bulkRows = entries.filter((e) => e.action === 'record.bulk-update');
    expect(bulkRows).toHaveLength(1);
    expect(bulkRows[0]?.changes).toMatchObject({ after: { requested: 3, succeeded: 3 } });
  });

  it('a rule never re-enters on its own write, and a chain stops at three hops', async () => {
    const rule = await makeRule({
      trigger: { kind: 'record', event: 'created', connectionId, table: 'main.users', watch: false },
    });
    const view = await loadSnapshotView(t.meta, connectionId);
    const users = view.table('main.users');
    const entity = {
      connectionId,
      table: 'main.users',
      pk: { id: 9 },
      label: '9',
    };
    const row = { id: 9, email: 'x@acme.io' };

    // The rule's own write.
    await matcher.onRecordEvent({
      connectionId,
      table: users,
      action: 'create',
      entity,
      before: null,
      after: row,
      origin: 'automation',
      ruleId: rule.id,
      hops: 1,
    });
    expect(await automationRunsRepo(t.meta).list({ since: T0 - 1000 })).toHaveLength(0);

    // Another rule's write at the ceiling: refused, with exactly one audit row.
    await matcher.onRecordEvent({
      connectionId,
      table: users,
      action: 'create',
      entity,
      before: null,
      after: row,
      origin: 'automation',
      ruleId: 'auto_other',
      hops: 4,
    });
    expect(await automationRunsRepo(t.meta).list({ since: T0 - 1000 })).toHaveLength(0);
    const entries = await auditRepo(t.meta).list({ limit: 100 });
    expect(entries.filter((e) => e.action === 'automation.loop-refused')).toHaveLength(1);

    // One hop below the ceiling still runs — the guard is a ceiling, not a ban.
    await matcher.onRecordEvent({
      connectionId,
      table: users,
      action: 'create',
      entity,
      before: null,
      after: row,
      origin: 'automation',
      ruleId: 'auto_other',
      hops: 3,
    });
    expect(await automationRunsRepo(t.meta).list({ since: T0 - 1000 })).toHaveLength(1);
  });
});
