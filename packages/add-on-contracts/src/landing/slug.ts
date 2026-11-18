// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LANDING PAGE'S SLUG: the last part of its address (`/x/pages/<slug>`).
 *
 * One rule, held by the engine (its publish seal refuses a live page whose
 * slug breaks it, and its door never serves one) and by the add-on's editor
 * (which refuses it as it is typed), so a page the editor lets through is a
 * page the door serves.
 *
 *  - a form's slug's shape: lower-case letters, digits and dashes, 1 to 80
 *    characters, with no dash at either end;
 *  - never one of the words the addresses themselves use (`api`, `assets`),
 *    nor a word a sign-in, verification, staff or billing page is known by
 *    ({@link LANDING_SLUGS_RESERVED}), so a page can never pass for the
 *    install's own sign-in, its staff side or a bill on its own address.
 *
 * A slug names one page of an install: the seal refuses a second page with
 * the same one.
 */
import { FORM_SLUG, FORM_SLUG_MAX } from '../forms/slug.js';

/** A slug as a page's address may carry one: lower-case letters, digits and dashes. */
export const LANDING_SLUG = FORM_SLUG;

/** The longest a slug is. */
export const LANDING_SLUG_MAX = FORM_SLUG_MAX;

/**
 * The slugs no page may have: the addresses' own words, and the words a page
 * asking for a password, a code, a payment or an account would use, so a
 * page can never pass for the install's own sign-in, its staff side or a
 * bill on its own address.
 */
export const LANDING_SLUGS_RESERVED: readonly string[] = [
  // The addresses' own words.
  'api',
  'assets',
  // Signing in and its codes.
  'login',
  'log-in',
  'logon',
  'signin',
  'sign-in',
  'account',
  'password',
  'reset',
  'verify',
  'verification',
  'auth',
  'oauth',
  'sso',
  '2fa',
  // The staff side.
  'admin',
  'wp-admin',
  // Money.
  'billing',
  'payment',
  'payments',
  'invoice',
  // Help and safety.
  'support',
  'security',
];

/** Whether a page may have this slug: it keeps the rule, and is no reserved word. */
export function isLandingSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && LANDING_SLUG.test(slug) && !LANDING_SLUGS_RESERVED.includes(slug);
}
