/**
 * i18next factory (10-i18n-theming.md §2.3): i18next + IcuFormat (ICU
 * MessageFormat for every message — i18next's own plural-suffix system is
 * disabled by the ICU format plugin) + an inline lazy backend. The bundled
 * en-US namespaces ship synchronously (they are the fallback text and must
 * never be async); every other locale/namespace pair is fetched through
 * `loadBundle` — the dashboard passes a Vite dynamic-import loader so each
 * locale becomes its own chunk.
 */
import i18next, { type BackendModule, type i18n, type ReadCallback, type Resource } from 'i18next';
import { IcuFormat } from './icu-format.js';

import { localeEntry, tagForLocale, type LocaleId } from './locales.js';
import { EN_US_RESOURCES, NAMESPACES, type Namespace, type ResourceBundle } from './resources/index.js';

/** The concrete i18next instance type consumers hold (re-exported so callers never import i18next directly). */
export type I18nInstance = i18n;

export type BundleLoader = (
  tag: string,
  ns: Namespace,
) => Promise<ResourceBundle | { default: ResourceBundle } | null>;

export interface CreateI18nOptions {
  /** Canonical locale id (`en_US` … `ar_EG`) the instance starts in. */
  locale: LocaleId;
  /**
   * Extra/override resource bundles, keyed by BCP-47 tag then namespace.
   * Merged over the bundled en-US resources (tests, Electron packaging).
   */
  resources?: Partial<Record<string, Partial<Record<Namespace, ResourceBundle>>>> | undefined;
  /**
   * Lazy loader for non-bundled locale/namespace pairs. Return `null` (or
   * reject) for a missing bundle — the key then resolves through the en-US
   * fallback chain instead of failing.
   */
  loadBundle?: BundleLoader | undefined;
  /** Missing-key hook (dev overlay / CI missing-key guard, §8.2). */
  onMissingKey?: ((lng: string, ns: string, key: string) => void) | undefined;
}

function lazyBackend(load: BundleLoader): BackendModule {
  return {
    type: 'backend',
    init(): void {
      // Options come through the closure — nothing to do.
    },
    read(language: string, namespace: string, callback: ReadCallback): void {
      void Promise.resolve()
        .then(async () => await load(language, namespace as Namespace))
        .then(
          (bundle) => {
            if (bundle === null) {
              callback(null, {});
              return;
            }
            const data = 'default' in bundle ? (bundle as { default: ResourceBundle }).default : bundle;
            callback(null, data as never);
          },
          () => {
            // Missing/failed chunk: resolve empty so the fallback chain applies
            // (degraded network beats a blank screen, §7.5).
            callback(null, {});
          },
        );
    },
  };
}

/**
 * Builds a ready (initialized) i18next instance for `locale`. For `en_US`
 * initialization is effectively synchronous (bundled resources); other
 * locales resolve once their bundles load (or immediately, falling back to
 * en-US, when no loader/bundle exists yet).
 */
export async function createI18n(opts: CreateI18nOptions): Promise<I18nInstance> {
  const tag = tagForLocale(opts.locale);

  const resources: Resource = {
    'en-US': { ...EN_US_RESOURCES },
  };
  for (const [resourceTag, byNs] of Object.entries(opts.resources ?? {})) {
    if (byNs === undefined) continue;
    const target = (resources[resourceTag] ??= {});
    for (const [ns, bundle] of Object.entries(byNs)) {
      if (bundle !== undefined) (target as Record<string, unknown>)[ns] = bundle;
    }
  }

  const instance = i18next.createInstance();
  instance.use(new IcuFormat());
  if (opts.loadBundle !== undefined) instance.use(lazyBackend(opts.loadBundle));

  await instance.init({
    lng: tag,
    fallbackLng: 'en-US',
    ns: [...NAMESPACES],
    defaultNS: 'common',
    resources,
    // Bundled en-US coexists with the lazy backend for other locales.
    partialBundledLanguages: true,
    // React escapes; ICU handles placeables (§2.3).
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
    ...(opts.onMissingKey === undefined
      ? {}
      : {
          saveMissing: true,
          missingKeyHandler: (lngs: readonly string[], ns: string, key: string): void => {
            for (const lng of lngs) opts.onMissingKey?.(lng, ns, key);
          },
        }),
  });

  return instance;
}

/**
 * Preloaded live locale switch (§7.4): the target locale's namespaces load
 * BEFORE `changeLanguage` fires, so the UI never renders a half-translated
 * frame while `dir`/`lang` flip.
 */
export async function switchLocale(instance: I18nInstance, locale: LocaleId): Promise<void> {
  const { tag } = localeEntry(locale);
  if (instance.language === tag) return;
  await instance.loadLanguages(tag);
  await instance.changeLanguage(tag);
}
