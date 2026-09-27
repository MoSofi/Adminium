// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CLOCK'S REFUSALS, AS A GUEST HEARS THEM.
 *
 * A move or a change a guest makes may be open only after one moment and
 * before another: a check-in from half an hour before the doors, a refund
 * until seven days before the show, a cancellation not inside the last two
 * days. The staff refusal says which end and the moment; a guest is told
 * `PUBLIC_TOO_EARLY {at}` (when it opens) or `PUBLIC_TOO_LATE {at}` (when it
 * closed) and nothing about any other row. A window shut by the linked row
 * (the show takes no refunds) or by a moment with no value is an unnamed
 * refusal: it would otherwise say what another row holds.
 */
import { AppError } from '../errors.js';

/** The public answer to a refusal made against the clock, or null for any other refusal. */
export function timedRefusal(error: unknown): { code: 'PUBLIC_TOO_EARLY' | 'PUBLIC_TOO_LATE'; params?: Record<string, unknown> } | null {
  if (!(error instanceof AppError)) return null;
  const details = (error.details ?? {}) as { requires?: unknown; bound?: unknown; at?: unknown; reason?: unknown };
  const at = typeof details.at === 'string' ? { at: details.at } : undefined;
  if (error.code === 'STATE_TOO_LATE') return { code: 'PUBLIC_TOO_LATE', ...(at === undefined ? {} : { params: at }) };
  const timed = error.code === 'WRITE_WINDOW_CLOSED' || (error.code === 'STATE_MOVE_REFUSED' && details.requires === 'time');
  if (!timed || at === undefined || details.reason !== undefined) return null;
  if (details.bound === 'after') return { code: 'PUBLIC_TOO_EARLY', params: at };
  if (details.bound === 'before') return { code: 'PUBLIC_TOO_LATE', params: at };
  return null;
}
