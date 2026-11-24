// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one SMS account of this server, kept in `adminium_sms_accounts`.
 *
 * The row is always `slot = 'server'`, and the unique index on `slot` makes
 * "one account per server" a database fact. Every write names the revision it
 * read: of two saves at once, the slower one changes nothing.
 *
 * Read through a parse, never a cast. A provider this version does not know
 * must not reach `SMS_PROVIDER_ADAPTERS[provider]`, so it throws. A sender or a
 * check reason it cannot read counts as none.
 */
import { newId, type MetaDb } from '@adminium/meta';
import { sql } from 'kysely';
import { z } from 'zod';

import type { SmsAccountFields, SmsAccountRow, SmsAccountStore } from './store.js';
import { SMS_CHECK_REASONS, SMS_PROVIDERS, type SmsSender } from './types.js';

const SLOT = 'server';
const TABLE = 'adminium_sms_accounts' as const;

const providerOf = z.enum(SMS_PROVIDERS);
const senderKindOf = z.enum(['number', 'name', 'pool']);
const checkReasonOf = z.enum(SMS_CHECK_REASONS);
const accountTypeOf = z.enum(['full', 'trial']);

/** PG boolean, MySQL tinyint, SQLite integer. */
const readBool = (value: unknown): boolean => value === true || value === 1 || value === '1';

interface StoredAccount {
  revision: number | string;
  provider: string;
  sealedCredentials: string;
  accountName: string | null;
  accountHint: string;
  accountType: string | null;
  senderKind: string | null;
  senderValue: string | null;
  defaultCountry: string | null;
  checkOk: unknown;
  checkReason: string | null;
  checkAt: number | string;
  savedAt: number | string;
  savedBy: string | null;
}

function decode(row: StoredAccount): SmsAccountRow {
  const provider = providerOf.safeParse(row.provider);
  if (!provider.success) throw new Error('The stored SMS account names a provider this version cannot read.');
  const kind = senderKindOf.safeParse(row.senderKind);
  const sender: SmsSender | null = kind.success && row.senderValue !== null ? { kind: kind.data, value: row.senderValue } : null;
  const reason = checkReasonOf.safeParse(row.checkReason);
  const type = accountTypeOf.safeParse(row.accountType);
  return {
    revision: Number(row.revision),
    provider: provider.data,
    sealedCredentials: row.sealedCredentials,
    accountName: row.accountName,
    accountHint: row.accountHint,
    accountType: type.success ? type.data : null,
    sender,
    defaultCountry: row.defaultCountry,
    check: { ok: readBool(row.checkOk), reason: reason.success ? reason.data : null, at: Number(row.checkAt) },
    savedAt: Number(row.savedAt),
    savedBy: row.savedBy,
  };
}

export function createSmsAccountStore(meta: MetaDb): SmsAccountStore {
  const { db } = meta;

  const columns = (fields: SmsAccountFields) => ({
    provider: fields.provider,
    sealedCredentials: fields.sealedCredentials,
    accountName: fields.accountName,
    accountHint: fields.accountHint,
    accountType: fields.accountType,
    senderKind: fields.sender?.kind ?? null,
    senderValue: fields.sender?.value ?? null,
    defaultCountry: fields.defaultCountry,
    checkOk: (meta.dialect === 'postgres' ? fields.check.ok : fields.check.ok ? 1 : 0) as never,
    checkReason: fields.check.reason,
    checkAt: fields.check.at,
    savedAt: fields.savedAt,
    savedBy: fields.savedBy,
  });

  async function read(): Promise<SmsAccountRow | null> {
    const row = await db.selectFrom(TABLE).selectAll().where('slot', '=', SLOT).executeTakeFirst();
    return row === undefined ? null : decode(row as unknown as StoredAccount);
  }

  return {
    read,

    async write(fields, expected) {
      if (expected === null) {
        const id = newId('sms');
        const at = fields.savedAt;
        const insert = db.insertInto('adminium_sms_accounts').values({ id, slot: SLOT, revision: 1, ...columns(fields), createdAt: at, updatedAt: at });
        // Never a caught duplicate: the loser of two first saves simply wrote nothing.
        if (meta.dialect === 'mysql') await insert.onDuplicateKeyUpdate({ id: sql`id` }).execute();
        else await insert.onConflict((conflict) => conflict.column('slot').doNothing()).execute();
        const held = await db.selectFrom(TABLE).select('id').where('slot', '=', SLOT).executeTakeFirst();
        return held?.id === id ? read() : null;
      }
      const result = await db
        .updateTable('adminium_sms_accounts')
        .set({ ...columns(fields), revision: expected + 1, updatedAt: fields.savedAt })
        .where('slot', '=', SLOT)
        .where('revision', '=', expected)
        .executeTakeFirst();
      return Number(result.numUpdatedRows) === 0 ? null : read();
    },

    async remove(expected) {
      const result = await db.deleteFrom('adminium_sms_accounts').where('slot', '=', SLOT).where('revision', '=', expected).executeTakeFirst();
      return Number(result.numDeletedRows) > 0;
    },
  };
}
