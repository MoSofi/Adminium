// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A webhook step's header value is a secret at rest and on the wire.
 *
 * - saved as `headerValue`, it is stored sealed and every reply says only
 *   `headerValueSet`;
 * - a save that sends no new value keeps the stored one for that step, a new
 *   value replaces it, and clearing the header name drops it;
 * - plain text from an API client that predates `headerValue` is sealed too;
 * - the request that goes out carries the value, opened;
 * - a value stored in plain text before any of this is sealed at boot, once,
 *   without touching the rule's `updatedAt`.
 */
import BetterSqlite3 from 'better-sqlite3';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  automationsRepo,
  permissionsRepo,
  type AutomationGraph,
  type AutomationTrigger,
  type EnqueueJobInput,
  type Job,
  jobsRepo,
} from '@adminium/meta';

import { decryptSecret, isEncryptedSecret } from '../src/config/secrets.js';
import { planWebhook, webhookSecretKey } from '../src/automations/actions/webhook.js';
import { sealStoredWebhookSecrets } from '../src/automations/webhook-secrets.js';
import { automationsRoutes } from '../src/routes/automations/index.js';
import { PERMISSIONS } from '../src/rbac/permissions.js';
import { makeAutomationsRegistry, seedAutomationsSqlite } from './automations-fixture.js';
import { asUser, buildDataTestApp, createConnectionViaApi, introspectViaApi, type DataTestContext } from './connections-helpers.js';
import { TEST_SECRET } from './helpers.js';

const T0 = Date.UTC(2026, 8, 8, 12, 0, 0);

const TRIGGER = (connectionId: string): AutomationTrigger => ({
  kind: 'record',
  event: 'created',
  connectionId,
  table: 'main.users',
  watch: true,
});

type Hook = Record<string, unknown>;

function hookGraph(hook: Hook): AutomationGraph {
  return {
    version: 1,
    nodes: [
      { id: 'n1', kind: 'trigger', title: 'When a user signs up' },
      {
        id: 'n2',
        kind: 'action',
        title: 'Call the CRM',
        onError: false,
        action: {
          kind: 'webhook',
          url: 'https://crm.example.test/hook',
          method: 'POST',
          bodyKind: 'json',
          body: null,
          headerName: 'Authorization',
          headerValueEncrypted: null,
          ...hook,
        },
      },
    ],
  } as AutomationGraph;
}

type WebhookStep = { action: { headerValueEncrypted: string | null; headerValueSet?: boolean; headerValue?: string } };
const stepOf = (graph: AutomationGraph): WebhookStep['action'] => (graph.nodes[1] as unknown as WebhookStep).action;
const open = (sealed: string | null) => (sealed === null ? null : decryptSecret(sealed, webhookSecretKey(TEST_SECRET)));

describe('webhook header values', () => {
  let sqlite: BetterSqlite3.Database;
  let t: DataTestContext;
  let connectionId: string;

  beforeEach(async () => {
    sqlite = seedAutomationsSqlite();
    t = await buildDataTestApp({
      registry: makeAutomationsRegistry(sqlite),
      now: () => T0,
      extraRoutes: async (api, ctx) => {
        await api.register(
          automationsRoutes({
            meta: ctx.meta,
            manager: ctx.manager,
            secret: TEST_SECRET,
            enqueue: async (input: EnqueueJobInput): Promise<Job> => jobsRepo(ctx.meta).enqueue({ ...input, kind: 'noop-progress' }, T0),
            now: () => T0,
          }) as never,
        );
      },
    });
    connectionId = await createConnectionViaApi(t, 'sqlite:/tmp/fixture.db', 'fixture', 'sqlite');
    await introspectViaApi(t, connectionId);
    await t.grantTable(t.roles.admin, connectionId, 'main.users', { read: true });
    const [, area, verb] = PERMISSIONS.automationsManage.split(':');
    await permissionsRepo(t.meta).grant(t.roles.admin.id, 'system', `${String(area)}.${String(verb)}`, { allowed: true });
  });

  afterEach(async () => {
    await t.app.close();
    sqlite.close();
  });

  const send = (method: 'POST' | 'PATCH' | 'GET', url: string, payload?: Record<string, unknown>): Promise<LightMyRequestResponse> =>
    t.app.inject({ method, url: `/api/v1${url}`, headers: asUser(t.users.admin), ...(payload === undefined ? {} : { payload }) });

  async function create(hook: Hook): Promise<{ id: string; res: LightMyRequestResponse }> {
    const res = await send('POST', '/automations', {
      name: 'CRM',
      connectionId,
      trigger: TRIGGER(connectionId),
      graph: hookGraph(hook),
      enabled: false,
    });
    expect(res.statusCode, res.body).toBe(201);
    return { id: (res.json() as { id: string }).id, res };
  }
  const stored = async (id: string) => stepOf((await automationsRepo(t.meta).findById(id))!.graph);

  it('is stored sealed and never sent back', async () => {
    const { id, res } = await create({ headerValue: 'Bearer s3cret-token' });
    expect(res.body).not.toContain('s3cret-token');
    expect(stepOf((res.json() as { graph: AutomationGraph }).graph)).toMatchObject({ headerValueEncrypted: null, headerValueSet: true });
    const step = await stored(id);
    expect(isEncryptedSecret(step.headerValueEncrypted ?? '')).toBe(true);
    expect(open(step.headerValueEncrypted)).toBe('Bearer s3cret-token');
    expect(step).not.toHaveProperty('headerValue');
    expect(step).not.toHaveProperty('headerValueSet');
    for (const url of ['/automations', `/automations/${id}`]) {
      const read = await send('GET', url);
      expect(read.statusCode).toBe(200);
      expect(read.body).not.toContain('s3cret-token');
      expect(read.body).not.toContain(step.headerValueEncrypted);
    }
  });

  it('is kept by a save that sends none, replaced by a new one, dropped with the header name', async () => {
    const { id, res } = await create({ headerValue: 'first' });
    const sealed = (await stored(id)).headerValueEncrypted;
    // The editor saves back what it was given, with another field changed.
    const echoed = (res.json() as { graph: AutomationGraph }).graph;
    (echoed.nodes[1] as unknown as { action: { url: string } }).action.url = 'https://crm.example.test/v2';
    expect((await send('PATCH', `/automations/${id}`, { graph: echoed })).statusCode).toBe(200);
    expect((await stored(id)).headerValueEncrypted).toBe(sealed);

    await send('PATCH', `/automations/${id}`, { graph: hookGraph({ headerValue: 'second' }) });
    expect(open((await stored(id)).headerValueEncrypted)).toBe('second');

    await send('PATCH', `/automations/${id}`, { graph: hookGraph({ headerName: null }) });
    expect((await stored(id)).headerValueEncrypted).toBeNull();
  });

  it('seals plain text from a client that predates the write-only field', async () => {
    const { id } = await create({ headerValueEncrypted: 'legacy-plain' });
    expect(open((await stored(id)).headerValueEncrypted)).toBe('legacy-plain');
  });

  it('goes out opened', async () => {
    const { id } = await create({ headerValue: 'Bearer out' });
    const action = (await automationsRepo(t.meta).findById(id))!.graph.nodes[1] as unknown as { action: never };
    const plan = planWebhook(action.action, { tokens: {}, secret: TEST_SECRET, rule: { id, name: 'CRM' }, source: null, now: T0 } as never);
    expect(plan.headers['Authorization']).toBe('Bearer out');
  });

  it('stored in plain text before this, is sealed once at boot', async () => {
    const rules = automationsRepo(t.meta);
    const rule = await rules.create(
      {
        connectionId,
        name: 'Old',
        description: null,
        trigger: TRIGGER(connectionId),
        graph: hookGraph({ headerValueEncrypted: 'kept-in-the-clear' }),
        enabled: false,
        timeSavedMinutes: null,
        nextRunAt: null,
        createdBy: null,
      },
      T0 - 1000,
    );
    expect((await stored(rule.id)).headerValueEncrypted).toBe('kept-in-the-clear');
    expect(await sealStoredWebhookSecrets(t.meta, TEST_SECRET)).toBe(1);
    const after = await rules.findById(rule.id);
    expect(open(stepOf(after!.graph).headerValueEncrypted)).toBe('kept-in-the-clear');
    expect(after!.updatedAt).toBe(rule.updatedAt);
    expect(await sealStoredWebhookSecrets(t.meta, TEST_SECRET)).toBe(0);
  });
});
