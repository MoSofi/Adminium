// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CALENDAR FILE, as text (FIL-3…FIL-6, FIL-9). What a mail app does with it
 * is not proved here: that is T16's walk in Gmail, Outlook and Apple Mail.
 */
import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';

import { calendarUid, noticeIn } from '../src/calendar/entry.js';
import { downloadFile, feedFile, foldLine, googleCalendarLink, icsInstant, icsParam, icsText, invitationFile, outlookCalendarLink, type CalendarEvent } from '../src/calendar/ics.js';
import { mailOptionsOf } from '../src/email/config.js';
import { scrubPathForLog, scrubUrlForLog } from '../src/log-scrub.js';

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  uid: 'lumen.42@install-1',
  sequence: 3,
  start: new Date('2026-09-17T17:00:00.000Z'),
  end: new Date('2026-09-17T18:00:00.000Z'),
  summary: 'Reformer Pilates · Lumen Studio',
  description: 'Reformer Pilates · Ivy\nLMN-1042\nDeclining in your calendar does not cancel.',
  location: '12 Valencia St, San Francisco',
  url: 'https://lumen.example',
  ...over,
});
const parties = { organizer: { name: 'Lumen Studio', email: 'hello@lumen.example' }, attendee: 'ava@guests.example' };
const stamp = new Date('2026-09-10T09:00:00.000Z');
/** The file's logical lines, unfolded. */
const lines = (text: string) => text.replace(/\r\n /g, '').split('\r\n').filter((line) => line !== '');

describe('times', () => {
  it('are UTC instants on both sides of a clock change, with no time zone block', () => {
    // 9 AM in San Francisco: PDT on Fri 30 Oct, PST on Mon 2 Nov 2026.
    expect(icsInstant(new Date('2026-10-30T16:00:00.000Z'))).toBe('20261030T160000Z');
    expect(icsInstant(new Date('2026-11-02T17:00:00.000Z'))).toBe('20261102T170000Z');
    const file = invitationFile({ method: 'REQUEST', event: event(), stamp, ...parties })!;
    expect(file).not.toContain('VTIMEZONE');
    expect(file).not.toContain('TZID');
    expect(lines(file)).toContain('DTSTART:20260917T170000Z');
    expect(lines(file)).toContain('DTEND:20260917T180000Z');
  });
});

describe('an invitation', () => {
  it('names the studio as organiser and the guest as the one attendee, with replies off', () => {
    const got = lines(invitationFile({ method: 'REQUEST', event: event(), stamp, ...parties })!);
    expect(got).toContain('METHOD:REQUEST');
    expect(got).toContain('STATUS:CONFIRMED');
    expect(got).toContain('SEQUENCE:3');
    expect(got).toContain('UID:lumen.42@install-1');
    expect(got).toContain('DTSTAMP:20260910T090000Z');
    expect(got).toContain('ORGANIZER;CN="Lumen Studio":mailto:hello@lumen.example');
    expect(got).toContain('ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:ava@guests.example');
    expect(got.filter((line) => line.startsWith('ATTENDEE'))).toHaveLength(1);
  });

  it('is cancelled by the same UID, with its raised sequence', () => {
    const got = lines(invitationFile({ method: 'CANCEL', event: event({ sequence: 4 }), stamp, ...parties })!);
    expect(got).toContain('METHOD:CANCEL');
    expect(got).toContain('STATUS:CANCELLED');
    expect(got).toContain('SEQUENCE:4');
    expect(got).toContain('UID:lumen.42@install-1');
  });

  it('is not made for anything but one plain address', () => {
    for (const attendee of ['a@b.example, c@d.example', 'x <a@b.example>', 'a@b.example\r\nATTENDEE:mailto:c@d.example', 'nobody']) {
      expect(invitationFile({ method: 'REQUEST', event: event(), stamp, organizer: parties.organizer, attendee }), attendee).toBeNull();
    }
    expect(invitationFile({ method: 'REQUEST', event: event(), stamp, organizer: { name: 'L', email: 'not an address' }, attendee: parties.attendee })).toBeNull();
  });

  it('ends every line with CRLF and keeps each to 75 octets, never inside a character', () => {
    const long = 'Réformer Pilates 日本語のクラス '.repeat(12);
    const file = invitationFile({ method: 'REQUEST', event: event({ summary: long, description: long }), stamp, ...parties })!;
    expect(file.endsWith('\r\n')).toBe(true);
    expect(file.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    for (const line of file.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    expect(file).not.toContain('�');
    expect(lines(file).find((line) => line.startsWith('SUMMARY:'))).toBe(`SUMMARY:${icsText(long)}`);
  });
});

describe('a value', () => {
  it('cannot start a property of its own', () => {
    const typed = 'Pilates\r\nATTENDEE:mailto:evil@x.example\nEND:VEVENT';
    const file = invitationFile({ method: 'REQUEST', event: event({ summary: typed, description: typed, location: typed }), stamp, organizer: { name: 'L"\r\nX:y', email: parties.organizer.email }, attendee: parties.attendee })!;
    const got = lines(file);
    expect(got.filter((line) => line.startsWith('ATTENDEE'))).toHaveLength(1);
    expect(got.filter((line) => line === 'END:VEVENT')).toHaveLength(1);
    expect(got.some((line) => line.startsWith('X:y'))).toBe(false);
  });

  it('is escaped as RFC 5545 says', () => {
    expect(icsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    expect(icsParam('Studio "One"\nTwo')).toBe('"Studio \'One\' Two"');
    expect(foldLine('short')).toBe('short');
  });

  it('leaves a url out unless it is a plain web address', () => {
    expect(lines(downloadFile({ event: event({ url: 'javascript:alert(1)' }), stamp })).some((line) => line.startsWith('URL:'))).toBe(false);
  });
});

describe('a plain copy and a feed', () => {
  it('a page\'s copy has no method and no parties, so no calendar answers it', () => {
    const got = lines(downloadFile({ event: event(), stamp }));
    expect(got.some((line) => /^(METHOD|ORGANIZER|ATTENDEE)/.test(line))).toBe(false);
  });

  it('a feed publishes every visit under its name', () => {
    const got = lines(feedFile({ name: 'Lumen, Studio', uid: 'feed.lumen.1@install-1', events: [event(), event({ uid: 'lumen.43@install-1' })], stamp }));
    expect(got.some((line) => line.startsWith('METHOD'))).toBe(false);
    expect(got).toContain('X-WR-CALNAME:Lumen\\, Studio');
    expect(got.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(got).not.toContain('BEGIN:VFREEBUSY');
  });

  it('a person with no visits still gets a valid calendar, with one component that shows nothing', () => {
    const got = lines(feedFile({ name: 'Lumen', uid: 'feed.lumen.1@install-1', events: [], stamp }));
    expect(got).toEqual(expect.arrayContaining(['BEGIN:VFREEBUSY', 'UID:feed.lumen.1@install-1', 'DTSTAMP:20260910T090000Z', 'END:VFREEBUSY']));
    expect(got).not.toContain('BEGIN:VEVENT');
  });
});

describe('the two add-to-calendar links', () => {
  it('carry the entry\'s own fields and nothing else', () => {
    const google = new URL(googleCalendarLink(event()));
    expect(google.origin).toBe('https://calendar.google.com');
    expect([...google.searchParams.keys()].sort()).toEqual(['action', 'dates', 'details', 'location', 'text']);
    expect(google.searchParams.get('dates')).toBe('20260917T170000Z/20260917T180000Z');
    const outlook = new URL(outlookCalendarLink(event()));
    expect(outlook.origin).toBe('https://outlook.live.com');
    expect([...outlook.searchParams.keys()].sort()).toEqual(['body', 'enddt', 'location', 'path', 'rru', 'startdt', 'subject']);
    expect(outlook.searchParams.get('startdt')).toBe('2026-09-17T17:00:00.000Z');
  });
});

describe('the entry\'s words', () => {
  it('a UID is the app, the row and the install: two studios\' first bookings are two events', () => {
    expect(calendarUid('lumen', '1', 'install-a')).not.toBe(calendarUid('lumen', '1', 'install-b'));
    expect(calendarUid('lumen', 'a b/c', 'i')).toBe('lumen.a%20b%2Fc@i');
  });

  it('the notice is in the mail\'s language, else its language family, else US English', () => {
    const notice = { 'en-US': 'Declining does not cancel', 'de-DE': 'Absagen storniert nicht' };
    expect(noticeIn(notice, 'de_DE')).toBe('Absagen storniert nicht');
    expect(noticeIn(notice, 'de-AT')).toBe('Absagen storniert nicht');
    expect(noticeIn(notice, 'fr-FR')).toBe('Declining does not cancel');
  });
});

describe('the part a mail carries', () => {
  it('is a text/calendar alternative with its method, and the same text as invite.ics', async () => {
    const content = invitationFile({ method: 'REQUEST', event: event(), stamp, ...parties })!;
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'crlf', disableFileAccess: true, disableUrlAccess: true });
    const sent = await transport.sendMail(mailOptionsOf({ to: 'ava@guests.example', subject: 'Booked', html: '<p>Booked</p>', text: 'Booked', calendar: { method: 'REQUEST', content } }, 'Lumen <no-reply@lumen.example>'));
    const raw = (sent.message as Buffer).toString('utf8');
    expect(raw).toMatch(/Content-Type: text\/calendar; charset=utf-8; method=REQUEST/i);
    expect(raw).toMatch(/filename=invite\.ics|name=invite\.ics/i);
    expect(raw).toContain('multipart/alternative');
  });

  it('is not there on a mail without one', () => {
    expect(mailOptionsOf({ to: 'a@b.example', subject: 's', html: 'h', text: 't' }, 'x@y.example')).not.toHaveProperty('icalEvent');
  });
});

describe('the feed\'s token in a log', () => {
  it('is replaced, in the path and with a query', () => {
    expect(scrubPathForLog('/x/cal/SECRETTOKEN.ics')).toBe('/x/cal/[REDACTED]');
    expect(scrubUrlForLog('/x/cal/SECRETTOKEN.ics?x=1')).toBe('/x/cal/[REDACTED]?x=1');
    expect(scrubPathForLog('/x/embed.js')).toBe('/x/embed.js');
  });
});
