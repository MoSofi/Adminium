// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The person's words for a refusal the server says in English: 403
 * `OFF_BY_OPERATOR` (a switch the operator of a trial or hosted installation
 * turned off, `details.question`) and the installation's connection-test
 * budget (429 `RATE_LIMITED`, `details.scope: 'instance'`).
 *
 * Loaded only when such an answer first arrives, or when `/system/info`
 * shows switches turned off (`refusals.ts`), and installed as every
 * `ApiError`'s message from then on, so a screen that shows `error.message`
 * says it in the person's language. Its words are the deferred
 * `operatorSwitches` and `operatorLock` groups of `common`, in before the
 * first message is built: nothing here reaches the entry chunk.
 */
import { offByOperatorWords, testBudgetWords } from '../settings/OffByOperator.js';
import { commonWordsReady } from '../i18n/commonWords.js';
import { setRefusalWords } from './refusals.js';

/** The words for `code` with `details`, or null where the server's message stands. */
export function refusalWords(code: string, details: unknown): string | null {
  const facts = (typeof details === 'object' && details !== null ? details : {}) as { question?: unknown; reason?: unknown; scope?: unknown; retryAfterSeconds?: unknown; limit?: unknown };
  if (code === 'OFF_BY_OPERATOR') return offByOperatorWords(typeof facts.question === 'string' ? facts.question : '', typeof facts.reason === 'string' ? facts.reason : undefined);
  if (code === 'RATE_LIMITED' && facts.scope === 'instance' && typeof facts.retryAfterSeconds === 'number') {
    return testBudgetWords(typeof facts.limit === 'number' ? facts.limit : 10, facts.retryAfterSeconds);
  }
  return null;
}

/** Waits for the words, then makes them every refusal's message. */
export async function install(): Promise<void> {
  await commonWordsReady();
  setRefusalWords(refusalWords);
}
