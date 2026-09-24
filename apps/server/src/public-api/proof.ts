// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The human check: a small proof of work a page solves before a write that
 * anyone could otherwise script (a first visit's booking, a registration) or
 * before a claim (a guess at a person's details).
 *
 * ── HOW ────────────────────────────────────────────────────────────────────
 * `GET /public/challenge?purpose=write|claim` hands out a salt, signed with a
 * key derived from the server's secret together with the key it was asked
 * through, the purpose, the difficulty and a two-minute expiry — nothing is
 * stored. The page finds a nonce such that `sha256(salt + nonce)` starts with
 * `difficulty` zero bits and sends `x-adminium-proof: <id>.<nonce>`. The
 * server checks the shape, the signature, the key, the purpose, the expiry
 * and the work — all without a database read, so a flood of bad proofs costs
 * an HMAC each — and then spends the proof: a row in `adminium_public_proofs`
 * keyed by the signed SALT, so a proof works once on every instance, whatever
 * spelling of it is sent.
 *
 * ── WHAT IT IS NOT ─────────────────────────────────────────────────────────
 * At sixteen bits a proof costs a laptop core a few milliseconds and a cheap
 * phone about a second: it prices out the careless script, not a determined
 * one. The limits, `maxOpen` and the per-person caps are what bound abuse; the
 * proof makes each request cost something to make.
 */
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

export const PROOF_PURPOSES = ['write', 'claim'] as const;
export type ProofPurpose = (typeof PROOF_PURPOSES)[number];

/** Leading zero bits a proof needs: about a second on a low-end phone. */
export const PROOF_DIFFICULTY = 16;
/** How long a challenge may be solved and used; a page asks for one when the form is sent. */
export const PROOF_TTL_MS = 2 * 60_000;

/** The one spelling a proof header may take: `<payload>~<signature>.<nonce>`. */
const HEADER = /^([A-Za-z0-9_-]{16,400})~([A-Za-z0-9_-]{43})\.([0-9a-z]{1,32})$/;

interface Payload {
  v: 1;
  /** The key it was asked through. */
  k: string;
  p: ProofPurpose;
  /** Sixteen random bytes, base64url. */
  s: string;
  /** Expiry, epoch ms. */
  e: number;
  d: number;
}

export interface ProofChallenge {
  id: string;
  salt: string;
  difficulty: number;
  expiresAt: number;
}

/** The key proofs are signed under: its own derivation from the secret. */
export function proofKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'adminium-public-proof-v1', 'proof', 32));
}

function sign(key: Buffer, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/** A new challenge for a key and a purpose. */
export function issueChallenge(key: Buffer, keyId: string, purpose: ProofPurpose, now: number): ProofChallenge {
  const payload: Payload = { v: 1, k: keyId, p: purpose, s: randomBytes(16).toString('base64url'), e: now + PROOF_TTL_MS, d: PROOF_DIFFICULTY };
  const text = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { id: `${text}~${sign(key, text)}`, salt: payload.s, difficulty: payload.d, expiresAt: payload.e };
}

/** How many zero bits a hash starts with. */
export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

/** The work a nonce does for a salt. */
export function proofWork(salt: string, nonce: string): number {
  return leadingZeroBits(createHash('sha256').update(`${salt}${nonce}`).digest());
}

/**
 * Whether a proof header holds, for this key and purpose, now — without a
 * database read. On success, the id to spend it under (the signed salt, so
 * every spelling of one proof spends the same row) and when it expires.
 */
export function checkProof(
  key: Buffer,
  header: unknown,
  expect: { keyId: string; purpose: ProofPurpose; now: number },
): { ok: true; spendId: string; expiresAt: number } | { ok: false } {
  if (typeof header !== 'string') return { ok: false };
  const match = HEADER.exec(header.trim());
  if (match === null) return { ok: false };
  const [, text = '', signature = '', nonce = ''] = match;
  const want = Buffer.from(sign(key, text), 'base64url');
  const got = Buffer.from(signature, 'base64url');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false };
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as Payload;
  } catch {
    return { ok: false };
  }
  if (payload.v !== 1 || payload.k !== expect.keyId || payload.p !== expect.purpose) return { ok: false };
  if (typeof payload.e !== 'number' || payload.e <= expect.now) return { ok: false };
  // A challenge made easier than today's difficulty is not accepted.
  if (typeof payload.d !== 'number' || payload.d < PROOF_DIFFICULTY || typeof payload.s !== 'string') return { ok: false };
  if (proofWork(payload.s, nonce) < payload.d) return { ok: false };
  const spendId = createHash('sha256').update(`${payload.k}|${payload.p}|${payload.s}`).digest('hex');
  return { ok: true, spendId, expiresAt: payload.e };
}

/** The nonce for a salt, found by trying — what the page's worker does, for tests and tools. */
export function solveProof(salt: string, difficulty: number): string {
  for (let n = 0; ; n += 1) {
    const nonce = n.toString(36);
    if (proofWork(salt, nonce) >= difficulty) return nonce;
  }
}
