// SPDX-License-Identifier: AGPL-3.0-only
/**
 * HOW LONG WE KEEP THINGS: the rows of the privacy page's keeping table.
 *
 * Each row is something kept about people, and how long. This release has
 * two, both fixed: the consent history (it proves what a person agreed to or
 * asked; kept until that person is erased, which deletes it) and the
 * do-not-email list (an objection outlives the person who made it: kept for
 * good, as a code once they are erased). Neither can be shortened.
 *
 * Later releases add a row each for what they keep (form answers, chat
 * transcripts, page visits): a row with a `setting` is changed through that
 * settings key, in months, from its `options`; the sweep that erases past it
 * reads the same key.
 */
import type { SettingKey } from '@adminium/meta';

/** How long a fixed row is kept. */
export type FixedKeep = 'forever' | 'until-erased';

export interface KeepingRowDef {
  /** What it is: the screens word it (`studio:privacy.keeping.<key>`). */
  key: string;
  /** Fixed: not changeable. */
  fixed: boolean;
  /** For a fixed row: how long (`forever`, or until the person is erased). */
  keptFor?: FixedKeep;
  /** For a changeable row: the settings key holding its months, and the months offered. */
  setting?: SettingKey;
  options?: readonly number[];
}

/** The keeping table, in the order it is shown. Append; never reorder. */
export const KEEPING_ROWS: readonly KeepingRowDef[] = [
  { key: 'consent-history', fixed: true, keptFor: 'until-erased' },
  { key: 'do-not-email', fixed: true, keptFor: 'forever' },
];

export interface KeepingRow {
  key: string;
  fixed: boolean;
  /** `forever`, `until-erased`, or how many months. */
  keptFor: FixedKeep | number;
  options: number[];
}

/** The keeping table as it stands. */
export async function keepingRows(read: (key: SettingKey) => Promise<unknown>): Promise<KeepingRow[]> {
  const out: KeepingRow[] = [];
  for (const row of KEEPING_ROWS) {
    if (row.fixed || row.setting === undefined) {
      out.push({ key: row.key, fixed: true, keptFor: row.keptFor ?? 'forever', options: [] });
      continue;
    }
    const months = await read(row.setting);
    out.push({ key: row.key, fixed: false, keptFor: typeof months === 'number' ? months : 'forever', options: [...(row.options ?? [])] });
  }
  return out;
}
