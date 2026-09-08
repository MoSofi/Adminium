// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Names shared between the producers (matcher, watch poller, schedule
 * scanner), the job registry and `compose.ts`. Their own module so importing
 * a constant never drags a runner — and its whole dependency tree — into a
 * route.
 */

/** The job kind that walks a rule's graph. INTERNAL: never enqueued by `POST /jobs`. */
export const AUTOMATION_RUN_KIND = 'automation.run';

/** Croner schedule names (08 §2 jobs plugin; both tick every minute). */
export const AUTOMATION_WATCH_SCHEDULE_NAME = 'automation-watch';
export const AUTOMATION_SCHEDULE_SCAN_NAME = 'automation-schedule';
export const AUTOMATION_POLL_CRON = '* * * * *';

/**
 * Jitter, so the two pollers and the scheduled-reports poll — all three on
 * `* * * * *` — do not land on the same second of every minute (§8).
 */
export const AUTOMATION_WATCH_JITTER_MS = 5_000;
export const AUTOMATION_SCHEDULE_JITTER_MS = 10_000;

/** Rows one watch tick reads per rule, and rows one scan tick may enqueue. */
export const AUTOMATION_WATCH_BATCH = 500;
export const AUTOMATION_SCAN_PAGE = 500;
export const AUTOMATION_SCAN_CAP = 10_000;
