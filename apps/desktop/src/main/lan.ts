// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LAN share, as the MAIN PROCESS owns it (11-electron.md §8.3).
 *
 * Three things live here, and each is here because it needs something only this
 * process has:
 *
 *  1. {@link enumerateLanUrls} — §8.3's "reachable URLs (`http://<LAN-IPv4>:4600`
 *     for each non-internal interface, via `os.networkInterfaces()`)". The
 *     server child cannot answer this: it knows the socket it bound, not the
 *     addresses that reach it, and `0.0.0.0` is not an address you can type into
 *     a phone.
 *  2. {@link probeBindable} — the §8.3 collision check ("Port collision ⇒ inline
 *     error with a 'Try 4601' suggestion"), run BEFORE the restart rather than
 *     discovered by it. See its comment for why the ordering is the whole
 *     feature.
 *  3. {@link suggestNextPort} — the "Try 4601".
 *
 * NOTHING HERE DECIDES ANYTHING. The toggle is `config.json`'s (§2.3) and the
 * rebind is `ServerManager.restart`'s (§2.2 step 9); this module supplies facts.
 * `os` and `net` are injected so all three are testable without a real machine's
 * interfaces or a real free port, which matters — an interface list is exactly
 * the kind of input whose interesting cases (a Docker bridge, a VPN's IPv6-only
 * tunnel, a `lo` alias) never appear on the developer's laptop.
 */

import net from 'node:net';
import os from 'node:os';

/** §8.3 / BRIEF §3: the default LAN port. Mirrors `config.ts`'s `DEFAULT_LAN_PORT`. */
export const DEFAULT_LAN_PORT = 4600;

/** §2.4/§8.3: the bind that makes this app reachable from the LAN. */
export const WILDCARD_HOST = '0.0.0.0';

/** The slice of `os.networkInterfaces()`'s entries this module reads. */
export interface NetworkInterfaceLike {
  address: string;
  family: string | number;
  /** True for `lo`/`lo0` and friends — see {@link enumerateLanUrls}. */
  internal: boolean;
}

export type NetworkInterfaces = () => NodeJS.Dict<NetworkInterfaceLike[]>;

/** One reachable address, ready for the §8.3 panel's list + copy button. */
export interface LanUrl {
  /** The OS's name for the NIC (`en0`, `Wi-Fi`, `eth0`) — the panel labels rows with it. */
  interfaceName: string;
  address: string;
  /** `http://<LAN-IPv4>:<port>` (§8.3). */
  url: string;
}

/**
 * §8.3's URL list: `http://<LAN-IPv4>:<port>` for every non-internal interface.
 *
 * ─── The three filters, and why each one is a real case ──────────────────────
 *
 * **`internal`** — §8.3 says "non-internal" and means it. `lo0` carries
 * `127.0.0.1`, which is reachable from exactly this machine; putting it in a
 * list headed "other devices can use these addresses" would be the panel's one
 * unforgivable lie, because it is the address that WORKS when you test it
 * yourself and fails for everyone you send it to.
 *
 * **IPv4 only** — §8.3 writes `http://<LAN-IPv4>:4600` explicitly. It is not
 * arbitrary: a link-local IPv6 address (`fe80::…%en0`) is not typeable into
 * another device's browser without its zone index, the zone index is that
 * DEVICE'S name for the interface and not ours, and a global IPv6 address is not
 * a LAN address at all — it is a public one, which is precisely what §8.3's
 * transport-honesty copy ("Share only on networks you trust") assumes we are
 * NOT handing out over plain HTTP.
 *
 * **Node's `family` shape** — compared against both `'IPv4'` and `4`. Node 18
 * changed this from the number to the string and the type says `string | number`
 * across the versions this repo's `engines.node >= 22` allows on paper; a
 * strict `=== 'IPv4'` silently produces an EMPTY list on the wrong runtime,
 * which reads as "no network" rather than as a bug.
 *
 * Sorted by interface name so the list does not reshuffle between polls —
 * `os.networkInterfaces()` makes no ordering promise, and a copy button that
 * moves under the cursor is a bug you cannot reproduce.
 */
export function enumerateLanUrls(
  port: number,
  interfaces: NetworkInterfaces = os.networkInterfaces as NetworkInterfaces,
): LanUrl[] {
  const found: LanUrl[] = [];
  for (const [interfaceName, entries] of Object.entries(interfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      found.push({
        interfaceName,
        address: entry.address,
        url: `http://${entry.address}:${String(port)}`,
      });
    }
  }
  return found.sort((a, b) =>
    a.interfaceName === b.interfaceName
      ? a.address.localeCompare(b.address)
      : a.interfaceName.localeCompare(b.interfaceName),
  );
}

/** {@link enumerateLanUrls}, flattened to the `string[]` §4's bridge carries. */
export function lanShareUrls(port: number, interfaces?: NetworkInterfaces): string[] {
  return (interfaces === undefined ? enumerateLanUrls(port) : enumerateLanUrls(port, interfaces))
    .map((entry) => entry.url);
}

/** §8.3's "Try 4601" — the next port up, or `null` at the top of the range. */
export function suggestNextPort(port: number): number | null {
  return port >= 65535 ? null : port + 1;
}

export type ProbeResult =
  | { ok: true }
  /** Something already holds the port — §8.3's collision. */
  | { ok: false; reason: 'in-use' }
  /** The OS refused the bind for another reason (EACCES on a privileged port…). */
  | { ok: false; reason: 'refused'; message: string };

/** Injected in the suites; `net.createServer` in production. */
export interface ProbeDeps {
  createServer?: (() => net.Server) | undefined;
}

/**
 * Can the server bind `host:port` right now?
 *
 * ─── Why this exists at all, i.e. why not just try the restart ───────────────
 *
 * §8.3 asks for "an inline error with a 'Try 4601' suggestion", and an inline
 * error has to happen while the user is still looking at the form. Discovering
 * the collision by restarting cannot do that, and the reason is mechanical
 * rather than aesthetic: a rebind changes the port, `main/index.ts`'s `subscribe`
 * listener navigates the window to the new origin on every `ready`, and a
 * navigated window is a renderer whose in-flight `setConfig` promise no longer
 * has anyone waiting on it. The failure path is worse still — the revert
 * restarts the child a SECOND time, so the error the user needed to read is
 * destroyed by the recovery from it. Probing first keeps the whole collision
 * case inside one IPC call with no restart, no navigation, and no config write.
 *
 * A TOCTOU window remains (something can take the port between this probe and
 * the child's listen), and it is handled where it lands rather than pretended
 * away: `main/index.ts` reverts the config and rebinds to loopback, so the app
 * stays usable. This probe is not a lock; it is what turns the overwhelmingly
 * common case — a port that is busy and stays busy — into a sentence the user
 * can act on.
 *
 * `exclusive: true` is load-bearing. Without it Node's cluster-aware default
 * allows a second bind to the same port in some configurations, so the probe
 * would report a free port that is not free — the exact false negative that
 * makes a pre-flight check worse than none.
 */
export async function probeBindable(
  host: string,
  port: number,
  deps: ProbeDeps = {},
): Promise<ProbeResult> {
  const create = deps.createServer ?? (() => net.createServer());
  return new Promise<ProbeResult>((resolve) => {
    const server = create();
    let settled = false;
    const finish = (result: ProbeResult): void => {
      if (settled) return;
      settled = true;
      // `close()` on a server that never listened is harmless and its callback
      // still fires; on one that did, this is what releases the port before the
      // child tries to take it — resolving first would race our own probe.
      server.close(() => {
        resolve(result);
      });
    };

    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        finish({ ok: false, reason: 'in-use' });
        return;
      }
      finish({ ok: false, reason: 'refused', message: error.message });
    });
    server.once('listening', () => {
      finish({ ok: true });
    });

    try {
      server.listen({ host, port, exclusive: true });
    } catch (error) {
      // A synchronous throw (an out-of-range port) never reaches the `error`
      // event, so it would hang this promise forever rather than fail it.
      finish({
        ok: false,
        reason: 'refused',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
