// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CONFIRMATION A GUEST'S BOOKING SENDS.
 *
 * An app's guest page is static: it has no server of its own, so when a guest
 * books a table through the public API, Adminium is the only thing that can
 * send them the confirmation. An endpoint whose definition carries `confirm`
 * does, right after the row is written:
 *
 *  - to the address in the row's `to` column — no address, no mail;
 *  - in the guest's own language (their browser's `Accept-Language`, else the
 *    workspace's), with the time written the way that language writes it, on
 *    the venue's clock (the key scope's zone);
 *  - with the venue's name, address and phone from its one-row settings table,
 *    the cancellation window from the table's booking limit, and a link back
 *    to the app's guest side to manage the booking.
 *
 * Mail is optional infrastructure: without SMTP nothing is queued and the
 * booking stands (the install check says so beforehand). A failure here never
 * undoes, or fails, the booking it confirms.
 */
import type { FastifyRequest } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { settingsRepo, type MetaDb } from '@adminium/meta';

import type { CapacitySetting } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { slotInstant } from '../crud/capacity-guard.js';
import type { ResolvedTable } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { BOOKING_CONFIRMATION_TEMPLATE_KEY, enqueueEmail } from '../email/send.js';
import { formatTag } from '../i18n/bcp47.js';
import { recipientLocale } from '../i18n/server-i18n.js';
import { negotiateLocale } from '../plugins/surfaces.js';
import { linkOrigin } from '../security/public-origin.js';
import type { PublicConfirm } from './endpoint.js';

type Db = Kysely<SourceDatabase>;

export interface ConfirmInput {
  meta: MetaDb;
  request: FastifyRequest;
  confirm: PublicConfirm;
  row: Row;
  db: Db;
  table: ResolvedTable;
  /** The key scope's zone: the venue's clock. */
  timezone: string;
  /** The installed app the key belongs to, whose guest side the link leads to. */
  appKey: string | null;
}

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));

async function oneRow(db: Db, table: string, columns: readonly string[]): Promise<Row> {
  if (columns.length === 0) return {};
  const row = (await db
    .selectFrom(table)
    .select(columns.map((column) => sql<unknown>`${sql.ref(column)}`.as(column)))
    .limit(1)
    .executeTakeFirst()) as Row | undefined;
  return row ?? {};
}

async function hoursOf(db: Db, value: number | CapacitySetting | undefined): Promise<string> {
  if (value === undefined) return '';
  if (typeof value === 'number') return String(value);
  return text((await oneRow(db, value.table, [value.column]))[value.column]);
}

/** Where the guest manages it: the app's guest side, on its own host when it has one. */
async function manageUrl(input: ConfirmInput, code: string): Promise<string> {
  const settings = await input.request.server.surfaceSettings?.read();
  const host =
    input.appKey === null
      ? undefined
      : Object.entries(settings?.domains ?? {}).find(
          ([, target]) => target.appKey === input.appKey && target.side === 'customer' && target.instance === undefined,
        )?.[0];
  const base =
    host !== undefined
      ? `https://${host}/`
      : `${await linkOrigin(input.meta, input.request)}${input.appKey === null ? '/' : `/apps/${input.appKey}/customer/`}`;
  const link = (input.confirm.link ?? '').replace('{code}', encodeURIComponent(code)).replace(/^\//, '');
  return `${base}${link}`;
}

/** Queue the confirmation for a row a guest just created; never throws. */
export async function sendConfirmation(input: ConfirmInput): Promise<boolean> {
  const { confirm, row } = input;
  try {
    const to = text(row[confirm.to]).trim();
    if (!to.includes('@')) return false;
    const locale =
      negotiateLocale(input.request.headers['accept-language']) ?? (await recipientLocale(input.meta, null));
    const instant = confirm.when === undefined ? null : slotInstant(row[confirm.when]);
    // The words in the nearest language; the time the guest's own way (`en-GB` reads 09:30).
    const when =
      instant === null
        ? ''
        : new Intl.DateTimeFormat(formatTag(input.request.headers['accept-language'], locale), {
            dateStyle: 'full',
            timeStyle: 'short',
            timeZone: input.timezone,
          }).format(instant);
    const venue = confirm.venue;
    const settings =
      venue === undefined
        ? {}
        : await oneRow(input.db, venue.table, [venue.name, venue.address, venue.phone].filter((c): c is string => c !== undefined));
    const code = confirm.code === undefined ? '' : text(row[confirm.code]);
    const job = await enqueueEmail(
      { meta: input.meta, logger: input.request.log },
      {
        to,
        templateKey: BOOKING_CONFIRMATION_TEMPLATE_KEY,
        locale,
        vars: {
          appName: text(await settingsRepo(input.meta).get('branding.appName')),
          venue: venue?.name === undefined ? '' : text(settings[venue.name]),
          address: venue?.address === undefined ? '' : text(settings[venue.address]),
          phone: venue?.phone === undefined ? '' : text(settings[venue.phone]),
          name: confirm.name === undefined ? '' : text(row[confirm.name]),
          code,
          when,
          party: confirm.party === undefined ? '' : text(row[confirm.party]),
          cancelHours: await hoursOf(input.db, input.table.table.capacity?.cancelHours),
          manageUrl: await manageUrl(input, code),
        },
      },
    );
    return job !== null;
  } catch (error) {
    input.request.log.warn({ err: error }, 'the booking was made, but its confirmation email could not be queued');
    return false;
  }
}
