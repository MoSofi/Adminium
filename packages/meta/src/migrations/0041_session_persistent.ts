// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0041 — `adminium_sessions.persistent`: did the person tick "Keep me
 * signed in"?
 *
 * The answer decides the cookie, not the row's lifetime: a persistent session
 * gets a cookie with `Max-Age`, a non-persistent one a browser-session cookie
 * that the browser drops when it closes. The server-side expiry
 * (`expires_at`, the 7-day idle window) is the same either way.
 *
 * ─── Why it is stored at all ──────────────────────────────────────────────
 *
 * The cookie is set more than once per sign-in, and the later writers never
 * see the checkbox. A 2FA login answers `/auth/login` with a challenge and sets
 * the cookie at `/auth/2fa/verify`; a password change revokes the session and
 * mints a new one. The challenge rows live in this same table, so the choice
 * rides on the challenge into the session, and from the session into its
 * replacement. Without it, a person who unticked the box on a shared computer
 * would be upgraded to a 30-day cookie by changing their password.
 *
 * ─── Backfill ─────────────────────────────────────────────────────────────
 *
 * The default does it: every session minted before this wave was given a
 * `Max-Age` cookie, which is exactly what `true` means.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .alterTable(metaTable('sessions'))
    .addColumn('persistent', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(true)))
    .execute();
}
