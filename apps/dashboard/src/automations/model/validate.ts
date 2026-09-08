// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Is this rule complete enough to switch on?" — the CLIENT's copy
 * (42-automations-and-workflow-logs.md D12, §3.5).
 *
 * The server is the authority (`automations/validate.ts` there); this is the
 * courtesy. Without it the card's toggle would fire a PATCH, get a 422, and
 * snap back — which works, but tells the person nothing until after they have
 * clicked. With it the toggle knows, the flow header can say so, and the
 * incomplete node can be lit before anybody asks.
 *
 * The two implementations are deliberately IDENTICAL in rule and different in
 * consequence: this one decides what the UI offers, that one decides what the
 * store accepts. A drift shows up as a toggle that looks enabled and 422s,
 * which `automations-routes.test.ts` pins from the other side.
 */

import { flatten, type Action, type Condition, type FlowNode, type Graph } from './graph.js';

export function isConditionComplete(condition: Condition): boolean {
  const needsOperand = condition.op !== 'is_empty' && condition.op !== 'not_empty';
  if (needsOperand && (condition.right === undefined || condition.right === '')) return false;
  if ('count' in condition.left) {
    const { table, matchColumn, equalsField } = condition.left.count;
    return table !== '' && matchColumn !== '' && equalsField !== '';
  }
  return condition.left.field !== '';
}

export function isActionComplete(action: Action): boolean {
  switch (action.kind) {
    case 'email':
      if (action.templateKey === null || action.templateKey === '') return false;
      if (action.to === null) return false;
      return action.to.kind === 'field' ? action.to.column !== '' : action.to.addresses.length > 0;
    case 'notification':
      if (action.to === null || action.title.trim() === '') return false;
      return 'users' in action.to ? action.to.users.length > 0 : action.to.roles.length > 0;
    case 'record.create':
      return action.table !== null && action.table !== '' && Object.keys(action.values).length > 0;
    case 'record.update':
      return Object.keys(action.values).length > 0;
    case 'webhook':
      return action.url !== null && action.url.trim() !== '';
  }
}

export function isNodeComplete(node: FlowNode): boolean {
  switch (node.kind) {
    case 'trigger':
    case 'stop':
    case 'wait':
      return true;
    case 'condition':
    case 'branch':
      return isConditionComplete(node.condition);
    case 'action':
      return isActionComplete(node.action);
  }
}

/** The first step that is not finished, or null when the rule may run. */
export function firstIncompleteNode(graph: Graph): FlowNode | null {
  return flatten(graph).find((node) => !isNodeComplete(node)) ?? null;
}
