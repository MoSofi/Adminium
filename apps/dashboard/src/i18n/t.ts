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
import { formatFallback, type I18nInstance } from '@adminium/i18n';

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
  // Before init (and in unit tests that never boot i18n) the fallback is what
  // renders — but it must still be INTERPOLATED, or a message like
  // `'{count} changes'` reaches the screen with its braces intact. Returning
  // the raw fallback was survivable only while 48 call sites hand-substituted
  // their tokens afterwards; once those became real ICU args (23-T06) this is
  // the path that has to do the work. Same implementation as `useMaybeT`.
  if (instance === null) return formatFallback(fallback, args);
  return instance.t(key, { defaultValue: fallback, ...args });
}
