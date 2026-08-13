/**
 * ICU formatting for the NO-INSTANCE path.
 *
 * Every `t(key, fallback, args)` in this repo has to work before
 * `initDashboardI18n()` has run and inside unit tests that never boot i18next
 * — components render, and the English fallback is what they show. Returning
 * the fallback *raw* in that state is wrong the moment the fallback has
 * placeholders: the user (or the test) sees the literal `{count} changes`.
 *
 * That defect used to be invisible because 48 call sites hand-substituted
 * their tokens with `.replace('{count}', …)` AFTER `t()` returned, which
 * silently papered over it. Once those became real ICU arguments (23-T06)
 * the gap showed up, so both fallback paths — `useMaybeT` in the React
 * bindings and the dashboard's module-level `t()` — now share this one
 * implementation.
 */

import { IntlMessageFormat } from 'intl-messageformat';

const cache = new Map<string, IntlMessageFormat>();

/**
 * Format `fallback` (always en-US source text) with `args`. Returns the
 * fallback unchanged when there is nothing to interpolate or when the message
 * does not parse — this path must never throw, since it is what renders when
 * i18n is not up.
 */
export function formatFallback(fallback: string, args?: Record<string, unknown>): string {
  if (args === undefined || !fallback.includes('{')) return fallback;
  try {
    let message = cache.get(fallback);
    if (message === undefined) {
      message = new IntlMessageFormat(fallback, 'en-US', undefined, { ignoreTag: true });
      cache.set(fallback, message);
    }
    return String(message.format(args as Record<string, string | number>));
  } catch {
    return fallback;
  }
}
