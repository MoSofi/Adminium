// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0006 — platform: adminium_llm_runs, adminium_automations,
 * adminium_automation_runs, adminium_scheduled_reports, adminium_exports,
 * adminium_imports, adminium_email_templates, adminium_webhooks,
 * adminium_webhook_deliveries, adminium_feature_flags, adminium_manifests,
 * adminium_changelog_seen (07-meta-store.md §3.19, §3.22–§3.26, §3.28–§3.33).
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('llm_runs'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('connection_id', c.id, (col) => col.notNull())
    .addColumn('snapshot_id', c.id, (col) => col.notNull())
    .addColumn('mode', c.str(8), (col) => col.notNull())
    .addColumn('provider', c.str(20))
    .addColumn('model', c.str(60))
    .addColumn('prompt_version', c.str(10), (col) => col.notNull())
    .addColumn('prompt_hash', c.str(64), (col) => col.notNull())
    .addColumn('response_raw', c.text)
    .addColumn('response_json', c.json)
    .addColumn('validation_status', c.str(8), (col) => col.notNull().defaultTo('pending'))
    .addColumn('validation_errors', c.json)
    .addColumn('applied_at', c.ts)
    .addColumn('applied_by', c.id)
    .addColumn('tokens_in', c.int)
    .addColumn('tokens_out', c.int)
    .addColumn('duration_ms', c.int)
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_llm_runs_connection_id',
      ['connection_id'],
      metaTable('connections'),
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .addForeignKeyConstraint(
      'fk_adminium_llm_runs_snapshot_id',
      ['snapshot_id'],
      metaTable('schema_snapshots'),
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .addForeignKeyConstraint('fk_adminium_llm_runs_applied_by', ['applied_by'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .addForeignKeyConstraint('fk_adminium_llm_runs_created_by', ['created_by'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .execute();
  await db.schema
    .createIndex('idx_adminium_llm_runs_prompt_hash')
    .on(metaTable('llm_runs'))
    .columns(['prompt_hash'])
    .execute();

  await db.schema
    .createTable(metaTable('automations'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('connection_id', c.id)
    .addColumn('name', c.str(120), (col) => col.notNull())
    .addColumn('description', c.text)
    .addColumn('enabled', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    .addColumn('trigger', c.json, (col) => col.notNull())
    .addColumn('graph', c.json, (col) => col.notNull())
    .addColumn('last_run_at', c.ts)
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_automations_connection_id',
      ['connection_id'],
      metaTable('connections'),
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .addForeignKeyConstraint('fk_adminium_automations_created_by', ['created_by'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .execute();

  await db.schema
    .createTable(metaTable('automation_runs'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('automation_id', c.id, (col) => col.notNull())
    // Soft ref — job rows are GC'd sooner (§3.23).
    .addColumn('job_id', c.str(36))
    .addColumn('status', c.str(10), (col) => col.notNull())
    .addColumn('trigger_event', c.json, (col) => col.notNull())
    .addColumn('trace', c.json)
    .addColumn('error', c.text)
    .addColumn('started_at', c.ts, (col) => col.notNull())
    .addColumn('finished_at', c.ts)
    .addForeignKeyConstraint(
      'fk_adminium_automation_runs_automation_id',
      ['automation_id'],
      metaTable('automations'),
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();
  await db.schema
    .createIndex('idx_adminium_automation_runs_auto_started')
    .on(metaTable('automation_runs'))
    .columns(['automation_id', 'started_at'])
    .execute();

  await db.schema
    .createTable(metaTable('scheduled_reports'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('page_id', c.id, (col) => col.notNull())
    .addColumn('name', c.str(120), (col) => col.notNull())
    .addColumn('schedule', c.json, (col) => col.notNull())
    .addColumn('recipients', c.json, (col) => col.notNull())
    .addColumn('format', c.str(4), (col) => col.notNull().defaultTo('pdf'))
    .addColumn('enabled', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(true)))
    .addColumn('last_run_at', c.ts)
    .addColumn('next_run_at', c.ts)
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_scheduled_reports_page_id', ['page_id'], metaTable('pages'), ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .addForeignKeyConstraint(
      'fk_adminium_scheduled_reports_created_by',
      ['created_by'],
      metaTable('users'),
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .execute();
  await db.schema
    .createIndex('idx_adminium_scheduled_reports_next')
    .on(metaTable('scheduled_reports'))
    .columns(['enabled', 'next_run_at'])
    .execute();

  await db.schema
    .createTable(metaTable('exports'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('connection_id', c.id)
    .addColumn('requested_by', c.id, (col) => col.notNull())
    .addColumn('source', c.json, (col) => col.notNull())
    .addColumn('format', c.str(6), (col) => col.notNull())
    .addColumn('status', c.str(12), (col) => col.notNull().defaultTo('processing'))
    .addColumn('file_id', c.id)
    .addColumn('row_count', c.bigint)
    .addColumn('error', c.text)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('completed_at', c.ts)
    .addColumn('expires_at', c.ts)
    .addForeignKeyConstraint(
      'fk_adminium_exports_connection_id',
      ['connection_id'],
      metaTable('connections'),
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .addForeignKeyConstraint('fk_adminium_exports_requested_by', ['requested_by'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .addForeignKeyConstraint('fk_adminium_exports_file_id', ['file_id'], metaTable('files'), ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .execute();
  await db.schema
    .createIndex('idx_adminium_exports_user_created')
    .on(metaTable('exports'))
    .columns(['requested_by', 'created_at'])
    .execute();
  await db.schema
    .createIndex('idx_adminium_exports_status_expires')
    .on(metaTable('exports'))
    .columns(['status', 'expires_at'])
    .execute();

  await db.schema
    .createTable(metaTable('imports'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('connection_id', c.id, (col) => col.notNull())
    .addColumn('table_name', c.str(200), (col) => col.notNull())
    .addColumn('requested_by', c.id, (col) => col.notNull())
    .addColumn('file_id', c.id, (col) => col.notNull())
    .addColumn('mapping', c.json, (col) => col.notNull())
    .addColumn('options', c.json, (col) => col.notNull())
    .addColumn('status', c.str(12), (col) => col.notNull().defaultTo('validating'))
    .addColumn('stats', c.json)
    .addColumn('error_report_file_id', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('started_at', c.ts)
    .addColumn('finished_at', c.ts)
    .addForeignKeyConstraint(
      'fk_adminium_imports_connection_id',
      ['connection_id'],
      metaTable('connections'),
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .addForeignKeyConstraint('fk_adminium_imports_requested_by', ['requested_by'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .addForeignKeyConstraint('fk_adminium_imports_file_id', ['file_id'], metaTable('files'), ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .addForeignKeyConstraint(
      'fk_adminium_imports_error_report_file_id',
      ['error_report_file_id'],
      metaTable('files'),
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .execute();

  await db.schema
    .createTable(metaTable('email_templates'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('key', c.str(80), (col) => col.notNull())
    .addColumn('locale', c.str(5), (col) => col.notNull().defaultTo('en_US'))
    .addColumn('name', c.str(120), (col) => col.notNull())
    .addColumn('subject', c.str(300), (col) => col.notNull())
    .addColumn('blocks', c.json, (col) => col.notNull())
    .addColumn('enabled', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(true)))
    .addColumn('is_builtin_copy', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    .addColumn('updated_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_email_templates_updated_by', ['updated_by'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .execute();
  await db.schema
    .createIndex('uq_adminium_email_templates_key_locale')
    .on(metaTable('email_templates'))
    .columns(['key', 'locale'])
    .unique()
    .execute();

  await db.schema
    .createTable(metaTable('webhooks'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('name', c.str(120), (col) => col.notNull())
    .addColumn('url', c.str(500), (col) => col.notNull())
    .addColumn('secret_encrypted', c.text, (col) => col.notNull())
    .addColumn('events', c.json, (col) => col.notNull())
    .addColumn('enabled', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(true)))
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_webhooks_created_by', ['created_by'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .execute();

  await db.schema
    .createTable(metaTable('webhook_deliveries'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('webhook_id', c.id, (col) => col.notNull())
    .addColumn('event', c.str(80), (col) => col.notNull())
    .addColumn('payload', c.json, (col) => col.notNull())
    .addColumn('attempt', c.int, (col) => col.notNull().defaultTo(1))
    .addColumn('success', c.bool, (col) => col.notNull())
    .addColumn('status_code', c.int)
    .addColumn('response_ms', c.int)
    .addColumn('error', c.text)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_webhook_deliveries_webhook_id',
      ['webhook_id'],
      metaTable('webhooks'),
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();
  await db.schema
    .createIndex('idx_adminium_webhook_deliveries_hook_created')
    .on(metaTable('webhook_deliveries'))
    .columns(['webhook_id', 'created_at'])
    .execute();

  await db.schema
    .createTable(metaTable('feature_flags'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('key', c.str(80), (col) => col.notNull())
    .addColumn('name', c.str(120), (col) => col.notNull())
    .addColumn('description', c.text)
    .addColumn('environments', c.json, (col) => col.notNull())
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_feature_flags_created_by', ['created_by'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .execute();
  await db.schema
    .createIndex('uq_adminium_feature_flags_key')
    .on(metaTable('feature_flags'))
    .columns(['key'])
    .unique()
    .execute();

  await db.schema
    .createTable(metaTable('manifests'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('manifest_key', c.str(80), (col) => col.notNull())
    .addColumn('version', c.str(20), (col) => col.notNull())
    .addColumn('source', c.str(12), (col) => col.notNull())
    .addColumn('manifest', c.json, (col) => col.notNull())
    .addColumn('license_key_encrypted', c.text)
    .addColumn('connection_id', c.id)
    .addColumn('status', c.str(10), (col) => col.notNull().defaultTo('installed'))
    .addColumn('installed_by', c.id)
    .addColumn('installed_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_manifests_connection_id',
      ['connection_id'],
      metaTable('connections'),
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .addForeignKeyConstraint('fk_adminium_manifests_installed_by', ['installed_by'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .execute();
  await db.schema
    .createIndex('uq_adminium_manifests_manifest_key')
    .on(metaTable('manifests'))
    .columns(['manifest_key'])
    .unique()
    .execute();

  await db.schema
    .createTable(metaTable('changelog_seen'))
    .ifNotExists()
    .addColumn('user_id', c.id, (col) => col.primaryKey())
    .addColumn('version', c.str(20), (col) => col.notNull())
    .addColumn('seen_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_changelog_seen_user_id', ['user_id'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();
}
