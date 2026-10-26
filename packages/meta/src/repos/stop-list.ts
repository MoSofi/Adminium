// SPDX-License-Identifier: AGPL-3.0-only
/**
 * stopListRepo — adminium_stop_list (0066), the do-not-email list.
 *
 * Rows arrive with the address already hashed and its display copy already
 * encrypted: the keys are the server's (`apps/server/src/consent/`), the only
 * caller. An address is one row under a key version (a unique index), so a
 * second add of it finds the first row rather than making another.
 */

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumStopListTable } from '../schema/tables.js';
import type { AddressHash } from './consent.js';
import { isDuplicateKeyError } from './util.js';

/** Why an address is on the list. */
export const STOP_REASONS = ['link', 'spam', 'bounce', 'hand', 'relay-unsubscribe', 'old-mark', 'lead-finder', 'erased'] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export interface StopEntryInput {
  address: AddressHash;
  /** The address, `enc:v1:` under the server's secret; null for an entry that keeps the hash alone. */
  addressEncrypted: string | null;
  reason: StopReason;
  /** Where from: a relay's, a campaign's or an app's name. */
  origin?: string | null | undefined;
  addedAt: number;
  addedById?: string | null | undefined;
  addedByLabel?: string | null | undefined;
}

export interface StopEntry {
  id: string;
  address: AddressHash;
  addressEncrypted: string | null;
  reason: StopReason;
  origin: string | null;
  addedAt: number;
  addedById: string | null;
  addedByLabel: string | null;
  erasedAt: number | null;
}

const cut = (value: string | null | undefined, width: number): string | null => (value === null || value === undefined ? null : value.slice(0, width));

function decode(row: AdminiumStopListTable): StopEntry {
  return {
    id: row.id,
    address: { hash: row.addressHash, version: Number(row.keyVersion) },
    addressEncrypted: row.addressEncrypted,
    reason: row.reason as StopReason,
    origin: row.origin,
    addedAt: Number(row.addedAt),
    addedById: row.addedById,
    addedByLabel: row.addedByLabel,
    erasedAt: row.erasedAt === null ? null : Number(row.erasedAt),
  };
}

export function stopListRepo(meta: MetaDb) {
  const { db } = meta;

  async function byHash(address: AddressHash): Promise<StopEntry | null> {
    const row = await db
      .selectFrom('adminium_stop_list')
      .selectAll()
      .where('addressHash', '=', address.hash)
      .where('keyVersion', '=', address.version)
      .executeTakeFirst();
    return row === undefined ? null : decode(row as AdminiumStopListTable);
  }

  return {
    byHash,

    /** Put an address on the list. `added: false` with the row already there when it was on it. */
    async add(input: StopEntryInput): Promise<{ entry: StopEntry; added: boolean }> {
      const row: AdminiumStopListTable = {
        id: newId('stp'),
        addressHash: input.address.hash,
        keyVersion: input.address.version,
        addressEncrypted: input.addressEncrypted,
        reason: input.reason,
        origin: cut(input.origin, 255),
        addedAt: input.addedAt,
        addedById: input.addedById ?? null,
        addedByLabel: cut(input.addedByLabel, 255),
        erasedAt: null,
      };
      try {
        await db.insertInto('adminium_stop_list').values(row).execute();
        return { entry: decode(row), added: true };
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        const there = await byHash(input.address);
        if (there === null) throw error;
        return { entry: there, added: false };
      }
    },

    /** The entries any of these hashes name (an address under each key version). */
    async findAny(hashes: readonly AddressHash[]): Promise<StopEntry[]> {
      if (hashes.length === 0) return [];
      const out: StopEntry[] = [];
      for (let i = 0; i < hashes.length; i += 300) {
        const part = hashes.slice(i, i + 300);
        const rows = await db
          .selectFrom('adminium_stop_list')
          .selectAll()
          .where((eb) => eb.or(part.map((one) => eb.and([eb('addressHash', '=', one.hash), eb('keyVersion', '=', one.version)]))))
          .execute();
        out.push(...rows.map((row) => decode(row as AdminiumStopListTable)));
      }
      return out;
    },

    async byId(id: string): Promise<StopEntry | null> {
      const row = await db.selectFrom('adminium_stop_list').selectAll().where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : decode(row as AdminiumStopListTable);
    },

    /** Newest first; `after` continues a page (the time and id of its last row); `reason` narrows it. */
    async page(opts: { limit: number; after?: { addedAt: number; id: string } | undefined; reason?: StopReason | undefined }): Promise<StopEntry[]> {
      let q = db.selectFrom('adminium_stop_list').selectAll();
      if (opts.reason !== undefined) q = q.where('reason', '=', opts.reason);
      const after = opts.after;
      if (after !== undefined) q = q.where((eb) => eb.or([eb('addedAt', '<', after.addedAt), eb.and([eb('addedAt', '=', after.addedAt), eb('id', '<', after.id)])]));
      const rows = await q.orderBy('addedAt', 'desc').orderBy('id', 'desc').limit(opts.limit).execute();
      return rows.map((row) => decode(row as AdminiumStopListTable));
    },

    async count(reason?: StopReason): Promise<number> {
      let q = db.selectFrom('adminium_stop_list').select((eb) => eb.fn.countAll<number | string>().as('n'));
      if (reason !== undefined) q = q.where('reason', '=', reason);
      const row = await q.executeTakeFirst();
      return Number(row?.n ?? 0);
    },

    /** Take an address off the list; false when the row was not there. */
    async remove(id: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_stop_list').where('id', '=', id).executeTakeFirst();
      return Number(res.numDeletedRows) > 0;
    },

    /** Its person was erased: the display copy goes, the hash stays. */
    async eraseDisplay(id: string, at: number): Promise<void> {
      await db.updateTable('adminium_stop_list').set({ addressEncrypted: null, erasedAt: at }).where('id', '=', id).execute();
    },

    /** The same address, encrypted again (the server's secret changed). */
    async reseal(id: string, addressEncrypted: string): Promise<void> {
      await db.updateTable('adminium_stop_list').set({ addressEncrypted }).where('id', '=', id).execute();
    },

    /** The same address hashed under a newer key version. False when that hash is on the list already (the caller drops this row). */
    async rehash(id: string, address: AddressHash): Promise<boolean> {
      try {
        await db.updateTable('adminium_stop_list').set({ addressHash: address.hash, keyVersion: address.version }).where('id', '=', id).execute();
        return true;
      } catch (error) {
        if (isDuplicateKeyError(error)) return false;
        throw error;
      }
    },

    /** Every row, in id order, a batch at a time (a search, a re-hash, a re-seal). */
    async scan(opts: { afterId?: string | undefined; limit: number }): Promise<StopEntry[]> {
      let q = db.selectFrom('adminium_stop_list').selectAll();
      if (opts.afterId !== undefined) q = q.where('id', '>', opts.afterId);
      const rows = await q.orderBy('id', 'asc').limit(opts.limit).execute();
      return rows.map((row) => decode(row as AdminiumStopListTable));
    },
  };
}

export type StopListRepo = ReturnType<typeof stopListRepo>;
