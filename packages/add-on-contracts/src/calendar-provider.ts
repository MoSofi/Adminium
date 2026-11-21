// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `calendar-provider@1` — one calendar service, as the engine's sync uses it.
 *
 * ─── WHAT A PROVIDER IS HANDED ──────────────────────────────────────────────
 * A factory is called per operation with an HTTP client that adds the bearer
 * header itself. A provider never holds a token, a refresh token or the client
 * secret, and there is no `authorize` or `refresh` here: the core runs both.
 *
 * ─── ANSWERS ARE DATA ───────────────────────────────────────────────────────
 * Every answer is parsed with the strict schema below before anyone believes
 * it. A refusal is a {@link CalendarError}, never a throw. A throw and an answer
 * outside the schema both read as `UNAVAILABLE`.
 *
 * ─── A BUSY TIME HAS NO WORDS ───────────────────────────────────────────────
 * {@link busyIntervalSchema} is strict and holds no free text, so what a
 * person's own event is called cannot be stored, even by a provider that was
 * sent it. A provider reports `kind` and `allDay`; the core decides what counts.
 *
 * ─── WHAT A PROVIDER CAN KNOW ───────────────────────────────────────────────
 * {@link CalendarTraits} says how this provider reads busy times, so a provider
 * can change its read (Google's free/busy query, or an event list under a
 * narrower permission) without the core changing:
 *  - `listsCalendars`: it can name the person's calendars to choose from;
 *  - `allDayKnown`: its busy times say whether they are all-day;
 *  - `busyPush`: a change to a busy time is pushed, rather than found by polling.
 */
import { z } from 'zod';

export const CALENDAR_PROVIDER_CONTRACT = 'calendar-provider';
export const CALENDAR_PROVIDER_VERSION = 1;
/** The name a provider's server module exports its factory under. */
export const CALENDAR_PROVIDER_FACTORY = 'createCalendarProvider';

export const CALENDAR_ERROR_CODES = [
  /** The token was refused. The core's client has already refreshed once; this changes no account's state. */
  'UNAUTHORIZED',
  'PERMISSION_MISSING',
  /** The calendar Adminium made is gone. */
  'CALENDAR_MISSING',
  'EVENT_MISSING',
  /** A cursor is too old: read again from the start. */
  'CURSOR_GONE',
  'RATE_LIMITED',
  'UNAVAILABLE',
  'INVALID_REQUEST',
  'CONFLICT',
] as const;
export type CalendarErrorCode = (typeof CALENDAR_ERROR_CODES)[number];

export interface CalendarError {
  calendarError: CalendarErrorCode;
  /** How long the service asked to be left alone. */
  retryAfterMs?: number;
}

export const calendarErrorSchema = z
  .object({
    calendarError: z.enum(CALENDAR_ERROR_CODES),
    retryAfterMs: z.number().int().min(0).max(86_400_000).optional(),
  })
  .strict();

export function calendarError(code: CalendarErrorCode, retryAfterMs?: number): CalendarError {
  return retryAfterMs === undefined ? { calendarError: code } : { calendarError: code, retryAfterMs };
}

export function isCalendarError(value: unknown): value is CalendarError {
  return typeof value === 'object' && value !== null && 'calendarError' in value;
}

export type CalendarAnswer<T> = T | CalendarError;

/** A moment, always with its zone: never a wall clock. */
const instant = z.string().max(40).datetime({ offset: true });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const remoteId = z.string().min(1).max(1024);
const calendarId = z.string().min(1).max(512);
/** Bounds a provider's own version mark, which the core only compares. */
const etag = z.string().min(1).max(256);

export const calendarTraitsSchema = z
  .object({
    listsCalendars: z.boolean(),
    allDayKnown: z.boolean(),
    busyPush: z.boolean(),
  })
  .strict();
export type CalendarTraits = z.infer<typeof calendarTraitsSchema>;

export const identifyAnswerSchema = z
  .object({
    label: z.string().min(1).max(320).nullable(),
    scopes: z.array(z.string().min(1).max(255)).max(32).nullable(),
  })
  .strict();
export type IdentifyAnswer = z.infer<typeof identifyAnswerSchema>;

export const calendarEntrySchema = z
  .object({
    id: calendarId,
    name: z.string().min(1).max(256),
    primary: z.boolean(),
    writable: z.boolean(),
  })
  .strict();
export type CalendarEntry = z.infer<typeof calendarEntrySchema>;

export const listCalendarsAnswerSchema = z.object({ calendars: z.array(calendarEntrySchema).max(250) }).strict();
export type ListCalendarsAnswer = z.infer<typeof listCalendarsAnswerSchema>;

export const ensureCalendarAnswerSchema = z.object({ calendarId }).strict();
export type EnsureCalendarAnswer = z.infer<typeof ensureCalendarAnswerSchema>;

export const upsertEventAnswerSchema = z.object({ remoteId, etag: etag.nullable() }).strict();
export type UpsertEventAnswer = z.infer<typeof upsertEventAnswerSchema>;

export const deleteEventAnswerSchema = z.object({ deleted: z.literal(true) }).strict();
export type DeleteEventAnswer = z.infer<typeof deleteEventAnswerSchema>;

export const ownEventSchema = z
  .object({
    remoteId,
    /** The key the core gave the event, when the service kept it. */
    key: z.string().min(1).max(128).nullable(),
    start: instant.nullable(),
    end: instant.nullable(),
    etag: etag.nullable(),
    deleted: z.boolean(),
  })
  .strict();
export type OwnEvent = z.infer<typeof ownEventSchema>;

export const listOwnEventsAnswerSchema = z
  .object({
    events: z.array(ownEventSchema).max(2_500),
    /** Where the next read starts. */
    cursor: z.string().min(1).max(4096).nullable(),
    /** More pages follow this one. */
    more: z.boolean(),
  })
  .strict();
export type ListOwnEventsAnswer = z.infer<typeof listOwnEventsAnswerSchema>;

/** How a calendar marks a time. Only `busy` and `away` take the person's time. */
export const BUSY_KINDS = ['busy', 'away', 'tentative', 'free', 'elsewhere'] as const;
export type BusyKind = (typeof BUSY_KINDS)[number];

/**
 * One busy time, with no words. A timed one is two instants. An all-day one
 * is a pair of dates (`endDate` the day after its last), because only the core
 * knows the venue's zone and how long that day is. `allDay: 'unknown'` is a
 * provider that cannot tell, and always counts.
 */
export const busyIntervalSchema = z.union([
  z
    .object({
      allDay: z.union([z.literal(false), z.literal('unknown')]),
      start: instant,
      end: instant,
      kind: z.enum(BUSY_KINDS),
    })
    .strict(),
  z
    .object({
      allDay: z.literal(true),
      date: day,
      endDate: day,
      kind: z.enum(BUSY_KINDS),
    })
    .strict(),
]);
export type BusyInterval = z.infer<typeof busyIntervalSchema>;

export const readBusyAnswerSchema = z.object({ intervals: z.array(busyIntervalSchema).max(5_000) }).strict();
export type ReadBusyAnswer = z.infer<typeof readBusyAnswerSchema>;

export const watchAnswerSchema = z
  .object({
    /** The service's own id for the channel, when it has one. */
    remoteChannelId: z.string().min(1).max(512).nullable(),
    /** A resource the service names, needed to stop the channel. */
    resourceId: z.string().min(1).max(1024).nullable(),
    /** When it ends, as the service said. Never assumed. */
    expiresAt: instant,
  })
  .strict();
export type WatchAnswer = z.infer<typeof watchAnswerSchema>;

export const renewAnswerSchema = z.object({ expiresAt: instant }).strict();
export type RenewAnswer = z.infer<typeof renewAnswerSchema>;

export const unwatchAnswerSchema = z.object({ stopped: z.literal(true) }).strict();
export type UnwatchAnswer = z.infer<typeof unwatchAnswerSchema>;

export const HOOK_NOTICE_KINDS = ['changed', 'sync', 'reauthorize', 'removed', 'missed'] as const;
export type HookNoticeKind = (typeof HOOK_NOTICE_KINDS)[number];

/**
 * What a delivery says, read without believing it: the core finds the channel
 * by the address it was sent to and compares `secret` itself.
 * `handshake`: the text a service wants echoed when a channel is being made.
 */
export const hookAnswerSchema = z
  .object({
    handshake: z.string().min(1).max(512).regex(/^[\x21-\x7e]+$/).nullable(),
    notices: z
      .array(
        z
          .object({
            secret: z.string().min(1).max(512).nullable(),
            kind: z.enum(HOOK_NOTICE_KINDS),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type HookAnswer = z.infer<typeof hookAnswerSchema>;

export interface UpsertEventInput {
  calendarId: string;
  /** Minted by the core; the same key for the same event, so a retry cannot make a second one. */
  key: string;
  remoteId: string | null;
  /** UTC instants. */
  start: string;
  end: string;
  /** The venue's IANA zone. */
  zone: string;
  /** All an event carries: no attendee, place, description or reminder. */
  title: string;
}

export interface WatchInput {
  /** `own`: the calendar Adminium made. `busy`: what counts as the person's busy time. */
  target: 'own' | 'busy';
  calendarIds: string[];
  /** Minted by the core. */
  channelId: string;
  /** Minted by the core: presented back on every delivery. */
  secret: string;
  /** Where the service calls. */
  address: string;
}

export interface ChannelRef {
  channelId: string;
  remoteChannelId: string | null;
  resourceId: string | null;
  /** The address of the channel, for a service that re-registers it. */
  address: string;
  secret: string;
}

export interface HookDelivery {
  headers: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
  rawBody: string;
}

/** One calendar service, for one account and one operation. */
export interface CalendarProvider {
  readonly key: string;
  readonly traits: CalendarTraits;
  identify(): Promise<CalendarAnswer<IdentifyAnswer>>;
  listCalendars(): Promise<CalendarAnswer<ListCalendarsAnswer>>;
  /** The calendar Adminium writes to: reused, renamed, never a second one. */
  ensureCalendar(input: { name: string; knownId: string | null }): Promise<CalendarAnswer<EnsureCalendarAnswer>>;
  upsertEvent(input: UpsertEventInput): Promise<CalendarAnswer<UpsertEventAnswer>>;
  deleteEvent(input: { calendarId: string; remoteId: string }): Promise<CalendarAnswer<DeleteEventAnswer>>;
  /** The events of the calendar Adminium made. */
  listOwnEvents(input: { calendarId: string; cursor: string | null }): Promise<CalendarAnswer<ListOwnEventsAnswer>>;
  /** Everything busy in `[from, to)`, whole. A read that could not finish is an error, never part of an answer. */
  readBusy(input: { calendarIds: string[]; from: string; to: string }): Promise<CalendarAnswer<ReadBusyAnswer>>;
  watch(input: WatchInput): Promise<CalendarAnswer<WatchAnswer>>;
  renew(input: ChannelRef): Promise<CalendarAnswer<RenewAnswer>>;
  unwatch(input: ChannelRef): Promise<CalendarAnswer<UnwatchAnswer>>;
  /** Reads a delivery. Pure: no call, no state. */
  readHook(delivery: HookDelivery): CalendarAnswer<HookAnswer>;
}

/** What a factory is handed. */
export interface CalendarProviderInput {
  /** Adds the bearer header, on the hosts the manifest declares. */
  http: (input: string | URL, init?: RequestInit) => Promise<Response>;
}

export type CreateCalendarProvider = (input: CalendarProviderInput) => CalendarProvider;

/** The schema of each call's answer, for the core's guard and the conformance kit. */
export const CALENDAR_ANSWER_SCHEMAS = {
  identify: identifyAnswerSchema,
  listCalendars: listCalendarsAnswerSchema,
  ensureCalendar: ensureCalendarAnswerSchema,
  upsertEvent: upsertEventAnswerSchema,
  deleteEvent: deleteEventAnswerSchema,
  listOwnEvents: listOwnEventsAnswerSchema,
  readBusy: readBusyAnswerSchema,
  watch: watchAnswerSchema,
  renew: renewAnswerSchema,
  unwatch: unwatchAnswerSchema,
  readHook: hookAnswerSchema,
} as const;
export type CalendarCall = keyof typeof CALENDAR_ANSWER_SCHEMAS;

/**
 * A provider whose every answer is checked. A throw is a service that could
 * not answer; an answer outside the schema is one Adminium cannot believe.
 * Both are `UNAVAILABLE`, and neither carries what the provider said.
 */
export function guardCalendarProvider(inner: CalendarProvider, log?: (message: string, fields: Record<string, unknown>) => void): CalendarProvider {
  const outside = (call: CalendarCall): CalendarError => {
    log?.('calendar provider answered outside its contract', { key: inner.key, call });
    return calendarError('UNAVAILABLE');
  };
  const judged = <T>(call: CalendarCall, answer: unknown): CalendarAnswer<T> => {
    if (isCalendarError(answer)) {
      const parsed = calendarErrorSchema.safeParse(answer);
      return parsed.success ? (parsed.data as CalendarError) : outside(call);
    }
    const parsed = CALENDAR_ANSWER_SCHEMAS[call].safeParse(answer);
    return parsed.success ? (parsed.data as T) : outside(call);
  };
  async function checked<T>(call: CalendarCall, run: () => Promise<unknown>): Promise<CalendarAnswer<T>> {
    let answer: unknown;
    try {
      answer = await run();
    } catch {
      log?.('calendar provider call threw', { key: inner.key, call });
      return calendarError('UNAVAILABLE');
    }
    return judged<T>(call, answer);
  }
  const traits = calendarTraitsSchema.safeParse(inner.traits);
  return {
    key: inner.key,
    // Traits a provider cannot state read as the least it could do.
    traits: traits.success ? traits.data : { listsCalendars: false, allDayKnown: false, busyPush: false },
    identify: () => checked('identify', () => inner.identify()),
    listCalendars: () => checked('listCalendars', () => inner.listCalendars()),
    ensureCalendar: (input) => checked('ensureCalendar', () => inner.ensureCalendar(input)),
    upsertEvent: (input) => checked('upsertEvent', () => inner.upsertEvent(input)),
    deleteEvent: (input) => checked('deleteEvent', () => inner.deleteEvent(input)),
    listOwnEvents: (input) => checked('listOwnEvents', () => inner.listOwnEvents(input)),
    readBusy: (input) => checked('readBusy', () => inner.readBusy(input)),
    watch: (input) => checked('watch', () => inner.watch(input)),
    renew: (input) => checked('renew', () => inner.renew(input)),
    unwatch: (input) => checked('unwatch', () => inner.unwatch(input)),
    readHook(delivery) {
      try {
        return judged<HookAnswer>('readHook', inner.readHook(delivery));
      } catch {
        log?.('calendar provider call threw', { key: inner.key, call: 'readHook' });
        return calendarError('UNAVAILABLE');
      }
    },
  };
}
