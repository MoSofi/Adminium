// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A trial past its end date runs no work of the user's in the background.
 *
 * `trial/read-only.ts` refuses writes that come in as requests. Scheduled
 * automations, an app's timed moves and reminders, queued imports and the
 * like write in this process with no request to refuse, so the job worker and
 * the schedule clock ask here before each one runs: once the policy answers
 * no to `writes`, a schedule not listed below does not fire, and a queued
 * job of a kind not listed below ends `failed` with the read-only words
 * instead of running.
 *
 * What stays is what the ended state itself needs: the exports (the way
 * out), the server's own mail (its own code decides which mail that is), the
 * events the operator is told, reading a source's schema, the catalogues, and
 * the sweeps that delete what has expired. A kind or schedule added later is
 * held until it is listed here.
 */
import type { TrialPolicy } from './policy.js';

/** The words a held job ends with. */
export const ENDED_JOB_WORDS = 'This trial has ended, so this installation is read-only. The job did not run.';

/** Job kinds that still run once a trial has ended. */
export const ENDED_TRIAL_JOB_KINDS: ReadonlySet<string> = new Set([
  // The operator's events about this instance.
  'operator.event',
  // Export everything, a table's export, a person's own data.
  'export-run',
  'privacy.export',
  // The server's mail; user mail is stopped where it is queued and sent (`email/send.ts`).
  'email.send',
  // Reading a source's schema, and the add-on and app catalogues.
  'introspect',
  'catalog-refresh',
  'app-catalog-refresh',
]);

/** Schedules that still fire once a trial has ended: clean-ups, the catalogues and counters. */
export const ENDED_TRIAL_SCHEDULES: ReadonlySet<string> = new Set([
  'exports-retention-sweep',
  'files-retention-sweep',
  'privacy-exports-sweep',
  'public-uploads-sweep',
  'form-answers-sweep',
  'forms-sweep',
  'retention-gc',
  'add-on-expire-sweep',
  'add-on-catalog-refresh',
  'app-catalog-refresh',
  'public-request-stats-flush',
  'telemetry-ping',
]);

/** What the job worker and the schedule clock ask: null to run, else why not. */
export interface EndedTrialHold {
  job(kind: string): string | null;
  schedule(name: string): boolean;
}

export function endedTrialHold(policy: Pick<TrialPolicy, 'allows'>): EndedTrialHold {
  const ended = (): boolean => !policy.allows('writes').allowed;
  return {
    job: (kind) => (ended() && !ENDED_TRIAL_JOB_KINDS.has(kind) ? ENDED_JOB_WORDS : null),
    schedule: (name) => ended() && !ENDED_TRIAL_SCHEDULES.has(name),
  };
}
