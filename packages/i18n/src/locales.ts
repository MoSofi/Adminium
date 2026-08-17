// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Canonical locale registry (10-i18n-theming.md §2.1) plus the runtime
 * overlay that lets an admin add locales the build never saw
 * (23-runtime-translations.md §5).
 *
 * Two id types, and the split is load-bearing:
 *
 *  - {@link BuiltinLocaleId} is the closed union of the eight COMPILED
 *    locales. Everything that must stay exhaustive keys off it —
 *    `REVIEW_STATUS`, the parity gate, `gen-resources.mjs`, `lazy.ts` — so a
 *    ninth *compiled* locale is still a compile error, and no runtime locale
 *    can ever reach a build-time gate.
 *  - {@link LocaleId} additionally admits runtime ids. `(string & {})` keeps
 *    literal autocomplete for the eight while accepting anything a custom
 *    locale row can hold.
 *
 * Every lookup helper here is TOTAL: none of them throws on an unknown id.
 * That is deliberate. Once locales are data, the orphan case — a deleted
 * locale still referenced by a user pref, a restored backup, an imported
 * config bundle — is the NORMAL aftermath of the feature, not an edge case,
 * and these helpers run inside a theme subscriber. `emitTheme` isolates each
 * listener now (23 §4.4), so a throw here no longer errors the React commit —
 * it is logged and swallowed, and this subscriber simply does not finish. That
 * is a quieter failure, not a smaller one: ThemeProvider stamps `dir`/`lang`
 * BEFORE it emits, so the page turns RTL while every string stays in the old
 * language, and nothing on screen says why.
 *
 * `dir` is still derived from the locale, never independently settable
 * (02-design-system.md §4.2).
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

/** A runtime locale entry, plus the fields only the DB registry knows. */
export interface RuntimeLocaleEntry extends LocaleEntry {
  /** False for admin-created locales. */
  builtin: boolean;
  /** Offered in pickers? (23 §3.1 `enabled`.) */
  enabled: boolean;
  /** Picker ordering. */
  sortOrder: number;
  /**
   * The REAL BCP-47 tag whose `Intl` behaviour this locale borrows (23 §5.6).
   * For a built-in this is just `tag`; for a custom locale it is the admin's
   * choice, because `tag` itself may be something `Intl` has never heard of.
   */
  intlTag: string;
  /** Plural categories frozen at create time from `intlTag`. */
  pluralCategories: readonly string[];
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

/** The eight COMPILED locales — the exhaustive axis (23 §5.1). */
export type BuiltinLocaleId = (typeof LOCALES)[number]['id']; // 'en_US' | … | 'ar_EG'

/**
 * Any locale id the running instance may hold — the eight compiled ones plus
 * whatever an admin created. `(string & {})` preserves literal autocomplete
 * for the eight instead of collapsing to a bare `string`.
 */
export type LocaleId = BuiltinLocaleId | (string & {});

export const BUILTIN_LOCALE_IDS = LOCALES.map((l) => l.id) as unknown as readonly BuiltinLocaleId[];

/** @deprecated Prefer {@link BUILTIN_LOCALE_IDS} (or the runtime list) by name. */
export const LOCALE_IDS = BUILTIN_LOCALE_IDS;

/**
 * Canonical id shape: a language subtag plus up to two more (script, region),
 * e.g. `en_US`, `sw_KE`, `zh_Hant_TW`. Three subtags is why the DB column is
 * `varchar(35)` and why {@link tagFromLocaleId} replaces EVERY underscore.
 */
export const LOCALE_ID_RE = /^[a-z]{2,3}(_[A-Za-z0-9]{2,8}){0,2}$/;

const BY_ID: ReadonlyMap<string, (typeof LOCALES)[number]> = new Map(LOCALES.map((l) => [l.id, l]));
const BY_TAG: ReadonlyMap<string, (typeof LOCALES)[number]> = new Map(LOCALES.map((l) => [l.tag, l]));

// --- runtime overlay ---------------------------------------------------------

/**
 * Locales the running instance knows about beyond the compiled eight. Set
 * once from the server manifest at boot and on every i18n version bump; empty
 * on a server/CLI that never loads it, which is exactly the pre-23 behaviour.
 *
 * A module-level singleton is correct here: one Adminium instance has one
 * meta store and therefore one locale registry, same as the compiled one.
 */
let runtimeById: ReadonlyMap<string, RuntimeLocaleEntry> = new Map();

/** Replace the runtime registry wholesale (boot, and every version bump). */
export function setRuntimeLocales(entries: readonly RuntimeLocaleEntry[]): void {
  runtimeById = new Map(entries.map((e) => [e.id, e]));
}

/** Drop the runtime registry — tests, and teardown. */
export function resetRuntimeLocales(): void {
  runtimeById = new Map();
}

/** Every locale the instance knows: compiled defaults merged under runtime rows. */
export function allLocales(): readonly RuntimeLocaleEntry[] {
  const merged = new Map<string, RuntimeLocaleEntry>();
  for (const entry of LOCALES) {
    merged.set(entry.id, {
      ...entry,
      builtin: true,
      enabled: true,
      sortOrder: 0,
      intlTag: entry.tag,
      pluralCategories: [],
    });
  }
  for (const [id, entry] of runtimeById) {
    const base = merged.get(id);
    // A built-in row may only carry `enabled`/`sortOrder` (23 §3.1 field
    // lock) — presentation always comes from the compiled entry, so an admin
    // cannot flip ar_EG to ltr and corrupt a shipped bundle's rendering.
    merged.set(
      id,
      base === undefined
        ? entry
        : { ...base, enabled: entry.enabled, sortOrder: entry.sortOrder, builtin: true },
    );
  }
  return [...merged.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  );
}

/** The locales a picker may offer, in picker order (23 §3.1 `enabled`). */
export function availableLocales(): readonly RuntimeLocaleEntry[] {
  return allLocales().filter((l) => l.enabled);
}

// --- lookups (all total) -----------------------------------------------------

/** True for one of the eight COMPILED locales. */
export function isBuiltinLocaleId(value: unknown): value is BuiltinLocaleId {
  return typeof value === 'string' && BY_ID.has(value);
}

/**
 * True for anything shaped like a locale id. This is a SHAPE check, not a
 * membership check: a cached preference may name a locale this build does not
 * compile in, and rejecting it would strand the user on en-US. Use
 * {@link isBuiltinLocaleId} when compiled membership is what you mean.
 */
export function isLocaleId(value: unknown): value is LocaleId {
  return typeof value === 'string' && LOCALE_ID_RE.test(value);
}

/**
 * `en_US` → `en-US`, `zh_Hant_TW` → `zh-Hant-TW`.
 *
 * Replaces EVERY underscore. A single-replacement version leaves
 * `zh-Hant_TW`, which is not a valid BCP-47 tag, and the formatter layer
 * coalesces invalid tags to `en-US` — silently degrading exactly the way the
 * admin-chosen `intlTag` exists to prevent.
 */
export function tagFromLocaleId(id: string): string {
  return id.replaceAll('_', '-');
}

/** Synthesized entry for an id no registry knows — never throws. */
function synthesize(id: string): LocaleEntry {
  return { id, tag: tagFromLocaleId(id), english: id, native: id, dir: 'ltr', fontHint: 'latin' };
}

/**
 * The presentation record for a locale: compiled entry, else runtime entry,
 * else a synthesized one. Total by contract — see the file header for why
 * throwing here is a white screen.
 */
export function localeEntry(id: LocaleId): LocaleEntry {
  return BY_ID.get(id) ?? runtimeById.get(id) ?? synthesize(id);
}

/** `'rtl'` iff the registry says so — data-driven, never hardcoded to `ar_EG`. */
export function dirForLocale(id: LocaleId): 'ltr' | 'rtl' {
  return localeEntry(id).dir;
}

export function isRtlLocale(id: LocaleId): boolean {
  return dirForLocale(id) === 'rtl';
}

/** `ar_EG` → `ar-EG` for i18next and the `lang` attribute. */
export function tagForLocale(id: LocaleId): string {
  return localeEntry(id).tag;
}

/**
 * The tag to hand `Intl.*` and `IntlMessageFormat` (23 §4.5). For a compiled
 * locale this is just the tag; for a custom locale it is the admin-chosen
 * borrow tag, because the locale's own tag may be something no ICU
 * implementation has data for.
 */
export function intlTagForLocale(id: LocaleId): string {
  return runtimeById.get(id)?.intlTag ?? tagForLocale(id);
}

/** Plural categories to validate a message against (frozen at create time). */
export function pluralCategoriesForLocale(id: LocaleId): readonly string[] {
  const frozen = runtimeById.get(id)?.pluralCategories;
  if (frozen !== undefined && frozen.length > 0) return frozen;
  try {
    return new Intl.PluralRules(intlTagForLocale(id)).resolvedOptions().pluralCategories;
  } catch {
    return ['other'];
  }
}

/**
 * Best-effort inverse of {@link tagForLocale}: exact compiled tag, then a
 * runtime tag, then a language-only compiled match (`de` → `de_DE`), else
 * `en_US`. Maps `i18next.language` / `navigator.language` back to an id.
 */
export function localeFromTag(tag: string): LocaleId {
  const exact = BY_TAG.get(tag);
  if (exact !== undefined) return exact.id;
  for (const entry of runtimeById.values()) {
    if (entry.tag === tag) return entry.id;
  }
  const lang = tag.toLowerCase().split('-')[0] ?? '';
  const byLang = LOCALES.find((l) => l.tag.toLowerCase().startsWith(`${lang}-`) || l.tag.toLowerCase() === lang);
  return byLang?.id ?? 'en_US';
}
