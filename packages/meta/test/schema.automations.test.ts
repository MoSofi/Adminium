// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The stored shapes of a rule (42-automations-and-workflow-logs.md §3.2,
 * 42-T02). Two things are checked, and the split matters:
 *
 *  1. The OWNER'S OWN EXAMPLES parse. Appendix C writes his two asks —
 *     "welcome, then an offer, then a reminder" and the appointment
 *     reminder with its first-time / repeat no-show branch — as the rules
 *     the product will store. §0.4's standing rule is that if a later change
 *     makes either inexpressible, the change is wrong; this suite is what
 *     notices.
 *
 *  2. The §5 refusals that are SHAPE refuse here rather than three layers
 *     later. Everything that needs a schema to resolve against (does this
 *     table have that column? is that template live?) is deliberately NOT
 *     here — the store cannot know, and a draft is allowed to be half-built
 *     (D12).
 */
import { describe, expect, it } from 'vitest';

import {
  AUTOMATION_MAX_WAIT_MS,
  automationConditionSchema,
  automationDurationMs,
  automationGraphSchema,
  automationTraceSchema,
  automationTriggerEventSchema,
  automationTriggerSchema,
} from '../src/index.js';

// --- Appendix C.1 — welcome, offer, reminder --------------------------------

const C1_TRIGGER = {
  kind: 'record',
  event: 'created',
  connectionId: 'cnx_1',
  table: 'public.users',
  watch: true,
};

const C1_GRAPH = {
  version: 1,
  nodes: [
    { id: 'n1', kind: 'trigger', title: 'When a user signs up' },
    {
      id: 'n2',
      kind: 'action',
      title: 'Send welcome email',
      action: { kind: 'email', templateKey: 'welcome', to: { kind: 'field', column: 'email' } },
    },
    { id: 'n3', kind: 'wait', title: 'Wait 2 days', amount: 2, unit: 'days' },
    {
      id: 'n4',
      kind: 'action',
      title: 'Send the special offer',
      action: { kind: 'email', templateKey: 'special-offer', to: { kind: 'field', column: 'email' } },
    },
    { id: 'n5', kind: 'wait', title: 'Wait a week', amount: 7, unit: 'days' },
    {
      id: 'n6',
      kind: 'branch',
      title: 'Did they claim it?',
      condition: {
        left: {
          count: { table: 'public.offer_claims', matchColumn: 'user_id', equalsField: 'id' },
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
              action: {
                kind: 'record.create',
                table: 'public.special_offer_beneficiaries',
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

// --- Appendix C.2 / C.3 — the appointment pair ------------------------------

const C2_TRIGGER = {
  kind: 'schedule',
  connectionId: 'cnx_1',
  schedule: { kind: 'interval', everyMinutes: '15' },
  forEach: {
    table: 'public.appointments',
    once: true,
    where: [
      { left: { field: 'starts_at' }, op: 'within_next', right: { amount: 2, unit: 'hours' } },
      { left: { field: 'status' }, op: 'is', right: 'scheduled' },
    ],
  },
};

const C3_BRANCH_CONDITION = {
  left: {
    count: {
      table: 'public.appointments',
      matchColumn: 'patient_id',
      equalsField: 'patient_id',
      where: { left: { field: 'status' }, op: 'is', right: 'no_show' },
    },
  },
  op: 'gt',
  right: 1,
};

describe('automation stored shapes — the owner’s examples', () => {
  it('parses C.1: a record trigger with a watch, two waits and a related-count branch', () => {
    expect(automationTriggerSchema.parse(C1_TRIGGER)).toMatchObject({ kind: 'record', watch: true });
    const graph = automationGraphSchema.parse(C1_GRAPH);
    expect(graph.nodes).toHaveLength(6);
    const branch = graph.nodes[5];
    if (branch?.kind !== 'branch') throw new Error('expected a branch node');
    expect(branch.branches[0]?.label).toBe('Claimed');
    const create = branch.branches[0]?.nodes[0];
    if (create?.kind !== 'action' || create.action.kind !== 'record.create') {
      throw new Error('expected a record.create action');
    }
    // `{ now: true }` survives as a MARKER, not a resolved timestamp — three
    // dialects have three right answers and the runner picks one (D17).
    expect(create.action.values['claimed_at']).toEqual({ now: true });
  });

  it('parses C.2: an interval schedule with a for-each scan and a relative-time op', () => {
    const trigger = automationTriggerSchema.parse(C2_TRIGGER);
    if (trigger.kind !== 'schedule') throw new Error('expected a schedule trigger');
    expect(trigger.forEach?.once).toBe(true);
    expect(trigger.forEach?.where[0]).toMatchObject({
      op: 'within_next',
      right: { amount: 2, unit: 'hours' },
    });
  });

  it('parses C.3: a count over the SAME table narrowed by one more leaf', () => {
    const condition = automationConditionSchema.parse(C3_BRANCH_CONDITION);
    if (!('count' in condition.left)) throw new Error('expected a count condition');
    expect(condition.left.count.where?.right).toBe('no_show');
  });

  it('stores a half-built action — a draft is allowed to be incomplete (D12)', () => {
    const graph = automationGraphSchema.parse({
      version: 1,
      nodes: [
        { id: 'n1', kind: 'trigger', title: 'When a user signs up' },
        { id: 'n2', kind: 'action', title: 'Send email', action: { kind: 'email' } },
      ],
    });
    const node = graph.nodes[1];
    if (node?.kind !== 'action' || node.action.kind !== 'email') throw new Error('expected email');
    expect(node.action.templateKey).toBeNull();
    expect(node.action.to).toBeNull();
    expect(node.onError).toBe(false);
  });
});

describe('automation stored shapes — the §5 refusals that are shape', () => {
  const trigger = { id: 'n1', kind: 'trigger', title: 'T' };
  const stop = (id: string) => ({ id, kind: 'stop', title: 'Stop' });

  it('refuses a graph with no trigger, and one whose trigger is not first', () => {
    expect(automationGraphSchema.safeParse({ version: 1, nodes: [stop('a')] }).success).toBe(false);
    expect(
      automationGraphSchema.safeParse({ version: 1, nodes: [stop('a'), trigger] }).success,
    ).toBe(false);
  });

  it('refuses a second trigger', () => {
    const second = { id: 'n2', kind: 'trigger', title: 'T2' };
    expect(automationGraphSchema.safeParse({ version: 1, nodes: [trigger, second] }).success).toBe(
      false,
    );
  });

  it('refuses a duplicate node id, branch children included', () => {
    const graph = {
      version: 1,
      nodes: [
        trigger,
        {
          id: 'n2',
          kind: 'branch',
          title: 'B',
          condition: { left: { field: 'x' }, op: 'is', right: '1' },
          branches: [
            { id: 'b1', label: 'If matches', nodes: [stop('dup')] },
            { id: 'b2', label: 'Otherwise', nodes: [stop('dup')] },
          ],
        },
      ],
    };
    expect(automationGraphSchema.safeParse(graph).success).toBe(false);
  });

  it('refuses a branch inside a branch (comp 570)', () => {
    const nested = {
      id: 'inner',
      kind: 'branch',
      title: 'Inner',
      condition: { left: { field: 'x' }, op: 'is', right: '1' },
      branches: [
        { id: 'i1', label: 'a', nodes: [] },
        { id: 'i2', label: 'b', nodes: [] },
      ],
    };
    const graph = {
      version: 1,
      nodes: [
        trigger,
        {
          id: 'outer',
          kind: 'branch',
          title: 'Outer',
          condition: { left: { field: 'x' }, op: 'is', right: '1' },
          branches: [
            { id: 'o1', label: 'a', nodes: [nested] },
            { id: 'o2', label: 'b', nodes: [] },
          ],
        },
      ],
    };
    expect(automationGraphSchema.safeParse(graph).success).toBe(false);
  });

  it('refuses more than 40 steps', () => {
    const nodes = [trigger, ...Array.from({ length: 40 }, (_, i) => stop(`s${i}`))];
    expect(automationGraphSchema.safeParse({ version: 1, nodes }).success).toBe(false);
  });

  it('refuses a wait of zero and a wait past thirty days (D8 / O6)', () => {
    const wait = (amount: number, unit: string) => ({
      version: 1,
      nodes: [trigger, { id: 'w', kind: 'wait', title: 'Wait', amount, unit }],
    });
    expect(automationGraphSchema.safeParse(wait(0, 'days')).success).toBe(false);
    expect(automationGraphSchema.safeParse(wait(31, 'days')).success).toBe(false);
    expect(automationGraphSchema.safeParse(wait(30, 'days')).success).toBe(true);
    expect(automationGraphSchema.safeParse(wait(721, 'hours')).success).toBe(false);
    expect(automationDurationMs(30, 'days')).toBe(AUTOMATION_MAX_WAIT_MS);
  });

  it('refuses an operand whose shape does not match its operator', () => {
    const bad = [
      { left: { field: 'starts_at' }, op: 'within_next', right: '2 hours' },
      { left: { field: 'name' }, op: 'is', right: { amount: 2, unit: 'hours' } },
      { left: { field: 'name' }, op: 'is_empty', right: 'x' },
    ];
    for (const condition of bad) {
      expect(automationConditionSchema.safeParse(condition).success).toBe(false);
    }
    // Absent is "not filled in yet", which a draft may be.
    expect(automationConditionSchema.safeParse({ left: { field: '' }, op: 'is' }).success).toBe(true);
  });

  it('refuses an operator that cannot compare a count', () => {
    const count = { table: 't', matchColumn: 'a', equalsField: 'b' };
    expect(
      automationConditionSchema.safeParse({ left: { count }, op: 'contains', right: 'x' }).success,
    ).toBe(false);
    expect(automationConditionSchema.safeParse({ left: { count }, op: 'gt', right: 0 }).success).toBe(
      true,
    );
  });

  it('refuses a schedule time that is not HH:mm and a day-of-month past 28', () => {
    const make = (patch: Record<string, unknown>) => ({
      kind: 'schedule',
      connectionId: null,
      schedule: { kind: 'monthly', time: '09:00', dayOfMonth: 1, timezone: 'UTC', ...patch },
    });
    expect(automationTriggerSchema.safeParse(make({ time: '9:00' })).success).toBe(false);
    expect(automationTriggerSchema.safeParse(make({ time: '24:00' })).success).toBe(false);
    expect(automationTriggerSchema.safeParse(make({ dayOfMonth: 29 })).success).toBe(false);
    expect(automationTriggerSchema.safeParse(make({})).success).toBe(true);
  });
});

describe('run payloads', () => {
  it('defaults hops to zero and keeps a null record for a bare schedule tick', () => {
    const event = automationTriggerEventSchema.parse({
      event: 'schedule.tick',
      origin: 'schedule',
      record: null,
      snapshot: null,
      occurredAt: 1_750_000_000_000,
    });
    expect(event.hops).toBe(0);
    expect(event.record).toBeNull();
  });

  it('carries a resume path for a suspended run (D8)', () => {
    const trace = automationTraceSchema.parse({
      version: 1,
      steps: [
        {
          nodeId: 'n2',
          name: 'Send welcome email',
          kind: 'action',
          status: 'ok',
          startedAt: 1,
          durationMs: 12,
          log: '250 OK · delivered to jordan@acme.io',
        },
      ],
      resume: [3],
    });
    expect(trace.resume).toEqual([3]);
  });
});
