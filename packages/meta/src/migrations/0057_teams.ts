// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0057 — teams.
 *
 * ─── `adminium_teams`, `adminium_team_members` ─────────────────────────────
 * A role's read of a table can be limited to the rows a person owns, or to
 * those of "their team". A team is a named set of people, and some of its
 * members LEAD it: a lead reaches the rows of everyone in the teams they
 * lead, and an ordinary member reaches no more than their own. A person may
 * be in several teams, and leading one says nothing of another.
 *
 * Both tables are empty after this wave: nothing is in a team until somebody
 * who manages people makes one.
 *
 * A member row goes with its team and with its person (both cascade): a
 * person who is removed leaves every team, and a suspended one stays in
 * theirs.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('teams'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('name', c.str(80), (col) => col.notNull())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addUniqueConstraint('uq_adminium_teams_name', ['name'])
    .execute();

  await db.schema
    .createTable(metaTable('team_members'))
    .ifNotExists()
    .addColumn('team_id', c.id, (col) => col.notNull())
    .addColumn('user_id', c.id, (col) => col.notNull())
    .addColumn('lead', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_adminium_team_members', ['team_id', 'user_id'])
    .addForeignKeyConstraint('fk_adminium_team_members_team_id', ['team_id'], metaTable('teams'), ['id'], (cb) => cb.onDelete('cascade'))
    .addForeignKeyConstraint('fk_adminium_team_members_user_id', ['user_id'], metaTable('users'), ['id'], (cb) => cb.onDelete('cascade'))
    .execute();
  // "Which teams is this person in" — asked with every permission set that carries a row limit.
  await db.schema.createIndex('idx_adminium_team_members_user_id').on(metaTable('team_members')).columns(['user_id']).execute();
}
