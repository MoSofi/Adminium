// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SafeStorageLike } from './config.js';
import { createModelsStore, modelsFileFor } from './models.js';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adminium-models-'));
  file = modelsFileFor(join(dir, 'app'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A key store that "encrypts" in a way a test can see through, and only for this user. */
const keyStore = (over: Partial<SafeStorageLike> = {}): SafeStorageLike => ({
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`sealed:${plain.split('').reverse().join('')}`),
  decryptString: (sealed) => {
    const text = sealed.toString();
    if (!text.startsWith('sealed:')) throw new Error('not this user’s');
    return text.slice('sealed:'.length).split('').reverse().join('');
  },
  ...over,
});
const KEY = 'sk-ant-api03-0123456789';

describe('the model keys the app keeps', () => {
  it('start empty, in a file beside the app’s own and not inside it', () => {
    expect(file).toBe(join(dir, 'app', 'models.json'));
    expect(createModelsStore({ file, keyStore: keyStore() }).read()).toEqual({ values: {}, keeping: 'key-store' });
    expect(existsSync(file)).toBe(false);
  });

  it('are written encrypted by the system’s key store, readable by the owner only, and read back', () => {
    const store = createModelsStore({ file, keyStore: keyStore() });
    expect(store.keep({ ADMINIUM_AI_ANTHROPIC_API_KEY: KEY, ADMINIUM_AI_MODEL: 'anthropic/claude' })).toEqual({ values: { ADMINIUM_AI_ANTHROPIC_API_KEY: KEY, ADMINIUM_AI_MODEL: 'anthropic/claude' }, keeping: 'key-store' });
    const onDisk = readFileSync(file, 'utf8');
    expect(onDisk).not.toContain(KEY);
    expect(JSON.parse(onDisk)).toMatchObject({ version: 1, storage: 'key-store' });
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o077).toBe(0);
    // Another launch.
    expect(createModelsStore({ file, keyStore: keyStore() }).read().values).toEqual({ ADMINIUM_AI_ANTHROPIC_API_KEY: KEY, ADMINIUM_AI_MODEL: 'anthropic/claude' });
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it('a later save changes only what it names; null or an empty value takes a name away', () => {
    const store = createModelsStore({ file, keyStore: keyStore() });
    store.keep({ ADMINIUM_AI_ANTHROPIC_API_KEY: KEY, ADMINIUM_AI_MODEL: 'anthropic/claude', PEXELS_API_KEY: 'px' });
    expect(store.keep({ ADMINIUM_AI_MODEL: 'ollama/llama3', ADMINIUM_AI_ANTHROPIC_API_KEY: null, PEXELS_API_KEY: '  ' }).values).toEqual({ ADMINIUM_AI_MODEL: 'ollama/llama3' });
    expect(store.read().values).toEqual({ ADMINIUM_AI_MODEL: 'ollama/llama3' });
  });

  it('where the system has no key store they are kept as they are, and the file says so', () => {
    const none = keyStore({ isEncryptionAvailable: () => false });
    const store = createModelsStore({ file, keyStore: none });
    expect(store.keep({ ADMINIUM_AI_OPENAI_API_KEY: KEY })).toEqual({ values: { ADMINIUM_AI_OPENAI_API_KEY: KEY }, keeping: 'plain' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, storage: 'plain', values: { ADMINIUM_AI_OPENAI_API_KEY: KEY } });
    expect(store.read()).toEqual({ values: { ADMINIUM_AI_OPENAI_API_KEY: KEY }, keeping: 'plain' });
    // A key store that fails to answer is no key store.
    expect(createModelsStore({ file, keyStore: keyStore({ isEncryptionAvailable: () => { throw new Error('no keyring'); } }) }).read().keeping).toBe('plain');
    // The store came later: the next save seals what was plain.
    const later = createModelsStore({ file, keyStore: keyStore() });
    later.keep({ ADMINIUM_AI_MODEL: 'openai/gpt' });
    expect(readFileSync(file, 'utf8')).not.toContain(KEY);
    expect(later.read().values).toEqual({ ADMINIUM_AI_OPENAI_API_KEY: KEY, ADMINIUM_AI_MODEL: 'openai/gpt' });
  });

  it('a value this computer cannot read is asked for again, the others are kept, and it is said in the log', () => {
    const log = vi.fn();
    createModelsStore({ file, keyStore: keyStore() }).keep({ ADMINIUM_AI_MODEL: 'anthropic/claude' });
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { values: Record<string, string> };
    parsed.values['ADMINIUM_AI_ANTHROPIC_API_KEY'] = Buffer.from('written by someone else').toString('base64');
    writeFileSync(file, JSON.stringify(parsed));
    expect(createModelsStore({ file, keyStore: keyStore(), log }).read().values).toEqual({ ADMINIUM_AI_MODEL: 'anthropic/claude' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ADMINIUM_AI_ANTHROPIC_API_KEY'));
    expect(String(log.mock.calls[0]?.[0])).not.toContain('written by someone else');
  });

  it('a file that does not read keeps nothing and is left where it is; a name that is not one of the eight is not kept', () => {
    const store = createModelsStore({ file, keyStore: keyStore() });
    store.keep({ ADMINIUM_AI_MODEL: 'a/b', ...({ NODE_OPTIONS: '--evil' } as object) });
    expect(readFileSync(file, 'utf8')).not.toContain('NODE_OPTIONS');
    writeFileSync(file, '{ broken');
    expect(store.read().values).toEqual({});
    expect(readFileSync(file, 'utf8')).toBe('{ broken');
    writeFileSync(file, JSON.stringify({ version: 2, storage: 'plain', values: {} }));
    expect(store.read().values).toEqual({});
  });
});
