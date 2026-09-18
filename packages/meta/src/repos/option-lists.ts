// SPDX-License-Identifier: AGPL-3.0-only
/**
 * optionListsRepo — `adminium_option_lists` (wave 0035).
 *
 * The answers a column accepts, named once. Everything that
 * references a list names its `key`; the id is internal, because a rule naming
 * a list travels in a project file and plan 49's gate refuses an instance id in
 * one.
 *
 * The repo validates the SHAPE — a slug, a name, items that are not empty and
 * not repeated. Whether a key may be deleted is a question about the RULES that
 * name it, which live in another table and are the route's business.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumOptionListsTable } from '../schema/tables.js';
import { MetaValidationError, packJson, readJson } from './util.js';

/** One answer. Mirrors `optionListItemSchema` in the page-config leaf. */
export interface OptionListItem {
  value: string;
  label?: string | undefined;
  tone?: string | undefined;
  description?: string | undefined;
}

export interface OptionListRow {
  id: string;
  key: string;
  name: string;
  items: OptionListItem[];
  /** `custom`, or `copy:<builtin key>`. */
  origin: string;
  createdAt: number;
  updatedAt: number;
}

export interface OptionListInput {
  key: string;
  name: string;
  items: OptionListItem[];
  origin?: string;
}

/** The same slug shape the leaf's schema enforces, and for the same reason. */
const KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

/** 500 is the ceiling a list is still a list at; past it, it is a table. */
export const MAX_OPTION_LIST_ITEMS = 500;

function checkInput(input: OptionListInput): void {
  if (input.key.length === 0 || input.key.length > 120 || !KEY_PATTERN.test(input.key)) {
    throw new MetaValidationError(`invalid option list key ${JSON.stringify(input.key)}`);
  }
  if (input.name.trim().length === 0 || input.name.length > 200) {
    throw new MetaValidationError('an option list needs a name');
  }
  if (input.items.length === 0) {
    throw new MetaValidationError('an option list with no values is not a list');
  }
  if (input.items.length > MAX_OPTION_LIST_ITEMS) {
    throw new MetaValidationError(`an option list holds at most ${String(MAX_OPTION_LIST_ITEMS)} values`);
  }
  const seen = new Set<string>();
  for (const item of input.items) {
    if (item.value.length === 0 || item.value.length > 256) {
      throw new MetaValidationError('every option needs a value');
    }
    if (seen.has(item.value)) {
      throw new MetaValidationError(`${JSON.stringify(item.value)} is listed twice`);
    }
    seen.add(item.value);
  }
}

function decode(row: Selectable<AdminiumOptionListsTable>): OptionListRow {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    items: readJson<OptionListItem[]>(row.items),
    origin: row.origin,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

export function optionListsRepo(meta: MetaDb) {
  const { db } = meta;

  return {
    async list(): Promise<OptionListRow[]> {
      const rows = await db.selectFrom('adminium_option_lists').selectAll().orderBy('key', 'asc').execute();
      return rows.map(decode);
    },

    async findByKey(key: string): Promise<OptionListRow | null> {
      const row = await db
        .selectFrom('adminium_option_lists')
        .selectAll()
        .where('key', '=', key)
        .executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    async create(input: OptionListInput, at: number = Date.now()): Promise<OptionListRow> {
      checkInput(input);
      const existing = await this.findByKey(input.key);
      if (existing !== null) {
        throw new MetaValidationError(`a list called ${JSON.stringify(input.key)} already exists`);
      }
      const row = {
        id: newId('opl'),
        key: input.key,
        name: input.name,
        items: packJson(input.items),
        origin: input.origin ?? 'custom',
        createdAt: at,
        updatedAt: at,
      };
      await db.insertInto('adminium_option_lists').values(row).execute();
      return decode(row as unknown as Selectable<AdminiumOptionListsTable>);
    },

    /**
     * Replace a list's name and items. The KEY never moves: it is what rules,
     * project files and other installs name, and renaming it would silently
     * unbind every column that used it. A list gets a new key by being a new
     * list.
     */
    async update(
      key: string,
      patch: { name?: string | undefined; items?: OptionListItem[] | undefined },
      at: number = Date.now(),
    ): Promise<OptionListRow | null> {
      const existing = await this.findByKey(key);
      if (existing === null) return null;
      const next: OptionListInput = {
        key,
        name: patch.name ?? existing.name,
        items: patch.items ?? existing.items,
      };
      checkInput(next);
      await db
        .updateTable('adminium_option_lists')
        .set({ name: next.name, items: packJson(next.items), updatedAt: at })
        .where('key', '=', key)
        .execute();
      return { ...existing, name: next.name, items: next.items, updatedAt: at };
    },

    async remove(key: string): Promise<boolean> {
      const result = await db
        .deleteFrom('adminium_option_lists')
        .where('key', '=', key)
        .executeTakeFirst();
      return Number(result.numDeletedRows) > 0;
    },

    /**
     * A stamp that moves whenever ANY list does.
     *
     * The data route rebuilds its `SnapshotView` on a stamp of the snapshot and
     * the override set; a rule that names a list is enforced from the list's
     * values, so the view has to notice a list changing too. Cheaper than
     * reading every list on every write, and it moves for a create, an edit and
     * a delete alike (the count covers the delete that lowers `max`).
     */
    async revision(): Promise<string> {
      const row = await db
        .selectFrom('adminium_option_lists')
        .select(({ fn }) => [fn.count<number>('id').as('count'), fn.max('updatedAt').as('latest')])
        .executeTakeFirst();
      return `${String(row?.count ?? 0)}:${String(row?.latest ?? 0)}`;
    },
  };
}

export type OptionListsRepo = ReturnType<typeof optionListsRepo>;
