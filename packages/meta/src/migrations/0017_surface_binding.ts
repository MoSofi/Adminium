// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0017 — key ↔ app-surface binding (29-app-surfaces.md D10, 29-T15).
 *
 * A hosted CUSTOMER surface is configured at serve time, not bake time: the
 * surfaces plugin answers `GET /apps/<key>/customer/surface-config.json` with
 * the newest live publishable key bound to that app, so rotating a key is
 * Studio + reload rather than a rebuild. "Bound to that app" needs a COLUMN —
 * before this wave, "minted per side per app" was a naming convention on
 * `adminium_public_keys.name`, which nothing could query.
 *
 * `app_key` is the manifest key of the owning app (`clients`, `clinic`, …),
 * nullable because binding is optional: a key minted for a standalone build
 * or a third-party integration belongs to no hosted surface and stays NULL.
 *
 * Planned as `0016_surface_binding` (29 D10); renumbered to 0017 because
 * plan 30's `0016_audit_entity` shipped first and the list is append-only.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** Matches the discovery layout: a surface directory name, e.g. `clients`. */
export const PUBLIC_KEY_APP_KEY_MAX = 64;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .alterTable(metaTable('public_keys'))
    .addColumn('app_key', c.str(PUBLIC_KEY_APP_KEY_MAX))
    .execute();
  // (app_key, side): the config route's exact lookup — every live key for one
  // app's side, newest picked in the query. The table is operator-scale (tens
  // of rows), but the read is on an anonymous, unauthenticated path, so it
  // should not scan by policy rather than by size.
  await db.schema
    .createIndex('ix_adminium_public_keys_app')
    .on(metaTable('public_keys'))
    .columns(['app_key', 'side'])
    .execute();
}
