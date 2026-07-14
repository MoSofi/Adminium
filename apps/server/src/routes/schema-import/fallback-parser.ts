/**
 * Minimal built-in schema-file parser — the M5 stub behind
 * `POST /api/v1/schema-import/parse` while `@adminium/schema-import` (the
 * full parser matrix: Prisma, Drizzle, TypeORM, Sequelize, Rails, Django —
 * M9) is built concurrently. Supports exactly two formats:
 *
 * - `sql-ddl`  — CREATE TABLE statements (pg_dump-style DDL subset),
 * - `json-ir`  — the engine's DatabaseModel JSON (or a `{ tables: [...] }`
 *                fragment; dialect/name defaulted).
 *
 * Every produced model passes `parseDatabaseModel`, so replies can never
 * carry a shape the engine would reject downstream.
 */

import {
  parseDatabaseModel,
  type DatabaseModel,
  type ImportFormat,
  type LogicalType,
} from '@adminium/engine';

export class SchemaParseError extends Error {
  override readonly name = 'SchemaParseError';
  /** 'UNSUPPORTED_FORMAT' | 'PARSE_FAILED' — mapped to 422 details by the route. */
  readonly reason: 'UNSUPPORTED_FORMAT' | 'PARSE_FAILED';
  readonly details: unknown;

  constructor(reason: 'UNSUPPORTED_FORMAT' | 'PARSE_FAILED', message: string, details?: unknown) {
    super(message);
    this.reason = reason;
    this.details = details;
  }
}

export interface FallbackParseResult {
  model: DatabaseModel;
  format: ImportFormat;
  warnings: string[];
}

/** Formats the built-in stub can actually parse this wave. */
export const FALLBACK_SUPPORTED_FORMATS: readonly ImportFormat[] = ['sql-ddl', 'json-ir'];

/** Best-effort format detection from content and/or file name. */
export function sniffFormat(content: string, fileName?: string): ImportFormat | null {
  const trimmed = content.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json-ir';
  if (/\bcreate\s+table\b/i.test(content)) return 'sql-ddl';
  const lower = (fileName ?? '').toLowerCase();
  if (lower.endsWith('.sql')) return 'sql-ddl';
  if (lower.endsWith('.json')) return 'json-ir';
  if (lower.endsWith('.prisma')) return 'prisma';
  if (lower.endsWith('.rb')) return 'rails';
  if (lower.endsWith('.py')) return 'django';
  return null;
}

/** File stem (no directories, no extension) — used as the model name. */
function modelName(fileName: string | undefined, fallback: string): string {
  if (fileName === undefined) return fallback;
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const stem = base.replace(/\.[^.]+$/, '');
  return stem.length > 0 ? stem : fallback;
}

// --- sql-ddl ----------------------------------------------------------------

/** Native type prefix → engine logical type (the closed 05 §2.2 set). */
const TYPE_MAP: ReadonlyArray<[RegExp, LogicalType]> = [
  [/^(big(int|serial)|int8)/, 'bigint'],
  [/^(small(int|serial)|int2|int4|integer|int\b|serial|mediumint|tinyint\s*\(\s*(?!1\b)\d+\s*\))/, 'integer'],
  [/^tinyint\s*\(\s*1\s*\)/, 'boolean'],
  [/^tinyint/, 'integer'],
  [/^(bool|boolean)/, 'boolean'],
  [/^(numeric|decimal|money)/, 'decimal'],
  [/^(real|float|double)/, 'float'],
  [/^(varchar|character\s+varying|nvarchar|varying)/, 'varchar'],
  [/^(char|character|nchar)/, 'varchar'],
  [/^(text|citext|mediumtext|longtext|tinytext|clob|string)/, 'text'],
  [/^(timestamptz|timestamp\s+with\s+time\s+zone)/, 'timestamptz'],
  [/^(timestamp|datetime)/, 'timestamp'],
  [/^date\b/, 'date'],
  [/^time\b/, 'time'],
  [/^interval/, 'interval'],
  [/^uuid/, 'uuid'],
  [/^(jsonb|json)/, 'json'],
  [/^(bytea|blob|binary|varbinary)/, 'binary'],
  [/^enum/, 'enum'],
  [/^(inet|cidr)/, 'inet'],
  [/^(geometry|geography|point|polygon)/, 'geometry'],
];

function logicalTypeFor(dbType: string): LogicalType {
  const lower = dbType.toLowerCase();
  for (const [pattern, logical] of TYPE_MAP) {
    if (pattern.test(lower)) return logical;
  }
  return 'unknown';
}

function stripQuotes(identifier: string): string {
  return identifier.replace(/^["'`[]|["'`\]]$/g, '');
}

/** Split a parenthesized body on top-level commas (paren + quote aware). */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const char of body) {
    if (quote !== null) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

interface RawColumn {
  name: string;
  dbType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  references: { table: string; column: string | null } | null;
}

interface RawTable {
  schema: string | null;
  name: string;
  columns: RawColumn[];
  primaryKey: string[];
  foreignKeys: Array<{ columns: string[]; table: string; refColumns: string[] }>;
  uniques: string[][];
}

const CONSTRAINT_START =
  /^(constraint\s+\S+\s+)?(primary\s+key|foreign\s+key|unique|check|exclude|key\s|index\s|fulltext|spatial)/i;

function parseColumnItem(item: string): RawColumn | null {
  const match = /^("[^"]+"|`[^`]+`|\[[^\]]+\]|[\w$]+)\s+(.+)$/s.exec(item);
  if (match === null) return null;
  const name = stripQuotes(match[1] ?? '');
  const rest = match[2] ?? '';
  // dbType = leading tokens up to the first standalone constraint keyword.
  const typeMatch =
    /^([\w"]+(?:\s+(?:varying|precision|with(?:out)?\s+time\s+zone))*(?:\s*\([^)]*\))?(?:\[\])?)/i.exec(rest);
  const dbType = (typeMatch?.[1] ?? 'text').replace(/"/g, '');
  const tail = rest.slice(dbType.length);
  const referencesMatch =
    /references\s+("[^"]+"|`[^`]+`|[\w$.]+)\s*(?:\(\s*("[^"]+"|`[^`]+`|[\w$]+)\s*\))?/i.exec(tail);
  return {
    name,
    dbType: dbType.trim(),
    nullable: !/\bnot\s+null\b/i.test(tail),
    isPrimaryKey: /\bprimary\s+key\b/i.test(tail),
    isUnique: /\bunique\b/i.test(tail),
    references:
      referencesMatch === null
        ? null
        : {
            table: stripQuotes(referencesMatch[1] ?? ''),
            column: referencesMatch[2] === undefined ? null : stripQuotes(referencesMatch[2]),
          },
  };
}

function parseIdentifierList(list: string): string[] {
  return splitTopLevel(list).map((part) => stripQuotes(part.trim()));
}

function parseCreateTables(sql: string, warnings: string[]): RawTable[] {
  const noComments = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const tables: RawTable[] = [];
  const createRe =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w$]+)(?:\.(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w$]+))?)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = createRe.exec(noComments)) !== null) {
    // Balanced-paren scan for the statement body.
    let depth = 1;
    let quote: string | null = null;
    let end = createRe.lastIndex;
    while (end < noComments.length && depth > 0) {
      const char = noComments[end] ?? '';
      if (quote !== null) {
        if (char === quote) quote = null;
      } else if (char === "'" || char === '"' || char === '`') {
        quote = char;
      } else if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
      }
      end += 1;
    }
    if (depth !== 0) {
      warnings.push('Unterminated CREATE TABLE statement — skipped the rest of the file.');
      break;
    }
    const body = noComments.slice(createRe.lastIndex, end - 1);
    createRe.lastIndex = end;

    const qualified = match[1] ?? '';
    const dotAt = qualified.startsWith('"') || qualified.startsWith('`') || qualified.startsWith('[')
      ? qualified.indexOf('.', qualified.length > 0 ? 1 : 0)
      : qualified.indexOf('.');
    const schema = dotAt > 0 ? stripQuotes(qualified.slice(0, dotAt)) : null;
    const name = stripQuotes(dotAt > 0 ? qualified.slice(dotAt + 1) : qualified);

    const table: RawTable = { schema, name, columns: [], primaryKey: [], foreignKeys: [], uniques: [] };
    for (const item of splitTopLevel(body)) {
      if (CONSTRAINT_START.test(item)) {
        const pk = /primary\s+key\s*\(([^)]*)\)/i.exec(item);
        if (pk !== null) {
          table.primaryKey = parseIdentifierList(pk[1] ?? '');
          continue;
        }
        const fk =
          /foreign\s+key\s*\(([^)]*)\)\s*references\s+("[^"]+"|`[^`]+`|[\w$.]+)\s*(?:\(([^)]*)\))?/i.exec(item);
        if (fk !== null) {
          table.foreignKeys.push({
            columns: parseIdentifierList(fk[1] ?? ''),
            table: stripQuotes(fk[2] ?? ''),
            refColumns: fk[3] === undefined ? [] : parseIdentifierList(fk[3]),
          });
          continue;
        }
        const unique = /^(?:constraint\s+\S+\s+)?unique\s*\(([^)]*)\)/i.exec(item);
        if (unique !== null) {
          table.uniques.push(parseIdentifierList(unique[1] ?? ''));
          continue;
        }
        continue; // CHECK / KEY / INDEX / EXCLUDE — ignored by the stub.
      }
      const column = parseColumnItem(item);
      if (column === null) {
        warnings.push(`Could not parse a column definition in ${name} — skipped: ${item.slice(0, 60)}`);
        continue;
      }
      table.columns.push(column);
    }
    if (table.columns.length === 0) {
      warnings.push(`Table ${name} has no parseable columns — skipped.`);
      continue;
    }
    tables.push(table);
  }
  return tables;
}

function sqlDdlToModel(content: string, fileName: string | undefined, warnings: string[]): DatabaseModel {
  const raw = parseCreateTables(content, warnings);
  if (raw.length === 0) {
    throw new SchemaParseError('PARSE_FAILED', 'No CREATE TABLE statements found in the file.');
  }

  const defaultSchema = raw.find((t) => t.schema !== null)?.schema ?? 'public';
  const idFor = (table: RawTable): string => `${table.schema ?? defaultSchema}.${table.name}`;
  const byName = new Map<string, RawTable>();
  for (const table of raw) {
    byName.set(table.name, table);
    byName.set(idFor(table), table);
  }

  const resolveRef = (
    from: string,
    target: string,
    column: string | null,
  ): { tableId: string; column: string } | null => {
    const hit = byName.get(stripQuotes(target)) ?? byName.get(`${defaultSchema}.${stripQuotes(target)}`);
    if (hit === undefined) {
      warnings.push(`${from}: REFERENCES ${target} points outside the file — relation dropped.`);
      return null;
    }
    const refColumn = column ?? hit.primaryKey[0] ?? hit.columns.find((c) => c.isPrimaryKey)?.name ?? null;
    if (refColumn === null || !hit.columns.some((c) => c.name === refColumn)) {
      warnings.push(`${from}: could not resolve the referenced column on ${target} — relation dropped.`);
      return null;
    }
    return { tableId: idFor(hit), column: refColumn };
  };

  const tables = raw.map((table) => {
    const pkColumns =
      table.primaryKey.length > 0
        ? table.primaryKey
        : table.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
    const columns = table.columns.map((column, index) => {
      let references: { tableId: string; column: string } | null = null;
      if (column.references !== null) {
        references = resolveRef(`${table.name}.${column.name}`, column.references.table, column.references.column);
      } else {
        const fk = table.foreignKeys.find((f) => f.columns.length === 1 && f.columns[0] === column.name);
        if (fk !== undefined) {
          references = resolveRef(`${table.name}.${column.name}`, fk.table, fk.refColumns[0] ?? null);
        }
      }
      return {
        name: column.name,
        ordinal: index + 1,
        dbType: column.dbType,
        logicalType: logicalTypeFor(column.dbType),
        nullable: column.nullable && !pkColumns.includes(column.name),
        isPrimaryKey: pkColumns.includes(column.name),
        isUnique: column.isUnique || table.uniques.some((u) => u.length === 1 && u[0] === column.name),
        ...(references === null ? {} : { references }),
      };
    });
    return {
      schema: table.schema ?? defaultSchema,
      name: table.name,
      columns,
      primaryKey: pkColumns.filter((name) => columns.some((c) => c.name === name)),
      uniques: table.uniques.map((u) => ({ name: null, columns: u })),
    };
  });

  return parseDatabaseModel({
    dialect: 'generic',
    source: { kind: 'import', format: 'sql-ddl', ...(fileName === undefined ? {} : { fileName }) },
    name: modelName(fileName, 'schema'),
    defaultSchema,
    schemas: [...new Set(tables.map((t) => t.schema))],
    tables,
    stats: {
      tableCount: tables.length,
      columnCount: tables.reduce((sum, t) => sum + t.columns.length, 0),
      relationCount: 0,
      durationMs: 0,
    },
  });
}

// --- json-ir ----------------------------------------------------------------

function jsonIrToModel(content: string, fileName: string | undefined): DatabaseModel {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new SchemaParseError('PARSE_FAILED', 'The file is not valid JSON.', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SchemaParseError('PARSE_FAILED', 'Expected a JSON object with a `tables` array.');
  }
  // Accept a bare { tables } fragment — default the envelope fields.
  const value = {
    dialect: 'generic',
    name: modelName(fileName, 'import'),
    source: { kind: 'import', format: 'json-ir', ...(fileName === undefined ? {} : { fileName }) },
    ...(parsed as Record<string, unknown>),
  };
  try {
    return parseDatabaseModel(value);
  } catch (error) {
    throw new SchemaParseError('PARSE_FAILED', 'The JSON does not match the Adminium schema model.', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

// --- entry ------------------------------------------------------------------

export function fallbackParseSchemaFile(
  content: string,
  opts: { format?: ImportFormat | undefined; fileName?: string | undefined } = {},
): FallbackParseResult {
  const format = opts.format ?? sniffFormat(content, opts.fileName);
  if (format === null) {
    throw new SchemaParseError(
      'UNSUPPORTED_FORMAT',
      'Could not detect the schema format. SQL DDL and Adminium JSON are supported today.',
      { supported: FALLBACK_SUPPORTED_FORMATS },
    );
  }
  if (!FALLBACK_SUPPORTED_FORMATS.includes(format)) {
    throw new SchemaParseError(
      'UNSUPPORTED_FORMAT',
      `The '${format}' format isn't supported yet — SQL DDL and Adminium JSON work today; ORM parsers land in M9.`,
      { format, supported: FALLBACK_SUPPORTED_FORMATS },
    );
  }
  const warnings: string[] = [];
  const model =
    format === 'sql-ddl' ? sqlDdlToModel(content, opts.fileName, warnings) : jsonIrToModel(content, opts.fileName);
  return { model, format, warnings: [...warnings, ...model.warnings.map((w) => w.message)] };
}
