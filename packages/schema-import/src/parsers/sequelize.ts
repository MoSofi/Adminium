// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sequelize model parser — 05-introspection-engine.md §5.2 row 5, tokenizer
 * level: `sequelize.define('name', {attrs}, {options})` and
 * `class X extends Model {}` + `X.init({attrs}, {options})` forms.
 * `DataTypes.*` map, `allowNull` / `unique` / `primaryKey` / `autoIncrement` /
 * `defaultValue` / `references: {model, key}`. Table names are taken verbatim
 * (Sequelize would pluralize model names at runtime — warned).
 */
import type { ColumnDefault, DatabaseModel, FkAction, LogicalType } from '@adminium/engine';

import { ModelBuilder, type ColumnDraft, type TableDraft } from '../builder.js';
import { SchemaImportError } from '../errors.js';
import { collectStrings, findBalanced, parseArgs, splitTopLevel, stringLiteral, stripComments } from '../text.js';
import type { WarningList } from '../warnings.js';

const JS_SCAN = { backslashEscapes: true, lineComments: ['//'], blockComments: true } as const;

const DATA_TYPES: Readonly<Record<string, { logicalType: LogicalType; dbType: string }>> = {
  STRING: { logicalType: 'varchar', dbType: 'varchar(255)' },
  CHAR: { logicalType: 'varchar', dbType: 'char' },
  TEXT: { logicalType: 'text', dbType: 'text' },
  CITEXT: { logicalType: 'text', dbType: 'citext' },
  TINYINT: { logicalType: 'integer', dbType: 'tinyint' },
  SMALLINT: { logicalType: 'integer', dbType: 'smallint' },
  MEDIUMINT: { logicalType: 'integer', dbType: 'mediumint' },
  INTEGER: { logicalType: 'integer', dbType: 'integer' },
  BIGINT: { logicalType: 'bigint', dbType: 'bigint' },
  FLOAT: { logicalType: 'float', dbType: 'float' },
  REAL: { logicalType: 'float', dbType: 'real' },
  DOUBLE: { logicalType: 'float', dbType: 'double' },
  DECIMAL: { logicalType: 'decimal', dbType: 'decimal' },
  NUMERIC: { logicalType: 'decimal', dbType: 'numeric' },
  BOOLEAN: { logicalType: 'boolean', dbType: 'boolean' },
  DATE: { logicalType: 'timestamptz', dbType: 'timestamp with time zone' },
  DATEONLY: { logicalType: 'date', dbType: 'date' },
  TIME: { logicalType: 'time', dbType: 'time' },
  NOW: { logicalType: 'timestamp', dbType: 'timestamp' },
  UUID: { logicalType: 'uuid', dbType: 'uuid' },
  JSON: { logicalType: 'json', dbType: 'json' },
  JSONB: { logicalType: 'json', dbType: 'jsonb' },
  BLOB: { logicalType: 'binary', dbType: 'blob' },
  ENUM: { logicalType: 'enum', dbType: 'enum' },
  GEOMETRY: { logicalType: 'geometry', dbType: 'geometry' },
  INET: { logicalType: 'inet', dbType: 'inet' },
};

interface ModelSite {
  modelName: string;
  attrsObject: string;
  optionsObject: string | null;
}

export function parseSequelize(content: string, name: string, warnings: WarningList): DatabaseModel {
  const source = stripComments(content, JS_SCAN);
  const sites: ModelSite[] = [];

  // Form 1: sequelize.define('user', {…}, {…})
  const defineRe = /\bsequelize\.define\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = defineRe.exec(source)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = findBalanced(source, open, JS_SCAN);
    if (close === -1) continue;
    const args = splitTopLevel(source.slice(open + 1, close), ',', JS_SCAN);
    const modelName = stringLiteral(args[0] ?? '');
    const attrs = args.find((a) => a.trimStart().startsWith('{'));
    if (modelName === null || attrs === undefined) {
      warnings.add('dynamic-name', 'sequelize.define with a non-literal name or attributes skipped');
      continue;
    }
    const options = args.slice(args.indexOf(attrs) + 1).find((a) => a.trimStart().startsWith('{')) ?? null;
    sites.push({ modelName, attrsObject: attrs, optionsObject: options });
    defineRe.lastIndex = close + 1;
  }

  // Form 2: class User extends Model {…}; User.init({…}, {…})
  const initRe = /\b([A-Za-z_$][\w$]*)\.init\s*\(/g;
  while ((m = initRe.exec(source)) !== null) {
    const className = m[1] as string;
    if (className === 'Model') continue;
    const open = m.index + m[0].length - 1;
    const close = findBalanced(source, open, JS_SCAN);
    if (close === -1) continue;
    const args = splitTopLevel(source.slice(open + 1, close), ',', JS_SCAN);
    const attrs = args.find((a) => a.trimStart().startsWith('{'));
    if (attrs === undefined) continue;
    const options = args.slice(args.indexOf(attrs) + 1).find((a) => a.trimStart().startsWith('{')) ?? null;
    sites.push({ modelName: className, attrsObject: attrs, optionsObject: options });
    initRe.lastIndex = close + 1;
  }

  if (sites.length === 0) {
    throw new SchemaImportError('no sequelize.define() calls or Model.init() classes found');
  }

  const builder = new ModelBuilder(warnings);
  /** model name (define name or class name) → table name, for `references: {model: Users}` */
  const modelToTable = new Map<string, string>();

  for (const site of sites) {
    const options = site.optionsObject !== null ? parseArgs(stripObj(site.optionsObject), 'js').named : {};
    const tableName = stringLiteral(options['tableName'] ?? '') ?? site.modelName;
    if (stringLiteral(options['tableName'] ?? '') === null) {
      warnings.add(
        'naming-assumed',
        `model "${site.modelName}" has no tableName option; name taken verbatim (Sequelize would pluralize at runtime)`,
      );
    }
    modelToTable.set(site.modelName, tableName);
    const modelNameOpt = stringLiteral(options['modelName'] ?? '');
    if (modelNameOpt !== null) modelToTable.set(modelNameOpt, tableName);

    const table = builder.addTable({ name: tableName });
    const underscored = options['underscored'] === 'true';

    for (const entry of splitTopLevel(stripObj(site.attrsObject), ',', JS_SCAN)) {
      const kv = /^([A-Za-z_$][\w$]*|"[^"]+"|'[^']+')\s*:\s*([\s\S]+)$/.exec(entry.trim());
      if (!kv) continue;
      const attrName = stringLiteral(kv[1] as string) ?? (kv[1] as string);
      const col = parseAttribute(attrName, (kv[2] as string).trim(), table, builder, warnings);
      if (col) table.columns.push(col);
    }

    if (options['timestamps'] === 'true') {
      const createdAt = underscored ? 'created_at' : 'createdAt';
      const updatedAt = underscored ? 'updated_at' : 'updatedAt';
      for (const colName of [createdAt, updatedAt]) {
        if (!table.columns.some((c) => c.name === colName)) {
          table.columns.push({
            name: colName,
            dbType: 'timestamp with time zone',
            logicalType: 'timestamptz',
            nullable: false,
          });
        }
      }
    }
  }

  // `references: { model: 'users' | Users }` may name a model — remap.
  for (const table of builder.allTables()) {
    for (const col of table.columns) {
      if (col.references != null && builder.getTable(col.references.table) === undefined) {
        const remapped = modelToTable.get(col.references.table);
        if (remapped !== undefined) col.references = { ...col.references, table: remapped };
      }
    }
  }

  if (/\.(belongsTo|hasMany|hasOne|belongsToMany)\s*\(/.test(source)) {
    warnings.add(
      'skipped-associations',
      'association calls (belongsTo/hasMany/hasOne/belongsToMany) are not imported; declare references in attributes',
    );
  }

  return builder.finalize({
    format: 'sequelize',
    dialect: 'generic',
    name,
    capabilities: { hasEnums: true, hasFKs: true, hasComments: true, hasChecks: false, hasSchemas: false },
  });
}

function stripObj(objectLiteral: string): string {
  const s = objectLiteral.trim();
  return s.startsWith('{') && s.endsWith('}') ? s.slice(1, -1) : s;
}

function parseAttribute(
  attrName: string,
  valueExpr: string,
  table: TableDraft,
  builder: ModelBuilder,
  warnings: WarningList,
): ColumnDraft | null {
  // Shorthand: `name: DataTypes.STRING`
  if (!valueExpr.startsWith('{')) {
    const typed = applyDataType(valueExpr, { name: attrName }, table, builder);
    if (!typed) {
      warnings.addCount('unknown-type', `skipped attribute with unrecognized type expression`);
      return null;
    }
    return typed;
  }

  const opts = parseArgs(stripObj(valueExpr), 'js').named;
  const columnName = stringLiteral(opts['field'] ?? '') ?? attrName;
  let col: ColumnDraft = { name: columnName };
  if (opts['type'] !== undefined) {
    const typed = applyDataType(opts['type'], col, table, builder);
    if (typed) col = typed;
    else {
      warnings.addCount('unknown-type', 'attribute type expression not recognized; mapped to unknown');
      col.dbType = opts['type'];
      col.logicalType = 'unknown';
    }
  }
  if (opts['allowNull'] !== undefined) col.nullable = opts['allowNull'] === 'true';
  if (opts['primaryKey'] === 'true') {
    col.isPrimaryKey = true;
    col.nullable = false;
  }
  if (opts['unique'] !== undefined && opts['unique'] !== 'false') col.isUnique = true;
  if (opts['autoIncrement'] === 'true') col.default = { kind: 'autoincrement' };
  if (opts['comment'] !== undefined) col.comment = stringLiteral(opts['comment']);
  if (opts['defaultValue'] !== undefined && col.default === undefined) {
    col.default = classifySequelizeDefault(opts['defaultValue']);
  }
  const refs = opts['references'];
  if (refs !== undefined && refs.trimStart().startsWith('{')) {
    const refOpts = parseArgs(stripObj(refs), 'js').named;
    const model = stringLiteral(refOpts['model'] ?? '') ?? refOpts['model'];
    const key = stringLiteral(refOpts['key'] ?? '');
    if (model !== undefined && model.length > 0) {
      col.references = {
        table: model,
        column: key ?? undefined,
        onDelete: fkAction(opts['onDelete']),
        onUpdate: fkAction(opts['onUpdate']),
      };
    }
  }
  return col;
}

/** Interpret a `DataTypes.X(...)` (or `Sequelize.X`) expression onto a column draft. */
function applyDataType(
  expr: string,
  col: ColumnDraft,
  table: TableDraft,
  builder: ModelBuilder,
): ColumnDraft | null {
  const m = /^(?:DataTypes|Sequelize)\.([A-Z]+[A-Z0-9_]*)(?:\s*\(([\s\S]*?)\))?/.exec(expr.trim());
  if (!m) return null;
  const typeName = m[1] as string;
  const args = m[2] ?? '';

  if (typeName === 'UUIDV4' || typeName === 'UUIDV1') {
    col.dbType = 'uuid';
    col.logicalType = 'uuid';
    return col;
  }
  const known = DATA_TYPES[typeName];
  if (known === undefined) return null;
  col.dbType = known.dbType;
  col.logicalType = known.logicalType;

  if (typeName === 'ENUM') {
    const values = collectStrings(args, JS_SCAN);
    if (values.length > 0) {
      const id = `public.${table.name}.${col.name}`;
      builder.addEnum({ id, name: col.name, values, source: 'column-type' });
      col.enumRef = id;
      col.dbType = `enum(${values.map((v) => `'${v}'`).join(',')})`;
    } else {
      col.logicalType = 'text';
    }
    return col;
  }
  const nums = args
    .split(',')
    .map((a) => Number.parseInt(a.trim(), 10))
    .filter((n) => Number.isFinite(n));
  if (typeName === 'STRING' || typeName === 'CHAR') {
    col.maxLength = nums[0] ?? 255;
    col.dbType = `varchar(${col.maxLength})`;
  } else if (typeName === 'DECIMAL' || typeName === 'NUMERIC' || typeName === 'FLOAT' || typeName === 'DOUBLE') {
    col.numericPrecision = nums[0] ?? null;
    col.numericScale = nums[1] ?? null;
  }
  return col;
}

function classifySequelizeDefault(raw: string): ColumnDefault {
  const arg = raw.trim();
  if (/^(?:DataTypes|Sequelize)\.NOW$/.test(arg)) return { kind: 'now' };
  if (/^(?:DataTypes|Sequelize)\.UUIDV[14]$/.test(arg)) return { kind: 'uuid' };
  const literalFn = /^(?:Sequelize|sequelize)\.(?:literal|fn)\s*\(([\s\S]*)\)$/.exec(arg);
  if (literalFn) {
    const inner = stringLiteral(splitTopLevel(literalFn[1] as string, ',', JS_SCAN)[0] ?? '') ?? literalFn[1];
    if (/current_timestamp|now\(\)/i.test(inner as string)) return { kind: 'now' };
    return { kind: 'expression', text: inner as string };
  }
  const str = stringLiteral(arg);
  if (str !== null) return { kind: 'literal', text: str };
  if (/^-?\d+(\.\d+)?$/.test(arg) || arg === 'true' || arg === 'false') {
    return { kind: 'literal', text: arg };
  }
  if (arg === 'null') return null;
  return { kind: 'expression', text: arg };
}

function fkAction(raw: string | undefined): FkAction | null {
  const value = raw === undefined ? null : stringLiteral(raw)?.toUpperCase() ?? null;
  switch (value) {
    case 'CASCADE':
      return 'cascade';
    case 'RESTRICT':
      return 'restrict';
    case 'SET NULL':
      return 'set-null';
    case 'SET DEFAULT':
      return 'set-default';
    case 'NO ACTION':
      return 'no-action';
    default:
      return null;
  }
}
