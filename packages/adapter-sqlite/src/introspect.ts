// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SQLite introspection — 05-introspection-engine.md §4.3.
 *
 * Reads pragma table-valued functions joined against `sqlite_master`, so the
 * statement set stays FIXED regardless of table count (the per-table pragma
 * loop happens inside SQLite, not over the executor). This module is
 * executor-agnostic — `introspectSqlite` takes a `CatalogExecutor` (any
 * `sql → rows` function) so the assembly logic is testable without the
 * `better-sqlite3` driver; `src/index.ts` wires it to the database handle.
 * Mirrors the postgres reference adapter file for file.
 *
 * THE "SCHEMA ONLY" INVARIANT (05 §10): every statement here references
 * `sqlite_master` / `pragma_*` / `sqlite_stat1` exclusively — with the one
 * documented exception of §4.3: exact `COUNT(*)` per table on files
 * < 100 MB, which touches no column values.
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

import { quoteIdentifier } from './serialization.js';
import { classifyDefault, mapSqliteType } from './type-map.js';

// ---------------------------------------------------------------------------
// Executor contract
// ---------------------------------------------------------------------------

export type CatalogRow = Record<string, unknown>;

/** Any `sql → rows` runner (better-sqlite3 in production, canned rows in tests). */
export type CatalogExecutor = (sql: string) => Promise<CatalogRow[]>;

export interface IntrospectContext {
  /** `adminium_connections` row id; falls back to the file stem. */
  connectionId: string;
  /** File stem (or 'memory') — becomes `model.name`; the schema is 'main'. */
  databaseName: string;
  /** Database file size; null = unknown. Gates the exact-count exception. */
  fileSizeBytes: number | null;
}

/**
 * Static dialect capabilities — 05 §2.1/§4.3 (probe refines per-connection).
 * Canonical values live in the engine's capability matrix (M9-T04) so the
 * wizard's degradation copy and the adapter never disagree.
 */
export const SQLITE_CAPABILITIES: AdapterCapabilities = {
  ...ENGINE_CAPABILITY_MATRIX.sqlite,
};

/** §4.3: exact per-table `COUNT(*)` only when the file is under 100 MB. */
export const EXACT_COUNT_MAX_FILE_BYTES = 100 * 1024 * 1024;

/** Migration/meta tables hidden behind "show system tables" — 05 §8.2. */
const SYSTEM_TABLE_PATTERN =
  /^(adminium_|knex_migrations)|^(_prisma_migrations|schema_migrations|ar_internal_metadata|django_migrations|sqlite_sequence)$/;

/** Enum values are capped at 256 with a warning — 05 §10. */
const ENUM_VALUE_CAP = 256;

// ---------------------------------------------------------------------------
// Catalog SQL (fixed set)
// ---------------------------------------------------------------------------

/** SQLite ≥ 3.37 — guarded with a sqlite_master fallback (05 §4.3). */
export const TABLE_LIST_SQL = `
SELECT name, type, wr, strict
FROM pragma_table_list
WHERE schema = 'main' AND name NOT LIKE 'sqlite_%'
ORDER BY name`;

/** DDL source — CHECK extraction, AUTOINCREMENT, WITHOUT ROWID fallback. */
export const MASTER_SQL = `
SELECT name, type, sql
FROM sqlite_master
WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
ORDER BY name`;

/** table_xinfo includes hidden/generated columns (05 §4.3). */
export const COLUMNS_SQL = `
SELECT m.name AS table_name,
       ti.cid AS ordinal,
       ti.name AS column_name,
       ti.type AS declared_type,
       ti."notnull" AS not_null,
       ti.dflt_value AS default_text,
       ti.pk AS pk_ordinal,
       ti.hidden AS hidden
FROM sqlite_master m
JOIN pragma_table_xinfo(m.name) ti
WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, ti.cid`;

export const FOREIGN_KEYS_SQL = `
SELECT m.name AS table_name,
       fk.id AS fk_id,
       fk.seq AS seq,
       fk."table" AS ref_table,
       fk."from" AS from_column,
       fk."to" AS to_column,
       fk.on_update AS on_update,
       fk.on_delete AS on_delete
FROM sqlite_master m
JOIN pragma_foreign_key_list(m.name) fk
WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, fk.id, fk.seq`;

export const INDEX_LIST_SQL = `
SELECT m.name AS table_name,
       il.name AS index_name,
       il."unique" AS is_unique,
       il.origin AS origin,
       il.partial AS partial
FROM sqlite_master m
JOIN pragma_index_list(m.name) il
WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, il.name`;

export const INDEX_COLUMNS_SQL = `
SELECT m.name AS table_name,
       il.name AS index_name,
       ii.seqno AS seqno,
       ii.name AS column_name
FROM sqlite_master m
JOIN pragma_index_list(m.name) il
JOIN pragma_index_info(il.name) ii
WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, il.name, ii.seqno`;

/** Guarded: only present after ANALYZE has run (05 §4.3). */
export const STAT1_SQL = `
SELECT tbl AS table_name, idx AS index_name, stat AS stat
FROM sqlite_stat1`;

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * One UNION ALL statement counting every included table — the §4.3 small-file
 * exception. COUNT(*) touches no column values; `rowCountExact: true`.
 */
export function exactCountsSql(tableNames: readonly string[]): string {
  return tableNames
    .map(
      (name) =>
        `SELECT ${quoteLiteral(name)} AS table_name, count(*) AS n FROM ${quoteIdentifier(name)}`,
    )
    .join('\nUNION ALL\n');
}

// ---------------------------------------------------------------------------
// Row coercion
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
// DDL scanning: CHECK constraints, AUTOINCREMENT, WITHOUT ROWID / STRICT.
// CHECK expressions and enum synthesis reuse the same `col IN (...)` parsing
// approach as the postgres adapter — duplicated by design (adapters never
// import each other, 05 §4.3 note).
// ---------------------------------------------------------------------------

/** Skip a quoted region starting at `i`; returns the index AFTER it. */
function skipQuoted(ddl: string, i: number): number {
  const open = ddl[i];
  const close = open === '[' ? ']' : open;
  let j = i + 1;
  while (j < ddl.length) {
    if (ddl[j] === close) {
      // '' / "" / `` escape by doubling ([ ] does not double)
      if (close !== ']' && ddl[j + 1] === close) {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j += 1;
  }
  return j;
}

/**
 * Scan a CREATE TABLE statement for CHECK constraints (column-level and
 * table-level), respecting strings/quoted identifiers. Returns the balanced
 * inner expression of each `CHECK (…)` plus the `CONSTRAINT <name>` when
 * present.
 */
export function scanCheckConstraints(
  ddl: string,
): { name: string | null; expression: string }[] {
  const results: { name: string | null; expression: string }[] = [];
  const tokens: string[] = []; // trailing significant identifiers/keywords
  let i = 0;
  while (i < ddl.length) {
    const ch = ddl[i] ?? '';
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const end = skipQuoted(ddl, i);
      tokens.push(ddl.slice(i + 1, end - 1));
      i = end;
      continue;
    }
    if (ch === '-' && ddl[i + 1] === '-') {
      const nl = ddl.indexOf('\n', i);
      i = nl === -1 ? ddl.length : nl + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < ddl.length && /[\w$]/.test(ddl[j] ?? '')) j += 1;
      const word = ddl.slice(i, j);
      if (word.toUpperCase() === 'CHECK') {
        // optional CONSTRAINT <name> immediately before
        const prev = tokens[tokens.length - 2];
        const name =
          prev !== undefined && prev.toUpperCase() === 'CONSTRAINT'
            ? (tokens[tokens.length - 1] ?? null)
            : null;
        // find the balanced ( … ) that follows
        let k = j;
        while (k < ddl.length && ddl[k] !== '(') k += 1;
        let depth = 0;
        let end = k;
        while (end < ddl.length) {
          const c = ddl[end] ?? '';
          if (c === "'" || c === '"' || c === '`' || c === '[') {
            end = skipQuoted(ddl, end);
            continue;
          }
          if (c === '(') depth += 1;
          else if (c === ')') {
            depth -= 1;
            if (depth === 0) break;
          }
          end += 1;
        }
        if (k < ddl.length && end > k) {
          results.push({ name, expression: ddl.slice(k + 1, end).trim() });
        }
        i = end + 1;
        tokens.push(word);
        continue;
      }
      tokens.push(word);
      i = j;
      continue;
    }
    i += 1;
  }
  return results;
}

/**
 * The `col IN (…)` head — everything up to the opening paren of the value
 * list, which `parseCheckEnum` then closes with `indexOf`.
 *
 * The one-piece pattern this replaces ended in `([^)]+)\)`, which is quadratic
 * (CodeQL js/polynomial-redos) — and this runs on CHECK bodies lifted verbatim
 * out of `sqlite_master.sql`, where a column name is whatever the application
 * let a user call it. A body repeating `_ in ((` and never closing the list
 * made `[^)]+` rescan the whole remainder from each of the O(n) candidate
 * starts; `'_'.repeat(n)` did the same through the unbounded `[\w$]*`.
 *
 * 127 is the package's own identifier ceiling — `SQLITE_MAX_IDENTIFIER_LENGTH`
 * is 128 (05 §2.1 "unlimited-ish sqlite (use 128)") and the query engine
 * enforces it, so a name this pattern would now decline is a name the adapter
 * could not address anyway.
 */
const CHECK_IN_HEAD = /["'`[]?([a-zA-Z_][\w$]{0,127})["'`\]]?\s+in\s*\(/gi;

/** Parse a `col IN ('a','b')` check shape into a synthesized enum (05 §4.3). */
export function parseCheckEnum(
  expression: string,
): { column: string; values: string[] } | null {
  CHECK_IN_HEAD.lastIndex = 0;
  for (
    let head = CHECK_IN_HEAD.exec(expression);
    head !== null;
    head = CHECK_IN_HEAD.exec(expression)
  ) {
    const start = CHECK_IN_HEAD.lastIndex;
    const end = expression.indexOf(')', start);
    // No `)` after this head means none after any later head either.
    if (end === -1) return null;
    const column = head[1];
    if (end > start && column !== undefined) {
      const values: string[] = [];
      for (const literal of expression.slice(start, end).matchAll(/'((?:[^']|'')*)'/g)) {
        values.push((literal[1] ?? '').replaceAll("''", "'"));
      }
      return values.length > 0 ? { column, values } : null;
    }
    // Empty list: resume just after this `(`, as the one-piece pattern did.
    CHECK_IN_HEAD.lastIndex = start;
  }
  return null;
}

/** Tail of the DDL after the closing paren — WITHOUT ROWID / STRICT options. */
function tableOptions(ddl: string | null): { withoutRowid: boolean; strict: boolean } {
  if (ddl === null) return { withoutRowid: false, strict: false };
  const tail = ddl.slice(ddl.lastIndexOf(')') + 1);
  return {
    withoutRowid: /without\s+rowid/i.test(tail),
    strict: /\bstrict\b/i.test(tail),
  };
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

/**
 * Run the fixed catalog query set through `exec` and assemble the
 * `DatabaseModel`. Schema only — never touches user rows (except the §4.3
 * small-file COUNT exception, which reads no column values).
 */
export async function introspectSqlite(
  exec: CatalogExecutor,
  ctx: IntrospectContext,
  opts: IntrospectOptions = {},
): Promise<DatabaseModel> {
  const startedAt = Date.now();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const collectRowEstimates = opts.collectRowEstimates ?? true;
  const warnings: ModelWarning[] = [];
  const schema = 'main';

  const guarded = async (sql: string): Promise<CatalogRow[]> => {
    if (Date.now() - startedAt > timeoutMs) {
      throw new AdapterError('TIMEOUT', 'introspection exceeded the total time budget', {
        detail: `timeoutMs=${timeoutMs}`,
        hint: 'raise IntrospectOptions.timeoutMs or narrow the table selection',
      });
    }
    return exec(sql);
  };

  // 1. DDL master list (always) ------------------------------------------------
  const masterRows = await guarded(MASTER_SQL);
  const ddlByTable = new Map<string, string | null>(
    masterRows.map((row) => [str(row['name']) ?? '', str(row['sql'])]),
  );

  // 2. table_list (SQLite ≥ 3.37; fallback: derive wr/strict from the DDL) ----
  const tableFlags = new Map<string, { withoutRowid: boolean; strict: boolean }>();
  try {
    for (const row of await guarded(TABLE_LIST_SQL)) {
      tableFlags.set(str(row['name']) ?? '', {
        withoutRowid: num(row['wr']) === 1,
        strict: num(row['strict']) === 1,
      });
    }
  } catch (error) {
    if (error instanceof AdapterError && error.code === 'TIMEOUT') throw error;
    for (const [name, ddl] of ddlByTable) tableFlags.set(name, tableOptions(ddl));
    warnings.push({
      code: 'table-list-unavailable',
      message: 'pragma_table_list is unavailable (SQLite < 3.37) — flags derived from DDL',
      tableId: null,
    });
  }

  // 3–5. Columns, foreign keys, indexes (set-based over pragma TVF joins) -----
  const columnRows = await guarded(COLUMNS_SQL);
  const fkRows = await guarded(FOREIGN_KEYS_SQL);
  const indexListRows = await guarded(INDEX_LIST_SQL);
  const indexColumnRows = await guarded(INDEX_COLUMNS_SQL);

  // 6. sqlite_stat1 (guarded: only exists after ANALYZE) ----------------------
  const statByTable = new Map<string, number>();
  try {
    for (const row of await guarded(STAT1_SQL)) {
      const name = str(row['table_name']) ?? '';
      const stat = str(row['stat']) ?? '';
      const rows = Number.parseInt(stat.split(' ')[0] ?? '', 10);
      if (Number.isFinite(rows)) {
        statByTable.set(name, Math.max(statByTable.get(name) ?? 0, rows));
      }
    }
  } catch (error) {
    if (error instanceof AdapterError && error.code === 'TIMEOUT') throw error;
    // No ANALYZE yet — small files fall through to exact counts below.
  }

  // -- tables -----------------------------------------------------------------
  const tables = new Map<string, MutableTable>();
  const autoincrementTables = new Set<string>();
  for (const row of masterRows) {
    const name = str(row['name']) ?? '';
    if (opts.tableFilter !== undefined && !opts.tableFilter({ schema, name })) continue;
    const kind = str(row['type']) === 'view' ? ('view' as const) : ('table' as const);
    const ddl = str(row['sql']);
    if (kind === 'table' && ddl !== null && /\bAUTOINCREMENT\b/i.test(ddl)) {
      autoincrementTables.add(name);
    }
    tables.set(name, {
      id: `${schema}.${name}`,
      schema,
      name,
      kind,
      comment: null, // SQLite has no comment syntax (hasComments: false)
      columns: [],
      primaryKey: [],
      uniques: [],
      checks: [],
      indexes: [],
      rowCountEstimate: null, // filled from stat1 / exact counts below
      rowCountExact: false,
      sizeBytes: null, // per-table sizes need the dbstat vtable — out of scope v1
      activity: null,
      rls: null, // Postgres only
      system: SYSTEM_TABLE_PATTERN.test(name),
      semantics: null,
    });
  }

  // -- columns ----------------------------------------------------------------
  const pkOrdinals = new Map<string, { name: string; ordinal: number }[]>();
  for (const row of columnRows) {
    const tableName = str(row['table_name']) ?? '';
    const table = tables.get(tableName);
    if (table === undefined) continue;
    const hidden = num(row['hidden']) ?? 0;
    if (hidden === 1) continue; // truly hidden columns are not part of the model
    const columnName = str(row['column_name']) ?? '';
    const declaredType = str(row['declared_type']) ?? '';
    const strict = tableFlags.get(tableName)?.strict ?? false;
    const mapped = mapSqliteType(declaredType, { strict });
    if (declaredType === '' && table.kind === 'table') {
      warnings.push({
        code: 'untyped-column',
        message: `column "${tableName}.${columnName}" has no declared type — add one for a better mapping`,
        tableId: table.id,
      });
    }
    const pkOrdinal = num(row['pk_ordinal']) ?? 0;
    if (pkOrdinal > 0) {
      const list = pkOrdinals.get(tableName) ?? [];
      list.push({ name: columnName, ordinal: pkOrdinal });
      pkOrdinals.set(tableName, list);
    }
    table.columns.push({
      name: columnName,
      // table_xinfo.cid is 0-based; the IR convention is 1-based (pg attnum).
      ordinal: (num(row['ordinal']) ?? 0) + 1,
      dbType: declaredType, // verbatim — '' means "no declared type" (BLOB affinity)
      logicalType: mapped.logicalType,
      nullable: num(row['not_null']) !== 1,
      default: hidden === 2 || hidden === 3 ? null : classifyDefault(str(row['default_text'])),
      isPrimaryKey: false,
      isUnique: false,
      isGenerated: hidden === 2 || hidden === 3, // 2 = virtual, 3 = stored
      enumRef: null,
      maxLength: mapped.maxLength,
      numericPrecision: mapped.numericPrecision,
      numericScale: mapped.numericScale,
      isArray: false,
      comment: null,
      references: null,
      semantics: null,
    });
  }

  // -- primary keys + rowid/AUTOINCREMENT defaults (05 §4.3) -------------------
  for (const [tableName, list] of pkOrdinals) {
    const table = tables.get(tableName);
    if (table === undefined) continue;
    table.primaryKey = list.sort((a, b) => a.ordinal - b.ordinal).map((c) => c.name);
    for (const column of table.columns) {
      if (table.primaryKey.includes(column.name)) column.isPrimaryKey = true;
    }
    const withoutRowid = tableFlags.get(tableName)?.withoutRowid ?? false;
    if (!withoutRowid && table.primaryKey.length === 1) {
      const pkColumn = table.columns.find((c) => c.name === table.primaryKey[0]);
      // INTEGER PRIMARY KEY is the rowid alias: auto-assigned on insert.
      // AUTOINCREMENT additionally pins monotonicity via sqlite_sequence.
      if (
        pkColumn !== undefined &&
        (pkColumn.dbType.trim().toUpperCase() === 'INTEGER' ||
          autoincrementTables.has(tableName)) &&
        pkColumn.logicalType === 'integer' &&
        pkColumn.default === null
      ) {
        pkColumn.default = { kind: 'autoincrement' };
      }
    }
  }

  // -- checks + enum synthesis from the DDL ------------------------------------
  const checkEnums = new Map<string, EnumDef>();
  for (const [tableName, ddl] of ddlByTable) {
    const table = tables.get(tableName);
    if (table === undefined || table.kind !== 'table' || ddl === null) continue;
    for (const check of scanCheckConstraints(ddl)) {
      table.checks.push({ name: check.name, expression: check.expression });
      const parsed = parseCheckEnum(check.expression);
      if (parsed === null || !table.columns.some((c) => c.name === parsed.column)) continue;
      const id = `${table.id}.${parsed.column}`;
      const column = table.columns.find((c) => c.name === parsed.column);
      if (column === undefined || column.enumRef !== null) continue;
      let values = parsed.values;
      if (values.length > ENUM_VALUE_CAP) {
        warnings.push({
          code: 'enum-capped',
          message: `enum "${id}" has ${values.length} values; capped at ${ENUM_VALUE_CAP}`,
          tableId: table.id,
        });
        values = values.slice(0, ENUM_VALUE_CAP);
      }
      checkEnums.set(id, { id, name: parsed.column, values, source: 'check' });
      column.enumRef = id;
    }
  }

  // -- indexes ------------------------------------------------------------------
  const indexColumns = new Map<string, { seq: number; name: string }[]>();
  for (const row of indexColumnRows) {
    const indexName = str(row['index_name']) ?? '';
    const columnName = str(row['column_name']); // null for rowid/expression parts
    const list = indexColumns.get(indexName) ?? [];
    if (columnName !== null) list.push({ seq: num(row['seqno']) ?? 0, name: columnName });
    indexColumns.set(indexName, list);
  }
  for (const row of indexListRows) {
    const table = tables.get(str(row['table_name']) ?? '');
    if (table === undefined) continue;
    const indexName = str(row['index_name']) ?? '';
    const origin = str(row['origin']) ?? 'c';
    const unique = num(row['is_unique']) === 1;
    const partial = num(row['partial']) === 1;
    const columns = (indexColumns.get(indexName) ?? [])
      .sort((a, b) => a.seq - b.seq)
      .map((c) => c.name);
    table.indexes.push({
      name: indexName,
      columns,
      expression: null, // expression indexes surface with empty columns in v1
      unique,
      primary: origin === 'pk',
      method: null, // SQLite has one index structure; no method taxonomy
      partial,
    });
    if (unique && origin === 'u') {
      table.uniques.push({ name: indexName, columns });
    }
    // Covered by a single-column unique constraint/index (05 §2.1) — the PK
    // autoindex counts, mirroring the pg reference adapter. (INTEGER PRIMARY
    // KEY rowid aliases have no autoindex; isPrimaryKey already covers them.)
    if (unique && !partial && columns.length === 1) {
      const column = table.columns.find((c) => c.name === columns[0]);
      if (column !== undefined) column.isUnique = true;
    }
  }

  // -- foreign keys (pragma foreign_key_list) ----------------------------------
  const relations: Relation[] = [];
  interface FkAccumulator {
    table: MutableTable;
    refTable: string;
    columns: { seq: number; from: string; to: string | null }[];
    onUpdate: FkAction | null;
    onDelete: FkAction | null;
  }
  const fkAccumulators = new Map<string, FkAccumulator>();
  for (const row of fkRows) {
    const table = tables.get(str(row['table_name']) ?? '');
    if (table === undefined) continue;
    const key = `${table.name}\x00${num(row['fk_id']) ?? 0}`;
    let acc = fkAccumulators.get(key);
    if (acc === undefined) {
      acc = {
        table,
        refTable: str(row['ref_table']) ?? '',
        columns: [],
        onUpdate: FK_ACTION_MAP[str(row['on_update']) ?? ''] ?? null,
        onDelete: FK_ACTION_MAP[str(row['on_delete']) ?? ''] ?? null,
      };
      fkAccumulators.set(key, acc);
    }
    acc.columns.push({
      seq: num(row['seq']) ?? 0,
      from: str(row['from_column']) ?? '',
      to: str(row['to_column']), // null = implicit reference to the target PK
    });
  }
  for (const acc of fkAccumulators.values()) {
    const target = tables.get(acc.refTable);
    const toTableId = `${schema}.${acc.refTable}`;
    if (target === undefined) {
      warnings.push({
        code: 'fk-target-excluded',
        message: `foreign key on "${acc.table.name}" references "${toTableId}" which is outside the introspected set`,
        tableId: acc.table.id,
      });
      continue;
    }
    const ordered = acc.columns.sort((a, b) => a.seq - b.seq);
    const columns = ordered.map((c) => c.from);
    const refColumns = ordered.map((c, i) => c.to ?? target.primaryKey[i] ?? '');
    if (refColumns.some((c) => c === '')) continue; // unresolvable implicit ref
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
    columns.forEach((columnName, position) => {
      const column = acc.table.columns.find((c) => c.name === columnName);
      const refColumn = refColumns[position];
      if (column !== undefined && column.references === null && refColumn !== undefined) {
        column.references = { tableId: toTableId, column: refColumn };
      }
    });
  }

  // -- one-to-one refinement: FK column set covered by a unique key -----------
  for (const relation of relations) {
    const table = [...tables.values()].find((t) => t.id === relation.from.tableId);
    if (table === undefined) continue;
    const key = [...relation.from.columns].sort().join(' ');
    const uniqueSets = [
      table.primaryKey,
      ...table.uniques.map((u) => u.columns),
      ...table.indexes.filter((i) => i.unique && !i.partial).map((i) => i.columns),
    ];
    if (uniqueSets.some((set) => set.length > 0 && [...set].sort().join(' ') === key)) {
      relation.cardinality = 'one-to-one';
    }
  }

  // -- row counts: stat1 estimates, else small-file exact counts (05 §4.3) ----
  if (collectRowEstimates) {
    const uncounted: string[] = [];
    for (const table of tables.values()) {
      if (table.kind !== 'table') continue;
      const estimate = statByTable.get(table.name);
      if (estimate !== undefined) {
        table.rowCountEstimate = estimate;
      } else if (
        ctx.fileSizeBytes !== null &&
        ctx.fileSizeBytes < EXACT_COUNT_MAX_FILE_BYTES
      ) {
        uncounted.push(table.name);
      }
    }
    if (uncounted.length > 0) {
      const countRows = await guarded(exactCountsSql(uncounted));
      for (const row of countRows) {
        const table = tables.get(str(row['table_name']) ?? '');
        const count = num(row['n']);
        if (table !== undefined && count !== null) {
          table.rowCountEstimate = count;
          table.rowCountExact = true; // 05 §2.1: true only for SQLite exact counts
        }
      }
    } else if (
      ctx.fileSizeBytes !== null &&
      ctx.fileSizeBytes >= EXACT_COUNT_MAX_FILE_BYTES &&
      [...tables.values()].some((t) => t.kind === 'table' && t.rowCountEstimate === null)
    ) {
      warnings.push({
        code: 'counts-unavailable',
        message: 'file exceeds the exact-count threshold — run ANALYZE for row counts',
        tableId: null,
      });
    }
  }

  // -- final assembly ----------------------------------------------------------
  const enums = [...checkEnums.values()].sort(compareBy((def) => def.id));
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
    dialect: 'sqlite',
    source: { kind: 'live', connectionId: ctx.connectionId },
    name: ctx.databaseName,
    defaultSchema: schema,
    schemas: [schema],
    tables: sortedTables,
    enums,
    relations,
    capabilities: { ...SQLITE_CAPABILITIES },
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
