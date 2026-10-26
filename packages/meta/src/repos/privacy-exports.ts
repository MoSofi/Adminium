// SPDX-License-Identifier: AGPL-3.0-only
/**
 * privacyExportsRepo — adminium_privacy_exports (0070): a person's data,
 * downloaded.
 *
 * The person arrives as the keyed hash of their address, already made: the
 * keys are the server's (`apps/server/src/consent/`). The row never holds
 * the address. The file is an adminium_files row the export job writes.
 */
import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumPrivacyExportsTable } from '../schema/tables.js';
import type { AddressHash } from './consent.js';
import { affected, packJson, readJsonOrNull } from './util.js';

export const PRIVACY_EXPORT_STATUSES = ['processing', 'ready', 'failed', 'expired'] as const;
export type PrivacyExportStatus = (typeof PRIVACY_EXPORT_STATUSES)[number];

/** The longest failure reason kept: a longer one is cut. */
const ERROR_WIDTH = 500;

export interface PrivacyExport {
  id: string;
  requestedBy: string;
  address: AddressHash;
  status: PrivacyExportStatus;
  fileId: string | null;
  /** Rows per source, once written. */
  counts: Record<string, number> | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
  expiresAt: number | null;
}

function decode(row: Selectable<AdminiumPrivacyExportsTable>): PrivacyExport {
  const counts = readJsonOrNull<Record<string, unknown>>(row.counts);
  return {
    id: row.id,
    requestedBy: row.requestedBy,
    address: { hash: row.addressHash, version: Number(row.keyVersion) },
    status: row.status as PrivacyExportStatus,
    fileId: row.fileId,
    counts: counts === null ? null : Object.fromEntries(Object.entries(counts).map(([source, rows]) => [source, Number(rows)])),
    error: row.error,
    createdAt: Number(row.createdAt),
    completedAt: row.completedAt === null ? null : Number(row.completedAt),
    expiresAt: row.expiresAt === null ? null : Number(row.expiresAt),
  };
}

export function privacyExportsRepo(meta: MetaDb) {
  const { db } = meta;

  async function findById(id: string): Promise<PrivacyExport | null> {
    const row = await db.selectFrom('adminium_privacy_exports').selectAll().where('id', '=', id).executeTakeFirst();
    return row === undefined ? null : decode(row);
  }

  async function aboutPerson(hashes: readonly AddressHash[]): Promise<PrivacyExport[]> {
    if (hashes.length === 0) return [];
    const rows = await db
      .selectFrom('adminium_privacy_exports')
      .selectAll()
      .where((eb) => eb.or(hashes.map((one) => eb.and([eb('addressHash', '=', one.hash), eb('keyVersion', '=', one.version)]))))
      .orderBy('createdAt', 'desc')
      .execute();
    return rows.map(decode);
  }

  return {
    findById,
    /** Every download about a person, under any of their address's hashes. */
    aboutPerson,

    async create(input: { requestedBy: string; address: AddressHash }, at: number = Date.now()): Promise<PrivacyExport> {
      const id = newId('pex');
      await db
        .insertInto('adminium_privacy_exports')
        .values({ id, requestedBy: input.requestedBy, addressHash: input.address.hash, keyVersion: input.address.version, status: 'processing', fileId: null, counts: null, error: null, createdAt: at, completedAt: null, expiresAt: null })
        .execute();
      return (await findById(id))!;
    },

    /** The file is written: ready until `expiresAt`. Only a row still processing moves. */
    async markReady(id: string, input: { fileId: string; counts: Record<string, number>; expiresAt: number }, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_privacy_exports')
        .set({ status: 'ready', fileId: input.fileId, counts: packJson(input.counts), completedAt: at, expiresAt: input.expiresAt })
        .where('id', '=', id)
        .where('status', '=', 'processing')
        .executeTakeFirst();
      return affected(res.numUpdatedRows) > 0;
    },

    async markFailed(id: string, error: string, at: number = Date.now()): Promise<boolean> {
      const res = await db
        .updateTable('adminium_privacy_exports')
        .set({ status: 'failed', error: error.slice(0, ERROR_WIDTH), completedAt: at })
        .where('id', '=', id)
        .where('status', '=', 'processing')
        .executeTakeFirst();
      return affected(res.numUpdatedRows) > 0;
    },

    /** The file is gone: the row stays, to say what was asked and when. */
    async markExpired(id: string): Promise<void> {
      await db.updateTable('adminium_privacy_exports').set({ status: 'expired', fileId: null }).where('id', '=', id).execute();
    },

    /** One person's downloads made by `requestedBy`, newest first. */
    async listFor(requestedBy: string, limit = 20): Promise<PrivacyExport[]> {
      const rows = await db
        .selectFrom('adminium_privacy_exports')
        .selectAll()
        .where('requestedBy', '=', requestedBy)
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(Math.min(Math.max(limit, 1), 100))
        .execute();
      return rows.map(decode);
    },

    /** Ready downloads whose time is up, for the sweep (`limit` at a time). */
    async expiredBefore(at: number, limit = 100): Promise<PrivacyExport[]> {
      const rows = await db
        .selectFrom('adminium_privacy_exports')
        .selectAll()
        .where('status', '=', 'ready')
        .where('expiresAt', '<', at)
        .orderBy('expiresAt', 'asc')
        .limit(limit)
        .execute();
      return rows.map(decode);
    },

    /** Deletes a person's downloads (the erasure); returns the files they held, for their bytes to go too. */
    async deleteAboutPerson(hashes: readonly AddressHash[]): Promise<{ deleted: number; fileIds: string[] }> {
      const found = await aboutPerson(hashes);
      if (found.length === 0) return { deleted: 0, fileIds: [] };
      const res = await db.deleteFrom('adminium_privacy_exports').where('id', 'in', found.map((one) => one.id)).executeTakeFirst();
      return { deleted: Number(res.numDeletedRows), fileIds: found.flatMap((one) => (one.fileId === null ? [] : [one.fileId])) };
    },
  };
}

export type PrivacyExportsRepo = ReturnType<typeof privacyExportsRepo>;
