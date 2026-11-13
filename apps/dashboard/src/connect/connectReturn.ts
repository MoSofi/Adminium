// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The browser coming back from an operator's connect service ("Connect
 * Supabase"): `<origin>/connect/supabase/return?state=…&code=…`.
 *
 * Lifted out of the address BEFORE the router mounts, like the bridge ticket
 * (`studio/connect/bridgeSeed.ts`): the one-time code must leave
 * `window.location` before anything copies it into router state or a
 * `Referer`. It waits in this tab's sessionStorage for the connect wizard,
 * which redeems it (a signed-in request, bound to the session that started
 * it), and the address becomes `/studio/connect`.
 *
 * Its own chunk: `main.tsx` loads it only on that address, so the entry
 * chunk carries one `startsWith`.
 */

const RETURN_PATH = /^\/connect\/(supabase)\/return\/?$/;
const STORAGE_KEY = 'adminium-connect-return';

export interface ConnectReturn {
  provider: 'supabase';
  state: string;
  code: string;
}

/** Called from `main.tsx`, before the router. A no-op on every other address. */
export function captureConnectReturn(): void {
  if (typeof window === 'undefined') return;
  const match = RETURN_PATH.exec(window.location.pathname);
  if (match === null) return;
  const url = new URL(window.location.href);
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  window.history.replaceState(window.history.state, '', '/studio/connect');
  if (state === '' || code === '') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: match[1], state, code }));
  } catch {
    // Storage off: the wizard shows the card again, and the person starts once more.
  }
}

/** Read the waiting return and forget it: single use at this end too. */
export function takeConnectReturn(): ConnectReturn | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<ConnectReturn>;
    return parsed.provider === 'supabase' && typeof parsed.state === 'string' && typeof parsed.code === 'string'
      ? { provider: parsed.provider, state: parsed.state, code: parsed.code }
      : null;
  } catch {
    return null;
  }
}

/** Is one waiting? Read-only: the wizard opens on its source step when so. */
export function hasConnectReturn(): boolean {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}
