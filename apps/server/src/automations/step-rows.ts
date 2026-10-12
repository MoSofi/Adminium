// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ROW AN EARLIER STEP MADE, read by a later one.
 *
 * A "create a row" step may be given a name; every later step of the same
 * run may then read the row it made as `{{steps.<name>.<column>}}`: an
 * enquiry made into a contact, then a deal for that contact, then a
 * follow-up on that deal.
 *
 * WHERE IT IS KEPT. In the run's stored trace, on the step that made it —
 * not in memory. A run that waits ends, and comes back as a new job with
 * nothing but its trace; a map held in memory would be gone exactly when a
 * step after the wait asks for it.
 *
 * A NAME NOTHING FILLED STOPS THE RUN. Any other placeholder nobody
 * recognises is left as written; `{{steps.deal.id}}` left as written would
 * be written into a key column as text. So a step that reads a row no
 * earlier step of this run made fails, by name, before it does anything.
 */
import type { AutomationGraph, AutomationNode, AutomationTraceStep } from '@adminium/meta';

import type { ResolvedTable } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { ActionFailure } from './actions/types.js';
import type { TokenMap } from './templating.js';

/** What a named step leaves in the trace. */
export type MadeRow = NonNullable<AutomationTraceStep['made']>;

const STEP_TOKEN = /\{\{\s*steps\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*(?:\|[^{}]*)?\}\}/g;

/** Every `steps.<name>.<column>` a value spells, anywhere inside it. */
export function stepTokensIn(value: unknown, out: { name: string; column: string }[] = []): { name: string; column: string }[] {
  if (typeof value === 'string') {
    for (const match of value.matchAll(STEP_TOKEN)) out.push({ name: match[1] as string, column: match[2] as string });
  } else if (Array.isArray(value)) {
    for (const item of value) stepTokensIn(item, out);
  } else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) stepTokensIn(item, out);
  }
  return out;
}

/** A value as a token carries it: text, with nothing for an empty one. */
function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** What a named step keeps of the row it made: every column a rule may read, as text. */
export function madeRowOf(name: string, table: ResolvedTable, pk: Record<string, unknown>, row: Row, standIn = false): MadeRow {
  const values: Record<string, string> = {};
  for (const [column, resolved] of table.columns) {
    // What the product hides from the rule's author is not handed on to the next step either.
    if (resolved.secret || resolved.masked) continue;
    const text = asText(row[column]);
    if (text.length <= 4000) values[column] = text;
  }
  return { name, table: table.id, pk, values, ...(standIn ? { standIn: true } : {}) };
}

/** The rows the run's steps made so far, as the tokens later steps read. */
export function stepTokensOf(steps: readonly Pick<AutomationTraceStep, 'made' | 'status'>[]): TokenMap {
  const out: TokenMap = {};
  for (const step of steps) {
    if (step.made === undefined || step.status !== 'ok') continue;
    for (const [column, value] of Object.entries(step.made.values)) out[`steps.${step.made.name}.${column}`] = value;
  }
  return out;
}

/** Stop a step that reads a row no earlier step of this run made (or a column that row does not have). */
export function assertStepRowsMade(action: unknown, tokens: TokenMap): void {
  for (const { name, column } of stepTokensIn(action)) {
    if (tokens[`steps.${name}.${column}`] !== undefined) continue;
    const made = Object.keys(tokens).some((key) => key.startsWith(`steps.${name}.`));
    throw new ActionFailure(
      made
        ? `{{steps.${name}.${column}}}: the row "${name}" has no column ${column}.`
        : `{{steps.${name}.${column}}}: no earlier step of this run made a row called "${name}" (the step that makes it was skipped, or failed).`,
    );
  }
}

/** Every step of a flow in the order a run reaches it: a branch's own steps after the branch. */
function inOrder(graph: AutomationGraph): AutomationNode[] {
  const out: AutomationNode[] = [];
  for (const node of graph.nodes) {
    out.push(node);
    if (node.kind === 'branch') for (const branch of node.branches) out.push(...(branch.nodes as AutomationNode[]));
  }
  return out;
}

/**
 * What is wrong with a rule's named rows as it is saved: a name used twice,
 * a step that reads a row no step before it makes, a column the row's table
 * does not have or does not show its author. `tableOf` answers the table a
 * create step writes as its author reads it, or null when the step names
 * none yet.
 */
export function stepRowProblems(
  graph: AutomationGraph,
  tableOf: (table: string) => { id: string; readable: (column: string) => 'ok' | 'hidden' | 'none' } | null,
): { nodeId: string; title: string; message: string }[] {
  const out: { nodeId: string; title: string; message: string }[] = [];
  const made = new Map<string, ReturnType<typeof tableOf>>();
  for (const node of inOrder(graph)) {
    // A step reads what was made BEFORE it: never the row it is about to make itself.
    for (const { name, column } of stepTokensIn(node)) {
      if (!made.has(name)) {
        out.push({ nodeId: node.id, title: node.title, message: `{{steps.${name}.${column}}}: no step before this one makes a row called "${name}".` });
        continue;
      }
      const table = made.get(name) ?? null;
      const seen = table === null ? 'ok' : table.readable(column);
      if (seen === 'none') out.push({ nodeId: node.id, title: node.title, message: `{{steps.${name}.${column}}}: ${table!.id} has no column ${column}.` });
      if (seen === 'hidden') out.push({ nodeId: node.id, title: node.title, message: `{{steps.${name}.${column}}}: ${column} is not shown to you, so a rule of yours cannot read it.` });
    }
    if (node.kind !== 'action' || node.action.kind !== 'record.create' || node.action.name === undefined) continue;
    const name = node.action.name;
    if (made.has(name)) out.push({ nodeId: node.id, title: node.title, message: `Two steps call the row they make "${name}": give each its own name.` });
    made.set(name, node.action.table === null || node.action.table === '' ? null : tableOf(node.action.table));
  }
  return out;
}
