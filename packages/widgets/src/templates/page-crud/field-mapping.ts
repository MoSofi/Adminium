// SPDX-License-Identifier: AGPL-3.0-only
import { dateOnlyValue } from '../../families/tables/column-spec.js';
import type { GridColumnSpec } from '../../families/tables/column-spec.js';
import { controlFor, legalControls, type FormControl } from '../../page-config/index.js';
import type { ControlOption } from './controls/types.js';

export { controlFor, legalControls };
export type { FormControl };

/**
 * Column spec → generated form-field kind (FormField + Input/
 * Select/Checkbox/DateInput by logicalType + semantics; enums → Select or
 * SegmentedControl by arity per the CRUD Admin comp; FK → async Combobox).
 * Pure so the mapping rules are unit-testable.
 */

const SERVER_MANAGED_SEMANTICS = new Set(['created-at', 'updated-at']);

/**
 * WHAT THE SERVER SAYS ABOUT ONE COLUMN, RIGHT NOW (`columnFacts` on the page
 * reply). Absent ⇒ the form falls back to the stored spec, exactly as it did
 * before these existed.
 *
 * THE BUG THIS FIXES. The form hid `created_at` and `updated_at` on the
 * classifier's TAG, never once asking whether anything actually fills them. On
 * a table whose `created_at` is NOT NULL with no database default, that meant a
 * form with no way to supply a value the database then demanded — the create
 * the owner reported on 2026-09-17, and the reason this plan exists. A tag says
 * what a column MEANS; only a fact says who writes it.
 */
export interface ColumnFact {
  /** Who puts a value here when nobody types one. `null` ⇒ nobody. */
  filledBy: 'database' | 'adminium' | null;
  /** NOT NULL (or a rule) and nothing fills it: the form has to ask. */
  required: boolean;
  /** False for a generated column: shown, never sent. */
  writable: boolean;
  /**
   * The answers an ADMIN fixed with `column.options`: the
   * values themselves, or the KEY of a workspace list.
   *
   * A key rather than its values, because the list is edited somewhere else and
   * a copy taken when the page was saved would be a different list by the time
   * anybody used it. The host resolves the key — it is the one that knows the
   * reader's language, and a country's name is `Intl.DisplayNames`'s to give.
   */
  options?: { list: string } | { values: readonly ControlOption[] } | undefined;
  /** What a person calls each of the column's enum values — the app's, or the operator's. */
  enumLabels?: Readonly<Record<string, string>> | undefined;
}

/** Resolves a list key into the answers it holds, in the reader's language. */
export type ListOptionsResolver = (key: string) => readonly ControlOption[] | undefined;

/**
 * The answers a column accepts: the rule's, else the database's own enum.
 *
 * A rule WINS over the column's enum, because it is the narrower statement and
 * the server enforces it — offering a value the write path refuses would be a
 * form that argues with itself.
 */
export function optionsForColumn(
  column: GridColumnSpec,
  fact?: ColumnFact | undefined,
  listOptions?: ListOptionsResolver | undefined,
): ControlOption[] {
  const rule = fact?.options;
  if (rule !== undefined) {
    const resolved = 'values' in rule ? rule.values : listOptions?.(rule.list);
    // A list the host cannot resolve contributes nothing, exactly as it does on
    // the server: the column falls back to what the database itself allows.
    if (resolved !== undefined) return resolved.map((option) => ({ ...option }));
  }
  return (column.enumValues ?? []).map((value) => ({
    value,
    ...(fact?.enumLabels?.[value] === undefined ? {} : { label: fact.enumLabels[value] }),
    ...(column.enumTones?.[value] === undefined ? {} : { tone: column.enumTones[value] }),
  }));
}

export type ColumnFacts = Readonly<Record<string, ColumnFact>>;

/**
 * The ONE mapping: which control this column gets, or that it gets none.
 *
 * ─── Why `hidden` lives here and the rest lives in the leaf ────────────────
 *
 * `controlFor` (page-config) answers "what does a column of this shape look
 * like", which the designer, the server and this renderer all need to agree on.
 * Whether the column appears AT ALL is a different question — it depends on who
 * fills it, which is a fact about the table rather than about the column's type
 * — and it is answered here, where the facts are.
 *
 * This replaced `fieldKindFor` and its sixteen-word kind vocabulary. Two
 * mappings for one decision is how the form and the generator came to disagree
 * about when to hide a timestamp and when to segment an enum (B9).
 */
export function controlForColumn(
  column: GridColumnSpec,
  fact?: ColumnFact | undefined,
  listOptions?: ListOptionsResolver | undefined,
): FormControl | 'hidden' {
  const rule = fact?.options;
  const ruleValues =
    rule === undefined
      ? undefined
      : ('values' in rule ? rule.values : listOptions?.(rule.list))?.map((option) => option.value);
  // Lookup, reverse-link and derived columns are all PROJECTIONS — computed
  // server-side from other rows or from arithmetic, with nothing on this table
  // to write — so they never appear in forms at all.
  if (
    column.lookup !== undefined ||
    column.reverse !== undefined ||
    column.derived !== undefined
  ) {
    return 'hidden';
  }
  if (fact !== undefined) {
    // A generated column is the database's arithmetic: shown, never sent.
    if (!fact.writable) return 'readonly';
    // Hidden only when something REALLY fills it. A key with a default, a
    // timestamp with one, a column a rule fills — none of those are anybody's
    // business. A `created_at` that nothing fills is the person's business,
    // and falls through to the ordinary control for its type.
    if (
      fact.filledBy !== null &&
      (column.primaryKey || (column.semantic !== null && SERVER_MANAGED_SEMANTICS.has(column.semantic)))
    ) {
      return 'hidden';
    }
  } else {
    // No facts on the reply (an older server, a page with no source table):
    // the stored spec's own flags, unchanged.
    if (column.primaryKey && column.hasDefault) return 'hidden';
    if (column.semantic !== null && SERVER_MANAGED_SEMANTICS.has(column.semantic)) return 'hidden';
    if (column.readOnly) return 'readonly';
  }

  /*
   * Everything else is the column's own shape, and the leaf owns that rule —
   * the same function the form designer offers controls from and the server
   * derives its document with.
   */
  return controlFor({
    name: column.name,
    logicalType: column.logicalType,
    semantic: column.semantic,
    nullable: column.nullable,
    maxLength: column.maxLength,
    primaryKey: column.primaryKey,
    unique: column.unique,
    // A rule's values decide the CONTROL as well as the answers: six or fewer
    // is a segmented control or choice cards, more is a select (D19).
    ...(ruleValues === undefined
      ? column.enumValues === undefined
        ? {}
        : { enumValues: column.enumValues }
      : { enumValues: ruleValues }),
    ...(column.fk === undefined ? {} : { fk: column.fk }),
    ...(column.file === undefined ? {} : { file: column.file }),
  });
}

/** Columns that appear in the generated create/edit form, in spec order. */
export function formColumns(
  columns: readonly GridColumnSpec[],
  facts?: ColumnFacts | undefined,
  listOptions?: ListOptionsResolver | undefined,
): GridColumnSpec[] {
  return columns.filter(
    (column) => controlForColumn(column, facts?.[column.name], listOptions) !== 'hidden',
  );
}

/**
 * Whether the form must be given a value.
 *
 * The fact wins where there is one: the server has already weighed NOT NULL
 * against every default, every generated expression and every fill, which the
 * stored spec's `hasDefault` boolean cannot express (it folds five default
 * kinds into one bit and says nothing about who fills the column).
 */
export function isRequired(column: GridColumnSpec, fact?: ColumnFact | undefined): boolean {
  if (fact !== undefined) return fact.required;
  return !column.nullable && !column.hasDefault && !column.readOnly;
}

/** Mono type tag next to the label (`varchar`, `enum`, `→ team_members`). */
export function fieldTypeTag(column: GridColumnSpec): string {
  if (column.fk !== undefined) return `→ ${column.fk.label ?? column.fk.table}`;
  if (column.logicalType === 'enum' || (column.enumValues?.length ?? 0) > 0) return 'enum';
  return column.logicalType;
}

// The wire-instant decode moved to the tables family (column-spec.ts): the
// cell renderer needs the same recovery and families/tables cannot import
// from templates/. Re-exported so form-side consumers keep this surface.
export { dateOnlyValue };

/** Coerce a raw input string back to the column's wire type for the API. */
export function coerceFieldValue(column: GridColumnSpec, raw: unknown): unknown {
  if (raw === '' || raw === undefined) return column.nullable ? null : raw === '' ? '' : raw;
  const control = controlForColumn(column);
  // Untouched edit fields still hold the wire instant at submit time — send
  // the calendar day, never the instant the server would re-truncate in UTC.
  if (control === 'date' && raw !== null) return dateOnlyValue(raw);
  if ((control === 'number' || control === 'currency' || control === 'stepper' || control === 'slider') && typeof raw === 'string') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  if (control === 'toggle-row' || control === 'check-row') return raw === true || raw === 'true';
  if (control === 'json' && typeof raw === 'string') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}
