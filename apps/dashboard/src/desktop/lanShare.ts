/**
 * LAN share, as the SPA sees it (11-electron.md §8.3).
 *
 * ─── Why this module has two feeds and not one ───────────────────────────────
 *
 * §8.3's panel is assembled from both sides of the process boundary, and neither
 * side can answer the other's questions:
 *
 *  - **The bridge** (§4's `getRuntimeInfo`/`setConfig`) owns `config.lanShare` —
 *    the toggle, the port, and the reachable `http://<LAN-IPv4>:<port>` URLs.
 *    `config.json` is the main process's file (§2.3), the URL list comes from
 *    `os.networkInterfaces()` in the process that HAS interfaces, and the rebind
 *    is main's child to restart. The server cannot write any of it.
 *  - **`GET /api/v1/desktop/lan-share`** owns who is connected and whether there
 *    is anyone to invite. Those are meta-store reads, and §1 principle 2 makes
 *    the server the only thing allowed to make them.
 *
 * ─── Intent vs. reality, which is the panel's whole subtlety ─────────────────
 *
 * `config.lanShare.enabled` is what the user ASKED for; the route's `active` is
 * what the socket actually DID. They disagree for a whole server lifetime when a
 * rebind has failed or has not happened yet, and the panel must show the second
 * — see {@link LanShareView}. This is the same reason §8.1's chip reads
 * `system/info`'s `lanShare` rather than the bridge.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../app/api.js';
import { getDesktopApi } from '../lib/desktop-runtime.js';

/**
 * The panel's anchor, for §8.1's "click → LAN panel".
 *
 * A hash and not a route: §8.3 calls this a panel opened FROM the toggle, and it
 * lives on the desktop settings page next to the switch that controls it. The
 * chip needs somewhere to send you, not a second page to maintain.
 */
export const LAN_SHARE_PANEL_HASH = 'lan-share';

/** §8.3 / BRIEF §3. Mirrors `main/config.ts`'s `DEFAULT_LAN_PORT`. */
export const DEFAULT_LAN_PORT = 4600;

/** What §4's bridge reports about `config.lanShare` (§2.3). */
export interface LanShareConfig {
  enabled: boolean;
  port: number;
  /** `http://<LAN-IPv4>:<port>` per non-internal interface. Empty while off. */
  urls: readonly string[];
}

/** The bridge's answer, or `null` when there is no bridge (self-host, a browser tab). */
export async function readLanShare(): Promise<LanShareConfig | null> {
  const desktop = getDesktopApi();
  if (desktop === null) return null;
  const info = await desktop.getRuntimeInfo();
  return { enabled: info.lanShare.enabled, port: info.lanShare.port, urls: info.lanShare.urls };
}

/**
 * Write the toggle to `config.json` and let main rebind the child (§8.3).
 *
 * Both fields go every time, including the unchanged one. `setConfig` takes a
 * PATCH whose `lanShare` is replaced wholesale, so sending `{ enabled }` alone
 * would be a `lanShare` object with no `port` — and main's `lanBindingChange`
 * compares ports to decide whether to restart at all.
 *
 * REJECTS on a port collision, with `LAN_PORT_IN_USE` and nothing written or
 * restarted; {@link lanPortSuggestion} reads the "Try 4601" back out.
 */
export async function setLanShare(next: { enabled: boolean; port: number }): Promise<void> {
  const desktop = getDesktopApi();
  if (desktop === null) throw new Error('the desktop bridge is unavailable');
  await desktop.setConfig({ lanShare: { enabled: next.enabled, port: next.port } });
}

/**
 * §8.3's "Try 4601", parsed out of the rejection message.
 *
 * A regex over prose is not the shape anyone would choose, and it is the shape
 * the wire has: `main/ipc.ts` flattens a thrown error to `{ code, message }` and
 * nothing else survives the `contextBridge` crossing, so a structured
 * `suggestedPort` field has nowhere to ride. `main/index.ts`'s `lanBindError`
 * produces the string and says the same thing from its side; `lanShare.test.ts`
 * pins the format against that producer's exact output, so the two cannot drift
 * without a red test.
 *
 * `null` when the message carries no suggestion — the top of the port range,
 * where `suggestNextPort` correctly has nothing to offer.
 */
export function lanPortSuggestion(message: string): number | null {
  const match = /\bTry (\d{1,5})\./.exec(message);
  if (match?.[1] === undefined) return null;
  const port = Number.parseInt(match[1], 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

/** `GET /api/v1/desktop/lan-share`'s payload (`routes/desktop-lan/schema.ts`). */
export interface LanShareStatus {
  /** The BIND, not the toggle — see the module header. */
  active: boolean;
  host: string;
  lanSessions: number;
  otherUsers: number;
}

interface LanShareStatusEnvelope {
  data: LanShareStatus;
}

/**
 * The server half of the panel.
 *
 * `staleTime: 0` with a poll while the panel is open: the session count is the
 * one number here that changes without this SPA doing anything — someone on
 * another device signs in — and a count that only updates on navigation is a
 * count that is wrong exactly when the admin is watching it to see whether their
 * colleague got in.
 */
export const LAN_SHARE_STATUS_POLL_MS = 10_000;

export function lanShareStatusQuery() {
  return queryOptions({
    queryKey: ['desktop', 'lan-share'] as const,
    queryFn: async (): Promise<LanShareStatus> =>
      (await api.get<LanShareStatusEnvelope>('/api/v1/desktop/lan-share')).data,
    staleTime: 0,
    refetchInterval: LAN_SHARE_STATUS_POLL_MS,
    // The route is Super-Admin + loopback only (`routes/desktop-lan/index.ts`).
    // A non-super-admin LAN user who navigates here gets one 403 and no loop.
    retry: false,
  });
}

/**
 * What the panel should say, from the two feeds joined.
 *
 * Pure and exported so the precedence is testable without a DOM — the states
 * that matter are the ones where the config and the socket disagree, and those
 * are unreachable from a component test that can only drive the toggle.
 *
 * - `off` — not sharing, and not trying to.
 * - `sharing` — the config says on and the socket agrees. The only state that
 *   shows URLs, because it is the only one in which they are reachable.
 * - `pending` — the config says on and the socket has not caught up (a rebind in
 *   flight, or the status is not loaded yet). Shows no URLs: handing out an
 *   address that nothing is listening on is the panel's worst output.
 * - `mismatch` — the config says OFF and the server is bound wide anyway. This
 *   should be unreachable (main reverts a failed rebind, §8.3), and if it
 *   happens it is a live network exposure the user did not ask for, so it is
 *   reported loudly rather than rendered as `off`.
 */
export type LanShareView = 'off' | 'sharing' | 'pending' | 'mismatch';

export function lanShareView(input: {
  configEnabled: boolean;
  /** `null` while the server's answer is unknown — pending, or refused. */
  active: boolean | null;
}): LanShareView {
  if (input.configEnabled) return input.active === true ? 'sharing' : 'pending';
  return input.active === true ? 'mismatch' : 'off';
}
