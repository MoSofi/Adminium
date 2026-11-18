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
 * Later releases add a row each for what they keep (chat transcripts, page
 * visits): a row with a `setting` is changed through that settings key, in
 * months, from its `options`; the sweep that erases past it reads the same
 * key.
 *
 * A forms add-on's answers are a row each ({@link formAnswersKeeping}): how
 * long is the add-on's own setting (its settings table's `answers_months`),
 * changed on the add-on's settings screen and read here; the engine's sweep
 * deletes the answers past it (`forms/answers.ts`). Empty: kept until
 * somebody removes them (or the person is erased).
 *
 * A chat add-on's conversations are a row each ({@link chatTranscriptsKeeping}),
 * the same way: its settings' `transcripts_months` (12 until the settings row
 * is made; empty: kept until removed), swept daily by the engine with their
 * messages and choices (`chat/transcripts.ts`).
 *
 * An add-on that finds people keeps a row each while it keeps people
 * ({@link foundPeopleKeeping}): how many years is its settings'
 * `keep_years` (1 to 10, 3 by default), counted from the day a person was
 * found or the last time they wrote, and never renewed by finding them
 * again; the engine's sweep erases them past it, and erases one who was not
 * told by their "tell by" day (`leads/sweep.ts`). The row is there, and
 * required, while people are on.
 */
import type { MetaDb, SettingKey } from '@adminium/meta';
import { sql } from 'kysely';

import type { ConnectionManager } from '../connections/manager.js';
import type { SnapshotView } from '../crud/identifiers.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { answersMonths } from '../forms/answers.js';
import { formsAddOnsOn, storedFormsAddOns } from '../forms/installed.js';
import { chatAddOnsOn, storedChatAddOns, transcriptsMonths } from '../chat/transcripts.js';
import { leadsAddOnsOn, readLeadsSettings, storedLeadsAddOns } from '../leads/installs.js';

/** How long a fixed row is kept. */
export type FixedKeep = 'forever' | 'until-erased' | 'until-removed';

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
  /** `forever`, `until-erased`, `until-removed`, or how many months. */
  keptFor: FixedKeep | number;
  options: number[];
  /** A row an add-on keeps: the add-on, whose own settings say how long. */
  addOn?: { key: string; name: string };
}

/** The key of a forms add-on's answers row. */
export const FORM_ANSWERS_KEEPING = 'form-answers';

/** One row per installed forms add-on with an answers table: how long it keeps its answers (see the header). */
export async function formAnswersKeeping(deps: { meta: MetaDb; manager: Pick<ConnectionManager, 'data'> }): Promise<KeepingRow[]> {
  const stored = await storedFormsAddOns(deps.meta);
  const out: KeepingRow[] = [];
  for (const connectionId of [...new Set(stored.map((one) => one.connectionId))].sort()) {
    let view: SnapshotView;
    try {
      view = await loadSnapshotView(deps.meta, connectionId, { forOthers: true });
    } catch {
      continue;
    }
    for (const addOn of await formsAddOnsOn(deps.meta, connectionId, view, stored)) {
      if (addOn.answers === null) continue;
      let months: number | null = null;
      try {
        months = await answersMonths((await deps.manager.data(connectionId)).db, addOn);
      } catch {
        // A database that cannot be read now: said as kept until removed, which is what its sweep does while it cannot run.
      }
      out.push({ key: FORM_ANSWERS_KEEPING, fixed: true, keptFor: months ?? 'until-removed', options: [], addOn: { key: addOn.key, name: addOn.name } });
    }
  }
  return out;
}

/** The key of a chat add-on's conversations row. */
export const CHAT_TRANSCRIPTS_KEEPING = 'chat-conversations';

/** One row per installed chat add-on with a conversations table: how long it keeps its conversations. */
export async function chatTranscriptsKeeping(deps: { meta: MetaDb; manager: Pick<ConnectionManager, 'data'> }): Promise<KeepingRow[]> {
  const stored = await storedChatAddOns(deps.meta);
  const out: KeepingRow[] = [];
  for (const connectionId of [...new Set(stored.map((one) => one.connectionId))].sort()) {
    let view: SnapshotView;
    try {
      view = await loadSnapshotView(deps.meta, connectionId, { forOthers: true });
    } catch {
      continue;
    }
    for (const addOn of await chatAddOnsOn(deps.meta, connectionId, view, stored)) {
      if (addOn.conversations === null) continue;
      let months: number | null = null;
      try {
        months = await transcriptsMonths((await deps.manager.data(connectionId)).db, addOn);
      } catch {
        // A database that cannot be read now: said as kept until removed, which is what its sweep does while it cannot run.
      }
      out.push({ key: CHAT_TRANSCRIPTS_KEEPING, fixed: true, keptFor: months ?? 'until-removed', options: [], addOn: { key: addOn.key, name: addOn.name } });
    }
  }
  return out;
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

/** The key of the row for the people an add-on found. */
export const FOUND_PEOPLE_KEEPING = 'found-people';

/** One row per installed add-on that keeps the people it finds: how long it keeps them, in months (see the header). */
export async function foundPeopleKeeping(deps: { meta: MetaDb; manager: Pick<ConnectionManager, 'data'> }): Promise<KeepingRow[]> {
  const stored = await storedLeadsAddOns(deps.meta);
  const out: KeepingRow[] = [];
  for (const connectionId of [...new Set(stored.map((one) => one.connectionId))].sort()) {
    let view: SnapshotView;
    try {
      view = await loadSnapshotView(deps.meta, connectionId, { forOthers: true });
    } catch {
      continue;
    }
    for (const addOn of await leadsAddOnsOn(deps.meta, connectionId, view, stored)) {
      if (addOn.foundPeople === null) continue;
      const table = addOn.foundPeople;
      let settings;
      let any = false;
      try {
        const { db } = await deps.manager.data(connectionId);
        settings = await readLeadsSettings(db, addOn);
        // People switched off again: the ones found before are still kept, for as long as the row says.
        if (!settings.peopleOn) any = (await db.selectFrom(table.id as never).select(sql<number>`1`.as('one') as never).limit(1).executeTakeFirst()) !== undefined;
      } catch {
        // A database that cannot be read now: nothing is said of it until it can be.
        continue;
      }
      if (!settings.peopleOn && !any) continue;
      out.push({ key: FOUND_PEOPLE_KEEPING, fixed: true, keptFor: settings.keepYears * 12, options: [], addOn: { key: addOn.key, name: addOn.name } });
    }
  }
  return out;
}
