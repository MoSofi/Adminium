// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0046 — a guest's session that was ENDED, not only one that lapsed.
 *
 * ─── `adminium_public_sessions.ended_at`, `.ended_reason` ──────────────────
 * "Sign out everywhere" and "delete my details" end every session of one
 * person at once. A session simply deleted would leave the person's other
 * devices silently signed out, a page that cannot say why. So an ended
 * session is kept, marked with the moment and the reason (`elsewhere` —
 * signed out from another device; `forgotten` — the person's details were
 * deleted), and a device that presents it is told the reason in a response
 * header, once, while it opens nothing: the row goes as it is told.
 *
 * Both columns are empty for every session made before this wave and for
 * every live one; housekeeping removes an ended row never presented at its
 * original expiry, as it removes any other.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema.alterTable(metaTable('public_sessions')).addColumn('ended_at', c.ts).execute();
  await db.schema.alterTable(metaTable('public_sessions')).addColumn('ended_reason', c.str(16)).execute();
}
