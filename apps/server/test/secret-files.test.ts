// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The operator's secrets given as files: `<NAME>_FILE=/path` (`config/operator-secrets.ts`).
 *
 * Taking a secret out of `process.env` does not take it out of the environment the process STARTED with, which the
 * operating system keeps readable to code running as the same user (`/proc/<pid>/environ`, `ps eww`). A secret read
 * from a file was never in any environment. These tests hold the loader to reading it exactly as if it had been set
 * in `<NAME>`, refusing every way the file can be wrong, leaving neither the path nor the value in `process.env` or
 * any child's environment, and (end to end) to a process started with only the file variable having no trace of the
 * value in its start-up environment.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadCliEnv } from '../src/cli/runtime.js';
import { childEnvironment } from '../src/config/child-env.js';
import { EnvValidationError, loadEnv } from '../src/config/env.js';
import { holdOperatorSecrets, operatorSecret, readSecretFiles, SECRET_FILE_MAX_BYTES } from '../src/config/operator-secrets.js';

const SECRET = 'f'.repeat(64);
const AI_KEY = 'sk-ant-from-a-secret-file';
const quiet = { write: () => true };

let dir: string;
let saved: NodeJS.ProcessEnv;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adminium-secret-files-'));
  saved = { ...process.env };
});
afterEach(() => {
  for (const name of Object.keys(process.env)) if (!(name in saved)) Reflect.deleteProperty(process.env, name);
  Object.assign(process.env, saved);
  // Forget what a test held, so the next one starts clean.
  for (const name of ['ADMINIUM_SECRET', 'ADMINIUM_AI_ANTHROPIC_API_KEY', 'ADMINIUM_SETUP_TOKEN']) {
    process.env[name] = '';
    holdOperatorSecrets();
  }
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string, content: string | Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

describe('reading a secret from a file', () => {
  it('reads the value as if it were set in the variable, one trailing newline taken off', () => {
    const read = readSecretFiles({ ADMINIUM_SECRET_FILE: file('secret', `${SECRET}\n`), ADMINIUM_AI_ANTHROPIC_API_KEY_FILE: file('ai', `${AI_KEY}\r\n`), OTHER: 'x' });
    expect(read.problems).toEqual([]);
    expect(read.env).toEqual({ ADMINIUM_SECRET: SECRET, ADMINIUM_AI_ANTHROPIC_API_KEY: AI_KEY, OTHER: 'x' });
    // Only one newline: a value that ends in a blank line keeps the rest.
    expect(readSecretFiles({ ADMINIUM_SETUP_TOKEN_FILE: file('token', 'abc\n\n') }).env.ADMINIUM_SETUP_TOKEN).toBe('abc\n');
    // A variable that is not an operator secret's file is left alone.
    expect(readSecretFiles({ SHOP_FILE: '/nowhere', ADMINIUM_DATA_DIR_FILE: '/nowhere' }).env).toEqual({ SHOP_FILE: '/nowhere', ADMINIUM_DATA_DIR_FILE: '/nowhere' });
  });

  it('refuses both ways at once, and a file that is missing, empty, a folder or too large', () => {
    const big = file('big', Buffer.alloc(SECRET_FILE_MAX_BYTES + 1, 'a'));
    const { env, problems } = readSecretFiles({
      ADMINIUM_SECRET: SECRET,
      ADMINIUM_SECRET_FILE: file('secret', SECRET),
      ADMINIUM_SETUP_TOKEN_FILE: join(dir, 'missing'),
      ADMINIUM_ARCHIVE_KEY_FILE: file('empty', '\n'),
      ADMINIUM_FIGMA_TOKEN_FILE: dir,
      PEXELS_API_KEY_FILE: big,
    });
    expect(problems.map((problem) => problem.variable)).toEqual([
      'ADMINIUM_SECRET_FILE',
      'ADMINIUM_SETUP_TOKEN_FILE',
      'ADMINIUM_ARCHIVE_KEY_FILE',
      'ADMINIUM_FIGMA_TOKEN_FILE',
      'PEXELS_API_KEY_FILE',
    ]);
    expect(problems.map((problem) => problem.problem)).toEqual([
      'ADMINIUM_SECRET is set as well: give the secret one way, the value or the file',
      `${join(dir, 'missing')} does not exist`,
      `${join(dir, 'empty')} is empty`,
      `${dir} is not a file`,
      `${big} is larger than 64 KiB; a secret file holds the value alone`,
    ]);
    // Nothing is filled in from a file that was refused.
    expect(env).toEqual({ ADMINIUM_SECRET: SECRET });
  });

  it('stops the boot with a row naming the file variable, through both loaders', () => {
    const missing = join(dir, 'missing');
    expect(() => loadEnv({ ADMINIUM_SECRET_FILE: missing }, quiet)).toThrow(EnvValidationError);
    try {
      loadEnv({ ADMINIUM_SECRET_FILE: missing }, quiet);
    } catch (error) {
      const table = (error as EnvValidationError).table;
      expect(table).toContain(`| ADMINIUM_SECRET_FILE | ${missing} does not exist`);
      // Not a second row calling the secret missing: its file is the problem.
      expect(table).not.toMatch(/\| ADMINIUM_SECRET +\|/);
    }
    expect(() => loadCliEnv({ ADMINIUM_DATA_DIR: dir, ADMINIUM_SECRET: SECRET, ADMINIUM_SECRET_FILE: file('secret', SECRET) })).toThrow(
      expect.objectContaining({ hint: expect.stringContaining('ADMINIUM_SECRET is set as well') }) as Error,
    );
    expect(loadEnv({ ADMINIUM_SECRET_FILE: file('secret', `${SECRET}\n`) }, quiet).ADMINIUM_SECRET).toBe(SECRET);
    expect(loadCliEnv({ ADMINIUM_DATA_DIR: dir, ADMINIUM_SECRET_FILE: file('secret', SECRET) }).ADMINIUM_SECRET).toBe(SECRET);
  });
});

describe('after the boot', () => {
  it('neither the path nor the value is in process.env, the boot and the late readers have the value, and no child sees either', () => {
    process.env.ADMINIUM_SECRET_FILE = file('secret', `${SECRET}\n`);
    process.env.ADMINIUM_AI_ANTHROPIC_API_KEY_FILE = file('ai', AI_KEY);
    Reflect.deleteProperty(process.env, 'ADMINIUM_SECRET');
    Reflect.deleteProperty(process.env, 'ADMINIUM_AI_ANTHROPIC_API_KEY');
    const env = loadCliEnv(process.env, { dataDir: dir });
    expect(env.ADMINIUM_SECRET).toBe(SECRET);
    // What every boot does next (`buildServer`, `composeServer`, a project's config about to load).
    holdOperatorSecrets();
    for (const name of ['ADMINIUM_SECRET', 'ADMINIUM_SECRET_FILE', 'ADMINIUM_AI_ANTHROPIC_API_KEY', 'ADMINIUM_AI_ANTHROPIC_API_KEY_FILE']) {
      expect(process.env[name], name).toBeUndefined();
    }
    expect(operatorSecret('ADMINIUM_AI_ANTHROPIC_API_KEY')).toBe(AI_KEY);
    expect(operatorSecret('ADMINIUM_SECRET')).toBe(SECRET);
    // A second boot in this process reads it as the first did.
    expect(loadCliEnv(process.env, { dataDir: dir }).ADMINIUM_SECRET).toBe(SECRET);

    // A child is given neither, whether it is read from the environment or a caller passes it.
    const given = childEnvironment('packages', { ADMINIUM_SECRET_FILE: join(dir, 'secret') }, { ...process.env, ADMINIUM_SECRET_FILE: join(dir, 'secret'), PATH: process.env.PATH });
    expect(Object.keys(given).filter((name) => name.startsWith('ADMINIUM_'))).toEqual([]);
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], { env: given, encoding: 'utf8' });
    const seen = JSON.parse(child.stdout) as Record<string, string>;
    expect(Object.keys(seen).filter((name) => name.startsWith('ADMINIUM_'))).toEqual([]);
    expect(child.stdout).not.toContain(SECRET);
    expect(child.stdout).not.toContain(join(dir, 'secret'));
  });
});

/** The start-up environment of process `pid`, as the operating system shows it to the same user. */
function startUpEnvironment(pid: number): string {
  if (process.platform === 'linux') return readFileSync(`/proc/${String(pid)}/environ`, 'utf8').replaceAll('\0', '\n');
  return spawnSync('/bin/ps', ['eww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', env: { PATH: '/bin:/usr/bin' } }).stdout;
}

describe.runIf(process.platform === 'darwin' || process.platform === 'linux')('a process started with only the file variable', () => {
  it('has the value to use, and none of it in its start-up environment', { timeout: 30_000 }, async () => {
    // The module the server reads secrets with, as plain JavaScript a separate node process can run.
    const source = readFileSync(new URL('../src/config/operator-secrets.ts', import.meta.url), 'utf8');
    const module = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    writeFileSync(join(dir, 'operator-secrets.mjs'), module);
    writeFileSync(
      join(dir, 'boot.mjs'),
      [
        "import { holdOperatorSecrets, operatorSecret, readSecretFiles } from './operator-secrets.mjs';",
        'const read = readSecretFiles(process.env);',
        'holdOperatorSecrets();',
        "process.stdout.write(JSON.stringify({ length: (read.env.ADMINIUM_SECRET ?? '').length, held: (operatorSecret('ADMINIUM_SECRET') ?? '').length, left: Object.keys(process.env).filter((name) => name.startsWith('ADMINIUM_')) }) + '\\n');",
        "process.stdin.on('data', () => process.exit(0));",
      ].join('\n'),
    );
    const secretFile = file('secret', `${SECRET}\n`);

    const boot = async (env: Record<string, string>): Promise<{ said: { length: number; held: number; left: string[] }; environment: string }> => {
      const child = spawn(process.execPath, [join(dir, 'boot.mjs')], { env: { PATH: process.env.PATH ?? '', ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
      try {
        const line = await new Promise<string>((resolve, reject) => {
          let out = '';
          child.stdout.on('data', (chunk: Buffer) => {
            out += chunk.toString('utf8');
            if (out.includes('\n')) resolve(out.trim());
          });
          child.once('error', reject);
          child.once('exit', (code) => reject(new Error(`exited ${String(code)}: ${out}`)));
        });
        return { said: JSON.parse(line) as { length: number; held: number; left: string[] }, environment: startUpEnvironment(child.pid ?? 0) };
      } finally {
        child.stdin.end('x');
        child.kill();
      }
    };

    const fromFile = await boot({ ADMINIUM_SECRET_FILE: secretFile });
    expect(fromFile.said).toEqual({ length: SECRET.length, held: SECRET.length, left: [] });
    expect(fromFile.environment).toContain(`ADMINIUM_SECRET_FILE=${secretFile}`);
    expect(fromFile.environment).not.toContain('ADMINIUM_SECRET=');
    expect(fromFile.environment).not.toContain(SECRET);

    // The same probe on a process given the value itself finds it: the check above is not blind.
    const fromValue = await boot({ ADMINIUM_SECRET: SECRET });
    expect(fromValue.said).toEqual({ length: SECRET.length, held: SECRET.length, left: [] });
    expect(fromValue.environment).toContain(`ADMINIUM_SECRET=${SECRET}`);
  });
});
