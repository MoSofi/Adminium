// SPDX-License-Identifier: AGPL-3.0-only
/**
 * REFUSED VALUES, IN THE READER'S LANGUAGE.
 *
 * The server answers a refused write with 422 and `details.fields = { <column>:
 * { code } }` — a CODE, never a sentence. The wording is chosen here, on the
 * client, for two reasons: the server's English would otherwise appear in the
 * middle of a translated screen, and the same code has to read the same way
 * whether it came back from Postgres, from a column rule, or from the form's
 * own check before the request was ever made.
 *
 * THE MAP IS AN EXHAUSTIVE LITERAL. `t('ui:formDialog.issue.' + code)` would
 * compile, pass every lint, and ship keys no bundle carries — `t()` renders its
 * fallback for a missing key, so the failure is invisible in English and
 * identical in all eight locales. Spelling every key out is what lets
 * `key-coverage.test.ts` see them.
 */

/** Every code a refusal can carry — the server's and the form's own. */
export const FIELD_ISSUE_CODES = [
  'required',
  'not-allowed',
  'invalid',
  'invalid-character',
  'format',
  'too-short',
  'too-long',
  'too-small',
  'too-large',
  'out-of-range',
  'email',
  'url',
  'phone',
  'number',
  'integer',
  'duplicate',
] as const;

export type FieldIssueCode = (typeof FIELD_ISSUE_CODES)[number];

export interface FieldIssue {
  code: string;
  /** The bound a message needs: "Use at most {n} characters", "{min} or more". */
  n?: number | undefined;
}

type Translate = (key: string, fallback: string, args?: Record<string, unknown>) => string;

export function isFieldIssueCode(value: unknown): value is FieldIssueCode {
  return typeof value === 'string' && (FIELD_ISSUE_CODES as readonly string[]).includes(value);
}

/**
 * One refusal as a sentence. An unknown code — a newer server, a code this
 * build does not know — reads as the generic "not valid here" rather than as a
 * raw identifier: a person should never be shown `too_wibbly`.
 */
export function fieldIssueMessage(t: Translate, issue: FieldIssue): string {
  const n = issue.n;
  switch (issue.code) {
    case 'required':
      return t('ui:formDialog.issue.required', 'This field is required.');
    case 'not-allowed':
      return t('ui:formDialog.issue.notAllowed', 'Choose one of the listed values.');
    case 'email':
      return t('ui:formDialog.issue.email', 'Enter a valid email address.');
    case 'url':
      return t('ui:formDialog.issue.url', 'Enter a valid web address.');
    case 'phone':
      return t('ui:formDialog.issue.phone', 'Enter a valid phone number.');
    case 'number':
      return t('ui:formDialog.issue.number', 'Enter a number.');
    case 'integer':
      return t('ui:formDialog.issue.integer', 'Enter a whole number.');
    case 'too-short':
      return t('ui:formDialog.issue.tooShort', 'Use at least {n} characters.', { n: n ?? 0 });
    case 'too-long':
      return t('ui:formDialog.issue.tooLong', 'Use at most {n} characters.', { n: n ?? 0 });
    case 'too-small':
      return t('ui:formDialog.issue.tooSmall', 'Must be {min} or more.', { min: n ?? 0 });
    case 'too-large':
      return t('ui:formDialog.issue.tooLarge', 'Must be {max} or less.', { max: n ?? 0 });
    case 'out-of-range':
      return t('ui:formDialog.issue.outOfRange', 'This number is out of range.');
    case 'duplicate':
      return t('ui:formDialog.issue.duplicate', 'Already added.');
    // U+0000, usually pasted in from elsewhere: no database keeps it the same way.
    case 'invalid-character':
      return t('ui:formDialog.issue.invalidCharacter', 'This text contains a hidden character that cannot be saved. Type it again.');
    // `format` is the server's word for "a validation rule said no" with no
    // shape named; it reads as the general refusal, which is what it is.
    case 'format':
    case 'invalid':
    default:
      return t('ui:formDialog.issue.invalid', 'This value is not valid here.');
  }
}

/** The form-level line for a refusal with no column to put it under. */
export function formIssueMessage(t: Translate): string {
  return t('ui:formDialog.issue.form', 'Some values were refused. Check the marked fields.');
}

/**
 * The refusal an API client attached to its error, as messages by column.
 *
 * `fieldIssues` is what `apps/dashboard/src/api/crud.ts` puts on an `ApiError`
 * whose envelope carried `details.fields`. Anything else — a network failure, a
 * 500, a hook rejection — answers null and stays a toast.
 */
export function fieldMessagesOf(t: Translate, reason: unknown): Record<string, string> | null {
  if (typeof reason !== 'object' || reason === null || !('fieldIssues' in reason)) return null;
  const issues = (reason as { fieldIssues: unknown }).fieldIssues;
  if (typeof issues !== 'object' || issues === null) return null;
  const out: Record<string, string> = {};
  for (const [column, issue] of Object.entries(issues as Record<string, unknown>)) {
    if (typeof issue !== 'object' || issue === null) continue;
    const { code, n } = issue as { code?: unknown; n?: unknown };
    if (typeof code !== 'string') continue;
    out[column] = fieldIssueMessage(t, { code, ...(typeof n === 'number' ? { n } : {}) });
  }
  return Object.keys(out).length === 0 ? null : out;
}
