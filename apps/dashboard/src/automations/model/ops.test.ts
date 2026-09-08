// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The flow builder's edit operations (42-automations-and-workflow-logs.md
 * 42-T17), one case per rule the comp states (Automation Rules 405-449).
 *
 * These are the only part of the builder that can be checked without a DOM,
 * and they are where the comp's behaviour actually lives: a drag that lands
 * a node BEFORE its target, a branch that refuses to nest, a trigger that
 * never moves. A regression in any of them looks like a working page that
 * quietly builds the wrong rule.
 */

import { describe, expect, it } from 'vitest';

import { countSteps, locate, newId, type Graph } from './graph.js';
import {
  duplicate,
  insert,
  move,
  moveIntoBranch,
  moveTo,
  patchBranchLabel,
  patchCondition,
  remove,
  toggleOnError,
} from './ops.js';
import { firstIncompleteNode } from './validate.js';
import { ACTION_STEPS, LOGIC_STEPS } from './vocabulary.js';

function graph(): Graph {
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
      {
        id: 'n3',
        kind: 'branch',
        title: 'Did they claim it?',
        condition: { left: { field: 'status' }, op: 'is', right: 'trial' },
        branches: [
          {
            id: 'n3a',
            label: 'If matches',
            nodes: [{ id: 'n4', kind: 'stop', title: 'Stop workflow' }],
          },
          { id: 'n3b', label: 'Otherwise', nodes: [] },
        ],
      },
    ],
  };
}

const emailStep = ACTION_STEPS.find((step) => step.key === 'email');
const branchStep = LOGIC_STEPS.find((step) => step.key === 'branch');
const waitStep = LOGIC_STEPS.find((step) => step.key === 'wait');
if (emailStep === undefined || branchStep === undefined || waitStep === undefined) {
  throw new Error('the picker definitions moved');
}

describe('graph helpers', () => {
  it('counts branch children as steps (comp 388)', () => {
    expect(countSteps(graph().nodes)).toBe(4);
  });

  it('locates a node inside a branch and says it is in one', () => {
    const found = locate(graph(), 'n4');
    expect(found?.inBranch).toBe(true);
    expect(found?.node.title).toBe('Stop workflow');
  });

  it('never mints an id the graph already carries', () => {
    const id = newId(graph());
    expect(['n1', 'n2', 'n3', 'n3a', 'n3b', 'n4']).not.toContain(id);
  });
});

describe('insert (comp 405-417)', () => {
  it('inserts at an index and returns the new node for the inspector', () => {
    const result = insert(graph(), { index: 1 }, emailStep);
    expect(result.graph.nodes[1]?.id).toBe(result.nodeId);
    expect(result.graph.nodes[1]?.title).toBe('Send email');
    // The original is untouched — the page holds a draft (D11).
    expect(graph().nodes).toHaveLength(3);
  });

  it('never inserts before the trigger', () => {
    const result = insert(graph(), { index: 0 }, emailStep);
    expect(result.graph.nodes[0]?.kind).toBe('trigger');
    expect(result.graph.nodes[1]?.id).toBe(result.nodeId);
  });

  it('gives a new branch two branches and an EMPTY condition (Appendix B)', () => {
    const result = insert(graph(), { index: 3 }, branchStep);
    const node = result.graph.nodes[3];
    if (node?.kind !== 'branch') throw new Error('expected a branch');
    expect(node.branches.map((branch) => branch.label)).toEqual(['If matches', 'Otherwise']);
    // The comp seeds a worked example from its demo data; a rule that arrives
    // pre-filled with a condition nobody wrote quietly does the wrong thing.
    expect(node.condition).toEqual({ left: { field: '' }, op: 'is', right: '' });
  });

  it('inserts into a branch, and refuses to put a branch inside one', () => {
    const inside = insert(graph(), { index: 0, branchId: 'n3b' }, waitStep);
    const branchNode = inside.graph.nodes[2];
    if (branchNode?.kind !== 'branch') throw new Error('expected a branch');
    expect(branchNode.branches[1].nodes).toHaveLength(1);

    const nested = insert(graph(), { index: 0, branchId: 'n3b' }, branchStep);
    const untouched = nested.graph.nodes[2];
    if (untouched?.kind !== 'branch') throw new Error('expected a branch');
    expect(untouched.branches[1].nodes).toHaveLength(0);
  });
});

describe('remove, duplicate, move (comp 421-427)', () => {
  it('never removes the trigger', () => {
    expect(remove(graph(), 'n1').nodes).toHaveLength(3);
    expect(remove(graph(), 'n2').nodes).toHaveLength(2);
  });

  it('duplicates after the source and re-ids the copy, its branches and children', () => {
    const result = duplicate(graph(), 'n3');
    const copy = result.graph.nodes[3];
    if (copy?.kind !== 'branch') throw new Error('expected a branch copy');
    expect(copy.id).toBe(result.nodeId);
    expect(copy.branches[0].id).toBe(`${result.nodeId}a`);
    expect(copy.branches[0].nodes[0]?.id).toBe(`${result.nodeId}-0`);
    // The original's ids are untouched.
    expect(result.graph.nodes[2]?.id).toBe('n3');
  });

  it('moves within a list and never past the trigger', () => {
    expect(move(graph(), 'n2', 1).nodes.map((node) => node.id)).toEqual(['n1', 'n3', 'n2']);
    // Up would put it before the trigger.
    expect(move(graph(), 'n2', -1).nodes.map((node) => node.id)).toEqual(['n1', 'n2', 'n3']);
  });
});

describe('drag (comp 429-449)', () => {
  it('lands the dragged node BEFORE its target', () => {
    const moved = moveTo(graph(), 'n3', 'n2');
    expect(moved.nodes.map((node) => node.id)).toEqual(['n1', 'n3', 'n2']);
  });

  it('refuses to move the trigger, or onto it', () => {
    expect(moveTo(graph(), 'n1', 'n2').nodes.map((node) => node.id)).toEqual(['n1', 'n2', 'n3']);
    expect(moveTo(graph(), 'n2', 'n1').nodes.map((node) => node.id)).toEqual(['n1', 'n2', 'n3']);
  });

  it('refuses to drag a branch into a branch', () => {
    const moved = moveTo(graph(), 'n3', 'n4');
    expect(moved.nodes.map((node) => node.id)).toEqual(['n1', 'n2', 'n3']);
  });

  it('appends to a branch when dropped on its Add step', () => {
    const moved = moveIntoBranch(graph(), 'n2', 'n3b');
    expect(moved.nodes.map((node) => node.id)).toEqual(['n1', 'n3']);
    const branchNode = moved.nodes[1];
    if (branchNode?.kind !== 'branch') throw new Error('expected a branch');
    expect(branchNode.branches[1].nodes[0]?.id).toBe('n2');
  });

  it('refuses to drop a branch into a branch', () => {
    expect(moveIntoBranch(graph(), 'n3', 'n3b').nodes).toHaveLength(3);
  });
});

describe('inspector edits', () => {
  it('patches a branch label and a condition', () => {
    const labelled = patchBranchLabel(graph(), 'n3', 0, 'Claimed');
    const node = labelled.nodes[2];
    if (node?.kind !== 'branch') throw new Error('expected a branch');
    expect(node.branches[0].label).toBe('Claimed');

    const patched = patchCondition(graph(), 'n3', {
      left: { count: { table: 'public.offer_claims', matchColumn: 'user_id', equalsField: 'id' } },
      op: 'gt',
      right: 0,
    });
    const branch = patched.nodes[2];
    if (branch?.kind !== 'branch') throw new Error('expected a branch');
    expect('count' in branch.condition.left).toBe(true);
  });

  it('toggles continue-on-error on an action and leaves a wait alone', () => {
    const toggled = toggleOnError(graph(), 'n2');
    const node = toggled.nodes[1];
    if (node?.kind !== 'action') throw new Error('expected an action');
    expect(node.onError).toBe(true);
    // A stop has no failure mode; the graph comes back unchanged.
    expect(toggleOnError(graph(), 'n4')).toEqual(graph());
  });
});

describe('completeness (D12)', () => {
  it('is complete when every action and condition is filled in', () => {
    expect(firstIncompleteNode(graph())).toBeNull();
  });

  it('names the first unfinished step', () => {
    const result = insert(graph(), { index: 2 }, emailStep);
    expect(firstIncompleteNode(result.graph)?.id).toBe(result.nodeId);
  });

  it('an empty condition is incomplete', () => {
    const result = insert(graph(), { index: 3 }, branchStep);
    expect(firstIncompleteNode(result.graph)?.id).toBe(result.nodeId);
  });
});
