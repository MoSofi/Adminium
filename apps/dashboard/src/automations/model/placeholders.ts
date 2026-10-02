// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT FILLS EACH PLACEHOLDER OF AN EMAIL STEP'S TEMPLATE — the client's copy.
 *
 * A template is written once and a rule can send it about any table, so
 * `{{first_name}}` is filled on a table with that column and sent AS WRITTEN
 * on one whose column is `name`. The run still sends (its trace names what
 * went out unfilled); this is what lets the inspector say so BEFORE the first
 * customer reads a pair of braces.
 *
 * The rule is the server's, restated (`automations/actions/email.ts` there):
 * a placeholder is filled by the step's own `vars`, by one of the four names
 * every rule's email can read, or by a column of the record the run is about
 * — as `{{record.<column>}}` or the bare `{{<column>}}`. Nothing else.
 */

import type { SourceTable, SourceTemplate, Sources } from '../api.js';
import { flatten, type Action, type FlowNode, type Graph } from './graph.js';

type EmailAction = Extract<Action, { kind: 'email' }>;

/** What every rule's email can read whatever its record is. */
export const RULE_EMAIL_VARS: readonly string[] = ['now', 'ruleName', 'recordLabel', 'appName'];

/**
 * `mapped` — the step says what fills it. `record` — a column of the record.
 * `rule` — one of {@link RULE_EMAIL_VARS}. `unfilled` — sent as written.
 */
export type PlaceholderState = 'mapped' | 'record' | 'rule' | 'unfilled';

export interface PlaceholderRow {
  name: string;
  state: PlaceholderState;
}

const RECORD_PREFIX = 'record.';

export function placeholderState(name: string, action: EmailAction, table: SourceTable | null): PlaceholderState {
  if (action.vars !== undefined && Object.hasOwn(action.vars, name)) return 'mapped';
  if (RULE_EMAIL_VARS.includes(name)) return 'rule';
  const column = name.startsWith(RECORD_PREFIX) ? name.slice(RECORD_PREFIX.length) : name;
  if (table?.columns.some((candidate) => candidate.name === column) === true) return 'record';
  return 'unfilled';
}

export function templateOf(sources: Sources | null, action: EmailAction): SourceTemplate | null {
  if (action.templateKey === null || action.templateKey === '') return null;
  return sources?.templates.find((row) => row.key === action.templateKey) ?? null;
}

/** The template's placeholders in reading order, each with what fills it. */
export function placeholderRows(
  action: EmailAction,
  template: SourceTemplate | null,
  table: SourceTable | null,
): PlaceholderRow[] {
  return (template?.placeholders ?? []).map((name) => ({ name, state: placeholderState(name, action, table) }));
}

/** `{{record.status}}` → `status` when that is exactly a column of the table; else null. */
export function columnOfValue(value: string, table: SourceTable | null): string | null {
  const match = /^\{\{record\.([A-Za-z0-9_.-]+)\}\}$/.exec(value);
  const name = match?.[1];
  if (name === undefined) return null;
  return table?.columns.some((candidate) => candidate.name === name) === true ? name : null;
}

/** The step's `vars` without the entries a newly picked template does not read. */
export function varsFor(action: EmailAction, template: SourceTemplate | null): Record<string, string> {
  const reads = new Set(template?.placeholders ?? []);
  return Object.fromEntries(Object.entries(action.vars ?? {}).filter(([name]) => reads.has(name)));
}

/** The first email step that would send a placeholder as written, with the names. */
export function firstUnfilledEmail(
  graph: Graph,
  sources: Sources | null,
  table: SourceTable | null,
): { node: FlowNode; names: string[] } | null {
  for (const node of flatten(graph)) {
    if (node.kind !== 'action' || node.action.kind !== 'email') continue;
    const names = placeholderRows(node.action, templateOf(sources, node.action), table)
      .filter((row) => row.state === 'unfilled')
      .map((row) => row.name);
    if (names.length > 0) return { node, names };
  }
  return null;
}

/** `{{a}}, {{b}}` — at most three named, the rest counted. */
export function listPlaceholders(names: readonly string[]): string {
  const shown = names
    .slice(0, 3)
    .map((name) => `{{${name}}}`)
    .join(', ');
  return names.length > 3 ? `${shown} +${String(names.length - 3)}` : shown;
}
