/**
 * Dashboard i18n boot (10-i18n-theming.md §7.5): build the shared i18next
 * instance BEFORE the first render, from the pre-hydration locale cache
 * (`STORAGE_KEYS.locale`), with a 2 s cap — on timeout the app renders en-US
 * and hot-swaps when the locale's chunks land (degraded network beats a
 * blank screen). Locale changes flow from ThemeProvider (the single owner of
 * the locale axis): `subscribeTheme` → preload target bundles →
 * `changeLanguage` (§7.4 — no half-translated frame), while ThemeProvider
 * itself stamps `dir`/`lang` on <html>.
 */
import {
  createI18n,
  isLocaleId,
  localeFromTag,
  switchLocale,
  tagForLocale,
  type I18nInstance,
  type LocaleId,
  type Namespace,
  type ResourceBundle,
} from '@adminium/i18n';
import { STORAGE_KEYS } from '@adminium/tokens';
import { subscribeTheme } from '@adminium/ui';

import { setI18nInstance } from './t.js';

/**
 * Per-locale/namespace lazy loaders. Literal dynamic imports so Vite splits
 * one chunk per bundle. Non-English bundles land with the MT bootstrap
 * (10-T14) — register their loaders here as the JSON files appear; a missing
 * entry resolves `null` and the key falls back to en-US (§7.5 step 2).
 */
const BUNDLE_LOADERS: Readonly<Record<string, () => Promise<{ default: ResourceBundle }>>> = {
  // e.g. 'de-DE/common': () => import('@adminium/i18n/locales/de-DE/common.json'),
};

async function loadBundle(tag: string, ns: Namespace): Promise<{ default: ResourceBundle } | null> {
  const loader = BUNDLE_LOADERS[`${tag}/${ns}`];
  if (loader === undefined) return null;
  return loader();
}

/** The locale the pre-hydration script painted with (localStorage cache). */
function cachedLocale(): LocaleId {
  try {
    const cached = window.localStorage.getItem(STORAGE_KEYS.locale);
    if (cached !== null && isLocaleId(cached)) return cached;
  } catch {
    // Private mode / storage disabled.
  }
  // Cold first visit: nearest supported locale from the browser (§7.2).
  return localeFromTag(navigator.language ?? 'en-US');
}

const INIT_TIMEOUT_MS = 2_000;

/**
 * Builds the app i18n instance and wires it to ThemeProvider's resolved
 * locale. Idempotent per page load; returns the ready instance.
 */
export async function initDashboardI18n(options: { locale?: LocaleId } = {}): Promise<I18nInstance> {
  const locale = options.locale ?? cachedLocale();

  const ready = createI18n({
    locale,
    loadBundle,
    ...(import.meta.env.DEV
      ? {
          onMissingKey: (lng: string, ns: string, key: string) => {
            // Dev missing-key overlay stand-in (§8.2) — the Playwright guard
            // fails any e2e test that triggers one of these.
            console.warn(`[i18n] missing key ${ns}:${key} (${lng})`);
          },
        }
      : {}),
  });

  // §7.5 step 2: cap the first paint on slow locale chunks, hot-swap later.
  const i18n = await Promise.race([
    ready,
    new Promise<I18nInstance | null>((resolve) => {
      setTimeout(() => resolve(null), INIT_TIMEOUT_MS);
    }),
  ]).then(async (instance) => {
    if (instance !== null) return instance;
    const enUs = await createI18n({ locale: 'en_US', loadBundle });
    void ready.then(async (late) => {
      // The capped instance finished loading — swap languages in place.
      await switchLocale(enUs, localeFromTag(late.language));
    });
    return enUs;
  });

  setI18nInstance(i18n);

  // ThemeProvider owns the locale axis; follow its resolution live (§7.4).
  subscribeTheme((resolved) => {
    if (tagForLocale(resolved.locale) === i18n.language) return;
    void switchLocale(i18n, resolved.locale);
  });

  return i18n;
}
