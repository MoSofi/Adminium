/**
 * Postgres introspection — 05-introspection-engine.md §4.1.
 *
 * Reads `pg_catalog`, not `information_schema` (too slow at 500 tables): a
 * FIXED set of 7 set-based catalog queries regardless of table count, joined
 * in memory. This module is executor-agnostic — `introspectPostgres` takes a
 * `CatalogExecutor` (any `sql → rows` function) so the assembly logic is
 * testable without the `pg` driver; `src/index.ts` wires it to the pool.
 *
 * THE "SCHEMA ONLY" INVARIANT (05 §10): every statement here references
 * `pg_catalog.*` exclusively — no user table is ever touched during setup.
 */
import {
  AdapterError,
  ENGINE_CAPABILITY_MATRIX,
  type AdapterCapabilities,
  type ColumnModel,
  type DatabaseModel,
  type EnumDef,
  type FkAction,
  type IndexModel,
  type IntrospectOptions,
  type ModelWarning,
  type Relation,
  type TableModel,
} from '@adminium/engine/adapter';

import { classifyDefault, mapPostgresType } from './type-map.js';

// ---------------------------------------------------------------------------
// Executor contract
// ---------------------------------------------------------------------------

export type CatalogRow = Record<string, unknown>;

/** Any `sql → rows` runner (the pg pool in production, psql in the harness). */
export type CatalogExecutor = (sql: string) => Promise<CatalogRow[]>;

export interface IntrospectContext {
  /** `adminium_connections` row id; falls back to the database name. */
  connectionId: string;
  /** `current_database()` — becomes `model.name`. */
  databaseName: string;
}

/**
 * Static dialect capabilities — 05 §2.1 (probe refines per-connection).
 * Canonical values live in the engine's capability matrix (M9-T04) so the
 * wizard's degradation copy and the adapter never disagree.
 */
export const POSTGRES_CAPABILITIES: AdapterCapabilities = {
  ...ENGINE_CAPABILITY_MATRIX.postgres,
};

/**
 * Session probe. Read-only detection per the M3 spec: recovery mode
 * (`pg_is_in_recovery()`), the session default
 * (`default_transaction_read_only`), or the role lacking CREATE on the
 * database (`has_database_privilege`).
 */
export const PROBE_SQL = `
SELECT current_setting('server_version') AS server_version,
       current_user AS role_name,
       pg_catalog.current_database() AS database_name,
       pg_catalog.pg_is_in_recovery() AS in_recovery,
       current_setting('default_transaction_read_only') AS default_read_only,
       pg_catalog.has_database_privilege(pg_catalog.current_database(), 'CREATE') AS can_create,
       COALESCE(
         (SELECT s.ssl FROM pg_catalog.pg_stat_ssl s WHERE s.pid = pg_catalog.pg_backend_pid()),
         false
       ) AS ssl`;

export interface ProbeResult {
  serverVersion: string;
  roleName: string;
  databaseName: string;
  readOnly: boolean;
  canCreate: boolean;
  ssl: boolean;
}

/** Interpret one {@link PROBE_SQL} row (executor-agnostic, pure). */
export function interpretProbe(row: CatalogRow): ProbeResult {
  const inRecovery = row['in_recovery'] === true || row['in_recovery'] === 't';
  const defaultReadOnly = row['default_read_only'] === 'on';
  const canCreate = row['can_create'] === true || row['can_create'] === 't';
  return {
    serverVersion: String(row['server_version'] ?? ''),
    roleName: String(row['role_name'] ?? ''),
    databaseName: String(row['database_name'] ?? ''),
    readOnly: inRecovery || defaultReadOnly || !canCreate,
    canCreate,
    ssl: row['ssl'] === true || row['ssl'] === 't',
  };
}

/** Migration/meta tables hidden behind "show system tables" — 05 §8.2. */
const SYSTEM_TABLE_PATTERN =
  /^(adminium_|knex_migrations)|^(_prisma_migrations|schema_migrations|ar_internal_metadata|django_migrations|sqlite_sequence)$/;

/** Enum values are capped at 256 with a warning — 05 §10. */
const ENUM_VALUE_CAP = 256;

// ---------------------------------------------------------------------------
// Catalog SQL (fixed set — CI asserts ≤ 12 statements, 05 §10)
// ---------------------------------------------------------------------------

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Predicate over `pg_namespace` alias `n` for the included schemas. */
function schemaPredicate(schemas: readonly string[] | null): string {
  if (schemas !== null && schemas.length > 0) {
    return `n.nspname IN (${schemas.map(quoteLiteral).join(', ')})`;
  }
  return `n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast|temp)'`;
}

const SCHEMAS_SQL = `
SELECT n.nspname AS name
FROM pg_catalog.pg_namespace n
WHERE ${schemaPredicate(null)}
ORDER BY n.nspname`;

function classesSql(pred: string): string {
  return `
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       c.oid::int8 AS rel_oid,
       c.relkind::text AS relkind,
       c.relispartition AS is_partition,
       c.reltuples::float8 AS reltuples,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       pg_catalog.obj_description(c.oid, 'pg_class') AS comment,
       (SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid)::int AS policy_count,
       s.n_tup_ins::int8 AS n_ins,
       s.n_tup_upd::int8 AS n_upd,
       s.n_tup_del::int8 AS n_del
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_stat_user_tables s ON s.relid = c.oid
WHERE c.relkind IN ('r', 'p', 'v', 'm') AND ${pred}
ORDER BY n.nspname, c.relname`;
}

/** Guarded separately: permission failures degrade to sizeBytes null (05 §4.1). */
function sizesSql(pred: string): string {
  return `
SELECT c.oid::int8 AS rel_oid,
       pg_catalog.pg_total_relation_size(c.oid)::int8 AS size_bytes
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'm') AND NOT c.relispartition AND ${pred}`;
}

function columnsSql(pred: string): string {
  return `
SELECT a.attrelid::int8 AS rel_oid,
       a.attname AS column_name,
       a.attnum::int AS ordinal,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS db_type,
       a.attnotnull AS not_null,
       a.attidentity::text AS identity,
       a.attgenerated::text AS generated,
       pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS default_expr,
       pg_catalog.col_description(a.attrelid, a.attnum) AS comment,
       t.typtype::text AS typtype,
       t.typcategory::text AS typcategory,
       tn.nspname AS type_schema,
       t.typname AS type_name,
       CASE WHEN t.typcategory = 'A'
            THEN pg_catalog.format_type(t.typelem, a.atttypmod) END AS elem_db_type,
       et.typtype::text AS elem_typtype,
       etn.nspname AS elem_type_schema,
       et.typname AS elem_type_name,
       CASE WHEN t.typtype = 'd'
            THEN pg_catalog.format_type(t.typbasetype, t.typtypmod) END AS base_db_type,
       bt.typtype::text AS base_typtype,
       btn.nspname AS base_type_schema,
       bt.typname AS base_type_name
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
JOIN pg_catalog.pg_namespace tn ON tn.oid = t.typnamespace
LEFT JOIN pg_catalog.pg_type et ON t.typcategory = 'A' AND et.oid = t.typelem
LEFT JOIN pg_catalog.pg_namespace etn ON etn.oid = et.typnamespace
LEFT JOIN pg_catalog.pg_type bt ON t.typtype = 'd' AND bt.oid = t.typbasetype
LEFT JOIN pg_catalog.pg_namespace btn ON btn.oid = bt.typnamespace
LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE a.attnum > 0 AND NOT a.attisdropped
  AND c.relkind IN ('r', 'p', 'v', 'm') AND ${pred}
ORDER BY a.attrelid, a.attnum`;
}

function constraintsSql(pred: string): string {
  return `
SELECT con.conname AS name,
       con.contype::text AS contype,
       con.conrelid::int8 AS rel_oid,
       rn.nspname AS ref_schema,
       rc.relname AS ref_table,
       (SELECT pg_catalog.array_agg(a.attname ORDER BY k.ord)
          FROM pg_catalog.unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_catalog.pg_attribute a
            ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS columns,
       (SELECT pg_catalog.array_agg(a.attname ORDER BY k.ord)
          FROM pg_catalog.unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_catalog.pg_attribute a
            ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS ref_columns,
       con.confupdtype::text AS on_update,
       con.confdeltype::text AS on_delete,
       pg_catalog.pg_get_constraintdef(con.oid) AS definition
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_class rc ON rc.oid = con.confrelid
LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
WHERE con.contype IN ('p', 'u', 'f', 'c') AND ${pred}
ORDER BY con.conname`;
}

function indexesSql(pred: string): string {
  return `
SELECT i.indrelid::int8 AS rel_oid,
       ic.relname AS index_name,
       i.indisunique AS is_unique,
       i.indisprimary AS is_primary,
       am.amname AS method,
       (i.indpred IS NOT NULL) AS is_partial,
       (SELECT pg_catalog.array_agg(a.attname ORDER BY k.ord)
          FROM pg_catalog.unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_catalog.pg_attribute a
            ON a.attrelid = i.indrelid AND a.attnum = k.attnum
         WHERE k.attnum > 0) AS columns,
       pg_catalog.pg_get_expr(i.indexprs, i.indrelid) AS expression
FROM pg_catalog.pg_index i
JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_am am ON am.oid = ic.relam
WHERE c.relkind IN ('r', 'p', 'm') AND ${pred}
ORDER BY ic.relname`;
}

/** All non-system enums (cross-schema column references must resolve). */
const ENUMS_SQL = `
SELECT n.nspname AS schema_name,
       t.typname AS enum_name,
       (SELECT pg_catalog.array_agg(e.enumlabel ORDER BY e.enumsortorder)
          FROM pg_catalog.pg_enum e
         WHERE e.enumtypid = t.oid) AS labels
FROM pg_catalog.pg_type t
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
WHERE t.typtype = 'e' AND ${schemaPredicate(null)}
ORDER BY n.nspname, t.typname`;

// ---------------------------------------------------------------------------
// Row coercion (pg returns int8 as string, the json harness returns numbers)
// ---------------------------------------------------------------------------

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function bool(value: unknown): boolean {
  return value === true || value === 't' || value === 'true';
}

function strArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  // The pg driver returns `name[]` (OID 1003) as the raw `{a,b}` literal unless a
  // type parser is registered; the psql/json_agg harness returns real JSON arrays.
  // Accept both so introspection is executor-agnostic for real.
  if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1);
    if (inner === '') return [];
    // Identifiers needing quotes ("a,b") are split naively here; catalog column
    // names with embedded commas/quotes are out of scope for v1 (noted 05 §4.1).
    return inner.split(',').map((s) => s.replace(/^"(.*)"$/, '$1'));
  }
  return [];
}

// ---------------------------------------------------------------------------
// CHECK (col IN (...)) → EnumDef synthesis — 05 §4.1
// ---------------------------------------------------------------------------

const CHECK_ANY_PATTERN =
  /\(?"?([a-zA-Z_][\w$]*)"?\)?(?:::[\w "]+(?:\(\d+(?:,\s*\d+)?\))?)?\s*=\s*ANY\s*\(\(?\s*ARRAY\[([^\]]+)\]/;
const CHECK_IN_PATTERN = /"?([a-zA-Z_][\w$]*)"?\s+IN\s+\(([^)]+)\)/i;

/** Parse `col = ANY (ARRAY['a', 'b'])` / `col IN ('a','b')` check shapes. */
export function parseCheckEnum(
  definition: string,
): { column: string; values: string[] } | null {
  const match = CHECK_ANY_PATTERN.exec(definition) ?? CHECK_IN_PATTERN.exec(definition);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  const values: string[] = [];
  for (const literal of match[2].matchAll(/'((?:[^']|'')*)'/g)) {
    values.push((literal[1] ?? '').replaceAll("''", "'"));
  }
  return values.length > 0 ? { column: match[1], values } : null;
}

/** `CHECK ((expr))` → `expr` (strip prefix + one balanced outer paren pair). */
function checkExpression(definition: string): string {
  let text = definition.replace(/^CHECK\s*/i, '').trim();
  while (text.startsWith('(') && text.endsWith(')')) {
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') depth -= 1;
      if (depth === 0 && i < text.length - 1) {
        wraps = false;
        break;
      }
    }
    if (!wraps) break;
    text = text.slice(1, -1).trim();
  }
  return text;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const FK_ACTION_MAP: Readonly<Record<string, FkAction>> = {
  a: 'no-action',
  r: 'restrict',
  c: 'cascade',
  n: 'set-null',
  d: 'set-default',
};

interface MutableTable extends TableModel {
  columns: ColumnModel[];
}

function compareBy<T>(key: (item: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
}

/**
 * Run the fixed catalog query set through `exec` and assemble the
 * `DatabaseModel`. Schema only — never touches user rows.
 */
export async function introspectPostgres(
  exec: CatalogExecutor,
  ctx: IntrospectContext,
  opts: IntrospectOptions = {},
): Promise<DatabaseModel> {
  const startedAt = Date.now();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const collectRowEstimates = opts.collectRowEstimates ?? true;
  const collectActivityStats = opts.collectActivityStats ?? true;
  const warnings: ModelWarning[] = [];

  const guarded = async (sql: string): Promise<CatalogRow[]> => {
    if (Date.now() - startedAt > timeoutMs) {
      throw new AdapterError('TIMEOUT', 'introspection exceeded the total time budget', {
        detail: `timeoutMs=${timeoutMs}`,
        hint: 'raise IntrospectOptions.timeoutMs or narrow the schema selection',
      });
    }
    return exec(sql);
  };

  // 1. Schemas ---------------------------------------------------------------
  const allSchemas = (await guarded(SCHEMAS_SQL))
    .map((row) => str(row['name']))
    .filter((name): name is string => name !== null);
  const requested = opts.schemas ?? null;
  const schemas =
    requested === null ? allSchemas : requested.filter((name) => allSchemas.includes(name));
  const pred = schemaPredicate(requested === null ? null : schemas);

  // 2. Classes ---------------------------------------------------------------
  const classRows = await guarded(classesSql(pred));

  // 3. Sizes (guarded: permission failures degrade to sizeBytes null) --------
  let sizeByOid = new Map<number, number>();
  try {
    const sizeRows = await guarded(sizesSql(pred));
    sizeByOid = new Map(
      sizeRows.map((row) => [num(row['rel_oid']) ?? -1, num(row['size_bytes']) ?? 0]),
    );
  } catch (error) {
    if (error instanceof AdapterError && error.code === 'TIMEOUT') throw error;
    warnings.push({
      code: 'size-unavailable',
      message: 'pg_total_relation_size failed (insufficient privileges?) — sizeBytes omitted',
      tableId: null,
    });
  }

  // 4–6. Columns, constraints, indexes ---------------------------------------
  const columnRows = await guarded(columnsSql(pred));
  const constraintRows = await guarded(constraintsSql(pred));
  const indexRows = await guarded(indexesSql(pred));

  // 7. Enums (all non-system so cross-schema references resolve) -------------
  const enumRows = await guarded(ENUMS_SQL);

  // -- native enum defs -------------------------------------------------------
  const nativeEnums = new Map<string, EnumDef>();
  for (const row of enumRows) {
    const schema = str(row['schema_name']) ?? '';
    const name = str(row['enum_name']) ?? '';
    const id = `${schema}.${name}`;
    let values = strArray(row['labels']);
    if (values.length > ENUM_VALUE_CAP) {
      warnings.push({
        code: 'enum-capped',
        message: `enum "${id}" has ${values.length} values; capped at ${ENUM_VALUE_CAP}`,
        tableId: null,
      });
      values = values.slice(0, ENUM_VALUE_CAP);
    }
    nativeEnums.set(id, { id, name, values, source: 'native' });
  }

  // -- tables -----------------------------------------------------------------
  const tablesByOid = new Map<number, MutableTable>();
  let hiddenPartitions = 0;
  for (const row of classRows) {
    const schema = str(row['schema_name']) ?? '';
    const name = str(row['table_name']) ?? '';
    if (bool(row['is_partition'])) {
      hiddenPartitions += 1;
      continue;
    }
    if (opts.tableFilter !== undefined && !opts.tableFilter({ schema, name })) continue;
    const oid = num(row['rel_oid']) ?? -1;
    const relkind = str(row['relkind']) ?? 'r';
    const kind =
      relkind === 'v' ? 'view' : relkind === 'm' ? 'materialized-view' : ('table' as const);
    const reltuples = num(row['reltuples']);
    const inserts = num(row['n_ins']);
    tablesByOid.set(oid, {
      id: `${schema}.${name}`,
      schema,
      name,
      kind,
      comment: str(row['comment']),
      columns: [],
      primaryKey: [],
      uniques: [],
      checks: [],
      indexes: [],
      rowCountEstimate:
        collectRowEstimates && kind !== 'view' && reltuples !== null && reltuples >= 0
          ? Math.round(reltuples)
          : null,
      rowCountExact: false,
      sizeBytes: sizeByOid.get(oid) ?? null,
      activity:
        collectActivityStats && kind === 'table' && inserts !== null
          ? {
              inserts,
              updates: num(row['n_upd']) ?? 0,
              deletes: num(row['n_del']) ?? 0,
            }
          : null,
      rls: {
        enabled: bool(row['rls_enabled']),
        forced: bool(row['rls_forced']),
        policyCount: num(row['policy_count']) ?? 0,
      },
      system: SYSTEM_TABLE_PATTERN.test(name),
      semantics: null,
    });
  }
  if (hiddenPartitions > 0) {
    warnings.push({
      code: 'partitions-hidden',
      message: `${hiddenPartitions} partition(s) hidden — partitioned parents are listed once`,
      tableId: null,
    });
  }

  // -- columns ----------------------------------------------------------------
  const referencedEnumIds = new Set<string>();
  for (const row of columnRows) {
    const table = tablesByOid.get(num(row['rel_oid']) ?? -1);
    if (table === undefined) continue;
    const dbType = str(row['db_type']) ?? 'unknown';
    const typtype = str(row['typtype']);
    const isArray = str(row['typcategory']) === 'A';
    const generated = str(row['generated']) === 's';

    let mapped = mapPostgresType(dbType);
    let enumRef: string | null = null;
    if (typtype === 'e') {
      mapped = { logicalType: 'enum', maxLength: null, numericPrecision: null, numericScale: null };
      enumRef = `${str(row['type_schema']) ?? ''}.${str(row['type_name']) ?? ''}`;
    } else if (typtype === 'd') {
      // Domain: logical type from the base, domain name kept in dbType (05 §4.1).
      mapped = mapPostgresType(str(row['base_db_type']) ?? dbType);
      if (str(row['base_typtype']) === 'e') {
        mapped = { ...mapped, logicalType: 'enum' };
        enumRef = `${str(row['base_type_schema']) ?? ''}.${str(row['base_type_name']) ?? ''}`;
      }
    } else if (isArray) {
      // Array: isArray set, element logicalType (05 §4.1); dbType stays 'type[]'.
      if (str(row['elem_typtype']) === 'e') {
        mapped = {
          logicalType: 'enum',
          maxLength: null,
          numericPrecision: null,
          numericScale: null,
        };
        enumRef = `${str(row['elem_type_schema']) ?? ''}.${str(row['elem_type_name']) ?? ''}`;
      } else {
        mapped = mapPostgresType(str(row['elem_db_type']) ?? dbType);
      }
    }
    if (enumRef !== null) referencedEnumIds.add(enumRef);

    table.columns.push({
      name: str(row['column_name']) ?? '',
      ordinal: num(row['ordinal']) ?? 0,
      dbType,
      logicalType: mapped.logicalType,
      nullable: !bool(row['not_null']),
      default: generated
        ? null
        : classifyDefault(str(row['default_expr']), str(row['identity']) ?? ''),
      isPrimaryKey: false,
      isUnique: false,
      isGenerated: generated,
      enumRef,
      maxLength: mapped.maxLength,
      numericPrecision: mapped.numericPrecision,
      numericScale: mapped.numericScale,
      isArray,
      comment: str(row['comment']),
      references: null,
      semantics: null,
    });
  }

  // -- constraints ------------------------------------------------------------
  const relations: Relation[] = [];
  const checkEnums = new Map<string, EnumDef>();
  const tableIds = new Set([...tablesByOid.values()].map((t) => t.id));

  for (const row of constraintRows) {
    const table = tablesByOid.get(num(row['rel_oid']) ?? -1);
    if (table === undefined) continue;
    const contype = str(row['contype']);
    const name = str(row['name']);
    const columns = strArray(row['columns']);

    if (contype === 'p') {
      table.primaryKey = columns;
      for (const column of table.columns) {
        if (columns.includes(column.name)) column.isPrimaryKey = true;
      }
    } else if (contype === 'u') {
      table.uniques.push({ name, columns });
    } else if (contype === 'c') {
      const definition = str(row['definition']) ?? '';
      table.checks.push({ name, expression: checkExpression(definition) });
      const parsed = parseCheckEnum(definition);
      if (parsed !== null && table.columns.some((c) => c.name === parsed.column)) {
        const id = `${table.id}.${parsed.column}`;
        checkEnums.set(id, {
          id,
          name: parsed.column,
          values: parsed.values.slice(0, ENUM_VALUE_CAP),
          source: 'check',
        });
        const column = table.columns.find((c) => c.name === parsed.column);
        if (column !== undefined && column.enumRef === null) column.enumRef = id;
      }
    } else if (contype === 'f') {
      const refSchema = str(row['ref_schema']) ?? '';
      const refTable = str(row['ref_table']) ?? '';
      const toTableId = `${refSchema}.${refTable}`;
      const refColumns = strArray(row['ref_columns']);
      if (!tableIds.has(toTableId)) {
        warnings.push({
          code: 'fk-target-excluded',
          message: `foreign key "${name ?? ''}" references "${toTableId}" which is outside the introspected set`,
          tableId: table.id,
        });
        continue;
      }
      relations.push({
        id: `fk:${table.id}(${columns.join(',')})->${toTableId}(${refColumns.join(',')})`,
        kind: 'declared-fk',
        cardinality: 'one-to-many', // refined below once uniques/indexes are known
        from: { tableId: table.id, columns },
        to: { tableId: toTableId, columns: refColumns },
        through: null,
        onDelete: FK_ACTION_MAP[str(row['on_delete']) ?? ''] ?? null,
        onUpdate: FK_ACTION_MAP[str(row['on_update']) ?? ''] ?? null,
        selfReferential: table.id === toTableId,
        confidence: 1,
      });
      // Convenience per-column mirror of the declared FK (05 §2.1).
      columns.forEach((columnName, position) => {
        const column = table.columns.find((c) => c.name === columnName);
        const refColumn = refColumns[position];
        if (column !== undefined && column.references === null && refColumn !== undefined) {
          column.references = { tableId: toTableId, column: refColumn };
        }
      });
    }
  }

  // -- indexes + isUnique -----------------------------------------------------
  for (const row of indexRows) {
    const table = tablesByOid.get(num(row['rel_oid']) ?? -1);
    if (table === undefined) continue;
    const index: IndexModel = {
      name: str(row['index_name']) ?? '',
      columns: strArray(row['columns']),
      expression: str(row['expression']),
      unique: bool(row['is_unique']),
      primary: bool(row['is_primary']),
      method: str(row['method']),
      partial: bool(row['is_partial']),
    };
    table.indexes.push(index);
    // Covered by a single-column unique constraint/index (05 §2.1).
    if (index.unique && !index.partial && index.expression === null && index.columns.length === 1) {
      const column = table.columns.find((c) => c.name === index.columns[0]);
      if (column !== undefined) column.isUnique = true;
    }
  }

  // -- one-to-one refinement: FK column set covered by a unique key -----------
  for (const relation of relations) {
    const table = [...tablesByOid.values()].find((t) => t.id === relation.from.tableId);
    if (table === undefined) continue;
    const key = [...relation.from.columns].sort().join('\x00');
    const uniqueSets = [
      table.primaryKey,
      ...table.uniques.map((u) => u.columns),
      ...table.indexes
        .filter((i) => i.unique && !i.partial && i.expression === null)
        .map((i) => i.columns),
    ];
    if (uniqueSets.some((set) => set.length > 0 && [...set].sort().join('\x00') === key)) {
      relation.cardinality = 'one-to-one';
    }
  }

  // -- final assembly ----------------------------------------------------------
  const includedSchemaSet = new Set(schemas);
  const enums = [
    ...[...nativeEnums.values()].filter(
      (def) => referencedEnumIds.has(def.id) || includedSchemaSet.has(def.id.split('.')[0] ?? ''),
    ),
    ...checkEnums.values(),
  ].sort(compareBy((def) => def.id));

  const tables = [...tablesByOid.values()].sort(compareBy((t) => t.id));
  for (const table of tables) {
    table.columns.sort((a, b) => a.ordinal - b.ordinal);
    table.indexes.sort(compareBy((i) => i.name));
    table.uniques.sort(compareBy((u) => u.name ?? ''));
    table.checks.sort(compareBy((c) => c.name ?? ''));
  }
  relations.sort(compareBy((r) => r.id));

  const columnCount = tables.reduce((total, table) => total + table.columns.length, 0);

  return {
    irVersion: 1,
    dialect: 'postgres',
    source: { kind: 'live', connectionId: ctx.connectionId },
    name: ctx.databaseName,
    defaultSchema: 'public',
    schemas,
    tables,
    enums,
    relations,
    capabilities: { ...POSTGRES_CAPABILITIES },
    introspectedAt: new Date().toISOString(),
    stats: {
      tableCount: tables.length,
      columnCount,
      relationCount: relations.length,
      durationMs: Date.now() - startedAt,
    },
    warnings,
  };
}
