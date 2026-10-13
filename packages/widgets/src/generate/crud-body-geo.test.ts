// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A place and an area on a generated records page.
 *
 * Both are kept as JSON (TEXT on SQLite), and a generated page left every JSON
 * column out: no cell in the list, and — the form and the record being built
 * from the same specs — no field either. The column's RULE says what it holds;
 * a JSON column with no rule stays out, as before.
 */
import { describe, expect, it } from 'vitest';

import { gridColumnSpecSchema } from '../page-config/grid-column-spec.js';
import type { CandidateColumn, CandidateTable, ClassifiedTableInput } from '../registry/candidates.js';
import { buildColumnDef, composeCrudBody } from './crud-body.js';

interface Spec {
  name: string;
  logicalType: string;
  semantic: string;
  place?: true;
  area?: true;
  secret?: boolean;
  pk?: boolean;
}

function build(specs: Spec[]): { table: CandidateTable; classified: ClassifiedTableInput } {
  const columns: CandidateColumn[] = specs.map((spec, index) => ({
    name: spec.name,
    ordinal: index + 1,
    logicalType: spec.logicalType,
    nullable: spec.pk !== true,
    isPrimaryKey: spec.pk ?? false,
    defaultKind: spec.pk === true ? 'autoincrement' : null,
    references: null,
    ...(spec.place === true ? { place: true as const } : {}),
    ...(spec.area === true ? { area: true as const } : {}),
  }));
  return {
    table: { id: 'public.sites', schema: 'public', name: 'sites', kind: 'table', primaryKey: ['id'], columns },
    classified: {
      tableId: 'public.sites',
      shape: 'generic',
      role: 'entity',
      displayColumn: 'name',
      columns: specs.map((spec) => ({ column: spec.name, semantic: spec.semantic, format: null, secret: spec.secret ?? false, maskedByDefault: false })),
    },
  };
}

const CTX = { readOnly: false, includedTableIds: new Set<string>(), relations: [] };
const ID: Spec = { name: 'id', logicalType: 'integer', semantic: 'pk-id', pk: true };
const NAME: Spec = { name: 'name', logicalType: 'varchar', semantic: 'plain' };

/** The page's specs by name, as the grid and the form read them. */
function specsOf(specs: Spec[]) {
  const { table, classified } = build(specs);
  const columns = composeCrudBody(table, classified, CTX).columns.map((column) => gridColumnSpecSchema.parse(column));
  return { columns, shown: columns.filter((column) => !column.hidden).map((column) => column.name), by: new Map(columns.map((column) => [column.name, column])) };
}

describe.each([
  ['json (Postgres, MySQL)', 'json', 'json-config'],
  // SQLite has no JSON type: an install makes the column TEXT, and a name can tag it as anything.
  ['text (SQLite)', 'text', 'geo-region'],
])('a place and an area kept as %s', (_engine, logicalType, semantic) => {
  const sites = (): Spec[] => [ID, NAME, { name: 'region', logicalType, semantic, place: true }, { name: 'zone', logicalType, semantic: logicalType === 'json' ? 'json-config' : 'plain', area: true }, { name: 'notes', logicalType: 'json', semantic: 'json-config' }];

  it('lists the place straight after the display column, and gives it its spec', () => {
    const { shown, by } = specsOf(sites());
    expect(shown).toEqual(['name', 'region']);
    // One spec on every engine: JSON, whatever keeps it; never sorted by.
    expect(by.get('region')).toMatchObject({ logicalType: 'json', semantic: 'json-config', sortable: false, hidden: false });
  });

  it('keeps the area out of the list and in the form: a hidden spec', () => {
    const { shown, by } = specsOf(sites());
    expect(shown).not.toContain('zone');
    expect(by.get('zone')).toMatchObject({ logicalType: 'json', semantic: 'json-config', sortable: false, hidden: true });
  });

  it('leaves a json column with no rule out, as before', () => {
    expect(specsOf(sites()).by.has('notes')).toBe(false);
  });
});

describe('a place among many columns', () => {
  it('is never dropped by the cap of eight', () => {
    const many: Spec[] = [ID, NAME, ...Array.from({ length: 12 }, (_, at): Spec => ({ name: `state_${String(at)}`, logicalType: 'varchar', semantic: 'status-workflow' })), { name: 'spot', logicalType: 'json', semantic: 'json-config', place: true }];
    const { shown } = specsOf(many);
    expect(shown).toHaveLength(8);
    expect(shown.slice(0, 2)).toEqual(['name', 'spot']);
  });

  it('is on no list and no form when it is a secret', () => {
    const { by } = specsOf([ID, NAME, { name: 'spot', logicalType: 'json', semantic: 'secret', place: true, secret: true }, { name: 'zone', logicalType: 'json', semantic: 'secret', area: true, secret: true }]);
    expect(by.has('spot')).toBe(false);
    expect(by.has('zone')).toBe(false);
  });
});

describe('a table with no place and no area', () => {
  it('builds each spec exactly as it did', () => {
    const { table, classified } = build([ID, NAME, { name: 'region', logicalType: 'text', semantic: 'geo-region' }]);
    const column = table.columns.find((one) => one.name === 'region')!;
    expect(buildColumnDef(column, classified.columns.find((one) => one.column === 'region')!)).toEqual({ name: 'region', label: 'Region', logicalType: 'text', semantic: 'geo-region', sortable: true });
  });
});
