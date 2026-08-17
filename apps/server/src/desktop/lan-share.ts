// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LAN share, as the SERVER can see it (11-electron.md §8.3, §8.1).
 *
 * The desktop shell owns the DECISION — `config.json`'s `lanShare` is main's
 * file (§2.3), and main is what re-forks this process with `ADMINIUM_HOST=0.0.0.0`
 * — so nothing here toggles anything. What lives here are the two questions only
 * a process holding the meta store and its own listening socket can answer:
 *
 *  1. {@link lanShareActive} — am I bound wide, or to loopback? §8.1's runtime
 *     chip needs this, and §8.1 forbids it the obvious source: "The chip is a
 *     `@adminium/ui` component fed by `GET /api/v1/system/info` + a lightweight
 *     connection-health poll — **no preload involvement**." So the answer has to
 *     come off this process's own boot environment.
 *  2. {@link readLanShareStatus} — who is actually connected, and is there
 *     anyone but the super admin to connect? Both are meta-store reads, and §1
 *     principle 2 makes this process the only thing allowed to make them.
 *
 * ─── Why the bind address is the honest signal ───────────────────────────────
 *
 * `config.lanShare.enabled` is a statement of INTENT that the user can change at
 * any moment; the bind address is the state of the world. They disagree for a
 * whole server lifetime whenever the rebind fails or has not happened yet —
 * exactly the window in which a chip saying "Sharing on LAN" over a
 * loopback-only server, or the reverse, is a lie with a security consequence.
 * §2.4 states the invariant in the same terms ("The server binds 127.0.0.1
 * unless LAN share is on"), so reporting the bind is reporting the promise.
 */

import type { MetaDb } from '@adminium/meta';

import { isLoopbackAddress } from '../auth/desktop-session.js';
import { SESSION_IDLE_TTL_MS } from '../auth/sessions.js';
import type { Env } from '../config/env.js';

/**
 * Bind addresses that mean "every interface", i.e. reachable from the LAN.
 *
 * `0.0.0.0` is what §2.2 step 5's env block names and what the shell sends.
 * `::` (and its bracketed spelling) is the IPv6 wildcard, which reaches the
 * same conclusion by the same mechanism — and which a fleet admin or a
 * hand-edited launch could produce. Anything else — a loopback literal, a
 * single NIC's address, a hostname — is not a wildcard. Note that a specific
 * LAN address like `192.168.1.5` is deliberately NOT here: it is reachable, but
 * the desktop shell never produces it (§8.3 flips between loopback and
 * `0.0.0.0` and nothing else), and treating an arbitrary literal as "sharing"
 * would require this module to enumerate interfaces — which is main's job (`os`
 * lives there, and this process may be in a container).
 */
const WILDCARD_BIND_HOSTS: ReadonlySet<string> = new Set(['0.0.0.0', '::', '[::]', '*']);

/** Is `host` a bind-every-interface address? */
export function isWildcardBindHost(host: string): boolean {
  return WILDCARD_BIND_HOSTS.has(host.trim());
}

/**
 * §8.3's toggle, as observed rather than as configured: is THIS process reachable
 * from the LAN because the desktop shell asked it to be?
 *
 * The `desktop` runtime clause is not decoration. Self-host, Docker and `npx
 * adminium` all default `HOST` to `0.0.0.0` — that is the normal, correct bind
 * for a server behind a reverse proxy, and it is not "LAN share". §8.3 is a
 * DESKTOP feature: an app that is normally a single-user local tool and has been
 * deliberately opened up. Reporting `true` for every Docker deployment would
 * make §8.1's chip meaningless on the one runtime that renders it and wrong on
 * every other.
 */
export function lanShareActive(env: Pick<Env, 'ADMINIUM_RUNTIME' | 'HOST'>): boolean {
  return env.ADMINIUM_RUNTIME === 'desktop' && isWildcardBindHost(env.HOST);
}

/** What §8.3's share panel shows, minus the URLs (which only main can enumerate). */
export interface LanShareStatus {
  /** {@link lanShareActive} — the bind, not the config. */
  active: boolean;
  /** Sessions currently held by a peer that is NOT this machine. */
  lanSessions: number;
  /**
   * Active users who are not super admins — §8.3's precondition ("at least one
   * non-super-admin user exists *or* the admin acknowledges they'll invite users
   * next").
   */
  otherUsers: number;
}

/**
 * §8.3's "connected-session count (from `adminium_sessions` with non-loopback
 * IPs)".
 *
 * ─── "Active" has to mean the same thing here as at the front door ───────────
 *
 * Three conditions, and they are `resolveSessionByToken`'s three, deliberately:
 * un-revoked, before `expires_at`, and inside the 7-day idle window. A count
 * that used fewer would report sessions that the very next request would refuse
 * as expired — a panel telling an admin "3 devices connected" when two of them
 * were signed out last week is worse than no panel, because the number is the
 * only reason the panel exists.
 *
 * ─── Non-loopback, and what a NULL ip means ──────────────────────────────────
 *
 * `adminium_sessions.ip` is nullable, and `null` is not "loopback": it is "we
 * were not told". It cannot be counted as a LAN peer (that would inflate the
 * number on any install whose sessions predate an ip being recorded), and it is
 * not counted here. In practice the desktop path always records one —
 * `routes/auth/handlers.ts`'s `requestMeta` passes `request.ip` on every login —
 * so this is a defensive read, not a common case.
 *
 * `isLoopbackAddress` rather than a `!== '127.0.0.1'` comparison: loopback is a
 * whole /8 plus `::1` plus the IPv4-mapped spellings a dual-stack listener hands
 * out, and `::ffff:127.0.0.1` is this machine however much it looks like it is
 * not.
 */
export async function readLanShareStatus(
  env: Pick<Env, 'ADMINIUM_RUNTIME' | 'HOST'>,
  meta: MetaDb,
  at: number = Date.now(),
): Promise<LanShareStatus> {
  const [lanSessions, otherUsers] = await Promise.all([
    countLanSessions(meta, at),
    countNonSuperAdminUsers(meta),
  ]);
  return { active: lanShareActive(env), lanSessions, otherUsers };
}

async function countLanSessions(meta: MetaDb, at: number): Promise<number> {
  const rows = await meta.db
    .selectFrom('adminium_sessions')
    .select(['ip'])
    .where('revokedAt', 'is', null)
    .where('expiresAt', '>', at)
    .where('lastSeenAt', '>', at - SESSION_IDLE_TTL_MS)
    .execute();
  // The loopback test is applied in TypeScript rather than SQL on purpose: the
  // rule is "is this address one of the several shapes that mean this machine",
  // which is `isLoopbackAddress`'s job and not something three dialects of
  // `LIKE` should be asked to re-implement between them. The row set is bounded
  // by the number of live sessions on a desktop install.
  return rows.filter((row) => row.ip !== null && !isLoopbackAddress(row.ip)).length;
}

/**
 * §8.3's precondition input: is there anybody to invite, or has the admin only
 * got themselves?
 *
 * "Non-super-admin" is asked of the ROLE ASSIGNMENT rather than of the user row,
 * because super-admin is not a column — it is a row in `adminium_user_roles`
 * pointing at the `super-admin` role (`@adminium/meta`'s `bootstrap.ts` seeds
 * it, and the RBAC resolver short-circuits on that slug). A second super admin
 * therefore does NOT count: §8.3's precondition exists so the admin does not
 * open their machine to a network on which nobody but them has an account, and
 * another copy of themselves does not change that.
 *
 * Suspended and invited users do not count either — `status: 'active'` is the
 * set that can actually log in.
 */
async function countNonSuperAdminUsers(meta: MetaDb): Promise<number> {
  const superAdmins = meta.db
    .selectFrom('adminium_user_roles')
    .innerJoin('adminium_roles', 'adminium_roles.id', 'adminium_user_roles.roleId')
    .select('adminium_user_roles.userId')
    .where('adminium_roles.slug', '=', SUPER_ADMIN_ROLE_SLUG);

  const rows = await meta.db
    .selectFrom('adminium_users')
    .select('id')
    .where('status', '=', 'active')
    .where('id', 'not in', superAdmins)
    .execute();
  return rows.length;
}

/**
 * The built-in role `@adminium/meta`'s `bootstrap.ts` seeds and the RBAC
 * resolver short-circuits on. Restated here rather than imported because meta
 * exports the seed shape and not the slug; `desktop-lan-route.test.ts` pins the
 * two together, since a typo would silently make every super admin count as an
 * "other user" and wave the §8.3 precondition through.
 */
export const SUPER_ADMIN_ROLE_SLUG = 'super-admin';
