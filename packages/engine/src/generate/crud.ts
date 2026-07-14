/**
 * `page-crud` envelope generation — one per included table (research/
 * widget-registry.md §14: "Every included table"; 01-architecture.md §6.1
 * fixes the config body shape: `columns[]`, `defaultSort`, `pageSize`,
 * `detail`).
 *
 * Column selection follows 05 (assignment note): display column, status,
 * money, dates first; list capped at ~8 visible columns. Secrets are
 * hard-excluded (05 §7.1 rule 1), pk ids are hidden by default (rule 2).
 */

import type { ClassifiedColumn, ClassifiedTable } from '../classify/index.js';
import type { ColumnModel, DatabaseModel, TableModel } from '../schema-model.js';
import { humanize, pageIdFor } from './util.js';

/** Max list-visible columns (05 "cap ~8"). */
const LIST_COLUMN_CAP = 8;
const DEFAULT_PAGE_SIZE = 50;

/** §7.1 rule-7 heuristic tone map for status pills. */
const TONE_POS = /^(active|paid|done|completed?|closed|approved|healthy|shipped|delivered)$/i;
const TONE_WARN = /^(pending|trial|review|in_review|draft|queued|on_hold|paused|open|new)$/i;
const TONE_DANGER = /^(failed|rejected|churned|overdue|blocked|cancell?ed|error)$/i;

export function enumTones(values: readonly string[]): Record<string, string> {
  const tones: Record<string, string> = {};
  for (const value of values) {
    if (TONE_POS.test(value)) tones[value] = 'pos';
    else if (TONE_WARN.test(value)) tones[value] = 'warn';
    else if (TONE_DANGER.test(value)) tones[value] = 'danger';
    else tones[value] = 'muted';
  }
  return tones;
}

const NUMERIC_TYPES = new Set(['integer', 'bigint', 'decimal', 'float']);

interface RankedColumn {
  column: ColumnModel;
  semantics: ClassifiedColumn['semantics'];
  priority: number;
}

/**
 * List-visibility priority (lower = earlier): display column, then status,
 * money, dates, FK chips, categories, identity columns, the rest. Excluded
 * entirely: secrets, pk ids, binary/image/json payloads, free text.
 */
function rankColumn(
  column: ColumnModel,
  semantics: ClassifiedColumn['semantics'],
  displayColumn: string | null,
): number | null {
  if (semantics.flags.secret) return null;
  const tag = semantics.primary;
  if (tag === 'pk-id') return null; // hidden by default in grids (rule 2)
  if (column.logicalType === 'binary' || column.logicalType === 'json') return null;
  if (tag === 'image-url' || tag === 'json-config' || tag === 'free-text') return null;
  if (column.name === displayColumn) return 0;
  switch (tag) {
    case 'status-workflow':
      return 1;
    case 'money':
      return 2;
    case 'created-at':
    case 'updated-at':
      return 3;
    case 'event-timestamp':
    case 'date-range':
      return 4;
    case 'fk':
      return 5;
    case 'category-enum':
      return 6;
    case 'person-name':
    case 'email':
      return 7;
    case 'boolean-flag':
      return 8;
    case 'percent':
    case 'score':
    case 'duration':
      return 9;
    case 'phone':
    case 'url':
    case 'slug':
      return 10;
    default:
      return 12;
  }
}

export interface CrudBuildContext {
  connectionId: string | null;
  slug: string;
  navGroup: 'workspace' | 'library' | 'planning' | 'people' | 'account';
  navIcon: string;
  navOrder: number;
  /** read-only-analytics intent, no-PK tables, and views render read-only. */
  readOnly: boolean;
  /** Tables included in this generation run (detail tabs only link these). */
  includedTableIds: ReadonlySet<string>;
}

function enumValuesFor(model: DatabaseModel, column: ColumnModel): string[] | null {
  if (column.enumRef === null) return null;
  return model.enums.find((e) => e.id === column.enumRef)?.values ?? null;
}

function listColumns(
  model: DatabaseModel,
  table: TableModel,
  classified: ClassifiedTable,
): Record<string, unknown>[] {
  const byName = new Map(classified.columns.map((c) => [c.column, c]));
  const ranked: RankedColumn[] = [];
  for (const column of table.columns) {
    const semantics = byName.get(column.name)?.semantics;
    if (semantics === undefined) continue;
    const priority = rankColumn(column, semantics, classified.displayColumn);
    if (priority === null) continue;
    ranked.push({ column, semantics, priority });
  }
  // Stable: priority, then declaration order.
  ranked.sort((a, b) => a.priority - b.priority || a.column.ordinal - b.column.ordinal);

  return ranked.slice(0, LIST_COLUMN_CAP).map(({ column, semantics }) => {
    // Emitted in @adminium/widgets' gridColumnSpecSchema vocabulary — the
    // page-crud template's column contract ({name, logicalType, semantic, …});
    // the renderers derive the cell treatment from logicalType+semantic, so no
    // widget id is stored per column.
    const def: Record<string, unknown> = {
      name: column.name,
      label: humanize(column.name),
      logicalType: column.logicalType,
      semantic: semantics.primary,
      sortable: true,
    };
    if (semantics.format !== null) def['format'] = semantics.format;
    if (semantics.primary === 'money') def['align'] = 'end';
    if (
      semantics.primary === 'pk-id' ||
      semantics.primary === 'external-id' ||
      semantics.primary === 'email'
    ) {
      def['mono'] = true;
    }
    if (column.references !== null) {
      def['fk'] = { table: column.references.tableId, column: column.references.column };
    }
    const values = enumValuesFor(model, column);
    if (values !== null) {
      def['enumValues'] = values;
      if (semantics.primary === 'status-workflow') def['enumTones'] = enumTones(values);
    }
    if (semantics.flags.maskedByDefault) def['pii'] = true;
    // Form-generation facts (RecordForm reads these off the same spec).
    if (column.isPrimaryKey) def['primaryKey'] = true;
    if (!column.nullable) def['nullable'] = false;
    if (column.default !== null) def['hasDefault'] = true;
    if (column.isUnique) def['unique'] = true;
    if (
      column.isGenerated ||
      semantics.primary === 'created-at' ||
      semantics.primary === 'updated-at'
    ) {
      def['readOnly'] = true;
    }
    if (column.maxLength !== null) def['maxLength'] = column.maxLength;
    return def;
  });
}

function defaultSort(table: TableModel, classified: ClassifiedTable): Record<string, unknown>[] {
  const createdAt = classified.columns.find((c) => c.semantics.primary === 'created-at');
  if (createdAt !== undefined) return [{ column: createdAt.column, dir: 'desc' }];
  const pk = table.primaryKey[0];
  if (pk !== undefined) return [{ column: pk, dir: 'desc' }];
  return [];
}

/** Detail tabs from inbound FKs (09 §7.1 — `tab-bar` with live count pills). */
function detailTabs(
  model: DatabaseModel,
  table: TableModel,
  includedTableIds: ReadonlySet<string>,
): Record<string, unknown>[] {
  const tabs: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const relation of [...model.relations].sort((a, b) => a.id.localeCompare(b.id))) {
    if (relation.to.tableId !== table.id) continue;
    if (relation.from.tableId === table.id) continue; // self-FK → hierarchy, not a tab
    if (relation.confidence < 0.8) continue;
    if (!includedTableIds.has(relation.from.tableId)) continue;
    const key = `${relation.from.tableId}:${relation.from.columns.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tabs.push({
      table: relation.from.tableId,
      fkColumn: relation.from.columns[0],
      label: humanize(relation.from.tableId),
    });
  }
  return tabs;
}

const AUTO_MANAGED_TAGS = new Set(['created-at', 'updated-at']);

/** Generated form field defs (09 §7.1 — the modal-wizard renders these). */
function formFields(
  model: DatabaseModel,
  table: TableModel,
  classified: ClassifiedTable,
): Record<string, unknown>[] {
  const byName = new Map(classified.columns.map((c) => [c.column, c]));
  const fields: Record<string, unknown>[] = [];
  for (const column of table.columns) {
    const semantics = byName.get(column.name)?.semantics;
    if (semantics === undefined || semantics.flags.secret) continue;
    if (column.isGenerated) continue;
    const auto = column.default !== null && column.default.kind !== 'literal' && column.default.kind !== 'expression';
    if (column.isPrimaryKey && auto) continue; // autoincrement / uuid PKs
    if (AUTO_MANAGED_TAGS.has(semantics.primary) && column.default !== null) continue;

    const field: Record<string, unknown> = {
      column: column.name,
      label: humanize(column.name),
      required: !column.nullable && column.default === null,
    };
    const tag = semantics.primary;
    if (tag === 'fk' && column.references !== null) {
      field['input'] = 'fk-combobox';
      field['ref'] = column.references.tableId;
    } else if (column.logicalType === 'enum') {
      const values = enumValuesFor(model, column) ?? [];
      field['input'] = values.length > 0 && values.length <= 3 ? 'segmented' : 'select';
      field['options'] = values;
    } else if (column.logicalType === 'boolean' || tag === 'boolean-flag') {
      field['input'] = 'switch';
    } else if (column.logicalType === 'date') {
      field['input'] = 'date';
    } else if (
      column.logicalType === 'timestamp' ||
      column.logicalType === 'timestamptz' ||
      column.logicalType === 'time'
    ) {
      field['input'] = 'datetime';
    } else if (NUMERIC_TYPES.has(column.logicalType)) {
      field['input'] = 'number';
      if (tag === 'money') field['format'] = 'currency';
    } else if (column.logicalType === 'json') {
      field['input'] = 'json';
    } else if (tag === 'free-text') {
      field['input'] = 'textarea';
    } else {
      field['input'] = 'text';
      if (column.maxLength !== null) field['maxLength'] = column.maxLength;
    }
    if (column.isUnique && !column.isPrimaryKey) field['unique'] = true;
    fields.push(field);
  }
  return fields;
}

/** Build the (unhashed, unvalidated) `page-crud` envelope for one table. */
export function buildCrudEnvelope(
  model: DatabaseModel,
  table: TableModel,
  classified: ClassifiedTable,
  ctx: CrudBuildContext,
): Record<string, unknown> {
  const readOnly = ctx.readOnly || table.primaryKey.length === 0 || table.kind !== 'table';
  const title = humanize(table.name);

  const config: Record<string, unknown> = {
    columns: listColumns(model, table, classified),
    defaultSort: defaultSort(table, classified),
    pageSize: DEFAULT_PAGE_SIZE,
    keyField: classified.displayColumn ?? table.primaryKey[0] ?? null,
    readOnly,
    detail: {
      template: 'page-record',
      tabsFromInboundFks: true,
      tabs: detailTabs(model, table, ctx.includedTableIds),
    },
  };
  if (!readOnly) {
    config['form'] = { fields: formFields(model, table, classified) };
  }

  return {
    v: 1,
    kind: 'page',
    id: pageIdFor(ctx.connectionId, ctx.slug),
    template: 'page-crud',
    title: { key: `nav.${ctx.slug}`, fallback: title },
    source: { connectionId: ctx.connectionId, table: table.id },
    nav: { group: ctx.navGroup, icon: ctx.navIcon, order: ctx.navOrder, slug: ctx.slug },
    access: {
      minRole: 'viewer',
      permissions: [`table:${table.id}:read`],
    },
    config,
  };
}
