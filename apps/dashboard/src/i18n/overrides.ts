// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Client side of the runtime override layer (23-runtime-translations.md §4.4,
 * §4.7).
 *
 * Two jobs:
 *
 *  1. Get overrides in front of the first paint when we can. i18n is fully
 *     initialised BEFORE the router mounts, and `/bootstrap` is a route-level
 *     fetch that happens afterwards — so overrides cannot ride the bootstrap
 *     payload and reach first paint. They are fetched inside `setup.ts`'s
 *     existing 2 s race instead, and cached in localStorage keyed by version:
 *     a WARM boot paints overridden text immediately, a COLD one may paint
 *     compiled text for up to the cap before swapping. That is a real,
 *     acknowledged amendment to 10 §7.5 rather than a silent regression.
 *  2. Keep them fresh afterwards, without pretending the delivery is stronger
 *     than it is. The realtime hub is in-process with no cross-node fan-out
 *     and the socket client invalidates nothing on reconnect, so a WS event is
 *     best-effort. The floor that does not depend on it is a version compare
 *     on reconnect and on `visibilitychange`.
 */
import { bumpI18nRevision, setRuntimeLocales, type OverrideMap, type RuntimeLocaleEntry } from '@adminium/i18n';

import { fetchManifest, fetchOverrides, type I18nManifest } from '../api/i18nBoot.js';
import { cachedVersion, writeCache } from './overrideCache.js';

function toRuntimeEntries(manifest: I18nManifest): RuntimeLocaleEntry[] {
  return manifest.locales.map((entry) => ({
    id: entry.locale,
    tag: entry.tag,
    english: entry.english,
    native: entry.native,
    dir: entry.dir,
    fontHint: entry.fontHint,
    builtin: entry.builtin,
    enabled: entry.enabled,
    sortOrder: entry.sortOrder,
    intlTag: entry.intlTag,
    pluralCategories: entry.pluralCategories,
  }));
}

export interface OverrideSnapshot {
  version: number;
  overrides: OverrideMap;
  locales: RuntimeLocaleEntry[];
}

/**
 * Fetch the manifest and this locale's overrides, install the locale registry,
 * and write the cache. Throws on network failure — callers decide whether that
 * is fatal (it never is: compiled text is a correct, if un-customised, render).
 */
export async function loadOverrides(locale: string): Promise<OverrideSnapshot> {
  const [manifest, overrides] = await Promise.all([fetchManifest(), fetchOverrides(locale)]);
  const locales = toRuntimeEntries(manifest);
  setRuntimeLocales(locales);
  writeCache({ version: manifest.version, locale, overrides, locales });
  return { version: manifest.version, overrides, locales };
}

/**
 * Compare the server's version against what we hold and, when it moved, hand
 * the caller a fresh snapshot to rebuild from.
 *
 * This is the at-least-once floor referred to in the module header: it does
 * not depend on the realtime hub having delivered anything, which matters
 * because a tab whose socket dropped during the backoff window would
 * otherwise never learn that the strings changed.
 */
export async function resyncIfStale(locale: string): Promise<OverrideSnapshot | null> {
  try {
    const manifest = await fetchManifest();
    if (manifest.version === cachedVersion()) {
      // Still install the registry: enabled/disabled flags may have been
      // cached from an older shape.
      setRuntimeLocales(toRuntimeEntries(manifest));
      return null;
    }
    const snapshot = await loadOverrides(locale);
    bumpI18nRevision();
    return snapshot;
  } catch {
    // Offline or signed out — the compiled text is still correct.
    return null;
  }
}

export { cachedOverrides, cachedVersion, clearOverrideCache } from './overrideCache.js';
