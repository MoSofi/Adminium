// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The nightly tidy-up for assistant sessions.
 *
 * Passes in this order, each for its own reason. A session with a turn still
 * waiting or running is never closed by any of them.
 *
 * CLOSE WHAT WAS ABANDONED. A modal's session is closed when the modal closes; a
 * browser that was quit, crashed or put to sleep never sends that. Those rows
 * would stay `open` forever and never become eligible for the second pass, so
 * anything untouched for a day is closed here. The person is long gone — there
 * is nothing to interrupt.
 *
 * CLOSE THE PANEL'S CONVERSATION WHEN IT IS OLD. It is one a person and stays
 * open across pages and days, so it is closed by its age (the same window as
 * the next pass), whatever its use.
 *
 * THEN DELETE WHAT IS OLD. Closed sessions past the configured window go, with
 * their turns. Transcripts are the largest rows this feature writes, and a
 * conversation nobody can reopen is not worth keeping — the audit row for
 * anything that was SAVED outlives it and is the durable record.
 */

import { assistantSessionsRepo, assistantUseDay, assistantUseRepo, settingsRepo, DAY_MS, type MetaDb } from '@adminium/meta';

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
  const idleBefore = at - ABANDONED_SESSION_MS;
  for (const session of await repo.listStaleOpen(idleBefore)) {
    // A turn still waiting or running is somebody's question: its session is left for the next pass.
    if (await repo.hasLiveTurn(session.id)) continue;
    if (await repo.close(session.id, at, { idleBefore })) closed += 1;
  }

  const days = await settingsRepo(meta).get('retention.assistantSessionsDays');
  // The panel's conversation is one a person, kept across pages and days, so "untouched for a
  // day" never ends it. Its AGE does, whatever its use: a conversation used daily would
  // otherwise never be closed, and so never deleted.
  for (const session of await repo.listOldPanels(at - days * DAY_MS)) {
    if (await repo.hasLiveTurn(session.id)) continue;
    if (await repo.close(session.id, at)) closed += 1;
  }
  const purged = await repo.purgeClosedBefore(at - days * DAY_MS);
  // What each person used on a day is held against that day's allowance and nothing later;
  // the rows are kept as long as the conversations are, then dropped.
  await assistantUseRepo(meta).purgeBefore(assistantUseDay(at - days * DAY_MS));
  return { closed, deleted: purged.sessions, turns: purged.turns };
}
