// SPDX-License-Identifier: AGPL-3.0-only
/**
 * publicUploadsRepo — adminium_public_uploads (0074): files strangers
 * uploaded, what each was taken for, and whose it became.
 *
 * The bytes are an `adminium_files` row of kind `stranger`; the server's
 * upload store (`apps/server/src/public-uploads/`) writes both. This repo
 * owns the rules a row moves by:
 *
 *  - ATTACH IS ALL OR NOTHING: every id named must be here, unattached, not
 *    expired and of the very same binding (what it was taken for and the
 *    address it came from), or none is attached. One statement in one
 *    transaction, so two answers naming the same file cannot both take it.
 *  - A swept file leaves an empty row (no name, no file) until a day after it
 *    came: the per-address daily count still sees it.
 *  - A guest's file for an app's column (binding kind `column`) is HELD for
 *    the row a write is making (owner named, out of the sweep), then ADOPTED
 *    once that write commits: the file becomes the row's own and this row is
 *    closed (`removed_at` set, no file), kept only for the address's day.
 *    The binding of such a file names what it is for and no address: the
 *    address is kept for the daily caps only.
 */
import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import type { AdminiumPublicUploadsTable } from '../schema/tables.js';
import { affected } from './util.js';

/** What an upload was taken for, and from where. */
export interface PublicUploadBinding {
  /** What kind of thing took it (`form`). */
  kind: string;
  /** Which one (`<add-on>/<form id>`). */
  key: string;
  /** The keyed hash of the network address it came from (its /64). */
  addressKey: string;
}

/** The row a file became part of. */
export interface PublicUploadOwner {
  connectionId: string;
  /** The table's id on that connection. */
  table: string;
  /** The row's key, as text. */
  key: string;
}

export interface PublicUpload {
  id: string;
  binding: PublicUploadBinding;
  /** Null once the sweep took the file away. */
  name: string | null;
  size: number;
  kind: string;
  fileId: string | null;
  createdAt: number;
  expiresAt: number | null;
  attachedAt: number | null;
  owner: PublicUploadOwner | null;
  removedAt: number | null;
}

export interface CreatePublicUploadInput {
  id: string;
  binding: PublicUploadBinding;
  name: string;
  size: number;
  kind: string;
  fileId: string;
  expiresAt: number;
}

function decode(row: Selectable<AdminiumPublicUploadsTable>): PublicUpload {
  return {
    id: row.id,
    binding: { kind: row.bindingKind, key: row.bindingKey, addressKey: row.addressKey },
    name: row.name,
    size: Number(row.size),
    kind: row.kind,
    fileId: row.fileId,
    createdAt: Number(row.createdAt),
    expiresAt: row.expiresAt === null ? null : Number(row.expiresAt),
    attachedAt: row.attachedAt === null ? null : Number(row.attachedAt),
    owner:
      row.ownerConnectionId === null || row.ownerTable === null || row.ownerKey === null
        ? null
        : { connectionId: row.ownerConnectionId, table: row.ownerTable, key: row.ownerKey },
    removedAt: row.removedAt === null ? null : Number(row.removedAt),
  };
}

/** Thrown inside the attach's transaction to roll it back. */
class NotAll extends Error {}

export function publicUploadsRepo(meta: MetaDb) {
  const { db } = meta;

  return {
    async create(input: CreatePublicUploadInput, at: number = Date.now()): Promise<PublicUpload> {
      await db
        .insertInto('adminium_public_uploads')
        .values({
          id: input.id,
          bindingKind: input.binding.kind,
          bindingKey: input.binding.key,
          addressKey: input.binding.addressKey,
          name: input.name,
          size: input.size,
          kind: input.kind,
          fileId: input.fileId,
          createdAt: at,
          expiresAt: input.expiresAt,
          attachedAt: null,
          ownerConnectionId: null,
          ownerTable: null,
          ownerKey: null,
          removedAt: null,
        })
        .execute();
      return {
        id: input.id,
        binding: { ...input.binding },
        name: input.name,
        size: input.size,
        kind: input.kind,
        fileId: input.fileId,
        createdAt: at,
        expiresAt: input.expiresAt,
        attachedAt: null,
        owner: null,
        removedAt: null,
      };
    },

    async findById(id: string): Promise<PublicUpload | null> {
      const row = await db.selectFrom('adminium_public_uploads').selectAll().where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    async findMany(ids: readonly string[]): Promise<PublicUpload[]> {
      if (ids.length === 0) return [];
      const rows = await db.selectFrom('adminium_public_uploads').selectAll().where('id', 'in', [...ids]).orderBy('id').execute();
      return rows.map(decode);
    },

    /**
     * Attach every one of `ids` to `owner`, or none: each must be here,
     * unattached, not swept, not expired at `at`, and of exactly this
     * binding. True when all were attached.
     */
    async attach(ids: readonly string[], binding: PublicUploadBinding, owner: PublicUploadOwner, at: number = Date.now()): Promise<boolean> {
      const unique = [...new Set(ids)];
      if (unique.length === 0) return true;
      if (unique.length !== ids.length) return false;
      try {
        await db.transaction().execute(async (trx) => {
          const res = await trx
            .updateTable('adminium_public_uploads')
            .set({ attachedAt: at, expiresAt: null, ownerConnectionId: owner.connectionId, ownerTable: owner.table, ownerKey: owner.key })
            .where('id', 'in', unique)
            .where('bindingKind', '=', binding.kind)
            .where('bindingKey', '=', binding.key)
            .where('addressKey', '=', binding.addressKey)
            .where('attachedAt', 'is', null)
            .where('removedAt', 'is', null)
            .where('expiresAt', '>', at)
            .executeTakeFirst();
          if (affected(res.numUpdatedRows) !== unique.length) throw new NotAll();
        });
        return true;
      } catch (error) {
        if (error instanceof NotAll) return false;
        throw error;
      }
    },

    /**
     * Hold every one of `ids` for `owner` (a write about to make or change
     * that row), or none: each must be here, unattached, not swept, not
     * expired at `at`, and taken for exactly this thing (`kind` + `key`),
     * from any address. True when all were held.
     */
    async hold(ids: readonly string[], target: { kind: string; key: string }, owner: PublicUploadOwner, at: number = Date.now()): Promise<boolean> {
      const unique = [...new Set(ids)];
      if (unique.length === 0) return true;
      if (unique.length !== ids.length) return false;
      try {
        await db.transaction().execute(async (trx) => {
          const res = await trx
            .updateTable('adminium_public_uploads')
            .set({ attachedAt: at, expiresAt: null, ownerConnectionId: owner.connectionId, ownerTable: owner.table, ownerKey: owner.key })
            .where('id', 'in', unique)
            .where('bindingKind', '=', target.kind)
            .where('bindingKey', '=', target.key)
            .where('attachedAt', 'is', null)
            .where('removedAt', 'is', null)
            .where('expiresAt', '>', at)
            .executeTakeFirst();
          if (affected(res.numUpdatedRows) !== unique.length) throw new NotAll();
        });
        return true;
      } catch (error) {
        if (error instanceof NotAll) return false;
        throw error;
      }
    },

    /**
     * Let go of held files whose write did not stand (or never came): each
     * unattached again until its own expiry. Only a hold of `kind` not yet
     * adopted. Answers how many were let go.
     */
    async release(holds: readonly { id: string; expiresAt: number }[], kind: string): Promise<number> {
      let n = 0;
      for (const one of holds) {
        const res = await db
          .updateTable('adminium_public_uploads')
          .set({ attachedAt: null, expiresAt: one.expiresAt, ownerConnectionId: null, ownerTable: null, ownerKey: null })
          .where('id', '=', one.id)
          .where('bindingKind', '=', kind)
          .where('attachedAt', 'is not', null)
          .where('removedAt', 'is', null)
          .executeTakeFirst();
        n += affected(res.numUpdatedRows);
      }
      return n;
    },

    /**
     * A held file became its row's own: this row is closed — the owner as
     * the row's key, no file, `removed_at` set — kept only for the address's
     * day. True when it was closed (a hold of `kind` not adopted before).
     */
    async adopt(id: string, kind: string, owner: PublicUploadOwner, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_public_uploads')
        .set({ removedAt: at, fileId: null, expiresAt: null, ownerConnectionId: owner.connectionId, ownerTable: owner.table, ownerKey: owner.key })
        .where('id', '=', id)
        .where('bindingKind', '=', kind)
        .where('attachedAt', 'is not', null)
        .where('removedAt', 'is', null)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Holds of `kind` made before `before` and not adopted: a write that may have stopped between its commit and its adoption. */
    async heldBefore(kind: string, before: number, limit = 100): Promise<PublicUpload[]> {
      const rows = await db
        .selectFrom('adminium_public_uploads')
        .selectAll()
        .where('bindingKind', '=', kind)
        .where('attachedAt', 'is not', null)
        .where('attachedAt', '<=', before)
        .where('removedAt', 'is', null)
        .orderBy('attachedAt')
        .orderBy('id')
        .limit(limit)
        .execute();
      return rows.map(decode);
    },

    /** Let go of files `owner` took (its write did not stand): unattached again, until `expiresAt`. */
    async detach(ids: readonly string[], owner: PublicUploadOwner, expiresAt: number): Promise<number> {
      if (ids.length === 0) return 0;
      const res = await db
        .updateTable('adminium_public_uploads')
        .set({ attachedAt: null, expiresAt, ownerConnectionId: null, ownerTable: null, ownerKey: null })
        .where('id', 'in', [...ids])
        .where('ownerConnectionId', '=', owner.connectionId)
        .where('ownerTable', '=', owner.table)
        .where('ownerKey', '=', owner.key)
        .executeTakeFirst();
      return affected(res.numUpdatedRows);
    },

    /** Unattached files whose time ran out before `at`, oldest first. */
    async expiredBefore(at: number, limit = 100): Promise<PublicUpload[]> {
      const rows = await db
        .selectFrom('adminium_public_uploads')
        .selectAll()
        .where('attachedAt', 'is', null)
        .where('removedAt', 'is', null)
        .where('expiresAt', '<=', at)
        .orderBy('expiresAt')
        .orderBy('id')
        .limit(limit)
        .execute();
      return rows.map(decode);
    },

    /**
     * The sweep took an unattached file's bytes: the row keeps only what the
     * daily count needs. Only while still unattached (a write that took it
     * since keeps it). True when it was emptied.
     */
    async markRemoved(id: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_public_uploads')
        .set({ removedAt: at, name: null, fileId: null, expiresAt: null })
        .where('id', '=', id)
        .where('attachedAt', 'is', null)
        .where('removedAt', 'is', null)
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** The files the rows `keys` of one table took. */
    async ownedBy(connectionId: string, table: string, keys: readonly string[]): Promise<PublicUpload[]> {
      if (keys.length === 0) return [];
      const rows = await db
        .selectFrom('adminium_public_uploads')
        .selectAll()
        .where('ownerConnectionId', '=', connectionId)
        .where('ownerTable', '=', table)
        .where('ownerKey', 'in', [...keys])
        .orderBy('id')
        .execute();
      return rows.map(decode);
    },

    /** Every file taken for one thing (a form), attached or not, still holding its bytes. */
    async boundTo(kind: string, key: string): Promise<PublicUpload[]> {
      const rows = await db
        .selectFrom('adminium_public_uploads')
        .selectAll()
        .where('bindingKind', '=', kind)
        .where('bindingKey', '=', key)
        .where('removedAt', 'is', null)
        .orderBy('id')
        .execute();
      return rows.map(decode);
    },

    async delete(ids: readonly string[]): Promise<number> {
      if (ids.length === 0) return 0;
      const res = await db.deleteFrom('adminium_public_uploads').where('id', 'in', [...ids]).executeTakeFirst();
      return affected(res.numDeletedRows);
    },

    /** Empty rows of swept files that came before `before`: the daily count no longer needs them. */
    async dropRemovedBefore(before: number): Promise<number> {
      const res = await db.deleteFrom('adminium_public_uploads').where('removedAt', 'is not', null).where('createdAt', '<', before).executeTakeFirst();
      return affected(res.numDeletedRows);
    },

    /** The bytes kept now, attached or not. */
    async keptBytes(): Promise<number> {
      const row = await db
        .selectFrom('adminium_public_uploads')
        .select((eb) => eb.fn.sum<number | string | null>('size').as('total'))
        .where('removedAt', 'is', null)
        .executeTakeFirst();
      return Number(row?.total ?? 0);
    },

    /**
     * The bytes of files waiting to be attached (taken, not held, adopted or
     * swept), of one pool: binding kinds `in` it, or every kind `notIn` it.
     */
    async waitingBytes(pool: { in: readonly string[] } | { notIn: readonly string[] }): Promise<number> {
      let query = db
        .selectFrom('adminium_public_uploads')
        .select((eb) => eb.fn.sum<number | string | null>('size').as('total'))
        .where('removedAt', 'is', null)
        .where('attachedAt', 'is', null);
      query = 'in' in pool ? query.where('bindingKind', 'in', [...pool.in]) : query.where('bindingKind', 'not in', [...pool.notIn]);
      const row = await query.executeTakeFirst();
      return Number(row?.total ?? 0);
    },

    /** How many bytes one address sent since `since`, swept and adopted files included. */
    async bytesFrom(addressKey: string, since: number): Promise<number> {
      const row = await db
        .selectFrom('adminium_public_uploads')
        .select((eb) => eb.fn.sum<number | string | null>('size').as('total'))
        .where('addressKey', '=', addressKey)
        .where('createdAt', '>=', since)
        .executeTakeFirst();
      return Number(row?.total ?? 0);
    },

    /** How many files one address sent since `since`, swept ones included. */
    async countFrom(addressKey: string, since: number): Promise<number> {
      const row = await db
        .selectFrom('adminium_public_uploads')
        .select((eb) => eb.fn.countAll<number | string>().as('n'))
        .where('addressKey', '=', addressKey)
        .where('createdAt', '>=', since)
        .executeTakeFirst();
      return Number(row?.n ?? 0);
    },
  };
}

export type PublicUploadsRepo = ReturnType<typeof publicUploadsRepo>;
