// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The asleep answer. An operator whose proxy puts idle instances to sleep
 * (adminium.app) answers an API call to a sleeping one with a JSON 503,
 * `Retry-After` and `X-Aapp-Asleep: 1`, and wakes the instance only when a page
 * is opened. So when an API read gets that answer, the dashboard reloads the
 * page: the reload is a page open, and the person gets their app back after the
 * proxy's waking page. A save that gets it does not reload (`api.ts`): it fails
 * with the proxy's message and what the person typed stays on the page.
 *
 * At most once in {@link ASLEEP_RELOAD_GAP_MS}, remembered across the reload in
 * session storage, so a proxy that keeps answering it never makes a loop.
 * Without that header (every server not behind such a proxy) nothing happens.
 * In the entry on purpose: a lazy chunk would be asked of the sleeping instance.
 */

/** The least time between two reloads for the asleep answer. */
export const ASLEEP_RELOAD_GAP_MS = 30_000;

const KEY = 'adminium.asleepReloadAt';

/** When this page last reloaded for it, for when session storage cannot keep it. */
let reloadedAt = 0;

/** Reload the page for the asleep answer, unless it was reloaded for it a moment ago. True when it reloads. */
export function reloadIfAsleep(response: Pick<Response, 'status' | 'headers'>, now = Date.now()): boolean {
  if (response.status !== 503 || response.headers.get('x-aapp-asleep') !== '1') return false;
  let last = reloadedAt;
  try {
    last = Math.max(last, Number(sessionStorage.getItem(KEY)) || 0);
  } catch {
    // No session storage (a private window, blocked site data): this page's own memory is all there is.
  }
  if (now >= last && now - last < ASLEEP_RELOAD_GAP_MS) return false;
  reloadedAt = now;
  try {
    sessionStorage.setItem(KEY, String(now));
  } catch {
    // As above.
  }
  location.reload();
  return true;
}

/** Forget the last reload (tests). */
export function resetAsleepReload(): void {
  reloadedAt = 0;
}
