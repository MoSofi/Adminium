/**
 * The receiving end of the local bridge (`apps/server/src/routes/bridge`).
 *
 * adminium.dev cannot introspect a database — a web page has no raw TCP — so
 * when someone pastes a connection string there it is handed to the Adminium
 * running on their own machine and the browser is sent here with a one-time
 * ticket. This module turns that ticket back into a DSN and hands it to the
 * connect wizard as a PREFILL.
 *
 * Prefill, not autopilot: the wizard still lands on its source step with the
 * value visible, and the user still presses Continue. That is deliberate and is
 * the property the bridge's whole safety argument rests on — an allow-listed
 * page can put text in a field you are about to read, and nothing more.
 */

import { api } from '../../app/api.js';
import type { ConnectionEngine } from '../api.js';

/** The query parameter the site redirects with. */
export const BRIDGE_PARAM = 'bridge';

/** Where a captured ticket waits for the connect route. Per-tab, by design. */
const STORAGE_KEY = 'adminium-bridge-ticket';

export interface BridgeSeed {
  dsn: string;
  engine: ConnectionEngine | null;
}

/**
 * Lift the ticket out of `window.location` and park it for the connect route.
 *
 * Called from `main.tsx` BEFORE the router mounts, for the same two reasons
 * `exchangeBootToken` is: the value has to leave the URL before anything can
 * copy it into router state or leak it through a `Referer` header, and the
 * route that consumes it may not be the route that first renders.
 *
 * That second reason is the whole point of the hand-off surviving in storage.
 * The site redirects to `/studio/connect?bridge=…`, but a FRESH install
 * client-side-redirects straight to `/setup` — nobody has an account yet — so a
 * ticket read only by the connect route would be discarded before the user even
 * had somewhere to put it. sessionStorage carries it across the first-run
 * detour and no further: it is per-tab, dies with the tab, and holds an opaque
 * single-use value that is worthless without an admin session on this instance.
 */
export function captureBridgeTicket(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const ticket = url.searchParams.get(BRIDGE_PARAM);
  if (ticket === null || ticket === '') return;
  url.searchParams.delete(BRIDGE_PARAM);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  try {
    window.sessionStorage.setItem(STORAGE_KEY, ticket);
  } catch {
    // Private mode / storage disabled. The hand-off is lost, which the wizard
    // renders as an ordinary "paste it yourself" — never as a failure.
  }
}

/** Is a hand-off waiting? Read-only — used to decide where to send the user. */
export function hasPendingBridgeTicket(): boolean {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Read the parked ticket and clear it. Single-use at this end too. */
export function takeBridgeTicket(): string | null {
  try {
    const ticket = window.sessionStorage.getItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
    return ticket === '' ? null : ticket;
  } catch {
    return null;
  }
}

/** Narrow the server's free-form engine string onto the three this build connects to. */
function asEngine(value: string | null): ConnectionEngine | null {
  return value === 'postgres' || value === 'mysql' || value === 'sqlite' ? value : null;
}

/**
 * Redeem a ticket. The route is session-gated and single-use, so this succeeds
 * at most once and only for a signed-in admin.
 *
 * A reply that is not the shape we expect is treated as a failure rather than
 * being destructured optimistically: the caller renders "that hand-off could not
 * be used" and the wizard stays usable by hand, which is strictly better than a
 * `TypeError` escaping into an unhandled rejection and leaving the user looking
 * at a wizard that silently ignored the thing they just did.
 */
export async function redeemBridgeSeed(ticket: string): Promise<BridgeSeed> {
  const body = await api.get<{ data?: { dsn?: unknown; engine?: unknown } }>(
    `/api/v1/bridge/seed/${encodeURIComponent(ticket)}`,
  );
  const dsn = body.data?.dsn;
  if (typeof dsn !== 'string' || dsn === '') {
    throw new Error('The bridge returned no connection string.');
  }
  const engine = body.data?.engine;
  return { dsn, engine: asEngine(typeof engine === 'string' ? engine : null) };
}
