// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rule document, as the CLIENT sees it (42-automations-and-workflow-
 * logs.md §3.5).
 *
 * Re-declared rather than imported: the dashboard may not depend on
 * `@adminium/meta` (the dep-cruiser rule `dashboard-no-meta-adapters-llm`),
 * so these types are a mirror of `json-payloads.ts`'s automation section. The
 * server is the authority — it re-parses everything this page sends — and the
 * `automations-routes.test.ts` refusals are what notice a drift.
 *
 * The shape is the COMP'S OWN nested list, not a DAG: `nodes` in order, and a
 * branch node carrying exactly two branches each with their own `nodes`
 * (Automation Rules 274-307). A branch may not contain another branch (comp
 * 570), which is why `BranchChildNode` excludes it and the picker hides the
 * tile inside a branch.
 */

export type NodeKind = 'trigger' | 'action' | 'condition' | 'branch' | 'wait' | 'stop';
export type DurationUnit = 'minutes' | 'hours' | 'days';

export type ConditionOp =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'gt'
  | 'lt'
  | 'is_empty'
  | 'not_empty'
  | 'within_next'
  | 'within_last'
  | 'more_than_ago'
  | 'more_than_ahead';

export interface RelativeOperand {
  amount: number;
  unit: DurationUnit;
}

export type ConditionOperand = string | number | RelativeOperand;

export interface FieldLeft {
  field: string;
}

export interface CountLeft {
  count: {
    table: string;
    matchColumn: string;
    equalsField: string;
    where?: { left: FieldLeft; op: ConditionOp; right?: ConditionOperand } | undefined;
  };
}

export interface Condition {
  left: FieldLeft | CountLeft;
  op: ConditionOp;
  right?: ConditionOperand | undefined;
}

export type EmailRecipient =
  | { kind: 'field'; column: string }
  | { kind: 'fixed'; addresses: string[] };

export type NotificationAudience = { roles: string[] } | { users: string[] };

export type WriteValue = string | { now: true };

export type Action =
  | { kind: 'email'; templateKey: string | null; to: EmailRecipient | null }
  | {
      kind: 'notification';
      to: NotificationAudience | null;
      title: string;
      body: string | null;
    }
  | { kind: 'record.create'; table: string | null; values: Record<string, WriteValue> }
  | { kind: 'record.update'; values: Record<string, WriteValue> }
  | {
      kind: 'webhook';
      url: string | null;
      method: 'POST' | 'PUT';
      bodyKind: 'json' | 'text' | 'slack';
      body: string | null;
      headerName: string | null;
      headerValueEncrypted: string | null;
    };

interface NodeBase {
  id: string;
  title: string;
  sub?: string | null | undefined;
}

export type TriggerNode = NodeBase & { kind: 'trigger' };
export type ActionNode = NodeBase & { kind: 'action'; onError: boolean; action: Action };
export type FilterNode = NodeBase & { kind: 'condition'; onError: boolean; condition: Condition };
export type WaitNode = NodeBase & { kind: 'wait'; amount: number; unit: DurationUnit };
export type StopNode = NodeBase & { kind: 'stop' };

/** Everything a branch may hold — never a trigger, never another branch. */
export type BranchChildNode = ActionNode | FilterNode | WaitNode | StopNode;

export interface Branch {
  id: string;
  label: string;
  nodes: BranchChildNode[];
}

export type BranchNode = NodeBase & {
  kind: 'branch';
  condition: Condition;
  branches: [Branch, Branch];
};

export type FlowNode = TriggerNode | BranchNode | BranchChildNode;

export interface Graph {
  version: 1;
  nodes: FlowNode[];
}

// --- the trigger ------------------------------------------------------------

export type RecordEvent = 'created' | 'updated' | 'deleted';

export type Schedule =
  | { kind: 'interval'; everyMinutes: '5' | '10' | '15' | '30' | '60' }
  | {
      kind: 'daily' | 'weekly' | 'monthly';
      time: string;
      dayOfWeek?: number | null | undefined;
      dayOfMonth?: number | null | undefined;
      timezone: string;
    };

export type Trigger =
  | {
      kind: 'record';
      event: RecordEvent;
      connectionId: string;
      table: string;
      watch: boolean;
      changedColumn?: string | null | undefined;
      when?: Condition[] | undefined;
    }
  | {
      kind: 'schedule';
      connectionId: string | null;
      schedule: Schedule;
      forEach?: { table: string; where: Condition[]; once: boolean } | undefined;
    };

// --- the comp's own helpers (Automation Rules 386-403) ----------------------

export interface Located {
  node: FlowNode;
  list: FlowNode[] | BranchChildNode[];
  index: number;
  inBranch: boolean;
}

/** Find a node anywhere in the graph, with the list it lives in (comp 392). */
export function locate(graph: Graph, id: string): Located | null {
  for (let i = 0; i < graph.nodes.length; i += 1) {
    const node = graph.nodes[i] as FlowNode;
    if (node.id === id) return { node, list: graph.nodes, index: i, inBranch: false };
    if (node.kind === 'branch') {
      for (const branch of node.branches) {
        const k = branch.nodes.findIndex((child) => child.id === id);
        if (k >= 0) {
          return { node: branch.nodes[k] as FlowNode, list: branch.nodes, index: k, inBranch: true };
        }
      }
    }
  }
  return null;
}

export function branchById(graph: Graph, branchId: string): Branch | null {
  for (const node of graph.nodes) {
    if (node.kind !== 'branch') continue;
    for (const branch of node.branches) if (branch.id === branchId) return branch;
  }
  return null;
}

/** Steps including branch children — the flow header's count (comp 388). */
export function countSteps(nodes: readonly FlowNode[]): number {
  return nodes.reduce(
    (total, node) =>
      total +
      1 +
      (node.kind === 'branch'
        ? node.branches.reduce((inner, branch) => inner + branch.nodes.length, 0)
        : 0),
    0,
  );
}

/** Every node in walk order, branch children included. */
export function flatten(graph: Graph): FlowNode[] {
  const out: FlowNode[] = [];
  for (const node of graph.nodes) {
    out.push(node);
    if (node.kind === 'branch') for (const branch of node.branches) out.push(...branch.nodes);
  }
  return out;
}

/**
 * Ids are generated CLIENT-side and must not collide with anything already in
 * the graph — a duplicate is a 422 from the server's own uniqueness check, and
 * the operation that produced it (usually Duplicate) would fail on save
 * rather than on the click.
 */
export function newId(graph: Graph, seed = 'n'): string {
  const taken = new Set<string>();
  for (const node of flatten(graph)) {
    taken.add(node.id);
    if (node.kind === 'branch') for (const branch of node.branches) taken.add(branch.id);
  }
  let n = taken.size + 1;
  while (taken.has(`${seed}${String(n)}`)) n += 1;
  return `${seed}${String(n)}`;
}

/** A structural copy — every op works on one of these, never in place. */
export function cloneGraph(graph: Graph): Graph {
  return structuredClone(graph);
}
