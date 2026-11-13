// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The trial and hosted environment: every
 * variable parsed in one block, the boots that fail, and the implied values
 * that are enforced rather than defaulted.
 *
 * Both front doors are driven: `loadEnv` (a container, the desktop shell) and
 * `loadCliEnv` (`adminium start`). A refusal that only one of them made would
 * be a door left open.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadCliEnv } from '../src/cli/runtime.js';
import { EnvValidationError, envSchema, loadEnv, OPERATOR_DECIDED_ENV, type Env } from '../src/config/env.js';
import { TEST_SECRET } from './helpers.js';

/** 32 random bytes, hex: what an operator token is made of. */
const TOKEN = 'a3f1c2e4b5d6978899aabbccddeeff00112233445566778899aabbccddeeff01';

/** The least a trial boot needs. */
const TRIAL: Record<string, string> = {
  ADMINIUM_SECRET: TEST_SECRET,
  ADMINIUM_TRIAL_MODE: 'on',
  ADMINIUM_TRIAL_ENDS_AT: '2026-12-01T00:00:00Z',
  ADMINIUM_PUBLIC_ORIGIN: 'https://hollis.try.example.com',
  ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432,*.pooler.supabase.com:6543',
  ADMINIUM_SETUP_TOKEN: 'a-long-enough-setup-token',
};

/** The least a hosted boot needs (the host list and the origin lock are kept). */
const HOSTED: Record<string, string> = {
  ADMINIUM_SECRET: TEST_SECRET,
  ADMINIUM_HOSTED_MODE: 'on',
  ADMINIUM_PUBLIC_ORIGIN: 'https://hollis.example.com',
  ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432',
};

const silent = { write: () => true };

type Booted = { ok: true; env: Env } | { ok: false; variables: string[]; table: string };

/** `loadEnv` over `raw`, as the problem table names it. */
function boot(raw: Record<string, string | undefined>): Booted {
  try {
    return { ok: true, env: loadEnv({ ...raw }, silent) };
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    return { ok: false, variables: error.issues.map((issue) => String(issue.path[0] ?? '(env)')), table: error.table };
  }
}

/** The same through the CLI's loader. */
function cliBoot(raw: Record<string, string | undefined>): { ok: boolean; message: string } {
  try {
    loadCliEnv({ ADMINIUM_DATA_DIR: mkdtempSync(join(tmpdir(), 'trial-env-')), ...raw });
    return { ok: true, message: '' };
  } catch (error) {
    return { ok: false, message: `${(error as Error).message}\n${(error as { hint?: string }).hint ?? ''}` };
  }
}

function refused(raw: Record<string, string | undefined>, variable: string): string {
  const result = boot(raw);
  expect(result.ok, `${variable} should fail the boot`).toBe(false);
  if (result.ok) return '';
  expect(result.variables).toContain(variable);
  return result.table;
}

function booted(raw: Record<string, string | undefined>): Env {
  const result = boot(raw);
  if (!result.ok) throw new Error(`expected a boot, got:\n${result.table}`);
  return result.env;
}

describe('the trial block parses', () => {
  it('reads every variable with its default', () => {
    const env = booted(TRIAL);
    expect(env.ADMINIUM_TRIAL_MODE).toBe(true);
    expect(env.ADMINIUM_HOSTED_MODE).toBe(false);
    expect(env.ADMINIUM_TRIAL_ENDS_AT).toBe('2026-12-01T00:00:00.000Z');
    expect(env.ADMINIUM_PUBLIC_ORIGIN).toBe('https://hollis.try.example.com');
    expect(env.ADMINIUM_TRIAL_DATA_MAX_MB).toBe(500);
    expect(env.ADMINIUM_TRIAL_UPLOAD_MAX_MB).toBe(10);
    expect(env.ADMINIUM_TRIAL_STORAGE_MAX_MB).toBe(1000);
    expect(env.ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY).toBe(50);
    expect(env.ADMINIUM_TRIAL_UPGRADE_URL).toBeUndefined();
    expect(env.ADMINIUM_TRIAL_SMTP_URL).toBeUndefined();
    expect(env.ADMINIUM_AI_OPERATOR_ONLY).toBe(false);
  });

  it('is off, and changes nothing, when unset', () => {
    const env = booted({ ADMINIUM_SECRET: TEST_SECRET });
    expect(env.ADMINIUM_TRIAL_MODE).toBe(false);
    expect(env.ADMINIUM_HOSTED_MODE).toBe(false);
    expect(env.ADMINIUM_NETWORK_POLICY).toBe('open');
    expect(env.ADMINIUM_LOCAL_DATABASES).toBeUndefined();
    expect(env.ADMINIUM_TELEMETRY).toBeUndefined();
    expect(env.ADMINIUM_MAP_SERVER).not.toBe('off');
  });

  it('takes an end date with a zone only', () => {
    expect(booted({ ...TRIAL, ADMINIUM_TRIAL_ENDS_AT: '2026-12-01T09:30:00+02:00' }).ADMINIUM_TRIAL_ENDS_AT).toBe('2026-12-01T07:30:00.000Z');
    for (const bad of ['2026-12-01', '2026-12-01T00:00:00', 'next tuesday', '2026-13-01T00:00:00Z']) {
      refused({ ...TRIAL, ADMINIUM_TRIAL_ENDS_AT: bad }, 'ADMINIUM_TRIAL_ENDS_AT');
    }
  });

  it('takes the caps as whole numbers of megabytes', () => {
    const env = booted({ ...TRIAL, ADMINIUM_TRIAL_DATA_MAX_MB: '200', ADMINIUM_TRIAL_UPLOAD_MAX_MB: '5', ADMINIUM_TRIAL_STORAGE_MAX_MB: '2000', ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY: '20' });
    expect([env.ADMINIUM_TRIAL_DATA_MAX_MB, env.ADMINIUM_TRIAL_UPLOAD_MAX_MB, env.ADMINIUM_TRIAL_STORAGE_MAX_MB, env.ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY]).toEqual([200, 5, 2000, 20]);
    refused({ ...TRIAL, ADMINIUM_TRIAL_DATA_MAX_MB: '0' }, 'ADMINIUM_TRIAL_DATA_MAX_MB');
    refused({ ...TRIAL, ADMINIUM_TRIAL_UPLOAD_MAX_MB: '1.5' }, 'ADMINIUM_TRIAL_UPLOAD_MAX_MB');
    refused({ ...TRIAL, ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY: 'lots' }, 'ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY');
  });

  it('takes an https upgrade address and an smtp relay', () => {
    const env = booted({ ...TRIAL, ADMINIUM_TRIAL_UPGRADE_URL: 'https://example.com/upgrade', ADMINIUM_TRIAL_SMTP_URL: 'smtp://i-123:pw@relay.example.com:587', ADMINIUM_TRIAL_MAIL_FROM: 'i-123@relay.example.com' });
    expect(env.ADMINIUM_TRIAL_UPGRADE_URL).toBe('https://example.com/upgrade');
    expect(env.ADMINIUM_TRIAL_SMTP_URL).toBe('smtp://i-123:pw@relay.example.com:587');
    for (const bad of ['http://example.com/upgrade', 'https://user:pw@example.com/up', 'https://example.com/up#x', 'javascript:alert(1)']) {
      refused({ ...TRIAL, ADMINIUM_TRIAL_UPGRADE_URL: bad }, 'ADMINIUM_TRIAL_UPGRADE_URL');
    }
    const table = refused({ ...TRIAL, ADMINIUM_TRIAL_SMTP_URL: 'https://user:hunter2@relay.example.com' }, 'ADMINIUM_TRIAL_SMTP_URL');
    // A credential is never printed back.
    expect(table).not.toContain('hunter2');
    refused({ ...TRIAL, ADMINIUM_TRIAL_SMTP_URL: 'smtp://' }, 'ADMINIUM_TRIAL_SMTP_URL');
  });

  it('takes a public origin as one origin, https unless it is this machine', () => {
    refused({ ...TRIAL, ADMINIUM_PUBLIC_ORIGIN: 'http://hollis.example.com' }, 'ADMINIUM_PUBLIC_ORIGIN');
    refused({ ...TRIAL, ADMINIUM_PUBLIC_ORIGIN: 'https://hollis.example.com/path' }, 'ADMINIUM_PUBLIC_ORIGIN');
    expect(booted({ ...TRIAL, ADMINIUM_PUBLIC_ORIGIN: 'http://localhost:4600' }).ADMINIUM_PUBLIC_ORIGIN).toBe('http://localhost:4600');
  });
});

describe('the operator variables parse', () => {
  it('takes plain lower-case host names as domains, and nothing else', () => {
    expect(booted({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_OPERATOR_DOMAINS: 'shop.example.com, www.hollis.co.uk' }).ADMINIUM_OPERATOR_DOMAINS).toEqual(['shop.example.com', 'www.hollis.co.uk']);
    for (const bad of ['*.example.com', 'Shop.example.com', '10.0.0.2', 'example.com:443', 'example.com/shop', 'https://example.com', 'localhost', '[::1]', 'exa mple.com', 'example.123']) {
      refused({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_OPERATOR_DOMAINS: bad }, 'ADMINIUM_OPERATOR_DOMAINS');
    }
  });

  it('takes an operator token of 32 random bytes or more, with a listener', () => {
    const env = booted({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_OPERATOR_TOKEN: TOKEN, ADMINIUM_OPERATOR_LISTEN: '10.0.0.2:4601' });
    expect(env.ADMINIUM_OPERATOR_TOKEN).toBe(TOKEN);
    expect(env.ADMINIUM_OPERATOR_LISTEN).toEqual({ host: '10.0.0.2', port: 4601 });
    // base64 of 32 bytes is as good as hex.
    booted({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_OPERATOR_TOKEN: Buffer.alloc(32, 7).toString('base64url'), ADMINIUM_OPERATOR_LISTEN: '10.0.0.2:4601' });
    for (const bad of ['short', TOKEN.slice(0, 62), 'a'.repeat(40)]) {
      refused({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_OPERATOR_TOKEN: bad, ADMINIUM_OPERATOR_LISTEN: '10.0.0.2:4601' }, 'ADMINIUM_OPERATOR_TOKEN');
    }
  });

  it('serves the operator endpoint on a named address only, never every address or the public port', () => {
    expect(booted({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_OPERATOR_TOKEN: TOKEN, ADMINIUM_OPERATOR_LISTEN: '[fd00::2]:4601' }).ADMINIUM_OPERATOR_LISTEN).toEqual({ host: 'fd00::2', port: 4601 });
    // Written another way, the same address as the one the listener binds and the checks read.
    expect(booted({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_OPERATOR_TOKEN: TOKEN, ADMINIUM_OPERATOR_LISTEN: '[FD00:0:0::2]:4601' }).ADMINIUM_OPERATOR_LISTEN).toEqual({ host: 'fd00::2', port: 4601 });
    // Every spelling of "every address" Node binds as one.
    const everyAddress = ['[::0.0.0.0]:4601', '[::ffff:0.0.0.0]:4601', '[0:0:0:0:0:0:0.0.0.0]:4601', '[0::0]:4601', '[::ffff:0:0]:4601', '000.000.000.000:4601'];
    for (const bad of ['0.0.0.0:4601', '[::]:4601', ...everyAddress, 'operator.internal:4601', '10.0.0.2', '10.0.0.2:0', '10.0.0.2:70000']) {
      refused({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_OPERATOR_TOKEN: TOKEN, ADMINIUM_OPERATOR_LISTEN: bad }, 'ADMINIUM_OPERATOR_LISTEN');
    }
    refused({ ADMINIUM_SECRET: TEST_SECRET, PORT: '4601', ADMINIUM_OPERATOR_TOKEN: TOKEN, ADMINIUM_OPERATOR_LISTEN: '10.0.0.2:4601' }, 'ADMINIUM_OPERATOR_LISTEN');
  });

  it('needs the token and the listener together, and the token for events', () => {
    refused({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_OPERATOR_TOKEN: TOKEN }, 'ADMINIUM_OPERATOR_TOKEN');
    refused({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_OPERATOR_LISTEN: '10.0.0.2:4601' }, 'ADMINIUM_OPERATOR_LISTEN');
    refused({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_OPERATOR_EVENTS_URL: 'https://control.example.com/events' }, 'ADMINIUM_OPERATOR_EVENTS_URL');
  });

  it('sends events to https, or plain http on the operator network only', () => {
    const base = { ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_OPERATOR_TOKEN: TOKEN, ADMINIUM_OPERATOR_LISTEN: '10.0.0.2:4601' };
    expect(booted({ ...base, ADMINIUM_OPERATOR_EVENTS_URL: 'https://control.example.com/events' }).ADMINIUM_OPERATOR_EVENTS_URL).toBe('https://control.example.com/events');
    expect(booted({ ...base, ADMINIUM_OPERATOR_EVENTS_URL: 'http://10.0.0.1:8080/events' }).ADMINIUM_OPERATOR_EVENTS_URL).toBe('http://10.0.0.1:8080/events');
    for (const bad of ['http://control.example.com/events', 'http://8.8.8.8/events', 'https://u:p@control.example.com/', 'http://169.254.169.254/latest', 'ftp://10.0.0.1/']) {
      refused({ ...base, ADMINIUM_OPERATOR_EVENTS_URL: bad }, 'ADMINIUM_OPERATOR_EVENTS_URL');
    }
  });

  it('reads operator AI: the switch, the one scope, a token budget', () => {
    const env = booted({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_AI_OPERATOR_ONLY: 'on', ADMINIUM_AI_OPERATOR_SCOPE: 'dashboard', ADMINIUM_AI_OPERATOR_BUDGET_TOKENS: '2000000' });
    expect([env.ADMINIUM_AI_OPERATOR_ONLY, env.ADMINIUM_AI_OPERATOR_SCOPE, env.ADMINIUM_AI_OPERATOR_BUDGET_TOKENS]).toEqual([true, 'dashboard', 2_000_000]);
    refused({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_AI_OPERATOR_SCOPE: 'everything' }, 'ADMINIUM_AI_OPERATOR_SCOPE');
    refused({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_AI_OPERATOR_BUDGET_TOKENS: '-1' }, 'ADMINIUM_AI_OPERATOR_BUDGET_TOKENS');
  });

  it('reads the start prompt from base64 or a mounted file, 2,000 characters at most', () => {
    const text = 'Build a dashboard for a bakery:\norders by day, top products.';
    expect(booted({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_DESIGNER_START_PROMPT_B64: Buffer.from(text).toString('base64') }).ADMINIUM_DESIGNER_START_PROMPT_B64).toBe(text);
    const dir = mkdtempSync(join(tmpdir(), 'start-prompt-'));
    writeFileSync(join(dir, 'prompt.txt'), `${text}\n`);
    expect(booted({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_DESIGNER_START_PROMPT_FILE: join(dir, 'prompt.txt') }).ADMINIUM_DESIGNER_START_PROMPT_FILE).toBe(text);
    refused({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_DESIGNER_START_PROMPT_B64: Buffer.from('x'.repeat(2001)).toString('base64') }, 'ADMINIUM_DESIGNER_START_PROMPT_B64');
    refused({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_DESIGNER_START_PROMPT_B64: 'not base64 at all!' }, 'ADMINIUM_DESIGNER_START_PROMPT_B64');
    refused({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_DESIGNER_START_PROMPT_B64: Buffer.from('a\u0000b').toString('base64') }, 'ADMINIUM_DESIGNER_START_PROMPT_B64');
    refused({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_DESIGNER_START_PROMPT_FILE: join(dir, 'missing.txt') }, 'ADMINIUM_DESIGNER_START_PROMPT_FILE');
    refused({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_DESIGNER_START_PROMPT_FILE: 'prompt.txt' }, 'ADMINIUM_DESIGNER_START_PROMPT_FILE');
    refused(
      { ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_DESIGNER_START_PROMPT_B64: Buffer.from(text).toString('base64'), ADMINIUM_DESIGNER_START_PROMPT_FILE: join(dir, 'prompt.txt') },
      'ADMINIUM_DESIGNER_START_PROMPT_FILE',
    );
  });

  it('holds the operator token and the relay out of process.env, file or value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'operator-token-'));
    writeFileSync(join(dir, 'token'), `${TOKEN}\n`);
    const env = booted({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_OPERATOR_TOKEN_FILE: join(dir, 'token'), ADMINIUM_OPERATOR_LISTEN: '10.0.0.2:4601' });
    expect(env.ADMINIUM_OPERATOR_TOKEN).toBe(TOKEN);
  });
});

describe('a trial boot fails without what it needs', () => {
  for (const name of ['ADMINIUM_TRIAL_ENDS_AT', 'ADMINIUM_SETUP_TOKEN', 'ADMINIUM_PUBLIC_ORIGIN', 'ADMINIUM_DATABASE_HOSTS']) {
    it(`without ${name}`, () => {
      const raw = { ...TRIAL };
      Reflect.deleteProperty(raw, name);
      refused(raw, name);
      expect(cliBoot(raw)).toMatchObject({ ok: false, message: expect.stringContaining(name) });
    });
  }

  it('boots with all of them, through both loaders', () => {
    booted(TRIAL);
    expect(cliBoot(TRIAL).ok).toBe(true);
  });
});

describe('a trial or hosted boot refuses what contradicts it', () => {
  const both = [
    ['ADMINIUM_RATE_LIMIT_SCALE', '50'],
    ['ADMINIUM_ADD_ON_DEV_TRUST', 'acme/*'],
    ['ADMINIUM_NETWORK_POLICY', 'open'],
    ['ADMINIUM_LOCAL_DATABASES', 'setting'],
    ['ADMINIUM_BRIDGE_ORIGINS', 'https://adminium.dev'],
    ['ADMINIUM_DEMO_SEED_SCRIPT', '/opt/demo-seed.mjs'],
    ['NODE_OPTIONS', '--require /tmp/x.js'],
    ['ADMINIUM_RUNTIME', 'desktop'],
    ['ADMINIUM_STORAGE_URL', 's3://bucket?endpoint=https://s3.example.com'],
    ['AWS_ENDPOINT_URL_S3', 'https://fly.storage.tigris.dev'],
  ] as const;
  for (const [name, value] of both) {
    it(`${name}=${value}`, () => {
      refused({ ...TRIAL, [name]: value }, name);
      refused({ ...HOSTED, [name]: value }, name);
      expect(cliBoot({ ...TRIAL, [name]: value })).toMatchObject({ ok: false, message: expect.stringContaining(name) });
      // Without either profile each is an ordinary value.
      if (name !== 'ADMINIUM_RUNTIME' && name !== 'ADMINIUM_DEMO_SEED_SCRIPT') booted({ ADMINIUM_SECRET: TEST_SECRET, [name]: value });
    });
  }

  it('a trial refuses telemetry and map servers switched on; the hosted profile keeps them', () => {
    for (const [name, value] of [['ADMINIUM_TELEMETRY', 'on'], ['ADMINIUM_MAP_SERVER', 'https://tiles.example.com'], ['ADMINIUM_ROUTING_SERVER', 'https://osrm.example.com']] as const) {
      refused({ ...TRIAL, [name]: value }, name);
      booted({ ...HOSTED, [name]: value });
    }
    // Saying what is implied is not a contradiction.
    booted({ ...TRIAL, ADMINIUM_NETWORK_POLICY: 'strict', ADMINIUM_LOCAL_DATABASES: 'off', ADMINIUM_TELEMETRY: 'off', ADMINIUM_MAP_SERVER: 'off', ADMINIUM_ROUTING_SERVER: 'off' });
  });

  it('refuses a control character in any trial or operator variable', () => {
    for (const [name, value] of [
      ['ADMINIUM_TRIAL_UPGRADE_URL', 'https://example.com/up\nX-Injected: 1'],
      ['ADMINIUM_PUBLIC_ORIGIN', 'https://hollis.example.com\r'],
      ['ADMINIUM_DATABASE_HOSTS', 'pg-trials:5432\u0000'],
      ['ADMINIUM_SETUP_TOKEN', 'a-long-enough-setup-token\t'],
      ['ADMINIUM_OPERATOR_DOMAINS', 'shop.example.com\u007f'],
      ['ADMINIUM_DEPLOY_LINK', 'off\u0085'],
    ] as const) {
      const table = refused({ ...TRIAL, [name]: value }, name);
      expect(table).toContain('control character');
    }
    // The new operator variables refuse one on any server.
    refused({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_AI_OPERATOR_SCOPE: 'dashboard\n' }, 'ADMINIUM_AI_OPERATOR_SCOPE');
  });

  it('refuses both profiles at once, and trial variables without trial mode', () => {
    refused({ ...TRIAL, ADMINIUM_HOSTED_MODE: 'on' }, 'ADMINIUM_HOSTED_MODE');
    for (const [name, value] of [
      ['ADMINIUM_TRIAL_ENDS_AT', '2026-12-01T00:00:00Z'],
      ['ADMINIUM_TRIAL_UPGRADE_URL', 'https://example.com/upgrade'],
      ['ADMINIUM_TRIAL_SMTP_URL', 'smtp://relay.example.com'],
      ['ADMINIUM_TRIAL_DATA_MAX_MB', '100'],
    ] as const) {
      refused({ ADMINIUM_SECRET: TEST_SECRET, [name]: value }, name);
      refused({ ...HOSTED, [name]: value }, name);
    }
  });

  it('a source URL must name a user and a database in either profile: the operator host takes only the login it names', () => {
    for (const url of ['postgres://pg-trials:5432/trial_hollis', 'postgres://trial_hollis:secret@pg-trials:5432', 'mysql://pg-trials:5432/trial_hollis']) {
      const table = refused({ ...TRIAL, ADMINIUM_SOURCE_URL: url }, 'ADMINIUM_SOURCE_URL');
      expect(table).toContain('must name a user and a database');
      // Never the password it was given.
      expect(table).not.toContain('secret');
      refused({ ...HOSTED, ADMINIUM_SOURCE_URL: url }, 'ADMINIUM_SOURCE_URL');
      expect(cliBoot({ ...TRIAL, ADMINIUM_SOURCE_URL: url })).toMatchObject({ ok: false, message: expect.stringContaining('ADMINIUM_SOURCE_URL') });
      // An ordinary server dials it as it is.
      booted({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_SOURCE_URL: url });
    }
    booted({ ...TRIAL, ADMINIUM_SOURCE_URL: 'postgres://trial_hollis:secret@pg-trials:5432/trial_hollis' });
  });

  it('a hosted boot needs the host list and the public origin, not an end date or a setup token', () => {
    booted(HOSTED);
    for (const name of ['ADMINIUM_PUBLIC_ORIGIN', 'ADMINIUM_DATABASE_HOSTS']) {
      const raw = { ...HOSTED };
      Reflect.deleteProperty(raw, name);
      refused(raw, name);
    }
  });
});

describe('implied values are enforced, never defaults', () => {
  it('a trial runs strict, with local databases, telemetry and maps off', () => {
    const env = booted(TRIAL);
    expect(env.ADMINIUM_NETWORK_POLICY).toBe('strict');
    expect(env.ADMINIUM_LOCAL_DATABASES).toBe('off');
    expect(env.ADMINIUM_TELEMETRY).toBe(false);
    expect(env.ADMINIUM_MAP_SERVER).toBe('off');
    expect(env.ADMINIUM_ROUTING_SERVER).toBe('off');
  });

  it('the hosted profile keeps strict and local databases off, and leaves telemetry and maps to the operator', () => {
    const env = booted(HOSTED);
    expect(env.ADMINIUM_NETWORK_POLICY).toBe('strict');
    expect(env.ADMINIUM_LOCAL_DATABASES).toBe('off');
    expect(env.ADMINIUM_TELEMETRY).toBeUndefined();
    expect(env.ADMINIUM_MAP_SERVER).not.toBe('off');
  });
});

describe('the operator-decided list', () => {
  it('names every trial and operator variable the schema validates', () => {
    const pattern = /^ADMINIUM_(TRIAL_|HOSTED_MODE$|PUBLIC_ORIGIN$|DATABASE_HOSTS$|LOCAL_DATABASES$|NETWORK_POLICY$|SQLITE_DIRS$|STORAGE_DIRS$|SETUP_TOKEN$|DEPLOY_LINK$|OPERATOR_|AI_OPERATOR_|SUPABASE_CONNECT_URL$|DESIGNER_START_PROMPT)/;
    const fromSchema = Object.keys(envSchema.shape).filter((name) => pattern.test(name)).sort();
    expect([...OPERATOR_DECIDED_ENV].sort()).toEqual(fromSchema);
    expect(fromSchema.length).toBe(30);
  });
});
