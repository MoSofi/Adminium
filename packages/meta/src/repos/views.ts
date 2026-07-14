/**
 * viewsRepo — adminium_views (07-meta-store.md §3.18).
 *
 * Saved filters/layouts over a page's grid state. `user_id = NULL` is a shared
 * workspace view; a non-null `user_id` owns the view privately. `config` is an
 * opaque JSON envelope (the page-crud grid state) — like `adminium_pages`,
 * this package never interprets it; the server route is the single write-time
 * validator. Uniqueness is `(page_id, user_id, name)`; at most one default per
 * `(page_id, user_id)` scope is app-enforced here in a transaction.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumViewsTable } from '../schema/tables.js';
import { packJson, readBool, readJson, writeBool } from './util.js';

export interface SavedView {
  id: string;
  pageId: string;
  /** NULL = shared workspace view; otherwise the owning user. */
  userId: string | null;
  name: string;
  /** Opaque grid-state envelope (validated at the route layer). */
  config: unknown;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateViewInput {
  pageId: string;
  userId?: string | null;
  name: string;
  config: unknown;
  isDefault?: boolean;
}

export interface UpdateViewInput {
  name?: string;
  config?: unknown;
  isDefault?: boolean;
}

function decode(row: Selectable<AdminiumViewsTable>): SavedView {
  return {
    id: row.id,
    pageId: row.pageId,
    userId: row.userId,
    name: row.name,
    config: readJson(row.config),
    isDefault: readBool(row.isDefault),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function viewsRepo(meta: MetaDb) {
  const { db } = meta;

  return {
    async findById(id: string): Promise<SavedView | null> {
      const row = await db.selectFrom('adminium_views').selectAll().where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    /**
     * Views visible to `userId` on `pageId`: the user's own plus every shared
     * (NULL-owner) view. Defaults first, then alphabetical.
     */
    async listForPageUser(pageId: string, userId: string): Promise<SavedView[]> {
      const rows = await db
        .selectFrom('adminium_views')
        .selectAll()
        .where('pageId', '=', pageId)
        .where((eb) => eb.or([eb('userId', '=', userId), eb('userId', 'is', null)]))
        .orderBy('isDefault', 'desc')
        .orderBy('name', 'asc')
        .execute();
      return rows.map(decode);
    },

    /** Owner-scoped existing name (uniqueness pre-check for a friendly 409). */
    async findByName(pageId: string, userId: string | null, name: string): Promise<SavedView | null> {
      let q = db
        .selectFrom('adminium_views')
        .selectAll()
        .where('pageId', '=', pageId)
        .where('name', '=', name);
      q = userId === null ? q.where('userId', 'is', null) : q.where('userId', '=', userId);
      const row = await q.executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    async create(input: CreateViewInput, at: number = Date.now()): Promise<SavedView> {
      const userId = input.userId ?? null;
      const isDefault = input.isDefault ?? false;
      const row = {
        id: newId('view'),
        pageId: input.pageId,
        userId,
        name: input.name,
        config: packJson(input.config),
        isDefault: writeBool(meta, isDefault),
        createdAt: at,
        updatedAt: at,
      };
      await db.transaction().execute(async (trx) => {
        if (isDefault) {
          const clear = userId === null
            ? trx.updateTable('adminium_views').set({ isDefault: writeBool(meta, false) }).where('pageId', '=', input.pageId).where('userId', 'is', null)
            : trx.updateTable('adminium_views').set({ isDefault: writeBool(meta, false) }).where('pageId', '=', input.pageId).where('userId', '=', userId);
          await clear.execute();
        }
        await trx.insertInto('adminium_views').values(row).execute();
      });
      return decode(row as Selectable<AdminiumViewsTable>);
    },

    async update(id: string, patch: UpdateViewInput, at: number = Date.now()): Promise<SavedView | null> {
      const current = await this.findById(id);
      if (current === null) return null;
      const set: Record<string, unknown> = { updatedAt: at };
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.config !== undefined) set.config = packJson(patch.config);
      if (patch.isDefault !== undefined) set.isDefault = writeBool(meta, patch.isDefault);

      await db.transaction().execute(async (trx) => {
        if (patch.isDefault === true) {
          const clear = current.userId === null
            ? trx.updateTable('adminium_views').set({ isDefault: writeBool(meta, false) }).where('pageId', '=', current.pageId).where('userId', 'is', null)
            : trx.updateTable('adminium_views').set({ isDefault: writeBool(meta, false) }).where('pageId', '=', current.pageId).where('userId', '=', current.userId);
          await clear.where('id', '!=', id).execute();
        }
        await trx.updateTable('adminium_views').set(set as never).where('id', '=', id).execute();
      });
      return this.findById(id);
    },

    async delete(id: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_views').where('id', '=', id).executeTakeFirst();
      return Number(res.numDeletedRows ?? 0n) === 1;
    },
  };
}

export type ViewsRepo = ReturnType<typeof viewsRepo>;
