// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dashboard's i18next instance: the core (`create-i18n-core.ts`) started
 * with the EAGER namespaces. en-US's ship synchronously (they are the fallback
 * text and must never be async) and the active locale's are fetched through
 * `loadBundle` before `init` resolves. A DEFERRED namespace (`studio`) is in
 * neither set: the surface that owns it calls `instance.loadNamespaces()` and
 * waits. See ./resources/namespaces.ts.
 */
import { buildI18n, type CreateI18nOptions, type I18nInstance } from './create-i18n-core.js';
import { EN_US_EAGER } from './resources/eager.js';
import { EAGER_NAMESPACES, type Namespace, type ResourceBundle } from './resources/namespaces.js';
import { loadedWords } from './ui-words.js';

export { switchLocale } from './create-i18n-core.js';
export type { BundleLoader, CreateI18nOptions, I18nInstance } from './create-i18n-core.js';

/**
 * Builds a ready (initialized) i18next instance for `locale`. For `en_US`
 * initialization is effectively synchronous (bundled resources); other
 * locales resolve once their bundles load (or immediately, falling back to
 * en-US, when no loader/bundle exists yet).
 */
export async function createI18n(opts: CreateI18nOptions): Promise<I18nInstance> {
  const english: Partial<Record<Namespace, ResourceBundle>> = { ...EN_US_EAGER };
  // The widget and template words, once any instance in this process has read them (ui-words.ts).
  for (const ns of ['ui', 'common'] as const) {
    const words = loadedWords(ns);
    if (words !== null) english[ns] = { ...(english[ns] as object), ...words } as ResourceBundle;
  }
  return buildI18n(opts, { english, namespaces: EAGER_NAMESPACES, defaultNamespace: 'common' });
}
