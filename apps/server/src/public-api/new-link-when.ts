// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Send it again" through a row's own link: another link of the row (the one
 * a confirmation email carries) is made again only while the row holds what
 * the entry names (`newLink.when`, an order still waiting to be confirmed).
 *
 * Judged twice: on the row as read, for the answer, and again in the renewal's
 * own UPDATE, so a row that moved on between the two (the buyer confirmed a
 * moment ago) gets no new code and no email.
 */
import type { StateCondition } from '@adminium/manifest';

import type { RecordFilter } from '../crud/filters.js';
import type { ResolvedTable } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { holds } from '../crud/state-conditions.js';

/** Whether the row holds every condition (none: always). */
export function newLinkWhenHolds(where: readonly StateCondition[] | undefined, row: Row): boolean {
  return (where ?? []).every((condition) => holds(condition, row));
}

/**
 * The same conditions as a filter for the renewal's WHERE, or null for none.
 * An empty text counts as empty, as `holds` reads it.
 */
export function newLinkWhenFilter(where: readonly StateCondition[] | undefined, table: ResolvedTable): RecordFilter | null {
  if (where === undefined || where.length === 0) return null;
  const text = (column: string) => ['text', 'varchar'].includes(table.columns.get(column)?.logicalType ?? '');
  const parts: RecordFilter[] = where.map((c): RecordFilter => {
    if (c.isNull === true) return text(c.column) ? { or: [{ column: c.column, op: 'is_null' }, { column: c.column, op: 'eq', value: '' }] } : { column: c.column, op: 'is_null' };
    if (c.isNull === false) return text(c.column) ? { and: [{ column: c.column, op: 'not_null' }, { column: c.column, op: 'neq', value: '' }] } : { column: c.column, op: 'not_null' };
    if (c.eq !== undefined) return { column: c.column, op: 'eq', value: c.eq };
    if (c.in !== undefined) return { column: c.column, op: 'in', value: [...c.in] };
    if (c.gt !== undefined) return { column: c.column, op: 'gt', value: c.gt };
    if (c.gte !== undefined) return { column: c.column, op: 'gte', value: c.gte };
    if (c.lt !== undefined) return { column: c.column, op: 'lt', value: c.lt };
    return { column: c.column, op: 'lte', value: c.lte };
  });
  return parts.length === 1 ? parts[0]! : { and: parts };
}
