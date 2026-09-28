// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0047 — on MySQL, every `text` column becomes `longtext`.
 *
 * ─── THE BUG ──────────────────────────────────────────────────────────────
 * `c.text` promises unbounded text (../columns.ts), and PostgreSQL and SQLite
 * keep that promise. MySQL's `text` does not: it holds 65,535 BYTES, fewer
 * characters once a value is not plain ASCII. A longer value is refused with
 * `Data too long for column` under the default strict `sql_mode` (a 500 on the
 * screen that saved it), and cut off at the limit, with only a warning, on a
 * server running without STRICT_TRANS_TABLES. Nothing sets a mode on the meta
 * connection, so which of the two a store gets is the server's choice.
 *
 * Values that reach it: the schema-enrichment prompt of any schema past a few
 * dozen tables (`llm_runs.prompt_text`, stored whole, up to 60k tokens a
 * chunk) and the model's reply to it (`llm_runs.response_raw`); a public
 * endpoint's definition (`public_endpoints.definition`) or an app's outbox
 * (`app_outboxes.definition`) that carries long default values or lists.
 *
 * ─── THE FIX ──────────────────────────────────────────────────────────────
 * ../columns.ts now emits `longtext` for `c.text` on MySQL, so a store made
 * from now on gets it from 0001. This wave converts the columns a store made
 * before already has: all 34 `c.text` columns 0001–0044 created. MySQL
 * cannot change a column's type in place (it copies the table), so it is one
 * `ALTER TABLE` per table and each table is copied once. MODIFY restates
 * the whole definition, so each column keeps exactly what it had: six are
 * NOT NULL, the rest nullable, and none has a default. `json` columns are
 * not touched: MySQL's `json` is bounded only by `max_allowed_packet`.
 *
 * Running it twice is harmless (a `longtext` column modified to `longtext`),
 * which matters because MySQL DDL commits as it goes: a crash halfway leaves
 * the ledger without this row, and the rerun finishes the rest.
 *
 * SQLITE AND POSTGRESQL ARE UNTOUCHED: their `text` is already unbounded.
 */
import {
  sql,
  type AlterTableBuilder,
  type AlterTableColumnAlteringBuilder,
  type ColumnDefinitionBuilder,
  type Kysely,
} from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** Every `c.text` column, by table (unprefixed), with whether it is NOT NULL. */
const TEXT_COLUMNS: Readonly<Record<string, readonly (readonly [column: string, notNull: boolean])[]>> = {
  users: [
    ['password_hash', false],
    ['totp_secret_encrypted', false],
  ],
  roles: [['description', false]],
  connections: [
    ['introspect_dsn_encrypted', false],
    ['data_dsn_encrypted', false],
    ['last_error', false],
    ['last_error_hint', false],
  ],
  jobs: [['last_error', false]],
  notifications: [['body', false]],
  llm_runs: [
    ['response_raw', false],
    ['prompt_text', false],
  ],
  automations: [['description', false]],
  automation_runs: [['error', false]],
  exports: [['error', false]],
  webhooks: [['secret_encrypted', true]],
  webhook_deliveries: [['error', false]],
  feature_flags: [['description', false]],
  manifests: [['license_key_encrypted', false]],
  translations: [
    ['value', true],
    ['source_text', false],
  ],
  public_keys: [
    ['token_encrypted', true],
    ['requires_staff', false],
    ['enabled_by', false],
  ],
  add_on_credentials: [['payload', true]],
  storage_destinations: [
    ['secret_encrypted', false],
    ['last_error', false],
  ],
  email_templates: [['footer', false]],
  documents: [['error', false]],
  assistant_turns: [
    ['ask_text', false],
    ['say', false],
  ],
  public_endpoints: [['definition', true]],
  public_challenges: [['new_destination_enc', false]],
  app_outboxes: [['definition', true]],
  app_tables: [['shape_columns', false]],
};

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  if (c.dialect !== 'mysql') return;

  for (const [table, columns] of Object.entries(TEXT_COLUMNS)) {
    // One statement per table, so a table is rebuilt once. Spelled `longtext`
    // here rather than `c.text`, so what this wave does cannot move if the
    // helper ever does.
    let statement: AlterTableBuilder | AlterTableColumnAlteringBuilder = db.schema.alterTable(metaTable(table));
    for (const [column, notNull] of columns) {
      statement = statement.modifyColumn(column, sql`longtext`, (col: ColumnDefinitionBuilder) => (notNull ? col.notNull() : col));
    }
    await (statement as AlterTableColumnAlteringBuilder).execute();
  }
}
