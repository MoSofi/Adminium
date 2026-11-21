// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CALENDAR FILE: one visit as an invitation, a cancellation or a line of a
 * feed, and the two links that add it to Google or Outlook.
 *
 * Times are UTC instants (the UTC form of RFC 5545). A booking is one visit that
 * never repeats, so a UTC time is exact on both sides of a clock change, needs
 * no `VTIMEZONE`, and every calendar shows it in its reader's own zone.
 *
 * An invitation is METHOD:REQUEST with the studio as ORGANIZER and the guest as
 * the one ATTENDEE, already accepted and asked for no reply. A cancellation is
 * METHOD:CANCEL with the same UID and a SEQUENCE no lower than the last sent
 * (RFC 5546's CANCEL). How Gmail, Outlook and Apple Mail treat either is not
 * something this file can promise.
 *
 * Everything put in a line goes through {@link icsText} (escaped) and
 * {@link foldLine} (75 octets, never inside a UTF-8 character), so a value
 * cannot start a property of its own.
 *
 * Pure.
 */

export type CalendarMethod = 'REQUEST' | 'CANCEL';

/** One visit, in the words an entry may carry. */
export interface CalendarEvent {
  uid: string;
  sequence: number;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  location?: string | undefined;
  url?: string | undefined;
}

const CRLF = '\r\n';
const PRODID = '-//Adminium//Bookings//EN';
/** The most octets a line holds before it is folded (RFC 5545's content lines). */
const LINE_OCTETS = 75;

/** A value's control characters gone: a line break is the one kept, and only {@link icsText} spells it. */
// eslint-disable-next-line no-control-regex -- the control characters are what this removes
const withoutControls = (value: string): string => value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ');

/** A TEXT value, escaped as RFC 5545 asks. */
export function icsText(value: string): string {
  return withoutControls(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** A parameter value, quoted: a double quote has no spelling there (RFC 5545's parameters), and neither has a line break. */
export function icsParam(value: string): string {
  return `"${withoutControls(value).replace(/\n/g, ' ').replace(/"/g, "'")}"`;
}

/** One content line, folded at 75 octets without splitting a character. */
export function foldLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= LINE_OCTETS) return line;
  const out: string[] = [];
  let current = '';
  let octets = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8');
    // A continuation line starts with a space, which counts.
    const room = out.length === 0 ? LINE_OCTETS : LINE_OCTETS - 1;
    if (octets + size > room) {
      out.push(current);
      current = '';
      octets = 0;
    }
    current += character;
    octets += size;
  }
  out.push(current);
  return out.join(`${CRLF} `);
}

/** `20260917T170000Z`. */
export function icsInstant(at: Date): string {
  return at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** An address as a calendar names it, or null for anything but one plain address. */
function mailto(address: string): string | null {
  const bare = address.trim();
  return /^[^\s<>"(),:;\\@]+@[^\s<>"(),:;\\@]+$/.test(bare) ? `mailto:${bare}` : null;
}

function eventLines(event: CalendarEvent, stamp: Date, status: 'CONFIRMED' | 'CANCELLED'): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${icsText(event.uid)}`,
    `SEQUENCE:${String(event.sequence)}`,
    `DTSTAMP:${icsInstant(stamp)}`,
    `DTSTART:${icsInstant(event.start)}`,
    `DTEND:${icsInstant(event.end)}`,
    `SUMMARY:${icsText(event.summary)}`,
    `DESCRIPTION:${icsText(event.description)}`,
    ...(event.location === undefined || event.location === '' ? [] : [`LOCATION:${icsText(event.location)}`]),
    ...(event.url === undefined || !/^https?:\/\/[^\s]+$/.test(event.url) ? [] : [`URL:${event.url}`]),
    `STATUS:${status}`,
    'TRANSP:OPAQUE',
  ];
}

const file = (lines: readonly string[]): string => `${lines.map(foldLine).join(CRLF)}${CRLF}`;

/**
 * An invitation, or its cancellation. Null when either address is not one
 * plain address: an ORGANIZER and an ATTENDEE are what make it an invitation
 * (RFC 5546's REQUEST), so there is no file without them.
 */
export function invitationFile(input: { method: CalendarMethod; event: CalendarEvent; stamp: Date; organizer: { name: string; email: string }; attendee: string }): string | null {
  const organizer = mailto(input.organizer.email);
  const attendee = mailto(input.attendee);
  if (organizer === null || attendee === null) return null;
  const cancelled = input.method === 'CANCEL';
  return file([
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    `METHOD:${input.method}`,
    ...eventLines(input.event, input.stamp, cancelled ? 'CANCELLED' : 'CONFIRMED'),
    `ORGANIZER;CN=${icsParam(input.organizer.name)}:${organizer}`,
    `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:${attendee}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]);
}

/** A plain copy of one visit, for a page's download: no METHOD, no parties, nothing a calendar would answer. */
export function downloadFile(input: { event: CalendarEvent; stamp: Date }): string {
  return file(['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN', ...eventLines(input.event, input.stamp, 'CONFIRMED'), 'END:VEVENT', 'END:VCALENDAR']);
}

/** A person's private feed: every visit in it, under the feed's name. No METHOD: it is a plain calendar, with no organiser to answer. */
export function feedFile(input: { name: string; uid: string; events: readonly CalendarEvent[]; stamp: Date }): string {
  return file([
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsText(input.name)}`,
    ...input.events.flatMap((event) => [...eventLines(event, input.stamp, 'CONFIRMED'), 'END:VEVENT']),
    // A calendar holds at least one component (as RFC 5545 requires): a person with no visits has one that shows nothing.
    ...(input.events.length > 0 ? [] : ['BEGIN:VFREEBUSY', `UID:${icsText(input.uid)}`, `DTSTAMP:${icsInstant(input.stamp)}`, 'END:VFREEBUSY']),
    'END:VCALENDAR',
  ]);
}

/** "Add to Google Calendar", carrying the entry's own fields and nothing else. */
export function googleCalendarLink(event: CalendarEvent): string {
  const query = new URLSearchParams({ action: 'TEMPLATE', text: event.summary, dates: `${icsInstant(event.start)}/${icsInstant(event.end)}`, details: event.description });
  if (event.location !== undefined && event.location !== '') query.set('location', event.location);
  return `https://calendar.google.com/calendar/render?${query.toString()}`;
}

/** "Add to Outlook", the same. */
export function outlookCalendarLink(event: CalendarEvent): string {
  const query = new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent', subject: event.summary, startdt: event.start.toISOString(), enddt: event.end.toISOString(), body: event.description });
  if (event.location !== undefined && event.location !== '') query.set('location', event.location);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${query.toString()}`;
}
