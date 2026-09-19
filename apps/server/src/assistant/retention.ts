// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The nightly tidy-up for assistant sessions.
 *
 * Two passes, in this order and for two different reasons.
 *
 * CLOSE WHAT WAS ABANDONED. A session is closed when the modal closes; a
 * browser that was quit, crashed or put to sleep never sends that. Those rows
 * would stay `open` forever and never become eligible for the second pass, so
 * anything untouched for a day is closed here. The person is long gone — there
 * is nothing to interrupt.
 *
 * THEN DELETE WHAT IS OLD. Closed sessions past the configured window go, with
 * their turns. Transcripts are the largest rows this feature writes, and a
 * conversation nobody can reopen is not worth keeping — the audit row for
 * anything that was SAVED outlives it and is the durable record.
 */

import { assistantSessionsRepo, settingsRepo, DAY_MS, type MetaDb } from '@adminium/meta';

/** How long an open session may sit untouched before the sweep closes it. */
export const ABANDONED_SESSION_MS = DAY_MS;

export interface AssistantSweepResult {
  /** Sessions a browser left open that this pass closed. */
  closed: number;
  /** Closed sessions deleted, with their turns. */
  deleted: number;
  turns: number;
}

export async function sweepAssistantSessions(
  meta: MetaDb,
  at: number = Date.now(),
): Promise<AssistantSweepResult> {
  const repo = assistantSessionsRepo(meta);

  let closed = 0;
  for (const session of await repo.listStaleOpen(at - ABANDONED_SESSION_MS)) {
    if (await repo.close(session.id, at)) closed += 1;
  }

  const days = await settingsRepo(meta).get('retention.assistantSessionsDays');
  const purged = await repo.purgeClosedBefore(at - days * DAY_MS);
  return { closed, deleted: purged.sessions, turns: purged.turns };
}
