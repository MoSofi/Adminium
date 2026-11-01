// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the page holds of an answer while it is typed, and how it is read:
 * which questions are shown ("show if", the vocabulary's own
 * `visibleQuestions`), what goes to the server, and the check run before
 * Send (the vocabulary's own `checkAnswer`: the server runs it again, and
 * the page never decides).
 */
import type { Form, FormDefinition, FormQuestion } from '@adminium/add-on-contracts/forms';
// The check alone, which reaches no schema: the page carries none of the schemas' weight.
import { checkAnswer, visibleQuestions, WHOLE_ANSWER } from '@adminium/add-on-contracts/forms/check';

/** One question's value as the page keeps it: text as typed, picks, a score, a tick. */
export type Held = string | string[] | number | boolean | undefined;
export type HeldValues = Readonly<Record<string, Held>>;

const NUMBER_TEXT = /^-?\d+(\.\d+)?$/;

/** The vocabulary's form, for its pure checks: the definition the API sent, and no settings a stranger is shown. */
export function formOf(definition: FormDefinition): Form {
  return { definition, settings: { becomes: null, tell: [], limits: { perHour: 1, harder: false } } };
}

/** The values as "show if" reads them: a number question's text as its number. */
function typed(definition: FormDefinition, values: HeldValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const question of definition.questions) {
    const value = values[question.id];
    if (question.kind === 'number' && typeof value === 'string') {
      const text = value.trim();
      if (NUMBER_TEXT.test(text)) out[question.id] = Number(text);
    } else if (value !== undefined && value !== false) {
      out[question.id] = value;
    }
  }
  return out;
}

/** The questions shown now, in order: never a hidden field, never one whose "show if" does not hold. */
export function shownQuestions(form: Form, values: HeldValues): FormQuestion[] {
  return visibleQuestions(form, typed(form.definition, values));
}

/** Whether a value says nothing: empty text, no picks, no tick. */
function empty(value: Held): boolean {
  return value === undefined || value === false || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0);
}

/** What is sent for the questions shown now: nothing for an empty one, never a value of one not shown. */
export function answerValues(form: Form, values: HeldValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const question of shownQuestions(form, values)) {
    // A file is the file door's to take; until it is, nothing is sent for one.
    if (question.kind === 'file') continue;
    const value = values[question.id];
    if (empty(value)) continue;
    out[question.id] = question.kind === 'number' && typeof value === 'string' ? value.trim() : value;
  }
  return out;
}

/** The form's hidden values, from the page's own address: only the parameters the form names. */
export function hiddenQuery(definition: FormDefinition, query: URLSearchParams | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (query === null) return out;
  for (const question of definition.questions) {
    if (question.kind !== 'hidden') continue;
    const value = query.get(question.param);
    if (value !== null && value.trim() !== '') out[question.param] = value;
  }
  return out;
}

/** The check before Send: each question's refusal by its id, and the whole answer's under `*`. */
export function checkBeforeSend(form: Form, values: HeldValues, ctx: { language: string; today: string; query: Record<string, string> }): Record<string, string> {
  const checked = checkAnswer(form, answerValues(form, values), ctx);
  return checked.ok ? {} : checked.errors;
}

export { WHOLE_ANSWER };
