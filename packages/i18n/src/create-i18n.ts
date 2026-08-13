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
import { bumpI18nRevision } from './revision.js';
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
            // CLONE (23-T01). i18next stores a backend bundle BY REFERENCE
            // (`skipCopy: true` on the connector's store write), and this
            // object is the live default export of a dynamic-import module —
            // a process-wide singleton. Anything that later merges runtime
            // overrides into the store would rewrite the compiled chunk
            // itself, destroying the original text for every other instance
            // in the process. Clone once here so the store owns its copy.
            callback(null, structuredClone(data) as never);
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

  // DEEP clone, not a spread (23-T01). A shallow spread leaves
  // `resources['en-US'].common === EN_US_RESOURCES.common`, and i18next's
  // ResourceStore takes `this.data = data` with no copy of its own — so the
  // store would alias the compiled ES-module singletons. Any later merge of
  // runtime overrides (23 §4.3) would then permanently rewrite the compiled
  // English in memory: the original text is gone, so even a correct
  // reset-to-built-in has nothing to restore, and on the server every
  // subsequently created instance inherits another caller's overrides.
  const resources: Resource = {
    'en-US': structuredClone(EN_US_RESOURCES) as Resource[string],
  };
  for (const [resourceTag, byNs] of Object.entries(opts.resources ?? {})) {
    if (byNs === undefined) continue;
    const target = (resources[resourceTag] ??= {});
    for (const [ns, bundle] of Object.entries(byNs)) {
      // Cloned for the same reason as the bundled resources above: a caller
      // (Electron packaging, tests) may hand us a module singleton.
      if (bundle !== undefined) (target as Record<string, unknown>)[ns] = structuredClone(bundle);
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
    // TRUE since 23-T08: an empty string is a deliberate override state
    // ("render nothing", 23 §3.3), not a missing value. With `false`, an
    // admin's blank would fall through to the en-US built-in and the state
    // would be unexpressible. Compiled bundles are unaffected — the parity
    // gate asserts no compiled message is empty.
    returnEmptyString: true,
    ...(opts.onMissingKey === undefined
      ? {}
      : {
          saveMissing: true,
          missingKeyHandler: (lngs: readonly string[], ns: string, key: string): void => {
            for (const lng of lngs) opts.onMissingKey?.(lng, ns, key);
          },
        }),
  });

  // A language switch changes what every key resolves to, so it is a revision
  // change like any other (23 §4.4). Without this, only components that
  // consume `I18nProvider`'s context re-render — and the dashboard's ~2.3k
  // call sites use a module-level `t()` that is not a hook, so already-painted
  // strings kept the OUTGOING language until a reload while `dir` flipped
  // immediately. That produced a mirrored English UI, and it is the defect
  // `apps/e2e/tests/rtl-locale.spec.ts` used to pin as a known bug.
  instance.on('languageChanged', () => {
    bumpI18nRevision();
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
