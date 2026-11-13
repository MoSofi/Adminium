// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one-time connection hand-off with an operator: the instance pulls the connection from it.
 *
 * ```
 *  POST /connect/start            → state + challenge, browser sent to the operator
 *  <origin>/connect/supabase/return?state=…&code=…   (the browser comes back)
 *  POST /connect/return {state, code}
 *     → POST <operator>/redeem {code, verifier}       (server to server)
 *     → a strict answer → a guarded, tested, introspected connection
 * ```
 *
 * What holds it together:
 *
 *  - The STATE is single use and lives ten minutes. It is bound to the
 *    session and the user that started the flow: the browser that comes back
 *    must be the same signed-in person, so a link someone else made cannot
 *    land a connection in your instance (or yours in theirs). Presented once,
 *    it is spent, whoever presents it.
 *  - The VERIFIER is the PKCE secret (RFC 7636, S256): the operator sees only
 *    its hash at the start, and the code is worth nothing without the
 *    verifier at the redeem. It is not kept here at all: it is derived from
 *    the instance secret and the state id when it is needed, and only its
 *    hash is stored, so this store holds nothing that redeems a code.
 *  - A PENDING answer (an existing project, whose password the operator never
 *    sees) waits here for the password the person types into this instance,
 *    under the same binding and the same ten minutes. It holds no secret.
 *
 * In memory, on purpose: a hand-off lives for minutes, and a restart in the
 * middle shows "Supabase connection expired." with a button that starts again.
 * Nothing about it is worth a table, and nothing in it is worth stealing.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { ConnectProviderId } from './providers.js';
import type { RedeemedConnection } from './redeem.js';

/** How long a started hand-off, or an answer waiting for its password, stays usable. */
export const HANDOFF_TTL_MS = 10 * 60_000;

/** The most hand-offs held at once; past it the oldest go first. A person needs one or two. */
export const HANDOFF_MAX_HELD = 500;

/** Who started it: the session and the user, compared at the return. */
export interface HandoffOwner {
  sessionId: string;
  userId: string;
}

const sha256 = (text: string): Buffer => createHash('sha256').update(text).digest();
const base64url = (bytes: Buffer): string => bytes.toString('base64url');

/** The PKCE challenge for a verifier: base64url(SHA-256(verifier)), no padding. */
export function s256(verifier: string): string {
  return base64url(sha256(verifier));
}

function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

interface HeldState {
  provider: ConnectProviderId;
  owner: { session: Buffer; user: string };
  verifierHash: Buffer;
  expiresAt: number;
}

interface HeldPending {
  provider: ConnectProviderId;
  owner: { session: Buffer; user: string };
  answer: RedeemedConnection;
  expiresAt: number;
}

/** Why a presented state or pending answer is not taken. The person sees one message for all of them. */
export type HandoffRefusal = 'unknown' | 'expired' | 'not-yours';

export type TakeResult<T> = { ok: true; value: T } | { ok: false; reason: HandoffRefusal };

export interface HandoffStoreOptions {
  /** `ADMINIUM_SECRET`: the verifier is derived from it, never stored. */
  secret: string;
  now?: () => number;
}

export interface HandoffStore {
  /** A new hand-off for `owner`: the state to send and the challenge to send with it. */
  start(provider: ConnectProviderId, owner: HandoffOwner): { state: string; challenge: string };
  /**
   * Spend a state. Spent on any presentation, the owner's or not, expired or
   * not: a state seen twice is never good the second time. Gives the verifier
   * to redeem with.
   */
  take(provider: ConnectProviderId, state: string, owner: HandoffOwner): TakeResult<{ verifier: string }>;
  /** Hold an answer that needs its password; the id to finish it with. */
  hold(provider: ConnectProviderId, owner: HandoffOwner, answer: RedeemedConnection): string;
  /** The held answer, still held (a wrong password may be typed again). */
  pending(id: string, owner: HandoffOwner): TakeResult<{ provider: ConnectProviderId; answer: RedeemedConnection }>;
  /** Drop a held answer: finished, or given up on. */
  drop(id: string): void;
  /** How many are held now (tests). */
  size(): number;
}

export function createHandoffStore(opts: HandoffStoreOptions): HandoffStore {
  const now = opts.now ?? ((): number => Date.now());
  const key = sha256(`adminium-connect-verifier\0${opts.secret}`);
  const states = new Map<string, HeldState>();
  const pendings = new Map<string, HeldPending>();

  const verifierFor = (state: string): string => base64url(createHmac('sha256', key).update(state).digest());
  const ownerOf = (owner: HandoffOwner): { session: Buffer; user: string } => ({ session: sha256(owner.sessionId), user: owner.userId });
  const owns = (held: { session: Buffer; user: string }, owner: HandoffOwner): boolean =>
    sameBytes(held.session, sha256(owner.sessionId)) && held.user === owner.userId;

  function prune(map: Map<string, { expiresAt: number }>): void {
    const at = now();
    for (const [id, entry] of map) if (entry.expiresAt <= at) map.delete(id);
    // Insertion order is age order: past the cap, the oldest go.
    while (map.size >= HANDOFF_MAX_HELD) {
      const oldest = map.keys().next();
      if (oldest.done === true) break;
      map.delete(oldest.value);
    }
  }

  return {
    start(provider, owner) {
      prune(states);
      const state = base64url(randomBytes(32));
      const verifier = verifierFor(state);
      states.set(base64url(sha256(state)), { provider, owner: ownerOf(owner), verifierHash: sha256(verifier), expiresAt: now() + HANDOFF_TTL_MS });
      return { state, challenge: s256(verifier) };
    },

    take(provider, state, owner) {
      const id = base64url(sha256(state));
      const held = states.get(id);
      if (held === undefined) return { ok: false, reason: 'unknown' };
      states.delete(id);
      if (held.provider !== provider) return { ok: false, reason: 'unknown' };
      if (held.expiresAt <= now()) return { ok: false, reason: 'expired' };
      if (!owns(held.owner, owner)) return { ok: false, reason: 'not-yours' };
      const verifier = verifierFor(state);
      // The derivation is checked against what was stored at the start: a changed secret is an expired hand-off.
      if (!sameBytes(sha256(verifier), held.verifierHash)) return { ok: false, reason: 'expired' };
      return { ok: true, value: { verifier } };
    },

    hold(provider, owner, answer) {
      prune(pendings);
      const id = base64url(randomBytes(24));
      pendings.set(id, { provider, owner: ownerOf(owner), answer, expiresAt: now() + HANDOFF_TTL_MS });
      return id;
    },

    pending(id, owner) {
      const held = pendings.get(id);
      if (held === undefined) return { ok: false, reason: 'unknown' };
      if (held.expiresAt <= now()) {
        pendings.delete(id);
        return { ok: false, reason: 'expired' };
      }
      if (!owns(held.owner, owner)) return { ok: false, reason: 'not-yours' };
      return { ok: true, value: { provider: held.provider, answer: held.answer } };
    },

    drop(id) {
      pendings.delete(id);
    },

    size() {
      return states.size + pendings.size;
    },
  };
}
