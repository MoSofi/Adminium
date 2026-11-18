// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE COUNTING LEVEL AND ITS KEEPING: Off, Counts only, Per visitor; when
 * counting started; and the daily sweep of what is kept past its months.
 *
 * - "Per visitor" needs the privacy notice: the banner links it, and a
 *   "yes" without a notice to read is no informed yes. Refused with
 *   {@link PerVisitorNeedsNotice} while the notice (the business's name and
 *   its address) is not set.
 * - Going DOWN from "Per visitor" (to Counts only or Off) ends the purpose
 *   the visitors said yes to: every visitor and visit row is deleted at once,
 *   and the caller writes ONE audit entry with the counts (never an id). A
 *   cookie left in a browser names nobody from then on.
 * - Going to Off stops counting; the counts kept stay until their sweep.
 * - Going UP from Off starts counting again: `privacy.countingSince` is set
 *   to that moment (a day with no views has no row, so only this can say
 *   when counting started). On boot it is set when it was never set and
 *   counting is on ({@link startCounting}).
 */
import { settingsRepo, viewDaysRepo, visitorsRepo, type BannerWords, type BannerLocale, type MetaDb, type VisitorsGone } from '@adminium/meta';

import { privacyNoticeReady } from '../privacy/business.js';
import type { TrackingLevel } from './counter.js';

/** "Per visitor" asked for while the privacy notice is not set. */
export class PerVisitorNeedsNotice extends Error {
  constructor() {
    super('Set the privacy notice first: the banner links it, so "Per visitor" needs it.');
  }
}

/** The counting tab, as it stands. */
export interface CountingState {
  level: TrackingLevel;
  /** When counting last started (epoch ms), or null when it never has. */
  countingSince: number | null;
  viewCountsMonths: number;
  visitsMonths: number;
  /** The owner's banner words per language; null: the defaults everywhere. */
  banner: Partial<Record<BannerLocale, BannerWords>> | null;
  /** Whether the privacy notice is set ("Per visitor" needs it). */
  noticeReady: boolean;
  /** What going down from "Per visitor" would delete now. */
  kept: VisitorsGone;
}

export async function countingState(meta: MetaDb): Promise<CountingState> {
  const settings = settingsRepo(meta);
  const [level, countingSince, viewCountsMonths, visitsMonths, banner, noticeReady, kept] = await Promise.all([
    settings.get('privacy.tracking'),
    settings.get('privacy.countingSince'),
    settings.get('privacy.viewCountsMonths'),
    settings.get('privacy.visitsMonths'),
    settings.get('privacy.banner'),
    privacyNoticeReady(meta),
    visitorsRepo(meta).counts(),
  ]);
  return { level, countingSince, viewCountsMonths, visitsMonths, banner, noticeReady, kept };
}

/** What a change did. */
export interface CountingChange {
  before: TrackingLevel;
  after: TrackingLevel;
  /** The visitor rows going down from "Per visitor" deleted; null when it did not go down from it. */
  deleted: VisitorsGone | null;
  /** Set when counting started again. */
  countingSince: number | null;
}

/**
 * Change the level (and, with it, the owner's banner words): see the header.
 * `banner` undefined leaves the words as they are.
 */
export async function changeCounting(
  meta: MetaDb,
  input: { level: TrackingLevel; banner?: Partial<Record<BannerLocale, BannerWords>> | null | undefined },
  opts: { by: string | null; at: number },
): Promise<CountingChange> {
  const settings = settingsRepo(meta);
  const before = await settings.get('privacy.tracking');
  const after = input.level;
  if (after === 'visitor' && before !== 'visitor' && !(await privacyNoticeReady(meta))) throw new PerVisitorNeedsNotice();
  if (input.banner !== undefined) await settings.set('privacy.banner', input.banner, { updatedBy: opts.by, at: opts.at });
  let countingSince: number | null = null;
  if (before !== after) {
    // Counting starts again from now; the rows from before stay as they were.
    if (before === 'off') {
      countingSince = opts.at;
      await settings.set('privacy.countingSince', opts.at, { updatedBy: opts.by, at: opts.at });
    }
    await settings.set('privacy.tracking', after, { updatedBy: opts.by, at: opts.at });
  }
  // The purpose the visitors said yes to has ended: every row goes at once.
  const deleted = before === 'visitor' && after !== 'visitor' ? await visitorsRepo(meta).deleteAll() : null;
  return { before, after, deleted, countingSince };
}

/** On boot: counting is on and was never said to have started — it starts now. */
export async function startCounting(meta: MetaDb, at: number): Promise<void> {
  const settings = settingsRepo(meta);
  if ((await settings.get('privacy.countingSince')) !== null) return;
  if ((await settings.get('privacy.tracking')) === 'off') return;
  await settings.set('privacy.countingSince', at, { updatedBy: null, at });
}

/** The day `months` months before `at`, in UTC, `YYYY-MM-DD`. */
export function monthsBefore(at: number, months: number): string {
  const date = new Date(at);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

/** What the daily sweep deleted. */
export interface CountingSwept {
  viewDays: number;
  visits: number;
  visitors: number;
}

/**
 * The daily sweep: view counts on days before `privacy.viewCountsMonths`,
 * visits before `privacy.visitsMonths`, then visitors with no visit left who
 * were not seen since.
 */
export async function sweepCounting(meta: MetaDb, at: number): Promise<CountingSwept> {
  const settings = settingsRepo(meta);
  const viewDays = await viewDaysRepo(meta).purgeBefore(monthsBefore(at, await settings.get('privacy.viewCountsMonths')));
  const cutoff = Date.parse(`${monthsBefore(at, await settings.get('privacy.visitsMonths'))}T00:00:00Z`);
  const gone = await visitorsRepo(meta).sweep(cutoff);
  return { viewDays, visits: gone.visits, visitors: gone.visitors };
}
