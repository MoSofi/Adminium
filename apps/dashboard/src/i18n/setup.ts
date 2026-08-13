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
  bumpI18nRevision,
  createI18n,
  createI18nWithOverrides,
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
import { cachedOverrides } from './overrideCache.js';
import { getI18nInstance, setI18nInstance } from './t.js';

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

  // WARM boot: overrides from the versioned localStorage cache are available
  // synchronously, so the first paint already carries the admin's copy. COLD
  // boot: `null`, and the paint carries compiled text until the post-boot
  // resync swaps it — the acknowledged amendment to 10 §7.5 (23 §4.7).
  const warmOverrides = cachedOverrides(locale);

  const ready = createI18nWithOverrides({
    locale,
    ...(warmOverrides === null ? {} : { overrides: warmOverrides }),
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
  //
  // Resolve the instance through `getI18nInstance()` on every tick rather than
  // closing over `i18n`: the override layer REPLACES the instance rather than
  // patching it (`refreshOverrides`/`resyncOverrides` both `setI18nInstance`),
  // and `refreshOverrides` runs on every boot a few lines below. A captured
  // reference therefore goes stale before the user can touch the locale picker,
  // and the switch then lands on an orphaned instance: its bundles load and its
  // language changes, but `t()` — which reads the CURRENT instance — keeps
  // resolving the old language, so the app turns RTL while every string stays
  // English. That is precisely the split rtl-locale.spec.ts catches.
  subscribeTheme((resolved) => {
    const current = getI18nInstance();
    if (current === null) return;
    if (tagForLocale(resolved.locale) === current.language) return;
    // Rebuild the native menu once the new locale's strings have actually loaded
    // (`switchLocale` awaits the bundle), never before — pushing mid-switch would
    // carry the OUTGOING locale (§7.4's "no half-translated frame" applies to the
    // menu bar too).
    void switchLocale(current, resolved.locale).then(() => {
      pushDesktopMenuLabels();
    });
  });

  // Post-boot: reconcile against the server WITHOUT blocking the first paint
  // (23 §4.7). On a cold boot this is what turns compiled text into the
  // admin's copy; on a warm one it is a cheap no-op when the version matches.
  void refreshOverrides(locale);

  return i18n;
}

/**
 * Fetch overrides for `locale` and rebuild the active instance with them.
 *
 * Rebuilding rather than patching is not a style choice: i18next's
 * `addResourceBundle` cannot remove a key (its `deepExtend` only writes keys
 * present in the source), so a store-mutation design cannot express "reset to
 * built-in" — the most common admin operation — and `removeResourceBundle`
 * would splice the namespace out of the instance entirely (23 §4.2).
 */
export async function refreshOverrides(locale: LocaleId): Promise<void> {
  try {
    // DYNAMIC import: everything network-facing in the override layer is
    // post-boot, so keeping it out of the entry chunk is free (23 §4.7 and
    // ./overrideCache.ts).
    const { loadOverrides } = await import('./overrides.js');
    const { overrides } = await loadOverrides(locale);
    const next = await createI18nWithOverrides({
      locale,
      loadBundle: loadLocaleBundle,
      overrides,
    });
    setI18nInstance(next);
    bumpI18nRevision();
    pushDesktopMenuLabels();
  } catch {
    // Signed out, offline, or the route is unavailable on this build. The
    // compiled text is a correct render — just not a customised one.
  }
}

/**
 * Re-check the server's version and rebuild only when it moved (23 §4.4).
 *
 * The locale is resolved from the LIVE instance rather than accepted from the
 * caller. The shell's only handle on it is `bootstrap.prefs.locale` — the value
 * the bootstrap query last returned, which is not necessarily the locale the
 * user is currently reading. Rebuilding at the wrong one refetches another
 * locale's overrides and installs them under the active language, so an admin's
 * customisations silently disappear until something reloads them. Taking the
 * locale from the instance that `t()` actually reads removes the whole class:
 * there is no second source of truth left to disagree with.
 */
export async function resyncOverrides(): Promise<void> {
  const current = getI18nInstance();
  if (current === null) return;
  const locale = localeFromTag(current.language);
  const { resyncIfStale } = await import('./overrides.js');
  const snapshot = await resyncIfStale(locale);
  if (snapshot === null) return;
  const next = await createI18nWithOverrides({
    locale,
    loadBundle: loadLocaleBundle,
    overrides: snapshot.overrides,
  });
  setI18nInstance(next);
  bumpI18nRevision();
}
