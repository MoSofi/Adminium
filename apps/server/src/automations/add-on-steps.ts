// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE STEPS INSTALLED ADD-ONS GIVE TO AUTOMATIONS.
 *
 * A rule's `add-on.step` keeps two keys: the add-on and the step. What the
 * step is — its inputs, the row it writes — is read here from the add-on as
 * it is installed on the rule's own database, at the save and again at every
 * run. Nothing of an add-on's own code runs: a step is a row the engine
 * writes through the same service as a rule's "create a record".
 *
 * One reader for the save, the run, the grants and the list a person picks
 * from, so they cannot come to disagree about which steps there are.
 */
import type { AddOnStep, AddOnStepInput } from '@adminium/add-on-contracts';
import type { AutomationWriteValue } from '@adminium/meta';

import type { AddOnInstalls } from '../apps/table-ref.js';

/** A step as it stands on one database. */
export interface InstalledStep {
  addOn: string;
  /** The add-on's own name: "Offers & gift cards". */
  addOnName: string;
  step: AddOnStep;
  /** The table the step writes, as this database knows it; null while the add-on's table is not there. */
  table: string | null;
  /** For each `record` input, the table its row is picked from (null when it is not there). */
  inputTables: Readonly<Record<string, string | null>>;
}

/** What asking for one step answers. Each refusal is a different sentence, so each is its own answer. */
export type StepAnswer =
  | { state: 'ok'; step: InstalledStep }
  /** No add-on of that key is installed on this database. */
  | { state: 'no-add-on' }
  /** It is installed and cannot be used now: switched off, mid-install, or its stored manifest no longer reads. */
  | { state: 'add-on-off'; addOnName: string }
  /** It is installed and gives no step of that key (an update took it away). */
  | { state: 'no-step'; addOnName: string };

export type StepLookup = (connectionId: string, addOn: string, step: string) => StepAnswer;

function installedStep(installs: AddOnInstalls, connectionId: string, addOn: string, addOnName: string, step: AddOnStep): InstalledStep {
  const inputTables: Record<string, string | null> = {};
  for (const input of step.inputs) {
    if (input.table !== undefined) inputTables[input.key] = installs.tableOf(connectionId, addOn, input.table);
  }
  return { addOn, addOnName, step, table: installs.tableOf(connectionId, addOn, step.writes.table), inputTables };
}

/** One step of one add-on on one database, or why it cannot be had. */
export function findStep(installs: AddOnInstalls, connectionId: string, addOn: string, step: string): StepAnswer {
  const found = installs.installed(connectionId, addOn);
  if (found === null) return { state: 'no-add-on' };
  const addOnName = typeof found.manifest.name === 'string' && found.manifest.name !== '' ? found.manifest.name : addOn;
  if (found.status !== 'installed') return { state: 'add-on-off', addOnName };
  const declared = (found.manifest.addOn?.steps ?? []).find((candidate) => candidate.key === step);
  if (declared === undefined) return { state: 'no-step', addOnName };
  return { state: 'ok', step: installedStep(installs, connectionId, addOn, addOnName, declared) };
}

/** Every step a rule on this database may use: of the add-ons installed and switched on, in their keys' order. */
export function stepsOn(installs: AddOnInstalls, connectionId: string): InstalledStep[] {
  const out: InstalledStep[] = [];
  for (const key of [...(installs.keys?.(connectionId) ?? [])].sort()) {
    const found = installs.installed(connectionId, key);
    if (found === null || found.status !== 'installed') continue;
    const addOnName = typeof found.manifest.name === 'string' && found.manifest.name !== '' ? found.manifest.name : key;
    for (const step of found.manifest.addOn?.steps ?? []) out.push(installedStep(installs, connectionId, key, addOnName, step));
  }
  return out;
}

/** A run's reader of installed steps, from the process's keeper of what is installed: read fresh when a run asks. */
export function stepLookupOf(installs: () => Promise<AddOnInstalls>): () => Promise<StepLookup> {
  return async () => {
    const now = await installs();
    return (connectionId, addOn, step) => findStep(now, connectionId, addOn, step);
  };
}

/** A lookup that finds nothing: for a rule with no connection, and for a caller that has no installs to ask. */
export const NO_STEPS: StepLookup = () => ({ state: 'no-add-on' });

/** The add-on's name a refusal uses: the one it has now, else the one the rule kept, else its key. */
export function addOnNameOf(answer: StepAnswer, action: { addOn: string; addOnName?: string | undefined }): string {
  if (answer.state === 'ok') return answer.step.addOnName;
  if (answer.state !== 'no-add-on') return answer.addOnName;
  return action.addOnName !== undefined && action.addOnName !== '' ? action.addOnName : action.addOn;
}

/** Why a step cannot be used, as one sentence; null when it can. The same words at the save and under a failed run. */
export function stepRefusal(answer: StepAnswer, action: { addOn: string; step: string; addOnName?: string | undefined }): string | null {
  const name = addOnNameOf(answer, action);
  switch (answer.state) {
    case 'ok':
      return answer.step.table === null ? `The add-on ${name} has not finished installing: its table is not there yet.` : null;
    case 'no-add-on':
      return `The add-on ${name} is no longer installed.`;
    case 'add-on-off':
      return `The add-on ${name} is switched off or not ready.`;
    case 'no-step':
      return `The add-on ${name} no longer has the step “${action.step}”.`;
  }
}

/**
 * The inputs of a step that may read a PERSONAL column of the rule's record
 * (a customer's address, their name): those whose value is written only into
 * columns the add-on itself keeps personal. So a personal value a rule reads
 * for a step lands where it is protected the same way, and never in a plain
 * column, a log or another step. `masked` is asked of the step's own table.
 */
export function personalInputs(step: AddOnStep, masked: (column: string) => boolean): Set<string> {
  const into = new Map<string, string[]>();
  for (const [column, value] of Object.entries(step.writes.values)) {
    if ('input' in value) into.set(value.input, [...(into.get(value.input) ?? []), column]);
  }
  return new Set([...into].filter(([, columns]) => columns.every(masked)).map(([input]) => input));
}

/** An add-on's own words as a log or a model is given them: one line, bounded, whatever the stored manifest holds. */
function oneLine(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** An input's English label: what a refusal and a run's log call it. */
export function inputLabel(input: AddOnStepInput): string {
  return oneLine(input.label['en-US']);
}

/** The step's English name: what a run's log calls it. */
export function stepName(step: AddOnStep): string {
  return oneLine(step.name['en-US']);
}

/** What the step does, in English, in one line. */
export function stepDoes(step: AddOnStep): string {
  return oneLine(step.does['en-US']);
}

/**
 * The values of the row a step writes, as a rule's own "create a record"
 * spells them: an input's text as the rule gave it (its placeholders are
 * filled at the run like any other), a fixed text, one of the run's own words.
 * A column whose input the rule left empty is left out, so the column's own
 * default or rule stands.
 */
export function stepWriteValues(step: AddOnStep, inputs: Readonly<Record<string, string>>): Record<string, AutomationWriteValue> {
  const out: Record<string, AutomationWriteValue> = {};
  for (const [column, value] of Object.entries(step.writes.values)) {
    if ('input' in value) {
      const given = inputs[value.input] ?? '';
      if (given.trim() !== '') out[column] = given;
    } else if ('text' in value) out[column] = value.text;
    else out[column] = value.token === 'now' ? { now: true } : `{{${value.token}}}`;
  }
  return out;
}
