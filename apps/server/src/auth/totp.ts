// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TOTP two-factor auth (08-server-api.md §2.1): RFC 6238 via `otpauth`,
 * 6 digits / 30 s / SHA-1 / ±1 step verify window. Secrets are encrypted at
 * rest (AES-256-GCM, HKDF-derived key from ADMINIUM_SECRET); recovery codes
 * are 10 single-use strings stored as argon2id hashes (07-meta-store.md §3.3).
 */
import { randomBytes } from 'node:crypto';

import * as OTPAuth from 'otpauth';
import argon2 from 'argon2';

import { decryptSecret, deriveKey, encryptSecret } from '../config/secrets.js';
import { ARGON2_OPTIONS } from './passwords.js';

export const TOTP_ISSUER = 'Adminium';
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_S = 30;
/** ±1 time-step tolerance (§2.1). */
export const TOTP_WINDOW = 1;
export const RECOVERY_CODE_COUNT = 10;

/** HKDF salt scoping the TOTP-secret encryption key. */
const TOTP_KEY_SALT = 'adminium:totp-secret';

function buildTotp(secretBase32: string, label = 'account'): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_S,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export interface TotpEnrollment {
  /** Base32 secret for manual entry. */
  secret: string;
  /** `otpauth://totp/...` URI — QR-able as-is. */
  otpauthUrl: string;
}

/** Generates a fresh 20-byte secret plus its otpauth:// provisioning URI. */
export function generateTotpEnrollment(accountLabel: string): TotpEnrollment {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  return { secret, otpauthUrl: buildTotp(secret, accountLabel).toString() };
}

/** Verifies a 6-digit code against the secret with a ±1 step window. */
export function verifyTotpCode(secretBase32: string, code: string, at: number = Date.now()): boolean {
  const token = code.replaceAll(/[\s-]/g, '');
  if (!/^\d{6}$/.test(token)) return false;
  try {
    return buildTotp(secretBase32).validate({ token, timestamp: at, window: TOTP_WINDOW }) !== null;
  } catch {
    return false;
  }
}

/** Derives the purpose-scoped key for TOTP-secret encryption at rest. */
export function totpEncryptionKey(masterSecret: string): Buffer {
  return deriveKey(masterSecret, TOTP_KEY_SALT);
}

export function encryptTotpSecret(secretBase32: string, key: Uint8Array): string {
  return encryptSecret(secretBase32, key);
}

export function decryptTotpSecret(token: string, key: Uint8Array): string {
  return decryptSecret(token, key);
}

/** `xxxxx-xxxxx` from an unbiased hex alphabet — easy to read aloud. */
function mintRecoveryCode(): string {
  const hex = randomBytes(5).toString('hex'); // 10 chars
  return `${hex.slice(0, 5)}-${hex.slice(5)}`;
}

/** The 10 plaintext codes — shown to the user exactly once. */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, mintRecoveryCode);
}

/** argon2id hashes for storage in `adminium_users.recovery_codes`. */
export async function hashRecoveryCodes(codes: readonly string[]): Promise<string[]> {
  return Promise.all(codes.map(async (code) => argon2.hash(normalizeRecoveryCode(code), ARGON2_OPTIONS)));
}

function normalizeRecoveryCode(code: string): string {
  return code.replaceAll(/[\s-]/g, '').toLowerCase();
}

/**
 * Single-use consume: returns the remaining hashes when `code` matches one of
 * them (the matched hash is removed), or `null` when nothing matches.
 */
export async function consumeRecoveryCode(
  hashes: readonly string[],
  code: string,
): Promise<string[] | null> {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length === 0) return null;
  for (let i = 0; i < hashes.length; i += 1) {
    const hash = hashes[i];
    if (hash === undefined) continue;
    let ok = false;
    try {
      ok = await argon2.verify(hash, normalized);
    } catch {
      ok = false;
    }
    if (ok) return [...hashes.slice(0, i), ...hashes.slice(i + 1)];
  }
  return null;
}
