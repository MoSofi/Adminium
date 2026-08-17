// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AES-256-GCM secret-at-rest for the encrypted `llm.apiKey` setting
 * (06-llm-assist.md §3.2; 01-architecture.md §7.1). The LLM key is protected with
 * the SAME mechanism connection strings use: an HKDF-SHA256 key derived from
 * `ADMINIUM_SECRET`, purpose-scoped by salt, producing `enc:v1:` GCM tokens
 * (`apps/server/src/config/secrets.ts` + `apps/server/src/connections/crypto.ts`).
 *
 * ⚠️ BLOCKER (see this track's followUps): those primitives currently live ONLY
 * in the server tree. `@adminium/llm` is consumed by the browser dashboard, so it
 * cannot import server code, and a package→app edge is impossible anyway. Until
 * the AES-256-GCM helper is extracted into a shared, browser-safe leaf, this
 * module ships the crypto CONTRACT and the LLM purpose-scoped wiring, taking the
 * primitives by INJECTION. M6 Wave 2 (server) supplies the real `node:crypto`
 * implementation; unit tests inject a fake. No `node:*` import here keeps the
 * package browser-safe.
 */

/** Purpose scope for the LLM API-key encryption key (mirror of `DSN_KEY_SALT`). */
export const LLM_KEY_SALT = 'adminium:llm-key:v1' as const;

/**
 * The AES-256-GCM primitives this module wires together — the exact shape of
 * `apps/server/src/config/secrets.ts`. Injected so the browser-safe `@adminium/llm`
 * never has to import the `node:crypto`-backed implementation directly.
 */
export interface SecretCryptoHelpers {
  /** HKDF-SHA256 → 32-byte key, purpose-scoped by `salt` (+ optional `info`). */
  deriveKey(secret: string, salt: string | Uint8Array, info?: string): Uint8Array;
  /** UTF-8 plaintext → `enc:v1:` GCM token with a fresh random IV. */
  encryptSecret(plaintext: string, key: Uint8Array): string;
  /** `enc:v1:` token → UTF-8 plaintext; throws on tamper / wrong key. */
  decryptSecret(token: string, key: Uint8Array): string;
}

/**
 * Encrypt/decrypt closures scoped to the LLM API-key purpose — the exact shape of
 * `@adminium/meta`'s `DsnCrypto`, so the meta store stays crypto-agnostic and the
 * server can hand the LLM-config repo these closures the same way it does for DSNs.
 */
export interface LlmKeyCrypto {
  encrypt(plaintext: string): string;
  decrypt(token: string): string;
}

/**
 * Builds the LLM-key crypto closures from the master secret and injected
 * primitives (mirror of `dsnCryptoFromSecret`). The `ADMINIUM_SECRET`-derived key
 * is scoped by {@link LLM_KEY_SALT} so LLM-key, DSN, TOTP, and session keys never
 * coincide even for the same master secret.
 */
export function llmKeyCryptoFromSecret(
  masterSecret: string,
  helpers: SecretCryptoHelpers,
): LlmKeyCrypto {
  if (masterSecret.length === 0) {
    throw new Error('cannot derive an LLM key-crypto closure from an empty secret');
  }
  const key = helpers.deriveKey(masterSecret, LLM_KEY_SALT);
  return {
    encrypt: (plaintext) => helpers.encryptSecret(plaintext, key),
    decrypt: (token) => helpers.decryptSecret(token, key),
  };
}
