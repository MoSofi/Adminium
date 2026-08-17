// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { SEGMENTED_MAX_ARITY, coerceFieldValue, fieldKindFor, fieldTypeTag, formColumns, isRequired } from './field-mapping.js';
import { gridColumnSpecSchema } from '../../families/tables/column-spec.js';
import type { GridColumnSpecInput } from '../../families/tables/column-spec.js';

const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

describe('fieldKindFor — generated form mapping (09 §7.1)', () => {
  it('pk with default and server-managed timestamps are hidden', () => {
    expect(fieldKindFor(spec({ name: 'id', label: 'ID', primaryKey: true, hasDefault: true }))).toBe('hidden');
    expect(fieldKindFor(spec({ name: 'created_at', label: 'Created', logicalType: 'timestamptz', semantic: 'created-at' }))).toBe('hidden');
    expect(fieldKindFor(spec({ name: 'updated_at', label: 'Updated', logicalType: 'timestamptz', semantic: 'updated-at' }))).toBe('hidden');
  });

  it('read-only columns render as readonly, natural pks stay editable', () => {
    expect(fieldKindFor(spec({ name: 'slug', label: 'Slug', readOnly: true }))).toBe('readonly');
    expect(fieldKindFor(spec({ name: 'code', label: 'Code', primaryKey: true, hasDefault: false, nullable: false }))).toBe('text');
  });

  it('FK → combobox', () => {
    expect(
      fieldKindFor(spec({ name: 'owner_id', label: 'Owner', logicalType: 'integer', fk: { table: 'public.team_members', column: 'id' } })),
    ).toBe('fk');
  });

  describe('enum arity rule (comp: SegmentedControl for small required enums)', () => {
    const enumSpec = (count: number, nullable: boolean) =>
      spec({
        name: 'status',
        label: 'Status',
        logicalType: 'enum',
        enumValues: Array.from({ length: count }, (_, i) => `v${String(i)}`),
        nullable,
      });

    it(`arity ≤ ${String(SEGMENTED_MAX_ARITY)} and required → segmented`, () => {
      expect(fieldKindFor(enumSpec(2, false))).toBe('segmented');
      expect(fieldKindFor(enumSpec(SEGMENTED_MAX_ARITY, false))).toBe('segmented');
    });
    it('larger arity → select', () => {
      expect(fieldKindFor(enumSpec(SEGMENTED_MAX_ARITY + 1, false))).toBe('select');
    });
    it('nullable enums always select (need the empty option)', () => {
      expect(fieldKindFor(enumSpec(2, true))).toBe('select');
    });
  });

  it('logicalType dispatch: boolean/number/date/time/datetime/json', () => {
    expect(fieldKindFor(spec({ name: 'ok', label: 'OK', logicalType: 'boolean' }))).toBe('checkbox');
    expect(fieldKindFor(spec({ name: 'seats', label: 'Seats', logicalType: 'integer' }))).toBe('number');
    expect(fieldKindFor(spec({ name: 'mrr', label: 'MRR', logicalType: 'decimal', semantic: 'money' }))).toBe('number');
    expect(fieldKindFor(spec({ name: 'day', label: 'Day', logicalType: 'date' }))).toBe('date');
    expect(fieldKindFor(spec({ name: 'at', label: 'At', logicalType: 'time' }))).toBe('time');
    expect(fieldKindFor(spec({ name: 'when', label: 'When', logicalType: 'timestamptz' }))).toBe('datetime');
    expect(fieldKindFor(spec({ name: 'meta', label: 'Meta', logicalType: 'json' }))).toBe('json');
  });

  it('semantics dispatch: email/url/free-text; unbounded text → textarea', () => {
    expect(fieldKindFor(spec({ name: 'email', label: 'Email', logicalType: 'varchar', semantic: 'email' }))).toBe('email');
    expect(fieldKindFor(spec({ name: 'site', label: 'Site', logicalType: 'varchar', semantic: 'url' }))).toBe('url');
    expect(fieldKindFor(spec({ name: 'bio', label: 'Bio', logicalType: 'text', semantic: 'free-text' }))).toBe('textarea');
    expect(fieldKindFor(spec({ name: 'notes', label: 'Notes', logicalType: 'text' }))).toBe('textarea');
    expect(fieldKindFor(spec({ name: 'name', label: 'Name', logicalType: 'varchar', maxLength: 120 }))).toBe('text');
  });
});

describe('form helpers', () => {
  it('formColumns drops hidden fields, keeps order', () => {
    const columns = [
      spec({ name: 'id', label: 'ID', primaryKey: true, hasDefault: true }),
      spec({ name: 'name', label: 'Name', logicalType: 'varchar' }),
      spec({ name: 'created_at', label: 'Created', semantic: 'created-at', logicalType: 'timestamptz' }),
    ];
    expect(formColumns(columns).map((c) => c.name)).toEqual(['name']);
  });

  it('isRequired: NOT NULL without default', () => {
    expect(isRequired(spec({ name: 'name', label: 'Name', nullable: false }))).toBe(true);
    expect(isRequired(spec({ name: 'name', label: 'Name', nullable: false, hasDefault: true }))).toBe(false);
    expect(isRequired(spec({ name: 'name', label: 'Name', nullable: true }))).toBe(false);
  });

  it('fieldTypeTag explains the generation (varchar / enum / → table)', () => {
    expect(fieldTypeTag(spec({ name: 'n', label: 'N', logicalType: 'varchar' }))).toBe('varchar');
    expect(fieldTypeTag(spec({ name: 's', label: 'S', logicalType: 'enum', enumValues: ['a'] }))).toBe('enum');
    expect(fieldTypeTag(spec({ name: 'o', label: 'O', fk: { table: 'public.team_members', column: 'id' } }))).toBe(
      '→ public.team_members',
    );
  });

  it('coerceFieldValue: numbers, booleans, JSON, nullable empties', () => {
    const seats = spec({ name: 'seats', label: 'Seats', logicalType: 'integer' });
    expect(coerceFieldValue(seats, '42')).toBe(42);
    const flag = spec({ name: 'ok', label: 'OK', logicalType: 'boolean' });
    expect(coerceFieldValue(flag, true)).toBe(true);
    const meta = spec({ name: 'meta', label: 'Meta', logicalType: 'json' });
    expect(coerceFieldValue(meta, '{"a":1}')).toEqual({ a: 1 });
    const note = spec({ name: 'note', label: 'Note', nullable: true });
    expect(coerceFieldValue(note, '')).toBeNull();
  });
});
