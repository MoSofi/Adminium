// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A READER OF A CAMPAIGN'S SEND LOG SEES OF EACH PERSON.
 *
 * The send log keeps each recipient's address and name as they were mailed.
 * A row mailed from an app's people table shows them only as that table
 * shows them to the reader now, by the rule the sender itself is held to
 * (`openPeopleTable`, `email/audience-table.ts`):
 *
 *  - a reader who may not read the table at all (no read grant, rows private
 *    to their owners, the address column secret or not shown to the role)
 *    sees the row's state and reason, and neither the address nor the name;
 *  - a reader who sees the address column masked (no `read_pii`) sees no
 *    address, and no name where the table masks its name column too;
 *  - everyone else sees both.
 * A row mailed to the workspace's own people (no table) shows both, as it
 * always did: the reader already holds `settings.manage`.
 *
 * What is not shown is never searched either: the log's search matches only
 * the fields the reader sees on every row of the run, so a masked reader
 * cannot find a person by typing their address.
 */
import type { MetaDb } from '@adminium/meta';

import { UNMASK_PERMISSION } from '../crud/mask.js';
import { readViewOf } from '../crud/read-view.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { peopleTablesOf } from '../people/tables-of.js';
import { permissionSetAllows, type PermissionSet } from '../rbac/resolver.js';

/** What a reader sees of the people of one table: the address and the name, each in clear or not. */
export interface PersonSight {
  address: boolean;
  name: boolean;
}

const ALL: PersonSight = { address: true, name: true };
const NONE: PersonSight = { address: false, name: false };

/** Whether a column, as this reader's view of the table has it, is shown in clear. */
function shown(column: { secret: boolean; unreadable?: boolean | undefined; masked?: boolean | undefined } | undefined, canReadPii: boolean): boolean {
  return column !== undefined && !column.secret && column.unreadable !== true && (column.masked !== true || canReadPii);
}

/** What `set` sees of the people of `tableId` on `connectionId` (see the header). */
export async function personSightOf(meta: MetaDb, set: PermissionSet, connectionId: string, tableId: string): Promise<PersonSight> {
  let whole;
  try {
    whole = await loadSnapshotView(meta, connectionId);
  } catch {
    return NONE;
  }
  const wholeTable = whole.linkTable(tableId);
  if (wholeTable === null) return NONE;
  if (!permissionSetAllows(set, `table:${connectionId}:${wholeTable.id}:read`) || wholeTable.table.private === true) return NONE;
  const declared = await peopleTablesOf(meta).of(connectionId, whole.model, wholeTable.id);
  if (declared === null || declared.email === null) return NONE;
  const table = readViewOf(whole, set).linkTable(wholeTable.id) ?? wholeTable;
  const email = table.columns.get(declared.email);
  if (email === undefined || email.secret || email.unreadable === true) return NONE;
  const canReadPii = permissionSetAllows(set, UNMASK_PERMISSION) || permissionSetAllows(set, `table:${connectionId}:${wholeTable.id}:read_pii`);
  const address = shown(email, canReadPii);
  // The name the log keeps came from the declared name column; with none declared, it goes with the address.
  const name = declared.name === null ? address : shown(table.columns.get(declared.name), canReadPii);
  return { address, name };
}

/** A reader's sight (their permission set, as the request resolves it) of every table a log names, asked once per table. */
export function sendLogSight(meta: MetaDb, set: PermissionSet): (connectionId: string | null, tableId: string | null) => Promise<PersonSight> {
  const held = new Map<string, Promise<PersonSight>>();
  return (connectionId, tableId) => {
    if (connectionId === null || tableId === null) return Promise.resolve(ALL);
    const key = `${connectionId}\u0000${tableId}`;
    let sight = held.get(key);
    if (sight === undefined) held.set(key, (sight = personSightOf(meta, set, connectionId, tableId)));
    return sight;
  };
}
