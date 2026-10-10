// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Keys a host keeps (the desktop app): the one reader of model values asks the
 * host and nothing else, a save goes back to the host, and no key is ever in
 * the environment a project's hooks and build lines can read.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAiEnv } from '../src/llm/ai-env.js';
import { HOST_KEPT_NAMES, hostModels, setHostModels, stopHostModels, useHostModels } from '../src/llm/host-models.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-host-models-'));
});
afterEach(() => {
  stopHostModels();
  rmSync(root, { recursive: true, force: true });
});

const KEY = 'sk-ant-host-kept-0123456789';

describe('with no host (a terminal, a server)', () => {
  it('nothing changes: the environment and the project’s .env are read, and a save goes to the file', () => {
    writeFileSync(join(root, '.env'), 'ADMINIUM_AI_MODEL=ollama/llama3\n');
    const env = createAiEnv({ root, fromEnvironment: { ADMINIUM_AI_OLLAMA_BASE_URL: 'http://127.0.0.1:11434' } });
    expect(env.read()).toEqual({ ADMINIUM_AI_MODEL: 'ollama/llama3', ADMINIUM_AI_OLLAMA_BASE_URL: 'http://127.0.0.1:11434' });
    expect(env.keptBy()).toBeNull();
    expect(env.ignored()).toEqual([]);
    expect(hostModels()).toBeNull();
    // A host's word with no host on is dropped.
    setHostModels({ ADMINIUM_AI_ANTHROPIC_API_KEY: KEY });
    expect(env.read()).not.toHaveProperty('ADMINIUM_AI_ANTHROPIC_API_KEY');
    env.write({ ADMINIUM_AI_ANTHROPIC_API_KEY: KEY });
    expect(readFileSync(join(root, '.env'), 'utf8')).toContain(KEY);
  });
});

describe('with a host that keeps the keys', () => {
  it('the host’s values are the only ones: the project’s .env and the environment decide nothing, addresses included', () => {
    // A folder from someone else: it names its own address, and a model.
    writeFileSync(join(root, '.env'), 'ADMINIUM_AI_COMPATIBLE_BASE_URL=https://evil.example/v1\nADMINIUM_AI_MODEL=compatible/x\n');
    const env = createAiEnv({ root, fromEnvironment: { ADMINIUM_AI_OPENAI_API_KEY: 'from-the-shell' } });
    useHostModels({ keep: vi.fn() });
    // Before the host's first word there is nothing.
    expect(env.read()).toEqual({});
    setHostModels({ ADMINIUM_AI_ANTHROPIC_API_KEY: KEY, ADMINIUM_AI_MODEL: 'anthropic/claude', PEXELS_API_KEY: 'px', NODE_OPTIONS: '--evil', ADMINIUM_AI_OPENAI_API_KEY: '  ' }, 'plain');
    expect(env.read()).toEqual({ ADMINIUM_AI_ANTHROPIC_API_KEY: KEY, ADMINIUM_AI_MODEL: 'anthropic/claude' });
    expect(env.shadowed()).toEqual([]);
    expect(env.fromOperator()).toEqual([]);
    expect(env.keptBy()).toBe('plain');
    // What the file names is said, so the page can say it is not used.
    expect(env.ignored().sort()).toEqual(['ADMINIUM_AI_COMPATIBLE_BASE_URL', 'ADMINIUM_AI_MODEL']);
    // Only the names a host keeps are held; the picture keys are held for their own reader.
    expect(hostModels()?.read()).toEqual({ ADMINIUM_AI_ANTHROPIC_API_KEY: KEY, ADMINIUM_AI_MODEL: 'anthropic/claude', PEXELS_API_KEY: 'px' });
    expect(HOST_KEPT_NAMES).toHaveLength(8);
  });

  it('a save goes to the host, is readable at once, and never touches the project’s .env; null takes a name away', () => {
    writeFileSync(join(root, '.env'), 'DATABASE_URL=sqlite:./data/app.sqlite\n');
    const keep = vi.fn();
    useHostModels({ keep });
    const env = createAiEnv({ root, fromEnvironment: {} });
    expect(env.writable).toBe(true);
    env.write({ ADMINIUM_AI_ANTHROPIC_API_KEY: KEY, ADMINIUM_AI_MODEL: 'anthropic/claude' });
    expect(keep).toHaveBeenCalledWith({ ADMINIUM_AI_ANTHROPIC_API_KEY: KEY, ADMINIUM_AI_MODEL: 'anthropic/claude' });
    expect(env.read()).toEqual({ ADMINIUM_AI_ANTHROPIC_API_KEY: KEY, ADMINIUM_AI_MODEL: 'anthropic/claude' });
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('DATABASE_URL=sqlite:./data/app.sqlite\n');
    env.write({ ADMINIUM_AI_ANTHROPIC_API_KEY: null });
    expect(env.read()).toEqual({ ADMINIUM_AI_MODEL: 'anthropic/claude' });
    // And with no project folder at all there is still somewhere to keep a model.
    expect(createAiEnv({ root: null, fromEnvironment: {} }).writable).toBe(true);
  });

  it('a key the host gave is in nobody’s environment: not this process’s, so not a hook’s and not a build line’s', () => {
    useHostModels({ keep: vi.fn() });
    setHostModels({ ADMINIUM_AI_ANTHROPIC_API_KEY: KEY, PEXELS_API_KEY: 'px-secret' });
    expect(JSON.stringify(process.env)).not.toContain(KEY);
    expect(JSON.stringify(process.env)).not.toContain('px-secret');
    for (const name of HOST_KEPT_NAMES) expect(process.env[name] ?? '').not.toBe(KEY);
  });
});
