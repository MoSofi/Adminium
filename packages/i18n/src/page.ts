// SPDX-License-Identifier: AGPL-3.0-only
/**
 * For a page with its own small vocabulary and nothing of the dashboard's
 * (the customer's pay page): an instance started with ONE namespace, whose
 * English the caller bundles itself. Importing this entry never reaches the
 * dashboard's bundles.
 */
import { buildI18n, type BundleLoader, type I18nInstance } from './create-i18n-core.js';
import type { LocaleId } from './locales.js';
import type { Namespace, ResourceBundle } from './resources/namespaces.js';

export { switchLocale } from './create-i18n-core.js';
export { localeFromTag, type LocaleId } from './locales.js';
export type { BundleLoader, I18nInstance } from './create-i18n-core.js';

export async function createPageI18n(opts: { locale: LocaleId; namespace: Namespace; english: ResourceBundle; loadBundle: BundleLoader }): Promise<I18nInstance> {
  return buildI18n({ locale: opts.locale, loadBundle: opts.loadBundle }, { english: { [opts.namespace]: opts.english }, namespaces: [opts.namespace], defaultNamespace: opts.namespace });
}
