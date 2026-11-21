// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `{{reviewLink}}` — the link a review mail carries, made when the mail goes
 * and only then (`reviews/link.ts`), for a kind the outbox names
 * (`outbox.reviewLinks`).
 *
 * The message's link names the reviewed row, that row's person is read through
 * the review word's own path, and the mail must be going to the address on
 * THEIR row: a link made for one person never reaches another. It is put in the
 * message's variables, which are sealed into the envelope with the rest of the
 * mail, so it is never stored in clear and nothing here logs it.
 */
import type { Outbox } from '@adminium/manifest';
import { settingsRepo, type MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { fetchByPk } from '../crud/records.js';
import { mailLinkKeys } from '../email/link-keys.js';
import { rowKeyOf } from '../payments/payables.js';
import { reviewWordOf } from '../reviews/host.js';
import { addressDigest, makeReviewToken, REVIEW_LINK_TTL_MS } from '../reviews/link.js';
import { followPath } from '../reviews/take.js';
import { referenced } from './recipient.js';

/** Why a message that prints a review link is not sent: the outbox row's sentence. */
export const REVIEW_LINK_SKIPS = {
  noRow: 'Not sent: the review link names no row',
  reviewed: 'Not sent: this was reviewed already',
  otherAddress: 'Not sent: a review link goes only to the address of the person whose visit it was',
  noAddress: 'Not sent: a review link needs this server\'s public address',
} as const;

const same = (stored: unknown, to: string): boolean => typeof stored === 'string' && stored.trim() !== '' && addressDigest(stored) === addressDigest(to);

/** The link for one message, or why it does not go. */
export async function reviewLinkFor(
  deps: { meta: MetaDb; secret: string; db: Kysely<SourceDatabase>; view: SnapshotView; now: number; base: string | null },
  input: { appKey: string; connectionId: string; block: NonNullable<Outbox['reviewLinks']>; definition: Pick<Outbox, 'table' | 'links' | 'recipient'>; message: Row; to: string },
): Promise<{ link: string } | { skip: string }> {
  const { db, view } = deps;
  const { block } = input;
  const column = input.definition.links?.[block.link];
  const id = column === undefined ? undefined : input.message[column];
  if (column === undefined || id === null || id === undefined) return { skip: REVIEW_LINK_SKIPS.noRow };
  const tableId = referenced(view, input.definition.table, column);
  if (tableId === undefined) return { skip: REVIEW_LINK_SKIPS.noRow };
  const table = view.table(tableId);
  const key = table.primaryKey[0];
  const host = await reviewWordOf(deps.meta, view, input.appKey, table.id);
  if (key === undefined || table.primaryKey.length !== 1 || host === null) return { skip: REVIEW_LINK_SKIPS.noRow };
  const row = await fetchByPk(db, table, { [key]: id });
  if (row === undefined) return { skip: REVIEW_LINK_SKIPS.noRow };
  const stamped = row[host.word.stamp];
  if (stamped !== null && stamped !== undefined && stamped !== '') return { skip: REVIEW_LINK_SKIPS.reviewed };
  // The review's person, and the mail going to the address on their own row.
  const person = await followPath(db, view, table, row, host.word.person, 'row');
  const recipient = input.definition.recipient;
  if (person === null || person.table.id !== view.table(recipient.table).id || !same(person.row[recipient.email], input.to)) return { skip: REVIEW_LINK_SKIPS.otherAddress };
  if (deps.base === null) return { skip: REVIEW_LINK_SKIPS.noAddress };
  const install = await settingsRepo(deps.meta).get('system.instanceId');
  if (typeof install !== 'string' || install === '') return { skip: REVIEW_LINK_SKIPS.noAddress };
  const token = makeReviewToken(await mailLinkKeys(deps.meta, deps.secret).review(), {
    install,
    app: input.appKey,
    connection: input.connectionId,
    table: table.id,
    row: rowKeyOf(table, row),
    column: recipient.email,
    address: addressDigest(input.to),
    expires: deps.now + REVIEW_LINK_TTL_MS,
  });
  return { link: `${deps.base.replace(/\/+$/, '')}/${block.page.replace(/^\/+/, '')}#${token}` };
}
