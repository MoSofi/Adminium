import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnvValidationError, formatEnvErrorTable, loadEnv } from '../src/config/env.js';

const SECRET = 'a-sufficiently-long-dev-secret';

/** A stderr stub capturing everything written to it. */
function makeStderr(): { write: (chunk: string) => boolean; output: () => string } {
  let buffer = '';
  return {
    write(chunk: string) {
      buffer += chunk;
      return true;
    },
    output: () => buffer,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadEnv — valid input', () => {
  it('applies documented defaults with only ADMINIUM_SECRET set', () => {
    const env = loadEnv({ ADMINIUM_SECRET: SECRET }, makeStderr());
    expect(env).toEqual({
      ADMINIUM_SECRET: SECRET,
      PORT: 4600,
      HOST: '0.0.0.0',
      DATABASE_URL: undefined,
      ADMINIUM_META_URL: undefined,
      ADMINIUM_DATA_DIR: './data',
      ADMINIUM_LOG_LEVEL: 'info',
      // UNDEFINED, not `false`. This variable overrides the `telemetry.enabled`
      // consent answer, so "unset" has to stay distinguishable from "off" —
      // collapsing it to `false` would make the override veto every consenting
      // instance. Telemetry is still off by default; that default lives in the
      // settings registry, not here.
      ADMINIUM_TELEMETRY: undefined,
      ADMINIUM_TRUST_PROXY: false,
      ADMINIUM_CORS_ORIGINS: undefined,
      // The 11-electron.md §2.2 desktop block. `self-host` is the default because
      // every deployment that is not the Electron shell is one, and because the
      // value gates whether `POST /auth/desktop-session` EXISTS (§5) — the safe
      // answer to "nobody said" is the one with no auto-login door.
      ADMINIUM_RUNTIME: 'self-host',
      ADMINIUM_BOOT_TOKEN: undefined,
      // Tri-state like ADMINIUM_TELEMETRY, and for the same reason: it mirrors an
      // answer stored elsewhere (config.json, §2.3), so "unset" must stay
      // distinguishable from "off" or the mirror would overwrite what it mirrors.
      ADMINIUM_DESKTOP_SINGLE_USER: undefined,
    });
  });

  it('rejects a boot token that is not 32 bytes of hex', () => {
    // The shape is §2.2 step 4's, and a truncating or re-encoding generator
    // upstream must fail the boot loudly rather than ship a weaker token.
    for (const token of ['abc', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
      expect(() =>
        loadEnv({ ADMINIUM_SECRET: SECRET, ADMINIUM_BOOT_TOKEN: token }, makeStderr()),
      ).toThrow(EnvValidationError);
    }
    expect(
      loadEnv({ ADMINIUM_SECRET: SECRET, ADMINIUM_BOOT_TOKEN: 'a'.repeat(64) }, makeStderr())
        .ADMINIUM_BOOT_TOKEN,
    ).toBe('a'.repeat(64));
  });

  it('rejects an unknown runtime rather than defaulting it', () => {
    expect(() =>
      loadEnv({ ADMINIUM_SECRET: SECRET, ADMINIUM_RUNTIME: 'desktop-ish' }, makeStderr()),
    ).toThrow(EnvValidationError);
    expect(
      loadEnv({ ADMINIUM_SECRET: SECRET, ADMINIUM_RUNTIME: 'desktop' }, makeStderr())
        .ADMINIUM_RUNTIME,
    ).toBe('desktop');
  });

  it('leaves ADMINIUM_TELEMETRY undefined when unset, so consent can decide', () => {
    const env = loadEnv({ ADMINIUM_SECRET: SECRET }, makeStderr());
    expect(env.ADMINIUM_TELEMETRY).toBeUndefined();
    // An empty value is unset, not "off" — a compose file with
    // `ADMINIUM_TELEMETRY: ${ADMINIUM_TELEMETRY:-}` must not veto the setting.
    expect(
      loadEnv({ ADMINIUM_SECRET: SECRET, ADMINIUM_TELEMETRY: '' }, makeStderr())
        .ADMINIUM_TELEMETRY,
    ).toBeUndefined();
  });

  it('parses explicit values (PORT coerced to a number)', () => {
    const env = loadEnv(
      {
        ADMINIUM_SECRET: SECRET,
        PORT: '8080',
        HOST: '127.0.0.1',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/app',
        ADMINIUM_META_URL: 'sqlite:./data/meta.db',
        ADMINIUM_DATA_DIR: '/data',
        ADMINIUM_LOG_LEVEL: 'debug',
      },
      makeStderr(),
    );
    expect(env.PORT).toBe(8080);
    expect(env.HOST).toBe('127.0.0.1');
    expect(env.ADMINIUM_META_URL).toBe('sqlite:./data/meta.db');
    expect(env.ADMINIUM_LOG_LEVEL).toBe('debug');
  });

  it.each([
    ['on', true],
    ['true', true],
    ['1', true],
    ['off', false],
    ['false', false],
    ['0', false],
  ])('parses boolean-ish ADMINIUM_TELEMETRY=%s as %s', (raw, expected) => {
    const env = loadEnv({ ADMINIUM_SECRET: SECRET, ADMINIUM_TELEMETRY: raw }, makeStderr());
    expect(env.ADMINIUM_TELEMETRY).toBe(expected);
  });

  it('treats empty strings as unset (defaults apply)', () => {
    const env = loadEnv(
      { ADMINIUM_SECRET: SECRET, PORT: '', ADMINIUM_LOG_LEVEL: '', DATABASE_URL: '' },
      makeStderr(),
    );
    expect(env.PORT).toBe(4600);
    expect(env.ADMINIUM_LOG_LEVEL).toBe('info');
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it.each([
    ['on', true],
    ['off', false],
  ])('parses boolean-ish ADMINIUM_TRUST_PROXY=%s as %s', (raw, expected) => {
    const env = loadEnv({ ADMINIUM_SECRET: SECRET, ADMINIUM_TRUST_PROXY: raw }, makeStderr());
    expect(env.ADMINIUM_TRUST_PROXY).toBe(expected);
  });

  it('parses ADMINIUM_CORS_ORIGINS as a trimmed CSV list', () => {
    const env = loadEnv(
      {
        ADMINIUM_SECRET: SECRET,
        ADMINIUM_CORS_ORIGINS: ' https://admin.acme.io , https://ops.acme.io ',
      },
      makeStderr(),
    );
    expect(env.ADMINIUM_CORS_ORIGINS).toEqual(['https://admin.acme.io', 'https://ops.acme.io']);
  });

  it('treats an empty ADMINIUM_CORS_ORIGINS as unset', () => {
    const env = loadEnv({ ADMINIUM_SECRET: SECRET, ADMINIUM_CORS_ORIGINS: ' , ' }, makeStderr());
    expect(env.ADMINIUM_CORS_ORIGINS).toBeUndefined();
  });

  it('rejects a wildcard CORS origin (credentialed responses)', () => {
    expect(() =>
      loadEnv({ ADMINIUM_SECRET: SECRET, ADMINIUM_CORS_ORIGINS: '*' }, makeStderr()),
    ).toThrow(EnvValidationError);
    expect(() =>
      loadEnv(
        { ADMINIUM_SECRET: SECRET, ADMINIUM_CORS_ORIGINS: 'https://a.io,*' },
        makeStderr(),
      ),
    ).toThrow(EnvValidationError);
  });

  it('ignores unrelated environment variables', () => {
    const env = loadEnv({ ADMINIUM_SECRET: SECRET, PATH: '/usr/bin' }, makeStderr());
    expect(env).not.toHaveProperty('PATH');
  });
});

describe('loadEnv — fail-fast behavior', () => {
  it('throws EnvValidationError (never process.exit) on a missing secret', () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as unknown as typeof process.exit);
    const stderr = makeStderr();
    expect(() => loadEnv({}, stderr)).toThrow(EnvValidationError);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('prints a variable | problem | hint table to stderr', () => {
    const stderr = makeStderr();
    expect(() => loadEnv({ ADMINIUM_SECRET: 'too-short', PORT: 'abc' }, stderr)).toThrow(
      EnvValidationError,
    );
    const out = stderr.output();
    // header
    expect(out).toContain('variable');
    expect(out).toContain('problem');
    expect(out).toContain('hint');
    // rows: variable, problem text, and hint text
    expect(out).toContain('ADMINIUM_SECRET');
    expect(out).toContain('must be at least 16 characters');
    expect(out).toContain('openssl rand -hex 32');
    expect(out).toContain('PORT');
    expect(out).toContain('integer between 1 and 65535 (default 4600)');
  });

  it('rejects a short secret and out-of-range or invalid values', () => {
    for (const env of [
      { ADMINIUM_SECRET: 'short' },
      { ADMINIUM_SECRET: SECRET, PORT: '0' },
      { ADMINIUM_SECRET: SECRET, PORT: '70000' },
      { ADMINIUM_SECRET: SECRET, PORT: '80.5' },
      { ADMINIUM_SECRET: SECRET, ADMINIUM_LOG_LEVEL: 'verbose' },
      { ADMINIUM_SECRET: SECRET, ADMINIUM_TELEMETRY: 'yes' },
    ]) {
      expect(() => loadEnv(env, makeStderr()), JSON.stringify(env)).toThrow(EnvValidationError);
    }
  });

  it('exposes the rendered table and issues on the error', () => {
    const stderr = makeStderr();
    let caught: EnvValidationError | undefined;
    try {
      loadEnv({}, stderr);
    } catch (error) {
      caught = error as EnvValidationError;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    expect(caught?.table).toContain('ADMINIUM_SECRET');
    expect(caught?.issues.length).toBeGreaterThan(0);
    expect(caught?.table).toBe(formatEnvErrorTable(caught?.issues ?? []));
  });

  it('writes to process.stderr by default', () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => loadEnv({})).toThrow(EnvValidationError);
    expect(writeSpy).toHaveBeenCalledOnce();
    expect(String(writeSpy.mock.calls[0]?.[0])).toContain('ADMINIUM_SECRET');
  });
});
