// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHEN IT REALLY HAPPENED — a staff device's own time for a write it sends
 * late: a door scan made without signal and sent when the phone is back
 * online.
 *
 * Only a staff member or an API key may say so, and only a little in the
 * past: up to six hours, and never ahead of now (a minute's grace for a
 * device clock that runs a little fast). The write then judges its own rules
 * by that time — the stamp says when the scan was made, and a window that was
 * open then lets it through — while every limit shared with other writers
 * still counts on the real clock (`write-clock.ts`). The audit row keeps the
 * time the device gave beside the time it arrived.
 */
import type { FastifyRequest } from 'fastify';

import { ValidationFailedError } from '../errors.js';
import type { WriteContext } from './write-context.js';

/** How far back a device may date a write. */
export const OCCURRED_AT_MAX_PAST_MS = 6 * 3_600_000;
/** How far ahead a device's clock may run and be taken as now. */
const OCCURRED_AT_SKEW_MS = 60_000;

/** The time each request said its write happened, for its audit row. */
const NOTED = new WeakMap<object, string>();

/**
 * The write's context with the device's time, when one was sent — refused
 * (422 on `occurredAt`) outside the six hours before now, or from a writer
 * who is not staff or an API key. A time a minute ahead is taken as now.
 */
export function withOccurredAt(context: WriteContext, sent: string | undefined, now: Date = new Date()): WriteContext {
  if (sent === undefined) return context;
  const at = new Date(sent);
  const refuse = (): never => {
    throw new ValidationFailedError('The time the write happened was refused.', { fields: { occurredAt: { code: 'out-of-range' } } });
  };
  const kind = context.actor?.kind;
  if ((kind !== 'user' && kind !== 'api-key') || context.origin === 'public') refuse();
  if (Number.isNaN(at.getTime())) refuse();
  if (at.getTime() > now.getTime() + OCCURRED_AT_SKEW_MS || at.getTime() < now.getTime() - OCCURRED_AT_MAX_PAST_MS) refuse();
  const occurredAt = at.getTime() > now.getTime() ? now : at;
  if (context.request !== null) NOTED.set(context.request, occurredAt.toISOString());
  return { ...context, occurredAt };
}

/** The time a request said its write happened, or undefined. */
export function occurredAtOf(request: FastifyRequest | null | undefined): string | undefined {
  return request === null || request === undefined ? undefined : NOTED.get(request);
}
