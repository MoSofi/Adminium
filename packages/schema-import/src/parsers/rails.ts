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
import {
  hasLineTerminator,
  isSpace,
  parseArgs,
  pluralize,
  scalarValue,
  singularize,
  stringLiteral,
  splitTopLevel,
} from '../text.js';
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

/**
 * Linear-time stand-in for the `/^<keyword>\s+(.*)$/` statement matchers —
 * returns the argument text after `keyword`, or null when `line` is not that
 * statement.
 *
 * The regex form is quadratic (CodeQL js/polynomial-redos, alerts #12/#14/#15/
 * #16): `\s+` and `.*` both match a space, so every split of the whitespace run
 * is retried whenever `$` cannot land — and `$` cannot land when the tail holds
 * a character `.` never matches. A `schema.rb` saved with CR-only line endings
 * is one giant "line" full of `\r`, so `'add_index ' + 50_000 spaces + '\rx\ry'`
 * is a plain uploaded file, not a contrived string.
 *
 * Same accept set as the regex: `\s+` is greedy and any line terminator that
 * defeats `$` sits *past* the whitespace run, so shortening `\s+` only prepends
 * characters to the capture and can never rescue a failed match. Testing the
 * maximal split alone is therefore exact.
 */
function keywordArgs(line: string, keyword: string): string | null {
  if (!line.startsWith(keyword)) return null;
  let i = keyword.length;
  while (isSpace(line[i])) i += 1;
  if (i === keyword.length) return null; // `\s+` needs at least one space
  const args = line.slice(i);
  return hasLineTerminator(args) ? null : args;
}

/** a-z or `_` — the characters of `[a-z_]` in the `t.<method>` matcher. */
function isMethodChar(code: number): boolean {
  return (code >= 97 && code <= 122) || code === 95;
}

/**
 * Linear-time stand-in for `/^t\.([a-z_]+[!?]?)\s*(.*)$/` (alert #13), the same
 * `\s`/`.` overlap as {@link keywordArgs}. Giving back a `[a-z_]` character
 * cannot help either — the character after a shorter run is a letter, which
 * neither `[!?]?` nor `\s*` accepts — so the maximal split is again exact.
 */
function tableMethodLine(line: string): { method: string; args: string } | null {
  if (!line.startsWith('t.')) return null;
  let i = 2;
  while (i < line.length && isMethodChar(line.charCodeAt(i))) i += 1;
  if (i === 2) return null; // `[a-z_]+` needs at least one character
  const suffix = line[i];
  if (suffix === '!' || suffix === '?') i += 1;
  const method = line.slice(2, i);
  let argStart = i;
  while (isSpace(line[argStart])) argStart += 1;
  const args = line.slice(argStart);
  return hasLineTerminator(args) ? null : { method, args };
}

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

    const createArgs = keywordArgs(line, 'create_table');
    if (createArgs !== null) {
      sawCreateTable = true;
      current = startTable(createArgs, builder, warnings);
      continue;
    }
    if (line === 'end' || line.startsWith('end ')) {
      current = null;
      continue;
    }
    if (current !== null) {
      const tLine = tableMethodLine(line);
      if (tLine) {
        handleTableLine(tLine.method, tLine.args, current, builder, warnings);
        continue;
      }
      continue;
    }

    const addIndex = keywordArgs(line, 'add_index');
    if (addIndex !== null) {
      handleAddIndex(addIndex, builder, warnings);
      continue;
    }
    const addFk = keywordArgs(line, 'add_foreign_key');
    if (addFk !== null) {
      handleAddForeignKey(addFk, builder, warnings);
      continue;
    }
    const addCheck = keywordArgs(line, 'add_check_constraint');
    if (addCheck !== null) {
      const args = parseArgs(addCheck, 'ruby');
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

/**
 * Linear-time stand-in for `/->\s*\{\s*"?([^"}]*)"?\s*\}/` — the body of a
 * `default: -> { … }` lambda, or null when `raw` holds no such lambda.
 *
 * The regex form is *cubic*, not merely quadratic: `\s*`, `[^"}]*` and the
 * trailing `\s*` all accept a space, so `'-> {' + n spaces` with no closing
 * brace makes the engine try every three-way split of the run. Measured on
 * node 22: 250 spaces 22 ms, 500 70 ms, 1_000 542 ms, 2_000 4.3 s, 4_000 34 s —
 * a clean 8x per doubling. That is one `default:` value in an uploaded
 * `schema.rb`, so a 4 KB run of spaces stalls the importer for half a minute.
 *
 * Same accept set, by two observations about where the regex can backtrack:
 *
 *  - The leading `\s*` runs are effectively possessive. `\{` cannot match a
 *    whitespace character, so giving one back never rescues the match.
 *  - Inside the braces only the *maximal* `\s*` split can match. A shorter split
 *    leaves the cursor on whitespace, so `"?` matches empty and `[^"}]*` — which
 *    accepts whitespace too — swallows exactly the same text up to the first `"`
 *    or `}`. The rest of the attempt is then character-for-character the maximal
 *    attempt's, so if the maximal split failed every shorter one fails.
 *    Likewise `[^"}]*` need only be tried at full length: it stops at the first
 *    `"` or `}`, and any shorter split would have to reach a `}` through the
 *    trailing `\s*`, which that first `"` or end-of-string blocks.
 *
 * That leaves: skip to `{`, skip whitespace, take an optional opening quote,
 * scan to the first `"` or `}`, and accept on a `}` there or on `"` followed by
 * whitespace and a `}`. The two cursors keep repeated start offsets from
 * rescanning ground already covered, which is what holds the loop linear on
 * inputs like `'->{a'.repeat(n) + '"' + ' '.repeat(n)`.
 */
function arrowLambdaBody(raw: string): string | null {
  let scanned = 0;
  let delimiter = -1;
  /** First `"` or `}` at or after `from`, or -1. Queries only ever move right. */
  const nextDelimiter = (from: number): number => {
    if (delimiter >= from) return delimiter;
    if (scanned < from) scanned = from;
    while (scanned < raw.length && raw[scanned] !== '"' && raw[scanned] !== '}') scanned += 1;
    delimiter = scanned < raw.length ? scanned : -1;
    return delimiter;
  };
  const afterSpace = (from: number): number => {
    let i = from;
    while (isSpace(raw[i])) i += 1;
    return i;
  };
  /** The `"?\s*\}` tail. Memoised because consecutive starts share one quote. */
  let closerAt = -1;
  let closerOk = false;
  const closes = (quote: number): boolean => {
    if (quote !== closerAt) {
      closerAt = quote;
      closerOk = raw[afterSpace(quote + 1)] === '}';
    }
    return closerOk;
  };

  for (let at = raw.indexOf('->'); at !== -1; at = raw.indexOf('->', at + 1)) {
    const brace = afterSpace(at + 2);
    if (raw[brace] !== '{') continue;
    const open = afterSpace(brace + 1);
    const body = raw[open] === '"' ? open + 1 : open;
    const end = nextDelimiter(body);
    // Neither `"` nor `}` left: every later start begins further right, so no
    // later attempt can find the `}` this one is missing either.
    if (end === -1) return null;
    if (raw[end] === '}' || closes(end)) return raw.slice(body, end);
  }
  return null;
}

function classifyRubyDefault(raw: string): ColumnDefault {
  const value = scalarValue(raw);
  if (typeof value === 'string') return { kind: 'literal', text: value };
  if (typeof value === 'number') return { kind: 'literal', text: String(value) };
  if (typeof value === 'boolean') return { kind: 'literal', text: String(value) };
  const arrow = arrowLambdaBody(raw);
  if (arrow !== null) {
    const expr = arrow.trim();
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
