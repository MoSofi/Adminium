// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "DELETE MY DETAILS", ON THE PARCELS. A label and a commercial invoice name the
 * customer and their address, so they go with the person, as in the staff
 * erasure (`shipping/labels.ts`).
 *
 * An order is found by the link to the person's own row and by nothing else,
 * whether or not the app declares a copy on it and whether or not the law keeps
 * it: the order stays, and its label is not that record. An order already
 * removed is found by the link its removal kept.
 */
import { removedRowsRepo, shippingBookingsRepo, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { rowKeyOf } from '../payments/payables.js';
import type { LabelPersonRow } from '../shipping/labels.js';
import { tableOf } from './sources.js';

const REMOVED_PAGE = 200;

/** Every row with a parcel that is this person's: their own, the orders linked to it, and those removed while linked. */
export async function parcelRowsOfPerson(meta: MetaDb, db: Kysely<SourceDatabase>, connectionId: string, view: SnapshotView, person: ResolvedTable, row: Row): Promise<LabelPersonRow[]> {
  const personKey = person.primaryKey.length === 1 ? row[person.primaryKey[0]!] : undefined;
  if (personKey === null || personKey === undefined) return [];
  const out: LabelPersonRow[] = [{ connectionId, table: person.id, key: rowKeyOf(person, row) }];
  for (const tableId of await shippingBookingsRepo(meta).tablesOn(connectionId)) {
    const table = tableOf(view, tableId);
    if (table === null || table.primaryKey.length === 0) continue;
    const vias = view.model.relations
      .filter((relation) => relation.through === null && relation.from.tableId === table.id && relation.to.tableId === person.id && relation.from.columns.length === 1)
      .map((relation) => relation.from.columns[0]!);
    for (const via of vias) {
      const rows = (await db.selectFrom(table.id as never).select(table.primaryKey.map((column) => sql.ref(column).as(column)) as never).where(sql.ref(via), '=', personKey as never).execute()) as Row[];
      for (const one of rows) out.push({ connectionId, table: table.id, key: rowKeyOf(table, one) });
    }
    if (vias.length === 0) continue;
    const links = vias.map((via) => ({ via, parentValue: String(personKey) }));
    let before: { removedAt: number; id: string } | undefined;
    for (;;) {
      const page = await removedRowsRepo(meta).listUnder({ connectionId, entityTable: table.id, parentTable: person.id, links, limit: REMOVED_PAGE, before });
      for (const one of page) out.push({ connectionId, table: table.id, key: one.entityId });
      if (page.length < REMOVED_PAGE) break;
      const last = page.at(-1)!;
      before = { removedAt: last.removedAt, id: last.id };
    }
  }
  return out;
}
