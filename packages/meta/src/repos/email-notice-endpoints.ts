// SPDX-License-Identifier: AGPL-3.0-only
/**
 * emailNoticeEndpointsRepo — adminium_email_notice_endpoints (0068).
 *
 * One row per mail service that calls Adminium back about bounces, spam
 * reports and unsubscribes. Secrets follow the storage-destination pattern:
 * this package stays crypto-agnostic and the server hands in encrypt/decrypt
 * closures under a key of their own purpose. Every read returns `hasSecret`
 * and never the secret; `secretOf` and `tokenOf` are the only doors to the
 * plain values, apart on purpose so a route that renders a row cannot print
 * one by accident.
 *
 * The path token is found by its sha256 (`token_hash`), never by the token: a
 * read of the table gives nobody a working address.
 */
import { createHash } from 'node:crypto';

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumEmailNoticeEndpointsTable } from '../schema/tables.js';
import type { DsnCrypto } from './connections.js';
import { MetaValidationError, affected, isDuplicateKeyError } from './util.js';

/** The widths the table holds (0068). */
export const NOTICE_SERVICE_MAX = 16;
export const NOTICE_TOPIC_ARN_MAX = 320;

/** A notice endpoint as every read sees it: never a secret, never the token. */
export interface NoticeEndpointRow {
  id: string;
  service: string;
  tokenHash: string;
  /** True when a secret (a signing key, or the credentials Adminium made) is kept. */
  hasSecret: boolean;
  secretSetAt: number | null;
  /** SendGrid's verification key: public. */
  publicKey: string | null;
  topicArn: string | null;
  confirmedAt: number | null;
  lastNoticeAt: number | null;
  noticeCount: number;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateNoticeEndpointInput {
  service: string;
  /** The path token, in the clear; kept hashed and encrypted, never as it is. */
  token: string;
  /** In the clear; encrypted here. */
  secret?: string | null;
  publicKey?: string | null;
  topicArn?: string | null;
  createdBy?: string | null;
}

/** The sha256 a path token is found by. */
export function noticeTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function decode(row: Selectable<AdminiumEmailNoticeEndpointsTable>): NoticeEndpointRow {
  return {
    id: row.id,
    service: row.service,
    tokenHash: row.tokenHash,
    hasSecret: row.secretEncrypted !== null,
    secretSetAt: row.secretSetAt === null ? null : Number(row.secretSetAt),
    publicKey: row.publicKey,
    topicArn: row.topicArn,
    confirmedAt: row.confirmedAt === null ? null : Number(row.confirmedAt),
    lastNoticeAt: row.lastNoticeAt === null ? null : Number(row.lastNoticeAt),
    noticeCount: Number(row.noticeCount),
    createdBy: row.createdBy,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function checkService(service: string): void {
  if (service.length === 0 || service.length > NOTICE_SERVICE_MAX) throw new MetaValidationError(`a notice service is 1–${String(NOTICE_SERVICE_MAX)} characters`);
}

function checkToken(token: string): void {
  if (token.length < 16) throw new MetaValidationError('a notice path token is at least 16 characters');
}

function checkTopic(arn: string | null | undefined): void {
  if (arn !== null && arn !== undefined && arn.length > NOTICE_TOPIC_ARN_MAX) throw new MetaValidationError(`a topic ARN is at most ${String(NOTICE_TOPIC_ARN_MAX)} characters`);
}

export function emailNoticeEndpointsRepo(meta: MetaDb, crypto: DsnCrypto) {
  const { db } = meta;
  const table = 'adminium_email_notice_endpoints' as const;

  async function byId(id: string): Promise<NoticeEndpointRow | null> {
    const row = await db.selectFrom(table).selectAll().where('id', '=', id).executeTakeFirst();
    return row === undefined ? null : decode(row);
  }

  return {
    byId,

    async byService(service: string): Promise<NoticeEndpointRow | null> {
      const row = await db.selectFrom(table).selectAll().where('service', '=', service).executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    /** The endpoint a call's path token names, or null. */
    async byToken(token: string): Promise<NoticeEndpointRow | null> {
      const row = await db.selectFrom(table).selectAll().where('tokenHash', '=', noticeTokenHash(token)).executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    async list(): Promise<NoticeEndpointRow[]> {
      const rows = await db.selectFrom(table).selectAll().orderBy('service').execute();
      return rows.map(decode);
    },

    /** A new endpoint; null when the service already has one (one per service). */
    async create(input: CreateNoticeEndpointInput, now = Date.now()): Promise<NoticeEndpointRow | null> {
      checkService(input.service);
      checkToken(input.token);
      checkTopic(input.topicArn);
      const id = newId('ntc');
      const secret = input.secret ?? null;
      try {
        await db
          .insertInto(table)
          .values({
            id,
            service: input.service,
            tokenHash: noticeTokenHash(input.token),
            tokenEncrypted: crypto.encrypt(input.token),
            secretEncrypted: secret === null ? null : crypto.encrypt(secret),
            secretSetAt: secret === null ? null : now,
            publicKey: input.publicKey ?? null,
            topicArn: input.topicArn ?? null,
            confirmedAt: null,
            lastNoticeAt: null,
            noticeCount: 0,
            createdBy: input.createdBy ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      } catch (error) {
        if (isDuplicateKeyError(error)) return null;
        throw error;
      }
      return byId(id);
    },

    /** The path token in the clear, to print the address again. Null when there is no such row. */
    async tokenOf(id: string): Promise<string | null> {
      const row = await db.selectFrom(table).select('tokenEncrypted').where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : crypto.decrypt(row.tokenEncrypted);
    },

    /** The secret in the clear, or null when none is kept. */
    async secretOf(id: string): Promise<string | null> {
      const row = await db.selectFrom(table).select('secretEncrypted').where('id', '=', id).executeTakeFirst();
      return row === undefined || row.secretEncrypted === null ? null : crypto.decrypt(row.secretEncrypted);
    },

    /** A new path token: the old address stops working at once. */
    async replaceToken(id: string, token: string, now = Date.now()): Promise<boolean> {
      checkToken(token);
      const done = await db
        .updateTable(table)
        .set({ tokenHash: noticeTokenHash(token), tokenEncrypted: crypto.encrypt(token), updatedAt: now })
        .where('id', '=', id)
        .executeTakeFirst();
      return affected(done.numUpdatedRows) > 0;
    },

    /** Keep a new secret (null takes it off). */
    async setSecret(id: string, secret: string | null, now = Date.now()): Promise<boolean> {
      const done = await db
        .updateTable(table)
        .set({ secretEncrypted: secret === null ? null : crypto.encrypt(secret), secretSetAt: secret === null ? null : now, updatedAt: now })
        .where('id', '=', id)
        .executeTakeFirst();
      return affected(done.numUpdatedRows) > 0;
    },

    async setPublicKey(id: string, publicKey: string | null, now = Date.now()): Promise<boolean> {
      const done = await db.updateTable(table).set({ publicKey, secretSetAt: publicKey === null ? null : now, updatedAt: now }).where('id', '=', id).executeTakeFirst();
      return affected(done.numUpdatedRows) > 0;
    },

    /** Pin another topic. A new topic has not answered the handshake yet, so `confirmed_at` is cleared. */
    async setTopicArn(id: string, topicArn: string | null, now = Date.now()): Promise<boolean> {
      checkTopic(topicArn);
      const done = await db
        .updateTable(table)
        .set({ topicArn, secretSetAt: topicArn === null ? null : now, confirmedAt: null, updatedAt: now })
        .where('id', '=', id)
        .executeTakeFirst();
      return affected(done.numUpdatedRows) > 0;
    },

    /** SNS's subscription handshake was answered. */
    async confirm(id: string, now = Date.now()): Promise<boolean> {
      const done = await db.updateTable(table).set({ confirmedAt: now }).where('id', '=', id).executeTakeFirst();
      return affected(done.numUpdatedRows) > 0;
    },

    /** A genuine notice arrived: counted, and its time kept for "Last notice …". */
    async noticed(id: string, now = Date.now()): Promise<boolean> {
      const done = await db
        .updateTable(table)
        .set((eb) => ({ lastNoticeAt: now, noticeCount: eb('noticeCount', '+', 1) }))
        .where('id', '=', id)
        .executeTakeFirst();
      return affected(done.numUpdatedRows) > 0;
    },

    async remove(id: string): Promise<boolean> {
      const done = await db.deleteFrom(table).where('id', '=', id).executeTakeFirst();
      return affected(done.numDeletedRows) > 0;
    },
  };
}
