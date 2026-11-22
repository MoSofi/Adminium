// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CALENDAR ENTRY A MAIL CARRIES (`emailTemplates[].calendar`): made when
 * the mail goes, from the booking as it stands then.
 *
 * An invitation while the booking still takes its time, a cancellation once it
 * does not, so a mail that went out late can never put a cancelled visit back
 * in someone's calendar. The ATTENDEE is the address this mail goes to and no
 * other. `{{calendarGoogle}}` and `{{calendarOutlook}}` carry the same fields;
 * for a cancelled visit they are empty, since there is nothing to add.
 */
import type { Outbox } from '@adminium/manifest';
import { settingsRepo, type MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';

import { bookingEntry, calendarRuleOf } from '../calendar/entry.js';
import { googleCalendarLink, invitationFile, outlookCalendarLink } from '../calendar/ics.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { fetchByPk } from '../crud/records.js';
import type { EmailCalendarPart } from '../email/types.js';
import { referenced } from './recipient.js';
import { settingReader } from './timing.js';

/** The names a template prints the two "add to calendar" links under. */
export const CALENDAR_GOOGLE_VARIABLE = 'calendarGoogle';
export const CALENDAR_OUTLOOK_VARIABLE = 'calendarOutlook';

/** The entry for one message, or null when it names no booking that can be one. */
export async function calendarPartFor(
  deps: { meta: MetaDb; db: Kysely<SourceDatabase>; view: SnapshotView; now: number },
  input: { appKey: string; connectionId: string; definition: Pick<Outbox, 'table' | 'links'>; link: string; message: Row; to: string; locale: string; organizer: { name: string; email: string } },
): Promise<{ part: EmailCalendarPart; google: string; outlook: string } | null> {
  const { db, view } = deps;
  const column = input.definition.links?.[input.link];
  const id = column === undefined ? undefined : input.message[column];
  if (column === undefined || id === null || id === undefined) return null;
  const tableId = referenced(view, input.definition.table, column);
  if (tableId === undefined) return null;
  const table = view.table(tableId);
  const rule = calendarRuleOf(table);
  const key = table.primaryKey[0];
  if (rule === null || key === undefined || table.primaryKey.length !== 1) return null;
  const row = await fetchByPk(db, table, { [key]: id });
  const install = await settingsRepo(deps.meta).get('system.instanceId');
  if (row === undefined || typeof install !== 'string' || install === '') return null;
  const read = settingReader(deps.meta, db, view, input.connectionId);
  const entry = await bookingEntry({ db, view, table, rule, appKey: input.appKey, connectionId: input.connectionId, install, locale: input.locale, setting: (source) => read(source) }, row);
  if (entry === null) return null;
  const method = entry.takesTime ? 'REQUEST' : 'CANCEL';
  const content = invitationFile({ method, event: entry.event, stamp: new Date(deps.now), organizer: input.organizer, attendee: input.to });
  if (content === null) return null;
  return { part: { method, content }, google: entry.takesTime ? googleCalendarLink(entry.event) : '', outlook: entry.takesTime ? outlookCalendarLink(entry.event) : '' };
}
