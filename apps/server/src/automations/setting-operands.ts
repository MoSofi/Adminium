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
 * from the app's own table as the rule reads the connection, whole: a setting
 * is a number, and decides which rows are visited, not what anybody is shown.
 */
import type { AutomationCondition } from '@adminium/meta';

import type { SettingReader } from '../outbox/timing.js';

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
