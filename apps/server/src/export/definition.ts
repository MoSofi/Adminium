// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An export DEFINITION — the builder's ordered column list with its headers,
 * linked values, counts, folds and calculated columns — resolved against the
 * snapshot under one caller's grants.
 *
 * ONE resolver, THREE callers: `POST /exports` validates a definition here
 * before a row exists (a page-author mistake is a 422 on the request, never a
 * failed job discovered later), `POST /exports/preview` reads a sample
 * through it, and the `export-run` job writes the file through it. All three
 * reach the projection families through `crud/projections.ts`, which is what
 * a page read uses — so a lookup an operator may not follow, a masked target
 * column, the shared twelve-subquery budget and the one-namespace rule are
 * decided by the same code whether the row is on a screen or in a file.
 *
 * THE MASKED SPLIT is the one thing this module decides on its own. A base
 * column masked for the caller must NOT go through `select=` — `readableColumn`
 * answers 403 `COLUMN_FORBIDDEN` for it, which would turn a low-privilege
 * export into a FAILED job — so masked base columns ride in `requiredColumns`,
 * where `runList` keeps them in the SELECT list, lets `maskRow` null and mark
 * them, and the writer turns the mark into `•••••` (D6). Everything else the
 * definition names goes through `select`.
 *
 * LEGACY. A source with no `columns` (every row written before this plan, and
 * every scheduled report) resolves to the pre-definition shape: every
 * selectable column under its own name. The job keeps threading the page's
 * derived block for those through `pageId`, exactly built it.
 */

import type { DerivedField } from '@adminium/engine/config';
import type { ExportSource } from '@adminium/meta';

import { ValidationFailedError } from '../errors.js';
import type { ResolvedColumn, ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { ResolvedLookup } from '../crud/lookups.js';
import type { PiiAccess } from '../crud/mask.js';
import type { ResolvedMeasure } from '../crud/measures.js';
import { resolveProjections, type ProjectionRefusal } from '../crud/projections.js';

/** Logical types whose values a JSON Lines writer may splice unquoted (D7). */
const NUMERIC_LOGICAL_TYPES: ReadonlySet<string> = new Set(['integer', 'bigint', 'decimal', 'float']);

export type ExportColumnKind = 'base' | 'lookup' | 'count' | 'measure' | 'field';

export interface ExportDefinitionColumn {
  /** The row key the value is read from. */
  key: string;
  /** The header it is written under. */
  header: string;
  kind: ExportColumnKind;
  /** Masked or refused for THIS caller — the preview's "n columns export masked". */
  masked: boolean;
  /** Whether a plain decimal value may be written as a JSON number. */
  numeric: boolean;
}

export interface ResolvedExportDefinition {
  /** True for a source without `columns` — the pre-definition shape. */
  legacy: boolean;
  columns: ExportDefinitionColumn[];
  /** `params.select` for the read, or undefined for "every selectable column" (legacy). */
  select: string[] | undefined;
  /** Base columns merged into the projection outside `select=` (fields' inputs + masked base columns). */
  requiredColumns: readonly string[];
  lookups: ResolvedLookup[];
  measures: ResolvedMeasure[];
  fields: readonly DerivedField[];
  refusals: ProjectionRefusal[];
}

export interface ResolveExportDefinitionOptions {
  view: SnapshotView;
  table: ResolvedTable;
  source: ExportSource;
  /** Whether the exported table's own personal columns go out in clear. */
  canReadPii: boolean;
  /**
   * The same, asked of each table a lookup or a measure reaches. Absent,
   * `canReadPii` answers for every table, which is right only for a reader
   * whose answer does not depend on the table.
   */
  canReadPiiOf?: PiiAccess | undefined;
  canReadTable: (tableId: string) => Promise<boolean>;
}

function isNumeric(column: ResolvedColumn): boolean {
  return NUMERIC_LOGICAL_TYPES.has(column.logicalType);
}

function refuse(message: string, details: unknown): never {
  throw new ValidationFailedError(message, details);
}

export async function resolveExportDefinition(
  opts: ResolveExportDefinitionOptions,
): Promise<ResolvedExportDefinition> {
  const { view, table, source, canReadPii, canReadPiiOf, canReadTable } = opts;

  if (source.columns === undefined) {
    return {
      legacy: true,
      columns: view.selectableColumns(table).map((column) => ({
        key: column.name,
        header: column.name,
        kind: 'base',
        masked: column.masked && !canReadPii,
        numeric: isNumeric(column),
      })),
      select: undefined,
      requiredColumns: [],
      lookups: [],
      measures: [],
      fields: [],
      refusals: [],
    };
  }

  const columns = source.columns;
  if (columns.length === 0) refuse('An export needs at least one column.', { columns: 0 });

  // Headers are file-level keys (a CSV header, a JSON Lines key), so two that
  // differ only by case or whitespace would still collide for a consumer.
  const headers = new Map<string, string>();
  for (const column of columns) {
    const header = column.label.trim();
    if (header.length === 0) {
      refuse(`Column ${JSON.stringify(column.name)} has an empty header.`, { column: column.name });
    }
    const folded = header.toLowerCase();
    if (headers.has(folded)) refuse(`Header ${JSON.stringify(header)} is used twice.`, { header });
    headers.set(folded, column.name);
  }

  const lookupSpecs: string[] = [];
  const aggSpecs: string[] = [];
  const refs: { name: string; ref: string }[] = [];
  const baseColumns = new Map<string, ResolvedColumn>();
  const keys = new Set<string>();
  for (const column of columns) {
    const families = [column.lookup, column.reverse, column.derived].filter(
      (block) => block !== undefined,
    ).length;
    if (families > 1) {
      refuse(`Column ${JSON.stringify(column.name)} is more than one kind of projection.`, {
        column: column.name,
      });
    }
    const key = column.derived?.ref ?? column.name;
    if (keys.has(key)) refuse(`Column ${JSON.stringify(key)} appears twice.`, { column: key });
    keys.add(key);

    if (column.lookup !== undefined) {
      lookupSpecs.push(`${column.name}:${[...column.lookup.path, column.lookup.select].join('.')}`);
    } else if (column.reverse !== undefined) {
      aggSpecs.push(`${column.name}:${column.reverse.table}.${column.reverse.fkColumn}:count`);
    } else if (column.derived !== undefined) {
      refs.push({ name: column.name, ref: column.derived.ref });
    } else {
      // 422 on an unknown or secret name — the snapshot's own rule.
      baseColumns.set(column.name, view.column(table, column.name));
    }
  }

  const derivedRaw = source.derived;
  if (
    derivedRaw !== undefined &&
    derivedRaw !== null &&
    (typeof derivedRaw !== 'object' || Array.isArray(derivedRaw))
  ) {
    refuse('`derived` must be an object with `measures` and `fields`.', {});
  }
  const compute =
    derivedRaw === undefined || derivedRaw === null ? undefined : JSON.stringify(derivedRaw);

  const projections = await resolveProjections({
    view,
    table,
    canReadPii: canReadPiiOf ?? canReadPii,
    canReadTable,
    lookup: lookupSpecs,
    agg: aggSpecs,
    compute,
  });

  const measuresByAlias = new Map(projections.measures.map((measure) => [measure.alias, measure]));
  const fieldsById = new Map(projections.fields.map((field) => [field.id, field]));
  for (const { name, ref } of refs) {
    if (!measuresByAlias.has(ref) && !fieldsById.has(ref)) {
      refuse(
        `Column ${JSON.stringify(name)} refers to ${JSON.stringify(ref)}, which this export does not define.`,
        { column: name, ref },
      );
    }
  }
  const lookupsByAlias = new Map(projections.lookups.map((lookup) => [lookup.alias, lookup]));

  const resolvedColumns: ExportDefinitionColumn[] = columns.map((column) => {
    const header = column.label.trim();
    if (column.lookup !== undefined) {
      const lookup = lookupsByAlias.get(column.name);
      return {
        key: column.name,
        header,
        kind: 'lookup',
        masked: lookup?.refused ?? false,
        numeric: lookup === undefined ? false : isNumeric(lookup.target),
      };
    }
    if (column.reverse !== undefined) {
      return {
        key: column.name,
        header,
        kind: 'count',
        masked: measuresByAlias.get(column.name)?.refused ?? false,
        numeric: true,
      };
    }
    if (column.derived !== undefined) {
      const measure = measuresByAlias.get(column.derived.ref);
      if (measure !== undefined) {
        return { key: measure.alias, header, kind: 'measure', masked: measure.refused, numeric: true };
      }
      const field = fieldsById.get(column.derived.ref);
      return {
        key: column.derived.ref,
        header,
        kind: 'field',
        masked: false,
        numeric: field?.result !== 'text',
      };
    }
    const base = baseColumns.get(column.name);
    return {
      key: column.name,
      header,
      kind: 'base',
      masked: base !== undefined && base.masked && !canReadPii,
      numeric: base !== undefined && isNumeric(base),
    };
  });

  const maskedForCaller = (column: ResolvedColumn): boolean => column.masked && !canReadPii;
  const select = [...baseColumns.values()]
    .filter((column) => !maskedForCaller(column))
    .map((column) => column.name);
  const maskedBase = [...baseColumns.values()]
    .filter((column) => maskedForCaller(column))
    .map((column) => column.name);

  return {
    legacy: false,
    columns: resolvedColumns,
    select,
    requiredColumns: [...new Set([...projections.requiredColumns, ...maskedBase])],
    lookups: projections.lookups,
    measures: projections.measures,
    fields: projections.fields,
    refusals: projections.refusals,
  };
}

/** Longest file stem the builder accepts; the extension is added after. */
export const MAX_FILE_STEM = 100;

/**
 * The stem a person typed, made safe for a `Content-Disposition` filename and
 * every storage key it might become: a known extension stripped (the format
 * decides it), anything outside `[\w .()-]` replaced, whitespace collapsed,
 * dots and spaces trimmed from the ends. `null` when nothing usable is left.
 */
export function sanitizeFileName(requested: string | undefined | null): string | null {
  if (requested === undefined || requested === null) return null;
  const stem = requested
    .replace(/\.(?:csv|jsonl|json)$/i, '')
    .replaceAll(/[^\w .()-]+/g, '_')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/^[. ]+|[. ]+$/g, '')
    .slice(0, MAX_FILE_STEM)
    .replaceAll(/[. ]+$/g, '');
  return stem.length === 0 ? null : stem;
}

/**
 * A stored `source.filters` list as the list read's `where` DSL string — one
 * filter as itself, several ANDed. Shared by the job, the saved-views read and
 * the preview, so a view's rows are the same rows whoever counts them.
 */
export function filtersToWhere(filters: unknown[] | undefined): string | undefined {
  if (filters === undefined || filters.length === 0) return undefined;
  return JSON.stringify(filters.length === 1 ? filters[0] : { and: filters });
}
