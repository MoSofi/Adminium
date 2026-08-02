/**
 * `adminium migrate` + meta-store resolution (M10-T01, 01 §3.1/§7.2).
 *
 * Unlike the dispatch suites, these run against a REAL temp SQLite meta store —
 * `migrate`'s whole contract is "idempotent", and a mocked migrator could not
 * tell you whether it is. No server is booted; only the store is opened.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeBootstrap } from '../src/config/bootstrap.js';
import { runCli } from '../src/cli/run.js';
import { defaultCliDeps } from '../src/cli/runtime.js';
import {
  embeddedMetaWarning,
  metaEngineFromUrl,
  metaUrlCryptoFromSecret,
  MetaUrlError,
  resolveMetaUrl,
  sqlitePathFromUrl,
} from '../src/meta/store.js';
import { fakeIo, TEST_SECRET } from './cli-helpers.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adminium-migrate-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Real deps, but pinned at a throwaway SQLite store under the temp dir. */
function realDeps(overrides: Record<string, string | undefined> = {}) {
  return {
    ...defaultCliDeps(),
    env: {
      ADMINIUM_SECRET: TEST_SECRET,
      ADMINIUM_META_URL: `sqlite:${join(dir, 'meta.db')}`,
      ADMINIUM_DATA_DIR: dir,
      ...overrides,
    },
    cwd: dir,
  };
}

describe('adminium migrate', () => {
  it('applies the migrations and reports what it applied', async () => {
    const io = fakeIo();
    await expect(runCli(['migrate'], { io, deps: realDeps() })).resolves.toBe(0);
    expect(io.stdout()).toMatch(/Applied \d+ migration\(s\) to the sqlite meta store/);
    expect(io.stdout()).toContain('0001_core_auth');
    expect(existsSync(join(dir, 'meta.db'))).toBe(true);
  });

  it('is idempotent — a second run applies nothing and still exits 0', async () => {
    await expect(runCli(['migrate'], { io: fakeIo(), deps: realDeps() })).resolves.toBe(0);

    const io = fakeIo();
    await expect(runCli(['migrate'], { io, deps: realDeps() })).resolves.toBe(0);
    expect(io.stdout()).toContain('up to date');
    expect(io.stdout()).not.toContain('Applied');
  });

  it('is idempotent across many runs, not just two', async () => {
    for (let i = 0; i < 3; i += 1) {
      await expect(runCli(['migrate'], { io: fakeIo(), deps: realDeps() })).resolves.toBe(0);
    }
    const io = fakeIo();
    await runCli(['migrate', '--status'], { io, deps: realDeps() });
    // Every known migration applied exactly once; no drift, no unknown rows.
    expect(io.stdout()).not.toContain('CHECKSUM DRIFT');
    expect(io.stdout()).not.toContain('unknown to this version');
    expect(io.stdout()).not.toMatch(/\bno\b/);
  });

  it('--status lists migrations without applying them', async () => {
    const io = fakeIo();
    await expect(runCli(['migrate', '--status'], { io, deps: realDeps() })).resolves.toBe(0);
    expect(io.stdout()).toContain('0001_core_auth');
    expect(io.stdout()).toContain('applied');
    // Nothing was applied, so every row reads "no".
    expect(io.stdout()).toMatch(/0001_core_auth\s+no/);
  });

  it('--meta-url beats ADMINIUM_META_URL', async () => {
    const other = join(dir, 'other.db');
    await expect(
      runCli(['migrate', '--meta-url', `sqlite:${other}`], { io: fakeIo(), deps: realDeps() }),
    ).resolves.toBe(0);
    expect(existsSync(other)).toBe(true);
    expect(existsSync(join(dir, 'meta.db'))).toBe(false);
  });

  it('fails fast without ADMINIUM_SECRET', async () => {
    const io = fakeIo();
    await expect(
      runCli(['migrate'], { io, deps: realDeps({ ADMINIUM_SECRET: undefined }) }),
    ).resolves.toBe(1);
    expect(io.stderr()).toContain('ADMINIUM_SECRET');
    expect(existsSync(join(dir, 'meta.db'))).toBe(false);
  });

  it('rejects an unsupported meta DSN scheme with the supported forms spelled out', async () => {
    const io = fakeIo();
    await expect(
      runCli(['migrate', '--meta-url', 'mongodb://localhost/db'], { io, deps: realDeps() }),
    ).resolves.toBe(1);
    expect(io.stderr()).toContain('postgres://');
    expect(io.stderr()).toContain('sqlite:');
  });
});

describe('metaEngineFromUrl', () => {
  it.each([
    ['postgres://u@h/db', 'postgres'],
    ['postgresql://u@h/db', 'postgres'],
    ['mysql://u@h/db', 'mysql'],
    ['mariadb://u@h/db', 'mysql'],
    ['sqlite:./meta.db', 'sqlite'],
    ['sqlite3:./meta.db', 'sqlite'],
    ['file:./meta.db', 'sqlite'],
  ])('%s → %s', (url, engine) => {
    expect(metaEngineFromUrl(url)).toBe(engine);
  });

  it('rejects anything else', () => {
    expect(() => metaEngineFromUrl('mongodb://h/db')).toThrow(MetaUrlError);
    expect(() => metaEngineFromUrl('just-a-path')).toThrow(MetaUrlError);
  });
});

describe('sqlitePathFromUrl', () => {
  it.each([
    ['sqlite:./meta.db', './meta.db'],
    ['sqlite:/abs/meta.db', '/abs/meta.db'],
    ['sqlite://./meta.db', './meta.db'],
    ['file:./meta.db', './meta.db'],
  ])('%s → %s', (url, path) => {
    expect(sqlitePathFromUrl(url)).toBe(path);
  });

  it('treats a bare scheme as an in-memory store', () => {
    expect(sqlitePathFromUrl('sqlite:')).toBe(':memory:');
  });
});

describe('resolveMetaUrl — the §7.2 precedence', () => {
  it('1. ADMINIUM_META_URL wins outright', async () => {
    await expect(
      resolveMetaUrl({ metaUrl: 'postgres://u@h/db', dataDir: dir, secret: TEST_SECRET }),
    ).resolves.toEqual({ url: 'postgres://u@h/db', engine: 'postgres', source: 'env' });
  });

  it('2. the bootstrap file supplies the DSN when the env does not', async () => {
    const url = 'postgres://u@bootstrap/db';
    await writeBootstrap(dir, {
      v: 1,
      metaUrl: metaUrlCryptoFromSecret(TEST_SECRET).encrypt(url),
      createdAt: new Date().toISOString(),
      instanceId: 'inst_1',
    });
    await expect(resolveMetaUrl({ dataDir: dir, secret: TEST_SECRET })).resolves.toEqual({
      url,
      engine: 'postgres',
      source: 'bootstrap',
    });
  });

  it('env beats the bootstrap file — "environment always wins" (§7.2)', async () => {
    await writeBootstrap(dir, {
      v: 1,
      metaUrl: metaUrlCryptoFromSecret(TEST_SECRET).encrypt('postgres://u@bootstrap/db'),
      createdAt: new Date().toISOString(),
      instanceId: 'inst_1',
    });
    const resolved = await resolveMetaUrl({
      metaUrl: 'mysql://u@env/db',
      dataDir: dir,
      secret: TEST_SECRET,
    });
    expect(resolved).toMatchObject({ url: 'mysql://u@env/db', source: 'env' });
  });

  it('a changed ADMINIUM_SECRET names the file and both ways out', async () => {
    // The most likely second-run failure there is: `openssl rand -hex 32`
    // yields a new value every time, so anyone re-running the quickstart in a
    // fresh terminal lands here. The raw crypto error ("decryption failed —
    // token was tampered with or the key is wrong") named neither the file nor
    // the variable, which made a self-inflicted, one-command-fixable situation
    // look like corruption.
    await writeBootstrap(dir, {
      v: 1,
      metaUrl: metaUrlCryptoFromSecret(TEST_SECRET).encrypt('postgres://u@bootstrap/db'),
      createdAt: new Date().toISOString(),
      instanceId: 'inst_1',
    });

    const failure = await resolveMetaUrl({ dataDir: dir, secret: 'a-completely-different-secret' })
      .then(() => null)
      .catch((error: unknown) => error as Error);

    expect(failure).not.toBeNull();
    expect(failure?.name).toBe('MetaSecretMismatchError');
    const message = failure?.message ?? '';
    expect(message).toContain(join(dir, 'adminium.json')); // which file
    expect(message).toContain('ADMINIUM_SECRET'); // which knob
    expect(message).toContain('openssl rand -hex 32'); // why it happened
    expect(message).toContain('set ADMINIUM_SECRET back'); // way out 1
    expect(message).toContain('delete'); // way out 2
    expect(message).toContain('your database'); // what is NOT lost
    // The unactionable original must not be what reaches the user.
    expect(message).not.toContain('token was tampered with');
  });

  it('restoring the original secret resolves the same DSN again', async () => {
    // Proves the first remedy the message offers actually works.
    const url = 'postgres://u@bootstrap/db';
    await writeBootstrap(dir, {
      v: 1,
      metaUrl: metaUrlCryptoFromSecret(TEST_SECRET).encrypt(url),
      createdAt: new Date().toISOString(),
      instanceId: 'inst_1',
    });
    await expect(resolveMetaUrl({ dataDir: dir, secret: 'wrong-secret-entirely' })).rejects.toThrow(
      /different ADMINIUM_SECRET/,
    );
    await expect(resolveMetaUrl({ dataDir: dir, secret: TEST_SECRET })).resolves.toMatchObject({
      url,
      source: 'bootstrap',
    });
  });

  it('3. falls back to embedded SQLite under the data dir (§3.1 OD-1)', async () => {
    const resolved = await resolveMetaUrl({ dataDir: dir, secret: TEST_SECRET });
    expect(resolved.engine).toBe('sqlite');
    expect(resolved.source).toBe('embedded');
    expect(sqlitePathFromUrl(resolved.url)).toBe(join(dir, 'meta.db'));
  });

  it('the bootstrap DSN is encrypted at rest, not plaintext', async () => {
    const crypto = metaUrlCryptoFromSecret(TEST_SECRET);
    const token = crypto.encrypt('postgres://user:secret-password@h/db');
    expect(token).not.toContain('secret-password');
    expect(crypto.decrypt(token)).toBe('postgres://user:secret-password@h/db');
  });

  it('a bootstrap DSN cannot be decrypted with a different secret', async () => {
    const token = metaUrlCryptoFromSecret(TEST_SECRET).encrypt('postgres://u@h/db');
    expect(() => metaUrlCryptoFromSecret('a-completely-different-secret').decrypt(token)).toThrow();
  });
});

describe('embeddedMetaWarning', () => {
  it('names the path and the variable that replaces it', () => {
    const warning = embeddedMetaWarning('sqlite:/data/meta.db');
    expect(warning).toContain('/data/meta.db');
    expect(warning).toContain('ADMINIUM_META_URL');
  });
});
