// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0015 — `adminium_connections.timezone` / `.currency` (28-T34, D20).
 *
 * ─── Why these are connection columns and not a settings table ──────────────
 *
 * D20 ruled O7 as a hybrid: Adminium owns only what it needs to serve correct
 * data, and it placed `timezone` on the SCOPE document — explicitly rejecting a
 * global `adminium_settings` key, because that is "wrong the moment an instance
 * holds two connections for businesses in different zones".
 *
 * That argument is right, and it points one level further than the ruling took
 * it. The thing a zone belongs to is the BUSINESS, and the business is the
 * database — the connection. A scope is a view onto a connection, and an
 * instance can hold several scopes over one connection; putting the zone on the
 * scope means the same business can be described by two scopes that disagree
 * about what time it is there, with nothing to reconcile them.
 *
 * ─── What forced it ────────────────────────────────────────────────────────
 *
 * A surface hosted BY Adminium reads through the operator's session. It has no
 * publishable key and therefore NO SCOPE, so under the old placement there was
 * nowhere for it to read a zone from at all — the app took it as a build
 * argument, which makes a property of the business a property of the artifact.
 * Hosted mode postdates D20; this is the consequence, not a reversal.
 *
 * ─── What does not change ──────────────────────────────────────────────────
 *
 * `scope.timezone` stays, as an OVERRIDE. It becomes optional and inherits from
 * the connection when omitted, and `compileScope` still refuses a scope that
 * ends up with no valid IANA zone from either source — so D20's boot-fatal
 * guarantee survives intact and every scope already stored keeps working
 * unchanged.
 *
 * Both columns are nullable with no default. There is no defensible default for
 * a timezone: a wrong zone is worse than a missing one, because it looks like
 * data. `null` means "not configured", and the refusal happens where the value
 * is needed rather than being papered over here.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .alterTable(metaTable('connections'))
    // IANA zone, e.g. `Europe/Lisbon`. 64 matches the scope schema's own cap.
    .addColumn('timezone', c.str(64))
    .execute();

  await db.schema
    .alterTable(metaTable('connections'))
    // ISO-4217, three letters. Null when this business's data carries no money.
    .addColumn('currency', c.str(3))
    .execute();
}
