/**
 * Wave 0002 — RBAC: adminium_roles, adminium_role_permissions,
 * adminium_user_roles, adminium_api_keys (07-meta-store.md §3.7–§3.10).
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('roles'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('slug', c.str(40), (col) => col.notNull())
    .addColumn('name', c.str(80), (col) => col.notNull())
    .addColumn('description', c.text)
    .addColumn('is_builtin', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex('uq_adminium_roles_slug')
    .ifNotExists()
    .on(metaTable('roles'))
    .columns(['slug'])
    .unique()
    .execute();

  await db.schema
    .createTable(metaTable('role_permissions'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('role_id', c.id, (col) =>
      col.notNull().references(`${metaTable('roles')}.id`).onDelete('cascade'),
    )
    .addColumn('resource_kind', c.str(10), (col) => col.notNull())
    .addColumn('resource_ref', c.str(255), (col) => col.notNull())
    .addColumn('actions', c.json, (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex('uq_adminium_role_permissions_role_kind_ref')
    .ifNotExists()
    .on(metaTable('role_permissions'))
    .columns(['role_id', 'resource_kind', 'resource_ref'])
    .unique()
    .execute();

  await db.schema
    .createTable(metaTable('user_roles'))
    .ifNotExists()
    .addColumn('user_id', c.id, (col) =>
      col.notNull().references(`${metaTable('users')}.id`).onDelete('cascade'),
    )
    .addColumn('role_id', c.id, (col) =>
      col.notNull().references(`${metaTable('roles')}.id`).onDelete('cascade'),
    )
    .addColumn('granted_by', c.id, (col) =>
      col.references(`${metaTable('users')}.id`).onDelete('set null'),
    )
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_adminium_user_roles', ['user_id', 'role_id'])
    .execute();

  await db.schema
    .createTable(metaTable('api_keys'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('name', c.str(80), (col) => col.notNull())
    .addColumn('prefix', c.str(16), (col) => col.notNull())
    .addColumn('token_hash', c.str(64), (col) => col.notNull())
    .addColumn('role_id', c.id, (col) =>
      col.notNull().references(`${metaTable('roles')}.id`).onDelete('cascade'),
    )
    .addColumn('created_by', c.id, (col) =>
      col.references(`${metaTable('users')}.id`).onDelete('set null'),
    )
    .addColumn('last_used_at', c.ts)
    .addColumn('expires_at', c.ts)
    .addColumn('revoked_at', c.ts)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex('uq_adminium_api_keys_token_hash')
    .ifNotExists()
    .on(metaTable('api_keys'))
    .columns(['token_hash'])
    .unique()
    .execute();
}
