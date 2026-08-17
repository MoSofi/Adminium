// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Password hashing (08-server-api.md §2.1, §7 item 7): argon2id with the
 * OWASP first-choice parameters — 19 MiB memory, 2 iterations, parallelism 1.
 * Only this module talks to the argon2 binding; callers never see raw hashes
 * beyond passing them to/from `@adminium/meta`.
 */
import argon2 from 'argon2';

/** OWASP argon2id first-choice configuration (m=19456 KiB, t=2, p=1). */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // KiB = 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hashes a plaintext password to a PHC-format argon2id string. */
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

/**
 * Constant-shape verify: malformed/foreign hashes return `false` instead of
 * throwing so login failure handling stays uniform (no user enumeration).
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** True when `hash` was minted with weaker/different parameters than ours. */
export function needsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  } catch {
    return true;
  }
}
