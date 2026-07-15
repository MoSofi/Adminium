/**
 * viewsRepo — adminium_views (07-meta-store.md §3.18, 04-widget-registry.md §6.3).
 *
 * Saved filters/layouts over a page. `user_id = NULL` is a shared workspace
 * view; a non-null `user_id` owns the view privately. `config` is an opaque
 * JSON envelope (page-crud grid state for `kind: 'filters'`, a `pageLayout`
 * for `kind: 'layout'`) — like `adminium_pages`, this package never interprets
 * it; the server route is the single write-time validator. Uniqueness is
 * `(page_id, user_id, name)`; at most one default per `(page_id, user_id)`
 * filter scope is app-enforced here in a transaction.
 *
 * The `kind` discriminator keeps the two surfaces from cross-contaminating: the
 * saved-views CRUD (`kind: 'filters'`) never lists a dashboard layout override
 * (`kind: 'layout'`), and the layout resolver never sees a filter view. Layout
 * overrides are one-per-(page, user) upserts under a reserved sentinel name.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumViewsTable } from '../schema/tables.js';
import { packJson, readBool, readJson, writeBool } from './util.js';

/** Row discriminator (04-widget-registry.md §6.3). */
export const VIEW_KINDS = ['filters', 'layout'] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

/**
 * Reserved name for the single per-user dashboard layout override row. Layout
 * rows are addressed by `(page_id, user_id, kind: 'layout')`, never by name,
 * but `name` is NOT NULL so this fills the column deterministically.
 */
export const LAYOUT_OVERRIDE_NAME = '__layout__';

export interface SavedView {
  id: string;
  pageId: string;
  /** NULL = shared workspace view; otherwise the owning user. */
  userId: string | null;
  /** `'filters'` (saved grid state) or `'layout'` (per-user dashboard override). */
  kind: ViewKind;
  name: string;
  /** Opaque grid-state / layout envelope (validated at the route layer). */
  config: unknown;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateViewInput {
  pageId: string;
  userId?: string | null;
  kind?: ViewKind;
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
    kind: (row.kind === 'layout' ? 'layout' : 'filters') satisfies ViewKind,
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
     * Saved *filter* views visible to `userId` on `pageId`: the user's own plus
     * every shared (NULL-owner) view. Defaults first, then alphabetical. Layout
     * overrides (`kind: 'layout'`) are excluded — they are not saved views.
     */
    async listForPageUser(pageId: string, userId: string): Promise<SavedView[]> {
      const rows = await db
        .selectFrom('adminium_views')
        .selectAll()
        .where('pageId', '=', pageId)
        .where('kind', '=', 'filters')
        .where((eb) => eb.or([eb('userId', '=', userId), eb('userId', 'is', null)]))
        .orderBy('isDefault', 'desc')
        .orderBy('name', 'asc')
        .execute();
      return rows.map(decode);
    },

    /** Owner-scoped existing filter-view name (uniqueness pre-check for a friendly 409). */
    async findByName(pageId: string, userId: string | null, name: string): Promise<SavedView | null> {
      let q = db
        .selectFrom('adminium_views')
        .selectAll()
        .where('pageId', '=', pageId)
        .where('kind', '=', 'filters')
        .where('name', '=', name);
      q = userId === null ? q.where('userId', 'is', null) : q.where('userId', '=', userId);
      const row = await q.executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    async create(input: CreateViewInput, at: number = Date.now()): Promise<SavedView> {
      const userId = input.userId ?? null;
      const kind: ViewKind = input.kind ?? 'filters';
      const isDefault = input.isDefault ?? false;
      const row = {
        id: newId('view'),
        pageId: input.pageId,
        userId,
        kind,
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

    // --- per-user dashboard layout overrides (04-widget-registry.md §6.3) -----
    // Exactly one row per (page_id, user_id, kind: 'layout'). Addressed by that
    // key, never by name; `config` holds the opaque `pageLayout` document.

    /** The caller's layout override for a page, or null if they follow the default. */
    async findLayoutOverride(pageId: string, userId: string): Promise<SavedView | null> {
      const row = await db
        .selectFrom('adminium_views')
        .selectAll()
        .where('pageId', '=', pageId)
        .where('userId', '=', userId)
        .where('kind', '=', 'layout')
        .executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    /** Insert or replace the caller's layout override for a page. */
    async upsertLayoutOverride(
      pageId: string,
      userId: string,
      config: unknown,
      at: number = Date.now(),
    ): Promise<SavedView> {
      const packed = packJson(config);
      const existing = await this.findLayoutOverride(pageId, userId);
      if (existing !== null) {
        await db
          .updateTable('adminium_views')
          .set({ config: packed, updatedAt: at })
          .where('id', '=', existing.id)
          .execute();
        return { ...existing, config: readJson(packed), updatedAt: at };
      }
      const row = {
        id: newId('view'),
        pageId,
        userId,
        kind: 'layout' as const,
        name: LAYOUT_OVERRIDE_NAME,
        config: packed,
        isDefault: writeBool(meta, false),
        createdAt: at,
        updatedAt: at,
      };
      await db.insertInto('adminium_views').values(row).execute();
      return decode(row as Selectable<AdminiumViewsTable>);
    },

    /** Remove the caller's layout override (the "Reset layout" action). */
    async deleteLayoutOverride(pageId: string, userId: string): Promise<boolean> {
      const res = await db
        .deleteFrom('adminium_views')
        .where('pageId', '=', pageId)
        .where('userId', '=', userId)
        .where('kind', '=', 'layout')
        .executeTakeFirst();
      return Number(res.numDeletedRows ?? 0n) >= 1;
    },
  };
}

export type ViewsRepo = ReturnType<typeof viewsRepo>;
