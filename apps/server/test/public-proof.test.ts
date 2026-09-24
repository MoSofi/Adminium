// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The human check's proof, below the route: signed for one key and one
 * purpose, good for two minutes, only with the work done — and spent under
 * the signed salt, so no spelling of one proof spends a second row.
 */
import { describe, expect, it } from 'vitest';

import { PROOF_DIFFICULTY, PROOF_TTL_MS, checkProof, issueChallenge, leadingZeroBits, proofKey, proofWork, solveProof } from '../src/public-api/proof.js';

const key = proofKey('a-test-secret-that-is-long-enough-for-hkdf');
const now = Date.UTC(2026, 6, 28, 9, 0);
const expect0 = { keyId: 'pbk_1', purpose: 'write' as const, now };

function solved(overrides: Partial<typeof expect0> = {}) {
  const challenge = issueChallenge(key, overrides.keyId ?? 'pbk_1', overrides.purpose ?? 'write', now);
  return { challenge, header: `${challenge.id}.${solveProof(challenge.salt, challenge.difficulty)}` };
}

describe('a proof', () => {
  it('holds for its key and purpose, while fresh, with the work done', () => {
    const { challenge, header } = solved();
    expect(challenge.difficulty).toBe(PROOF_DIFFICULTY);
    expect(challenge.expiresAt).toBe(now + PROOF_TTL_MS);
    expect(checkProof(key, header, expect0)).toMatchObject({ ok: true, expiresAt: now + PROOF_TTL_MS });
    expect(checkProof(key, header, { ...expect0, keyId: 'pbk_2' })).toEqual({ ok: false });
    expect(checkProof(key, header, { ...expect0, purpose: 'claim' })).toEqual({ ok: false });
    expect(checkProof(key, header, { ...expect0, now: now + PROOF_TTL_MS })).toEqual({ ok: false });
    expect(checkProof(proofKey('another-secret-entirely-long-enough'), header, expect0)).toEqual({ ok: false });
  });

  it('is refused without the work, or with a payload made easier', () => {
    const { challenge } = solved();
    let lazy = 0;
    while (proofWork(challenge.salt, lazy.toString(36)) >= PROOF_DIFFICULTY) lazy += 1;
    expect(checkProof(key, `${challenge.id}.${lazy.toString(36)}`, expect0)).toEqual({ ok: false });
    // An edited payload (difficulty 1) fails the signature.
    const [payload, signature] = challenge.id.split('~') as [string, string];
    const easier = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), d: 1 })).toString('base64url');
    expect(checkProof(key, `${easier}~${signature}.0`, expect0)).toEqual({ ok: false });
  });

  it('takes one spelling only, and spends under its salt whatever else changes', () => {
    const { header } = solved();
    const first = checkProof(key, header, expect0);
    expect(first.ok).toBe(true);
    // Base64 padding, standard-alphabet characters, stray punctuation: refused by shape.
    for (const variant of [header.replace('~', '=~'), header.replace(/-/g, '+'), `${header}!`, ` ${header.toUpperCase()}`]) {
      if (variant === header) continue;
      expect(checkProof(key, variant, expect0).ok).toBe(false);
    }
    // Another nonce that also does the work is the same proof: the same row to spend.
    const [id] = header.split('.') as [string];
    const salt = JSON.parse(Buffer.from(id.split('~')[0]!, 'base64url').toString()).s as string;
    let other = Number.parseInt(header.split('.')[1]!, 36) + 1;
    while (proofWork(salt, other.toString(36)) < PROOF_DIFFICULTY) other += 1;
    const second = checkProof(key, `${id}.${other.toString(36)}`, expect0);
    expect(second.ok && first.ok && second.spendId === first.spendId).toBe(true);
  });

  it('counts leading zero bits', () => {
    expect(leadingZeroBits(Uint8Array.from([0, 0, 0x0f, 0xff]))).toBe(20);
    expect(leadingZeroBits(Uint8Array.from([0x80]))).toBe(0);
    expect(leadingZeroBits(Uint8Array.from([0, 1]))).toBe(15);
  });
});
