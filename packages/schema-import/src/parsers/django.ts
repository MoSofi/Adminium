// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Django `models.py` parser — 05-introspection-engine.md §5.2 row 7. Pure
 * line grammar per `class X(models.Model):` block. Field map per the
 * assignment (CharField(max_length) … ForeignKey/OneToOneField/
 * ManyToManyField), `choices=` → CHECK-style enum, `class Meta: db_table`,
 * implicit `id` pk, FK column `<field>_id`, snake_case table naming. The app
 * label is unknowable from a single file, so derived table names warn once —
 * Studio offers a rename affordance downstream.
 */
import type { ColumnDefault, DatabaseModel, FkAction, LogicalType } from '@adminium/engine';

import { ModelBuilder, type ColumnDraft, type TableDraft } from '../builder.js';
import { SchemaImportError } from '../errors.js';
import { findBalanced, parseArgs, singularize, snakeCase, splitTopLevel, stringLiteral } from '../text.js';
import type { WarningList } from '../warnings.js';

const PY_SCAN = { backslashEscapes: true, lineComments: ['#'] } as const;

interface DjangoFieldType {
  logicalType: LogicalType;
  dbType: string;
  maxLength?: number;
}

const FIELD_TYPES: Readonly<Record<string, DjangoFieldType>> = {
  CharField: { logicalType: 'varchar', dbType: 'character varying' },
  SlugField: { logicalType: 'varchar', dbType: 'character varying', maxLength: 50 },
  EmailField: { logicalType: 'varchar', dbType: 'character varying', maxLength: 254 },
  URLField: { logicalType: 'varchar', dbType: 'character varying', maxLength: 200 },
  FilePathField: { logicalType: 'varchar', dbType: 'character varying', maxLength: 100 },
  FileField: { logicalType: 'varchar', dbType: 'character varying', maxLength: 100 },
  ImageField: { logicalType: 'varchar', dbType: 'character varying', maxLength: 100 },
  TextField: { logicalType: 'text', dbType: 'text' },
  IntegerField: { logicalType: 'integer', dbType: 'integer' },
  PositiveIntegerField: { logicalType: 'integer', dbType: 'integer' },
  PositiveSmallIntegerField: { logicalType: 'integer', dbType: 'smallint' },
  SmallIntegerField: { logicalType: 'integer', dbType: 'smallint' },
  BigIntegerField: { logicalType: 'bigint', dbType: 'bigint' },
  PositiveBigIntegerField: { logicalType: 'bigint', dbType: 'bigint' },
  AutoField: { logicalType: 'integer', dbType: 'integer' },
  BigAutoField: { logicalType: 'bigint', dbType: 'bigint' },
  SmallAutoField: { logicalType: 'integer', dbType: 'smallint' },
  DecimalField: { logicalType: 'decimal', dbType: 'numeric' },
  FloatField: { logicalType: 'float', dbType: 'double precision' },
  BooleanField: { logicalType: 'boolean', dbType: 'boolean' },
  NullBooleanField: { logicalType: 'boolean', dbType: 'boolean' },
  DateField: { logicalType: 'date', dbType: 'date' },
  DateTimeField: { logicalType: 'timestamptz', dbType: 'timestamp with time zone' },
  TimeField: { logicalType: 'time', dbType: 'time' },
  DurationField: { logicalType: 'interval', dbType: 'interval' },
  UUIDField: { logicalType: 'uuid', dbType: 'uuid' },
  JSONField: { logicalType: 'json', dbType: 'jsonb' },
  BinaryField: { logicalType: 'binary', dbType: 'bytea' },
  IPAddressField: { logicalType: 'inet', dbType: 'inet' },
  GenericIPAddressField: { logicalType: 'inet', dbType: 'inet' },
};

const AUTO_FIELDS = new Set(['AutoField', 'BigAutoField', 'SmallAutoField']);

interface DjangoField {
  name: string;
  type: string;
  args: ReturnType<typeof parseArgs>;
}

interface DjangoModel {
  className: string;
  tableName: string;
  explicitTable: boolean;
  fields: DjangoField[];
  meta: Record<string, string>;
}

export function parseDjango(content: string, name: string, warnings: WarningList): DatabaseModel {
  const models = scanModels(content);
  if (models.length === 0) {
    throw new SchemaImportError('no `class X(models.Model)` definitions found');
  }

  const builder = new ModelBuilder(warnings);
  const classToTable = new Map<string, string>();
  for (const model of models) {
    classToTable.set(model.className, model.tableName);
    if (!model.explicitTable) {
      warnings.add(
        'naming-assumed',
        `model "${model.className}" table name assumed "${model.tableName}" (app label unknown; Django would prefix it)`,
      );
    }
  }
  const resolveTarget = (raw: string): string | null => {
    const lit = stringLiteral(raw);
    const ref = lit ?? raw.trim();
    if (!/^[A-Za-z_][\w.]*$/.test(ref)) return null;
    if (ref === 'self') return null; // handled by caller with own table
    const bare = ref.includes('.') ? (ref.split('.').pop() as string) : ref;
    return classToTable.get(bare) ?? null;
  };

  interface M2mDraft {
    fromTable: string;
    fieldName: string;
    targetRaw: string;
    through: string | null;
  }
  const m2ms: M2mDraft[] = [];

  for (const model of models) {
    const table = builder.addTable({ name: model.tableName });
    let hasExplicitPk = false;
    /** field name → column name (FKs become `<field>_id`) for Meta lookups. */
    const fieldToColumn = new Map<string, string>();

    for (const field of model.fields) {
      const named = field.args.named;
      if (field.type === 'ManyToManyField') {
        m2ms.push({
          fromTable: model.tableName,
          fieldName: field.name,
          targetRaw: field.args.positional[0] ?? named['to'] ?? '',
          through: stringLiteral(named['through'] ?? '') ?? null,
        });
        continue;
      }
      if (field.type === 'ForeignKey' || field.type === 'OneToOneField') {
        const targetRaw = field.args.positional[0] ?? named['to'] ?? '';
        const isSelf = stringLiteral(targetRaw) === 'self' || targetRaw.trim() === "'self'";
        const target = isSelf ? model.tableName : resolveTarget(targetRaw);
        const columnName = stringLiteral(named['db_column'] ?? '') ?? `${field.name}_id`;
        const col: ColumnDraft = {
          name: columnName,
          dbType: 'bigint',
          logicalType: 'bigint',
          nullable: (named['null'] ?? '') === 'True',
        };
        if (field.type === 'OneToOneField') col.isUnique = true;
        if ((named['unique'] ?? '') === 'True') col.isUnique = true;
        if ((named['primary_key'] ?? '') === 'True') {
          col.isPrimaryKey = true;
          hasExplicitPk = true;
        }
        if (target === null) {
          warnings.add(
            'unresolved-reference',
            `ForeignKey "${model.className}.${field.name}" targets ${targetRaw || '?'} which is not in this file`,
          );
        } else {
          col.references = {
            table: target,
            column: stringLiteral(named['to_field'] ?? '') ?? undefined,
            onDelete: djangoOnDelete(named['on_delete']),
            cardinality: field.type === 'OneToOneField' ? 'one-to-one' : undefined,
          };
        }
        table.columns.push(col);
        fieldToColumn.set(field.name, columnName);
        continue;
      }

      const known = FIELD_TYPES[field.type];
      if (known === undefined) {
        warnings.addCount('unknown-field', `skipped unsupported Django field type ${field.type}`);
        continue;
      }
      const columnName = stringLiteral(named['db_column'] ?? '') ?? field.name;
      const col: ColumnDraft = {
        name: columnName,
        dbType: known.dbType,
        logicalType: known.logicalType,
        nullable: (named['null'] ?? '') === 'True',
      };
      const maxLength = Number.parseInt(named['max_length'] ?? '', 10);
      if (Number.isFinite(maxLength)) col.maxLength = maxLength;
      else if (known.maxLength !== undefined) col.maxLength = known.maxLength;
      if (col.logicalType === 'varchar' && col.maxLength != null) {
        col.dbType = `character varying(${col.maxLength})`;
      }
      const digits = Number.parseInt(named['max_digits'] ?? '', 10);
      if (Number.isFinite(digits)) col.numericPrecision = digits;
      const places = Number.parseInt(named['decimal_places'] ?? '', 10);
      if (Number.isFinite(places)) col.numericScale = places;
      if ((named['unique'] ?? '') === 'True') col.isUnique = true;
      if ((named['primary_key'] ?? '') === 'True') {
        col.isPrimaryKey = true;
        col.nullable = false;
        hasExplicitPk = true;
      }
      if (AUTO_FIELDS.has(field.type)) {
        col.default = { kind: 'autoincrement' };
        col.nullable = false;
      }
      if ((named['auto_now'] ?? '') === 'True' || (named['auto_now_add'] ?? '') === 'True') {
        col.default = { kind: 'now' };
      }
      if (named['default'] !== undefined && col.default === undefined) {
        col.default = classifyPyDefault(named['default']);
      }
      if ((named['db_index'] ?? '') === 'True') {
        table.indexes.push({ name: `${table.name}_${columnName}_idx`, columns: [columnName] });
      }
      const choices = named['choices'];
      if (choices !== undefined) {
        const values = parseChoices(choices);
        if (values !== null && values.length > 0) {
          const id = `public.${table.name}.${columnName}`;
          builder.addEnum({ id, name: columnName, values, source: 'import' });
          col.logicalType = 'enum';
          col.enumRef = id;
        } else {
          warnings.add(
            'unresolved-enum',
            `choices for "${model.className}.${field.name}" could not be resolved statically`,
          );
        }
      }
      table.columns.push(col);
      fieldToColumn.set(field.name, columnName);
    }

    if (!hasExplicitPk) {
      table.columns.unshift({
        name: 'id',
        dbType: 'bigint',
        logicalType: 'bigint',
        nullable: false,
        isPrimaryKey: true,
        default: { kind: 'autoincrement' },
      });
    }

    // Meta: unique_together names FIELDS, not columns — remap (FK → `<field>_id`).
    const uniqueTogether = model.meta['unique_together'];
    if (uniqueTogether !== undefined) {
      for (const group of parseTupleList(uniqueTogether)) {
        const columns = group.map((f) => fieldToColumn.get(f) ?? f);
        if (columns.length > 0) table.uniques.push({ name: null, columns });
      }
    }
  }

  // ManyToMany: through table when named and present, else synthesized join table.
  for (const m2m of m2ms) {
    const target = resolveTarget(m2m.targetRaw) ?? (stringLiteral(m2m.targetRaw) === 'self' ? m2m.fromTable : null);
    if (target === null) {
      warnings.add(
        'unresolved-reference',
        `ManyToManyField "${m2m.fieldName}" on "${m2m.fromTable}" targets a model outside this file; skipped`,
      );
      continue;
    }
    const fromTable = builder.getTable(m2m.fromTable);
    const toTable = builder.getTable(target);
    if (!fromTable || !toTable) continue;
    const pkOf = (t: TableDraft): string =>
      t.primaryKey[0] ?? t.columns.find((c) => c.isPrimaryKey === true)?.name ?? 'id';
    const fromPk = pkOf(fromTable);
    const toPk = pkOf(toTable);
    const fromCol = `${singularize(m2m.fromTable)}_id`;
    const toCol = `${singularize(target)}_id`;

    if (m2m.through !== null) {
      const throughTable = classToTable.get(m2m.through) ?? m2m.through;
      if (builder.getTable(throughTable) === undefined) {
        warnings.add(
          'unresolved-reference',
          `ManyToManyField "${m2m.fieldName}" through "${m2m.through}" not found; relation skipped`,
        );
        continue;
      }
      // Through model declares its own FKs; emit the m2m relation only.
      const through = builder.getTable(throughTable) as TableDraft;
      const fromRef = through.columns.find((c) => c.references?.table === m2m.fromTable);
      const toRef = through.columns.find((c) => c.references?.table === target && c !== fromRef);
      if (!fromRef || !toRef) continue;
      builder.addRelation({
        kind: 'inferred-join-table',
        cardinality: 'many-to-many',
        from: { table: m2m.fromTable, columns: [fromPk] },
        to: { table: target, columns: [toPk] },
        through: { table: throughTable, fromColumns: [fromRef.name], toColumns: [toRef.name] },
        confidence: 1,
      });
      continue;
    }

    const joinName = `${m2m.fromTable}_${snakeCase(m2m.fieldName)}`;
    const join = builder.addTable({ name: joinName });
    join.columns.push({
      name: 'id',
      dbType: 'bigint',
      logicalType: 'bigint',
      nullable: false,
      isPrimaryKey: true,
      default: { kind: 'autoincrement' },
    });
    join.columns.push({
      name: fromCol,
      dbType: 'bigint',
      logicalType: 'bigint',
      nullable: false,
      references: { table: m2m.fromTable, onDelete: 'cascade' },
    });
    join.columns.push({
      name: toCol === fromCol ? `to_${toCol}` : toCol,
      dbType: 'bigint',
      logicalType: 'bigint',
      nullable: false,
      references: { table: target, onDelete: 'cascade' },
    });
    join.uniques.push({ name: null, columns: [fromCol, toCol === fromCol ? `to_${toCol}` : toCol] });
    warnings.add(
      'synthesized-join-table',
      `ManyToManyField "${m2m.fieldName}" on "${m2m.fromTable}" synthesized join table "${joinName}"`,
      joinName,
    );
    builder.addRelation({
      kind: 'inferred-join-table',
      cardinality: 'many-to-many',
      from: { table: m2m.fromTable, columns: [fromPk] },
      to: { table: target, columns: [toPk] },
      through: {
        table: joinName,
        fromColumns: [fromCol],
        toColumns: [toCol === fromCol ? `to_${toCol}` : toCol],
      },
      confidence: 1,
    });
  }

  return builder.finalize({
    format: 'django',
    dialect: 'generic',
    name,
    capabilities: { hasEnums: true, hasFKs: true, hasComments: false, hasChecks: true, hasSchemas: false },
  });
}

function djangoOnDelete(raw: string | undefined): FkAction | null {
  if (raw === undefined) return null;
  const m = /models\.(\w+)/.exec(raw);
  switch (m?.[1]) {
    case 'CASCADE':
      return 'cascade';
    case 'PROTECT':
    case 'RESTRICT':
      return 'restrict';
    case 'SET_NULL':
      return 'set-null';
    case 'SET_DEFAULT':
      return 'set-default';
    case 'DO_NOTHING':
      return 'no-action';
    default:
      return null;
  }
}

function classifyPyDefault(raw: string): ColumnDefault {
  const arg = raw.trim();
  const str = stringLiteral(arg);
  if (str !== null) return { kind: 'literal', text: str };
  if (/^-?\d+(\.\d+)?$/.test(arg)) return { kind: 'literal', text: arg };
  if (arg === 'True' || arg === 'False') return { kind: 'literal', text: arg.toLowerCase() };
  if (arg === 'None') return null;
  if (/^(timezone\.now|datetime\.now|datetime\.datetime\.now)$/.test(arg)) return { kind: 'now' };
  if (/^uuid\.uuid4$/.test(arg)) return { kind: 'uuid' };
  if (/^(list|dict)$/.test(arg)) return { kind: 'expression', text: `${arg}()` };
  return { kind: 'expression', text: arg };
}

/** `[('a', 'Label A'), ('b', 'B')]` → ['a','b']; identifiers → null. */
function parseChoices(raw: string): string[] | null {
  const s = raw.trim();
  if (!s.startsWith('[') && !s.startsWith('(')) return null;
  const inner = s.slice(1, -1);
  const values: string[] = [];
  for (const item of splitTopLevel(inner, ',', PY_SCAN)) {
    const t = item.trim();
    if (!t.startsWith('(')) continue;
    const tupleInner = t.slice(1, t.endsWith(')') ? -1 : undefined);
    const first = splitTopLevel(tupleInner, ',', PY_SCAN)[0];
    if (first === undefined) continue;
    const lit = stringLiteral(first);
    if (lit !== null) values.push(lit);
    else if (/^-?\d+$/.test(first.trim())) values.push(first.trim());
  }
  return values;
}

function parseTupleList(raw: string): string[][] {
  const s = raw.trim();
  const inner = s.startsWith('[') || s.startsWith('(') ? s.slice(1, -1) : s;
  const groups: string[][] = [];
  const parts = splitTopLevel(inner, ',', PY_SCAN);
  if (parts.every((p) => stringLiteral(p) !== null)) {
    // single tuple: ('a', 'b')
    groups.push(parts.map((p) => stringLiteral(p) as string));
    return groups;
  }
  for (const part of parts) {
    const t = part.trim();
    if (!t.startsWith('(') && !t.startsWith('[')) continue;
    const tupleInner = t.slice(1, /[)\]]$/.test(t) ? -1 : undefined);
    const cols = splitTopLevel(tupleInner, ',', PY_SCAN)
      .map((c) => stringLiteral(c))
      .filter((c): c is string => c !== null);
    if (cols.length > 0) groups.push(cols);
  }
  return groups;
}

/* ------------------------------- model scanning ------------------------------- */

function scanModels(content: string): DjangoModel[] {
  const models: DjangoModel[] = [];
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    const classMatch = /^(\s*)class\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/.exec(line);
    if (!classMatch || !/\bmodels\.Model\b|\bModel\b/.test(classMatch[3] as string)) {
      i += 1;
      continue;
    }
    const indent = (classMatch[1] as string).length;
    const className = classMatch[2] as string;
    // Body: lines more indented than the class line.
    const bodyLines: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const bodyLine = lines[j] as string;
      if (bodyLine.trim().length === 0) {
        bodyLines.push(bodyLine);
        j += 1;
        continue;
      }
      const bodyIndent = bodyLine.length - bodyLine.trimStart().length;
      if (bodyIndent <= indent) break;
      bodyLines.push(bodyLine);
      j += 1;
    }
    i = j;

    const { fields, meta } = parseClassBody(bodyLines);
    const tableName = stringLiteral(meta['db_table'] ?? '') ?? snakeCase(className);
    models.push({
      className,
      tableName,
      explicitTable: stringLiteral(meta['db_table'] ?? '') !== null,
      fields,
      meta,
    });
  }
  return models;
}

function parseClassBody(bodyLines: string[]): { fields: DjangoField[]; meta: Record<string, string> } {
  const fields: DjangoField[] = [];
  const meta: Record<string, string> = {};
  let inMeta = false;
  let metaIndent = 0;
  let i = 0;
  while (i < bodyLines.length) {
    const raw = bodyLines[i] as string;
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) {
      i += 1;
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    if (inMeta && indent <= metaIndent) inMeta = false;

    const metaMatch = /^class\s+Meta\s*:/.exec(line);
    if (metaMatch) {
      inMeta = true;
      metaIndent = indent;
      i += 1;
      continue;
    }
    if (inMeta) {
      const kv = /^([a-z_]+)\s*=\s*(.+)$/.exec(line);
      if (kv) {
        let value = kv[2] as string;
        // Multi-line meta values (indexes = [...]) — join until balanced.
        while (!isBalanced(value) && i + 1 < bodyLines.length) {
          i += 1;
          value += '\n' + (bodyLines[i] as string).trim();
        }
        meta[kv[1] as string] = value.trim();
      }
      i += 1;
      continue;
    }

    const fieldMatch = /^([a-z_][a-z0-9_]*)\s*=\s*models\.([A-Za-z_]\w*)\s*\(/.exec(line);
    if (fieldMatch) {
      // Accumulate until the call's parens balance (choices lists span lines).
      let text = line;
      while (!isBalanced(text) && i + 1 < bodyLines.length) {
        i += 1;
        text += '\n' + (bodyLines[i] as string).trim();
      }
      const open = text.indexOf('(', text.indexOf(fieldMatch[2] as string));
      const close = findBalanced(text, open, PY_SCAN);
      const argText = close === -1 ? text.slice(open + 1) : text.slice(open + 1, close);
      fields.push({
        name: fieldMatch[1] as string,
        type: fieldMatch[2] as string,
        args: parseArgs(argText, 'python'),
      });
    }
    i += 1;
  }
  return { fields, meta };
}

function isBalanced(text: string): boolean {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) {
        if (text[j] === '\\') j += 1;
        j += 1;
      }
      i = j + 1;
      continue;
    }
    if (ch === '#') break;
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    i += 1;
  }
  return depth <= 0;
}
