import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Secret handling (01-architecture.md §7.1): `ADMINIUM_SECRET` is the master
 * secret; HKDF-SHA256 derives purpose-scoped keys (DSN, meta-URL, LLM-key and
 * TOTP-secret encryption at rest). @fastify/cookie signs the session cookie
 * with the master secret directly. Values at rest are AES-256-GCM tokens of
 * the form `enc:v1:<base64(iv|tag|ciphertext)>`.
 *
 * There is no CSRF key: no CSRF token is issued or checked anywhere. The
 * cross-site defence is the session cookie's `SameSite=Lax` plus CORS being
 * off by default (see `auth/sessions.ts` and `plugins/core.ts`).
 */
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export const ENC_TOKEN_PREFIX = 'enc:v1:';

export class SecretFormatError extends Error {
  override readonly name = 'SecretFormatError';
}

export class SecretIntegrityError extends Error {
  override readonly name = 'SecretIntegrityError';
}

/**
 * Derives a 32-byte key from the master secret via HKDF-SHA256. `info`
 * scopes the key to a purpose so two purposes never coincide on one key
 * even for the same secret + salt.
 */
export function deriveKey(secret: string, salt: string | Uint8Array, info = 'adminium:enc'): Buffer {
  if (secret.length === 0) {
    throw new SecretFormatError('cannot derive a key from an empty secret');
  }
  return Buffer.from(hkdfSync('sha256', secret, salt, info, KEY_BYTES));
}

/** Encrypts a UTF-8 string to an `enc:v1:` token with a fresh random IV. */
export function encryptSecret(plaintext: string, key: Uint8Array): string {
  assertKeyLength(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_TOKEN_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/**
 * Decrypts an `enc:v1:` token. Throws `SecretFormatError` on malformed
 * tokens and `SecretIntegrityError` when the GCM tag does not verify
 * (tampered payload or wrong key).
 */
export function decryptSecret(token: string, key: Uint8Array): string {
  assertKeyLength(key);
  if (!token.startsWith(ENC_TOKEN_PREFIX)) {
    throw new SecretFormatError(`expected an "${ENC_TOKEN_PREFIX}" token`);
  }
  const raw = Buffer.from(token.slice(ENC_TOKEN_PREFIX.length), 'base64');
  // empty plaintext is legal: GCM yields zero ciphertext bytes, the tag still authenticates it
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new SecretFormatError('encrypted token payload is too short');
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretIntegrityError('decryption failed — token was tampered with or the key is wrong');
  }
}

/** True when `value` looks like an `enc:v1:` token (format check only). */
export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(ENC_TOKEN_PREFIX);
}

function assertKeyLength(key: Uint8Array): void {
  if (key.byteLength !== KEY_BYTES) {
    throw new SecretFormatError(`key must be exactly ${String(KEY_BYTES)} bytes (use deriveKey)`);
  }
}
