// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The column rules and option lists an app's manifest asks for, written as
 * the operator's own would be — and taken back only while they are still
 * the app's.
 *
 * A rule becomes one override row, created one at a time (never the
 * replace-all save), with origin `app`. The operator always wins: a rule is
 * skipped when they already keep one for the same column, and each rule the
 * app writes is recorded on its table's record with a hash of its value. An
 * update or an uninstall touches a rule only while that hash still matches;
 * a rule the operator changed, switched off or deleted is theirs from then on
 * — and stays theirs: the record keeps it as `released`, so no later version
 * writes it back (a switched-off rule has no active row to say so, and a
 * deleted one no row at all).
 *
 * A table built on an add-on's shape carries the shape's rules the same way,
 * each recorded with the add-on it comes from (`shape`), so the column
 * inspector can say "Set by …" and ask before one is switched off.
 *
 * The rules written are the four an operator can set in the column inspector
 * — the allowed values, the labels of a database enum, required and
 * validation — and the ones Adminium decides for every write: a copied price,
 * a running number, a code, a stamp, a value worked out by a formula, a
 * prefixed number, a fill from a setting. A total over child rows joins them
 * with the write path's rollup, and a document's states with the table's
 * booking and capacity guards.
 *
 * EVERY TABLE A RULE NAMES IS STORED BY ITS REAL ID. A rule names tables at
 * any depth — a rollup's child, the settings row a number starts from, the
 * child tables a state locks, the rows a fingerprint covers — and an app with
 * prefixed tables writes them all by their short names. One mapper
 * (`realRuleValue`) rewrites each of them, so no rule ever queries a table by
 * a name that does not exist, and the live-model checks below refuse one it
 * cannot find. The app's names for its tables and columns — in every
 * language it speaks — and the column that names a row where another links to
 * it are written the same way: the operator's rename wins, and an unchanged
 * one goes with the app.
 *
 * A RULE NEVER SHOWS A SECRET OF A TABLE THE APP DID NOT MAKE. A `secret:
 * false` (or any rule that would take a column out of the secrets, or take
 * a personal column's mask off) is written only on a table this app's
 * install created; on a table it reuses — a `users` table with its
 * `api_token`, another app's table — it is skipped, with a sentence, and
 * only an operator can show the column, in Studio, as Super Admin. Judged
 * the way the Studio guards judge a save: what the whole table keeps from
 * its readers before the rule and after it. A table the app created gets
 * one more: the code its shared link opens a row with (`claim: { by:
 * 'token' }`) is shown to the staff who read the table — the desk copies the
 * link it hands over — unless the manifest says otherwise.
 *
 * An app's option list is installed once as `<appKey>-<name>`: the operator
 * may edit it like any other, so a later version never overwrites it, and a
 * list of that key made by anyone else is left alone.
 */
import { createHash } from 'node:crypto';

import { parseDatabaseModel, parseEnumCheck, type ColumnModel, type DatabaseModel } from '@adminium/engine';
import { shareCodeColumns, type BookingRule, type ColumnRules, type Manifest, type States } from '@adminium/manifest';
import {
  MetaValidationError,
  appTablesRepo,
  optionListsRepo,
  overridesRepo,
  snapshotsRepo,
  validateOverrideInput,
  type AppTableRecord,
  type AppTableRule,
  type MetaDb,
  type SchemaOverride,
} from '@adminium/meta';

import { installedShapes } from '../documents/app-profiles.js';
import { canonicalJson } from './sample-data.js';
import { mapTableRefs } from './real-refs.js';
import { bookingRuleIssue, capacityRuleIssue, columnRuleIssue, statesRuleIssue } from '../connections/column-rules-validation.js';
import { columnsShown } from '../connections/effective-schema.js';
import { roleSlugFor } from './manifest-roles.js';

export type RuleOp =
  | 'column.options'
  | 'column.enumLabels'
  | 'column.required'
  | 'column.requiredWhen'
  | 'column.validation'
  | 'column.copy'
  | 'column.sequence'
  | 'column.code'
  | 'column.rollup'
  | 'column.venueLocal'
  | 'column.stamp'
  | 'column.default'
  | 'column.format'
  | 'column.formula'
  | 'column.scale'
  | 'column.normalize'
  | 'column.bounds'
  | 'column.pii'
  | 'column.secret'
  | 'column.label'
  | 'table.capacity'
  | 'table.booking'
  | 'table.states'
  | 'table.label'
  | 'table.keyField';

/** Ops that name things rather than rule a write: no column-rule check applies. */
const NAMING_OPS: ReadonlySet<RuleOp> = new Set(['column.label', 'table.label', 'table.keyField']);
/** Ops that belong to the table, not one of its columns. */
const TABLE_OPS: ReadonlySet<RuleOp> = new Set(['table.capacity', 'table.booking', 'table.states', 'table.label', 'table.keyField']);

interface DesiredRule {
  /** Written only on a table this app created, and silently left out elsewhere (Adminium asks it, not the manifest). */
  ownTableOnly?: true;
  /** The add-on whose shape owns the rule (the table is built on it). */
  shape?: string;
  /** Table refs the rule names that this install does not have: it is skipped, by name. */
  missing?: string[];
  ref: string;
  /** The real table's id in the snapshot (`public.pos_menu_items`). */
  table: string;
  column: string;
  op: RuleOp;
  value: Record<string, unknown>;
}

export interface RuleSkip {
  table: string;
  column: string;
  op: string;
  reason: string;
}

export interface RulesResult {
  written: number;
  /** Rules the operator already keeps, or the database cannot. */
  skipped: RuleSkip[];
  /** The app's own rules a new version no longer asks for. */
  removed: number;
  /** Option lists installed now. */
  lists: string[];
}

/** One label out of a manifest's `text | {bcp47: text}`: the store keeps one. */
function oneLabel(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const labels = value as Record<string, string>;
    return labels['en-US'] ?? labels['en'] ?? Object.values(labels)[0];
  }
  return undefined;
}

/**
 * A manifest's `text | {bcp47: text}` as the store keeps a label: the string
 * as it is, or the map keyed the way Adminium's locales are (`en-US` →
 * `en_US`), so each reader gets their own language.
 */
export function storedLabel(value: string | Record<string, string>): string | Record<string, string> {
  if (typeof value === 'string') return value;
  return Object.fromEntries(Object.entries(value).map(([tag, text]) => [tag.replace('-', '_'), text]));
}

export function listKeyFor(appKey: string, name: string): string {
  return name.startsWith('builtin:') ? name : `${appKey}-${name}`;
}

/** The override rows one column's manifest rules become. */
export function opsForRules(appKey: string, rules: ColumnRules): { op: RuleOp; value: Record<string, unknown> }[] {
  const out: { op: RuleOp; value: Record<string, unknown> }[] = [];
  if (rules.options !== undefined) {
    out.push({
      op: 'column.options',
      value:
        'list' in rules.options
          ? { list: listKeyFor(appKey, rules.options.list) }
          : {
              // Each value's word kept in every language the app gives, as a
              // choice column's value labels are: "Bar" to a German reader.
              values: rules.options.values.map((item) => ({
                value: item.value,
                ...(item.label === undefined ? {} : { label: storedLabel(item.label) }),
                ...(item.tone === undefined ? {} : { tone: item.tone }),
              })),
            },
    });
  }
  if (rules.enumLabels !== undefined) {
    // Kept in every language the app gives, as a column's name is, so a
    // status reads "Wartend" to a German reader and "Waiting" to an English one.
    const labels: Record<string, string | Record<string, string>> = {};
    for (const [value, label] of Object.entries(rules.enumLabels.labels)) labels[value] = storedLabel(label);
    out.push({
      op: 'column.enumLabels',
      value: { labels, ...(rules.enumLabels.tones === undefined ? {} : { tones: rules.enumLabels.tones }) },
    });
  }
  if (rules.required === true) out.push({ op: 'column.required', value: { required: true } });
  if (rules.requiredWhen !== undefined) out.push({ op: 'column.requiredWhen', value: { column: rules.requiredWhen.column, in: [...rules.requiredWhen.in] } });
  if (rules.validation !== undefined) out.push({ op: 'column.validation', value: { ...rules.validation } });
  if (rules.copy !== undefined) out.push({ op: 'column.copy', value: { ...rules.copy } });
  if (rules.sequence !== undefined) out.push({ op: 'column.sequence', value: { ...rules.sequence } });
  if (rules.code !== undefined) out.push({ op: 'column.code', value: { ...rules.code } });
  // `from` names the child by its short ref; the installer swaps in its real id.
  if (rules.rollup !== undefined) out.push({ op: 'column.rollup', value: { ...rules.rollup } });
  if (rules.venueLocal === true) out.push({ op: 'column.venueLocal', value: { venueLocal: true } });
  if (rules.stamp !== undefined) out.push({ op: 'column.stamp', value: { ...rules.stamp } });
  if (rules.default !== undefined) out.push({ op: 'column.default', value: { kind: 'from', from: rules.default.from } });
  if (rules.format !== undefined) out.push({ op: 'column.format', value: { ...rules.format } });
  if (rules.formula !== undefined) out.push({ op: 'column.formula', value: { formula: rules.formula } });
  if (rules.normalize !== undefined) out.push({ op: 'column.normalize', value: { normalize: rules.normalize } });
  if (rules.notAfter !== undefined || rules.notBefore !== undefined) {
    out.push({
      op: 'column.bounds',
      value: { ...(rules.notAfter === undefined ? {} : { notAfter: rules.notAfter }), ...(rules.notBefore === undefined ? {} : { notBefore: { ...rules.notBefore } }) },
    });
  }
  if (rules.personal !== undefined) out.push({ op: 'column.pii', value: { masked: rules.personal } });
  if (rules.secret !== undefined) out.push({ op: 'column.secret', value: { secret: rules.secret } });
  return out;
}

/**
 * A booking rule as it is stored: every table it names — top-level or nested
 * (who does what, the order, both hours tables, the closures, each number read
 * from the settings row) — replaced by the real table's id, so a prefixed
 * install never queries a short name. The one mapper (`real-refs.ts`).
 */
export function bookingValue(booking: BookingRule, realId: (ref: string) => string): Record<string, unknown> {
  return mapTableRefs({ ...booking } as Record<string, unknown>, realId).value;
}

/** The properties that hold a table ref in one op's value, beside `table` and a `children` object. */
function refKeysOf(op: RuleOp): readonly string[] {
  return op === 'column.rollup' ? ['from'] : [];
}

/**
 * A rule's value with every table it names — at any depth — replaced by the
 * real table's id: a rollup's child, a `{table, column}` setting (an add-on's
 * setting names no table and is left as it is), the tables a fingerprint
 * reads, and every table a document's states tie to the state. The one
 * mapper (`real-refs.ts`), and the refs it could not find.
 */
export function realRuleRefs(
  op: RuleOp,
  value: Record<string, unknown>,
  realId: (ref: string) => string,
  /** The app's key: a move kept for some of its roles names their role slugs, as the people who hold them do. */
  appKey?: string,
): { value: Record<string, unknown>; missing: string[] } {
  if (NAMING_OPS.has(op)) return { value, missing: [] };
  const mapped = mapTableRefs(value, realId, { refKeys: refKeysOf(op) });
  if (op !== 'table.states' || appKey === undefined) return mapped;
  const states = mapped.value as unknown as States;
  const moves = Object.fromEntries(
    Object.entries(states.moves).map(([from, list]) => [
      from,
      list.map((move) => (typeof move === 'string' || move.roles === undefined ? move : { ...move, roles: move.roles.map((role) => roleSlugFor(appKey, role)) })),
    ]),
  );
  return { ...mapped, value: { ...states, moves } as unknown as Record<string, unknown> };
}

/** {@link realRuleRefs}, the value alone. */
export function realRuleValue(op: RuleOp, value: Record<string, unknown>, realId: (ref: string) => string, appKey?: string): Record<string, unknown> {
  return realRuleRefs(op, value, realId, appKey).value;
}

/** A rule's value, hashed the same however the store's JSON column ordered its keys. */
export function ruleHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

const targetOf = (op: string, table: string, column: string | null) => `${op}|${table}|${column ?? ''}`;

/**
 * The override a recorded rule became, if it is still the app's: found by
 * id, or — after a Studio save, which rewrites every row under a new id but
 * keeps its origin — by the same target, origin `app` and the same value.
 */
function stillOurs(rule: AppTableRule, byId: Map<string, SchemaOverride>, active: readonly SchemaOverride[]): SchemaOverride | null {
  if (rule.released === true) return null;
  const row =
    byId.get(rule.overrideId) ??
    active.find(
      (o) =>
        o.origin === 'app' &&
        targetOf(o.op, o.tableName, o.columnName) === targetOf(rule.op, rule.table, rule.column) &&
        ruleHash(o.value) === rule.valueHash,
    );
  if (row === undefined) return null;
  if (row.status !== 'active' || ruleHash(row.value) !== rule.valueHash) return null;
  return row;
}

async function latestModel(meta: MetaDb, connectionId: string): Promise<DatabaseModel | null> {
  const snapshot = await snapshotsRepo(meta).latest(connectionId);
  return snapshot === null ? null : parseDatabaseModel(snapshot.schema);
}

/**
 * The columns of one table kept from readers under `before` that are not
 * under `after`: a secret no longer one, or a personal column no longer
 * masked — what the Studio save's Super Admin guards judge, for one table.
 */
export function secretsLost(model: DatabaseModel, tableId: string, before: readonly SchemaOverride[], after: readonly SchemaOverride[]): string[] {
  const one = { ...model, tables: model.tables.filter((table) => table.id === tableId) };
  return columnsShown(one, before, after).map(([, column]) => column);
}

/**
 * The columns of `table` a rule would take out of the secrets: the table's
 * secrets under the active rules, and under them with this one written (in
 * place of the automatic row it replaces).
 */
export function secretsShownBy(
  model: DatabaseModel,
  active: readonly SchemaOverride[],
  rule: { connectionId: string; table: string; column: string; op: string; value: Record<string, unknown>; held?: SchemaOverride | undefined },
): string[] {
  const at = Date.now();
  const written = {
    id: 'ovr_candidate',
    connectionId: rule.connectionId,
    op: rule.op,
    tableName: rule.table,
    columnName: rule.column,
    value: rule.value,
    origin: 'app',
    status: 'active',
    llmRunId: null,
    createdBy: null,
    createdAt: at,
    updatedAt: at,
  } as SchemaOverride;
  return secretsLost(model, rule.table, active, [...active.filter((row) => row !== rule.held), written]);
}

/** Why a rule that would show a secret (or a masked column) of a table the app did not make is not written. */
function notOursToShow(tableName: string, columns: readonly string[]): string {
  const named = columns.map((column) => `"${tableName}.${column}"`).join(', ');
  return `It would show ${named}, which is kept from readers, on a table that was here before the app: only an operator can show it, in Studio, as Super Admin.`;
}

/**
 * What the check step says before an install: the rules of the manifest the
 * install will skip because they would show a secret (or a masked column) of
 * a table it reuses — asked of the latest snapshot and the rules as they
 * stand, as the install asks them.
 */
export async function rulesKeptBack(
  meta: MetaDb,
  manifest: Manifest,
  connectionId: string,
  reused: readonly { ref: string; tableName: string }[],
): Promise<{ table: string; column: string; message: string }[]> {
  if (manifest.kind !== 'app' || reused.length === 0) return [];
  const model = await latestModel(meta, connectionId);
  if (model === null) return [];
  const active = (await overridesRepo(meta).listForConnection(connectionId)).filter((o) => o.status === 'active');
  const out: { table: string; column: string; message: string }[] = [];
  for (const { ref, tableName } of reused) {
    const real = model.tables.find((t) => t.name === tableName);
    const table = manifest.requiredSchema?.tables.find((t) => t.ref === ref);
    if (real === undefined || table === undefined) continue;
    for (const column of table.columns) {
      if (column.rules === undefined || !real.columns.some((c) => c.name === column.ref)) continue;
      const shown = new Set<string>();
      for (const rule of opsForRules(manifest.key, column.rules)) {
        for (const name of secretsShownBy(model, active, { connectionId, table: real.id, column: column.ref, op: rule.op, value: rule.value })) shown.add(name);
      }
      if (shown.size > 0) out.push({ table: ref, column: column.ref, message: notOursToShow(real.name, [...shown]) });
    }
  }
  return out;
}

/**
 * Install the app's option lists, then write, replace and take back its
 * column rules against the latest snapshot. Run after the tables exist and
 * have been introspected, on install and on every update.
 */
export async function writeManifestRules(input: {
  meta: MetaDb;
  manifest: Manifest;
  connectionId: string;
  createdBy: string | null;
}): Promise<RulesResult> {
  const { meta, manifest, connectionId } = input;
  const result: RulesResult = { written: 0, skipped: [], removed: 0, lists: [] };
  if (manifest.kind !== 'app') return result;

  // ── option lists ──────────────────────────────────────────────────────
  const lists = optionListsRepo(meta);
  for (const [name, list] of Object.entries(manifest.optionLists ?? {})) {
    const key = listKeyFor(manifest.key, name);
    if ((await lists.findByKey(key)) !== null) continue;
    await lists.create({
      key,
      name: oneLabel(list.label) ?? name,
      origin: `app:${manifest.key}`,
      items: list.values.map((item) => {
        const label = oneLabel(item.label);
        return { value: item.value, ...(label === undefined ? {} : { label }), ...(item.tone === undefined ? {} : { tone: item.tone }) };
      }),
    });
    result.lists.push(key);
  }

  const model = await latestModel(meta, connectionId);
  const records = (await appTablesRepo(meta).forInstall(connectionId, manifest.key)).filter(
    (record) => record.role === 'app' && (record.state === 'created' || record.state === 'adopted' || record.state === 'shared'),
  );
  if (model === null || records.length === 0) return result;

  // What this version asks for, against the real tables.
  const realOf = (ref: string) => {
    const record = records.find((r) => r.ref === ref);
    return record === undefined ? undefined : model.tables.find((t) => t.name === record.tableName);
  };
  /** An app table's short name → its id in the snapshot; '' when it is not there (the check refuses it). */
  const realId = (ref: string) => realOf(ref)?.id ?? '';
  /*
   * WHICH RULES A SHAPE OWNS. A table built on an add-on's shape spells out
   * the part's rules (the install checked they are the part's); each is
   * recorded with the add-on it comes from, so the inspector can say so.
   */
  const shapes = (manifest.requiredSchema?.tables ?? []).some((table) => table.builtOn !== undefined)
    ? (await installedShapes(meta)).byKey
    : new Map<string, never>();
  const shapeOwned = (table: (typeof manifest.requiredSchema.tables)[number], column: string, op: RuleOp): string | undefined => {
    if (table.builtOn === undefined || table.part === undefined) return undefined;
    const part = shapes.get(table.builtOn)?.parts[table.part];
    if (part === undefined) return undefined;
    const addOn = table.builtOn.split('/')[0]!;
    if (op === 'table.states') return part.states === undefined ? undefined : addOn;
    const want = part.columns.find((c) => c.ref === column);
    if (want === undefined) return undefined;
    if (op === 'column.scale') return want.scale === undefined ? undefined : addOn;
    return opsForRules(manifest.key, (want.rules ?? {}) as ColumnRules).some((rule) => rule.op === op) ? addOn : undefined;
  };
  const desired: DesiredRule[] = [];
  for (const table of manifest.requiredSchema?.tables ?? []) {
    const real = realOf(table.ref);
    if (real === undefined) continue;
    if (table.label !== undefined) {
      const value = {
        label: storedLabel(table.label),
        ...(table.labelPlural === undefined ? {} : { labelPlural: storedLabel(table.labelPlural) }),
      };
      desired.push({ ref: table.ref, table: real.id, column: '', op: 'table.label', value });
    }
    if (table.keyField !== undefined) {
      desired.push({ ref: table.ref, table: real.id, column: '', op: 'table.keyField', value: { column: table.keyField } });
    }
    for (const column of table.columns) {
      if (column.label !== undefined) {
        desired.push({ ref: table.ref, table: real.id, column: column.ref, op: 'column.label', value: { label: storedLabel(column.label) } });
      }
      /*
       * A choice column that reached the database as plain text — an update
       * adds one to a table that exists as a varchar, since the schema door it
       * uses carries no value list — keeps its values as the allowed-values
       * rule, so every write is still held to them. A column the install made
       * has its CHECK, and a rule of the app's own wins. Its values' words go
       * with them, in every language the app gives.
       */
      const live = real.columns.find((c) => c.name === column.ref);
      const names = real.columns.map((c) => c.name);
      const checked =
        live !== undefined &&
        (live.logicalType === 'enum' || live.enumRef !== null || (real.checks ?? []).some((check) => parseEnumCheck(check.expression, names)?.column === column.ref));
      if (column.type === 'enum' && column.enum !== undefined && column.rules?.options === undefined && live !== undefined && !checked) {
        const labels = column.rules?.enumLabels?.labels ?? {};
        desired.push({
          ref: table.ref,
          table: real.id,
          column: column.ref,
          op: 'column.options',
          value: {
            values: column.enum.map((value) => {
              const label = labels[value];
              return { value, ...(label === undefined ? {} : { label: storedLabel(label) }) };
            }),
          },
        });
      }
      // The places a decimal keeps: SQLite stores every decimal as a REAL
      // and remembers none, so the rule carries them on every engine.
      if (column.scale !== undefined) {
        const shape = shapeOwned(table, column.ref, 'column.scale');
        desired.push({ ref: table.ref, table: real.id, column: column.ref, op: 'column.scale', value: { scale: column.scale }, ...(shape === undefined ? {} : { shape }) });
      }
      /*
       * `default: "now"` is filled by Adminium, on every create through every
       * door. On MySQL it has to be: the column is a `DATETIME`, which keeps
       * this server's wall clock, and the database — its session in UTC —
       * could only fill UTC's, so the table is made with no default there
       * (`renderDefault`). On every engine it lets what the create works out
       * read the moment: a visit's hours, counted from a start nobody typed.
       */
      if (column.default === 'now' && column.type === 'timestamptz' && column.rules?.default === undefined) {
        desired.push({ ref: table.ref, table: real.id, column: column.ref, op: 'column.default', value: { kind: 'now' } });
      }
      if (column.rules === undefined) continue;
      for (const rule of opsForRules(manifest.key, column.rules)) {
        const mapped = realRuleRefs(rule.op, rule.value, realId);
        const shape = shapeOwned(table, column.ref, rule.op);
        desired.push({
          ref: table.ref,
          table: real.id,
          column: column.ref,
          op: rule.op,
          value: mapped.value,
          missing: mapped.missing,
          ...(shape === undefined ? {} : { shape }),
        });
      }
    }
    // The code a shared link opens a row with: the desk's to hand over, on a table the app made (checked below).
    for (const ref of shareCodeColumns(manifest.publicAccess ?? [], table.ref)) {
      const declared = table.columns.find((column) => column.ref === ref);
      if (declared === undefined || declared.rules?.secret !== undefined) continue;
      desired.push({ ref: table.ref, table: real.id, column: ref, op: 'column.secret', value: { secret: false }, ownTableOnly: true });
    }
    for (const [op, value] of [
      ['table.capacity', table.capacity],
      ['table.booking', table.booking],
      ['table.states', table.states],
    ] as const) {
      if (value === undefined) continue;
      const mapped = realRuleRefs(op, { ...value } as Record<string, unknown>, realId, manifest.key);
      const shape = shapeOwned(table, '', op);
      desired.push({ ref: table.ref, table: real.id, column: '', op, value: mapped.value, missing: mapped.missing, ...(shape === undefined ? {} : { shape }) });
    }
  }

  const overrides = overridesRepo(meta);
  const all = await overrides.listForConnection(connectionId);
  const active = all.filter((o) => o.status === 'active');
  const byId = new Map(all.map((o) => [o.id, o]));
  const knownLists = new Set((await lists.list()).map((list) => list.key));
  const wanted = new Map(desired.map((rule) => [targetOf(rule.op, rule.table, rule.column), rule]));

  /** Targets whose rule the operator changed, switched off or removed: never written again. */
  const released = new Set<string>();
  for (const record of records) {
    const kept: AppTableRule[] = [];
    // Rules an earlier version wrote: kept, replaced, or taken back — only
    // while they are still the app's.
    for (const rule of record.rules) {
      const row = stillOurs(rule, byId, active);
      if (row === null) {
        // The operator's now, and from now on: kept as released, never written again.
        kept.push({ op: rule.op, table: rule.table, column: rule.column, valueHash: rule.valueHash, overrideId: rule.overrideId, released: true });
        released.add(targetOf(rule.op, rule.table, rule.column));
        continue;
      }
      const want = wanted.get(targetOf(rule.op, rule.table, rule.column));
      // One an earlier version wrote that shows a secret of a table the app did not make: taken back.
      const shows =
        record.state !== 'created' && !NAMING_OPS.has(rule.op as RuleOp) && !TABLE_OPS.has(rule.op as RuleOp) && secretsLost(model, rule.table, active.filter((o) => o !== row), active).length > 0;
      if (want !== undefined && ruleHash(want.value) === rule.valueHash && !shows) {
        kept.push({ ...rule, overrideId: row.id, ...(want.shape === undefined ? {} : { shape: want.shape }) });
        wanted.delete(targetOf(rule.op, rule.table, rule.column));
        continue;
      }
      await overrides.delete(row.id);
      if (want === undefined) result.removed += 1;
      // A changed rule is written again below, as a new one.
      const index = active.indexOf(row);
      if (index !== -1) active.splice(index, 1);
    }

    for (const rule of desired.filter((r) => r.ref === record.ref)) {
      const target = targetOf(rule.op, rule.table, rule.column);
      if (!wanted.has(target)) continue;
      wanted.delete(target);
      const skip = (reason: string) => result.skipped.push({ table: rule.table, column: rule.column, op: rule.op, reason });
      // The live-model check every nested ref gets: a table this install does
      // not have is never stored, whatever op names it.
      if ((rule.missing ?? []).length > 0) {
        skip(`It names ${(rule.missing ?? []).map((ref) => `"${ref}"`).join(', ')}, which this app does not have here.`);
        continue;
      }
      const held = active.find((o) => targetOf(o.op, o.tableName, o.columnName) === target);
      if (released.has(target)) {
        skip(
          held !== undefined
            ? 'The operator already keeps a rule for this column.'
            : all.some((o) => o.status === 'disabled' && targetOf(o.op, o.tableName, o.columnName) === target)
              ? 'The operator switched off the rule for this column.'
              : 'The operator removed the rule for this column.',
        );
        continue;
      }
      if (held !== undefined && held.origin !== 'auto') {
        skip('The operator already keeps a rule for this column.');
        continue;
      }
      // One the operator switched off is still theirs: never a second row beside it.
      if (all.some((o) => o.status === 'disabled' && o.origin !== 'auto' && targetOf(o.op, o.tableName, o.columnName) === target)) {
        skip('The operator switched off the rule for this column.');
        continue;
      }
      // A table the app did not make keeps its secrets: only an operator shows one.
      if (record.state !== 'created' && !NAMING_OPS.has(rule.op) && !TABLE_OPS.has(rule.op)) {
        if (rule.ownTableOnly === true) continue;
        const shown = secretsShownBy(model, active, { connectionId, table: rule.table, column: rule.column, op: rule.op, value: rule.value, held });
        if (shown.length > 0) {
          skip(notOursToShow(record.tableName, shown));
          continue;
        }
      }
      // Adminium's own guess (introspection masks a column named `phone`) is
      // not the operator's word: the app knows its own column better.
      if (held !== undefined) {
        await overrides.delete(held.id);
        active.splice(active.indexOf(held), 1);
      }
      const table = model.tables.find((t) => t.id === rule.table)!;
      // The booking guard, the names and the key field are the table's, not a column's.
      const tableLevel = TABLE_OPS.has(rule.op);
      const column: ColumnModel | undefined = table.columns.find((c) => c.name === rule.column);
      if (!tableLevel && column === undefined) {
        skip(`"${table.name}" has no column "${rule.column}".`);
        continue;
      }
      const request = {
        connectionId,
        op: rule.op,
        tableName: rule.table,
        columnName: tableLevel ? null : rule.column,
        value: rule.value,
        origin: 'app' as const,
        createdBy: input.createdBy,
      };
      try {
        validateOverrideInput(request);
      } catch (error) {
        if (error instanceof MetaValidationError) {
          skip(error.message);
          continue;
        }
        throw error;
      }
      if (rule.op === 'table.keyField' && !table.columns.some((c) => c.name === rule.value['column'])) {
        skip(`"${table.name}" has no column "${String(rule.value['column'])}".`);
        continue;
      }
      if (rule.op === 'table.capacity' || rule.op === 'table.booking' || rule.op === 'table.states') {
        const check = rule.op === 'table.capacity' ? capacityRuleIssue : rule.op === 'table.booking' ? bookingRuleIssue : statesRuleIssue;
        const issue = check(rule.value, table, model);
        if (issue !== null) {
          skip(issue);
          continue;
        }
      } else if (!NAMING_OPS.has(rule.op) && rule.op !== 'column.enumLabels' && rule.op !== 'column.pii' && rule.op !== 'column.secret' && column !== undefined) {
        const issue = columnRuleIssue(
          rule.op as Exclude<RuleOp, 'column.enumLabels' | 'column.pii' | 'column.secret' | 'column.label' | 'table.capacity' | 'table.booking' | 'table.states' | 'table.label' | 'table.keyField'>,
          rule.value,
          column,
          model,
          knownLists,
        );
        if (issue !== null) {
          skip(issue);
          continue;
        }
      }
      const row = await overrides.create(request);
      active.push(row);
      kept.push({
        op: rule.op,
        table: rule.table,
        column: rule.column,
        valueHash: ruleHash(rule.value),
        overrideId: row.id,
        ...(rule.shape === undefined ? {} : { shape: rule.shape }),
      });
      result.written += 1;
    }
    await appTablesRepo(meta).setRules(record.id, kept);
  }
  return result;
}

/** What stops being guaranteed when a shape's rule is switched off — the kind of promise it keeps. */
export type ShapeGuarantee = 'numbers' | 'totals' | 'edits' | 'kept';

export function guaranteeOf(op: string): ShapeGuarantee {
  if (op === 'column.sequence' || op === 'column.format') return 'numbers';
  if (op === 'column.formula' || op === 'column.rollup' || op === 'column.scale') return 'totals';
  if (op === 'table.states') return 'edits';
  return 'kept';
}

/**
 * The rules on this connection an add-on's shape set and nobody has changed
 * since: the column inspector labels each "Set by <add-on>" and asks before
 * one is switched off. Once changed, a rule is the operator's and leaves the
 * list.
 */
export async function shapeRules(
  meta: MetaDb,
  connectionId: string,
): Promise<{ tableName: string; columnName: string | null; op: string; addOn: string; guarantee: ShapeGuarantee }[]> {
  const all = await overridesRepo(meta).listForConnection(connectionId);
  const active = all.filter((o) => o.status === 'active');
  const byId = new Map(all.map((o) => [o.id, o]));
  const out: { tableName: string; columnName: string | null; op: string; addOn: string; guarantee: ShapeGuarantee }[] = [];
  for (const record of await appTablesRepo(meta).forConnection(connectionId)) {
    for (const rule of record.rules) {
      if (rule.shape === undefined) continue;
      const row = stillOurs(rule, byId, active);
      if (row === null) continue;
      out.push({ tableName: row.tableName, columnName: row.columnName, op: row.op, addOn: rule.shape, guarantee: guaranteeOf(row.op) });
    }
  }
  return out;
}

/** The app's rules that are still its own, for the uninstall dialog's count. */
export async function ownRules(meta: MetaDb, records: readonly AppTableRecord[], connectionId: string): Promise<SchemaOverride[]> {
  const all = await overridesRepo(meta).listForConnection(connectionId);
  const active = all.filter((o) => o.status === 'active');
  const byId = new Map(all.map((o) => [o.id, o]));
  return records.flatMap((record) => record.rules.flatMap((rule) => stillOurs(rule, byId, active) ?? []));
}

/**
 * Uninstall: take back the rules the app wrote that are still as it wrote
 * them. A rule the operator changed stays, as theirs.
 */
export async function removeManifestRules(meta: MetaDb, records: readonly AppTableRecord[], connectionId: string): Promise<number> {
  const rows = await ownRules(meta, records, connectionId);
  const overrides = overridesRepo(meta);
  for (const row of rows) await overrides.delete(row.id);
  for (const record of records) if (record.rules.length > 0) await appTablesRepo(meta).setRules(record.id, []);
  return rows.length;
}
