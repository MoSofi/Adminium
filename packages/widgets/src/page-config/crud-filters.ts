// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FILTERS A PAGE OFFERS — `config.filters`, and the ones derived from the
 * table when a page defines none (D8).
 *
 * ─── Why an admin defines them ─────────────────────────────────────────────
 *
 * A free "add a filter over anything" is a query builder, and a query builder
 * over a table nobody has described is how a person ends up filtering on
 * `legacy_ref_2` and reading a number that means something else. What ships is
 * the set an admin chose, each with a control that suits the column, and the
 * defaults are the two a table can always answer for itself.
 *
 * ─── This is a leaf ────────────────────────────────────────────────────────
 *
 * Zod and nothing else, like every other `page-config` module: the dashboard
 * validates a stored block with it, the template renders from it, and the
 * server reaches it through `@adminium/engine/config`. One schema, three
 * readers, no second opinion about what a filter is.
 */
import { z } from 'zod';

import type { FormColumnShape } from './crud-form.js';

/** The six controls a filter may use. */
export const FILTER_CONTROLS = [
  'one-of',
  'any-of',
  'yes-no',
  'record',
  'date-range',
  'number-range',
] as const;
export type FilterControl = (typeof FILTER_CONTROLS)[number];

/**
 * Six is the ceiling. Past it the bar is a form, and a filter nobody can see
 * without scrolling is a filter nobody uses.
 */
export const MAX_FILTERS = 6;

/** How many a page gets for free: the comp draws two meta pills (151–178). */
export const MAX_DERIVED_FILTERS = 2;

const filterFieldSchema = z.object({
  column: z.string().min(1),
  /** Absent ⇒ the control the column's own shape implies. */
  control: z.enum(FILTER_CONTROLS).optional(),
  /** What the chip and the button say; absent ⇒ the column's label. */
  label: z.string().trim().min(1).max(40).optional(),
});
export type CrudFilterField = z.infer<typeof filterFieldSchema>;

export const crudFiltersConfigSchema = z.array(filterFieldSchema).max(MAX_FILTERS);

/**
 * The stored block, or `null` when the page carries none — or carries one this
 * build cannot read, which degrades to the derived set. A column named twice is
 * refused for the same reason a form field is: two controls writing one
 * condition, and the last one silently wins.
 */
export function parseCrudFilters(config: Record<string, unknown>): CrudFilterField[] | null {
  const raw = config['filters'];
  if (raw === undefined || raw === null) return null;
  const parsed = crudFiltersConfigSchema.safeParse(raw);
  if (!parsed.success) return null;
  const names = parsed.data.map((filter) => filter.column);
  if (new Set(names).size !== names.length) return null;
  return parsed.data;
}

const NUMERIC = new Set(['integer', 'bigint', 'decimal', 'float']);
const TEMPORAL = new Set(['date', 'timestamp', 'timestamptz']);

function hasChoices(column: FormColumnShape): boolean {
  if (column.options !== undefined) return true;
  return (column.enumValues?.length ?? 0) > 0;
}

/**
 * The control this column can be filtered with, or null when it cannot be
 * filtered at all in wave 1.
 *
 * A TEXT column is deliberately absent: filtering on its distinct values means
 * reading the table to build the menu, and a free "contains" box is the query
 * builder D8 refuses. Search already answers "find the row that says this".
 */
export function filterControlFor(column: FormColumnShape): FilterControl | null {
  if (column.lookup !== undefined || column.reverse !== undefined || column.derived !== undefined) return null;
  if (column.file !== undefined || column.list === true) return null;
  if (column.fk !== undefined && column.fk !== null) return 'record';
  if (column.logicalType === 'boolean') return 'yes-no';
  if (hasChoices(column)) return 'one-of';
  if (TEMPORAL.has(column.logicalType)) return 'date-range';
  if (NUMERIC.has(column.logicalType) && column.primaryKey !== true) return 'number-range';
  return null;
}

/** Every control this column may legally be given, for the Studio picker. */
export function legalFilterControls(column: FormColumnShape): FilterControl[] {
  const base = filterControlFor(column);
  if (base === null) return [];
  // A choice can be "one of" or "any of" — the same menu, one tick or several.
  if (base === 'one-of') return ['one-of', 'any-of'];
  return [base];
}

/** One column as the page reply describes it, for the derivation. */
export interface FilterColumnFact {
  spec: FormColumnShape;
  ordinal: number;
  /** A masked column never becomes a filter: see the derivation. */
  masked?: boolean | undefined;
}

/**
 * The filters a page gets when nobody has defined any.
 *
 * TWO at most, because the comp's toolbar draws two and a row of six buttons
 * over a table nobody asked to filter is chrome. **Status first**: it is the
 * column people filter by in every admin ever written, and putting it second
 * would be a default that is wrong for the common case.
 *
 * A MASKED column is never offered. Its values are redacted for the reader, so
 * a menu over it would either leak the values it exists to hide or list
 * asterisks nobody can choose between.
 */
export function deriveFilters(input: { columns: readonly FilterColumnFact[] }): CrudFilterField[] {
  const candidates = [...input.columns]
    .sort((a, b) => a.ordinal - b.ordinal)
    .filter((fact) => fact.masked !== true && filterControlFor(fact.spec) !== null);

  const score = (fact: FilterColumnFact): number => {
    const control = filterControlFor(fact.spec);
    if (fact.spec.semantic === 'status') return 0;
    if (/status|state|stage/i.test(fact.spec.name)) return 1;
    // A short choice next: a menu of five is a decision, a menu of fifty is a
    // search, and a date range is a question somebody has to already have.
    if (control === 'one-of') return 2;
    if (control === 'yes-no') return 3;
    if (control === 'record') return 4;
    if (control === 'date-range') return 5;
    return 6;
  };

  return candidates
    .map((fact, index) => ({ fact, index }))
    .sort((a, b) => score(a.fact) - score(b.fact) || a.index - b.index)
    .slice(0, MAX_DERIVED_FILTERS)
    .map(({ fact }) => ({
      column: fact.spec.name,
      control: filterControlFor(fact.spec) as FilterControl,
    }));
}

/** The stored filters, with a column the table no longer has dropped. */
export function filtersFor(
  stored: CrudFilterField[] | null,
  facts: { columns: readonly FilterColumnFact[] },
): CrudFilterField[] {
  if (stored === null) return deriveFilters(facts);
  const known = new Map(facts.columns.map((fact) => [fact.spec.name, fact]));
  return stored.flatMap((filter) => {
    const fact = known.get(filter.column);
    // A filter over a column that is gone — or one that has become masked
    // since — is dropped rather than rendered as a control with no menu.
    if (fact === undefined || fact.masked === true) return [];
    const control = filter.control ?? filterControlFor(fact.spec);
    return control === null ? [] : [{ ...filter, control }];
  });
}
