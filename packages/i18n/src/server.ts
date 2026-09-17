// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Server-side i18n.
 *
 * A Node instance over the same bundles, for the surfaces that render text
 * outside the browser: system email, scheduled-report subjects, job output.
 * No React import anywhere on this path — that is the whole reason it is a
 * separate entry point.
 *
 * Runtime overrides ride along, so an operator who reworded something in the
 * Translations editor sees it in their mail too. The caller supplies them
 * (this package cannot reach the meta store; the import matrix keeps it
 * dependency-free).
 *
 * CONCURRENCY NOTE: a long-lived server creates one of these per recipient
 * locale, repeatedly, from a process-global compiled bundle. That is only
 * safe because `createI18n` deep-clones before handing anything to i18next
 * — without it, the first override applied would rewrite the compiled
 * English for every later instance in the process.
 */

import type { I18nInstance } from './create-i18n.js';
import { createI18nWithOverrides, type OverrideMap } from './overrides.js';
import { type LocaleId } from './locales.js';
import { loadLocaleBundle } from './resources/lazy.js';
import { DEFERRED_NAMESPACES } from './resources/namespaces.js';

export interface CreateServerI18nOptions {
  /** Recipient's resolved locale (their pref → workspace default → en_US). */
  locale: LocaleId;
  /** DB-sourced overrides keyed by BCP-47 tag; omit for compiled text only. */
  overrides?: OverrideMap | undefined;
}

/**
 * Build a translator for one recipient. Missing keys fall through the normal
 * chain to compiled en-US, so a partially translated locale still produces a
 * complete email rather than a half-empty one.
 */
export async function createServerI18n(opts: CreateServerI18nOptions): Promise<I18nInstance> {
  const instance = await createI18nWithOverrides({
    locale: opts.locale,
    loadBundle: loadLocaleBundle,
    ...(opts.overrides === undefined ? {} : { overrides: opts.overrides }),
  });
  // `createI18n` initialises with EAGER_NAMESPACES only, because in the browser
  // a deferred namespace is awaited by the surface that owns it. There is no
  // such surface here: this instance renders whole documents in one pass —
  // system email, invoices, campaign sends — and a namespace it has not loaded
  // resolves to the call site's defaultValue, i.e. silent English for every
  // non-English recipient rather than a missing-key error. Loading the whole
  // deferred set costs nothing on a server (no chunk, no wire) and is done HERE
  // rather than in a caller because there are two wrappers — `translatorFor`
  // and the built-in template seeder `translatorForLocale` — and patching only
  // one seeds English rows into `adminium_email_templates` for 7 locales.
  await instance.loadNamespaces([...DEFERRED_NAMESPACES]);
  return instance;
}

export type { I18nInstance, OverrideMap };
