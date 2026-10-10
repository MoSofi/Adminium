// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A STEP AN ADD-ON GIVES — "issue a voucher to the order's customer".
 *
 * The add-on's manifest says what the step is called, what a person fills in
 * and the one row of one of its own tables the step makes. The run reads that
 * from the add-on as it is installed NOW, fills the inputs from the rule's
 * record, and makes the row through the same door as "create a record"
 * (`createRow`): the add-on's column rules decide the code, its outbox mails
 * it, another rule may react. No code of the add-on runs here.
 *
 * --- An add-on that is gone ------------------------------------------------
 *
 * Removing an add-on does not edit rules. The step stays with its settings
 * and fails by name ("The add-on Offers is no longer installed."); if the
 * add-on comes back, it works again.
 *
 * --- What a step may read --------------------------------------------------
 *
 * An input is text with the rule's placeholders, filled like any other field
 * of a rule: a personal column is not a placeholder. One exception: an input
 * whose value goes ONLY into columns the add-on itself keeps personal (the
 * voucher holder's address, their name) may read a personal column of the
 * record. It is written to the add-on's row, protected there the same way,
 * and never to the run's log.
 */
import { placeholdersIn } from '@adminium/manifest';
import type { AutomationAction } from '@adminium/meta';

import type { ResolvedTable } from '../../crud/identifiers.js';
import type { Row } from '../../crud/mask.js';
import { normalizeWriteValue } from '../../crud/write-values.js';
import { NO_STEPS, inputLabel, personalInputs, stepName, stepRefusal, type InstalledStep } from '../add-on-steps.js';
import { substitute, tokensFor, type TokenMap } from '../templating.js';
import { assertWritable, createRow, nowValueFor, sourceOf } from './record-write.js';
import { ActionFailure, type ActionContext, type ActionResult } from './types.js';

type StepAction = Extract<AutomationAction, { kind: 'add-on.step' }>;

/** A typed or read address, as a mail server would take it. */
const ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** The step as installed on the run's own database, or the failure that says why it cannot run. */
function installedOf(action: StepAction, ctx: ActionContext): { step: InstalledStep; table: ResolvedTable } {
  const source = sourceOf(ctx);
  const answer = (ctx.steps ?? NO_STEPS)(source.connectionId, action.addOn, action.step);
  const refusal = stepRefusal(answer, action);
  if (refusal !== null || answer.state !== 'ok' || answer.step.table === null) throw new ActionFailure(refusal ?? 'This step cannot run.');
  let table: ResolvedTable;
  try {
    table = source.view.table(answer.step.table);
  } catch {
    throw new ActionFailure(`The add-on ${answer.step.addOnName} has not finished installing: its table is not there yet.`);
  }
  assertWritable(table);
  return { step: answer.step, table };
}

/** What a personal input may read: the rule's own words, and the record's personal columns with them. */
function personalTokens(ctx: ActionContext): TokenMap {
  if (ctx.source === null) return ctx.tokens;
  return tokensFor({ row: ctx.source.row, table: ctx.source.table, related: ctx.source.related, ruleName: ctx.rule.name, recordLabel: ctx.source.record.label, now: ctx.now, includeMasked: true });
}

/** The inputs of a step whose value is kept personal by the add-on's own table. */
function personalOf(installed: InstalledStep, table: ResolvedTable): Set<string> {
  return personalInputs(installed.step, (column) => table.columns.get(column)?.masked === true);
}

/** Each input as this run fills it; a refusal names the step and the input, never the value. */
function filledInputs(action: StepAction, installed: InstalledStep, table: ResolvedTable, ctx: ActionContext): Record<string, string> {
  const name = stepName(installed.step);
  const personal = personalOf(installed, table);
  const out: Record<string, string> = {};
  for (const input of installed.step.inputs) {
    const label = inputLabel(input);
    const value = substitute(action.inputs[input.key] ?? '', personal.has(input.key) ? personalTokens(ctx) : ctx.tokens).trim();
    const unfilled = placeholdersIn(value)[0];
    if (unfilled !== undefined) throw new ActionFailure(`${name}: “${label}” reads ${unfilled.whole}, which nothing fills.`);
    if (value === '') {
      if (input.required === true) throw new ActionFailure(`${name}: “${label}” has no value for this record.`);
      continue;
    }
    if (input.kind === 'email' && !ADDRESS.test(value)) throw new ActionFailure(`${name}: “${label}” does not hold an email address for this record.`);
    if (input.kind === 'number' && !Number.isFinite(Number(value))) throw new ActionFailure(`${name}: “${label}” is not a number for this record.`);
    if (input.kind === 'choice' && !(input.options ?? []).some((option) => option.value === value)) {
      throw new ActionFailure(`${name}: “${label}” is none of its choices (${(input.options ?? []).map((option) => option.value).join(', ')}).`);
    }
    out[input.key] = value;
  }
  return out;
}

/** The row the step writes, column by column, as the columns take their values. Nothing here is read for placeholders a second time. */
function rowOf(installed: InstalledStep, table: ResolvedTable, inputs: Readonly<Record<string, string>>, ctx: ActionContext): Row {
  const row: Row = {};
  for (const [name, value] of Object.entries(installed.step.writes.values)) {
    const column = table.columns.get(name);
    if (column === undefined) throw new ActionFailure(`${table.id} has no column ${JSON.stringify(name)}: the add-on ${installed.addOnName} and its tables no longer agree.`);
    if ('input' in value) {
      // An input the rule left empty: the column keeps its own default or rule.
      if (inputs[value.input] !== undefined) row[name] = normalizeWriteValue(column, inputs[value.input] as string);
    } else if ('text' in value) row[name] = normalizeWriteValue(column, value.text);
    else if (value.token === 'now') row[name] = nowValueFor(table, name, ctx.now);
    else row[name] = normalizeWriteValue(column, value.token === 'ruleName' ? ctx.rule.name : (ctx.source?.record.label ?? ''));
  }
  return row;
}

export async function runAddOnStepAction(action: StepAction, ctx: ActionContext): Promise<ActionResult> {
  const { step, table } = installedOf(action, ctx);
  const created = await createRow(ctx, table, rowOf(step, table, filledInputs(action, step, table, ctx), ctx));
  return { log: ctx.text.stepOk(stepName(step.step), created.label) };
}

/** Everything the run does but the write: the step is found, the inputs are filled and judged. A personal value is said to be there, not shown. */
export function dryRunAddOnStepAction(action: StepAction, ctx: ActionContext): ActionResult {
  const { step, table } = installedOf(action, ctx);
  const inputs = filledInputs(action, step, table, ctx);
  rowOf(step, table, inputs, ctx);
  const personal = personalOf(step, table);
  const pairs = step.step.inputs
    .filter((input) => inputs[input.key] !== undefined)
    .map((input) => `${inputLabel(input)} = ${personal.has(input.key) ? 'filled in (kept private)' : (inputs[input.key] as string).slice(0, 60)}`)
    .join(', ');
  return { log: ctx.text.stepWould(stepName(step.step), pairs === '' ? 'nothing filled in' : pairs) };
}
