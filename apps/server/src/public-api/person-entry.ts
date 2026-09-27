// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An entry that finds its person by the address a guest types
 * (`find_or_create`): which table the person is kept in and by which column,
 * the columns a new person is filled with, and — for a guest already signed
 * in — the person's own address and details put in place of what was typed.
 *
 * The person table is the one the key's sign-in-by-link identity claims. On a
 * create it is on the same key; on a change through a row's own link (a
 * ticket accepted by a friend) it is on the app's customer key, so it is read
 * from the endpoint the entry names.
 */
import { publicEndpointsRepo, type MetaDb } from '@adminium/meta';

import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { parseDefinition, sourceTable } from './endpoint.js';
import type { CompiledResource, CompiledScope } from './scope.js';

export type FindOrCreate = NonNullable<CompiledResource['findOrCreate']>;

/** The person table, and its address column. */
export interface PersonTable {
  table: ResolvedTable;
  email: string;
}

/** The table people found by address are kept in, or null when the named identity is not a sign-in by link. */
export async function personTableOf(meta: MetaDb, view: SnapshotView, scope: CompiledScope, connectionId: string, identityRef: string): Promise<PersonTable | null> {
  const claim = scope.claim;
  const here = scope.byRef.get(identityRef);
  if (claim?.ref === identityRef && claim.strategy === 'email-link' && claim.email !== undefined && here !== undefined) {
    const table = sourceTable(view, here.table);
    return table === null ? null : { table, email: claim.email };
  }
  const stored = await publicEndpointsRepo(meta).findByRef(connectionId, identityRef);
  if (stored === null) return null;
  const parsed = parseDefinition(stored.definition);
  if (!parsed.ok) return null;
  const identity = parsed.definition.identity;
  if (identity?.strategy !== 'email-link' || identity.email === undefined) return null;
  const table = sourceTable(view, parsed.definition.source);
  return table === null ? null : { table, email: identity.email };
}

const filled = (value: unknown): boolean => value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '');

/** The columns a new person is filled with, from the entry's values (an empty one fills nothing). */
export function fillOf(finder: FindOrCreate, values: Readonly<Row>): Row {
  const out: Row = {};
  for (const [target, source] of Object.entries(finder.fill)) if (filled(values[source])) out[target] = values[source];
  return out;
}

/** The entry's own column a refusal of the person table's column is told by. */
export function entryColumnOf(finder: FindOrCreate, person: PersonTable, column: string): string {
  if (column === person.email) return finder.email;
  return finder.fill[column] ?? finder.email;
}

/**
 * A signed-in guest's create: the row carries the person's own address (so
 * its emails carry its link to the address the account keeps), and each
 * detail the entry fills a new person with and the guest left empty is the
 * person's own.
 */
export function signedInValues(finder: FindOrCreate, person: PersonTable, values: Row, row: Row): void {
  const address = row[person.email];
  if (typeof address === 'string' && address.trim() !== '') values[finder.email] = address;
  for (const [target, source] of Object.entries(finder.fill)) {
    if (!filled(values[source]) && filled(row[target])) values[source] = row[target];
  }
}
