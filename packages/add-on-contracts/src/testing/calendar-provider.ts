// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `calendar-provider@1` conformance suite.
 *
 * Every provider runs it against itself: the demo provider in this package,
 * and each real one in its own add-on (against recorded answers). A DRIVER
 * plays the person at their calendar, because only they can add a busy time
 * or delete an event there. A driver that cannot do something leaves it out,
 * and the cases that need it are skipped by name.
 *
 * What it holds a provider to:
 *   - every answer parses with the contract's schema, and a refusal is data;
 *   - the calendar is reused, never made twice;
 *   - the same key gives the same event, so a retry makes no second one;
 *   - a busy read carries no words, and answers whole;
 *   - an unknown event is `EVENT_MISSING`, a lost calendar `CALENDAR_MISSING`;
 *   - a delivery is read without being believed, and nothing is echoed that
 *     could not be sent back safely.
 */
import { describe, expect, it } from 'vitest';

import {
  CALENDAR_ANSWER_SCHEMAS,
  calendarErrorSchema,
  isCalendarError,
  type BusyInterval,
  type CalendarAnswer,
  type CalendarCall,
  type CalendarProvider,
  type HookDelivery,
} from '../calendar-provider.js';

export interface CalendarConformanceDriver {
  /** A busy time in the person's main calendar, between two instants. */
  addBusy?(input: { calendarId: string; start: string; end: string }): Promise<void>;
  /** The person deletes an event in their own calendar. */
  deleteEventOutside?(remoteId: string): Promise<void>;
  /** The person deletes the calendar Adminium made. */
  deleteCalendarOutside?(calendarId: string): Promise<void>;
  /** A genuine delivery for a channel made with this secret. */
  deliveryFor?(input: { channelId: string; secret: string }): HookDelivery;
}

export interface CalendarConformanceOptions {
  name: string;
  /** Builds a provider for one operation, as the engine does. */
  make: () => CalendarProvider;
  driver: CalendarConformanceDriver;
  /** The calendar a busy time is read from. */
  mainCalendar: string;
  /** Words a provider's busy answer must never hold. */
  forbiddenWords?: readonly string[];
  /**
   * `false`: this service's permissions cannot name a person's calendars, so a
   * calendar whose id was lost cannot be found again and a new one is made.
   */
  findsLostCalendar?: boolean;
}

function answered<T>(call: CalendarCall, answer: CalendarAnswer<T>): T {
  if (isCalendarError(answer)) throw new Error(`${call} refused: ${answer.calendarError}`);
  const parsed = CALENDAR_ANSWER_SCHEMAS[call].safeParse(answer);
  if (!parsed.success) throw new Error(`${call} answered outside its schema: ${parsed.error.message}`);
  return answer;
}

function refusedWith(answer: unknown, code: string): void {
  expect(isCalendarError(answer)).toBe(true);
  expect(calendarErrorSchema.safeParse(answer).success).toBe(true);
  expect((answer as { calendarError: string }).calendarError).toBe(code);
}

const HOUR = 3_600_000;
const iso = (at: number) => new Date(at).toISOString();

export function calendarProviderConformance(options: CalendarConformanceOptions): void {
  const { make, driver, mainCalendar } = options;
  const when = (ready: unknown) => (ready === undefined ? it.skip : it);
  const base = Date.UTC(2030, 0, 7, 9);
  let serial = 0;
  const event = (calendarId: string, remoteId: string | null = null, key = `conformance-${String(++serial)}`) => ({
    calendarId,
    key,
    remoteId,
    start: iso(base),
    end: iso(base + HOUR),
    zone: 'UTC',
    title: 'Conformance visit',
  });

  describe(`calendar-provider@1 — ${options.name}`, () => {
    it('states its traits', () => {
      const { traits } = make();
      expect(typeof traits.listsCalendars).toBe('boolean');
      expect(typeof traits.allDayKnown).toBe('boolean');
      expect(typeof traits.busyPush).toBe('boolean');
    });

    it('identifies the account', async () => {
      answered('identify', await make().identify());
    });

    it('lists calendars, or refuses when it cannot', async () => {
      const provider = make();
      const answer = await provider.listCalendars();
      if (provider.traits.listsCalendars) answered('listCalendars', answer);
      else refusedWith(answer, 'PERMISSION_MISSING');
    });

    it('makes its calendar once, and renames it', async () => {
      const first = answered('ensureCalendar', await make().ensureCalendar({ name: 'Conformance', knownId: null }));
      const again = answered('ensureCalendar', await make().ensureCalendar({ name: 'Conformance renamed', knownId: first.calendarId }));
      expect(again.calendarId).toBe(first.calendarId);
      const lost = answered('ensureCalendar', await make().ensureCalendar({ name: 'Conformance renamed', knownId: null }));
      if (options.findsLostCalendar !== false) expect(lost.calendarId).toBe(first.calendarId);
    });

    it('the same key gives the same event', async () => {
      const { calendarId } = answered('ensureCalendar', await make().ensureCalendar({ name: 'Conformance', knownId: null }));
      const input = event(calendarId);
      const first = answered('upsertEvent', await make().upsertEvent(input));
      const second = answered('upsertEvent', await make().upsertEvent(input));
      expect(second.remoteId).toBe(first.remoteId);
    });

    it('an update changes the event it names', async () => {
      const { calendarId } = answered('ensureCalendar', await make().ensureCalendar({ name: 'Conformance', knownId: null }));
      const input = event(calendarId);
      const made = answered('upsertEvent', await make().upsertEvent(input));
      const moved = answered('upsertEvent', await make().upsertEvent({ ...input, remoteId: made.remoteId, start: iso(base + HOUR), end: iso(base + 2 * HOUR) }));
      expect(moved.remoteId).toBe(made.remoteId);
    });

    it('a deleted or unknown event is EVENT_MISSING', async () => {
      const { calendarId } = answered('ensureCalendar', await make().ensureCalendar({ name: 'Conformance', knownId: null }));
      const made = answered('upsertEvent', await make().upsertEvent(event(calendarId)));
      answered('deleteEvent', await make().deleteEvent({ calendarId, remoteId: made.remoteId }));
      refusedWith(await make().deleteEvent({ calendarId, remoteId: made.remoteId }), 'EVENT_MISSING');
      refusedWith(await make().upsertEvent(event(calendarId, made.remoteId)), 'EVENT_MISSING');
    });

    it('lists its own events from a cursor, with deletions', async () => {
      const { calendarId } = answered('ensureCalendar', await make().ensureCalendar({ name: 'Conformance', knownId: null }));
      const start = answered('listOwnEvents', await make().listOwnEvents({ calendarId, cursor: null }));
      const made = answered('upsertEvent', await make().upsertEvent(event(calendarId)));
      const after = answered('listOwnEvents', await make().listOwnEvents({ calendarId, cursor: start.cursor }));
      expect(after.events.some((one) => one.remoteId === made.remoteId && !one.deleted)).toBe(true);
      answered('deleteEvent', await make().deleteEvent({ calendarId, remoteId: made.remoteId }));
      const gone = answered('listOwnEvents', await make().listOwnEvents({ calendarId, cursor: after.cursor }));
      expect(gone.events.some((one) => one.remoteId === made.remoteId && one.deleted)).toBe(true);
    });

    when(driver.addBusy)('a busy read holds the time and no words', async () => {
      const start = iso(base + 24 * HOUR);
      const end = iso(base + 25 * HOUR);
      await driver.addBusy!({ calendarId: mainCalendar, start, end });
      const answer = answered('readBusy', await make().readBusy({ calendarIds: [mainCalendar], from: iso(base), to: iso(base + 48 * HOUR) }));
      const starts = answer.intervals.flatMap((one: BusyInterval) => (one.allDay === true ? [] : [Date.parse(one.start)]));
      expect(starts).toContain(Date.parse(start));
      const text = JSON.stringify(answer);
      for (const word of options.forbiddenWords ?? []) expect(text).not.toContain(word);
    });

    when(driver.deleteEventOutside)('an event deleted outside reads as missing', async () => {
      const { calendarId } = answered('ensureCalendar', await make().ensureCalendar({ name: 'Conformance', knownId: null }));
      const made = answered('upsertEvent', await make().upsertEvent(event(calendarId)));
      await driver.deleteEventOutside!(made.remoteId);
      refusedWith(await make().upsertEvent(event(calendarId, made.remoteId)), 'EVENT_MISSING');
    });

    when(driver.deliveryFor)('reads a delivery without believing it', async () => {
      const answer = answered('readHook', make().readHook(driver.deliveryFor!({ channelId: 'conformance-channel', secret: 'conformance-secret' })));
      expect(answer.notices.some((notice) => notice.secret === 'conformance-secret')).toBe(true);
      const empty = make().readHook({ headers: {}, query: {}, rawBody: '' });
      if (!isCalendarError(empty)) expect(empty.notices.every((notice) => notice.secret !== 'conformance-secret')).toBe(true);
    });

    when(driver.deleteCalendarOutside)('a lost calendar is CALENDAR_MISSING', async () => {
      const { calendarId } = answered('ensureCalendar', await make().ensureCalendar({ name: 'Conformance', knownId: null }));
      await driver.deleteCalendarOutside!(calendarId);
      refusedWith(await make().upsertEvent(event(calendarId)), 'CALENDAR_MISSING');
    });
  });
}
