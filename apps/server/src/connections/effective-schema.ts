// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Effective schema = active snapshot + active override ops applied in
 * created_at order, later ops winning per (op, table, column) target
 * (read path). Pure functions — no I/O.
 *
 * The returned model is the snapshot's `DatabaseModel` JSON with
 * display-layer fields attached (`label`, `hidden`, `excluded`, …). It is a
 * reply/derived shape and is never re-parsed by the strict engine schema.
 */

import { SEMANTIC_TAGS } from '@adminium/engine';
import type {
  ColumnModel,
  ColumnSemantics,
  DatabaseModel,
  Relation,
  SemanticTag,
  TableModel,
} from '@adminium/engine';
import type { FormulaExpr } from '@adminium/manifest';
import type { SchemaOverride } from '@adminium/meta';

/** One answer a choice column accepts. */
export interface ColumnOptionItem {
  value: string;
  label?: string;
  tone?: string;
  description?: string;
}

/** `column.options`: a named list, or the values themselves. */
export type ColumnOptions = { list: string } | { values: ColumnOptionItem[] };

/**
 * A setting a rule reads when it runs: a column of the app's one-row settings
 * table (its id in the snapshot), or one of an add-on's settings in the meta
 * store.
 */
export type RuleSetting = { table: string; column: string } | { addOn: string; setting: string };

/** `column.default`: how Adminium fills the column when nobody does. */
export interface ColumnFillRule {
  kind: 'now' | 'uuid' | 'literal' | 'current-user' | 'database' | 'none' | 'from';
  text?: string;
  userField?: 'id' | 'name';
  onUpdate?: boolean;
  /** `from` only: where a create's empty value comes from. */
  from?: 'connection.currency' | RuleSetting;
}

/** `column.copy`: the value comes from the row `via` points at. */
export interface ColumnCopyRule {
  via: string;
  from: string;
  mode?: 'default' | 'always';
}

/**
 * `column.sequence`: the next number in this column's own counter — or, with
 * `gapless`, the next number after the largest the table holds, taken inside
 * the write that creates the row, so the series never skips or repeats.
 */
export interface ColumnSequenceRule {
  start?: number;
  gapless?: true;
  /** The first number, read from a setting (it only ever raises `start`). */
  startSetting?: RuleSetting;
  /** A foreign key column: each parent row has its own series. */
  scope?: string;
}

/** `column.format`: a text column written from a running number of the row (`INV-0042`). */
export interface ColumnFormatRule {
  from: string;
  prefix?: string;
  prefixSetting?: RuleSetting;
  pad?: number;
}

/** `column.code`: a short random code, Crockford base 32. */
export interface ColumnCodeRule {
  prefix?: string;
  length: number;
}

/** `column.rollup`: this column is the total of its child rows. */
export interface ColumnRollupRule {
  /** The child table's id in the snapshot. */
  from: string;
  /** The child's column linking back to this row. */
  via: string;
  sum: string;
  times?: string;
  /** A child row whose column holds a value is left out (a voided line). */
  unlessSet?: string;
  /** Only child rows whose column equals the value are added up (`voided = false`). */
  where?: { column: string; eq: string | number | boolean };
  /** A second column of this row kept in step: `of − Σminus − total` (`balance = fee − waived − paid`). */
  balance?: { column: string; of: string; minus?: string[] };
  /** A write that would take a balance this total feeds below zero is refused. */
  cap?: true;
}

/** A child list a fingerprint covers: its rows in `orderBy` order, then by key. */
export interface HashChild {
  /** The child table's id in the snapshot. */
  table: string;
  via: string;
  columns: string[];
  orderBy?: string;
}

/** What a fingerprint covers: columns of the row, its child rows, and rows it points at. */
export interface HashOf {
  columns: string[];
  children?: HashChild[];
  linked?: { via: string; table: string; columns: string[]; children?: HashChild[] }[];
}

/**
 * What a stamp writes: the moment, today's date on the venue's calendar, who
 * did it, a word per kind of writer, another column of the row, a column of
 * the signed-in person's own row, a date so many days after another, or a
 * fingerprint.
 */
export type StampSet =
  | 'now'
  | 'today'
  | 'user-name'
  | 'user-id'
  | { byOrigin: { public: string; staff?: string } }
  | { copy: string }
  | { claim: string; staff?: 'user-name' | 'user-id' }
  | { addDays: { date: string; days: string | number; map?: Record<string, number> } }
  | { hashOf: HashOf };

/** When a stamp is written: on create, when a column changes to a value, or when a column is first filled. */
export type StampTrigger = 'create' | { column: string; values: (string | number | boolean)[] } | { column: string; filled: true };

/**
 * `column.stamp`: a value written when something happens — the moment, or who
 * did it — on a create, or when another column changes to one of `values`.
 */
export interface ColumnStampRule {
  set: StampSet;
  on: StampTrigger | StampTrigger[];
}

/**
 * `table.states`: a document's life — its states, the moves between them, what
 * stays open once it is locked, the child tables tied to its state (each by
 * its id in the snapshot), and when it may never be deleted.
 */
export interface TableStatesRule {
  column: string;
  initial: string;
  moves: Record<string, (string | StateMoveRule)[]>;
  lock?: { when: string[]; except?: string[] };
  children?: Record<string, { via: string; lock?: true; parentIn?: string[]; clearOnCreate?: string[] }>;
  lockedWhenReferencedBy?: { table: string; via: string; in: string[] }[];
  noDelete?: { when: 'numbered' | string[] };
  onlyLater?: string[];
}

/** One move of a state, with what it asks for first and who may make it (role slugs). */
export interface StateMoveRule {
  to: string;
  requires?: {
    children?: Record<string, number>;
    where?: { column: string; eq?: string | number | boolean; in?: (string | number | boolean)[]; isNull?: boolean; gt?: number; gte?: number; lt?: number; lte?: number }[];
  };
  roles?: string[];
}

/**
 * A row of another table that locks this one while it is in some states,
 * resolved when the model is built: `column` is that table's state column.
 */
export interface LockedByReference {
  table: string;
  via: string;
  column: string;
  in: string[];
}

/**
 * A parent whose state this table's rows are tied to (the parent's
 * `states.children` names this table), resolved when the model is built so a
 * write to a child row can judge it from the child table alone.
 */
export interface StateParent {
  /** The parent table's id and its one-column key. */
  table: string;
  key: string;
  /** This table's foreign key to the parent. */
  via: string;
  /** The parent's state column, and the states it is locked in. */
  column: string;
  lockedIn: string[];
  /** Rows of other tables that lock the parent too. */
  lockedBy: LockedByReference[];
  lock?: true;
  parentIn?: string[];
  clearOnCreate?: string[];
}

/** A number or a time the rule states, or a settings table's column read at write time. */
export type CapacitySetting = { table: string; column: string };

/** `table.capacity`: how much of a slot the table's rows may take. */
export interface TableCapacityRule {
  slot: string;
  amount: string;
  perSlot: number | CapacitySetting;
  countWhere?: { column: string; values: string[] };
  slotMinutes: number | CapacitySetting;
  windowDays?: number | CapacitySetting;
  opens?: string | CapacitySetting;
  closes?: string | CapacitySetting;
  resource?: string;
  /** Hours before its time a guest may still cancel through the public API. */
  cancelHours?: number | CapacitySetting;
}

/** A weekly-hours table the booking guard reads: the weekday and `HH:MM` text times. */
export interface BookingHoursTable {
  /** The table's id in the snapshot. */
  table: string;
  weekday: string;
  opens: string;
  closes: string;
  breakStart?: string;
  breakEnd?: string;
}

/**
 * `table.booking`: booking PEOPLE. No two counted rows of one resource may
 * overlap, inside its weekly hours and outside its closures. Every nested
 * `table` is an id in the snapshot, mapped from the app's short names at
 * install.
 */
export interface TableBookingRule {
  start: string;
  minutes: string;
  resource: string;
  kind: string;
  countWhere: { column: string; values: string[] };
  eligible: {
    table: string;
    resource: string;
    kind: string;
    order?: { table: string; column: string; active?: string; public?: string };
  };
  hours: {
    practice: BookingHoursTable & { open?: string };
    own?: BookingHoursTable & { resource: string };
  };
  closures?: { table: string; from: string; to: string; resource?: string; active?: string };
  grid: number | CapacitySetting;
  windowDays?: number | CapacitySetting;
  noticeMinutes?: number | CapacitySetting;
  cancel?: {
    hours: number | CapacitySetting;
    mode: 'refuse' | 'flag';
    flag?: string;
    when: { column: string; to: string };
  };
}

/** `column.validation`: the checks an admin asked for, beyond the column's type. */
export interface ColumnValidation {
  format?: 'email' | 'url' | 'phone';
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
}

/** `column.requiredWhen`: another column of the row, and the values of it that make this one required. */
export interface ColumnRequiredWhen {
  column: string;
  in: (string | number | boolean)[];
}

export interface EffectiveColumn extends ColumnModel {
  label?: string;
  hidden?: boolean;
  /** Resolved mask state (overrides > classifier default). */
  masked?: boolean;
  enumLabels?: Record<string, string>;
  enumTones?: Record<string, string>;
  /*
   * ─── The four column rules (plan 50 phase C) ─────────────────────────────
   *
   * Unlike every other field here, these do not change what a reader SEES —
   * they change what the write path does, on every caller. They ride the
   * effective schema because that is what `ResolvedTable` already carries into
   * `crud/write-service.ts`, so a rule reaches the CSV import and the public
   * API without either of them knowing the rule exists.
   */
  fill?: ColumnFillRule;
  options?: ColumnOptions;
  /** An admin's `column.required`. The column's own NOT NULL is separate. */
  requiredByRule?: boolean;
  /** `column.requiredWhen`: required only while another column of the row holds one of `in`. */
  requiredWhen?: ColumnRequiredWhen;
  validation?: ColumnValidation;
  /*
   * ─── Decided by Adminium ────────────────────────────────────────────────
   *
   * Filled on every write whoever writes, and never publicly writable.
   */
  copy?: ColumnCopyRule;
  /** `column.sequence`: the next number in this column's own counter. */
  sequence?: ColumnSequenceRule;
  code?: ColumnCodeRule;
  rollup?: ColumnRollupRule;
  stamp?: ColumnStampRule;
  /** `column.format`: the text of a running number, prefixed and padded. */
  format?: ColumnFormatRule;
  /** `column.formula`: worked out from the row's other columns on every write. */
  formula?: FormulaExpr;
  /**
   * `column.scale`: the places a decimal keeps — a number, or `currency`: the
   * decimals of the row's own `currency` column, else the connection's.
   */
  scale?: number | 'currency';
  /** `column.venueLocal`: a wall time with no zone is read on the venue's clock. */
  venueLocal?: boolean;
  /** `column.normalize`: text stored trimmed (`trim`), or trimmed and in lower case (`email`). */
  normalize?: 'trim' | 'email';
  /** `column.bounds`: a date never later than today, never earlier than another date. */
  bounds?: { notAfter?: 'today'; notBefore?: { column: string; via?: string } };
}

export interface EffectiveTable extends Omit<TableModel, 'columns'> {
  columns: EffectiveColumn[];
  label?: string;
  labelPlural?: string;
  icon?: string;
  excluded?: boolean;
  keyField?: string;
  /** The booking guard (`table.capacity`). */
  capacity?: TableCapacityRule;
  /** Booking people (`table.booking`). */
  booking?: TableBookingRule;
  /**
   * A document's life (`table.states`). Carried in the model the dashboard
   * reads, so a record page draws a locked row's fields read-only: a field is
   * locked when the row's `states.column` is one of `lock.when` (or a row of
   * `lockedBy` points at it in one of its states) and the field is not in
   * `lock.except`.
   */
  states?: TableStatesRule;
  /** Rows of other tables that lock this table's rows (`lockedWhenReferencedBy`, resolved). */
  lockedBy?: LockedByReference[];
  /** The parents whose state this table's rows are tied to. */
  stateParents?: StateParent[];
}

export interface EffectiveRelation extends Relation {
  label?: string;
}

export interface EffectiveModel extends Omit<DatabaseModel, 'tables' | 'relations'> {
  tables: EffectiveTable[];
  relations: EffectiveRelation[];
}

function tableId(table: TableModel): string {
  return table.id;
}

/** Locale every connection resolves L10n bundles to in v1 (always required). */
const DEFAULT_LOCALE = 'en_US';

/** Resolve one locale→string map to `locale`, falling back to en_US. */
function resolveLocalized(map: unknown, locale: string): string | null {
  if (typeof map !== 'object' || map === null || Array.isArray(map)) return null;
  const rec = map as Record<string, unknown>;
  const candidate = rec[locale] ?? rec[DEFAULT_LOCALE];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

/**
 * Resolve a USER-authored label, which may be either shape.
 *
 * Until now a user rename was a bare string, so an operator who renamed
 * "Records" to "Patients" got one language forever — while `llm.label` rows
 * were already locale maps. That asymmetry is most of what "translations for
 * the micro-SaaS" means in practice, because data labels are the first thing
 * an operator changes.
 *
 * Both shapes are accepted permanently, not transitionally: a bare string is
 * the correct storage for a single-language workspace, and every existing row
 * is one. `''` keeps its established meaning of an explicit clear.
 */
function resolveUserLabel(value: unknown, locale: string): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null;
  return resolveLocalized(value, locale);
}

/**
 * A choice column's words for its values, in the reader's language.
 *
 * Each value's label takes either shape a user label does: a plain string (an
 * operator's, and every row an app wrote before it kept its labels in each
 * language) or a locale map, resolved like a column's name — theirs, else US
 * English. Both are read for good, so older rows need no migration. A value
 * with nothing to show for this reader is left out and reads as its raw value.
 */
export function resolveEnumLabels(labels: unknown, locale: string = DEFAULT_LOCALE): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof labels !== 'object' || labels === null || Array.isArray(labels)) return out;
  for (const [value, label] of Object.entries(labels as Record<string, unknown>)) {
    const text = resolveUserLabel(label, locale);
    if (text !== null) out[value] = text;
  }
  return out;
}

/**
 * A `column.options` rule with each value's word in the reader's language.
 *
 * An inline value's label takes the same two shapes a value label does — a
 * plain string, or one per locale an app installed — and resolves the same
 * way; a value with nothing to show for this reader loses its label and reads
 * as its raw value. A named list passes through: it is resolved where the
 * reader's language is known, from the list itself.
 */
export function resolveColumnOptions(value: unknown, locale: string = DEFAULT_LOCALE): ColumnOptions {
  const options = value as { list?: unknown; values?: unknown };
  if (!Array.isArray(options.values)) return value as ColumnOptions;
  return {
    values: (options.values as (Omit<ColumnOptionItem, 'label'> & { label?: unknown })[]).map(({ label, ...item }) => {
      const text = label === undefined ? null : resolveUserLabel(label, locale);
      return text === null ? item : { ...item, label: text };
    }),
  };
}

/**
 * Effective table-label map (`tableName` → label) from active override rows.
 * Provenance user > llm > heuristic: a user `table.label` row beats an
 * accepted `llm.label` bundle for the same table REGARDLESS of created_at
 * order; within one origin, later rows win. `llm.label` values are localized
 * bundles — resolved to the connection's default locale (en_US).
 *
 * Shared by {@link applyOverrides} (the read path) and the generation
 * pipeline (`generate/run.ts` overlays it onto the parsed model so generated
 * page titles — and through `adminium_pages`, the sidebar nav — carry
 * renames).
 */
export function activeTableLabels(
  overrides: readonly SchemaOverride[],
  defaultLocale: string = DEFAULT_LOCALE,
): Map<string, string> {
  const labels = new Map<string, string>();
  const userLabeled = new Set<string>();
  for (const row of overrides) {
    if (row.status !== 'active') continue;
    const op: string = row.op;
    if (op === 'table.label') {
      // ANY active user row locks the table against llm bundles — including a
      // degenerate empty label (the write path now rejects '', but legacy rows
      // may exist). '' acts as an explicit clear so later-row-wins holds
      // verbatim without ever emitting a label the engine's min(1) forbids.
      userLabeled.add(row.tableName);
      const label = resolveUserLabel(row.value.label, defaultLocale);
      if (label !== null) {
        labels.set(row.tableName, label);
      } else {
        labels.delete(row.tableName);
      }
    } else if (op === 'llm.label' && row.columnName === null && !userLabeled.has(row.tableName)) {
      const resolved = resolveLocalized(row.value.label, defaultLocale);
      if (resolved !== null) labels.set(row.tableName, resolved);
    }
  }
  return labels;
}

/** The engine's own tag set, for the ops that store one as a free string. */
const KNOWN_SEMANTIC_TAGS: ReadonlySet<string> = new Set(SEMANTIC_TAGS);

function isSemanticTag(value: unknown): value is SemanticTag {
  return typeof value === 'string' && KNOWN_SEMANTIC_TAGS.has(value);
}

/**
 * Stamp an asserted tag onto a column's semantics, keeping everything else the
 * classifier decided (flags, format, pair).
 *
 * `confidence: 1, source: 'override'` is the assertion itself: a human said so,
 * which is as certain as a declared fact and is the precedence marker every
 * downstream reader tests. Shared by the read path below and the composition
 * overlay above it so the two can never stamp differently.
 */
function stampSemantic(existing: ColumnSemantics | null, primary: SemanticTag): ColumnSemantics {
  const base: ColumnSemantics = existing ?? {
    primary,
    flags: { secret: false, pii: null, maskedByDefault: false },
    format: null,
    pair: null,
    confidence: 1,
    source: 'override',
  };
  return { ...base, primary, confidence: 1, source: 'override' };
}

/**
 * The tag each active `column.semanticType` row asserts, keyed
 * `tableName\u0000columnName`. Later rows win, as everywhere else here.
 *
 * A tag the engine does not know is DROPPED rather than stamped: the stored
 * payload types `semanticType` as a free string (`json-payloads.ts`), so this
 * is the only place the enum is enforced, and a junk tag reaching a candidate
 * rule silently changes which pages a table can back.
 *
 * Shared by {@link applyOverrides} (the read path) and
 * {@link applyColumnSemanticOverrides} (the composition path).
 */
export function activeColumnSemantics(
  overrides: readonly SchemaOverride[],
): Map<string, SemanticTag> {
  const tags = new Map<string, SemanticTag>();
  for (const row of overrides) {
    if (row.status !== 'active') continue;
    if ((row.op as string) !== 'column.semanticType' || row.columnName === null) continue;
    if (!isSemanticTag(row.value.semanticType)) continue;
    tags.set(`${row.tableName}\u0000${row.columnName}`, row.value.semanticType);
  }
  return tags;
}

/**
 * Overlay active column-semantic overrides onto a PARSED `DatabaseModel` — the
 * composition path's counterpart to {@link applyOverrides}.
 *
 * It cannot just call `applyOverrides`: that returns an `EffectiveModel`
 * carrying display-layer fields (`label`, `hidden`, `excluded`, …) that the
 * strict engine schema rejects, and it folds in ops composition has no business
 * seeing. What composition needs is exactly one thing — the column's semantic —
 * on a model that is still a `DatabaseModel`.
 *
 * The loop was open at the same end `applyAcceptedRelations` closed for
 * relations. An operator opened Studio's Column Inspector, tagged `date` as
 * `event-timestamp`, saved — and the calendar page still refused to compose,
 * because `composeForTable` and `generate/run.ts` both re-parsed the RAW
 * snapshot. The override changed what CRUD showed and nothing about what a page
 * could be built from. Everything below the call site was already correct:
 * `toClassifiedInput` (engine `generate/archetype.ts`) prefers a stamped
 * semantic whose `source` is not `heuristic` over the recomputed one, so
 * stamping here is the entire unlock.
 *
 * A row naming a column the schema has since dropped is skipped, the same way a
 * stale relation override is — drift must not fail a run. The model is returned
 * untouched, not cloned, when no row applies.
 */
export function applyColumnSemanticOverrides(
  model: DatabaseModel,
  overrides: readonly SchemaOverride[],
): DatabaseModel {
  const tags = activeColumnSemantics(overrides);
  if (tags.size === 0) return model;

  let changed = false;
  const tables = model.tables.map((table) => {
    let touched = false;
    const columns = table.columns.map((column) => {
      const tag = tags.get(`${table.id}\u0000${column.name}`);
      if (tag === undefined) return column;
      touched = true;
      return { ...column, semantics: stampSemantic(column.semantics, tag) };
    });
    if (!touched) return table;
    changed = true;
    return { ...table, columns };
  });
  return changed ? { ...model, tables } : model;
}

/**
 * The answers a column's `column.options` list gives, keyed
 * `tableName\u0000columnName`.
 *
 * Only the INLINE variant. `{ list: '<name>' }` names a shared list that lives
 * in settings, and resolving it needs a read this pure function does not have;
 * a column pointing at one keeps whatever values the database itself declares.
 */
function activeColumnOptionValues(
  overrides: readonly SchemaOverride[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const row of overrides) {
    if (row.status !== 'active') continue;
    if ((row.op as string) !== 'column.options' || row.columnName === null) continue;
    const values = (row.value as unknown as ColumnOptions | undefined);
    if (values === undefined || !('values' in values)) continue;
    const list = values.values
      .map((item) => item.value)
      .filter((value) => typeof value === 'string' && value.length > 0);
    if (list.length === 0) continue;
    out.set(`${row.tableName}\u0000${row.columnName}`, list);
  }
  return out;
}

/**
 * Project an admin's `column.options` list onto the model as a real enum.
 *
 * THIS IS THE SECOND HALF OF A REPAIR NOBODY WOULD HAVE SEEN FAIL. A board's
 * requirement reaches into the enum's VALUES, not just the column's semantic —
 * a `status` of `bronze|silver|gold` has the right type, the right semantic and
 * still no board. And `addColumns` cannot carry values: `AddColumn` holds a
 * `DesiredColumn`, and only `DesiredTable` has an `enumValues` map. So a repair
 * that adds a status column has exactly one channel for the values it must
 * hold, and it is this override.
 *
 * Without this projection that channel is a dead end. The candidate rules read
 * `enumValues` from `model.enums` through `column.enumRef`
 * (`generate/archetype.ts#enumValuesFor`) and have no idea `column.options`
 * exists, so the values would be stored, shown in every form, and invisible to
 * the one question the repair was performed to change. The operator would watch
 * a schema change succeed and the board still refuse.
 *
 * A column that ALREADY carries an `enumRef` is left alone: the database's own
 * enum or CHECK is the stronger statement, and an admin's answer list is a
 * display choice layered over it rather than a replacement for it.
 */
export function applyColumnOptionValues(
  model: DatabaseModel,
  overrides: readonly SchemaOverride[],
): DatabaseModel {
  const values = activeColumnOptionValues(overrides);
  if (values.size === 0) return model;

  const enums = [...model.enums];
  let changed = false;
  const tables = model.tables.map((table) => {
    let touched = false;
    const columns = table.columns.map((column) => {
      if (column.enumRef !== null) return column;
      const list = values.get(`${table.id}\u0000${column.name}`);
      if (list === undefined) return column;
      // `${tableId}.${column}` is the id shape the adapters already mint for a
      // CHECK-derived enum, so nothing downstream has to tell the two apart.
      const id = `${table.id}.${column.name}`;
      enums.push({ id, name: column.name, values: list, source: 'check' });
      touched = true;
      return { ...column, enumRef: id };
    });
    if (!touched) return table;
    changed = true;
    return { ...table, columns };
  });
  return changed ? { ...model, tables, enums } : model;
}

/**
 * Every override op that changes WHAT A PAGE CAN BE BUILT FROM, folded onto a
 * parsed model in one call.
 *
 * The distinction this name draws is the useful one. `applyOverrides` answers
 * "what should a reader see" and folds in labels, masks, hidden flags and write
 * rules — none of which composition may look at, and all of which turn the
 * model into a shape the strict engine schema rejects. This answers "what can
 * this table back", and its members are exactly the ops a candidate rule reads:
 * the column's semantic, and the values an enum column may hold.
 *
 * Both call sites (`composeForTable` and `generate/run.ts`) take this one, so a
 * new op that changes composition is added in one place and cannot reach one
 * path while missing the other — which is the bug both halves of this function
 * exist to fix.
 */
export function applyCompositionOverrides(
  model: DatabaseModel,
  overrides: readonly SchemaOverride[],
): DatabaseModel {
  return applyColumnOptionValues(applyColumnSemanticOverrides(model, overrides), overrides);
}

/**
 * The tables' and columns' own names — renames, and the names an app installed
 * — laid onto a model a page is composed from, so its headings, titles and
 * counts read "Reservations" and "Party size", not `pos_reservations` and
 * `party_size`.
 *
 * Resolved exactly as a reader's model resolves them ({@link applyOverrides},
 * provenance user > llm), in the connection's default locale: a stored page
 * holds one language.
 */
export function withEffectiveLabels(model: DatabaseModel, overrides: readonly SchemaOverride[]): DatabaseModel {
  const effective = new Map(applyOverrides(model, overrides).tables.map((table) => [table.id, table]));
  return {
    ...model,
    tables: model.tables.map((table) => {
      const named = effective.get(tableId(table));
      if (named === undefined) return table;
      const labels = new Map(named.columns.flatMap((column) => (column.label === undefined ? [] : [[column.name, column.label] as const])));
      // A composed title names the table as a collection: its plural, where it has one.
      const title = named.labelPlural ?? named.label;
      return {
        ...table,
        ...(title === undefined ? {} : { label: title }),
        columns: table.columns.map((column) => {
          const label = labels.get(column.name);
          return label === undefined ? column : { ...column, label };
        }),
      };
    }),
  };
}

/**
 * Fold the `relation.add` / `relation.remove` ops of a set of active
 * overrides onto a relation list, in created_at order (later-row-wins, so
 * add-then-remove and remove-then-add both mean what they read like).
 *
 * An accepted relation enters at `kind: 'override'`, `confidence: 1`: a human
 * decision is as certain as a declared foreign key, and outranks the 0.8 gate
 * every downstream detector applies. A removal matches STRUCTURALLY, on
 * (fromTable, fromColumn, toTable), not by id, which is what lets it suppress
 * a `declared-fk` and an `inferred-name` alike.
 *
 * Extracted from {@link applyOverrides} because the read path was the only
 * caller: `generate/run.ts` re-parsed the raw snapshot and never saw these
 * ops, so a relation a user accepted in the Studio remap editor showed up in
 * the schema browser and then vanished from the next regeneration. Both paths
 * now fold the same ops the same way.
 */
export function applyRelationOverrides(
  relations: readonly Relation[],
  overrides: readonly SchemaOverride[],
): Relation[] {
  let result: Relation[] = [...relations];
  for (const row of overrides) {
    if (row.status !== 'active') continue;
    const value: Record<string, unknown> = row.value;
    if ((row.op as string) === 'relation.add') {
      const from = row.tableName;
      const relation: Relation = {
        id: `override:${from}.${String(value.fromColumn)}->${String(value.toTable)}`,
        kind: 'override',
        cardinality:
          value.cardinality === 'many-to-one' ? 'one-to-many' : (value.cardinality as never),
        from: { tableId: from, columns: [value.fromColumn as string] },
        to: { tableId: value.toTable as string, columns: [value.toColumn as string] },
        through: null,
        onDelete: null,
        onUpdate: null,
        selfReferential: from === value.toTable,
        confidence: 1,
        // A virtual relation is a badge Adminium owns, not a row in the
        // customer's catalog — so there is no constraint name to carry, and
        // that absence is what tells a DDL plan it cannot DROP this one
        // .
        constraintName: null,
      };
      // An accepted relation SUPERSEDES the inferred one it was accepted
      // from: rule 1 emits `inferred-name:orders(customer_id)->customers(id)`
      // for the same pair, and keeping both would leave two edges between the
      // same two tables — a duplicate FK chip on every card, and a duplicated
      // join in the generated list page.
      result = [
        ...result.filter(
          (r) =>
            r.id !== relation.id &&
            !(
              r.through === null &&
              r.from.tableId === relation.from.tableId &&
              r.from.columns.length === 1 &&
              r.from.columns[0] === relation.from.columns[0] &&
              r.to.tableId === relation.to.tableId
            ),
        ),
        relation,
      ];
    } else if ((row.op as string) === 'relation.remove') {
      result = result.filter(
        (r) =>
          !(
            r.from.tableId === row.tableName &&
            r.from.columns.includes(value.fromColumn as string) &&
            r.to.tableId === value.toTable
          ),
      );
    }
  }
  return result;
}

export interface ApplyOverridesOptions {
  /**
   * The reader's locale (`de_DE`): the one every label kept in several
   * languages resolves to — names, `llm.label` bundles and a choice column's
   * value labels, its inline `column.options` words included. Absent, en_US.
   */
  defaultLocale?: string;
}

/**
 * Tie every table's states to the tables they reach: a table another's
 * `lockedWhenReferencedBy` names learns which rows lock it, and a child table
 * learns its parent's lock and states — so a write to one table can be
 * judged from that table alone, whichever door it comes through. A reference
 * to a table that is gone, or that keeps no states, ties nothing.
 */
function tieStates(tables: ReadonlyMap<string, EffectiveTable>): void {
  for (const table of tables.values()) {
    delete table.lockedBy;
    delete table.stateParents;
  }
  for (const table of tables.values()) {
    const states = table.states;
    if (states === undefined) continue;
    const lockedBy: LockedByReference[] = [];
    for (const ref of states.lockedWhenReferencedBy ?? []) {
      const column = tables.get(ref.table)?.states?.column;
      if (column !== undefined) lockedBy.push({ table: ref.table, via: ref.via, column, in: ref.in });
    }
    if (lockedBy.length > 0) table.lockedBy = lockedBy;
  }
  for (const table of tables.values()) {
    const states = table.states;
    const key = table.primaryKey[0];
    if (states === undefined || key === undefined || table.primaryKey.length !== 1) continue;
    for (const [childId, rule] of Object.entries(states.children ?? {})) {
      const child = tables.get(childId);
      if (child === undefined || !child.columns.some((c) => c.name === rule.via)) continue;
      (child.stateParents ??= []).push({
        table: tableId(table as TableModel),
        key,
        via: rule.via,
        column: states.column,
        lockedIn: states.lock?.when ?? [],
        lockedBy: table.lockedBy ?? [],
        ...(rule.lock === undefined ? {} : { lock: rule.lock }),
        ...(rule.parentIn === undefined ? {} : { parentIn: rule.parentIn }),
        ...(rule.clearOnCreate === undefined ? {} : { clearOnCreate: rule.clearOnCreate }),
      });
    }
  }
}

/**
 * Which columns are secrets, once every rule is in.
 *
 * The classifier guesses a secret from a column's name (`…token…`,
 * `…password…`), and a secret is carried by no response, to anyone. A column
 * with a `code` rule is not taken for one by its name: Adminium made its value
 * to be handed on — a studio's `share_token` is the link it sends — so the
 * rule wins over the guess, and the staff who read the table see it. What a
 * public caller is offered is decided apart (`public-api/endpoint.ts`,
 * `public-api/scope.ts`): a code is shown there only where an entry names it,
 * and a shared link's never.
 *
 * `column.secret` (an app's `secret`) says it outright, either way, over the
 * guess and the rule alike; a column the operator tagged `secret` stays one
 * whatever its rules. A column that is not a secret after all loses what the
 * guess made of it: its tag, and the mask introspection wrote for it — a mask
 * a person or an app wrote, or one for a kind of personal data, stays.
 */
function settleSecrets(
  tables: Iterable<EffectiveTable>,
  said: ReadonlyMap<EffectiveColumn, boolean>,
  maskedForSecret: ReadonlySet<EffectiveColumn>,
): void {
  for (const table of tables) {
    for (const column of table.columns) {
      const semantics = column.semantics ?? null;
      const guessed = semantics !== null && (semantics.flags.secret || semantics.primary === 'secret');
      const tagged = semantics?.primary === 'secret' && semantics.source === 'override';
      const secret = said.get(column) ?? (tagged || (guessed && column.code === undefined));
      if (secret) {
        if (!guessed || semantics?.flags.secret !== true) {
          column.semantics = {
            ...(semantics ?? { primary: 'secret', format: null, pair: null, confidence: 1, source: 'override' }),
            flags: { pii: semantics?.flags.pii ?? null, secret: true, maskedByDefault: true },
          };
        }
        continue;
      }
      if (semantics === null || !guessed) continue;
      column.semantics = {
        ...semantics,
        primary: semantics.primary === 'secret' ? 'plain' : semantics.primary,
        flags: { ...semantics.flags, secret: false, maskedByDefault: semantics.flags.pii !== null && semantics.flags.maskedByDefault },
      };
      if (maskedForSecret.has(column)) delete column.masked;
    }
  }
}

/** Apply active override rows (already in created_at order) onto a snapshot model. */
export function applyOverrides(
  model: DatabaseModel,
  overrides: readonly SchemaOverride[],
  opts: ApplyOverridesOptions = {},
): EffectiveModel {
  const locale = opts.defaultLocale ?? DEFAULT_LOCALE;
  const effective = structuredClone(model) as unknown as EffectiveModel;
  // Relation add/remove resolves up-front from the ONE shared resolver
  // (`generate/run.ts` calls the same one), so `relation.label` below labels
  // the final set regardless of the order the two rows were written in.
  effective.relations = applyRelationOverrides(effective.relations, overrides);
  const tables = new Map<string, EffectiveTable>(effective.tables.map((t) => [tableId(t as TableModel), t]));
  const columnOf = (table: EffectiveTable | undefined, name: string | null): EffectiveColumn | undefined =>
    table?.columns.find((c) => c.name === name);
  // What `column.secret` says of a column, and the masks introspection wrote for a secret guess alone.
  const secretSaid = new Map<EffectiveColumn, boolean>();
  const maskedForSecret = new Set<EffectiveColumn>();

  // Provenance user > llm for COLUMN labels too: a user `column.label` row
  // locks its column against the llm bundle regardless of created_at order.
  const userLabeledColumns = new Set<string>();
  for (const row of overrides) {
    if (row.status === 'active' && (row.op as string) === 'column.label' && row.columnName !== null) {
      userLabeledColumns.add(`${row.tableName}\u0000${row.columnName}`);
    }
  }

  for (const row of overrides) {
    if (row.status !== 'active') continue;
    const table = tables.get(row.tableName);
    const value: Record<string, unknown> = row.value;
    switch (row.op as string) {
      case 'table.label': {
        if (table === undefined) break;
        // Empty label = explicit clear (legacy rows only — the write path
        // rejects ''); mirrors activeTableLabels so both paths agree. A
        // locale map resolves for the viewer's locale.
        const label = resolveUserLabel(value.label, locale);
        if (label !== null) table.label = label;
        else delete table.label;
        const plural = resolveUserLabel(value.labelPlural, locale);
        if (plural !== null) table.labelPlural = plural;
        if (typeof value.icon === 'string') table.icon = value.icon;
        break;
      }
      case 'table.exclude': {
        if (table !== undefined) table.excluded = value.excluded === true;
        break;
      }
      case 'table.keyField': {
        if (table !== undefined) table.keyField = value.column as string;
        break;
      }
      case 'table.capacity': {
        if (table !== undefined) table.capacity = value as unknown as TableCapacityRule;
        break;
      }
      case 'table.booking': {
        if (table !== undefined) table.booking = value as unknown as TableBookingRule;
        break;
      }
      case 'table.states': {
        if (table !== undefined) table.states = value as unknown as TableStatesRule;
        break;
      }
      case 'column.normalize': {
        const column = columnOf(table, row.columnName);
        if (column !== undefined) column.normalize = value.normalize as 'trim' | 'email';
        break;
      }
      case 'column.bounds': {
        const column = columnOf(table, row.columnName);
        if (column !== undefined) column.bounds = value as NonNullable<EffectiveColumn['bounds']>;
        break;
      }
      case 'column.venueLocal': {
        const column = columnOf(table, row.columnName);
        if (column !== undefined) column.venueLocal = value.venueLocal === true;
        break;
      }
      case 'column.rollup': {
        const column = columnOf(table, row.columnName);
        if (column !== undefined) column.rollup = value as unknown as ColumnRollupRule;
        break;
      }
      case 'column.stamp': {
        const column = columnOf(table, row.columnName);
        if (column !== undefined) column.stamp = value as unknown as ColumnStampRule;
        break;
      }
      case 'column.label': {
        const column = columnOf(table, row.columnName);
        if (column === undefined) break;
        // Same '' = explicit clear normalization as table.label, and the same
        // both-shapes resolution; the row still locks the column against llm
        // bundles via userLabeledColumns.
        const label = resolveUserLabel(value.label, locale);
        if (label !== null) column.label = label;
        else delete column.label;
        break;
      }
      case 'column.semanticType': {
        const column = columnOf(table, row.columnName);
        if (column === undefined) break;
        // The guard is new: the value was cast straight through before, so a
        // junk tag became `semantics.primary` in the reply. Both paths now
        // drop it, because only one of them could and they must agree.
        if (!isSemanticTag(value.semanticType)) break;
        column.semantics = stampSemantic(column.semantics, value.semanticType);
        break;
      }
      case 'column.enumLabels': {
        const column = columnOf(table, row.columnName);
        if (column === undefined) break;
        column.enumLabels = resolveEnumLabels(value.labels, locale);
        if (value.tones !== undefined) column.enumTones = value.tones as Record<string, string>;
        break;
      }
      case 'column.pii': {
        const column = columnOf(table, row.columnName);
        if (column === undefined) break;
        column.masked = value.masked === true;
        // Introspection masks every column its classifier guessed a secret, naming no kind of personal data.
        if (row.origin === 'auto' && value.masked === true && typeof value.kind !== 'string') maskedForSecret.add(column);
        else maskedForSecret.delete(column);
        if (column.semantics !== null && typeof value.kind === 'string') {
          column.semantics = {
            ...column.semantics,
            flags: { ...column.semantics.flags, pii: value.kind as never, maskedByDefault: value.masked === true },
          };
        }
        break;
      }
      case 'column.hidden': {
        const column = columnOf(table, row.columnName);
        if (column !== undefined) column.hidden = value.hidden === true;
        break;
      }
      case 'column.secret': {
        const column = columnOf(table, row.columnName);
        if (column !== undefined) secretSaid.set(column, value.secret === true);
        break;
      }
      case 'column.default': {
        const column = columnOf(table, row.columnName);
        if (column !== undefined) column.fill = value as unknown as ColumnFillRule;
        break;
      }
      case 'column.options': {
        const column = columnOf(table, row.columnName);
        if (column !== undefined) column.options = resolveColumnOptions(value, locale);
        break;
      }
      case 'column.required': {
        const column = columnOf(table, row.columnName);
        // Only `true` is storable, so the row's presence IS the rule.
        if (column !== undefined) column.requiredByRule = value.required === true;
        break;
      }
      case 'column.requiredWhen': {
        const column = columnOf(table, row.columnName);
        if (column !== undefined) column.requiredWhen = value as unknown as ColumnRequiredWhen;
        break;
      }
      case 'column.validation': {
        const column = columnOf(table, row.columnName);
        if (column !== undefined) column.validation = value as unknown as ColumnValidation;
        break;
      }
      case 'column.copy': {
        const column = columnOf(table, row.columnName);
        if (column !== undefined) column.copy = value as unknown as ColumnCopyRule;
        break;
      }
      case 'column.sequence': {
        const column = columnOf(table, row.columnName);
        if (column !== undefined) column.sequence = value as unknown as ColumnSequenceRule;
        break;
      }
      case 'column.format': {
        const column = columnOf(table, row.columnName);
        if (column !== undefined) column.format = value as unknown as ColumnFormatRule;
        break;
      }
      case 'column.formula': {
        const column = columnOf(table, row.columnName);
        if (column !== undefined) column.formula = value.formula as FormulaExpr;
        break;
      }
      case 'column.scale': {
        const column = columnOf(table, row.columnName);
        if (column !== undefined) column.scale = value.scale as number | 'currency';
        break;
      }
      case 'column.code': {
        const column = columnOf(table, row.columnName);
        if (column !== undefined) column.code = value as unknown as ColumnCodeRule;
        break;
      }
      case 'llm.label': {
        // The label bundle (origin 'llm'): `value.label` is a locale→string
        // map; table-scoped when columnName is null, column-scoped otherwise.
        // Silently skipped before M11 — the accepted rename never reached the
        // effective model. TABLE labels are folded in by the post-loop
        // `activeTableLabels` pass (single home for the user>llm precedence);
        // only the column scope is handled here.
        if (row.columnName === null) break;
        if (userLabeledColumns.has(`${row.tableName}\u0000${row.columnName}`)) break;
        const column = columnOf(table, row.columnName);
        if (column === undefined) break;
        const resolved = resolveLocalized(value.label, locale);
        if (resolved !== null) column.label = resolved;
        break;
      }
      case 'relation.label': {
        const relation = effective.relations.find(
          (r) => r.from.tableId === row.tableName && r.from.columns.includes(value.fromColumn as string),
        );
        if (relation !== undefined) relation.label = value.label as string;
        break;
      }
    }
  }

  settleSecrets(tables.values(), secretSaid, maskedForSecret);
  tieStates(tables);

  // Table labels last, from the ONE precedence-aware resolver — a user
  // `table.label` beats an accepted `llm.label` bundle whichever came first.
  for (const [name, label] of activeTableLabels(overrides, locale)) {
    const table = tables.get(name);
    if (table !== undefined) table.label = label;
  }

  return effective;
}

/**
 * Column mask/secret resolution for the serialization layer. Source of
 * truth: `column.pii` override rows; classifier `maskedByDefault` fills in
 * when no row targets the column. `secret` columns are hard-excluded and
 * not unmaskable.
 */
export interface TableColumnPolicy {
  masked: ReadonlySet<string>;
  secret: ReadonlySet<string>;
}

export function columnPolicyFor(table: EffectiveTable): TableColumnPolicy {
  const masked = new Set<string>();
  const secret = new Set<string>();
  for (const column of table.columns) {
    const semantics = column.semantics;
    if (semantics?.flags.secret === true || semantics?.primary === 'secret') {
      secret.add(column.name);
      continue;
    }
    const maskedByOverride = column.masked;
    const maskedByDefault = semantics?.flags.maskedByDefault === true;
    if (maskedByOverride ?? maskedByDefault) masked.add(column.name);
  }
  return { masked, secret };
}
