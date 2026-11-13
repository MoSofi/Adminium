// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The asleep answer. An operator whose proxy puts idle instances to sleep
 * (adminium.app) answers an API call to a sleeping one with a JSON 503,
 * `Retry-After` and `X-Aapp-Asleep: 1`, and wakes the instance only when a page
 * is opened. So when an API call gets that answer, the dashboard reloads the
 * page: the reload is a page open, and the person gets their app back after the
 * proxy's waking page.
 *
 * At most once in {@link ASLEEP_RELOAD_GAP_MS}, remembered across the reload in
 * session storage, so a proxy that keeps answering it never makes a loop.
 * Without that header (every server not behind such a proxy) nothing happens.
 */

/** The header the operator's proxy sets on its asleep answer. */
export const ASLEEP_HEADER = 'x-aapp-asleep';

/** The least time between two reloads for the asleep answer. */
export const ASLEEP_RELOAD_GAP_MS = 30_000;

const STORAGE_KEY = 'adminium.asleepReloadAt';

/** When this page last reloaded for it, where session storage cannot keep it. */
let reloadedAt: number | null = null;

export interface AsleepDeps {
  now: () => number;
  reload: () => void;
  storage: () => Pick<Storage, 'getItem' | 'setItem'>;
}

const browser: AsleepDeps = {
  now: () => Date.now(),
  reload: () => globalThis.location.reload(),
  storage: () => globalThis.sessionStorage,
};

/** Is this the operator's asleep answer? */
export function isAsleepAnswer(response: Pick<Response, 'status' | 'headers'>): boolean {
  return response.status === 503 && response.headers.get(ASLEEP_HEADER) === '1';
}

/** Reload the page for the asleep answer, unless it was reloaded for it a moment ago. True when it reloads. */
export function reloadIfAsleep(response: Pick<Response, 'status' | 'headers'>, deps: AsleepDeps = browser): boolean {
  if (!isAsleepAnswer(response)) return false;
  const now = deps.now();
  let last = reloadedAt;
  try {
    const kept = Number(deps.storage().getItem(STORAGE_KEY));
    if (Number.isFinite(kept) && kept > 0) last = Math.max(last ?? 0, kept);
  } catch {
    // No session storage (a private window, blocked site data): this page's own memory is all there is.
  }
  if (last !== null && now - last >= 0 && now - last < ASLEEP_RELOAD_GAP_MS) return false;
  reloadedAt = now;
  try {
    deps.storage().setItem(STORAGE_KEY, String(now));
  } catch {
    // As above.
  }
  deps.reload();
  return true;
}

/** Forget the last reload (tests). */
export function resetAsleepReload(): void {
  reloadedAt = null;
}
