// SPDX-License-Identifier: AGPL-3.0-only
/**
 * IS THIS RULE COMPLETE, AND DOES IT NAME THINGS THAT EXIST?
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
import { yesNo } from './yes-no.js';
import { isRelativeAutomationOp } from '@adminium/meta';

import { ValidationFailedError } from '../errors.js';
import type { ResolvedColumn, ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { guardOutboundUrl } from '../connections/dsn.js';
import { isConditionComplete } from './conditions.js';
import { isDateColumn } from './relative-time.js';
import { isSlackWebhookUrl } from './actions/webhook.js';
import { isAddressColumn, parseRelated, relatedTarget, relatedUses, type RelatedRef } from './related.js';

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
    case 'document.render':
      /*
       * The ONE field. Everything else about the document — the mapping, the
       * paper, the formats, the prefix, the provider — is the profile's, so
       * "is this step finished" is exactly "has a mapping been chosen".
       *
       * That the mapping still EXISTS and is enabled is deliberately not
       * checked here: this function decides whether a rule can be saved, and
       * a profile deleted after the rule was written must not make the rule
       * unsavable. The run turns a missing mapping into a skip with a reason,
       * and the dry run says so before anybody waits for a trigger.
       */
      return action.profileId !== null && action.profileId !== '';
  }
}

// --- resolution -------------------------------------------------------------

export interface ResolveContext {
  view: SnapshotView | null;
  /** Live template keys — an archived one is not offerable. */
  templateKeys: ReadonlySet<string>;
  blockLoopback: boolean;
}

/**
 * What to do about it, for the three steps that need the RUN'S record and a
 * bare schedule tick has none. `table` is null here exactly when the trigger
 * is a schedule with no for-each scan — a record trigger always resolves one,
 * and a scan resolves the table it scans.
 */
const NO_RECORD_REMEDY = 'Give the schedule a table, or trigger the rule on a record.';

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

/**
 * A column a rule READS (a condition, the column it watches, an address), as
 * the view it is checked in knows it. In a person's own view (`readAs`) a
 * column their role is not shown is refused by name and nothing of it is
 * told; in the whole view no column is unreadable and this is a plain lookup.
 * `undefined` means the table has no such column.
 */
function readColumn(table: ResolvedTable, name: string, where: string): ResolvedColumn | undefined {
  const column = table.columns.get(name);
  if (column?.unreadable === true) {
    throw new ValidationFailedError(`${where}: ${name} is not a column your role is shown, so a rule of yours cannot read it.`, { column: name, reason: 'read-limit' });
  }
  return column;
}

/**
 * A column of a related row (`customer_id.email`), checked as the AUTHOR reads
 * the schema: the link is one the snapshot holds from the rule's table, the
 * far table is theirs to see, the far column is there and shown to them.
 * Answers the far column; throws the refusal that says which half is wrong.
 */
function relatedColumn(table: ResolvedTable, ref: RelatedRef, ctx: ResolveContext, where: string): { target: ResolvedTable; column: ResolvedColumn } {
  if (readColumn(table, ref.link, where) === undefined) {
    throw new ValidationFailedError(`${where}: ${table.id} has no column ${ref.link}.`, { column: ref.link });
  }
  const target = ctx.view === null ? null : relatedTarget(ctx.view, table, ref.link);
  if (target === null) {
    throw new ValidationFailedError(`${where}: ${ref.link} is not a link to another table, so it has no ${ref.column}.`, { column: ref.link, reason: 'not-a-link' });
  }
  const column = readColumn(target.table, ref.column, where);
  if (column === undefined) {
    throw new ValidationFailedError(`${where}: ${target.table.id} has no column ${ref.column}.`, { column: `${ref.link}.${ref.column}` });
  }
  return { target: target.table, column };
}

/** A typed address, as a mail server would take it: one @, something on both sides, a dot after it, no spaces. */
const ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

function checkCondition(
  condition: AutomationCondition,
  table: ResolvedTable,
  ctx: ResolveContext,
  where: string,
): void {
  if ('count' in condition.left) {
    const counted = tableOrThrow(ctx, condition.left.count.table, where);
    const match = readColumn(counted, condition.left.count.matchColumn, where);
    if (condition.left.count.matchColumn !== '' && match === undefined) {
      throw new ValidationFailedError(
        `${where}: ${counted.id} has no column ${condition.left.count.matchColumn}.`,
        {},
      );
    }
    const equals = readColumn(table, condition.left.count.equalsField, where);
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
  const column = readColumn(table, name, where);
  if (column === undefined) {
    throw new ValidationFailedError(`${where}: ${table.id} has no column ${name}.`, { column: name });
  }
  if (isRelativeAutomationOp(condition.op) && !isDateColumn(column)) {
    throw new ValidationFailedError(
      `${where}: ${name} is not a date column, so it has no relative time.`,
      { column: name },
    );
  }
  // A yes/no is asked whether it is yes or no, and nothing else: "greater than" or "contains" would hold on no engine.
  if (column.logicalType === 'boolean' && condition.op !== 'is_empty' && condition.op !== 'not_empty') {
    if (condition.op !== 'is' && condition.op !== 'is_not') {
      throw new ValidationFailedError(`${where}: ${name} is a yes/no, so a rule asks whether it is or is not.`, { column: name });
    }
    if (condition.right !== undefined && yesNo(condition.right) === null) {
      throw new ValidationFailedError(`${where}: ${name} is a yes/no: compare it with yes or no.`, { column: name });
    }
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
          throw new ValidationFailedError(
            `${where}: this rule has no record to read an address from. ${NO_RECORD_REMEDY}`,
            {},
          );
        }
        const related = parseRelated(action.to.column);
        if (related !== null) relatedColumn(table, related, ctx, where);
        else if (readColumn(table, action.to.column, where) === undefined) {
          throw new ValidationFailedError(`${where}: ${table.id} has no column ${action.to.column}.`, {});
        }
      }
      // A typed address is one nobody can check later: a mistake in it is said now.
      if (action.to?.kind === 'fixed') {
        const wrong = action.to.addresses.map((address) => address.trim()).find((address) => address !== '' && !ADDRESS.test(address));
        if (wrong !== undefined) {
          throw new ValidationFailedError(`${where}: “${wrong}” is not an email address.`, { address: wrong, reason: 'not-an-address' });
        }
      }
      return;
    }
    case 'record.create': {
      // Unfinished is allowed to be saved (D11), and the New-rule modal makes
      // exactly this shape, so judge nothing until a target is named.
      if (action.table === null || action.table === '') return;
      /*
       * A create writes through the RUN'S OWN connection handle, and a run
       * only has one when it is about a record (`runner.ts` `openSource`
       * returns null without one, and `record-write.ts` `sourceOf` throws).
       * A bare schedule tick therefore fails this step every single time —
       * silently, until somebody reads the run log. Refused here for the same
       * reason an update with no record is, three lines down.
       */
      if (table === null) {
        throw new ValidationFailedError(
          `${where}: a schedule with no table to scan has no connection to write through. ${NO_RECORD_REMEDY}`,
          {},
        );
      }
      const target = tableOrThrow(ctx, action.table, where);
      assertNotSystem(target, where);
      checkValues(action.values, target, where);
      return;
    }
    case 'record.update': {
      /*
       * Unfinished first, exactly as `record.create` above — and this order is
       * the whole point of the case. Without it the New-rule modal's own
       * "On a schedule" + "Update field" pair, which is `values: {}`, was a
       * 422 on a brand-new rule; D12 says it saves PAUSED and says which step
       * is unfinished. A CONFIGURED update under a bare schedule is still a
       * refusal: `record-write.ts` re-reads the run's record by pk, and there
       * is none.
       */
      if (Object.keys(action.values).length === 0) return;
      if (table === null) {
        throw new ValidationFailedError(
          `${where}: a schedule with no table to scan has no record to update. ${NO_RECORD_REMEDY}`,
          {},
        );
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

/**
 * Whether a table is one of Adminium's own, which no rule reads or writes.
 * Told by the table's own name: a database or a schema may be called anything
 * (a MySQL database named `adminium_shop` holds ordinary tables).
 */
export function isOwnTable(table: Pick<ResolvedTable, 'name'>): boolean {
  return table.name.startsWith('adminium_');
}

function assertNotSystem(table: ResolvedTable, where: string): void {
  if (isOwnTable(table)) {
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
  // A state reached only by a move marked undo is a person's to make, naming the state they saw: a rule never can.
  const states = table.table.states;
  const value = states === undefined ? undefined : values[states.column];
  if (states !== undefined && typeof value === 'string') {
    const moves = Object.values(states.moves).flatMap((list) => list.filter((move) => (typeof move === 'string' ? move : move.to) === value));
    if (moves.length > 0 && moves.every((move) => typeof move === 'object' && move.undo === true)) {
      throw new ValidationFailedError(`${where}: every move to "${value}" is an undo, which only a person makes.`, { column: states.column });
    }
  }
}

/** Every refusal that needs a schema. Throws 422; returns the trigger table. */
export function resolveRule(
  trigger: AutomationTrigger,
  graph: AutomationGraph,
  ctx: ResolveContext,
): ResolvedTable | null {
  let table: ResolvedTable | null = null;

  if (trigger.kind === 'record') {
    table = tableOrThrow(ctx, trigger.table, 'The trigger');
    if (trigger.changedColumn != null && trigger.changedColumn !== '') {
      if (readColumn(table, trigger.changedColumn, 'The trigger') === undefined) {
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
      // The scan is one query: a count of related rows is a second one, and would throw at every tick with nobody told.
      if ('count' in condition.left) {
        throw new ValidationFailedError("A schedule's conditions are read by the database. Count related rows in a step after it.", { table: table.id });
      }
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
  // A placeholder that reaches through a link (`{{customer_id.name}}`): the link and the far
  // column must be there, and a protected column is no placeholder there either. A name whose
  // first half is no link is left alone: an unknown placeholder stays as written, as ever.
  if (table !== null && ctx.view !== null) {
    for (const use of relatedUses(graph)) {
      if (use.as !== 'token' || relatedTarget(ctx.view, table, use.link) === null) continue;
      const where = `Step “${use.title}”`;
      const { column } = relatedColumn(table, use, ctx, where);
      // As for the record's own columns: a mail's values may carry a personal column (the mail
      // goes to that person), no other step may, and a secret is carried by nothing.
      if (column.secret || (column.masked && use.step !== 'email')) {
        throw new ValidationFailedError(`${where}: ${use.link}.${use.column} is a protected column and cannot be a placeholder.`, { column: `${use.link}.${use.column}` });
      }
    }
  }
  return table;
}

/** Something a person should look at that does not stop the rule: drawn on the step, said at the save. */
export interface RuleWarning {
  nodeId: string;
  code: 'recipient-not-address';
  column: string;
}

/**
 * What a saved rule is warned of. Today one thing: an email step addressed to
 * a column that does not hold addresses. A rule made by hand may do it (the
 * schema's reading of a column can be wrong, and old rules must go on
 * running); a person is told, on the step.
 */
export function ruleWarnings(trigger: AutomationTrigger, graph: AutomationGraph, view: SnapshotView | null): RuleWarning[] {
  if (view === null) return [];
  const subject = trigger.kind === 'record' ? trigger.table : (trigger.forEach?.table ?? null);
  if (subject === null) return [];
  let table: ResolvedTable;
  try {
    table = view.table(subject);
  } catch {
    return [];
  }
  const out: RuleWarning[] = [];
  for (const node of flattenNodes(graph)) {
    if (node.kind !== 'action' || node.action.kind !== 'email' || node.action.to?.kind !== 'field' || node.action.to.column === '') continue;
    const name = node.action.to.column;
    const related = parseRelated(name);
    const far = related === null ? null : relatedTarget(view, table, related.link);
    const holds = related === null ? isAddressColumn(table, name) : far !== null && isAddressColumn(far.table, related.column);
    if (!holds) out.push({ nodeId: node.id, code: 'recipient-not-address', column: name });
  }
  return out;
}

/** The tables a save must prove the AUTHOR can reach, and with which verb (D2). */
export function requiredGrants(
  trigger: AutomationTrigger,
  graph: AutomationGraph,
  connectionId: string | null,
  /** The schema, to know which table a link leads to: reading a related row is reading its table. */
  view: SnapshotView | null = null,
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
  if (view !== null && subject !== null) {
    let table: ResolvedTable | null = null;
    try {
      table = view.table(subject);
    } catch {
      table = null;
    }
    if (table !== null) {
      for (const use of relatedUses(graph)) {
        const target = relatedTarget(view, table, use.link);
        if (target !== null) add(target.table.id, 'read');
      }
    }
  }
  return wanted;
}
