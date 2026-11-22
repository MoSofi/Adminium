// SPDX-License-Identifier: AGPL-3.0-only
/**
 * NOBODY WIDENS THE ROWS THEY REACH BY MOVING PEOPLE OR ROWS.
 *
 * Who owns a row and who leads whom decide which rows a limited role reaches.
 * So somebody held to their own rows, or their team's, may still manage teams
 * and hand a leaver's rows on, but not in a way that brings more rows within
 * their own reach. A key has no rows of its own: it answers for the person who
 * made it. Somebody nothing limits, and a Super Admin, are not held by this.
 */
import { teamsRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { rowTestTables } from '../crud/row-limit.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import type { RbacPrincipal } from './principal.js';
import { resolvePermissionSet, type PermissionSet } from './resolver.js';
import { ROW_ACTIONS, asksForTeam, rowReachesOf } from './row-limits.js';

/** The refusal's `details.reason`: what the screens say in the reader's language. */
export const REACH_ABOVE_YOU = 'reach-above-you';
export const REACH_MESSAGE = 'This would bring rows within your own reach that your role does not give you.';

export interface ReachSubject {
  userId: string;
  set: PermissionSet;
}

/** Whose reach this request could widen; null when nothing limits it. */
export async function reachSubjectOf(meta: MetaDb, principal: RbacPrincipal | null): Promise<ReachSubject | null> {
  if (principal === null) return null;
  const userId = principal.kind === 'user' ? principal.id : principal.madeBy;
  if (userId === null) return null;
  const person = await usersRepo(meta).findById(userId);
  if (person === null) return null;
  const set = await resolvePermissionSet(meta, { kind: 'user', id: person.id, label: person.name });
  return set.superAdmin || set.rowLimits === undefined ? null : { userId: person.id, set };
}

/** Would this seat on a team bring anybody into the reach of somebody limited to their team's rows? */
export async function seatWidensReach(meta: MetaDb, subject: ReachSubject, teamId: string, userId: string, lead: boolean): Promise<boolean> {
  if (!asksForTeam(subject.set.rowLimits)) return false;
  const teams = teamsRepo(meta);
  const members = await teams.members(teamId);
  const leads = members.some((member) => member.userId === subject.userId && member.lead);
  const gained =
    userId === subject.userId
      ? lead && !leads ? members.map((member) => member.userId).filter((id) => id !== subject.userId) : []
      : leads && !members.some((member) => member.userId === userId) ? [userId] : [];
  if (gained.length === 0) return false;
  const already = new Set((await teams.leadReach(subject.userId)).ids);
  return gained.some((id) => !already.has(id));
}

/**
 * Would handing these tables' rows from one person to another bring rows into
 * the subject's reach? Asked of the tables moved and of every table whose own
 * test reads them: a row can be somebody's through its parent or a listing.
 */
export async function handOverWidensReach(
  meta: MetaDb,
  subject: ReachSubject,
  tables: readonly { connectionId: string; tableId: string }[],
  fromId: string,
  toId: string,
): Promise<boolean> {
  const led = new Set((await teamsRepo(meta).leadReach(subject.userId)).ids);
  const toSelf = toId === subject.userId;
  if (!toSelf && !led.has(toId)) return false;
  const asked = new Map(tables.map((table) => [`${table.connectionId}\u0000${table.tableId}`, table]));
  for (const connectionId of new Set(tables.map((table) => table.connectionId))) {
    const moved = new Set(tables.filter((table) => table.connectionId === connectionId).map((table) => table.tableId));
    const { model } = await loadSnapshotView(meta, connectionId);
    for (const table of model.tables) {
      if (rowTestTables(model, table.id).some((id) => moved.has(id))) asked.set(`${connectionId}\u0000${table.id}`, { connectionId, tableId: table.id });
    }
  }
  return [...asked.values()].some((table) =>
    ROW_ACTIONS.some((action) => {
      const reaches = rowReachesOf(subject.set, table.connectionId, table.tableId, action);
      if (reaches === null) return false;
      // Their team's already covers somebody they lead: those rows were theirs to reach.
      if (led.has(fromId) && reaches.some((reach) => reach.reach === 'team' && reach.while === undefined && reach.by === undefined && reach.via === undefined)) return false;
      return reaches.some((reach) => (reach.reach === 'own' ? toSelf : reach.reach === 'team' && !led.has(fromId)));
    }),
  );
}
