// SPDX-License-Identifier: AGPL-3.0-only
/**
 * IS THIS RULE COMPLETE, AND DOES IT NAME THINGS THAT EXIST?
 * (42-automations-and-workflow-logs.md §5, D12, 42-T14.)
 *
 * Two different questions, deliberately separated:
 *
 *  - RESOLUTION — does the table exist, does the column exist, is the
 *    relative operator on a date column, is the webhook URL one we may dial?
 *    These are refusals: a rule that names a column the table does not have
 *    is a 422 at save time, because storing it would produce a run that fails
 *    for a reason nobody can see from the flow.
 *
 *  - COMPLETENESS — has the person finished filling this step in? That is NOT
 *    a refusal (D11: a half-built flow must survive a save); it is what
 *    decides whether the rule may be switched ON. `POST` with
 *    `enabled: true` stores it paused instead; `PATCH { enabled: true }` is a
 *    422 naming the first unfinished step, which is what the card's toggle
 *    snapping back and the toast are built on.
 *
 * The dashboard re-implements COMPLETENESS in `model/validate.ts` so the UI
 * can explain before it asks. This is the authority; that is the courtesy.
 */

import type {
  AutomationAction,
  AutomationCondition,
  AutomationGraph,
  AutomationNode,
  AutomationTrigger,
} from '@adminium/meta';
import { isRelativeAutomationOp } from '@adminium/meta';

import { ValidationFailedError } from '../errors.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { guardOutboundUrl } from '../connections/dsn.js';
import { isConditionComplete } from './conditions.js';
import { isDateColumn } from './relative-time.js';
import { isSlackWebhookUrl } from './actions/webhook.js';

/** Every node, branch children included, in walk order. */
export function flattenNodes(graph: AutomationGraph): AutomationNode[] {
  const out: AutomationNode[] = [];
  for (const node of graph.nodes) {
    out.push(node);
    if (node.kind === 'branch') {
      for (const branch of node.branches) out.push(...(branch.nodes as AutomationNode[]));
    }
  }
  return out;
}

/** The first step that is not finished, or null when the rule may run (D12). */
export function firstIncompleteNode(graph: AutomationGraph): AutomationNode | null {
  for (const node of flattenNodes(graph)) {
    switch (node.kind) {
      case 'trigger':
      case 'stop':
      case 'wait':
        break;
      case 'condition':
      case 'branch':
        if (!isConditionComplete(node.condition)) return node;
        break;
      case 'action':
        if (!isActionComplete(node.action)) return node;
        break;
    }
  }
  return null;
}

export function isActionComplete(action: AutomationAction): boolean {
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

// --- resolution -------------------------------------------------------------

export interface ResolveContext {
  view: SnapshotView | null;
  /** Live template keys — an archived one is not offerable (39 D4). */
  templateKeys: ReadonlySet<string>;
  blockLoopback: boolean;
}

function tableOrThrow(ctx: ResolveContext, id: string, where: string): ResolvedTable {
  if (ctx.view === null) {
    throw new ValidationFailedError(`${where} names a table but the rule has no connection.`, {
      table: id,
    });
  }
  try {
    return ctx.view.table(id);
  } catch {
    throw new ValidationFailedError(`${where} names a table that does not exist: ${id}.`, {
      table: id,
    });
  }
}

function checkCondition(
  condition: AutomationCondition,
  table: ResolvedTable,
  ctx: ResolveContext,
  where: string,
): void {
  if ('count' in condition.left) {
    const counted = tableOrThrow(ctx, condition.left.count.table, where);
    const match = counted.columns.get(condition.left.count.matchColumn);
    if (condition.left.count.matchColumn !== '' && match === undefined) {
      throw new ValidationFailedError(
        `${where}: ${counted.id} has no column ${condition.left.count.matchColumn}.`,
        {},
      );
    }
    const equals = table.columns.get(condition.left.count.equalsField);
    if (condition.left.count.equalsField !== '' && equals === undefined) {
      throw new ValidationFailedError(
        `${where}: ${table.id} has no column ${condition.left.count.equalsField}.`,
        {},
      );
    }
    if (condition.left.count.where) checkCondition(condition.left.count.where, counted, ctx, where);
    return;
  }
  const name = condition.left.field;
  if (name === '') return; // unfinished, which a draft may be
  const column = table.columns.get(name);
  if (column === undefined) {
    throw new ValidationFailedError(`${where}: ${table.id} has no column ${name}.`, { column: name });
  }
  if (isRelativeAutomationOp(condition.op) && !isDateColumn(column)) {
    throw new ValidationFailedError(
      `${where}: ${name} is not a date column, so it has no relative time.`,
      { column: name },
    );
  }
}

function checkAction(
  action: AutomationAction,
  table: ResolvedTable | null,
  ctx: ResolveContext,
  where: string,
): void {
  switch (action.kind) {
    case 'email': {
      if (action.templateKey !== null && action.templateKey !== '' && !ctx.templateKeys.has(action.templateKey)) {
        throw new ValidationFailedError(
          `${where}: there is no live email template with the key ${action.templateKey}.`,
          { templateKey: action.templateKey },
        );
      }
      if (action.to?.kind === 'field' && action.to.column !== '') {
        if (table === null) {
          throw new ValidationFailedError(`${where}: this rule has no record to read an address from.`, {});
        }
        if (!table.columns.has(action.to.column)) {
          throw new ValidationFailedError(`${where}: ${table.id} has no column ${action.to.column}.`, {});
        }
      }
      return;
    }
    case 'record.create': {
      if (action.table === null || action.table === '') return;
      const target = tableOrThrow(ctx, action.table, where);
      assertNotSystem(target, where);
      checkValues(action.values, target, where);
      return;
    }
    case 'record.update': {
      if (table === null) {
        throw new ValidationFailedError(`${where}: this rule has no record to update.`, {});
      }
      assertNotSystem(table, where);
      checkValues(action.values, table, where);
      return;
    }
    case 'webhook': {
      if (action.url === null || action.url.trim() === '') return;
      const url = action.url.trim();
      // A URL carrying a token cannot be resolved until the run; the send-time
      // guard is the one that matters for those.
      if (!url.includes('{{')) {
        guardOutboundUrl(url, { blockLoopback: ctx.blockLoopback });
        if (action.bodyKind === 'slack' && !isSlackWebhookUrl(url)) {
          throw new ValidationFailedError(
            `${where}: a Slack message needs a hooks.slack.com webhook URL.`,
            { url },
          );
        }
      }
      return;
    }
    case 'notification':
      return;
  }
}

function assertNotSystem(table: ResolvedTable, where: string): void {
  if (table.id.includes('adminium_')) {
    throw new ValidationFailedError(`${where}: ${table.id} is one of Adminium's own tables.`, {
      table: table.id,
    });
  }
  if (table.readOnly) {
    throw new ValidationFailedError(`${where}: ${table.id} is read-only.`, { table: table.id });
  }
}

function checkValues(
  values: Record<string, unknown>,
  table: ResolvedTable,
  where: string,
): void {
  for (const column of Object.keys(values)) {
    const resolved = table.columns.get(column);
    if (resolved === undefined) {
      throw new ValidationFailedError(`${where}: ${table.id} has no column ${column}.`, { column });
    }
    if (resolved.secret || resolved.masked) {
      throw new ValidationFailedError(
        `${where}: ${column} is a protected column and cannot be written by a rule.`,
        { column },
      );
    }
  }
}

/** Every §5 refusal that needs a schema. Throws 422; returns the trigger table. */
export function resolveRule(
  trigger: AutomationTrigger,
  graph: AutomationGraph,
  ctx: ResolveContext,
): ResolvedTable | null {
  let table: ResolvedTable | null = null;

  if (trigger.kind === 'record') {
    table = tableOrThrow(ctx, trigger.table, 'The trigger');
    if (trigger.changedColumn != null && trigger.changedColumn !== '') {
      if (!table.columns.has(trigger.changedColumn)) {
        throw new ValidationFailedError(
          `The trigger: ${table.id} has no column ${trigger.changedColumn}.`,
          { column: trigger.changedColumn },
        );
      }
    }
    for (const condition of trigger.when ?? []) checkCondition(condition, table, ctx, 'The trigger');
  } else if (trigger.forEach !== undefined) {
    table = tableOrThrow(ctx, trigger.forEach.table, 'The schedule');
    if (trigger.forEach.once && trigger.forEach.where.length === 0) {
      // "Once per record" over an unfiltered table fires for every row of the
      // table on the first tick and never again — never what anybody means.
      throw new ValidationFailedError(
        'A once-per-record scan needs at least one condition.',
        { table: table.id },
      );
    }
    for (const condition of trigger.forEach.where) {
      checkCondition(condition, table, ctx, 'The schedule');
    }
  }

  for (const node of flattenNodes(graph)) {
    const where = `Step “${node.title}”`;
    if (node.kind === 'action') checkAction(node.action, table, ctx, where);
    else if ((node.kind === 'condition' || node.kind === 'branch') && table !== null) {
      checkCondition(node.condition, table, ctx, where);
    }
  }
  return table;
}

/** The tables a save must prove the AUTHOR can reach, and with which verb (D2). */
export function requiredGrants(
  trigger: AutomationTrigger,
  graph: AutomationGraph,
  connectionId: string | null,
): { permission: string; table: string }[] {
  if (connectionId === null) return [];
  const wanted: { permission: string; table: string }[] = [];
  const add = (table: string, action: string): void => {
    if (table === '') return;
    const permission = `table:${connectionId}:${table}:${action}`;
    if (!wanted.some((row) => row.permission === permission)) wanted.push({ permission, table });
  };

  let subject: string | null = null;
  if (trigger.kind === 'record') {
    subject = trigger.table;
    add(trigger.table, 'read');
  } else if (trigger.forEach !== undefined) {
    subject = trigger.forEach.table;
    add(trigger.forEach.table, 'read');
  }

  for (const node of flattenNodes(graph)) {
    if (node.kind !== 'action') continue;
    if (node.action.kind === 'record.create' && node.action.table !== null) {
      add(node.action.table, 'create');
    }
    if (node.action.kind === 'record.update' && subject !== null) add(subject, 'update');
  }
  return wanted;
}
