// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Export Builder's DRAFT — the ordered column list, the measures the
 * folds and counts are, the calculated fields, the format and row-scope
 * settings — and the rules that shape it. Pure TypeScript: the steps render
 * it, this decides it.
 *
 * WHAT IS STORED (D1). `toSource` writes a page-config-shaped body: every
 * column as a `gridColumnSpec` INPUT (`name`, `label`, and `lookup` /
 * `reverse` / `derived` for a projection), the folds and counts authored here
 * as MEASURES in `derived.measures`, the calculated columns as FIELDS in
 * `derived.fields`. A count authored here is a `count` measure rather than the
 * Studio's legacy `reverse` block, so a rule can read it (`{measure}`); a
 * count COPIED from a page keeps its `reverse` block and stays as it was.
 *
 * HEADERS (D4) follow the comp's script (692-712): first letter up,
 * underscores as spaces, a trailing `id` read as "ID"; a linked value is
 * "<Singular> <column>"; a count is "<Table> count"; a fold is "Sum of <col>".
 *
 * BUDGETS (D9, D11) are the server's, per family: 12 linked columns, 12
 * counts + folds, 8 calculated — the two caps the comp drew as one are two.
 */
import {
  DECIMAL_LITERAL_PATTERN,
  MAX_DERIVED_FIELDS,
  gridColumnSpecSchema,
  parseCrudDerived,
  type CrudDerivedConfig,
  type DerivedField,
  type FieldExpr,
  type Measure,
  type MeasureFn,
} from '@adminium/engine/config';
import { humanize } from '@adminium/widgets/generate';

import type { SchemaColumn, SchemaReply, SchemaTable } from '../../studio/api.js';
import {
  addableColumns,
  displayableColumns,
  findTable,
  fkColumns,
  inboundLinks,
  lookupAliasFor,
  numericColumns,
  type InboundLink,
} from '../../studio/pages/columnSpecBuilder.js';
import type { ExportColumnDef, ExportSavedViewDto, ExportSource } from '../api.js';
import { FOLD_HEADER_WORD, copy, type BadgeKind } from './copy.js';

export const MAX_LINKED = 12;
export const MAX_TOTALS = 12;
export const MAX_CALCULATED = MAX_DERIVED_FIELDS;
export const MAX_FACTORS = 4;
export const MAX_HOPS = 3;

export type DraftKind = 'base' | 'linked' | 'count' | 'fold' | 'calc';

export interface DraftColumn {
  /** Dedupe key: `b:table.col`, `l:path:table.col`, `a:fn:table:cols`, `c:…` (comp 702-714). */
  id: string;
  kind: DraftKind;
  /** The header written to the file — editable. */
  header: string;
  /** The mono caption under it (comp `src`). */
  source: string;
  /** The type chip. */
  type: string;
  masked: boolean;
  readOnly: boolean;
  numeric: boolean;
  badges: BadgeKind[];
  /** The stored column, label filled in at `toSource`. */
  spec: Omit<ExportColumnDef, 'label'>;
}

export interface Draft {
  columns: DraftColumn[];
  measures: Measure[];
  fields: DerivedField[];
}

export const EMPTY_DRAFT: Draft = { columns: [], measures: [], fields: [] };

const NUMERIC_TYPES: ReadonlySet<string> = new Set(['integer', 'bigint', 'decimal', 'float']);

// ---------------------------------------------------------------------------
// Headers (D4)
// ---------------------------------------------------------------------------

/** `contact_name` → "Contact name", `client_id` → "Client ID", `id` → "ID". */
export function sentence(name: string): string {
  const words = name.split(/[_\s-]+/).filter((word) => word.length > 0);
  return words
    .map((word, index) => {
      if (word.toLowerCase() === 'id') return 'ID';
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(' ');
}

/** The table's display label — the override's, else the humanized name. */
export function tableLabel(table: Pick<SchemaTable, 'name' | 'label'>): string {
  return table.label ?? humanize(table.name);
}

/** "Clients" → "Client", the comp's rule (701): a trailing `s` comes off. */
export function singular(label: string): string {
  return label.replace(/s$/, '');
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Column factories (comp 702-714)
// ---------------------------------------------------------------------------

function isPii(column: SchemaColumn): boolean {
  const pii = column.semantics?.flags?.pii;
  return typeof pii === 'string' && pii.length > 0;
}

function baseBadges(column: SchemaColumn): BadgeKind[] {
  return [
    ...(column.isPrimaryKey === true ? (['key'] as const) : []),
    ...(column.isGenerated === true ? (['calculated'] as const) : []),
    ...(isPii(column) ? (['masked'] as const) : []),
  ];
}

export function mkBase(table: SchemaTable, column: SchemaColumn): DraftColumn {
  return {
    id: `b:${table.id}.${column.name}`,
    kind: 'base',
    header: sentence(column.name),
    source: `${table.name}.${column.name}`,
    type: column.logicalType,
    masked: isPii(column),
    readOnly: column.isPrimaryKey === true || column.isGenerated === true,
    numeric: NUMERIC_TYPES.has(column.logicalType),
    badges: baseBadges(column),
    spec: { name: column.name },
  };
}

export interface LinkHop {
  /** The FK column followed. */
  via: string;
  /** The table reached. */
  table: SchemaTable;
}

export function mkLinked(
  path: readonly LinkHop[],
  target: SchemaColumn,
  taken: ReadonlySet<string>,
): DraftColumn {
  const reached = path[path.length - 1] as LinkHop;
  const vias = path.map((hop) => hop.via);
  return {
    id: `l:${vias.join('→')}:${reached.table.id}.${target.name}`,
    kind: 'linked',
    header: `${singular(tableLabel(reached.table))} ${sentence(target.name).toLowerCase()}`,
    source: copy.genLinkedSrc(reached.table.name, target.name, vias.join(' → ')),
    type: target.logicalType,
    masked: isPii(target),
    readOnly: target.isPrimaryKey === true || target.isGenerated === true,
    numeric: NUMERIC_TYPES.has(target.logicalType),
    badges: ['linked', ...(isPii(target) ? (['masked'] as const) : [])],
    spec: {
      name: lookupAliasFor(vias, target.name, taken),
      lookup: { path: [...vias], select: target.name },
    },
  };
}

export interface CountAuthored {
  column: DraftColumn;
  measure: Measure;
}

export function mkCount(link: InboundLink, taken: ReadonlySet<string>): CountAuthored {
  const id = lookupAliasFor([link.table.name], 'count', taken);
  return {
    column: {
      id: `a:count:${link.table.id}:${link.column.name}`,
      kind: 'count',
      header: copy.genCount(tableLabel(link.table)),
      source: copy.genCountSrc(link.table.name, link.column.name),
      type: 'integer',
      masked: false,
      readOnly: true,
      numeric: true,
      badges: ['count'],
      spec: { name: id, derived: { ref: id } },
    },
    measure: { id, table: link.table.id, fkColumn: link.column.name, fn: 'count' },
  };
}

export function mkFold(
  link: InboundLink,
  fn: Exclude<MeasureFn, 'count'>,
  factors: readonly SchemaColumn[],
  taken: ReadonlySet<string>,
): CountAuthored {
  const names = factors.map((column) => column.name);
  const id = lookupAliasFor([link.table.name], names[0] ?? fn, taken);
  const words = names.map((name) => sentence(name).toLowerCase()).join(' × ');
  return {
    column: {
      id: `a:${fn}:${link.table.id}:${names.join('*')}`,
      kind: 'fold',
      header: capitalize(`${FOLD_HEADER_WORD[fn]()} ${words}`),
      source: copy.genFoldSrc(fn, link.table.name, names.join(' × ')),
      type: 'numeric',
      masked: false,
      readOnly: true,
      numeric: true,
      badges: [fn],
      spec: { name: id, derived: { ref: id } },
    },
    measure: {
      id,
      table: link.table.id,
      fkColumn: link.column.name,
      fn,
      of: { terms: [{ sign: 'plus', factors: names }] },
    },
  };
}

export interface CalcAuthored {
  column: DraftColumn;
  field: DerivedField;
}

function mkCalc(id: string, header: string, source: string, numeric: boolean, field: DerivedField): CalcAuthored {
  return {
    column: {
      id: `c:${id}`,
      kind: 'calc',
      header,
      source,
      type: numeric ? 'numeric' : 'text',
      masked: false,
      readOnly: true,
      numeric,
      badges: ['calculated'],
      spec: { name: id, derived: { ref: id } },
    },
    field,
  };
}

// ---------------------------------------------------------------------------
// Operands (D10): base numeric columns, the folds and counts authored here,
// and earlier numeric calculations — never a linked value.
// ---------------------------------------------------------------------------

export interface Operand {
  /** The draft column shown in the select. */
  column: DraftColumn;
  expr: FieldExpr;
}

export function operandsOf(draft: Draft): Operand[] {
  const measureIds = new Set(draft.measures.map((measure) => measure.id));
  const decimalFields = new Set(draft.fields.filter((field) => field.result !== 'text').map((field) => field.id));
  const out: Operand[] = [];
  for (const column of draft.columns) {
    if (!column.numeric) continue;
    if (column.kind === 'base') out.push({ column, expr: { col: column.spec.name } });
    else if ((column.kind === 'count' || column.kind === 'fold') && measureIds.has(column.spec.name)) {
      out.push({ column, expr: { measure: column.spec.name } });
    } else if (column.kind === 'calc' && decimalFields.has(column.spec.name)) {
      out.push({ column, expr: { field: column.spec.name } });
    }
  }
  return out;
}

function calcId(prefix: string, taken: ReadonlySet<string>): string {
  return lookupAliasFor([prefix], 'calc', taken).replace(/__calc$/, '');
}

/** "5,000" → "5000"; null when the leaf's literal grammar would refuse it. */
export function decimalLiteral(text: string): string | null {
  const bare = text.replaceAll(/[,\s]/g, '');
  return DECIMAL_LITERAL_PATTERN.test(bare) ? bare : null;
}

export function mkArith(a: Operand, op: '+' | '−', b: Operand, taken: ReadonlySet<string>): CalcAuthored {
  const id = calcId(`${a.column.spec.name}_${op === '+' ? 'plus' : 'minus'}_${b.column.spec.name}`, taken);
  return mkCalc(
    id,
    copy.genArithHeader(a.column.header, op, b.column.header),
    copy.genArithHeader(a.column.header.toLowerCase(), op, b.column.header.toLowerCase()),
    true,
    { id, scale: 2, expr: { op: op === '+' ? 'add' : 'sub', args: [a.expr, b.expr] } },
  );
}

export function mkPercent(pct: string, a: Operand, taken: ReadonlySet<string>): CalcAuthored | null {
  const literal = decimalLiteral(pct);
  if (literal === null) return null;
  const id = calcId(`pct_${literal.replace('.', '_')}_of_${a.column.spec.name}`, taken);
  return mkCalc(
    id,
    copy.genPctHeader(pct, a.column.header),
    copy.genPctHeader(pct, a.column.header.toLowerCase()),
    true,
    {
      id,
      scale: 2,
      expr: { op: 'mul', args: [a.expr, { op: 'div', args: [{ lit: literal }, { lit: '100' }] }] },
    },
  );
}

export function mkRule(
  a: Operand,
  threshold: string,
  then: string,
  otherwise: string,
  taken: ReadonlySet<string>,
): CalcAuthored | null {
  const literal = decimalLiteral(threshold);
  if (literal === null || then.trim().length === 0 || otherwise.trim().length === 0) return null;
  const id = calcId(`rule_${a.column.spec.name}`, taken);
  return mkCalc(
    id,
    copy.genRuleHeader(then.trim(), otherwise.trim()),
    copy.genRuleSrc(a.column.header, threshold, then.trim(), otherwise.trim()),
    false,
    {
      id,
      scale: 0,
      result: 'text',
      expr: {
        cases: [{ when: { left: a.expr, cmp: 'gt', right: { lit: literal } }, then: { text: then.trim() } }],
        else: { text: otherwise.trim() },
      },
    },
  );
}

// ---------------------------------------------------------------------------
// The draft's rules
// ---------------------------------------------------------------------------

/** Every stored name and alias the draft has claimed — one namespace. */
export function takenNames(draft: Draft): Set<string> {
  return new Set([
    ...draft.columns.map((column) => column.spec.name),
    ...draft.measures.map((measure) => measure.id),
    ...draft.fields.map((field) => field.id),
  ]);
}

export function linkedCount(draft: Draft): number {
  return draft.columns.filter((column) => column.kind === 'linked').length;
}

export function totalsCount(draft: Draft): number {
  return draft.columns.filter((column) => column.kind === 'count' || column.kind === 'fold').length;
}

export function calculatedCount(draft: Draft): number {
  return draft.columns.filter((column) => column.kind === 'calc').length;
}

/** Headers that collide, case- and whitespace-insensitively (comp 918-920). */
export function duplicateHeaders(draft: Draft): Set<string> {
  const counts = new Map<string, number>();
  for (const column of draft.columns) {
    const key = column.header.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([key]) => key));
}

export type AddOutcome = { ok: true; draft: Draft } | { ok: false; reason: 'already' | 'limit' | 'refused'; message?: string };

/**
 * Add one authored column, its measure or field alongside, under the comp's
 * three outcomes (731-737): already in the file, over the family's budget, or
 * added. A calculated column is also run through the shipped parser first
 * (the Studio card's rule): a block a read would refuse is never authored.
 */
export function addColumn(
  draft: Draft,
  column: DraftColumn,
  extra: { measure?: Measure | undefined; field?: DerivedField | undefined } = {},
  baseColumnNames: readonly string[] = [],
): AddOutcome {
  if (draft.columns.some((existing) => existing.id === column.id)) return { ok: false, reason: 'already' };
  if (column.kind === 'linked' && linkedCount(draft) >= MAX_LINKED) return { ok: false, reason: 'limit' };
  if ((column.kind === 'count' || column.kind === 'fold') && totalsCount(draft) >= MAX_TOTALS) {
    return { ok: false, reason: 'limit' };
  }
  if (column.kind === 'calc' && calculatedCount(draft) >= MAX_CALCULATED) return { ok: false, reason: 'limit' };

  const measures = extra.measure === undefined ? draft.measures : [...draft.measures, extra.measure];
  const fields = extra.field === undefined ? draft.fields : [...draft.fields, extra.field];
  if (extra.measure !== undefined || extra.field !== undefined) {
    const parsed = parseCrudDerived(
      { measures, fields },
      {
        columns: baseColumnNames,
        takenAliases: draft.columns
          .filter((existing) => existing.kind === 'linked' || existing.spec.reverse !== undefined)
          .map((existing) => existing.spec.name),
      },
    );
    if (!parsed.ok) return { ok: false, reason: 'refused', message: parsed.refusal.message };
  }
  return { ok: true, draft: { columns: [...draft.columns, column], measures, fields } };
}

/** Remove a column and, with it, the measure or field nothing else references. */
export function removeColumn(draft: Draft, id: string): Draft {
  const column = draft.columns.find((existing) => existing.id === id);
  if (column === undefined) return draft;
  const columns = draft.columns.filter((existing) => existing.id !== id);
  const ref = column.spec.derived?.ref;
  return {
    columns,
    measures: ref === undefined ? draft.measures : draft.measures.filter((measure) => measure.id !== ref),
    fields: ref === undefined ? draft.fields : draft.fields.filter((field) => field.id !== ref),
  };
}

export function setHeader(draft: Draft, id: string, header: string): Draft {
  return {
    ...draft,
    columns: draft.columns.map((column) => (column.id === id ? { ...column, header } : column)),
  };
}

export function moveColumn(draft: Draft, id: string, direction: -1 | 1): Draft {
  const index = draft.columns.findIndex((column) => column.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= draft.columns.length) return draft;
  const columns = [...draft.columns];
  const [moved] = columns.splice(index, 1);
  columns.splice(target, 0, moved as DraftColumn);
  return { ...draft, columns };
}

/** Drop `id` before (or after) `overId` — the comp's `dropOn` (747-757). */
export function dropColumn(draft: Draft, id: string, overId: string, before: boolean): Draft {
  if (id === overId) return draft;
  const columns = [...draft.columns];
  const from = columns.findIndex((column) => column.id === id);
  if (from < 0) return draft;
  const [moved] = columns.splice(from, 1);
  const to = columns.findIndex((column) => column.id === overId);
  if (to < 0) return draft;
  columns.splice(before ? to : to + 1, 0, moved as DraftColumn);
  return { ...draft, columns };
}

// ---------------------------------------------------------------------------
// Starting points
// ---------------------------------------------------------------------------

/** Every non-secret column of the table, in ordinal order (comp `defaultCols`). */
export function defaultDraft(table: SchemaTable): Draft {
  return { columns: addableColumns(table, new Set()).map((column) => mkBase(table, column)), measures: [], fields: [] };
}

/**
 * The columns of a page's stored body, rebuilt as a draft (comp `pageCols`):
 * the page's own labels, its lookups, its counts (kept as `reverse`), its
 * measures and fields. Hidden columns are left out — a file of what the page
 * shows (a fill: the comp draws no hidden column).
 */
export function draftFromPage(body: Record<string, unknown>, schema: SchemaReply, table: SchemaTable): Draft {
  const parsedDerived = parseCrudDerived(body['derived']);
  const derived: CrudDerivedConfig = parsedDerived.ok ? parsedDerived.value : { measures: [], fields: [] };
  const raw = Array.isArray(body['columns']) ? (body['columns'] as unknown[]) : [];
  const columns: ExportColumnDef[] = [];
  for (const entry of raw) {
    const parsed = gridColumnSpecSchema.safeParse(entry);
    if (!parsed.success || parsed.data.hidden) continue;
    columns.push({
      name: parsed.data.name,
      label: parsed.data.label,
      ...(parsed.data.lookup === undefined ? {} : { lookup: parsed.data.lookup }),
      ...(parsed.data.reverse === undefined || parsed.data.reverse.agg !== 'count'
        ? {}
        : { reverse: { table: parsed.data.reverse.table, fkColumn: parsed.data.reverse.fkColumn, agg: 'count' as const } }),
      ...(parsed.data.derived === undefined ? {} : { derived: parsed.data.derived }),
    });
  }
  return draftFromSource({ kind: 'table', table: table.id, columns, derived }, schema, table);
}

/** A stored definition (a finished export's, or a page's) rebuilt as a draft. */
export function draftFromSource(source: ExportSource, schema: SchemaReply, table: SchemaTable): Draft {
  const parsedDerived = parseCrudDerived(source.derived);
  const derived: CrudDerivedConfig = parsedDerived.ok ? parsedDerived.value : { measures: [], fields: [] };
  const measuresById = new Map(derived.measures.map((measure) => [measure.id, measure]));
  const fieldsById = new Map(derived.fields.map((field) => [field.id, field]));
  const columns: DraftColumn[] = [];
  for (const stored of source.columns ?? []) {
    const header = stored.label;
    if (stored.lookup !== undefined) {
      const hops = followPath(schema, table, stored.lookup.path);
      const reached = hops?.[hops.length - 1]?.table;
      const target = reached?.columns.find((column) => column.name === stored.lookup?.select);
      columns.push({
        id: `l:${stored.lookup.path.join('→')}:${reached?.id ?? '?'}.${stored.lookup.select}`,
        kind: 'linked',
        header,
        source: copy.genLinkedSrc(reached?.name ?? '?', stored.lookup.select, stored.lookup.path.join(' → ')),
        type: target?.logicalType ?? 'text',
        masked: target === undefined ? false : isPii(target),
        readOnly: true,
        numeric: target === undefined ? false : NUMERIC_TYPES.has(target.logicalType),
        badges: ['linked', ...(target !== undefined && isPii(target) ? (['masked'] as const) : [])],
        spec: { name: stored.name, lookup: stored.lookup },
      });
      continue;
    }
    if (stored.reverse !== undefined) {
      const linking = findTable(schema, stored.reverse.table);
      columns.push({
        id: `a:count:${stored.reverse.table}:${stored.reverse.fkColumn}`,
        kind: 'count',
        header,
        source: copy.genCountSrc(linking?.name ?? stored.reverse.table, stored.reverse.fkColumn),
        type: 'integer',
        masked: false,
        readOnly: true,
        numeric: true,
        badges: ['count'],
        spec: { name: stored.name, reverse: stored.reverse },
      });
      continue;
    }
    if (stored.derived !== undefined) {
      const measure = measuresById.get(stored.derived.ref);
      const field = fieldsById.get(stored.derived.ref);
      if (measure !== undefined) {
        const linking = findTable(schema, measure.table);
        const factors = measure.of?.terms.flatMap((term) => term.factors) ?? [];
        const isCount = measure.fn === 'count';
        columns.push({
          id: isCount
            ? `a:count:${measure.table}:${measure.fkColumn}`
            : `a:${measure.fn}:${measure.table}:${factors.join('*')}`,
          kind: isCount ? 'count' : 'fold',
          header,
          source: isCount
            ? copy.genCountSrc(linking?.name ?? measure.table, measure.fkColumn)
            : copy.genFoldSrc(measure.fn, linking?.name ?? measure.table, factors.join(' × ')),
          type: isCount ? 'integer' : 'numeric',
          masked: false,
          readOnly: true,
          numeric: true,
          badges: [measure.fn],
          spec: { name: stored.name, derived: stored.derived },
        });
      } else if (field !== undefined) {
        columns.push({
          id: `c:${field.id}`,
          kind: 'calc',
          header,
          source: header.toLowerCase(),
          type: field.result === 'text' ? 'text' : 'numeric',
          masked: false,
          readOnly: true,
          numeric: field.result !== 'text',
          badges: ['calculated'],
          spec: { name: stored.name, derived: stored.derived },
        });
      }
      continue;
    }
    const column = table.columns.find((candidate) => candidate.name === stored.name);
    if (column === undefined) continue;
    columns.push({ ...mkBase(table, column), header });
  }
  return { columns, measures: derived.measures, fields: derived.fields };
}

/** Walk an FK path from `table` through the schema; null when a hop is missing (schema drift). */
export function followPath(schema: SchemaReply, table: SchemaTable, path: readonly string[]): LinkHop[] | null {
  const hops: LinkHop[] = [];
  let current = table;
  for (const via of path) {
    const column = current.columns.find((candidate) => candidate.name === via);
    const reached = column?.references == null ? null : findTable(schema, column.references.tableId);
    if (reached === null) return null;
    hops.push({ via, table: reached });
    current = reached;
  }
  return hops;
}

// ---------------------------------------------------------------------------
// Suggestions (D15): four one-click chips the schema makes obvious
// ---------------------------------------------------------------------------

export interface Suggestion {
  key: string;
  label: string;
  meta: string;
  build: (taken: ReadonlySet<string>) => { column: DraftColumn; measure?: Measure };
  /** The draft id the suggestion would add — hidden once in the file. */
  id: string;
}

const TEXT_TYPES: ReadonlySet<string> = new Set(['text', 'varchar']);

/** The referenced table's display column: the classifier's `isDisplay` if the reply carries one, else the first text column that is neither a key nor personal data. */
function displayColumnOf(table: SchemaTable): SchemaColumn | null {
  const candidates = displayableColumns(table).filter((column) => column.isPrimaryKey !== true && !isPii(column));
  return candidates.find((column) => TEXT_TYPES.has(column.logicalType)) ?? null;
}

export function suggestionsFor(schema: SchemaReply, table: SchemaTable): Suggestion[] {
  const out: Suggestion[] = [];
  for (const fk of fkColumns(table)) {
    const reached = fk.references == null ? null : findTable(schema, fk.references.tableId);
    if (reached === null) continue;
    const display = displayColumnOf(reached);
    if (display === null) continue;
    const hop: LinkHop = { via: fk.name, table: reached };
    out.push({
      key: `s:link:${fk.name}`,
      label: `${singular(tableLabel(reached))} ${sentence(display.name).toLowerCase()}`,
      meta: copy.via(fk.name),
      id: `l:${fk.name}:${reached.id}.${display.name}`,
      build: (taken) => ({ column: mkLinked([hop], display, taken) }),
    });
  }
  const links = inboundLinks(schema, table);
  for (const link of links) {
    out.push({
      key: `s:count:${link.table.id}:${link.column.name}`,
      label: copy.genCount(tableLabel(link.table)),
      meta: copy.via(link.column.name),
      id: `a:count:${link.table.id}:${link.column.name}`,
      build: (taken) => mkCount(link, taken),
    });
  }
  for (const link of links) {
    const numeric = numericColumns(link.table);
    const money = numeric.find((column) => column.semantics?.primary === 'money') ?? numeric[0];
    if (money === undefined) continue;
    out.push({
      key: `s:sum:${link.table.id}:${money.name}`,
      label: capitalize(`${FOLD_HEADER_WORD.sum()} ${link.table.name} ${sentence(money.name).toLowerCase()}`),
      meta: copy.via(link.column.name),
      id: `a:sum:${link.table.id}:${money.name}`,
      build: (taken) => mkFold(link, 'sum', [money], taken),
    });
  }
  return out.slice(0, 4);
}

// ---------------------------------------------------------------------------
// The wire (D1, D8)
// ---------------------------------------------------------------------------

export interface DraftSettings {
  format: 'csv' | 'json';
  scope: 'all' | 'view';
  view: ExportSavedViewDto | null;
  headerRow: boolean;
  /** The typed stem; empty for the default. */
  name: string;
}

export function toSource(draft: Draft, table: SchemaTable, settings: DraftSettings): ExportSource {
  const derived =
    draft.measures.length === 0 && draft.fields.length === 0
      ? {}
      : { derived: { measures: draft.measures, fields: draft.fields } };
  const scope =
    settings.scope === 'view' && settings.view !== null
      ? { viewId: settings.view.id, filters: settings.view.filters }
      : {};
  return {
    kind: 'table',
    table: table.id,
    ...scope,
    columns: draft.columns.map((column) => ({ ...column.spec, label: column.header.trim() })),
    ...derived,
    options: {
      headerRow: settings.headerRow,
      ...(settings.name.trim().length === 0 ? {} : { fileName: settings.name.trim() }),
    },
  };
}

/** `<table>-<YYYY-MM-DD>` in the viewer's local date (comp 1032). */
export function defaultFileStem(table: SchemaTable | null, now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${table?.name ?? 'export'}-${y}-${m}-${d}`;
}

export function fileExtension(format: 'csv' | 'json'): string {
  return format === 'csv' ? '.csv' : '.jsonl';
}

/** The comp's `size()` (863): B / KB / MB. */
export function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export { MAX_FACTORS as MAX_FOLD_FACTORS };
