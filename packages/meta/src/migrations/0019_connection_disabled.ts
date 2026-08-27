// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0019 — `adminium_connections.disabled_at`: the operator PAUSED this
 * source, and when.
 *
 * ─── Why not a `status` value ──────────────────────────────────────────────
 *
 * `status` is a HEALTH reading — `connected` / `error` / `unconfigured` — and
 * every writer of it is a probe (`recordTestResult`, the create path). Folding
 * a pause into that enum would mean the next successful test silently unpaused
 * the connection, because a probe's whole job is to overwrite `status` with
 * what it just observed. It would also destroy the reading underneath: an
 * operator who pauses a source that is currently failing, fixes the database,
 * and resumes has no way back to `error` because nothing recorded it.
 *
 * Health is observed; a pause is INTENDED. Two facts, two columns, and the
 * card can say "paused, and it was failing when you paused it".
 *
 * ─── Why a timestamp and not a boolean ─────────────────────────────────────
 *
 * A pause is meant to be temporary, so "how long has this been off?" is the
 * question that follows it — a source paused an hour ago during a migration
 * and one paused five weeks ago and forgotten are the same boolean and very
 * different situations. NULL means enabled; anything else is the epoch-ms
 * instant it was paused (07-meta-store.md §2.1: never a native datetime).
 *
 * WHO paused it is not stored here. The audit log already records the actor
 * for `connection.disable` / `connection.enable` alongside every other
 * connection action, and a second, unjoined copy on the row would be one more
 * thing that can disagree with it.
 *
 * ─── Backfill ──────────────────────────────────────────────────────────────
 *
 * None. Every pre-0019 row was serving, which is exactly what NULL means.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .alterTable(metaTable('connections'))
    .addColumn('disabled_at', c.ts)
    .execute();
}
