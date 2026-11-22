// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE BOOKING AS A CALENDAR ENTRY: what the invitation, the links and the feed
 * all say of it, built here and nowhere else so they cannot drift apart.
 *
 * The entry holds only the studio's own words and the booking's facts: the
 * service, the person's first name, the studio's name and address, the code,
 * the website, and the line that declining does not cancel. It is built from
 * named columns, so a guest's note, phone, price or a link that opens the
 * booking has no way in. Its UID is the app, the row's key and this install's
 * id: every studio numbers its codes from the same prefix, so a code alone
 * would make one studio's visit overwrite another's in a shared calendar.
 */
import type { BookingCalendar } from '@adminium/manifest';
import type { Kysely } from 'kysely';

import type { TableBookingRule } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { bookingCounts } from '../crud/booking-guard.js';
import { slotInstant } from '../crud/capacity-guard.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { rowKeyOf } from '../payments/payables.js';
import { followPath } from '../reviews/take.js';
import type { CalendarEvent } from './ics.js';

/** A booking rule that carries the calendar word. */
export type CalendarRule = TableBookingRule & { calendar: BookingCalendar };

/** The table's booking rule, when it has a calendar word. */
export function calendarRuleOf(table: ResolvedTable): CalendarRule | null {
  const rule = table.table?.booking;
  return rule === undefined || 'plain' in rule || rule.calendar === undefined ? null : (rule as CalendarRule);
}

/** Reads a text setting of the app's one-row table. */
export type TextSetting = (source: { table: string; column: string }) => Promise<unknown>;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value).trim());

/**
 * The entry's UID: the same in the mail, the feed and anything that syncs it, so
 * one visit is one event everywhere. The database is in it because one server
 * can run a copy of an app per database, each counting its rows from 1: without
 * it, one copy's cancellation could remove another copy's visit from a guest's
 * calendar.
 */
export function calendarUid(appKey: string, connectionId: string, rowKey: string, install: string): string {
  return `${appKey}.${encodeURIComponent(connectionId)}.${encodeURIComponent(rowKey)}@${install}`;
}

/** The notice in the mail's language: the exact tag, else the same language, else US English. */
export function noticeIn(notice: Readonly<Record<string, string>>, locale: string): string {
  const wanted = locale.replace('_', '-').toLowerCase();
  const tags = Object.keys(notice);
  const hit = tags.find((tag) => tag.toLowerCase() === wanted) ?? tags.find((tag) => tag.toLowerCase().split('-')[0] === wanted.split('-')[0]);
  return notice[hit ?? 'en-US'] ?? notice['en-US'] ?? '';
}

/** Follows a path to a text, reading each linked row once for the whole of a feed. */
export async function textAlong(db: Kysely<SourceDatabase>, view: SnapshotView, table: ResolvedTable, row: Row, path: readonly string[], memo: Map<string, string> | undefined): Promise<string> {
  if (path.length === 1) return text(row[path[0]!]);
  const id = `${path.join('.')}:${String(row[path[0]!])}`;
  const held = memo?.get(id);
  if (held !== undefined) return held;
  const found = await followPath(db, view, table, row, path, 'column');
  const value = text(found?.value);
  memo?.set(id, value);
  return value;
}

export interface EntryContext {
  db: Kysely<SourceDatabase>;
  view: SnapshotView;
  table: ResolvedTable;
  rule: CalendarRule;
  appKey: string;
  connectionId: string;
  install: string;
  locale: string;
  setting: TextSetting;
  /** Linked rows read once for a whole feed. */
  memo?: Map<string, string> | undefined;
}

/** One row as an entry, with whether it still takes its time; null when its time cannot be read. */
export async function bookingEntry(ctx: EntryContext, row: Row, opts: { customerName?: string | undefined; withoutNotice?: boolean | undefined } = {}): Promise<{ event: CalendarEvent; takesTime: boolean } | null> {
  const { rule, db, view, table } = ctx;
  const calendar = rule.calendar;
  const start = slotInstant(row[rule.start]);
  const minutes = Number(row[rule.minutes]);
  if (start === null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const title = await textAlong(db, view, table, row, calendar.title, ctx.memo);
  const person = calendar.person === undefined ? '' : ((await textAlong(db, view, table, row, calendar.person, ctx.memo)).split(/\s+/)[0] ?? '');
  const studio = text(await ctx.setting(calendar.studio.name));
  const location = calendar.studio.address === undefined ? '' : text(await ctx.setting(calendar.studio.address));
  const website = calendar.studio.website === undefined ? '' : text(await ctx.setting(calendar.studio.website));
  const code = calendar.code === undefined ? '' : text(row[calendar.code]);
  const named = opts.customerName === undefined || opts.customerName === '' ? title : `${title} · ${opts.customerName}`;
  const description = [[title, person].filter((part) => part !== '').join(' · '), code, opts.withoutNotice === true ? '' : noticeIn(calendar.notice, ctx.locale)].filter((line) => line !== '').join('\n');
  return {
    event: {
      uid: calendarUid(ctx.appKey, ctx.connectionId, rowKeyOf(table, row), ctx.install),
      sequence: Math.max(0, Math.trunc(Number(row[calendar.revision]) || 0)),
      start,
      end: new Date(start.getTime() + minutes * 60_000),
      summary: studio === '' ? named : `${named} · ${studio}`,
      description,
      ...(location === '' ? {} : { location }),
      ...(website === '' ? {} : { url: website }),
    },
    takesTime: bookingCounts(rule, row),
  };
}
