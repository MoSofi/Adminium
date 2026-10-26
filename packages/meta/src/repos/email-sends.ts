// SPDX-License-Identifier: AGPL-3.0-only
/**
 * emailSendsRepo — adminium_email_sends, the campaign send ledger (wave 0067),
 * and emailSendCountersRepo, the hourly count every run shares.
 *
 * One row per recipient of one run, written before the first message goes.
 * A batch moves rows `queued → sending` under a claim token of its own
 * ({@link claim}), and each claimed row then leaves `sending` exactly once:
 * handed over (`sent`, in the transaction that queued its message), settled
 * without a message (a skip, a failure), or put back (`queued`) for a later
 * batch. Every one of those moves is guarded on the row still being `sending`
 * under that same token, so a batch whose rows were taken back (after a stop,
 * a crash, a "go on") can change none of them. The portable compare-and-set
 * of the job queue: no `SELECT … FOR UPDATE`, no `UPDATE … LIMIT`.
 *
 * The address is held in clear, as the app outbox holds the address it
 * sends to (see the migration).
 */

import { sql, type Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import { emailSendStateSchema, type EmailSendState } from '../schema/json-payloads.js';
import type { AdminiumEmailSendsTable } from '../schema/tables.js';
import { affected, isDuplicateKeyError } from './util.js';

/** The widths the migration gives the copied fields; longer values are cut, never refused. */
export const EMAIL_SEND_ADDRESS_MAX = 320;
export const EMAIL_SEND_NAME_MAX = 120;
export const EMAIL_SEND_LANGUAGE_MAX = 35;
export const EMAIL_SEND_KEY_MAX = 200;
export const EMAIL_SEND_REASON_MAX = 500;

/** Rows per INSERT when a run's recipients are written. */
const WRITE_CHUNK = 200;

export interface EmailSend {
  id: string;
  runId: string;
  seq: number;
  address: string;
  name: string;
  language: string | null;
  connectionId: string | null;
  personTable: string | null;
  personKey: string | null;
  state: EmailSendState;
  reason: string | null;
  attempts: number;
  claimToken: string | null;
  claimedAt: number | null;
  sentAt: number | null;
  jobId: string | null;
  clicks: number;
  createdAt: number;
  updatedAt: number;
}

/** One recipient as the writer is given it. */
export interface EmailSendInput {
  address: string;
  name: string;
  language?: string | null | undefined;
  connectionId?: string | null | undefined;
  personTable?: string | null | undefined;
  personKey?: string | null | undefined;
  /** `queued` unless the person is already known not to get it. */
  state?: Extract<EmailSendState, 'queued' | 'skipped-stop' | 'skipped-consent'> | undefined;
  reason?: string | null | undefined;
}

/** The send log's filters: each is one or more ledger states. */
export const EMAIL_SEND_FILTERS = {
  sent: ['sent'],
  waiting: ['queued', 'sending'],
  skipped: ['skipped-stop', 'skipped-consent'],
  bounced: ['bounced'],
  spam: ['spam'],
  failed: ['failed'],
  unsubscribed: ['unsubscribed'],
} as const satisfies Record<string, readonly EmailSendState[]>;
export type EmailSendFilter = keyof typeof EMAIL_SEND_FILTERS;

export interface ListEmailSendsInput {
  filter?: EmailSendFilter | undefined;
  /** Part of a name or an address, any case. */
  q?: string | undefined;
  /** The last `seq` of the page before. */
  after?: number | undefined;
  limit: number;
}

function cut(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  return value.length > max ? value.slice(0, max) : value;
}

function decode(row: Selectable<AdminiumEmailSendsTable>): EmailSend {
  return {
    id: row.id,
    runId: row.runId,
    seq: Number(row.seq),
    address: row.address,
    name: row.name,
    language: row.language,
    connectionId: row.connectionId,
    personTable: row.personTable,
    personKey: row.personKey,
    state: emailSendStateSchema.parse(row.state),
    reason: row.reason,
    attempts: Number(row.attempts),
    claimToken: row.claimToken,
    claimedAt: row.claimedAt === null ? null : Number(row.claimedAt),
    sentAt: row.sentAt === null ? null : Number(row.sentAt),
    jobId: row.jobId,
    clicks: Number(row.clicks),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

/**
 * Escape LIKE's wildcards in a search term with `!`, named in the query's
 * ESCAPE clause: SQLite has no default escape character, and a backslash
 * means something else inside a MySQL string, so `!` is the one that reads
 * the same on all three.
 */
function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (ch) => `!${ch}`);
}

export function emailSendsRepo(meta: MetaDb) {
  const { db } = meta;

  async function findById(id: string): Promise<EmailSend | null> {
    const row = await db.selectFrom('adminium_email_sends').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? decode(row) : null;
  }

  /** Moves one claimed row out of `sending`, only while it is still this claim's. */
  async function settleClaimed(
    id: string,
    token: string,
    values: { state: EmailSendState; reason?: string | null; sentAt?: number | null; jobId?: string | null },
    at: number,
  ): Promise<boolean> {
    const res = await db
      .updateTable('adminium_email_sends')
      .set({
        state: values.state,
        claimToken: null,
        ...(values.reason === undefined ? {} : { reason: cut(values.reason, EMAIL_SEND_REASON_MAX) }),
        ...(values.sentAt === undefined ? {} : { sentAt: values.sentAt }),
        ...(values.jobId === undefined ? {} : { jobId: values.jobId }),
        updatedAt: at,
      })
      .where('id', '=', id)
      .where('state', '=', 'sending')
      .where('claimToken', '=', token)
      .executeTakeFirst();
    return affected(res.numUpdatedRows) === 1;
  }

  return {
    findById,

    /**
     * Writes a run's recipients from `firstSeq` on, in order, in chunks;
     * returns how many rows were written. The unique `(run_id, seq)` index
     * refuses a second copy of a place.
     */
    async write(runId: string, rows: readonly EmailSendInput[], firstSeq: number, at: number = Date.now()): Promise<number> {
      for (let start = 0; start < rows.length; start += WRITE_CHUNK) {
        const chunk = rows.slice(start, start + WRITE_CHUNK);
        await db
          .insertInto('adminium_email_sends')
          .values(
            chunk.map((row, index) => ({
              id: newId('esnd'),
              runId,
              seq: firstSeq + start + index,
              address: cut(row.address.trim(), EMAIL_SEND_ADDRESS_MAX) ?? '',
              name: cut(row.name.trim(), EMAIL_SEND_NAME_MAX) ?? '',
              language: cut(row.language, EMAIL_SEND_LANGUAGE_MAX),
              connectionId: row.connectionId ?? null,
              personTable: cut(row.personTable, EMAIL_SEND_KEY_MAX),
              personKey: cut(row.personKey, EMAIL_SEND_KEY_MAX),
              state: row.state ?? 'queued',
              reason: cut(row.reason, EMAIL_SEND_REASON_MAX),
              attempts: 0,
              claimToken: null,
              claimedAt: null,
              sentAt: null,
              jobId: null,
              clicks: 0,
              createdAt: at,
              updatedAt: at,
            })),
          )
          .execute();
      }
      return rows.length;
    },

    /** Every row of a run: what a start that died half-way leaves, removed before it is written again. */
    async clearRun(runId: string): Promise<number> {
      const res = await db.deleteFrom('adminium_email_sends').where('runId', '=', runId).executeTakeFirst();
      return Number(res.numDeletedRows);
    },

    /**
     * Puts every claimed row of a run back in the queue. Safe whoever holds
     * the claims: a batch still running finds its rows gone from under its
     * token and hands none of them over.
     */
    async releaseClaims(runId: string, at: number = Date.now()): Promise<number> {
      const res = await db
        .updateTable('adminium_email_sends')
        .set({ state: 'queued', claimToken: null, updatedAt: at })
        .where('runId', '=', runId)
        .where('state', '=', 'sending')
        .executeTakeFirst();
      return affected(res.numUpdatedRows);
    },

    /**
     * Claims up to `limit` queued rows of a run, first written first, under
     * `token` (fresh per batch). Returns the rows this claim won; a row
     * another claim took in between is simply not among them.
     */
    async claim(runId: string, limit: number, token: string, at: number = Date.now()): Promise<EmailSend[]> {
      if (limit <= 0) return [];
      const candidates = await db
        .selectFrom('adminium_email_sends')
        .select(['id'])
        .where('runId', '=', runId)
        .where('state', '=', 'queued')
        .orderBy('seq', 'asc')
        .limit(limit)
        .execute();
      if (candidates.length === 0) return [];
      await db
        .updateTable('adminium_email_sends')
        // The token is new on every claim, so MySQL always reports a claimed row as changed.
        .set((eb) => ({ state: 'sending', claimToken: token, claimedAt: at, attempts: eb('attempts', '+', 1), updatedAt: at }))
        .where('id', 'in', candidates.map((row) => row.id))
        .where('state', '=', 'queued')
        .execute();
      const rows = await db
        .selectFrom('adminium_email_sends')
        .selectAll()
        .where('runId', '=', runId)
        .where('state', '=', 'sending')
        .where('claimToken', '=', token)
        .orderBy('seq', 'asc')
        .execute();
      return rows.map(decode);
    },

    /** The claimed row was handed to the mail queue as `jobId` (call inside the transaction that queued it). */
    async markHanded(id: string, token: string, jobId: string, at: number = Date.now()): Promise<boolean> {
      return await settleClaimed(id, token, { state: 'sent', sentAt: at, jobId, reason: null }, at);
    },

    /** The claimed row ends without a message: skipped (with why), or failed before it was handed over. */
    async settle(
      id: string,
      token: string,
      state: Extract<EmailSendState, 'skipped-stop' | 'skipped-consent' | 'failed'>,
      reason: string,
      at: number = Date.now(),
    ): Promise<boolean> {
      return await settleClaimed(id, token, { state, reason }, at);
    },

    /** Every row still claimed under `token` goes back to the queue: what a batch did not get to. */
    async unclaimAll(runId: string, token: string, at: number = Date.now()): Promise<number> {
      const res = await db
        .updateTable('adminium_email_sends')
        .set({ state: 'queued', claimToken: null, updatedAt: at })
        .where('runId', '=', runId)
        .where('state', '=', 'sending')
        .where('claimToken', '=', token)
        .executeTakeFirst();
      return affected(res.numUpdatedRows);
    },

    /**
     * A handed message the mail queue gave up on: the row turns `failed` with
     * what the server said, or `bounced` when the server refused the address
     * for good at send time. Null when the row is not `sent` (already marked
     * by a bounce notice, or not this ledger's).
     */
    async markGivenUp(id: string, reason: string, at: number = Date.now(), state: Extract<EmailSendState, 'failed' | 'bounced'> = 'failed'): Promise<EmailSend | null> {
      const res = await db
        .updateTable('adminium_email_sends')
        .set({ state, reason: cut(reason, EMAIL_SEND_REASON_MAX), updatedAt: at })
        .where('id', '=', id)
        .where('state', '=', 'sent')
        .executeTakeFirst();
      if (affected(res.numUpdatedRows) === 0) return null;
      return await findById(id);
    },

    /** How many rows of a run are in each state (absent = none). */
    async counts(runId: string): Promise<Partial<Record<EmailSendState, number>>> {
      const rows = await db
        .selectFrom('adminium_email_sends')
        .select((eb) => ['state', eb.fn.countAll<number>().as('n')])
        .where('runId', '=', runId)
        .groupBy('state')
        .execute();
      const out: Partial<Record<EmailSendState, number>> = {};
      for (const row of rows) out[emailSendStateSchema.parse(row.state)] = Number(row.n);
      return out;
    },

    /** Rows not yet handed over or settled: queued, or claimed by a batch. */
    async remaining(runId: string): Promise<number> {
      const row = await db
        .selectFrom('adminium_email_sends')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('runId', '=', runId)
        .where('state', 'in', ['queued', 'sending'])
        .executeTakeFirst();
      return Number(row?.n ?? 0);
    },

    /**
     * The mail-queue jobs of handed rows that are still being tried after a
     * refusal (`pending` with a last error): their id and that error. The log
     * says "will try again" only for these.
     */
    async retrying(jobIds: readonly string[]): Promise<Map<string, string>> {
      const out = new Map<string, string>();
      if (jobIds.length === 0) return out;
      const rows = await db
        .selectFrom('adminium_jobs')
        .select(['id', 'lastError'])
        .where('id', 'in', [...jobIds])
        .where('status', '=', 'pending')
        .where('lastError', 'is not', null)
        .execute();
      for (const row of rows) out.set(row.id, row.lastError ?? '');
      return out;
    },

    /** One page of a run's log, in the order the recipients were written. */
    async list(runId: string, input: ListEmailSendsInput): Promise<EmailSend[]> {
      let query = db.selectFrom('adminium_email_sends').selectAll().where('runId', '=', runId);
      if (input.filter !== undefined) query = query.where('state', 'in', [...EMAIL_SEND_FILTERS[input.filter]]);
      const term = input.q?.trim().toLowerCase() ?? '';
      if (term.length > 0) {
        const like = `%${escapeLike(term)}%`;
        query = query.where(sql<boolean>`(lower(name) like ${like} escape '!' or lower(address) like ${like} escape '!')`);
      }
      if (input.after !== undefined) query = query.where('seq', '>', input.after);
      const rows = await query.orderBy('seq', 'asc').limit(input.limit).execute();
      return rows.map(decode);
    },
  };
}

export type EmailSendsRepo = ReturnType<typeof emailSendsRepo>;

// ─── the hourly count ───────────────────────────────────────────────────────

export const EMAIL_SEND_COUNTER_WINDOW_MS = 3_600_000;

/** The one bucket every campaign run counts in: a cap is the mail server's hour, not one run's. */
export const EMAIL_CAMPAIGN_COUNTER_BUCKET = 'email.campaign';

export function emailSendCountersRepo(meta: MetaDb) {
  const { db } = meta;
  const windowOf = (at: number): number => Math.floor(at / EMAIL_SEND_COUNTER_WINDOW_MS) * EMAIL_SEND_COUNTER_WINDOW_MS;

  async function read(bucket: string, at: number = Date.now()): Promise<number> {
    const row = await db
      .selectFrom('adminium_email_send_counters')
      .select(['hits'])
      .where('bucket', '=', bucket)
      .where('windowStart', '=', windowOf(at))
      .executeTakeFirst();
    return row === undefined ? 0 : Number(row.hits);
  }

  return {
    read,

    /** When the hour that holds `at` ends: where a run that met its cap waits until. */
    nextWindow(at: number): number {
      return windowOf(at) + EMAIL_SEND_COUNTER_WINDOW_MS;
    },

    /**
     * Counts `n` hits in `bucket`'s current hour and returns the new count.
     * One statement adds them, so a burst counts every hit; the value always
     * changes, so MySQL reports the row as touched.
     */
    async hit(bucket: string, at: number = Date.now(), n = 1): Promise<number> {
      const windowStart = windowOf(at);
      const bump = () =>
        db
          .updateTable('adminium_email_send_counters')
          .set((eb) => ({ hits: eb('hits', '+', n) }))
          .where('bucket', '=', bucket)
          .where('windowStart', '=', windowStart)
          .executeTakeFirst();
      const bumped = await bump();
      if (affected(bumped.numUpdatedRows) === 0) {
        try {
          await db.insertInto('adminium_email_send_counters').values({ bucket, windowStart, hits: n }).execute();
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;
          await bump();
        }
      }
      return await read(bucket, at);
    },

    /** Drops the hours before `before`: a count is read only in its own hour. */
    async gc(before: number): Promise<number> {
      const res = await db.deleteFrom('adminium_email_send_counters').where('windowStart', '<', windowOf(before)).executeTakeFirst();
      return Number(res.numDeletedRows);
    },
  };
}

export type EmailSendCountersRepo = ReturnType<typeof emailSendCountersRepo>;
