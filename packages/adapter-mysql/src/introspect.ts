// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MySQL/MariaDB introspection — 05-introspection-engine.md §4.2.
 *
 * Reads `information_schema` scoped `WHERE TABLE_SCHEMA = <db>`: a FIXED set
 * of set-based queries regardless of table count (≤ 10 statements — 05 §10),
 * joined in memory. This module is executor-agnostic — `introspectMysql`
 * takes a `CatalogExecutor` (any `sql → rows` function) so the assembly
 * logic is testable without the `mysql2` driver; `src/index.ts` wires it to
 * the pool. Mirrors the postgres reference adapter file for file.
 *
 * THE "SCHEMA ONLY" INVARIANT (05 §10): every statement here references
 * `information_schema.*` exclusively — no user table is ever touched during
 * setup (asserted offline by test/introspect.offline.test.ts).
 */
import {
  AdapterError,
  ENGINE_CAPABILITY_MATRIX,
  type AdapterCapabilities,
  type ColumnModel,
  type DatabaseModel,
  type EnumDef,
  type FkAction,
  type IntrospectOptions,
  type ModelWarning,
  type Relation,
  type TableModel,
} from '@adminium/engine/adapter';

import { classifyMysqlDefault, mapMysqlType, parseEnumValues } from './type-map.js';

// ---------------------------------------------------------------------------
// Executor contract
// ---------------------------------------------------------------------------

export type CatalogRow = Record<string, unknown>;

/** Any `sql → rows` runner (the mysql2 pool in production, canned rows in tests). */
export type CatalogExecutor = (sql: string) => Promise<CatalogRow[]>;

export interface IntrospectContext {
  /** `adminium_connections` row id; falls back to the database name. */
  connectionId: string;
  /** `DATABASE()` — the one schema MySQL connections see (hasSchemas=false). */
  databaseName: string;
}

/**
 * Static dialect capabilities — 05 §2.1 (probe refines per-connection).
 * Canonical values live in the engine's capability matrix (M9-T04) so the
 * wizard's degradation copy and the adapter never disagree.
 */
export const MYSQL_CAPABILITIES: AdapterCapabilities = {
  ...ENGINE_CAPABILITY_MATRIX.mysql,
};

// ---------------------------------------------------------------------------
// Probe (test / read-only / version gate)
// ---------------------------------------------------------------------------

/**
 * Session probe. `@@read_only` covers replica/`--read-only` servers; the
 * grants probe (`SHOW GRANTS`) refines per-user write access — 05 §4.2.
 */
export const PROBE_SQL = `
SELECT VERSION() AS server_version,
       CURRENT_USER() AS role_name,
       DATABASE() AS database_name,
       @@read_only AS read_only`;

/** Grants probe — parsed by {@link interpretGrants}. */
export const GRANTS_SQL = 'SHOW GRANTS';

/** TLS probe (guarded — may be absent on stripped-down servers). */
export const SSL_SQL = "SHOW SESSION STATUS LIKE 'Ssl_cipher'";

export interface ServerFlavor {
  flavor: 'mysql' | 'mariadb';
  major: number;
  minor: number;
  /** MySQL ≥ 8.0, MariaDB ≥ 10.5 (05 §4.2); older → UNSUPPORTED. */
  supported: boolean;
}

/**
 * Feature-detect the server flavor and version from `VERSION()` output.
 * Handles MariaDB's replication-compat prefix (`5.5.5-10.6.14-MariaDB`).
 */
export function detectServerFlavor(version: string): ServerFlavor {
  let text = version.trim();
  const isMariaDb = /mariadb/i.test(text);
  if (isMariaDb) text = text.replace(/^5\.5\.5-/, '');
  const match = /^(\d+)\.(\d+)/.exec(text);
  const major = Number.parseInt(match?.[1] ?? '0', 10);
  const minor = Number.parseInt(match?.[2] ?? '0', 10);
  const supported = isMariaDb ? major > 10 || (major === 10 && minor >= 5) : major >= 8;
  return { flavor: isMariaDb ? 'mariadb' : 'mysql', major, minor, supported };
}

export interface ProbeResult {
  serverVersion: string;
  flavor: ServerFlavor;
  roleName: string;
  /** Null when the DSN names no database. */
  databaseName: string | null;
  /** `@@read_only` — server-level; grants refine per-user access. */
  readOnly: boolean;
}

/** Interpret one {@link PROBE_SQL} row (executor-agnostic, pure). */
export function interpretProbe(row: CatalogRow): ProbeResult {
  const serverVersion = String(row['server_version'] ?? '');
  const readOnlyRaw = row['read_only'];
  return {
    serverVersion,
    flavor: detectServerFlavor(serverVersion),
    roleName: String(row['role_name'] ?? ''),
    databaseName: str(row['database_name']),
    readOnly: readOnlyRaw === 1 || readOnlyRaw === '1' || readOnlyRaw === 'ON',
  };
}

export interface GrantsResult {
  canSelect: boolean;
  canWrite: boolean;
  canDDL: boolean;
}

/**
 * Parse `SHOW GRANTS` rows (each row is one `GRANT … ON scope TO user`
 * string) into privilege booleans for `databaseName` — pure, unit-testable.
 */
export function interpretGrants(rows: CatalogRow[], databaseName: string): GrantsResult {
  const result: GrantsResult = { canSelect: false, canWrite: false, canDDL: false };
  for (const row of rows) {
    const line = String(Object.values(row)[0] ?? '');
    const match = /^GRANT\s+(.+?)\s+ON\s+(\S+)\s+TO\s/i.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const scope = match[2].replaceAll('`', '').replaceAll('"', '');
    const scopeDb = scope.split('.')[0] ?? '';
    if (scopeDb !== '*' && scopeDb.toLowerCase() !== databaseName.toLowerCase()) continue;
    const privileges = match[1].toUpperCase();
    const all = privileges.includes('ALL PRIVILEGES') || privileges.trim() === 'ALL';
    if (all || /\bSELECT\b/.test(privileges)) result.canSelect = true;
    if (all || /\b(INSERT|UPDATE|DELETE)\b/.test(privileges)) result.canWrite = true;
    if (all || /\b(CREATE|ALTER|DROP)\b/.test(privileges)) result.canDDL = true;
  }
  return result;
}

/** Migration/meta tables hidden behind "show system tables" — 05 §8.2. */
const SYSTEM_TABLE_PATTERN =
  /^(adminium_|knex_migrations)|^(_prisma_migrations|schema_migrations|ar_internal_metadata|django_migrations|sqlite_sequence)$/;

/** Enum values are capped at 256 with a warning — 05 §10. */
const ENUM_VALUE_CAP = 256;

// ---------------------------------------------------------------------------
// Catalog SQL (fixed set — offline tests assert information_schema-only)
// ---------------------------------------------------------------------------

function quoteLiteral(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
}

export function tablesSql(schema: string): string {
  return `
SELECT TABLE_NAME AS table_name,
       TABLE_TYPE AS table_type,
       ENGINE AS engine,
       TABLE_ROWS AS table_rows,
       (COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0)) AS size_bytes,
       TABLE_COMMENT AS table_comment
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = ${quoteLiteral(schema)}
ORDER BY TABLE_NAME`;
}

export function columnsSql(schema: string): string {
  return `
SELECT TABLE_NAME AS table_name,
       COLUMN_NAME AS column_name,
       ORDINAL_POSITION AS ordinal,
       COLUMN_TYPE AS column_type,
       DATA_TYPE AS data_type,
       IS_NULLABLE AS is_nullable,
       COLUMN_DEFAULT AS default_value,
       EXTRA AS extra,
       COLUMN_COMMENT AS column_comment,
       CHARACTER_MAXIMUM_LENGTH AS char_max_length,
       NUMERIC_PRECISION AS numeric_precision,
       NUMERIC_SCALE AS numeric_scale
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = ${quoteLiteral(schema)}
ORDER BY TABLE_NAME, ORDINAL_POSITION`;
}

export function statisticsSql(schema: string): string {
  return `
SELECT TABLE_NAME AS table_name,
       INDEX_NAME AS index_name,
       NON_UNIQUE AS non_unique,
       SEQ_IN_INDEX AS seq_in_index,
       COLUMN_NAME AS column_name,
       INDEX_TYPE AS index_type
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = ${quoteLiteral(schema)}
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`;
}

export function foreignKeysSql(schema: string): string {
  return `
SELECT k.TABLE_NAME AS table_name,
       k.CONSTRAINT_NAME AS constraint_name,
       k.COLUMN_NAME AS column_name,
       k.ORDINAL_POSITION AS ordinal,
       k.REFERENCED_TABLE_SCHEMA AS ref_schema,
       k.REFERENCED_TABLE_NAME AS ref_table,
       k.REFERENCED_COLUMN_NAME AS ref_column,
       r.UPDATE_RULE AS on_update,
       r.DELETE_RULE AS on_delete
FROM information_schema.KEY_COLUMN_USAGE k
JOIN information_schema.REFERENTIAL_CONSTRAINTS r
  ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
 AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
 AND r.TABLE_NAME = k.TABLE_NAME
WHERE k.TABLE_SCHEMA = ${quoteLiteral(schema)}
  AND k.REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`;
}

export function tableConstraintsSql(schema: string): string {
  return `
SELECT TABLE_NAME AS table_name,
       CONSTRAINT_NAME AS constraint_name,
       CONSTRAINT_TYPE AS constraint_type
FROM information_schema.TABLE_CONSTRAINTS
WHERE TABLE_SCHEMA = ${quoteLiteral(schema)}
ORDER BY TABLE_NAME, CONSTRAINT_NAME`;
}

/** Guarded: the view exists on MySQL ≥ 8.0.16 / MariaDB ≥ 10.2 only. */
export function checkConstraintsSql(schema: string): string {
  return `
SELECT CONSTRAINT_NAME AS constraint_name,
       CHECK_CLAUSE AS check_clause
FROM information_schema.CHECK_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = ${quoteLiteral(schema)}
ORDER BY CONSTRAINT_NAME`;
}

/** The fixed introspection statement set (6 + the probe = 7 — 05 §4.2). */
export function introspectionStatements(schema: string): string[] {
  return [
    tablesSql(schema),
    columnsSql(schema),
    statisticsSql(schema),
    foreignKeysSql(schema),
    tableConstraintsSql(schema),
    checkConstraintsSql(schema),
  ];
}

// ---------------------------------------------------------------------------
// Row coercion (mysql2 returns numbers/strings depending on column and flags)
// ---------------------------------------------------------------------------

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// CHECK (col IN (...)) → EnumDef synthesis — same approach as the postgres
// adapter's parseCheckEnum, duplicated by design (adapters never import each
// other), flavored for MySQL's backticked identifiers, charset introducers
// (_utf8mb4'…'), and backslash-escaped quotes in CHECK_CLAUSE.
// ---------------------------------------------------------------------------

function normalizeCheckClause(clause: string): string {
  return clause
    .replaceAll("\\'", "'") // MySQL 8 escapes the literal delimiters with backslashes
    .replace(/_[a-z][a-z0-9]*\s*(?=')/gi, ''); // strip charset introducers (_utf8mb4'…')
}

const CHECK_IN_PATTERN = /[`"]?([a-zA-Z_][\w$]*)[`"]?\s+in\s+\(([^)]+)\)/i;

/** Parse a `col IN ('a','b')` check shape into a synthesized enum. */
export function parseCheckEnum(clause: string): { column: string; values: string[] } | null {
  const normalized = normalizeCheckClause(clause);
  const match = CHECK_IN_PATTERN.exec(normalized);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  const values: string[] = [];
  for (const literal of match[2].matchAll(/'((?:[^']|'')*)'/g)) {
    values.push((literal[1] ?? '').replaceAll("''", "'"));
  }
  return values.length > 0 ? { column: match[1], values } : null;
}

/** Strip one balanced outer paren pair from a check expression, like pg. */
function checkExpression(clause: string): string {
  let text = normalizeCheckClause(clause).trim();
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
  CASCADE: 'cascade',
  RESTRICT: 'restrict',
  'SET NULL': 'set-null',
  'SET DEFAULT': 'set-default',
  'NO ACTION': 'no-action',
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

/** char(36)/varchar(36) columns named like a uuid — heuristic flag (05 §2.2). */
const UUID_NAME_PATTERN = /(^|_)(uuid|guid)(_|$)/i;

/**
 * Run the fixed catalog query set through `exec` and assemble the
 * `DatabaseModel`. Schema only — never touches user rows.
 */
export async function introspectMysql(
  exec: CatalogExecutor,
  ctx: IntrospectContext,
  opts: IntrospectOptions = {},
): Promise<DatabaseModel> {
  const startedAt = Date.now();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const collectRowEstimates = opts.collectRowEstimates ?? true;
  const warnings: ModelWarning[] = [];
  const schema = ctx.databaseName;

  const guarded = async (sql: string): Promise<CatalogRow[]> => {
    if (Date.now() - startedAt > timeoutMs) {
      throw new AdapterError('TIMEOUT', 'introspection exceeded the total time budget', {
        detail: `timeoutMs=${timeoutMs}`,
        hint: 'raise IntrospectOptions.timeoutMs or narrow the table selection',
      });
    }
    return exec(sql);
  };

  // 1–5. The unconditional statements ----------------------------------------
  const tableRows = await guarded(tablesSql(schema));
  const columnRows = await guarded(columnsSql(schema));
  const statisticRows = await guarded(statisticsSql(schema));
  const fkRows = await guarded(foreignKeysSql(schema));
  const tcRows = await guarded(tableConstraintsSql(schema));

  // 6. CHECK constraints (feature-detected: view absent before 8.0.16/10.2) --
  let ccRows: CatalogRow[] = [];
  try {
    ccRows = await guarded(checkConstraintsSql(schema));
  } catch (error) {
    if (error instanceof AdapterError && error.code === 'TIMEOUT') throw error;
    warnings.push({
      code: 'checks-unavailable',
      message:
        'information_schema.CHECK_CONSTRAINTS is unavailable (MySQL < 8.0.16?) — check constraints omitted',
      tableId: null,
    });
  }

  // -- tables -----------------------------------------------------------------
  const tables = new Map<string, MutableTable>();
  for (const row of tableRows) {
    const name = str(row['table_name']) ?? '';
    if (opts.tableFilter !== undefined && !opts.tableFilter({ schema, name })) continue;
    const kind = str(row['table_type']) === 'VIEW' ? ('view' as const) : ('table' as const);
    const engine = str(row['engine']);
    const estimate = num(row['table_rows']);
    if (kind === 'table' && engine !== null && engine.toUpperCase() === 'MYISAM') {
      warnings.push({
        code: 'myisam-no-fks',
        message: `table "${name}" uses the MyISAM engine — foreign keys are not enforced (relation inference weight raised)`,
        tableId: `${schema}.${name}`,
      });
    }
    tables.set(name, {
      id: `${schema}.${name}`,
      schema,
      name,
      kind,
      comment: str(row['table_comment']),
      columns: [],
      primaryKey: [],
      uniques: [],
      checks: [],
      indexes: [],
      rowCountEstimate:
        collectRowEstimates && kind === 'table' && estimate !== null ? estimate : null,
      rowCountExact: false,
      sizeBytes: kind === 'table' ? num(row['size_bytes']) : null,
      activity: null, // pg_stat-style counters have no information_schema equivalent
      rls: null, // Postgres only
      system: SYSTEM_TABLE_PATTERN.test(name),
      semantics: null,
    });
  }

  // -- columns ----------------------------------------------------------------
  const columnEnums = new Map<string, EnumDef>();
  for (const row of columnRows) {
    const table = tables.get(str(row['table_name']) ?? '');
    if (table === undefined) continue;
    const columnName = str(row['column_name']) ?? '';
    const dbType = str(row['column_type']) ?? str(row['data_type']) ?? 'unknown';
    const extra = str(row['extra']) ?? '';
    const generated = /\bgenerated\b/i.test(extra) && !/default_generated/i.test(extra);

    const mapped = mapMysqlType(dbType);
    let { logicalType } = mapped;
    let enumRef: string | null = null;

    if (logicalType === 'enum') {
      const id = `${table.id}.${columnName}`;
      let values = parseEnumValues(dbType) ?? [];
      if (values.length > ENUM_VALUE_CAP) {
        warnings.push({
          code: 'enum-capped',
          message: `enum "${id}" has ${values.length} values; capped at ${ENUM_VALUE_CAP}`,
          tableId: table.id,
        });
        values = values.slice(0, ENUM_VALUE_CAP);
      }
      if (values.length > 0) {
        columnEnums.set(id, { id, name: columnName, values, source: 'column-type' });
        enumRef = id;
      } else {
        logicalType = 'text';
      }
    } else if (
      logicalType === 'varchar' &&
      mapped.maxLength === 36 &&
      UUID_NAME_PATTERN.test(columnName)
    ) {
      // char(36) + name heuristic — 05 §2.2 (values are never probed at setup).
      logicalType = 'uuid';
    }

    if (mapped.warning === 'set-as-text') {
      warnings.push({
        code: 'set-as-text',
        message: `column "${table.name}.${columnName}" is a set(...) — mapped to text (05 §4.2)`,
        tableId: table.id,
      });
    } else if (mapped.warning === 'year-as-integer') {
      warnings.push({
        code: 'year-as-integer',
        message: `column "${table.name}.${columnName}" is a year — mapped to integer`,
        tableId: table.id,
      });
    } else if (mapped.warning === 'unsigned-overflow') {
      warnings.push({
        code: 'unsigned-overflow',
        message: `column "${table.name}.${columnName}" is ${dbType} — values may exceed the signed range and travel as strings`,
        tableId: table.id,
      });
    }

    table.columns.push({
      name: columnName,
      ordinal: num(row['ordinal']) ?? 0,
      dbType,
      logicalType,
      nullable: str(row['is_nullable']) === 'YES',
      default: generated ? null : classifyMysqlDefault(str(row['default_value']), extra),
      isPrimaryKey: false,
      isUnique: false,
      isGenerated: generated,
      enumRef,
      maxLength: mapped.maxLength,
      numericPrecision: mapped.numericPrecision,
      numericScale: mapped.numericScale,
      isArray: false, // MySQL has no array types
      comment: str(row['column_comment']),
      references: null,
      semantics: null,
    });
  }

  // -- indexes / PK / uniques (information_schema.STATISTICS) -----------------
  interface IndexAccumulator {
    table: MutableTable;
    unique: boolean;
    method: string | null;
    columns: { seq: number; name: string }[];
  }
  const indexAccumulators = new Map<string, IndexAccumulator>();
  for (const row of statisticRows) {
    const table = tables.get(str(row['table_name']) ?? '');
    if (table === undefined) continue;
    const indexName = str(row['index_name']) ?? '';
    const key = `${table.name}\x00${indexName}`;
    let acc = indexAccumulators.get(key);
    if (acc === undefined) {
      acc = {
        table,
        unique: num(row['non_unique']) === 0,
        method: str(row['index_type'])?.toLowerCase() ?? null,
        columns: [],
      };
      indexAccumulators.set(key, acc);
    }
    const columnName = str(row['column_name']);
    if (columnName !== null) {
      acc.columns.push({ seq: num(row['seq_in_index']) ?? 0, name: columnName });
    }
  }
  for (const [key, acc] of indexAccumulators) {
    const indexName = key.split('\x00')[1] ?? '';
    const columns = acc.columns.sort((a, b) => a.seq - b.seq).map((c) => c.name);
    const primary = indexName === 'PRIMARY';
    acc.table.indexes.push({
      name: indexName,
      columns,
      expression: null, // functional index expressions are not surfaced in v1
      unique: acc.unique,
      primary,
      method: acc.method,
      partial: false,
    });
    if (primary) {
      acc.table.primaryKey = columns;
      for (const column of acc.table.columns) {
        if (columns.includes(column.name)) column.isPrimaryKey = true;
      }
    } else if (acc.unique) {
      acc.table.uniques.push({ name: indexName, columns });
    }
    // Covered by a single-column unique constraint/index (05 §2.1) — the PK
    // index counts, mirroring the pg reference adapter.
    if (acc.unique && columns.length === 1) {
      const column = acc.table.columns.find((c) => c.name === columns[0]);
      if (column !== undefined) column.isUnique = true;
    }
  }

  // -- foreign keys (KEY_COLUMN_USAGE + REFERENTIAL_CONSTRAINTS) --------------
  const relations: Relation[] = [];
  interface FkAccumulator {
    table: MutableTable;
    refSchema: string;
    refTable: string;
    columns: { seq: number; from: string; to: string }[];
    onUpdate: FkAction | null;
    onDelete: FkAction | null;
  }
  const fkAccumulators = new Map<string, FkAccumulator>();
  for (const row of fkRows) {
    const table = tables.get(str(row['table_name']) ?? '');
    if (table === undefined) continue;
    const constraintName = str(row['constraint_name']) ?? '';
    const key = `${table.name}\x00${constraintName}`;
    let acc = fkAccumulators.get(key);
    if (acc === undefined) {
      acc = {
        table,
        refSchema: str(row['ref_schema']) ?? schema,
        refTable: str(row['ref_table']) ?? '',
        columns: [],
        onUpdate: FK_ACTION_MAP[str(row['on_update']) ?? ''] ?? null,
        onDelete: FK_ACTION_MAP[str(row['on_delete']) ?? ''] ?? null,
      };
      fkAccumulators.set(key, acc);
    }
    acc.columns.push({
      seq: num(row['ordinal']) ?? 0,
      from: str(row['column_name']) ?? '',
      to: str(row['ref_column']) ?? '',
    });
  }
  for (const [key, acc] of fkAccumulators) {
    const constraintName = key.split('\x00')[1] ?? '';
    const ordered = acc.columns.sort((a, b) => a.seq - b.seq);
    const columns = ordered.map((c) => c.from);
    const refColumns = ordered.map((c) => c.to);
    const toTableId = `${acc.refSchema}.${acc.refTable}`;
    // Cross-database FKs are out of scope v1 (05 §4.2); filtered targets warn.
    if (acc.refSchema !== schema || !tables.has(acc.refTable)) {
      warnings.push({
        code: 'fk-target-excluded',
        message: `foreign key "${constraintName}" references "${toTableId}" which is outside the introspected set`,
        tableId: acc.table.id,
      });
      continue;
    }
    relations.push({
      id: `fk:${acc.table.id}(${columns.join(',')})->${toTableId}(${refColumns.join(',')})`,
      kind: 'declared-fk',
      cardinality: 'one-to-many', // refined below once uniques are known
      from: { tableId: acc.table.id, columns },
      to: { tableId: toTableId, columns: refColumns },
      through: null,
      onDelete: acc.onDelete,
      onUpdate: acc.onUpdate,
      selfReferential: acc.table.id === toTableId,
      confidence: 1,
    });
    // Convenience per-column mirror of the declared FK (05 §2.1).
    columns.forEach((columnName, position) => {
      const column = acc.table.columns.find((c) => c.name === columnName);
      const refColumn = refColumns[position];
      if (column !== undefined && column.references === null && refColumn !== undefined) {
        column.references = { tableId: toTableId, column: refColumn };
      }
    });
  }

  // -- checks (TABLE_CONSTRAINTS type CHECK + CHECK_CONSTRAINTS clause) -------
  const checkEnums = new Map<string, EnumDef>();
  const clauseByConstraint = new Map<string, string>();
  for (const row of ccRows) {
    const name = str(row['constraint_name']);
    const clause = str(row['check_clause']);
    if (name !== null && clause !== null) clauseByConstraint.set(name, clause);
  }
  for (const row of tcRows) {
    if (str(row['constraint_type']) !== 'CHECK') continue;
    const table = tables.get(str(row['table_name']) ?? '');
    const name = str(row['constraint_name']);
    if (table === undefined || name === null) continue;
    const clause = clauseByConstraint.get(name);
    if (clause === undefined) continue;
    table.checks.push({ name, expression: checkExpression(clause) });
    const parsed = parseCheckEnum(clause);
    if (parsed !== null && table.columns.some((c) => c.name === parsed.column)) {
      const id = `${table.id}.${parsed.column}`;
      const column = table.columns.find((c) => c.name === parsed.column);
      if (column !== undefined && column.enumRef === null) {
        checkEnums.set(id, {
          id,
          name: parsed.column,
          values: parsed.values.slice(0, ENUM_VALUE_CAP),
          source: 'check',
        });
        column.enumRef = id;
      }
    }
  }

  // -- one-to-one refinement: FK column set covered by a unique key -----------
  for (const relation of relations) {
    const table = [...tables.values()].find((t) => t.id === relation.from.tableId);
    if (table === undefined) continue;
    const key = [...relation.from.columns].sort().join(' ');
    const uniqueSets = [table.primaryKey, ...table.uniques.map((u) => u.columns)];
    if (uniqueSets.some((set) => set.length > 0 && [...set].sort().join(' ') === key)) {
      relation.cardinality = 'one-to-one';
    }
  }

  // -- final assembly ----------------------------------------------------------
  const enums = [...columnEnums.values(), ...checkEnums.values()].sort(
    compareBy((def) => def.id),
  );
  const sortedTables = [...tables.values()].sort(compareBy((t) => t.id));
  for (const table of sortedTables) {
    table.columns.sort((a, b) => a.ordinal - b.ordinal);
    table.indexes.sort(compareBy((i) => i.name));
    table.uniques.sort(compareBy((u) => u.name ?? ''));
    table.checks.sort(compareBy((c) => c.name ?? ''));
  }
  relations.sort(compareBy((r) => r.id));

  const columnCount = sortedTables.reduce((total, table) => total + table.columns.length, 0);

  return {
    irVersion: 1,
    dialect: 'mysql',
    source: { kind: 'live', connectionId: ctx.connectionId },
    name: ctx.databaseName,
    defaultSchema: schema,
    schemas: [schema],
    tables: sortedTables,
    enums,
    relations,
    capabilities: { ...MYSQL_CAPABILITIES },
    introspectedAt: new Date().toISOString(),
    stats: {
      tableCount: sortedTables.length,
      columnCount,
      relationCount: relations.length,
      durationMs: Date.now() - startedAt,
    },
    warnings,
  };
}
