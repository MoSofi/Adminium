// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Secrets must not survive the log, at ANY depth.
 *
 * THE BUG THIS PINS. `REDACT_PATHS` reads as though `*.password` covers
 * "password at any level"; pino's `*` is exactly one level, so the list
 * protected depth 2 and leaked at depth 1, at depth 3+, and through arrays. The
 * SMTP credential was covered at no depth at all — under a comment in
 * `email/config.ts` asserting pino redacted it.
 *
 * Every case here drives the REAL `buildLogger` and asserts on the bytes it
 * writes. Asserting on `scrubSecretFields` alone would not catch a formatter
 * that is never wired in, which is the failure mode that produced this file.
 */
import { describe, expect, it } from 'vitest';

import { buildLogger } from '../src/app.js';
import { SECRET_FIELD_NAMES_CANONICAL, scrubSecretFields } from '../src/log-redaction.js';
import { makeEnv } from './helpers.js';

/** Captures every line the logger writes, as pino would write it to the file. */
function capture(): { lines: string[]; stream: { write(line: string): void } } {
  const lines: string[] = [];
  return { lines, stream: { write: (line: string) => void lines.push(line) } };
}

function logged(fn: (log: ReturnType<typeof buildLogger>) => void): string {
  const { lines, stream } = capture();
  const log = buildLogger(makeEnv(), { pretty: false, stream });
  fn(log);
  return lines.join('\n');
}

const SECRET = 'S3CR3T-CANARY-VALUE';

describe('secrets do not survive the log at any depth', () => {
  it('redacts at depth 1, 2, 3 and inside arrays', () => {
    const out = logged((log) => {
      log.info({ password: SECRET }, 'depth 1');
      log.info({ a: { password: SECRET } }, 'depth 2');
      log.info({ a: { b: { password: SECRET } } }, 'depth 3');
      log.info({ users: [{ password: SECRET }] }, 'array');
      log.info({ a: { b: { c: { d: { e: { password: SECRET } } } } } }, 'depth 6');
    });
    // Depths 1, 3+ and arrays are exactly what the path list missed.
    expect(out).not.toContain(SECRET);
    expect(out).toContain('[REDACTED]');
  });

  it('redacts the SMTP credential — both the ciphertext and the decrypted plaintext', () => {
    // The residual as reported was the stored ciphertext. The plaintext is the
    // more valuable of the two and was equally unprotected: pino's `*.password`
    // matches neither `pass` nor `passEncrypted`, because paths are field names
    // and not substrings.
    const out = logged((log) => {
      log.info({ smtp: { passEncrypted: SECRET, pass: SECRET, user: 'ops@example.com' } }, 'smtp');
    });
    expect(out).not.toContain(SECRET);
    expect(out).toContain('ops@example.com');
  });

  it('redacts the TOTP seed, recovery codes and a driver error carrying a DSN', () => {
    const out = logged((log) => {
      // otpauthUrl is a STRING containing the seed, so no key-name rule below it helps.
      log.info({ enroll: { otpauthUrl: `otpauth://totp/a?secret=${SECRET}` } }, 'totp');
      // recoveryCodes is an ARRAY — a scrubber that only censored strings would print it.
      log.info({ result: { recoveryCodes: [SECRET, SECRET] } }, 'recovery');
      // export/redaction.ts already refuses to EXPORT last_error for this reason.
      log.info({ conn: { lastError: `connect failed: postgres://u:${SECRET}@h/db` } }, 'driver');
    });
    expect(out).not.toContain(SECRET);
  });

  it('matches case-insensitively, unlike pino paths', () => {
    const out = logged((log) => log.info({ a: { PassEncrypted: SECRET, APIKEY: SECRET } }, 'case'));
    expect(out).not.toContain(SECRET);
  });
});

describe('the scrub does not damage what the log is for', () => {
  it('keeps an Error serializable — message and stack survive', () => {
    // Invariant (a): pino runs formatters.log BEFORE the per-key serializers, so
    // a scrubber that cloned an Error would hand `err` a plain object with no
    // message and no stack.
    const out = logged((log) => log.error({ err: new Error('boom-marker') }, 'failed'));
    expect(out).toContain('boom-marker');
    expect(out).toContain('stack');
  });

  it('returns the SAME object when nothing matched, so ordinary lines allocate nothing', () => {
    const input = { requestId: 'abc', durationMs: 12, nested: { rows: [1, 2, 3] } };
    expect(scrubSecretFields(input)).toBe(input);
  });

  it('does not censor *hash fields — a verifier is not a credential', () => {
    const out = logged((log) => log.info({ user: { passwordHash: 'argon2id$v=19$m=...' } }, 'hash'));
    expect(out).toContain('argon2id');
  });
});

describe('the walk is total — hardening that would otherwise only look applied', () => {
  it('breaks a circular reference with a marker rather than re-emitting the node', () => {
    // Returning the node on a revisit hands pino the ORIGINAL, unscrubbed object.
    const cyclic: Record<string, unknown> = { password: SECRET };
    cyclic.self = cyclic;
    const out = JSON.stringify(scrubSecretFields(cyclic));
    expect(out).not.toContain(SECRET);
    expect(out).toContain('[REDACTED:CIRCULAR]');
  });

  it('replaces a subtree past the depth cap instead of returning it', () => {
    let deep: Record<string, unknown> = { password: SECRET };
    for (let i = 0; i < 14; i += 1) deep = { nest: deep };
    expect(JSON.stringify(scrubSecretFields(deep))).not.toContain(SECRET);
  });

  it('survives a getter that throws instead of taking the request down with it', () => {
    const hostile = {
      ok: 'visible',
      get boom(): string {
        throw new Error('getter exploded');
      },
    };
    expect(() => scrubSecretFields(hostile as unknown as Record<string, unknown>)).not.toThrow();
    const out = JSON.stringify(scrubSecretFields(hostile as unknown as Record<string, unknown>));
    expect(out).toContain('visible');
    expect(out).toContain('[REDACTED:THREW]');
  });
});

describe('the field list stays honest', () => {
  it('carries no *hash spelling, which would blind debugging', () => {
    for (const name of SECRET_FIELD_NAMES_CANONICAL) {
      expect(name.toLowerCase().endsWith('hash')).toBe(false);
    }
  });

  it('covers every field the audit found leaking', () => {
    const lower = new Set(SECRET_FIELD_NAMES_CANONICAL.map((n) => n.toLowerCase()));
    for (const name of [
      'pass',
      'passencrypted',
      'otpauthurl',
      'recoverycodes',
      'challengetoken',
      'secretencrypted',
      'lasterror',
    ]) {
      expect(lower.has(name), `${name} must be redacted`).toBe(true);
    }
  });
});
