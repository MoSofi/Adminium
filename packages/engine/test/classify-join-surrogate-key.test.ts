// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { classifyTableColumns, detectJoinTable, inferJoinTableRelations, parseDatabaseModel } from '../src/index.js';

/**
 * A link table with its own surrogate key.
 *
 * `clinician_visit_types(id, clinician_id, visit_type_id)` says nothing but
 * "this clinician does this visit type". Its composite-key booster never fires
 * (the key is `id`), and an app install's table prefix hides the composed-name
 * booster (`clinic_clinician_visit_types` does not contain
 * `clinic_visit_type`), so it stayed an entity at 0.7 and no many-to-many
 * relation was ever made for a form's chips to write through. Nothing but the
 * pair and its own one-column key is the signal that holds.
 */

const fk = (name: string, table: string) => ({ name, logicalType: 'integer', nullable: false, references: { tableId: `main.${table}`, column: 'id' } });
const id = { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false };
const entity = (name: string) => ({ schema: 'main', name, columns: [id, { name: 'name', logicalType: 'varchar', maxLength: 80 }], primaryKey: ['id'] });

const model = parseDatabaseModel({
  irVersion: 1,
  dialect: 'sqlite',
  name: 'clinic',
  tables: [
    entity('clinic_clinicians'),
    entity('clinic_visit_types'),
    // Prefixed, a surrogate key, nothing else.
    { schema: 'main', name: 'clinic_clinician_visit_types', columns: [id, fk('clinician_id', 'clinic_clinicians'), fk('visit_type_id', 'clinic_visit_types')], primaryKey: ['id'] },
    // The same pair, with a data column of its own: a record, not a link.
    {
      schema: 'main',
      name: 'clinic_referrals',
      columns: [id, fk('clinician_id', 'clinic_clinicians'), fk('visit_type_id', 'clinic_visit_types'), { name: 'note', logicalType: 'text' }],
      primaryKey: ['id'],
    },
  ],
  relations: [],
});

const tableNamed = (name: string) => model.tables.find((t) => t.name === name)!;
const detect = (name: string) => detectJoinTable(tableNamed(name), classifyTableColumns(model, tableNamed(name)));

describe('a link table with its own surrogate key', () => {
  it('is a join table, whatever prefix its name carries', () => {
    const result = detect('clinic_clinician_visit_types');
    expect(result.isJoin).toBe(true);
    expect(result.confidence).toBeCloseTo(0.8, 5);
    expect(result.fkColumns.sort()).toEqual(['clinician_id', 'visit_type_id']);
    expect(result.reasons).toContain('nothing but the FK pair and its own surrogate key (+0.1)');
  });

  it('gets its many-to-many relation, through it, from one side to the other', () => {
    const [relation, ...rest] = inferJoinTableRelations(model).map((r) => r.relation);
    expect(rest).toEqual([]);
    expect(relation).toMatchObject({
      cardinality: 'many-to-many',
      from: { tableId: 'main.clinic_clinicians', columns: ['id'] },
      to: { tableId: 'main.clinic_visit_types', columns: ['id'] },
      through: { tableId: 'main.clinic_clinician_visit_types', fromColumns: ['clinician_id'], toColumns: ['visit_type_id'] },
    });
    expect(relation!.confidence).toBeCloseTo(0.8, 5);
  });

  it('is not given to a table that keeps a value of its own', () => {
    expect(detect('clinic_referrals').isJoin).toBe(false);
  });
});
