// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ANSWER, CHECKED: what a visitor sent, held to the form it answers.
 *
 * The browser's own checks are for the visitor's comfort; this is the check.
 * The engine runs it on every answer before anything is written, and the
 * builder's preview runs the same one, so what the page lets through and what
 * the server takes never differ.
 *
 * What it holds an answer to:
 *  - only the form's own questions, and none hidden by "show if" (a value
 *    there is refused, not dropped: the page must not send it);
 *  - each kind's own shape and bounds: required, choices and picks, a date's
 *    earliest day in the business's time zone, a number's bounds and
 *    wholeness, an e-mail address, a phone number, a text's length;
 *  - a hidden field filled from the page address's query alone;
 *  - a file answer as the upload ids the file door handed out (what they
 *    are is the file door's to say);
 *  - a tick as `true`, or nothing.
 * Every text is NFC-normalised, and every control character is taken out
 * (a long answer keeps its line breaks).
 *
 * Its own entry too (`@adminium/add-on-contracts/forms/check`), which
 * reaches no schema: a stranger's page checks answers with it and carries
 * none of the schemas' weight.
 *
 * Pure: no I/O.
 */
import type { FormQuestion, ShowIf } from './definition.js';
import type { Form } from './parse.js';
import { FORM_FILES_MAX, keepsNames, SCALE_OF } from './scales.js';

/** What an answer to one question is, once checked. */
export type FormAnswerValue = string | string[] | number | true;
/** A whole answer: question id to value, for the questions answered. */
export type FormAnswerValues = Record<string, FormAnswerValue>;

/** Why one answer was refused (one per question), or `*` for the answer as a whole. */
export const FORM_ANSWER_CODES = [
  /** The answer is not an object of question ids, or names a language the form does not speak. */
  'shape',
  'language',
  /** No question of the form has this id. */
  'unknown-question',
  /** The question is hidden by its "show if", so it takes no answer. */
  'not-shown',
  /** A hidden field is filled from the page address only. */
  'from-query',
  'required',
  /** Not text, or text with nothing left in it. */
  'text',
  'too-long',
  'email',
  'phone',
  /** Not one of the question's choices, or a choice named twice. */
  'choice',
  'too-few',
  'too-many',
  /** Not a day (yyyy-mm-dd), or before the earliest the question takes. */
  'date',
  'too-early',
  'number',
  'whole',
  'too-small',
  'too-large',
  'score',
  'stars',
  'file',
  'tick',
] as const;
export type FormAnswerCode = (typeof FORM_ANSWER_CODES)[number];

/** The key of a refusal that is about the answer as a whole. */
export const WHOLE_ANSWER = '*';

export type CheckedAnswer =
  | {
      ok: true;
      values: FormAnswerValues;
      /** The first e-mail question's answer, trimmed and in lower case; null when there is none, or the survey keeps no names. */
      email: string | null;
      /** The first name question's answer; null likewise. */
      name: string | null;
    }
  | { ok: false; errors: Record<string, FormAnswerCode> };

/** The longest a hidden field's value is kept. */
export const HIDDEN_VALUE_MAX = 200;
/** The longest e-mail address taken (the address the mail system carries). */
export const EMAIL_MAX = 254;
/** The longest a name is kept on the answer. */
export const ANSWER_NAME_MAX = 200;
/** An upload id the file door hands out. */
export const UPLOAD_ID = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * An e-mail address: a local part of 1 to 64 characters with no space, `@`,
 * angle bracket, quote, comma or semicolon, and a domain of dot-separated
 * labels ending in one of letters. Stricter than the engine's column rule
 * (`something@something.something`), which lives in the server: no package
 * both import holds an address rule.
 */
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+\p{L}[\p{L}-]{0,62}$/u;
/** A phone number as people write one: an optional +, digits, spaces and ( ) . - , with 6 to 15 digits. */
const PHONE = /^\+?\(?[0-9][0-9\s().-]*$/;
const PHONE_DIGITS = { min: 6, max: 15 } as const;
/** A number written as text: at most 16 characters, digits with an optional sign and point. */
const NUMBER_TEXT = /^-?\d+(\.\d+)?$/;
const NUMBER_TEXT_MAX = 16;
const NUMBER_MAGNITUDE = 1e12;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Lone surrogate halves: what no text holds, and what a database may refuse. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** A text as it is kept: well formed, NFC, without control characters (a long answer keeps its line breaks), trimmed. */
export function cleanText(text: string, keepLineBreaks = false): string {
  let out = text.replace(LONE_SURROGATE, '').normalize('NFC');
  if (keepLineBreaks) out = out.replace(/\r\n?/g, '\n');
  out = out.replace(/\p{Cc}/gu, (character) => (keepLineBreaks && character === '\n' ? character : ''));
  return out.trim();
}

/** How many characters a text is, counted as a database counts them. */
const lengthOf = (text: string): number => [...text].length;

/** Whether a value is one no answer was given in: nothing, a text with nothing to keep in it, no picks. */
const empty = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && cleanText(value) === '') || (Array.isArray(value) && value.length === 0);

/** Whether a "show if" holds for an answer given. */
function holds(showIf: ShowIf, value: FormAnswerValue | undefined): boolean {
  if (value === undefined) return false;
  if (showIf.includes !== undefined) return Array.isArray(value) && value.includes(showIf.includes);
  if (showIf.is !== undefined) return value === showIf.is;
  if (typeof value !== 'number') return false;
  if (showIf.atLeast !== undefined) return value >= showIf.atLeast;
  if (showIf.atMost !== undefined) return value <= showIf.atMost;
  return false;
}

/**
 * Whether a question is shown, given the answers so far and which earlier
 * questions are: one whose "show if" names a question not shown is not shown
 * either, so no chain ever runs through a hidden question.
 */
function shown(question: FormQuestion, values: Readonly<Record<string, unknown>>, visible: ReadonlySet<string>): boolean {
  if (question.kind === 'hidden') return false;
  const showIf = question.showIf;
  if (showIf === undefined) return true;
  return visible.has(showIf.question) && holds(showIf, values[showIf.question] as FormAnswerValue | undefined);
}

/**
 * The questions a visitor is shown, in order, given the answers so far. A
 * hidden field is never among them.
 */
export function visibleQuestions(form: Pick<Form, 'definition'>, values: Readonly<Record<string, unknown>>): FormQuestion[] {
  const visible = new Set<string>();
  const out: FormQuestion[] = [];
  for (const question of form.definition.questions) {
    if (!shown(question, values, visible)) continue;
    visible.add(question.id);
    out.push(question);
  }
  return out;
}

/** A number as an answer gives one: a finite number, or a short decimal written as text. */
function numberOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= NUMBER_MAGNITUDE ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length > NUMBER_TEXT_MAX || !NUMBER_TEXT.test(text)) return null;
  const n = Number(text);
  return Math.abs(n) <= NUMBER_MAGNITUDE ? n : null;
}

/** Whether a text is a real calendar day, `yyyy-mm-dd`. */
function isDay(text: string): boolean {
  const match = DAY.exec(text);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The day after a `yyyy-mm-dd`. */
function nextDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

/** Whether a text is an e-mail address this vocabulary takes. */
export function isEmailAddress(text: string): boolean {
  return text.length <= EMAIL_MAX && EMAIL.test(text);
}

/** Whether a text is a phone number this vocabulary takes. */
export function isPhoneNumber(text: string): boolean {
  const digits = text.replace(/\D/g, '').length;
  return PHONE.test(text) && digits >= PHONE_DIGITS.min && digits <= PHONE_DIGITS.max;
}

type Judged = { value: FormAnswerValue } | { code: FormAnswerCode };

/** One answer to one shown question, judged by its kind. `raw` is not empty. */
function judge(question: FormQuestion, raw: unknown, today: string): Judged {
  switch (question.kind) {
    case 'short':
    case 'long': {
      if (typeof raw !== 'string') return { code: 'text' };
      const text = cleanText(raw, question.kind === 'long');
      if (text === '') return { code: 'text' };
      if (lengthOf(text) > question.maxLength) return { code: 'too-long' };
      if (question.kind === 'short' && question.check === 'email' && !isEmailAddress(text)) return { code: 'email' };
      if (question.kind === 'short' && question.check === 'phone' && !isPhoneNumber(text)) return { code: 'phone' };
      return { value: text };
    }
    case 'one':
      return typeof raw === 'string' && question.choices.some((choice) => choice.id === raw) ? { value: raw } : { code: 'choice' };
    case 'several': {
      if (!Array.isArray(raw) || !raw.every((pick) => typeof pick === 'string' && question.choices.some((choice) => choice.id === pick))) return { code: 'choice' };
      const picks = raw as string[];
      if (new Set(picks).size !== picks.length) return { code: 'choice' };
      if (question.min !== undefined && picks.length < question.min) return { code: 'too-few' };
      if (question.max !== undefined && picks.length > question.max) return { code: 'too-many' };
      return { value: [...picks] };
    }
    case 'date': {
      if (typeof raw !== 'string' || !isDay(raw)) return { code: 'date' };
      const earliest = question.from === 'today' ? today : question.from === 'tomorrow' ? nextDay(today) : null;
      return earliest !== null && raw < earliest ? { code: 'too-early' } : { value: raw };
    }
    case 'number': {
      const n = numberOf(raw);
      if (n === null) return { code: 'number' };
      if (question.whole === true && !Number.isInteger(n)) return { code: 'whole' };
      if (question.min !== undefined && n < question.min) return { code: 'too-small' };
      if (question.max !== undefined && n > question.max) return { code: 'too-large' };
      return { value: n };
    }
    case 'score':
    case 'stars': {
      const n = numberOf(raw);
      const scale = SCALE_OF[question.kind];
      return n !== null && Number.isInteger(n) && n >= scale.min && n <= scale.max ? { value: n } : { code: question.kind };
    }
    case 'file': {
      const ids = typeof raw === 'string' ? [raw] : raw;
      if (!Array.isArray(ids) || ids.length > (question.many === true ? FORM_FILES_MAX : 1)) return { code: 'file' };
      if (!ids.every((id) => typeof id === 'string' && UPLOAD_ID.test(id)) || new Set(ids).size !== ids.length) return { code: 'file' };
      return { value: [...(ids as string[])] };
    }
    case 'tick':
      return raw === true ? { value: true } : { code: 'tick' };
    case 'hidden':
      // Never reached: a hidden field is filled from the query, never from the answer.
      return { code: 'from-query' };
  }
}

/**
 * An answer to a form, checked: the values kept, the person's e-mail address
 * and name when the form keeps them — or every refusal, one per question.
 *
 * `today` is the business's own date (`yyyy-mm-dd` in its time zone), which a
 * date question's earliest day counts from. `query` is the page address's
 * query, the one place a hidden field is filled from.
 */
export function checkAnswer(
  form: Form,
  raw: unknown,
  context: { language: string; today: string; query?: Readonly<Record<string, string | readonly string[] | undefined>> | undefined },
): CheckedAnswer {
  const errors: Record<string, FormAnswerCode> = {};
  const { definition } = form;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: { [WHOLE_ANSWER]: 'shape' } };
  if (!(definition.languages as readonly string[]).includes(context.language)) errors[WHOLE_ANSWER] = 'language';
  const given = raw as Readonly<Record<string, unknown>>;
  const byId = new Map(definition.questions.map((question) => [question.id, question]));
  for (const key of Object.keys(given)) {
    const question = byId.get(key);
    if (question === undefined) errors[/^q[a-z0-9]{1,15}$/.test(key) ? key : WHOLE_ANSWER] = 'unknown-question';
    else if (question.kind === 'hidden' && !empty(given[key])) errors[key] = 'from-query';
  }

  const values: FormAnswerValues = {};
  const visible = new Set<string>();
  for (const question of definition.questions) {
    if (question.kind === 'hidden') {
      const found = context.query?.[question.param];
      const first = typeof found === 'string' ? found : Array.isArray(found) ? (found as readonly string[])[0] : undefined;
      const text = first === undefined ? '' : [...cleanText(first)].slice(0, HIDDEN_VALUE_MAX).join('').trim();
      if (text !== '') values[question.id] = text;
      continue;
    }
    const value = given[question.id];
    // A question shown by an answer that was itself refused is not judged: whether it is asked waits for that answer.
    if (question.showIf !== undefined && question.showIf.question in errors) continue;
    if (!shown(question, values, visible)) {
      if (!empty(value)) errors[question.id] = 'not-shown';
      continue;
    }
    visible.add(question.id);
    if (empty(value)) {
      if (question.required) errors[question.id] = 'required';
      continue;
    }
    const judged = judge(question, value, context.today);
    if ('code' in judged) errors[question.id] ??= judged.code;
    else values[question.id] = judged.value;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  // The person: kept only where the form keeps who answered.
  const keeps = keepsNames(form.settings);
  const firstOf = (test: (question: FormQuestion) => boolean): string | null => {
    const question = definition.questions.find((candidate) => test(candidate) && typeof values[candidate.id] === 'string');
    return question === undefined ? null : (values[question.id] as string);
  };
  const email = keeps ? firstOf((question) => question.kind === 'short' && question.check === 'email') : null;
  const name = keeps ? firstOf((question) => question.kind === 'short' && question.role === 'name') : null;
  return {
    ok: true,
    values,
    email: email === null ? null : email.toLowerCase(),
    name: name === null ? null : [...name].slice(0, ANSWER_NAME_MAX).join(''),
  };
}
