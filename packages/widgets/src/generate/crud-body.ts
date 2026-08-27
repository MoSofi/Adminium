// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-crud` config-body composer — the body-building vocabulary of the
 * Engine's bespoke `generate/crud.ts`, relocated behind the leaf boundary
 * (research/widget-registry.md §14: "Every included table"; 01-architecture.md
 * §6.1 fixes the config body shape: `columns[]`, `defaultSort`, `pageSize`,
 * `detail`).
 *
 * `page-crud` deliberately keeps its TYPED body (09-generated-app.md §3.3) —
 * this module produces `config.columns`/`form`/`detail`, not a `config.layout`,
 * and the Engine still wraps the body into the §6.1 envelope. What moved is the
 * vocabulary: column selection, tones, form-field mapping — the rules of *what
 * a crud page contains* — now live beside the candidate rules (04 §8: the
 * Registry owns what can be instantiated and why).
 *
 * PARITY CONTRACT: `packages/engine/test/generate-baseline.test.ts` pins the
 * generator's output byte-identical, so every function here reproduces the
 * bespoke builder's exact behaviour — same exclusions, same key order, same
 * fallbacks. Inputs are the structural mirrors of `../registry/candidates.ts`;
 * the Engine's adapter fills them from `TableModel`/`ClassifiedTable`.
 *
 * Column selection follows 05 (assignment note): display column, status,
 * money, dates first; list capped at ~8 visible columns. Secrets are
 * hard-excluded (05 §7.1 rule 1), pk ids are hidden by default (rule 2) —
 * emitted as `hidden` specs (not dropped) so the page-crud template can still
 * resolve row identity and generate the create/edit form's key field.
 */

import { fkDisplayAliasOf, type GridColumnSpecInput } from '../page-config/grid-column-spec.js';
import {
  humanize,
  type CandidateColumn,
  type CandidateRelation,
  type CandidateTable,
  type CandidateTableInput,
  type ClassifiedColumnInput,
  type ClassifiedTableInput,
} from '../registry/candidates.js';

/** Max list-visible columns (05 "cap ~8"). */
const LIST_COLUMN_CAP = 8;
const DEFAULT_PAGE_SIZE = 50;

/** §7.1 rule-7 heuristic tone map for status pills. */
const TONE_POS = /^(active|paid|done|completed?|closed|approved|healthy|shipped|delivered)$/i;
const TONE_WARN = /^(pending|trial|review|in_review|draft|queued|on_hold|paused|open|new)$/i;
const TONE_DANGER = /^(failed|rejected|churned|overdue|blocked|cancell?ed|error)$/i;

/**
 * The tones the crud generator actually emits — a subset of `gridToneSchema`.
 * `'muted'` is the rule-7 fallback ("inactive / draft / neutral", same
 * vocabulary as the LLM contract's `Tone`); renderers map it onto the neutral
 * treatment (`families/tables/cells.tsx`).
 */
export type CrudEnumTone = 'pos' | 'warn' | 'danger' | 'muted';

/**
 * Mirrored (deliberately) by `packages/llm/src/apply/normalize.ts` — the LLM
 * apply path re-derives tones for enum values the generator never saw.
 */
export function enumTones(values: readonly string[]): Record<string, CrudEnumTone> {
  const tones: Record<string, CrudEnumTone> = {};
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
  column: CandidateColumn;
  semantics: ClassifiedColumnInput;
  priority: number;
}

/**
 * List-visibility priority (lower = earlier): display column, then status,
 * money, dates, FK chips, categories, identity columns, the rest. Excluded
 * entirely: secrets, pk ids, binary/image/json payloads, free text.
 */
function rankColumn(
  column: CandidateColumn,
  semantics: ClassifiedColumnInput,
  displayColumn: string | null,
): number | null {
  if (semantics.secret ?? false) return null;
  const tag = semantics.semantic;
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

export interface CrudBodyContext {
  /** read-only-analytics intent, no-PK tables, and views render read-only. */
  readOnly: boolean;
  /** Tables included in this generation run (detail tabs only link these). */
  includedTableIds: ReadonlySet<string>;
  /** Every model relation — detail tabs derive from the inbound ones. */
  relations: readonly CandidateRelation[];
  /**
   * Referenced-table display columns (tableId → column name) — the
   * generation-time fact `fk.display` is stamped from, so FK chips can show
   * "Drift & Fern" instead of the raw id ({@link crudDisplayColumns} builds
   * it from the included candidate model). Optional: absent ⇔ no stamping,
   * chips keep their raw-value fallback.
   */
  displayColumns?: ReadonlyMap<string, string> | undefined;
}

/**
 * The `fk.display` source map for {@link CrudBodyContext.displayColumns}: each
 * included table's classified display column. Secret display columns are
 * skipped — the server hard-422s a lookup that targets a secret identifier,
 * which would break every read of the page (a MASKED display column stays in:
 * the server nulls it per caller and the chip falls back to the raw id).
 * Included tables only, deliberately: an FK onto an excluded table has no page
 * to open and no guarantee the snapshot serves lookups against it.
 */
export function crudDisplayColumns(
  model: readonly CandidateTableInput[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of model) {
    const display = entry.classified.displayColumn ?? null;
    if (display === null) continue;
    const semantics = entry.classified.columns.find((c) => c.column === display);
    if (semantics?.secret ?? false) continue;
    map.set(entry.table.id, display);
  }
  return map;
}

/**
 * The referenced table's display column for one FK column — null unless the
 * chip's display lookup would actually work: the referenced table must have a
 * known (non-secret) display column that is not the referenced column itself
 * (joining the pk back in shows the raw id anyway), and the derived alias must
 * be servable — inside the server's alias grammar and not shadowing a REAL
 * column of the source table, which the server refuses with a hard 422 on
 * every read. The source-table check lives here, at generation time, because
 * only the generator sees the full column list; the interpreter re-checks only
 * against the specs it has.
 */
function fkDisplayFor(
  table: CandidateTable,
  column: CandidateColumn,
  displayColumns: ReadonlyMap<string, string> | undefined,
): string | null {
  const ref = column.references;
  if (ref === null || ref === undefined || displayColumns === undefined) return null;
  const display = displayColumns.get(ref.tableId);
  if (display === undefined || display === ref.column) return null;
  const alias = fkDisplayAliasOf(column.name);
  if (alias === null) return null;
  if (table.columns.some((c) => c.name === alias)) return null;
  return display;
}

/** Detail-tab entry (09 §7.1 — `tab-bar` with live count pills). */
export interface CrudDetailTab {
  /** The referencing table's id. */
  table: string;
  /** Its FK column into this page's table. */
  fkColumn: string | undefined;
  label: string;
}

export interface CrudSortSpec {
  column: string;
  dir: 'asc' | 'desc';
}

/** One generated form field (09 §7.1 — the modal-wizard renders these). */
export interface CrudFormField {
  column: string;
  label: string;
  required: boolean;
  input?:
    | 'fk-combobox'
    | 'segmented'
    | 'select'
    | 'switch'
    | 'date'
    | 'datetime'
    | 'number'
    | 'json'
    | 'textarea'
    | 'text';
  /** fk-combobox target table id. */
  ref?: string;
  /** segmented/select options. */
  options?: readonly string[];
  format?: 'currency';
  maxLength?: number;
  unique?: boolean;
}

/** The typed `page-crud` config body (01 §6.1 / 09 §3.3), pre-envelope. */
export interface CrudPageBody {
  columns: GridColumnSpecInput[];
  defaultSort: CrudSortSpec[];
  pageSize: number;
  keyField: string | null;
  readOnly: boolean;
  detail: {
    template: 'page-record';
    tabsFromInboundFks: true;
    tabs: CrudDetailTab[];
  };
  form?: { fields: CrudFormField[] };
}

/** `enumValues` carries resolved values or is absent — absent ⇔ no enum. */
function enumValuesFor(column: CandidateColumn): readonly string[] | null {
  return column.enumValues ?? null;
}

/** Sort key: engine `ColumnModel.ordinal` (0 = unspecified — ties keep declaration order). */
function ordinalOf(column: CandidateColumn): number {
  return column.ordinal ?? 0;
}

/**
 * One `config.columns[]` entry in the `gridColumnSpecSchema` vocabulary — the
 * page-crud template's column contract ({name, logicalType, semantic, …}); the
 * renderers derive the cell treatment from logicalType+semantic, so no widget
 * id is stored per column.
 *
 * Exported (as well as used by `listColumns`) for the Studio column manager:
 * re-adding a removed column, or composing a lookup column's presentation
 * from the referenced table's model, must produce exactly the spec a
 * regeneration would — one composer, two callers.
 */
export function buildColumnDef(
  column: CandidateColumn,
  semantics: ClassifiedColumnInput,
  /**
   * The referenced table's display column, when the caller knows it (the
   * generator via {@link crudDisplayColumns}; the Studio column manager's
   * schema reply does not carry it, so re-added FK columns stay unstamped
   * until the next regeneration — the chip's raw-value fallback, never a
   * crash). Pre-checked by the caller ({@link fkDisplayFor}); stamped as
   * `fk.display` verbatim.
   */
  fkDisplay?: string | null,
): GridColumnSpecInput {
  const def: GridColumnSpecInput = {
    name: column.name,
    label: humanize(column.name),
    // The candidate mirror keeps `logicalType` an open string; the engine enum
    // it mirrors is identical to GRID_LOGICAL_TYPES (schema-model.ts §6), so
    // the narrow assertion cannot widen the emitted vocabulary.
    logicalType: column.logicalType as GridColumnSpecInput['logicalType'],
    semantic: semantics.semantic,
    sortable: true,
  };
  if (semantics.format !== null && semantics.format !== undefined) def.format = semantics.format;
  if (semantics.semantic === 'money') def.align = 'end';
  if (
    semantics.semantic === 'pk-id' ||
    semantics.semantic === 'external-id' ||
    semantics.semantic === 'email'
  ) {
    def.mono = true;
  }
  if (column.references !== null && column.references !== undefined) {
    def.fk = {
      table: column.references.tableId,
      column: column.references.column,
      ...(fkDisplay === null || fkDisplay === undefined ? {} : { display: fkDisplay }),
    };
  }
  const values = enumValuesFor(column);
  if (values !== null) {
    def.enumValues = [...values];
    if (semantics.semantic === 'status-workflow') def.enumTones = enumTones(values);
  }
  if (semantics.maskedByDefault ?? false) def.pii = true;
  // Form-generation facts (RecordForm reads these off the same spec).
  if (column.isPrimaryKey ?? false) def.primaryKey = true;
  if (!(column.nullable ?? true)) def.nullable = false;
  if (column.defaultKind !== null && column.defaultKind !== undefined) def.hasDefault = true;
  if (column.isUnique ?? false) def.unique = true;
  if (
    (column.isGenerated ?? false) ||
    semantics.semantic === 'created-at' ||
    semantics.semantic === 'updated-at'
  ) {
    def.readOnly = true;
  }
  if (column.maxLength !== null && column.maxLength !== undefined) def.maxLength = column.maxLength;
  return def;
}

function listColumns(
  table: CandidateTable,
  classified: ClassifiedTableInput,
  ctx: CrudBodyContext,
): GridColumnSpecInput[] {
  const byName = new Map(classified.columns.map((c) => [c.column, c]));
  const displayColumn = classified.displayColumn ?? null;
  const ranked: RankedColumn[] = [];
  for (const column of table.columns) {
    const semantics = byName.get(column.name);
    if (semantics === undefined) continue;
    const priority = rankColumn(column, semantics, displayColumn);
    if (priority === null) continue;
    ranked.push({ column, semantics, priority });
  }
  // Stable: priority, then declaration order.
  ranked.sort((a, b) => a.priority - b.priority || ordinalOf(a.column) - ordinalOf(b.column));

  const defs = ranked
    .slice(0, LIST_COLUMN_CAP)
    .map(({ column, semantics }) =>
      buildColumnDef(column, semantics, fkDisplayFor(table, column, ctx.displayColumns)),
    );

  // Every PK column — and every REQUIRED column — needs a spec even when the
  // ranking drops it from the visible set. Two reasons, one mechanism:
  //
  //   - PKs (pk-id, rule 2): the page-crud template derives row identity
  //     (rowIdOf → the record-route `:recordId`) from `config.columns`.
  //   - Required columns (NOT NULL, no default, not server-managed): the
  //     create form is built from `config.columns` too, so a required column
  //     the ~8 cap dropped (a NOT NULL free-text `description`) made every
  //     generated create — the page's own "New row" and the record page's
  //     in-tab add — fail on a constraint the form never showed. A form that
  //     cannot express a required input is structurally broken, not merely
  //     terse.
  //
  // Both append as `hidden` — DataGrid filters hidden specs out of the grid,
  // so the list stays capped while forms/detail and row ids resolve
  // (gridColumnSpecSchema: "Hidden from the grid but still available to
  // forms/detail"). Secrets stay excluded ABSOLUTELY: they never leave the
  // server, whatever their constraints — a required secret column is a schema
  // the generated form cannot serve, and silently emitting its spec would
  // trade a visible failure for a masking hole.
  const present = new Set(defs.map((def) => def.name));
  for (const column of table.columns) {
    if (present.has(column.name)) continue;
    const semantics = byName.get(column.name);
    if (semantics === undefined || (semantics.secret ?? false)) continue;
    // Hidden FK specs stamp `fk.display` too: hidden columns still render on
    // the record page ("available to forms/detail"), where the chip benefits
    // the same way.
    const def = buildColumnDef(column, semantics, fkDisplayFor(table, column, ctx.displayColumns));
    const required = def.nullable === false && def.hasDefault !== true && def.readOnly !== true;
    if (!(column.isPrimaryKey ?? false) && !required) continue;
    defs.push({ ...def, hidden: true });
  }

  return defs;
}

function defaultSort(table: CandidateTable, classified: ClassifiedTableInput): CrudSortSpec[] {
  const createdAt = classified.columns.find((c) => c.semantic === 'created-at');
  if (createdAt !== undefined) return [{ column: createdAt.column, dir: 'desc' }];
  const pk = (table.primaryKey ?? [])[0];
  if (pk !== undefined) return [{ column: pk, dir: 'desc' }];
  return [];
}

/** Detail tabs from inbound FKs (09 §7.1) — conf ≥ 0.8, deduped, no self-FK. */
function detailTabs(
  table: CandidateTable,
  relations: readonly CandidateRelation[],
  includedTableIds: ReadonlySet<string>,
): CrudDetailTab[] {
  const tabs: CrudDetailTab[] = [];
  const seen = new Set<string>();
  for (const relation of [...relations].sort((a, b) => a.id.localeCompare(b.id))) {
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
function formFields(table: CandidateTable, classified: ClassifiedTableInput): CrudFormField[] {
  const byName = new Map(classified.columns.map((c) => [c.column, c]));
  const fields: CrudFormField[] = [];
  for (const column of table.columns) {
    const semantics = byName.get(column.name);
    if (semantics === undefined || (semantics.secret ?? false)) continue;
    if (column.isGenerated ?? false) continue;
    const defaultKind = column.defaultKind ?? null;
    const auto = defaultKind !== null && defaultKind !== 'literal' && defaultKind !== 'expression';
    if ((column.isPrimaryKey ?? false) && auto) continue; // autoincrement / uuid PKs
    if (AUTO_MANAGED_TAGS.has(semantics.semantic) && defaultKind !== null) continue;

    const field: CrudFormField = {
      column: column.name,
      label: humanize(column.name),
      required: !(column.nullable ?? true) && defaultKind === null,
    };
    const tag = semantics.semantic;
    if (tag === 'fk' && column.references !== null && column.references !== undefined) {
      field.input = 'fk-combobox';
      field.ref = column.references.tableId;
    } else if (column.logicalType === 'enum') {
      const values = enumValuesFor(column) ?? [];
      field.input = values.length > 0 && values.length <= 3 ? 'segmented' : 'select';
      field.options = values;
    } else if (column.logicalType === 'boolean' || tag === 'boolean-flag') {
      field.input = 'switch';
    } else if (column.logicalType === 'date') {
      field.input = 'date';
    } else if (
      column.logicalType === 'timestamp' ||
      column.logicalType === 'timestamptz' ||
      column.logicalType === 'time'
    ) {
      field.input = 'datetime';
    } else if (NUMERIC_TYPES.has(column.logicalType)) {
      field.input = 'number';
      if (tag === 'money') field.format = 'currency';
    } else if (column.logicalType === 'json') {
      field.input = 'json';
    } else if (tag === 'free-text') {
      field.input = 'textarea';
    } else {
      field.input = 'text';
      if (column.maxLength !== null && column.maxLength !== undefined) {
        field.maxLength = column.maxLength;
      }
    }
    if ((column.isUnique ?? false) && !(column.isPrimaryKey ?? false)) field.unique = true;
    fields.push(field);
  }
  return fields;
}

/** Build the typed `page-crud` config body for one table (pre-envelope). */
export function composeCrudBody(
  table: CandidateTable,
  classified: ClassifiedTableInput,
  ctx: CrudBodyContext,
): CrudPageBody {
  const readOnly =
    ctx.readOnly || (table.primaryKey ?? []).length === 0 || (table.kind ?? 'table') !== 'table';

  const body: CrudPageBody = {
    columns: listColumns(table, classified, ctx),
    defaultSort: defaultSort(table, classified),
    pageSize: DEFAULT_PAGE_SIZE,
    keyField: classified.displayColumn ?? (table.primaryKey ?? [])[0] ?? null,
    readOnly,
    detail: {
      template: 'page-record',
      tabsFromInboundFks: true,
      tabs: detailTabs(table, ctx.relations, ctx.includedTableIds),
    },
  };
  if (!readOnly) {
    body.form = { fields: formFields(table, classified) };
  }
  return body;
}
