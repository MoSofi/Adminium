/**
 * @adminium/i18n — 8-locale registry, i18next+ICU runtime factory, Intl
 * formatter layer, RTL utils (workplan/10-i18n-theming.md). Framework-free;
 * React bindings live in the `@adminium/i18n/react` entry.
 */
export const PACKAGE_NAME = '@adminium/i18n';

export {
  LOCALES,
  LOCALE_IDS,
  dirForLocale,
  isLocaleId,
  isRtlLocale,
  localeEntry,
  localeFromTag,
  tagForLocale,
} from './locales.js';
export type { LocaleEntry, LocaleId } from './locales.js';

export { createI18n, switchLocale } from './create-i18n.js';
export type { BundleLoader, CreateI18nOptions, I18nInstance } from './create-i18n.js';

export { EN_US_RESOURCES, NAMESPACES } from './resources/index.js';
export type { Namespace, ResourceBundle } from './resources/index.js';
export { loadLocaleBundle } from './resources/lazy.js';

export { getFormatters, latnDataTag, weekInfo } from './format/index.js';
export type { FmtContext, Formatters, WeekInfo } from './format/index.js';
