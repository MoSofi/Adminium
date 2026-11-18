// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Visitor counting as the server composes it: one counter and one visitor
 * door per process, the minute flush, the daily sweep, and when counting
 * started. `compose.ts` calls {@link createCounting} once and hands the parts
 * to the doors (`counter`, `visitors`), the privacy routes (`counter`) and the
 * scheduler ({@link registerCountingSchedules}).
 */
import { connectionTenantConfig, settingsRepo, viewDaysRepo, visitorsRepo, type MetaDb } from '@adminium/meta';

import { addressKeyRing } from '../consent/keys.js';
import { createViewCounter, type ViewCounter } from './counter.js';
import { startCounting, sweepCounting } from './tracking.js';
import { createVisitorDoor, type VisitorDoor } from './visitor.js';

/** Every minute: the counts and visits held in memory, written. */
export const VIEW_COUNTS_FLUSH_NAME = 'view-counts-flush';
export const VIEW_COUNTS_FLUSH_CRON = '* * * * *';
/** Daily: view counts and visits past their months (`privacy.viewCountsMonths`, `privacy.visitsMonths`). */
export const VIEW_COUNTS_SWEEP_NAME = 'view-counts-sweep';
export const VIEW_COUNTS_SWEEP_CRON = '55 3 * * *';

/** How long an install's time zone is kept between reads. */
const ZONE_KEEP_MS = 5 * 60_000;

/** The business's zone for an install's things: its database's, else UTC; kept a few minutes. */
export function zoneOfInstall(meta: MetaDb, now: () => number = Date.now): (installId: string) => Promise<string> {
  const kept = new Map<string, { at: number; zone: string }>();
  return async (installId) => {
    const held = kept.get(installId);
    if (held !== undefined && now() - held.at < ZONE_KEEP_MS) return held.zone;
    const row = await meta.db.selectFrom('adminium_manifests').select('connectionId').where('id', '=', installId).executeTakeFirst();
    const zone = row?.connectionId == null ? 'UTC' : ((await connectionTenantConfig(meta, row.connectionId))?.timezone ?? 'UTC');
    if (kept.size > 1_000) kept.clear();
    kept.set(installId, { at: now(), zone });
    return zone;
  };
}

export interface Counting {
  counter: ViewCounter;
  visitors: VisitorDoor;
}

export interface CountingLogger {
  warn: (obj: Record<string, unknown>, msg: string) => void;
  info: (obj: Record<string, unknown>, msg: string) => void;
}

/** The counter and the visitor door, with the level read and when counting started set (see the header). */
export async function createCounting(deps: { meta: MetaDb; secret: string; log: CountingLogger; now?: () => number }): Promise<Counting> {
  const { meta } = deps;
  const now = deps.now ?? Date.now;
  const settings = settingsRepo(meta);
  const views = viewDaysRepo(meta);
  const kept = visitorsRepo(meta);
  const ring = addressKeyRing(meta, deps.secret);
  let visitors: VisitorDoor | null = null;
  const counter = createViewCounter({
    add: (count) => views.add(count),
    addVisits: (list) => kept.addVisits(list),
    zoneOf: zoneOfInstall(meta, now),
    readLevel: () => settings.get('privacy.tracking'),
    visitorOf: (request) => (visitors === null || request.protocol === undefined ? null : visitors.idOf({ headers: request.headers as never, protocol: request.protocol })),
    now,
    onError: (error) => deps.log.warn({ err: error }, 'view counts could not be written; this minute is dropped'),
  });
  visitors = createVisitorDoor({ meta, secret: deps.secret, level: () => counter.level(), hashForWrite: (address) => ring.hashForWrite(address) });
  await startCounting(meta, now()).catch((error: unknown) => deps.log.warn({ err: error }, 'when counting started could not be written'));
  await counter.refresh().catch(() => counter.level());
  return { counter, visitors };
}

/** What `registerCountingSchedules` registers on. */
export interface CountingScheduler {
  registerSchedule: (name: string, cron: string, run: () => Promise<void>, opts?: { jitterMs?: number }) => void;
}

/** The minute flush and the daily sweep. */
export function registerCountingSchedules(scheduler: CountingScheduler, deps: { meta: MetaDb; counting: Counting; log: CountingLogger }): void {
  scheduler.registerSchedule(VIEW_COUNTS_FLUSH_NAME, VIEW_COUNTS_FLUSH_CRON, () => deps.counting.counter.flush(), { jitterMs: 2_000 });
  scheduler.registerSchedule(VIEW_COUNTS_SWEEP_NAME, VIEW_COUNTS_SWEEP_CRON, async () => {
    const swept = await sweepCounting(deps.meta, Date.now());
    if (swept.viewDays > 0 || swept.visits > 0 || swept.visitors > 0) deps.log.info({ ...swept }, 'view counts sweep');
  });
}
