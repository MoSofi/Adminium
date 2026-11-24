// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where marketing texts are kept: `adminium_text_runs`,
 * `adminium_text_run_recipients` and `adminium_text_confirmations`.
 *
 * None of them holds a number or a word of a message: a number is its keyed
 * hash (the stop list's) and a mask. A run's frozen template is the business's
 * own words, not a person's.
 *
 * Every change of state is a compare-and-set on the state it moves from, so
 * two batches of one run, or a batch and a cancel, never both act on a row.
 */
import { newId, type AddressHash, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import type { TextRecipientSkip, TextRecipientState, TextRunState } from './types.js';

interface RunTable {
  id: string;
  name: string;
  templateKey: string;
  content: string;
  connectionId: string;
  personTable: string;
  viewId: string | null;
  status: string;
  reason: string | null;
  scheduledAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  waitingUntil: number | null;
  jobId: string | null;
  createdBy: string;
  cancelledBy: string | null;
  createdAt: number;
  updatedAt: number;
}

interface RecipientTable {
  id: string;
  runId: string;
  connectionId: string;
  personTable: string;
  personKey: string;
  name: string | null;
  phoneHash: string | null;
  keyVersion: number | null;
  phoneMasked: string | null;
  country: string | null;
  locale: string | null;
  state: string;
  reason: string | null;
  deliveryId: string | null;
  tries: number;
  claim: string | null;
  createdAt: number;
  updatedAt: number;
}

interface ConfirmationTable {
  id: string;
  consentEventId: string;
  phoneHash: string;
  keyVersion: number;
  phoneMasked: string | null;
  connectionId: string | null;
  personTable: string | null;
  personKey: string | null;
  language: string | null;
  state: string;
  requestedAt: number;
  requestedBy: string | null;
  confirmedAt: number | null;
  ip: string | null;
  userAgent: string | null;
}

interface MarketingTables {
  adminium_text_runs: RunTable;
  adminium_text_run_recipients: RecipientTable;
  adminium_text_confirmations: ConfirmationTable;
  adminium_text_deliveries: { id: string; state: string; reason: string | null; providerStatus: string | null; segments: number | null; slotDay: string | null; createdAt: number; updatedAt: number };
  adminium_text_stop_list: { phoneHash: string; keyVersion: number; reason: string; addedAt: number };
}

export interface TextRun {
  id: string;
  name: string;
  templateKey: string;
  /** The template's languages as they were when the run was made. */
  content: Record<string, string>;
  connectionId: string;
  table: string;
  viewId: string | null;
  status: TextRunState;
  reason: string | null;
  scheduledAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  waitingUntil: number | null;
  jobId: string | null;
  createdBy: string;
  cancelledBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TextRecipient {
  id: string;
  runId: string;
  connectionId: string;
  table: string;
  key: string;
  name: string | null;
  phone: AddressHash | null;
  phoneMasked: string | null;
  country: string | null;
  locale: string | null;
  state: TextRecipientState;
  reason: TextRecipientSkip | null;
  deliveryId: string | null;
  tries: number;
  claim: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TextConfirmation {
  id: string;
  consentEventId: string;
  phone: AddressHash;
  phoneMasked: string | null;
  person: { connectionId: string; table: string; key: string } | null;
  language: string | null;
  state: 'waiting' | 'confirmed' | 'void';
  requestedAt: number;
  requestedBy: string | null;
  confirmedAt: number | null;
}

export interface NewTextRun {
  name: string;
  templateKey: string;
  content: Record<string, string>;
  connectionId: string;
  table: string;
  viewId: string | null;
  scheduledAt: number;
  createdBy: string;
}

export interface NewTextRecipient {
  connectionId: string;
  table: string;
  key: string;
  name: string | null;
  phone: AddressHash | null;
  phoneMasked: string | null;
  country: string | null;
  locale: string | null;
  state: 'queued' | 'skipped';
  reason: TextRecipientSkip | null;
}

/** A delivery's end as the totals read it. */
export interface RecipientWithDelivery {
  recipient: TextRecipient;
  delivery: { id: string; state: string; reason: string | null; providerStatus: string | null; segments: number | null; createdAt: number } | null;
}

/** Who a row of these tables is about, for the erasure. */
export interface MarketingWho {
  hashes: readonly AddressHash[];
  person?: { connectionId: string; table: string; key: string } | null | undefined;
}

const NAME_MAX = 120;
const PERSON_MAX = 200;
const cut = (value: string | null, width: number): string | null => (value === null ? null : value.slice(0, width));
const orNull = (value: number | string | null): number | null => (value === null ? null : Number(value));

function readContent(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return {};
  }
}

function decodeRun(row: RunTable): TextRun {
  return {
    id: row.id,
    name: row.name,
    templateKey: row.templateKey,
    content: readContent(row.content),
    connectionId: row.connectionId,
    table: row.personTable,
    viewId: row.viewId,
    status: row.status as TextRunState,
    reason: row.reason,
    scheduledAt: Number(row.scheduledAt),
    startedAt: orNull(row.startedAt),
    finishedAt: orNull(row.finishedAt),
    waitingUntil: orNull(row.waitingUntil),
    jobId: row.jobId,
    createdBy: row.createdBy,
    cancelledBy: row.cancelledBy,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function decodeRecipient(row: RecipientTable): TextRecipient {
  const version = orNull(row.keyVersion);
  return {
    id: row.id,
    runId: row.runId,
    connectionId: row.connectionId,
    table: row.personTable,
    key: row.personKey,
    name: row.name,
    phone: row.phoneHash !== null && version !== null ? { hash: row.phoneHash, version } : null,
    phoneMasked: row.phoneMasked,
    country: row.country,
    locale: row.locale,
    state: row.state as TextRecipientState,
    reason: row.reason as TextRecipientSkip | null,
    deliveryId: row.deliveryId,
    tries: Number(row.tries),
    claim: row.claim,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function decodeConfirmation(row: ConfirmationTable): TextConfirmation {
  return {
    id: row.id,
    consentEventId: row.consentEventId,
    phone: { hash: row.phoneHash, version: Number(row.keyVersion) },
    phoneMasked: row.phoneMasked,
    person: row.connectionId !== null && row.personTable !== null && row.personKey !== null ? { connectionId: row.connectionId, table: row.personTable, key: row.personKey } : null,
    language: row.language,
    state: row.state as TextConfirmation['state'],
    requestedAt: Number(row.requestedAt),
    requestedBy: row.requestedBy,
    confirmedAt: orNull(row.confirmedAt),
  };
}

function cursorOf(run: { createdAt: number; id: string }): string {
  return Buffer.from(JSON.stringify([run.createdAt, run.id])).toString('base64url');
}

function readCursor(cursor: string | null | undefined): { createdAt: number; id: string } | undefined | null {
  if (cursor === null || cursor === undefined || cursor === '') return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(parsed) && typeof parsed[0] === 'number' && typeof parsed[1] === 'string') return { createdAt: parsed[0], id: parsed[1] };
  } catch {
    // Not one of ours.
  }
  return null;
}

export function createTextMarketingStore(meta: MetaDb) {
  return storeOver(meta.db as unknown as Kysely<MarketingTables>, meta.dialect);
}

/** The store, and its work in one transaction on a store over it. */
export type TextMarketingStore = ReturnType<typeof storeBase> & { transaction<T>(work: (store: TextMarketingStore) => Promise<T>): Promise<T> };

function storeOver(db: Kysely<MarketingTables>, dialect: MetaDb['dialect']): TextMarketingStore {
  return {
    ...storeBase(db, dialect),
    transaction: (work) => db.transaction().execute((trx) => work(storeOver(trx as unknown as Kysely<MarketingTables>, dialect))),
  };
}

function storeBase(db: Kysely<MarketingTables>, dialect: MetaDb['dialect']) {

  /** One row, exactly: MySQL's default collation compares without case, so there `abc` would also match `ABC`. */
  const personIs = (person: { connectionId: string; table: string; key: string }) =>
    sql<boolean>`${sql.ref('connectionId')} = ${person.connectionId} and ${sql.ref('personTable')} = ${person.table} and ${sql.ref('personKey')} = ${person.key}${dialect === 'mysql' ? sql` and binary ${sql.ref('personTable')} = ${person.table} and binary ${sql.ref('personKey')} = ${person.key}` : sql``}`;

  const whoSql = (who: MarketingWho) => {
    const parts = [
      ...who.hashes.map((one) => sql`(${sql.ref('phoneHash')} = ${one.hash} and ${sql.ref('keyVersion')} = ${one.version})`),
      ...(who.person == null ? [] : [sql`(${personIs(who.person)})`]),
    ];
    return parts.length === 0 ? null : sql<boolean>`(${sql.join(parts, sql` or `)})`;
  };

  async function runById(id: string): Promise<TextRun | null> {
    const row = await db.selectFrom('adminium_text_runs').selectAll().where('id', '=', id).executeTakeFirst();
    return row === undefined ? null : decodeRun(row);
  }

  async function recipientById(id: string): Promise<TextRecipient | null> {
    const row = await db.selectFrom('adminium_text_run_recipients').selectAll().where('id', '=', id).executeTakeFirst();
    return row === undefined ? null : decodeRecipient(row);
  }

  return {
    runs: {
      byId: runById,

      async create(input: NewTextRun, at: number): Promise<TextRun> {
        const row: RunTable = {
          id: newId('txr'),
          name: input.name.slice(0, NAME_MAX),
          templateKey: input.templateKey,
          content: JSON.stringify(input.content),
          connectionId: input.connectionId,
          personTable: input.table.slice(0, PERSON_MAX),
          viewId: input.viewId,
          status: 'scheduled',
          reason: null,
          scheduledAt: input.scheduledAt,
          startedAt: null,
          finishedAt: null,
          waitingUntil: null,
          jobId: null,
          createdBy: input.createdBy,
          cancelledBy: null,
          createdAt: at,
          updatedAt: at,
        };
        await db.insertInto('adminium_text_runs').values(row).execute();
        return decodeRun(row);
      },

      async setJob(id: string, jobId: string, at: number): Promise<void> {
        await db.updateTable('adminium_text_runs').set({ jobId, updatedAt: at }).where('id', '=', id).execute();
      },

      /** Moves a run from one of `from` to `to`; false when it was not in one of them. */
      async move(id: string, from: readonly TextRunState[], to: TextRunState, more: Partial<Pick<RunTable, 'reason' | 'startedAt' | 'finishedAt' | 'waitingUntil' | 'cancelledBy' | 'jobId'>>, at: number): Promise<boolean> {
        const result = await db
          .updateTable('adminium_text_runs')
          .set({ status: to, ...more, updatedAt: at })
          .where('id', '=', id)
          .where('status', 'in', [...from])
          .executeTakeFirst();
        return Number(result.numUpdatedRows) === 1;
      },

      /** Newest first. */
      async page(opts: { limit: number; cursor?: string | null | undefined }): Promise<{ runs: TextRun[]; next: string | null } | null> {
        const after = readCursor(opts.cursor);
        if (after === null) return null;
        let query = db.selectFrom('adminium_text_runs').selectAll();
        if (after !== undefined) query = query.where((eb) => eb.or([eb('createdAt', '<', after.createdAt), eb.and([eb('createdAt', '=', after.createdAt), eb('id', '<', after.id)])]));
        const rows = (await query.orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(opts.limit + 1).execute()).map(decodeRun);
        const shown = rows.slice(0, opts.limit);
        return { runs: shown, next: rows.length > opts.limit ? cursorOf(shown.at(-1)!) : null };
      },
    },

    recipients: {
      byId: recipientById,

      async write(runId: string, rows: readonly NewTextRecipient[], at: number): Promise<void> {
        if (rows.length === 0) return;
        const values: RecipientTable[] = rows.map((row) => ({
          id: newId('txp'),
          runId,
          connectionId: row.connectionId,
          personTable: row.table.slice(0, PERSON_MAX),
          personKey: row.key,
          name: cut(row.name, NAME_MAX),
          phoneHash: row.phone?.hash ?? null,
          keyVersion: row.phone?.version ?? null,
          phoneMasked: row.phoneMasked,
          country: row.country,
          locale: row.locale,
          state: row.state,
          reason: row.reason,
          deliveryId: null,
          tries: 0,
          claim: null,
          createdAt: at,
          updatedAt: at,
        }));
        // In slices: one statement's parameters are limited on every engine.
        for (let i = 0; i < values.length; i += 100) await db.insertInto('adminium_text_run_recipients').values(values.slice(i, i + 100)).execute();
      },

      async any(runId: string): Promise<boolean> {
        return (await db.selectFrom('adminium_text_run_recipients').select('id').where('runId', '=', runId).limit(1).executeTakeFirst()) !== undefined;
      },

      /**
       * Claims up to `limit` queued people under a fresh token. Rows a dead
       * batch left `sending` are put back first: their batch is gone.
       */
      async claim(runId: string, claim: string, limit: number, at: number): Promise<TextRecipient[]> {
        await db.updateTable('adminium_text_run_recipients').set({ state: 'queued', claim: null, updatedAt: at }).where('runId', '=', runId).where('state', '=', 'sending').execute();
        if (limit <= 0) return [];
        const ids = (await db.selectFrom('adminium_text_run_recipients').select('id').where('runId', '=', runId).where('state', '=', 'queued').orderBy('id').limit(limit).execute()).map((row) => row.id);
        if (ids.length === 0) return [];
        await db.updateTable('adminium_text_run_recipients').set({ state: 'sending', claim, updatedAt: at }).where('id', 'in', ids).where('state', '=', 'queued').execute();
        const rows = await db.selectFrom('adminium_text_run_recipients').selectAll().where('claim', '=', claim).where('state', '=', 'sending').orderBy('id').execute();
        return rows.map(decodeRecipient);
      },

      /** Ends one claimed person; false when the claim was lost (a cancel, or another batch). */
      async end(id: string, claim: string, to: { state: 'handed'; deliveryId: string } | { state: 'skipped'; reason: TextRecipientSkip } | { state: 'queued' }, at: number): Promise<boolean> {
        const set =
          to.state === 'handed'
            ? { state: 'handed', deliveryId: to.deliveryId, reason: null, claim: null, updatedAt: at, tries: sql<number>`tries + 1` }
            : to.state === 'skipped'
              ? { state: 'skipped', reason: to.reason, claim: null, updatedAt: at }
              : { state: 'queued', claim: null, updatedAt: at };
        const result = await db
          .updateTable('adminium_text_run_recipients')
          .set(set as never)
          .where('id', '=', id)
          .where('claim', '=', claim)
          .where('state', '=', 'sending')
          .executeTakeFirst();
        return Number(result.numUpdatedRows) === 1;
      },

      /** A handed person whose text the send path refused for today's limit: back in the queue for tomorrow. */
      async requeue(id: string, deliveryId: string, at: number): Promise<boolean> {
        const result = await db
          .updateTable('adminium_text_run_recipients')
          .set({ state: 'queued', deliveryId: null, updatedAt: at })
          .where('id', '=', id)
          .where('state', '=', 'handed')
          .where('deliveryId', '=', deliveryId)
          .executeTakeFirst();
        return Number(result.numUpdatedRows) === 1;
      },

      /** Every person still waiting for their turn ends with `to`. */
      async endQueued(runId: string, to: { state: 'cancelled' } | { state: 'skipped'; reason: TextRecipientSkip }, at: number): Promise<number> {
        const result = await db
          .updateTable('adminium_text_run_recipients')
          .set({ state: to.state, reason: to.state === 'skipped' ? to.reason : null, claim: null, updatedAt: at })
          .where('runId', '=', runId)
          .where('state', 'in', ['queued', 'sending'])
          .executeTakeFirst();
        return Number(result.numUpdatedRows);
      },

      async countByState(runId: string): Promise<Record<string, number>> {
        const rows = await db.selectFrom('adminium_text_run_recipients').select(['state', sql<number>`count(*)`.as('n')]).where('runId', '=', runId).groupBy('state').execute();
        return Object.fromEntries(rows.map((row) => [row.state, Number(row.n)]));
      },

      /** Handed people whose delivery has not taken a slot of the day yet: they will. */
      async pendingSlots(runId: string): Promise<number> {
        const row = await db
          .selectFrom('adminium_text_run_recipients as r')
          .innerJoin('adminium_text_deliveries as d', 'd.id', 'r.deliveryId')
          .select(sql<number>`count(*)`.as('n'))
          .where('r.runId', '=', runId)
          .where('r.state', '=', 'handed')
          .where('d.state', 'in', ['prepared', 'retrying'])
          .where('d.slotDay', 'is', null)
          .executeTakeFirst();
        return Number(row?.n ?? 0);
      },

      /** People with their deliveries, a page at a time, in the order they were written. */
      async page(runId: string, opts: { limit: number; after?: string | null | undefined; state?: TextRecipientState | undefined; reason?: string | undefined }): Promise<RecipientWithDelivery[]> {
        let query = db
          .selectFrom('adminium_text_run_recipients as r')
          .leftJoin('adminium_text_deliveries as d', 'd.id', 'r.deliveryId')
          .selectAll('r')
          .select(['d.id as dId', 'd.state as dState', 'd.reason as dReason', 'd.providerStatus as dStatus', 'd.segments as dSegments', 'd.createdAt as dCreatedAt'])
          .where('r.runId', '=', runId);
        if (opts.after != null && opts.after !== '') query = query.where('r.id', '>', opts.after);
        if (opts.state !== undefined) query = query.where('r.state', '=', opts.state);
        if (opts.reason !== undefined) query = query.where((eb) => eb.or([eb('r.reason', '=', opts.reason!), eb('d.reason', '=', opts.reason!)]));
        const rows = await query.orderBy('r.id').limit(opts.limit).execute();
        return rows.map((row) => {
          const own = row as unknown as RecipientTable & { dId: string | null; dState: string | null; dReason: string | null; dStatus: string | null; dSegments: number | null; dCreatedAt: number | null };
          return {
            recipient: decodeRecipient(own),
            delivery: own.dId === null ? null : { id: own.dId, state: own.dState!, reason: own.dReason, providerStatus: own.dStatus, segments: orNull(own.dSegments), createdAt: Number(own.dCreatedAt) },
          };
        });
      },

      /** The run's people counted by where they stand and how their delivery ended. */
      async tally(runId: string): Promise<{ state: string; reason: string | null; dState: string | null; dReason: string | null; dStatus: string | null; n: number }[]> {
        const rows = await db
          .selectFrom('adminium_text_run_recipients as r')
          .leftJoin('adminium_text_deliveries as d', 'd.id', 'r.deliveryId')
          .select(['r.state as state', 'r.reason as reason', 'd.state as dState', 'd.reason as dReason', 'd.providerStatus as dStatus', sql<number>`count(*)`.as('n')])
          .where('r.runId', '=', runId)
          .groupBy(['r.state', 'r.reason', 'd.state', 'd.reason', 'd.providerStatus'])
          .execute();
        return rows.map((row) => ({ state: row.state, reason: row.reason, dState: row.dState ?? null, dReason: row.dReason ?? null, dStatus: row.dStatus ?? null, n: Number(row.n) }));
      },

      /** How many people of the run asked for no more texts after its text reached the provider. */
      async optOuts(runId: string): Promise<number> {
        const row = await db
          .selectFrom('adminium_text_run_recipients as r')
          .innerJoin('adminium_text_deliveries as d', 'd.id', 'r.deliveryId')
          .innerJoin('adminium_text_stop_list as s', (join) => join.onRef('s.phoneHash', '=', 'r.phoneHash').onRef('s.keyVersion', '=', 'r.keyVersion'))
          .select(sql<number>`count(*)`.as('n'))
          .where('r.runId', '=', runId)
          .where('d.state', 'in', ['accepted', 'provider-failed', 'unknown', 'checked-went'])
          .where('s.reason', 'in', ['text-stop', 'provider-opt-out', 'staff'])
          .whereRef('s.addedAt', '>=', 'd.createdAt')
          .executeTakeFirst();
        return Number(row?.n ?? 0);
      },

      eraseFor: async (who: MarketingWho): Promise<number> => {
        const where = whoSql(who);
        if (where === null) return 0;
        const result = await db.deleteFrom('adminium_text_run_recipients').where(where).executeTakeFirst();
        return Number(result.numDeletedRows);
      },

      countFor: async (who: MarketingWho): Promise<number> => {
        const where = whoSql(who);
        if (where === null) return 0;
        const row = await db.selectFrom('adminium_text_run_recipients').select(sql<number>`count(*)`.as('n')).where(where).executeTakeFirst();
        return Number(row?.n ?? 0);
      },
    },

    confirmations: {
      async create(input: { consentEventId: string; phone: AddressHash; phoneMasked: string | null; person: { connectionId: string; table: string; key: string } | null; language: string | null; requestedBy: string | null }, at: number): Promise<TextConfirmation> {
        const row: ConfirmationTable = {
          id: newId('tcf'),
          consentEventId: input.consentEventId,
          phoneHash: input.phone.hash,
          keyVersion: input.phone.version,
          phoneMasked: input.phoneMasked,
          connectionId: input.person?.connectionId ?? null,
          personTable: input.person?.table ?? null,
          personKey: input.person?.key ?? null,
          language: input.language,
          state: 'waiting',
          requestedAt: at,
          requestedBy: input.requestedBy,
          confirmedAt: null,
          ip: null,
          userAgent: null,
        };
        await db.insertInto('adminium_text_confirmations').values(row).execute();
        return decodeConfirmation(row);
      },

      async byId(id: string): Promise<TextConfirmation | null> {
        const row = await db.selectFrom('adminium_text_confirmations').selectAll().where('id', '=', id).executeTakeFirst();
        return row === undefined ? null : decodeConfirmation(row);
      },

      /** The newest request for a number since a moment, if any. */
      async latestFor(hashes: readonly AddressHash[], since: number): Promise<TextConfirmation | null> {
        if (hashes.length === 0) return null;
        const row = await db
          .selectFrom('adminium_text_confirmations')
          .selectAll()
          .where((eb) => eb.or(hashes.map((one) => eb.and([eb('phoneHash', '=', one.hash), eb('keyVersion', '=', one.version)]))))
          .where('requestedAt', '>=', since)
          // A request whose mail never went is no request.
          .where('state', '!=', 'void')
          .orderBy('requestedAt', 'desc')
          .orderBy('id', 'desc')
          .limit(1)
          .executeTakeFirst();
        return row === undefined ? null : decodeConfirmation(row);
      },

      /** Once: only a waiting request turns confirmed, so two presses at one moment confirm once. */
      async markConfirmed(id: string, input: { ip: string | null; userAgent: string | null }, at: number): Promise<boolean> {
        const result = await db
          .updateTable('adminium_text_confirmations')
          .set({ state: 'confirmed', confirmedAt: at, ip: cut(input.ip, 64), userAgent: cut(input.userAgent, 512) })
          .where('id', '=', id)
          .where('state', '=', 'waiting')
          .executeTakeFirst();
        return Number(result.numUpdatedRows) === 1;
      },

      async markVoid(id: string): Promise<void> {
        await db.updateTable('adminium_text_confirmations').set({ state: 'void' }).where('id', '=', id).execute();
      },

      eraseFor: async (who: MarketingWho): Promise<number> => {
        const where = whoSql(who);
        if (where === null) return 0;
        const result = await db.deleteFrom('adminium_text_confirmations').where(where).executeTakeFirst();
        return Number(result.numDeletedRows);
      },

      countFor: async (who: MarketingWho): Promise<number> => {
        const where = whoSql(who);
        if (where === null) return 0;
        const row = await db.selectFrom('adminium_text_confirmations').select(sql<number>`count(*)`.as('n')).where(where).executeTakeFirst();
        return Number(row?.n ?? 0);
      },
    },
  };
}

