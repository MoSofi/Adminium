/**
 * Drizzle schema parser — 05-introspection-engine.md §5.2 row 3, at the
 * tokenizer level (no TypeScript compiler): `pgTable/mysqlTable/sqliteTable`
 * calls are located by regex, their argument lists split with a
 * balance-aware scanner, and column builder chains
 * (`varchar('x',{length}).notNull().references(() => other.col)`) parsed
 * method-by-method. Dynamic/computed names are unresolvable statically and
 * produce warnings.
 */
import type { ColumnDefault, DatabaseModel, Dialect, FkAction, LogicalType } from '@adminium/engine';

import { ModelBuilder, type ColumnDraft, type TableDraft } from '../builder.js';
import { SchemaImportError } from '../errors.js';
import { collectStrings, findBalanced, splitTopLevel, stringLiteral, parseArgs } from '../text.js';
import type { WarningList } from '../warnings.js';

const JS_SCAN = { backslashEscapes: true, lineComments: ['//'], blockComments: true } as const;

const BUILDER_TYPES: Readonly<
  Record<string, { logicalType: LogicalType; dbType: string }>
> = {
  serial: { logicalType: 'integer', dbType: 'serial' },
  smallserial: { logicalType: 'integer', dbType: 'smallserial' },
  bigserial: { logicalType: 'bigint', dbType: 'bigserial' },
  integer: { logicalType: 'integer', dbType: 'integer' },
  int: { logicalType: 'integer', dbType: 'int' },
  tinyint: { logicalType: 'integer', dbType: 'tinyint' },
  smallint: { logicalType: 'integer', dbType: 'smallint' },
  mediumint: { logicalType: 'integer', dbType: 'mediumint' },
  bigint: { logicalType: 'bigint', dbType: 'bigint' },
  text: { logicalType: 'text', dbType: 'text' },
  varchar: { logicalType: 'varchar', dbType: 'varchar' },
  char: { logicalType: 'varchar', dbType: 'char' },
  boolean: { logicalType: 'boolean', dbType: 'boolean' },
  timestamp: { logicalType: 'timestamp', dbType: 'timestamp' },
  datetime: { logicalType: 'timestamp', dbType: 'datetime' },
  date: { logicalType: 'date', dbType: 'date' },
  time: { logicalType: 'time', dbType: 'time' },
  interval: { logicalType: 'interval', dbType: 'interval' },
  json: { logicalType: 'json', dbType: 'json' },
  jsonb: { logicalType: 'json', dbType: 'jsonb' },
  uuid: { logicalType: 'uuid', dbType: 'uuid' },
  numeric: { logicalType: 'decimal', dbType: 'numeric' },
  decimal: { logicalType: 'decimal', dbType: 'decimal' },
  real: { logicalType: 'float', dbType: 'real' },
  doublePrecision: { logicalType: 'float', dbType: 'double precision' },
  double: { logicalType: 'float', dbType: 'double' },
  float: { logicalType: 'float', dbType: 'float' },
  blob: { logicalType: 'binary', dbType: 'blob' },
  bytea: { logicalType: 'binary', dbType: 'bytea' },
  inet: { logicalType: 'inet', dbType: 'inet' },
};

interface TableSite {
  varName: string;
  fn: 'pgTable' | 'mysqlTable' | 'sqliteTable';
  tableName: string;
  columnsObject: string;
  extras: string | null;
}

interface PendingRef {
  table: TableDraft;
  column: ColumnDraft;
  targetVar: string;
  targetKey: string;
  onDelete: FkAction | null;
  onUpdate: FkAction | null;
}

export function parseDrizzle(content: string, name: string, warnings: WarningList): DatabaseModel {
  const builder = new ModelBuilder(warnings);

  // pgEnum / mysqlEnum declarations bound to variables.
  const enumVars = new Map<string, { id: string; values: string[] }>();
  const enumRe = /const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:pgEnum|mysqlEnum)\s*\(/g;
  let em: RegExpExecArray | null;
  while ((em = enumRe.exec(content)) !== null) {
    const open = em.index + em[0].length - 1;
    const close = findBalanced(content, open, JS_SCAN);
    if (close === -1) continue;
    const args = splitTopLevel(content.slice(open + 1, close), ',', JS_SCAN);
    const enumName = stringLiteral(args[0] ?? '') ?? (em[1] as string);
    const values = collectStrings(args[1] ?? '', JS_SCAN);
    if (values.length > 0) {
      builder.addEnum({ id: enumName, name: enumName, values, source: 'import' });
      enumVars.set(em[1] as string, { id: enumName, values });
    }
  }

  // Table declaration sites.
  const sites: TableSite[] = [];
  const tableRe = /const\s+([A-Za-z_$][\w$]*)\s*=\s*(pgTable|mysqlTable|sqliteTable)\s*\(/g;
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(content)) !== null) {
    const open = tm.index + tm[0].length - 1;
    const close = findBalanced(content, open, JS_SCAN);
    if (close === -1) continue;
    const args = splitTopLevel(content.slice(open + 1, close), ',', JS_SCAN);
    const nameArg = stringLiteral(args[0] ?? '');
    if (nameArg === null) {
      warnings.add(
        'dynamic-name',
        `table bound to "${tm[1]}" has a non-literal name and was skipped`,
      );
      continue;
    }
    if (args[1] === undefined || !args[1].trimStart().startsWith('{')) {
      warnings.add('dynamic-name', `table "${nameArg}" has a non-literal column map and was skipped`);
      continue;
    }
    sites.push({
      varName: tm[1] as string,
      fn: tm[2] as TableSite['fn'],
      tableName: nameArg,
      columnsObject: stripBraces(args[1]),
      extras: args[2] ?? null,
    });
  }
  if (sites.length === 0) {
    throw new SchemaImportError('no pgTable/mysqlTable/sqliteTable declarations found');
  }

  const dialect: Dialect =
    sites[0]?.fn === 'mysqlTable' ? 'mysql' : sites[0]?.fn === 'sqliteTable' ? 'sqlite' : 'postgres';

  const varToTable = new Map<string, TableDraft>();
  /** varName → property key → db column name */
  const keyMaps = new Map<string, Map<string, string>>();
  const pendingRefs: PendingRef[] = [];

  for (const site of sites) {
    const table = builder.addTable({ name: site.tableName });
    varToTable.set(site.varName, table);
    const keyMap = new Map<string, string>();
    keyMaps.set(site.varName, keyMap);

    for (const entry of splitTopLevel(site.columnsObject, ',', JS_SCAN)) {
      const kv = /^([A-Za-z_$][\w$]*|"[^"]+"|'[^']+')\s*:\s*([\s\S]+)$/.exec(entry.trim());
      if (!kv) continue;
      const key = stringLiteral(kv[1] as string) ?? (kv[1] as string);
      const col = parseColumnChain(kv[2] as string, key, table, builder, enumVars, pendingRefs, warnings);
      if (col) {
        table.columns.push(col);
        keyMap.set(key, col.name);
      }
    }

    if (site.extras !== null) parseExtras(site.extras, site.varName, table, keyMaps, warnings);
  }

  // Resolve deferred references now that every table/column exists.
  for (const ref of pendingRefs) {
    const target = varToTable.get(ref.targetVar);
    const keyMap = keyMaps.get(ref.targetVar);
    if (!target || !keyMap) {
      warnings.add(
        'unresolved-reference',
        `reference from "${ref.table.name}"."${ref.column.name}" to unknown table variable "${ref.targetVar}"`,
      );
      continue;
    }
    ref.column.references = {
      table: target.name,
      column: keyMap.get(ref.targetKey) ?? ref.targetKey,
      onDelete: ref.onDelete,
      onUpdate: ref.onUpdate,
    };
  }

  return builder.finalize({
    format: 'drizzle',
    dialect,
    name,
    capabilities: {
      hasEnums: dialect !== 'sqlite',
      hasFKs: true,
      hasComments: false,
      hasChecks: false,
      hasSchemas: false,
    },
  });
}

function stripBraces(objectLiteral: string): string {
  const s = objectLiteral.trim();
  return s.startsWith('{') && s.endsWith('}') ? s.slice(1, -1) : s;
}

interface ChainCall {
  method: string;
  args: string;
}

/** `builder('name', {opts}).notNull().default(x)` → head + calls. */
function parseCallChain(expr: string): { head: string; headArgs: string; calls: ChainCall[] } | null {
  const m = /^([A-Za-z_$][\w$.]*)\s*\(/.exec(expr.trim());
  if (!m) return null;
  const text = expr.trim();
  const open = m[0].length - 1;
  const close = findBalanced(text, open, JS_SCAN);
  if (close === -1) return null;
  const head = m[1] as string;
  const headArgs = text.slice(open + 1, close);
  const calls: ChainCall[] = [];
  let i = close + 1;
  while (i < text.length) {
    const cm = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(text.slice(i));
    if (!cm) break;
    const callOpen = i + cm[0].length - 1;
    const callClose = findBalanced(text, callOpen, JS_SCAN);
    if (callClose === -1) break;
    calls.push({ method: cm[1] as string, args: text.slice(callOpen + 1, callClose) });
    i = callClose + 1;
  }
  return { head, headArgs, calls };
}

function parseColumnChain(
  expr: string,
  key: string,
  table: TableDraft,
  builder: ModelBuilder,
  enumVars: ReadonlyMap<string, { id: string; values: string[] }>,
  pendingRefs: PendingRef[],
  warnings: WarningList,
): ColumnDraft | null {
  const chain = parseCallChain(expr);
  if (!chain) {
    warnings.add('dynamic-name', `column "${table.name}"."${key}" is not a builder call; skipped`);
    return null;
  }
  const headArgs = splitTopLevel(chain.headArgs, ',', JS_SCAN);
  const dbName = stringLiteral(headArgs[0] ?? '') ?? key;
  const opts =
    headArgs.find((a) => a.trimStart().startsWith('{')) !== undefined
      ? parseArgs(stripBraces(headArgs.find((a) => a.trimStart().startsWith('{')) as string), 'js').named
      : {};

  const col: ColumnDraft = { name: dbName };
  const enumVar = enumVars.get(chain.head);
  const inlineEnum = chain.head === 'mysqlEnum' || chain.head === 'pgEnum';
  if (enumVar) {
    col.dbType = enumVar.id;
    col.logicalType = 'enum';
    col.enumRef = enumVar.id;
  } else if (inlineEnum) {
    const values = collectStrings(headArgs.slice(1).join(','), JS_SCAN);
    if (values.length > 0) {
      const id = `public.${table.name}.${dbName}`;
      col.dbType = `enum(${values.map((v) => `'${v}'`).join(',')})`;
      col.logicalType = 'enum';
      col.enumRef = id;
      builder.addEnum({ id, name: dbName, values, source: 'column-type' });
    }
  } else {
    const known = BUILDER_TYPES[chain.head];
    if (known === undefined) {
      warnings.addCount('unknown-builder', `unknown drizzle column builder "${chain.head}"`);
      col.dbType = chain.head;
      col.logicalType = 'unknown';
    } else {
      col.dbType = known.dbType;
      col.logicalType = known.logicalType;
    }
  }

  const length = Number.parseInt(opts['length'] ?? '', 10);
  if (Number.isFinite(length)) {
    col.maxLength = length;
    col.dbType = `${col.dbType}(${length})`;
  }
  const precision = Number.parseInt(opts['precision'] ?? '', 10);
  if (Number.isFinite(precision) && (col.logicalType === 'decimal' || col.logicalType === 'float')) {
    col.numericPrecision = precision;
    const scale = Number.parseInt(opts['scale'] ?? '', 10);
    if (Number.isFinite(scale)) col.numericScale = scale;
  }
  if (opts['withTimezone'] === 'true' && col.logicalType === 'timestamp') {
    col.logicalType = 'timestamptz';
    col.dbType = 'timestamp with time zone';
  }
  if (chain.head === 'serial' || chain.head === 'smallserial' || chain.head === 'bigserial') {
    col.default = { kind: 'autoincrement' };
    col.nullable = false;
  }

  for (const call of chain.calls) {
    switch (call.method) {
      case 'notNull':
        col.nullable = false;
        break;
      case 'primaryKey': {
        col.isPrimaryKey = true;
        col.nullable = false;
        const pkOpts = parseArgs(stripBraces(call.args), 'js').named;
        if (pkOpts['autoIncrement'] === 'true') col.default = { kind: 'autoincrement' };
        break;
      }
      case 'unique':
        col.isUnique = true;
        break;
      case 'default':
        col.default = classifyJsDefault(call.args);
        break;
      case 'defaultNow':
        col.default = { kind: 'now' };
        break;
      case 'defaultRandom':
        col.default = { kind: 'uuid' };
        break;
      case '$defaultFn':
      case '$default':
      case '$onUpdate':
      case '$onUpdateFn':
        // Application-level defaults never reach the database schema.
        break;
      case 'references': {
        const parts = splitTopLevel(call.args, ',', JS_SCAN);
        const target = /=>\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/.exec(parts[0] ?? '');
        if (!target) {
          warnings.add(
            'unresolved-reference',
            `could not resolve .references() target for "${table.name}"."${col.name}"`,
          );
          break;
        }
        const refOpts = parts[1] !== undefined ? parseArgs(stripBraces(parts[1]), 'js').named : {};
        pendingRefs.push({
          table,
          column: col,
          targetVar: target[1] as string,
          targetKey: target[2] as string,
          onDelete: fkActionFromString(refOpts['onDelete']),
          onUpdate: fkActionFromString(refOpts['onUpdate']),
        });
        break;
      }
      case 'array':
        col.isArray = true;
        break;
      case 'generatedAlwaysAs':
        col.isGenerated = true;
        break;
      case 'generatedAlwaysAsIdentity':
      case 'generatedByDefaultAsIdentity':
        col.default = { kind: 'autoincrement' };
        break;
      case '$type':
      case 'onUpdateNow':
        break;
      default:
        warnings.addCount('unknown-builder', `ignored drizzle modifier .${call.method}()`);
    }
  }
  return col;
}

function classifyJsDefault(raw: string): ColumnDefault {
  const arg = raw.trim();
  if (arg.length === 0) return null;
  const str = stringLiteral(arg);
  if (str !== null) return { kind: 'literal', text: str };
  if (/^-?\d+(\.\d+)?$/.test(arg) || arg === 'true' || arg === 'false') {
    return { kind: 'literal', text: arg };
  }
  if (/^sql`/.test(arg)) {
    const inner = /^sql`([\s\S]*)`$/.exec(arg)?.[1] ?? arg;
    if (/current_timestamp|now\(\)/i.test(inner)) return { kind: 'now' };
    if (/gen_random_uuid|uuid/i.test(inner)) return { kind: 'uuid' };
    return { kind: 'expression', text: inner };
  }
  return { kind: 'expression', text: arg };
}

function fkActionFromString(raw: string | undefined): FkAction | null {
  const value = raw === undefined ? null : stringLiteral(raw);
  if (value === null) return null;
  switch (value) {
    case 'cascade':
      return 'cascade';
    case 'restrict':
      return 'restrict';
    case 'set null':
      return 'set-null';
    case 'set default':
      return 'set-default';
    case 'no action':
      return 'no-action';
    default:
      return null;
  }
}

/** Third-argument extras: composite PK, unique constraints, indexes. */
function parseExtras(
  extras: string,
  tableVar: string,
  table: TableDraft,
  keyMaps: ReadonlyMap<string, Map<string, string>>,
  warnings: WarningList,
): void {
  const keyMap = keyMaps.get(tableVar) ?? new Map<string, string>();
  const resolveCols = (text: string): string[] => {
    const cols: string[] = [];
    const re = /[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      cols.push(keyMap.get(m[1] as string) ?? (m[1] as string));
    }
    return cols;
  };

  const callRe = /\b(primaryKey|unique|uniqueIndex|index|foreignKey)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(extras)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = findBalanced(extras, open, JS_SCAN);
    if (close === -1) continue;
    const fn = m[1] as string;
    const args = extras.slice(open + 1, close);
    // Chained `.on(t.a, t.b)` after unique()/index().
    let onArgs: string | null = null;
    const after = extras.slice(close + 1);
    const onMatch = /^\s*\.\s*on\s*\(/.exec(after);
    if (onMatch) {
      const onOpen = close + 1 + onMatch[0].length - 1;
      const onClose = findBalanced(extras, onOpen, JS_SCAN);
      if (onClose !== -1) onArgs = extras.slice(onOpen + 1, onClose);
    }

    if (fn === 'primaryKey') {
      const cols = resolveCols(args);
      if (cols.length > 0) table.primaryKey = cols;
    } else if (fn === 'unique' || fn === 'uniqueIndex') {
      const cols = resolveCols(onArgs ?? args);
      const name = stringLiteral(splitTopLevel(args, ',', JS_SCAN)[0] ?? '') ?? null;
      if (cols.length > 0) {
        table.uniques.push({ name, columns: cols });
        if (fn === 'uniqueIndex' && name !== null) {
          table.indexes.push({ name, columns: cols, unique: true });
        }
      }
    } else if (fn === 'index') {
      const cols = resolveCols(onArgs ?? args);
      const name =
        stringLiteral(splitTopLevel(args, ',', JS_SCAN)[0] ?? '') ?? `${table.name}_${cols.join('_')}_idx`;
      if (cols.length > 0) table.indexes.push({ name, columns: cols });
    } else if (fn === 'foreignKey') {
      warnings.addCount('unsupported-constraint', 'composite foreignKey() in extras not resolved');
    }
    callRe.lastIndex = close + 1;
  }
}
