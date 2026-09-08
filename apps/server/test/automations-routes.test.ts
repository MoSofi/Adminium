// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/automations` and `/automation-runs` (42-automations-and-workflow-logs.md
 * §3.1, §5, 42-T14, 42-T15).
 *
 * The two properties worth defending hardest:
 *
 *  - D2. A rule executes as the system principal, so the SAVE is the only
 *    place authority is checked. A user who cannot update a table must not be
 *    able to write a rule that updates it, and the 403 must name the table.
 *  - D12. A half-built rule saves; it just cannot be switched on. The 422
 *    names the first unfinished step, which is what the card toggle's snap
 *    back and its toast are built on.
 */

import BetterSqlite3 from 'better-sqlite3';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  automationRunsRepo,
  automationsRepo,
  emailTemplatesRepo,
  type AutomationGraph,
  type AutomationTrace,
  type AutomationTrigger,
  type EnqueueJobInput,
  type Job,
  jobsRepo,
  permissionsRepo,
} from '@adminium/meta';

import { automationsRoutes } from '../src/routes/automations/index.js';
import { automationRunsRoutes } from '../src/routes/automations/runs.js';
import { PERMISSIONS } from '../src/rbac/permissions.js';
import { makeAutomationsRegistry, seedAutomationsSqlite } from './automations-fixture.js';
import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';
import { TEST_SECRET } from './helpers.js';

const T0 = Date.UTC(2026, 8, 8, 12, 0, 0);

const TRIGGER = (connectionId: string): AutomationTrigger => ({
  kind: 'record',
  event: 'created',
  connectionId,
  table: 'main.users',
  watch: true,
});

/** Trigger + one CONFIGURED email step — the complete shape. */
function completeGraph(): AutomationGraph {
  return {
    version: 1,
    nodes: [
      { id: 'n1', kind: 'trigger', title: 'When a user signs up' },
      {
        id: 'n2',
        kind: 'action',
        title: 'Send welcome email',
        onError: false,
        action: { kind: 'email', templateKey: 'welcome', to: { kind: 'field', column: 'email' } },
      },
    ],
  };
}

/** What the New-rule modal actually creates: an action with nothing set. */
function draftGraph(): AutomationGraph {
  return {
    version: 1,
    nodes: [
      { id: 'n1', kind: 'trigger', title: 'When a user signs up' },
      {
        id: 'n2',
        kind: 'action',
        title: 'Send email',
        onError: false,
        action: { kind: 'email', templateKey: null, to: null },
      },
    ],
  };
}

describe('42 — the automations routes', () => {
  let sqlite: BetterSqlite3.Database;
  let t: DataTestContext;
  let connectionId: string;
  let now: number;
  let rebuilds = 0;

  async function enqueue(input: EnqueueJobInput): Promise<Job> {
    return jobsRepo(t.meta).enqueue({ ...input, kind: 'noop-progress' }, now);
  }

  beforeEach(async () => {
    now = T0;
    rebuilds = 0;
    sqlite = seedAutomationsSqlite();
    t = await buildDataTestApp({
      registry: makeAutomationsRegistry(sqlite),
      now: () => now,
      extraRoutes: async (api, ctx) => {
        await api.register(
          automationsRoutes({
            meta: ctx.meta,
            manager: ctx.manager,
            secret: TEST_SECRET,
            enqueue,
            now: () => now,
            onRulesChanged: () => {
              rebuilds += 1;
            },
          }) as never,
        );
        await api.register(automationRunsRoutes({ meta: ctx.meta, now: () => now }) as never);
      },
    });
    connectionId = await createConnectionViaApi(t, 'sqlite:/tmp/fixture.db', 'fixture', 'sqlite');
    await introspectViaApi(t, connectionId);

    // The admin authors rules; the editor may read users but not update them.
    await t.grantTable(t.roles.admin, connectionId, 'main.users', {
      read: true,
      create: true,
      update: true,
      delete: true,
    });
    await t.grantTable(t.roles.editor, connectionId, 'main.users', { read: true });
    for (const role of [t.roles.admin, t.roles.editor]) {
      await grantSystem(role.id, PERMISSIONS.automationsManage);
    }
    await emailTemplatesRepo(t.meta).upsert('welcome', 'en_US', {
      name: 'Welcome',
      subject: 'Welcome',
      enabled: true,
      blocks: [{ id: 'b1', block: 'email.text', data: { text: 'Hi.' } }],
    } as never);

    sqlite
      .prepare('INSERT INTO users (id, email, full_name, created_at) VALUES (?, ?, ?, ?)')
      .run(7, 'jordan@acme.io', 'Jordan Ellis', new Date(T0).toISOString());
  });

  /** `system:automations:manage` → the `automations.manage` system grant. */
  async function grantSystem(roleId: string, permission: string): Promise<void> {
    const [, area, verb] = permission.split(':');
    await permissionsRepo(t.meta).grant(roleId, 'system', `${String(area)}.${String(verb)}`, {
      allowed: true,
    });
  }

  afterEach(async () => {
    await t.app.close();
    sqlite.close();
  });

  const asAdmin = () => asUser(t.users.admin);

  async function post(
    url: string,
    payload: Record<string, unknown>,
    headers = asAdmin(),
  ): Promise<LightMyRequestResponse> {
    return t.app.inject({ method: 'POST', url: `/api/v1${url}`, headers, payload });
  }
  async function get(url: string, headers = asAdmin()): Promise<LightMyRequestResponse> {
    return t.app.inject({ method: 'GET', url: `/api/v1${url}`, headers });
  }
  async function patch(
    url: string,
    payload: Record<string, unknown>,
    headers = asAdmin(),
  ): Promise<LightMyRequestResponse> {
    return t.app.inject({ method: 'PATCH', url: `/api/v1${url}`, headers, payload });
  }

  it('refuses every route without system:automations:manage', async () => {
    const res = await get('/automations', asUser(t.users.viewer));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('creates a complete rule enabled, and an incomplete one PAUSED (D12)', async () => {
    const live = await post('/automations', {
      name: 'Welcome new signups',
      connectionId,
      trigger: TRIGGER(connectionId),
      graph: completeGraph(),
      enabled: true,
    });
    expect(live.statusCode).toBe(201);
    expect(live.json()).toMatchObject({ enabled: true, valid: true, incompleteNodeId: null });

    const draft = await post('/automations', {
      name: 'Half built',
      connectionId,
      trigger: TRIGGER(connectionId),
      graph: draftGraph(),
      // "Enable immediately" was on, and the reply tells the truth instead.
      enabled: true,
    });
    expect(draft.statusCode).toBe(201);
    expect(draft.json()).toMatchObject({ enabled: false, valid: false, incompleteNodeId: 'n2' });
    // Every rule write rebuilds the matcher's index.
    expect(rebuilds).toBe(2);
  });

  it('refuses to switch an incomplete rule on, naming the step (D12)', async () => {
    const created = await post('/automations', {
      name: 'Half built',
      connectionId,
      trigger: TRIGGER(connectionId),
      graph: draftGraph(),
      enabled: false,
    });
    const id = (created.json() as { id: string }).id;

    const res = await patch(`/automations/${id}`, { enabled: true });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      error: { code: 'AUTOMATION_INCOMPLETE', details: { nodeId: 'n2', nodeTitle: 'Send email' } },
    });
    expect((await automationsRepo(t.meta).findById(id))?.enabled).toBe(false);
  });

  it('refuses a save whose author cannot write the table it writes (D2)', async () => {
    const graph: AutomationGraph = {
      version: 1,
      nodes: [
        { id: 'n1', kind: 'trigger', title: 'Trigger' },
        {
          id: 'n2',
          kind: 'action',
          title: 'Mark them welcomed',
          onError: false,
          action: { kind: 'record.update', values: { status: 'welcomed' } },
        },
      ],
    };
    const res = await post(
      '/automations',
      { name: 'Editor rule', connectionId, trigger: TRIGGER(connectionId), graph, enabled: false },
      asUser(t.users.editor),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: { code: 'TABLE_FORBIDDEN', details: { table: 'main.users' } },
    });
    // The admin, who holds update, saves the same rule fine.
    expect(
      (
        await post('/automations', {
          name: 'Admin rule',
          connectionId,
          trigger: TRIGGER(connectionId),
          graph,
          enabled: false,
        })
      ).statusCode,
    ).toBe(201);
  });

  it('refuses the §5 shapes that need a schema', async () => {
    const record = TRIGGER(connectionId) as Extract<AutomationTrigger, { kind: 'record' }>;
    const cases: { graph?: AutomationGraph; trigger?: AutomationTrigger; expect: string }[] = [
      {
        trigger: { ...record, table: 'main.nope' },
        expect: 'does not exist',
      },
      {
        trigger: { ...record, when: [{ left: { field: 'no_such_column' }, op: 'is', right: 'x' }] },
        expect: 'has no column',
      },
      {
        trigger: {
          ...record,
          when: [
            { left: { field: 'full_name' }, op: 'within_next', right: { amount: 2, unit: 'hours' } },
          ],
        },
        expect: 'not a date column',
      },
      {
        graph: {
          version: 1,
          nodes: [
            { id: 'n1', kind: 'trigger', title: 'Trigger' },
            {
              id: 'n2',
              kind: 'action',
              title: 'Send email',
              onError: false,
              action: { kind: 'email', templateKey: 'ghost', to: { kind: 'field', column: 'email' } },
            },
          ],
        },
        expect: 'no live email template',
      },
      {
        graph: {
          version: 1,
          nodes: [
            { id: 'n1', kind: 'trigger', title: 'Trigger' },
            {
              id: 'n2',
              kind: 'action',
              title: 'Write a secret',
              onError: false,
              action: { kind: 'record.update', values: { email: 'x@y.z' } },
            },
          ],
        },
        expect: 'protected column',
      },
      {
        graph: {
          version: 1,
          nodes: [
            { id: 'n1', kind: 'trigger', title: 'Trigger' },
            {
              id: 'n2',
              kind: 'action',
              title: 'Slack',
              onError: false,
              action: {
                kind: 'webhook',
                url: 'https://example.test/hook',
                method: 'POST',
                bodyKind: 'slack',
                body: 'hi',
                headerName: null,
                headerValueEncrypted: null,
              },
            },
          ],
        },
        expect: 'hooks.slack.com',
      },
    ];
    for (const testCase of cases) {
      const res = await post('/automations', {
        name: 'Refused',
        connectionId,
        trigger: testCase.trigger ?? TRIGGER(connectionId),
        graph: testCase.graph ?? completeGraph(),
        enabled: false,
      });
      expect(res.statusCode, testCase.expect).toBe(422);
      expect(res.json()).toMatchObject({ error: { message: expect.stringContaining(testCase.expect) } });
    }
  });

  it('duplicates paused, deletes with its runs, and renames', async () => {
    const created = await post('/automations', {
      name: 'Welcome new signups',
      connectionId,
      trigger: TRIGGER(connectionId),
      graph: completeGraph(),
      enabled: true,
    });
    const id = (created.json() as { id: string }).id;

    const copy = await post(`/automations/${id}/duplicate`, {});
    expect(copy.statusCode).toBe(201);
    expect(copy.json()).toMatchObject({ name: 'Welcome new signups (copy)', enabled: false });

    expect((await patch(`/automations/${id}`, { name: 'Renamed' })).json()).toMatchObject({
      name: 'Renamed',
    });

    const runs = automationRunsRepo(t.meta);
    const run = await runs.begin(
      {
        automationId: id,
        dedupeKey: 'k',
        origin: 'watch',
        triggerEvent: {
          event: 'record.created',
          origin: 'watch',
          hops: 0,
          record: { connectionId, table: 'main.users', pk: { id: 7 }, label: '7' },
          snapshot: null,
          occurredAt: T0,
        },
      },
      T0,
    );
    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/automations/${id}`,
      headers: asAdmin(),
    });
    expect(res.statusCode).toBe(200);
    expect(await runs.findById(run?.id ?? '')).toBeNull();
  });

  it('the dry run executes nothing and reports the path it took (D14)', async () => {
    const created = await post('/automations', {
      name: 'Welcome new signups',
      connectionId,
      trigger: TRIGGER(connectionId),
      graph: completeGraph(),
      enabled: true,
    });
    const id = (created.json() as { id: string }).id;

    const res = await post(`/automations/${id}/test`, {
      trigger: TRIGGER(connectionId),
      graph: completeGraph(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { trace: AutomationTrace; sample: { pk: Record<string, unknown> } };
    expect(body.sample.pk).toEqual({ id: 7 });
    expect(body.trace.steps[1]?.log).toContain('Would send');
    // The dry run creates no run row: Test is not an execution.
    expect(await automationRunsRepo(t.meta).list({ since: T0 - 1000 })).toHaveLength(0);
  });

  it('the dry run refuses when the trigger table is empty', async () => {
    sqlite.prepare('DELETE FROM users').run();
    const created = await post('/automations', {
      name: 'Welcome new signups',
      connectionId,
      trigger: TRIGGER(connectionId),
      graph: completeGraph(),
      enabled: false,
    });
    const id = (created.json() as { id: string }).id;
    const res = await post(`/automations/${id}/test`, {
      trigger: TRIGGER(connectionId),
      graph: completeGraph(),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'NO_SAMPLE_RECORD' } });
  });

  it('offers sources with the watch columns and the caller’s own grants', async () => {
    const res = await get('/automations/sources');
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      connections: {
        tables: {
          id: string;
          canUpdate: boolean;
          watch: { created: string | null; updated: string | null };
          columns: { name: string; pii: boolean; dateLike: boolean }[];
        }[];
      }[];
      templates: { key: string }[];
    };
    const users = body.connections[0]?.tables.find((table) => table.id === 'main.users');
    expect(users?.watch).toEqual({ created: 'created_at', updated: 'updated_at' });
    expect(users?.canUpdate).toBe(true);
    expect(users?.columns.find((c) => c.name === 'email')?.pii).toBe(true);
    expect(users?.columns.find((c) => c.name === 'created_at')?.dateLike).toBe(true);
    expect(body.templates.map((row) => row.key)).toContain('welcome');

    // The editor sees the same tables with `canUpdate` false — the select can
    // grey the option rather than letting a save 403 later.
    const asEditor = await get('/automations/sources', asUser(t.users.editor));
    const editorUsers = (asEditor.json() as typeof body).connections[0]?.tables.find(
      (table) => table.id === 'main.users',
    );
    expect(editorUsers?.canUpdate).toBe(false);
  });

  it('lists runs newest-first in a seven-day window with the three filter counts', async () => {
    const rule = await automationsRepo(t.meta).create(
      {
        connectionId,
        name: 'Welcome new signups',
        enabled: true,
        trigger: TRIGGER(connectionId),
        graph: completeGraph(),
      },
      T0,
    );
    const runs = automationRunsRepo(t.meta);
    const trace: AutomationTrace = { version: 1, steps: [], resume: null };
    const event = {
      event: 'record.created' as const,
      origin: 'watch' as const,
      hops: 0,
      record: { connectionId, table: 'main.users', pk: { id: 7 }, label: '7' },
      snapshot: null,
      occurredAt: T0,
    };
    const add = async (key: string, ageMs: number, status: 'succeeded' | 'failed' | null) => {
      const run = await runs.begin(
        { automationId: rule.id, dedupeKey: key, origin: 'watch', triggerEvent: event },
        T0 - ageMs,
      );
      if (run === null) throw new Error('expected a run');
      if (status !== null) {
        await runs.start(run.id);
        await runs.finish(run.id, { status, trace, durationMs: 20 }, T0 - ageMs + 5);
      }
      return run.id;
    };
    const ok = await add('a', 1000, 'succeeded');
    const bad = await add('b', 2000, 'failed');
    const pending = await add('c', 500, null);
    // Outside the seven-day window: never listed, never counted.
    await add('d', 8 * 86_400_000, 'succeeded');

    const res = await get('/automation-runs');
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      runs: { id: string; ruleName: string; trigger: string }[];
      counts: { all: number; success: number; failed: number; running: number };
      cursor: { next: string | null };
    };
    expect(body.runs.map((run) => run.id)).toEqual([pending, ok, bad]);
    expect(body.runs[0]?.ruleName).toBe('Welcome new signups');
    expect(body.runs[0]?.trigger).toBe('record created');
    expect(body.counts).toEqual({ all: 3, success: 1, failed: 1, running: 1 });
    expect(body.cursor.next).toBeNull();

    const failed = await get('/automation-runs?status=failed');
    expect((failed.json() as typeof body).runs.map((run) => run.id)).toEqual([bad]);

    const detail = await get(`/automation-runs/${bad}`);
    expect(detail.json()).toMatchObject({ run: { id: bad, status: 'failed', durationMs: 20 } });

    const stats = await get('/automation-runs/stats?tz=UTC');
    expect(stats.json()).toMatchObject({ runsToday: 3, failedToday: 1, avgDurationMsToday: 20 });
  });
});
