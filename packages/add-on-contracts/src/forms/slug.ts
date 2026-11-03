// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FORM'S SLUG: the last part of its address (`/x/forms/<slug>`).
 *
 * One rule, held by the engine's door (a slug that breaks it is never
 * served) and by the forms add-on's builder (which refuses it as it is
 * typed), so a form the builder lets through is a form the door serves.
 *
 *  - lower-case letters, digits and dashes, 1 to 80 characters, with no dash
 *    at either end;
 *  - never one of the words the addresses themselves use: `api` (the
 *    form's own reads, `/x/forms/api/<slug>`), and `surveys` (the staff
 *    page's own path to a survey, `/add-ons/<key>/<key>/surveys/<slug>`,
 *    beside a form's `/add-ons/<key>/<key>/<slug>`).
 */

/** A slug as a form's address may carry one: lower-case letters, digits and dashes. */
export const FORM_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/** The longest a slug is. */
export const FORM_SLUG_MAX = 80;

/** The slugs no form may have: words the addresses themselves use. */
export const FORM_SLUGS_RESERVED: readonly string[] = ['api', 'surveys'];

/** Whether a form may have this slug: it keeps the rule, and is no reserved word. */
export function isFormSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && FORM_SLUG.test(slug) && !FORM_SLUGS_RESERVED.includes(slug);
}
