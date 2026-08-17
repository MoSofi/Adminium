// SPDX-License-Identifier: AGPL-3.0-only
import type { GridColumnSpec } from '../../families/tables/column-spec.js';

/**
 * Column spec → generated form-field kind (09 §7.1: FormField + Input/
 * Select/Checkbox/DateInput by logicalType + semantics; enums → Select or
 * SegmentedControl by arity per the CRUD Admin comp; FK → async Combobox).
 * Pure so the mapping rules are unit-testable.
 */

export type FieldKind =
  | 'hidden' // pk with default / server-managed timestamps — never in forms
  | 'readonly' // shown on edit, never editable
  | 'text'
  | 'textarea'
  | 'number'
  | 'checkbox'
  | 'date'
  | 'time'
  | 'datetime'
  | 'segmented' // enum, arity ≤ SEGMENTED_MAX_ARITY
  | 'select' // enum, larger arity (or nullable enums needing an empty choice)
  | 'fk' // async avatar combobox
  | 'email'
  | 'url'
  | 'json';

/** Enum arity at or below which the form renders a SegmentedControl (comp rule). */
export const SEGMENTED_MAX_ARITY = 4;

const SERVER_MANAGED_SEMANTICS = new Set(['created-at', 'updated-at']);

export function fieldKindFor(column: GridColumnSpec): FieldKind {
  // Server-managed columns never render as inputs (09 §7.1 form keeper).
  if (column.primaryKey && column.hasDefault) return 'hidden';
  if (column.semantic !== null && SERVER_MANAGED_SEMANTICS.has(column.semantic)) return 'hidden';
  if (column.readOnly) return 'readonly';

  if (column.fk !== undefined) return 'fk';

  if (column.logicalType === 'enum' || (column.enumValues !== undefined && column.enumValues.length > 0)) {
    const arity = column.enumValues?.length ?? 0;
    // Small required enums read best as a segmented tray (CRUD Admin comp);
    // nullable enums need the empty option a Select provides.
    return arity > 0 && arity <= SEGMENTED_MAX_ARITY && !column.nullable ? 'segmented' : 'select';
  }

  if (column.logicalType === 'boolean') return 'checkbox';

  switch (column.logicalType) {
    case 'integer':
    case 'bigint':
    case 'decimal':
    case 'float':
      return 'number';
    case 'date':
      return 'date';
    case 'time':
      return 'time';
    case 'timestamp':
    case 'timestamptz':
      return 'datetime';
    case 'json':
      return 'json';
    default:
      break;
  }

  if (column.semantic === 'email') return 'email';
  if (column.semantic === 'url' || column.semantic === 'image-url') return 'url';
  if (column.semantic === 'free-text') return 'textarea';
  // Unbounded text → textarea, but natural (editable) pks and unique keys
  // are identifiers — single-line inputs regardless of the unbounded type.
  if (column.logicalType === 'text' && column.maxLength === null && !column.primaryKey && !column.unique) {
    return 'textarea';
  }

  return 'text';
}

/** Columns that appear in the generated create/edit form, in spec order. */
export function formColumns(columns: readonly GridColumnSpec[]): GridColumnSpec[] {
  return columns.filter((column) => {
    const kind = fieldKindFor(column);
    return kind !== 'hidden';
  });
}

/** A column is required when NOT NULL and without a DB default (09 §7.1). */
export function isRequired(column: GridColumnSpec): boolean {
  return !column.nullable && !column.hasDefault && !column.readOnly;
}

/** Mono type tag next to the label (`varchar`, `enum`, `→ team_members`). */
export function fieldTypeTag(column: GridColumnSpec): string {
  if (column.fk !== undefined) return `→ ${column.fk.table}`;
  if (column.logicalType === 'enum' || (column.enumValues?.length ?? 0) > 0) return 'enum';
  return column.logicalType;
}

/** Coerce a raw input string back to the column's wire type for the API. */
export function coerceFieldValue(column: GridColumnSpec, raw: unknown): unknown {
  if (raw === '' || raw === undefined) return column.nullable ? null : raw === '' ? '' : raw;
  const kind = fieldKindFor(column);
  if (kind === 'number' && typeof raw === 'string') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  if (kind === 'checkbox') return raw === true || raw === 'true';
  if (kind === 'json' && typeof raw === 'string') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}
