// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Lazy loaders for every locale/namespace pair that is not bundled. Each
 * entry is a LITERAL dynamic import so bundlers (Vite, Electron packaging)
 * split one chunk per bundle and a de_DE user downloads only German strings.
 * Pass {@link loadLocaleBundle} as `createI18n`'s `loadBundle`.
 *
 * Two things are lazy here, for two different reasons:
 *
 * - **the 7 non-English locales, every namespace.** en-US's eager namespaces
 *   (./eager.ts) ship in the main bundle because they are the fallback text
 *   and must never be async; nobody else's do.
 * - **`studio`, en-US INCLUDED**. The deferred namespace is loaded on
 * demand by the surface that owns it, so the English console text is a
 * chunk the console's own visitors fetch rather than ~36 KiB every user
 * carries. See `DEFERRED_NAMESPACES` in./namespaces.ts for the contract
 * that makes this safe.
 */
import type { Namespace, ResourceBundle } from './namespaces.js';

type BundleModule = { default: ResourceBundle };

const LOADERS: Readonly<Record<string, () => Promise<BundleModule>>> = {
  // The en-US bundles that are not in the main chunk (DEFERRED_NAMESPACES).
  'en-US/studio': () => import('./en-us/studio.js'),
  'en-US/email': () => import('./en-us/email.js'),
  'en-US/automations': () => import('./en-us/automations.js'),
  'en-US/dataio': () => import('./en-us/dataio.js'),
  'en-US/files': () => import('./en-us/files.js'),
  'en-US/reportBuilder': () => import('./en-us/reportBuilder.js'),
  'en-US/onboarding': () => import('./en-us/onboarding.js'),
  'en-US/project': () => import('./en-us/project.js'),
  'en-US/addOns': () => import('./en-us/addOns.js'),
  'en-US/assistant': () => import('./en-us/assistant.js'),
  'de-DE/common': () => import('./de-de/common.js'),
  'de-DE/ui': () => import('./de-de/ui.js'),
  'de-DE/studio': () => import('./de-de/studio.js'),
  'de-DE/generated': () => import('./de-de/generated.js'),
  'de-DE/errors': () => import('./de-de/errors.js'),
  'de-DE/email': () => import('./de-de/email.js'),
  'de-DE/automations': () => import('./de-de/automations.js'),
  'de-DE/dataio': () => import('./de-de/dataio.js'),
  'de-DE/files': () => import('./de-de/files.js'),
  'de-DE/reportBuilder': () => import('./de-de/reportBuilder.js'),
  'de-DE/onboarding': () => import('./de-de/onboarding.js'),
  'de-DE/project': () => import('./de-de/project.js'),
  'de-DE/addOns': () => import('./de-de/addOns.js'),
  'de-DE/assistant': () => import('./de-de/assistant.js'),
  'fr-FR/common': () => import('./fr-fr/common.js'),
  'fr-FR/ui': () => import('./fr-fr/ui.js'),
  'fr-FR/studio': () => import('./fr-fr/studio.js'),
  'fr-FR/generated': () => import('./fr-fr/generated.js'),
  'fr-FR/errors': () => import('./fr-fr/errors.js'),
  'fr-FR/email': () => import('./fr-fr/email.js'),
  'fr-FR/automations': () => import('./fr-fr/automations.js'),
  'fr-FR/dataio': () => import('./fr-fr/dataio.js'),
  'fr-FR/files': () => import('./fr-fr/files.js'),
  'fr-FR/reportBuilder': () => import('./fr-fr/reportBuilder.js'),
  'fr-FR/onboarding': () => import('./fr-fr/onboarding.js'),
  'fr-FR/project': () => import('./fr-fr/project.js'),
  'fr-FR/addOns': () => import('./fr-fr/addOns.js'),
  'fr-FR/assistant': () => import('./fr-fr/assistant.js'),
  'cs-CZ/common': () => import('./cs-cz/common.js'),
  'cs-CZ/ui': () => import('./cs-cz/ui.js'),
  'cs-CZ/studio': () => import('./cs-cz/studio.js'),
  'cs-CZ/generated': () => import('./cs-cz/generated.js'),
  'cs-CZ/errors': () => import('./cs-cz/errors.js'),
  'cs-CZ/email': () => import('./cs-cz/email.js'),
  'cs-CZ/automations': () => import('./cs-cz/automations.js'),
  'cs-CZ/dataio': () => import('./cs-cz/dataio.js'),
  'cs-CZ/files': () => import('./cs-cz/files.js'),
  'cs-CZ/reportBuilder': () => import('./cs-cz/reportBuilder.js'),
  'cs-CZ/onboarding': () => import('./cs-cz/onboarding.js'),
  'cs-CZ/project': () => import('./cs-cz/project.js'),
  'cs-CZ/addOns': () => import('./cs-cz/addOns.js'),
  'cs-CZ/assistant': () => import('./cs-cz/assistant.js'),
  'da-DK/common': () => import('./da-dk/common.js'),
  'da-DK/ui': () => import('./da-dk/ui.js'),
  'da-DK/studio': () => import('./da-dk/studio.js'),
  'da-DK/generated': () => import('./da-dk/generated.js'),
  'da-DK/errors': () => import('./da-dk/errors.js'),
  'da-DK/email': () => import('./da-dk/email.js'),
  'da-DK/automations': () => import('./da-dk/automations.js'),
  'da-DK/dataio': () => import('./da-dk/dataio.js'),
  'da-DK/files': () => import('./da-dk/files.js'),
  'da-DK/reportBuilder': () => import('./da-dk/reportBuilder.js'),
  'da-DK/onboarding': () => import('./da-dk/onboarding.js'),
  'da-DK/project': () => import('./da-dk/project.js'),
  'da-DK/addOns': () => import('./da-dk/addOns.js'),
  'da-DK/assistant': () => import('./da-dk/assistant.js'),
  'zh-CN/common': () => import('./zh-cn/common.js'),
  'zh-CN/ui': () => import('./zh-cn/ui.js'),
  'zh-CN/studio': () => import('./zh-cn/studio.js'),
  'zh-CN/generated': () => import('./zh-cn/generated.js'),
  'zh-CN/errors': () => import('./zh-cn/errors.js'),
  'zh-CN/email': () => import('./zh-cn/email.js'),
  'zh-CN/automations': () => import('./zh-cn/automations.js'),
  'zh-CN/dataio': () => import('./zh-cn/dataio.js'),
  'zh-CN/files': () => import('./zh-cn/files.js'),
  'zh-CN/reportBuilder': () => import('./zh-cn/reportBuilder.js'),
  'zh-CN/onboarding': () => import('./zh-cn/onboarding.js'),
  'zh-CN/project': () => import('./zh-cn/project.js'),
  'zh-CN/addOns': () => import('./zh-cn/addOns.js'),
  'zh-CN/assistant': () => import('./zh-cn/assistant.js'),
  'zh-TW/common': () => import('./zh-tw/common.js'),
  'zh-TW/ui': () => import('./zh-tw/ui.js'),
  'zh-TW/studio': () => import('./zh-tw/studio.js'),
  'zh-TW/generated': () => import('./zh-tw/generated.js'),
  'zh-TW/errors': () => import('./zh-tw/errors.js'),
  'zh-TW/email': () => import('./zh-tw/email.js'),
  'zh-TW/automations': () => import('./zh-tw/automations.js'),
  'zh-TW/dataio': () => import('./zh-tw/dataio.js'),
  'zh-TW/files': () => import('./zh-tw/files.js'),
  'zh-TW/reportBuilder': () => import('./zh-tw/reportBuilder.js'),
  'zh-TW/onboarding': () => import('./zh-tw/onboarding.js'),
  'zh-TW/project': () => import('./zh-tw/project.js'),
  'zh-TW/addOns': () => import('./zh-tw/addOns.js'),
  'zh-TW/assistant': () => import('./zh-tw/assistant.js'),
  'ar-EG/common': () => import('./ar-eg/common.js'),
  'ar-EG/ui': () => import('./ar-eg/ui.js'),
  'ar-EG/studio': () => import('./ar-eg/studio.js'),
  'ar-EG/generated': () => import('./ar-eg/generated.js'),
  'ar-EG/errors': () => import('./ar-eg/errors.js'),
  'ar-EG/email': () => import('./ar-eg/email.js'),
  'ar-EG/automations': () => import('./ar-eg/automations.js'),
  'ar-EG/dataio': () => import('./ar-eg/dataio.js'),
  'ar-EG/files': () => import('./ar-eg/files.js'),
  'ar-EG/reportBuilder': () => import('./ar-eg/reportBuilder.js'),
  'ar-EG/onboarding': () => import('./ar-eg/onboarding.js'),
  'ar-EG/project': () => import('./ar-eg/project.js'),
  'ar-EG/addOns': () => import('./ar-eg/addOns.js'),
  'ar-EG/assistant': () => import('./ar-eg/assistant.js'),
};

/**
 * `BundleLoader`-shaped (create-i18n.ts): resolves `null` for pairs without a
 * lazy bundle (en-US's eager namespaces — already in the main chunk — and
 * unknown tags), so the en-US fallback chain applies instead of failing.
 */
export async function loadLocaleBundle(tag: string, ns: Namespace): Promise<BundleModule | null> {
  const loader = LOADERS[`${tag}/${ns}`];
  if (loader === undefined) return null;
  return loader();
}
