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
      ADMINIUM_TELEMETRY: false,
      ADMINIUM_TRUST_PROXY: false,
      ADMINIUM_CORS_ORIGINS: undefined,
    });
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
