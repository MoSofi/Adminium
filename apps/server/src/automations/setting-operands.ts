// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN AMOUNT OF TIME READ FROM A SETTING.
 *
 * A relative condition says how long: `{ "amount": 7, "unit": "days" }`. It
 * may say instead where the business keeps that number: `"setting": { "table",
 * "column" }`, a whole-number column of the app's settings row (its first
 * row). "Quiet for more than `settings.nudge_quiet_days` days" then follows the
 * number the owner sets on the app's own Settings screen. `amount` stays the
 * number used while the setting holds nothing a day count can be (empty, not
 * a whole number, below 1 or above 3650), so a rule never reads "0 days".
 *
 * The setting is read when the conditions are read: once per tick of a
 * schedule's scan, and as a step of the run reaches a condition. It is read
 * as the rule reads the connection (`ruleSettingReader`): a private table is
 * not there, a secret or personal column holds nothing, and the row read is
 * the one with the lowest key. Which rows a rule visits answers the question
 * "is this number above that one", so a number is no way to read a table:
 * the rule's author must read the table it is kept in (`requiredGrants`), and
 * a protected column is refused when the rule is saved (`checkCondition`).
 */
import type { AutomationCondition, MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { SnapshotView } from '../crud/identifiers.js';
import { settingReader, type SettingReader } from '../outbox/timing.js';

type Relative = { amount: number; unit: 'minutes' | 'hours' | 'days'; setting?: { table: string; column: string } | undefined };

const relativeWithSetting = (right: unknown): right is Relative & { setting: { table: string; column: string } } =>
  typeof right === 'object' && right !== null && 'setting' in right && typeof (right as Relative).setting === 'object' && (right as Relative).setting !== null;

/** Whether any of these conditions reads its amount from a setting. */
export function readsSettings(conditions: readonly AutomationCondition[]): boolean {
  return conditions.some((condition) => relativeWithSetting(condition.right));
}

/** A setting's value as a number of units: a whole number from 1 to 3650, or null. */
function amountOf(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : null;
}

/** The conditions with each amount a setting holds put in its place, and the setting left out. */
export async function withSettingAmounts(conditions: readonly AutomationCondition[], read: SettingReader): Promise<AutomationCondition[]> {
  const out: AutomationCondition[] = [];
  for (const condition of conditions) {
    const right = condition.right;
    if (!relativeWithSetting(right)) {
      out.push(condition);
      continue;
    }
    const held = amountOf(await read({ table: right.setting.table, column: right.setting.column }));
    out.push({ ...condition, right: { amount: held ?? right.amount, unit: right.unit } } as AutomationCondition);
  }
  return out;
}

/**
 * A rule's reader of the amounts its conditions keep in a setting, through
 * the view the rule reads the connection in (private tables left out): a
 * table that is not there, a column that is not, or one that is secret,
 * personal or hidden, holds nothing, and the rule's own amount is used. An
 * add-on's setting is no amount of a rule.
 */
export function ruleSettingReader(meta: MetaDb, db: Kysely<SourceDatabase>, view: SnapshotView): SettingReader {
  const read = settingReader(meta, db, view);
  return async (source) => {
    if ('addOn' in source) return undefined;
    const column = view.linkTable(source.table)?.columns.get(source.column);
    if (column === undefined || column.secret || column.masked || column.unreadable === true) return undefined;
    return read(source);
  };
}
