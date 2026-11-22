// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the sync tells the people who manage an app's connections. Each is told
 * once per cause (a clash, a calendar that was deleted, push gone quiet), and
 * none names a customer: only the team member whose calendar it is.
 */
import { tellAccountManagers, type AccountNoticeDeps } from '../connected-accounts/notices.js';

export type CalendarNoticeDeps = AccountNoticeDeps;

export const CALENDAR_NOTICE_KINDS = ['calendar.clash', 'calendar.stale-dropped', 'calendar.removed', 'calendar.remade', 'calendar.push-silent', 'calendar.unreadable', 'calendar.names-left'] as const;
export type CalendarNoticeKind = (typeof CALENDAR_NOTICE_KINDS)[number];

const WORDS: Record<CalendarNoticeKind, { title: { key: string; fallback: string }; body: { key: string; fallback: string } }> = {
  'calendar.clash': {
    title: { key: 'clashTitle', fallback: '{person} has a calendar clash' },
    body: { key: 'clashBody', fallback: 'A busy time in {person}’s calendar now overlaps a booking. Open the booking to move it or keep it.' },
  },
  'calendar.stale-dropped': {
    title: { key: 'staleTitle', fallback: '{person}’s busy times were dropped' },
    body: { key: 'staleBody', fallback: '{person} has not reconnected for 7 days, so their calendar no longer blocks times.' },
  },
  'calendar.removed': {
    title: { key: 'removedTitle', fallback: '{person} removed the {calendar} calendar' },
    body: { key: 'removedBody', fallback: 'It was deleted twice in a week, so bookings no longer go to {person}’s calendar until they turn it back on.' },
  },
  'calendar.remade': {
    title: { key: 'remadeTitle', fallback: 'The {calendar} calendar was made again' },
    body: { key: 'remadeBody', fallback: 'It was deleted from {person}’s account, so it was made again with their coming bookings.' },
  },
  'calendar.push-silent': {
    title: { key: 'silentTitle', fallback: 'Changes from {person}’s calendar are arriving late' },
    body: { key: 'silentBody', fallback: 'Its instant updates have stopped, so changes arrive with the regular check, within about 12 minutes.' },
  },
  'calendar.names-left': {
    title: { key: 'namesLeftTitle', fallback: '{person}’s calendar may still show a customer’s name' },
    body: { key: 'namesLeftBody', fallback: 'Some events in the {calendar} calendar could not be removed before this connection ended. Ask {person} to delete them there.' },
  },
  'calendar.unreadable': {
    title: { key: 'unreadableTitle', fallback: 'A calendar of {person}’s can no longer be read' },
    body: { key: 'unreadableBody', fallback: 'It was deleted or is no longer shared, so it was taken off the calendars counted as busy and no longer blocks {person}’s slots. Their other calendars still do.' },
  },
};

/** Best effort: a notice never holds up the sync. */
export async function tellCalendar(deps: CalendarNoticeDeps, appKey: string | null, kind: CalendarNoticeKind, values: Record<string, string>): Promise<void> {
  await tellAccountManagers(deps, appKey, kind, { ...WORDS[kind], values }).catch(() => undefined);
}
