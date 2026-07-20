/**
 * Wave 0005 — ops: adminium_jobs, adminium_audit_log,
 * adminium_notifications, adminium_notification_prefs
 * (07-meta-store.md §3.11–§3.12, §3.20–§3.21).
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('jobs'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('kind', c.str(60), (col) => col.notNull())
    .addColumn('payload', c.json, (col) => col.notNull())
    .addColumn('status', c.str(12), (col) => col.notNull().defaultTo('pending'))
    .addColumn('priority', c.int, (col) => col.notNull().defaultTo(0))
    .addColumn('run_at', c.ts, (col) => col.notNull())
    .addColumn('attempts', c.int, (col) => col.notNull().defaultTo(0))
    .addColumn('max_attempts', c.int, (col) => col.notNull().defaultTo(3))
    .addColumn('locked_by', c.str(60))
    .addColumn('locked_at', c.ts)
    .addColumn('dedupe_key', c.str(120))
    .addColumn('last_error', c.text)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('started_at', c.ts)
    .addColumn('finished_at', c.ts)
    .execute();
  await db.schema
    .createIndex('idx_adminium_jobs_status_run_at')
    .on(metaTable('jobs'))
    .columns(['status', 'run_at'])
    .execute();
  // NULLs are exempt from unique on all three dialects (§3.12).
  await db.schema
    .createIndex('uq_adminium_jobs_dedupe_key')
    .on(metaTable('jobs'))
    .columns(['dedupe_key'])
    .unique()
    .execute();

  await db.schema
    .createTable(metaTable('audit_log'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('actor_kind', c.str(12), (col) => col.notNull())
    // No FK — audit retention outlives principals (§3.11).
    .addColumn('actor_id', c.str(36))
    .addColumn('actor_label', c.str(200), (col) => col.notNull())
    .addColumn('category', c.str(20), (col) => col.notNull())
    .addColumn('action', c.str(80), (col) => col.notNull())
    // Soft ref (no FK).
    .addColumn('connection_id', c.str(36))
    .addColumn('entity', c.json)
    .addColumn('changes', c.json)
    .addColumn('ip', c.str(45))
    .addColumn('user_agent', c.str(300))
    .addColumn('request_id', c.str(30))
    .execute();
  await db.schema
    .createIndex('idx_adminium_audit_log_created_at')
    .on(metaTable('audit_log'))
    .columns(['created_at'])
    .execute();
  await db.schema
    .createIndex('idx_adminium_audit_log_actor_created')
    .on(metaTable('audit_log'))
    .columns(['actor_id', 'created_at'])
    .execute();
  await db.schema
    .createIndex('idx_adminium_audit_log_category_created')
    .on(metaTable('audit_log'))
    .columns(['category', 'created_at'])
    .execute();

  await db.schema
    .createTable(metaTable('notifications'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('user_id', c.id, (col) =>
      col.notNull().references(`${metaTable('users')}.id`).onDelete('cascade'),
    )
    .addColumn('kind', c.str(60), (col) => col.notNull())
    .addColumn('actor_label', c.str(120), (col) => col.notNull().defaultTo('Adminium'))
    .addColumn('title', c.str(200), (col) => col.notNull())
    .addColumn('body', c.text)
    .addColumn('entity', c.json)
    .addColumn('action_url', c.str(500))
    .addColumn('read_at', c.ts)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex('idx_adminium_notifications_user_read_created')
    .on(metaTable('notifications'))
    .columns(['user_id', 'read_at', 'created_at'])
    .execute();

  await db.schema
    .createTable(metaTable('notification_prefs'))
    .ifNotExists()
    .addColumn('user_id', c.id, (col) =>
      col.notNull().references(`${metaTable('users')}.id`).onDelete('cascade'),
    )
    .addColumn('event_key', c.str(80), (col) => col.notNull())
    .addColumn('channels', c.json, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_adminium_notification_prefs', ['user_id', 'event_key'])
    .execute();
}
