// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LINK INTO AN ADD-ON'S TABLE BESIDE A KEY THE SERVER ONLY GUESSED.
 *
 * The server reads links between tables from columns' names: an order line's
 * `design_id`, beside a `customiser_designs` table, reads as a link into it.
 * That guess is no foreign key, and never stops the column linking into the
 * add-on's table. A key the database keeps, or one a person or an app
 * declared, still does: a column is never both.
 */
import { parseDatabaseModel, type RelationKind } from '@adminium/engine';
import { describe, expect, it } from 'vitest';

import { columnRuleIssue } from '../src/connections/column-rules-validation.js';

const int = (name: string, nullable = false) => ({ name, logicalType: 'integer', nullable });
const table = (name: string, columns: object[]) => ({ schema: 'public', name, primaryKey: ['id'], columns: [int('id'), ...columns] });
const LINK = { addOn: 'customiser', table: 'designs' };

/** A shop's order lines and the add-on's designs, with `design_id` linked by one relation of this kind. */
function shop(kind: RelationKind) {
  const model = parseDatabaseModel({
    dialect: 'postgres',
    name: 'shop',
    defaultSchema: 'public',
    schemas: ['public'],
    tables: [table('printing_order_lines', [int('design_id', true)]), table('customiser_designs', [])],
    relations: [
      {
        id: `${kind}:design_id`,
        kind,
        cardinality: 'one-to-many',
        from: { tableId: 'public.printing_order_lines', columns: ['design_id'] },
        to: { tableId: 'public.customiser_designs', columns: ['id'] },
        confidence: kind.startsWith('inferred') ? 0.8 : 1,
      },
    ],
  });
  const column = model.tables[0]!.columns.find((c) => c.name === 'design_id')!;
  return { model, column };
}

describe("a link into an add-on's table beside a guessed key", () => {
  it('is kept where the server only guessed a link from the name', () => {
    const { model, column } = shop('inferred-name');
    expect(columnRuleIssue('column.addOnLink', LINK, column, model)).toBeNull();
  });

  it.each(['declared-fk', 'manifest', 'override'] as const)('is refused where the column is a real foreign key (%s)', (kind) => {
    const { model, column } = shop(kind);
    expect(columnRuleIssue('column.addOnLink', LINK, column, model)).toMatch(/is a foreign key already/);
  });
});
