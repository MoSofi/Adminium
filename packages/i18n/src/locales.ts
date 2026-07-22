/**
 * Canonical locale registry (10-i18n-theming.md §2.1) — the single
 * source of truth for the 8 BRIEF locales. Canonical ids use the underscore
 * form (`en_US`); BCP-47 tags are derived for everything `Intl`- and
 * i18next-facing. `dir` is derived from the locale, never independently
 * settable (02-design-system.md §4.2) — adding a future RTL locale (he_IL,
 * fa_IR) is a registry data change, not a code change.
 */

export interface LocaleEntry {
  /** Canonical underscore id stored in `adminium_settings`/`adminium_user_prefs`. */
  id: string;
  /** BCP-47 tag for `Intl.*`, i18next, and the `lang` attribute. */
  tag: string;
  /** English exonym for admin surfaces. */
  english: string;
  /** Native endonym — locale pickers always show this (§7.3). */
  native: string;
  dir: 'ltr' | 'rtl';
  /**
   * Body font-stack hint per `@adminium/tokens` fonts.css (02-design-system.md
   * §2.4): `latin` → Manrope, `arabic` → IBM Plex Sans Arabic (Manrope
   * fallback for Latin glyphs), `cjk` → Manrope + platform CJK fallbacks.
   * JetBrains Mono stays the mono face everywhere (§5.1).
   */
  fontHint: 'latin' | 'arabic' | 'cjk';
}

export const LOCALES = [
  { id: 'en_US', tag: 'en-US', english: 'English (US)', native: 'English (US)', dir: 'ltr', fontHint: 'latin' },
  { id: 'de_DE', tag: 'de-DE', english: 'German', native: 'Deutsch', dir: 'ltr', fontHint: 'latin' },
  { id: 'fr_FR', tag: 'fr-FR', english: 'French', native: 'Français', dir: 'ltr', fontHint: 'latin' },
  { id: 'cs_CZ', tag: 'cs-CZ', english: 'Czech', native: 'Čeština', dir: 'ltr', fontHint: 'latin' },
  { id: 'da_DK', tag: 'da-DK', english: 'Danish', native: 'Dansk', dir: 'ltr', fontHint: 'latin' },
  { id: 'zh_CN', tag: 'zh-CN', english: 'Chinese (Simplified)', native: '简体中文', dir: 'ltr', fontHint: 'cjk' },
  { id: 'zh_TW', tag: 'zh-TW', english: 'Chinese (Traditional)', native: '繁體中文', dir: 'ltr', fontHint: 'cjk' },
  { id: 'ar_EG', tag: 'ar-EG', english: 'Arabic (Egypt)', native: 'العربية (مصر)', dir: 'rtl', fontHint: 'arabic' },
] as const satisfies readonly LocaleEntry[];

export type LocaleId = (typeof LOCALES)[number]['id']; // 'en_US' | … | 'ar_EG'

export const LOCALE_IDS = LOCALES.map((l) => l.id) as unknown as readonly LocaleId[];

const BY_ID: ReadonlyMap<string, (typeof LOCALES)[number]> = new Map(LOCALES.map((l) => [l.id, l]));
const BY_TAG: ReadonlyMap<string, (typeof LOCALES)[number]> = new Map(LOCALES.map((l) => [l.tag, l]));

export function isLocaleId(value: unknown): value is LocaleId {
  return typeof value === 'string' && BY_ID.has(value);
}

export function localeEntry(id: LocaleId): LocaleEntry {
  const entry = BY_ID.get(id);
  if (entry === undefined) throw new Error(`unknown locale id: ${JSON.stringify(id)}`);
  return entry;
}

/** `'rtl'` iff the registry says so (`ar_EG` today) — data-driven, not hardcoded. */
export function dirForLocale(id: LocaleId): 'ltr' | 'rtl' {
  return localeEntry(id).dir;
}

export function isRtlLocale(id: LocaleId): boolean {
  return dirForLocale(id) === 'rtl';
}

/** `ar_EG` → `ar-EG` for `Intl.*`, i18next, and the `lang` attribute. */
export function tagForLocale(id: LocaleId): string {
  return localeEntry(id).tag;
}

/**
 * Best-effort inverse of {@link tagForLocale}: exact tag match, then a
 * language-only match (`de` → `de_DE`), else `en_US`. Used to map
 * `i18next.language` / `navigator.language` back to a canonical id.
 */
export function localeFromTag(tag: string): LocaleId {
  const exact = BY_TAG.get(tag);
  if (exact !== undefined) return exact.id;
  const lang = tag.toLowerCase().split('-')[0] ?? '';
  const byLang = LOCALES.find((l) => l.tag.toLowerCase().startsWith(`${lang}-`) || l.tag.toLowerCase() === lang);
  return byLang?.id ?? 'en_US';
}
