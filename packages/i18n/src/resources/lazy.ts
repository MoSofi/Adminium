// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Lazy loaders for every locale/namespace pair that is not bundled
 * (10-i18n-theming.md §2.3). Each entry is a LITERAL dynamic import so
 * bundlers (Vite, Electron packaging) split one chunk per bundle and a de_DE
 * user downloads only German strings. Pass {@link loadLocaleBundle} as
 * `createI18n`'s `loadBundle`.
 *
 * Two things are lazy here, for two different reasons:
 *
 * - **the 7 non-English locales, every namespace.** en-US's eager namespaces
 *   (./eager.ts) ship in the main bundle because they are the fallback text
 *   and must never be async; nobody else's do.
 * - **`studio`, en-US INCLUDED** (10-T06). The deferred namespace is loaded
 *   on demand by the surface that owns it, so the English console text is a
 *   chunk the console's own visitors fetch rather than ~36 KiB every user
 *   carries. See `DEFERRED_NAMESPACES` in ./namespaces.ts for the contract
 *   that makes this safe.
 */
import type { Namespace, ResourceBundle } from './namespaces.js';

type BundleModule = { default: ResourceBundle };

const LOADERS: Readonly<Record<string, () => Promise<BundleModule>>> = {
  // The one en-US bundle that is not in the main chunk (DEFERRED_NAMESPACES).
  'en-US/studio': () => import('./en-us/studio.js'),
  'de-DE/common': () => import('./de-de/common.js'),
  'de-DE/ui': () => import('./de-de/ui.js'),
  'de-DE/studio': () => import('./de-de/studio.js'),
  'de-DE/generated': () => import('./de-de/generated.js'),
  'de-DE/errors': () => import('./de-de/errors.js'),
  'fr-FR/common': () => import('./fr-fr/common.js'),
  'fr-FR/ui': () => import('./fr-fr/ui.js'),
  'fr-FR/studio': () => import('./fr-fr/studio.js'),
  'fr-FR/generated': () => import('./fr-fr/generated.js'),
  'fr-FR/errors': () => import('./fr-fr/errors.js'),
  'cs-CZ/common': () => import('./cs-cz/common.js'),
  'cs-CZ/ui': () => import('./cs-cz/ui.js'),
  'cs-CZ/studio': () => import('./cs-cz/studio.js'),
  'cs-CZ/generated': () => import('./cs-cz/generated.js'),
  'cs-CZ/errors': () => import('./cs-cz/errors.js'),
  'da-DK/common': () => import('./da-dk/common.js'),
  'da-DK/ui': () => import('./da-dk/ui.js'),
  'da-DK/studio': () => import('./da-dk/studio.js'),
  'da-DK/generated': () => import('./da-dk/generated.js'),
  'da-DK/errors': () => import('./da-dk/errors.js'),
  'zh-CN/common': () => import('./zh-cn/common.js'),
  'zh-CN/ui': () => import('./zh-cn/ui.js'),
  'zh-CN/studio': () => import('./zh-cn/studio.js'),
  'zh-CN/generated': () => import('./zh-cn/generated.js'),
  'zh-CN/errors': () => import('./zh-cn/errors.js'),
  'zh-TW/common': () => import('./zh-tw/common.js'),
  'zh-TW/ui': () => import('./zh-tw/ui.js'),
  'zh-TW/studio': () => import('./zh-tw/studio.js'),
  'zh-TW/generated': () => import('./zh-tw/generated.js'),
  'zh-TW/errors': () => import('./zh-tw/errors.js'),
  'ar-EG/common': () => import('./ar-eg/common.js'),
  'ar-EG/ui': () => import('./ar-eg/ui.js'),
  'ar-EG/studio': () => import('./ar-eg/studio.js'),
  'ar-EG/generated': () => import('./ar-eg/generated.js'),
  'ar-EG/errors': () => import('./ar-eg/errors.js'),
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
