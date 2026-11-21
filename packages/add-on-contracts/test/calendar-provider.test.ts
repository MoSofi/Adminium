// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `calendar-provider@1`: the conformance suite against the built-in demo, and
 * the guard every real provider is called through.
 */
import { describe, expect, it } from 'vitest';

import {
  CONTRACT_REGISTRY,
  DEMO_CALENDAR_SECRET_HEADER,
  busyIntervalSchemaForTest,
  calendarError,
  createDemoCalendarBackend,
  guardCalendarProvider,
  isCalendarError,
  readBusyAnswerSchemaForTest,
  type CalendarProvider,
} from './calendar-provider.fixtures.js';
import { calendarProviderConformance } from '../src/testing/calendar-provider.js';

const backend = createDemoCalendarBackend();
const ACCOUNT = 'demo:conformance';

calendarProviderConformance({
  name: 'the built-in demo',
  make: () => backend.providerFor(ACCOUNT),
  mainCalendar: 'primary',
  forbiddenWords: ['Dentist'],
  driver: {
    addBusy: async ({ calendarId, start, end }) => backend.setBusy(ACCOUNT, calendarId, [{ allDay: false, start, end, kind: 'busy' }]),
    deleteEventOutside: async (remoteId) => backend.deleteEvent(ACCOUNT, remoteId),
    deleteCalendarOutside: async () => backend.deleteOwnCalendar(ACCOUNT),
    deliveryFor: ({ secret }) => ({ headers: { [DEMO_CALENDAR_SECRET_HEADER]: secret }, query: {}, rawBody: '' }),
  },
});

describe('calendar-provider@1', () => {
  it('is in the registry', () => {
    expect(CONTRACT_REGISTRY.map((c) => c.id)).toContain('calendar-provider');
  });

  it('has no place for what an event is called', () => {
    const titled = { allDay: false, start: '2030-01-07T09:00:00Z', end: '2030-01-07T10:00:00Z', kind: 'busy', title: 'Dentist' };
    expect(busyIntervalSchemaForTest.safeParse(titled).success).toBe(false);
    expect(readBusyAnswerSchemaForTest.safeParse({ intervals: [titled] }).success).toBe(false);
  });

  it('refuses a time with no zone', () => {
    expect(busyIntervalSchemaForTest.safeParse({ allDay: false, start: '2030-01-07 09:00', end: '2030-01-07 10:00', kind: 'busy' }).success).toBe(false);
  });

  const broken = (change: Partial<CalendarProvider>): CalendarProvider => guardCalendarProvider({ ...backend.providerFor('demo:guard'), ...change });

  it('turns a throw into UNAVAILABLE', async () => {
    const provider = broken({ readBusy: () => Promise.reject(new Error('secret-from-provider')) });
    const answer = await provider.readBusy({ calendarIds: ['primary'], from: '2030-01-07T00:00:00Z', to: '2030-01-08T00:00:00Z' });
    expect(answer).toEqual(calendarError('UNAVAILABLE'));
  });

  it('turns an answer outside the schema into UNAVAILABLE, a title included', async () => {
    const provider = broken({
      readBusy: () => Promise.resolve({ intervals: [{ allDay: false, start: '2030-01-07T09:00:00Z', end: '2030-01-07T10:00:00Z', kind: 'busy', title: 'Dentist' }] } as never),
    });
    const answer = await provider.readBusy({ calendarIds: ['primary'], from: '2030-01-07T00:00:00Z', to: '2030-01-08T00:00:00Z' });
    expect(isCalendarError(answer)).toBe(true);
    expect(JSON.stringify(answer)).not.toContain('Dentist');
  });

  it('refuses a handshake that could not be echoed safely', () => {
    const provider = broken({ readHook: () => ({ handshake: '<script>alert(1)</script> x', notices: [] }) });
    expect(isCalendarError(provider.readHook({ headers: {}, query: {}, rawBody: '' }))).toBe(true);
  });

  it('reads as the least it could do when its traits are wrong', () => {
    const provider = broken({ traits: { listsCalendars: 'yes' } as never });
    expect(provider.traits).toEqual({ listsCalendars: false, allDayKnown: false, busyPush: false });
  });

  it('says an all-day time is unknown when the service cannot tell', async () => {
    const demo = createDemoCalendarBackend();
    demo.setTraits('demo:a', { listsCalendars: false, allDayKnown: false, busyPush: false });
    demo.setBusy('demo:a', 'primary', [{ allDay: true, date: '2030-01-07', endDate: '2030-01-08', kind: 'busy' }]);
    const answer = await demo.providerFor('demo:a').readBusy({ calendarIds: ['primary'], from: '2030-01-07T00:00:00Z', to: '2030-01-09T00:00:00Z' });
    expect(answer).toMatchObject({ intervals: [{ allDay: 'unknown', kind: 'busy' }] });
    expect(await demo.providerFor('demo:a').listCalendars()).toEqual(calendarError('PERMISSION_MISSING'));
  });
});
