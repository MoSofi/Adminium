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
 * a rule the operator changed, switched off or deleted is theirs from then on.
 *
 * The rules written are the four an operator can set in the column inspector
 * — the allowed values, the labels of a database enum, required and
 * validation — and the ones Adminium decides for every write: a copied price,
 * a running number, a code, a stamp. A total over child rows joins them with the
 * write path's rollup. The app's names for its tables and columns — in every
 * language it speaks — and the column that names a row where another links to
 * it are written the same way: the operator's rename wins, and an unchanged
 * one goes with the app.
 *
 * An app's option list is installed once as `<appKey>-<name>`: the operator
 * may edit it like any other, so a later version never overwrites it, and a
 * list of that key made by anyone else is left alone.
 */
import { createHash } from 'node:crypto';

import { parseDatabaseModel, parseEnumCheck, type ColumnModel, type DatabaseModel } from '@adminium/engine';
import type { BookingRule, ColumnRules, Manifest } from '@adminium/manifest';
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

import { canonicalJson } from './sample-data.js';
import { bookingRuleIssue, capacityRuleIssue, columnRuleIssue } from '../connections/column-rules-validation.js';

type RuleOp =
  | 'column.options'
  | 'column.enumLabels'
  | 'column.required'
  | 'column.validation'
  | 'column.copy'
  | 'column.sequence'
  | 'column.code'
  | 'column.rollup'
  | 'column.venueLocal'
  | 'column.stamp'
  | 'column.pii'
  | 'column.label'
  | 'table.capacity'
  | 'table.booking'
  | 'table.label'
  | 'table.keyField';

/** Ops that name things rather than rule a write: no column-rule check applies. */
const NAMING_OPS: ReadonlySet<RuleOp> = new Set(['column.label', 'table.label', 'table.keyField']);
/** Ops that belong to the table, not one of its columns. */
const TABLE_OPS: ReadonlySet<RuleOp> = new Set(['table.capacity', 'table.booking', 'table.label', 'table.keyField']);

interface DesiredRule {
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
  if (rules.validation !== undefined) out.push({ op: 'column.validation', value: { ...rules.validation } });
  if (rules.copy !== undefined) out.push({ op: 'column.copy', value: { ...rules.copy } });
  if (rules.sequence !== undefined) out.push({ op: 'column.sequence', value: { ...rules.sequence } });
  if (rules.code !== undefined) out.push({ op: 'column.code', value: { ...rules.code } });
  // `from` names the child by its short ref; the installer swaps in its real id.
  if (rules.rollup !== undefined) out.push({ op: 'column.rollup', value: { ...rules.rollup } });
  if (rules.venueLocal === true) out.push({ op: 'column.venueLocal', value: { venueLocal: true } });
  if (rules.stamp !== undefined) out.push({ op: 'column.stamp', value: { ...rules.stamp } });
  if (rules.personal !== undefined) out.push({ op: 'column.pii', value: { masked: rules.personal } });
  return out;
}

/**
 * A booking rule as it is stored: every table it names — top-level or nested
 * (who does what, the order, both hours tables, the closures, each number read
 * from the settings row) — replaced by the real table's id, so a prefixed
 * install never queries a short name.
 */
export function bookingValue(booking: BookingRule, realId: (ref: string) => string): Record<string, unknown> {
  const setting = <T>(value: T): T =>
    typeof value === 'object' && value !== null && 'table' in value
      ? ({ ...value, table: realId((value as { table: string }).table) } as T)
      : value;
  const { eligible, hours, closures, cancel } = booking;
  return {
    ...booking,
    eligible: {
      ...eligible,
      table: realId(eligible.table),
      ...(eligible.order === undefined ? {} : { order: { ...eligible.order, table: realId(eligible.order.table) } }),
    },
    hours: {
      practice: { ...hours.practice, table: realId(hours.practice.table) },
      ...(hours.own === undefined ? {} : { own: { ...hours.own, table: realId(hours.own.table) } }),
    },
    ...(closures === undefined ? {} : { closures: { ...closures, table: realId(closures.table) } }),
    grid: setting(booking.grid),
    ...(booking.windowDays === undefined ? {} : { windowDays: setting(booking.windowDays) }),
    ...(booking.noticeMinutes === undefined ? {} : { noticeMinutes: setting(booking.noticeMinutes) }),
    ...(cancel === undefined ? {} : { cancel: { ...cancel, hours: setting(cancel.hours) } }),
  };
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
  /** A setting `{table: <ref>, column}` pointed at the real table. */
  const settingOf = (value: unknown) =>
    typeof value === 'object' && value !== null && 'table' in value
      ? { ...(value as { table: string; column: string }), table: realId((value as { table: string }).table) }
      : value;
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
      if (column.rules === undefined) continue;
      for (const rule of opsForRules(manifest.key, column.rules)) {
        const value =
          rule.op === 'column.rollup' ? { ...rule.value, from: realOf(String(rule.value['from']))?.id ?? '' } : rule.value;
        desired.push({ ref: table.ref, table: real.id, column: column.ref, op: rule.op, value });
      }
    }
    if (table.capacity !== undefined) {
      const value = Object.fromEntries(Object.entries(table.capacity).map(([key, setting]) => [key, settingOf(setting)]));
      desired.push({ ref: table.ref, table: real.id, column: '', op: 'table.capacity', value });
    }
    if (table.booking !== undefined) {
      desired.push({ ref: table.ref, table: real.id, column: '', op: 'table.booking', value: bookingValue(table.booking, realId) });
    }
  }

  const overrides = overridesRepo(meta);
  const all = await overrides.listForConnection(connectionId);
  const active = all.filter((o) => o.status === 'active');
  const byId = new Map(all.map((o) => [o.id, o]));
  const knownLists = new Set((await lists.list()).map((list) => list.key));
  const wanted = new Map(desired.map((rule) => [targetOf(rule.op, rule.table, rule.column), rule]));

  for (const record of records) {
    const kept: AppTableRule[] = [];
    // Rules an earlier version wrote: kept, replaced, or taken back — only
    // while they are still the app's.
    for (const rule of record.rules) {
      const row = stillOurs(rule, byId, active);
      if (row === null) continue; // the operator's now
      const want = wanted.get(targetOf(rule.op, rule.table, rule.column));
      if (want !== undefined && ruleHash(want.value) === rule.valueHash) {
        kept.push({ ...rule, overrideId: row.id });
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
      const held = active.find((o) => targetOf(o.op, o.tableName, o.columnName) === target);
      if (held !== undefined && held.origin !== 'auto') {
        skip('The operator already keeps a rule for this column.');
        continue;
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
      if (rule.op === 'table.capacity' || rule.op === 'table.booking') {
        const issue = (rule.op === 'table.capacity' ? capacityRuleIssue : bookingRuleIssue)(rule.value, table, model);
        if (issue !== null) {
          skip(issue);
          continue;
        }
      } else if (!NAMING_OPS.has(rule.op) && rule.op !== 'column.enumLabels' && rule.op !== 'column.pii' && column !== undefined) {
        const issue = columnRuleIssue(
          rule.op as Exclude<RuleOp, 'column.enumLabels' | 'column.pii' | 'column.label' | 'table.capacity' | 'table.booking' | 'table.label' | 'table.keyField'>,
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
      kept.push({ op: rule.op, table: rule.table, column: rule.column, valueHash: ruleHash(rule.value), overrideId: row.id });
      result.written += 1;
    }
    await appTablesRepo(meta).setRules(record.id, kept);
  }
  return result;
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
