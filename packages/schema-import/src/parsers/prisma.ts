// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Prisma schema parser — 05-introspection-engine.md §5.2 row 2. Hand-rolled
 * block parser (the grammar is small and stable): `datasource` provider →
 * dialect, `model` / `enum` blocks, field attributes, `///` doc comments →
 * comments. Relation fields with `fields:`/`references:` become declared FKs;
 * back-relations (model-typed fields without `fields:`) are skipped.
 */
import type { ColumnDefault, DatabaseModel, Dialect, FkAction, LogicalType } from '@adminium/engine';

import { ModelBuilder, type ColumnDraft, type TableDraft } from '../builder.js';
import { SchemaImportError } from '../errors.js';
import { findBalanced, splitTopLevel, stringLiteral } from '../text.js';
import type { WarningList } from '../warnings.js';

const SCALAR_TYPES: Readonly<Record<string, LogicalType>> = {
  String: 'text',
  Int: 'integer',
  BigInt: 'bigint',
  Float: 'float',
  Decimal: 'decimal',
  Boolean: 'boolean',
  DateTime: 'timestamp',
  Json: 'json',
  Bytes: 'binary',
};

const ON_DELETE_MAP: Readonly<Record<string, FkAction>> = {
  Cascade: 'cascade',
  Restrict: 'restrict',
  SetNull: 'set-null',
  SetDefault: 'set-default',
  NoAction: 'no-action',
};

interface Block {
  keyword: string;
  name: string;
  body: string;
  /** `///` lines immediately above the block. */
  doc: string | null;
}

interface FieldAttr {
  name: string;
  args: string;
}

interface PrismaField {
  name: string;
  type: string;
  optional: boolean;
  list: boolean;
  attrs: FieldAttr[];
  doc: string | null;
}

export function parsePrisma(content: string, name: string, warnings: WarningList): DatabaseModel {
  const blocks = scanBlocks(content);
  if (!blocks.some((b) => b.keyword === 'model')) {
    throw new SchemaImportError('no `model` blocks found in Prisma schema');
  }

  let dialect: Dialect = 'generic';
  for (const block of blocks) {
    if (block.keyword !== 'datasource') continue;
    const provider = /provider\s*=\s*"([^"]+)"/.exec(block.body)?.[1];
    if (provider === 'postgresql' || provider === 'postgres' || provider === 'cockroachdb') {
      dialect = 'postgres';
    } else if (provider === 'mysql') dialect = 'mysql';
    else if (provider === 'sqlite') dialect = 'sqlite';
    else if (provider !== undefined) {
      warnings.add('unsupported-provider', `datasource provider "${provider}" mapped to generic dialect`);
    }
  }

  const builder = new ModelBuilder(warnings);
  const enumNames = new Set<string>();
  for (const block of blocks) {
    if (block.keyword !== 'enum') continue;
    const values: string[] = [];
    for (const rawLine of block.body.split('\n')) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith('//')) continue;
      const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s+@map\("([^"]+)"\))?/.exec(line);
      if (m) values.push(m[2] ?? (m[1] as string));
    }
    if (values.length > 0) {
      builder.addEnum({ id: block.name, name: block.name, values, source: 'import' });
      enumNames.add(block.name);
    }
  }

  const models = blocks.filter((b) => b.keyword === 'model');
  const modelNames = new Set(models.map((m) => m.name));
  /** model name → parsed fields + table draft (relations resolved after all models). */
  const parsed: { block: Block; table: TableDraft; fields: PrismaField[] }[] = [];

  for (const block of models) {
    const fields = parseModelBody(block.body);
    const mapAttr = findBlockAttr(block.body, 'map');
    const tableName = (mapAttr ? stringLiteral(mapAttr) : null) ?? block.name;
    const table = builder.addTable({ name: tableName, comment: block.doc });
    parsed.push({ block, table, fields });
  }
  const tableNameOf = (model: string): string | null => {
    const entry = parsed.find((p) => p.block.name === model);
    return entry ? entry.table.name : null;
  };

  for (const { block, table, fields } of parsed) {
    const columnNameOf = (fieldName: string): string => {
      const field = fields.find((f) => f.name === fieldName);
      const mapped = field?.attrs.find((a) => a.name === 'map');
      return (mapped ? stringLiteral(mapped.args) : null) ?? fieldName;
    };

    for (const field of fields) {
      if (modelNames.has(field.type)) {
        // Relation field.
        const rel = field.attrs.find((a) => a.name === 'relation');
        const args = rel ? parseRelationArgs(rel.args) : null;
        if (!args || args.fields.length === 0) continue; // back-relation — skipped by design
        const targetModel = field.type;
        const targetTable = tableNameOf(targetModel);
        if (targetTable === null) continue;
        const fkColumns = args.fields.map(columnNameOf);
        const toColumns = args.references;
        if (fkColumns.length === 1) {
          const col = table.columns.find((c) => c.name === fkColumns[0]);
          if (col) {
            col.references = {
              table: targetTable,
              column: toColumns[0],
              onDelete: args.onDelete,
            };
            continue;
          }
        }
        builder.addRelation({
          kind: 'declared-fk',
          cardinality: 'one-to-many',
          from: { table: table.name, columns: fkColumns },
          to: { table: targetTable, columns: toColumns.length > 0 ? toColumns : fkColumns },
          onDelete: args.onDelete,
        });
        continue;
      }
      if (field.list && !SCALAR_TYPES[field.type] && !enumNames.has(field.type)) {
        // List of an unknown type — an implicit M2M back-relation to a model
        // outside this file, or unsupported composite type.
        warnings.add(
          'skipped-field',
          `field "${block.name}.${field.name}" of type ${field.type}[] skipped`,
        );
        continue;
      }

      const col = buildColumn(field, block.name, enumNames, warnings);
      if (col === null) continue;
      table.columns.push(col);
      if (field.attrs.some((a) => a.name === 'id')) {
        col.isPrimaryKey = true;
        col.nullable = false;
      }
      if (field.attrs.some((a) => a.name === 'unique')) col.isUnique = true;
    }

    // Block attributes.
    for (const attr of blockAttrs(block.body)) {
      if (attr.name === 'id') {
        table.primaryKey = parseFieldList(attr.args).map(columnNameOf);
      } else if (attr.name === 'unique') {
        table.uniques.push({ name: null, columns: parseFieldList(attr.args).map(columnNameOf) });
      } else if (attr.name === 'index') {
        const cols = parseFieldList(attr.args).map(columnNameOf);
        table.indexes.push({ name: `${table.name}_${cols.join('_')}_idx`, columns: cols });
      } else if (attr.name !== 'map') {
        warnings.addCount('unsupported-attribute', `ignored @@${attr.name} attribute`);
      }
    }
  }

  return builder.finalize({
    format: 'prisma',
    dialect,
    name,
    capabilities: {
      hasEnums: true,
      hasFKs: true,
      hasComments: true,
      hasSchemas: false,
      hasChecks: false,
    },
  });
}

function buildColumn(
  field: PrismaField,
  modelName: string,
  enumNames: ReadonlySet<string>,
  warnings: WarningList,
): ColumnDraft | null {
  const mapped = field.attrs.find((a) => a.name === 'map');
  const name = (mapped ? stringLiteral(mapped.args) : null) ?? field.name;
  const col: ColumnDraft = {
    name,
    nullable: field.optional,
    isArray: field.list,
    comment: field.doc,
  };
  if (enumNames.has(field.type)) {
    col.dbType = field.type;
    col.logicalType = 'enum';
    col.enumRef = field.type;
  } else {
    const scalar = SCALAR_TYPES[field.type];
    if (scalar === undefined) {
      if (field.type === 'Unsupported') {
        warnings.add('unsupported-type', `field "${modelName}.${field.name}" has Unsupported() type`);
        col.dbType = 'unsupported';
        col.logicalType = 'unknown';
      } else {
        warnings.add(
          'skipped-field',
          `field "${modelName}.${field.name}" of unknown type ${field.type} skipped`,
        );
        return null;
      }
    } else {
      col.dbType = field.type;
      col.logicalType = scalar;
    }
  }

  // Native type refinements: @db.VarChar(120), @db.Uuid, @db.Text, @db.Timestamptz…
  const native = field.attrs.find((a) => a.name.startsWith('db.'));
  if (native) {
    const kind = native.name.slice(3).toLowerCase();
    const arg = Number.parseInt(native.args, 10);
    if (kind === 'varchar' || kind === 'char') {
      col.logicalType = 'varchar';
      col.dbType = Number.isFinite(arg) ? `varchar(${arg})` : 'varchar';
      if (Number.isFinite(arg)) col.maxLength = arg;
    } else if (kind === 'text') col.logicalType = 'text';
    else if (kind === 'uuid') col.logicalType = 'uuid';
    else if (kind === 'timestamptz') col.logicalType = 'timestamptz';
    else if (kind === 'date') col.logicalType = 'date';
    else if (kind === 'decimal' || kind === 'money') col.logicalType = 'decimal';
    else if (kind === 'jsonb' || kind === 'json') col.logicalType = 'json';
  }

  const def = field.attrs.find((a) => a.name === 'default');
  if (def) col.default = classifyPrismaDefault(def.args);
  if (field.attrs.some((a) => a.name === 'updatedAt')) {
    // No IR slot for @updatedAt; the classifier's `updated-at` semantic picks
    // it up from the column name downstream.
  }
  return col;
}

function classifyPrismaDefault(args: string): ColumnDefault {
  const arg = args.trim();
  if (arg === 'autoincrement()') return { kind: 'autoincrement' };
  if (arg === 'now()') return { kind: 'now' };
  if (arg === 'uuid()' || arg === 'uuid(4)' || arg === 'uuid(7)') return { kind: 'uuid' };
  if (arg === 'cuid()' || arg === 'cuid(2)' || arg === 'nanoid()' || arg === 'ulid()') {
    return { kind: 'expression', text: arg };
  }
  const dbgen = /^dbgenerated\(\s*"([^"]*)"\s*\)$/.exec(arg);
  if (dbgen) return { kind: 'expression', text: dbgen[1] as string };
  const str = stringLiteral(arg);
  if (str !== null) return { kind: 'literal', text: str };
  if (/^-?\d+(\.\d+)?$/.test(arg) || arg === 'true' || arg === 'false') {
    return { kind: 'literal', text: arg };
  }
  if (/^\[.*\]$/s.test(arg)) return { kind: 'expression', text: arg };
  // Bare word: enum value default.
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(arg)) return { kind: 'literal', text: arg };
  return { kind: 'expression', text: arg };
}

/* ------------------------------- block scanning ------------------------------- */

function scanBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const re = /(^|\n)([ \t]*)(model|enum|datasource|generator)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const braceIndex = m.index + m[0].length - 1;
    const end = findBalanced(content, braceIndex, { lineComments: ['//'] });
    if (end === -1) continue;
    // Collect /// doc lines immediately above.
    const before = content.slice(0, m.index).split('\n');
    const docLines: string[] = [];
    for (let i = before.length - 1; i >= 0; i -= 1) {
      const line = (before[i] as string).trim();
      if (line.startsWith('///')) docLines.unshift(line.slice(3).trim());
      else if (line.length === 0 && docLines.length === 0) continue;
      else break;
    }
    blocks.push({
      keyword: m[3] as string,
      name: m[4] as string,
      body: content.slice(braceIndex + 1, end),
      doc: docLines.length > 0 ? docLines.join('\n') : null,
    });
    re.lastIndex = end + 1;
  }
  return blocks;
}

function parseModelBody(body: string): PrismaField[] {
  const fields: PrismaField[] = [];
  let doc: string[] = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('///')) {
      doc.push(line.slice(3).trim());
      continue;
    }
    if (line.startsWith('//')) continue;
    if (line.startsWith('@@')) {
      doc = [];
      continue;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_.]*(?:\(\s*"[^"]*"\s*\))?)(\[\])?(\?)?\s*(.*)$/.exec(
      line,
    );
    if (!m) {
      doc = [];
      continue;
    }
    let type = m[2] as string;
    const unsupported = /^Unsupported\(/.exec(type);
    if (unsupported) type = 'Unsupported';
    fields.push({
      name: m[1] as string,
      type,
      list: m[3] !== undefined,
      optional: m[4] !== undefined,
      attrs: parseAttrs(m[5] ?? ''),
      doc: doc.length > 0 ? doc.join('\n') : null,
    });
    doc = [];
  }
  return fields;
}

function parseAttrs(rest: string): FieldAttr[] {
  const attrs: FieldAttr[] = [];
  let i = 0;
  while (i < rest.length) {
    if (rest[i] !== '@') {
      i += 1;
      continue;
    }
    const m = /^@([A-Za-z_][A-Za-z0-9_.]*)/.exec(rest.slice(i));
    if (!m) {
      i += 1;
      continue;
    }
    const name = m[1] as string;
    let args = '';
    let next = i + m[0].length;
    if (rest[next] === '(') {
      const end = findBalanced(rest, next);
      if (end !== -1) {
        args = rest.slice(next + 1, end);
        next = end + 1;
      }
    }
    attrs.push({ name, args });
    i = next;
  }
  return attrs;
}

function blockAttrs(body: string): FieldAttr[] {
  const attrs: FieldAttr[] = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('@@')) continue;
    const m = /^@@([A-Za-z_][A-Za-z0-9_.]*)/.exec(line);
    if (!m) continue;
    const name = m[1] as string;
    let args = '';
    const parenIndex = m[0].length;
    if (line[parenIndex] === '(') {
      const end = findBalanced(line, parenIndex);
      if (end !== -1) args = line.slice(parenIndex + 1, end);
    }
    attrs.push({ name, args });
  }
  return attrs;
}

function findBlockAttr(body: string, name: string): string | null {
  return blockAttrs(body).find((a) => a.name === name)?.args ?? null;
}

/** `[a, b]` (bare or with `fields: [..]` sub-syntax) → field names. */
function parseFieldList(args: string): string[] {
  const listMatch = /\[([^\]]*)\]/.exec(args);
  const inner = listMatch ? (listMatch[1] as string) : args;
  return splitTopLevel(inner, ',')
    .map((s) => s.trim().replace(/\(.*\)$/s, '').trim())
    .filter((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s));
}

function parseRelationArgs(args: string): {
  fields: string[];
  references: string[];
  onDelete: FkAction | null;
} {
  const out = { fields: [] as string[], references: [] as string[], onDelete: null as FkAction | null };
  for (const part of splitTopLevel(args, ',')) {
    const kv = /^(\w+)\s*:\s*([\s\S]+)$/.exec(part);
    if (!kv) continue;
    const key = kv[1] as string;
    const value = (kv[2] as string).trim();
    if (key === 'fields') out.fields = parseFieldList(value);
    else if (key === 'references') out.references = parseFieldList(value);
    else if (key === 'onDelete') out.onDelete = ON_DELETE_MAP[value] ?? null;
  }
  return out;
}
