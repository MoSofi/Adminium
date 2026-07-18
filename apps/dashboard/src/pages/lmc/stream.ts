/**
 * App-lifetime stream transport singleton for the live-tail templates
 * (page-log-viewer's WS tail — 04-widget-registry.md §5.3).
 *
 * `createStreamTransport` (src/api/streamTransport.ts) already reference-
 * counts channels and tears the socket down when the last subscriber leaves,
 * so ONE lazily-created instance can back every live page for the session —
 * exactly the "single multiplexed connection" §5.3 asks for. Kept in its own
 * module (not a React context bootstrap in AppShell) so only pages that
 * actually stream ever open the connection.
 */
import { createStreamTransport, type DashboardStreamTransport } from '../../api/streamTransport.js';

let singleton: DashboardStreamTransport | null = null;

export function appStreamTransport(): DashboardStreamTransport {
  singleton ??= createStreamTransport();
  return singleton;
}

/** Test seam: drop the shared instance so each test starts cold. */
export function resetAppStreamTransport(): void {
  singleton?.stop();
  singleton = null;
}
