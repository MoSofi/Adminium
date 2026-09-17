// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every edit the flow builder can make, as PURE functions over a graph
 * (the comp's own rules, Automation Rules 405-449).
 *
 * They are pure for two reasons. The obvious one is that they are the only
 * part of the builder that can be unit-tested without a DOM. The load-bearing
 * one is D11: the page holds a DRAFT and saves it explicitly, so every
 * operation has to produce a new document rather than mutate the one the
 * server sent — "is this dirty?" is a comparison, and a comparison against a
 * value somebody mutated is always false.
 *
 * The comp's rules, kept verbatim:
 *
 *  - the trigger never moves and is never removed (comp 421, 427);
 *  - a branch never enters a branch (comp 434, 445);
 *  - dragging a node ONTO another moves it BEFORE that one (comp 429);
 *  - dropping on a branch's "Add step" appends to that branch (comp 440);
 *  - duplicating re-ids the copy, its branches and their children (comp 422).
 *
 * The one departure is the DEFAULTS: the comp seeds a new condition and a new
 * filter with worked examples from its own demo data (comp 410-411). A new
 * condition here starts EMPTY, both because that demo data is about a product
 * this one is not, and because a rule that arrives pre-filled with a condition
 * nobody wrote is a rule that quietly does the wrong thing (Appendix B).
 */

import {
  branchById,
  cloneGraph,
  locate,
  newId,
  type Action,
  type BranchChildNode,
  type Condition,
  type FlowNode,
  type Graph,
  type NodeKind,
} from './graph.js';

/** Where the picker will insert: at an index of the root list, or of a branch. */
export interface InsertTarget {
  index: number;
  branchId?: string | undefined;
}

/** What the picker's tiles carry (D10). */
export interface StepDefinition {
  key: string;
  kind: NodeKind;
  icon: string;
  label: string;
  /** The node's default `sub` — "Template · pick one" and friends. */
  sub: string;
  desc: string;
  action?: Action | undefined;
}

export const EMPTY_CONDITION: Condition = { left: { field: '' }, op: 'is', right: '' };

/** The comp's default branch labels (comp 410), which ARE kept. */
export const BRANCH_LABELS = ['If matches', 'Otherwise'] as const;

export function insert(graph: Graph, target: InsertTarget, def: StepDefinition): {
  graph: Graph;
  nodeId: string;
} {
  const next = cloneGraph(graph);
  const id = newId(next);
  const base = { id, title: def.label, sub: def.sub };

  let node: FlowNode;
  switch (def.kind) {
    case 'branch':
      node = {
        ...base,
        kind: 'branch',
        condition: structuredClone(EMPTY_CONDITION),
        branches: [
          { id: `${id}a`, label: BRANCH_LABELS[0], nodes: [] },
          { id: `${id}b`, label: BRANCH_LABELS[1], nodes: [] },
        ],
      };
      break;
    case 'condition':
      node = { ...base, kind: 'condition', onError: false, condition: structuredClone(EMPTY_CONDITION) };
      break;
    case 'wait':
      node = { ...base, kind: 'wait', amount: 1, unit: 'days' };
      break;
    case 'stop':
      node = { ...base, kind: 'stop' };
      break;
    default:
      node = {
        ...base,
        kind: 'action',
        onError: false,
        action: def.action ?? { kind: 'email', templateKey: null, to: null },
      };
  }

  if (target.branchId !== undefined) {
    const branch = branchById(next, target.branchId);
    // A branch never holds a branch (comp 570) — the picker hides the tile,
    // and this is the belt. (A trigger is never built here at all: the picker
    // has no tile for it.)
    if (branch && node.kind !== 'branch') {
      branch.nodes.splice(target.index, 0, node);
    }
  } else {
    // Never before the trigger: index 0 is its.
    next.nodes.splice(Math.max(1, target.index), 0, node);
  }
  return { graph: next, nodeId: id };
}

export function remove(graph: Graph, id: string): Graph {
  const next = cloneGraph(graph);
  const found = locate(next, id);
  if (found === null || found.node.kind === 'trigger') return graph;
  (found.list as FlowNode[]).splice(found.index, 1);
  return next;
}

export function duplicate(graph: Graph, id: string): { graph: Graph; nodeId: string } {
  const next = cloneGraph(graph);
  const found = locate(next, id);
  if (found === null || found.node.kind === 'trigger') return { graph, nodeId: id };
  const copyId = newId(next);
  const copy = structuredClone(found.node);
  copy.id = copyId;
  if (copy.kind === 'branch') {
    copy.branches.forEach((branch, i) => {
      branch.id = `${copyId}${i === 0 ? 'a' : 'b'}`;
      branch.nodes.forEach((child, k) => {
        child.id = `${copyId}-${String(k)}`;
      });
    });
  }
  (found.list as FlowNode[]).splice(found.index + 1, 0, copy);
  return { graph: next, nodeId: copyId };
}

/** Move within the node's own list; never past or onto the trigger (comp 427). */
export function move(graph: Graph, id: string, direction: -1 | 1): Graph {
  const next = cloneGraph(graph);
  const found = locate(next, id);
  if (found === null) return graph;
  const target = found.index + direction;
  const list = found.list as FlowNode[];
  if (target < 0 || target >= list.length) return graph;
  if (list[found.index]?.kind === 'trigger' || list[target]?.kind === 'trigger') return graph;
  const swap = list[found.index] as FlowNode;
  list[found.index] = list[target] as FlowNode;
  list[target] = swap;
  return next;
}

/** Drag `dragId` onto `targetId` — it lands BEFORE the target (comp 429). */
export function moveTo(graph: Graph, dragId: string, targetId: string): Graph {
  if (dragId === targetId) return graph;
  const next = cloneGraph(graph);
  const from = locate(next, dragId);
  const onto = locate(next, targetId);
  if (from === null || onto === null) return graph;
  if (from.node.kind === 'trigger' || onto.node.kind === 'trigger') return graph;
  // A branch cannot be dragged into a branch (comp 435).
  if (from.node.kind === 'branch' && onto.inBranch) return graph;

  const moved = from.node;
  (from.list as FlowNode[]).splice(from.index, 1);
  const after = locate(next, targetId);
  if (after === null) {
    (from.list as FlowNode[]).splice(from.index, 0, moved);
    return graph;
  }
  (after.list as FlowNode[]).splice(after.index, 0, moved);
  return next;
}

/** Drop on a branch's dashed "Add step" — appended to that branch (comp 440). */
export function moveIntoBranch(graph: Graph, dragId: string, branchId: string): Graph {
  const next = cloneGraph(graph);
  const from = locate(next, dragId);
  if (from === null || from.node.kind === 'trigger' || from.node.kind === 'branch') return graph;
  const branch = branchById(next, branchId);
  if (branch === null) return graph;
  if (from.list === branch.nodes) return graph;
  const moved = from.node as BranchChildNode;
  (from.list as FlowNode[]).splice(from.index, 1);
  branch.nodes.push(moved);
  return next;
}

export function patchNode(graph: Graph, id: string, patch: Partial<FlowNode>): Graph {
  const next = cloneGraph(graph);
  const found = locate(next, id);
  if (found === null) return graph;
  Object.assign(found.node, patch);
  return next;
}

export function patchAction(graph: Graph, id: string, patch: Partial<Action>): Graph {
  const next = cloneGraph(graph);
  const found = locate(next, id);
  if (found === null || found.node.kind !== 'action') return graph;
  found.node.action = { ...found.node.action, ...patch } as Action;
  return next;
}

export function patchCondition(graph: Graph, id: string, condition: Condition): Graph {
  const next = cloneGraph(graph);
  const found = locate(next, id);
  if (found === null) return graph;
  if (found.node.kind === 'condition' || found.node.kind === 'branch') {
    found.node.condition = condition;
    return next;
  }
  return graph;
}

export function patchBranchLabel(graph: Graph, id: string, index: 0 | 1, label: string): Graph {
  const next = cloneGraph(graph);
  const found = locate(next, id);
  if (found === null || found.node.kind !== 'branch') return graph;
  found.node.branches[index].label = label;
  return next;
}

export function toggleOnError(graph: Graph, id: string): Graph {
  const next = cloneGraph(graph);
  const found = locate(next, id);
  if (found === null) return graph;
  if (found.node.kind === 'action' || found.node.kind === 'condition') {
    found.node.onError = !found.node.onError;
    return next;
  }
  return graph;
}
