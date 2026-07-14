/**
 * App-wide translator. Same call signature as the pre-M8 stub —
 * `t(key, fallback)` — but now backed by the shared i18next instance
 * (@adminium/i18n, 10-i18n-theming.md §2.3) once `initDashboardI18n()`
 * (./setup.ts) has run. Before init (or in unit tests that never boot i18n)
 * it degrades to the fallback text, exactly like the old stub, so the key
 * sweep to real bundles stays mechanical.
 *
 * Keys are bare (no `ns:` prefix) and resolve in the `common` namespace by
 * default; `ui:`/`studio:`/`generated:`/`errors:` prefixes address the other
 * bundles (§2.4/§2.5). ICU args ride the third parameter.
 */
import type { I18nInstance } from '@adminium/i18n';

export type { I18nInstance };

let instance: I18nInstance | null = null;

/** Wired once by `initDashboardI18n()`; exported for tests. */
export function setI18nInstance(i18n: I18nInstance | null): void {
  instance = i18n;
}

export function getI18nInstance(): I18nInstance | null {
  return instance;
}

export function t(key: string, fallback: string, args?: Record<string, unknown>): string {
  if (instance === null) return fallback;
  return instance.t(key, { defaultValue: fallback, ...args });
}
