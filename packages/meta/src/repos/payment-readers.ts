// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The card readers paired with a service (0092), for the tills: the
 * service's own id for each, the name staff gave it, its location, and when
 * it was last seen. One row per reader per service and mode.
 */
import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumPaymentReadersTable } from '../schema/tables.js';
import { affected, readBool, writeBool } from './util.js';

export interface PaymentReader {
  id: string;
  provider: string;
  mode: 'test' | 'live';
  /** The service's own id for the reader. */
  readerRef: string;
  label: string;
  locationId: string | null;
  locationName: string | null;
  model: string | null;
  online: boolean;
  lastSeenAt: number | null;
  createdBy: string | null;
  createdAt: number;
}

export interface PairReaderInput {
  provider: string;
  mode: 'test' | 'live';
  readerRef: string;
  label: string;
  locationId: string | null;
  locationName: string | null;
  model: string | null;
  online: boolean;
  lastSeenAt: number | null;
  createdBy: string | null;
}

function decode(row: Selectable<AdminiumPaymentReadersTable>): PaymentReader {
  return {
    id: row.id,
    provider: row.provider,
    mode: row.mode === 'live' ? 'live' : 'test',
    readerRef: row.readerRef,
    label: row.label,
    locationId: row.locationId,
    locationName: row.locationName,
    model: row.model,
    online: readBool(row.online),
    lastSeenAt: row.lastSeenAt === null ? null : Number(row.lastSeenAt),
    createdBy: row.createdBy,
    createdAt: Number(row.createdAt),
  };
}

export function paymentReadersRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /** Keeps a reader the service paired; one already kept (the same service, mode and id) is named again. */
    async pair(input: PairReaderInput, at: number = Date.now()): Promise<PaymentReader> {
      const existing = await db
        .selectFrom('adminium_payment_readers')
        .selectAll()
        .where('provider', '=', input.provider)
        .where('mode', '=', input.mode)
        .where('readerRef', '=', input.readerRef)
        .executeTakeFirst();
      if (existing !== undefined) {
        await db.updateTable('adminium_payment_readers').set({ label: input.label, locationId: input.locationId, locationName: input.locationName, model: input.model, online: writeBool(meta, input.online), lastSeenAt: input.lastSeenAt, updatedAt: at }).where('id', '=', existing.id).execute();
        return (await this.byId(existing.id))!;
      }
      const row: Selectable<AdminiumPaymentReadersTable> = {
        id: newId('prd'),
        provider: input.provider,
        mode: input.mode,
        readerRef: input.readerRef,
        label: input.label,
        locationId: input.locationId,
        locationName: input.locationName,
        model: input.model,
        online: writeBool(meta, input.online),
        lastSeenAt: input.lastSeenAt,
        createdBy: input.createdBy,
        createdAt: at,
        updatedAt: at,
      };
      await db.insertInto('adminium_payment_readers').values(row).execute();
      return decode(row);
    },

    async byId(id: string): Promise<PaymentReader | null> {
      const row = await db.selectFrom('adminium_payment_readers').selectAll().where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    /** Every reader kept, by name; one service and mode when asked. */
    async list(filter: { provider?: string; mode?: 'test' | 'live' } = {}): Promise<PaymentReader[]> {
      let query = db.selectFrom('adminium_payment_readers').selectAll();
      if (filter.provider !== undefined) query = query.where('provider', '=', filter.provider);
      if (filter.mode !== undefined) query = query.where('mode', '=', filter.mode);
      return (await query.orderBy('label').orderBy('id').execute()).map(decode);
    },

    /** A new name staff gave it. */
    async rename(id: string, label: string, at: number = Date.now()): Promise<boolean> {
      return affected((await db.updateTable('adminium_payment_readers').set({ label, updatedAt: at }).where('id', '=', id).executeTakeFirst()).numUpdatedRows) === 1;
    },

    /** What the service last said of it. */
    async seen(id: string, online: boolean, lastSeenAt: number | null, at: number = Date.now()): Promise<void> {
      await db.updateTable('adminium_payment_readers').set({ online: writeBool(meta, online), lastSeenAt, updatedAt: at }).where('id', '=', id).execute();
    },

    async remove(id: string): Promise<boolean> {
      return affected((await db.deleteFrom('adminium_payment_readers').where('id', '=', id).executeTakeFirst()).numDeletedRows) === 1;
    },
  };
}

export type PaymentReadersRepo = ReturnType<typeof paymentReadersRepo>;
