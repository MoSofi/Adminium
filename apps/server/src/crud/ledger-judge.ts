// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WOULD A PLAN FIT — answered from what was read, with nothing written.
 *
 * A quote and a "how much is left" question write no row of an add-on's
 * ledger, so the cap a save judges after its rows are in cannot be asked.
 * This works the same sum out in memory: each planned row adds to the total
 * of the parent it points at, the parent's balance moves by as much, and a
 * capped balance that would go below zero — and lower than it stands — is
 * refused, unless the parent's own switch lets it.
 *
 * The parent must be among the rows the action read: a parent nobody read
 * is not judged here. The save's cap stays the authority; a quote can say
 * yes and the save still refuse.
 *
 * Pure: no database.
 */
import type { RollupInto } from './column-rules.js';

type Scalar = string | number | boolean | null;
type ScalarRow = Record<string, Scalar>;

/** A planned insert, as the judge reads one: its table by the add-on's name, its line, its values. */
export interface JudgedInsert {
  table: string;
  line: string;
  values: Readonly<Record<string, unknown>>;
}

export interface JudgeModel {
  /** The totals a row of one of the add-on's tables feeds, by the add-on's name for the table. */
  rollups(table: string): readonly RollupInto[];
  /** Every row of a table (by its id) that the call read. */
  rows(tableId: string): readonly ScalarRow[];
}

export type JudgeResult = { ok: true } | { ok: false; line: string; left: string; table: string };

const PLACES = 6;
const SCALE = 10n ** BigInt(PLACES);

/** A decimal as a whole number of millionths; null when it is no number. */
function units(value: unknown): bigint | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean' || typeof value === 'object') return null;
  const text = typeof value === 'number' ? value.toFixed(PLACES) : String(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const scaled = BigInt(whole) * SCALE + BigInt(fraction.slice(0, PLACES).padEnd(PLACES, '0'));
  return negative ? -scaled : scaled;
}

function text(value: bigint): string {
  const negative = value < 0n;
  const digits = String(negative ? -value : value).padStart(PLACES + 1, '0');
  const fraction = digits.slice(-PLACES).replace(/0+$/, '');
  return `${negative ? '-' : ''}${digits.slice(0, -PLACES)}${fraction === '' ? '' : `.${fraction}`}`;
}

const filled = (value: unknown): boolean => value !== null && value !== undefined && value !== '';
const yes = (value: unknown): boolean => value === true || value === 1 || value === '1';

/** Whether the planned inserts fit under every capped balance the reads show; the first that does not, with its line and what is left. */
export function judgePlanned(inserts: readonly JudgedInsert[], model: JudgeModel): JudgeResult {
  // What each parent's total would take on, in the plan's order, with the line that first adds to it.
  const moved = new Map<string, { rollup: RollupInto; key: unknown; by: bigint; line: string }>();
  for (const row of inserts) {
    for (const rollup of model.rollups(row.table)) {
      const key = row.values[rollup.via];
      if (!filled(key) || typeof key === 'object') continue;
      if (rollup.unlessSet !== undefined && filled(row.values[rollup.unlessSet])) continue;
      if (rollup.where !== undefined && String(row.values[rollup.where.column] ?? '') !== String(rollup.where.eq)) continue;
      let amount = rollup.count === true ? SCALE : units(row.values[rollup.sum]);
      if (amount === null) continue;
      if (rollup.times !== undefined) {
        const times = units(row.values[rollup.times]);
        if (times === null) continue;
        amount = (amount * times) / SCALE;
      }
      const name = `${rollup.parent}\u0000${String(key)}\u0000${rollup.column}`;
      const entry = moved.get(name) ?? { rollup, key, by: 0n, line: row.line };
      entry.by += amount;
      moved.set(name, entry);
    }
  }
  for (const { rollup, key, by, line } of moved.values()) {
    const parent = model.rows(rollup.parent).find((candidate) => String(candidate[rollup.parentKey]) === String(key));
    if (parent === undefined) continue;
    for (const balance of rollup.balances) {
      if (!balance.cappedBy.includes(rollup.column)) continue;
      const stands = units(parent[balance.column]);
      if (stands === null) continue;
      // The total is taken off the balance, whether it is the balance's own total or one of what it takes off.
      const after = stands - by;
      if (after >= 0n || after >= stands) continue;
      if (balance.capUnless !== undefined && yes(parent[balance.capUnless])) continue;
      return { ok: false, line, left: text(stands < 0n ? 0n : stands), table: rollup.parent };
    }
  }
  return { ok: true };
}
