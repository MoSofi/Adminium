// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The built-in demo calendar beyond the conformance suite: push channels,
 * planned failures, what a person does in their own calendar, and the hook.
 */
import { describe, expect, it } from 'vitest';

import { DEMO_CALENDAR_SECRET_HEADER, createDemoCalendarBackend, readDemoHook } from '../src/calendar-demo.js';
import { calendarError, guardCalendarProvider, type CalendarProvider } from '../src/calendar-provider.js';

const ACCOUNT = 'demo:a';
const FROM = '2030-01-07T00:00:00Z';
const TO = '2030-01-08T00:00:00Z';
const ALL_TRAITS = { listsCalendars: true, allDayKnown: true, busyPush: true };

const channel = (channelId: string) => ({ channelId, remoteChannelId: `remote-${channelId}`, resourceId: `resource-${channelId}`, address: 'https://desk.example/hook', secret: 's3cret' });
const watching = (channelId: string, target: 'own' | 'busy' = 'own') => ({ target, calendarIds: ['primary'], channelId, secret: 's3cret', address: 'https://desk.example/hook' });

async function withEvent(demo: ReturnType<typeof createDemoCalendarBackend>) {
  const provider = demo.providerFor(ACCOUNT);
  const made = await provider.ensureCalendar({ name: 'Bookings', knownId: null });
  if (!('calendarId' in made)) throw new Error('no calendar');
  const event = await provider.upsertEvent({ calendarId: made.calendarId, key: 'k1', remoteId: null, start: '2030-01-07T09:00:00Z', end: '2030-01-07T10:00:00Z', zone: 'UTC', title: 'Booked' });
  if (!('remoteId' in event)) throw new Error('no event');
  return { provider, calendarId: made.calendarId, remoteId: event.remoteId, etag: event.etag };
}

describe('the demo calendar', () => {
  it('keeps a channel until it is stopped, and renews only a live one', async () => {
    let at = 1_000;
    const demo = createDemoCalendarBackend({ now: () => at });
    const provider = demo.providerFor(ACCOUNT);
    expect(await provider.watch(watching('c1'))).toMatchObject({ remoteChannelId: 'remote-c1', resourceId: 'resource-c1' });
    const first = demo.channels(ACCOUNT)[0]!;
    expect(first).toMatchObject({ channelId: 'c1', target: 'own', address: 'https://desk.example/hook' });
    expect(demo.delivery(ACCOUNT, 'c1').headers[DEMO_CALENDAR_SECRET_HEADER]).toBe('s3cret');

    at += 5_000;
    expect(await provider.renew(channel('c1'))).toEqual({ expiresAt: new Date(first.expiresAt + 5_000).toISOString() });
    expect(await provider.renew(channel('nobody'))).toEqual(calendarError('EVENT_MISSING'));

    expect(await provider.unwatch(channel('c1'))).toEqual({ stopped: true });
    expect(demo.channels(ACCOUNT)).toEqual([]);
    expect(await provider.renew(channel('c1'))).toEqual(calendarError('EVENT_MISSING'));
    // Stopping what is already gone is still an answer.
    expect(await provider.unwatch(channel('nobody'))).toEqual({ stopped: true });
    expect(demo.delivery(ACCOUNT, 'nobody').headers[DEMO_CALENDAR_SECRET_HEADER]).toBeUndefined();
  });

  it('refuses a busy channel on a service that cannot push busy times', async () => {
    const demo = createDemoCalendarBackend();
    demo.ensure(ACCOUNT, { ...ALL_TRAITS, busyPush: false });
    expect(await demo.providerFor(ACCOUNT).watch(watching('c1', 'busy'))).toEqual(calendarError('PERMISSION_MISSING'));
    expect(demo.channels(ACCOUNT)).toEqual([]);
  });

  it('answers each channel call with a planned failure, once, and counts it', async () => {
    const demo = createDemoCalendarBackend();
    const provider = demo.providerFor(ACCOUNT);
    demo.failNext(ACCOUNT, 'watch', 'RATE_LIMITED', 1_500);
    demo.failNext(ACCOUNT, 'renew', 'UNAVAILABLE');
    demo.failNext(ACCOUNT, 'unwatch', 'UNAVAILABLE');
    expect(await provider.watch(watching('c1'))).toEqual(calendarError('RATE_LIMITED', 1_500));
    expect(await provider.renew(channel('c1'))).toEqual(calendarError('UNAVAILABLE'));
    expect(await provider.unwatch(channel('c1'))).toEqual(calendarError('UNAVAILABLE'));
    expect(await provider.watch(watching('c1'))).toMatchObject({ remoteChannelId: 'remote-c1' });
    expect(demo.callCount(ACCOUNT, 'watch')).toBe(2);
    expect(demo.callCount(ACCOUNT, 'readBusy')).toBe(0);
  });

  it('shows a person moving an event, and ignores one that is not there', async () => {
    const demo = createDemoCalendarBackend();
    const { provider, calendarId, remoteId, etag } = await withEvent(demo);
    demo.editEvent(ACCOUNT, remoteId, { start: '2030-01-07T11:00:00Z', end: '2030-01-07T12:00:00Z' });
    demo.editEvent(ACCOUNT, 'nobody', { start: '2030-01-07T11:00:00Z' });
    demo.deleteEvent(ACCOUNT, 'nobody');
    const [moved] = demo.events(ACCOUNT);
    expect(moved).toMatchObject({ remoteId, start: '2030-01-07T11:00:00Z', end: '2030-01-07T12:00:00Z' });
    expect(moved!.etag).not.toBe(etag);
    expect(await provider.listOwnEvents({ calendarId, cursor: null })).toMatchObject({ events: [{ remoteId, start: '2030-01-07T11:00:00Z' }] });
  });

  it('shows a person deleting an event, then the whole calendar', async () => {
    const demo = createDemoCalendarBackend();
    const { provider, calendarId, remoteId } = await withEvent(demo);
    expect(demo.ownCalendar(ACCOUNT)).toEqual({ id: calendarId, name: 'Bookings' });
    demo.deleteEvent(ACCOUNT, remoteId);
    expect(demo.events(ACCOUNT)).toEqual([]);
    demo.deleteOwnCalendar(ACCOUNT);
    expect(demo.ownCalendar(ACCOUNT)).toBeNull();
    expect(await provider.listOwnEvents({ calendarId, cursor: null })).toEqual(calendarError('CALENDAR_MISSING'));
  });

  it('adds a calendar once, and forgets everything on a reset', async () => {
    const demo = createDemoCalendarBackend();
    demo.ensure(ACCOUNT);
    const entry = { id: 'team', name: 'Team', primary: false };
    demo.addCalendar(ACCOUNT, entry);
    demo.addCalendar(ACCOUNT, entry);
    const listed = await demo.providerFor(ACCOUNT).listCalendars();
    if (!('calendars' in listed)) throw new Error('no list');
    expect(listed.calendars.filter((one) => one.id === 'team')).toHaveLength(1);
    demo.failNext(ACCOUNT, 'identify', 'UNAVAILABLE');
    demo.reset();
    expect(demo.callCount(ACCOUNT, 'listCalendars')).toBe(0);
    expect(await demo.providerFor(ACCOUNT).identify()).toMatchObject({ scopes: ['demo'] });
  });

  it('marks a timed busy interval unknown too when the service cannot tell all-day', async () => {
    const demo = createDemoCalendarBackend();
    demo.setTraits(ACCOUNT, { ...ALL_TRAITS, allDayKnown: false });
    demo.setBusy(ACCOUNT, 'primary', [{ allDay: false, start: '2030-01-07T09:00:00Z', end: '2030-01-07T10:00:00Z', kind: 'busy' }]);
    const answer = await demo.providerFor(ACCOUNT).readBusy({ calendarIds: ['primary'], from: FROM, to: TO });
    expect(answer).toMatchObject({ intervals: [{ allDay: 'unknown', start: '2030-01-07T09:00:00Z' }] });
  });
});

describe('the demo hook', () => {
  const delivery = (headers: Record<string, string | undefined>, query: Record<string, string | undefined> = {}) => ({ headers, query, rawBody: '' });

  it('echoes a handshake and tells nothing else', () => {
    expect(readDemoHook(delivery({}, { validationToken: 'abc' }))).toEqual({ handshake: 'abc', notices: [] });
  });

  it('reads each kind it knows, and anything else as a change', () => {
    for (const kind of ['reauthorize', 'removed', 'missed'] as const) {
      expect(readDemoHook(delivery({ 'x-demo-kind': kind, [DEMO_CALENDAR_SECRET_HEADER]: 's' }))).toEqual({ handshake: null, notices: [{ secret: 's', kind }] });
    }
    expect(readDemoHook(delivery({ 'x-demo-kind': 'other' }, { validationToken: '' }))).toEqual({ handshake: null, notices: [{ secret: null, kind: 'changed' }] });
  });
});

describe('the guard around a calendar provider', () => {
  const inner = (): CalendarProvider => createDemoCalendarBackend().providerFor(ACCOUNT);

  it('does not believe an error code outside the contract', async () => {
    const logged: unknown[] = [];
    const guarded = guardCalendarProvider({ ...inner(), identify: async () => ({ calendarError: 'NOT_A_CODE' }) as never }, (message, fields) => logged.push([message, fields.call]));
    expect(await guarded.identify()).toEqual(calendarError('UNAVAILABLE'));
    expect(logged).toEqual([['calendar provider answered outside its contract', 'identify']]);
  });

  it('turns a hook reader that throws into UNAVAILABLE, and says which call', () => {
    const logged: unknown[] = [];
    const guarded = guardCalendarProvider(
      { ...inner(), readHook: () => { throw new Error('the secret was wrong: s3cret'); } },
      (message, fields) => logged.push([message, fields.call]),
    );
    expect(guarded.readHook({ headers: {}, query: {}, rawBody: '' })).toEqual(calendarError('UNAVAILABLE'));
    expect(logged).toEqual([['calendar provider call threw', 'readHook']]);
  });
});
