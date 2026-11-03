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
 *
 * --- A person, a row named by a column, the record's own name ------------
 *
 * A `person` input names whose row of a people table the step is about: the
 * rule's record itself (`@record`), when an app declares its table as
 * people, or the person one link of it names (`@link:<column>`: the job's
 * main contact). The run reads that row as the system, through the app's
 * people declaration, and gives the step's columns its fields: the address
 * and the name (personal: only into columns the add-on keeps personal, and
 * never into the log), the language (the install's own where the table
 * keeps none), the company they work for, and the row as the consent log
 * names it (its table and key). Nobody there, or no address: the step fails
 * by name and writes nothing.
 *
 * A `record` input may name its row by a unique column in place of its key
 * (`by`: a survey by its slug), and hold the rows it may name to some values
 * (`where`: only live surveys). The run finds the row; a name that finds
 * none fails by name. The `recordTable` and `recordKey` tokens are the rule's
 * record as other rows name it: its table's stored name and its key.
 */
import { randomUUID } from 'node:crypto';

import { ADD_ON_STEP_PERSONAL_FIELDS, type AddOnStepInput, type AddOnStepPersonField, type AddOnStepWhere } from '@adminium/add-on-contracts';
import { FORM_LANGUAGES } from '@adminium/add-on-contracts/forms';
import { placeholdersIn } from '@adminium/manifest';
import { settingsRepo, type AutomationAction } from '@adminium/meta';
import { sql } from 'kysely';

import type { ResolvedTable } from '../../crud/identifiers.js';
import { labelColumnFor } from '../../crud/labels.js';
import type { Row } from '../../crud/mask.js';
import { pkLabel } from '../../crud/records.js';
import { normalizeWriteValue } from '../../crud/write-values.js';
import { outboundKey } from '../../documents/compose.js';
import { peopleTablesOf } from '../../people/tables-of.js';
import { NO_STEPS, inputLabel, personSource, personalInputs, stepName, stepRefusal, type InstalledStep } from '../add-on-steps.js';
import { substitute, tokensFor, type TokenMap } from '../templating.js';
import { assertWritable, createRow, nowValueFor, sourceOf } from './record-write.js';
import { ActionFailure, type ActionContext, type ActionResult } from './types.js';

type StepAction = Extract<AutomationAction, { kind: 'add-on.step' }>;

/** A typed or read address, as a mail server would take it. */
const ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** A number as every engine reads it the same way: digits, with a decimal part or without. */
const NUMBER = /^-?\d+(\.\d+)?$/;

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
  return tokensFor({ row: ctx.source.row, table: ctx.source.table, related: ctx.source.related, people: ctx.source.people, was: ctx.source.was, ruleName: ctx.rule.name, recordLabel: ctx.source.record.label, now: ctx.now, includeMasked: true });
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
    // A person is read by its own path below: what the rule keeps is which person, never a value.
    if (input.kind === 'person') continue;
    const label = inputLabel(input);
    // Judged as the rule wrote it, before anything is filled in: a value that happens to hold braces is not a placeholder, and is never quoted.
    const written = action.inputs[input.key] ?? '';
    const tokens = personal.has(input.key) ? personalTokens(ctx) : ctx.tokens;
    const unfilled = placeholdersIn(written).find((placeholder) => placeholder.backup === undefined && !Object.hasOwn(tokens, placeholder.name));
    if (unfilled !== undefined) throw new ActionFailure(`${name}: “${label}” reads ${unfilled.whole}, which nothing fills.`);
    const value = substitute(written, tokens).trim();
    if (value === '') {
      if (input.required === true) throw new ActionFailure(`${name}: “${label}” has no value for this record.`);
      continue;
    }
    if (input.kind === 'email' && !ADDRESS.test(value)) throw new ActionFailure(`${name}: “${label}” does not hold an email address for this record.`);
    if (input.kind === 'number' && !NUMBER.test(value)) throw new ActionFailure(`${name}: “${label}” is not a number for this record.`);
    if (input.kind === 'choice' && !(input.options ?? []).some((option) => option.value === value)) {
      throw new ActionFailure(`${name}: “${label}” is none of its choices (${(input.options ?? []).map((option) => option.value).join(', ')}).`);
    }
    out[input.key] = value;
  }
  return out;
}

/** A person a step is about, read as the system: each field, with null where their row keeps none. */
type PersonFields = Readonly<Record<AddOnStepPersonField, string | null>>;

/** A language as a form speaks it (`de-DE`): the value itself, else another region of the same language, else null. */
export function formLanguageOf(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const tag = value.trim().replace('_', '-').toLowerCase();
  return FORM_LANGUAGES.find((language) => language.toLowerCase() === tag) ?? FORM_LANGUAGES.find((language) => language.toLowerCase().split('-')[0] === tag.split('-')[0]) ?? null;
}

/** The install's own language, as a form speaks it: what a person whose table keeps no language is written to in. */
async function installLanguage(ctx: ActionContext): Promise<string> {
  return formLanguageOf(await settingsRepo(ctx.meta).get('locale.default')) ?? 'en-US';
}

/** A text a row holds, or null. */
function textOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/** One row of a table by one of its columns, read as the system; null when there is none. */
async function rowBy(ctx: ActionContext, table: ResolvedTable, column: string, value: unknown, where: readonly AddOnStepWhere[] = []): Promise<Row | null> {
  const source = sourceOf(ctx);
  let query = source.db.selectFrom(table.id as never).selectAll().where(sql.ref(column), '=', value as never);
  for (const condition of where) {
    const held = table.columns.get(condition.column);
    query = query.where(sql.ref(condition.column), '=', (held === undefined ? condition.eq : normalizeWriteValue(held, condition.eq)) as never);
  }
  const rows = (await query.limit(2).execute()) as Row[];
  // Two rows hold it: it names neither.
  return rows.length === 1 ? rows[0]! : null;
}

/**
 * Whose row a `person` input names, and its fields (see the header). A
 * refusal names the step, the input and the column, never a person.
 */
async function personFields(input: AddOnStepInput, written: string, installed: InstalledStep, ctx: ActionContext): Promise<PersonFields> {
  const name = stepName(installed.step);
  const label = inputLabel(input);
  const source = sourceOf(ctx);
  const how = personSource(written);
  if (how === null) throw new ActionFailure(`${name}: “${label}” does not say whose row it is. Choose a person in the step.`);
  const people = (await peopleTablesOf(ctx.meta).all(source.connectionId, source.view.model)).filter((table) => table.kind === 'people');
  let table: ResolvedTable;
  let row: Row | null;
  if ('record' in how) {
    table = source.table;
    row = source.row;
  } else {
    // One link of the record, and no further: a person two links away is not this step's to find.
    const target = outboundKey(source.view, source.table, how.link);
    if (target === null) throw new ActionFailure(`${name}: “${label}” reads ${how.link}, which links to nothing on this record.`);
    const value = source.row[how.link];
    if (value === null || value === undefined || String(value) === '') throw new ActionFailure(`${name}: “${label}” has nobody: this record’s ${how.link} is empty.`);
    try {
      table = source.view.table(target.tableId);
    } catch {
      throw new ActionFailure(`${name}: “${label}” reads ${how.link}, whose table is not there.`);
    }
    row = await rowBy(ctx, table, target.column, value);
  }
  const declared = people.find((candidate) => candidate.table === table.id);
  if (declared === undefined) throw new ActionFailure(`${name}: “${label}” reads ${table.table?.label ?? table.name}, which no app declares as people.`);
  if (row === null) throw new ActionFailure(`${name}: “${label}” has nobody: the person this record names is not there.`);
  const email = declared.email === null ? null : textOf(row[declared.email]);
  if (email === null || !ADDRESS.test(email)) throw new ActionFailure(`${name}: “${label}” has no e-mail address for this record.`);
  const key = table.primaryKey[0];
  if (key === undefined || table.primaryKey.length !== 1) throw new ActionFailure(`${name}: “${label}” reads a table whose rows have no single key.`);
  let company: string | null = null;
  if (declared.company !== null && textOf(row[declared.company]) !== null) {
    const at = outboundKey(source.view, table, declared.company);
    const companies = at === null ? null : source.view.table(at.tableId);
    const found = at === null || companies === null ? null : await rowBy(ctx, companies, at.column, row[declared.company]);
    const labelColumn = companies === null ? null : labelColumnFor(source.view, companies);
    company = found === null || labelColumn === null ? null : textOf(found[labelColumn]);
  }
  return {
    email,
    name: declared.name === null ? null : textOf(row[declared.name]),
    language: (declared.language === null ? null : formLanguageOf(row[declared.language])) ?? (await installLanguage(ctx)),
    company,
    // As the consent log names a person: the table's id here, and the key as text.
    table: table.id,
    key: pkLabel(table, { [key]: row[key] }),
  };
}

/** Every person input of the step, read once. */
async function peopleOf(action: StepAction, installed: InstalledStep, ctx: ActionContext): Promise<Record<string, PersonFields>> {
  const out: Record<string, PersonFields> = {};
  for (const input of installed.step.inputs) {
    if (input.kind !== 'person') continue;
    const written = action.inputs[input.key] ?? '';
    if (written.trim() === '') {
      if (input.required === true) throw new ActionFailure(`${stepName(installed.step)}: “${inputLabel(input)}” has no person chosen.`);
      continue;
    }
    out[input.key] = await personFields(input, written, installed, ctx);
  }
  return out;
}

/**
 * Each `record` input that names its row by a column or holds it to some
 * values, turned into the row's key: the row is found as the system, with
 * every condition, and a name that finds none fails by name.
 */
async function resolveRecords(installed: InstalledStep, inputs: Record<string, string>, ctx: ActionContext): Promise<void> {
  const source = sourceOf(ctx);
  for (const input of installed.step.inputs) {
    if (input.kind !== 'record' || (input.by === undefined && input.where === undefined)) continue;
    const given = inputs[input.key];
    if (given === undefined) continue;
    const tableId = installed.inputTables[input.key] ?? null;
    if (tableId === null) throw new ActionFailure(`The add-on ${installed.addOnName} has not finished installing: its table is not there yet.`);
    const table = source.view.table(tableId);
    const key = table.primaryKey[0];
    if (key === undefined) throw new ActionFailure(`${stepName(installed.step)}: “${inputLabel(input)}” reads a table whose rows have no single key.`);
    const row = await rowBy(ctx, table, input.by ?? key, given, input.where ?? []);
    if (row === null) {
      const held = (input.where ?? []).map((condition) => `${condition.column} ${String(condition.eq)}`).join(', ');
      throw new ActionFailure(`${stepName(installed.step)}: no “${inputLabel(input)}” called “${given}”${held === '' ? '' : ` (${held})`} is there.`);
    }
    inputs[input.key] = String(row[key]);
  }
}

/** The row the step writes, column by column, as the columns take their values. Nothing here is read for placeholders a second time. */
function rowOf(installed: InstalledStep, table: ResolvedTable, inputs: Readonly<Record<string, string>>, people: Readonly<Record<string, PersonFields>>, ctx: ActionContext): Row {
  const row: Row = {};
  for (const [name, value] of Object.entries(installed.step.writes.values)) {
    const column = table.columns.get(name);
    if (column === undefined) throw new ActionFailure(`${table.id} has no column ${JSON.stringify(name)}: the add-on ${installed.addOnName} and its tables no longer agree.`);
    if ('input' in value) {
      // An input the rule left empty: the column keeps its own default or rule.
      if (inputs[value.input] !== undefined) row[name] = normalizeWriteValue(column, inputs[value.input] as string);
    } else if ('person' in value) {
      // A person's address and name go only where the add-on keeps them personal: never into a column anyone reads in full.
      if (ADD_ON_STEP_PERSONAL_FIELDS.includes(value.field) && !column.masked) {
        throw new ActionFailure(`${stepName(installed.step)}: ${table.id}.${name} is not kept personal, so a person's ${value.field} is not written to it.`);
      }
      const field = people[value.person]?.[value.field];
      if (field !== null && field !== undefined) row[name] = normalizeWriteValue(column, field);
    } else if ('text' in value) row[name] = normalizeWriteValue(column, value.text);
    else if (value.token === 'now') row[name] = nowValueFor(table, name, ctx.now);
    else if (value.token === 'recordTable' || value.token === 'recordKey') {
      const source = sourceOf(ctx);
      row[name] = normalizeWriteValue(column, value.token === 'recordTable' ? installed.refOf(source.table.id) : pkLabel(source.table, source.record.pk as Row));
    } else row[name] = normalizeWriteValue(column, value.token === 'ruleName' ? ctx.rule.name : (ctx.source?.record.label ?? ''));
  }
  // The row's key is Adminium's (no step may write it): a text key nothing else fills is given a fresh id, as the answer door does.
  const [key, ...more] = table.primaryKey;
  const held = key === undefined ? undefined : table.table.columns.find((candidate) => candidate.name === key);
  if (key !== undefined && more.length === 0 && row[key] === undefined && held !== undefined && held.default === null && !held.isGenerated && (table.columns.get(key)?.textish === true || held.logicalType === 'uuid')) {
    row[key] = randomUUID();
  }
  return row;
}

/** The values a failed write must not repeat: personal inputs, and every field of a person read. */
function secretsOf(personal: ReadonlySet<string>, inputs: Readonly<Record<string, string>>, people: Readonly<Record<string, PersonFields>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of personal) if (inputs[key] !== undefined) out[key] = inputs[key];
  for (const [key, fields] of Object.entries(people)) {
    for (const field of ADD_ON_STEP_PERSONAL_FIELDS) {
      const value = fields[field];
      if (value !== null) out[`${key}.${field}`] = value;
    }
  }
  return out;
}

/**
 * What a failed write says, without the personal values it was given: a
 * database quotes the value it refused ("Duplicate entry '…'"), and a step's
 * failure is kept in the run's log.
 */
export function withoutPersonal(message: string, personal: ReadonlySet<string>, inputs: Readonly<Record<string, string>>): string {
  let out = message;
  for (const key of personal) {
    const value = inputs[key];
    if (value !== undefined && value !== '') out = out.replaceAll(value, '…');
  }
  return out;
}

export async function runAddOnStepAction(action: StepAction, ctx: ActionContext): Promise<ActionResult> {
  const { step, table } = installedOf(action, ctx);
  const inputs = filledInputs(action, step, table, ctx);
  await resolveRecords(step, inputs, ctx);
  const people = await peopleOf(action, step, ctx);
  const row = rowOf(step, table, inputs, people, ctx);
  const secrets = secretsOf(personalOf(step, table), inputs, people);
  const created = await createRow(ctx, table, row).catch((error: unknown) => {
    if (error instanceof ActionFailure) throw new ActionFailure(withoutPersonal(error.message, new Set(Object.keys(secrets)), secrets));
    throw error;
  });
  return { log: ctx.text.stepOk(stepName(step.step), created.label) };
}

/**
 * Everything the run does but the write: the step is found, the inputs are
 * filled and judged, a person and a row named by a column are found. A
 * personal value is said to be there, not shown; a person never is.
 */
export async function dryRunAddOnStepAction(action: StepAction, ctx: ActionContext): Promise<ActionResult> {
  const { step, table } = installedOf(action, ctx);
  const inputs = filledInputs(action, step, table, ctx);
  await resolveRecords(step, inputs, ctx);
  const people = await peopleOf(action, step, ctx);
  rowOf(step, table, inputs, people, ctx);
  const personal = personalOf(step, table);
  const pairs = step.step.inputs
    .filter((input) => inputs[input.key] !== undefined || people[input.key] !== undefined)
    .map((input) => `${inputLabel(input)} = ${input.kind === 'person' ? 'found (kept private)' : personal.has(input.key) ? 'filled in (kept private)' : (inputs[input.key] as string).slice(0, 60)}`)
    .join(', ');
  return { log: ctx.text.stepWould(stepName(step.step), pairs === '' ? 'nothing filled in' : pairs) };
}
