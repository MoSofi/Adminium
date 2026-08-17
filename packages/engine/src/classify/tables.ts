// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Table-shape classification — 05-introspection-engine.md §8 (roles) plus
 * the §6 structural detectors that live at table granularity: join-table
 * detection (rule 2), self-FK hierarchy (rule 3), and the polymorphic
 * pattern flag (rule 4). Also selects each table's display column and
 * natural key, which the generator uses for FK chips, cards, and detail
 * titles (research/widget-registry.md §15).
 *
 * Two outputs per table:
 *  - `semantics`: the persisted `TableSemantics` (role/hierarchy/polymorphic
 *    per the schema-model enum: entity | join-table | log | people |
 *    messages | line-items | system).
 *  - `shape`: the broader generator-facing `TableShape` kind used by
 *    template scoring (people | workflow | events | catalog | join | log |
 *    settings | geo | generic) with human-readable reasons.
 */
import type {
  ColumnModel,
  DatabaseModel,
  TableModel,
  TableSemantics,
} from '../schema-model.js';
import {
  buildColumnClassifyContext,
  classifyColumn,
  PEOPLE_TABLE_RE,
  type ClassifiedColumn,
} from './columns.js';
import { normalizeName } from './names.js';

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export const TABLE_SHAPE_KINDS = [
  'people',
  'workflow',
  'events',
  'catalog',
  'join',
  'log',
  'settings',
  'geo',
  'generic',
] as const;
export type TableShapeKind = (typeof TABLE_SHAPE_KINDS)[number];

export interface TableShape {
  kind: TableShapeKind;
  reasons: string[];
}

export interface ClassifiedTable {
  tableId: string;
  shape: TableShape;
  semantics: TableSemantics;
  /**
   * First text-ish unique/title/name column — what grids, FK chips, and
   * detail headers render for a row. Null when the table has no text-ish
   * candidate (pure join tables, numeric-only tables).
   */
  displayColumn: string | null;
  /** First unique text-ish column (slug/email/username/code) — human key. */
  naturalKey: string | null;
  columns: ClassifiedColumn[];
}

// ---------------------------------------------------------------------------
// Vocab
// ---------------------------------------------------------------------------

/**
 * Tables the connect wizard keeps out of the picker by default — 05 §8.2.
 *
 * Three kinds, none of which anyone wants CRUD pages over: Adminium's own
 * `adminium_*` store, which lands in the SOURCE database whenever the meta
 * store is placed there (a supported 01 §3.1 configuration); other tools'
 * migration bookkeeping; and join tables, which exist to be traversed rather
 * than edited. Generation already declines to page all three —
 * `filterModelToIncludedTables` keeps them in the graph for M2M detection and
 * nothing else — so offering them only ever produced a selection that could
 * not be honoured.
 *
 * It lives HERE, beside the classifier that assigns the roles, because both
 * front doors have to agree on it. The Studio hid them from its first commit
 * while the CLI wizard listed `adminium_users` as a table to build an admin
 * panel over, which is precisely the drift "one code path, two front doors"
 * exists to prevent. Structurally typed so a caller holding a stored snapshot
 * (whose tables are parsed, not `TableModel` instances) can use it too.
 */
export function isPreHiddenTable(table: {
  system?: boolean | null | undefined;
  semantics?: { role?: string | null | undefined } | null | undefined;
}): boolean {
  const role = table.semantics?.role ?? 'entity';
  return table.system === true || role === 'join-table' || role === 'system';
}

/** §8 trigger: `page-log-viewer` name pattern. */
const LOG_TABLE_RE = /(^|_)(audit|logs?|events?|history|deliveries)(_|$)/;
const SETTINGS_TABLE_RE = /(^|_)(settings?|preferences?|configs?|configurations?|options)(_|$)/;
/** §8.2 system-table vocabulary. */
const SYSTEM_TABLE_RE =
  /^(adminium_.*|_prisma_migrations|schema_migrations|ar_internal_metadata|django_migrations|knex_migrations.*|sqlite_sequence|mysql\..*)$/;
/** §6 rule 3 — self-FK column names that imply a hierarchy. */
const HIERARCHY_COLUMN_RE = /^(parent|manager|supervisor|reports_to|superior)(_id)?$/;
/** Join-table "allowed extra" columns (§6 rule 2). */
const POSITION_RE = /^(position|sort_order|rank|ordering)$/;
/** Line-items detection: quantity × rate numerics on a 2-FK child table. */
const QTY_RE = /(^|_)(qty|quantity|units|count)(_|$)/;
const RATE_RE = /(^|_)(price|rate|amount|cost|unit_price)(_|$)/;
/** Messages detection: sender FK + body text + created-at. */
const SENDER_RE = /(^|_)(sender|author|user|from_user|creator)(_id)?$/;
const BODY_RE = /^(body|message|content|text)$/;
/** §8 log shape: "verb-ish text" = a short action/event/verb column. */
const VERBISH_RE = /(^|_)(action|event|activity|verb|operation)(_type|_name)?(_|$)/;
/** Events-shaped table names (guards the calendar trigger against orders-like tables). */
const EVENTS_TABLE_RE =
  /(^|_)(events?|meetings?|appointments?|schedules?|shifts?|bookings?|sessions?|releases?)(_|$)/;
/** Display-column name preference. */
const TITLE_RE = /^(title|name|label|subject|headline|summary)$/;
const TITLE_SUFFIX_RE = /_(title|name|label|subject)$/;

const TEXTISH = new Set(['text', 'varchar']);

// ---------------------------------------------------------------------------
// §6 rule 2 — join-table detection (M2M)
// ---------------------------------------------------------------------------

export interface JoinTableResult {
  isJoin: boolean;
  confidence: number;
  fkColumns: string[];
  reasons: string[];
}

/**
 * Accepted-relation threshold (05 §6). The SAME number lives in
 * classify/columns.ts, infer/relations.ts and generate/domains.ts; all four
 * move together or the model means different things to different readers.
 */
const ACCEPTED_RELATION_CONFIDENCE = 0.8;

/**
 * The column view {@link detectJoinTable} must be given — its FK test read
 * through two lenses, not one.
 *
 * `detectJoinTable` looks for `semantics.primary === 'fk'`, but §7.1 rule 2
 * (pk-id) precedes rule 3 (fk), so a composite-PK FK column — which is what
 * the canonical join table is made of — classifies as `pk-id` and is invisible
 * to it. The detector already compensates with a fallback to the DECLARED
 * `references` mirror. An INFERRED or overridden FK has no such mirror, so on
 * exactly the FK-less schemas `infer/relations.ts` exists for, a perfectly
 * obvious `order_products(order_id, product_id)` stayed an `entity`: rule 1
 * added both relations, rule 2 emitted the M2M from them, and then the table
 * classifier — reading raw `classifyColumn` output — could not see either.
 *
 * So accepted relations (≥ 0.8, non-M2M) are restated as `fk` here: the
 * inferred half of the same fallback. The override is LOCAL to join
 * detection and never reaches `ClassifiedTable.columns` — a composite-PK
 * column stays `pk-id` everywhere else, as §7.1 says it must.
 *
 * M2M relations are excluded on purpose: their `from.columns` are the TARGET
 * table's key columns, not FKs on the through table, so counting them would
 * make every table owning an M2M look like it had an extra FK.
 */
export function joinDetectionColumns(
  model: DatabaseModel,
  table: TableModel,
  columns: readonly ClassifiedColumn[],
): ClassifiedColumn[] {
  const fkColumns = new Set<string>();
  for (const relation of model.relations) {
    if (relation.through !== null) continue;
    if (relation.from.tableId !== table.id) continue;
    if (relation.confidence < ACCEPTED_RELATION_CONFIDENCE) continue;
    for (const column of relation.from.columns) fkColumns.add(column);
  }
  if (fkColumns.size === 0) return [...columns];
  return columns.map((column) =>
    column.semantics.primary === 'fk' || !fkColumns.has(column.column)
      ? column
      : { ...column, semantics: { ...column.semantics, primary: 'fk' as const } },
  );
}

/**
 * A table qualifies when: exactly 2 FK-like columns referencing two tables
 * (possibly the same one), and at most 2 additional columns drawn from
 * {surrogate id, created-at-classified, position/sort_order, one small
 * metadata column}. Boosters: composite PK/unique over the pair (+0.1),
 * name matching the two target names (+0.1). Base 0.7 → typical 0.8–0.9;
 * accepted at ≥ 0.8 (§6 thresholds).
 */
export function detectJoinTable(
  table: TableModel,
  columns: ClassifiedColumn[],
): JoinTableResult {
  const none: JoinTableResult = { isJoin: false, confidence: 0, fkColumns: [], reasons: [] };
  const byName = new Map(columns.map((c) => [c.column, c]));

  const fkCols = table.columns.filter((c) => byName.get(c.name)?.semantics.primary === 'fk'
    || (c.references !== null));
  // Composite-PK FK columns classify as pk-id (rule 2 precedes rule 3), so
  // count declared references too — the structural signal is the FK itself.
  const fkNames = [...new Set(fkCols.map((c) => c.name))];
  if (fkNames.length !== 2) return none;

  const extras = table.columns.filter((c) => !fkNames.includes(c.name));
  if (extras.length > 2) return none;
  let metadataBudget = 1;
  for (const extra of extras) {
    const name = normalizeName(extra.name);
    const primary = byName.get(extra.name)?.semantics.primary;
    const surrogateId = primary === 'pk-id';
    const createdAt = primary === 'created-at';
    const position = POSITION_RE.test(name);
    if (surrogateId || createdAt || position) continue;
    if (metadataBudget > 0) {
      metadataBudget -= 1;
      continue;
    }
    return none;
  }

  // Accumulate in integer hundredths — 0.7 + 0.1 must reach the 0.8 gate
  // exactly, not as 0.7999999999999999.
  let confidenceHundredths = 70;
  const reasons = [`exactly 2 FK columns (${fkNames.join(', ')}) and no other data columns`];

  const pairSet = new Set(fkNames);
  const coveredByPk =
    table.primaryKey.length === 2 && table.primaryKey.every((c) => pairSet.has(c));
  const coveredByUnique = table.uniques.some(
    (u) => u.columns.length === 2 && u.columns.every((c) => pairSet.has(c)),
  );
  if (coveredByPk || coveredByUnique) {
    confidenceHundredths += 10;
    reasons.push('composite PK/unique constraint covers the FK pair (+0.1)');
  }

  const targets = fkCols
    .map((c) => c.references?.tableId.split('.').pop() ?? '')
    .filter(Boolean)
    .map((t) => t.replace(/s$/, ''));
  if (targets.length === 2) {
    const tableName = normalizeName(table.name);
    const [a, b] = targets as [string, string];
    if (
      tableName.includes(a) && tableName.includes(b)
    ) {
      confidenceHundredths += 10;
      reasons.push('table name is composed of both target names (+0.1)');
    }
  }

  const confidence = Math.min(100, confidenceHundredths) / 100;
  return { isJoin: confidenceHundredths >= 80, confidence, fkColumns: fkNames, reasons };
}

// ---------------------------------------------------------------------------
// §6 rules 3–4 — hierarchy + polymorphic flags
// ---------------------------------------------------------------------------

function detectHierarchy(model: DatabaseModel, table: TableModel): { parentColumn: string } | null {
  for (const column of table.columns) {
    if (!HIERARCHY_COLUMN_RE.test(normalizeName(column.name))) continue;
    if (column.references?.tableId === table.id) return { parentColumn: column.name };
    const selfRelation = model.relations.some(
      (r) =>
        r.selfReferential &&
        r.from.tableId === table.id &&
        r.from.columns.includes(column.name) &&
        r.confidence >= ACCEPTED_RELATION_CONFIDENCE,
    );
    if (selfRelation) return { parentColumn: column.name };
  }
  return null;
}

function detectPolymorphic(
  model: DatabaseModel,
  table: TableModel,
): TableSemantics['polymorphic'] {
  const results: TableSemantics['polymorphic'] = [];
  const names = new Map(table.columns.map((c) => [normalizeName(c.name), c]));
  const tableNames = new Set(model.tables.map((t) => normalizeName(t.name)));
  const enumsById = new Map(model.enums.map((e) => [e.id, e]));

  for (const column of table.columns) {
    const name = normalizeName(column.name);
    const match = /^(?<base>[a-z0-9_]+)_type$/.exec(name);
    if (match?.groups === undefined) continue;
    if (!TEXTISH.has(column.logicalType) && column.logicalType !== 'enum') continue;
    const idColumn = names.get(`${match.groups['base']}_id`);
    if (idColumn === undefined) continue;
    // Rails-style `commentable_type/commentable_id` also matches this shape.
    let targets: string[] = [];
    if (column.enumRef !== null) {
      const values = enumsById.get(column.enumRef)?.values ?? [];
      targets = values.map((v) => normalizeName(v)).filter((v) => tableNames.has(v));
    }
    results.push({ typeColumn: column.name, idColumn: idColumn.name, targets });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Display column + natural key
// ---------------------------------------------------------------------------

function isTextish(column: ColumnModel): boolean {
  return TEXTISH.has(column.logicalType);
}

/**
 * Per 05 (assignment note): "first text-ish unique/title/name column".
 * Preference order: exact title/name → `_name`-suffixed → unique text-ish
 * (slug/email/username) → first text-ish non-PK non-secret column.
 */
export function selectDisplayColumn(
  table: TableModel,
  columns: ClassifiedColumn[],
): string | null {
  const secret = new Set(
    columns.filter((c) => c.semantics.flags.secret).map((c) => c.column),
  );
  const candidates = table.columns.filter(
    (c) => isTextish(c) && !c.isPrimaryKey && !secret.has(c.name),
  );
  const exact = candidates.find((c) => TITLE_RE.test(normalizeName(c.name)));
  if (exact) return exact.name;
  const suffixed = candidates.find((c) => TITLE_SUFFIX_RE.test(normalizeName(c.name)));
  if (suffixed) return suffixed.name;
  const unique = candidates.find((c) => c.isUnique);
  if (unique) return unique.name;
  return candidates[0]?.name ?? null;
}

/** First unique text-ish column — the human-facing natural key, if any. */
export function selectNaturalKey(table: TableModel, columns: ClassifiedColumn[]): string | null {
  const secret = new Set(
    columns.filter((c) => c.semantics.flags.secret).map((c) => c.column),
  );
  const singleColumnUniques = new Set(
    table.uniques.filter((u) => u.columns.length === 1).map((u) => u.columns[0]!),
  );
  const candidate = table.columns.find(
    (c) =>
      isTextish(c) &&
      !c.isPrimaryKey &&
      !secret.has(c.name) &&
      (c.isUnique || singleColumnUniques.has(c.name)),
  );
  return candidate?.name ?? null;
}

// ---------------------------------------------------------------------------
// Shape + role classification
// ---------------------------------------------------------------------------

/** Classify a single table (columns are classified as part of this). */
export function classifyTable(model: DatabaseModel, table: TableModel): ClassifiedTable {
  const ctx = buildColumnClassifyContext(model, table);
  const columns = table.columns.map((column) => classifyColumn(column, ctx));
  const primaryOf = (name: string) =>
    columns.find((c) => c.column === name)?.semantics.primary ?? 'plain';
  const has = (tag: string) => columns.some((c) => c.semantics.primary === tag);

  const join = detectJoinTable(table, joinDetectionColumns(model, table, columns));
  const hierarchy = detectHierarchy(model, table);
  const polymorphic = detectPolymorphic(model, table);
  const tableName = normalizeName(table.name);

  const reasons: string[] = [];
  let kind: TableShapeKind = 'generic';
  let role: TableSemantics['role'] = 'entity';

  const fkTargetIsPeopleish = (column: ColumnModel): boolean => {
    const target = column.references?.tableId;
    if (target === undefined || target === null) return false;
    const targetTable = model.tables.find((t) => t.id === target);
    return targetTable !== undefined && PEOPLE_TABLE_RE.test(normalizeName(targetTable.name));
  };
  const actorFk = table.columns.some(
    (c) =>
      (primaryOf(c.name) === 'fk' || c.references !== null) &&
      (SENDER_RE.test(normalizeName(c.name)) || fkTargetIsPeopleish(c)),
  );

  // -- precedence: structural/system signals first, generic last ----------
  if (table.system || SYSTEM_TABLE_RE.test(tableName)) {
    kind = 'generic';
    role = 'system';
    reasons.push('system/migration table (§8.2) — excluded and hidden by default');
  } else if (join.isJoin) {
    kind = 'join';
    role = 'join-table';
    reasons.push(...join.reasons, `join-table confidence ${join.confidence.toFixed(2)}`);
  } else if (
    LOG_TABLE_RE.test(tableName) ||
    (has('created-at') &&
      !has('updated-at') &&
      actorFk &&
      table.columns.some(
        (c) =>
          TEXTISH.has(c.logicalType) &&
          (c.maxLength === null || c.maxLength <= 64) &&
          VERBISH_RE.test(normalizeName(c.name)),
      ))
  ) {
    kind = 'log';
    role = 'log';
    reasons.push(
      LOG_TABLE_RE.test(tableName)
        ? 'table name matches audit/log/events/history vocabulary (§8)'
        : 'append-only shape: created-at + actor FK + text, no updated-at (§8)',
    );
  } else if (SETTINGS_TABLE_RE.test(tableName)) {
    kind = 'settings';
    reasons.push('table name matches settings/preferences vocabulary');
  } else if (ctx.peopleish && (has('person-name') || has('email'))) {
    kind = 'people';
    role = 'people';
    reasons.push('people shape: person-name/email columns on a people-ish table (§8 directory trigger)');
  } else if (has('status-workflow')) {
    kind = 'workflow';
    reasons.push('status-workflow enum present (§7.1 rule 7 → kanban trigger)');
  } else if (
    (has('event-timestamp') || has('date-range')) &&
    (EVENTS_TABLE_RE.test(tableName) || has('date-range'))
  ) {
    kind = 'events';
    reasons.push('event timestamps with an events-shaped name or start/end pair (§8 calendar trigger)');
  } else {
    // Line-items / messages roles are orthogonal to the remaining kinds.
    const geoColumns = columns.filter(
      (c) => c.semantics.primary === 'geo-region' || c.semantics.primary === 'geo-point',
    );
    const dataColumns = table.columns.filter((c) => !c.isPrimaryKey);
    if (
      geoColumns.length >= 2 &&
      dataColumns.length > 0 &&
      geoColumns.length / dataColumns.length >= 0.6
    ) {
      kind = 'geo';
      reasons.push(
        `${geoColumns.length}/${dataColumns.length} data columns are geographic (§7.1 rules 14–15)`,
      );
    } else {
      const displayColumn = selectDisplayColumn(table, columns);
      const catalogSignal = has('money') || has('category-enum') || has('image-url');
      if (displayColumn !== null && catalogSignal) {
        kind = 'catalog';
        reasons.push('display column plus money/category/image columns — catalog shape');
      } else {
        reasons.push('no §8 trigger matched');
      }
    }
  }

  // -- roles that refine `entity` without changing the shape kind ---------
  if (role === 'entity') {
    const fkCount = table.columns.filter((c) => c.references !== null).length;
    const hasQty = table.columns.some(
      (c) => QTY_RE.test(normalizeName(c.name)) && ['integer', 'bigint', 'decimal', 'float'].includes(c.logicalType),
    );
    const hasRate = table.columns.some(
      (c) => RATE_RE.test(normalizeName(c.name)) && ['integer', 'bigint', 'decimal', 'float'].includes(c.logicalType),
    );
    const hasBody = table.columns.some(
      (c) => BODY_RE.test(normalizeName(c.name)) && TEXTISH.has(c.logicalType),
    );
    if (fkCount >= 2 && hasQty && hasRate) {
      role = 'line-items';
      reasons.push('line-items role: child of 2 FKs with qty × rate numerics (§8 invoice trigger)');
    } else if (actorFk && hasBody && has('created-at')) {
      role = 'messages';
      reasons.push('messages role: sender FK + body text + created-at (§8 chat trigger)');
    }
  }

  const semantics: TableSemantics = { role, hierarchy, polymorphic };
  if (hierarchy !== null) {
    reasons.push(`self-FK hierarchy via "${hierarchy.parentColumn}" (§6 rule 3)`);
  }
  for (const p of polymorphic) {
    reasons.push(`polymorphic pair ${p.typeColumn}/${p.idColumn} (§6 rule 4 — no relation fabricated)`);
  }

  return {
    tableId: table.id,
    shape: { kind, reasons },
    semantics,
    displayColumn: selectDisplayColumn(table, columns),
    naturalKey: selectNaturalKey(table, columns),
    columns,
  };
}
