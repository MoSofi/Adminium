// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0054 — a workspace that was there before keeps what its assistant did.
 *
 * From this release what the assistant may DO is four switches (create,
 * change, send, delete), all off on a new workspace: it reads, and a person
 * switches the rest on. But an assistant that was already in use could save
 * its drafts (a template, a report, a rule) as new documents. Upgrading must
 * not take that away, so a workspace that existed gets `create` on and the
 * other three off: exactly what it could do the day before.
 *
 * "A workspace that existed" is two things, both read here:
 *  - the store's FIRST migration is older than this run (the test wave 0050
 *    uses, for the reasons written there), AND
 *  - somebody is in it. A store that was migrated and never set up has no
 *    user and nothing to keep: it starts like any new workspace, all off.
 *
 * A stored value is never touched.
 */

import { sql, type Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** A store whose first migration is older than this was there before this run. */
const SAME_RUN_MS = 60_000;

export const ABILITIES_SETTING = 'assistant.abilities';
export const UPGRADED_ABILITIES = { create: true, change: false, send: false, delete: false } as const;

export async function up(db: Kysely<unknown>, _c: ColumnHelpers, now: number = Date.now()): Promise<void> {
  // One short alias: the store's own Kysely renames result columns (snake to camel), and this must read on a bare one too.
  const ledger = await sql<{ at: number | string | bigint | null }>`SELECT MIN(applied_at) AS ${sql.ref('at')} FROM adminium_migrations`.execute(db).catch(() => ({ rows: [] }));
  const first = ledger.rows[0]?.at;
  const firstAt = first === undefined || first === null ? null : Number(first);
  // No row at all: this store is being made now (or the ledger is not there to ask).
  if (firstAt === null || !Number.isFinite(firstAt) || now - firstAt <= SAME_RUN_MS) return;

  const people = await sql<{ n: number | string | bigint }>`SELECT COUNT(*) AS ${sql.ref('n')} FROM ${sql.table(metaTable('users'))}`.execute(db);
  if (Number(people.rows[0]?.n ?? 0) === 0) return;

  const settings = metaTable('settings');
  const held = await sql<{ key: string }>`SELECT ${sql.ref('key')} FROM ${sql.table(settings)} WHERE ${sql.ref('key')} = ${ABILITIES_SETTING}`.execute(db);
  if (held.rows.length > 0) return;
  await sql`INSERT INTO ${sql.table(settings)} (${sql.ref('key')}, ${sql.ref('value')}, updated_at, updated_by) VALUES (${ABILITIES_SETTING}, ${JSON.stringify(UPGRADED_ABILITIES)}, ${now}, ${null})`.execute(db);
}
