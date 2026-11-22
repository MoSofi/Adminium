// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sync's fixed job kinds and timers (cT17, SYN-22). Nothing is registered
 * per add-on: the account or the row goes in the payload and the dedupe key.
 * Jobs are never retried by the queue (SYN-16): the row stays marked or the
 * account stays due, and the next tick is the retry. They run behind every
 * other job, and a service that is out holds that account's calls for a
 * minute, so a slow provider cannot keep mail or payments waiting.
 */
import { z } from 'zod';

import type { JobRegistry } from '../jobs/registry.js';
import { CALENDAR_POLL_JOB, CALENDAR_SYNC_ROW_JOB, type CalendarSync } from './service.js';

export const CALENDAR_PLAN_NAME = 'calendar.plan';
export const CALENDAR_PLAN_CRON = '* * * * *';
export const CALENDAR_SWEEP_NAME = 'calendar.sweep';
export const CALENDAR_SWEEP_CRON = '*/5 * * * *';
export const CALENDAR_DAILY_NAME = 'calendar.daily';
export const CALENDAR_DAILY_CRON = '41 * * * *';

const rowPayload = z.object({ connectionId: z.string().min(1).max(64), tableName: z.string().min(1).max(128), rowKey: z.string().min(1).max(191) }).strict();
const pollPayload = z.object({ accountId: z.string().min(1).max(36) }).strict();

export function registerCalendarSyncJobs(registry: JobRegistry, sync: CalendarSync): void {
  registry.registerJobHandler(CALENDAR_SYNC_ROW_JOB, rowPayload, async (payload) => sync.syncRow(payload), { internal: true });
  registry.registerJobHandler(CALENDAR_POLL_JOB, pollPayload, async (payload) => sync.readAccount(payload.accountId), { internal: true });
}
