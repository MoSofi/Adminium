// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Telling the owner that strangers' uploads are being refused: a pool is full
 * (`quota`: forms' files, or guests' files for an app's columns, each said
 * apart), one network address sent its day's files (`cap`), or its day's
 * bytes (`bytes`).
 *
 * Every Super Admin is told, in their own language, through the
 * notifications system (bell and its e-mail leg) — at most ONCE AN HOUR for
 * each of them (a pool's quota is its own): the first refusal in an hour claims that hour's name in
 * the "told once" store the payment notices use (`notice:` names, dropped
 * after 90 days by their sweep), every other refusal that hour, in any
 * process, stays quiet. Best effort: a notice that cannot be written never
 * changes the refusal it reports.
 */
import { paymentSettingsRepo, rolesRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import { translatorFor } from '../i18n/server-i18n.js';
import { notify, type NotificationPublisher } from '../notifications/notify.js';
import { NOTICE_CLAIM_PREFIX } from '../payments/notices.js';

/** Why uploads were refused: a pool holds its share, or one address sent its day's files or bytes. */
export type UploadTrip = 'quota' | 'cap' | 'bytes';

/** What a notice says: the pool's share in GB, the day's files, the day's megabytes; and which pool filled. */
export interface UploadTripValues {
  gb?: string;
  n?: number;
  mb?: string;
  pool?: 'forms' | 'columns';
}

/** The notice's kind (what a person's notification settings switch). */
export const UPLOAD_NOTICE_KIND = 'publicUploads.refused';

const HOUR_MS = 3_600_000;
const claimSchema = z.object({ at: z.number() }).strict();

/** Every active Super Admin: the owner of the install. */
async function owners(meta: MetaDb): Promise<string[]> {
  const superAdmin = await rolesRepo(meta).findBySlug('super-admin');
  if (superAdmin === null) return [];
  const out: string[] = [];
  for (const userId of await rolesRepo(meta).usersInRole(superAdmin.id)) {
    const user = await usersRepo(meta).findById(userId);
    if (user !== null && user.status === 'active') out.push(userId);
  }
  return out.sort();
}

type Notice = 'quota' | 'quotaColumns' | 'cap' | 'bytes';

const WORDS: Readonly<Record<Notice, { titleKey: string; bodyKey: string; title: string; body: string }>> = {
  quota: {
    titleKey: 'files:publicUploads.notice.quota.title',
    bodyKey: 'files:publicUploads.notice.quota.body',
    title: 'Files from your forms are being refused',
    body: 'The files strangers sent with your forms, waiting for their answers, fill the space set for them ({gb} GB). It frees itself as they are sent or expire, or raise the limit in Settings.',
  },
  quotaColumns: {
    titleKey: 'files:publicUploads.notice.quotaColumns.title',
    bodyKey: 'files:publicUploads.notice.quotaColumns.body',
    title: "Customers' files are being refused",
    body: 'The files customers uploaded for your apps, waiting for their orders, fill the space set for them ({gb} GB). It frees itself as they order or the files expire, or raise the limit in Settings.',
  },
  bytes: {
    titleKey: 'files:publicUploads.notice.bytes.title',
    bodyKey: 'files:publicUploads.notice.bytes.body',
    title: 'One visitor sent too much',
    body: 'A network address sent {mb} MB of files in a day, the most allowed. Its next files are refused until tomorrow.',
  },
  cap: {
    titleKey: 'files:publicUploads.notice.cap.title',
    bodyKey: 'files:publicUploads.notice.cap.body',
    title: 'One visitor sent too many files',
    body: 'A network address sent {n} files in a day, the most allowed. Its next files are refused until tomorrow.',
  },
};

/**
 * Tells the owner once in this hour that uploads were refused for `trip`.
 * Answers how many were told (0 when someone was told this hour already).
 */
export async function tellUploadsRefused(
  deps: { meta: MetaDb; hub?: NotificationPublisher | undefined },
  trip: UploadTrip,
  values: UploadTripValues,
  at: number,
): Promise<number> {
  const notice: Notice = trip === 'quota' && values.pool === 'columns' ? 'quotaColumns' : trip;
  let people: string[];
  try {
    people = await owners(deps.meta);
  } catch {
    return 0;
  }
  if (people.length === 0) return 0;
  const docs = paymentSettingsRepo(deps.meta);
  // A pool's quota is told apart from the other's: a flood on one never quiets the other's notice.
  const name = `${NOTICE_CLAIM_PREFIX}public-uploads:${notice}:${String(Math.floor(at / HOUR_MS))}`;
  try {
    if (!(await docs.claim(name, claimSchema, { at }, at))) return 0;
  } catch {
    return 0;
  }
  let told = 0;
  for (const userId of people) {
    try {
      const i18n = await translatorFor(deps.meta, userId);
      const words = WORDS[notice];
      const shown = { gb: values.gb ?? '', n: values.n ?? 0, mb: values.mb ?? '' };
      await notify(
        deps.meta,
        {
          userId,
          kind: UPLOAD_NOTICE_KIND,
          title: i18n.t(words.titleKey, { defaultValue: words.title, ...shown }),
          body: i18n.t(words.bodyKey, { defaultValue: words.body, ...shown }),
          actionUrl: '/settings',
        },
        { at, ...(deps.hub === undefined ? {} : { hub: deps.hub }) },
      );
      told += 1;
    } catch {
      // One person's notice failing never stops the others'.
    }
  }
  // Told to nobody: let the hour's claim go, so the next refusal tries again.
  if (told === 0) await docs.remove(name).catch(() => undefined);
  return told;
}
