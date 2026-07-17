/**
 * Which of §8.1's four chips does this Adminium show right now?
 * (11-electron.md §8.1; the chip component itself is `@adminium/ui`'s
 * `RuntimeChip`.)
 *
 * Pure, and separate from the component, because the interesting part is a
 * PRECEDENCE decision, not a render: §8.1's table reads as four tidy rows, but
 * the real states overlap — an app can be sharing on the LAN *and* pointed at a
 * remote Postgres *and* have that Postgres down, all at once. One chip, so
 * somebody has to rank them. That ranking is a product judgement and is testable
 * only if it lives somewhere a test can call.
 */
import type { RuntimeChipState } from '@adminium/ui';

import type { Runtime } from '../app/capabilities.js';

/**
 * The health facts the chip needs from one connection — a deliberate subset of
 * `ConnectionDto` (`studio/api.ts`), so this module does not care about the
 * other twelve fields and neither do its tests.
 */
export interface ConnectionHealth {
  name: string;
  /** `postgres` | `mysql` | `sqlite` — sqlite is the local one. */
  engine: string;
  /** `dsn` (a live database) | `schema-file` (an import, no live DB at all). */
  sourceKind: string;
  /** `unconfigured` | `connected` | `error`, from the persisted test results. */
  status: string;
}

export interface RuntimeChipInput {
  runtime: Runtime;
  /**
   * The health poll's answer, or `null` when there ISN'T one — not yet loaded,
   * or refused.
   *
   * `null` and `[]` are different facts and collapsing them is a lie the chip
   * cannot afford. `[]` means "this app has no connections, everything is on
   * this machine" ⇒ `Local`. `null` means "we do not know", and the feed that
   * answers it (`GET /api/v1/connections`) is gated on the Admin-only
   * `system:connections:manage` — so for an Editor or Viewer on this desktop,
   * and for every LAN user §8.3 invites, the honest answer is `null` forever.
   * Treating that as `[]` would print a confident `Local` over a remote Postgres
   * that is currently down: the precise inversion of what §8.1's chip is for.
   */
  connections: readonly ConnectionHealth[] | null;
  /**
   * §8.3's "Share on local network" toggle.
   *
   * NOT WIRED YET, and there is nothing here that can wire it: §8.1 forbids the
   * preload bridge as a source ("no preload involvement"), and the two feeds it
   * does sanction cannot answer it today — `GET /api/v1/system/info` carries the
   * three §8.2 capability flags and no bind address, and a connection-health
   * poll knows nothing about how the server is listening. 11-T11 owns the LAN
   * share feature end-to-end and depends on this task; the honest server-side
   * signal for it is `env.HOST === '0.0.0.0'` under the desktop runtime (§2.4:
   * "The server binds 127.0.0.1 unless LAN share is on"), which that task can
   * add to this reply.
   *
   * It is a REQUIRED parameter rather than an optional-defaulting-false so the
   * gap is visible at the one call site instead of hiding behind a default.
   */
  lanShare: boolean;
}

/**
 * A source database that lives somewhere other than this machine.
 *
 * `sqlite` is local by construction (§2.1: local files under `<dataDir>`), and a
 * `schema-file` import has no live database at all — neither can be "offline",
 * so neither belongs in the remote-DB states. Anything else is a DSN to a
 * Postgres/MySQL server that may or may not be reachable.
 */
function isRemote(connection: ConnectionHealth): boolean {
  return connection.sourceKind === 'dsn' && connection.engine !== 'sqlite';
}

/** Remote connections whose last persisted test failed (`status: 'error'`). */
export function unreachableRemotes(
  connections: readonly ConnectionHealth[] | null,
): ConnectionHealth[] {
  return (connections ?? []).filter(
    (connection) => isRemote(connection) && connection.status === 'error',
  );
}

/**
 * §8.1's chip, or `null` when there is none to show.
 *
 * `null` on self-host and Cloud is the whole of the "desktop only" rule: the
 * chip answers "is your data on this machine?", and that is not a question a
 * self-hosted server's user is asking — they know where it runs.
 *
 * `null` ALSO when the health answer is unknown (`connections: null`). Every
 * state below is a claim about where the data is, and the chip has no way to
 * make one without the poll — so it says nothing rather than guessing `Local`.
 * NO CHIP IS A DEGRADATION; A WRONG CHIP IS A LIE, and this one would be told
 * exactly to the non-admin LAN users of §8.3, who cannot read `/connections`.
 * Giving them a real chip needs a health summary they are allowed to see; that
 * is 11-T11's to add alongside the LAN-share signal, and it is the same shape of
 * fix.
 *
 * ─── The precedence, and why ─────────────────────────────────────────────────
 *
 *  1. `remote-db-offline` — the only state that reports a PROBLEM. It wins
 *     because it is the only one that changes what the user should do next, and
 *     because §8.1 pairs it with the data pages for that connection showing the
 *     DB-unreachable state: a topbar that said "Sharing on LAN" while every page
 *     underneath said "Database unreachable" would be answering a question
 *     nobody asked.
 *  2. `lan-share` — beats `remote-db` because it is the only CLICKABLE state
 *     (→ the §8.3 panel) and the only one with a security consequence: other
 *     people can reach this app right now. "Some of my data is remote" is a fact
 *     the user configured once; "my app is on the network" is a fact worth
 *     keeping in front of them.
 *  3. `remote-db` — at least one reachable remote source.
 *  4. `local` — everything on this machine, nothing shared. The default.
 */
export function runtimeChipState(input: RuntimeChipInput): RuntimeChipState | null {
  if (input.runtime !== 'desktop') return null;
  const { connections } = input;
  if (connections === null) return null;
  if (unreachableRemotes(connections).length > 0) return 'remote-db-offline';
  if (input.lanShare) return 'lan-share';
  if (connections.some(isRemote)) return 'remote-db';
  return 'local';
}
