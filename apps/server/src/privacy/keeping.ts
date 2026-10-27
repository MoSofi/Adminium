// SPDX-License-Identifier: AGPL-3.0-only
/**
 * HOW LONG WE KEEP THINGS: the rows of the privacy page's keeping table.
 *
 * Each row is something kept about people, and how long. This release has
 * two, both fixed: the consent history (it proves what a person agreed to or
 * asked) and the do-not-email list (an objection outlives the person who
 * made it). Neither can be shortened, so both read "Kept for good".
 *
 * Later releases add a row each for what they keep (form answers, chat
 * transcripts, page visits): a row with a `setting` is changed through that
 * settings key, in months, from its `options`; the sweep that erases past it
 * reads the same key.
 */
import type { SettingKey } from '@adminium/meta';

export interface KeepingRowDef {
  /** What it is: the screens word it (`studio:privacy.keeping.<key>`). */
  key: string;
  /** Fixed: kept for good, not changeable. */
  fixed: boolean;
  /** For a changeable row: the settings key holding its months, and the months offered. */
  setting?: SettingKey;
  options?: readonly number[];
}

/** The keeping table, in the order it is shown. Append; never reorder. */
export const KEEPING_ROWS: readonly KeepingRowDef[] = [
  { key: 'consent-history', fixed: true },
  { key: 'do-not-email', fixed: true },
];

export interface KeepingRow {
  key: string;
  fixed: boolean;
  /** `forever`, or how many months. */
  keptFor: 'forever' | number;
  options: number[];
}

/** The keeping table as it stands. */
export async function keepingRows(read: (key: SettingKey) => Promise<unknown>): Promise<KeepingRow[]> {
  const out: KeepingRow[] = [];
  for (const row of KEEPING_ROWS) {
    if (row.fixed || row.setting === undefined) {
      out.push({ key: row.key, fixed: true, keptFor: 'forever', options: [] });
      continue;
    }
    const months = await read(row.setting);
    out.push({ key: row.key, fixed: false, keptFor: typeof months === 'number' ? months : 'forever', options: [...(row.options ?? [])] });
  }
  return out;
}
