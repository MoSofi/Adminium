// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SQL DDL / pg_dump / mysqldump / sqlite parser — 05-introspection-engine.md
 * §5.2 row 1. Hand-rolled tokenizer + statement splitter + per-statement
 * mini-parsers. Everything that is not schema DDL (INSERT, COPY, SET,
 * functions, grants, …) is skipped by design with aggregated warning counts,
 * which makes whole pg_dump files safe to feed in. Crucially, pg_dump
 * declares PKs and FKs via `ALTER TABLE ONLY … ADD CONSTRAINT`, so those are
 * first-class here.
 *
 * Dialect sniff (documented contract): backticks / `ENGINE=` /
 * `AUTO_INCREMENT` → mysql; `AUTOINCREMENT` / `WITHOUT ROWID` → sqlite;
 * anything else → postgres (the format's home dialect).
 */
import type { DatabaseModel, Dialect, FkAction } from '@adminium/engine';

import { ModelBuilder, type ColumnDraft, type TableDraft } from '../builder.js';
import { extractCheckEnum } from '../check-enum.js';
import { SchemaImportError } from '../errors.js';
import { collectStrings, splitTopLevel, stripComments } from '../text.js';
import { classifySqlDefault, isSerialType, mapSqlType } from '../type-map.js';
import type { WarningList } from '../warnings.js';
import { SqlCursor } from './sql-cursor.js';

const SQL_SCAN = { dollarQuotes: true, lineComments: ['--'], blockComments: true } as const;

interface Statement {
  text: string;
  line: number;
}

function splitStatements(sql: string): Statement[] {
  const statements: Statement[] = [];
  let start = 0;
  let line = 1;
  let startLine = 1;
  let i = 0;
  const bump = (from: number, to: number): void => {
    for (let j = from; j < to; j += 1) if (sql[j] === '\n') line += 1;
  };
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === '`' || ch === '$') {
      const next =
        ch === '$'
          ? skipDollar(sql, i)
          : skipQuoted(sql, i);
      if (next !== i) {
        bump(i, next);
        i = next;
        continue;
      }
    }
    if (ch === ';') {
      const text = sql.slice(start, i).trim();
      if (text.length > 0) statements.push({ text, line: startLine });
      start = i + 1;
      i += 1;
      startLine = line;
      continue;
    }
    if (ch === '\n') line += 1;
    if (sql.slice(start, i).trim().length === 0) startLine = line;
    i += 1;
  }
  const tail = sql.slice(start).trim();
  if (tail.length > 0) statements.push({ text: tail, line: startLine });
  return statements;
}

function skipQuoted(sql: string, i: number): number {
  const quote = sql[i] as string;
  let j = i + 1;
  while (j < sql.length) {
    if (sql[j] === quote) {
      if (sql[j + 1] === quote) {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j += 1;
  }
  return sql.length;
}

function skipDollar(sql: string, i: number): number {
  const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
  if (!m) return i;
  const tag = m[0];
  const end = sql.indexOf(tag, i + tag.length);
  return end === -1 ? sql.length : end + tag.length;
}

function sniffDialect(content: string): Dialect {
  if (/`/.test(content) || /ENGINE\s*=/i.test(content) || /AUTO_INCREMENT/i.test(content)) {
    return 'mysql';
  }
  if (/\bAUTOINCREMENT\b/i.test(content) || /WITHOUT\s+ROWID/i.test(content)) return 'sqlite';
  return 'postgres';
}

/**
 * Words that start a table constraint. `CONSTRAINT` may be followed directly
 * by one of these — MySQL makes the constraint symbol optional
 * (`CONSTRAINT FOREIGN KEY (a) REFERENCES b(id)`), and swallowing `FOREIGN` as
 * the symbol turned the foreign key into an index named "FOREIGN".
 */
const CONSTRAINT_HEADS: ReadonlySet<string> = new Set([
  'PRIMARY',
  'FOREIGN',
  'UNIQUE',
  'CHECK',
  'KEY',
  'INDEX',
  'FULLTEXT',
  'SPATIAL',
  'EXCLUDE',
]);

/** Consume the optional symbol after a `CONSTRAINT` keyword. */
function takeConstraintSymbol(cur: SqlCursor): string | null {
  return CONSTRAINT_HEADS.has(cur.peekWord() ?? '') ? null : cur.takeIdentifier();
}

const FK_ACTION_MAP: Readonly<Record<string, FkAction>> = {
  CASCADE: 'cascade',
  RESTRICT: 'restrict',
  'SET NULL': 'set-null',
  'SET DEFAULT': 'set-default',
  'NO ACTION': 'no-action',
};

interface SqlParseState {
  builder: ModelBuilder;
  warnings: WarningList;
  /** lowercased enum type name (bare + qualified) → EnumDef id */
  enumTypes: Map<string, string>;
  defaultSchema: string;
}

export function parseSql(content: string, name: string, warnings: WarningList): DatabaseModel {
  const dialect = sniffDialect(content);
  const builder = new ModelBuilder(warnings);
  const state: SqlParseState = { builder, warnings, enumTypes: new Map(), defaultSchema: 'public' };

  // pg_dump COPY payloads are newline-delimited rows terminated by `\.` — not
  // `;`-terminated SQL. Drop the row data before tokenizing so it cannot
  // swallow the following statement (setup never reads rows anyway).
  const withoutCopyData = content.replace(/(\bFROM\s+stdin;)[\s\S]*?(?:\n\\\.|$)/gi, '$1');
  const cleaned = stripComments(withoutCopyData, SQL_SCAN);
  const statements = splitStatements(cleaned);
  if (statements.length === 0) {
    throw new SchemaImportError('no SQL statements found in input');
  }

  for (const stmt of statements) {
    try {
      parseStatement(stmt, state);
    } catch {
      warnings.add(
        'unparseable-statement',
        `could not parse statement at line ${stmt.line}: ${stmt.text.slice(0, 60)}…`,
      );
    }
  }

  resolveEnumColumns(state);

  return builder.finalize({
    format: 'sql',
    dialect,
    name,
    capabilities: {
      hasEnums: dialect !== 'sqlite',
      hasFKs: true,
      hasSchemas: dialect === 'postgres',
      hasComments: dialect !== 'sqlite',
      hasChecks: true,
      maxIdentifierLength: dialect === 'postgres' ? 63 : dialect === 'mysql' ? 64 : 128,
    },
  });
}

function parseStatement(stmt: Statement, state: SqlParseState): void {
  const cur = new SqlCursor(stmt.text);
  const first = cur.peekWord();
  if (first === 'CREATE') {
    cur.takeWord();
    // Skip noise qualifiers.
    while (cur.tryWords('OR', 'REPLACE') || cur.tryWords('GLOBAL') || cur.tryWords('LOCAL') ||
      cur.tryWords('TEMPORARY') || cur.tryWords('TEMP') || cur.tryWords('UNLOGGED')) {
      /* consumed */
    }
    const unique = cur.tryWords('UNIQUE');
    const kind = cur.peekWord();
    if (kind === 'TABLE') {
      cur.takeWord();
      parseCreateTable(cur, stmt, state);
      return;
    }
    if (kind === 'TYPE') {
      cur.takeWord();
      parseCreateType(cur, state);
      return;
    }
    if (kind === 'INDEX') {
      cur.takeWord();
      parseCreateIndex(cur, unique, state);
      return;
    }
    if (kind === 'MATERIALIZED' || kind === 'VIEW') {
      const materialized = kind === 'MATERIALIZED';
      cur.takeWord();
      if (materialized) cur.tryWords('VIEW');
      parseCreateView(cur, materialized, state);
      return;
    }
    state.warnings.addCount('skipped-statement', `skipped CREATE ${kind ?? '?'} statement`);
    return;
  }
  if (first === 'ALTER') {
    cur.takeWord();
    if (cur.tryWords('TABLE')) {
      parseAlterTable(cur, stmt, state);
      return;
    }
    state.warnings.addCount('skipped-statement', `skipped ALTER ${cur.peekWord() ?? '?'} statement`);
    return;
  }
  if (first === 'COMMENT') {
    cur.takeWord();
    parseCommentOn(cur, state);
    return;
  }
  state.warnings.addCount('skipped-statement', `skipped ${first ?? 'unknown'} statement`);
}

function qualifiedToParts(
  parts: string[] | null,
  state: SqlParseState,
): { schema: string; name: string } | null {
  if (!parts || parts.length === 0) return null;
  const name = parts[parts.length - 1] as string;
  const schema = parts.length > 1 ? (parts[parts.length - 2] as string) : state.defaultSchema;
  return { schema, name };
}

function parseCreateTable(cur: SqlCursor, stmt: Statement, state: SqlParseState): void {
  cur.tryWords('IF', 'NOT', 'EXISTS');
  const named = qualifiedToParts(cur.takeQualifiedIdentifier(), state);
  const body = cur.takeParenGroup();
  if (!named || body === null) {
    state.warnings.add(
      'unparseable-statement',
      `could not parse CREATE TABLE at line ${stmt.line}`,
    );
    return;
  }
  const table = state.builder.addTable({ name: named.name, schema: named.schema });

  for (const item of splitTopLevel(body, ',', SQL_SCAN)) {
    parseTableItem(item, table, state);
  }

  // MySQL table options tail: ENGINE=… COMMENT='…'.
  const tail = cur.rest();
  const commentMatch = /\bCOMMENT\s*=?\s*'((?:[^']|'')*)'/i.exec(tail);
  if (commentMatch) table.comment = (commentMatch[1] as string).replaceAll("''", "'");
}

function parseTableItem(item: string, table: TableDraft, state: SqlParseState): void {
  const cur = new SqlCursor(item);
  const constraintName = cur.tryWords('CONSTRAINT') ? takeConstraintSymbol(cur) : null;

  const head = cur.peekWord();
  if (head !== null && CONSTRAINT_HEADS.has(head)) {
    parseTableConstraint(cur, table, constraintName, state);
    return;
  }
  if (constraintName !== null) {
    // `CONSTRAINT x <something we don't know>`
    state.warnings.addCount('unsupported-constraint', `skipped unsupported constraint kind`);
    return;
  }
  parseColumnDef(cur, table, state);
}

function parseTableConstraint(
  cur: SqlCursor,
  table: TableDraft,
  constraintName: string | null,
  state: SqlParseState,
): void {
  if (cur.tryWords('PRIMARY', 'KEY')) {
    const group = cur.takeParenGroup();
    if (group !== null) table.primaryKey = identList(group);
    return;
  }
  if (cur.tryWords('FOREIGN', 'KEY')) {
    // mysql allows an index name between FOREIGN KEY and the column list.
    let group = cur.takeParenGroup();
    if (group === null) {
      cur.takeIdentifier();
      group = cur.takeParenGroup();
    }
    if (group === null) return;
    const columns = identList(group);
    if (!cur.tryWords('REFERENCES')) return;
    const target = qualifiedToParts(cur.takeQualifiedIdentifier(), state);
    if (!target) return;
    const targetCols = cur.takeParenGroup();
    const actions = parseFkTail(cur);
    addForeignKey(table, columns, target, targetCols === null ? null : identList(targetCols), actions, state);
    return;
  }
  if (cur.tryWords('UNIQUE')) {
    if (!cur.tryWords('KEY')) cur.tryWords('INDEX');
    let group = cur.takeParenGroup();
    let name = constraintName;
    if (group === null) {
      name = cur.takeIdentifier() ?? name;
      group = cur.takeParenGroup();
    }
    if (group !== null) table.uniques.push({ name, columns: identList(group) });
    return;
  }
  if (cur.tryWords('CHECK')) {
    const expr = cur.takeParenGroup();
    if (expr !== null) {
      table.checks.push({ name: constraintName, expression: expr.trim() });
      synthesizeCheckEnum(expr, table, state);
    }
    return;
  }
  if (cur.tryWords('KEY') || cur.tryWords('INDEX') || cur.tryWords('FULLTEXT') || cur.tryWords('SPATIAL')) {
    if (!cur.tryWords('KEY')) cur.tryWords('INDEX'); // FULLTEXT KEY / SPATIAL INDEX
    const name = cur.takeIdentifier() ?? constraintName ?? `${table.name}_idx`;
    const group = cur.takeParenGroup();
    if (group !== null) {
      table.indexes.push({ name, columns: identList(group), unique: false });
    }
    return;
  }
  state.warnings.addCount('unsupported-constraint', 'skipped unsupported table constraint');
}

function parseColumnDef(cur: SqlCursor, table: TableDraft, state: SqlParseState): void {
  const name = cur.takeIdentifier();
  if (name === null) {
    state.warnings.addCount('unparseable-column', `skipped unparseable column on "${table.name}"`);
    return;
  }
  const typeRaw = parseTypePhrase(cur);
  if (typeRaw === null) {
    state.warnings.addCount('unparseable-column', `skipped unparseable column on "${table.name}"`);
    return;
  }
  const mapped = mapSqlType(typeRaw.replace(/^[^.]*\./, ''));
  const col: ColumnDraft = {
    name,
    dbType: typeRaw,
    logicalType: mapped.logicalType,
    maxLength: mapped.maxLength,
    numericPrecision: mapped.numericPrecision,
    numericScale: mapped.numericScale,
    isArray: mapped.isArray,
  };
  if (isSerialType(typeRaw)) {
    col.default = { kind: 'autoincrement' };
    col.nullable = false;
  }
  // MySQL inline enum('a','b') / set('a','b').
  const enumMatch = /^(enum|set)\s*\((.*)\)$/is.exec(typeRaw.trim());
  if (enumMatch) {
    const values = collectStrings(enumMatch[2] as string);
    if ((enumMatch[1] as string).toLowerCase() === 'enum' && values.length > 0) {
      const id = `${table.schema ?? 'public'}.${table.name}.${name}`;
      state.builder.addEnum({ id, name, values, source: 'column-type' });
      col.logicalType = 'enum';
      col.enumRef = id;
    } else {
      col.logicalType = 'text';
      state.warnings.add(
        'set-type',
        `MySQL SET column "${table.name}"."${name}" mapped to text`,
        `${table.schema ?? 'public'}.${table.name}`,
      );
    }
  }

  parseColumnModifiers(cur, col, table, state);
  table.columns.push(col);
}

/** Consume a (possibly multi-word, possibly parameterized) SQL type phrase. */
function parseTypePhrase(cur: SqlCursor): string | null {
  const parts = cur.takeQualifiedIdentifier();
  if (!parts) return null;
  let phrase = parts.join('.');
  const lower = (parts[parts.length - 1] as string).toLowerCase();

  if (lower === 'double' && cur.tryWords('PRECISION')) phrase += ' precision';
  if ((lower === 'character' || lower === 'national') && cur.tryWords('VARYING')) phrase += ' varying';
  if (lower === 'bit' && cur.tryWords('VARYING')) phrase += ' varying';

  const args = cur.takeParenGroup();
  if (args !== null) phrase += `(${args})`;

  if (lower === 'time' || lower === 'timestamp') {
    if (cur.tryWords('WITH', 'TIME', 'ZONE')) phrase += ' with time zone';
    else if (cur.tryWords('WITHOUT', 'TIME', 'ZONE')) phrase += ' without time zone';
  }
  if (lower === 'interval') {
    const fields = ['YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'TO'];
    while (fields.includes(cur.peekWord() ?? '')) cur.takeWord();
  }
  if (lower === 'int' || lower === 'integer' || lower === 'tinyint' || lower === 'smallint' ||
      lower === 'mediumint' || lower === 'bigint' || lower === 'decimal' || lower === 'numeric' ||
      lower === 'float' || lower === 'double') {
    while (cur.tryWords('UNSIGNED') || cur.tryWords('ZEROFILL')) phrase += '';
  }
  // Array suffixes: text[] / text[][].
  while (cur.tryChar('[')) {
    cur.tryChar(']');
    phrase += '[]';
  }
  if (cur.tryWords('ARRAY')) phrase += '[]';
  return phrase;
}

function parseColumnModifiers(
  cur: SqlCursor,
  col: ColumnDraft,
  table: TableDraft,
  state: SqlParseState,
): void {
  while (!cur.eof()) {
    if (cur.tryWords('CONSTRAINT')) {
      cur.takeIdentifier();
      continue;
    }
    if (cur.tryWords('NOT', 'NULL')) {
      col.nullable = false;
      continue;
    }
    if (cur.tryWords('NULL')) {
      col.nullable = true;
      continue;
    }
    if (cur.tryWords('DEFAULT')) {
      if (cur.tryWords('NULL')) {
        col.default = null;
        continue;
      }
      const raw = takeDefaultExpression(cur);
      col.default = classifySqlDefault(raw);
      continue;
    }
    if (cur.tryWords('PRIMARY', 'KEY')) {
      col.isPrimaryKey = true;
      col.nullable = false;
      // sqlite: INTEGER PRIMARY KEY AUTOINCREMENT
      if (cur.tryWords('AUTOINCREMENT')) col.default = { kind: 'autoincrement' };
      continue;
    }
    if (cur.tryWords('UNIQUE')) {
      cur.tryWords('KEY');
      col.isUnique = true;
      continue;
    }
    if (cur.tryWords('REFERENCES')) {
      const target = qualifiedToParts(cur.takeQualifiedIdentifier(), state);
      const group = cur.takeParenGroup();
      const actions = parseFkTail(cur);
      if (target) {
        col.references = {
          table: `${target.schema}.${target.name}`,
          column: group === null ? undefined : identList(group)[0],
          onDelete: actions.onDelete,
          onUpdate: actions.onUpdate,
        };
      }
      continue;
    }
    if (cur.tryWords('CHECK')) {
      const expr = cur.takeParenGroup();
      if (expr !== null) {
        table.checks.push({ name: null, expression: expr.trim() });
        synthesizeCheckEnumForColumn(expr, col, table, state);
      }
      cur.tryWords('NOT', 'ENFORCED');
      continue;
    }
    if (cur.tryWords('AUTO_INCREMENT') || cur.tryWords('AUTOINCREMENT')) {
      col.default = { kind: 'autoincrement' };
      continue;
    }
    if (cur.tryWords('GENERATED')) {
      if (cur.tryWords('BY', 'DEFAULT', 'AS', 'IDENTITY') || cur.tryWords('ALWAYS', 'AS', 'IDENTITY')) {
        cur.takeParenGroup();
        col.default = { kind: 'autoincrement' };
        continue;
      }
      if (cur.tryWords('ALWAYS', 'AS')) {
        cur.takeParenGroup();
        if (!cur.tryWords('STORED')) cur.tryWords('VIRTUAL');
        col.isGenerated = true;
        continue;
      }
      continue;
    }
    if (cur.tryWords('AS')) {
      // sqlite/mysql generated column shorthand: `col type AS (expr)`.
      cur.takeParenGroup();
      if (!cur.tryWords('STORED')) cur.tryWords('VIRTUAL');
      col.isGenerated = true;
      continue;
    }
    if (cur.tryWords('COMMENT')) {
      const text = cur.takeStringLiteral();
      if (text !== null) col.comment = text;
      continue;
    }
    if (cur.tryWords('COLLATE')) {
      cur.takeQualifiedIdentifier();
      continue;
    }
    if (cur.tryWords('CHARACTER', 'SET') || cur.tryWords('CHARSET')) {
      cur.takeIdentifier();
      continue;
    }
    if (cur.tryWords('ON', 'UPDATE')) {
      // mysql `ON UPDATE CURRENT_TIMESTAMP`.
      cur.takeWord();
      cur.takeParenGroup();
      continue;
    }
    const tok = cur.takeWord();
    if (tok === null) {
      // Punctuation we don't understand — drop the rest of this column item.
      state.warnings.addCount(
        'unsupported-column-modifier',
        'ignored trailing tokens in a column definition',
      );
      return;
    }
    state.warnings.addCount('unsupported-column-modifier', `ignored column modifier ${tok}`);
  }
}

/** Capture a DEFAULT expression: one expression unit plus trailing casts. */
function takeDefaultExpression(cur: SqlCursor): string {
  const start = cur.save();
  // Unit: string | number | word[(args)] | (expr)
  if (cur.takeStringLiteral() === null) {
    if (cur.tryNumber() === null) {
      if (cur.takeParenGroup() === null) {
        const word = cur.takeWord();
        if (word !== null) cur.takeParenGroup();
      }
    }
  }
  // Trailing casts: ::type, possibly multi-word / array.
  let rest = cur.rest();
  while (rest.startsWith('::')) {
    cur.tryChar(':');
    cur.tryChar(':');
    cur.takeQualifiedIdentifier();
    if (!cur.tryWords('VARYING')) cur.tryWords('PRECISION');
    cur.takeParenGroup();
    while (cur.tryChar('[')) cur.tryChar(']');
    rest = cur.rest();
  }
  return cur.textFrom(start);
}

function parseFkTail(cur: SqlCursor): { onDelete: FkAction | null; onUpdate: FkAction | null } {
  let onDelete: FkAction | null = null;
  let onUpdate: FkAction | null = null;
  for (;;) {
    if (cur.tryWords('MATCH')) {
      cur.takeWord();
      continue;
    }
    if (cur.tryWords('ON', 'DELETE')) {
      onDelete = takeFkAction(cur);
      continue;
    }
    if (cur.tryWords('ON', 'UPDATE')) {
      onUpdate = takeFkAction(cur);
      continue;
    }
    if (cur.tryWords('NOT', 'DEFERRABLE') || cur.tryWords('DEFERRABLE')) continue;
    if (cur.tryWords('INITIALLY')) {
      cur.takeWord();
      continue;
    }
    if (cur.tryWords('NOT', 'VALID')) continue;
    return { onDelete, onUpdate };
  }
}

function takeFkAction(cur: SqlCursor): FkAction | null {
  if (cur.tryWords('SET', 'NULL')) return 'set-null';
  if (cur.tryWords('SET', 'DEFAULT')) return 'set-default';
  if (cur.tryWords('NO', 'ACTION')) return 'no-action';
  const word = cur.takeWord();
  if (word !== null && FK_ACTION_MAP[word] !== undefined) return FK_ACTION_MAP[word] as FkAction;
  return null;
}

function identList(group: string): string[] {
  return splitTopLevel(group, ',', SQL_SCAN)
    .map((part) => {
      const cur = new SqlCursor(part);
      return cur.takeIdentifier() ?? part.trim();
    })
    .filter((s) => s.length > 0);
}

function addForeignKey(
  table: TableDraft,
  columns: string[],
  target: { schema: string; name: string },
  targetColumns: string[] | null,
  actions: { onDelete: FkAction | null; onUpdate: FkAction | null },
  state: SqlParseState,
): void {
  const targetName = `${target.schema}.${target.name}`;
  if (columns.length === 1) {
    const col = table.columns.find((c) => c.name === columns[0]);
    if (col) {
      col.references = {
        table: targetName,
        column: targetColumns?.[0],
        onDelete: actions.onDelete,
        onUpdate: actions.onUpdate,
      };
      return;
    }
  }
  const targetTable = state.builder.getTable(targetName);
  const toColumns = targetColumns ?? targetTable?.primaryKey ?? [];
  if (toColumns.length !== columns.length) {
    state.warnings.add(
      'unresolved-reference',
      `composite foreign key on "${table.name}" (${columns.join(', ')}) could not be resolved`,
    );
    return;
  }
  state.builder.addRelation({
    kind: 'declared-fk',
    cardinality: 'one-to-many',
    from: { table: `${table.schema ?? 'public'}.${table.name}`, columns },
    to: { table: targetName, columns: toColumns },
    onDelete: actions.onDelete,
    onUpdate: actions.onUpdate,
  });
}

/* --------------------------- CHECK → enum synthesis --------------------------- */

function synthesizeCheckEnum(expression: string, table: TableDraft, state: SqlParseState): void {
  const found = extractCheckEnum(expression);
  if (!found) return;
  const col = table.columns.find((c) => c.name === found.column);
  if (!col || col.logicalType === 'enum') return;
  applyCheckEnum(col, found.values, table, state);
}

function synthesizeCheckEnumForColumn(
  expression: string,
  col: ColumnDraft,
  table: TableDraft,
  state: SqlParseState,
): void {
  const found = extractCheckEnum(expression);
  if (!found || found.column !== col.name || col.logicalType === 'enum') return;
  applyCheckEnum(col, found.values, table, state);
}

function applyCheckEnum(
  col: ColumnDraft,
  values: string[],
  table: TableDraft,
  state: SqlParseState,
): void {
  const id = `${table.schema ?? 'public'}.${table.name}.${col.name}`;
  state.builder.addEnum({ id, name: col.name, values, source: 'check' });
  col.logicalType = 'enum';
  col.enumRef = id;
}

/* --------------------------------- other DDL --------------------------------- */

function parseCreateType(cur: SqlCursor, state: SqlParseState): void {
  const named = qualifiedToParts(cur.takeQualifiedIdentifier(), state);
  if (!named || !cur.tryWords('AS', 'ENUM')) {
    state.warnings.addCount('skipped-statement', 'skipped CREATE TYPE (non-enum) statement');
    return;
  }
  const group = cur.takeParenGroup();
  if (group === null) return;
  const values = collectStrings(group);
  if (values.length === 0) return;
  const id = `${named.schema}.${named.name}`;
  state.builder.addEnum({ id, name: named.name, values, source: 'native' });
  state.enumTypes.set(named.name.toLowerCase(), id);
  state.enumTypes.set(`${named.schema}.${named.name}`.toLowerCase(), id);
}

function parseCreateIndex(cur: SqlCursor, unique: boolean, state: SqlParseState): void {
  cur.tryWords('CONCURRENTLY');
  cur.tryWords('IF', 'NOT', 'EXISTS');
  const indexName = cur.takeIdentifier() ?? 'index';
  if (!cur.tryWords('ON')) return;
  cur.tryWords('ONLY');
  const named = qualifiedToParts(cur.takeQualifiedIdentifier(), state);
  if (!named) return;
  const table = state.builder.getTable(`${named.schema}.${named.name}`);
  if (!table) {
    state.warnings.add('unknown-table', `CREATE INDEX on unknown table "${named.name}"`);
    return;
  }
  let method: string | null = null;
  if (cur.tryWords('USING')) method = (cur.takeIdentifier() ?? '').toLowerCase() || null;
  const group = cur.takeParenGroup();
  if (group === null) return;
  const parts = splitTopLevel(group, ',', SQL_SCAN);
  const known = new Set(table.columns.map((c) => c.name));
  const cols: string[] = [];
  let isExpression = false;
  for (const part of parts) {
    const partCur = new SqlCursor(part);
    const ident = partCur.takeIdentifier();
    if (ident !== null && known.has(ident)) cols.push(ident);
    else isExpression = true;
  }
  const partial = /\bWHERE\b/i.test(cur.rest());
  table.indexes.push({
    name: indexName,
    columns: cols,
    expression: isExpression ? group.trim() : null,
    unique,
    method,
    partial,
  });
  if (unique && cols.length > 0 && !isExpression) {
    table.uniques.push({ name: indexName, columns: cols });
  }
}

function parseCreateView(cur: SqlCursor, materialized: boolean, state: SqlParseState): void {
  cur.tryWords('IF', 'NOT', 'EXISTS');
  const named = qualifiedToParts(cur.takeQualifiedIdentifier(), state);
  if (!named) return;
  // Columns only when explicitly listed: CREATE VIEW v (a, b) AS …
  const group = cur.takeParenGroup();
  if (group === null) {
    state.warnings.addCount(
      'skipped-statement',
      `skipped CREATE ${materialized ? 'MATERIALIZED VIEW' : 'VIEW'} without column list`,
    );
    return;
  }
  const table = state.builder.addTable({
    name: named.name,
    schema: named.schema,
    kind: materialized ? 'materialized-view' : 'view',
  });
  for (const colName of identList(group)) {
    table.columns.push({ name: colName, dbType: 'unknown', logicalType: 'unknown' });
  }
}

function parseAlterTable(cur: SqlCursor, stmt: Statement, state: SqlParseState): void {
  cur.tryWords('IF', 'EXISTS');
  cur.tryWords('ONLY');
  const named = qualifiedToParts(cur.takeQualifiedIdentifier(), state);
  if (!named) return;
  const table = state.builder.getTable(`${named.schema}.${named.name}`);
  if (!table) {
    state.warnings.add('unknown-table', `ALTER TABLE on unknown table "${named.name}" skipped`);
    return;
  }

  if (cur.tryWords('ADD', 'CONSTRAINT')) {
    parseTableConstraint(cur, table, takeConstraintSymbol(cur), state);
    return;
  }
  if (cur.tryWords('ADD')) {
    const head = cur.peekWord();
    if (head === 'PRIMARY' || head === 'FOREIGN' || head === 'UNIQUE' || head === 'CHECK' ||
        head === 'KEY' || head === 'INDEX') {
      parseTableConstraint(cur, table, null, state);
      return;
    }
    cur.tryWords('COLUMN');
    cur.tryWords('IF', 'NOT', 'EXISTS');
    parseColumnDef(cur, table, state);
    return;
  }
  if (cur.tryWords('ALTER', 'COLUMN') || cur.tryWords('ALTER')) {
    const colName = cur.takeIdentifier();
    const col = table.columns.find((c) => c.name === colName);
    if (!col) return;
    if (cur.tryWords('SET', 'DEFAULT')) {
      col.default = classifySqlDefault(takeDefaultExpression(cur));
      return;
    }
    if (cur.tryWords('SET', 'NOT', 'NULL')) {
      col.nullable = false;
      return;
    }
    if (cur.tryWords('DROP', 'NOT', 'NULL')) {
      col.nullable = true;
      return;
    }
    state.warnings.addCount('skipped-statement', 'skipped ALTER TABLE ALTER COLUMN action');
    return;
  }
  state.warnings.addCount(
    'skipped-statement',
    `skipped ALTER TABLE ${cur.peekWord() ?? '?'} action`,
  );
}

function parseCommentOn(cur: SqlCursor, state: SqlParseState): void {
  if (!cur.tryWords('ON')) return;
  if (cur.tryWords('TABLE')) {
    const named = qualifiedToParts(cur.takeQualifiedIdentifier(), state);
    if (named && cur.tryWords('IS')) {
      const text = cur.takeStringLiteral();
      const table = state.builder.getTable(`${named.schema}.${named.name}`);
      if (table && text !== null) table.comment = text;
    }
    return;
  }
  if (cur.tryWords('COLUMN')) {
    const parts = cur.takeQualifiedIdentifier();
    if (parts && parts.length >= 2 && cur.tryWords('IS')) {
      const text = cur.takeStringLiteral();
      const colName = parts[parts.length - 1] as string;
      const tableRef = parts.slice(0, -1).join('.');
      const table = state.builder.getTable(tableRef);
      const col = table?.columns.find((c) => c.name === colName);
      if (col && text !== null) col.comment = text;
    }
    return;
  }
  state.warnings.addCount('skipped-statement', `skipped COMMENT ON ${cur.peekWord() ?? '?'} statement`);
}

/** Late pass: columns typed with a `CREATE TYPE … AS ENUM` name become enum columns. */
function resolveEnumColumns(state: SqlParseState): void {
  if (state.enumTypes.size === 0) return;
  for (const table of state.builder.allTables()) {
    for (const col of table.columns) {
      if (col.logicalType !== 'unknown' || col.dbType === undefined) continue;
      const base = col.dbType.replace(/\(.*\)/s, '').replace(/\[\]/g, '').trim().toLowerCase();
      const id = state.enumTypes.get(base) ?? state.enumTypes.get(base.replace(/^[^.]*\./, ''));
      if (id !== undefined) {
        col.logicalType = 'enum';
        col.enumRef = id;
      }
    }
  }
}
