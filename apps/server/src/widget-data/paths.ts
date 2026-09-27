// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Filter and window columns one link away — `order_id.status` on an order's
 * lines: the status of the order each line belongs to.
 *
 * Resolved with the lookup resolver (`crud/lookups.ts`): the same grammar,
 * the same foreign keys (declared, accepted and inferred), the same read
 * checks — the reader must be able to read the table the key points at, and
 * a masked column (or a masked key) reads only for a reader who sees that
 * table's personal columns. Where a lookup that fails a check degrades to an
 * empty cell, a filter cannot: a filter quietly dropped would count rows the
 * page means to leave out. So a refused path refuses the widget — 403
 * `TABLE_FORBIDDEN` for the table, 403 `COLUMN_FORBIDDEN` for a masked column.
 *
 * One link only: a deeper path is refused (422) rather than followed.
 */
import type { QueryDescriptor } from '@adminium/engine/config';

import { ForbiddenError, ValidationFailedError } from '../errors.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { resolveLookups } from '../crud/lookups.js';
import { piiAllows, type PiiAccess } from '../crud/mask.js';
import type { ResolvedPath } from './compiler.js';

/** The filter and window columns of a descriptor that reach another table. */
export function pathColumnsOf(descriptor: QueryDescriptor, table: ResolvedTable): string[] {
  const names = [...(descriptor.filters ?? []).map((filter) => filter.column), ...(descriptor.window === undefined ? [] : [descriptor.window.column])];
  return [...new Set(names.filter((name) => name.includes('.') && !table.columns.has(name)))];
}

export async function resolvePaths(input: {
  view: SnapshotView;
  table: ResolvedTable;
  descriptor: QueryDescriptor;
  connectionId: string;
  /** Asked of each table a masked column lives in. */
  canReadPii: PiiAccess;
  canReadTable: (tableId: string) => Promise<boolean>;
}): Promise<Map<string, ResolvedPath>> {
  const { view, table } = input;
  const paths = new Map<string, ResolvedPath>();
  for (const name of pathColumnsOf(input.descriptor, table)) {
    const parts = name.split('.');
    if (parts.length !== 2 || parts.some((part) => part === '')) {
      throw new ValidationFailedError(`A filter reaches one link away, as "keyColumn.column": "${name}" does not.`, { column: name });
    }
    // An alias no column of the table has: the resolver refuses one that shadows a column.
    let alias = 'filter_path';
    while (table.columns.has(alias)) alias = `${alias}_`;
    const [lookup] = await resolveLookups({
      view,
      table,
      raw: [`${alias}:${name}`],
      canReadPii: input.canReadPii,
      canReadTable: input.canReadTable,
    });
    const hop = lookup?.hops[0];
    if (lookup === undefined || hop === undefined) {
      throw new ValidationFailedError(`"${name}" does not reach another table.`, { column: name });
    }
    if (lookup.refused) {
      if (!(await input.canReadTable(hop.refTable.id))) {
        const permission = `table:${input.connectionId}:${hop.refTable.id}:read`;
        throw new ForbiddenError('You do not have access to this table.', 'TABLE_FORBIDDEN', { permission });
      }
      const masked = view.column(table, hop.fkColumn).masked ? { table: table.id, column: hop.fkColumn } : { table: hop.refTable.id, column: lookup.target.name };
      throw new ForbiddenError(`Column ${JSON.stringify(masked.column)} is masked for your role.`, 'COLUMN_FORBIDDEN', masked);
    }
    paths.set(name, {
      fkColumn: view.column(table, hop.fkColumn),
      parent: hop.refTable,
      parentKey: hop.refColumn,
      column: lookup.target,
      unmasked: await piiAllows(input.canReadPii, hop.refTable.id),
    });
  }
  return paths;
}
