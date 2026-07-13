/**
 * DSN encryption closures (01-architecture.md §3/§7.1): AES-256-GCM with an
 * HKDF key derived from `ADMINIUM_SECRET`, purpose-scoped so DSN, TOTP, and
 * session keys never coincide. `@adminium/meta` receives only these
 * closures — the meta store stays crypto-agnostic.
 */

import type { DsnCrypto } from '@adminium/meta';

import { decryptSecret, deriveKey, encryptSecret } from '../config/secrets.js';

const DSN_KEY_SALT = 'adminium:dsn:v1';

export function dsnCryptoFromSecret(masterSecret: string): DsnCrypto {
  const key = deriveKey(masterSecret, DSN_KEY_SALT);
  return {
    encrypt: (plaintext) => encryptSecret(plaintext, key),
    decrypt: (token) => decryptSecret(token, key),
  };
}
