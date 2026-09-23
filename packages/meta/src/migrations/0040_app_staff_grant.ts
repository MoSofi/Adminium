// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0040 — opening an app's staff screens becomes a grant of its own.
 *
 * Until now anyone signed in could open every installed app's staff screens;
 * from this wave they need `app:<key>:staff`. So that nothing changes for the
 * people who could, every role that exists when this runs — except an app's
 * own roles, which say for themselves what they may open, and Super Admin,
 * which needs no grant — is given the every-app row (`app:*:staff`) once.
 *
 * A role made later starts without it, like every other grant; the built-in
 * roles are given it by their seed, which also covers a fresh install, where
 * this wave runs before any role exists.
 */
import type { Kysely } from 'kysely';

import { newId } from '../ids.js';
import { metaTable } from '../prefix.js';

interface RoleRow {
  id: string;
  slug: string;
  appKey: string | null;
}

type GrantDb = Kysely<{
  [key: string]: {
    id: string;
    slug: string;
    appKey: string | null;
    roleId: string;
    resourceKind: string;
    resourceRef: string;
    actions: string;
  };
}>;

// No column-helpers parameter: this wave moves data, not shape.
export async function up(db: Kysely<unknown>): Promise<void> {
  const grants = db as unknown as GrantDb;
  const roles = (await grants
    .selectFrom(metaTable('roles'))
    .select(['id', 'slug', 'appKey'])
    .execute()) as RoleRow[];
  for (const role of roles) {
    if (role.appKey !== null || role.slug === 'super-admin') continue;
    const existing = await grants
      .selectFrom(metaTable('role_permissions'))
      .select('id')
      .where('roleId', '=', role.id)
      .where('resourceKind', '=', 'app')
      .where('resourceRef', '=', '*')
      .executeTakeFirst();
    if (existing !== undefined) continue;
    await grants
      .insertInto(metaTable('role_permissions'))
      .values({
        id: newId('perm'),
        roleId: role.id,
        resourceKind: 'app',
        resourceRef: '*',
        actions: JSON.stringify({ staff: true }),
      } as never)
      .execute();
  }
}
