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
  loadLocaleBundle,
  localeFromTag,
  switchLocale,
  tagForLocale,
  type I18nInstance,
  type LocaleId,
} from '@adminium/i18n';
import { STORAGE_KEYS } from '@adminium/tokens';
import { subscribeTheme } from '@adminium/ui';

import { pushDesktopMenuLabels } from '../desktop/menuLabels.js';
import { setI18nInstance } from './t.js';

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
    // All 7 non-English locales load through @adminium/i18n's lazy loader:
    // literal dynamic imports inside the package, so Vite splits one chunk
    // per locale/namespace pair and an en_US user downloads no other
    // locale's strings. Unknown pairs resolve `null` → en-US fallback.
    loadBundle: loadLocaleBundle,
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
    const enUs = await createI18n({ locale: 'en_US', loadBundle: loadLocaleBundle });
    void ready.then(async (late) => {
      // The capped instance finished loading — swap languages in place.
      await switchLocale(enUs, localeFromTag(late.language));
    });
    return enUs;
  });

  setI18nInstance(i18n);
  // §14 (Electron): the native menu is localized by the SPA — resolve the labels
  // now that i18n is ready and push them to the shell. No-op off the desktop
  // shell (`getDesktopApi()` is null on self-host/Cloud), so this same one bundle
  // stays runtime-agnostic.
  pushDesktopMenuLabels();

  // ThemeProvider owns the locale axis; follow its resolution live (§7.4).
  subscribeTheme((resolved) => {
    if (tagForLocale(resolved.locale) === i18n.language) return;
    // Rebuild the native menu once the new locale's strings have actually loaded
    // (`switchLocale` awaits the bundle), never before — pushing mid-switch would
    // carry the OUTGOING locale (§7.4's "no half-translated frame" applies to the
    // menu bar too).
    void switchLocale(i18n, resolved.locale).then(() => {
      pushDesktopMenuLabels();
    });
  });

  return i18n;
}
