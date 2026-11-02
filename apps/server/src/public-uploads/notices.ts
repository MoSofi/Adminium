// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Telling the owner that strangers' uploads are being refused: the store is
 * full (`quota`), or one network address sent its day's files (`cap`).
 *
 * Every Super Admin is told, in their own language, through the
 * notifications system (bell and its e-mail leg) — at most ONCE AN HOUR for
 * each of the two: the first refusal in an hour claims that hour's name in
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

/** Why uploads were refused: the store holds its quota, or one address sent its day's files. */
export type UploadTrip = 'quota' | 'cap';

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

const WORDS: Readonly<Record<UploadTrip, { titleKey: string; bodyKey: string; title: string; body: string }>> = {
  quota: {
    titleKey: 'files:publicUploads.notice.quota.title',
    bodyKey: 'files:publicUploads.notice.quota.body',
    title: 'Files from your forms are being refused',
    body: 'The files strangers uploaded fill the space set for them ({gb} GB). Delete answers you no longer need, or raise the limit in Settings.',
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
  values: { gb?: string; n?: number },
  at: number,
): Promise<number> {
  let people: string[];
  try {
    people = await owners(deps.meta);
  } catch {
    return 0;
  }
  if (people.length === 0) return 0;
  const docs = paymentSettingsRepo(deps.meta);
  const name = `${NOTICE_CLAIM_PREFIX}public-uploads:${trip}:${String(Math.floor(at / HOUR_MS))}`;
  try {
    if (!(await docs.claim(name, claimSchema, { at }, at))) return 0;
  } catch {
    return 0;
  }
  let told = 0;
  for (const userId of people) {
    try {
      const i18n = await translatorFor(deps.meta, userId);
      const words = WORDS[trip];
      const shown = { gb: values.gb ?? '', n: values.n ?? 0 };
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
