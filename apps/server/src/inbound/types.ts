// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE WORDS OF THE INBOUND CORE: what a channel (texts, mail) gives the door,
 * and what the door and the job give back.
 *
 * The core knows nothing about any one channel. It holds the door's order, one
 * store-once table, a queued job, the failed list, retention and erasure. A
 * channel supplies its proof, what one delivery holds, and what an event means.
 */
import type { AddressHash } from '@adminium/meta';

/**
 * Where an event stands.
 *  - `pending`: stored, waiting for its job.
 *  - `working`: a job holds it.
 *  - `processed`: done. The body is gone.
 *  - `ignored`: nothing to do. The body is gone.
 *  - `failed`: on the staff list. The body stays, so a retry can read it.
 *  - `erased`: its person was erased. Only the mark that stops a re-delivery stays.
 */
export const INBOUND_STATES = ['pending', 'working', 'processed', 'ignored', 'failed', 'erased'] as const;
export type InboundState = (typeof INBOUND_STATES)[number];

/** A stable reason: safe in a log, a job's error and the staff list. It never holds a body or an address. */
export type InboundReason = string;
const REASON = /^[a-z0-9-]{1,32}$/;

/** The reason as given, or a fixed word when it is not one of the plain shape. */
export function safeReason(reason: unknown, fallback = 'handler-error'): InboundReason {
  return typeof reason === 'string' && REASON.test(reason) ? reason : fallback;
}

export interface InboundEventRecord {
  id: string;
  channel: string;
  account: string;
  /** A digest of the provider's id, so every engine compares it the same way. */
  providerId: string;
  /** Which provider or mailbox of the channel it came through. */
  source: string;
  kind: string;
  state: InboundState;
  /** The keyed hash of the sender, for erasure. Never the address. */
  subject: AddressHash | null;
  sealedBody: string | null;
  attempts: number;
  reason: InboundReason | null;
  occurredAt: number | null;
  receivedAt: number;
  claimedAt: number | null;
  finishedAt: number | null;
  retainUntil: number | null;
}

/** One event a proved delivery holds. */
export interface InboundCandidate {
  /** The provider's own id for this event: a re-delivery carries the same one. */
  providerId: string;
  kind: string;
  /** Who it is about, as `tel:+49…` or `mailto:a@b`. Hashed before it is stored. Null when nobody. */
  subject: string | null;
  /** What the channel needs later. Sealed before it is stored. */
  body: string;
  occurredAt: number | null;
}

/** One request at the door, after the token was checked. */
export interface InboundDelivery {
  source: string;
  account: string;
  /** The exact bytes that arrived. */
  body: Buffer;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  /** This door's address, built from the stored public address. Never from the request's headers. */
  publicUrl: string;
  now: number;
}

export type InboundProof =
  | {
      genuine: true;
      /** Empty when the delivery is genuine and holds nothing to keep. */
      events: readonly InboundCandidate[];
      /** The answer this provider expects, when it is not the door's plain JSON. */
      reply?: { contentType: string; body: string } | undefined;
    }
  | { genuine: false; answer: 400 | 401 | 403 | 503; reason: InboundReason };

export type InboundAccount =
  /** The account this source is connected to right now. */
  | { state: 'ready'; account: string }
  /** The channel has no such source: 404. */
  | { state: 'unknown' }
  /** A real source that cannot check a proof now: 503, so the provider keeps the event. */
  | { state: 'unavailable' };

/** A stored event, opened for its channel. */
export interface InboundOpened {
  id: string;
  channel: string;
  account: string;
  source: string;
  kind: string;
  body: string;
  occurredAt: number | null;
  receivedAt: number;
}

export interface InboundHandled {
  outcome: 'processed' | 'ignored';
  /** How long the row (never the body) is kept, so a late re-delivery stays a duplicate. */
  retainMs?: number | undefined;
  reason?: InboundReason | undefined;
}

/** Stores events once, as a door or a catch-up hands them over. */
export type InboundAccept = (input: { channel: string; account: string; source: string; events: readonly InboundCandidate[] }) => Promise<{ stored: number; duplicates: number }>;

/** One way in. Mail adds its own; nothing in the core names a channel. */
export interface InboundChannel {
  readonly channel: string;
  /** The largest delivery this channel takes, in bytes. */
  readonly bodyLimit: number;
  /** Whether the outside can reach this channel's door now. */
  reach(): Promise<{ open: boolean; origin: string | null }>;
  account(source: string): Promise<InboundAccount>;
  /** Proves one delivery. Throws only for this server's own trouble, which is a 503. */
  prove(delivery: InboundDelivery): Promise<InboundProof>;
  /** Does an event's work. Must be safe to run twice. */
  handle(event: InboundOpened): Promise<InboundHandled>;
  /**
   * Asks the source for what this server may have missed, and hands it to
   * `accept`. Run from the sweep, so it must be bounded and safe to repeat.
   */
  catchUp?(accept: InboundAccept): Promise<unknown>;
}

/** This event will never work as it is: straight to the failed list. */
export class InboundFailedError extends Error {
  override readonly name = 'InboundFailedError';
  readonly reason: InboundReason;

  constructor(reason: InboundReason) {
    super(`inbound event failed: ${safeReason(reason)}`);
    this.reason = safeReason(reason);
  }
}

/** Not yet: try again. When the tries run out it ends as `finally`. */
export class InboundRetryError extends Error {
  override readonly name = 'InboundRetryError';
  readonly reason: InboundReason;
  readonly finally: 'failed' | 'ignored';

  constructor(reason: InboundReason, options: { finally: 'failed' | 'ignored' } = { finally: 'failed' }) {
    super(`inbound event will be retried: ${safeReason(reason)}`);
    this.reason = safeReason(reason);
    this.finally = options.finally;
  }
}

/**
 * What the job throws so the worker retries. Its message is the reason alone,
 * because the worker stores it in `adminium_jobs.lastError`, and a handler's own
 * error could quote a number or a message.
 */
export class InboundJobError extends Error {
  override readonly name = 'InboundJobError';

  constructor(reason: InboundReason) {
    super(`inbound event not finished: ${safeReason(reason)}`);
  }
}
