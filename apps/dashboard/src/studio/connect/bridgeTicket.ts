// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The parked ticket of the local bridge (`./bridgeSeed.ts`): whether one is
 * waiting, and taking it. Kept apart from the code that captures and redeems
 * it, which only a page opened with a ticket or the connect wizard loads, so
 * the first paint carries these few lines alone.
 */

/** The query parameter the site redirects with. */
export const BRIDGE_PARAM = 'bridge';

/** Where a captured ticket waits for the connect route. Per-tab, by design. */
export const BRIDGE_STORAGE_KEY = 'adminium-bridge-ticket';

/** Is a hand-off waiting? Read-only — used to decide where to send the user. */
export function hasPendingBridgeTicket(): boolean {
  try {
    return window.sessionStorage.getItem(BRIDGE_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Read the parked ticket and clear it. Single-use at this end too. */
export function takeBridgeTicket(): string | null {
  try {
    const ticket = window.sessionStorage.getItem(BRIDGE_STORAGE_KEY);
    window.sessionStorage.removeItem(BRIDGE_STORAGE_KEY);
    return ticket === '' ? null : ticket;
  } catch {
    return null;
  }
}
