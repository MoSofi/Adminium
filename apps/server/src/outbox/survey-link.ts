// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `{{survey_link}}` — the link a survey invitation's mail carries, made when
 * the mail goes and only then.
 *
 * A forms add-on's outbox names the kinds that print it (`outbox.surveyLinks`;
 * the manifest holds every producer of such a kind to the add-on's
 * invitations table). For one message the sender asks this module, before the
 * message is claimed:
 *
 *  - the invitation is the row the message's producer link names;
 *  - it is still unanswered, and the mail is going to the very address it
 *    was made for (a link made for one person never reaches another);
 *  - its form is live;
 *  - the server has a public address (`system.publicOrigin`): without one
 *    there is no link, so the message is not sent and its row says why;
 *  - a NAMED survey's link carries a new one-use token (`forms/survey-token.ts`)
 *    and stops `stopAfterDays` days after the invitation was made (the form's
 *    `survey.stopAfterDays`): the invitation keeps the token's hash and that
 *    moment, written only once the message is claimed
 *    ({@link keepSurveyToken}), and only while it is still unanswered; a mail
 *    sent again makes a new token, and the old link stops working;
 *  - an anonymous survey (and a form) has an open link, with no token, and
 *    nothing is written.
 *
 * The link is put in the message's variables, which are sealed into the
 * envelope with the rest of the mail: it is never stored in clear, and
 * nothing here logs it.
 */
import { parseForm } from '@adminium/add-on-contracts/forms';
import { settingsRepo, type MetaDb } from '@adminium/meta';
import type { Dialect } from '@adminium/engine';
import { sql, type Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { readInstant } from '../crud/moments.js';
import { bindWriteValue } from '../crud/write-values.js';
import { jsonOf } from '../forms/catalog.js';
import { mintSurveyToken, surveyTokenHash, surveyUrl } from '../forms/survey-token.js';
import type { OutboxProducer } from '@adminium/manifest';
import { referenced, rowOf } from './recipient.js';
import { sourceOf } from './timing.js';

const DAY_MS = 86_400_000;

/** What a survey link is, once made: the link, and what the invitation keeps of it once the message is claimed. */
export interface SurveyLink {
  link: string;
  /** The invitation's table and key, and what it keeps; null for an open link (nothing is written). */
  keep: { table: string; pk: Row; hash: string; expiresAt: number } | null;
}

/** Why a message that prints a survey link is not sent: the outbox row's sentence. */
export const SURVEY_LINK_SKIPS = {
  noInvitation: 'Not sent: the survey link names no invitation',
  answered: 'Not sent: the survey was answered already',
  otherAddress: 'Not sent: a survey link goes only to the address it was made for',
  notLive: 'Not sent: the survey is not live',
  stopped: 'Not sent: the survey stopped taking answers for this invitation',
  noOrigin: 'Not sent: this server has no public address for the survey link (set it in Settings)',
} as const;

/** A moment as a database hands it back: a Date (Postgres, MySQL), or SQLite's zone-less wall clock (`crud/moments.ts`). */
export function instantOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return readInstant(value)?.getTime() ?? null;
}

/** The same address, as the sender compares one: the same characters, or the same ASCII letters in another case. */
function sameAddress(stored: string, to: string): boolean {
  const ascii = (text: string) => /^[\x21-\x7e]+$/.test(text);
  return stored === to || (ascii(stored) && ascii(to) && stored.toLowerCase() === to.toLowerCase());
}

/** The invitation a message is about: the row its producer's link names, on the table the producer reads. */
export async function invitationOf(
  ctx: { db: Kysely<SourceDatabase>; view: SnapshotView },
  producer: OutboxProducer | undefined,
  message: Row,
): Promise<{ table: string; row: Row } | null> {
  if (producer === undefined) return null;
  try {
    const table = ctx.view.table(sourceOf(producer).table).id;
    const row = await rowOf(ctx.db, ctx.view, table, message[producer.link]);
    return row === null ? null : { table, row };
  } catch {
    return null;
  }
}

/**
 * The person an invitation names (its `person_table` and `person_key`), as
 * the consent log keeps them: their "no" to surveys is found by their row as
 * well as by the address.
 */
export function invitationPerson(connectionId: string, invitation: Row): { connectionId: string; table: string; key: string } | null {
  const table = invitation['person_table'];
  const key = invitation['person_key'];
  return typeof table === 'string' && table !== '' && (typeof key === 'string' || typeof key === 'number') && String(key) !== '' ? { connectionId, table, key: String(key) } : null;
}

/** The survey link one message carries, or why it is not sent (see the header). Nothing is written here. */
export async function surveyLinkFor(
  ctx: { meta: MetaDb; db: Kysely<SourceDatabase>; view: SnapshotView; now: number },
  invitation: { table: string; row: Row } | null,
  to: string,
): Promise<SurveyLink | { skip: string }> {
  if (invitation === null) return { skip: SURVEY_LINK_SKIPS.noInvitation };
  const { row } = invitation;
  if (row['answered_at'] !== null && row['answered_at'] !== undefined) return { skip: SURVEY_LINK_SKIPS.answered };
  const email = row['email'];
  if (typeof email !== 'string' || !sameAddress(email.trim(), to.trim())) return { skip: SURVEY_LINK_SKIPS.otherAddress };

  const formsTable = referenced(ctx.view, invitation.table, 'form_id');
  const form = formsTable === undefined ? null : await rowOf(ctx.db, ctx.view, formsTable, row['form_id']);
  if (form === null || form['state'] !== 'live' || typeof form['slug'] !== 'string') return { skip: SURVEY_LINK_SKIPS.notLive };
  const published = jsonOf(form['published']) as { definition?: unknown; settings?: unknown } | null | undefined;
  const parsed = published === null || published === undefined ? null : parseForm(published.definition, published.settings);
  if (parsed === null || !parsed.ok) return { skip: SURVEY_LINK_SKIPS.notLive };

  const origin = await settingsRepo(ctx.meta).get('system.publicOrigin');
  if (typeof origin !== 'string' || origin.trim() === '') return { skip: SURVEY_LINK_SKIPS.noOrigin };

  const survey = parsed.form.settings.survey;
  if (survey?.mode !== 'named') return { link: surveyUrl(origin, form['slug'], null), keep: null };
  const invitedAt = instantOf(row['invited_at']) ?? ctx.now;
  const expiresAt = invitedAt + survey.stopAfterDays * DAY_MS;
  if (expiresAt <= ctx.now) return { skip: SURVEY_LINK_SKIPS.stopped };
  const key = ctx.view.table(invitation.table).primaryKey[0];
  if (key === undefined) return { skip: SURVEY_LINK_SKIPS.noInvitation };
  const token = mintSurveyToken();
  return { link: surveyUrl(origin, form['slug'], token), keep: { table: invitation.table, pk: { [key]: row[key] }, hash: surveyTokenHash(token), expiresAt } };
}

/**
 * Writes what the invitation keeps of a link once its message is claimed:
 * the token's hash and when it stops, only while the invitation is still
 * unanswered. False when it was answered meanwhile (the message must not go).
 */
export async function keepSurveyToken(target: { db: Kysely<SourceDatabase>; view: SnapshotView; dialect: Dialect }, keep: NonNullable<SurveyLink['keep']>): Promise<boolean> {
  const table = target.view.table(keep.table);
  const expires = table.columns.get('expires_at');
  const values: Row = { token_hash: keep.hash };
  if (expires !== undefined) values['expires_at'] = bindWriteValue(expires, new Date(keep.expiresAt).toISOString(), target.dialect);
  let update = target.db.updateTable(table.id as never).set(values as never);
  for (const [column, value] of Object.entries(keep.pk)) update = update.where(sql.ref(column), '=', value as never);
  const result = await update.where(sql.ref('answered_at'), 'is', null).executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}
