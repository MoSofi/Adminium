// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium try` makes and keeps its own secret (V21): the quickstart's
 * `npx @adminiumjs/adminium try` stopped at once without ADMINIUM_SECRET.
 */
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { keepNewSecret, prepareTrySecret, readKeptSecret } from '../src/cli/kept-secret.js';
import { loadCliEnv } from '../src/cli/runtime.js';

const folder = () => mkdtemp(join(tmpdir(), 'adminium-kept-'));

describe('the kept secret', () => {
  it('is made once, owner-only, and never written over', async () => {
    const dir = await folder();
    expect(readKeptSecret(dir)).toBeNull();
    const made = keepNewSecret(dir);
    expect(made).toMatch(/^[0-9a-f]{64}$/);
    expect(readKeptSecret(dir)).toBe(made);
    if (process.platform !== 'win32') expect((await stat(join(dir, 'secret'))).mode & 0o777).toBe(0o600);
    expect(keepNewSecret(dir)).toBe(made);
  });

  it('ignores a file too short to be a secret', async () => {
    const dir = await folder();
    await writeFile(join(dir, 'secret'), 'short\n');
    expect(readKeptSecret(dir)).toBeNull();
  });
});

describe('prepareTrySecret', () => {
  it('makes one for a new folder, and says where', async () => {
    const dir = await folder();
    expect(prepareTrySecret({}, dir)).toEqual({ madeIn: dir });
    expect(readKeptSecret(dir)).not.toBeNull();
  });

  it('does nothing when the environment gives one, or one is already kept', async () => {
    const given = await folder();
    expect(prepareTrySecret({ ADMINIUM_SECRET: 'x'.repeat(32) }, given)).toEqual({ madeIn: null });
    await expect(readFile(join(given, 'secret'))).rejects.toThrow();

    const kept = await folder();
    const first = keepNewSecret(kept);
    expect(prepareTrySecret({}, kept)).toEqual({ madeIn: null });
    expect(readKeptSecret(kept)).toBe(first);
  });

  it('never makes one over an instance that was made with another', async () => {
    const dir = await folder();
    await writeFile(join(dir, 'meta.db'), '');
    expect(() => prepareTrySecret({}, dir)).toThrow(/holds an Adminium instance/);
    expect(readKeptSecret(dir)).toBeNull();
  });
});

describe('loadCliEnv reads the kept secret', () => {
  it('uses the one kept in the data folder when none is given', async () => {
    const dir = await folder();
    const kept = keepNewSecret(dir);
    expect(loadCliEnv({ ADMINIUM_DATA_DIR: dir }).ADMINIUM_SECRET).toBe(kept);
    expect(loadCliEnv({}, { dataDir: dir }).ADMINIUM_SECRET).toBe(kept);
  });

  it('lets the environment win over the file', async () => {
    const dir = await folder();
    keepNewSecret(dir);
    const given = 'y'.repeat(32);
    expect(loadCliEnv({ ADMINIUM_DATA_DIR: dir, ADMINIUM_SECRET: given }).ADMINIUM_SECRET).toBe(given);
  });
});
