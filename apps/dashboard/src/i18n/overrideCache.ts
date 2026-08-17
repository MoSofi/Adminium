// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SYNCHRONOUS, boot-path half of the override layer
 * (23-runtime-translations.md §4.7).
 *
 * Only the warm-cache read has to happen before the first paint; everything
 * that touches the network (`./overrides.ts`) is post-boot and is
 * dynamic-imported, so the dashboard's entry chunk pays for a localStorage
 * read and nothing else. `check-entry-budget.mjs` is a ratchet that may not
 * be raised to make a build green, and this split is how the feature stays
 * under it without giving up the flash-free warm boot.
 */
import { setRuntimeLocales, type OverrideMap, type RuntimeLocaleEntry } from '@adminium/i18n';

export const CACHE_KEY = 'adminium-i18n-overrides';
export const VERSION_KEY = 'adminium-i18n-version';
export const LOCALES_KEY = 'adminium-i18n-locales';

export interface CachedPayload {
  version: number;
  locale: string;
  overrides: OverrideMap;
  locales: RuntimeLocaleEntry[];
}

export function readCache(): CachedPayload | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as CachedPayload;
    if (typeof parsed.version !== 'number' || typeof parsed.overrides !== 'object') return null;
    return parsed;
  } catch {
    // Private mode, quota, or a payload written by an older build.
    return null;
  }
}

export function writeCache(payload: CachedPayload): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    window.localStorage.setItem(VERSION_KEY, String(payload.version));
    window.localStorage.setItem(LOCALES_KEY, JSON.stringify(payload.locales));
  } catch {
    // A full quota must not break booting; the next load just runs cold.
  }
}

/** The version the last successful fetch saw — the resync comparison point. */
export function cachedVersion(): number {
  return readCache()?.version ?? -1;
}

/** Overrides for `locale` from the warm cache, or null on a cold boot. */
export function cachedOverrides(locale: string): OverrideMap | null {
  const cached = readCache();
  if (cached === null || cached.locale !== locale) return null;
  // Prime the locale registry too, so a custom locale's direction and Intl tag
  // are known before the first paint rather than after the manifest lands.
  if (Array.isArray(cached.locales)) setRuntimeLocales(cached.locales);
  return cached.overrides;
}

/** Clear the cache — used when a user signs out or the locale changes. */
export function clearOverrideCache(): void {
  try {
    window.localStorage.removeItem(CACHE_KEY);
    window.localStorage.removeItem(VERSION_KEY);
    window.localStorage.removeItem(LOCALES_KEY);
  } catch {
    // Nothing to do; a stale cache is corrected by the next version compare.
  }
}
