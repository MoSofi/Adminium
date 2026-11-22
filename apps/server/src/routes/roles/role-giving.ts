// SPDX-License-Identifier: AGPL-3.0-only
/**
 * NOBODY HANDS OUT POWER THEY DO NOT HOLD.
 *
 * Whoever is not a signed-in Super Admin may set only permissions they fully
 * hold (`rbac/role-within.ts`), may not change or delete a role that holds
 * more than they do, and may not give or take such a role from anybody,
 * themselves included. Super Admin itself is given, taken and copied by a
 * signed-in Super Admin alone.
 *
 * A key answers for two: its own role and the person who made it, as they
 * stand now. A key with nobody behind it, or whose maker has stopped, gives
 * nothing. What is already stored is not touched: this judges changes.
 */
import type { FastifyRequest } from 'fastify';
import { permissionsRepo, rolesRepo, usersRepo, type Role, type RolePermission } from '@adminium/meta';

import type { EffectiveModel } from '../../connections/effective-schema.js';
import { ForbiddenError } from '../../errors.js';
import { scrubUrlForLog } from '../../log-scrub.js';
import type { RbacDecoration } from '../../plugins/rbac.js';
import { matrixRowsFromGrants } from '../../rbac/permissions.js';
import { getPrincipal } from '../../rbac/principal.js';
import { personWithinReach } from '../../rbac/reach-held.js';
import { SUPER_ADMIN_SLUG, resolvePermissionSet, type PermissionSet } from '../../rbac/resolver.js';
import { holdsEdit, holdsRole, holdsRows, type GrantRow } from '../../rbac/role-within.js';

/** The refusal's `details.reason`: what the screens say in the reader's language. */
export const ROLE_ABOVE_YOU = 'role-above-you';
export const ACCOUNT_ABOVE_YOU = 'account-above-you';

interface RoleGiver {
  /** A signed-in Super Admin: holds everything, and alone gives Super Admin. */
  superAdmin: boolean;
  /** Every permission set the giver is held to: theirs and, for a key, its maker's. */
  sets: readonly PermissionSet[];
  /** Why this key gives nothing at all. */
  blocked: 'no-maker' | 'maker-stopped' | null;
}

const MESSAGES = {
  above: 'You can hand out only permissions you hold yourself, and cannot change a role that holds more than you do.',
  'super-admin': 'Only a signed-in Super Admin can give, change or copy the Super Admin role.',
  'no-maker': 'This key has no person behind it, so it cannot hand out a role.',
  'maker-stopped': 'This account is no longer active.',
} as const;

export function roleGiving(app: { rbac: RbacDecoration }) {
  const { meta } = app.rbac;
  const permissions = permissionsRepo(meta);
  const givers = new WeakMap<FastifyRequest, Promise<RoleGiver>>();

  async function readGiver(request: FastifyRequest): Promise<RoleGiver> {
    const own = await app.rbac.resolve(request);
    const principal = getPrincipal(request);
    if (principal === null || principal.kind === 'user') return { superAdmin: own.superAdmin, sets: [own], blocked: null };
    if (principal.madeBy === null) return { superAdmin: false, sets: [own], blocked: 'no-maker' };
    const maker = await usersRepo(meta).findById(principal.madeBy);
    if (maker === null) return { superAdmin: false, sets: [own], blocked: 'no-maker' };
    if (maker.status !== 'active') return { superAdmin: false, sets: [own], blocked: 'maker-stopped' };
    return { superAdmin: false, sets: [own, await resolvePermissionSet(meta, { kind: 'user', id: maker.id, label: maker.name })], blocked: null };
  }

  function giverOf(request: FastifyRequest): Promise<RoleGiver> {
    let giver = givers.get(request);
    if (giver === undefined) {
      giver = readGiver(request);
      givers.set(request, giver);
    }
    return giver;
  }

  /** On the audit log as a denied attempt. Names the role, and no grant of it. */
  async function refusal(request: FastifyRequest, roleId: string, why: keyof typeof MESSAGES): Promise<ForbiddenError> {
    await app.rbac.audit(request, {
      category: 'rbac',
      action: 'permission.denied',
      changes: { after: { reason: ROLE_ABOVE_YOU, method: request.method, url: scrubUrlForLog(request.url), roleId } },
    });
    return new ForbiddenError(MESSAGES[why], 'FORBIDDEN', { reason: ROLE_ABOVE_YOU, roleId });
  }

  /** Somebody held to an app's screens does not hand out a role that opens the rest of the dashboard: one ordinary role lifts that. */
  const staysOnScreens = (set: PermissionSet, role: Pick<Role, 'screensOnly'>): boolean => set.screensOnly === null || role.screensOnly;

  const holdsAll = (giver: RoleGiver, role: Role, rows: readonly GrantRow[]): boolean =>
    giver.superAdmin || (giver.blocked === null && role.slug !== SUPER_ADMIN_SLUG && giver.sets.every((set) => staysOnScreens(set, role) && holdsRole(set, role.id, rows)));

  /** May this caller give, take, change or delete this role as it is stored? */
  async function assertMayHandle(request: FastifyRequest, role: Role): Promise<void> {
    const giver = await giverOf(request);
    if (giver.superAdmin) return;
    if (giver.blocked !== null) throw await refusal(request, role.id, giver.blocked);
    if (role.slug === SUPER_ADMIN_SLUG) throw await refusal(request, role.id, 'super-admin');
    if (!holdsAll(giver, role, await permissions.listForRole(role.id))) throw await refusal(request, role.id, 'above');
  }

  /**
   * A copy is a new, live role. Holding the source counts for an ordinary role;
   * an app's role may be suspended with its app, and a copy would bring what it
   * holds to life, so that one is judged on what the caller holds right now.
   */
  async function assertMayClone(request: FastifyRequest, source: Role, rows: readonly RolePermission[]): Promise<void> {
    const giver = await giverOf(request);
    if (giver.superAdmin) return;
    if (giver.blocked !== null) throw await refusal(request, source.id, giver.blocked);
    if (source.slug === SUPER_ADMIN_SLUG) throw await refusal(request, source.id, 'super-admin');
    // A copy is an ordinary role whatever its source was, so nobody held to an app's screens makes one.
    const held = (set: PermissionSet): boolean => set.screensOnly === null && ((source.appKey === null && set.roleIds.includes(source.id)) || holdsRows(set, rows));
    if (!giver.sets.every(held)) throw await refusal(request, source.id, 'above');
  }

  /** What a save of a role's matrix adds or un-limits must be held (`holdsEdit`). */
  async function assertMayWrite(request: FastifyRequest, role: Role, next: readonly GrantRow[], stored: readonly GrantRow[]): Promise<void> {
    const giver = await giverOf(request);
    if (giver.superAdmin) return;
    if (!giver.sets.every((set) => holdsEdit(set, next, stored))) throw await refusal(request, role.id, 'above');
  }

  /** Which of these roles the caller may change: what the screens offer. The server still decides each save. */
  async function changeable(request: FastifyRequest, roles: readonly Role[]): Promise<ReadonlySet<string>> {
    const giver = await giverOf(request);
    const out = new Set<string>();
    for (const role of roles) {
      if (giver.superAdmin || (giver.blocked === null && role.slug !== SUPER_ADMIN_SLUG && holdsAll(giver, role, await permissions.listForRole(role.id)))) out.add(role.id);
    }
    return out;
  }

  /** The grants this caller could give: everything, or those they hold with nothing narrowing them. */
  async function grantable(request: FastifyRequest): Promise<{ all: boolean; grants: string[] }> {
    const giver = await giverOf(request);
    if (giver.superAdmin) return { all: true, grants: [] };
    if (giver.blocked !== null) return { all: false, grants: [] };
    if (giver.sets.every((set) => set.superAdmin)) return { all: true, grants: [] };
    const candidates = new Set(giver.sets.flatMap((set) => [...set.grants]));
    const grants = [...candidates].filter((grant) => {
      const { rows, invalid } = matrixRowsFromGrants([grant]);
      return invalid.length === 0 && rows.length === 1 && giver.sets.every((set) => holdsRows(set, rows));
    });
    return { all: false, grants: grants.sort() };
  }

  /** All of this person's roles are the caller's to hold, and their rows within the caller's reach (a key: its own and its maker's). */
  async function holdsPerson(giver: RoleGiver, userId: string, held: readonly Role[], models: Map<string, EffectiveModel | null>): Promise<boolean> {
    if (giver.superAdmin) return true;
    for (const role of held) {
      if (!holdsAll(giver, role, await permissions.listForRole(role.id))) return false;
    }
    for (const set of giver.sets) {
      if (!(await personWithinReach(meta, set, userId, models))) return false;
    }
    return true;
  }

  /**
   * Account changes are held to what the caller holds: somebody may change the
   * sign-in details only of a person whose roles and rows are within their own.
   */
  async function assertHoldsAccount(request: FastifyRequest, userId: string, held: readonly Role[]): Promise<void> {
    const giver = await giverOf(request);
    if (await holdsPerson(giver, userId, held, new Map())) return;
    await app.rbac.audit(request, {
      category: 'rbac',
      action: 'permission.denied',
      changes: { after: { reason: ACCOUNT_ABOVE_YOU, method: request.method, url: scrubUrlForLog(request.url), userId } },
    });
    throw new ForbiddenError('This person holds permissions or rows you do not reach, so you cannot change their sign-in details.', 'FORBIDDEN', { reason: ACCOUNT_ABOVE_YOU, userId });
  }

  /** Whose sign-in details this caller may not change, of these people: what the People page offers. */
  async function accountsAbove(request: FastifyRequest, byUser: ReadonlyMap<string, readonly { id: string }[]>): Promise<ReadonlySet<string>> {
    const giver = await giverOf(request);
    if (giver.superAdmin) return new Set();
    const asked = new Set([...byUser.values()].flatMap((list) => list.map((role) => role.id)));
    const roles = (await rolesRepo(meta).list()).filter((role) => asked.has(role.id));
    const may = await changeable(request, roles);
    const models = new Map<string, EffectiveModel | null>();
    const locked = new Set<string>();
    for (const [userId, list] of byUser) {
      if (list.some((role) => !may.has(role.id))) locked.add(userId);
      else if (!(await holdsPerson(giver, userId, [], models))) locked.add(userId);
    }
    return locked;
  }

  return { assertMayHandle, assertMayClone, assertMayWrite, assertHoldsAccount, accountsAbove, changeable, grantable };
}
