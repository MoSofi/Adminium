// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The desk's price check and retry key: what a staff form's save is held to
 * when it sends the price it showed (`expect`) or a key to find its own
 * earlier save by (`clientKey`) — the same two things a guest's create and
 * change carry, over the same columns.
 *
 * WHICH COLUMN. The app names the figure a price check compares (`expect`)
 * and the column a retry key is kept in (`clientKey`) on its public entries
 * of the table; the desk's save uses the same ones. A price check may name
 * another money column the caller can read (`expect.column`).
 *
 * A RETRY KEY is kept as the guest's is: a keyed hash, never as sent — and
 * per person as well as per connection and table, so one desk's key never
 * finds another's booking, and a guest's never finds a desk's.
 */
import { publicEndpointsRepo, type MetaDb } from '@adminium/meta';
import { ratioText, sameDecimal, toRatio } from '@adminium/manifest';

import { ConflictError, ValidationFailedError } from '../../errors.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import type { Row } from '../../crud/mask.js';
import { definitionToResource, parseDefinition } from '../../public-api/endpoint.js';
import { CLIENT_KEY_FORMAT, clientKeyHash, placesOfColumn } from '../public/tree.js';

/** The columns the app's public entries of a table name for a price check and a retry key. */
export interface DeclaredColumns {
  /** The figure a create or a change checks against the price shown, or null. */
  expect: string | null;
  /** The unique text column a create keeps its retry key in, or null. */
  clientKey: string | null;
}

const tableIdOf = (view: SnapshotView, name: string): string | null => {
  try {
    return view.table(name).id;
  } catch {
    return null;
  }
};

/** What the connection's public entries of `table` declare: the first price-checked column and the first retry-key column. */
export async function declaredColumns(meta: MetaDb, connectionId: string, view: SnapshotView, table: ResolvedTable): Promise<DeclaredColumns> {
  let expect: string | null = null;
  let clientKey: string | null = null;
  for (const row of await publicEndpointsRepo(meta).listByConnection(connectionId)) {
    const parsed = parseDefinition(row.definition);
    if (!parsed.ok || tableIdOf(view, parsed.definition.source) !== table.id) continue;
    const resource = definitionToResource(row.ref, parsed.definition, parsed.definition.methods, table);
    const creates = parsed.definition.methods.includes('POST');
    const changes = parsed.definition.methods.includes('PATCH') || parsed.definition.methods.includes('PUT');
    if (expect === null && (creates || changes) && typeof resource.expect === 'string' && table.columns.has(resource.expect)) expect = resource.expect;
    if (clientKey === null && creates && typeof resource.clientKey === 'string' && table.columns.has(resource.clientKey)) clientKey = resource.clientKey;
  }
  return { expect, clientKey };
}

const NUMBER_TYPES: ReadonlySet<string> = new Set(['integer', 'bigint', 'decimal', 'float']);

/**
 * The column a desk's price check compares: the one it names, else the one
 * the app's entries check. Refused (422) when there is none or it holds no
 * number; `readable` refuses (403) a column the caller may not read — a
 * price they may not see is not theirs to check.
 */
export function expectColumnOf(
  table: ResolvedTable,
  declared: DeclaredColumns,
  named: string | undefined,
  readable: (column: string) => void,
): string {
  const column = named ?? declared.expect;
  if (column === null) {
    throw new ValidationFailedError('This table names no figure a price is checked against: name the column (expect.column).', { fields: { expect: { code: 'not-allowed' } } });
  }
  readable(column);
  const found = table.columns.get(column);
  if (found === undefined || !NUMBER_TYPES.has(found.logicalType)) {
    throw new ValidationFailedError(`${column} holds no price to check.`, { fields: { expect: { code: 'not-allowed' } }, column });
  }
  return column;
}

/**
 * The save's own check of the price the desk showed, on the row as the save
 * leaves it (its totals settled), inside its transaction: a different figure
 * refuses the save — 409 `PRICE_CHANGED` with the figure it would have
 * saved — and nothing is kept.
 */
export function priceCheck(view: SnapshotView, table: ResolvedTable, column: string, expected: string): (row: Row) => void {
  const places = placesOfColumn(view, table, column);
  return (row) => {
    if (sameDecimal(row[column], expected, places)) return;
    const total = toRatio(row[column]);
    throw new ConflictError('The price changed. Nothing was saved.', 'PRICE_CHANGED', { column, total: total === null ? null : ratioText(total, places) });
  };
}

/**
 * What a desk's retry key is kept as in the table's retry-key column: the
 * guest's keyed hash, over the person's id as well. Refused (422) when the
 * table keeps no retry key, or the key is not one a client mints.
 */
export function staffRetryKey(secret: Buffer | null, declared: DeclaredColumns, connectionId: string, table: ResolvedTable, userId: string | null, key: string): { column: string; hash: string } {
  if (declared.clientKey === null || secret === null) {
    throw new ValidationFailedError('This table keeps no retry key.', { fields: { clientKey: { code: 'not-allowed' } } });
  }
  if (!CLIENT_KEY_FORMAT.test(key)) throw new ValidationFailedError('A retry key is 22 to 64 letters, digits, - or _.', { fields: { clientKey: { code: 'format' } } });
  return { column: declared.clientKey, hash: clientKeyHash(secret, connectionId, table.id, JSON.stringify(['staff', userId ?? '', key])) };
}
