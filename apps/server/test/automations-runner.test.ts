// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The runner (…), walked over the OWNER'S FIRST EXAMPLE (Appendix C.1) with
 * the waits shortened to seconds: welcome → wait → offer → wait → did they
 * claim it? → the beneficiary row or the final reminder.
 *
 * The standing rule is that if a change makes either of the owner's
 * examples inexpressible, the change is wrong. This is where that gets
 * noticed for the first one.
 */

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  automationsRepo,
  emailTemplatesRepo,
  settingsRepo,
  type Automation,
  type AutomationGraph,
  type AutomationTriggerEvent,
} from '@adminium/meta';

import { walkRule, type RunOutcome } from '../src/automations/runner.js';
import { HookRejectedError, createWriteService, type RecordHooks } from '../src/crud/write-service.js';
import { encryptSecret } from '../src/config/secrets.js';
import { emailSecretKey } from '../src/email/config.js';
import type { EmailTransport, OutboundEmail } from '../src/email/types.js';
import { makeAutomationsRegistry, seedAutomationsSqlite } from './automations-fixture.js';
import {
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';

const T0 = Date.UTC(2026, 8, 8, 12, 0, 0);
const SECRET = 'test-secret-value-for-automations-0000';

const iso = (at: number): string => new Date(at).toISOString();

/** Appendix C.1, with the two waits shortened so a test can walk them. */
function welcomeGraph(): AutomationGraph {
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
      { id: 'n3', kind: 'wait', title: 'Wait 2 days', amount: 2, unit: 'minutes' },
      {
        id: 'n4',
        kind: 'action',
        title: 'Send the special offer',
        onError: false,
        action: {
          kind: 'email',
          templateKey: 'special-offer',
          to: { kind: 'field', column: 'email' },
        },
      },
      { id: 'n5', kind: 'wait', title: 'Wait a week', amount: 7, unit: 'minutes' },
      {
        id: 'n6',
        kind: 'branch',
        title: 'Did they claim it?',
        condition: {
          left: {
            count: { table: 'main.offer_claims', matchColumn: 'user_id', equalsField: 'id' },
          },
          op: 'gt',
          right: 0,
        },
        branches: [
          {
            id: 'n6a',
            label: 'Claimed',
            nodes: [
              {
                id: 'n7',
                kind: 'action',
                title: 'Record the beneficiary',
                onError: false,
                action: {
                  kind: 'record.create',
                  table: 'main.special_offer_beneficiaries',
                  values: { user_id: '{{record.id}}', claimed_at: { now: true } },
                },
              },
            ],
          },
          {
            id: 'n6b',
            label: 'Otherwise',
            nodes: [
              {
                id: 'n8',
                kind: 'action',
                title: 'Send the final reminder',
                onError: false,
                action: {
                  kind: 'email',
                  templateKey: 'offer-final-reminder',
                  to: { kind: 'field', column: 'email' },
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('42 — the runner walks the owner’s first example', () => {
  let sqlite: BetterSqlite3.Database;
  let t: DataTestContext;
  let connectionId: string;
  let now: number;
  const sent: OutboundEmail[] = [];

  const transport: EmailTransport = {
    async send(message) {
      sent.push(message);
      return { response: '250 2.0.0 Ok: queued as 4B1C2' };
    },
  };

  beforeEach(async () => {
    now = T0;
    sent.length = 0;
    sqlite = seedAutomationsSqlite();
    t = await buildDataTestApp({ registry: makeAutomationsRegistry(sqlite), now: () => now });
    connectionId = await createConnectionViaApi(t, 'sqlite:/tmp/fixture.db', 'fixture', 'sqlite');
    await introspectViaApi(t, connectionId);

    // SMTP, so the email step does not fail loudly (D15's other half).
    await settingsRepo(t.meta).set('email.smtp', {
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      user: 'mailer',
      passEncrypted: encryptSecret('hunter2', emailSecretKey(SECRET)),
      from: 'Adminium <no-reply@example.test>',
    } as never);

    const templates = emailTemplatesRepo(t.meta);
    for (const [key, subject] of [
      ['welcome', 'Welcome'],
      ['special-offer', 'A special offer for you'],
      ['offer-final-reminder', 'Last chance for your offer'],
    ] as const) {
      await templates.upsert(key, 'en_US', {
        name: subject,
        subject,
        enabled: true,
        blocks: [{ id: 'b1', block: 'email.text', data: { text: 'Hello {{record.full_name}}.' } }],
      } as never);
    }

    sqlite
      .prepare(
        'INSERT INTO users (id, email, full_name, status, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(7, 'jordan@acme.io', 'Jordan Ellis', 'new', iso(T0));
  });

  afterEach(async () => {
    await t.app.close();
    sqlite.close();
  });

  async function makeRule(): Promise<Automation> {
    return automationsRepo(t.meta).create(
      {
        connectionId,
        name: 'Welcome new signups',
        enabled: true,
        trigger: {
          kind: 'record',
          event: 'created',
          connectionId,
          table: 'main.users',
          watch: true,
        },
        graph: welcomeGraph(),
      },
      now,
    );
  }

  function event(): AutomationTriggerEvent {
    return {
      event: 'record.created',
      origin: 'watch',
      ruleId: null,
      hops: 0,
      record: { connectionId, table: 'main.users', pk: { id: 7 }, label: '7' },
      snapshot: { id: 7, email: null },
      occurredAt: T0,
    };
  }

  function deps() {
    return {
      meta: t.meta,
      manager: t.manager,
      app: t.app as never,
      secret: SECRET,
      now: () => now,
      createTransport: () => transport,
    };
  }

  async function walk(rule: Automation, outcome: RunOutcome | null): Promise<RunOutcome> {
    return walkRule(deps(), {
      rule,
      runId: 'arun_test',
      event: event(),
      ...(outcome !== null && outcome.kind === 'waiting'
        ? { resume: outcome.trace.resume as number[], trace: outcome.trace }
        : {}),
    });
  }

  it('suspends at each wait, resumes, and takes the Otherwise branch with no claim', async () => {
    const rule = await makeRule();

    const first = await walk(rule, null);
    expect(first.kind).toBe('waiting');
    expect(sent.map((m) => m.subject)).toEqual(['Welcome']);
    // The SMTP reply IS the log line the comp draws (D15).
    expect(first.trace.steps[1]?.log).toBe('250 2.0.0 Ok: queued as 4B1C2 · delivered to jordan@acme.io');
    expect(first.trace.resume).toEqual([3]);

    now = T0 + 2 * 60_000;
    const second = await walk(rule, first);
    expect(second.kind).toBe('waiting');
    expect(sent.map((m) => m.subject)).toEqual(['Welcome', 'A special offer for you']);

    now = T0 + 9 * 60_000;
    const third = await walk(rule, second);
    expect(third.kind).toBe('finished');
    if (third.kind !== 'finished') throw new Error('expected a finished run');
    expect(third.status).toBe('succeeded');
    expect(sent.map((m) => m.subject)).toEqual([
      'Welcome',
      'A special offer for you',
      'Last chance for your offer',
    ]);
    const branch = third.trace.steps.find((step) => step.kind === 'branch');
    expect(branch?.log).toBe('took “Otherwise”');
    // Nothing was written to the beneficiaries table.
    const rows = sqlite.prepare('SELECT COUNT(*) AS n FROM special_offer_beneficiaries').get() as {
      n: number;
    };
    expect(rows.n).toBe(0);
  });

  it('takes the Claimed branch and creates the beneficiary row when a claim exists', async () => {
    const rule = await makeRule();
    sqlite
      .prepare('INSERT INTO offer_claims (claim_id, user_id, claimed_at) VALUES (?, ?, ?)')
      .run(1, 7, iso(T0));

    let outcome = await walk(rule, null);
    now = T0 + 2 * 60_000;
    outcome = await walk(rule, outcome);
    now = T0 + 9 * 60_000;
    outcome = await walk(rule, outcome);

    if (outcome.kind !== 'finished') throw new Error('expected a finished run');
    expect(outcome.status).toBe('succeeded');
    expect(sent.map((m) => m.subject)).toEqual(['Welcome', 'A special offer for you']);
    const branch = outcome.trace.steps.find((step) => step.kind === 'branch');
    expect(branch?.log).toBe('took “Claimed”');

    const row = sqlite
      .prepare('SELECT user_id, claimed_at FROM special_offer_beneficiaries')
      .get() as { user_id: number; claimed_at: string };
    // `{{record.id}}` resolved, and `{ now: true }` became a real timestamp.
    expect(row.user_id).toBe(7);
    expect(String(row.claimed_at)).not.toBe('');
    // The write was announced as the RULE's, so the audit trail names it and
    // another rule could react to it.
    expect(outcome.trace.steps.some((step) => step.log?.startsWith('created '))).toBe(true);
  });

  it('a record deleted mid-wait ends the run skipped, not failed', async () => {
    const rule = await makeRule();
    const first = await walk(rule, null);
    expect(first.kind).toBe('waiting');

    sqlite.prepare('DELETE FROM users WHERE id = ?').run(7);
    now = T0 + 2 * 60_000;
    const second = await walk(rule, first);
    if (second.kind !== 'finished') throw new Error('expected a finished run');
    expect(second.status).toBe('skipped');
    expect(second.trace.steps.at(-1)?.log).toBe('Record no longer exists');
  });

  it('a failed step fails the run and skips the rest unless it continues on error', async () => {
    const rule = await automationsRepo(t.meta).create(
      {
        connectionId,
        name: 'Broken',
        enabled: true,
        trigger: { kind: 'record', event: 'created', connectionId, table: 'main.users', watch: false },
        graph: {
          version: 1,
          nodes: [
            { id: 'n1', kind: 'trigger', title: 'Trigger' },
            {
              id: 'n2',
              kind: 'action',
              title: 'Send a missing template',
              onError: false,
              action: { kind: 'email', templateKey: 'no-such-template', to: { kind: 'field', column: 'email' } },
            },
            {
              id: 'n3',
              kind: 'action',
              title: 'Mark them',
              onError: false,
              action: { kind: 'record.update', values: { status: 'welcomed' } },
            },
          ],
        },
      },
      now,
    );
    const outcome = await walk(rule, null);
    if (outcome.kind !== 'finished') throw new Error('expected a finished run');
    expect(outcome.status).toBe('failed');
    expect(outcome.trace.steps[1]?.status).toBe('fail');
    expect(outcome.trace.steps[2]?.status).toBe('skip');
    expect(sqlite.prepare('SELECT status FROM users WHERE id = 7').get()).toMatchObject({
      status: 'new',
    });

    // The same rule with "Continue on error" runs the later step and STILL
    // reports a failed run (D9).
    const graph = rule.graph;
    const second = graph.nodes[1];
    if (second?.kind !== 'action') throw new Error('expected an action');
    second.onError = true;
    const patched = await automationsRepo(t.meta).update(rule.id, { graph }, now);
    if (patched === null) throw new Error('expected the rule to update');

    const retry = await walk(patched, null);
    if (retry.kind !== 'finished') throw new Error('expected a finished run');
    expect(retry.status).toBe('failed');
    expect(retry.trace.steps[2]?.status).toBe('ok');
    expect(sqlite.prepare('SELECT status FROM users WHERE id = 7').get()).toMatchObject({
      status: 'welcomed',
    });
  });

  it("a project hook's refusal fails the step with the hook's message, and its context says who wrote", async () => {
    const seen: unknown[] = [];
    const hooks: RecordHooks = {
      wants: (timing) => Promise.resolve(timing === 'before'),
      before: async (write) => {
        seen.push({ action: write.action, origin: write.context.origin, hops: write.context.hops, actor: write.context.actor });
        throw new HookRejectedError(`No ${write.action} from a rule.`, 'hooks/users.ts');
      },
      after: () => Promise.resolve(),
    };
    const rule = await automationsRepo(t.meta).create(
      {
        connectionId,
        name: 'Refused',
        enabled: true,
        trigger: { kind: 'record', event: 'created', connectionId, table: 'main.users', watch: false },
        graph: {
          version: 1,
          nodes: [
            { id: 'n1', kind: 'trigger', title: 'Trigger' },
            {
              id: 'n2',
              kind: 'action',
              title: 'Mark them',
              onError: true,
              action: { kind: 'record.update', values: { status: 'welcomed' } },
            },
            {
              id: 'n3',
              kind: 'action',
              title: 'Record the beneficiary',
              onError: false,
              action: {
                kind: 'record.create',
                table: 'main.special_offer_beneficiaries',
                values: { user_id: '{{record.id}}', claimed_at: { now: true } },
              },
            },
          ],
        },
      },
      now,
    );
    const outcome = await walkRule(
      { ...deps(), writes: createWriteService({ hooks: () => hooks }) },
      { rule, runId: 'arun_hooked', event: event() },
    );
    if (outcome.kind !== 'finished') throw new Error('expected a finished run');
    expect(outcome.status).toBe('failed');
    expect(outcome.trace.steps[1]).toMatchObject({ status: 'fail', log: 'No update from a rule.' });
    expect(outcome.trace.steps[2]).toMatchObject({ status: 'fail', log: 'No create from a rule.' });
    expect(sqlite.prepare('SELECT status FROM users WHERE id = 7').get()).toMatchObject({ status: 'new' });
    expect(seen).toEqual([
      { action: 'update', origin: 'automation', hops: 1, actor: { kind: 'automation', id: rule.id, label: 'Refused' } },
      { action: 'create', origin: 'automation', hops: 1, actor: { kind: 'automation', id: rule.id, label: 'Refused' } },
    ]);
  });

  it('a filter that does not match ends the run succeeded with the rest skipped (D18)', async () => {
    const rule = await automationsRepo(t.meta).create(
      {
        connectionId,
        name: 'Only trial users',
        enabled: true,
        trigger: { kind: 'record', event: 'created', connectionId, table: 'main.users', watch: false },
        graph: {
          version: 1,
          nodes: [
            { id: 'n1', kind: 'trigger', title: 'Trigger' },
            {
              id: 'n2',
              kind: 'condition',
              title: 'Only continue if',
              onError: false,
              condition: { left: { field: 'status' }, op: 'is', right: 'trial' },
            },
            {
              id: 'n3',
              kind: 'action',
              title: 'Send welcome email',
              onError: false,
              action: { kind: 'email', templateKey: 'welcome', to: { kind: 'field', column: 'email' } },
            },
          ],
        },
      },
      now,
    );
    const outcome = await walk(rule, null);
    if (outcome.kind !== 'finished') throw new Error('expected a finished run');
    expect(outcome.status).toBe('succeeded');
    expect(outcome.trace.steps[1]?.log).toBe('evaluated → false · stopped');
    expect(outcome.trace.steps[2]?.status).toBe('skip');
    expect(sent).toHaveLength(0);
  });

  it('a dry run resolves everything and performs nothing (D14)', async () => {
    const rule = await makeRule();
    const outcome = await walkRule(deps(), {
      rule,
      runId: 'arun_test',
      event: event(),
      dryRun: true,
    });
    if (outcome.kind !== 'finished') throw new Error('expected a finished run');
    expect(outcome.status).toBe('succeeded');
    expect(sent).toHaveLength(0);
    expect(outcome.trace.steps[1]?.log).toBe('Would send “Welcome” to jordan@acme.io');
    // A wait logs and continues, so the whole path is walked in one pass.
    expect(outcome.trace.steps[2]?.log).toBe('Would wait 2 minutes');
    expect(outcome.trace.steps.some((step) => step.log?.startsWith('Would set '))).toBe(false);
    const rows = sqlite.prepare('SELECT COUNT(*) AS n FROM special_offer_beneficiaries').get() as {
      n: number;
    };
    expect(rows.n).toBe(0);
  });
});
