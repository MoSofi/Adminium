// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE VIEW COUNTER: how many times strangers saw a landing page or a form,
 * per day, and (at "Per visitor", after a "yes") which pages one visitor saw.
 *
 * A door calls {@link ViewCounter.count} at the data read of a live thing:
 * the pages door for a landing page (`page`), the forms door for a form on
 * its own page or in a frame (`form-page`), for a form block that came near
 * the screen on a landing page (`form-opened`, with the page's key as its
 * place) and, after an answer's write stood, `form-sent`. `count` returns at
 * once, never throws and never waits on the store: no failure of counting
 * ever reaches a door, and nothing about counting can turn a page off.
 *
 * ─── WHAT IS LEFT OUT ──────────────────────────────────────────────────────
 * - everything while the level (`privacy.tracking`) is `off`;
 * - a view by a known bot, crawler, link preview, monitor, headless browser
 *   or script, or a prefetch (`bots.ts`). A link scanner that fetches only
 *   the HTML never reaches a data read at all;
 * - a repeat view within {@link DEDUPE_MS} from the same network address (an
 *   IPv4 address, an IPv6 /64) of the same thing, kind and place. Held in
 *   memory only, under a hash with a key made at start, so no address is
 *   kept even there; at most {@link DEDUPE_MAX} entries, the oldest let go
 *   first, from the front (a mark seen again moves to the back), so a full
 *   map costs one step a view, never a walk;
 * - a key the table cannot hold (an empty or too-long thing or place).
 *
 * A sent form (`form-sent`) is an event, not a view: every answer kept is
 * counted, whoever sent it (the answer door has already refused traps,
 * failed checks and refusals); only the level stops it.
 *
 * ─── HOW IT IS WRITTEN ─────────────────────────────────────────────────────
 * Counts are added up in memory by install, kind, thing, place and quarter
 * hour (UTC), and {@link ViewCounter.flush} (every minute, and on shutdown)
 * turns each quarter into the business's day (the thing's database's time
 * zone, else UTC; every zone is a whole number of quarters from UTC) and adds
 * each day's sum to its row with the meta store's portable add. A flush
 * never writes a zero and never retries: the counts are swapped out before
 * the writes, a failure is logged once and that minute dropped (a stuck
 * store would otherwise grow the map without bound). The level is read again
 * at each flush, so a server switched to Off writes nothing after it, in
 * every process, and at most {@link LEVEL_FRESH_MS} after a view asks for it
 * ({@link ViewCounter.levelNow}). At most {@link PENDING_MAX} keys wait for
 * one flush.
 *
 * At "Per visitor" a counted view (never a send) of a visitor who said yes
 * (their cookie is present, and not in a frame) also waits as a visit, written in the same
 * flush, many in one insert; a "yes" whose visitor row is not written yet
 * becomes one then (`views/visitor.ts` `admit`, capped per network), and a
 * visit whose visitor is gone by then is dropped by the store.
 *
 * Going down from "Per visitor" deletes every visitor at once
 * (`tracking.ts`); each process, at its next flush after it sees the level
 * go down, deletes them all once more ({@link ViewCounterDeps.dropVisitors}):
 * a process that wrote a visitor in the moment between the change and its
 * own reading of it leaves nothing behind.
 */
import { createHmac, randomBytes } from 'node:crypto';

import type { VisitInput } from '@adminium/meta';

import { ipv6Network, rateAddress } from '../public-api/limiter.js';
import { isPrefetch, isKnownBot } from './bots.js';
import { TRACKING_LEVELS, type TrackingLevel } from './level.js';
import type { Newcomer, VisitorProof } from './visitor.js';

/** What is counted: a landing page, a form on its own page or in a frame, a form block opened on a page, a form sent. */
export const VIEW_KINDS = ['page', 'form-page', 'form-opened', 'form-sent'] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

/** A repeat view of one thing from one address within this time is not counted again: thirty minutes. */
export const DEDUPE_MS = 30 * 60_000;
/** The most addresses the repeat check holds: the oldest are let go past it. */
export const DEDUPE_MAX = 50_000;
/** The most counts that wait for one flush; past it, new keys wait for the next minute. */
export const PENDING_MAX = 20_000;
/** The most visits that wait for one flush. */
export const VISITS_MAX = 20_000;
/** How long the level held in memory is trusted before a view asks the settings again. */
export const LEVEL_FRESH_MS = 5_000;
/** The longest thing and place a count keeps (the table's widths). */
const THING_MAX = 64;
const INSTALL_MAX = 64;

/** A quarter of an hour: every time zone's offset from UTC is a whole number of them. */
const QUARTER_MS = 15 * 60_000;

/** The part of a request the counter reads. */
export interface CountedRequest {
  ip: string;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  /** How it came in, as the server sees it: the visitor's cookie is named for it. */
  protocol?: 'http' | 'https' | undefined;
  /** The host it came on: a visitor's row keeps it. */
  host?: string | undefined;
}

/** One count, as a door asks for it. */
export interface CountInput {
  /** The add-on install that holds the thing (its `adminium_manifests` id); nothing is counted without one. */
  installId: string | undefined;
  kind: ViewKind;
  /** The counted row's key, as text: a live page's, a live form's. */
  thing: string;
  /** The page key a form sat on; none (or `''`) on its own page or in a frame. */
  place?: string | undefined;
  /** The stranger's request. */
  request: CountedRequest;
  /** Drawn in a frame on another website: counted, but never a visitor's (no cookie is read). */
  framed?: boolean | undefined;
}

export interface ViewCounter {
  /** Count one view (see the header). Never throws, never waits. */
  count(input: CountInput): void;
  /** Write what was counted so far. Safe to call concurrently. */
  flush(): Promise<void>;
  /** The level as this process holds it. */
  level(): TrackingLevel;
  /** The level changed here (the Privacy page's save): used at once. */
  setLevel(level: TrackingLevel): void;
  /** Read the level again from the settings. */
  refresh(): Promise<TrackingLevel>;
  /** The level, read again from the settings when what is held is older than {@link LEVEL_FRESH_MS}. */
  levelNow(): Promise<TrackingLevel>;
  /** Counts and visits waiting for the next flush (a test seam). */
  pending(): { counts: number; visits: number };
}

export interface ViewCounterDeps {
  /** Adds one day's views to its row (`viewDaysRepo.add`). */
  add: (count: { installId: string; kind: string; thing: string; place: string; day: string; views: number }) => Promise<void>;
  /**
   * Writes visits, dropping those of visitors no longer there
   * (`visitorsRepo.addVisits`), after the rows of the "yes"es whose first
   * counted view these are (`newcomers`, `views/visitor.ts` `admit`).
   */
  addVisits?: ((visits: readonly VisitInput[], newcomers: readonly Newcomer[]) => Promise<number>) | undefined;
  /** Deletes every visitor and visit: the second pass after the level went down from "Per visitor". */
  dropVisitors?: (() => Promise<unknown>) | undefined;
  /** The business's time zone for an install's things: its database's zone, else UTC. */
  zoneOf: (installId: string) => Promise<string>;
  /** The level, read from the settings. */
  readLevel: () => Promise<TrackingLevel>;
  /** What the request's visitor cookie proves, or null. Read only at "Per visitor", never in a frame. */
  visitorOf?: ((request: CountedRequest) => VisitorProof | null) | undefined;
  now?: () => number;
  onError?: (error: unknown) => void;
}

interface Pending {
  installId: string;
  kind: ViewKind;
  thing: string;
  place: string;
  quarter: number;
  views: number;
}

/** The day a moment falls on in a time zone, `YYYY-MM-DD`; UTC for a zone this runtime does not know. */
export function dayIn(zone: string, at: number): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

const KINDS: ReadonlySet<string> = new Set(VIEW_KINDS);

export function createViewCounter(deps: ViewCounterDeps): ViewCounter {
  const now = deps.now ?? Date.now;
  const report = (error: unknown): void => {
    try {
      deps.onError?.(error);
    } catch {
      // A logger that throws is no reason to count less.
    }
  };
  // The repeat check's hashes are keyed by bytes made at start: no address is kept, even in memory.
  const dedupeKey = randomBytes(32);
  let current: TrackingLevel = 'counts';
  /** When the level was last read from the settings, and the read under way. */
  let readAt = Number.NEGATIVE_INFINITY;
  let reading: Promise<TrackingLevel> | null = null;
  /** Set when this process saw the level go down from "Per visitor": its next flush deletes every visitor once more. */
  let wentDown = false;
  let counts = new Map<string, Pending>();
  let visits: VisitInput[] = [];
  let newcomers = new Map<string, Newcomer>();
  const seen = new Map<string, number>();
  let full = false;

  const label = (text: string): string => createHmac('sha256', dedupeKey).update(text).digest('base64url');

  /**
   * Whether this view was counted from the same address within the window;
   * marks it otherwise. The map is kept in the order marks were set (a mark
   * set again moves to the back), so what has run its time, and past the
   * bound the oldest, is always at the front: let go from there, one step a
   * view.
   */
  function repeated(input: CountInput, at: number): boolean {
    const address = rateAddress(input.request.ip);
    const key = label(JSON.stringify([address, input.kind, input.installId, input.thing, input.place ?? '']));
    const last = seen.get(key);
    if (last !== undefined && at - last < DEDUPE_MS) return true;
    seen.delete(key);
    for (const [one, when] of seen) {
      if (seen.size < DEDUPE_MAX && at - when < DEDUPE_MS) break;
      seen.delete(one);
    }
    seen.set(key, at);
    return false;
  }

  function countOne(input: CountInput): void {
    if (current === 'off') return;
    const { installId, kind, thing } = input;
    const place = input.place ?? '';
    if (installId === undefined || installId === '' || installId.length > INSTALL_MAX) return;
    if (!KINDS.has(kind) || thing === '' || thing.length > THING_MAX || place.length > THING_MAX) return;
    const at = now();
    if (kind !== 'form-sent') {
      if (isKnownBot(input.request.headers['user-agent']) || isPrefetch(input.request.headers)) return;
      if (repeated(input, at)) return;
    }
    const quarter = Math.floor(at / QUARTER_MS) * QUARTER_MS;
    const id = JSON.stringify([installId, kind, thing, place, quarter]);
    const pending = counts.get(id);
    if (pending !== undefined) pending.views += 1;
    else if (counts.size < PENDING_MAX) counts.set(id, { installId, kind, thing, place, quarter, views: 1 });
    else if (!full) {
      full = true;
      report(new Error('The view counter is full until its next write: new counts this minute are dropped.'));
    }
    // A visitor's visit: a view (never a send, which the answer's own join records), only at "Per visitor",
    // only on the install's own pages, only with their cookie.
    if (kind !== 'form-sent' && current === 'visitor' && input.framed !== true && deps.visitorOf !== undefined && visits.length < VISITS_MAX) {
      const proof = deps.visitorOf(input.request);
      if (proof !== null) {
        visits.push({ visitorId: proof.id, installId, kind, thing, at });
        // The first view of a "yes" may make its visitor row at the flush: kept with keyed labels of its networks, never the address.
        if (!newcomers.has(proof.id)) {
          const wide = ipv6Network(input.request.ip, 48);
          newcomers.set(proof.id, { proof, host: input.request.host ?? '', at, networks: { address: label(`a|${rateAddress(input.request.ip)}`), wide: wide === null ? null : label(`w|${wide}`) } });
        }
      }
    }
  }

  /** Takes a level read from the settings; going down from "Per visitor" is remembered for the next flush. */
  function take(level: TrackingLevel): TrackingLevel {
    if (!(TRACKING_LEVELS as readonly string[]).includes(level)) return current;
    if (current === 'visitor' && level !== 'visitor') wentDown = true;
    current = level;
    return current;
  }

  async function refresh(): Promise<TrackingLevel> {
    const level = await deps.readLevel();
    readAt = now();
    return take(level);
  }

  /** Read the level again when what is held is stale; one read at a time. */
  function refreshStale(): Promise<TrackingLevel> {
    if (now() - readAt < LEVEL_FRESH_MS) return Promise.resolve(current);
    if (reading === null) {
      // A read that fails is not tried again by every view: the next one waits its turn.
      readAt = now();
      reading = refresh().finally(() => {
        reading = null;
      });
    }
    return reading;
  }

  return {
    count(input) {
      try {
        // A view asks the settings again when the level held is stale: in the background, never waited on.
        refreshStale().catch(report);
        countOne(input);
      } catch (error) {
        report(error);
      }
    },

    async flush() {
      const batch = counts;
      const visitBatch = visits;
      const newBatch = [...newcomers.values()];
      counts = new Map();
      visits = [];
      newcomers = new Map();
      full = false;
      try {
        // Switched off elsewhere since these were counted: nothing is written.
        const level = await refresh().catch(() => current);
        if (wentDown && level !== 'visitor' && deps.dropVisitors !== undefined) {
          // The second pass: whatever any process wrote between the change and its reading of it.
          wentDown = false;
          await deps.dropVisitors();
        }
        if (level === 'off' || batch.size === 0) return;
        const zones = new Map<string, string>();
        const days = new Map<string, { installId: string; kind: string; thing: string; place: string; day: string; views: number }>();
        for (const one of batch.values()) {
          let zone = zones.get(one.installId);
          if (zone === undefined) {
            zone = await deps.zoneOf(one.installId).catch(() => 'UTC');
            zones.set(one.installId, zone);
          }
          const day = dayIn(zone, one.quarter);
          const id = JSON.stringify([one.installId, one.kind, one.thing, one.place, day]);
          const sum = days.get(id);
          if (sum !== undefined) sum.views += one.views;
          else days.set(id, { installId: one.installId, kind: one.kind, thing: one.thing, place: one.place, day, views: one.views });
        }
        let failed = false;
        for (const day of days.values()) {
          if (day.views < 1) continue;
          try {
            await deps.add(day);
          } catch (error) {
            if (!failed) report(error);
            failed = true;
          }
        }
        if (level === 'visitor' && visitBatch.length > 0 && deps.addVisits !== undefined) await deps.addVisits(visitBatch, newBatch);
      } catch (error) {
        report(error);
      }
    },

    level: () => current,
    setLevel(level) {
      take(level);
      readAt = now();
    },
    refresh,
    levelNow: refreshStale,
    pending: () => ({ counts: counts.size, visits: visits.length }),
  };
}
