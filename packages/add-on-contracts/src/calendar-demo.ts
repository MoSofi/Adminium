// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The built-in demo calendar: a `calendar-provider@1` that talks to a backend
 * held in this process. The sync's gate, the conformance suite, an app's sync
 * contract and its sample figures run on it, with no outside account.
 *
 * It behaves as the real services do where that changes the core's work: a
 * key of a deleted event cannot be used again, a channel ends on its own, a
 * delivery carries only the secret, and a read either answers whole or fails.
 * Nothing here is secret or kept: a restart empties it.
 */
import {
  calendarError,
  type BusyInterval,
  type CalendarAnswer,
  type CalendarEntry,
  type CalendarErrorCode,
  type CalendarProvider,
  type CalendarTraits,
  type ChannelRef,
  type HookAnswer,
  type HookDelivery,
  type OwnEvent,
  type UpsertEventInput,
  type WatchInput,
} from './calendar-provider.js';

/** The key the demo provider is known by. Never an add-on's. */
export const DEMO_CALENDAR_KEY = 'demo';
/** An account's subject when it is the demo's: never one a real sign-in gives. */
export const DEMO_CALENDAR_SUBJECT_PREFIX = 'demo:';
/** The header a demo delivery carries its secret in. */
export const DEMO_CALENDAR_SECRET_HEADER = 'x-demo-channel-token';
const OWN_CALENDAR = 'adminium-own';
const CHANNEL_MS = 7 * 86_400_000;

/** Every trait on: what a service that can do all of it answers. */
export const DEMO_CALENDAR_TRAITS: CalendarTraits = { listsCalendars: true, allDayKnown: true, busyPush: true };

interface DemoEvent {
  remoteId: string;
  key: string;
  calendarId: string;
  start: string;
  end: string;
  title: string;
  zone: string;
  etag: string;
  deleted: boolean;
  serial: number;
}

interface DemoChannel {
  channelId: string;
  target: 'own' | 'busy';
  secret: string;
  address: string;
  expiresAt: number;
  stopped: boolean;
}

interface DemoAccount {
  traits: CalendarTraits;
  ownCalendar: { id: string; name: string } | null;
  calendars: CalendarEntry[];
  /** What each calendar holds as busy, by calendar id. */
  busy: Map<string, BusyInterval[]>;
  events: Map<string, DemoEvent>;
  keys: Map<string, string>;
  channels: Map<string, DemoChannel>;
  serial: number;
  /** The next calls of a kind that fail, oldest first. */
  failures: { call: string; code: CalendarErrorCode; retryAfterMs?: number }[];
  /** How many calls of each kind were made. */
  calls: Map<string, number>;
}

export interface DemoCalendarBackend {
  /** A provider for one account of the demo. */
  providerFor(account: string): CalendarProvider;
  /** Makes an account, with one main calendar, if it is not there. */
  ensure(account: string, traits?: CalendarTraits): void;
  setTraits(account: string, traits: CalendarTraits): void;
  addCalendar(account: string, entry: CalendarEntry): void;
  /** Replaces what a calendar holds as busy. */
  setBusy(account: string, calendarId: string, intervals: readonly BusyInterval[]): void;
  /** The account's events in the calendar Adminium made, the deleted ones left out. */
  events(account: string): { remoteId: string; key: string; start: string; end: string; title: string; etag: string }[];
  /** A person editing an event in their own calendar. */
  editEvent(account: string, remoteId: string, change: { start?: string; end?: string }): void;
  /** A person deleting an event in their own calendar. */
  deleteEvent(account: string, remoteId: string): void;
  /** A person deleting the whole calendar Adminium made. */
  deleteOwnCalendar(account: string): void;
  ownCalendar(account: string): { id: string; name: string } | null;
  /** The next call of this kind answers with this error. */
  failNext(account: string, call: string, code: CalendarErrorCode, retryAfterMs?: number): void;
  callCount(account: string, call: string): number;
  /** The live channels of an account. */
  channels(account: string): { channelId: string; target: 'own' | 'busy'; address: string; expiresAt: number }[];
  /** What the service would send for a channel. */
  delivery(account: string, channelId: string): HookDelivery;
  /** Removes everything: a test's fresh start. */
  reset(): void;
}

export function createDemoCalendarBackend(options: { now?: () => number } = {}): DemoCalendarBackend {
  const now = options.now ?? Date.now;
  const accounts = new Map<string, DemoAccount>();
  let counter = 0;
  const next = (prefix: string) => `${prefix}-${String(++counter)}`;

  function held(account: string): DemoAccount {
    let found = accounts.get(account);
    if (found === undefined) {
      found = {
        traits: { ...DEMO_CALENDAR_TRAITS },
        ownCalendar: null,
        calendars: [{ id: 'primary', name: 'Main calendar', primary: true, writable: true }],
        busy: new Map(),
        events: new Map(),
        keys: new Map(),
        channels: new Map(),
        serial: 0,
        failures: [],
        calls: new Map(),
      };
      accounts.set(account, found);
    }
    return found;
  }

  /** Counts the call, and answers with a planned failure if one is due. */
  function enter(state: DemoAccount, call: string): { calendarError: CalendarErrorCode; retryAfterMs?: number } | null {
    state.calls.set(call, (state.calls.get(call) ?? 0) + 1);
    const at = state.failures.findIndex((failure) => failure.call === call);
    if (at === -1) return null;
    const [failure] = state.failures.splice(at, 1);
    return calendarError(failure!.code, failure!.retryAfterMs);
  }

  const toOwn = (event: DemoEvent): OwnEvent => ({ remoteId: event.remoteId, key: event.key, start: event.start, end: event.end, etag: event.etag, deleted: event.deleted });

  function overlaps(interval: BusyInterval, from: number, to: number): boolean {
    const start = interval.allDay === true ? Date.parse(`${interval.date}T00:00:00Z`) : Date.parse(interval.start);
    const end = interval.allDay === true ? Date.parse(`${interval.endDate}T00:00:00Z`) : Date.parse(interval.end);
    return start < to && end > from;
  }

  function providerFor(account: string): CalendarProvider {
    const state = held(account);
    return {
      key: DEMO_CALENDAR_KEY,
      get traits() {
        return state.traits;
      },
      async identify() {
        return enter(state, 'identify') ?? { label: `${account}@demo.invalid`, scopes: ['demo'] };
      },
      async listCalendars() {
        const failed = enter(state, 'listCalendars');
        if (failed !== null) return failed;
        if (!state.traits.listsCalendars) return calendarError('PERMISSION_MISSING');
        // The calendar Adminium made is never offered as one to read.
        return { calendars: state.calendars.map((entry) => ({ ...entry })) };
      },
      async ensureCalendar(input) {
        const failed = enter(state, 'ensureCalendar');
        if (failed !== null) return failed;
        if (state.ownCalendar !== null && (input.knownId === null || input.knownId === state.ownCalendar.id)) {
          state.ownCalendar.name = input.name;
          return { calendarId: state.ownCalendar.id };
        }
        if (state.ownCalendar !== null) return { calendarId: state.ownCalendar.id };
        state.ownCalendar = { id: `${OWN_CALENDAR}-${next('c')}`, name: input.name };
        return { calendarId: state.ownCalendar.id };
      },
      async upsertEvent(input: UpsertEventInput) {
        const failed = enter(state, 'upsertEvent');
        if (failed !== null) return failed;
        if (state.ownCalendar === null || state.ownCalendar.id !== input.calendarId) return calendarError('CALENDAR_MISSING');
        const existingId = input.remoteId ?? state.keys.get(input.key) ?? null;
        const existing = existingId === null ? undefined : state.events.get(existingId);
        if (input.remoteId !== null && (existing === undefined || existing.deleted)) return calendarError('EVENT_MISSING');
        // A key whose event was deleted cannot be used for a new one, as a client-chosen id cannot.
        if (input.remoteId === null && existing?.deleted === true) return calendarError('CONFLICT');
        state.serial += 1;
        const etag = `etag-${String(state.serial)}`;
        if (existing !== undefined) {
          Object.assign(existing, { start: input.start, end: input.end, title: input.title, zone: input.zone, etag, serial: state.serial });
          return { remoteId: existing.remoteId, etag };
        }
        const remoteId = next('event');
        state.events.set(remoteId, { remoteId, key: input.key, calendarId: input.calendarId, start: input.start, end: input.end, title: input.title, zone: input.zone, etag, deleted: false, serial: state.serial });
        state.keys.set(input.key, remoteId);
        return { remoteId, etag };
      },
      async deleteEvent(input) {
        const failed = enter(state, 'deleteEvent');
        if (failed !== null) return failed;
        if (state.ownCalendar === null || state.ownCalendar.id !== input.calendarId) return calendarError('CALENDAR_MISSING');
        const event = state.events.get(input.remoteId);
        if (event === undefined || event.deleted) return calendarError('EVENT_MISSING');
        state.serial += 1;
        event.deleted = true;
        event.serial = state.serial;
        return { deleted: true as const };
      },
      async listOwnEvents(input) {
        const failed = enter(state, 'listOwnEvents');
        if (failed !== null) return failed;
        if (state.ownCalendar === null || state.ownCalendar.id !== input.calendarId) return calendarError('CALENDAR_MISSING');
        const since = input.cursor === null ? 0 : Number(input.cursor);
        if (!Number.isFinite(since) || since > state.serial) return calendarError('CURSOR_GONE');
        const events = [...state.events.values()].filter((event) => event.calendarId === input.calendarId && event.serial > since).sort((a, b) => a.serial - b.serial).map(toOwn);
        return { events, cursor: String(state.serial), more: false };
      },
      async readBusy(input) {
        const failed = enter(state, 'readBusy');
        if (failed !== null) return failed;
        const from = Date.parse(input.from);
        const to = Date.parse(input.to);
        const intervals = input.calendarIds.flatMap((id) => (state.busy.get(id) ?? []).filter((interval) => overlaps(interval, from, to)));
        return {
          // A service that cannot tell an all-day time from any other says so.
          intervals: intervals.map((interval) => {
            if (state.traits.allDayKnown) return { ...interval };
            if (interval.allDay === true) return { allDay: 'unknown' as const, start: `${interval.date}T00:00:00Z`, end: `${interval.endDate}T00:00:00Z`, kind: interval.kind };
            return { ...interval, allDay: 'unknown' as const };
          }),
        };
      },
      async watch(input: WatchInput) {
        const failed = enter(state, 'watch');
        if (failed !== null) return failed;
        if (input.target === 'busy' && !state.traits.busyPush) return calendarError('PERMISSION_MISSING');
        const expiresAt = now() + CHANNEL_MS;
        state.channels.set(input.channelId, { channelId: input.channelId, target: input.target, secret: input.secret, address: input.address, expiresAt, stopped: false });
        return { remoteChannelId: `remote-${input.channelId}`, resourceId: `resource-${input.channelId}`, expiresAt: new Date(expiresAt).toISOString() };
      },
      async renew(input: ChannelRef) {
        const failed = enter(state, 'renew');
        if (failed !== null) return failed;
        const channel = state.channels.get(input.channelId);
        if (channel === undefined || channel.stopped) return calendarError('EVENT_MISSING');
        channel.expiresAt = now() + CHANNEL_MS;
        return { expiresAt: new Date(channel.expiresAt).toISOString() };
      },
      async unwatch(input: ChannelRef) {
        const failed = enter(state, 'unwatch');
        if (failed !== null) return failed;
        const channel = state.channels.get(input.channelId);
        if (channel !== undefined) channel.stopped = true;
        return { stopped: true as const };
      },
      readHook: readDemoHook,
    };
  }

  return {
    providerFor,
    ensure(account, traits) {
      const state = held(account);
      if (traits !== undefined) state.traits = { ...traits };
    },
    setTraits(account, traits) {
      held(account).traits = { ...traits };
    },
    addCalendar(account, entry) {
      const state = held(account);
      if (!state.calendars.some((one) => one.id === entry.id)) state.calendars.push({ ...entry });
    },
    setBusy(account, calendarId, intervals) {
      held(account).busy.set(calendarId, intervals.map((interval) => ({ ...interval })));
    },
    events(account) {
      return [...held(account).events.values()]
        .filter((event) => !event.deleted)
        .map(({ remoteId, key, start, end, title, etag }) => ({ remoteId, key, start, end, title, etag }));
    },
    editEvent(account, remoteId, change) {
      const state = held(account);
      const event = state.events.get(remoteId);
      if (event === undefined) return;
      state.serial += 1;
      Object.assign(event, change, { etag: `etag-${String(state.serial)}`, serial: state.serial });
    },
    deleteEvent(account, remoteId) {
      const state = held(account);
      const event = state.events.get(remoteId);
      if (event === undefined) return;
      state.serial += 1;
      event.deleted = true;
      event.serial = state.serial;
    },
    deleteOwnCalendar(account) {
      const state = held(account);
      state.ownCalendar = null;
      for (const event of state.events.values()) event.deleted = true;
    },
    ownCalendar: (account) => {
      const own = held(account).ownCalendar;
      return own === null ? null : { ...own };
    },
    failNext(account, call, code, retryAfterMs) {
      held(account).failures.push({ call, code, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) });
    },
    callCount: (account, call) => held(account).calls.get(call) ?? 0,
    channels: (account) =>
      [...held(account).channels.values()]
        .filter((channel) => !channel.stopped)
        .map(({ channelId, target, address, expiresAt }) => ({ channelId, target, address, expiresAt })),
    delivery(account, channelId) {
      const channel = held(account).channels.get(channelId);
      return { headers: { [DEMO_CALENDAR_SECRET_HEADER]: channel?.secret }, query: {}, rawBody: '' };
    },
    reset() {
      accounts.clear();
    },
  };
}

/** Reads a demo delivery: the handshake, or a notice with the secret it carried. */
export function readDemoHook(delivery: HookDelivery): CalendarAnswer<HookAnswer> {
  const handshake = delivery.query['validationToken'];
  if (handshake !== undefined && handshake !== '') return { handshake, notices: [] };
  const told = delivery.headers['x-demo-kind'];
  const kind = told === 'reauthorize' || told === 'removed' || told === 'missed' ? told : 'changed';
  return { handshake: null, notices: [{ secret: delivery.headers[DEMO_CALENDAR_SECRET_HEADER] ?? null, kind }] };
}
