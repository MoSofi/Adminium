// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0018 — `adminium_connections.timezoneSource`: WHO chose the zone.
 *
 * ─── What changed under 0015 ───────────────────────────────────────────────
 *
 * 0015 added `timezone` and argued for no default at all: "a wrong zone is
 * worse than a missing one, because it looks like data". `connectionsRepo`
 * later seeded new rows from the SERVER's zone anyway, and for a good reason —
 * a null zone made a hosted app surface refuse to render, so the cost of the
 * missing value landed as total unavailability rather than an hour's drift.
 *
 * Both positions are right about their own failure, and the column below is
 * what lets them both hold. A seeded zone keeps surfaces rendering; recording
 * that it was seeded keeps it from passing as a decision nobody made.
 *
 * ─── Why provenance and not a different default ────────────────────────────
 *
 * Without this column a stored zone is two very different facts wearing one
 * value: something an operator chose for the business, or something the server
 * guessed from the clock of whatever machine it happens to run on (a developer
 * laptop, a container defaulting to UTC, a VM in the wrong region). Studio
 * renders them identically, so the guess reads as a decision — reproducing in
 * the UI precisely the failure 0015 refused in the data.
 *
 * ─── Values, and why NULL is not backfilled ────────────────────────────────
 *
 *   'operator'  a human set this — the wizard, Studio, or `PATCH /connections`
 *   'host'      `connectionsRepo.create` derived it from the server's own zone
 *   NULL        unknown, or no zone to attribute
 *
 * Rows predating this column are left NULL rather than guessed at, and NULL
 * must render as no claim at all. The asymmetry is deliberate: under-claiming
 * costs an operator a badge they did not need, while over-claiming tells
 * someone their correct, deliberately chosen zone is a guess — which is how a
 * badge earns the right to be ignored.
 *
 * A zone that is itself NULL carries a NULL source: there is no choice to
 * attribute, and "the operator chose nothing" is a state `timezone` already
 * records on its own.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .alterTable(metaTable('connections'))
    // 'operator' is the longest value at 8; 16 leaves room for a third source
    // (an inherited or probed zone) without a second ALTER.
    .addColumn('timezone_source', c.str(16))
    .execute();
}
