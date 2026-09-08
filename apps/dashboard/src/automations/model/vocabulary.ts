// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The closed vocabularies both pages render from (42-automations-and-
 * workflow-logs.md D10, D21; the comp's `kindMeta`, Automation Rules
 * 381-384, and its two picker groups, 546-561).
 *
 * EVERY LABEL IS A LITERAL `t()` KEY. Not one of them is assembled from a
 * kind and a suffix (D21): `t(\`automations:kind.${kind}\`)` reads fine in
 * English and is unfindable by the extractor, untranslatable by a person who
 * cannot see the whole key, and silently English in every locale that missed
 * it. Exhaustive maps are longer and are the only version that survives eight
 * languages.
 */

import type { NodeKind, Action, ConditionOp, DurationUnit } from './graph.js';
import type { StepDefinition } from './ops.js';

/** The comp's five kind tones (Automation Rules 381-384). */
export interface KindMeta {
  /** `automations:kind.*` — TRIGGER / FILTER / IF / ELSE / DELAY / ACTION. */
  labelKey: string;
  fallback: string;
  /** Tailwind token classes, one per role, matching the comp's variables. */
  text: string;
  soft: string;
  /** The node card's 3px left border. */
  borderLeft: string;
  icon: string;
}

export const KIND_META: Readonly<Record<NodeKind, KindMeta>> = {
  trigger: {
    labelKey: 'automations:kind.trigger',
    fallback: 'TRIGGER',
    text: 'text-accent',
    soft: 'bg-accent-soft',
    borderLeft: 'border-s-accent',
    icon: 'zap',
  },
  condition: {
    labelKey: 'automations:kind.condition',
    fallback: 'FILTER',
    text: 'text-warn',
    soft: 'bg-warn-soft',
    borderLeft: 'border-s-warn',
    icon: 'filter',
  },
  branch: {
    labelKey: 'automations:kind.branch',
    fallback: 'IF / ELSE',
    text: 'text-warn',
    soft: 'bg-warn-soft',
    borderLeft: 'border-s-warn',
    icon: 'git-branch',
  },
  wait: {
    labelKey: 'automations:kind.wait',
    fallback: 'DELAY',
    text: 'text-fg-muted',
    soft: 'bg-surface-3',
    borderLeft: 'border-s-fg-muted',
    icon: 'timer',
  },
  action: {
    labelKey: 'automations:kind.action',
    fallback: 'ACTION',
    text: 'text-pos',
    soft: 'bg-pos-soft',
    borderLeft: 'border-s-pos',
    icon: 'mail',
  },
  stop: {
    labelKey: 'automations:kind.wait',
    fallback: 'DELAY',
    text: 'text-fg-muted',
    soft: 'bg-surface-3',
    borderLeft: 'border-s-fg-muted',
    icon: 'circle-stop',
  },
};

/** The tile's own icon, which is finer-grained than the kind's. */
export function iconForNode(kind: NodeKind, action: Action | null): string {
  if (kind !== 'action' || action === null) return KIND_META[kind].icon;
  switch (action.kind) {
    case 'email':
      return 'mail';
    case 'notification':
      return 'bell';
    case 'record.create':
      return 'square-plus';
    case 'record.update':
      return 'pencil';
    case 'webhook':
      return action.bodyKind === 'slack' ? 'hash' : 'webhook';
  }
}

/**
 * DEPARTURE D10 — six action tiles where the comp draws eight.
 *
 * Create task, Add tag, Assign owner and Enrich record name concepts the
 * customer's schema may or may not have and the runner cannot keep a promise
 * about; offering them would be a tile that fails at run time on most
 * databases. "Update field" IS "add a tag" for a schema with a tag column,
 * and "Create record" is the owner's beneficiaries example. Slack stays,
 * because a Slack incoming webhook IS a webhook (D19).
 */
export const ACTION_STEPS: readonly StepDefinition[] = [
  {
    key: 'email',
    kind: 'action',
    icon: 'mail',
    label: 'Send email',
    sub: 'Template · pick one',
    desc: 'From a saved template',
    action: { kind: 'email', templateKey: null, to: null },
  },
  {
    key: 'notification',
    kind: 'action',
    icon: 'bell',
    label: 'Send notification',
    sub: 'Choose who to tell',
    desc: 'Tell people in this workspace',
    action: { kind: 'notification', to: null, title: '', body: null },
  },
  {
    key: 'create',
    kind: 'action',
    icon: 'square-plus',
    label: 'Create record',
    sub: 'Table · pick one',
    desc: 'Add a row to a table',
    action: { kind: 'record.create', table: null, values: {} },
  },
  {
    key: 'update',
    kind: 'action',
    icon: 'pencil',
    label: 'Update field',
    sub: 'Set a value',
    desc: 'Write back to a record',
    action: { kind: 'record.update', values: {} },
  },
  {
    key: 'webhook',
    kind: 'action',
    icon: 'webhook',
    label: 'Call webhook',
    sub: 'POST · JSON payload',
    desc: 'Send data anywhere',
    action: {
      kind: 'webhook',
      url: null,
      method: 'POST',
      bodyKind: 'json',
      body: null,
      headerName: null,
      headerValueEncrypted: null,
    },
  },
  {
    key: 'slack',
    kind: 'action',
    icon: 'hash',
    label: 'Slack message',
    sub: 'Channel · add a webhook URL',
    desc: 'Post to a channel',
    action: {
      kind: 'webhook',
      url: null,
      method: 'POST',
      bodyKind: 'slack',
      body: null,
      headerName: null,
      headerValueEncrypted: null,
    },
  },
];

/** The comp's four logic tiles, unchanged (comp 556-561). */
export const LOGIC_STEPS: readonly StepDefinition[] = [
  {
    key: 'branch',
    kind: 'branch',
    icon: 'git-branch',
    label: 'If / else branch',
    sub: '',
    desc: 'Split into two paths',
  },
  {
    key: 'filter',
    kind: 'condition',
    icon: 'filter',
    label: 'Only continue if',
    sub: '',
    desc: 'Stop when unmatched',
  },
  {
    key: 'wait',
    kind: 'wait',
    icon: 'timer',
    label: 'Wait / delay',
    sub: 'Pause for 1 day',
    desc: 'Hold before next step',
  },
  {
    key: 'stop',
    kind: 'stop',
    icon: 'circle-stop',
    label: 'Stop workflow',
    sub: 'Ends the run',
    desc: 'Halt this run here',
  },
];

/** `automations:pick.<key>` / `.desc` — the tile's two lines. */
export function stepLabelKey(key: string): string {
  return `automations:pick.${key}`;
}
export function stepDescKey(key: string): string {
  return `automations:pick.${key}.desc`;
}

/** The comp's five operators first, then emptiness, then the date four (D18). */
export const VALUE_OPS: readonly ConditionOp[] = [
  'is',
  'is_not',
  'contains',
  'gt',
  'lt',
  'is_empty',
  'not_empty',
];
export const DATE_OPS: readonly ConditionOp[] = [
  'within_next',
  'within_last',
  'more_than_ago',
  'more_than_ahead',
];
/** A count is a number; `contains` and the relative ops are meaningless on one. */
export const COUNT_OPS: readonly ConditionOp[] = ['is', 'is_not', 'gt', 'lt'];

export const OP_LABELS: Readonly<Record<ConditionOp, { key: string; fallback: string }>> = {
  is: { key: 'automations:op.is', fallback: 'is' },
  is_not: { key: 'automations:op.isNot', fallback: 'is not' },
  contains: { key: 'automations:op.contains', fallback: 'contains' },
  gt: { key: 'automations:op.gt', fallback: 'is greater than' },
  lt: { key: 'automations:op.lt', fallback: 'is less than' },
  is_empty: { key: 'automations:op.isEmpty', fallback: 'is empty' },
  not_empty: { key: 'automations:op.notEmpty', fallback: 'is not empty' },
  within_next: { key: 'automations:op.withinNext', fallback: 'is within the next' },
  within_last: { key: 'automations:op.withinLast', fallback: 'is within the last' },
  more_than_ago: { key: 'automations:op.moreThanAgo', fallback: 'was more than … ago' },
  more_than_ahead: { key: 'automations:op.moreThanAhead', fallback: 'is more than … from now' },
};

export const UNIT_LABELS: Readonly<Record<DurationUnit, { key: string; fallback: string }>> = {
  minutes: {
    key: 'automations:unit.minutes',
    fallback: '{count, plural, one {minute} other {minutes}}',
  },
  hours: { key: 'automations:unit.hours', fallback: '{count, plural, one {hour} other {hours}}' },
  days: { key: 'automations:unit.days', fallback: '{count, plural, one {day} other {days}}' },
};

export function opNeedsOperand(op: ConditionOp): boolean {
  return op !== 'is_empty' && op !== 'not_empty';
}

export function isRelativeOp(op: ConditionOp): boolean {
  return DATE_OPS.includes(op);
}

// --- run statuses (Workflow Logs 184-185 + DEPARTURE D9) --------------------

export type RunStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface StatusMeta {
  key: string;
  fallback: string;
  icon: string;
  text: string;
  soft: string;
  /** The row's 3px left border when selected. */
  border: string;
  spin: boolean;
}

/**
 * The comp knows three (success / failed / running). The four extra are
 * D9's, and each takes a glyph the comp already uses somewhere: `hourglass`
 * for a run waiting out the undo window, `timer` for one suspended mid-flow
 * (the DELAY node's own icon), and the trace's `minus` for skipped and
 * cancelled.
 */
export const STATUS_META: Readonly<Record<RunStatus, StatusMeta>> = {
  succeeded: {
    key: 'automations:logs.status.success',
    fallback: 'Success',
    icon: 'circle-check-big',
    text: 'text-pos',
    soft: 'bg-pos-soft',
    border: 'border-s-pos',
    spin: false,
  },
  failed: {
    key: 'automations:logs.status.failed',
    fallback: 'Failed',
    icon: 'circle-x',
    text: 'text-danger',
    soft: 'bg-danger-soft',
    border: 'border-s-danger',
    spin: false,
  },
  running: {
    key: 'automations:logs.status.running',
    fallback: 'Running',
    icon: 'loader',
    text: 'text-accent',
    soft: 'bg-accent-soft',
    border: 'border-s-accent',
    spin: true,
  },
  pending: {
    key: 'automations:logs.status.pending',
    fallback: 'Starts {when}',
    icon: 'hourglass',
    text: 'text-accent',
    soft: 'bg-accent-soft',
    border: 'border-s-accent',
    spin: false,
  },
  waiting: {
    key: 'automations:logs.status.waiting',
    fallback: 'Waiting · resumes {when}',
    icon: 'timer',
    text: 'text-accent',
    soft: 'bg-accent-soft',
    border: 'border-s-accent',
    spin: false,
  },
  skipped: {
    key: 'automations:logs.status.skipped',
    fallback: 'Skipped',
    icon: 'minus',
    text: 'text-fg-subtle',
    soft: 'bg-surface-3',
    border: 'border-s-border-strong',
    spin: false,
  },
  cancelled: {
    key: 'automations:logs.status.cancelled',
    fallback: 'Cancelled',
    icon: 'minus',
    text: 'text-fg-subtle',
    soft: 'bg-surface-3',
    border: 'border-s-border-strong',
    spin: false,
  },
};

/** The comp's four trace-step tones (Workflow Logs 185), plus `wait` (D9). */
export const STEP_META: Readonly<
  Record<'ok' | 'fail' | 'run' | 'skip' | 'wait', { icon: string; text: string; soft: string; spin: boolean }>
> = {
  ok: { icon: 'check', text: 'text-pos', soft: 'bg-pos-soft', spin: false },
  fail: { icon: 'x', text: 'text-danger', soft: 'bg-danger-soft', spin: false },
  run: { icon: 'loader', text: 'text-accent', soft: 'bg-accent-soft', spin: true },
  skip: { icon: 'minus', text: 'text-fg-subtle', soft: 'bg-surface-3', spin: false },
  wait: { icon: 'timer', text: 'text-accent', soft: 'bg-accent-soft', spin: false },
};

/** "Running" is the comp's word for pending + running + waiting (D9). */
export const RUNNING_STATUSES: readonly RunStatus[] = ['pending', 'running', 'waiting'];
