// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CALENDAR SYNC. Bookings go out to each person's connected calendar, and
 * the times they are busy come back into a table the booking guard reads.
 *
 * ─── OUT (level-triggered) ──────────────────────────────────────────────────
 * A write marks its row DIRTY and queues one job. The job reads the row as it
 * is now, works out the one event it should have (or none), compares that with
 * the MIRROR, and calls the provider until they agree. So a booking moved while
 * its first write is on the wire ends right, a booking moved to another person
 * leaves no event behind, and a lost job is found again by the sweep. An event's
 * key is minted here, from the row and a generation, so a retry after a crash
 * finds the event it made rather than making a second.
 *
 * ─── IN (a whole window, swapped in one step) ───────────────────────────────
 * Each pass reads `[start of today, last bookable day + 2)` whole and swaps it
 * in (`replaceBusyRows`). A read that failed keeps the rows it had and does not
 * move "last synced". While someone must reconnect, what was last known keeps
 * blocking for seven days, shown with its date; then it goes, and the desk is
 * told.
 *
 * ─── THE FIRST READ ─────────────────────────────────────────────────────────
 * Until it ends, or two minutes pass, one busy time covers the whole window, so
 * a guest cannot book over a diary nobody has read yet.
 *
 * ─── PUSH ───────────────────────────────────────────────────────────────────
 * A notice only says "read soon": one deduped job per account, never sooner
 * than 15 seconds after the last read, so a replayed notice costs nothing.
 *
 * ─── CLASHES ────────────────────────────────────────────────────────────────
 * Worked out from the bookings and busy rows whenever asked, keyed on the
 * overlap clipped to the booking. "Keep it" is stored on that key: it stands
 * until the overlap itself changes.
 *
 * ─── NAMES ──────────────────────────────────────────────────────────────────
 * A customer's name goes out as first name and initial at most. The morning
 * after the visit the title becomes the service alone, and when a person is
 * forgotten or erased, every event of theirs is written again without a name.
 * No store here holds a title.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';

import {
  isCalendarError,
  type CalendarError,
  type CalendarBusyInterval,
  type CalendarProvider,
  type DemoCalendarBackend,
  type HookDelivery,
  DEMO_CALENDAR_SUBJECT_PREFIX,
} from '@adminium/add-on-contracts';
import {
  calendarSyncRepo,
  manifestsRepo,
  newId,
  type CalendarChannel,
  type CalendarEventRow,
  type CalendarRowRef,
  type CalendarSyncState,
  type ConnectedAccount,
  type CredentialCrypto,
  type MetaDb,
} from '@adminium/meta';
import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';

import type { AddOnRuntimeState } from '../add-ons/runtime.js';
import { CONNECTED_ACCOUNT_END_JOB } from '../connected-accounts/jobs.js';
import { addressDigest } from '../reviews/link.js';
import type { ConnectedAccounts } from '../connected-accounts/service.js';
import type { BookingSyncRule, TableBookingRule } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { RecordWriteEvent } from '../crud/after-record-write.js';
import { BUSY_ROWS_MAX, BUSY_WINDOW_DAYS, dropBusyRows, keptBusySource, replaceBusyRows } from '../crud/booking-busy.js';
import { addDays, busyIn, keyOf, lastBookableDay } from '../crud/booking-guard.js';
import { slotInstant, type GuardTarget } from '../crud/capacity-guard.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { settingsColumn } from '../crud/settings-row.js';
import { fetchByPk } from '../crud/records.js';
import { venueClock, wallTimeToInstant } from '../crud/venue-time.js';
import { pkOfRowKey, rowKeyOf } from '../payments/payables.js';
import type { Reachability } from '../payments/reachability.js';
import { tellCalendar, type CalendarNoticeDeps } from './notices.js';
import { calendarProviderFor, isDemoAccount, providerKeyOf, readHookFor, type CalendarProviderDeps } from './provider.js';
import { busyHash, countedBusy, deriveClashes, detailWithin, eventHash, eventKey, eventTitle, lastReadDay, nextPollDelay, withoutOwnEvents, type ClashBooking, type DerivedClash, type Detail, type Span, type WantedEvent } from './rules.js';

export const CALENDAR_SYNC_ROW_JOB = 'calendar.sync-row';
export const CALENDAR_POLL_JOB = 'calendar.poll';

/** How long the first read may hold a person's slots closed. */
export const FIRST_READ_MS = 2 * 60_000;
/** How long a person's last known busy times keep blocking while they must reconnect. */
export const STALE_BUSY_MS = 7 * 86_400_000;
/** The closest two reads of one account may be. */
export const READ_FLOOR_MS = 15_000;
/** A poll that could not reach the service, or a provider that is not loaded. */
const UNAVAILABLE_RETRY_MS = 30 * 60_000;
/** A read that failed for a reason worth trying again soon. */
const FAILED_RETRY_MS = 5 * 60_000;
/** How soon a person who must reconnect is looked at again. */
const RECONNECT_LOOK_MS = 60 * 60_000;
/** A second deleted calendar within this long stops the sync for that person. */
const CALENDAR_LOST_WINDOW_MS = 7 * 86_400_000;
/** No notice for this long, while polls keep finding changes: push has gone quiet. */
const PUSH_SILENT_MS = 86_400_000;
/** A channel ending within this long is renewed. */
const CHANNEL_RENEW_MS = 2 * 86_400_000;
/** After a call the service could not answer, how long that account's other calls wait, so an outage cannot fill the queue. */
const UNAVAILABLE_HOLD_MS = 60_000;
/** How long one job may hold the right to make or remake a calendar: past the longest call it makes. */
const CALENDAR_LEASE_MS = 90_000;
const CALENDAR_LEASE_WAIT_MS = 250;
const CALENDAR_LEASE_TRIES = 12;
/** Behind mail, payments and the rest: a calendar can wait a moment. */
const CALENDAR_JOB_PRIORITY = -1;
/** How many pages of named events one morning pass reads. */
const NAMED_PAGES = 20;
/** How many of a person's coming bookings go out as they connect. */
const BACKFILL_AT_ONCE = 25;
/** How many rows one sweep sends out. */
const SWEEP_ROWS = 200;
/** How many accounts one planner tick reads. */
const PLAN_ACCOUNTS = 100;
/** Rows read for a backfill, a forget or a re-render. */
const ROW_PAGE = 500;
const DAY_MS = 86_400_000;

export interface CalendarSource {
  view: SnapshotView;
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  timezone: string;
}

export interface CalendarSyncDeps {
  meta: MetaDb;
  crypto: Pick<CredentialCrypto, 'encrypt' | 'decrypt'>;
  accounts: ConnectedAccounts;
  /** The app's database and its snapshot; null when there is none to read. */
  source(connectionId: string): Promise<CalendarSource | null>;
  runtime: () => AddOnRuntimeState | null;
  demo: DemoCalendarBackend | null;
  enqueue(input: { kind: string; payload: Record<string, unknown>; dedupeKey: string; maxAttempts: number; runAt?: number; priority?: number }): Promise<unknown>;
  publicOrigin(): Promise<string | null>;
  reach(): Promise<Reachability>;
  /** Every database an app is installed on. */
  connectionIds(): Promise<string[]>;
  notices?: Omit<CalendarNoticeDeps, 'meta' | 'secret'> & { secret?: string };
  now?: () => number;
  random?: () => number;
  log?: (message: string, fields: Record<string, unknown>) => void;
}

/** A booking table with a sync rule, and everything its work needs. */
export interface BoundTable {
  source: CalendarSource;
  table: ResolvedTable;
  rule: TableBookingRule & { sync: BookingSyncRule };
  busy: ResolvedTable;
  resource: ResolvedTable;
  /** What the booking's foreign key points at. */
  resourceColumn: string;
  target: GuardTarget;
}

interface WantedRow {
  account: ConnectedAccount;
  state: CalendarSyncState | null;
  event: WantedEvent;
  past: boolean;
}

export interface RowClash extends DerivedClash {
  kept: boolean;
}

function sameSecret(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

const syncedTables = (view: SnapshotView): string[] => view.model.tables.filter((table) => table.booking?.sync !== undefined).map((table) => table.id);

/** An account the sync may call. */
const usable = (account: ConnectedAccount): boolean => account.state === 'connected' || account.state === 'connecting' || account.state === 'partial';

/** What a service says of a calendar that is gone, or closed to this person. */
const CALENDAR_LOST: ReadonlySet<string> = new Set(['CALENDAR_MISSING', 'PERMISSION_MISSING']);

export function createCalendarSync(deps: CalendarSyncDeps) {
  const { meta, accounts } = deps;
  const repo = calendarSyncRepo(meta, deps.crypto);
  const accountsRepo = accounts.repo;
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const providerDeps: CalendarProviderDeps = { accounts, runtime: deps.runtime, demo: deps.demo, ...(deps.log === undefined ? {} : { log: deps.log }) };
  const noticeDeps: CalendarNoticeDeps = { meta, ...deps.notices, ...(deps.now === undefined ? {} : { now: deps.now }) };

  // ─── What a table and an account are ────────────────────────────────────

  function bindIn(source: CalendarSource, connectionId: string, tableId: string): BoundTable | null {
    if (!source.view.model.tables.some((one) => one.id === tableId)) return null;
    const table = source.view.table(tableId);
    const rule = table.table?.booking;
    if (rule?.sync === undefined) return null;
    const kept = keptBusySource(rule);
    if (kept === undefined || !source.view.model.tables.some((one) => one.id === kept.table)) return null;
    const link = table.table?.columns.find((column) => column.name === rule.resource)?.references;
    if (link === undefined || link === null || !source.view.model.tables.some((one) => one.id === link.tableId)) return null;
    const target: GuardTarget = { connectionId, table, db: source.db, dialect: source.dialect, timezone: source.timezone };
    return { source, table, rule: rule as BoundTable['rule'], busy: source.view.table(kept.table), resource: source.view.table(link.tableId), resourceColumn: link.column, target };
  }

  async function bind(connectionId: string, tableId: string): Promise<BoundTable | null> {
    const source = await deps.source(connectionId);
    return source === null ? null : bindIn(source, connectionId, tableId);
  }

  /** The booking table an account's person is the resource of. */
  async function bindAccount(account: Pick<ConnectedAccount, 'connectionId' | 'tableName'>): Promise<BoundTable | null> {
    const source = await deps.source(account.connectionId);
    if (source === null) return null;
    for (const id of syncedTables(source.view)) {
      const bound = bindIn(source, account.connectionId, id);
      if (bound?.resource.id === account.tableName) return bound;
    }
    return null;
  }

  /** The value a booking's foreign key holds for an account's row. */
  async function resourceValue(bound: BoundTable, rowKey: string): Promise<unknown> {
    const pk = pkOfRowKey(bound.resource, rowKey);
    if (pk === null) return null;
    if (bound.resource.primaryKey.length === 1 && bound.resource.primaryKey[0] === bound.resourceColumn) return pk[bound.resourceColumn];
    const row = await fetchByPk(bound.source.db, bound.resource, pk);
    return row?.[bound.resourceColumn] ?? null;
  }

  /** The account of the person a booking names. */
  async function accountOfResource(bound: BoundTable, value: unknown): Promise<ConnectedAccount | null> {
    if (value === null || value === undefined || value === '') return null;
    let rowKey = String(value);
    if (!(bound.resource.primaryKey.length === 1 && bound.resource.primaryKey[0] === bound.resourceColumn)) {
      const db = bound.source.db;
      const row = (await db.selectFrom(bound.resource.id).selectAll().where((eb) => eb(db.dynamic.ref(bound.resourceColumn), '=', value as never)).executeTakeFirst()) as Row | undefined;
      if (row === undefined) return null;
      rowKey = rowKeyOf(bound.resource, row);
    }
    const found = await accountsRepo.forTarget({ connectionId: bound.target.connectionId, tableName: bound.resource.id, rowKey });
    return found[0] ?? null;
  }

  /** A column of the row, or `fk.column` one link away. */
  async function readPath(bound: BoundTable, row: Row, path: string | undefined): Promise<string | null> {
    if (path === undefined) return null;
    const [first, second] = path.split('.') as [string, string | undefined];
    const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
    if (second === undefined) return text(row[first]);
    const value = row[first];
    if (value === null || value === undefined) return null;
    const link = bound.table.table?.columns.find((column) => column.name === first)?.references;
    if (link === undefined || link === null) return null;
    const db = bound.source.db;
    const held = (await db.selectFrom(link.tableId).selectAll().where((eb) => eb(db.dynamic.ref(link.column), '=', value as never)).executeTakeFirst()) as Row | undefined;
    return text(held?.[second]);
  }

  async function calendarNameOf(bound: BoundTable): Promise<string> {
    const name = bound.rule.sync.calendarName;
    if (typeof name === 'string') return name;
    const db = bound.source.db;
    // The settings row as every reader takes it: the first by key.
    const held = await settingsColumn(db, name.table, name.column);
    return typeof held === 'string' && held.trim() !== '' ? held.trim().slice(0, 100) : 'Bookings';
  }

  /** The start of today on the venue's clock. */
  function startOfToday(bound: Pick<BoundTable, 'source'>): number {
    const day = venueClock(new Date(now()), bound.source.timezone).day;
    return wallTimeToInstant(`${day} 00:00`, bound.source.timezone)?.getTime() ?? now() - DAY_MS;
  }

  /** The event this row should have, if any. */
  async function wantedFor(bound: BoundTable, row: Row): Promise<WantedRow | null> {
    const { rule } = bound;
    if (!rule.sync.when.values.includes(String(row[rule.sync.when.column]))) return null;
    const start = slotInstant(row[rule.start])?.getTime();
    const minutes = Number(row[rule.minutes] ?? 0);
    if (start === undefined || !Number.isFinite(minutes) || minutes <= 0) return null;
    const account = await accountOfResource(bound, row[rule.resource]);
    if (account === null) return null;
    const state = await repo.state(account.id);
    const end = start + minutes * 60_000;
    const past = end < startOfToday(bound);
    const max: Detail = rule.sync.detail?.max ?? 'first-name+initial';
    const chosen: Detail = state?.detail ?? rule.sync.detail?.default ?? 'first-name+initial';
    const detail: Detail = past ? 'none' : detailWithin(chosen, max);
    const service = await readPath(bound, row, rule.sync.title.service);
    const person = detail === 'none' ? null : await readPath(bound, row, rule.sync.title.person);
    const { title, named } = eventTitle(service, person, detail);
    return { account, state, event: { start, end, zone: bound.source.timezone, title, named }, past };
  }

  const remember = (state: CalendarSyncState | null, change: Parameters<typeof repo.patch>[1]) => (state === null ? Promise.resolve() : repo.patch(state.accountId, change, now()));

  /** A service that is out, or asked for room: this account's calls wait, and no other's do. */
  async function holdFor(state: CalendarSyncState | null, ms: number | undefined, word: 'RATE_LIMITED' | 'UNAVAILABLE' = 'RATE_LIMITED'): Promise<void> {
    const until = now() + (ms ?? FAILED_RETRY_MS);
    if (state !== null) state.holdUntil = until;
    await remember(state, { holdUntil: until, lastError: word });
  }

  // ─── The calendar Adminium keeps at the provider ────────────────────────

  /**
   * One job at a time makes or remakes an account's calendar, so two workers
   * cannot make two, or reset events the other just wrote. A job that finds it
   * taken waits a few seconds, because the other is usually about to finish.
   * Past that it leaves its row marked, and the sweep brings it back.
   */
  async function withCalendarLease<T>(accountId: string, run: () => Promise<T | null>): Promise<T | null> {
    for (let tries = 0; ; tries += 1) {
      const until = now() + CALENDAR_LEASE_MS;
      if (await repo.takeCalendarLease(accountId, now(), until)) {
        try {
          return await run();
        } finally {
          await repo.releaseCalendarLease(accountId, until).catch(() => undefined);
        }
      }
      if (tries >= CALENDAR_LEASE_TRIES) return null;
      await new Promise((resolve) => setTimeout(resolve, CALENDAR_LEASE_WAIT_MS));
    }
  }

  async function makeCalendar(provider: CalendarProvider, state: CalendarSyncState, name: string): Promise<string | null> {
    const made = await provider.ensureCalendar({ name, knownId: state.calendarId });
    if (isCalendarError(made)) {
      if (made.calendarError === 'RATE_LIMITED') await holdFor(state, made.retryAfterMs);
      else await remember(state, { lastError: made.calendarError });
      return null;
    }
    await repo.patch(state.accountId, { calendarId: made.calendarId, calendarName: name, lastError: null }, now());
    state.calendarId = made.calendarId;
    state.calendarName = name;
    return made.calendarId;
  }

  async function ensureOwnCalendar(bound: BoundTable, provider: CalendarProvider, state: CalendarSyncState): Promise<string | null> {
    const name = await calendarNameOf(bound);
    if (state.calendarId !== null && state.calendarName === name) return state.calendarId;
    return withCalendarLease(state.accountId, async () => {
      const fresh = await repo.state(state.accountId);
      if (fresh === null) return null;
      state.calendarId = fresh.calendarId;
      state.calendarName = fresh.calendarName;
      if (state.calendarId !== null && state.calendarName === name) return state.calendarId;
      return makeCalendar(provider, state, name);
    });
  }

  /** Every event of the account now points at nothing. Returns the coming ones, to write again. */
  async function resetMirrors(bound: BoundTable, account: ConnectedAccount, at: number): Promise<CalendarRowRef[]> {
    const coming: CalendarRowRef[] = [];
    let after: string | null = null;
    for (;;) {
      const page: CalendarEventRow[] = await repo.eventsOfAccount(account.id, after, ROW_PAGE);
      if (page.length === 0) break;
      for (const mirror of page) {
        after = mirror.id;
        await repo.patchEvent(mirror.id, { remoteId: null, etag: null, appliedHash: null, detail: null, generation: mirror.generation + 1 }, at);
        if (mirror.endAt !== null && mirror.endAt >= startOfToday(bound)) coming.push({ connectionId: mirror.connectionId, tableName: mirror.tableName, rowKey: mirror.rowKey });
      }
      if (page.length < ROW_PAGE) break;
    }
    return coming;
  }

  /**
   * The person deleted the calendar Adminium made. Made again once and said so.
   * Deleted again within a week: they mean it, so the sync stops writing for
   * them until they turn it back on. `failedId` is the calendar the caller
   * found gone: if another job has already moved on from it, this one follows.
   */
  async function calendarLost(bound: BoundTable, account: ConnectedAccount, provider: CalendarProvider, state: CalendarSyncState, failedId: string): Promise<string | null> {
    return withCalendarLease(account.id, async () => {
      const fresh = await repo.state(account.id);
      if (fresh === null) return null;
      if (fresh.calendarId !== failedId) {
        state.calendarId = fresh.calendarId;
        state.calendarName = fresh.calendarName;
        state.paused = fresh.paused;
        return fresh.calendarId;
      }
      const at = now();
      const recent = fresh.calendarLostAt !== null && at - fresh.calendarLostAt < CALENDAR_LOST_WINDOW_MS;
      const count = recent ? fresh.calendarLostCount + 1 : 1;
      const pausing = count >= 2;
      // No job can write to it from here, and only then are the events reset: nothing written to the new one is reset with them.
      await repo.patch(account.id, { calendarId: null, ownCursor: null, calendarLostAt: at, calendarLostCount: count, ...(pausing ? { paused: 'calendar-removed', lastError: 'CALENDAR_MISSING' } : {}) }, at);
      state.calendarId = null;
      state.ownCursor = null;
      state.calendarLostAt = at;
      state.calendarLostCount = count;
      if (pausing) state.paused = 'calendar-removed';
      const coming = await resetMirrors(bound, account, at);
      const person = await personName(account);
      if (pausing) {
        await tellCalendar(noticeDeps, await appKeyOf(account), 'calendar.removed', { person, calendar: fresh.calendarName ?? '' });
        return null;
      }
      const calendarId = await makeCalendar(provider, state, await calendarNameOf(bound));
      for (const ref of coming) await markAndQueue(ref);
      if (calendarId === null) return null;
      await tellCalendar(noticeDeps, await appKeyOf(account), 'calendar.remade', { person, calendar: state.calendarName ?? '' });
      return calendarId;
    });
  }

  async function personName(account: ConnectedAccount): Promise<string> {
    const table = await accounts.tableOf(account.connectionId, account.tableName).catch(() => null);
    const row = await accounts.readRow(account).catch(() => undefined);
    return (table === null ? null : accounts.personOf(row, table.rule).name) ?? account.address ?? '';
  }

  async function appKeyOf(account: ConnectedAccount): Promise<string | null> {
    return (await accounts.tableOf(account.connectionId, account.tableName).catch(() => null))?.appKey ?? null;
  }

  // ─── OUT ────────────────────────────────────────────────────────────────

  /** Writes one event. True when the mirror and the provider now agree. */
  async function writeEvent(bound: BoundTable, ref: CalendarRowRef, wanted: WantedRow, existing: CalendarEventRow | undefined): Promise<boolean> {
    const { account, event } = wanted;
    // A person who must reconnect: nothing can be written. Connecting again queues their rows.
    if (!usable(account)) return true;
    if (existing === undefined && wanted.past) return true;
    const hash = eventHash(event);
    if (existing?.appliedHash === hash && existing.remoteId !== null) return true;
    const state = wanted.state ?? (await repo.ensure({ accountId: account.id, connectionId: account.connectionId, bookingTable: bound.table.id, detail: bound.rule.sync.detail?.default ?? 'first-name+initial', nextPollAt: now() }, now()));
    if (state.paused !== null) return true;
    if (state.holdUntil !== null && state.holdUntil > now()) return false;
    const lookup = await calendarProviderFor(providerDeps, account);
    if (!lookup.ok) return lookup.reason === 'reconnect';
    const { provider } = lookup;
    let calendarId = await ensureOwnCalendar(bound, provider, state);
    if (calendarId === null) return false;
    const mirror = existing ?? (await repo.ensureEvent(account.id, ref, now()));
    let { generation, remoteId } = mirror;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const key = eventKey({ ...ref, accountId: account.id, generation });
      const answer = await provider.upsertEvent({
        calendarId,
        key,
        remoteId,
        start: new Date(event.start).toISOString(),
        end: new Date(event.end).toISOString(),
        zone: event.zone,
        title: event.title,
      });
      if (!isCalendarError(answer)) {
        await repo.patchEvent(
          mirror.id,
          { generation, remoteId: answer.remoteId, etag: answer.etag, appliedHash: hash, startAt: event.start, endAt: event.end, detail: event.named ? 'name' : 'none', tries: 0, lastError: null },
          now(),
        );
        return true;
      }
      if (answer.calendarError === 'EVENT_MISSING' || answer.calendarError === 'CONFLICT') {
        // Deleted outside, or its key is spent: it is made again under the next one.
        generation += 1;
        remoteId = null;
        continue;
      }
      if (answer.calendarError === 'CALENDAR_MISSING') {
        const remade = await calendarLost(bound, account, provider, state, calendarId);
        if (remade === null) return state.paused !== null;
        calendarId = remade;
        generation += 1;
        remoteId = null;
        continue;
      }
      await repo.patchEvent(mirror.id, { tries: mirror.tries + 1, lastError: answer.calendarError }, now());
      if (answer.calendarError === 'RATE_LIMITED') await holdFor(state, answer.retryAfterMs);
      else if (answer.calendarError === 'UNAVAILABLE') await holdFor(state, UNAVAILABLE_HOLD_MS, 'UNAVAILABLE');
      return false;
    }
    return false;
  }

  /** Takes one event out. True when it is gone, or cannot be reached by anyone. */
  async function removeEvent(mirror: CalendarEventRow): Promise<boolean> {
    const account = await accountsRepo.find(mirror.accountId);
    if (account === null) {
      await repo.removeEvent(mirror.id);
      return true;
    }
    // It stays in the mirror, so connecting again can still take it out.
    if (!usable(account)) return true;
    if (mirror.remoteId === null) {
      await repo.removeEvent(mirror.id);
      return true;
    }
    const state = await repo.state(account.id);
    if (state?.calendarId === null || state === null) {
      await repo.removeEvent(mirror.id);
      return true;
    }
    if (state.holdUntil !== null && state.holdUntil > now()) return false;
    const lookup = await calendarProviderFor(providerDeps, account);
    if (!lookup.ok) return lookup.reason === 'reconnect';
    const answer = await lookup.provider.deleteEvent({ calendarId: state.calendarId, remoteId: mirror.remoteId });
    if (isCalendarError(answer) && answer.calendarError !== 'EVENT_MISSING' && answer.calendarError !== 'CALENDAR_MISSING') {
      await repo.patchEvent(mirror.id, { tries: mirror.tries + 1, lastError: answer.calendarError }, now());
      if (answer.calendarError === 'RATE_LIMITED') await holdFor(state, answer.retryAfterMs);
      else if (answer.calendarError === 'UNAVAILABLE') await holdFor(state, UNAVAILABLE_HOLD_MS, 'UNAVAILABLE');
      return false;
    }
    await repo.removeEvent(mirror.id);
    return true;
  }

  /** Makes one row's events right, as the row is now. True when nothing is left to do. */
  async function settle(bound: BoundTable, ref: CalendarRowRef, row: Row | undefined): Promise<{ clean: boolean; hash: string | null }> {
    const wanted = row === undefined ? null : await wantedFor(bound, row);
    const mirrors = await repo.eventsOfRow(ref);
    let clean = true;
    for (const mirror of mirrors) {
      if (wanted !== null && wanted.account.id === mirror.accountId) continue;
      clean = (await removeEvent(mirror)) && clean;
    }
    if (wanted === null) return { clean, hash: null };
    const written = await writeEvent(bound, ref, wanted, mirrors.find((mirror) => mirror.accountId === wanted.account.id));
    return { clean: clean && written, hash: `${wanted.account.id}:${eventHash(wanted.event)}` };
  }

  const readRow = async (bound: BoundTable, rowKey: string): Promise<Row | undefined> => {
    const pk = pkOfRowKey(bound.table, rowKey);
    return pk === null ? undefined : await fetchByPk(bound.source.db, bound.table, pk);
  };

  async function queueRow(ref: CalendarRowRef): Promise<void> {
    await deps.enqueue({ kind: CALENDAR_SYNC_ROW_JOB, payload: { ...ref }, dedupeKey: `calendar-row:${ref.connectionId}:${ref.tableName}:${ref.rowKey}`.slice(0, 255), maxAttempts: 1, priority: CALENDAR_JOB_PRIORITY });
  }

  async function markAndQueue(ref: CalendarRowRef): Promise<void> {
    await repo.markDirty(ref, now());
    await queueRow(ref);
  }

  /** The job: reads the row, and calls the provider until the two agree or it cannot. */
  async function syncRow(ref: CalendarRowRef): Promise<{ state: 'clean' | 'left' | 'no-rule' }> {
    const bound = await bind(ref.connectionId, ref.tableName);
    if (bound === null) {
      const dirty = await repo.dirty(ref);
      if (dirty !== null) await repo.clearDirty(dirty.id, dirty.mark);
      return { state: 'no-rule' };
    }
    // Marked again while it ran: a job queued now would fold into this one, so this one goes round again.
    for (let pass = 0; pass < 3; pass += 1) {
      const dirty = await repo.dirty(ref);
      let clean = false;
      let last: string | null | undefined;
      // The row may change while a call is out: read again until what was written is what it says.
      for (let round = 0; round < 3; round += 1) {
        const row = await readRow(bound, ref.rowKey);
        const settled = await settle(bound, ref, row);
        clean = settled.clean;
        if (!clean || settled.hash === last) break;
        last = settled.hash;
        const again = await readRow(bound, ref.rowKey);
        const stillWanted = again === undefined ? null : await wantedFor(bound, again);
        const hashNow = stillWanted === null ? null : `${stillWanted.account.id}:${eventHash(stillWanted.event)}`;
        if (hashNow === last) break;
        clean = false;
      }
      if (!clean) return { state: 'left' };
      if (dirty === null || (await repo.clearDirty(dirty.id, dirty.mark))) return { state: 'clean' };
    }
    return { state: 'left' };
  }

  /** The bookings that take a value in one of their title's columns, by key. */
  async function rowsLinkedTo(bound: BoundTable, linkColumn: string, value: unknown): Promise<string[]> {
    const db = bound.source.db;
    const rows = (await db.selectFrom(bound.table.id).selectAll().where((eb) => eb(db.dynamic.ref(linkColumn), '=', value as never)).limit(ROW_PAGE * 4).execute()) as Row[];
    return rows.map((row) => rowKeyOf(bound.table, row));
  }

  /** Marks every booking whose title reads a row of this table. */
  async function markByTitleLinks(bound: BoundTable, connectionId: string, tableId: string, row: Row): Promise<void> {
    for (const path of [bound.rule.sync.title.service, bound.rule.sync.title.person]) {
      if (path === undefined || !path.includes('.')) continue;
      const [first] = path.split('.') as [string];
      const link = bound.table.table?.columns.find((column) => column.name === first)?.references;
      if (link?.tableId !== tableId) continue;
      const value = row[link.column];
      if (value === null || value === undefined) continue;
      for (const rowKey of await rowsLinkedTo(bound, first, value)) await markAndQueue({ connectionId, tableName: bound.table.id, rowKey });
    }
  }

  // ─── IN ─────────────────────────────────────────────────────────────────

  /** The window one pass reads: `[start of today, last bookable day + 2)`. */
  async function readWindow(bound: BoundTable): Promise<{ from: number; to: number; fromDay: string; toDay: string }> {
    const zone = bound.source.timezone;
    const fromDay = venueClock(new Date(now()), zone).day;
    const lastDay = await lastBookableDay(bound.rule, bound.target, new Date(now()));
    const toDay = lastReadDay(fromDay, lastDay, BUSY_WINDOW_DAYS);
    const from = wallTimeToInstant(`${fromDay} 00:00`, zone)?.getTime() ?? now();
    const to = wallTimeToInstant(`${toDay} 00:00`, zone)?.getTime() ?? now() + 92 * DAY_MS;
    return { from, to, fromDay, toDay };
  }

  /**
   * Swaps in one account's busy times. False: the account ended while the read
   * was out, so what this just wrote is taken back at once. `end` marks the
   * account before it drops the rows, so either it sees these or this sees it.
   */
  async function swapBusy(bound: BoundTable, account: ConnectedAccount, spans: readonly Span[], window: { from: number; to: number }): Promise<boolean> {
    const resource = await resourceValue(bound, account.rowKey);
    if (resource === null || resource === undefined) throw new Error('The account\'s row has no key to hold its busy times by.');
    await replaceBusyRows(bound.rule, bound.target, bound.busy, {
      account: account.id,
      from: new Date(window.from),
      to: new Date(window.to),
      forgetBefore: new Date(window.from),
      rows: spans.map((span) => ({ resource: resource as string | number, start: new Date(span.start), end: new Date(span.end) })),
    });
    const after = await accountsRepo.find(account.id);
    if (after !== null && after.state !== 'disconnecting') return true;
    await dropBusyRows(bound.rule, bound.target, bound.busy, account.id);
    return false;
  }

  /** Puts back an event someone changed or deleted in their own calendar. */
  async function repairOwnEvents(bound: BoundTable, account: ConnectedAccount, provider: CalendarProvider, state: CalendarSyncState): Promise<boolean> {
    if (state.calendarId === null) return false;
    let cursor = state.ownCursor;
    let changed = false;
    let mirrors: Map<string, CalendarEventRow> | null = null;
    for (let page = 0; page < 20; page += 1) {
      const answer = await provider.listOwnEvents({ calendarId: state.calendarId, cursor });
      if (isCalendarError(answer)) {
        if (answer.calendarError === 'CURSOR_GONE' && cursor !== null) {
          cursor = null;
          continue;
        }
        if (answer.calendarError === 'CALENDAR_MISSING') await calendarLost(bound, account, provider, state, state.calendarId);
        if (answer.calendarError === 'RATE_LIMITED') await holdFor(state, answer.retryAfterMs);
        return changed;
      }
      if (answer.events.length > 0 && mirrors === null) mirrors = await mirrorsByRemote(account.id);
      for (const event of answer.events) {
        const mirror = mirrors?.get(event.remoteId);
        if (mirror === undefined) continue;
        // Our own write coming back.
        if (!event.deleted && event.etag !== null && event.etag === mirror.etag) continue;
        changed = true;
        await repo.patchEvent(mirror.id, event.deleted ? { remoteId: null, etag: null, appliedHash: null, generation: mirror.generation + 1 } : { appliedHash: null }, now());
        if (mirror.endAt === null || mirror.endAt >= startOfToday(bound)) await markAndQueue({ connectionId: mirror.connectionId, tableName: mirror.tableName, rowKey: mirror.rowKey });
      }
      cursor = answer.cursor;
      if (!answer.more) break;
    }
    await repo.patch(state.accountId, { ownCursor: cursor }, now());
    state.ownCursor = cursor;
    return changed;
  }

  async function mirrorsByRemote(accountId: string): Promise<Map<string, CalendarEventRow>> {
    const out = new Map<string, CalendarEventRow>();
    let after: string | null = null;
    for (;;) {
      const page: CalendarEventRow[] = await repo.eventsOfAccount(accountId, after, ROW_PAGE);
      if (page.length === 0) break;
      for (const mirror of page) {
        after = mirror.id;
        if (mirror.remoteId !== null) out.set(mirror.remoteId, mirror);
      }
      if (page.length < ROW_PAGE) break;
    }
    return out;
  }

  /**
   * The first read did not finish in time: the slots it held closed open again,
   * whatever the account's state is now. Dropped first, so a failed drop is
   * tried again. A real read landing in between is read again at once.
   */
  async function endFirstReadHold(bound: BoundTable, account: ConnectedAccount, state: CalendarSyncState): Promise<void> {
    const since = state.connectingSince;
    if (since === null || now() - since < FIRST_READ_MS) return;
    await dropBusyRows(bound.rule, bound.target, bound.busy, account.id);
    await repo.clearConnecting(account.id, since, now());
    state.connectingSince = null;
    await repo.patch(account.id, { nextPollAt: now() }, now());
    await accountsRepo.moveState(account.id, 'connecting', 'connected', now());
  }

  /** One whole read of an account. Whatever goes wrong, it is tried again, and no busy time changed. */
  async function readAccount(accountId: string): Promise<{ state: string }> {
    try {
      return await readOnce(accountId);
    } catch (error) {
      deps.log?.('calendar sync: a read failed', { error: error instanceof Error ? error.name : 'unknown' });
      await repo.patch(accountId, { nextPollAt: now() + FAILED_RETRY_MS, lastError: 'FAILED' }, now()).catch(() => undefined);
      return { state: 'failed' };
    }
  }

  /**
   * A whole read, unless one added calendar is gone. That one is taken off the
   * list and the managers are told, so it cannot freeze the person's other
   * calendars at what they last said. The main calendar is never taken off:
   * if it cannot be read, nothing about this person can be trusted.
   */
  async function readBusyOf(account: ConnectedAccount, provider: CalendarProvider, state: CalendarSyncState, calendarIds: string[], from: string, to: string): Promise<Awaited<ReturnType<CalendarProvider['readBusy']>>> {
    const whole = await provider.readBusy({ calendarIds, from, to });
    if (!isCalendarError(whole) || !CALENDAR_LOST.has(whole.calendarError)) return whole;
    const intervals: Exclude<Awaited<ReturnType<CalendarProvider['readBusy']>>, CalendarError>['intervals'] = [];
    const lost: string[] = [];
    for (const calendarId of calendarIds) {
      const one = await provider.readBusy({ calendarIds: [calendarId], from, to });
      if (!isCalendarError(one)) intervals.push(...one.intervals);
      else if (calendarId === 'primary' || !CALENDAR_LOST.has(one.calendarError)) return one;
      else lost.push(calendarId);
    }
    if (lost.length === 0) return whole;
    const left = (state.readCalendars ?? ['primary']).filter((id) => !lost.includes(id));
    const next = left.length > 0 ? left : ['primary'];
    await repo.patch(account.id, { readCalendars: next }, now());
    state.readCalendars = next;
    await tellCalendar(noticeDeps, await appKeyOf(account), 'calendar.unreadable', { person: await personName(account) });
    return left.length > 0 ? { intervals } : provider.readBusy({ calendarIds: ['primary'], from, to });
  }

  async function readOnce(accountId: string): Promise<{ state: string }> {
    const account = await accountsRepo.find(accountId);
    if (account === null || account.state === 'disconnecting') return { state: 'gone' };
    const held = await repo.state(accountId);
    if (held === null) return { state: 'no-sync' };
    const state = held;
    const bound = await bindAccount(account);
    const pushBack = (ms: number, lastError: string | null) => repo.patch(accountId, { nextPollAt: now() + ms, lastError }, now());
    if (bound === null) {
      await pushBack(UNAVAILABLE_RETRY_MS, 'NO_TABLE');
      return { state: 'no-table' };
    }
    await endFirstReadHold(bound, account, state);
    if (account.state === 'reconnect') {
      await dropIfStale(bound, account, state);
      await pushBack(RECONNECT_LOOK_MS, null);
      return { state: 'reconnect' };
    }
    if (state.paused !== null) {
      await pushBack(RECONNECT_LOOK_MS, state.lastError);
      return { state: 'paused' };
    }
    if (state.holdUntil !== null && state.holdUntil > now()) {
      await pushBack(state.holdUntil - now(), state.lastError);
      return { state: 'held' };
    }
    const lookup = await calendarProviderFor(providerDeps, account);
    if (!lookup.ok) {
      await pushBack(lookup.reason === 'unavailable' ? UNAVAILABLE_RETRY_MS : RECONNECT_LOOK_MS, lookup.reason.toUpperCase());
      return { state: lookup.reason };
    }
    const { provider } = lookup;
    const startedAt = now();
    await repo.patch(accountId, { readStartedAt: startedAt }, startedAt);
    const window = await readWindow(bound);
    // The calendar Adminium writes is never read as the person's busy time.
    const calendarIds = (state.readCalendars ?? ['primary']).filter((id) => id !== state.calendarId);
    const answer = await readBusyOf(account, provider, state, calendarIds, new Date(window.from).toISOString(), new Date(window.to).toISOString());
    if (isCalendarError(answer)) {
      if (answer.calendarError === 'RATE_LIMITED') {
        const wait = answer.retryAfterMs ?? FAILED_RETRY_MS;
        await repo.patch(accountId, { holdUntil: now() + wait, nextPollAt: now() + wait, lastError: 'RATE_LIMITED' }, now());
      } else {
        await pushBack(answer.calendarError === 'UNAVAILABLE' ? FAILED_RETRY_MS : FAILED_RETRY_MS * 2, answer.calendarError);
      }
      return { state: 'failed' };
    }
    // A person may show the calendar Adminium writes inside one they read: their own bookings are not busy times.
    const own = (await repo.eventsFrom(accountId, window.from, BUSY_ROWS_MAX)).flatMap((mirror) => (mirror.remoteId !== null && mirror.startAt !== null && mirror.endAt !== null ? [{ start: mirror.startAt, end: mirror.endAt }] : []));
    const spans = countedBusy(withoutOwnEvents(answer.intervals as CalendarBusyInterval[], own), { countAllDay: state.countAllDay, zone: bound.source.timezone, from: window.from, to: window.to });
    if (!(await swapBusy(bound, account, spans, window))) return { state: 'gone' };

    const newHash = busyHash(spans);
    const busyChanged = state.busyHash !== null && state.busyHash !== newHash;
    const calendarReady = await ensureOwnCalendar(bound, provider, state);
    const ownChanged = calendarReady === null ? false : await repairOwnEvents(bound, account, provider, state);
    const at = now();
    // A hold a call set during this read stands: it is the service's word.
    await repo.patch(accountId, { lastSyncedAt: at, nextPollAt: at + nextPollDelay(random), busyHash: newHash, connectingSince: null, staleDroppedAt: null, lastError: null }, at);
    // A notice that came while this read was out asks for another, once the floor allows it.
    const after = await repo.state(accountId);
    if (after?.noticeAt != null && after.noticeAt > startedAt) await repo.pullForward(accountId, at + READ_FLOOR_MS, after.noticeAt);
    await accountsRepo.moveState(account.id, 'connecting', 'connected', at);
    if (calendarReady !== null && state.calendarId !== null) await keepChannels(account, provider, lookup.key, state, state.calendarId);
    if (busyChanged || ownChanged) await watchForSilence(account, state);
    await tellClashes(bound, account).catch((error: unknown) => deps.log?.('calendar clashes could not be told', { error: error instanceof Error ? error.name : 'unknown' }));
    return { state: 'read' };
  }

  /** The last busy times of someone who has not reconnected, once they are too old to trust. */
  async function dropIfStale(bound: BoundTable, account: ConnectedAccount, state: CalendarSyncState): Promise<void> {
    if (state.staleDroppedAt !== null) return;
    const since = state.lastSyncedAt ?? account.stateSince;
    if (now() - since < STALE_BUSY_MS) return;
    await dropBusyRows(bound.rule, bound.target, bound.busy, account.id);
    await repo.patch(account.id, { staleDroppedAt: now() }, now());
    await tellCalendar(noticeDeps, await appKeyOf(account), 'calendar.stale-dropped', { person: await personName(account) });
  }

  // ─── PUSH ───────────────────────────────────────────────────────────────

  const hookAddress = (origin: string, key: string, channelId: string) => `${origin}/api/v1/calendars/hook/${key}/${channelId}`;

  async function openChannel(account: ConnectedAccount, provider: CalendarProvider, key: string, target: 'own' | 'busy', calendarIds: string[], origin: string): Promise<void> {
    const id = newId('chn');
    const secret = randomBytes(32).toString('base64url');
    const address = hookAddress(origin, key, id);
    // Written first: a service that checks the address at once must find it being made.
    await repo.putChannel({ id, accountId: account.id, provider: key, target, state: 'creating', secret, remoteChannelId: null, resourceId: null, address, expiresAt: now() + 120_000 }, now());
    const answer = await provider.watch({ target, calendarIds, channelId: id, secret, address });
    if (isCalendarError(answer)) {
      await repo.removeChannel(id);
      return;
    }
    await repo.patchChannel(id, { state: 'live', remoteChannelId: answer.remoteChannelId, resourceId: answer.resourceId, expiresAt: Date.parse(answer.expiresAt) });
  }

  const channelRef = (channel: CalendarChannel) => ({ channelId: channel.id, remoteChannelId: channel.remoteChannelId, resourceId: channel.resourceId, address: channel.address, secret: channel.secret });

  /** Push is on while the outside can reach this server: the channels it needs, at its current address. */
  async function keepChannels(account: ConnectedAccount, provider: CalendarProvider, key: string, state: CalendarSyncState, calendarId: string): Promise<void> {
    const reach = await deps.reach();
    const origin = reach.state === 'reachable' ? await deps.publicOrigin() : null;
    const channels = await repo.channelsOf(account.id);
    for (const channel of channels) {
      const elsewhere = origin === null || !channel.address.startsWith(`${origin}/`);
      const stuck = channel.state === 'creating' && now() - channel.createdAt > 120_000;
      if (!elsewhere && !stuck && channel.expiresAt > now()) continue;
      await provider.unwatch(channelRef(channel));
      await repo.removeChannel(channel.id);
    }
    if (origin === null) return;
    const live = await repo.channelsOf(account.id);
    if (!live.some((channel) => channel.target === 'own')) await openChannel(account, provider, key, 'own', [calendarId], origin);
    if (provider.traits.busyPush && !live.some((channel) => channel.target === 'busy')) await openChannel(account, provider, key, 'busy', state.readCalendars ?? ['primary'], origin);
  }

  /** A connection with no notice for a day, whose polls keep finding changes. Told once. */
  async function watchForSilence(account: ConnectedAccount, state: CalendarSyncState): Promise<void> {
    if (state.silentToldAt !== null) return;
    const channels = await repo.channelsOf(account.id);
    if (channels.length === 0) return;
    const heard = Math.max(...channels.map((channel) => channel.lastNoticeAt ?? channel.createdAt));
    if (now() - heard < PUSH_SILENT_MS) return;
    await repo.patch(account.id, { silentToldAt: now() }, now());
    await tellCalendar(noticeDeps, await appKeyOf(account), 'calendar.push-silent', { person: await personName(account) });
  }

  /**
   * Channels near their end. Renewed in place where the service can. Where it
   * cannot, a new one is opened first, so no change is missed while both run,
   * and then the old one stops.
   */
  async function renewChannels(): Promise<number> {
    let renewed = 0;
    for (const channel of await repo.channelsEndingBefore(now() + CHANNEL_RENEW_MS, 200)) {
      if (channel.state === 'creating') continue;
      const account = await accountsRepo.find(channel.accountId);
      if (account === null || !usable(account)) continue;
      const lookup = await calendarProviderFor(providerDeps, account);
      if (!lookup.ok) continue;
      const answer = await lookup.provider.renew(channelRef(channel));
      if (!isCalendarError(answer)) {
        await repo.patchChannel(channel.id, { expiresAt: Date.parse(answer.expiresAt) });
        renewed += 1;
        continue;
      }
      if (answer.calendarError === 'RATE_LIMITED' || answer.calendarError === 'UNAVAILABLE' || answer.calendarError === 'UNAUTHORIZED') continue;
      const state = await repo.state(account.id);
      const reach = await deps.reach();
      const origin = reach.state === 'reachable' ? await deps.publicOrigin() : null;
      if (state !== null && origin !== null) {
        const ids = channel.target === 'own' ? (state.calendarId === null ? [] : [state.calendarId]) : (state.readCalendars ?? ['primary']);
        if (ids.length > 0) await openChannel(account, lookup.provider, lookup.key, channel.target, ids, origin);
      }
      await lookup.provider.unwatch(channelRef(channel));
      await repo.removeChannel(channel.id);
      renewed += 1;
    }
    return renewed;
  }

  /**
   * Where a service calls. One indexed read for a channel nobody knows; a
   * genuine notice only pulls the account's next read forward, so a replay
   * costs nothing. A handshake is echoed only while that channel is being made.
   */
  async function receiveHook(input: { provider: string; channelId: string; delivery: HookDelivery }): Promise<{ status: number; text?: string }> {
    const reach = await deps.reach();
    // Not reachable as far as this server knows: the service keeps its notice.
    if (reach.state !== 'reachable') return { status: 503 };
    const channel = await repo.channel(input.channelId).catch(() => null);
    if (channel === null || channel.provider !== input.provider) return { status: 404 };
    const answer = readHookFor(providerDeps, input.provider, input.delivery);
    if (answer === null) return { status: 503 };
    if (isCalendarError(answer)) return { status: 400 };
    if (answer.handshake !== null) return channel.state === 'creating' ? { status: 200, text: answer.handshake } : { status: 404 };
    const genuine = answer.notices.filter((notice) => notice.secret !== null && sameSecret(notice.secret, channel.secret));
    if (genuine.length === 0) return { status: answer.notices.length === 0 ? 202 : 403 };
    const at = now();
    // A service says the channel needs renewing, or has ended: the next sweep or read deals with it.
    if (genuine.some((notice) => notice.kind === 'removed')) await repo.removeChannel(channel.id);
    else await repo.patchChannel(channel.id, { lastNoticeAt: at, ...(genuine.some((notice) => notice.kind === 'reauthorize') ? { expiresAt: at } : {}) });
    const state = await repo.state(channel.accountId);
    if (state === null) return { status: 202 };
    const soonest = Math.max(at, (state.readStartedAt ?? 0) + READ_FLOOR_MS);
    await repo.pullForward(channel.accountId, soonest, at);
    await deps.enqueue({ kind: CALENDAR_POLL_JOB, payload: { accountId: channel.accountId }, dedupeKey: `calendar-poll:${channel.accountId}`, maxAttempts: 1, runAt: soonest, priority: CALENDAR_JOB_PRIORITY });
    if (state.silentToldAt !== null) await repo.patch(channel.accountId, { silentToldAt: null }, at);
    return { status: 202 };
  }

  // ─── CLASHES ────────────────────────────────────────────────────────────

  /**
   * The counted, coming bookings of the connected people of a table (or of one
   * person), and their busy times. Nobody's first-read hold is a clash.
   */
  async function clashInputs(bound: BoundTable, only?: string): Promise<{ bookings: ClashBooking[]; busy: Map<string, Span[]>; whole: boolean }> {
    const asked = (await accountsRepo.forTable(bound.target.connectionId, bound.resource.id)).filter((account) => only === undefined || account.rowKey === only);
    const people = asked.filter((account) => account.state !== 'connecting' && account.state !== 'disconnecting');
    const holding = new Set((await repo.states(people.map((account) => account.id))).filter((state) => state.connectingSince !== null).map((state) => state.accountId));
    const connected = people.filter((account) => !holding.has(account.id));
    // Someone mid-read is left out for now: what is stored about them says nothing about their clashes yet.
    const whole = connected.length === asked.length;
    const busy = new Map<string, Span[]>();
    const bookings: ClashBooking[] = [];
    if (connected.length === 0) return { bookings, busy, whole };
    const zone = bound.source.timezone;
    const today = venueClock(new Date(now()), zone).day;
    const last = addDays(await lastBookableDay(bound.rule, bound.target, new Date(now())), 2);
    const db = bound.source.db;
    const resources = await Promise.all(connected.map((account) => resourceValue(bound, account.rowKey)));
    const named = resources.filter((value) => value !== null && value !== undefined);
    if (named.length === 0) return { bookings, busy, whole };
    for (const one of await busyIn(bound.rule, bound.target, today, last, named, (source) => source.engine !== undefined)) {
      const list = busy.get(one.resource) ?? [];
      list.push({ start: one.start, end: one.end });
      busy.set(one.resource, list);
    }
    const rows = (await db
      .selectFrom(bound.table.id)
      .selectAll()
      .where((eb) => eb(db.dynamic.ref(bound.rule.start), '>=', addDays(today, -1)))
      .where((eb) => eb(db.dynamic.ref(bound.rule.start), '<', addDays(last, 2)))
      .where((eb) => eb(db.dynamic.ref(bound.rule.countWhere.column), 'in', bound.rule.countWhere.values))
      .where((eb) => eb(db.dynamic.ref(bound.rule.resource), 'in', named as never[]))
      .execute()) as Row[];
    const at = now();
    for (const row of rows) {
      const start = slotInstant(row[bound.rule.start])?.getTime();
      const minutes = Number(row[bound.rule.minutes] ?? 0);
      if (start === undefined || !Number.isFinite(minutes) || minutes <= 0) continue;
      const end = start + minutes * 60_000;
      if (end <= at) continue;
      bookings.push({ rowKey: rowKeyOf(bound.table, row), resource: keyOf(row[bound.rule.resource]), start, end });
    }
    return { bookings, busy, whole };
  }

  /**
   * The clashes now, each saying whether it was kept. Stored choices for
   * clashes that no longer exist are let go; asked for one person, only theirs.
   */
  async function clashesOf(bound: BoundTable, only?: string): Promise<RowClash[]> {
    const { bookings, busy, whole } = await clashInputs(bound, only);
    const derived = deriveClashes(bookings, busy);
    const stored = await repo.clashesOfTable(bound.target.connectionId, bound.table.id);
    const keyOfClash = (c: { rowKey: string; overlapStart: number; overlapEnd: number }) => `${c.rowKey}|${String(c.overlapStart)}|${String(c.overlapEnd)}`;
    const byKey = new Map(stored.map((row) => [keyOfClash(row), row]));
    const live = new Set(derived.map(keyOfClash));
    const theirs = new Set(bookings.map((booking) => booking.rowKey));
    if (whole) await repo.removeClashes(stored.filter((row) => !live.has(keyOfClash(row)) && (only === undefined || theirs.has(row.rowKey))).map((row) => row.id));
    return derived.map((clash) => ({ ...clash, kept: byKey.get(keyOfClash(clash))?.keptAt != null }));
  }

  /** Tells the desk of each new clash of this person, once. */
  async function tellClashes(bound: BoundTable, account: ConnectedAccount): Promise<void> {
    for (const clash of await clashesOf(bound, account.rowKey)) {
      if (clash.kept) continue;
      const row = await repo.ensureClash({ connectionId: bound.target.connectionId, tableName: bound.table.id, rowKey: clash.rowKey }, clash.overlapStart, clash.overlapEnd);
      if (row.toldAt !== null || !(await repo.claimTold(row.id, now()))) continue;
      await tellCalendar(noticeDeps, await appKeyOf(account), 'calendar.clash', { person: await personName(account) });
    }
  }

  // ─── THE LIFE OF A CONNECTION ───────────────────────────────────────────

  /** A person connected: the first read holds their slots, and their coming bookings go out. */
  async function onConnected(account: ConnectedAccount): Promise<void> {
    const bound = await bindAccount(account);
    if (bound === null) return;
    const at = now();
    const before = await repo.state(account.id);
    await repo.ensure({ accountId: account.id, connectionId: account.connectionId, bookingTable: bound.table.id, detail: bound.rule.sync.detail?.default ?? 'first-name+initial', nextPollAt: at }, at);
    await repo.patch(account.id, { paused: null, calendarLostCount: 0, calendarLostAt: null, nextPollAt: at, holdUntil: null, staleDroppedAt: null }, at);
    if (before === null) {
      // Connecting back: the calendar they left is theirs again. Its name is left blank, so it is checked before it is used.
      const kept = await accounts.takeCalendar(account.manifestId, account.subject).catch(() => null);
      if (kept !== null) await repo.patch(account.id, { calendarId: kept, calendarName: null }, at);
    }
    if (before === null || before.lastSyncedAt === null) {
      // Never read: nobody knows this diary yet, so its window is closed until the first read.
      await repo.patch(account.id, { connectingSince: at }, at);
      await accountsRepo.moveState(account.id, 'connected', 'connecting', at);
      const window = await readWindow(bound);
      await swapBusy(bound, account, [{ start: window.from, end: window.to }], window);
    }
    await deps.enqueue({ kind: CALENDAR_POLL_JOB, payload: { accountId: account.id }, dedupeKey: `calendar-poll:${account.id}`, maxAttempts: 1, priority: CALENDAR_JOB_PRIORITY });
    await backfill(bound, account);
    // Events that could not be taken out while the grant was gone.
    let after: string | null = null;
    for (;;) {
      const page: CalendarEventRow[] = await repo.eventsOfAccount(account.id, after, ROW_PAGE);
      if (page.length === 0) break;
      for (const mirror of page) {
        after = mirror.id;
        await repo.markDirty({ connectionId: mirror.connectionId, tableName: mirror.tableName, rowKey: mirror.rowKey }, at);
      }
      if (page.length < ROW_PAGE) break;
    }
  }

  /** Marks every coming booking of this person, so the sweep sends them at its own pace. */
  async function backfill(bound: BoundTable, account: ConnectedAccount): Promise<void> {
    const resource = await resourceValue(bound, account.rowKey);
    if (resource === null || resource === undefined) return;
    const db = bound.source.db;
    const from = venueClock(new Date(now()), bound.source.timezone).day;
    const rows = (await db
      .selectFrom(bound.table.id)
      .selectAll()
      .where((eb) => eb(db.dynamic.ref(bound.rule.resource), '=', resource as never))
      .where((eb) => eb(db.dynamic.ref(bound.rule.start), '>=', addDays(from, -1)))
      .where((eb) => eb(db.dynamic.ref(bound.rule.sync.when.column), 'in', bound.rule.sync.when.values))
      .limit(ROW_PAGE * 4)
      .execute()) as Row[];
    // The first few go now, so a person sees their week at once; the sweep sends the rest at its own pace.
    for (const [index, row] of rows.entries()) {
      const ref = { connectionId: account.connectionId, tableName: bound.table.id, rowKey: rowKeyOf(bound.table, row) };
      await repo.markDirty(ref, now());
      if (index < BACKFILL_AT_ONCE) await queueRow(ref);
    }
  }

  accounts.setCalendarNamer(async (target) => {
    const bound = await bindAccount(target);
    return bound === null ? null : calendarNameOf(bound);
  });

  /**
   * At the end of a connection: its channels stop, its coming events go, its
   * busy times go. An event the service would not take out keeps its mirror,
   * and the grant stays for another try, for this alone. Once no try is left,
   * or the grant is dead, whoever manages the connections is told whose
   * calendar may still show a name, and never whose name.
   */
  accounts.addCleanup({
    run: async ({ account, lastTry }) => {
      let removed = 0;
      let failed = false;
      let namesLeft = 0;
      const unreached: CalendarEventRow[] = [];
      const lookup = await calendarProviderFor(providerDeps, account, { ending: true }).catch(() => null);
      const provider = lookup?.ok === true ? lookup.provider : null;
      let grantDead = lookup?.ok === false && lookup.reason === 'reconnect';
      const state = await repo.state(account.id);
      for (const channel of await repo.channelsOf(account.id)) {
        if (provider === null) failed = true;
        else if (isCalendarError(await provider.unwatch(channelRef(channel)))) failed = true;
        await repo.removeChannel(channel.id);
      }
      const at = now();
      let after: string | null = null;
      for (;;) {
        const page: CalendarEventRow[] = await repo.eventsOfAccount(account.id, after, ROW_PAGE);
        if (page.length === 0) break;
        for (const mirror of page) {
          after = mirror.id;
          // Coming events go. So does a past one still carrying a name: once its row here is gone, nothing could take the name out.
          if (mirror.remoteId !== null && (mirror.endAt === null || mirror.endAt >= at || mirror.detail === 'name')) {
            if (state?.calendarId == null) {
              // No calendar to reach it in.
              if (mirror.detail === 'name') namesLeft += 1;
            } else {
              let gone = false;
              if (provider !== null && !grantDead) {
                const answer = await provider.deleteEvent({ calendarId: state.calendarId, remoteId: mirror.remoteId });
                if (!isCalendarError(answer) || answer.calendarError === 'EVENT_MISSING' || answer.calendarError === 'CALENDAR_MISSING') {
                  removed += 1;
                  gone = true;
                } else if (answer.calendarError === 'UNAUTHORIZED' || answer.calendarError === 'PERMISSION_MISSING') {
                  grantDead = true;
                }
              }
              if (!gone) {
                failed = true;
                unreached.push(mirror);
                continue;
              }
            }
          }
          await repo.removeEvent(mirror.id);
        }
        if (page.length < ROW_PAGE) break;
      }
      const again = unreached.length > 0 && !lastTry && !grantDead;
      if (!again) {
        for (const mirror of unreached) {
          if (mirror.detail === 'name') namesLeft += 1;
          await repo.removeEvent(mirror.id);
        }
      }
      // The busy times go whatever the service said: they are this server's to drop.
      try {
        const bound = await bindAccount(account);
        // No table to read means nothing was ever swapped in for this account.
        if (bound !== null) await dropBusyRows(bound.rule, bound.target, bound.busy, account.id);
      } catch {
        // The hourly pass drops the rows of an account that no longer exists.
        failed = true;
      }
      if (state?.calendarId != null) await accounts.rememberCalendar(account.manifestId, account.subject, state.calendarId).catch(() => undefined);
      if (again) return { removed, retry: true };
      if (namesLeft > 0) {
        const bound = await bindAccount(account).catch(() => null);
        const calendar = state?.calendarName ?? (bound === null ? '' : await calendarNameOf(bound));
        await tellCalendar(noticeDeps, await appKeyOf(account), 'calendar.names-left', { person: await personName(account), calendar });
      }
      if (failed) throw new Error('Part of the calendar could not be reached.');
      return { removed };
    },
  });

  // ─── THE TICKS ──────────────────────────────────────────────────────────

  async function sendDirty(limit: number): Promise<number> {
    const rows = await repo.dirtyBefore(now(), limit);
    for (const row of rows) {
      // To the back of the line: rows that keep failing cannot stand in front of the rest.
      await repo.touchDirty(row.id, now());
      await queueRow({ connectionId: row.connectionId, tableName: row.tableName, rowKey: row.rowKey });
    }
    return rows.length;
  }

  /** Each minute: the accounts due a read. One job each, deduped and never retried: the next plan is the retry. */
  async function plan(): Promise<{ polls: number }> {
    // A first read's hold ends on time, whatever has become of the read.
    for (const state of await repo.connectingBefore(now() - FIRST_READ_MS, PLAN_ACCOUNTS)) {
      try {
        const account = await accountsRepo.find(state.accountId);
        const bound = account === null ? null : await bindAccount(account);
        if (account !== null && bound !== null) await endFirstReadHold(bound, account, state);
      } catch (error) {
        deps.log?.('calendar sync: a first-read hold could not be ended', { error: error instanceof Error ? error.name : 'unknown' });
      }
    }
    const due = await repo.due(now(), PLAN_ACCOUNTS);
    for (const state of due) {
      await deps.enqueue({ kind: CALENDAR_POLL_JOB, payload: { accountId: state.accountId }, dedupeKey: `calendar-poll:${state.accountId}`, maxAttempts: 1, priority: CALENDAR_JOB_PRIORITY });
    }
    return { polls: due.length };
  }

  /** Every five minutes: rows still waiting to go out, and channels near their end. */
  async function sweep(): Promise<{ rows: number; renewed: number }> {
    const rows = await sendDirty(SWEEP_ROWS);
    const renewed = await renewChannels();
    return { rows, renewed };
  }

  /**
   * Hourly: titles of visits that are over lose the name, the morning after.
   * Around four on the venue's clock, every coming booking is compared with
   * its event again (a renamed service, a corrected name, a write that was lost).
   */
  async function daily(): Promise<{ marked: number }> {
    let marked = 0;
    for (const connectionId of await deps.connectionIds()) {
      const source = await deps.source(connectionId).catch(() => null);
      if (source === null) continue;
      for (const tableId of syncedTables(source.view)) {
        const bound = bindIn(source, connectionId, tableId);
        if (bound === null) continue;
        marked += await markNamedPast(bound);
        await dropOrphans(bound);
        const hour = Math.floor(venueClock(new Date(now()), bound.source.timezone).minute / 60);
        if (hour === 4) marked += await markComing(bound);
      }
    }
    await sendDirty(SWEEP_ROWS);
    return { marked };
  }

  /** Past events still carrying a name, of people the sync can write for: nobody who must reconnect stands in the others' way. */
  async function markNamedPast(bound: BoundTable): Promise<number> {
    const connectionId = bound.target.connectionId;
    const reachable = new Map<string, boolean>();
    let marked = 0;
    let after: string | null = null;
    for (let page = 0; page < NAMED_PAGES; page += 1) {
      const rows: CalendarEventRow[] = await repo.namedBefore(connectionId, bound.table.id, startOfToday(bound), after, ROW_PAGE);
      if (rows.length === 0) break;
      for (const mirror of rows) {
        after = mirror.id;
        if (!reachable.has(mirror.accountId)) {
          const account = await accountsRepo.find(mirror.accountId);
          reachable.set(mirror.accountId, account !== null && usable(account));
        }
        if (reachable.get(mirror.accountId) !== true) continue;
        await repo.markDirty({ connectionId, tableName: bound.table.id, rowKey: mirror.rowKey }, now());
        marked += 1;
      }
      if (rows.length < ROW_PAGE) break;
    }
    return marked;
  }

  /**
   * Busy times of an account that no longer exists, which no later pass would
   * ever replace. Only an account's own id: a sample's rows name no account.
   */
  async function dropOrphans(bound: BoundTable): Promise<void> {
    const kept = keptBusySource(bound.rule);
    if (kept?.engine === undefined) return;
    const held = (await bound.source.db.selectFrom(bound.busy.id).select(sql<string>`${sql.ref(kept.engine.account)}`.as('account')).distinct().execute()) as { account: string }[];
    for (const { account } of held) {
      if (typeof account === 'string' && account.startsWith('cac_') && (await accountsRepo.find(account)) === null) await dropBusyRows(bound.rule, bound.target, bound.busy, account);
    }
  }

  async function markComing(bound: BoundTable): Promise<number> {
    const connectionId = bound.target.connectionId;
    const db = bound.source.db;
    const from = venueClock(new Date(now()), bound.source.timezone).day;
    const rows = (await db
      .selectFrom(bound.table.id)
      .selectAll()
      .where((eb) => eb(db.dynamic.ref(bound.rule.start), '>=', from))
      .where((eb) => eb(db.dynamic.ref(bound.rule.sync.when.column), 'in', bound.rule.sync.when.values))
      .limit(ROW_PAGE * 4)
      .execute()) as Row[];
    for (const row of rows) await repo.markDirty({ connectionId, tableName: bound.table.id, rowKey: rowKeyOf(bound.table, row) }, now());
    // A row no longer wanted that still has an event comes out too.
    let after: string | null = null;
    let seen = rows.length;
    for (;;) {
      const page: CalendarEventRow[] = await repo.rowsFrom(connectionId, bound.table.id, now(), after, ROW_PAGE);
      if (page.length === 0) break;
      for (const mirror of page) {
        after = mirror.id;
        await repo.markDirty({ connectionId, tableName: bound.table.id, rowKey: mirror.rowKey }, now());
        seen += 1;
      }
      if (page.length < ROW_PAGE) break;
    }
    return seen;
  }

  // ─── THE WRITE PATH AND THE ERASE ───────────────────────────────────────

  /** A write to any row: never throws, and only marks. The job does the calling. */
  async function onRecordEvent(event: RecordWriteEvent): Promise<void> {
    try {
      const source = await deps.source(event.connectionId);
      if (source === null) return;
      const tables = syncedTables(source.view);
      if (tables.length === 0) return;
      for (const id of tables) {
        const bound = bindIn(source, event.connectionId, id);
        if (bound === null) continue;
        if (event.table.id === bound.resource.id) await endIfRowLeft(event, bound);
        if (id === event.table.id) {
          const pk = event.entity.pk as Row;
          await markAndQueue({ connectionId: event.connectionId, tableName: id, rowKey: rowKeyOf(bound.table, pk) });
          continue;
        }
        // A service renamed, or a person forgotten: the bookings that show them.
        if (event.action !== 'delete') await markByTitleLinks(bound, event.connectionId, event.table.id, (event.after ?? event.entity.pk) as Row);
      }
    } catch (error) {
      deps.log?.('calendar sync: a write could not be marked', { error: String(error) });
    }
  }

  /**
   * A person's row deleted or switched off: their connection ends now, not at
   * the next hourly sweep. The job judges the row again before it ends anything.
   */
  async function endIfRowLeft(event: RecordWriteEvent, bound: BoundTable): Promise<void> {
    const rule = await accounts.tableOf(event.connectionId, bound.resource.id);
    if (rule === null) return;
    const gone = event.action === 'delete' || !accounts.rowIsLive((event.after ?? undefined) as Row | undefined, rule.rule);
    const was = accounts.personOf((event.before ?? undefined) as Row | undefined, rule.rule).address;
    const next = accounts.personOf((event.after ?? undefined) as Row | undefined, rule.rule).address;
    // The row came to hold someone else: its bookings must not keep going to the last person's calendar.
    const handedOver = !gone && was !== null && was.trim().toLowerCase() !== next?.trim().toLowerCase();
    if (!gone && !handedOver) return;
    const rowKey = rowKeyOf(bound.resource, event.entity.pk as Row);
    for (const account of await accountsRepo.forTarget({ connectionId: event.connectionId, tableName: bound.resource.id, rowKey })) {
      // Their own account's address, put on the row: the same person, nothing to end.
      if (handedOver && next !== null && account.address?.trim().toLowerCase() === next.trim().toLowerCase()) continue;
      const payload = handedOver ? { accountId: account.id, why: { kind: 'handed-over', from: addressDigest(was) } } : { accountId: account.id };
      await deps.enqueue({ kind: CONNECTED_ACCOUNT_END_JOB, payload, dedupeKey: `connected-account-end:${account.id}`, maxAttempts: 5 });
    }
  }

  /**
   * After an erasure, which writes rows without announcing them: every
   * booking of those rows, past ones too, is written again without the name.
   * The connected account of an erased address ends.
   */
  async function onErased(input: { address: string; rows: readonly { connectionId: string; table: string; key: string }[] }): Promise<{ events: number; accounts: number }> {
    let events = 0;
    for (const row of input.rows) {
      const source = await deps.source(row.connectionId).catch(() => null);
      if (source === null) continue;
      for (const id of syncedTables(source.view)) {
        const bound = bindIn(source, row.connectionId, id);
        if (bound === null) continue;
        if (id === row.table) {
          await markAndQueue({ connectionId: row.connectionId, tableName: id, rowKey: row.key });
          events += 1;
          continue;
        }
        if (!source.view.model.tables.some((one) => one.id === row.table)) continue;
        const table = source.view.table(row.table);
        const pk = pkOfRowKey(table, row.key);
        const held = pk === null ? undefined : await fetchByPk(source.db, table, pk);
        if (held === undefined) continue;
        await markByTitleLinks(bound, row.connectionId, row.table, held);
        events += 1;
      }
    }
    let ended = 0;
    // An erased row's own connection, and any link still open for it.
    for (const row of input.rows) {
      const target = { connectionId: row.connectionId, tableName: row.table, rowKey: row.key };
      for (const account of await accountsRepo.forTarget(target).catch(() => [])) {
        if ((await accounts.end(account.id).catch(() => null)) !== null) ended += 1;
      }
      await accountsRepo.removeLinksOnTarget(target).catch(() => undefined);
    }
    const address = input.address.trim().toLowerCase();
    if (address === '') return { events, accounts: ended };
    let after: string | null = null;
    for (;;) {
      const page: ConnectedAccount[] = await accountsRepo.page(after, 200);
      if (page.length === 0) break;
      for (const account of page) {
        after = account.id;
        const named = account.address?.toLowerCase() === address || (await accounts.rowAddressOf(account))?.trim().toLowerCase() === address;
        if (named && (await accounts.end(account.id).catch(() => null)) !== null) ended += 1;
      }
      if (page.length < 200) break;
    }
    return { events, accounts: ended };
  }

  // ─── WHAT THE DESK ASKS ─────────────────────────────────────────────────

  /** A row's calendar, as the desk shows it. */
  async function stateOfRow(target: { connectionId: string; tableName: string; rowKey: string }, options?: { personal?: boolean }) {
    const account = (await accountsRepo.forTarget(target))[0];
    if (account === undefined) return null;
    // Without personal data: the state alone, and no call on the person's account to learn the rest.
    const personal = options?.personal !== false;
    const state = await repo.state(account.id);
    const channels = await repo.channelsOf(account.id);
    const lookup = personal ? await calendarProviderFor(providerDeps, account).catch(() => null) : null;
    const traits = lookup?.ok === true ? lookup.provider.traits : null;
    let calendars: { id: string; name: string; primary: boolean; writable: boolean }[] | null = null;
    if (lookup?.ok === true && lookup.provider.traits.listsCalendars) {
      const answer = await lookup.provider.listCalendars();
      if (!isCalendarError(answer)) calendars = answer.calendars;
    }
    return {
      accountId: account.id,
      state: account.state,
      address: personal ? account.address : null,
      demo: isDemoAccount(account),
      lastSyncedAt: state?.lastSyncedAt ?? null,
      /** While someone must reconnect: the date of the busy times that still block. Null once they were dropped. */
      busyAsOf: account.state === 'reconnect' && state?.staleDroppedAt == null ? (state?.lastSyncedAt ?? null) : null,
      busyDropped: state?.staleDroppedAt != null,
      paused: state?.paused ?? null,
      readCalendars: personal ? (state?.readCalendars ?? null) : null,
      countAllDay: state?.countAllDay ?? false,
      detail: state?.detail ?? 'first-name+initial',
      /** The calendar Adminium keeps there, which is never one of the calendars to count. */
      calendarId: state?.calendarId ?? null,
      /** What this provider can tell: the all-day tick and the list of calendars are shown only when it can. */
      traits,
      calendars,
      /** Push: how many channels are live, and when one last spoke. */
      push: { channels: channels.filter((channel) => channel.state === 'live').length, lastNoticeAt: channels.reduce<number | null>((last, channel) => (channel.lastNoticeAt !== null && (last === null || channel.lastNoticeAt > last) ? channel.lastNoticeAt : last), null) },
    };
  }

  /**
   * A person's own choices about their calendar. Calendars must be ones this
   * account lists, where the provider can list them; where it cannot (Google
   * with two permissions), ids are typed by hand, as ruled.
   */
  async function setChoices(accountId: string, input: { readCalendars?: string[] | null; countAllDay?: boolean; detail?: Detail; resume?: boolean; byOwnPerson?: boolean }): Promise<'ok' | 'unknown-calendar' | 'not-theirs'> {
    const account = await accountsRepo.find(accountId);
    if (account === null) return 'ok';
    if (input.readCalendars !== undefined && input.readCalendars !== null) {
      const lookup = await calendarProviderFor(providerDeps, account);
      if (lookup.ok && lookup.provider.traits.listsCalendars) {
        const listed = await lookup.provider.listCalendars();
        if (isCalendarError(listed)) return 'unknown-calendar';
        const known = new Set(['primary', ...listed.calendars.map((calendar) => calendar.id)]);
        if (input.readCalendars.some((id) => !known.has(id))) return 'unknown-calendar';
      } else if (lookup.ok) {
        // A calendar typed by hand is tried once, so a mistyped ID is refused here and not at every later read.
        const had = new Set((await repo.state(accountId))?.readCalendars ?? ['primary']);
        for (const id of input.readCalendars) {
          if (had.has(id)) continue;
          // An ID nobody can check against a list reads with this person's grant: only they may aim it at a calendar.
          if (input.byOwnPerson === false) return 'not-theirs';
          const tried = await lookup.provider.readBusy({ calendarIds: [id], from: new Date(now()).toISOString(), to: new Date(now() + 60_000).toISOString() });
          if (isCalendarError(tried) && CALENDAR_LOST.has(tried.calendarError)) return 'unknown-calendar';
        }
      }
    }
    const bound = await bindAccount(account);
    const max: Detail = bound?.rule.sync.detail?.max ?? 'first-name+initial';
    const at = now();
    await repo.patch(
      accountId,
      {
        ...(input.readCalendars === undefined ? {} : { readCalendars: input.readCalendars }),
        ...(input.countAllDay === undefined ? {} : { countAllDay: input.countAllDay }),
        ...(input.detail === undefined ? {} : { detail: detailWithin(input.detail, max) }),
        ...(input.resume === true ? { paused: null, calendarLostCount: 0, calendarLostAt: null } : {}),
        nextPollAt: at,
      },
      at,
    );
    await deps.enqueue({ kind: CALENDAR_POLL_JOB, payload: { accountId }, dedupeKey: `calendar-poll:${accountId}`, maxAttempts: 1, priority: CALENDAR_JOB_PRIORITY });
    if (bound !== null && (input.detail !== undefined || input.resume === true)) await backfill(bound, account);
    return 'ok';
  }

  async function syncNow(accountId: string): Promise<void> {
    const state = await repo.state(accountId);
    if (state === null) return;
    const soonest = Math.max(now(), (state.readStartedAt ?? 0) + READ_FLOOR_MS);
    await repo.pullForward(accountId, soonest, state.noticeAt ?? 0);
    await deps.enqueue({ kind: CALENDAR_POLL_JOB, payload: { accountId }, dedupeKey: `calendar-poll:${accountId}`, maxAttempts: 1, runAt: soonest, priority: CALENDAR_JOB_PRIORITY });
  }

  /** A person's busy blocks, with no words, for the desk's grey blocks. */
  async function busyOfRow(target: { connectionId: string; tableName: string; rowKey: string }, from: string, to: string): Promise<Span[] | null> {
    const source = await deps.source(target.connectionId);
    if (source === null) return null;
    for (const id of syncedTables(source.view)) {
      const bound = bindIn(source, target.connectionId, id);
      if (bound?.resource.id !== target.tableName) continue;
      const value = await resourceValue(bound, target.rowKey);
      if (value === null || value === undefined) return [];
      const rows = await busyIn(bound.rule, bound.target, from, to, [value], (one) => one.engine !== undefined);
      return rows.map((one) => ({ start: one.start, end: one.end })).sort((a, b) => a.start - b.start);
    }
    return null;
  }

  /** The clashes of a booking table, kept ones marked. */
  async function clashes(connectionId: string, tableId: string): Promise<RowClash[] | null> {
    const bound = await bind(connectionId, tableId);
    return bound === null ? null : clashesOf(bound);
  }

  /** "Keep it": holds while this overlap stays exactly as it is. False: there is no such clash now. */
  async function keepClash(connectionId: string, tableId: string, input: { rowKey: string; overlapStart: number; overlapEnd: number; by: string }): Promise<boolean> {
    const bound = await bind(connectionId, tableId);
    if (bound === null) return false;
    const live = await clashesOf(bound);
    if (!live.some((clash) => clash.rowKey === input.rowKey && clash.overlapStart === input.overlapStart && clash.overlapEnd === input.overlapEnd)) return false;
    const row = await repo.ensureClash({ connectionId, tableName: tableId, rowKey: input.rowKey }, input.overlapStart, input.overlapEnd);
    await repo.keepClash(row.id, input.by, now());
    return true;
  }

  /** How many of a table's people are connected, by state: the Overview's card. Null: its rows do not connect. */
  async function connectionCounts(connectionId: string, resourceTable: string): Promise<{ connected: number; reconnect: number; connecting: number; partial: number; notConnected: number } | null> {
    const rule = await accounts.tableOf(connectionId, resourceTable);
    const source = await deps.source(connectionId);
    if (rule === null || source === null) return null;
    const counts = { connected: 0, reconnect: 0, connecting: 0, partial: 0, notConnected: 0 };
    const held = new Set<string>();
    let after: string | null = null;
    for (;;) {
      const page: ConnectedAccount[] = await accountsRepo.page(after, 200);
      if (page.length === 0) break;
      for (const account of page) {
        after = account.id;
        if (account.connectionId !== connectionId || account.tableName !== resourceTable || account.state === 'disconnecting') continue;
        held.add(account.rowKey);
        counts[account.state] += 1;
      }
      if (page.length < 200) break;
    }
    const table = source.view.table(resourceTable);
    const db = source.db;
    // Everyone who could connect: a person switched off is nobody's to chase.
    const rows = (await db.selectFrom(table.id).selectAll().limit(5_000).execute()) as Row[];
    for (const row of rows) {
      if (!accounts.rowIsLive(row, rule.rule) || held.has(rowKeyOf(table, row))) continue;
      counts.notConnected += 1;
    }
    return counts;
  }

  /**
   * Attaches a demo calendar to a row, with no outside account: a sample, a
   * contract or the gate. Refused where this server offers no demo.
   */
  async function attachDemo(target: { connectionId: string; tableName: string; rowKey: string }): Promise<ConnectedAccount | null> {
    if (deps.demo === null) return null;
    const table = await accounts.tableOf(target.connectionId, target.tableName);
    if (table === null) return null;
    const app = await manifestsRepo(meta, accounts.crypto).findInScope(table.appKey, target.connectionId);
    if (app === null) return null;
    const held = await accountsRepo.forTarget(target);
    if (held[0] !== undefined) return held[0];
    const subject = `${DEMO_CALENDAR_SUBJECT_PREFIX}${createHash('sha256').update(`${target.connectionId}|${target.tableName}|${target.rowKey}`).digest('hex').slice(0, 24)}`;
    deps.demo.ensure(subject);
    const at = now();
    const link = await accountsRepo.mintLink({ ...target, providers: ['demo'], purpose: 'connect', tokenHash: randomBytes(32).toString('hex'), createdBy: null, expiresAt: at + 60_000 }, at);
    const account = await accountsRepo.connect(
      {
        manifestId: app.row.id,
        target,
        subject,
        address: `${subject.slice(DEMO_CALENDAR_SUBJECT_PREFIX.length)}@demo.invalid`,
        tokens: { accessToken: 'demo', refreshToken: 'demo' },
        expiresAt: null,
        refreshExpiresAt: null,
        scopes: null,
        state: 'connected',
      },
      link.id,
      at,
    );
    if (account !== null) await onConnected(account);
    return account === null ? null : await accountsRepo.find(account.id);
  }

  return {
    repo,
    syncRow,
    readAccount,
    onConnected,
    onRecordEvent,
    onErased,
    plan,
    sweep,
    daily,
    receiveHook,
    stateOfRow,
    /** When this account's calendar was last read, for the add-on's page. */
    lastSyncedOf: async (accountId: string): Promise<number | null> => (await repo.state(accountId))?.lastSyncedAt ?? null,
    busyOfRow,
    setChoices,
    syncNow,
    clashes,
    keepClash,
    connectionCounts,
    attachDemo,
    bind,
    /** The demo backend, where this server offers it. */
    demo: deps.demo,
    /** The accounts service this sync runs on: a test ends a connection the way the door does. */
    accountsForTest: accounts,
    providerKeyOf: (account: ConnectedAccount) => providerKeyOf(providerDeps, account),
  };
}

export type CalendarSync = ReturnType<typeof createCalendarSync>;
