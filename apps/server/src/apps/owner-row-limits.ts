// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH ROWS A ROLE REACHES, WHEN ITS APP AND ITS OWNER BOTH HAVE A SAY.
 *
 * Which rows a role reaches is the one limit an owner can set by hand (the
 * Rows dialog). What the owner set is kept beside the limit in force
 * (`TableActions.ownerRows`), so nothing has to guess whose a limit is:
 *
 *  - an app's install or update writes what its version declares, and the
 *    owner's stands over it, action by action;
 *  - it outlasts the grant it narrows: when an add-on is away or a version
 *    drops the action, it waits on the row, and holds again when it returns.
 *
 * On a table an add-on shares among apps, a role reaches only its own app's
 * rows whatever else it is given. An owner's reach is held to them too; one
 * already held to another condition cannot be, and that action is not given.
 */
import { rowReachList, type RowLimit, type RowReach } from '@adminium/meta';

import { canonical } from '../rbac/role-within.js';

const ACTIONS = ['read', 'update', 'delete'] as const;
type Action = (typeof ACTIONS)[number];
type Written = RowLimit[Action];

/** One reach and a list of that one reach are the same limit. */
export const sameReach = (a: Written, b: Written): boolean => canonical(rowReachList(a)) === canonical(rowReachList(b));

/** The limit in force: what the version declares, with the owner's over it. Names any action that cannot be given. */
export function rowLimitWith(
  ownerRows: RowLimit | undefined,
  declared: RowLimit | undefined,
  ownApp: { column: string; in: string[] } | null = null,
): { rows: RowLimit | undefined; blocked: Action[] } {
  const rows: RowLimit = { ...(declared ?? {}) };
  const blocked: Action[] = [];
  for (const action of ACTIONS) {
    const written = ownerRows?.[action];
    if (written === undefined) continue;
    if (ownApp === null) {
      rows[action] = written;
      continue;
    }
    const reaches = rowReachList(written);
    if (reaches.some((reach) => reach.while !== undefined && canonical(reach.while) !== canonical(ownApp))) {
      blocked.push(action);
      delete rows[action];
      continue;
    }
    const held = reaches.map((reach) => ({ ...reach, while: ownApp }));
    rows[action] = held.length === 1 ? held[0]! : held;
  }
  return { rows: Object.keys(rows).length === 0 ? undefined : rows, blocked };
}

/** What is the owner's after they save a table's limit: what they changed, and what was theirs already. */
export function ownerRowsAfterEdit(stored: RowLimit | undefined, owner: RowLimit | undefined, written: RowLimit): RowLimit | undefined {
  const out: RowLimit = {};
  for (const action of ACTIONS) {
    const now = written[action];
    if (now === undefined) continue;
    if (owner?.[action] !== undefined || !sameReach(now, stored?.[action])) out[action] = now;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * Of a limit stored before owners' limits were recorded, what the running
 * version does not declare: the owner's. A shared table's own-app condition
 * is the engine's, and is left out of the comparison.
 */
export function ownerRowsIn(stored: RowLimit | undefined, declared: RowLimit | undefined, appKey: string): RowLimit | undefined {
  const own = canonical([appKey]);
  const plain = (written: Written): string =>
    canonical(
      rowReachList(written)
        .map((reach): Partial<RowReach> => {
          if (reach.while === undefined || canonical(reach.while.in) !== own) return reach;
          const { while: _while, ...rest } = reach;
          return rest;
        })
        .filter((reach) => !(reach.reach === 'all' && Object.keys(reach).length === 1)),
    );
  const out: RowLimit = {};
  for (const action of ACTIONS) {
    const held = stored?.[action];
    if (held !== undefined && plain(held) !== plain(declared?.[action])) out[action] = held;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}
