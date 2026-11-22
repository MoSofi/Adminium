// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The business's sending settings: the daily limit and the service hours.
 *
 * The limit is required. A setting that is missing or cannot be read falls
 * back to the default, so a damaged setting can never mean "no limit".
 */
import { usableZone } from '../../notifications/quiet.js';
import type { DailyHours } from './window.js';

export const DEFAULT_TEXT_DAILY_LIMIT = 500;
export const MAX_TEXT_DAILY_LIMIT = 100_000;
/** The share of the limit at which the business is warned. */
export const TEXT_WARNING_SHARE = 0.8;
export const DEFAULT_SERVICE_HOURS: Readonly<DailyHours> = { from: '08:00', to: '21:00' };

const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export interface TextSendPolicy {
  dailyLimit: number;
  serviceHours: DailyHours;
  /**
   * The one zone the daily count is kept in, for the whole server. A text's own
   * zone decides when it may go, and must not decide which day's count it uses,
   * or two zones would each get a full limit. UTC when unset or unusable.
   */
  dayZone: string;
}

function readHours(value: unknown): DailyHours {
  const hours = value as Partial<DailyHours> | null | undefined;
  const from = hours?.from;
  const to = hours?.to;
  // Equal ends say nothing: neither "always" nor "never" can be read from them.
  if (typeof from !== 'string' || typeof to !== 'string' || !CLOCK.test(from) || !CLOCK.test(to) || from === to) return { ...DEFAULT_SERVICE_HOURS };
  return { from, to };
}

export function readTextPolicy(stored: unknown): TextSendPolicy {
  const value = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, unknown>;
  const limit = value['dailyLimit'];
  return {
    dailyLimit: typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= MAX_TEXT_DAILY_LIMIT ? limit : DEFAULT_TEXT_DAILY_LIMIT,
    serviceHours: readHours(value['serviceHours']),
    dayZone: typeof value['dayZone'] === 'string' ? (usableZone(value['dayZone']) ?? 'UTC') : 'UTC',
  };
}

/** The count at which the warning shows. */
export function warningAt(limit: number): number {
  return Math.ceil(limit * TEXT_WARNING_SHARE);
}

/** The calendar day, `YYYY-MM-DD`, in a zone (UTC when it is not one that can be used). */
export function dayKey(at: number, zone: string | null): string {
  const read = (timeZone: string): string => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
  if (zone === null || zone === '') return read('UTC');
  try {
    return read(zone);
  } catch {
    return read('UTC');
  }
}
