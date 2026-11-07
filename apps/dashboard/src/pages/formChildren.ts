// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The tables a line-items field draws from, keyed by relation: the page
 * REPLY's shape projected onto the template's. Shared by the crud and record
 * bindings, whose edit dialogs draw the same form for the same row.
 */
import { withFactChoices, type ColumnFacts, type GridColumnSpec, type PageCrudProps } from '@adminium/widgets';

import type { FormChildFactReply } from '../api/pages.js';
import { parseColumns } from './columnSpecs.js';

/** Absent when the table holds no list of another's rows. */
export function childFactsOf(
  formChildren: readonly FormChildFactReply[] | undefined,
  columns: readonly GridColumnSpec[],
  pageId: string,
): PageCrudProps['childFacts'] {
  if (formChildren === undefined || formChildren.length === 0) return undefined;
  return Object.fromEntries(
    formChildren.map((child) => [
      child.relationId,
      {
        label: child.label,
        table: child.childTable,
        foreignColumn: child.foreignColumn,
        // The parent column the child points at is its own key: the server
        // refuses a relation that points anywhere else.
        parentKeyColumn: primaryKeyOf(columns)[0] ?? 'id',
        primaryKey: primaryKeyOf(child.columns.map((column) => column.spec)),
        ...childColumnsOf(child, pageId),
      },
    ]),
  );
}

/**
 * A line-items table's columns and what the server says of each — its choice
 * columns' words and tones included, so a line's status reads in the person's
 * language in the repeater as it does in the grid.
 */
function childColumnsOf(child: FormChildFactReply, pageId: string): { columns: readonly GridColumnSpec[]; facts: ColumnFacts } {
  const facts: ColumnFacts = Object.fromEntries(
    child.columns.map((column) => [
      String(column.spec['name'] ?? ''),
      {
        filledBy: column.filledBy,
        required: column.required,
        ...(column.requiredWhen === undefined ? {} : { requiredWhen: column.requiredWhen }),
        ...(column.mentions === true ? { mentions: true as const } : {}),
        writable: column.writable,
        ...(column.insertable === undefined ? {} : { insertable: column.insertable }),
        ...(column.updatable === undefined ? {} : { updatable: column.updatable }),
        ...(column.options === undefined ? {} : { options: column.options }),
        ...(column.enumLabels === undefined ? {} : { enumLabels: column.enumLabels }),
        ...(column.enumTones === undefined ? {} : { enumTones: column.enumTones }),
      },
    ]),
  );
  const columns = parseColumns({ columns: child.columns.map((column) => column.spec) }, pageId);
  return { columns: withFactChoices(columns, facts), facts };
}

/** The key columns of a spec list, in order. */
function primaryKeyOf(specs: readonly (GridColumnSpec | Record<string, unknown>)[]): string[] {
  return specs
    .filter((spec) => (spec as Record<string, unknown>)['primaryKey'] === true)
    .map((spec) => String((spec as Record<string, unknown>)['name']));
}
