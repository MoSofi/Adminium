// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Model connections: what the environment names, what a project's `.env`
 * holds, and the one resolver every caller of a model goes through.
 *
 * Three promises are pinned here. A key in a project's `.env` never reaches
 * `process.env`. Writing that file cannot be made to write anything but the
 * six names it is for. And whichever path asks for a model, its address is
 * checked and a cloud is refused when the server's network features are off.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { llmKeyCryptoFromSecret, ProviderError, type ProviderClient, type ProviderConfig, type ProviderRunner, type RunResult } from '@adminium/llm';
import { createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decryptSecret, deriveKey, encryptSecret } from '../src/config/secrets.js';
import { createAiEnv, type AiEnv } from '../src/llm/ai-env.js';
import { createAiConnections, parseSelected, ProviderNotConfiguredError, type AiConnections } from '../src/llm/connections.js';
import { addressKind, resolveAndCheck } from '../src/llm/outbound.js';
import { AI_ENV_NAMES, loadDotEnv, readDotEnv, setDotEnv } from '../src/project/dotenv.js';
import { TEST_SECRET } from './helpers.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-ai-env-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const envFile = (): string => readFileSync(join(root, '.env'), 'utf8');
const put = (text: string): void => {
  writeFileSync(join(root, '.env'), text);
};

// ── writing .env ─────────────────────────────────────────────────────────────

describe('setting a variable in .env', () => {
  it('changes the one line and keeps every other byte', () => {
    put('# the secret\nADMINIUM_SECRET=abc\n\nADMINIUM_AI_MODEL=ollama/qwen3\nDATABASE_URL=sqlite:./data/a.db\n');
    setDotEnv(root, { ADMINIUM_AI_MODEL: 'anthropic/claude-sonnet-5-5' }, AI_ENV_NAMES);
    expect(envFile()).toBe('# the secret\nADMINIUM_SECRET=abc\n\nADMINIUM_AI_MODEL=anthropic/claude-sonnet-5-5\nDATABASE_URL=sqlite:./data/a.db\n');
  });

  it('adds a variable that is not there, after a blank line, and makes the file when there is none', () => {
    put('ADMINIUM_SECRET=abc\n');
    setDotEnv(root, { ADMINIUM_AI_ANTHROPIC_API_KEY: 'sk-ant-1' }, AI_ENV_NAMES);
    expect(envFile()).toBe('ADMINIUM_SECRET=abc\n\nADMINIUM_AI_ANTHROPIC_API_KEY=sk-ant-1\n');

    rmSync(join(root, '.env'));
    setDotEnv(root, { ADMINIUM_AI_OLLAMA_BASE_URL: 'http://localhost:11434' }, AI_ENV_NAMES);
    expect(envFile()).toBe('ADMINIUM_AI_OLLAMA_BASE_URL=http://localhost:11434\n');
  });

  it('removes a variable, every line of it', () => {
    put('ADMINIUM_AI_MODEL=a/b\nX=1\nexport ADMINIUM_AI_MODEL=c/d\n');
    setDotEnv(root, { ADMINIUM_AI_MODEL: null }, AI_ENV_NAMES);
    expect(envFile()).toBe('X=1\n');
  });

  it('refuses a name it is not for, the secret above all', () => {
    put('ADMINIUM_SECRET=abc\n');
    expect(() => {
      setDotEnv(root, { ADMINIUM_SECRET: 'mine' }, AI_ENV_NAMES);
    }).toThrow('not a variable that may be written');
    expect(() => {
      setDotEnv(root, { NODE_OPTIONS: '--require ./x.js' }, AI_ENV_NAMES);
    }).toThrow('not a variable that may be written');
    expect(envFile()).toBe('ADMINIUM_SECRET=abc\n');
  });

  it('refuses a value that would be more than one line', () => {
    put('ADMINIUM_SECRET=abc\n');
    for (const value of ['sk-1\nNODE_OPTIONS=--require ./x.js', 'sk-1\rX=1', 'sk\u00001']) {
      expect(() => {
        setDotEnv(root, { ADMINIUM_AI_OPENAI_API_KEY: value }, AI_ENV_NAMES);
      }).toThrow('line break or a NUL');
    }
    expect(envFile()).toBe('ADMINIUM_SECRET=abc\n');
  });

  it('writes a value with spaces, a hash or quotes so that it reads back as itself', () => {
    const values = ['two words', 'with # hash', 'a=b', "it's", 'say "hi"', 'dollar $HOME', 'back\\slash'];
    for (const value of values) {
      setDotEnv(root, { ADMINIUM_AI_COMPATIBLE_API_KEY: value }, AI_ENV_NAMES);
      expect(readDotEnv(root)?.['ADMINIUM_AI_COMPATIBLE_API_KEY'], value).toBe(value);
    }
  });

  it('leaves the file readable by its owner only, whatever it was', () => {
    put('X=1\n');
    chmodSync(join(root, '.env'), 0o644);
    setDotEnv(root, { ADMINIUM_AI_MODEL: 'ollama/qwen3' }, AI_ENV_NAMES);
    expect(statSync(join(root, '.env')).mode & 0o777).toBe(0o600);
  });
});

// ── the environment ──────────────────────────────────────────────────────────

describe('the model variables of a project', () => {
  it('are never copied into the environment with the rest of .env', () => {
    put('DATABASE_URL=sqlite:./a.db\nADMINIUM_AI_ANTHROPIC_API_KEY=sk-ant-1\nADMINIUM_AI_MODEL=anthropic/x\n');
    const env: Record<string, string | undefined> = {};
    const filled = loadDotEnv(root, env);
    expect(filled).toEqual(['DATABASE_URL']);
    expect(Object.keys(env)).toEqual(['DATABASE_URL']);
  });

  it('are read from the file on every look, the operator’s own values first', () => {
    put('ADMINIUM_AI_ANTHROPIC_API_KEY=from-file\nADMINIUM_AI_MODEL=anthropic/x\n');
    const aiEnv = createAiEnv({ root, fromEnvironment: { ADMINIUM_AI_ANTHROPIC_API_KEY: 'from-operator', ADMINIUM_AI_OLLAMA_BASE_URL: '' } });
    expect(aiEnv.read()).toEqual({ ADMINIUM_AI_ANTHROPIC_API_KEY: 'from-operator', ADMINIUM_AI_MODEL: 'anthropic/x' });
    expect(aiEnv.shadowed()).toEqual(['ADMINIUM_AI_ANTHROPIC_API_KEY']);
    expect(aiEnv.fromOperator()).toEqual(['ADMINIUM_AI_ANTHROPIC_API_KEY']);

    aiEnv.write({ ADMINIUM_AI_MODEL: 'anthropic/y' });
    expect(aiEnv.read().ADMINIUM_AI_MODEL).toBe('anthropic/y');
  });

  it('are nothing, and cannot be written, with no project', () => {
    const aiEnv = createAiEnv({ root: null, fromEnvironment: {} });
    expect(aiEnv.read()).toEqual({});
    expect(aiEnv.writable).toBe(false);
    expect(() => {
      aiEnv.write({ ADMINIUM_AI_MODEL: 'a/b' });
    }).toThrow('no project folder');
  });
});

describe('the selected model', () => {
  it('is a provider and a model, and a model may have slashes of its own', () => {
    expect(parseSelected('anthropic/claude-sonnet-5-5')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
    expect(parseSelected('openai-compatible/meta/llama-3.3')).toEqual({ provider: 'openai-compatible', model: 'meta/llama-3.3' });
    expect(parseSelected('claude')).toBeNull();
    expect(parseSelected('azure/gpt')).toBeNull();
    expect(parseSelected('ollama/')).toBeNull();
    expect(parseSelected(undefined)).toBeNull();
  });
});

// ── addresses ────────────────────────────────────────────────────────────────

describe('where an address really points', () => {
  it('tells the kinds apart, mapped and bracketed forms included', () => {
    expect(addressKind('169.254.169.254')).toBe('metadata');
    expect(addressKind('::ffff:169.254.169.254')).toBe('metadata');
    expect(addressKind('::ffff:a9fe:a9fe')).toBe('metadata');
    expect(addressKind('fe80::1')).toBe('metadata');
    expect(addressKind('127.0.0.1')).toBe('loopback');
    expect(addressKind('[::1]')).toBe('loopback');
    expect(addressKind('10.1.2.3')).toBe('private');
    expect(addressKind('172.20.0.1')).toBe('private');
    expect(addressKind('192.168.1.10')).toBe('private');
    expect(addressKind('::ffff:192.168.1.10')).toBe('private');
    expect(addressKind('fd12::1')).toBe('private');
    expect(addressKind('8.8.8.8')).toBe('public');
    expect(addressKind('172.32.0.1')).toBe('public');
  });

  it('refuses a public-looking name that resolves to the metadata address', async () => {
    await expect(resolveAndCheck('https://models.example/v1', { resolve: async () => ['93.184.216.34', '169.254.169.254'] })).rejects.toThrow('blocked range');
    await expect(resolveAndCheck('https://models.example/v1', { resolve: async () => ['93.184.216.34'] })).resolves.toBeUndefined();
  });

  it('refuses the server’s own network only where it is asked to', async () => {
    const inside = { resolve: async () => ['10.0.0.5'] };
    await expect(resolveAndCheck('http://box.internal:8000/v1', inside)).resolves.toBeUndefined();
    await expect(resolveAndCheck('http://box.internal:8000/v1', { ...inside, blockPrivate: true })).rejects.toThrow('own network');
    await expect(resolveAndCheck('http://127.0.0.1:8000/v1', { blockPrivate: true })).rejects.toThrow('own network');
  });

  it('lets a name that does not resolve through: the call fails on its own', async () => {
    await expect(
      resolveAndCheck('https://nowhere.invalid/v1', {
        resolve: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    ).resolves.toBeUndefined();
  });
});

// ── the resolver ─────────────────────────────────────────────────────────────

describe('the model connections', () => {
  let meta: MetaDb;
  let built: ProviderConfig[];
  const keyCrypto = llmKeyCryptoFromSecret(TEST_SECRET, { deriveKey, encryptSecret, decryptSecret });

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    built = [];
  });
  afterEach(async () => {
    await meta.db.destroy();
  });

  const fakeClient = (config: ProviderConfig): ProviderClient => {
    built.push(config);
    return {
      id: config.provider,
      listModels: async () => [{ id: 'm1', label: 'M1' }],
      complete: async () => ({ text: '{}' }),
      test: async () => ({ ok: true, model: 'm1', latencyMs: 1 }),
    };
  };
  /** A model that passes the build check: it calls the tool, then answers. */
  const fakeRunner = (config: ProviderConfig): ProviderRunner => {
    built.push(config);
    let calls = 0;
    return {
      id: config.provider,
      async run(): Promise<RunResult> {
        calls += 1;
        return calls === 1
          ? { blocks: [{ type: 'tool_call', id: 'c1', name: 'echo', input: { word: 'adminium' } }], stop: 'tool_calls', malformed: [] }
          : { blocks: [{ type: 'text', text: 'done' }], stop: 'end', malformed: [] };
      },
    };
  };

  const connections = (aiEnv: AiEnv, over: Partial<Parameters<typeof createAiConnections>[0]> = {}): AiConnections =>
    createAiConnections({
      settings: settingsRepo(meta),
      keyCrypto,
      aiEnv,
      networkFeatures: true,
      production: false,
      createClient: fakeClient,
      createRunner: fakeRunner,
      resolve: async () => ['93.184.216.34'],
      ...over,
    });
  const envOf = (values: Record<string, string>): AiEnv => createAiEnv({ root: null, fromEnvironment: values });

  it('lists what the environment names, one per provider, and never a key', async () => {
    const all = connections(
      envOf({
        ADMINIUM_AI_ANTHROPIC_API_KEY: 'sk-ant-1',
        ADMINIUM_AI_COMPATIBLE_BASE_URL: 'http://box.test:8000/v1',
        ADMINIUM_AI_OLLAMA_BASE_URL: 'http://localhost:11434',
        ADMINIUM_AI_MODEL: 'anthropic/claude-x',
      }),
    );
    const list = await all.list();
    expect(list).toEqual([
      { id: 'env:anthropic', provider: 'anthropic', source: 'environment', baseUrl: null, hasKey: true, model: 'claude-x' },
      { id: 'env:openai-compatible', provider: 'openai-compatible', source: 'environment', baseUrl: 'http://box.test:8000/v1', hasKey: false, model: null },
      { id: 'env:ollama', provider: 'ollama', source: 'environment', baseUrl: 'http://localhost:11434', hasKey: false, model: null },
    ]);
    expect(JSON.stringify(list)).not.toContain('sk-ant-1');
  });

  it('uses the saved setting when there is one, and the environment’s selected model when there is none', async () => {
    const all = connections(envOf({ ADMINIUM_AI_ANTHROPIC_API_KEY: 'sk-ant-1', ADMINIUM_AI_MODEL: 'anthropic/claude-x' }));
    expect(await all.default()).toMatchObject({ connection: { id: 'env:anthropic' }, model: 'claude-x' });

    const settings = settingsRepo(meta);
    await settings.set('llm.provider', 'openai');
    await settings.set('llm.model', 'gpt-x');
    await settings.set('llm.apiKey', keyCrypto.encrypt('sk-saved'));
    expect(await all.default()).toMatchObject({ connection: { id: 'database', provider: 'openai', hasKey: true }, model: 'gpt-x' });
    expect((await all.list()).map((connection) => connection.id)).toEqual(['database', 'env:anthropic']);

    // The saved key is decrypted where the client is built, and only there.
    await all.client('database');
    expect(built.at(-1)).toMatchObject({ provider: 'openai', model: 'gpt-x', apiKey: 'sk-saved' });
  });

  it('has nothing to use when the environment selects a provider it has no key for', async () => {
    const all = connections(envOf({ ADMINIUM_AI_MODEL: 'openai/gpt-x' }));
    expect(await all.default()).toBeNull();
    expect(all.refusal(null)).toBe('no-provider');
    await expect(all.client('env:openai')).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });

  it('picks the connection of the provider a run was made for', async () => {
    const all = connections(envOf({ ADMINIUM_AI_ANTHROPIC_API_KEY: 'sk-ant-1', ADMINIUM_AI_MODEL: 'anthropic/claude-x' }));
    const resolved = await all.clientForProvider('anthropic', 'claude-y');
    expect(resolved).toMatchObject({ provider: 'anthropic', model: 'claude-y' });
    expect(built.at(-1)).toMatchObject({ provider: 'anthropic', apiKey: 'sk-ant-1', model: 'claude-y' });
  });

  it('calls only a local model when network features are off, on every path', async () => {
    const all = connections(
      envOf({ ADMINIUM_AI_ANTHROPIC_API_KEY: 'sk-ant-1', ADMINIUM_AI_OLLAMA_BASE_URL: 'http://localhost:11434', ADMINIUM_AI_MODEL: 'anthropic/claude-x' }),
      { networkFeatures: false },
    );
    expect(all.refusal((await all.default())?.connection ?? null)).toBe('network-disabled');
    await expect(all.client('env:anthropic')).rejects.toMatchObject({ code: 'config' });
    await expect(all.runner('env:anthropic', 'claude-x')).rejects.toBeInstanceOf(ProviderError);
    await expect(all.clientForProvider('anthropic')).rejects.toBeInstanceOf(ProviderError);
    await expect(all.runner('env:ollama', 'qwen3')).resolves.toMatchObject({ provider: 'ollama', model: 'qwen3' });
  });

  it('checks the address before any client is built, for a saved connection and for the environment’s', async () => {
    const settings = settingsRepo(meta);
    await settings.set('llm.provider', 'openai-compatible');
    await settings.set('llm.baseUrl', 'http://169.254.169.254/v1');
    const all = connections(envOf({ ADMINIUM_AI_COMPATIBLE_BASE_URL: 'https://models.example/v1' }), { resolve: async () => ['169.254.169.254'] });
    await expect(all.client('database')).rejects.toThrow('blocked');
    await expect(all.runner('env:openai-compatible', 'm')).rejects.toThrow('blocked range');
    expect(built).toEqual([]);
  });

  it('refuses a saved loopback address in production, and lets the operator’s own through', async () => {
    const settings = settingsRepo(meta);
    await settings.set('llm.provider', 'openai-compatible');
    await settings.set('llm.baseUrl', 'http://127.0.0.1:8000/v1');
    const all = connections(envOf({ ADMINIUM_AI_COMPATIBLE_BASE_URL: 'http://127.0.0.1:8000/v1' }), { production: true });
    await expect(all.client('database')).rejects.toThrow('Loopback');
    await expect(all.client('env:openai-compatible')).resolves.toMatchObject({ provider: 'openai-compatible' });
  });

  it('tests a draft: lists models, then checks the named one can build, without saving anything', async () => {
    put('ADMINIUM_SECRET=abc\n');
    const all = connections(createAiEnv({ root, fromEnvironment: {} }));
    expect(await all.test({ provider: 'anthropic', apiKey: 'sk-ant-typed' })).toEqual({ ok: true, models: [{ id: 'm1', label: 'M1' }], canBuild: null, error: null });
    const tested = await all.test({ provider: 'anthropic', apiKey: 'sk-ant-typed', model: 'm1' });
    expect(tested).toMatchObject({ ok: true, canBuild: { canBuild: true, reportsUsage: false } });
    expect(all.verdict('env:anthropic', 'm1')).toEqual({ canBuild: true, reportsUsage: false });
    expect(envFile()).toBe('ADMINIUM_SECRET=abc\n');
  });

  it('tests against the saved key when the form leaves the key out', async () => {
    put('ADMINIUM_AI_ANTHROPIC_API_KEY=sk-ant-saved\n');
    const all = connections(createAiEnv({ root, fromEnvironment: {} }));
    await all.test({ provider: 'anthropic' });
    expect(built.at(-1)).toMatchObject({ apiKey: 'sk-ant-saved' });
  });

  it('reports a refused key as a failed test, not as a crash', async () => {
    const all = connections(createAiEnv({ root, fromEnvironment: {} }), {
      createClient: () => ({
        id: 'anthropic',
        listModels: async () => {
          throw new ProviderError({ provider: 'anthropic', code: 'auth', status: 401, message: 'anthropic: HTTP 401' });
        },
        complete: async () => ({ text: '' }),
        test: async () => ({ ok: true, model: '', latencyMs: 0 }),
      }),
    });
    expect(await all.test({ provider: 'anthropic', apiKey: 'bad' })).toEqual({ ok: false, models: [], canBuild: null, error: { code: 'auth', message: 'anthropic: HTTP 401' } });
  });

  it('saves a model to the project’s .env and uses it at once', async () => {
    put('ADMINIUM_SECRET=abc\n');
    const all = connections(createAiEnv({ root, fromEnvironment: {} }));
    const saved = await all.save({ provider: 'anthropic', apiKey: 'sk-ant-new', model: 'claude-x' });
    expect(saved).toEqual({ id: 'env:anthropic', provider: 'anthropic', source: 'environment', baseUrl: null, hasKey: true, model: 'claude-x' });
    expect(envFile()).toBe('ADMINIUM_SECRET=abc\n\nADMINIUM_AI_MODEL=anthropic/claude-x\nADMINIUM_AI_ANTHROPIC_API_KEY=sk-ant-new\n');
    expect(await all.default()).toMatchObject({ connection: { id: 'env:anthropic' }, model: 'claude-x' });

    // Changing only the model keeps the key that is there.
    await all.save({ provider: 'anthropic', model: 'claude-y' });
    expect(readDotEnv(root)).toMatchObject({ ADMINIUM_AI_ANTHROPIC_API_KEY: 'sk-ant-new', ADMINIUM_AI_MODEL: 'anthropic/claude-y' });
  });

  it('refuses to save a provider with no key or address to reach it by', async () => {
    put('');
    const all = connections(createAiEnv({ root, fromEnvironment: {} }));
    await expect(all.save({ provider: 'openai', model: 'gpt-x' })).rejects.toThrow('needs its key or its address');
  });

  it('refuses to save over a value the operator’s environment sets, and with no project at all', async () => {
    put('');
    const shadowed = connections(createAiEnv({ root, fromEnvironment: { ADMINIUM_AI_MODEL: 'ollama/qwen3' } }));
    await expect(shadowed.save({ provider: 'anthropic', apiKey: 'k', model: 'm' })).rejects.toMatchObject({ details: { reason: 'ENV_SHADOWED' } });
    expect(envFile()).toBe('');

    const nowhere = connections(envOf({}));
    await expect(nowhere.save({ provider: 'anthropic', apiKey: 'k', model: 'm' })).rejects.toMatchObject({ details: { reason: 'ENV_NOT_WRITABLE' } });
  });
});
