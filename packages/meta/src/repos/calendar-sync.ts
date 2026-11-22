// SPDX-License-Identifier: AGPL-3.0-only
/**
 * calendarSyncRepo — the sync's own state (wave 0102): per account, the event
 * mirror, the rows waiting to be written out, the push channels and the clashes
 * told or kept. Only `apps/server/src/calendar-sync` calls this.
 *
 * Nothing here holds what an event is called or who it is for.
 */
import type { Selectable, Updateable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type {
  AdminiumCalendarChannelsTable,
  AdminiumCalendarClashesTable,
  AdminiumCalendarDirtyTable,
  AdminiumCalendarEventsTable,
  AdminiumCalendarSyncTable,
} from '../schema/tables.js';
import type { CredentialCrypto } from './manifests.js';
import { affected, isDuplicateKeyError, packJson, readBool, readJsonOrNull, writeBool } from './util.js';

export const CALENDAR_DETAILS = ['first-name+initial', 'none'] as const;
export type CalendarDetail = (typeof CALENDAR_DETAILS)[number];

export interface CalendarRowRef {
  connectionId: string;
  tableName: string;
  rowKey: string;
}

export interface CalendarSyncState {
  accountId: string;
  connectionId: string;
  bookingTable: string;
  calendarId: string | null;
  calendarName: string | null;
  /** The calendars read for busy times. Null: the main one. */
  readCalendars: string[] | null;
  countAllDay: boolean;
  detail: CalendarDetail;
  ownCursor: string | null;
  readStartedAt: number | null;
  lastSyncedAt: number | null;
  nextPollAt: number;
  noticeAt: number | null;
  connectingSince: number | null;
  holdUntil: number | null;
  staleDroppedAt: number | null;
  calendarLostAt: number | null;
  calendarLostCount: number;
  paused: string | null;
  calendarLeaseUntil: number | null;
  busyHash: string | null;
  silentToldAt: number | null;
  lastError: string | null;
  updatedAt: number;
}

export interface CalendarEventRow extends CalendarRowRef {
  id: string;
  accountId: string;
  generation: number;
  remoteId: string | null;
  etag: string | null;
  appliedHash: string | null;
  startAt: number | null;
  endAt: number | null;
  detail: 'name' | 'none' | null;
  tries: number;
  lastError: string | null;
  updatedAt: number;
}

export interface CalendarDirtyRow extends CalendarRowRef {
  id: string;
  markedAt: number;
  mark: number;
}

export interface CalendarChannel {
  id: string;
  accountId: string;
  provider: string;
  target: 'own' | 'busy';
  state: 'creating' | 'live';
  secret: string;
  remoteChannelId: string | null;
  resourceId: string | null;
  address: string;
  expiresAt: number;
  lastNoticeAt: number | null;
  createdAt: number;
}

export interface CalendarClashRow extends CalendarRowRef {
  id: string;
  overlapStart: number;
  overlapEnd: number;
  toldAt: number | null;
  keptAt: number | null;
  keptBy: string | null;
}

const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

function stateOf(row: Selectable<AdminiumCalendarSyncTable>): CalendarSyncState {
  return {
    accountId: row.accountId,
    connectionId: row.connectionId,
    bookingTable: row.bookingTable,
    calendarId: row.calendarId,
    calendarName: row.calendarName,
    readCalendars: readJsonOrNull<string[]>(row.readCalendars),
    countAllDay: readBool(row.countAllDay),
    detail: row.detail === 'none' ? 'none' : 'first-name+initial',
    ownCursor: row.ownCursor,
    readStartedAt: num(row.readStartedAt),
    lastSyncedAt: num(row.lastSyncedAt),
    nextPollAt: Number(row.nextPollAt),
    noticeAt: num(row.noticeAt),
    connectingSince: num(row.connectingSince),
    holdUntil: num(row.holdUntil),
    staleDroppedAt: num(row.staleDroppedAt),
    calendarLostAt: num(row.calendarLostAt),
    calendarLostCount: Number(row.calendarLostCount),
    paused: row.paused,
    calendarLeaseUntil: num(row.calendarLeaseUntil),
    busyHash: row.busyHash,
    silentToldAt: num(row.silentToldAt),
    lastError: row.lastError,
    updatedAt: Number(row.updatedAt),
  };
}

function eventOf(row: Selectable<AdminiumCalendarEventsTable>): CalendarEventRow {
  return {
    id: row.id,
    accountId: row.accountId,
    connectionId: row.connectionId,
    tableName: row.tableName,
    rowKey: row.rowKey,
    generation: Number(row.generation),
    remoteId: row.remoteId,
    etag: row.etag,
    appliedHash: row.appliedHash,
    startAt: num(row.startAt),
    endAt: num(row.endAt),
    detail: row.detail === 'name' || row.detail === 'none' ? row.detail : null,
    tries: Number(row.tries),
    lastError: row.lastError,
    updatedAt: Number(row.updatedAt),
  };
}

function dirtyOf(row: Selectable<AdminiumCalendarDirtyTable>): CalendarDirtyRow {
  return { id: row.id, connectionId: row.connectionId, tableName: row.tableName, rowKey: row.rowKey, markedAt: Number(row.markedAt), mark: Number(row.mark) };
}

function clashOf(row: Selectable<AdminiumCalendarClashesTable>): CalendarClashRow {
  return {
    id: row.id,
    connectionId: row.connectionId,
    tableName: row.tableName,
    rowKey: row.rowKey,
    overlapStart: Number(row.overlapStart),
    overlapEnd: Number(row.overlapEnd),
    toldAt: num(row.toldAt),
    keptAt: num(row.keptAt),
    keptBy: row.keptBy,
  };
}

export type CalendarStatePatch = Partial<Omit<CalendarSyncState, 'accountId' | 'connectionId' | 'updatedAt'>>;

export function calendarSyncRepo(meta: MetaDb, crypto: Pick<CredentialCrypto, 'encrypt' | 'decrypt'>) {
  const { db } = meta;
  function channelOf(row: Selectable<AdminiumCalendarChannelsTable>): CalendarChannel {
    return {
      id: row.id,
      accountId: row.accountId,
      provider: row.provider,
      target: row.target === 'busy' ? 'busy' : 'own',
      state: row.state === 'creating' ? 'creating' : 'live',
      secret: crypto.decrypt(row.secretSealed),
      remoteChannelId: row.remoteChannelId,
      resourceId: row.resourceId,
      address: row.address,
      expiresAt: Number(row.expiresAt),
      lastNoticeAt: num(row.lastNoticeAt),
      createdAt: Number(row.createdAt),
    };
  }

  return {
    // ─── One account ────────────────────────────────────────────────────────

    /** The account's sync row, made if it is not there. */
    async ensure(input: { accountId: string; connectionId: string; bookingTable: string; detail: CalendarDetail; nextPollAt: number }, at: number): Promise<CalendarSyncState> {
      const found = await db.selectFrom('adminium_calendar_sync').selectAll().where('accountId', '=', input.accountId).executeTakeFirst();
      if (found !== undefined) return stateOf(found);
      try {
        await db
          .insertInto('adminium_calendar_sync')
          .values({
            accountId: input.accountId,
            connectionId: input.connectionId,
            bookingTable: input.bookingTable,
            calendarId: null,
            calendarName: null,
            readCalendars: null,
            countAllDay: writeBool(meta, false),
            detail: input.detail,
            ownCursor: null,
            readStartedAt: null,
            lastSyncedAt: null,
            nextPollAt: input.nextPollAt,
            noticeAt: null,
            connectingSince: null,
            holdUntil: null,
            staleDroppedAt: null,
            calendarLostAt: null,
            calendarLostCount: 0,
            paused: null,
            calendarLeaseUntil: null,
            busyHash: null,
            silentToldAt: null,
            lastError: null,
            updatedAt: at,
          })
          .execute();
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
      return stateOf(await db.selectFrom('adminium_calendar_sync').selectAll().where('accountId', '=', input.accountId).executeTakeFirstOrThrow());
    },

    async state(accountId: string): Promise<CalendarSyncState | null> {
      const row = await db.selectFrom('adminium_calendar_sync').selectAll().where('accountId', '=', accountId).executeTakeFirst();
      return row === undefined ? null : stateOf(row);
    },

    async states(accountIds: readonly string[]): Promise<CalendarSyncState[]> {
      if (accountIds.length === 0) return [];
      return (await db.selectFrom('adminium_calendar_sync').selectAll().where('accountId', 'in', [...accountIds]).execute()).map(stateOf);
    },

    async patch(accountId: string, change: CalendarStatePatch, at: number): Promise<void> {
      const { readCalendars, countAllDay, ...rest } = change;
      const set: Updateable<AdminiumCalendarSyncTable> = { ...rest, updatedAt: at };
      if (countAllDay !== undefined) set.countAllDay = writeBool(meta, countAllDay);
      if (readCalendars !== undefined) set.readCalendars = readCalendars === null ? null : packJson(readCalendars);
      await db.updateTable('adminium_calendar_sync').set(set).where('accountId', '=', accountId).execute();
    },

    /** Accounts due a read, the longest waiting first. */
    async due(at: number, limit: number): Promise<CalendarSyncState[]> {
      return (await db.selectFrom('adminium_calendar_sync').selectAll().where('nextPollAt', '<=', at).orderBy('nextPollAt').limit(limit).execute()).map(stateOf);
    },

    /** Every account's state, a page at a time, in id order. */
    async page(after: string | null, limit: number): Promise<CalendarSyncState[]> {
      let query = db.selectFrom('adminium_calendar_sync').selectAll().orderBy('accountId').limit(limit);
      if (after !== null) query = query.where('accountId', '>', after);
      return (await query.execute()).map(stateOf);
    },

    /** First reads that have held a person's slots since before a moment. */
    async connectingBefore(before: number, limit: number): Promise<CalendarSyncState[]> {
      return (await db.selectFrom('adminium_calendar_sync').selectAll().where('connectingSince', '<=', before).orderBy('connectingSince').limit(limit).execute()).map(stateOf);
    },

    /** Ends a first read's hold, only if it is still the one that was read. */
    async clearConnecting(accountId: string, since: number, at: number): Promise<boolean> {
      const res = await db.updateTable('adminium_calendar_sync').set({ connectingSince: null, updatedAt: at }).where('accountId', '=', accountId).where('connectingSince', '=', since).executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** The right to make or remake this account's calendar. One statement, so one job gets it. */
    async takeCalendarLease(accountId: string, at: number, until: number): Promise<boolean> {
      const res = await db
        .updateTable('adminium_calendar_sync')
        .set({ calendarLeaseUntil: until })
        .where('accountId', '=', accountId)
        .where((eb) => eb.or([eb('calendarLeaseUntil', 'is', null), eb('calendarLeaseUntil', '<=', at)]))
        .executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    /** Lets it go, unless a later holder took it after this one's time ran out. */
    async releaseCalendarLease(accountId: string, until: number): Promise<void> {
      await db.updateTable('adminium_calendar_sync').set({ calendarLeaseUntil: null }).where('accountId', '=', accountId).where('calendarLeaseUntil', '=', until).execute();
    },

    /** A push notice: read this account by `at`, unless it is due sooner already. */
    async pullForward(accountId: string, by: number, noticeAt: number): Promise<void> {
      await db.updateTable('adminium_calendar_sync').set({ noticeAt, updatedAt: noticeAt }).where('accountId', '=', accountId).execute();
      await db.updateTable('adminium_calendar_sync').set({ nextPollAt: by }).where('accountId', '=', accountId).where('nextPollAt', '>', by).execute();
    },

    // ─── The event mirror ───────────────────────────────────────────────────

    async eventsOfRow(ref: CalendarRowRef): Promise<CalendarEventRow[]> {
      const rows = await db
        .selectFrom('adminium_calendar_events')
        .selectAll()
        .where('connectionId', '=', ref.connectionId)
        .where('tableName', '=', ref.tableName)
        .where('rowKey', '=', ref.rowKey)
        .execute();
      return rows.map(eventOf);
    },

    async eventsOfAccount(accountId: string, after: string | null, limit: number): Promise<CalendarEventRow[]> {
      let query = db.selectFrom('adminium_calendar_events').selectAll().where('accountId', '=', accountId).orderBy('id').limit(limit);
      if (after !== null) query = query.where('id', '>', after);
      return (await query.execute()).map(eventOf);
    },

    /** The mirror row for an account and a booking, made if it is not there. */
    async ensureEvent(accountId: string, ref: CalendarRowRef, at: number): Promise<CalendarEventRow> {
      const find = () =>
        db
          .selectFrom('adminium_calendar_events')
          .selectAll()
          .where('accountId', '=', accountId)
          .where('connectionId', '=', ref.connectionId)
          .where('tableName', '=', ref.tableName)
          .where('rowKey', '=', ref.rowKey)
          .executeTakeFirst();
      const found = await find();
      if (found !== undefined) return eventOf(found);
      try {
        await db
          .insertInto('adminium_calendar_events')
          .values({
            id: newId('cev'),
            accountId,
            connectionId: ref.connectionId,
            tableName: ref.tableName,
            rowKey: ref.rowKey,
            generation: 1,
            remoteId: null,
            etag: null,
            appliedHash: null,
            startAt: null,
            endAt: null,
            detail: null,
            tries: 0,
            lastError: null,
            updatedAt: at,
          })
          .execute();
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
      const row = await find();
      if (row === undefined) throw new Error('The calendar event row could not be read back.');
      return eventOf(row);
    },

    async patchEvent(id: string, change: Partial<Pick<CalendarEventRow, 'generation' | 'remoteId' | 'etag' | 'appliedHash' | 'startAt' | 'endAt' | 'detail' | 'tries' | 'lastError'>>, at: number): Promise<void> {
      await db.updateTable('adminium_calendar_events').set({ ...change, updatedAt: at }).where('id', '=', id).execute();
    },

    async removeEvent(id: string): Promise<void> {
      await db.deleteFrom('adminium_calendar_events').where('id', '=', id).execute();
    },

    /** Mirror rows of a table still naming a person, over before `before`, a page at a time: the morning-after pass. */
    async namedBefore(connectionId: string, tableName: string, before: number, after: string | null, limit: number): Promise<CalendarEventRow[]> {
      let query = db
        .selectFrom('adminium_calendar_events')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .where('tableName', '=', tableName)
        .where('detail', '=', 'name')
        .where('endAt', '<', before)
        .orderBy('id')
        .limit(limit);
      if (after !== null) query = query.where('id', '>', after);
      return (await query.execute()).map(eventOf);
    },

    /** An account's events that end on or after a moment. */
    async eventsFrom(accountId: string, from: number, limit: number): Promise<CalendarEventRow[]> {
      return (await db.selectFrom('adminium_calendar_events').selectAll().where('accountId', '=', accountId).where('endAt', '>=', from).limit(limit).execute()).map(eventOf);
    },

    /** The rows of a table with an event on or after a moment. */
    async rowsFrom(connectionId: string, tableName: string, from: number, after: string | null, limit: number): Promise<CalendarEventRow[]> {
      let query = db
        .selectFrom('adminium_calendar_events')
        .selectAll()
        .where('connectionId', '=', connectionId)
        .where('tableName', '=', tableName)
        .where('endAt', '>=', from)
        .orderBy('id')
        .limit(limit);
      if (after !== null) query = query.where('id', '>', after);
      return (await query.execute()).map(eventOf);
    },

    // ─── Rows waiting to go out ─────────────────────────────────────────────

    /** Marks a row. Marking one already marked moves its mark on, so the job running now does not clear it. */
    async markDirty(ref: CalendarRowRef, at: number): Promise<void> {
      const bump = () =>
        db
          .updateTable('adminium_calendar_dirty')
          .set((eb) => ({ markedAt: at, mark: eb('mark', '+', 1) }))
          .where('connectionId', '=', ref.connectionId)
          .where('tableName', '=', ref.tableName)
          .where('rowKey', '=', ref.rowKey)
          .executeTakeFirst();
      if (affected((await bump()).numUpdatedRows) > 0) return;
      try {
        await db
          .insertInto('adminium_calendar_dirty')
          .values({ id: newId('cdr'), connectionId: ref.connectionId, tableName: ref.tableName, rowKey: ref.rowKey, markedAt: at, mark: 1 })
          .execute();
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        await bump();
      }
    },

    async dirty(ref: CalendarRowRef): Promise<CalendarDirtyRow | null> {
      const row = await db
        .selectFrom('adminium_calendar_dirty')
        .selectAll()
        .where('connectionId', '=', ref.connectionId)
        .where('tableName', '=', ref.tableName)
        .where('rowKey', '=', ref.rowKey)
        .executeTakeFirst();
      return row === undefined ? null : dirtyOf(row);
    },

    /** Clears a row, only if nothing marked it since `mark` was read. */
    async clearDirty(id: string, mark: number): Promise<boolean> {
      const res = await db.deleteFrom('adminium_calendar_dirty').where('id', '=', id).where('mark', '=', mark).executeTakeFirst();
      return affected(res.numDeletedRows) === 1;
    },

    /** Sends a row to the back of the line, leaving its mark: one that keeps failing starves no other. */
    async touchDirty(id: string, at: number): Promise<void> {
      await db.updateTable('adminium_calendar_dirty').set({ markedAt: at }).where('id', '=', id).execute();
    },

    /** Rows marked before a moment, the oldest first. */
    async dirtyBefore(before: number, limit: number): Promise<CalendarDirtyRow[]> {
      return (await db.selectFrom('adminium_calendar_dirty').selectAll().where('markedAt', '<=', before).orderBy('markedAt').limit(limit).execute()).map(dirtyOf);
    },

    // ─── Push channels ──────────────────────────────────────────────────────

    async putChannel(input: Omit<CalendarChannel, 'lastNoticeAt' | 'createdAt'>, at: number): Promise<void> {
      await db
        .insertInto('adminium_calendar_channels')
        .values({
          id: input.id,
          accountId: input.accountId,
          provider: input.provider,
          target: input.target,
          state: input.state,
          secretSealed: crypto.encrypt(input.secret),
          remoteChannelId: input.remoteChannelId,
          resourceId: input.resourceId,
          address: input.address,
          expiresAt: input.expiresAt,
          lastNoticeAt: null,
          createdAt: at,
        })
        .execute();
    },

    /** One indexed read: what an unknown channel costs. */
    async channel(id: string): Promise<CalendarChannel | null> {
      const row = await db.selectFrom('adminium_calendar_channels').selectAll().where('id', '=', id).executeTakeFirst();
      return row === undefined ? null : channelOf(row);
    },

    async channelsOf(accountId: string): Promise<CalendarChannel[]> {
      return (await db.selectFrom('adminium_calendar_channels').selectAll().where('accountId', '=', accountId).orderBy('createdAt').execute()).map(channelOf);
    },

    async channelsEndingBefore(before: number, limit: number): Promise<CalendarChannel[]> {
      return (await db.selectFrom('adminium_calendar_channels').selectAll().where('expiresAt', '<', before).orderBy('expiresAt').limit(limit).execute()).map(channelOf);
    },

    async patchChannel(id: string, change: Partial<Pick<CalendarChannel, 'state' | 'remoteChannelId' | 'resourceId' | 'expiresAt' | 'lastNoticeAt'>>): Promise<void> {
      await db.updateTable('adminium_calendar_channels').set(change).where('id', '=', id).execute();
    },

    async removeChannel(id: string): Promise<void> {
      await db.deleteFrom('adminium_calendar_channels').where('id', '=', id).execute();
    },

    // ─── Clashes told or kept ───────────────────────────────────────────────

    async clashesOfTable(connectionId: string, tableName: string): Promise<CalendarClashRow[]> {
      return (await db.selectFrom('adminium_calendar_clashes').selectAll().where('connectionId', '=', connectionId).where('tableName', '=', tableName).execute()).map(clashOf);
    },

    /** The row of one clash, made if it is not there. */
    async ensureClash(ref: CalendarRowRef, overlapStart: number, overlapEnd: number): Promise<CalendarClashRow> {
      const find = () =>
        db
          .selectFrom('adminium_calendar_clashes')
          .selectAll()
          .where('connectionId', '=', ref.connectionId)
          .where('tableName', '=', ref.tableName)
          .where('rowKey', '=', ref.rowKey)
          .where('overlapStart', '=', overlapStart)
          .where('overlapEnd', '=', overlapEnd)
          .executeTakeFirst();
      const found = await find();
      if (found !== undefined) return clashOf(found);
      try {
        await db
          .insertInto('adminium_calendar_clashes')
          .values({ id: newId('ccl'), connectionId: ref.connectionId, tableName: ref.tableName, rowKey: ref.rowKey, overlapStart, overlapEnd, toldAt: null, keptAt: null, keptBy: null })
          .execute();
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
      const row = await find();
      if (row === undefined) throw new Error('The clash could not be read back.');
      return clashOf(row);
    },

    /** Claims the telling of a clash. True for the one caller that may tell it. */
    async claimTold(id: string, at: number): Promise<boolean> {
      const res = await db.updateTable('adminium_calendar_clashes').set({ toldAt: at }).where('id', '=', id).where('toldAt', 'is', null).executeTakeFirst();
      return affected(res.numUpdatedRows) === 1;
    },

    async keepClash(id: string, by: string, at: number): Promise<void> {
      await db.updateTable('adminium_calendar_clashes').set({ keptAt: at, keptBy: by }).where('id', '=', id).execute();
    },

    async removeClashes(ids: readonly string[]): Promise<void> {
      if (ids.length === 0) return;
      await db.deleteFrom('adminium_calendar_clashes').where('id', 'in', [...ids]).execute();
    },
  };
}

export type CalendarSyncRepo = ReturnType<typeof calendarSyncRepo>;
