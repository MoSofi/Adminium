// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The step a document mapping writes into its own rule.
 *
 * `documents/trigger-sync.ts` on the server saves a rule whose one step is
 * `document.render`. The picker never offers that step, so no test that
 * builds a rule the way a person does ever held one — and the first rule
 * that did took the whole Automations page down with it. These cases hold
 * the rule the server writes, and a step no build knows yet.
 */

import { describe, expect, it } from 'vitest';

import { automationIcon } from '../icons.js';
import type { Action, ActionNode } from './graph.js';
import { insert } from './ops.js';
import { subLineFor } from './summaries.js';
import { isActionComplete, isNodeComplete } from './validate.js';
import { ACTION_STEPS, iconForNode } from './vocabulary.js';

const draw: ActionNode = {
  id: 'draw',
  kind: 'action',
  title: 'Invoice',
  sub: null,
  onError: false,
  action: { kind: 'document.render', profileId: 'prof_1' },
};

describe('a document mapping’s step', () => {
  it('has an icon of its own', () => {
    const name = iconForNode('action', draw.action);
    expect(name).toBe('file-text');
    expect(automationIcon(name)).toBeDefined();
  });

  it('has a sentence, and counts as complete', () => {
    expect(subLineFor(draw, null)).toBe('Draws a document');
    expect(isNodeComplete(draw)).toBe(true);
  });
});

describe('a step this build does not know', () => {
  const unknown = { kind: 'sms.send', to: '+15550100' } as unknown as Action;

  it('draws with the action’s own icon instead of throwing', () => {
    const name = iconForNode('action', unknown);
    expect(typeof name).toBe('string');
    expect(() => automationIcon(name)).not.toThrow();
  });

  it('has an empty sentence and is left to the server to judge', () => {
    expect(subLineFor({ ...draw, action: unknown }, null)).toBe('');
    expect(isActionComplete(unknown)).toBe(true);
  });
});

describe('a new step’s second line', () => {
  it('follows what the step does, instead of keeping the picker’s hint', () => {
    const create = ACTION_STEPS.find((step) => step.action?.kind === 'record.create')!;
    const { graph, nodeId } = insert({ nodes: [{ id: 'trigger', kind: 'trigger', title: 'When' }] } as never, { index: 1 }, create);
    const node = graph.nodes.find((candidate) => candidate.id === nodeId) as ActionNode;
    expect(subLineFor(node, null)).toBe('Table · pick one');
    // A table and a value are picked: the card says so.
    const filled: ActionNode = { ...node, action: { kind: 'record.create', table: 'main.orders', values: { status: 'paid' } } };
    expect(subLineFor(filled, null)).not.toContain('pick one');
    expect(subLineFor(filled, null)).toContain('1 values');
  });
});
