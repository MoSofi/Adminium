// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TypeORM entity parser — 05-introspection-engine.md §5.2 row 4, tokenizer
 * level (no TS compiler): `@Entity` classes are located, class-level and
 * property-level decorators parsed with a balance-aware scanner. `@ManyToOne`
 * (+ optional `@JoinColumn`) becomes an FK column; when `@JoinColumn` is
 * absent, the snake_case `<prop>_id` convention is applied with a warning.
 * `@OneToMany` (inverse side) is skipped. Decorator options built from
 * spreads/variables are unresolvable and warn.
 */
import type { ColumnDefault, DatabaseModel, FkAction } from '@adminium/engine';

import { ModelBuilder, type ColumnDraft, type TableDraft } from '../builder.js';
import { SchemaImportError } from '../errors.js';
import { findBalanced, parseArgs, snakeCase, splitTopLevel, stringLiteral, stripComments } from '../text.js';
import { mapSqlType } from '../type-map.js';
import type { WarningList } from '../warnings.js';

const JS_SCAN = { backslashEscapes: true, lineComments: ['//'], blockComments: true } as const;

interface Decorator {
  name: string;
  args: string[];
}

interface PropertySite {
  decorators: Decorator[];
  propName: string;
  tsType: string | null;
}

interface EntitySite {
  className: string;
  tableName: string;
  explicitName: boolean;
  classDecorators: Decorator[];
  properties: PropertySite[];
}

interface PendingFk {
  table: TableDraft;
  column: ColumnDraft;
  targetClass: string;
  cardinality: 'one-to-many' | 'one-to-one';
  onDelete: FkAction | null;
  /** explicit referencedColumnName, else target pk */
  targetColumn: string | null;
}

export function parseTypeorm(content: string, name: string, warnings: WarningList): DatabaseModel {
  const source = stripComments(content, JS_SCAN);
  const builder = new ModelBuilder(warnings);

  // TS string enums declared in the same input.
  const tsEnums = new Map<string, string[]>();
  const enumRe = /(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)\s*\{/g;
  let em: RegExpExecArray | null;
  while ((em = enumRe.exec(source)) !== null) {
    const open = em.index + em[0].length - 1;
    const close = findBalanced(source, open, JS_SCAN);
    if (close === -1) continue;
    const body = source.slice(open + 1, close);
    const values: string[] = [];
    for (const member of splitTopLevel(body, ',', JS_SCAN)) {
      const withValue = /^[A-Za-z_$][\w$]*\s*=\s*(['"][\s\S]*['"])$/.exec(member.trim());
      if (withValue) {
        const lit = stringLiteral(withValue[1] as string);
        if (lit !== null) values.push(lit);
        continue;
      }
      const bare = /^([A-Za-z_$][\w$]*)$/.exec(member.trim());
      if (bare) values.push(bare[1] as string);
    }
    if (values.length > 0) tsEnums.set(em[1] as string, values);
  }

  const entities = scanEntities(source, warnings);
  if (entities.length === 0) {
    throw new SchemaImportError('no @Entity classes found in input');
  }

  const classToTable = new Map<string, TableDraft>();
  const pendingFks: PendingFk[] = [];

  for (const entity of entities) {
    if (!entity.explicitName) {
      warnings.add(
        'naming-assumed',
        `entity "${entity.className}" has no explicit table name; assumed snake_case "${entity.tableName}"`,
      );
    }
    const table = builder.addTable({ name: entity.tableName });
    classToTable.set(entity.className, table);

    for (const deco of entity.classDecorators) {
      if (deco.name === 'Index') {
        const columns = listOfStrings(deco.args.find((a) => a.trimStart().startsWith('[')) ?? '');
        const idxName = stringLiteral(deco.args[0] ?? '') ?? `${entity.tableName}_${columns.join('_')}_idx`;
        if (columns.length > 0) table.indexes.push({ name: idxName, columns });
      } else if (deco.name === 'Unique') {
        const columns = listOfStrings(deco.args.find((a) => a.trimStart().startsWith('[')) ?? '');
        if (columns.length > 0) table.uniques.push({ name: stringLiteral(deco.args[0] ?? ''), columns });
      }
    }

    for (const prop of entity.properties) {
      parseProperty(prop, entity, table, builder, tsEnums, pendingFks, warnings);
    }
  }

  // Resolve @ManyToOne/@OneToOne FK column types + targets.
  for (const fk of pendingFks) {
    const target = classToTable.get(fk.targetClass);
    if (!target) {
      warnings.add(
        'unresolved-reference',
        `relation from "${fk.table.name}"."${fk.column.name}" to entity "${fk.targetClass}" not in input`,
      );
      continue;
    }
    const pkName = fk.targetColumn ?? target.primaryKey[0] ?? target.columns.find((c) => c.isPrimaryKey)?.name ?? 'id';
    const pkCol = target.columns.find((c) => c.name === pkName);
    if (pkCol && fk.column.logicalType === undefined) {
      fk.column.logicalType = pkCol.logicalType ?? 'integer';
      fk.column.dbType = pkCol.dbType ?? 'integer';
    }
    fk.table.columns.push(fk.column);
    fk.column.references = {
      table: target.name,
      column: pkName,
      onDelete: fk.onDelete,
      cardinality: fk.cardinality === 'one-to-one' ? 'one-to-one' : undefined,
    };
  }

  return builder.finalize({
    format: 'typeorm',
    dialect: 'generic',
    name,
    capabilities: { hasEnums: true, hasFKs: true, hasComments: true, hasChecks: false, hasSchemas: false },
  });
}

function parseProperty(
  prop: PropertySite,
  entity: EntitySite,
  table: TableDraft,
  builder: ModelBuilder,
  tsEnums: ReadonlyMap<string, string[]>,
  pendingFks: PendingFk[],
  warnings: WarningList,
): void {
  const find = (n: string): Decorator | undefined => prop.decorators.find((d) => d.name === n);

  const manyToOne = find('ManyToOne');
  const oneToOne = find('OneToOne');
  if (manyToOne || oneToOne) {
    const deco = (manyToOne ?? oneToOne) as Decorator;
    const target = extractRelationTarget(deco.args[0] ?? '');
    if (target === null) {
      warnings.add('unresolved-reference', `could not resolve relation target on "${entity.className}.${prop.propName}"`);
      return;
    }
    const optsArg = deco.args.find((a) => a.trimStart().startsWith('{'));
    const opts = optsArg !== undefined ? parseArgs(stripBraces(optsArg), 'js').named : {};
    const joinColumn = find('JoinColumn');
    if (oneToOne && !joinColumn) return; // inverse side of a OneToOne
    let columnName: string | null = null;
    let targetColumn: string | null = null;
    if (joinColumn) {
      const jcArg = joinColumn.args.find((a) => a.trimStart().startsWith('{') || a.trimStart().startsWith('['));
      if (jcArg !== undefined) {
        const jcOpts = parseArgs(stripBraces(jcArg.replace(/^\s*\[/, '').replace(/\]\s*$/, '')), 'js').named;
        columnName = stringLiteral(jcOpts['name'] ?? '') ?? null;
        targetColumn = stringLiteral(jcOpts['referencedColumnName'] ?? '') ?? null;
      }
    }
    if (columnName === null) {
      columnName = `${snakeCase(prop.propName)}_id`;
      warnings.add(
        'naming-assumed',
        `@JoinColumn absent on "${entity.className}.${prop.propName}"; assumed FK column "${columnName}"`,
      );
    }
    const nullable = opts['nullable'] !== 'false'; // relations default to nullable
    const col: ColumnDraft = { name: columnName, nullable };
    pendingFks.push({
      table,
      column: col,
      targetClass: target,
      cardinality: oneToOne ? 'one-to-one' : 'one-to-many',
      onDelete: fkActionFromString(opts['onDelete']),
      targetColumn,
    });
    return;
  }
  if (find('OneToMany') || find('ManyToMany')) {
    // Inverse / join-table side: @OneToMany skipped by design; @ManyToMany
    // needs the owning side's @JoinTable which we do not model in v1.
    if (find('ManyToMany')) warnings.addCount('skipped-relation', 'skipped @ManyToMany relation');
    return;
  }

  const generated = find('PrimaryGeneratedColumn');
  const primary = find('PrimaryColumn');
  const created = find('CreateDateColumn');
  const updated = find('UpdateDateColumn');
  const deleted = find('DeleteDateColumn');
  const version = find('VersionColumn');
  const column = find('Column');
  if (!generated && !primary && !created && !updated && !deleted && !version && !column) return;

  const deco = (column ?? generated ?? primary ?? created ?? updated ?? deleted ?? version) as Decorator;
  const optsArg = deco.args.find((a) => a.trimStart().startsWith('{'));
  if (deco.args.some((a) => a.includes('...'))) {
    warnings.add('unsupported-options', `decorator options with spread on "${entity.className}.${prop.propName}" ignored`);
  }
  const opts = optsArg !== undefined ? parseArgs(stripBraces(optsArg), 'js').named : {};
  const typeArg = stringLiteral(deco.args[0] ?? '') ?? stringLiteral(opts['type'] ?? '');

  const col: ColumnDraft = {
    name: stringLiteral(opts['name'] ?? '') ?? prop.propName,
    nullable: opts['nullable'] === 'true',
  };

  if (generated) {
    col.isPrimaryKey = true;
    col.nullable = false;
    const strategy = stringLiteral(deco.args[0] ?? '') ?? 'increment';
    if (strategy === 'uuid') {
      col.logicalType = 'uuid';
      col.dbType = 'uuid';
      col.default = { kind: 'uuid' };
    } else {
      col.logicalType = 'integer';
      col.dbType = 'integer';
      col.default = { kind: 'autoincrement' };
    }
  } else if (created || updated || deleted) {
    col.logicalType = 'timestamp';
    col.dbType = typeArg ?? 'timestamp';
    col.nullable = deleted !== undefined;
    if (created) col.default = { kind: 'now' };
  } else if (version) {
    col.logicalType = 'integer';
    col.dbType = 'integer';
    col.nullable = false;
  } else {
    if (primary) {
      col.isPrimaryKey = true;
      col.nullable = false;
    }
    // Type: explicit SQL type string, `enum`, or inferred from the TS type.
    const enumOpt = opts['enum'];
    if (typeArg === 'enum' || enumOpt !== undefined) {
      const values = resolveEnumValues(enumOpt ?? '', tsEnums);
      if (values !== null && values.length > 0) {
        const id = `public.${table.name}.${col.name}`;
        builder.addEnum({ id, name: col.name, values, source: 'import' });
        col.logicalType = 'enum';
        col.dbType = 'enum';
        col.enumRef = id;
      } else {
        warnings.add(
          'unresolved-enum',
          `enum values for "${entity.className}.${prop.propName}" could not be resolved statically`,
        );
        col.logicalType = 'text';
        col.dbType = 'enum';
      }
    } else if (typeArg !== null) {
      const mapped = mapSqlType(typeArg);
      col.dbType = typeArg;
      col.logicalType = mapped.logicalType;
      col.maxLength = mapped.maxLength;
      col.numericPrecision = mapped.numericPrecision;
      col.numericScale = mapped.numericScale;
    } else {
      const inferred = inferFromTsType(prop.tsType);
      col.logicalType = inferred.logicalType;
      col.dbType = inferred.dbType;
    }
  }

  const length = Number.parseInt(opts['length']?.replaceAll(/['"]/g, '') ?? '', 10);
  if (Number.isFinite(length)) {
    col.maxLength = length;
    col.dbType = `${col.dbType}(${length})`;
  }
  const precision = Number.parseInt(opts['precision'] ?? '', 10);
  if (Number.isFinite(precision)) col.numericPrecision = precision;
  const scale = Number.parseInt(opts['scale'] ?? '', 10);
  if (Number.isFinite(scale)) col.numericScale = scale;
  if (opts['unique'] === 'true') col.isUnique = true;
  if (opts['array'] === 'true') col.isArray = true;
  if (opts['comment'] !== undefined) col.comment = stringLiteral(opts['comment']);
  if (opts['default'] !== undefined) col.default = classifyJsDefault(opts['default']);
  if (opts['generated'] !== undefined && opts['generated'] !== 'false') {
    col.default = { kind: 'autoincrement' };
  }

  table.columns.push(col);

  const index = find('Index');
  if (index) {
    const idxName = stringLiteral(index.args[0] ?? '') ?? `${table.name}_${col.name}_idx`;
    const idxOptsArg = index.args.find((a) => a.trimStart().startsWith('{'));
    const idxOpts = idxOptsArg !== undefined ? parseArgs(stripBraces(idxOptsArg), 'js').named : {};
    table.indexes.push({ name: idxName, columns: [col.name], unique: idxOpts['unique'] === 'true' });
  }
  const generatedDeco = find('Generated');
  if (generatedDeco) col.default = { kind: 'autoincrement' };
}

function inferFromTsType(tsType: string | null): { logicalType: ColumnDraft['logicalType']; dbType: string } {
  const t = (tsType ?? '').replace(/\s*\|\s*null\s*$/, '').trim();
  switch (t) {
    case 'string':
      return { logicalType: 'varchar', dbType: 'varchar' };
    case 'number':
      return { logicalType: 'integer', dbType: 'integer' };
    case 'boolean':
      return { logicalType: 'boolean', dbType: 'boolean' };
    case 'Date':
      return { logicalType: 'timestamp', dbType: 'timestamp' };
    default:
      return { logicalType: 'unknown', dbType: t.length > 0 ? t : 'unknown' };
  }
}

function resolveEnumValues(enumOpt: string, tsEnums: ReadonlyMap<string, string[]>): string[] | null {
  const raw = enumOpt.trim();
  if (raw.length === 0) return null;
  if (raw.startsWith('[')) {
    const inner = raw.slice(1, raw.endsWith(']') ? -1 : undefined);
    const values = splitTopLevel(inner, ',', JS_SCAN)
      .map((v) => stringLiteral(v) ?? v.trim())
      .filter((v) => v.length > 0);
    return values;
  }
  if (/^[A-Za-z_$][\w$]*$/.test(raw)) return tsEnums.get(raw) ?? null;
  return null;
}

function classifyJsDefault(raw: string): ColumnDefault {
  const arg = raw.trim();
  const str = stringLiteral(arg);
  if (str !== null) return { kind: 'literal', text: str };
  if (/^-?\d+(\.\d+)?$/.test(arg) || arg === 'true' || arg === 'false') {
    return { kind: 'literal', text: arg };
  }
  if (/^\(\s*\)\s*=>/.test(arg)) {
    const body = arg.replace(/^\(\s*\)\s*=>\s*/, '');
    const lit = stringLiteral(body);
    if (lit !== null) {
      if (/current_timestamp|now\(\)/i.test(lit)) return { kind: 'now' };
      return { kind: 'expression', text: lit };
    }
    return { kind: 'expression', text: body };
  }
  return { kind: 'expression', text: arg };
}

function fkActionFromString(raw: string | undefined): FkAction | null {
  const value = raw === undefined ? null : stringLiteral(raw);
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

function extractRelationTarget(arg: string): string | null {
  const arrow = /=>\s*([A-Za-z_$][\w$]*)/.exec(arg);
  if (arrow) return arrow[1] as string;
  const str = stringLiteral(arg);
  if (str !== null) return str;
  return null;
}

function stripBraces(objectLiteral: string): string {
  const s = objectLiteral.trim();
  return s.startsWith('{') && s.endsWith('}') ? s.slice(1, -1) : s;
}

function listOfStrings(arrayLiteral: string): string[] {
  const s = arrayLiteral.trim();
  if (!s.startsWith('[')) return [];
  const inner = s.slice(1, s.endsWith(']') ? -1 : undefined);
  return splitTopLevel(inner, ',', JS_SCAN)
    .map((v) => stringLiteral(v))
    .filter((v): v is string => v !== null);
}

/* ------------------------------ entity scanning ------------------------------ */

function scanEntities(source: string, warnings: WarningList): EntitySite[] {
  const entities: EntitySite[] = [];
  // The regex used to end `[^{]*\{`, which overlapped the `[\w$]*` of the class
  // name (both match `$`), making `class $$$$…` quadratic — CodeQL
  // js/polynomial-redos alert #18, ~0.6s for a 20 KB run of `$`. The brace is
  // now located with a linear `indexOf`, which finds exactly the same character:
  // `[^{]*` could not cross a `{`, so it always stopped at the first one after
  // the (greedily matched, never usefully shortened) class name.
  const classRe = /(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g;
  let prevEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(source)) !== null) {
    const braceIndex = source.indexOf('{', m.index + m[0].length);
    // No `{` left in the file — no later `class` could have matched either.
    if (braceIndex === -1) break;
    const bodyEnd = findBalanced(source, braceIndex, JS_SCAN);
    if (bodyEnd === -1) {
      // Resume where the old pattern left off: just past the unbalanced brace.
      classRe.lastIndex = braceIndex + 1;
      continue;
    }
    const before = source.slice(prevEnd, m.index);
    prevEnd = bodyEnd + 1;
    classRe.lastIndex = bodyEnd + 1;

    const classDecorators = scanDecorators(before, true);
    const entityDeco = classDecorators.find((d) => d.name === 'Entity');
    if (!entityDeco) continue;

    const className = m[1] as string;
    let tableName: string | null = stringLiteral(entityDeco.args[0] ?? '');
    if (tableName === null) {
      const optsArg = entityDeco.args.find((a) => a.trimStart().startsWith('{'));
      if (optsArg !== undefined) {
        tableName = stringLiteral(parseArgs(stripBraces(optsArg), 'js').named['name'] ?? '');
      }
    }
    const explicitName = tableName !== null;
    entities.push({
      className,
      tableName: tableName ?? snakeCase(className),
      explicitName,
      classDecorators: classDecorators.filter((d) => d.name !== 'Entity'),
      properties: scanProperties(source.slice(braceIndex + 1, bodyEnd), warnings),
    });
  }
  return entities;
}

/** Scan decorators in `text`; when `tail` is true, only those after the last statement end. */
function scanDecorators(text: string, tail: boolean): Decorator[] {
  const region = tail ? text.slice(Math.max(text.lastIndexOf(';'), text.lastIndexOf('}')) + 1) : text;
  const decorators: Decorator[] = [];
  const re = /@([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(region)) !== null) {
    const afterName = m.index + m[0].length;
    let args: string[] = [];
    if (region[afterName] === '(') {
      const close = findBalanced(region, afterName, JS_SCAN);
      if (close !== -1) {
        args = splitTopLevel(region.slice(afterName + 1, close), ',', JS_SCAN);
        re.lastIndex = close + 1;
      }
    }
    decorators.push({ name: m[1] as string, args });
  }
  return decorators;
}

function scanProperties(body: string, warnings: WarningList): PropertySite[] {
  const properties: PropertySite[] = [];
  let pending: Decorator[] = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i] as string;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '@') {
      const m = /^@([A-Za-z_$][\w$]*)/.exec(body.slice(i));
      if (m) {
        let args: string[] = [];
        let next = i + m[0].length;
        if (body[next] === '(') {
          const close = findBalanced(body, next, JS_SCAN);
          if (close !== -1) {
            args = splitTopLevel(body.slice(next + 1, close), ',', JS_SCAN);
            next = close + 1;
          }
        }
        pending.push({ name: m[1] as string, args });
        i = next;
        continue;
      }
    }
    // Property or method signature up to `;` or `{`.
    const stmtEnd = findStatementEnd(body, i);
    const stmt = body.slice(i, stmtEnd.end);
    if (pending.length > 0 && !stmtEnd.isMethod) {
      const pm = /^(?:public\s+|private\s+|protected\s+|readonly\s+)*([A-Za-z_$][\w$]*)\s*[?!]?\s*(?::\s*([^;=]+))?/.exec(
        stmt.trim(),
      );
      if (pm) {
        properties.push({
          decorators: pending,
          propName: pm[1] as string,
          tsType: pm[2]?.trim() ?? null,
        });
      } else {
        warnings.addCount('unparseable-property', 'skipped unparseable decorated class member');
      }
    }
    pending = [];
    i = stmtEnd.end + 1;
  }
  return properties;
}

function findStatementEnd(body: string, start: number): { end: number; isMethod: boolean } {
  let i = start;
  while (i < body.length) {
    const skipped = skipJsAtom(body, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const ch = body[i];
    if (ch === ';' || ch === '\n') return { end: i, isMethod: false };
    if (ch === '(') {
      // method signature — skip its parens, then its body if present
      const close = findBalanced(body, i, JS_SCAN);
      if (close === -1) return { end: body.length, isMethod: true };
      let j = close + 1;
      while (j < body.length && /\s|:|[A-Za-z_$<>[\]|,.]/.test(body[j] as string)) j += 1;
      if (body[j] === '{') {
        const bodyClose = findBalanced(body, j, JS_SCAN);
        return { end: bodyClose === -1 ? body.length : bodyClose, isMethod: true };
      }
      return { end: j, isMethod: true };
    }
    if (ch === '{') {
      const close = findBalanced(body, i, JS_SCAN);
      i = close === -1 ? body.length : close + 1;
      continue;
    }
    i += 1;
  }
  return { end: body.length, isMethod: false };
}

function skipJsAtom(body: string, i: number): number {
  const ch = body[i];
  if (ch === "'" || ch === '"' || ch === '`') {
    let j = i + 1;
    while (j < body.length) {
      if (body[j] === '\\') {
        j += 2;
        continue;
      }
      if (body[j] === ch) return j + 1;
      j += 1;
    }
    return body.length;
  }
  if (body.startsWith('//', i)) {
    const nl = body.indexOf('\n', i);
    return nl === -1 ? body.length : nl;
  }
  if (body.startsWith('/*', i)) {
    const end = body.indexOf('*/', i + 2);
    return end === -1 ? body.length : end + 2;
  }
  return i;
}
