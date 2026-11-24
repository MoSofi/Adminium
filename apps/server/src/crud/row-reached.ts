// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One row, as the person asking reaches it: read by its key with their row
 * limits, and `undefined` for a row they do not reach, exactly as for a row
 * that is not there. A record panel's code and a carrier quote are served on
 * this one check, so neither can come to differ from the other.
 */
import type { MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { PermissionSet } from '../rbac/resolver.js';
import { factsViewFor } from '../routes/pages/column-facts.js';
import type { ResolvedTable } from './identifiers.js';
import type { Row } from './mask.js';
import { fetchByPk, parseRecordId } from './records.js';
import { rowLimitContextOf } from './row-limit-context.js';
import { fetchVisible } from './row-limit.js';

export interface RowReachDeps {
  meta: MetaDb;
  data(connectionId: string): Promise<{ db: Kysely<SourceDatabase> }>;
  resolve(request: FastifyRequest): Promise<PermissionSet>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a parsed key can name a row at all. An id of the wrong shape is a
 * row that is not there: bound as it is, Postgres would answer with a type
 * error, and the caller would see a server fault.
 */
function keyFits(table: ResolvedTable, pk: Row): boolean {
  return Object.entries(pk).every(([name, value]) => {
    const type = table.columns.get(name)?.logicalType;
    if (type === 'integer' || type === 'bigint') return typeof value === 'number' ? Number.isSafeInteger(value) : typeof value === 'bigint';
    if (type === 'uuid') return typeof value === 'string' && UUID.test(value);
    return true;
  });
}

/** The row, when this person reaches it. */
export async function readReachedRow(deps: RowReachDeps, request: FastifyRequest, connectionId: string, tableId: string, row: string): Promise<Row | undefined> {
  const view = await factsViewFor(deps.meta, connectionId);
  if (view === null) return undefined;
  const table = view.table(tableId);
  const pk = parseRecordId(table, row);
  if (!keyFits(table, pk)) return undefined;
  const rows = await rowLimitContextOf(deps.meta, await deps.resolve(request), connectionId, view.model);
  const { db } = await deps.data(connectionId);
  return rows === null ? fetchByPk(db, table, pk) : fetchVisible(rows, db, table, pk, 'read');
}
