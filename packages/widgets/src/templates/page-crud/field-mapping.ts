// SPDX-License-Identifier: AGPL-3.0-only
import { dateOnlyValue } from '../../families/tables/column-spec.js';
import type { GridColumnSpec } from '../../families/tables/column-spec.js';
import { withChoices, type ChoiceWords } from '../../families/tables/choices.js';
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
  /**
   * Asked for only while another column of the record holds one of `in` (an
   * away event names who is away). The server refuses the write otherwise.
   */
  requiredWhen?: { column: string; in: readonly (string | number | boolean)[] } | undefined;
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
  /** What a person calls each of the column's enum values — the app's, or the operator's — in the reader's language. */
  enumLabels?: Readonly<Record<string, string>> | undefined;
  /** Each value's badge tone, the app's or the operator's. */
  enumTones?: Readonly<Record<string, string>> | undefined;
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
    // A value the rule gives no word keeps the column's own, as the list does.
    if (resolved !== undefined) {
      return resolved.map((option) =>
        option.label !== undefined || fact?.enumLabels?.[option.value] === undefined
          ? { ...option }
          : { ...option, label: fact.enumLabels[option.value] },
      );
    }
  }
  return (column.enumValues ?? []).map((value) => ({
    value,
    ...(fact?.enumLabels?.[value] === undefined ? {} : { label: fact.enumLabels[value] }),
    ...(column.enumTones?.[value] === undefined ? {} : { tone: column.enumTones[value] }),
  }));
}

export type ColumnFacts = Readonly<Record<string, ColumnFact>>;

/**
 * What the server says a column's values are called and drawn in, for a
 * list: its value labels and tones, with the words and tones of the inline
 * answers a form offers over them — so a grid cell and a choice on the same
 * page say the same thing. All of it already in the reader's language.
 *
 * A named list is left to the form: a column of country codes stays a column
 * of codes in a grid, as it always has.
 */
export function choiceWordsOf(fact: ColumnFact | undefined): ChoiceWords | undefined {
  if (fact === undefined) return undefined;
  const rule = fact.options;
  const answers = rule !== undefined && 'values' in rule ? rule.values : undefined;
  const labels: Record<string, string> = { ...fact.enumLabels };
  const tones: Record<string, string> = { ...fact.enumTones };
  for (const answer of answers ?? []) {
    if (answer.label !== undefined) labels[answer.value] = answer.label;
    if (answer.tone !== undefined) tones[answer.value] = answer.tone;
  }
  if (Object.keys(labels).length === 0 && Object.keys(tones).length === 0) return undefined;
  return {
    ...(Object.keys(labels).length === 0 ? {} : { enumLabels: labels }),
    ...(Object.keys(tones).length === 0 ? {} : { enumTones: tones }),
  };
}

/**
 * A page's stored columns with the server's words for their values, where the
 * page sets none of its own: what the grid, the peek and the record page draw
 * a status or a choice with.
 */
export function withFactChoices(columns: readonly GridColumnSpec[], facts: ColumnFacts | undefined): readonly GridColumnSpec[] {
  if (facts === undefined) return columns;
  return withChoices(columns, (name) => choiceWordsOf(facts[name]));
}

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
 *
 * `values` are the record as the form holds it: a column required only while
 * another holds a listed value is required once the person picks one.
 * `stored` is the record as it was loaded, on an edit: as on the server, an
 * edit that changes neither column is not judged, so a record kept from
 * before the rule can still be edited in its other fields.
 */
export function isRequired(
  column: GridColumnSpec,
  fact?: ColumnFact | undefined,
  values?: Readonly<Record<string, unknown>>,
  stored?: Readonly<Record<string, unknown>>,
): boolean {
  if (fact !== undefined) return fact.required || requiredNow(column.name, fact, values, stored);
  return !column.nullable && !column.hasDefault && !column.readOnly;
}

const emptyValue = (value: unknown): boolean => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

/** A yes or a no as a form or a database holds one: a switch's boolean, `1` or `0`, `'true'`. */
function yesOrNo(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const word = String(value).trim().toLowerCase();
  return ['true', 't', 'yes', 'y', 'on', '1'].includes(word) ? true : ['false', 'f', 'no', 'n', 'off', '0'].includes(word) ? false : null;
}

/** Whether a value the form holds is one a `requiredWhen` lists. */
function listedValue(listed: string | number | boolean, held: unknown): boolean {
  // A switch holds a boolean, a database may hand one back as 1 or 0.
  if (typeof listed === 'boolean') return yesOrNo(held) === listed;
  // A form holds a choice as its text.
  return String(listed) === String(held);
}

/** Whether the other column a `requiredWhen` names holds one of its values, on a write that touches either. */
function requiredNow(
  name: string,
  fact: ColumnFact,
  values: Readonly<Record<string, unknown>> | undefined,
  stored: Readonly<Record<string, unknown>> | undefined,
): boolean {
  const when = fact.requiredWhen;
  if (when === undefined || values === undefined) return false;
  if (stored !== undefined) {
    const same = (column: string) => (emptyValue(values[column]) && emptyValue(stored[column])) || String(values[column]) === String(stored[column]);
    if (same(name) && same(when.column)) return false;
  }
  const held = values[when.column];
  if (emptyValue(held)) return false;
  return when.in.some((listed) => listedValue(listed, held));
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
