// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The human sentence a refused page composition carries.
 *
 * What `composeForTable` used to show, verbatim, was
 * `built.warnings.map((w) => w.message).join('; ')` — engine-internal compose
 * warnings, semicolon-joined, handed to whoever hit the 422. "Required slot
 * 'calendar' of 'page-calendar' has no accepted candidate" is a true sentence
 * about the composer and tells an operator nothing about their table.
 *
 * D6 splits the fix in two, because the two halves carry different risk: the
 * FIELD stays where it was (the CLI and the page editor read it by name, so
 * moving it breaks them), and the WORDING is rebuilt from the fit report. The
 * structured report rides alongside for callers that can act on it.
 *
 * This is English, deliberately. The dashboard renders its own localized copy
 * from the structured `fit` field — that is what the field is for — and the
 * message is what reaches an API or CLI caller who has no locale to render in.
 */

import type { FitRole, TemplateFit } from '@adminium/engine';

/**
 * What each role means to someone who has never heard of a semantic tag.
 *
 * Phrased as the thing the table is missing, not as the tag that encodes it:
 * an operator has a table of appointments, not a table with an
 * `event-timestamp` column.
 */
const ROLE_PHRASE: Readonly<Record<FitRole, string>> = {
  'event-date': 'a date on each row',
  title: 'a text column to show as each row’s title',
  'status-workflow': 'a status column whose values read as workflow states',
  'person-fk': 'a link to a table of people',
  'shift-type': 'a column saying which kind of shift each row is',
};

/** "a", "a and b", "a, b and c". */
function sentenceList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] as string}`;
}

/**
 * Why this table cannot back this template, in words an operator can act on.
 *
 * Falls back through three levels, each honest about how much is known:
 * the unmet ROLES when the template declares them, the unfilled SLOT when it
 * does not, and finally the engine's own reason — which is still better than an
 * empty string when composition failed for a reason that is neither.
 */
export function fitRefusalMessage(fit: TemplateFit, engineReason: string): string {
  const unmet = fit.requirements.filter((r) => r.satisfiedBy === null && !r.optional);
  if (unmet.length > 0) {
    const phrases = unmet.map((r) => ROLE_PHRASE[r.role]);
    return `This page cannot be built from that table: it needs ${sentenceList(phrases)}.`;
  }

  if (fit.unfilled.length > 0) {
    const areas = sentenceList(fit.unfilled.map((s) => `“${s.slot}”`));
    return `This page cannot be built from that table: nothing on it can fill the ${areas} area.`;
  }

  if (fit.reason !== '') return `This page cannot be built from that table: ${fit.reason}`;
  if (engineReason !== '') return `This page cannot be built from that table: ${engineReason}`;
  return 'This page cannot be built from that table.';
}
