// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A TEST TEXT MAY COST: `POST /sms/test` sends one fixed text to a number
 * the signed-in person types, with no consent asked. That is only safe while
 * it is the person's own number, so it is held to that as nearly as the
 * server can without a code sent first:
 *
 *  - each person may test at most {@link SMS_TEST_NUMBERS_PER_PERSON_DAY}
 *    different numbers a day (one, and one more for a typo), so it is no way
 *    to text strangers;
 *  - the whole server sends at most {@link SMS_TEST_LIMIT} in
 *    {@link SMS_TEST_WINDOW_MS} and {@link SMS_TEST_PER_DAY} a day;
 *  - each test takes a slot of the day's text limit, so it shows in usage and
 *    stops when the day is used up. The slot stays used even when the provider
 *    refuses: a test is rare, and its count never runs backwards.
 *
 * The counts live in meta (the form marks a stranger's answers are counted
 * in), so a restart or a second replica starts nothing afresh. A number is
 * counted under a keyed hash, never in clear. The route's audit row names the
 * person and the number's last two digits.
 */
import { createHmac } from 'node:crypto';

import { formMarksRepo, type MetaDb } from '@adminium/meta';

import { RateLimitedError } from '../errors.js';
import { capKey } from '../public-api/anonymous-caps.js';
import { dayKey, readTextPolicy } from './send/policy.js';
import type { TextSendStore } from './send/store.js';
import { SMS_TEST_LIMIT, SMS_TEST_WINDOW_MS } from './service.js';

/** Test texts a day on the whole server. */
export const SMS_TEST_PER_DAY = 20;
/** Different numbers one person may test in a day. */
export const SMS_TEST_NUMBERS_PER_PERSON_DAY = 2;

const DAY_MS = 24 * 60 * 60 * 1000;
const SERVER_SUBJECT = 'sms-test';
const SERVER_PURPOSE = 'sms-test';

export interface SmsTestGateDeps {
  meta: MetaDb;
  secret: string;
  store: Pick<TextSendStore, 'takeSlot'>;
  /** The stored sending settings: the day's clock and limit. */
  policy: () => Promise<unknown>;
  now?: (() => number) | undefined;
}

/** Throws when this test may not go; takes its counts when it may. */
export type SmsTestGate = (userId: string, e164: string) => Promise<void>;

export function createSmsTestGate(deps: SmsTestGateDeps): SmsTestGate {
  const marks = formMarksRepo(deps.meta);
  const key = capKey(deps.secret);
  const now = deps.now ?? Date.now;
  const personSubject = (userId: string): string => `sms-test-person:${createHmac('sha256', key).update(userId).digest('hex')}`;
  // Sixteen characters is the purpose's width: `n:` and fourteen of the number's keyed hash.
  const numberPurpose = (e164: string): string => `n:${createHmac('sha256', key).update(e164).digest('hex').slice(0, 14)}`;

  return async (userId, e164) => {
    const at = now();
    const person = personSubject(userId);
    const purpose = numberPurpose(e164);
    const since = at - DAY_MS;
    const known = (await marks.sentSince(person, since, purpose)) > 0;
    if (!known && (await distinctNumbers(person, since)) >= SMS_TEST_NUMBERS_PER_PERSON_DAY) {
      throw new RateLimitedError('A test text goes to your own number. You have tested other numbers today: try again tomorrow.', { reason: 'test-number' });
    }
    if ((await marks.sentSince(SERVER_SUBJECT, at - SMS_TEST_WINDOW_MS, SERVER_PURPOSE)) >= SMS_TEST_LIMIT) throw new RateLimitedError('Too many test texts. Try again in a few minutes.', { reason: 'test-limit' });
    if ((await marks.sentSince(SERVER_SUBJECT, since, SERVER_PURPOSE)) >= SMS_TEST_PER_DAY) throw new RateLimitedError('Too many test texts today. Try again tomorrow.', { reason: 'test-limit' });
    const policy = readTextPolicy(await deps.policy());
    if (!(await deps.store.takeSlot(dayKey(at, policy.dayZone), policy.dailyLimit, at))) throw new RateLimitedError('Today\'s text limit is used up, test texts included.', { reason: 'daily-limit' });
    await marks.mark({ subject: SERVER_SUBJECT, purpose: SERVER_PURPOSE }, at);
    await marks.mark({ subject: person, purpose }, at);
  };

  /** How many different numbers this person tested since then. */
  async function distinctNumbers(subject: string, since: number): Promise<number> {
    const rows = await deps.meta.db.selectFrom('adminium_form_marks').select('purpose').distinct().where('subject', '=', subject).where('createdAt', '>=', since).execute();
    return rows.length;
  }
}
