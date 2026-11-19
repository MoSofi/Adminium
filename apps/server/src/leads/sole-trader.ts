// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SOLE TRADER IS ONE PERSON, STORED IN TWO ROWS.
 *
 * A register's sole trader (a French entrepreneur individuel, a Norwegian
 * ENK) is a person: the company row the lead door adds for them holds their
 * own name, often their home address and phone. With people on, the door
 * keeps them as a found person too (their contact row, with the address a
 * member of staff typed). The two rows are one unit: kept together, erased
 * together.
 *
 * What ties them is a mark in the add-on's fields' sources, written on the
 * COMPANY row as Adminium, before the person is kept: a row whose column is
 * {@link SOLE_TRADER_MARK} (no table's column is named so), whose source is
 * the register, and whose value hash is the sha-256 of the found person's
 * address. A found person's row names that company (`company_table`,
 * `company_key`); the company row is theirs when the mark is there for their
 * address. Every erasure of the found person (Object, the "tell by" day, the
 * keeping time, a privacy erasure) then empties that company row too, and
 * their download carries it.
 *
 * The mark also says where the address came from: a sole trader's address is
 * never a source's, always the one a member of staff typed at Add. The tell
 * mail and the download say so.
 */
import { createHash } from 'node:crypto';

import { sql, type Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable } from '../crud/identifiers.js';
import { instantFor } from '../crud/instants.js';
import type { Row } from '../crud/mask.js';
import { insertRow, type RecordWriteService, type WriteContext, type WriteTarget } from '../crud/write-service.js';
import { normaliseAddress } from '../public-api/claim-code.js';

/** The column name the mark is written under: no table's column is named so. */
export const SOLE_TRADER_MARK = '*person';

/** The mark's value hash: the sha-256, in hex, of the address as every door normalises it. */
export function soleTraderHash(address: string): string {
  return createHash('sha256').update(normaliseAddress(address)).digest('hex');
}

/** Where the mark is written: the add-on's fields' sources, as Adminium. */
export interface SoleTraderPlace {
  target: WriteTarget;
  writes: Pick<RecordWriteService, 'check'>;
  context: WriteContext;
}

/** Marks a company row as the sole trader with this address (see the header). */
export async function markSoleTrader(place: SoleTraderPlace, company: { table: string; key: string }, address: string, source: string, at: number): Promise<void> {
  await unmarkSoleTrader(place.target.db, place.target.table, company);
  const values: Row = {
    table_ref: company.table.slice(0, 64),
    row_key: company.key.slice(0, 200),
    column_name: SOLE_TRADER_MARK,
    source: source.slice(0, 32),
    found_at: instantFor(new Date(at)),
    value_hash: soleTraderHash(address),
  };
  const verdict = await place.writes.check('create', place.target, place.context, [values], { capacity: 'unchecked' });
  const good = verdict.rows[0];
  if (good === null || good === undefined) throw new Error(`the fields' sources table refused a sole trader's mark: ${JSON.stringify(verdict.issues[0] ?? {})}`);
  await insertRow(place.target.db, place.target.dialect, place.target.table, good);
}

/** Takes a company row's mark away (the person was not kept after all). */
export async function unmarkSoleTrader(db: Kysely<SourceDatabase>, fieldSources: ResolvedTable, company: { table: string; key: string }): Promise<void> {
  await db
    .deleteFrom(fieldSources.id as never)
    .where(sql.ref('table_ref'), '=', company.table as never)
    .where(sql.ref('row_key'), '=', company.key as never)
    .where(sql.ref('column_name'), '=', SOLE_TRADER_MARK as never)
    .execute();
}

/** Whether a found person's company row is theirs: a sole trader's, marked for their address. */
export async function soleTraderCompany(
  db: Kysely<SourceDatabase>,
  fieldSources: ResolvedTable | null,
  found: { companyTable: string | null; companyKey: string | null; email: string | null },
): Promise<boolean> {
  if (fieldSources === null || found.companyTable === null || found.companyKey === null || found.email === null) return false;
  const hit = await db
    .selectFrom(fieldSources.id as never)
    .select(sql<number>`1`.as('one') as never)
    .where(sql.ref('table_ref'), '=', found.companyTable as never)
    .where(sql.ref('row_key'), '=', found.companyKey as never)
    .where(sql.ref('column_name'), '=', SOLE_TRADER_MARK as never)
    .where(sql.ref('value_hash'), '=', soleTraderHash(found.email) as never)
    .limit(1)
    .executeTakeFirst();
  return hit !== undefined;
}
