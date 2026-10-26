// SPDX-License-Identifier: AGPL-3.0-only
/**
 * addressKeysRepo — adminium_address_keys (0065), and
 * consentLogRepo — adminium_consent_log (0065).
 *
 * The log is append-only: this repo can add a row and read rows, and the one
 * delete it has is a person's own rows when the person is erased. No method
 * changes a row. Addresses arrive already hashed: the keys and the hashing are
 * the server's (`apps/server/src/consent/`), which is the only caller.
 *
 * A person is found by their row (connection, table, key) OR by their
 * address's hash under any key version the caller passes, so an event that
 * named only the address (an unsubscribe link) and one that named only the row
 * (a staff record) both count for the same person.
 */

import type { Expression, ExpressionBuilder, SqlBool } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumConsentLogTable, MetaDB } from '../schema/tables.js';
import { MetaValidationError, isDuplicateKeyError } from './util.js';

/** What a person may say yes or no to. A closed list; the code grows it. */
export const CONSENT_PURPOSES = ['newsletter', 'surveys'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/**
 * Where a consent event came from. `person`: the person themselves, through a
 * door that is neither a form nor an unsubscribe link (their public "delete
 * my details" empties a declared consent column, and the log says so).
 */
export const CONSENT_SOURCES = ['form', 'import', 'staff', 'review', 'unsubscribe', 'relay', 'bounce', 'system', 'person'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

/** A yes, a no, or "they replied to a marketing e-mail" (about every purpose). */
export const CONSENT_STATES = ['yes', 'no', 'replied'] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

/** How a person told a staff member they agree. */
export const CONSENT_HOWS = ['in-person', 'phone', 'email', 'paper'] as const;
export type ConsentHow = (typeof CONSENT_HOWS)[number];

/** The longest person table or key the log keeps (as the audit log's keys). */
export const CONSENT_PERSON_KEY_MAX = 200;

/** A row of a source table: the person an event is about. */
export interface ConsentPerson {
  connectionId: string;
  /** The table's snapshot id (`public.contacts`). */
  table: string;
  /** The row's key as text, as `pkLabel` writes it. */
  key: string;
}

/** An address's keyed hash, and the version of the key it was made under. */
export interface AddressHash {
  hash: string;
  version: number;
}

/** Who an event is about: a row, an address, or both (at least one). */
export interface ConsentSubject {
  person?: ConsentPerson | null | undefined;
  /** The address's hash under each key version there is (to find); the newest one first (to write). */
  hashes?: readonly AddressHash[] | undefined;
}

export interface ConsentEventInput {
  person: ConsentPerson | null;
  address: AddressHash | null;
  purpose: ConsentPurpose | null;
  state: ConsentState;
  source: ConsentSource;
  detail?: string | null | undefined;
  how?: ConsentHow | null | undefined;
  note?: string | null | undefined;
  staffId?: string | null | undefined;
  staffLabel?: string | null | undefined;
  wording?: string | null | undefined;
  wordingVersion?: string | null | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  at: number;
  confirmedAt?: number | null | undefined;
}

export interface ConsentEvent {
  id: string;
  person: ConsentPerson | null;
  address: AddressHash | null;
  purpose: ConsentPurpose | null;
  state: ConsentState;
  source: ConsentSource;
  detail: string | null;
  how: ConsentHow | null;
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

/** The widths the columns keep: a longer value is cut, never refused (a browser string, a form name). */
const WIDTH = { detail: 255, staffLabel: 255, wordingVersion: 40, ip: 64, userAgent: 512 } as const;

const cut = (value: string | null | undefined, width: number): string | null => (value === null || value === undefined ? null : value.slice(0, width));
const orNull = (value: number | string | null | undefined): number | null => (value === null || value === undefined ? null : Number(value));

function personPart(value: string, what: string): string {
  if (value.length === 0 || value.length > CONSENT_PERSON_KEY_MAX) {
    // Cut, two long keys would be one person: refused instead.
    throw new MetaValidationError(`A consent ${what} must be 1 to ${String(CONSENT_PERSON_KEY_MAX)} characters long.`);
  }
  return value;
}

function decode(row: AdminiumConsentLogTable): ConsentEvent {
  const version = orNull(row.keyVersion);
  return {
    id: row.id,
    person: row.connectionId !== null && row.personTable !== null && row.personKey !== null ? { connectionId: row.connectionId, table: row.personTable, key: row.personKey } : null,
    address: row.addressHash !== null && version !== null ? { hash: row.addressHash, version } : null,
    purpose: row.purpose as ConsentPurpose | null,
    state: row.state as ConsentState,
    source: row.source as ConsentSource,
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

type LogEb = ExpressionBuilder<MetaDB, 'adminium_consent_log'>;

/** Whether a subject names anyone: a subject that names nothing has no rows. */
const namesSomeone = (subject: ConsentSubject): boolean => subject.person != null || (subject.hashes?.length ?? 0) > 0;

/** The rows of a subject: its row, or its address under any version given (a subject that names someone). */
function subjectWhere(eb: LogEb, subject: ConsentSubject): Expression<SqlBool> {
  const parts: Expression<SqlBool>[] = [];
  if (subject.person != null) {
    parts.push(
      eb.and([
        eb('connectionId', '=', subject.person.connectionId),
        eb('personTable', '=', personPart(subject.person.table, 'table')),
        eb('personKey', '=', personPart(subject.person.key, 'key')),
      ]),
    );
  }
  for (const one of subject.hashes ?? []) parts.push(eb.and([eb('addressHash', '=', one.hash), eb('keyVersion', '=', one.version)]));
  return eb.or(parts);
}

export function consentLogRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /** Add one event. The only write there is. */
    async append(input: ConsentEventInput): Promise<ConsentEvent> {
      if (input.person === null && input.address === null) throw new MetaValidationError('A consent event names a person, an address, or both.');
      if ((input.state === 'replied') !== (input.purpose === null)) throw new MetaValidationError('A yes or a no is for one purpose; a "replied" is for none.');
      const row: AdminiumConsentLogTable = {
        id: newId('cns'),
        connectionId: input.person?.connectionId ?? null,
        personTable: input.person === null ? null : personPart(input.person.table, 'table'),
        personKey: input.person === null ? null : personPart(input.person.key, 'key'),
        addressHash: input.address?.hash ?? null,
        keyVersion: input.address?.version ?? null,
        purpose: input.purpose,
        state: input.state,
        source: input.source,
        detail: cut(input.detail, WIDTH.detail),
        how: input.how ?? null,
        note: input.note ?? null,
        staffId: input.staffId ?? null,
        staffLabel: cut(input.staffLabel, WIDTH.staffLabel),
        wording: input.wording ?? null,
        wordingVersion: cut(input.wordingVersion, WIDTH.wordingVersion),
        ip: cut(input.ip, WIDTH.ip),
        userAgent: cut(input.userAgent, WIDTH.userAgent),
        at: input.at,
        confirmedAt: input.confirmedAt ?? null,
      };
      await db.insertInto('adminium_consent_log').values(row).execute();
      return decode(row);
    },

    /** A subject's latest yes or no for a purpose (the newest by time, then by id); null when never asked. */
    async latest(subject: ConsentSubject, purpose: ConsentPurpose): Promise<ConsentEvent | null> {
      if (!namesSomeone(subject)) return null;
      const row = await db
        .selectFrom('adminium_consent_log')
        .selectAll()
        .where((eb) => subjectWhere(eb, subject))
        .where('purpose', '=', purpose)
        .where('state', 'in', ['yes', 'no'])
        .orderBy('at', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst();
      return row === undefined ? null : decode(row as AdminiumConsentLogTable);
    },

    /**
     * `latest` for many subjects at once: each one's newest yes or no for a
     * purpose, in the order given (null when never asked). A page of people
     * costs a few queries instead of one per person: the rows found by key,
     * then the rows found by address hash, each in chunks of 500, and the
     * newest (by time, then by id) picked here exactly as `latest` picks it.
     */
    async latestAmong(subjects: readonly ConsentSubject[], purpose: ConsentPurpose): Promise<(ConsentEvent | null)[]> {
      const found = new Map<string, AdminiumConsentLogTable>();
      const byTable = new Map<string, { connectionId: string; table: string; keys: Set<string> }>();
      const hashes = new Set<string>();
      for (const subject of subjects) {
        const person = subject.person;
        if (person != null && person.key.length > 0 && person.key.length <= CONSENT_PERSON_KEY_MAX) {
          const table = personPart(person.table, 'table');
          const id = `${person.connectionId}\u0000${table}`;
          const group = byTable.get(id) ?? { connectionId: person.connectionId, table, keys: new Set<string>() };
          group.keys.add(person.key);
          byTable.set(id, group);
        }
        for (const one of subject.hashes ?? []) hashes.add(one.hash);
      }
      const base = () =>
        db
          .selectFrom('adminium_consent_log')
          .selectAll()
          .where('purpose', '=', purpose)
          .where('state', 'in', ['yes', 'no']);
      for (const group of byTable.values()) {
        const keys = [...group.keys];
        for (let i = 0; i < keys.length; i += 500) {
          const rows = await base()
            .where('connectionId', '=', group.connectionId)
            .where('personTable', '=', group.table)
            .where('personKey', 'in', keys.slice(i, i + 500))
            .execute();
          for (const row of rows) found.set(String(row.id), row as AdminiumConsentLogTable);
        }
      }
      const wanted = [...hashes];
      for (let i = 0; i < wanted.length; i += 500) {
        const rows = await base().where('addressHash', 'in', wanted.slice(i, i + 500)).execute();
        for (const row of rows) found.set(String(row.id), row as AdminiumConsentLogTable);
      }
      const byPerson = new Map<string, AdminiumConsentLogTable[]>();
      const byHash = new Map<string, AdminiumConsentLogTable[]>();
      for (const row of found.values()) {
        if (row.personKey !== null && row.connectionId !== null && row.personTable !== null) {
          const id = `${row.connectionId}\u0000${row.personTable}\u0000${row.personKey}`;
          byPerson.set(id, [...(byPerson.get(id) ?? []), row]);
        }
        if (row.addressHash !== null) {
          const id = `${String(row.keyVersion)}\u0000${row.addressHash}`;
          byHash.set(id, [...(byHash.get(id) ?? []), row]);
        }
      }
      const newer = (a: AdminiumConsentLogTable, b: AdminiumConsentLogTable): boolean =>
        Number(a.at) !== Number(b.at) ? Number(a.at) > Number(b.at) : String(a.id) > String(b.id);
      return subjects.map((subject) => {
        let best: AdminiumConsentLogTable | null = null;
        const consider = (rows: readonly AdminiumConsentLogTable[] | undefined) => {
          for (const row of rows ?? []) if (best === null || newer(row, best)) best = row;
        };
        const person = subject.person;
        if (person != null) consider(byPerson.get(`${person.connectionId}\u0000${personPart(person.table, 'table')}\u0000${person.key}`));
        for (const one of subject.hashes ?? []) consider(byHash.get(`${String(one.version)}\u0000${one.hash}`));
        return best === null ? null : decode(best);
      });
    },

    /** A subject's events, newest first. `before` continues a page: the time and id of its last row. */
    async history(subject: ConsentSubject, opts: { limit: number; before?: { at: number; id: string } | undefined }): Promise<ConsentEvent[]> {
      if (!namesSomeone(subject)) return [];
      let q = db
        .selectFrom('adminium_consent_log')
        .selectAll()
        .where((eb) => subjectWhere(eb, subject));
      const before = opts.before;
      if (before !== undefined) q = q.where((eb) => eb.or([eb('at', '<', before.at), eb.and([eb('at', '=', before.at), eb('id', '<', before.id)])]));
      const rows = await q.orderBy('at', 'desc').orderBy('id', 'desc').limit(opts.limit).execute();
      return rows.map((row) => decode(row as AdminiumConsentLogTable));
    },

    /** When the subject last replied to a marketing e-mail; null when never. */
    async lastReplied(subject: ConsentSubject): Promise<number | null> {
      if (!namesSomeone(subject)) return null;
      const row = await db
        .selectFrom('adminium_consent_log')
        .select('at')
        .where((eb) => subjectWhere(eb, subject))
        .where('state', '=', 'replied')
        .orderBy('at', 'desc')
        .limit(1)
        .executeTakeFirst();
      return row === undefined ? null : Number(row.at);
    },

    /**
     * Which of a table's rows the log holds a yes or a no for (for `purpose`,
     * or for any purpose): the first-send review asks only about the others.
     */
    async answeredAmong(connectionId: string, table: string, keys: readonly string[], purpose?: ConsentPurpose): Promise<Set<string>> {
      const out = new Set<string>();
      const wanted = [...new Set(keys)].filter((key) => key.length > 0 && key.length <= CONSENT_PERSON_KEY_MAX);
      for (let i = 0; i < wanted.length; i += 500) {
        let q = db
          .selectFrom('adminium_consent_log')
          .select('personKey')
          .distinct()
          .where('connectionId', '=', connectionId)
          .where('personTable', '=', personPart(table, 'table'))
          .where('personKey', 'in', wanted.slice(i, i + 500))
          .where('state', 'in', ['yes', 'no']);
        if (purpose !== undefined) q = q.where('purpose', '=', purpose);
        for (const row of await q.execute()) if (row.personKey !== null) out.add(row.personKey);
      }
      return out;
    },

    /**
     * The erasure's delete: every row of the person, and every row of their
     * address under the versions given. The one delete the log has.
     */
    async deleteForPerson(subject: ConsentSubject): Promise<number> {
      if (!namesSomeone(subject)) return 0;
      const res = await db
        .deleteFrom('adminium_consent_log')
        .where((eb) => subjectWhere(eb, subject))
        .executeTakeFirst();
      return Number(res.numDeletedRows);
    },
  };
}

export type ConsentLogRepo = ReturnType<typeof consentLogRepo>;

/** One version of the key addresses are hashed under, as stored (still encrypted). */
export interface StoredAddressKey {
  version: number;
  keyEncrypted: string;
  createdAt: number;
}

export function addressKeysRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /** Every version, oldest first. */
    async all(): Promise<StoredAddressKey[]> {
      const rows = await db.selectFrom('adminium_address_keys').selectAll().orderBy('version', 'asc').execute();
      return rows.map((row) => ({ version: Number(row.version), keyEncrypted: row.keyEncrypted, createdAt: Number(row.createdAt) }));
    },

    /** Add a version; false when another process made that version first. */
    async create(input: StoredAddressKey): Promise<boolean> {
      try {
        await db.insertInto('adminium_address_keys').values(input).execute();
        return true;
      } catch (error) {
        if (isDuplicateKeyError(error)) return false;
        throw error;
      }
    },

    /** The same key, encrypted again (the server's secret changed). */
    async reseal(version: number, keyEncrypted: string): Promise<void> {
      await db.updateTable('adminium_address_keys').set({ keyEncrypted }).where('version', '=', version).execute();
    },
  };
}

export type AddressKeysRepo = ReturnType<typeof addressKeysRepo>;
