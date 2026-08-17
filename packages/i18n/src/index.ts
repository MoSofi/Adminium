// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @adminium/i18n — 8-locale registry, i18next+ICU runtime factory, Intl
 * formatter layer, RTL utils (10-i18n-theming.md). Framework-free;
 * React bindings live in the `@adminium/i18n/react` entry.
 */
export const PACKAGE_NAME = '@adminium/i18n';

export {
  BUILTIN_LOCALE_IDS,
  LOCALES,
  LOCALE_ID_RE,
  LOCALE_IDS,
  allLocales,
  availableLocales,
  dirForLocale,
  intlTagForLocale,
  isBuiltinLocaleId,
  isLocaleId,
  isRtlLocale,
  localeEntry,
  localeFromTag,
  pluralCategoriesForLocale,
  resetRuntimeLocales,
  setRuntimeLocales,
  tagForLocale,
  tagFromLocaleId,
} from './locales.js';
export type { BuiltinLocaleId, LocaleEntry, LocaleId, RuntimeLocaleEntry } from './locales.js';

export { createI18n, switchLocale } from './create-i18n.js';
export {
  createI18nWithOverrides,
  mergeOverrides,
  overrideTag,
  rebuildWithOverrides,
} from './overrides.js';
export type { CreateI18nWithOverridesOptions, OverrideMap } from './overrides.js';
export {
  clearFormatFailures,
  formatFailures,
  recordFormatFailure,
} from './format-errors.js';
export type { FormatFailure } from './format-errors.js';
export type { BundleLoader, CreateI18nOptions, I18nInstance } from './create-i18n.js';

export { EN_US_RESOURCES, NAMESPACES } from './resources/index.js';
export type { Namespace, ResourceBundle } from './resources/index.js';
export { loadLocaleBundle } from './resources/lazy.js';

// NOTE: the key index (`./keys.js`), the write validator
// (`./validate-message.js`) and the generated a11y-critical key list
// (`./a11y-keys.js`) are deliberately NOT re-exported here. They are
// EDIT-TIME concerns — only the server's translation routes and the editor
// need them — and the 458-entry `Set` literal in particular is not something
// Rollup will drop from the dashboard's entry chunk just because nothing
// references it. Import them from `@adminium/i18n/editing` instead; the
// dashboard's entry budget (`check-entry-budget.mjs`) is why.

export { formatFallback } from './fallback.js';

export {
  bumpI18nRevision,
  getI18nRevision,
  resetI18nRevision,
  subscribeI18nRevision,
} from './revision.js';

export { REVIEW_STATUS, isReviewed, reviewedFraction } from './review-status.js';
export type { LocaleReview, ReviewCoverage } from './review-status.js';

export { getFormatters, latnDataTag, weekInfo } from './format/index.js';
export type { FmtContext, Formatters, WeekInfo } from './format/index.js';
