// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERSON'S PRIVATE CALENDAR FEED: their counted bookings, thirty days back to
 * sixty ahead, for a calendar service to fetch.
 *
 * The link is a bearer key that an outside service keeps and fetches for as
 * long as it lives, so:
 *  - it is sealed (`email/sealed-link.ts`) and names one person's row, a digest
 *    of the address on it, and the random nonce that person's feed holds now.
 *    "Renew" replaces the nonce and the old link stops at once; a row that
 *    comes to hold someone else's address opens nothing;
 *  - a person made inactive or deleted, the staff account that took the link
 *    suspended or deleted, an app switched off or removed, and a made-up link
 *    all get the same answer, so a link tells nothing;
 *  - an entry shows the service, and the customer's first name and initial only
 *    while the studio's setting says `name`: never an address, a phone, a note,
 *    a price or a link that opens the booking.
 */
import { createHash } from 'node:crypto';

import { calendarFeedsRepo, manifestsRepo, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { fetchByPk } from '../crud/records.js';
import { bindWriteValue } from '../crud/write-values.js';
import { mailLinkKeys } from '../email/link-keys.js';
import { openLink, sealLink } from '../email/sealed-link.js';
import { settingReader } from '../outbox/timing.js';
import { pkOfRowKey } from '../payments/payables.js';
import { addressDigest } from '../reviews/link.js';
import { shownNameOfFull } from '../reviews/tables.js';
import { bookingEntry, calendarRuleOf, textAlong, type CalendarRule } from './entry.js';
import { feedFile, type CalendarEvent } from './ics.js';

const KIND = 'calendar-feed';
const DAY_MS = 86_400_000;
/** How far the feed reaches, back and ahead. */
export const FEED_DAYS_BACK = 30;
export const FEED_DAYS_AHEAD = 60;
/** The most entries one feed holds. */
export const FEED_MAX_ENTRIES = 2_000;

/** Where a feed is served. */
export const CALENDAR_FEED_PREFIX = '/x/cal/';

export interface FeedClaim {
  install: string;
  app: string;
  connection: string;
  /** The booked table's id, and the person's row of its resource table. */
  table: string;
  row: string;
  /** A digest of the sign-in address on that row when the link was made: a row that now holds someone else opens nothing. */
  address: string;
  nonce: string;
  /** The signed-in person who took the link: it stops while they are suspended, and for good once they are deleted. */
  user: string;
}

export function makeFeedToken(key: string, claim: FeedClaim): string {
  return sealLink(key, KIND, { v: 1, ...claim });
}

export function readFeedToken(keys: readonly string[], install: string, token: unknown): FeedClaim | null {
  const read = openLink(keys, KIND, token);
  if (read === null || read['v'] !== 1 || read['install'] !== install) return null;
  const { app, connection, table, row, address, nonce, user } = read;
  if (typeof app !== 'string' || typeof connection !== 'string' || typeof table !== 'string' || typeof row !== 'string' || typeof address !== 'string' || typeof nonce !== 'string' || typeof user !== 'string') return null;
  return { install, app, connection, table, row, address, nonce, user };
}

/** The feed link on this server's public address. */
export function feedUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${CALENDAR_FEED_PREFIX}${token}.ics`;
}

/** The booked table's calendar rule with a feed, and the table of the people it is booked with. */
export function feedTargetOf(view: SnapshotView, tableId: string): { table: ResolvedTable; rule: CalendarRule & { calendar: { feed: NonNullable<CalendarRule['calendar']['feed']> } }; resource: ResolvedTable } | null {
  let table: ResolvedTable;
  try {
    table = view.table(tableId);
  } catch {
    return null;
  }
  const rule = calendarRuleOf(table);
  if (rule === null || rule.calendar.feed === undefined || table.primaryKey.length !== 1) return null;
  const relation = view.model.relations.find((one) => one.from.tableId === table.id && one.from.columns.length === 1 && one.from.columns[0] === rule.resource);
  if (relation === undefined) return null;
  try {
    const resource = view.table(relation.to.tableId);
    return resource.primaryKey.length === 1 ? { table, rule: rule as never, resource } : null;
  } catch {
    return null;
  }
}

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('reading an app for its feed never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('reading an app for its feed never reads a credential');
  },
};

export interface FeedDeps {
  meta: MetaDb;
  secret: string;
  manager: ConnectionManager;
  viewFor: (connectionId: string) => Promise<SnapshotView | null>;
  now?: (() => number) | undefined;
}

/** What a live claim opens, or null: every reason there is none reads the same. */
async function liveFeed(deps: FeedDeps, claim: FeedClaim) {
  const holder = await usersRepo(deps.meta).findById(claim.user);
  if (holder === null || holder.status === 'suspended') return null;
  const installed = await manifestsRepo(deps.meta, NO_SECRETS).findInScope(claim.app, claim.connection);
  if (installed === null || installed.row.status !== 'installed' || installed.row.connectionId !== claim.connection) return null;
  const view = await deps.viewFor(claim.connection);
  if (view === null) return null;
  const target = feedTargetOf(view, claim.table);
  if (target === null) return null;
  const held = await calendarFeedsRepo(deps.meta).nonceOf({ connectionId: claim.connection, appKey: claim.app, tableName: target.table.id, rowKey: claim.row });
  if (held === null || held !== claim.nonce) return null;
  const pk = pkOfRowKey(target.resource, claim.row);
  if (pk === null) return null;
  const { db, dialect } = await deps.manager.data(claim.connection);
  const person = await fetchByPk(db, target.resource, pk);
  if (person === undefined) return null;
  // The person it was made for: a row handed to someone else, or a key used again after a delete, opens nothing.
  const own = person[target.rule.calendar.feed.own];
  if (typeof own !== 'string' || own.trim() === '' || addressDigest(own) !== claim.address) return null;
  const active = target.rule.calendar.feed.active;
  if (active !== undefined && !yes(person[active])) return null;
  return { view, db, dialect, target, personKey: person[target.resource.primaryKey[0]!] };
}

const yes = (value: unknown): boolean => value === true || value === 1 || value === '1' || value === 'true' || value === 't';

/** A feed's text and its version tag (which ignores the moment it was made), or null for a link that opens nothing. */
export async function renderFeed(deps: FeedDeps, token: string): Promise<{ body: string; etag: string } | null> {
  const install = await settingsRepo(deps.meta).get('system.instanceId');
  if (typeof install !== 'string' || install === '') return null;
  const claim = readFeedToken(await mailLinkKeys(deps.meta, deps.secret).feedAll(), install, token);
  if (claim === null) return null;
  const live = await liveFeed(deps, claim);
  if (live === null) return null;
  const { view, db, dialect, target, personKey } = live;
  const { table, rule } = target;
  const now = deps.now?.() ?? Date.now();
  const column = table.columns.get(rule.start);
  if (column === undefined) return null;
  const rows = (await (db as Kysely<SourceDatabase>)
    .selectFrom(table.id)
    .selectAll()
    .where(db.dynamic.ref(rule.resource), '=', personKey as never)
    .where(db.dynamic.ref(rule.countWhere.column), 'in', rule.countWhere.values as never)
    .where(db.dynamic.ref(rule.start), '>=', bindWriteValue(column, new Date(now - FEED_DAYS_BACK * DAY_MS).toISOString(), dialect) as never)
    .where(db.dynamic.ref(rule.start), '<=', bindWriteValue(column, new Date(now + FEED_DAYS_AHEAD * DAY_MS).toISOString(), dialect) as never)
    .orderBy(db.dynamic.ref(rule.start))
    .limit(FEED_MAX_ENTRIES)
    .execute()) as Row[];
  const read = settingReader(deps.meta, db, view, claim.connection);
  const feed = rule.calendar.feed;
  const names = feed.detail !== undefined && feed.customer !== undefined && String((await read(feed.detail)) ?? '') === 'name';
  const memo = new Map<string, string>();
  const ctx = { db, view, table, rule, appKey: claim.app, connectionId: claim.connection, install, locale: 'en-US', setting: (source: { table: string; column: string }) => read(source), memo };
  const events: CalendarEvent[] = [];
  for (const row of rows) {
    const customerName = names ? shownNameOfFull(await textAlong(db, view, table, row, feed.customer!, memo)) : undefined;
    const entry = await bookingEntry(ctx, row, { customerName, withoutNotice: true });
    if (entry !== null) events.push(entry.event);
  }
  const studio = String((await read(rule.calendar.studio.name)) ?? '').trim();
  const body = feedFile({ name: studio === '' ? 'Calendar' : studio, uid: `feed.${claim.app}.${encodeURIComponent(claim.connection)}.${encodeURIComponent(claim.row)}@${install}`, events, stamp: new Date(now) });
  // The moment it was made changes on every fetch and says nothing about the visits.
  const etag = `"${createHash('sha256').update(body.replace(/^DTSTAMP:.*\r\n/gm, '')).digest('base64url')}"`;
  return { body, etag };
}
