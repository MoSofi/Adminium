// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What `PUT …/schema/overrides` will accept as a COLUMN RULE, and what it
 * refuses by name.
 *
 * ─── Why the route checks more than the payload schema ─────────────────────
 *
 * `overridePatchSchema` proves the SHAPE: `kind` is one of six words, `min` is
 * a number. It cannot prove the rule is keepable, because it never sees the
 * column. A `now` fill on a `varchar` column parses perfectly and then writes
 * an ISO string into a name field on every insert; an option list on a column
 * whose values the database already fixes is a second, quieter source of truth
 * that the CHECK constraint will overrule at the worst possible moment.
 *
 * So each rule is checked against the column it names, in the live snapshot,
 * and a refused one comes back as a 422 that says which column and why —
 * never as a rule that is stored, shown in Studio, drawn in the form, and then
 * contradicted by the database.
 */
import { parseEnumCheck, type ColumnModel, type DatabaseModel, type LogicalType, type TableModel } from '@adminium/engine';
import { dayColumns, formulaColumns, formulaExprSchema, isChangeEffect, isJoinColumn, momentColumns, undoMoveIssues, type States } from '@adminium/manifest';

import { storedAdjust, storedPosting } from '@adminium/meta';
import { z } from 'zod';

import { columnPolicyFor, type EffectiveModel } from './effective-schema.js';

/**
 * Why a rule may not land a column that is kept from readers in this one, or
 * null. A `copy` of a linked row's column, a stamp that copies a column of its
 * row and a formula's inputs all put a value where the rules that keep it —
 * a secret left out of every answer, personal data masked, the code a shared
 * link opens its row with never shown — do not reach: past the Super Admin
 * gate on showing a secret, an install's word never to show one on a table it
 * reuses, the audit's and the outbox's redaction and the public refusals.
 * So the source must be kept no better than the column it lands in: a secret
 * in a secret, personal data in personal data or a secret. A shared link's
 * code lands nowhere.
 *
 * Judged on the model as the save leaves it (`applyOverrides`), with the
 * connection's share codes (`public-api/share-codes.ts`).
 */
export function keptColumnIssue(
  op: string,
  raw: unknown,
  at: { table: string; column: string },
  model: EffectiveModel,
  shareCodes: ReadonlyMap<string, ReadonlySet<string>>,
): string | null {
  const value = (raw ?? {}) as Value;
  const here = model.tables.find((table) => table.id === at.table);
  if (here === undefined) return null;
  const sources: { table: string; column: string }[] = [];
  if (op === 'column.copy' && typeof value['via'] === 'string' && typeof value['from'] === 'string') {
    const relation = model.relations.find((r) => r.through === null && r.from.tableId === at.table && r.from.columns.length === 1 && r.from.columns[0] === value['via']);
    if (relation !== undefined) sources.push({ table: relation.to.tableId, column: value['from'] });
  } else if (op === 'column.stamp') {
    const set = value['set'] as Value | string | undefined;
    if (typeof set === 'object' && set !== null && typeof set['copy'] === 'string') sources.push({ table: at.table, column: set['copy'] });
  } else if (op === 'column.formula') {
    const parsed = formulaExprSchema.safeParse(value['formula']);
    if (parsed.success) for (const column of formulaColumns(parsed.data)) sources.push({ table: at.table, column });
  }
  const into = columnPolicyFor(here);
  for (const source of sources) {
    const table = model.tables.find((candidate) => candidate.id === source.table);
    if (table === undefined || (source.table === at.table && source.column === at.column)) continue;
    const kept = columnPolicyFor(table);
    const named = JSON.stringify(`${table.name}.${source.column}`);
    const verb = op === 'column.formula' ? 'no formula reads it' : 'no column copies it';
    if (shareCodes.get(table.name)?.has(source.column) === true) return `${named} is the code a shared link opens its row with, so ${verb}.`;
    if (kept.secret.has(source.column) && !into.secret.has(at.column)) return `${named} is a secret, so ${verb} unless it is one too.`;
    if (kept.masked.has(source.column) && !into.masked.has(at.column) && !into.secret.has(at.column)) {
      return `${named} is personal data, so ${verb} unless it is marked personal too.`;
    }
  }
  return null;
}

/** The lists that live in code rather than the store (D6, Appendix D). */
export const BUILTIN_OPTION_LISTS = ['builtin:countries', 'builtin:us-states', 'builtin:gender'] as const;

const NOW_TYPES: ReadonlySet<LogicalType> = new Set(['date', 'time', 'timestamp', 'timestamptz']);
const UUID_TYPES: ReadonlySet<LogicalType> = new Set(['uuid', 'text', 'varchar']);
const USER_TYPES: ReadonlySet<LogicalType> = new Set(['text', 'varchar', 'uuid', 'integer', 'bigint']);
const NUMERIC_TYPES: ReadonlySet<LogicalType> = new Set(['integer', 'bigint', 'decimal', 'float']);
const TEXTUAL_TYPES: ReadonlySet<LogicalType> = new Set(['text', 'varchar']);
/** The columns a joined text reads: text and whole numbers, spelled alike by every database. */
const JOINED_TYPES: ReadonlySet<LogicalType> = new Set(['text', 'varchar', 'integer', 'bigint']);
/** Types whose answers cannot be a list: they have their own, or no, vocabulary. */
const UNLISTABLE_TYPES: ReadonlySet<LogicalType> = new Set(['boolean', 'json', 'binary']);

type Value = Record<string, unknown>;

/** The rules saved beside the one judged: same table, any column. */
export interface RelatedRules {
  rules: readonly { op: string; columnName: string | null; value: unknown }[];
  /** A workspace list's values, by key. */
  lists?: ReadonlyMap<string, readonly string[]> | undefined;
}

/** The rules through which Adminium fills a column itself: nobody is asked for it. */
const FILLING_OPS: ReadonlySet<string> = new Set(['column.copy', 'column.sequence', 'column.code', 'column.rollup', 'column.stamp', 'column.format', 'column.formula', 'column.lookup', 'column.perNight', 'column.customerKey', 'column.codeLast4']);

/** Whether a rule saved beside this one has Adminium fill the column. */
function filledByRule(related: RelatedRules | undefined, column: string): boolean {
  return (related?.rules ?? []).some(
    (rule) =>
      rule.columnName === column &&
      (FILLING_OPS.has(rule.op) || (rule.op === 'column.default' && !['none', 'database'].includes(String((rule.value as Value | null)?.['kind'])))),
  );
}

/**
 * Whether Adminium fills the column whatever a write sends. A copy that only
 * fills what a write leaves out is not that: with nothing to copy, a person is
 * still the one to ask.
 */
function alwaysFilledByRule(related: RelatedRules | undefined, column: string): boolean {
  const others = (related?.rules ?? []).filter((rule) => {
    if (rule.columnName !== column || rule.op !== 'column.copy') return true;
    const copy = rule.value as Value | null;
    return (copy?.['mode'] ?? 'default') !== 'default' || copy?.['follow'] === true;
  });
  return filledByRule({ ...related, rules: others }, column);
}

/** The values a column's own rule allows, when it lists them: inline, or a list by key. */
function listedValues(related: RelatedRules | undefined, column: string): readonly string[] | null {
  const options = (related?.rules ?? []).find((rule) => rule.op === 'column.options' && rule.columnName === column)?.value as Value | undefined;
  if (options === undefined) return null;
  if ('list' in options) return related?.lists?.get(String(options['list'])) ?? null;
  return ((options['values'] ?? []) as { value: string }[]).map((item) => item.value);
}

/**
 * The reason this rule cannot be kept for this column, or `null`.
 *
 * One string, in the operator's words — the route turns it into the 422. There
 * is no code vocabulary here on purpose: these are refusals an admin reads once
 * while editing a rule, not something a client branches on.
 */
export function columnRuleIssue(
  op:
    | 'column.default'
    | 'column.options'
    | 'column.required'
    | 'column.requiredWhen'
    | 'column.validation'
    | 'column.copy'
    | 'column.sequence'
    | 'column.code'
    | 'column.rollup'
    | 'column.venueLocal'
    | 'column.stamp'
    | 'column.format'
    | 'column.formula'
    | 'column.scale'
    | 'column.normalize'
    | 'column.retryKey'
    | 'column.bounds'
    | 'column.lookup'
    | 'column.perNight'
    | 'column.announce'
    | 'column.tableRef'
    | 'column.addOnLink'
    | 'column.codeLast4'
    | 'column.plainText'
    | 'column.customerKey',
  raw: unknown,
  column: ColumnModel,
  model: DatabaseModel,
  /**
   * The workspace's own list keys, which the route reads from the store
   * (phase F). Absent ⇒ only the built-ins exist, which is what a caller with
   * no store — a project file checked offline — can know.
   */
  knownLists?: ReadonlySet<string> | undefined,
  /**
   * The other rules saved with this one, on the same table, and the values of
   * the workspace's lists by key: what a rule is judged against beside the
   * database (a column required only sometimes is not also required always).
   */
  related?: RelatedRules | undefined,
): string | null {
  const value = (raw ?? {}) as Value;
  const name = JSON.stringify(column.name);
  switch (op) {
    case 'column.default': {
      if (column.isGenerated) {
        return `${name} is generated by the database, so Adminium cannot fill it.`;
      }
      const kind = String(value['kind']);
      // SQLite stores a timestamp as TEXT and reports it as `text`, so there a
      // text column IS a date column (the same widening `defaultKindAllowed`
      // makes for the designer).
      const dateCapable =
        NOW_TYPES.has(column.logicalType) ||
        (model.dialect === 'sqlite' &&
          (column.logicalType === 'text' || column.logicalType === 'varchar'));
      if (kind === 'now' && !dateCapable) {
        return `A date-and-time default needs a date or timestamp column; ${name} is ${column.logicalType}.`;
      }
      if (kind === 'uuid' && !UUID_TYPES.has(column.logicalType)) {
        return `A unique-id default needs a uuid or text column; ${name} is ${column.logicalType}.`;
      }
      if (kind === 'current-user' && !USER_TYPES.has(column.logicalType)) {
        return `The signed-in user cannot be stored in a ${column.logicalType} column.`;
      }
      if (kind === 'literal' && typeof value['text'] !== 'string') {
        return 'A fixed starting value needs the value itself.';
      }
      if (kind === 'from') {
        const from = value['from'];
        if (from === 'connection.currency') {
          if (!TEXTUAL_TYPES.has(column.logicalType)) return `A currency is three letters: ${name} is ${column.logicalType}.`;
        } else if (typeof from === 'object' && from !== null && 'table' in from) {
          const issue = settingIssue(from as Value, model);
          if (issue !== null) return issue;
        } else if (typeof from !== 'object' || from === null) {
          return 'A value filled from elsewhere names where: the connection\'s currency, a settings column or an add-on setting.';
        }
      }
      // `onUpdate` means "fill it again when the row changes", which only a
      // clock and an actor can answer. On a literal or a uuid it would rewrite
      // the same value, or mint a new key, on every save (plan 33's lesson).
      if (value['onUpdate'] === true && kind !== 'now' && kind !== 'current-user') {
        return 'Only the current time and the signed-in user can be filled in again on every change.';
      }
      return null;
    }

    case 'column.options': {
      if (UNLISTABLE_TYPES.has(column.logicalType)) {
        return `A ${column.logicalType} column cannot have a list of allowed values.`;
      }
      if (column.enumRef !== null) {
        const values = model.enums.find((def) => def.id === column.enumRef)?.values ?? [];
        return (
          `Your database already fixes what ${name} accepts` +
          (values.length > 0 ? ` (${values.join(', ')})` : '') +
          ' — change those values in Studio → Schema → Design.'
        );
      }
      if ('list' in value) {
        const key = String(value['list']);
        // A rule may only name a list that EXISTS: a key nobody defines would
        // be a rule that quietly checks nothing (the write path treats an
        // unresolvable list as no list at all), and the admin would have no way
        // to see that the column they just restricted is not restricted.
        if (!(BUILTIN_OPTION_LISTS as readonly string[]).includes(key) && knownLists?.has(key) !== true) {
          return `There is no list called ${JSON.stringify(key)}.`;
        }
        return null;
      }
      const items = (value['values'] ?? []) as { value: string }[];
      const seen = new Set<string>();
      for (const item of items) {
        if (seen.has(item.value)) return `${JSON.stringify(item.value)} is listed twice.`;
        seen.add(item.value);
      }
      return null;
    }

    case 'column.required': {
      if (column.isGenerated) {
        return `${name} is generated by the database, so nobody fills it in.`;
      }
      if ((related?.rules ?? []).some((rule) => rule.op === 'column.requiredWhen' && rule.columnName === column.name)) {
        return `${name} is required always, or only when another column says so, not both.`;
      }
      return null;
    }

    case 'column.requiredWhen': {
      if (column.isGenerated) return `${name} is generated by the database, so nobody fills it in.`;
      if (!column.nullable) return `${name} is never empty already, so it needs no condition to be required.`;
      // The same refusals the manifest makes (`appReferenceIssues`).
      if ((related?.rules ?? []).some((rule) => rule.op === 'column.required' && rule.columnName === column.name)) {
        return `${name} is required always, or only when another column says so, not both.`;
      }
      if (alwaysFilledByRule(related, column.name)) return `Adminium fills ${name}, so nobody is asked for it.`;
      const table = model.tables.find((candidate) => candidate.columns.includes(column));
      const other = table?.columns.find((c) => c.name === value['column']);
      if (other === undefined) return `${table?.name ?? 'This table'} has no column ${JSON.stringify(value['column'])}.`;
      if (other === column) return `${name} is required by another column, not by itself.`;
      // What the other column may hold: its enum, a CHECK listing its values, or a list its own rule keeps it to.
      const names = table?.columns.map((c) => c.name) ?? [];
      const checked = (table?.checks ?? []).map((check) => parseEnumCheck(check.expression, names)).find((parsed) => parsed?.column === other.name)?.values;
      const enumValues =
        other.enumRef !== null ? (model.enums.find((def) => def.id === other.enumRef)?.values ?? null) : (checked ?? listedValues(related, other.name));
      for (const listed of (value['in'] ?? []) as unknown[]) {
        const fits =
          enumValues !== null
            ? enumValues.includes(String(listed))
            : other.logicalType === 'boolean'
              ? typeof listed === 'boolean'
              : NUMERIC_TYPES.has(other.logicalType)
                ? // SQLite keeps an app's boolean as a number; Postgres and MySQL have their own
                  // (a MySQL `tinyint(1)` reads as one), and a number column there keeps numbers.
                  typeof listed === 'number' || (typeof listed === 'boolean' && model.dialect === 'sqlite')
                : typeof listed === 'string';
        if (!fits) return `${JSON.stringify(listed)} is not a value ${other.name} can hold.`;
      }
      return null;
    }

    case 'column.validation': {
      const min = value['min'];
      const max = value['max'];
      if (typeof min === 'number' && typeof max === 'number' && min > max) {
        return 'The smallest value cannot be larger than the largest.';
      }
      const minLength = value['minLength'];
      const maxLength = value['maxLength'];
      if (typeof minLength === 'number' && typeof maxLength === 'number' && minLength > maxLength) {
        return 'The shortest length cannot be larger than the longest.';
      }
      const lengths = typeof minLength === 'number' || typeof maxLength === 'number';
      if (lengths && !TEXTUAL_TYPES.has(column.logicalType)) {
        return `A length rule needs a text column; ${name} is ${column.logicalType}.`;
      }
      const bounds = typeof min === 'number' || typeof max === 'number';
      if (bounds && !NUMERIC_TYPES.has(column.logicalType)) {
        return `A smallest or largest value needs a number column; ${name} is ${column.logicalType}.`;
      }
      if (value['format'] !== undefined && !TEXTUAL_TYPES.has(column.logicalType)) {
        return `A format rule needs a text column; ${name} is ${column.logicalType}.`;
      }
      return null;
    }

    case 'column.copy': {
      if (column.isGenerated) return `${name} is generated by the database, so Adminium cannot fill it.`;
      const table = model.tables.find((candidate) => candidate.columns.includes(column));
      const via = String(value['via']);
      const from = String(value['from']);
      if (via === column.name) return `${name} cannot be copied through itself.`;
      const relation = model.relations.find(
        (r) => r.through === null && r.from.tableId === table?.id && r.from.columns.length === 1 && r.from.columns[0] === via,
      );
      if (relation === undefined) return `${JSON.stringify(via)} does not link this table to another one.`;
      const target = model.tables.find((candidate) => candidate.id === relation.to.tableId);
      if (target?.columns.some((c) => c.name === from) !== true) {
        return `The linked table has no column ${JSON.stringify(from)}.`;
      }
      if (value['follow'] === true && value['mode'] !== 'always') return 'A copy that follows its row always wins: its mode is "always".';
      return null;
    }

    case 'column.sequence': {
      if (column.isGenerated || column.isPrimaryKey) return `${name} numbers itself, so it takes no running number.`;
      if (!NUMERIC_TYPES.has(column.logicalType) && !TEXTUAL_TYPES.has(column.logicalType)) {
        return `A running number needs a number or text column; ${name} is ${column.logicalType}.`;
      }
      if (value['gapless'] === true) {
        if (column.logicalType !== 'integer' && column.logicalType !== 'bigint') {
          return `A number without gaps is a whole number; ${name} is ${column.logicalType}.`;
        }
        const table = model.tables.find((candidate) => candidate.columns.includes(column));
        if (value['scope'] !== undefined && table?.columns.some((c) => c.name === String(value['scope'])) !== true) {
          return `${table?.name ?? 'This table'} has no column ${JSON.stringify(value['scope'])} to number within.`;
        }
        const start = value['startSetting'];
        if (typeof start === 'object' && start !== null && 'table' in start) {
          const issue = settingIssue(start as Value, model);
          if (issue !== null) return issue;
        }
      } else if (value['scope'] !== undefined || value['startSetting'] !== undefined) {
        return 'A running number per parent, or one that starts at a setting, is numbered without gaps.';
      }
      return null;
    }

    case 'column.format': {
      if (column.isGenerated || column.isPrimaryKey) return `${name} is filled by the database, so Adminium cannot write it.`;
      if (!TEXTUAL_TYPES.has(column.logicalType)) return `A number with a prefix needs a text column; ${name} is ${column.logicalType}.`;
      const table = model.tables.find((candidate) => candidate.columns.includes(column));
      const from = table?.columns.find((c) => c.name === String(value['from']));
      if (from === undefined) return `${table?.name ?? 'This table'} has no column ${JSON.stringify(value['from'])} to number from.`;
      if (!NUMERIC_TYPES.has(from.logicalType)) return `${from.name} is not a number, so it cannot be written with a prefix.`;
      const width = String(value['prefix'] ?? '').length + Number(value['pad'] ?? 0);
      if (column.maxLength !== null && column.maxLength < width) return `${name} holds ${String(column.maxLength)} characters, fewer than the prefix and the padding.`;
      const setting = value['prefixSetting'];
      if (typeof setting === 'object' && setting !== null && 'table' in setting) {
        const issue = settingIssue(setting as Value, model);
        if (issue !== null) return issue;
      }
      return null;
    }

    case 'column.formula': {
      if (column.isGenerated || column.isPrimaryKey) return `${name} is filled by the database, so Adminium cannot work it out.`;
      const joins = typeof value['formula'] === 'object' && value['formula'] !== null && 'join' in value['formula'];
      if (joins) {
        if (!TEXTUAL_TYPES.has(column.logicalType)) return `A joined text needs a text column; ${name} is ${column.logicalType}.`;
      } else if (!NUMERIC_TYPES.has(column.logicalType) || column.logicalType === 'float') {
        // SQLite keeps every decimal as a REAL, and reports it as float.
        if (!(column.logicalType === 'float' && model.dialect === 'sqlite')) {
          return `A worked-out value needs a decimal or whole-number column; ${name} is ${column.logicalType}.`;
        }
      }
      const parsed = formulaExprSchema.safeParse(value['formula']);
      if (!parsed.success) return 'The formula is not one Adminium can work out.';
      const table = model.tables.find((candidate) => candidate.columns.includes(column));
      const moments = momentColumns(parsed.data).columns;
      const days = dayColumns(parsed.data).columns;
      const joined = typeof parsed.data === 'object' && 'join' in parsed.data ? parsed.data.join.filter(isJoinColumn) : [];
      for (const ref of formulaColumns(parsed.data)) {
        if (ref === column.name) return `${name} cannot be worked out from itself.`;
        const read = table?.columns.find((c) => c.name === ref);
        if (read === undefined) return `${table?.name ?? 'This table'} has no column ${JSON.stringify(ref)} for the formula.`;
        // A decimal, a yes or no or a time is spelled differently by each database: a join reads text and whole numbers.
        if (joined.includes(ref) && !JOINED_TYPES.has(read.logicalType)) return `A joined text reads text and whole-number columns; ${JSON.stringify(ref)} is ${read.logicalType}.`;
        // SQLite keeps a timestamp as text, and may say so.
        const moment = read.logicalType === 'timestamp' || read.logicalType === 'timestamptz' || (model.dialect === 'sqlite' && TEXTUAL_TYPES.has(read.logicalType));
        if (moments.has(ref) && !moment) return `${JSON.stringify(ref)} is not a moment, so no hours are counted from it.`;
        // SQLite keeps a date as text, and may say so.
        const day = read.logicalType === 'date' || (model.dialect === 'sqlite' && TEXTUAL_TYPES.has(read.logicalType));
        if (days.has(ref) && !day) return `${JSON.stringify(ref)} is not a date, so no days are counted from it.`;
      }
      return null;
    }

    case 'column.bounds': {
      // SQLite keeps a date as text, and says so.
      const dated = (c: ColumnModel) => ['date', 'timestamp', 'timestamptz'].includes(c.logicalType) || (model.dialect === 'sqlite' && TEXTUAL_TYPES.has(c.logicalType));
      if (!dated(column)) return `Only a date is kept within dates; ${name} is ${column.logicalType}.`;
      const table = model.tables.find((candidate) => candidate.columns.includes(column));
      for (const side of ['notBefore', 'notAfter']) {
        const bound = value[side] as { column?: unknown; via?: unknown; when?: { column?: unknown }[]; strict?: unknown } | 'today' | undefined;
        if (bound === undefined || bound === 'today') continue;
        let owner = table;
        if (typeof bound.via === 'string') {
          const relation = model.relations.find((r) => r.through === null && r.from.tableId === table?.id && r.from.columns.length === 1 && r.from.columns[0] === bound.via);
          if (relation === undefined) return `${JSON.stringify(bound.via)} is not a foreign key of ${table?.name ?? 'this table'}.`;
          owner = model.tables.find((candidate) => candidate.id === relation.to.tableId);
        }
        const other = owner?.columns.find((c) => c.name === bound.column);
        if (other === undefined) return `${owner?.name ?? 'That table'} has no column ${JSON.stringify(bound.column)}.`;
        if (!dated(other)) return `${owner?.name ?? 'That table'}.${String(bound.column)} is not a date.`;
        const conditions = [...(bound.when ?? []), ...(Array.isArray(bound.strict) ? (bound.strict as { column?: unknown }[]) : [])];
        const missing = conditions.find((condition) => !table?.columns.some((c) => c.name === condition.column));
        if (missing !== undefined) return `${table?.name ?? 'This table'} has no column ${JSON.stringify(missing.column)}.`;
      }
      return null;
    }

    case 'column.retryKey': {
      // A 43-letter hash, found by its one row.
      if (!TEXTUAL_TYPES.has(column.logicalType)) return `A retry key is kept in text; ${name} is ${column.logicalType}.`;
      return null;
    }

    case 'column.normalize': {
      return TEXTUAL_TYPES.has(column.logicalType) ? null : `Only text is stored trimmed or in lower case; ${name} is ${column.logicalType}.`;
    }

    case 'column.scale': {
      const decimal = column.logicalType === 'decimal' || column.logicalType === 'float';
      return decimal ? null : `Decimal places need a decimal column; ${name} is ${column.logicalType}.`;
    }

    case 'column.code': {
      if (column.isGenerated || column.isPrimaryKey) return `${name} numbers itself, so it takes no code.`;
      if (!TEXTUAL_TYPES.has(column.logicalType)) return `A code needs a text column; ${name} is ${column.logicalType}.`;
      const width = String(value['prefix'] ?? '').length + Number(value['length']);
      if (column.maxLength !== null && column.maxLength < width) {
        return `${name} holds ${String(column.maxLength)} characters; this code needs ${String(width)}.`;
      }
      // What renews it: other columns of the same row.
      const renew = value['renew'] as { on?: unknown } | undefined;
      if (renew !== undefined) {
        const table = model.tables.find((candidate) => candidate.columns.includes(column));
        for (const trigger of (Array.isArray(renew.on) ? renew.on : [renew.on]) as Value[]) {
          const watched = String(trigger['column']);
          if (watched === column.name) return 'A code is renewed by another column of the row.';
          if (table?.columns.some((c) => c.name === watched) !== true) return `${table?.name ?? 'The table'} has no column ${JSON.stringify(watched)} to renew the code by.`;
        }
      }
      return null;
    }

    case 'column.announce': {
      // Told from the settle, which has the row before and after only for a formula column.
      const formula = (related?.rules ?? []).some((rule) => rule.op === 'column.formula' && rule.columnName === column.name);
      if (related !== undefined && !formula) return `A change is announced of a formula column; ${name} has no formula.`;
      return null;
    }

    case 'column.tableRef': {
      return TEXTUAL_TYPES.has(column.logicalType) ? null : `A table's name is kept in text; ${name} is ${column.logicalType}.`;
    }

    case 'column.addOnLink': {
      // No foreign key: the add-on may not be there. The column holds the key of a row of its table.
      if (column.isGenerated || column.isPrimaryKey) return `${name} cannot link into an add-on's table.`;
      if (!column.nullable) return `A link into an add-on's table may be empty; ${name} is never empty.`;
      if (!TEXTUAL_TYPES.has(column.logicalType) && column.logicalType !== 'integer' && column.logicalType !== 'bigint') {
        return `A link into an add-on's table is a whole number or text; ${name} is ${column.logicalType}.`;
      }
      const table = model.tables.find((candidate) => candidate.columns.includes(column));
      const linked = model.relations.some((r) => r.through === null && r.from.tableId === table?.id && r.from.columns.includes(column.name));
      if (linked) return `${name} is a foreign key already, so it cannot also link into an add-on's table.`;
      return null;
    }

    case 'column.codeLast4': {
      if (!TEXTUAL_TYPES.has(column.logicalType)) return `The last four of a code are kept in text; ${name} is ${column.logicalType}.`;
      const table = model.tables.find((candidate) => candidate.columns.includes(column));
      const of = String(value['of']);
      if (of === column.name || table?.columns.some((c) => c.name === of) !== true) return `${table?.name ?? 'The table'} has no column ${JSON.stringify(of)} to take the last four of.`;
      const coded = (related?.rules ?? []).some((rule) => rule.op === 'column.code' && rule.columnName === of);
      if (related !== undefined && !coded) return `${JSON.stringify(of)} is not a code Adminium makes, so there is nothing to take the last four of.`;
      return null;
    }

    case 'column.plainText': {
      return TEXTUAL_TYPES.has(column.logicalType) ? null : `Plain text is a rule of a text column; ${name} is ${column.logicalType}.`;
    }

    case 'column.customerKey': {
      if (!TEXTUAL_TYPES.has(column.logicalType) || !column.nullable) return `A customer key is kept in text that may be empty; ${name} is not.`;
      const table = model.tables.find((candidate) => candidate.columns.includes(column));
      const of = table?.columns.find((c) => c.name === String(value['of']));
      if (of === undefined || of.name === column.name) return `${table?.name ?? 'The table'} has no column ${JSON.stringify(value['of'])} holding an address.`;
      if (!TEXTUAL_TYPES.has(of.logicalType)) return `An address is text; ${JSON.stringify(of.name)} is ${of.logicalType}.`;
      return null;
    }

    case 'column.lookup': {
      // A link filled from a typed code: the link itself, the column typed into, and the codes' column.
      const table = model.tables.find((candidate) => candidate.columns.includes(column));
      if (typeof value['table'] !== 'string') {
        // Among an add-on's codes: this database cannot see them, so the column says where it links.
        const into = value['table'] as { addOn?: unknown; table?: unknown };
        const link = (related?.rules ?? []).find((rule) => rule.op === 'column.addOnLink' && rule.columnName === column.name)?.value as { addOn?: unknown; table?: unknown } | undefined;
        if (related !== undefined && (link === undefined || link.addOn !== into.addOn || link.table !== into.table)) {
          return `A code looked up in an add-on's table fills a column that links there; ${name} carries no such link.`;
        }
        const typed = table?.columns.find((c) => c.name === String(value['from']));
        if (typed === undefined) return `${table?.name ?? 'The table'} has no column ${JSON.stringify(value['from'])} to type a code into.`;
        if (!TEXTUAL_TYPES.has(typed.logicalType)) return `A code is typed into text; ${JSON.stringify(typed.name)} is ${typed.logicalType}.`;
        return null;
      }
      const targetId = String(value['table']);
      const relation = model.relations.find(
        (r) => r.through === null && r.from.tableId === table?.id && r.from.columns.length === 1 && r.from.columns[0] === column.name && r.to.columns.length === 1,
      );
      if (relation === undefined || relation.to.tableId !== targetId) return `${name} does not link this table to ${JSON.stringify(targetId)}, so a typed code cannot fill it.`;
      const typed = table?.columns.find((c) => c.name === String(value['from']));
      if (typed === undefined) return `${table?.name ?? 'The table'} has no column ${JSON.stringify(value['from'])} to type a code into.`;
      if (!TEXTUAL_TYPES.has(typed.logicalType)) return `A code is typed into text; ${JSON.stringify(typed.name)} is ${typed.logicalType}.`;
      const target = model.tables.find((candidate) => candidate.id === targetId);
      const code = target?.columns.find((c) => c.name === String(value['column']));
      if (target === undefined || code === undefined) return `There is no column ${JSON.stringify(value['column'])} in ${JSON.stringify(targetId)} to find a code by.`;
      if (!TEXTUAL_TYPES.has(code.logicalType)) return `A code is found in text; ${target.name}.${code.name} is ${code.logicalType}.`;
      for (const condition of [...((value['where'] ?? []) as Value[]), ...((value['scope'] ?? []) as Value[])]) {
        if (!target.columns.some((c) => c.name === String(condition['column']))) return `${target.name} has no column ${JSON.stringify(condition['column'])}.`;
      }
      for (const scope of (value['scope'] ?? []) as Value[]) {
        if (table?.columns.some((c) => c.name === String(scope['equals'])) !== true) return `${table?.name ?? 'The table'} has no column ${JSON.stringify(scope['equals'])}.`;
      }
      return null;
    }

    case 'column.venueLocal': {
      // SQLite keeps a timestamp as text, and reports it as text.
      const clock =
        column.logicalType === 'timestamp' ||
        column.logicalType === 'timestamptz' ||
        (model.dialect === 'sqlite' && (column.logicalType === 'text' || column.logicalType === 'varchar'));
      return clock ? null : `A venue's clock needs a date-and-time column; ${name} is ${column.logicalType}.`;
    }

    case 'column.stamp': {
      if (column.isGenerated || column.isPrimaryKey) return `${name} is filled by the database, so Adminium cannot stamp it.`;
      const set = value['set'];
      // SQLite keeps a date and a timestamp as text, and reports them as text.
      const sqliteText = model.dialect === 'sqlite' && (column.logicalType === 'text' || column.logicalType === 'varchar');
      const table = model.tables.find((candidate) => candidate.columns.includes(column));
      const dated = typeof set === 'object' && set !== null && 'addDays' in set;
      // A moment (now plus some minutes, a deadline, a moment of the row) is written into a clock column.
      const momentous = typeof set === 'object' && set !== null && ('addMinutes' in set || 'deadline' in set || 'moment' in set);
      if (momentous) {
        const clocked = NOW_TYPES.has(column.logicalType) || sqliteText;
        if (!clocked) return `A stamped moment needs a date-and-time column; ${name} is ${column.logicalType}.`;
        const issue = table === undefined ? null : momentStampIssue(set as Value, table, model);
        if (issue !== null) return issue;
      }
      // A `byOrigin` side's word that is a stamp word writes what that word means (`today`: a date).
      const words = momentous
        ? []
        : typeof set === 'object' && set !== null && 'byOrigin' in set
          ? Object.values((set as { byOrigin: Record<string, unknown> }).byOrigin).map(String)
          : [typeof set === 'string' ? set : dated ? 'today' : ''];
      const clock = NOW_TYPES.has(column.logicalType) || sqliteText;
      for (const word of words) {
        if (word === 'now' || word === 'today') {
          if (!clock) return `A date stamp needs a date or date-and-time column; ${name} is ${column.logicalType}.`;
        } else if (!TEXTUAL_TYPES.has(column.logicalType) && column.logicalType !== 'enum') {
          return `A stamp that names someone needs a text column; ${name} is ${column.logicalType}.`;
        }
      }
      if (typeof set === 'object' && set !== null && 'copy' in set) {
        const source = String((set as { copy: unknown }).copy);
        if (source === column.name) return `A stamp copies another column, not ${name} itself.`;
        if (table?.columns.some((c) => c.name === source) !== true) return `${table?.name ?? 'This table'} has no column ${JSON.stringify(source)} to copy.`;
      }
      if (dated) {
        const days = (set as { addDays: Value }).addDays;
        for (const part of [days['date'], typeof days['days'] === 'string' ? days['days'] : undefined]) {
          if (part !== undefined && table?.columns.some((c) => c.name === String(part)) !== true) {
            return `${table?.name ?? 'This table'} has no column ${JSON.stringify(part)} to count days from.`;
          }
        }
      }
      if (typeof set === 'object' && set !== null && 'hashOf' in set) {
        if (column.maxLength !== null && column.maxLength < 64) return `A fingerprint is 64 characters; ${name} holds ${String(column.maxLength)}.`;
        const hash = (set as { hashOf: Value }).hashOf;
        for (const part of (hash['columns'] as unknown[] | undefined) ?? []) {
          if (table?.columns.some((c) => c.name === String(part)) !== true) return `${table?.name ?? 'This table'} has no column ${JSON.stringify(part)} to fingerprint.`;
        }
        const children = [
          ...(((hash['children'] as Value[] | undefined) ?? [])),
          ...(((hash['linked'] as Value[] | undefined) ?? []).flatMap((link) => [link, ...(((link['children'] as Value[] | undefined) ?? []))])),
        ];
        for (const child of children) {
          if (!model.tables.some((candidate) => candidate.id === String(child['table']))) {
            return `There is no table ${JSON.stringify(child['table'])} to fingerprint.`;
          }
        }
      }
      const triggers = Array.isArray(value['on']) ? (value['on'] as unknown[]) : [value['on']];
      for (const on of triggers) {
        if (typeof on !== 'object' || on === null) continue;
        if (Array.isArray((on as Value)['columns'])) {
          for (const part of (on as Value)['columns'] as unknown[]) {
            if (String(part) === column.name) return `A stamp watches another column, not ${name} itself.`;
            if (table !== undefined && !table.columns.some((c) => c.name === String(part))) return `${table.name} has no column ${JSON.stringify(part)} to watch.`;
          }
          continue;
        }
        const watched = String((on as Value)['column']);
        if (watched === column.name) return `A stamp watches another column, not ${name} itself.`;
        if (table !== undefined && !table.columns.some((c) => c.name === watched)) {
          return `${table.name} has no column ${JSON.stringify(watched)} to watch.`;
        }
      }
      return null;
    }

    case 'column.perNight':
      return perNightRuleIssue(value, column, model);

    case 'column.rollup': {
      if (column.isGenerated || column.isPrimaryKey) return `${name} cannot hold a total.`;
      if (!NUMERIC_TYPES.has(column.logicalType)) return `A total needs a number column; ${name} is ${column.logicalType}.`;
      const parent = model.tables.find((candidate) => candidate.columns.includes(column));
      const child = model.tables.find((candidate) => candidate.id === String(value['from']));
      if (child === undefined) return `There is no table ${JSON.stringify(value['from'])} to add up.`;
      const via = String(value['via']);
      const links = model.relations.some(
        (r) =>
          r.through === null &&
          r.from.tableId === child.id &&
          r.to.tableId === parent?.id &&
          r.from.columns.length === 1 &&
          r.from.columns[0] === via,
      );
      if (!links) return `${JSON.stringify(via)} does not link ${child.name} back to this table.`;
      if ((value['sum'] === undefined) === (value['count'] === undefined)) return 'A total adds up a column or counts rows, not both.';
      if (value['count'] === true) {
        if (column.logicalType !== 'integer' && column.logicalType !== 'bigint') return `A count needs a whole-number column; ${name} is ${column.logicalType}.`;
        if (value['times'] !== undefined || value['balance'] !== undefined || value['cap'] !== undefined || value['capUnless'] !== undefined) return 'A count takes nothing to multiply, no balance and no cap.';
      }
      const capUnless = value['capUnless'] as Value | undefined;
      if (capUnless !== undefined) {
        // Lifts the cap for one row: a yes/no of this table that is never empty.
        if (value['cap'] !== true) return 'A cap is lifted only where there is one: capUnless needs cap.';
        const flag = parent?.columns.find((c) => c.name === String(capUnless['column']));
        if (flag === undefined) return `${parent?.name ?? 'This table'} has no column ${JSON.stringify(capUnless['column'])} to lift the cap by.`;
        if (flag.nullable || !(flag.logicalType === 'boolean' || flag.logicalType === 'integer')) return `${parent?.name}.${flag.name} must say yes or no for every row to lift a cap.`;
      }
      for (const part of [value['sum'], value['times']]) {
        if (part === undefined) continue;
        const counted = child.columns.find((c) => c.name === String(part));
        if (counted === undefined) return `${child.name} has no column ${JSON.stringify(part)}.`;
        if (!NUMERIC_TYPES.has(counted.logicalType)) return `${child.name}.${counted.name} is not a number, so it cannot be added up.`;
      }
      if (value['unlessSet'] !== undefined && !child.columns.some((c) => c.name === String(value['unlessSet']))) {
        return `${child.name} has no column ${JSON.stringify(value['unlessSet'])}.`;
      }
      const where = value['where'] as Value | undefined;
      const filter = where === undefined ? undefined : child.columns.find((c) => c.name === String(where['column']));
      if (where !== undefined && filter === undefined) return `${child.name} has no column ${JSON.stringify(where['column'])} to filter by.`;
      // An empty value equals nothing: a row left empty would drop out of the total unseen.
      if (filter?.nullable === true) return `${child.name}.${filter.name} may be empty, so a row could drop out of the total unseen.`;
      const balance = value['balance'] as Value | undefined;
      if (balance !== undefined) {
        const names = [balance['column'], balance['of'], ...((balance['minus'] as unknown[] | undefined) ?? [])].map(String);
        for (const part of names) {
          const found = parent?.columns.find((c) => c.name === part);
          if (found === undefined) return `${parent?.name ?? 'This table'} has no column ${JSON.stringify(part)} for the balance.`;
          if (!NUMERIC_TYPES.has(found.logicalType)) return `${parent?.name}.${found.name} is not a number, so it cannot be part of a balance.`;
        }
        const own = String(balance['column']);
        if (own === column.name || names.slice(1).includes(own)) return 'The balance is a column of its own, not one it is worked out from.';
        if (parent?.columns.find((c) => c.name === own)?.isGenerated === true) return `${JSON.stringify(own)} is generated by the database.`;
      }
      return null;
    }
  }
}

/**
 * Why a price by the night cannot be kept for this column against the live
 * snapshot, or `null`: its dates are dates of this table (text on SQLite),
 * its rate is read through a link of this table, and the adjustments' table
 * (by its id), their link to the same table, and their columns are there.
 */
function perNightRuleIssue(value: Value, column: ColumnModel, model: DatabaseModel): string | null {
  const name = JSON.stringify(column.name);
  if (column.isGenerated || column.isPrimaryKey) return `${name} is filled by the database, so Adminium cannot price it.`;
  if (!NUMERIC_TYPES.has(column.logicalType) || (column.logicalType === 'float' && model.dialect !== 'sqlite')) {
    return `A price by the night needs a decimal or whole-number column; ${name} is ${column.logicalType}.`;
  }
  const table = model.tables.find((candidate) => candidate.columns.includes(column));
  const dated = (c: ColumnModel | undefined) => c !== undefined && (c.logicalType === 'date' || (model.dialect === 'sqlite' && TEXTUAL_TYPES.has(c.logicalType)));
  for (const end of ['from', 'to']) {
    const found = table?.columns.find((c) => c.name === String(value[end]));
    if (!dated(found)) return `${JSON.stringify(value[end])} is not a date of this table.`;
  }
  const linkTo = (from: TableModel | undefined, via: unknown) =>
    model.relations.find((r) => r.through === null && r.from.tableId === from?.id && r.from.columns.length === 1 && r.from.columns[0] === via);
  const rate = (value['rate'] ?? {}) as Value;
  const rateLink = linkTo(table, rate['via']);
  if (rateLink === undefined) return `${JSON.stringify(rate['via'])} does not link this table to another one.`;
  const rates = model.tables.find((candidate) => candidate.id === rateLink.to.tableId);
  const priced = rates?.columns.find((c) => c.name === String(rate['column']));
  if (priced === undefined || !NUMERIC_TYPES.has(priced.logicalType)) return `The linked table has no number column ${JSON.stringify(rate['column'])}.`;
  const adjust = value['adjust'] as Value | undefined;
  if (adjust === undefined) return null;
  const adjustments = model.tables.find((candidate) => candidate.id === String(adjust['table']));
  if (adjustments === undefined) return `There is no table ${JSON.stringify(adjust['table'])} of adjustments.`;
  const match = (adjust['match'] ?? {}) as Value;
  if (match['via'] !== undefined && linkTo(adjustments, match['via'])?.to.tableId !== rateLink.to.tableId) {
    return `${JSON.stringify(match['via'])} does not link ${adjustments.name} to the table the rate is read from.`;
  }
  const where = adjust['where'] as Value | undefined;
  for (const part of [adjust['add'], adjust['name'], match['weekdays'], match['from'], match['to'], where?.['column']]) {
    if (part !== undefined && !adjustments.columns.some((c) => c.name === String(part))) return `${adjustments.name} has no column ${JSON.stringify(part)}.`;
  }
  return null;
}

/** Why a setting a rule reads (`{table, column}` of a settings row, by its id) is not there, or `null`. */
function settingIssue(setting: Value, model: DatabaseModel): string | null {
  const source = model.tables.find((candidate) => candidate.id === String(setting['table']));
  if (source?.columns.some((c) => c.name === String(setting['column'])) !== true) {
    return `There is no column ${JSON.stringify(setting['column'])} in ${JSON.stringify(setting['table'])} to read.`;
  }
  return null;
}

/** The rules that write a column themselves, as the manifest counts them: an undo's `clears` never names such a column. */
const DECIDING_OPS: ReadonlySet<string> = new Set(['copy', 'sequence', 'code', 'rollup', 'stamp', 'formula', 'format', 'default', 'lookup', 'perNight'].map((name) => `column.${name}`));

/**
 * Why a table's states cannot be kept, or `null`: the state column, every
 * column a move or the lock names, and every child table it ties to the
 * state (by its id) with the foreign key back, must exist in the live snapshot.
 */
export function statesRuleIssue(
  raw: unknown,
  table: TableModel,
  model: DatabaseModel,
  /**
   * The rules saved beside it on the same table: a column one of them decides
   * is not an undo's to empty. `kept`: the rule is the one already stored,
   * saved again unchanged — what an undo empties and a second move to one
   * state are judged only when a save changes the states, so a rule saved
   * before those checks does not stop every later save.
   */
  related?: { rules: readonly { op: string; columnName: string | null; value: unknown }[]; kept?: boolean },
): string | null {
  // The shape was proved by the store's own schema (`validateOverrideInput`),
  // which knows a table here is its id in the snapshot (`main.studio_lines`).
  const states = (raw ?? {}) as States;
  if (typeof states.column !== 'string' || typeof states.moves !== 'object' || states.moves === null) {
    return 'The states are not written the way Adminium keeps them.';
  }
  const own = (name: string) => table.columns.some((c) => c.name === name);
  const conditions = Object.values(states.moves).flatMap((moves) => moves.flatMap((move) => (typeof move === 'string' ? [] : (move.requires?.where ?? []))));
  for (const name of [states.column, ...(states.lock?.except ?? []), ...(states.onlyLater ?? []).map((entry) => (typeof entry === 'string' ? entry : entry.column)), ...conditions.map((c) => c.column), ...(states.late ?? []).flatMap((late) => (late.where ?? []).map((c) => c.column))]) {
    if (!own(name)) return `${table.name} has no column ${JSON.stringify(name)}.`;
  }
  const linked = (id: string, via: string) => {
    const child = model.tables.find((candidate) => candidate.id === id);
    if (child === undefined) return `There is no table ${JSON.stringify(id)} to tie to the state.`;
    if (!child.columns.some((c) => c.name === via)) return `${child.name} has no column ${JSON.stringify(via)}.`;
    return null;
  };
  for (const [id, child] of Object.entries(states.children ?? {})) {
    const issue = linked(id, child.via);
    if (issue !== null) return issue;
    for (const name of child.clearOnCreate ?? []) if (!own(name)) return `${table.name} has no column ${JSON.stringify(name)}.`;
    const childTable = model.tables.find((candidate) => candidate.id === id)!;
    if (child.release !== undefined) {
      if (child.lock !== true) return `A ${childTable.name} row is released only from its parent's lock.`;
      for (const state of child.release.when) {
        if (!(states.lock?.when ?? []).includes(state)) return `${JSON.stringify(state)} is not a state the lock holds, so there is nothing to release.`;
        // Released there, a link stops locking its row: a row moving on from it could come back billing a changed one.
        if ((states.moves[state] ?? []).length > 0) return `${JSON.stringify(state)} has moves out of it: release only in a final state.`;
      }
      for (const name of child.release.columns) {
        const column = childTable.columns.find((c) => c.name === name);
        if (column === undefined) return `${childTable.name} has no column ${JSON.stringify(name)}.`;
        if (name === child.via || column.isPrimaryKey || !column.nullable) return `${childTable.name}.${name} cannot be emptied.`;
      }
    }
    for (const [link, columns] of Object.entries(child.lockLinked ?? {})) {
      // As the write path follows it: one column to one other table's one-column key.
      const relation = model.relations.find(
        (r) => r.through === null && r.from.tableId === id && r.from.columns.length === 1 && r.from.columns[0] === link && r.to.columns.length === 1,
      );
      const target = relation === undefined ? undefined : model.tables.find((candidate) => candidate.id === relation.to.tableId);
      if (target === undefined) return `${childTable.name}.${link} does not point at another table.`;
      for (const name of columns) if (!target.columns.some((c) => c.name === name)) return `${target.name} has no column ${JSON.stringify(name)}.`;
    }
  }
  for (const moves of Object.values(states.moves)) {
    for (const move of moves) {
      if (typeof move === 'string') continue;
      for (const id of Object.keys(move.requires?.children ?? {})) {
        if (states.children?.[id] === undefined) return `A move asks for rows of ${JSON.stringify(id)}, which is not tied to the state.`;
      }
    }
  }
  for (const ref of states.lockedWhenReferencedBy ?? []) {
    const issue = linked(ref.table, ref.via);
    if (issue !== null) return issue;
  }
  // What an undo empties, and a move another to the same state hides: judged as an app's manifest is.
  const deciding = new Set((related?.rules ?? []).filter((rule) => rule.columnName !== null && DECIDING_OPS.has(rule.op)).map((rule) => rule.columnName!));
  const [undo] = related?.kept === true ? [] : undoMoveIssues(states, table.name, {
    column: (name) => {
      const found = table.columns.find((c) => c.name === name);
      return found === undefined ? undefined : { key: found.isPrimaryKey, nullable: found.nullable };
    },
    decided: (name) => deciding.has(name) || table.columns.find((c) => c.name === name)?.isGenerated === true,
  });
  if (undo !== undefined) return `${undo.message.charAt(0).toUpperCase()}${undo.message.slice(1)}.`;
  return conditionedStatesIssue(states, table, model);
}

/** The table one of `table`'s columns points at, followed as the write path follows a link: one column to a one-column key. */
function linkTargetOf(table: TableModel, via: string, model: DatabaseModel): TableModel | undefined {
  const relation = model.relations.find(
    (r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === via && r.to.columns.length === 1,
  );
  return relation === undefined ? undefined : model.tables.find((candidate) => candidate.id === relation.to.tableId);
}

/** Why a moment (see the manifest's moments) cannot be read on this database, or `null`. */
function momentIssue(moment: Value, table: TableModel, model: DatabaseModel): string | null {
  let owner: TableModel | undefined = table;
  if (typeof moment['via'] === 'string') {
    owner = linkTargetOf(table, moment['via'], model);
    if (owner === undefined) return `${table.name}.${moment['via']} does not point at another table.`;
  }
  if (!owner.columns.some((c) => c.name === String(moment['column']))) return `${owner.name} has no column ${JSON.stringify(moment['column'])}.`;
  const time = moment['time'];
  if (typeof time === 'object' && time !== null) {
    const hours = (time as Value)['hours'] as Value | undefined;
    if (hours !== undefined) {
      const source = model.tables.find((candidate) => candidate.id === String(hours['table']));
      if (source === undefined) return `There is no table ${JSON.stringify(hours['table'])} to read the hours from.`;
      for (const part of [hours['weekday'], hours['open'], hours['opens'], hours['closes']]) {
        if (part !== undefined && !source.columns.some((c) => c.name === String(part))) return `${source.name} has no column ${JSON.stringify(part)}.`;
      }
    } else if ((time as Value)['table'] === undefined) {
      // A time of day kept on the row the moment's column is read from.
      if (!owner.columns.some((c) => c.name === String((time as Value)['column']))) return `${owner.name} has no column ${JSON.stringify((time as Value)['column'])}.`;
    } else {
      const issue = settingIssue(time as Value, model);
      if (issue !== null) return issue;
    }
  }
  for (const side of ['plus', 'minus']) {
    for (const amount of Object.values((moment[side] as Value | undefined) ?? {})) {
      if (typeof amount === 'object' && amount !== null) {
        const issue = settingIssue(amount as Value, model);
        if (issue !== null) return issue;
      }
    }
  }
  for (const fallback of (moment['or'] as Value[] | undefined) ?? []) {
    const issue = momentIssue(fallback, table, model);
    if (issue !== null) return issue;
  }
  return null;
}

/** Why a stamped moment (now plus minutes, a deadline, a moment of the row) cannot be worked out here, or `null`. */
function momentStampIssue(set: Value, table: TableModel, model: DatabaseModel): string | null {
  const amounts: unknown[] = [];
  if ('addMinutes' in set) {
    const add = set['addMinutes'] as Value;
    amounts.push(add['minutes'], add['hours']);
    if (add['notAfter'] !== undefined) {
      const issue = momentIssue(add['notAfter'] as Value, table, model);
      if (issue !== null) return issue;
    }
  }
  if ('deadline' in set) {
    const deadline = set['deadline'] as Value;
    amounts.push(deadline['days'], deadline['time']);
    if (deadline['notAfter'] !== undefined) {
      const issue = momentIssue(deadline['notAfter'] as Value, table, model);
      if (issue !== null) return issue;
    }
  }
  if ('moment' in set) {
    const issue = momentIssue(set['moment'] as Value, table, model);
    if (issue !== null) return issue;
  }
  for (const amount of amounts) {
    if (typeof amount === 'object' && amount !== null) {
      const issue = settingIssue(amount as Value, model);
      if (issue !== null) return issue;
    }
  }
  return null;
}

/**
 * Why what a table's moves wait for or set off cannot be kept, or `null`:
 * the links they read through must lead somewhere, and every column, setting
 * and hours table they name must exist.
 */
function conditionedStatesIssue(states: States, table: TableModel, model: DatabaseModel): string | null {
  const own = (name: string) => table.columns.some((c) => c.name === name);
  const through = (via: string, names: readonly string[]): string | null => {
    const target = linkTargetOf(table, via, model);
    if (target === undefined) return `${table.name}.${via} does not point at another table.`;
    for (const name of names) if (!target.columns.some((c) => c.name === name)) return `${target.name} has no column ${JSON.stringify(name)}.`;
    return null;
  };
  for (const moves of Object.values(states.moves)) {
    for (const move of moves) {
      if (typeof move === 'string' || move.requires === undefined) continue;
      for (const condition of move.requires.linked ?? []) {
        const issue = through(condition.via, condition.where.map((c) => c.column));
        if (issue !== null) return issue;
      }
      for (const moment of [move.requires.time?.after, move.requires.time?.before]) {
        const issue = moment === undefined ? null : momentIssue(moment as unknown as Value, table, model);
        if (issue !== null) return issue;
      }
      for (const setting of move.requires.setting ?? []) {
        const issue = settingIssue(setting as unknown as Value, model);
        if (issue !== null) return issue;
      }
    }
  }
  if (typeof states.strict === 'object') {
    for (const name of states.strict.show) if (!own(name)) return `${table.name} has no column ${JSON.stringify(name)}.`;
  }
  for (const late of states.late ?? []) {
    if (late.flag !== undefined && !own(late.flag)) return `${table.name} has no column ${JSON.stringify(late.flag)}.`;
    const issue = momentIssue(late.moment as unknown as Value, table, model);
    if (issue !== null) return issue;
    for (const amount of Object.values(late.within)) {
      const read = typeof amount === 'object' && amount !== null ? settingIssue(amount as Value, model) : null;
      if (read !== null) return read;
    }
  }
  for (const timed of states.timed ?? []) {
    const issue = momentIssue(timed.at as unknown as Value, table, model);
    if (issue !== null) return issue;
    for (const name of Object.keys(timed.set ?? {})) if (!own(name)) return `${table.name} has no column ${JSON.stringify(name)}.`;
  }
  const create = states.create?.requires;
  if (create !== undefined) {
    for (const condition of create.where ?? []) if (!own(condition.column)) return `${table.name} has no column ${JSON.stringify(condition.column)}.`;
    for (const condition of create.linked ?? []) {
      const issue = through(condition.via, condition.where.map((c) => c.column));
      if (issue !== null) return issue;
    }
    for (const moment of [create.time?.after, create.time?.before]) {
      const issue = moment === undefined ? null : momentIssue(moment as unknown as Value, table, model);
      if (issue !== null) return issue;
    }
    for (const setting of create.setting ?? []) {
      const issue = settingIssue(setting as unknown as Value, model);
      if (issue !== null) return issue;
    }
  }
  for (const effect of states.effects ?? []) {
    const issue = isChangeEffect(effect)
      ? through(effect.on.change, [...Object.keys(effect.old?.set ?? {}), ...Object.keys(effect.new?.set ?? {})])
      : through(effect.via, Object.keys(effect.set));
    if (issue !== null) return issue;
  }
  return null;
}

/**
 * Why a table's limits cannot be kept, or `null`: one rule, or `{rules}` for
 * several. Each column a rule names must be there — the table's own, or of
 * the row a foreign key it names points at — and each table it reads (hours,
 * closures, pauses, the rooms counted, their closures, a setting) must exist
 * by its id in the snapshot. The first problem is the answer.
 */
export function capacityRuleIssue(raw: unknown, table: TableModel, model: DatabaseModel): string | null {
  const value = (raw ?? {}) as Value;
  const rules = Array.isArray(value['rules']) ? (value['rules'] as Value[]) : [value];
  for (const rule of rules) {
    const issue = oneCapacityRuleIssue(rule, table, model);
    if (issue !== null) return issue;
  }
  return null;
}

/** The table a one-column foreign key of `from` points at, as the write path follows it. */
function linkedTable(from: TableModel, column: unknown, model: DatabaseModel): TableModel | undefined {
  const relation = model.relations.find(
    (r) => r.through === null && r.from.tableId === from.id && r.from.columns.length === 1 && r.from.columns[0] === String(column) && r.to.columns.length === 1,
  );
  return relation === undefined ? undefined : model.tables.find((candidate) => candidate.id === relation.to.tableId);
}

function oneCapacityRuleIssue(value: Value, table: TableModel, model: DatabaseModel): string | null {
  const own = (name: unknown) => table.columns.find((c) => c.name === String(name));
  const missing = (on: TableModel, name: unknown) => `${on.name} has no column ${JSON.stringify(name)}.`;
  const has = (on: TableModel, name: unknown) => on.columns.some((c) => c.name === String(name));
  /** Through a foreign key of `from`: the table, or why not. */
  const through = (from: TableModel, via: unknown): TableModel | string => {
    if (!has(from, via)) return missing(from, via);
    return linkedTable(from, via, model) ?? `${from.name}.${String(via)} does not point at another table.`;
  };
  /** A column of the row itself, or of the row `via` points at. */
  const reached = (name: unknown, via: unknown): string | null => {
    if (via === undefined) return has(table, name) ? null : missing(table, name);
    const on = through(table, via);
    if (typeof on === 'string') return on;
    return has(on, name) ? null : missing(on, name);
  };
  /** A table by its id, and each of `columns` on it. */
  const elsewhere = (part: unknown, columns: readonly string[], what: string): string | null => {
    if (part === undefined) return null;
    const entry = part as Value;
    const source = model.tables.find((candidate) => candidate.id === String(entry['table'] ?? ''));
    if (source === undefined) return `There is no table ${JSON.stringify(entry['table'])} for the ${what} to read.`;
    for (const key of columns) {
      if (entry[key] !== undefined && !has(source, entry[key])) return `${source.name} has no column ${JSON.stringify(entry[key])} for the ${what}.`;
    }
    return null;
  };
  const setting = (candidate: unknown): string | null => {
    if (typeof candidate !== 'object' || candidate === null || !('table' in candidate)) return null;
    const { table: id, column } = candidate as { table: string; column: string };
    const source = model.tables.find((t) => t.id === id);
    return source?.columns.some((c) => c.name === column) === true ? null : `There is no column ${JSON.stringify(column)} in ${JSON.stringify(id)} to read.`;
  };
  const first = (...issues: (string | null)[]) => issues.find((issue) => issue !== null) ?? null;

  /** What counts, and a hold's end: on the row, or one hop up. */
  const counting = (): string | null => {
    const conditions = (value['countWhere'] === undefined ? [] : Array.isArray(value['countWhere']) ? value['countWhere'] : [value['countWhere']]) as Value[];
    for (const condition of conditions) {
      const issue = reached(condition['column'], condition['via']);
      if (issue !== null) return issue;
    }
    const hold = value['hold'] as Value | undefined;
    if (hold === undefined) return null;
    const level = hold['via'] === undefined ? table : through(table, hold['via']);
    if (typeof level === 'string') return level;
    const end = hold['column'];
    const ends = (typeof end === 'object' && end !== null ? [end as Value, ...(((end as Value)['or'] ?? []) as Value[])] : [{ column: end }]) as Value[];
    for (const part of ends) {
      const on = part['via'] === undefined ? level : through(level, part['via']);
      if (typeof on === 'string') return on;
      if (!has(on, part['column'])) return missing(on, part['column']);
    }
    return null;
  };

  const kind = value['kind'] ?? 'slot';
  if (kind === 'slot') {
    // In the order a released slot rule was always checked: its columns, what counts, then its settings.
    for (const key of ['slot', 'amount', 'resource'] as const) {
      if (value[key] === undefined || typeof value[key] === 'number') continue;
      if (own(value[key]) === undefined) return missing(table, value[key]);
    }
    const counted = counting();
    if (counted !== null) return counted;
    const amount = typeof value['amount'] === 'string' ? own(value['amount']) : undefined;
    if (amount !== undefined && !NUMERIC_TYPES.has(amount.logicalType)) return `${amount.name} is not a number, so it cannot be counted.`;
    for (const key of ['perSlot', 'slotMinutes', 'windowDays', 'opens', 'closes', 'cancelHours', 'noticeMinutes'] as const) {
      const issue = setting(value[key]);
      if (issue !== null) return issue;
    }
    return first(
      elsewhere(value['hours'], ['weekday', 'open', 'opens', 'closes'], 'opening hours'),
      elsewhere(value['closures'], ['from', 'to', 'active'], 'closures'),
      elsewhere(value['pauses'], ['slot', 'active'], 'paused slots'),
    );
  }

  const counted = counting();
  if (counted !== null) return counted;
  if (kind === 'parent') {
    const target = through(table, value['via']);
    if (typeof target === 'string') return target;
    /** A size: a number, a setting, or a column of `on` (and its day). */
    const size = (candidate: unknown, on: TableModel): string | null => {
      if (typeof candidate !== 'object' || candidate === null) return null;
      const entry = candidate as Value;
      if ('table' in entry) return setting(entry);
      if (!has(on, entry['column'])) return missing(on, entry['column']);
      if (entry['onDay'] !== undefined && !has(on, entry['onDay'])) return missing(on, entry['onDay']);
      return null;
    };
    const amount = typeof value['amount'] === 'string' ? own(value['amount']) : undefined;
    if (typeof value['amount'] === 'string' && amount === undefined) return missing(table, value['amount']);
    if (amount !== undefined && !NUMERIC_TYPES.has(amount.logicalType)) return `${amount.name} is not a number, so it cannot be counted.`;
    const window = (value['window'] ?? {}) as Value;
    const perWrite = value['perWrite'] as Value | undefined;
    const issue = first(
      size(value['size'], target),
      ...[window['opens'], window['closes']].filter((name) => name !== undefined).map((name) => (has(target, name) ? null : missing(target, name))),
      perWrite === undefined ? null : has(table, perWrite['within']) ? size(perWrite['max'], target) : missing(table, perWrite['within']),
      value['lockBy'] === undefined || has(table, value['lockBy']) ? null : missing(table, value['lockBy']),
    );
    if (issue !== null) return issue;
    for (const wider of (value['also'] ?? []) as Value[]) {
      const pool = through(table, wider['via']);
      if (typeof pool === 'string') return pool;
      const hop = wider['size'] as Value | number;
      if (typeof hop === 'object' && hop !== null && 'via' in hop) {
        const next = through(pool, hop['via']);
        if (typeof next === 'string') return next;
        if (!has(next, hop['column'])) return missing(next, hop['column']);
      } else {
        const sized = size(hop, pool);
        if (sized !== null) return sized;
      }
    }
    const day = value['day'];
    if (day !== undefined) {
      const dayIssue = typeof day === 'string' ? reached(day, undefined) : reached((day as Value)['column'], (day as Value)['via']);
      if (dayIssue !== null) return dayIssue;
    }
    const reserved = value['reserved'] as Value | undefined;
    if (reserved?.['via'] !== undefined) {
      const on = through(table, reserved['via']);
      if (typeof on === 'string') return on;
    }
    return null;
  }

  if (kind === 'night') {
    for (const key of ['from', 'to'] as const) {
      const date = value[key];
      const issue = typeof date === 'object' && date !== null ? reached((date as Value)['column'], (date as Value)['via']) : reached(date, undefined);
      if (issue !== null) return issue;
    }
    const pool = (value['pool'] ?? {}) as Value;
    const target = through(table, pool['via']);
    if (typeof target === 'string') return target;
    const count = pool['count'] as Value | undefined;
    const sized = pool['size'];
    const nights = (value['nights'] ?? {}) as Value;
    const given = pool['given'] as Value | undefined;
    let givenIssue: string | null = null;
    if (given !== undefined) {
      const room = through(table, given['via']);
      givenIssue = typeof room === 'string' ? room : has(room, given['column']) ? null : missing(room, given['column']);
    }
    return first(
      elsewhere(count, ['column'], 'rooms counted'),
      elsewhere(count?.['outOfService'] ?? pool['outOfService'], ['room', 'from', 'to', 'active'], 'rooms out of service'),
      (pool['fits'] as Value | undefined) === undefined || has(target, (pool['fits'] as Value)['column']) ? null : missing(target, (pool['fits'] as Value)['column']),
      typeof sized === 'object' && sized !== null && !has(target, (sized as Value)['column']) ? missing(target, (sized as Value)['column']) : null,
      givenIssue,
      setting(nights['min']),
      setting(nights['max']),
      setting(nights['aheadDays']),
    );
  }
  return `A limit of kind ${JSON.stringify(kind)} is not one Adminium keeps.`;
}

/**
 * Why a table's booking rule cannot be kept, or `null`: every column it names
 * on its own table, and every table and column it reads elsewhere — the link
 * table of who does what, the weekly hours, the closures, the settings row —
 * must exist in the live snapshot. A nested table left unmapped (the app's
 * short name, or none) is caught here, before the guard would query a table
 * that is not there on every booking.
 */
export function bookingRuleIssue(raw: unknown, table: TableModel, model: DatabaseModel): string | null {
  const value = (raw ?? {}) as Value;
  const own = (name: unknown) => table.columns.find((c) => c.name === String(name));
  const ownNames: unknown[] = [value['start'], value['minutes'], value['resource'], value['kind'], (value['countWhere'] as Value | undefined)?.['column']];
  const cancel = value['cancel'] as Value | undefined;
  if (cancel !== undefined) ownNames.push((cancel['when'] as Value | undefined)?.['column'], cancel['flag']);
  for (const name of ownNames) {
    if (name === undefined) continue;
    if (own(name) === undefined) return `${table.name} has no column ${JSON.stringify(name)}.`;
  }
  const minutes = own(value['minutes']);
  if (minutes !== undefined && !NUMERIC_TYPES.has(minutes.logicalType)) {
    return `${minutes.name} is not a number, so it cannot be a length in minutes.`;
  }

  /** The table by its snapshot id, and each of `columns` on it. */
  const elsewhere = (part: unknown, what: string): string | null => {
    if (part === undefined) return null;
    const entry = part as Value;
    const id = String(entry['table'] ?? '');
    const source = model.tables.find((candidate) => candidate.id === id);
    if (source === undefined) return `There is no table ${JSON.stringify(id)} for the ${what} to read.`;
    for (const [key, column] of Object.entries(entry)) {
      if (key === 'table' || typeof column !== 'string') continue;
      if (!source.columns.some((c) => c.name === column)) return `${source.name} has no column ${JSON.stringify(column)} for the ${what}.`;
    }
    return null;
  };
  const eligible = value['eligible'] as Value | undefined;
  const hours = value['hours'] as Value | undefined;
  for (const [part, what] of [
    [eligible === undefined ? undefined : { ...eligible, order: undefined }, 'list of who does what'],
    [eligible?.['order'], 'booking order'],
    [hours?.['practice'], 'opening hours'],
    [hours?.['own'], 'own hours'],
    [value['closures'], 'closures'],
  ] as const) {
    const issue = elsewhere(part, what);
    if (issue !== null) return issue;
  }
  if (eligible === undefined || hours?.['practice'] === undefined) return 'A booking rule names who does what and the opening hours.';

  for (const setting of [value['grid'], value['windowDays'], value['noticeMinutes'], cancel?.['hours']]) {
    if (typeof setting !== 'object' || setting === null) continue;
    const { table: id, column } = setting as { table: string; column: string };
    const source = model.tables.find((candidate) => candidate.id === id);
    if (source?.columns.some((c) => c.name === column) !== true) return `There is no column ${JSON.stringify(column)} in ${JSON.stringify(id)} to read.`;
  }
  return null;
}

/**
 * The reason a table's postings cannot be kept as they are stored, or `null`:
 * every column a posting names is a column of the table (or, under `via`, of
 * the row the lines belong to), `via` links the two, and a sibling table it
 * names is there.
 *
 * Whether a posting fits the ledger it goes into is judged with that add-on's
 * manifest at hand, where the rule is installed or saved; this is what the
 * database alone can say.
 */
export function postingsRuleIssue(raw: unknown, table: TableModel, model: DatabaseModel): string | null {
  const parsed = z.object({ postings: z.array(storedPosting).min(1).max(6) }).strict().safeParse(raw);
  if (!parsed.success) return `The postings of ${table.name} are not spelled as Adminium stores them: ${parsed.error.issues[0]?.message ?? 'invalid'}.`;
  const has = (of: TableModel, column: string): boolean => of.columns.some((c) => c.name === column);
  const seen = new Set<string>();
  for (const posting of parsed.data.postings) {
    const named = `The posting ${JSON.stringify(posting.id)}`;
    if (seen.has(posting.id)) return `Two postings of ${table.name} share the id ${JSON.stringify(posting.id)}.`;
    seen.add(posting.id);
    if (posting.reserve === undefined && posting.post === undefined) return `${named} says neither when it reserves nor when it posts.`;
    if (table.primaryKey.length !== 1) return `${named} needs rows it can name: ${table.name} has no single-column key.`;
    let parent: TableModel | undefined;
    if (posting.via !== undefined) {
      const link = model.relations.find((r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === posting.via);
      parent = link === undefined ? undefined : model.tables.find((candidate) => candidate.id === link.to.tableId);
      if (parent === undefined) return `${named} reads its rows as lines through ${JSON.stringify(posting.via)}, which links ${table.name} to no table.`;
    }
    for (const phase of ['reserve', 'post', 'reverse'] as const) {
      const point = posting[phase]?.on;
      if (point === undefined || 'create' in point || 'to' in point) continue;
      const judged = parent !== undefined && point.own !== true ? parent : table;
      if (!has(judged, point.column)) return `${named} fires on ${JSON.stringify(point.column)}, which is not a column of ${judged.name}.`;
    }
    const mappings: unknown[] = [...Object.values(posting.map), ...Object.values(posting.multipliers ?? {}), ...(posting.heldUntil === undefined ? [] : [posting.heldUntil])];
    for (const mapping of mappings) {
      if (typeof mapping === 'string') {
        if (!has(table, mapping)) return `${named} reads ${JSON.stringify(mapping)}, which is not a column of ${table.name}.`;
      } else if (typeof mapping === 'object' && mapping !== null && 'parent' in mapping) {
        const column = String((mapping as { parent: unknown }).parent);
        if (parent === undefined) return `${named} reads a column of its parent, and its rows are lines of nothing (no via).`;
        if (!has(parent, column)) return `${named} reads ${JSON.stringify(column)}, which is not a column of ${parent.name}.`;
      }
    }
    for (const column of [posting.unlessSet, posting.only?.column]) {
      if (column !== undefined && !has(table, column)) return `${named} reads ${JSON.stringify(column)}, which is not a column of ${table.name}.`;
    }
    for (const refusal of posting.refuses ?? []) {
      if ((refusal.table === undefined) !== (refusal.via === undefined)) return `${named} names lines of another table by that table and its link to the same parent: both, or neither.`;
      if (posting.via === undefined) return `${named} is refused by a sibling line, and its rows are lines of nothing (no via).`;
      const sibling = refusal.table === undefined ? table : model.tables.find((candidate) => candidate.id === refusal.table);
      if (sibling === undefined) return `${named} names the table ${JSON.stringify(refusal.table)}, which is not in this database.`;
      if (!has(sibling, refusal.column)) return `${named} reads ${JSON.stringify(refusal.column)}, which is not a column of ${sibling.name}.`;
    }
  }
  return null;
}

/**
 * Two tables of lines under one parent that each carry a posting of the same
 * id: a receipt names the parent row, the line and the rule, never the lines'
 * table, so a line of one would be taken for a line of the other. Names the
 * two, or `null`.
 */
export function viaPostingClash(rows: readonly { tableName: string; value: unknown }[], model: DatabaseModel): string | null {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const postings = (row.value as { postings?: { id?: unknown; via?: unknown }[] } | null)?.postings ?? [];
    for (const posting of postings) {
      if (typeof posting.id !== 'string' || typeof posting.via !== 'string') continue;
      const link = model.relations.find((r) => r.through === null && r.from.tableId === row.tableName && r.from.columns.length === 1 && r.from.columns[0] === posting.via);
      if (link === undefined) continue;
      const key = `${link.to.tableId}\u0000${posting.id}`;
      const other = seen.get(key);
      if (other !== undefined && other !== row.tableName) return `${other} and ${row.tableName} each have a posting ${JSON.stringify(posting.id)} for lines of ${link.to.tableId}: give the two different ids.`;
      seen.set(key, row.tableName);
    }
  }
  return null;
}

/**
 * The reason a table's price rule cannot be kept as it is stored, or `null`:
 * every column it names is a column of the table it names it on, and each
 * child table is one of this database's, linked to the order through `via`.
 *
 * Whether the rule fits the add-on that answers it is judged with that
 * add-on's manifest at hand; this is what the database alone can say.
 */
export function adjustRuleIssue(raw: unknown, table: TableModel, model: DatabaseModel): string | null {
  const parsed = storedAdjust.safeParse(raw);
  if (!parsed.success) return `The price rule of ${table.name} is not spelled as Adminium stores it: ${parsed.error.issues[0]?.message ?? 'invalid'}.`;
  const adjust = parsed.data;
  if (table.primaryKey.length !== 1) return `A price rule needs rows it can name: ${table.name} has no single-column key.`;
  const missing = (of: TableModel, columns: readonly (string | undefined)[]): string | null => {
    const gone = columns.find((column) => column !== undefined && !of.columns.some((c) => c.name === column));
    return gone === undefined ? null : `The price rule reads ${JSON.stringify(gone)}, which is not a column of ${of.name}.`;
  };
  const child = (id: string, via: string): TableModel | string => {
    const found = model.tables.find((candidate) => candidate.id === id);
    if (found === undefined) return `The price rule names the table ${JSON.stringify(id)}, which is not in this database.`;
    const linked = model.relations.some((r) => r.through === null && r.from.tableId === found.id && r.from.columns.length === 1 && r.from.columns[0] === via && r.to.tableId === table.id);
    return linked ? found : `${JSON.stringify(via)} does not link ${found.name} to ${table.name}, so its rows are no part of the order.`;
  };
  const order = adjust.order;
  const own = missing(table, [order.discount, order.customer?.link, order.customer?.proved, order.customer?.counts?.column, order.staff?.kind, order.staff?.value, order.staff?.reason, order.staff?.by, adjust.expect, adjust.refunds?.of, adjust.refunds?.taxOf, adjust.frozen !== undefined && 'column' in adjust.frozen ? adjust.frozen.column : undefined, typeof order.currency === 'string' ? order.currency : undefined]);
  if (own !== null) return own;
  for (const part of adjust.lines) {
    const of = 'self' in part ? table : child(part.table, part.via);
    if (typeof of === 'string') return of;
    const columns = 'self' in part ? [part.price, part.quantity, part.discount, ...part.what.map((what) => what.column), part.nights?.from, part.nights?.to, part.nights?.rate] : [part.via, part.price, part.quantity, part.discount, ...part.what.map((what) => what.column), part.excludes?.column, part.paidBy?.column, part.only?.column, part.unlessSet];
    const gone = missing(of, columns);
    if (gone !== null) return gone;
  }
  if (adjust.codes !== undefined) {
    const of = child(adjust.codes.table, adjust.codes.via);
    if (typeof of === 'string') return of;
    const gone = missing(of, [adjust.codes.typed, adjust.codes.code, adjust.codes.voucher, adjust.codes.removed]);
    if (gone !== null) return gone;
  }
  if (adjust.refunds !== undefined) {
    const of = child(adjust.refunds.table, adjust.refunds.via);
    if (typeof of === 'string') return of;
    const gone = missing(of, [adjust.refunds.amount, adjust.refunds.tax, adjust.refunds.against]);
    if (gone !== null) return gone;
    const lines = adjust.refunds.lines;
    if (lines !== undefined) {
      const returned = model.tables.find((candidate) => candidate.id === lines.table);
      if (returned === undefined) return `The price rule names the table ${JSON.stringify(lines.table)}, which is not in this database.`;
      const lost = missing(returned, [lines.via, lines.line, lines.quantity]);
      if (lost !== null) return lost;
    }
  }
  return null;
}
