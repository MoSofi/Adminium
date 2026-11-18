// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What bounds the calls to one source of a lead source add-on, so a click or
 * a rule never spends more of the owner's account than they said.
 *
 * In memory, per process (a restart forgets them, and nothing is lost: each
 * is a matter of seconds):
 *  - the source's own rate window (`window` in its manifest entry: "600
 *    calls in 300 seconds") as a bucket, refilled as the window runs;
 *  - a pause: a source that answered 429, or said it was rate limited, is not
 *    asked again for the seconds it named (a minute when it named none). Only
 *    that source pauses;
 *  - at most two calls in flight per source per install.
 *
 * Persisted (`adminium_source_days`), per install, source and UTC day:
 *  - the day's total, against the source's daily cap (paid sources: 100
 *    unless the owner set another);
 *  - each staff member's own count, against their share of the cap (half,
 *    unless the owner set another), so one person cannot spend the day;
 *  - the automation step's own count, against a smaller budget of its own.
 * A call reserves on both before it is made and settles after, so calls at
 * once never pass a cap together; every page of a search is a call.
 *
 * Each refusal is named (`SOURCE_OFF`, `KEY_NOT_SET`, `DAILY_CAP`,
 * `PERSON_SHARE`, `PAUSED` with the seconds left, `BUSY`), so the screen says
 * which, and nothing was asked of the source.
 */
import { SOURCE_DAY_STEP, SOURCE_DAY_TOTAL, sourceDayOf, sourceDaysRepo, type MetaDb } from '@adminium/meta';

import type { SourceState } from './state.js';

/** Calls one source of one install may have running at once. */
export const MAX_IN_FLIGHT = 2;
/** How long a source that said "too many" without saying how long is left alone. */
export const DEFAULT_PAUSE_SECONDS = 60;
/** The longest pause a source may ask for. */
export const MAX_PAUSE_SECONDS = 3600;
/** The automation step's daily calls on a source with no daily cap. */
export const STEP_DAILY_CALLS = 100;
/** The automation step's share of a capped source's day, in per cent: smaller than a person's. */
export const STEP_SHARE = 20;

/** The spender that is the automation step. */
export const STEP_SPENDER = SOURCE_DAY_STEP;

export const SOURCE_REFUSAL_CODES = ['SOURCE_OFF', 'KEY_NOT_SET', 'DAILY_CAP', 'PERSON_SHARE', 'PAUSED', 'BUSY', 'NOT_VOUCHED'] as const;
export type SourceRefusalCode = (typeof SOURCE_REFUSAL_CODES)[number];

/** The engine said no before the source was asked. */
export interface SourceRefusal {
  ok: false;
  code: SourceRefusalCode;
  message: string;
  /** `PAUSED`: the seconds until the source may be asked again. */
  retryAfterSeconds?: number;
  /** `DAILY_CAP`, `PERSON_SHARE`: the calls made today and the cap they reached. */
  used?: number;
  cap?: number;
}

const refusal = (code: SourceRefusalCode, message: string, more: Omit<SourceRefusal, 'ok' | 'code' | 'message'> = {}): SourceRefusal => ({ ok: false, code, message, ...more });

/** A source's own rate window, as its manifest entry declares it. */
export interface SourceWindow {
  calls: number;
  seconds: number;
}

interface Slot {
  inFlight: number;
  tokens: number;
  refilledAt: number;
  pausedUntil: number;
}

/** The in-memory half (see the header): one per process. */
export class SourceGate {
  readonly #slots = new Map<string, Slot>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  #slot(installId: string, source: string, window: SourceWindow | undefined): Slot {
    const name = `${installId}\u0000${source}`;
    let slot = this.#slots.get(name);
    if (slot === undefined) {
      slot = { inFlight: 0, tokens: window?.calls ?? 0, refilledAt: this.#now(), pausedUntil: 0 };
      this.#slots.set(name, slot);
    }
    if (window !== undefined) {
      const at = this.#now();
      slot.tokens = Math.min(window.calls, slot.tokens + ((at - slot.refilledAt) * window.calls) / (window.seconds * 1000));
      slot.refilledAt = at;
    }
    return slot;
  }

  /**
   * Lets one call in, or says why not: paused, two already running, or the
   * window spent. The caller calls `leave` when the call ended, whatever
   * became of it.
   */
  enter(installId: string, source: string, window: SourceWindow | undefined): { ok: true; leave: () => void } | SourceRefusal {
    const slot = this.#slot(installId, source, window);
    const at = this.#now();
    if (slot.pausedUntil > at) {
      const seconds = Math.ceil((slot.pausedUntil - at) / 1000);
      return refusal('PAUSED', `${source} asked to be left alone for a while: try again in ${seconds} seconds.`, { retryAfterSeconds: seconds });
    }
    if (slot.inFlight >= MAX_IN_FLIGHT) return refusal('BUSY', `${source} is answering ${MAX_IN_FLIGHT} questions already: try again when one is done.`);
    if (window !== undefined) {
      if (slot.tokens < 1) {
        const seconds = Math.max(1, Math.ceil(((1 - slot.tokens) * window.seconds) / window.calls));
        return refusal('PAUSED', `${source} takes ${window.calls} calls in ${window.seconds} seconds: try again in ${seconds} seconds.`, { retryAfterSeconds: seconds });
      }
      slot.tokens -= 1;
    }
    slot.inFlight += 1;
    let left = false;
    return {
      ok: true,
      leave: () => {
        if (left) return;
        left = true;
        slot.inFlight = Math.max(0, slot.inFlight - 1);
      },
    };
  }

  /** The source said "too many": it is not asked again for `seconds` (a minute when it named none). */
  pause(installId: string, source: string, seconds: number | undefined): void {
    const slot = this.#slot(installId, source, undefined);
    const wait = Math.min(MAX_PAUSE_SECONDS, Math.max(1, Math.round(seconds ?? DEFAULT_PAUSE_SECONDS)));
    slot.pausedUntil = Math.max(slot.pausedUntil, this.#now() + wait * 1000);
  }

  /** The seconds a source is still paused for; 0 when it is not. */
  pausedFor(installId: string, source: string): number {
    const slot = this.#slots.get(`${installId}\u0000${source}`);
    const at = this.#now();
    return slot === undefined || slot.pausedUntil <= at ? 0 : Math.ceil((slot.pausedUntil - at) / 1000);
  }
}

/** The one gate of this process. */
export const sourceGate = new SourceGate();

/** A `Retry-After` header as seconds (a number, or a date); undefined when it says neither. */
export function retryAfterSeconds(header: string | null, now: number = Date.now()): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value);
  const when = Date.parse(value);
  return Number.isNaN(when) ? undefined : Math.max(0, Math.ceil((when - now) / 1000));
}

/** One person's share of a day's cap; null when there is no cap or no share. */
export function personCap(state: Pick<SourceState, 'dailyCap' | 'personShare'>): number | null {
  if (state.dailyCap === null || state.personShare === null) return null;
  return Math.max(1, Math.floor((state.dailyCap * state.personShare) / 100));
}

/** The automation step's own budget for a day: a fifth of a capped source's day, else its own small number. */
export function stepCap(state: Pick<SourceState, 'dailyCap'>): number {
  return state.dailyCap === null ? STEP_DAILY_CALLS : Math.max(1, Math.floor((state.dailyCap * STEP_SHARE) / 100));
}

/** What the call is counted against: who asked, on which day. */
export interface DayHold {
  /** Ends the hold: `made` counts the call (it was asked of the source), else it counts nothing. */
  settle(made: boolean): Promise<void>;
}

/**
 * Reserves one call on the day's total and on its spender's own count, or
 * says which cap it met. Each reservation is one statement, so calls at once
 * never pass a cap together.
 */
export async function reserveDay(
  meta: MetaDb,
  input: { installId: string; source: string; spender: string; state: Pick<SourceState, 'dailyCap' | 'personShare'>; at: number },
): Promise<{ ok: true; hold: DayHold } | SourceRefusal> {
  const days = sourceDaysRepo(meta);
  const day = sourceDayOf(input.at);
  const total = { installId: input.installId, source: input.source, day, spender: SOURCE_DAY_TOTAL };
  const own = { ...total, spender: input.spender };
  const cap = input.state.dailyCap;
  if (!(await days.reserve(total, cap, input.at))) {
    return refusal('DAILY_CAP', `${input.source}: ${String(cap)} of ${String(cap)} today.`, { used: cap ?? 0, cap: cap ?? 0 });
  }
  const step = input.spender === STEP_SPENDER;
  const mine = step ? stepCap(input.state) : personCap(input.state);
  if (!(await days.reserve(own, mine, input.at))) {
    await days.settle(total, 0, input.at);
    return refusal(
      'PERSON_SHARE',
      step ? `${input.source}: the automation step's ${String(mine)} calls for today are spent.` : `${input.source}: your ${String(mine)} calls for today are spent; colleagues may still search.`,
      { used: mine ?? 0, cap: mine ?? 0 },
    );
  }
  let settled = false;
  return {
    ok: true,
    hold: {
      async settle(made) {
        if (settled) return;
        settled = true;
        const at = Date.now();
        await days.settle(own, made ? 1 : 0, at);
        await days.settle(total, made ? 1 : 0, at);
      },
    },
  };
}

/** Today's calls of a source, over everybody. */
export async function usedToday(meta: MetaDb, installId: string, source: string, at: number = Date.now()): Promise<number> {
  const day = await sourceDaysRepo(meta).day({ installId, source, day: sourceDayOf(at), spender: SOURCE_DAY_TOTAL });
  return day?.calls ?? 0;
}
