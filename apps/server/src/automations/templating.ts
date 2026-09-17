// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE TOKEN GRAMMAR, DOCUMENTED ONCE.
 *
 * A rule has two places a person writes a value that should come from the
 * record: an action FIELD (the recipient address, a webhook body, a column
 * value, a notification title) and an email TEMPLATE. Those are two different
 * substitution engines, and the temptation is to give them two grammars.
 *
 * They get one. `renderEmail`'s `PLACEHOLDER_RE` already admits dots
 * (`[A-Za-z0-9_.-]+`, `email/render.ts`), so `{{record.email}}` is a legal
 * token in a template the moment `vars` carries that key — which is exactly
 * what `actions/email.ts` puts there. So the guide has one sentence to teach
 * and a person who learns it in the inspector already knows it in the editor.
 *
 * --- What resolves ---------------------------------------------------------
 *
 *   {{record.<column>}}   a column of the record this run is about
 *   {{now}}               the run's instant, ISO-8601
 *   {{ruleName}}          the rule's name
 *   {{recordLabel}}       the record's display label
 *
 * And nothing else. An unknown token is left VERBATIM rather than blanked:
 * a webhook body that arrives with `{{customer.name}}` still in it tells an
 * operator exactly what they typed wrong, where an empty string tells them
 * the field was empty.
 *
 * --- Masked columns are absent, not blank ----------------------------------
 *
 * The RUN reads the record unmasked — it has to, to address the email. But a
 * column the classifier masks is left out of the token map entirely, so the
 * token renders as itself and an operator can see that the value was withheld
 * rather than empty. `{{record.email}}` on a masked address is the one
 * exception the email step makes for itself, and it makes it deliberately:
 * see `actions/email.ts`.
 */

import type { ResolvedTable } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';

/** The same shape `renderEmail` takes for its `vars`. */
export type TokenMap = Record<string, string>;

const TOKEN_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export interface TokenContext {
  row: Row | null;
  table: ResolvedTable | null;
  ruleName: string;
  recordLabel: string;
  now: number;
  /**
   * Include masked columns. Only the email step's recipient resolution sets
   * this, and only for the column it is addressing.
   */
  includeMasked?: boolean | undefined;
}

/**
 * Every token a run can resolve, as strings — the map handed to
 * `substitute()` here AND to `renderEmail`'s `vars` there. Both names for a
 * column are present: `record.email` (the documented grammar) and the bare
 * `email` (so a template someone wrote by hand reads naturally).
 */
export function tokensFor(ctx: TokenContext): TokenMap {
  const tokens: TokenMap = {
    now: new Date(ctx.now).toISOString(),
    ruleName: ctx.ruleName,
    recordLabel: ctx.recordLabel,
  };
  if (ctx.row === null || ctx.table === null) return tokens;
  for (const [name, column] of ctx.table.columns) {
    if (!(ctx.includeMasked ?? false) && (column.masked || column.secret)) continue;
    const value = asText(ctx.row[name]);
    tokens[`record.${name}`] = value;
    tokens[name] = value;
  }
  return tokens;
}

/** Substitute known tokens; leave unknown ones exactly as written. */
export function substitute(text: string, tokens: TokenMap): string {
  return text.replace(TOKEN_RE, (whole, name: string) => {
    const value = tokens[name];
    return value === undefined ? whole : value;
  });
}

/** True when the text carries at least one token. */
export function hasTokens(text: string): boolean {
  TOKEN_RE.lastIndex = 0;
  return TOKEN_RE.test(text);
}
