// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rails `schema.rb` parser — 05-introspection-engine.md §5.2 row 6. Pure
 * line grammar, no Ruby runtime: `create_table "name", id:, force: do |t|`
 * blocks with `t.<type> "col", null:, default:, limit:, precision:, scale:,
 * comment:` lines, `t.references`/`t.belongs_to` (→ `<name>_id` + FK by the
 * pluralization convention), `t.index`, `t.timestamps`, plus top-level
 * `add_index` / `add_foreign_key` / `add_check_constraint`. `execute` blocks
 * and unknown `t.` methods warn and are skipped.
 */
import type { ColumnDefault, DatabaseModel, FkAction, LogicalType } from '@adminium/engine';

import { ModelBuilder, type ColumnDraft, type TableDraft } from '../builder.js';
import { extractCheckEnum } from '../check-enum.js';
import { SchemaImportError } from '../errors.js';
import { parseArgs, pluralize, scalarValue, singularize, stringLiteral, splitTopLevel } from '../text.js';
import type { WarningList } from '../warnings.js';

const T_TYPES: Readonly<Record<string, { logicalType: LogicalType; dbType: string }>> = {
  string: { logicalType: 'varchar', dbType: 'character varying' },
  text: { logicalType: 'text', dbType: 'text' },
  integer: { logicalType: 'integer', dbType: 'integer' },
  bigint: { logicalType: 'bigint', dbType: 'bigint' },
  smallint: { logicalType: 'integer', dbType: 'smallint' },
  decimal: { logicalType: 'decimal', dbType: 'numeric' },
  numeric: { logicalType: 'decimal', dbType: 'numeric' },
  float: { logicalType: 'float', dbType: 'double precision' },
  boolean: { logicalType: 'boolean', dbType: 'boolean' },
  date: { logicalType: 'date', dbType: 'date' },
  datetime: { logicalType: 'timestamp', dbType: 'timestamp' },
  timestamp: { logicalType: 'timestamp', dbType: 'timestamp' },
  timestamptz: { logicalType: 'timestamptz', dbType: 'timestamp with time zone' },
  time: { logicalType: 'time', dbType: 'time' },
  json: { logicalType: 'json', dbType: 'json' },
  jsonb: { logicalType: 'json', dbType: 'jsonb' },
  uuid: { logicalType: 'uuid', dbType: 'uuid' },
  binary: { logicalType: 'binary', dbType: 'bytea' },
  blob: { logicalType: 'binary', dbType: 'blob' },
  inet: { logicalType: 'inet', dbType: 'inet' },
  cidr: { logicalType: 'inet', dbType: 'cidr' },
  interval: { logicalType: 'interval', dbType: 'interval' },
};

export function parseRails(content: string, name: string, warnings: WarningList): DatabaseModel {
  const builder = new ModelBuilder(warnings);
  const lines = content.split('\n');
  let current: TableDraft | null = null;
  let sawCreateTable = false;
  let inExecuteHeredoc: string | null = null;

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const raw = lines[lineNo] as string;
    const line = raw.trim();
    if (inExecuteHeredoc !== null) {
      if (line === inExecuteHeredoc) inExecuteHeredoc = null;
      continue;
    }
    if (line.length === 0 || line.startsWith('#')) continue;

    const createMatch = /^create_table\s+(.*)$/.exec(line);
    if (createMatch) {
      sawCreateTable = true;
      current = startTable(createMatch[1] as string, builder, warnings);
      continue;
    }
    if (line === 'end' || line.startsWith('end ')) {
      current = null;
      continue;
    }
    if (current !== null) {
      const tMatch = /^t\.([a-z_]+[!?]?)\s*(.*)$/.exec(line);
      if (tMatch) {
        handleTableLine(tMatch[1] as string, tMatch[2] as string, current, builder, warnings);
        continue;
      }
      continue;
    }

    const addIndex = /^add_index\s+(.*)$/.exec(line);
    if (addIndex) {
      handleAddIndex(addIndex[1] as string, builder, warnings);
      continue;
    }
    const addFk = /^add_foreign_key\s+(.*)$/.exec(line);
    if (addFk) {
      handleAddForeignKey(addFk[1] as string, builder, warnings);
      continue;
    }
    const addCheck = /^add_check_constraint\s+(.*)$/.exec(line);
    if (addCheck) {
      const args = parseArgs(addCheck[1] as string, 'ruby');
      const tableName = rubyString(args.positional[0]);
      const expr = rubyString(args.positional[1]);
      const table = tableName !== null ? builder.getTable(tableName) : undefined;
      if (table && expr !== null) {
        applyCheck(table, expr, rubyString(args.named['name'] ?? ''), builder);
      }
      continue;
    }
    if (/^execute\b/.test(line)) {
      const heredoc = /<<[-~]?(\w+)/.exec(line);
      if (heredoc) inExecuteHeredoc = heredoc[1] as string;
      warnings.addCount('skipped-statement', 'skipped execute block in schema.rb');
      continue;
    }
  }

  if (!sawCreateTable) {
    throw new SchemaImportError('no create_table blocks found in schema.rb');
  }

  return builder.finalize({
    format: 'rails',
    dialect: 'generic',
    name,
    capabilities: { hasEnums: false, hasFKs: true, hasComments: true, hasChecks: true, hasSchemas: false },
  });
}

/** Record a CHECK constraint and synthesize a `source:'check'` enum when it is a `col IN (...)`. */
function applyCheck(
  table: TableDraft,
  expression: string,
  name: string | null,
  builder: ModelBuilder,
): void {
  table.checks.push({ name, expression });
  const found = extractCheckEnum(expression);
  if (!found) return;
  const col = table.columns.find((c) => c.name === found.column);
  if (!col || col.logicalType === 'enum') return;
  const id = `public.${table.name}.${col.name}`;
  builder.addEnum({ id, name: col.name, values: found.values, source: 'check' });
  col.logicalType = 'enum';
  col.enumRef = id;
}

function rubyString(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const lit = stringLiteral(raw);
  if (lit !== null) return lit;
  const sym = /^:([A-Za-z_][A-Za-z0-9_]*)$/.exec(raw.trim());
  return sym ? (sym[1] as string) : null;
}

function startTable(argText: string, builder: ModelBuilder, warnings: WarningList): TableDraft | null {
  const withoutBlock = argText.replace(/\bdo\s*\|t\|\s*$/, '').trim().replace(/,\s*$/, '');
  const args = parseArgs(withoutBlock, 'ruby');
  const tableName = rubyString(args.positional[0]);
  if (tableName === null) {
    warnings.add('dynamic-name', 'create_table with a non-literal name skipped');
    return null;
  }
  const table = builder.addTable({ name: tableName });
  const comment = rubyString(args.named['comment'] ?? '');
  if (comment !== null) table.comment = comment;

  const idOpt = args.named['id'];
  if (idOpt !== undefined && idOpt.trim() === 'false') return table;
  const pkName = rubyString(args.named['primary_key'] ?? '') ?? 'id';
  const idType = rubyString(idOpt ?? '') ?? 'bigint';
  const mapped = T_TYPES[idType] ?? { logicalType: 'bigint' as const, dbType: 'bigint' };
  table.columns.push({
    name: pkName,
    dbType: mapped.dbType,
    logicalType: mapped.logicalType,
    nullable: false,
    isPrimaryKey: true,
    default: mapped.logicalType === 'uuid' ? { kind: 'uuid' } : { kind: 'autoincrement' },
  });
  return table;
}

function handleTableLine(
  method: string,
  argText: string,
  table: TableDraft,
  builder: ModelBuilder,
  warnings: WarningList,
): void {
  const args = parseArgs(argText, 'ruby');

  if (method === 'timestamps') {
    for (const colName of ['created_at', 'updated_at']) {
      table.columns.push({
        name: colName,
        dbType: 'timestamp',
        logicalType: 'timestamp',
        nullable: false,
      });
    }
    return;
  }
  if (method === 'index') {
    const columns = indexColumns(args.positional[0]);
    if (columns.length > 0) {
      const unique = (args.named['unique'] ?? '') === 'true';
      const idxName = rubyString(args.named['name'] ?? '') ?? `index_${table.name}_on_${columns.join('_and_')}`;
      table.indexes.push({ name: idxName, columns, unique });
      if (unique) table.uniques.push({ name: idxName, columns });
    }
    return;
  }
  if (method === 'check_constraint') {
    const expr = rubyString(args.positional[0]);
    if (expr !== null) {
      applyCheck(table, expr, rubyString(args.named['name'] ?? ''), builder);
    }
    return;
  }
  if (method === 'references' || method === 'belongs_to') {
    for (const positional of args.positional) {
      const refName = rubyString(positional);
      if (refName === null) continue;
      handleReference(refName, args.named, table, warnings);
    }
    return;
  }
  if (method === 'column') {
    // t.column "name", :string, options
    const colName = rubyString(args.positional[0]);
    const typeName = rubyString(args.positional[1]);
    if (colName !== null && typeName !== null) {
      addColumn(colName, typeName, args.named, table, warnings);
    }
    return;
  }
  if (method === 'virtual') {
    const colName = rubyString(args.positional[0]);
    if (colName !== null) {
      const typeName = rubyString(args.named['type'] ?? '') ?? 'string';
      addColumn(colName, typeName, args.named, table, warnings);
      const col = table.columns[table.columns.length - 1];
      if (col) col.isGenerated = true;
    }
    return;
  }
  if (T_TYPES[method] !== undefined) {
    for (const positional of args.positional) {
      const colName = rubyString(positional);
      if (colName !== null) addColumn(colName, method, args.named, table, warnings);
    }
    return;
  }
  warnings.addCount('unsupported-method', `skipped unknown schema.rb method t.${method}`);
}

function addColumn(
  colName: string,
  typeName: string,
  named: Record<string, string>,
  table: TableDraft,
  warnings: WarningList,
): void {
  const mapped = T_TYPES[typeName];
  if (mapped === undefined) {
    warnings.addCount('unknown-type', `unknown rails column type :${typeName} mapped to unknown`);
  }
  const col: ColumnDraft = {
    name: colName,
    dbType: mapped?.dbType ?? typeName,
    logicalType: mapped?.logicalType ?? 'unknown',
    nullable: (named['null'] ?? '') !== 'false',
  };
  const limit = Number.parseInt(named['limit'] ?? '', 10);
  if (Number.isFinite(limit)) {
    if (col.logicalType === 'varchar' || col.logicalType === 'text') {
      col.maxLength = limit;
      col.dbType = `${col.dbType}(${limit})`;
    } else if (col.logicalType === 'integer' && limit === 8) {
      col.logicalType = 'bigint';
      col.dbType = 'bigint';
    }
  }
  const precision = Number.parseInt(named['precision'] ?? '', 10);
  if (Number.isFinite(precision) && (col.logicalType === 'decimal' || col.logicalType === 'float')) {
    col.numericPrecision = precision;
    const scale = Number.parseInt(named['scale'] ?? '', 10);
    if (Number.isFinite(scale)) col.numericScale = scale;
  }
  if (named['default'] !== undefined) col.default = classifyRubyDefault(named['default']);
  if ((named['array'] ?? '') === 'true') col.isArray = true;
  const comment = rubyString(named['comment'] ?? '');
  if (comment !== null) col.comment = comment;
  if ((named['unique'] ?? '') === 'true') col.isUnique = true;
  table.columns.push(col);
  if ((named['index'] ?? '') === 'true') {
    table.indexes.push({ name: `index_${table.name}_on_${colName}`, columns: [colName] });
  }
}

function handleReference(
  refName: string,
  named: Record<string, string>,
  table: TableDraft,
  warnings: WarningList,
): void {
  if ((named['polymorphic'] ?? '') === 'true') {
    table.columns.push({ name: `${refName}_type`, dbType: 'character varying', logicalType: 'varchar', nullable: (named['null'] ?? '') !== 'false' });
    table.columns.push({ name: `${refName}_id`, dbType: 'bigint', logicalType: 'bigint', nullable: (named['null'] ?? '') !== 'false' });
    warnings.add(
      'polymorphic-reference',
      `polymorphic reference "${refName}" on "${table.name}" has no single target; no FK emitted`,
      table.name,
    );
    return;
  }
  const typeName = rubyString(named['type'] ?? '') ?? 'bigint';
  const mapped = T_TYPES[typeName] ?? { logicalType: 'bigint' as const, dbType: 'bigint' };
  const columnName = `${refName}_id`;
  const col: ColumnDraft = {
    name: columnName,
    dbType: mapped.dbType,
    logicalType: mapped.logicalType,
    nullable: (named['null'] ?? '') !== 'false',
  };
  const fkOpt = named['foreign_key'];
  if (fkOpt !== undefined && fkOpt.trim() !== 'false') {
    let toTable = pluralize(refName);
    let onDelete: FkAction | null = null;
    if (fkOpt.trim().startsWith('{')) {
      const fkOpts = parseArgs(fkOpt.trim().slice(1, -1), 'ruby').named;
      toTable = rubyString(fkOpts['to_table'] ?? '') ?? toTable;
      onDelete = railsFkAction(rubyString(fkOpts['on_delete'] ?? ''));
    } else {
      warnings.add(
        'naming-assumed',
        `t.references "${refName}" targets "${toTable}" by pluralization convention`,
        table.name,
      );
    }
    col.references = { table: toTable, onDelete };
  }
  table.columns.push(col);
  if ((named['index'] ?? 'true') !== 'false') {
    table.indexes.push({ name: `index_${table.name}_on_${columnName}`, columns: [columnName] });
  }
}

function handleAddIndex(argText: string, builder: ModelBuilder, warnings: WarningList): void {
  const args = parseArgs(argText, 'ruby');
  const tableName = rubyString(args.positional[0]);
  const table = tableName !== null ? builder.getTable(tableName) : undefined;
  if (!table) {
    warnings.add('unknown-table', `add_index on unknown table ${args.positional[0] ?? '?'}`);
    return;
  }
  const columns = indexColumns(args.positional[1]);
  if (columns.length === 0) return;
  const unique = (args.named['unique'] ?? '') === 'true';
  const idxName = rubyString(args.named['name'] ?? '') ?? `index_${table.name}_on_${columns.join('_and_')}`;
  table.indexes.push({ name: idxName, columns, unique });
  if (unique) table.uniques.push({ name: idxName, columns });
}

function handleAddForeignKey(argText: string, builder: ModelBuilder, warnings: WarningList): void {
  const args = parseArgs(argText, 'ruby');
  const fromName = rubyString(args.positional[0]);
  const toName = rubyString(args.positional[1]);
  if (fromName === null || toName === null) return;
  const table = builder.getTable(fromName);
  if (!table) {
    warnings.add('unknown-table', `add_foreign_key on unknown table "${fromName}"`);
    return;
  }
  const columnName = rubyString(args.named['column'] ?? '') ?? `${singularize(toName)}_id`;
  const col = table.columns.find((c) => c.name === columnName);
  if (!col) {
    warnings.add(
      'unresolved-reference',
      `add_foreign_key "${fromName}" → "${toName}": column "${columnName}" not found`,
      table.name,
    );
    return;
  }
  col.references = {
    table: toName,
    column: rubyString(args.named['primary_key'] ?? '') ?? undefined,
    onDelete: railsFkAction(rubyString(args.named['on_delete'] ?? '')),
    onUpdate: railsFkAction(rubyString(args.named['on_update'] ?? '')),
  };
}

function indexColumns(positional: string | undefined): string[] {
  if (positional === undefined) return [];
  const raw = positional.trim();
  if (raw.startsWith('[')) {
    return splitTopLevel(raw.slice(1, raw.endsWith(']') ? -1 : undefined), ',')
      .map((s) => rubyString(s))
      .filter((s): s is string => s !== null);
  }
  const single = rubyString(raw);
  return single === null ? [] : [single];
}

function classifyRubyDefault(raw: string): ColumnDefault {
  const value = scalarValue(raw);
  if (typeof value === 'string') return { kind: 'literal', text: value };
  if (typeof value === 'number') return { kind: 'literal', text: String(value) };
  if (typeof value === 'boolean') return { kind: 'literal', text: String(value) };
  const arrow = /->\s*\{\s*"?([^"}]*)"?\s*\}/.exec(raw);
  if (arrow) {
    const expr = (arrow[1] as string).trim();
    if (/now\(\)|current_timestamp/i.test(expr)) return { kind: 'now' };
    if (/gen_random_uuid/i.test(expr)) return { kind: 'uuid' };
    return { kind: 'expression', text: expr };
  }
  if (raw.trim() === 'nil') return null;
  return { kind: 'expression', text: raw.trim() };
}

function railsFkAction(symbol: string | null): FkAction | null {
  switch (symbol) {
    case 'cascade':
      return 'cascade';
    case 'nullify':
      return 'set-null';
    case 'restrict':
      return 'restrict';
    default:
      return null;
  }
}
