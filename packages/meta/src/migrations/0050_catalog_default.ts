// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0050 — an existing install keeps its catalogue switches as they were.
 *
 * From 0.3.16 the two switches (`addOns.catalogEnabled`, `apps.catalogEnabled`)
 * default to ON: a new install lists what adminium.dev offers from its first
 * start. A switch nobody ever touched has no row, and reads the registry's
 * default, so without this an upgraded server would start asking adminium.dev
 * for the two lists because it upgraded. Nobody agreed to that.
 *
 * So, on a store that already existed, each of the two keys that has NO row is
 * given one saying `false`: what that server was running on. A stored value,
 * on or off, is never touched.
 *
 * "Already existed" is read from the migration ledger itself: was the
 * migration before this one applied in an earlier run? A new store applies
 * every migration in one pass, seconds apart; an upgraded store, a restored
 * backup, a desktop install and a store that was migrated and never set up all
 * hold an older row. The margin is a minute. A new install slow enough to take
 * longer between two migrations lands on off, which is the safe side.
 */

import { sql, type Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** The migration before this one: its row says when the store last moved. */
const PREVIOUS = '0049_project_apps';
/** Longer ago than this, and the store was there before this run. */
const SAME_RUN_MS = 60_000;

export const CATALOG_SWITCHES = ['addOns.catalogEnabled', 'apps.catalogEnabled'] as const;

export async function up(db: Kysely<unknown>, _c: ColumnHelpers, now: number = Date.now()): Promise<void> {
  // One short alias: the store's own Kysely renames result columns (snake to camel), and this must read on a bare one too.
  const ledger = await sql<{ at: number | string | bigint }>`SELECT applied_at AS ${sql.ref('at')} FROM adminium_migrations WHERE name = ${PREVIOUS}`.execute(db).catch(() => ({ rows: [] as { at: number }[] }));
  const appliedAt = ledger.rows[0] === undefined ? null : Number(ledger.rows[0].at);
  // No row for the one before: this store is being made now (or the ledger is not there to ask).
  if (appliedAt === null || !Number.isFinite(appliedAt) || now - appliedAt <= SAME_RUN_MS) return;

  const settings = metaTable('settings');
  for (const key of CATALOG_SWITCHES) {
    const held = await sql<{ key: string }>`SELECT ${sql.ref('key')} FROM ${sql.table(settings)} WHERE ${sql.ref('key')} = ${key}`.execute(db);
    if (held.rows.length > 0) continue;
    await sql`INSERT INTO ${sql.table(settings)} (${sql.ref('key')}, ${sql.ref('value')}, updated_at, updated_by) VALUES (${key}, ${'false'}, ${now}, ${null})`.execute(db);
  }
}
