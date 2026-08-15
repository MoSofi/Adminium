/**
 * Stage 6 — referential cross-checks against the live schema snapshot and the
 * registry allow-lists (06-llm-assist.md §7.3, exhaustive).
 *
 * The Zod pass (stage 4) proves a response is *shaped* right; this proves it is
 * *true*: every table/column it names exists, every relation it confirms was
 * really declared, every enum's values match the catalog, every widget binds to
 * a real (correctly-typed) column, and every page-template / widget / icon comes
 * from a vocabulary the runtime can render. Each violation is a per-item error
 * (§7.2): it drops exactly one suggestion (and its dependents — a hallucinated
 * table also drops the dashboard widgets bound to it) and lets everything else
 * apply.
 *
 * Browser-safe: the engine is imported TYPE-ONLY, so no DB-driver code can reach
 * `@adminium/dashboard` through here (the numeric/temporal type sets below are
 * local constants, not runtime engine imports).
 */
import type { ColumnModel, DatabaseModel, LogicalType, StatsResult } from '@adminium/engine';

import {
  columnLabelId,
  enumId as enumSuggestionId,
  groupId as groupSuggestionId,
  keyId,
  relationId,
  tableLabelId,
  templateId as templateSuggestionId,
  widgetId as widgetSuggestionId,
} from '../apply/suggestion-id.js';
import { PSEUDO_ENUM_MAX_DISTINCT, qualifyTableRef } from '../prompt/serializer.js';
import { type LlmValidationError, makeError } from './errors.js';
import type { LlmResponseV1, LocaleCode } from './schema.js';

/* ------------------------------------------------------------------ context */

/**
 * Everything the referential checks read. `snapshot` is the classified schema
 * IR the run was built against (validation always runs against the run's
 * snapshot — §7.4); `allowedTemplates` / `allowedWidgets` are Track W's
 * registry allow-lists (`LLM_ALLOWED_TEMPLATES` / `LLM_ALLOWED_WIDGETS`),
 * injected as data so this package never depends on `@adminium/widgets`.
 */
export interface ReferentialContext {
  /** The classified schema model the response is validated against. */
  snapshot: DatabaseModel;
  /** The run's requested locales (drives the fallback icon check messaging). */
  locales: readonly LocaleCode[];
  /**
   * `LLM_ALLOWED_TEMPLATES` — the RECOMMENDABLE page-template vocabulary (the
   * same list the prompt injected, one coherent contract). Non-recommendable
   * registry templates (the M7 tool surfaces) are simply absent and fail the
   * membership check; `page-crud` is rejected separately with its bespoke
   * "always generated" message whether or not a caller includes it.
   */
  allowedTemplates: readonly string[];
  /** `LLM_ALLOWED_WIDGETS` — the curated dashboard-widget subset. */
  allowedWidgets: readonly string[];
  /**
   * The bundled lucide manifest (`@adminium/ui` `LUCIDE_ICON_NAMES`), injected
   * as data. When absent the icon check is skipped (Zod already guarantees
   * kebab-case); when present, an unknown icon is a warning + `table` fallback.
   */
  allowedIcons?: ReadonlySet<string> | readonly string[];
  /**
   * Tables present only as chunk context (`"stub": true`); a suggestion for one
   * is treated like a hallucinated table (§4.5 / §7.3 row 1).
   */
  stubTables?: readonly string[];
  /**
   * The run's collected statistics (same array the prompt was built from). Used
   * ONLY to recover the `pseudoEnumCandidate` flag (§4.2): a low-cardinality
   * non-PII text column the prompt flagged and asked the model to classify. §7.3
   * row 4 accepts an `enums[]` suggestion on such a column even without a declared
   * DB enum/CHECK. Absent ⇒ pseudo-enum acceptance is off (only declared-enum
   * columns qualify), matching the sample-free corpus fixtures.
   */
  stats?: readonly StatsResult[];
}

/* ---------------------------------------------------------------- constants */

/** The fallback icon a rejected/unknown icon downgrades to (§7.3 icon row). */
export const FALLBACK_ICON = 'table';

const NUMERIC_TYPES: ReadonlySet<LogicalType> = new Set<LogicalType>([
  'integer',
  'bigint',
  'decimal',
  'float',
]);

const TEMPORAL_TYPES: ReadonlySet<LogicalType> = new Set<LogicalType>([
  'date',
  'time',
  'timestamp',
  'timestamptz',
]);

/** A single-column PK of one of these types reads as a surrogate id (§7.3). */
const SURROGATE_PK_TYPES: ReadonlySet<LogicalType> = new Set<LogicalType>([
  'uuid',
  'integer',
  'bigint',
]);

/** Aggregations that require a numeric metric column (§7.3 widget row). */
const NUMERIC_AGGS = new Set<string>(['sum', 'avg', 'min', 'max']);

/* -------------------------------------------------------------- prune model */

/**
 * The per-item drops one validation pass wants applied, addressed by the
 * ORIGINAL response indices (so error paths keep pointing at what the model
 * produced). {@link applyPrunes} turns these into a cleaned response and cascades
 * table drops to dependent enums + dashboard widgets.
 */
export interface ResponsePrunes {
  tables: Set<number>;
  /** tableIndex → column indices to drop. */
  columns: Map<number, Set<number>>;
  nullDisplayColumn: Set<number>;
  nullNaturalKey: Set<number>;
  dropMicrocopy: Set<number>;
  /** tableIndex → pageTemplate indices to drop. */
  pageTemplates: Map<number, Set<number>>;
  /** tableIndex → replace icon with {@link FALLBACK_ICON}. */
  fallbackTableIcon: Set<number>;
  enums: Set<number>;
  confirmedRelations: Set<number>;
  inferredRelations: Set<number>;
  navGroups: Set<number>;
  /** navGroupIndex → replace icon with {@link FALLBACK_ICON}. */
  fallbackNavIcon: Set<number>;
  dashboards: Set<number>;
  /** dashboardIndex → widget indices to drop. */
  widgets: Map<number, Set<number>>;
}

export function createPrunes(): ResponsePrunes {
  return {
    tables: new Set(),
    columns: new Map(),
    nullDisplayColumn: new Set(),
    nullNaturalKey: new Set(),
    dropMicrocopy: new Set(),
    pageTemplates: new Map(),
    fallbackTableIcon: new Set(),
    enums: new Set(),
    confirmedRelations: new Set(),
    inferredRelations: new Set(),
    navGroups: new Set(),
    fallbackNavIcon: new Set(),
    dashboards: new Set(),
    widgets: new Map(),
  };
}

function addNested(map: Map<number, Set<number>>, outer: number, inner: number): void {
  const set = map.get(outer);
  if (set) set.add(inner);
  else map.set(outer, new Set([inner]));
}

function mergeNested(into: Map<number, Set<number>>, from: Map<number, Set<number>>): void {
  for (const [outer, inners] of from) {
    for (const inner of inners) addNested(into, outer, inner);
  }
}

/** Union two prune sets (locale stage + referential stage) into a new one. */
export function mergePrunes(a: ResponsePrunes, b: ResponsePrunes): ResponsePrunes {
  const out = createPrunes();
  for (const key of [
    'tables',
    'nullDisplayColumn',
    'nullNaturalKey',
    'dropMicrocopy',
    'fallbackTableIcon',
    'enums',
    'confirmedRelations',
    'inferredRelations',
    'navGroups',
    'fallbackNavIcon',
    'dashboards',
  ] as const) {
    for (const i of a[key]) out[key].add(i);
    for (const i of b[key]) out[key].add(i);
  }
  for (const map of [a.columns, b.columns]) mergeNested(out.columns, map);
  for (const map of [a.pageTemplates, b.pageTemplates]) mergeNested(out.pageTemplates, map);
  for (const map of [a.widgets, b.widgets]) mergeNested(out.widgets, map);
  return out;
}

/* ------------------------------------------------------------ schema index */

interface TableIndex {
  id: string;
  columns: Map<string, ColumnModel>;
  columnNames: Set<string>;
  primaryKey: readonly string[];
  /** column name → its declared enum's ordered value set (when enum-backed). */
  enumValuesByColumn: Map<string, readonly string[]>;
  /** Column names flagged `pseudoEnumCandidate` from stats (§4.2); empty when no stats. */
  pseudoEnumColumns: Set<string>;
}

interface SchemaIndex {
  tables: Map<string, TableIndex>;
  /** Signatures of declared FK relations (columns order-insensitive). */
  declaredRelations: Set<string>;
  stubTables: Set<string>;
}

function relationSignature(
  fromTable: string,
  fromColumns: readonly string[],
  toTable: string,
  toColumns: readonly string[],
): string {
  const from = [...fromColumns].sort().join(',');
  const to = [...toColumns].sort().join(',');
  return `${fromTable}|${from}=>${toTable}|${to}`;
}

function buildSchemaIndex(
  model: DatabaseModel,
  stubTables: readonly string[],
  stats: readonly StatsResult[],
): SchemaIndex {
  const enumValuesById = new Map(model.enums.map((e) => [e.id, e.values] as const));
  const distinctCount = distinctCountByColumn(stats, model.defaultSchema);
  const tables = new Map<string, TableIndex>();

  for (const table of model.tables) {
    const columns = new Map<string, ColumnModel>();
    const enumValuesByColumn = new Map<string, readonly string[]>();
    const pseudoEnumColumns = new Set<string>();
    for (const column of table.columns) {
      columns.set(column.name, column);
      if (column.enumRef !== null) {
        const values = enumValuesById.get(column.enumRef);
        if (values) enumValuesByColumn.set(column.name, values);
      }
      if (isPseudoEnumCandidate(column, distinctCount(table.id, column.name))) {
        pseudoEnumColumns.add(column.name);
      }
    }
    tables.set(table.id, {
      id: table.id,
      columns,
      columnNames: new Set(columns.keys()),
      primaryKey: table.primaryKey,
      enumValuesByColumn,
      pseudoEnumColumns,
    });
  }

  const declaredRelations = new Set<string>();
  for (const relation of model.relations) {
    if (relation.kind === 'inferred-name' || relation.kind === 'inferred-join-table') continue;
    declaredRelations.add(
      relationSignature(
        relation.from.tableId,
        relation.from.columns,
        relation.to.tableId,
        relation.to.columns,
      ),
    );
  }
  // Column-level FK mirrors count as declared relations too (belt-and-braces:
  // some imports carry references without a materialized Relation row).
  for (const table of model.tables) {
    for (const column of table.columns) {
      if (column.references !== null) {
        declaredRelations.add(
          relationSignature(
            table.id,
            [column.name],
            column.references.tableId,
            [column.references.column],
          ),
        );
      }
    }
  }

  return { tables, declaredRelations, stubTables: new Set(stubTables) };
}

function isEnumLikeColumn(column: ColumnModel, table: TableIndex): boolean {
  if (column.logicalType === 'enum' || column.enumRef !== null) return true;
  if (table.enumValuesByColumn.has(column.name)) return true;
  // §7.3 row 4: a low-cardinality text column the prompt flagged
  // `pseudoEnumCandidate` is a legitimate enum target even without a declared
  // DB enum/CHECK — the prompt explicitly asks the model to classify it.
  if (table.pseudoEnumColumns.has(column.name)) return true;
  const semantics = column.semantics;
  return (
    semantics !== null &&
    (semantics.primary === 'status-workflow' || semantics.primary === 'category-enum')
  );
}

/** `(tableId, column) → distinctCount | null`, built from the run's stats (§4.2). */
function distinctCountByColumn(
  stats: readonly StatsResult[],
  defaultSchema: string,
): (tableId: string, column: string) => number | null {
  const map = new Map<string, number | null>();
  for (const result of stats) {
    const tableId = qualifyTableRef(result.table, defaultSchema);
    for (const column of result.columns) map.set(`${tableId} ${column.column}`, column.distinctCount);
  }
  return (tableId, column) => map.get(`${tableId} ${column}`) ?? null;
}

/**
 * Mirror of the serializer's `pseudoEnumCandidate` rule (§4.2): a non-PII,
 * non-secret text/varchar column with no declared enum whose distinctCount is at
 * or below {@link PSEUDO_ENUM_MAX_DISTINCT}. Kept in lockstep with the prompt via
 * the shared threshold so what the prompt flags is exactly what validation accepts.
 */
function isPseudoEnumCandidate(column: ColumnModel, distinctCount: number | null): boolean {
  const isText = column.logicalType === 'text' || column.logicalType === 'varchar';
  const pii = (column.semantics?.flags.pii ?? null) !== null;
  const secret = column.semantics?.flags.secret ?? false;
  return (
    isText &&
    !pii &&
    !secret &&
    column.enumRef === null &&
    distinctCount !== null &&
    distinctCount <= PSEUDO_ENUM_MAX_DISTINCT
  );
}

function isSurrogatePk(table: TableIndex, columnName: string): boolean {
  if (table.primaryKey.length !== 1 || table.primaryKey[0] !== columnName) return false;
  const column = table.columns.get(columnName);
  if (!column) return false;
  if (column.logicalType === 'uuid') return true;
  if (column.default?.kind === 'autoincrement') return true;
  return SURROGATE_PK_TYPES.has(column.logicalType);
}

function typesCompatible(a: LogicalType, b: LogicalType): boolean {
  if (a === b) return true;
  if (NUMERIC_TYPES.has(a) && NUMERIC_TYPES.has(b)) return true;
  if (TEMPORAL_TYPES.has(a) && TEMPORAL_TYPES.has(b)) return true;
  const textish: ReadonlySet<LogicalType> = new Set<LogicalType>(['text', 'varchar', 'uuid']);
  return textish.has(a) && textish.has(b);
}

function toIconSet(icons: ReferentialContext['allowedIcons']): ReadonlySet<string> | null {
  if (icons === undefined) return null;
  return icons instanceof Set ? icons : new Set(icons);
}

/* --------------------------------------------------------------- the check */

export interface ReferentialResult {
  errors: LlmValidationError[];
  warnings: LlmValidationError[];
  prunes: ResponsePrunes;
}

/**
 * Run the exhaustive §7.3 cross-checks. Produces per-item errors + warnings and
 * the {@link ResponsePrunes} the caller applies with {@link applyPrunes}. Never
 * throws and never mutates `response`.
 */
export function runReferentialChecks(
  response: LlmResponseV1,
  ctx: ReferentialContext,
): ReferentialResult {
  const index = buildSchemaIndex(ctx.snapshot, ctx.stubTables ?? [], ctx.stats ?? []);
  const iconSet = toIconSet(ctx.allowedIcons);
  const errors: LlmValidationError[] = [];
  const warnings: LlmValidationError[] = [];
  const prunes = createPrunes();

  checkTables(response, ctx, index, iconSet, errors, warnings, prunes);
  checkEnums(response, index, errors, prunes);
  checkRelations(response, index, errors, prunes);
  checkNavGroups(response, index, iconSet, errors, warnings, prunes);
  checkDashboards(response, index, ctx, errors, prunes);
  // Last: it reads `prunes` to skip items the checks above already dropped, so a
  // collision with a discarded table/group/dashboard is never reported.
  checkLabelCollisions(response, warnings, prunes);

  return { errors, warnings, prunes };
}

/**
 * Warn when one `en_US` label is reused across a table, a nav group and/or a
 * dashboard (prompt v1.2, decisions 1 + 7).
 *
 * Each of the three becomes its own routed page or nav entry — `generate/crud.ts`
 * titles a table's CRUD page from the table label, and
 * `llm/apply-service.ts#upsertDashboardPage` titles a dashboard page from
 * `label.en_US` — so a reused string ships two pages a human cannot tell apart in
 * the nav. This is a WARNING, not an item error: dropping a whole dashboard (and
 * its ranked widgets) over a naming clash costs far more than it fixes, and the
 * §7.2 review diff is where a human retitles it before anything is applied.
 *
 * Comparison is trimmed + case-folded: "Knowledge base" and "Knowledge Base"
 * collide in the nav exactly as identical strings do.
 */
function checkLabelCollisions(
  response: LlmResponseV1,
  warnings: LlmValidationError[],
  prunes: ResponsePrunes,
): void {
  /** First claimant of a folded label, in table → group → dashboard precedence. */
  const claimed = new Map<string, string>();
  const fold = (label: string): string => label.trim().toLowerCase();

  const claim = (raw: string | undefined, owner: string, path: string, sid?: string): void => {
    if (raw === undefined || raw.trim() === '') return;
    const key = fold(raw);
    const holder = claimed.get(key);
    if (holder === undefined) {
      claimed.set(key, owner);
      return;
    }
    warnings.push(
      makeError(
        'LLM_LABEL_COLLISION',
        path,
        `Label "${raw}" is already used by ${holder}; ${owner} reuses it. Each becomes its own page or nav entry, so both would appear under the same name. Rename one before applying.`,
        sid === undefined ? undefined : { suggestionId: sid },
      ),
    );
  };

  // Tables first: their CRUD pages are always generated, so they hold the name.
  response.tables.forEach((table, i) => {
    if (prunes.tables.has(i)) return;
    claim(table.label.en_US, `table "${table.table}"`, `tables[${i}].label.en_US`, tableLabelId(table.table));
  });

  response.navGroups.forEach((group, i) => {
    if (prunes.navGroups.has(i)) return;
    claim(group.label.en_US, `nav group "${group.id}"`, `navGroups[${i}].label.en_US`, groupSuggestionId(group.id));
  });

  response.dashboards.forEach((dashboard, i) => {
    if (prunes.dashboards.has(i)) return;
    claim(
      dashboard.label.en_US,
      `dashboard "${dashboard.id}"`,
      `dashboards[${i}].label.en_US`,
      undefined,
    );
  });
}

function checkTables(
  response: LlmResponseV1,
  ctx: ReferentialContext,
  index: SchemaIndex,
  iconSet: ReadonlySet<string> | null,
  errors: LlmValidationError[],
  warnings: LlmValidationError[],
  prunes: ResponsePrunes,
): void {
  response.tables.forEach((table, i) => {
    const known = index.tables.get(table.table);
    if (!known || index.stubTables.has(table.table)) {
      const dependents = countDependentWidgets(response, table.table);
      const suffix =
        dependents > 0
          ? ` ${dependents} dependent widget suggestion${dependents === 1 ? '' : 's'} bound to it ${dependents === 1 ? 'was' : 'were'} also dropped.`
          : '';
      const reason = index.stubTables.has(table.table)
        ? `"${table.table}" is a stub (context-only) table; emit no suggestions for it.`
        : `"${table.table}" does not exist in this schema snapshot.`;
      errors.push(
        makeError('LLM_UNKNOWN_TABLE', `tables[${i}].table`, `${reason} The suggestion was discarded.${suffix}`, {
          suggestionId: tableLabelId(table.table),
        }),
      );
      prunes.tables.add(i);
      return;
    }

    // Columns
    table.columns.forEach((column, j) => {
      if (!known.columnNames.has(column.column)) {
        errors.push(
          makeError(
            'LLM_UNKNOWN_COLUMN',
            `tables[${i}].columns[${j}].column`,
            `Column "${column.column}" does not exist on "${table.table}". The suggestion was discarded.`,
            { suggestionId: columnLabelId(table.table, column.column) },
          ),
        );
        addNested(prunes.columns, i, j);
      }
    });

    // Display column
    if (table.displayColumn !== null) {
      if (!known.columnNames.has(table.displayColumn)) {
        errors.push(
          makeError(
            'LLM_UNKNOWN_COLUMN',
            `tables[${i}].displayColumn`,
            `Display column "${table.displayColumn}" does not exist on "${table.table}".`,
            { suggestionId: keyId(table.table) },
          ),
        );
        prunes.nullDisplayColumn.add(i);
      } else if (isSurrogatePk(known, table.displayColumn)) {
        errors.push(
          makeError(
            'LLM_BAD_DISPLAY_COLUMN',
            `tables[${i}].displayColumn`,
            `Display column "${table.displayColumn}" is the surrogate primary key of "${table.table}" — a human cannot read it. The suggestion was discarded.`,
            { suggestionId: keyId(table.table) },
          ),
        );
        prunes.nullDisplayColumn.add(i);
      }
    }

    // Natural key
    if (table.naturalKey !== null) {
      const missing = table.naturalKey.find((col) => !known.columnNames.has(col));
      if (missing !== undefined) {
        errors.push(
          makeError(
            'LLM_UNKNOWN_COLUMN',
            `tables[${i}].naturalKey`,
            `Natural-key column "${missing}" does not exist on "${table.table}".`,
            { suggestionId: keyId(table.table) },
          ),
        );
        prunes.nullNaturalKey.add(i);
      }
    }

    // Page templates
    table.pageTemplates.forEach((template, k) => {
      if (template.template === 'page-crud') {
        errors.push(
          makeError(
            'LLM_UNKNOWN_TEMPLATE',
            `tables[${i}].pageTemplates[${k}].template`,
            '"page-crud" is always generated and must never be recommended. The suggestion was discarded.',
            { suggestionId: templateSuggestionId(table.table, template.template) },
          ),
        );
        addNested(prunes.pageTemplates, i, k);
      } else if (!ctx.allowedTemplates.includes(template.template)) {
        errors.push(
          makeError(
            'LLM_UNKNOWN_TEMPLATE',
            `tables[${i}].pageTemplates[${k}].template`,
            `"${template.template}" is not an allowed page template. The suggestion was discarded.`,
            { suggestionId: templateSuggestionId(table.table, template.template) },
          ),
        );
        addNested(prunes.pageTemplates, i, k);
      }
    });

    // Icon (warning + fallback; Zod already enforced kebab-case)
    if (iconSet && !iconSet.has(table.icon)) {
      warnings.push(
        makeError(
          'LLM_UNKNOWN_ICON',
          `tables[${i}].icon`,
          `Icon "${table.icon}" is not in the bundled lucide manifest; falling back to "${FALLBACK_ICON}".`,
          { suggestionId: tableLabelId(table.table) },
        ),
      );
      prunes.fallbackTableIcon.add(i);
    }
  });
}

function checkEnums(
  response: LlmResponseV1,
  index: SchemaIndex,
  errors: LlmValidationError[],
  prunes: ResponsePrunes,
): void {
  response.enums.forEach((enumeration, i) => {
    const sid = enumSuggestionId(enumeration.table, enumeration.column);
    const known = index.tables.get(enumeration.table);
    if (!known || index.stubTables.has(enumeration.table)) {
      const reason = index.stubTables.has(enumeration.table)
        ? `"${enumeration.table}" is a stub (context-only) table; emit no suggestions for it.`
        : `"${enumeration.table}" does not exist in this schema snapshot, so it has no enum column.`;
      errors.push(
        makeError('LLM_NOT_AN_ENUM', `enums[${i}].table`, `${reason} The suggestion was discarded.`, {
          suggestionId: sid,
        }),
      );
      prunes.enums.add(i);
      return;
    }
    const column = known.columns.get(enumeration.column);
    if (!column) {
      errors.push(
        makeError(
          'LLM_NOT_AN_ENUM',
          `enums[${i}].column`,
          `Column "${enumeration.column}" does not exist on "${enumeration.table}". The suggestion was discarded.`,
          { suggestionId: sid },
        ),
      );
      prunes.enums.add(i);
      return;
    }
    if (!isEnumLikeColumn(column, known)) {
      errors.push(
        makeError(
          'LLM_NOT_AN_ENUM',
          `enums[${i}].column`,
          `Column "${enumeration.table}.${enumeration.column}" is not enum-like in the snapshot (no enum type, CHECK constraint or low-cardinality flag). The suggestion was discarded.`,
          { suggestionId: sid },
        ),
      );
      prunes.enums.add(i);
      return;
    }

    // Value-set checks — only possible when the catalog knows the values.
    const values = known.enumValuesByColumn.get(enumeration.column);
    if (!values) return;
    const valueSet = new Set(values);

    if (enumeration.order !== null && !isPermutation(enumeration.order, values)) {
      errors.push(
        makeError(
          'LLM_ENUM_VALUES',
          `enums[${i}].order`,
          `"order" must be a permutation of the declared values [${values.join(', ')}]. The suggestion was discarded.`,
          { suggestionId: sid },
        ),
      );
      prunes.enums.add(i);
      return;
    }

    const toneKeys = Object.keys(enumeration.tones);
    if (toneKeys.length !== valueSet.size || toneKeys.some((k) => !valueSet.has(k))) {
      errors.push(
        makeError(
          'LLM_ENUM_VALUES',
          `enums[${i}].tones`,
          `"tones" must map exactly the declared values [${values.join(', ')}], no more, no fewer. The suggestion was discarded.`,
          { suggestionId: sid },
        ),
      );
      prunes.enums.add(i);
      return;
    }

    if (enumeration.terminal) {
      const stray = enumeration.terminal.find((v) => !valueSet.has(v));
      if (stray !== undefined) {
        errors.push(
          makeError(
            'LLM_ENUM_VALUES',
            `enums[${i}].terminal`,
            `Terminal value "${stray}" is not among the declared values [${values.join(', ')}]. The suggestion was discarded.`,
            { suggestionId: sid },
          ),
        );
        prunes.enums.add(i);
      }
    }
  });
}

function checkRelations(
  response: LlmResponseV1,
  index: SchemaIndex,
  errors: LlmValidationError[],
  prunes: ResponsePrunes,
): void {
  response.relations.confirmed.forEach((relation, i) => {
    const signature = relationSignature(
      relation.fromTable,
      relation.fromColumns,
      relation.toTable,
      relation.toColumns,
    );
    if (!index.declaredRelations.has(signature)) {
      errors.push(
        makeError(
          'LLM_UNKNOWN_RELATION',
          `relations.confirmed[${i}]`,
          `No declared relation "${relation.fromTable}.${relation.fromColumns.join(',')}" → "${relation.toTable}.${relation.toColumns.join(',')}" exists in the snapshot; a confirmation must reference a declared foreign key. The suggestion was discarded.`,
          {
            suggestionId: relationId(
              relation.fromTable,
              relation.fromColumns,
              relation.toTable,
              relation.toColumns,
            ),
          },
        ),
      );
      prunes.confirmedRelations.add(i);
    }
  });

  response.relations.inferred.forEach((relation, i) => {
    const sid = relationId(
      relation.fromTable,
      relation.fromColumns,
      relation.toTable,
      relation.toColumns,
    );
    const from = index.tables.get(relation.fromTable);
    const to = index.tables.get(relation.toTable);
    const missingEndpoint =
      !from ||
      !to ||
      relation.fromColumns.some((c) => !from.columnNames.has(c)) ||
      relation.toColumns.some((c) => !to.columnNames.has(c));
    if (missingEndpoint) {
      errors.push(
        makeError(
          'LLM_RELATION_INVALID',
          `relations.inferred[${i}]`,
          `Inferred relation endpoints do not all exist: "${relation.fromTable}.${relation.fromColumns.join(',')}" → "${relation.toTable}.${relation.toColumns.join(',')}". The suggestion was discarded.`,
          { suggestionId: sid },
        ),
      );
      prunes.inferredRelations.add(i);
      return;
    }

    const signature = relationSignature(
      relation.fromTable,
      relation.fromColumns,
      relation.toTable,
      relation.toColumns,
    );
    if (index.declaredRelations.has(signature)) {
      errors.push(
        makeError(
          'LLM_RELATION_INVALID',
          `relations.inferred[${i}]`,
          `Inferred relation duplicates a relation already declared as a foreign key; it must be listed as confirmed, not inferred. The suggestion was discarded.`,
          { suggestionId: sid },
        ),
      );
      prunes.inferredRelations.add(i);
      return;
    }

    const incompatible = relation.fromColumns.some((fromCol, k) => {
      const toCol = relation.toColumns[k];
      if (toCol === undefined) return false;
      const fromType = from.columns.get(fromCol)?.logicalType;
      const toType = to.columns.get(toCol)?.logicalType;
      return fromType !== undefined && toType !== undefined && !typesCompatible(fromType, toType);
    });
    if (incompatible) {
      errors.push(
        makeError(
          'LLM_RELATION_INVALID',
          `relations.inferred[${i}]`,
          `Inferred relation joins columns of incompatible types. The suggestion was discarded.`,
          { suggestionId: sid },
        ),
      );
      prunes.inferredRelations.add(i);
    }
  });
}

function checkNavGroups(
  response: LlmResponseV1,
  index: SchemaIndex,
  iconSet: ReadonlySet<string> | null,
  errors: LlmValidationError[],
  warnings: LlmValidationError[],
  prunes: ResponsePrunes,
): void {
  const seenIds = new Set<string>();
  const tableToGroup = new Map<string, number>();

  response.navGroups.forEach((group, i) => {
    if (seenIds.has(group.id)) {
      errors.push(
        makeError(
          'LLM_GROUP_INVALID',
          `navGroups[${i}].id`,
          `Duplicate nav-group id "${group.id}"; ids must be unique. The group was discarded.`,
          { suggestionId: groupSuggestionId(group.id) },
        ),
      );
      prunes.navGroups.add(i);
      return;
    }

    const unknown = group.tables.find((t) => !index.tables.get(t) || index.stubTables.has(t));
    if (unknown !== undefined) {
      errors.push(
        makeError(
          'LLM_GROUP_INVALID',
          `navGroups[${i}].tables`,
          `Nav group "${group.id}" references "${unknown}", which is not a table in this schema snapshot. The group was discarded.`,
          { suggestionId: groupSuggestionId(group.id) },
        ),
      );
      prunes.navGroups.add(i);
      return;
    }

    const claimed = group.tables.find((t) => tableToGroup.has(t));
    if (claimed !== undefined) {
      errors.push(
        makeError(
          'LLM_GROUP_INVALID',
          `navGroups[${i}].tables`,
          `Table "${claimed}" already belongs to nav group "${response.navGroups[tableToGroup.get(claimed) ?? 0]?.id ?? ''}"; every table must appear in exactly one group. The group was discarded.`,
          { suggestionId: groupSuggestionId(group.id) },
        ),
      );
      prunes.navGroups.add(i);
      return;
    }

    // Survives: claim its id + tables.
    seenIds.add(group.id);
    for (const t of group.tables) tableToGroup.set(t, i);

    if (iconSet && !iconSet.has(group.icon)) {
      warnings.push(
        makeError(
          'LLM_UNKNOWN_ICON',
          `navGroups[${i}].icon`,
          `Icon "${group.icon}" is not in the bundled lucide manifest; falling back to "${FALLBACK_ICON}".`,
          { suggestionId: groupSuggestionId(group.id) },
        ),
      );
      prunes.fallbackNavIcon.add(i);
    }
  });
}

function checkDashboards(
  response: LlmResponseV1,
  index: SchemaIndex,
  ctx: ReferentialContext,
  errors: LlmValidationError[],
  prunes: ResponsePrunes,
): void {
  response.dashboards.forEach((dashboard, i) => {
    dashboard.widgets.forEach((widget, k) => {
      const sid = widgetSuggestionId(dashboard.id, widget.widget, widget.rank);
      const path = `dashboards[${i}].widgets[${k}]`;

      if (!ctx.allowedWidgets.includes(widget.widget)) {
        errors.push(
          makeError(
            'LLM_UNKNOWN_WIDGET',
            `${path}.widget`,
            `Widget "${widget.widget}" is not in the allowed dashboard-widget set. The suggestion was discarded.`,
            { suggestionId: sid },
          ),
        );
        addNested(prunes.widgets, i, k);
        return;
      }

      const table = index.tables.get(widget.table);
      if (!table || index.stubTables.has(widget.table)) {
        const reason = index.stubTables.has(widget.table)
          ? `Widget binds to "${widget.table}", a stub (context-only) table; emit no suggestions for it.`
          : `Widget binds to "${widget.table}", which is not a table in this schema snapshot.`;
        errors.push(
          makeError('LLM_WIDGET_BINDING', `${path}.table`, `${reason} The suggestion was discarded.`, {
            suggestionId: sid,
          }),
        );
        addNested(prunes.widgets, i, k);
        return;
      }

      const boundColumn = (field: 'metricColumn' | 'dimensionColumn' | 'timeColumn'): boolean => {
        const value = widget[field];
        if (value === undefined) return true;
        if (!table.columnNames.has(value)) {
          errors.push(
            makeError(
              'LLM_WIDGET_BINDING',
              `${path}.${field}`,
              `Column "${value}" does not exist on "${widget.table}". The suggestion was discarded.`,
              { suggestionId: sid },
            ),
          );
          addNested(prunes.widgets, i, k);
          return false;
        }
        return true;
      };

      if (!boundColumn('metricColumn')) return;
      if (!boundColumn('dimensionColumn')) return;
      if (!boundColumn('timeColumn')) return;

      if (widget.agg !== undefined && NUMERIC_AGGS.has(widget.agg) && widget.metricColumn !== undefined) {
        const type = table.columns.get(widget.metricColumn)?.logicalType;
        if (type !== undefined && !NUMERIC_TYPES.has(type)) {
          errors.push(
            makeError(
              'LLM_WIDGET_BINDING',
              `${path}.metricColumn`,
              `Aggregation "${widget.agg}" needs a numeric metric column, but "${widget.metricColumn}" is ${type}. The suggestion was discarded.`,
              { suggestionId: sid },
            ),
          );
          addNested(prunes.widgets, i, k);
          return;
        }
      }

      if (widget.timeColumn !== undefined) {
        const type = table.columns.get(widget.timeColumn)?.logicalType;
        if (type !== undefined && !TEMPORAL_TYPES.has(type)) {
          errors.push(
            makeError(
              'LLM_WIDGET_BINDING',
              `${path}.timeColumn`,
              `Time column "${widget.timeColumn}" is ${type}, not a date/time type. The suggestion was discarded.`,
              { suggestionId: sid },
            ),
          );
          addNested(prunes.widgets, i, k);
        }
      }
    });
  });
}

/* ---------------------------------------------------------------- helpers */

function isPermutation(candidate: readonly string[], values: readonly string[]): boolean {
  if (candidate.length !== values.length) return false;
  const remaining = new Map<string, number>();
  for (const v of values) remaining.set(v, (remaining.get(v) ?? 0) + 1);
  for (const c of candidate) {
    const count = remaining.get(c);
    if (count === undefined || count === 0) return false;
    remaining.set(c, count - 1);
  }
  return true;
}

function countDependentWidgets(response: LlmResponseV1, tableName: string): number {
  let count = 0;
  for (const dashboard of response.dashboards) {
    for (const widget of dashboard.widgets) {
      if (widget.table === tableName) count += 1;
    }
  }
  return count;
}

/* ----------------------------------------------------------- apply prunes */

/**
 * Produce a cleaned response with every pruned suggestion removed. Table drops
 * cascade: a dropped table also removes its enum suggestions and the dashboard
 * widgets bound to it (acceptance criterion 4). Never mutates `response`.
 */
export function applyPrunes(response: LlmResponseV1, prunes: ResponsePrunes): LlmResponseV1 {
  const droppedTableNames = new Set<string>();
  for (const i of prunes.tables) {
    const name = response.tables[i]?.table;
    if (name !== undefined) droppedTableNames.add(name);
  }

  const tables = response.tables
    .map((table, i) => {
      if (prunes.tables.has(i)) return null;
      const droppedColumns = prunes.columns.get(i);
      const droppedTemplates = prunes.pageTemplates.get(i);
      const next: LlmResponseV1['tables'][number] = {
        ...table,
        columns: table.columns.filter((_, j) => !droppedColumns?.has(j)),
        pageTemplates: table.pageTemplates.filter((_, k) => !droppedTemplates?.has(k)),
      };
      if (prunes.nullDisplayColumn.has(i)) next.displayColumn = null;
      if (prunes.nullNaturalKey.has(i)) next.naturalKey = null;
      if (prunes.dropMicrocopy.has(i)) delete next.microcopy;
      if (prunes.fallbackTableIcon.has(i)) next.icon = FALLBACK_ICON;
      return next;
    })
    .filter((t): t is LlmResponseV1['tables'][number] => t !== null);

  const enums = response.enums.filter(
    (enumeration, i) => !prunes.enums.has(i) && !droppedTableNames.has(enumeration.table),
  );

  const confirmed = response.relations.confirmed.filter(
    (_, i) => !prunes.confirmedRelations.has(i),
  );
  const inferred = response.relations.inferred.filter((_, i) => !prunes.inferredRelations.has(i));

  const navGroups = response.navGroups
    .map((group, i) => {
      if (prunes.navGroups.has(i)) return null;
      if (prunes.fallbackNavIcon.has(i)) return { ...group, icon: FALLBACK_ICON };
      return group;
    })
    .filter((g): g is LlmResponseV1['navGroups'][number] => g !== null);

  const dashboards = response.dashboards
    .map((dashboard, i) => {
      if (prunes.dashboards.has(i)) return null;
      const droppedWidgets = prunes.widgets.get(i);
      return {
        ...dashboard,
        widgets: dashboard.widgets.filter(
          (widget, k) => !droppedWidgets?.has(k) && !droppedTableNames.has(widget.table),
        ),
      };
    })
    .filter((d): d is LlmResponseV1['dashboards'][number] => d !== null);

  return {
    ...response,
    tables,
    enums,
    relations: { confirmed, inferred },
    navGroups,
    dashboards,
  };
}
