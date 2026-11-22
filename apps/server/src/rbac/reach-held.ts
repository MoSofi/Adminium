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

import type { EffectiveModel } from '../connections/effective-schema.js';
import { rowTestTables } from '../crud/row-limit.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import type { RbacPrincipal } from './principal.js';
import { permissionSetAllows, resolvePermissionSet, type PermissionSet } from './resolver.js';
import { canonical } from './role-within.js';
import { ROW_ACTIONS, asksForTeam, rowReachesOf, type RowReach } from './row-limits.js';

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

/** Does one reach of the caller's take in every row one reach of the other person's does? When in doubt, no. */
function reachCovers(
  mine: RowReach,
  theirs: RowReach,
  me: { ids: ReadonlySet<string>; capped: boolean },
  them: { id: string; led: readonly string[]; capped: boolean },
): boolean {
  // What narrows mine must narrow theirs the same way. A "never the person named" is about me, and says nothing of them.
  if (mine.notBy !== undefined) return false;
  if (mine.while !== undefined && canonical(mine.while) !== canonical(theirs.while)) return false;
  if (mine.notThrough !== undefined && canonical(mine.notThrough) !== canonical(theirs.notThrough)) return false;
  // A reach through a parent is judged by that parent's person alone: only the same way there says the same rows.
  if (theirs.via !== undefined || mine.via !== undefined) {
    if (mine.via !== theirs.via || mine.by !== theirs.by) return false;
  } else if (mine.by !== undefined && mine.by !== theirs.by) return false;
  if (theirs.unowned === true && mine.unowned !== true && mine.reach !== 'all') return false;
  if (mine.reach === 'all') return true;
  if (mine.reach !== 'team' || me.capped || !me.ids.has(them.id)) return false;
  if (theirs.reach === 'own') return true;
  return theirs.reach === 'team' && !them.capped && them.led.every((id) => me.ids.has(id));
}

/**
 * Does somebody limited to some rows already reach everything this person's
 * roles let them reach? Asked of every table the person holds an action on,
 * by the same ways a row is judged: its own people, a parent, a listing.
 * Somebody nothing limits is not asked. What cannot be read counts as no.
 */
export async function personWithinReach(
  meta: MetaDb,
  held: PermissionSet,
  personId: string,
  models: Map<string, EffectiveModel | null> = new Map(),
): Promise<boolean> {
  if (held.superAdmin || held.rowLimits === undefined || held.reach?.userId === personId) return true;
  const person = await usersRepo(meta).findById(personId);
  if (person === null) return false;
  const theirs = await resolvePermissionSet(meta, { kind: 'user', id: person.id, label: person.name });
  if (theirs.superAdmin) return false;
  if (![...theirs.grants].some((grant) => grant.startsWith('table:'))) return true;
  const ownId = held.reach?.userId ?? null;
  const me = { ids: new Set([...(ownId === null ? [] : [ownId]), ...(ownId === null ? [] : (held.reach?.ledIds ?? []))]), capped: held.reach?.capped === true };
  const them = { id: person.id, led: theirs.reach?.ledIds ?? [], capped: theirs.reach?.capped === true };
  const connections = await meta.db.selectFrom('adminium_connections').select('id').execute();
  for (const { id: connectionId } of connections) {
    if (!models.has(connectionId)) models.set(connectionId, await loadSnapshotView(meta, connectionId).then((view) => view.model, () => null));
    const model = models.get(connectionId) ?? null;
    if (model === null) {
      const couldHold = [...theirs.grants].some((grant) => grant.startsWith(`table:${connectionId}:`) || grant.startsWith('table:*:'));
      if (couldHold) return false;
      continue;
    }
    for (const table of model.tables) {
      for (const action of ROW_ACTIONS) {
        if (!permissionSetAllows(theirs, `table:${connectionId}:${table.id}:${action}`)) continue;
        // A private table's rows are its own people's alone, whoever leads them.
        if (table.private === true) return false;
        const mine = rowReachesOf(held, connectionId, table.id, action);
        if (mine === null) continue;
        const asked = rowReachesOf(theirs, connectionId, table.id, action);
        if (asked === null) return false;
        if (!asked.every((reach) => mine.some((own) => reachCovers(own, reach, me, them)))) return false;
      }
    }
  }
  return true;
}
