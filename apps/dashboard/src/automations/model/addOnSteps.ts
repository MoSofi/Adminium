// SPDX-License-Identifier: AGPL-3.0-only
/**
 * STEPS FROM ADD-ONS, AS THE BUILDER READS THEM (comp `Milo Automations`, 05).
 *
 * A rule's `add-on.step` keeps two keys and what fills each input. What the
 * step is called, what it asks for and whether it is still there is read from
 * `Sources` (the server reads it from the installed add-on), so the builder
 * draws a step's fields from the add-on's own description and knows at once
 * when the add-on is gone.
 */
import { api } from '../../app/api.js';
import { getI18nInstance } from '../../i18n/t.js';
import type { EveryLanguage, SourceStep, SourceStepInput, Sources } from '../api.js';
import type { StepDefinition } from './ops.js';
import type { Action } from './graph.js';

export type StepAction = Extract<Action, { kind: 'add-on.step' }>;

/** An add-on's text in the language the screen is in; English where it has none. */
export function inLanguage(text: EveryLanguage | undefined): string {
  if (text === undefined) return '';
  const language = getI18nInstance()?.language ?? 'en-US';
  return text[language] ?? text['en-US'] ?? Object.values(text)[0] ?? '';
}

/** Every step the add-ons installed on a database give. */
export function stepsOf(sources: Sources | null, connectionId: string | null): SourceStep[] {
  if (sources === null || connectionId === null) return [];
  return sources.connections.find((connection) => connection.id === connectionId)?.steps ?? [];
}

/** The step a rule's action names, as installed now; null when its add-on is gone, off, or no longer gives it. */
export function stepOf(sources: Sources | null, connectionId: string | null, action: StepAction): SourceStep | null {
  return stepsOf(sources, connectionId).find((step) => step.addOn === action.addOn && step.key === action.step) ?? null;
}

/** The add-on's name for a step: the one it has now, else the one the rule kept, else its key. */
export function addOnNameOf(step: SourceStep | null, action: StepAction): string {
  if (step !== null) return step.addOnName;
  return action.addOnName !== undefined && action.addOnName !== '' ? action.addOnName : action.addOn;
}

/** The picker's tiles for the steps add-ons give: one a step, under the add-on's name. */
export function addOnStepTiles(sources: Sources | null, connectionId: string | null): StepDefinition[] {
  return stepsOf(sources, connectionId).map((step) => ({
    key: `add-on:${step.addOn}:${step.key}`,
    kind: 'action',
    icon: 'puzzle',
    label: inLanguage(step.name),
    sub: '',
    desc: inLanguage(step.does),
    addOnName: step.addOnName,
    action: { kind: 'add-on.step', addOn: step.addOn, step: step.key, addOnName: step.addOnName, inputs: {} },
  }));
}

/** Whether every input the step needs is filled. A step that is not there is never ready. */
export function isStepReady(action: StepAction, step: SourceStep | null): boolean {
  if (step === null) return false;
  return step.inputs.every((input) => !input.required || (action.inputs[input.key] ?? '').trim() !== '');
}

/** `{{record.customer_id.email}}` → `customer_id.email` when the whole value is one placeholder of the record; else null. */
export function columnOfInput(value: string): string | null {
  return /^\{\{\s*record\.([A-Za-z0-9_.-]+)\s*\}\}$/.exec(value.trim())?.[1] ?? null;
}

/** How an input is filled right now: from a column of the record, or with what was typed. */
export function inputMode(input: SourceStepInput, value: string): 'column' | 'text' {
  if (columnOfInput(value) !== null) return 'column';
  if (value.trim() !== '') return 'text';
  // Nothing yet: an address and a name come from the record far more often than they are typed.
  return input.kind === 'email' || input.kind === 'text' ? 'column' : 'text';
}

/** A row a `record` input may pick: what the rule keeps (its key, or the column it is named by) and what it reads as. */
export interface PickableRow {
  value: string;
  label: string;
  detail?: string | undefined;
}

/**
 * The rows a `record` input may pick when the add-on holds it to some values
 * (only live surveys): the first fifty that meet every condition, read as
 * the person editing the rule reads the table. The run asks the same of the
 * row it is given.
 */
export async function pickableRows(connectionId: string, table: string, valueColumn: string, labelColumn: string | null, where: readonly { column: string; eq: string | number | boolean }[]): Promise<PickableRow[]> {
  const search = new URLSearchParams();
  search.set('select', [...new Set([valueColumn, ...(labelColumn === null ? [] : [labelColumn])])].join(','));
  search.set('where', JSON.stringify({ and: where.map((condition) => ({ column: condition.column, op: 'eq', value: condition.eq })) }));
  search.set('limit', '50');
  const reply = await api.get<{ data: Record<string, unknown>[] }>(`/api/v1/data/${encodeURIComponent(connectionId)}/${encodeURIComponent(table)}?${search.toString()}`);
  return reply.data.flatMap((row) => {
    const value = row[valueColumn];
    if (value === null || value === undefined || String(value) === '') return [];
    const label = labelColumn === null ? null : row[labelColumn];
    return [{ value: String(value), label: label === null || label === undefined || String(label) === '' ? String(value) : String(label) }];
  });
}
