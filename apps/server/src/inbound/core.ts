// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE INBOUND CORE: what happens to an event once its delivery is proved.
 *
 *   accept   seals the body, hashes the sender, stores it once, queues its job
 *   run      the job: one claim, the channel's work, then done, retry, wait or failed
 *   failed   the list staff see, with retry, retry all and dismiss
 *   sweep    re-queues what lost its job, and applies retention
 *   erase    a person's events keep only the mark that stops a re-delivery
 *
 * ─── Stored is what counts ─────────────────────────────────────────────────
 * The answer to the provider depends on the store alone. If the row is written
 * and the job cannot be queued, the event is safe and the sweep queues it. If
 * the row cannot be written, `accept` throws and the door answers 503.
 *
 * ─── What never leaves ─────────────────────────────────────────────────────
 * The body is sealed under a key taken from the address keys, so a changed
 * server secret leaves it readable. Nothing here logs a body or an address, and
 * a handler's error is reduced to a stable reason before anything stores it.
 *
 * ─── Three ways a try can end badly ────────────────────────────────────────
 * An ordinary error uses one of {@link INBOUND_MAX_ATTEMPTS} tries. An outage
 * uses none: the event waits, for up to {@link INBOUND_DEFER_MAX_MS}. A claim
 * that never comes back took the process with it, and the worker runs inside
 * the API, so {@link INBOUND_MAX_LOST_CLAIMS} of those end the event before it can
 * take every app on the server down again. The count lives on the event because
 * the sweep starts a new job, whose own attempts begin at nought.
 */
import { createHmac } from 'node:crypto';

import { jobsRepo, type AddressHash, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import { decryptSecret, encryptSecret, SecretFormatError, SecretIntegrityError } from '../config/secrets.js';
import { AddressKeysLockedError, addressKeyRing, INBOUND_BODY_PURPOSE } from '../consent/keys.js';
import { isConnectionWideError, ValidationFailedError } from '../errors.js';
import type { JobRegistry } from '../jobs/registry.js';
import { createInboundEventStore, type InboundEventStore } from './store.js';
import {
  INBOUND_CRASHED_REASON,
  INBOUND_SOURCE_MAX,
  InboundDeferError,
  InboundFailedError,
  InboundJobError,
  InboundRetryError,
  safeReason,
  type InboundAccept,
  type InboundChannel,
  type InboundEventHead,
  type InboundEventRecord,
  type InboundReason,
  type InboundState,
  type InboundSummary,
} from './types.js';

export const INBOUND_PARSE_JOB = 'inbound.parse';
export const INBOUND_SWEEP_JOB = 'inbound.sweep';
export const INBOUND_MAX_ATTEMPTS = 5;
/** Claims that may die with the process before the event goes to the failed list. */
export const INBOUND_MAX_LOST_CLAIMS = 3;
/** Below every ordinary job, so a burst of events never runs ahead of a password reset or a payment mail. */
export const INBOUND_PARSE_PRIORITY = -1;

const DAY_MS = 24 * 60 * 60 * 1000;
/** A job quiet this long has lost its worker. */
export const INBOUND_STALE_MS = 10 * 60 * 1000;
/** A pending event with no job after this long is queued again. */
export const INBOUND_REQUEUE_AFTER_MS = 2 * 60 * 1000;
/** A finished row stays this long, unless the channel asks for longer, so a late re-delivery is still a duplicate. */
export const INBOUND_DEFAULT_RETAIN_MS = 35 * DAY_MS;
/** How long an outage may hold an event before its tries start to count, so nothing waits for ever. */
export const INBOUND_DEFER_MAX_MS = 7 * DAY_MS;
/** A failed event's body is kept this long for a retry, unless its channel says otherwise. */
export const INBOUND_FAILED_BODY_MS = 90 * DAY_MS;
/** A failed row, after its body has gone, so staff can still see that something was lost. */
export const INBOUND_FAILED_ROW_MS = 400 * DAY_MS;
/** Rows handled in one sweep step. */
export const INBOUND_SWEEP_BATCH = 500;
/** A sender's failed events read for a hold, at most. Past that many, it holds: so many failures are for staff to look at. */
const WAITING_FAILED_READ = 20;

const BODY_PURPOSE = INBOUND_BODY_PURPOSE;
/** The purpose of the key provider ids are digested under. */
export const INBOUND_ID_PURPOSE = 'adminium:inbound-provider-id';
const PROVIDER_ID_MAX = 1024;

/**
 * The provider's id as stored: a keyed digest. Hex, because MySQL's default
 * collation would treat two ids that differ only in case as one, and a real
 * event would then be dropped as a duplicate. Keyed, because this mark outlives
 * an erasure and some ids are built from a phone number: a plain digest of one
 * could be walked back to the number by trying every number there is.
 */
export function providerIdKey(raw: string, keyHex: string): string {
  return createHmac('sha256', Buffer.from(keyHex, 'hex')).update(raw, 'utf8').digest('hex');
}

export interface InboundCoreDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET`, which opens the address keys. */
  secret: string;
  channels: readonly InboundChannel[];
  /** Where it is kept; the real table when left out. */
  store?: InboundEventStore | undefined;
  /** Queues the parse job; the jobs table when left out. */
  enqueue?: ((eventId: string) => Promise<unknown>) | undefined;
  now?: (() => number) | undefined;
}

export interface InboundFailedView {
  id: string;
  channel: string;
  source: string;
  kind: string;
  reason: InboundReason | null;
  attempts: number;
  receivedAt: number;
  occurredAt: number | null;
  finishedAt: number | null;
  /** False once its body has gone, so a retry cannot work. */
  retryable: boolean;
  /** Who it is from, masked, as its channel reads the body; null when it cannot say. */
  masked: string | null;
  /** It may be a request to stop, so what is sent to its sender waits until it is retried or closed. */
  holds: boolean;
  /** When its body goes, and with it the hold: the retry is then lost. Null when it holds nothing. */
  holdsUntil: number | null;
}

export interface InboundSweepResult {
  requeued: number;
  bodiesWiped: number;
  deleted: number;
}

export interface InboundCore {
  /** Stores each event once. Throws when one cannot be stored safely. */
  accept: InboundAccept;
  /** One run of the parse job. Throws only to ask the worker for another try, including while another claim is still live. */
  run(eventId: string): Promise<{ state: InboundState | 'skipped' }>;
  failed: {
    list(opts: { channel?: string | undefined; limit: number; cursor?: string | null | undefined }): Promise<{ events: InboundFailedView[]; next: string | null }>;
    /** One failed event, or null when it is not failed (any more). */
    get(id: string): Promise<InboundFailedView | null>;
    /** How many are failed, and how many of them hold what is sent to their sender. Reads at most `limit` bodies. */
    count(opts: { channel?: string | undefined; limit: number }): Promise<{ failed: number; holding: number; more: boolean }>;
    retry(id: string): Promise<boolean>;
    /** Retries up to `limit` of them, leaving any that crashed the server: those are retried one at a time, on purpose. */
    retryAll(opts: { channel?: string | undefined; limit: number }): Promise<{ retried: number; more: boolean }>;
    dismiss(id: string): Promise<boolean>;
  };
  /** Re-queues, applies retention, then lets each channel catch up. A channel's failure never fails the sweep. */
  sweep(): Promise<InboundSweepResult>;
  /** Whether an event of these kinds from this subject is stored and not yet acted on, a failed one included. */
  waitingFrom(subject: string, kinds: readonly string[]): Promise<boolean>;
  /** `subject` as the channel wrote it (`tel:+49…`, `mailto:a@b`). */
  erase(input: { subject: string }): Promise<{ events: number }>;
  /** How many events {@link InboundCore.erase} would empty for this subject. Writes nothing. */
  countFrom(subject: string): Promise<number>;
}

function cursorOf(event: { receivedAt: number; id: string }): string {
  return Buffer.from(JSON.stringify([event.receivedAt, event.id])).toString('base64url');
}

function readCursor(cursor: string | null | undefined): { receivedAt: number; id: string } | undefined {
  if (cursor === null || cursor === undefined || cursor === '') return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(parsed) && typeof parsed[0] === 'number' && typeof parsed[1] === 'string') return { receivedAt: parsed[0], id: parsed[1] };
  } catch {
    // Not one of ours: refused below.
  }
  throw new ValidationFailedError('That page cursor is not one this list gave.', { field: 'cursor' });
}


export function createInboundCore(deps: InboundCoreDeps): InboundCore {
  const now = deps.now ?? Date.now;
  const store = deps.store ?? createInboundEventStore(deps.meta);
  const ring = addressKeyRing(deps.meta, deps.secret);
  // Read each time, because the wiring adds channels after the core is built.
  const channelNamed = (name: string): InboundChannel | undefined => deps.channels.find((channel) => channel.channel === name);

  const enqueue =
    deps.enqueue ??
    ((eventId: string) => jobsRepo(deps.meta).enqueue({ kind: INBOUND_PARSE_JOB, payload: { eventId }, dedupeKey: `inbound:${eventId}`, maxAttempts: INBOUND_MAX_ATTEMPTS, priority: INBOUND_PARSE_PRIORITY }, now()));

  async function seal(body: string): Promise<string> {
    return encryptSecret(body, Buffer.from(await ring.derivedForWrite(BODY_PURPOSE), 'hex'));
  }

  async function open(sealed: string): Promise<string> {
    for (const key of await ring.derivedAll(BODY_PURPOSE)) {
      try {
        return decryptSecret(sealed, Buffer.from(key, 'hex'));
      } catch (error) {
        if (!(error instanceof SecretIntegrityError || error instanceof SecretFormatError)) throw error;
      }
    }
    throw new InboundFailedError('body-unreadable');
  }

  /** What the channel reads from a failed body. A body that cannot be opened, or a channel that cannot say, holds. */
  async function summaryOf(channelName: string, kind: string, sealed: string | null, hasBody = sealed !== null): Promise<InboundSummary> {
    if (!hasBody) return { masked: null, holds: false };
    const channel = channelNamed(channelName);
    if (channel?.summarize === undefined || sealed === null) return { masked: null, holds: true };
    try {
      return channel.summarize({ kind, body: await open(sealed) });
    } catch {
      return { masked: null, holds: true };
    }
  }

  /** The failed events whose body a summary needs: only a channel that reads one ever has it fetched. */
  const readable = (events: readonly InboundEventHead[]): string[] => events.filter((one) => one.hasBody && channelNamed(one.channel)?.summarize !== undefined).map((one) => one.id);

  function bodyKeptFor(channelName: string): number {
    return channelNamed(channelName)?.failedBodyMs ?? INBOUND_FAILED_BODY_MS;
  }

  async function viewOf(event: InboundEventHead, sealed: string | null): Promise<InboundFailedView> {
    const summary = await summaryOf(event.channel, event.kind, sealed, event.hasBody);
    return {
      id: event.id,
      channel: event.channel,
      source: event.source,
      kind: event.kind,
      reason: event.reason,
      attempts: event.attempts,
      receivedAt: event.receivedAt,
      occurredAt: event.occurredAt,
      finishedAt: event.finishedAt,
      retryable: event.hasBody,
      masked: summary.masked,
      holds: summary.holds,
      holdsUntil: summary.holds ? event.receivedAt + bodyKeptFor(event.channel) : null,
    };
  }

  /** The job is a convenience: the row is what is safe, and the sweep queues whatever this misses. */
  async function queue(eventId: string): Promise<void> {
    try {
      await enqueue(eventId);
    } catch {
      // Stored and pending: `sweep` finds it.
    }
  }

  async function endFailed(event: InboundEventRecord, claimedAt: number, reason: InboundReason): Promise<{ state: InboundState | 'skipped' }> {
    const at = now();
    const kept = await store.finish(event.id, claimedAt, { state: 'failed', reason, at, retainUntil: at + INBOUND_FAILED_ROW_MS });
    return { state: kept ? 'failed' : 'skipped' };
  }

  const accept: InboundAccept = async (input) => {
    if (channelNamed(input.channel) === undefined) throw new Error('No such inbound channel.');
    // SQLite would keep what Postgres and MySQL refuse.
    if (input.source.length > INBOUND_SOURCE_MAX) throw new Error('An inbound source name is too long.');
    let stored = 0;
    let duplicates = 0;
    if (input.events.length === 0) return { stored, duplicates };
    // The newest key first made if there is none, then every version, so a re-delivery after a new key is still a repeat.
    const writeKey = await ring.derivedForWrite(INBOUND_ID_PURPOSE);
    const allKeys = await ring.derivedAll(INBOUND_ID_PURPOSE);
    for (const candidate of input.events) {
      if (candidate.providerId.length === 0 || candidate.providerId.length > PROVIDER_ID_MAX) throw new Error('An inbound event has no usable provider id.');
      const known = await store.byProviderIds(input.channel, input.account, allKeys.map((key) => providerIdKey(candidate.providerId, key)));
      const { event, fresh } =
        known !== null
          ? { event: known, fresh: false }
          : await store.put({
              channel: input.channel,
              account: input.account,
              providerId: providerIdKey(candidate.providerId, writeKey),
              source: input.source,
              kind: candidate.kind,
              subject: candidate.subject === null ? null : await ring.hashForWrite(candidate.subject),
              sealedBody: await seal(candidate.body),
              occurredAt: candidate.occurredAt,
              receivedAt: now(),
            });
      if (fresh) stored += 1;
      else duplicates += 1;
      // A repeat of one still waiting may be the only nudge it gets.
      if (fresh || event.state === 'pending') await queue(event.id);
    }
    return { stored, duplicates };
  };

  return {
    accept,

    async run(eventId) {
      const claimedAtTry = now();
      const event = await store.claim(eventId, claimedAtTry, claimedAtTry - INBOUND_STALE_MS);
      if (event === null || event.claimedAt === null) {
        // The worker's lock goes stale before this claim does. Ending here would finish the job with the event
        // unhandled, so a claim that may be a dead worker's is waited out.
        // The claim is not this run's, so waiting it out uses none of the event's tries.
        if ((await store.stateOf(eventId)) === 'working') throw new InboundJobError('claim-live');
        return { state: 'skipped' };
      }
      const claimedAt = event.claimedAt;
      if (event.lostClaims >= INBOUND_MAX_LOST_CLAIMS) return endFailed(event, claimedAt, INBOUND_CRASHED_REASON);

      const channel = channelNamed(event.channel);
      if (channel === undefined) return endFailed(event, claimedAt, 'unknown-channel');
      if (event.sealedBody === null) return endFailed(event, claimedAt, 'body-gone');

      try {
        const handled = await channel.handle({
          id: event.id,
          channel: event.channel,
          account: event.account,
          source: event.source,
          kind: event.kind,
          body: await open(event.sealedBody),
          occurredAt: event.occurredAt,
          receivedAt: event.receivedAt,
        });
        const at = now();
        const done = await store.finish(event.id, claimedAt, {
          state: handled.outcome,
          reason: handled.reason === undefined ? null : safeReason(handled.reason),
          at,
          retainUntil: at + (handled.retainMs ?? INBOUND_DEFAULT_RETAIN_MS),
        });
        return { state: done ? handled.outcome : 'skipped' };
      } catch (error) {
        if (error instanceof InboundFailedError) return endFailed(event, claimedAt, error.reason);
        const outage = error instanceof InboundDeferError || isConnectionWideError(error);
        const reason =
          error instanceof InboundRetryError || error instanceof InboundDeferError
            ? error.reason
            : error instanceof AddressKeysLockedError
              ? 'keys-locked'
              : outage
                ? 'store-unreachable'
                : 'handler-error';
        if (outage && now() - event.receivedAt < INBOUND_DEFER_MAX_MS) {
          // The job ends cleanly; the sweep brings this back once there is something to come back to.
          await store.defer(event.id, claimedAt, reason);
          return { state: 'pending' };
        }
        if (event.attempts >= INBOUND_MAX_ATTEMPTS) {
          if (error instanceof InboundRetryError && error.finally === 'ignored') {
            const at = now();
            const done = await store.finish(event.id, claimedAt, { state: 'ignored', reason, at, retainUntil: at + INBOUND_DEFAULT_RETAIN_MS });
            return { state: done ? 'ignored' : 'skipped' };
          }
          return endFailed(event, claimedAt, reason);
        }
        await store.release(event.id, claimedAt, reason);
        throw new InboundJobError(reason);
      }
    },

    failed: {
      async list(opts) {
        const limit = Math.min(Math.max(opts.limit, 1), 200);
        const rows = await store.failedPage({ channel: opts.channel, limit: limit + 1, after: readCursor(opts.cursor) });
        const shown = rows.slice(0, limit);
        const bodies = await store.failedBodies(readable(shown));
        const events: InboundFailedView[] = [];
        for (const one of shown) events.push(await viewOf(one, bodies.get(one.id) ?? null));
        return { events, next: rows.length > limit ? cursorOf(shown.at(-1)!) : null };
      },

      async get(id) {
        const event = await store.byId(id);
        if (event === null || event.state !== 'failed') return null;
        const { sealedBody, ...head } = event;
        return viewOf({ ...head, hasBody: sealedBody !== null }, sealedBody);
      },

      async count(opts) {
        const rows = await store.failedPage({ channel: opts.channel, limit: opts.limit + 1 });
        const shown = rows.slice(0, opts.limit);
        const bodies = await store.failedBodies(readable(shown));
        let holding = 0;
        for (const one of shown) if ((await summaryOf(one.channel, one.kind, bodies.get(one.id) ?? null, one.hasBody)).holds) holding += 1;
        return { failed: shown.length, holding, more: rows.length > opts.limit };
      },

      async retry(id) {
        if (!(await store.retry(id))) return false;
        await queue(id);
        return true;
      },

      async retryAll(opts) {
        const limit = Math.min(Math.max(opts.limit, 1), INBOUND_SWEEP_BATCH);
        const ids = await store.retryableIds({ channel: opts.channel, limit: limit + 1 });
        let retried = 0;
        for (const id of ids.slice(0, limit)) {
          if (!(await store.retry(id))) continue;
          retried += 1;
          await queue(id);
        }
        return { retried, more: ids.length > limit };
      },

      async dismiss(id) {
        const at = now();
        return store.dismiss(id, at, at + INBOUND_DEFAULT_RETAIN_MS);
      },
    },

    async sweep() {
      const at = now();
      const stuck = await store.stuck(at - INBOUND_REQUEUE_AFTER_MS, INBOUND_SWEEP_BATCH);
      for (const id of stuck) await queue(id);
      const ownLimit = deps.channels.flatMap((channel) => (channel.failedBodyMs === undefined ? [] : [{ name: channel.channel, ms: channel.failedBodyMs }]));
      let bodiesWiped = await store.wipeFailedBodies(at - INBOUND_FAILED_BODY_MS, INBOUND_SWEEP_BATCH, { except: ownLimit.map((one) => one.name) });
      for (const one of ownLimit) bodiesWiped += await store.wipeFailedBodies(at - one.ms, INBOUND_SWEEP_BATCH, { only: one.name });
      const deleted = await store.deleteExpired(at, INBOUND_SWEEP_BATCH);
      for (const channel of deps.channels) {
        try {
          await channel.catchUp?.(accept);
        } catch {
          // The next sweep asks again.
        }
      }
      return { requeued: stuck.length, bodiesWiped, deleted };
    },

    async waitingFrom(subject, kinds) {
      const hashes = await ring.hashesOf(subject);
      if (await store.anyWaiting(hashes, kinds)) return true;
      // A failed one holds only when it may be the request to stop that nobody could act on: an ordinary message
      // that failed must not keep every text from its sender for as long as its body is kept.
      const failed = await store.failedFrom(hashes, kinds, WAITING_FAILED_READ);
      if (failed.length >= WAITING_FAILED_READ) return true;
      for (const one of failed) if ((await summaryOf(one.channel, one.kind, one.sealedBody)).holds) return true;
      return false;
    },

    async erase(input) {
      const at = now();
      const hashes: AddressHash[] = await ring.hashesOf(input.subject);
      return { events: await store.eraseSubject(hashes, at, at + INBOUND_DEFAULT_RETAIN_MS) };
    },

    async countFrom(subject) {
      return store.countSubject(await ring.hashesOf(subject));
    },
  };
}

const parsePayload = z.object({ eventId: z.string().min(1).max(64) });

/** The two job kinds. Internal, because a payload names a stored event. */
export function registerInboundJobs(registry: JobRegistry, core: InboundCore): void {
  registry.registerJobHandler(
    INBOUND_PARSE_JOB,
    parsePayload,
    async (payload) => {
      try {
        return await core.run(payload.eventId);
      } catch (error) {
        // The worker stores this message: only a stable reason may reach it.
        throw error instanceof InboundJobError ? error : new InboundJobError('store-error');
      }
    },
    { internal: true },
  );
  registry.registerJobHandler(INBOUND_SWEEP_JOB, z.object({}).passthrough(), async () => core.sweep(), { internal: true });
}
