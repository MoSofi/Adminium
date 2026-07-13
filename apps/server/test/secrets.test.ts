import { describe, expect, it } from 'vitest';

import {
  ENC_TOKEN_PREFIX,
  SecretFormatError,
  SecretIntegrityError,
  decryptSecret,
  deriveKey,
  encryptSecret,
  isEncryptedSecret,
} from '../src/config/secrets.js';

const SECRET = 'a-sufficiently-long-master-secret';
const key = deriveKey(SECRET, 'unit-test-salt');

describe('deriveKey (HKDF-SHA256)', () => {
  it('produces a 32-byte key', () => {
    expect(key.length).toBe(32);
  });

  it('is deterministic for the same secret + salt + info', () => {
    expect(deriveKey(SECRET, 'unit-test-salt').equals(key)).toBe(true);
  });

  it('differs by salt, secret, and info scope', () => {
    expect(deriveKey(SECRET, 'other-salt').equals(key)).toBe(false);
    expect(deriveKey('another-master-secret-entirely', 'unit-test-salt').equals(key)).toBe(false);
    expect(deriveKey(SECRET, 'unit-test-salt', 'adminium:hmac').equals(key)).toBe(false);
  });

  it('rejects an empty secret', () => {
    expect(() => deriveKey('', 'salt')).toThrow(SecretFormatError);
  });
});

describe('encryptSecret / decryptSecret (AES-256-GCM)', () => {
  it('round-trips a DSN', () => {
    const dsn = 'postgres://adminium:s3cret@db.internal:5432/meta';
    expect(decryptSecret(encryptSecret(dsn, key), key)).toBe(dsn);
  });

  it('round-trips unicode and empty strings', () => {
    for (const value of ['', 'пароль-avec-émoji-🔐', 'sqlite:./data/meta.db']) {
      expect(decryptSecret(encryptSecret(value, key), key)).toBe(value);
    }
  });

  it('produces enc:v1:<base64> tokens', () => {
    const token = encryptSecret('hello', key);
    expect(token.startsWith(ENC_TOKEN_PREFIX)).toBe(true);
    expect(token).toMatch(/^enc:v1:[A-Za-z0-9+/]+=*$/);
    expect(isEncryptedSecret(token)).toBe(true);
    expect(isEncryptedSecret('postgres://plain')).toBe(false);
  });

  it('uses a fresh IV per call (same plaintext, different tokens)', () => {
    expect(encryptSecret('hello', key)).not.toBe(encryptSecret('hello', key));
  });

  it('detects tampering with any byte of the payload', () => {
    const token = encryptSecret('sensitive-dsn', key);
    const raw = Buffer.from(token.slice(ENC_TOKEN_PREFIX.length), 'base64');
    for (const offset of [0, 12, raw.length - 1]) {
      // iv, tag, ciphertext
      const tampered = Buffer.from(raw);
      const byte = tampered[offset] ?? 0;
      tampered[offset] = byte ^ 0xff;
      const tamperedToken = ENC_TOKEN_PREFIX + tampered.toString('base64');
      expect(() => decryptSecret(tamperedToken, key)).toThrow(SecretIntegrityError);
    }
  });

  it('rejects decryption with the wrong key', () => {
    const token = encryptSecret('sensitive-dsn', key);
    const wrongKey = deriveKey(SECRET, 'a-different-salt');
    expect(() => decryptSecret(token, wrongKey)).toThrow(SecretIntegrityError);
  });

  it('rejects malformed tokens as format errors', () => {
    expect(() => decryptSecret('not-a-token', key)).toThrow(SecretFormatError);
    expect(() => decryptSecret('enc:v1:AAAA', key)).toThrow(SecretFormatError); // too short
  });

  it('rejects keys of the wrong length', () => {
    const shortKey = new Uint8Array(16);
    expect(() => encryptSecret('x', shortKey)).toThrow(SecretFormatError);
    expect(() => decryptSecret(encryptSecret('x', key), shortKey)).toThrow(SecretFormatError);
  });
});
