// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LLM key-crypto contract tests (06-llm-assist.md §3.2). The concrete AES-256-GCM
 * primitives live in the server tree (see the blocker); here we inject a fake to
 * prove the wiring: the LLM purpose salt is used and encrypt/decrypt round-trips.
 */
import { describe, expect, it, vi } from 'vitest';

import { LLM_KEY_SALT, llmKeyCryptoFromSecret, type SecretCryptoHelpers } from './crypto.js';

function fakeHelpers(): { helpers: SecretCryptoHelpers; deriveKey: ReturnType<typeof vi.fn> } {
  // Reversible stand-in for AES-256-GCM: token = "enc:" + reversed plaintext, keyed nominally.
  const deriveKey = vi.fn((secret: string, salt: string | Uint8Array) =>
    new TextEncoder().encode(`${secret}|${String(salt)}`).slice(0, 32),
  );
  const helpers: SecretCryptoHelpers = {
    deriveKey,
    encryptSecret: (plaintext, key) => `enc:${String(key.length)}:${[...plaintext].reverse().join('')}`,
    decryptSecret: (token) => {
      const payload = token.replace(/^enc:\d+:/, '');
      return [...payload].reverse().join('');
    },
  };
  return { helpers, deriveKey };
}

describe('llmKeyCryptoFromSecret', () => {
  it('derives the key with the LLM purpose salt and round-trips', () => {
    const { helpers, deriveKey } = fakeHelpers();
    const crypto = llmKeyCryptoFromSecret('master-secret', helpers);

    expect(deriveKey).toHaveBeenCalledTimes(1);
    expect(deriveKey).toHaveBeenCalledWith('master-secret', LLM_KEY_SALT);

    const token = crypto.encrypt('sk-provider-key');
    expect(token).not.toContain('sk-provider-key'); // the closure produced a token, not plaintext
    expect(crypto.decrypt(token)).toBe('sk-provider-key');
  });

  it('rejects an empty master secret', () => {
    const { helpers } = fakeHelpers();
    expect(() => llmKeyCryptoFromSecret('', helpers)).toThrow(/empty secret/);
  });

  it('exposes the LLM purpose salt distinct from other purposes', () => {
    expect(LLM_KEY_SALT).toBe('adminium:llm-key:v1');
  });
});
