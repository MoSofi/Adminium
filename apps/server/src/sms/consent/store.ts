// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where text consent is kept: `adminium_text_stop_list` and
 * `adminium_text_consent_log`.
 *
 * A store that cannot be read throws, and the decision throws with it, so no
 * text can pass for want of a store.
 *
 * A phone arrives already hashed and sealed. The keys are the service's.
 */
import { CONSENT_PERSON_KEY_MAX, newId, type AddressHash, type ConsentHow, type ConsentPerson, type MetaDb } from '@adminium/meta';
import { sql, type Expression, type ExpressionBuilder, type Kysely, type SqlBool } from 'kysely';

import { ValidationFailedError } from '../../errors.js';
import type { TextConsentEvent, TextConsentSource, TextConsentState, TextPurpose, TextStopReason, TextStopRecord } from './types.js';

interface TextStopTable {
  id: string;
  phoneHash: string;
  keyVersion: number;
  phoneEncrypted: string | null;
  reason: string;
  origin: string | null;
  addedAt: number;
  addedById: string | null;
  addedByLabel: string | null;
  erasedAt: number | null;
}

interface TextLogTable {
  id: string;
  connectionId: string | null;
  personTable: string | null;
  personKey: string | null;
  phoneHash: string | null;
  keyVersion: number | null;
  purpose: string | null;
  state: string;
  source: string;
  detail: string | null;
  how: string | null;
  note: string | null;
  staffId: string | null;
  staffLabel: string | null;
  wording: string | null;
  wordingVersion: string | null;
  ip: string | null;
  userAgent: string | null;
  at: number;
  confirmedAt: number | null;
}

interface TextTables {
  adminium_text_stop_list: TextStopTable;
  adminium_text_consent_log: TextLogTable;
}

export type TextStopInput = Omit<TextStopRecord, 'id'>;
export type TextEventInput = Omit<TextConsentEvent, 'id'>;

export interface TextConsentStore {
  stop: {
    findAny(hashes: readonly AddressHash[]): Promise<TextStopRecord[]>;
    /** One row per hash: a second add finds the first. Safe inside a transaction on every engine. */
    add(input: TextStopInput): Promise<{ entry: TextStopRecord; added: boolean }>;
    byId(id: string): Promise<TextStopRecord | null>;
    remove(id: string): Promise<boolean>;
    eraseDisplay(id: string, at: number): Promise<void>;
    page(opts: { limit: number; after?: { addedAt: number; id: string } | undefined; reason?: TextStopReason | undefined }): Promise<TextStopRecord[]>;
  };
  log: {
    append(input: TextEventInput): Promise<TextConsentEvent>;
    /** The newest yes or no for this number. At the same moment, a no wins. */
    latestForPhone(hashes: readonly AddressHash[], purpose: TextPurpose): Promise<TextConsentEvent | null>;
    /** The newest no on this row, whichever number it was given for. */
    latestNoForPerson(person: ConsentPerson, purpose: TextPurpose): Promise<TextConsentEvent | null>;
    history(who: { person?: ConsentPerson | null | undefined; hashes: readonly AddressHash[] }, limit: number): Promise<TextConsentEvent[]>;
    deleteFor(who: { person?: ConsentPerson | null | undefined; hashes: readonly AddressHash[] }): Promise<number>;
  };
  transaction<T>(work: (store: TextConsentStore) => Promise<T>): Promise<T>;
}

const WIDTH = { origin: 255, detail: 255, staffLabel: 255, wordingVersion: 40, ip: 64, userAgent: 512 } as const;
const cut = (value: string | null, width: number): string | null => (value === null ? null : value.slice(0, width));
const orNull = (value: number | string | null): number | null => (value === null ? null : Number(value));

function decodeStop(row: TextStopTable): TextStopRecord {
  return {
    id: row.id,
    phone: { hash: row.phoneHash, version: Number(row.keyVersion) },
    phoneEncrypted: row.phoneEncrypted,
    reason: row.reason as TextStopReason,
    origin: row.origin,
    addedAt: Number(row.addedAt),
    addedById: row.addedById,
    addedByLabel: row.addedByLabel,
    erasedAt: orNull(row.erasedAt),
  };
}

function decodeEvent(row: TextLogTable): TextConsentEvent {
  const version = orNull(row.keyVersion);
  return {
    id: row.id,
    person: row.connectionId !== null && row.personTable !== null && row.personKey !== null ? { connectionId: row.connectionId, table: row.personTable, key: row.personKey } : null,
    phone: row.phoneHash !== null && version !== null ? { hash: row.phoneHash, version } : null,
    purpose: row.purpose as TextPurpose | null,
    state: row.state as TextConsentState,
    source: row.source as TextConsentSource,
    detail: row.detail,
    how: row.how as ConsentHow | null,
    note: row.note,
    staffId: row.staffId,
    staffLabel: row.staffLabel,
    wording: row.wording,
    wordingVersion: row.wordingVersion,
    ip: row.ip,
    userAgent: row.userAgent,
    at: Number(row.at),
    confirmedAt: orNull(row.confirmedAt),
  };
}

type LogEb = ExpressionBuilder<TextTables, 'adminium_text_consent_log'>;

function hashIn(eb: LogEb, hashes: readonly AddressHash[]): Expression<SqlBool>[] {
  return hashes.map((one) => eb.and([eb('phoneHash', '=', one.hash), eb('keyVersion', '=', one.version)]));
}

/**
 * One row, exactly. MySQL's default collation compares without case, so there
 * `abc` would also match `ABC`, and an erasure would delete another person's
 * consent. The plain comparison stays first because it is what the index serves.
 */
function personIs(eb: LogEb, person: ConsentPerson, dialect: MetaDb['dialect']): Expression<SqlBool> {
  const same: Expression<SqlBool>[] = [eb('connectionId', '=', person.connectionId), eb('personTable', '=', person.table), eb('personKey', '=', person.key)];
  if (dialect === 'mysql') same.push(sql<SqlBool>`binary ${sql.ref('personTable')} = ${person.table}`, sql<SqlBool>`binary ${sql.ref('personKey')} = ${person.key}`);
  return eb.and(same);
}

function storeOver(db: Kysely<TextTables>, dialect: MetaDb['dialect']): TextConsentStore {
  async function byHash(hash: AddressHash): Promise<TextStopRecord | null> {
    const row = await db.selectFrom('adminium_text_stop_list').selectAll().where('phoneHash', '=', hash.hash).where('keyVersion', '=', hash.version).executeTakeFirst();
    return row === undefined ? null : decodeStop(row as TextStopTable);
  }

  const whoWhere = (eb: LogEb, who: { person?: ConsentPerson | null | undefined; hashes: readonly AddressHash[] }): Expression<SqlBool> =>
    eb.or([...(who.person == null ? [] : [personIs(eb, who.person, dialect)]), ...hashIn(eb, who.hashes)]);

  return {
    stop: {
      async findAny(hashes) {
        if (hashes.length === 0) return [];
        const rows = await db
          .selectFrom('adminium_text_stop_list')
          .selectAll()
          .where((eb) => eb.or(hashes.map((one) => eb.and([eb('phoneHash', '=', one.hash), eb('keyVersion', '=', one.version)]))))
          .execute();
        return rows.map((row) => decodeStop(row as TextStopTable));
      },

      async add(input) {
        const row: TextStopTable = {
          id: newId('tsp'),
          phoneHash: input.phone.hash,
          keyVersion: input.phone.version,
          phoneEncrypted: input.phoneEncrypted,
          reason: input.reason,
          origin: cut(input.origin, WIDTH.origin),
          addedAt: input.addedAt,
          addedById: input.addedById,
          addedByLabel: cut(input.addedByLabel, WIDTH.staffLabel),
          erasedAt: input.erasedAt,
        };
        // Never a caught duplicate: one aborts a Postgres transaction.
        const insert = db.insertInto('adminium_text_stop_list').values(row);
        if (dialect === 'mysql') await insert.onDuplicateKeyUpdate({ id: sql`id` }).execute();
        else await insert.onConflict((conflict) => conflict.columns(['phoneHash', 'keyVersion']).doNothing()).execute();
        const entry = await byHash(input.phone);
        if (entry === null) throw new Error('The text stop entry was not there after it was written.');
        return { entry, added: entry.id === row.id };
      },

      async byId(id) {
        const row = await db.selectFrom('adminium_text_stop_list').selectAll().where('id', '=', id).executeTakeFirst();
        return row === undefined ? null : decodeStop(row as TextStopTable);
      },

      async remove(id) {
        const result = await db.deleteFrom('adminium_text_stop_list').where('id', '=', id).executeTakeFirst();
        return Number(result.numDeletedRows) > 0;
      },

      async eraseDisplay(id, at) {
        await db.updateTable('adminium_text_stop_list').set({ phoneEncrypted: null, erasedAt: at }).where('id', '=', id).execute();
      },

      async page(opts) {
        let query = db.selectFrom('adminium_text_stop_list').selectAll();
        if (opts.reason !== undefined) query = query.where('reason', '=', opts.reason);
        const after = opts.after;
        if (after !== undefined) query = query.where((eb) => eb.or([eb('addedAt', '<', after.addedAt), eb.and([eb('addedAt', '=', after.addedAt), eb('id', '<', after.id)])]));
        const rows = await query.orderBy('addedAt', 'desc').orderBy('id', 'desc').limit(opts.limit).execute();
        return rows.map((row) => decodeStop(row as TextStopTable));
      },
    },

    log: {
      async append(input) {
        // Cut, two long keys would be one person: refused instead.
        for (const part of input.person === null ? [] : [input.person.table, input.person.key]) {
          if (part.length === 0 || part.length > CONSENT_PERSON_KEY_MAX) throw new ValidationFailedError('A consent row is named by a table and a key of 1 to 200 characters.', { field: 'person' });
        }
        const row: TextLogTable = {
          id: newId('tcn'),
          connectionId: input.person?.connectionId ?? null,
          personTable: input.person?.table ?? null,
          personKey: input.person?.key ?? null,
          phoneHash: input.phone?.hash ?? null,
          keyVersion: input.phone?.version ?? null,
          purpose: input.purpose,
          state: input.state,
          source: input.source,
          detail: cut(input.detail, WIDTH.detail),
          how: input.how,
          note: input.note,
          staffId: input.staffId,
          staffLabel: cut(input.staffLabel, WIDTH.staffLabel),
          wording: input.wording,
          wordingVersion: cut(input.wordingVersion, WIDTH.wordingVersion),
          ip: cut(input.ip, WIDTH.ip),
          userAgent: cut(input.userAgent, WIDTH.userAgent),
          at: input.at,
          confirmedAt: input.confirmedAt,
        };
        await db.insertInto('adminium_text_consent_log').values(row).execute();
        return decodeEvent(row);
      },

      async latestForPhone(hashes, purpose) {
        if (hashes.length === 0) return null;
        const row = await db
          .selectFrom('adminium_text_consent_log')
          .selectAll()
          .where((eb) => eb.or(hashIn(eb, hashes)))
          .where('purpose', '=', purpose)
          .where('state', 'in', ['yes', 'no'])
          .orderBy('at', 'desc')
          .orderBy(sql`case when state = 'no' then 0 else 1 end`)
          .orderBy('id', 'desc')
          .limit(1)
          .executeTakeFirst();
        return row === undefined ? null : decodeEvent(row as TextLogTable);
      },

      async latestNoForPerson(person, purpose) {
        const row = await db
          .selectFrom('adminium_text_consent_log')
          .selectAll()
          .where((eb) => personIs(eb, person, dialect))
          .where('purpose', '=', purpose)
          .where('state', '=', 'no')
          .orderBy('at', 'desc')
          .orderBy('id', 'desc')
          .limit(1)
          .executeTakeFirst();
        return row === undefined ? null : decodeEvent(row as TextLogTable);
      },

      async history(who, limit) {
        if (who.person == null && who.hashes.length === 0) return [];
        const rows = await db
          .selectFrom('adminium_text_consent_log')
          .selectAll()
          .where((eb) => whoWhere(eb, who))
          .orderBy('at', 'desc')
          .orderBy('id', 'desc')
          .limit(limit)
          .execute();
        return rows.map((row) => decodeEvent(row as TextLogTable));
      },

      async deleteFor(who) {
        if (who.person == null && who.hashes.length === 0) return 0;
        const result = await db
          .deleteFrom('adminium_text_consent_log')
          .where((eb) => whoWhere(eb, who))
          .executeTakeFirst();
        return Number(result.numDeletedRows);
      },
    },

    transaction: (work) => db.transaction().execute((trx) => work(storeOver(trx as unknown as Kysely<TextTables>, dialect))),
  };
}

export function createTextConsentStore(meta: MetaDb): TextConsentStore {
  return storeOver(meta.db as unknown as Kysely<TextTables>, meta.dialect);
}
