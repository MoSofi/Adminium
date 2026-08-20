// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Review status of each locale's translations (10-i18n-theming.md §3.3).
 *
 * Every string in a non-English bundle is either machine-drafted (`mt`),
 * human-signed-off (`reviewed`), or stale because the English moved under it
 * (`outdated`). On disk that lives in `locales/<tag>/.meta.json`, maintained by
 * `scripts/meta.mjs`. This module is the RUNTIME view of it: enough for the
 * locale picker to be honest about which languages have actually been read by
 * a native speaker, without shipping 19k status entries to the browser.
 *
 * The counts below are generated — run `pnpm --filter @adminium/i18n gen:review`
 * after `meta.mjs check` — precisely so that "is de-DE ready?" is answered by
 * the tracked data rather than by anyone's recollection.
 */
import { isBuiltinLocaleId, type BuiltinLocaleId, type LocaleId } from './locales.js';

/**
 * Review is a property of the COMPILED bundles, so this axis keys off
 * {@link BuiltinLocaleId}, not {@link LocaleId} (23 §5.1). Two consequences,
 * both wanted: adding a ninth compiled locale is still a compile error here,
 * and a runtime locale — whose strings live in the meta store and were never
 * seen by the review pipeline — simply has no entry and reports "not
 * reviewed" rather than widening this record into `Record<string, …>` and
 * quietly losing the exhaustiveness guarantee.
 */
type TrackedLocaleId = Exclude<BuiltinLocaleId, 'en_US'>;

export interface ReviewCoverage {
  /** Keys tracked for this locale (equal to the en-US key count). */
  tracked: number;
  reviewed: number;
  /** Machine-drafted, never read by a human reviewer. */
  mt: number;
  /** Was reviewed once, but the en-US source has changed since. */
  outdated: number;
}

/**
 * `true` when the locale clears the §3.3 v1.0 bar: 100% `reviewed` in
 * `common`/`ui`/`errors` and ≥95% in `studio`/`generated`.
 */
export interface LocaleReview extends ReviewCoverage {
  shipReady: boolean;
}

/** GENERATED — see the module docblock. `en_US` is the source and never tracked. */
export const REVIEW_STATUS: Record<TrackedLocaleId, LocaleReview> = {
  de_DE: { tracked: 3442, reviewed: 0, mt: 3407, outdated: 35, shipReady: false },
  fr_FR: { tracked: 3442, reviewed: 0, mt: 3407, outdated: 35, shipReady: false },
  cs_CZ: { tracked: 3442, reviewed: 0, mt: 3407, outdated: 35, shipReady: false },
  da_DK: { tracked: 3442, reviewed: 0, mt: 3407, outdated: 35, shipReady: false },
  zh_CN: { tracked: 3442, reviewed: 0, mt: 3407, outdated: 35, shipReady: false },
  zh_TW: { tracked: 3442, reviewed: 0, mt: 3407, outdated: 35, shipReady: false },
  ar_EG: { tracked: 3442, reviewed: 0, mt: 3407, outdated: 35, shipReady: false },
};

/**
 * `true` if this locale's copy has been through native review. `en_US` is the
 * source text, so it is trivially "reviewed".
 */
export function isReviewed(id: LocaleId): boolean {
  if (id === 'en_US') return true;
  return trackedStatus(id)?.shipReady ?? false;
}

/**
 * Narrowing guard rather than a cast: with {@link LocaleId} widened to admit
 * runtime ids, `REVIEW_STATUS[id as …]` would be an index of a literal-keyed
 * record by `string`, which this repo's `noUncheckedIndexedAccess` config
 * rejects — and papering over it by widening the record would delete the
 * exhaustiveness guarantee the record exists for.
 */
function trackedStatus(id: LocaleId): LocaleReview | undefined {
  if (!isBuiltinLocaleId(id) || id === 'en_US') return undefined;
  return REVIEW_STATUS[id];
}

/**
 * Share of a locale's strings a human has signed off, 0–1. Drives the picker's
 * secondary line; `en_US` is 1 by definition.
 */
export function reviewedFraction(id: LocaleId): number {
  if (id === 'en_US') return 1;
  const s = trackedStatus(id);
  if (s === undefined || s.tracked === 0) return 0;
  return s.reviewed / s.tracked;
}
