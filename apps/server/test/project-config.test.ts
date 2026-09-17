// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A project's config, the folder lookup, `.env`, and package-manager wording.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { variableSources } from '../src/project/boot.js';
import { HELPERS_SOURCE } from '../src/project/build.js';
import {
  configFields,
  configuredDatabases,
  defineConfig,
  env as envHelper,
  parseProjectConfig,
  projectEnvironment,
  withDefaults,
} from '../src/project/config.js';
import { addToDotEnv, loadDotEnv, readDotEnv } from '../src/project/dotenv.js';
import { configFileIn, findProject } from '../src/project/locate.js';
import { detectPackageManager, runScript } from '../src/project/package-manager.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adminium-project-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the config object', () => {
  it('accepts databases by key, and hands the object back from defineConfig', () => {
    const config = defineConfig({ databases: { main: { url: 'sqlite:./a.db' }, 'old-archive': {} } });
    const parsed = parseProjectConfig(config);
    expect(parsed.ok).toBe(true);
  });

  it('names each problem by where it is', () => {
    const parsed = parseProjectConfig({ databases: { Main: { url: 'x' } }, server: { port: 0 }, colour: 'red' });
    expect(parsed.ok).toBe(false);
    const problems = parsed.ok ? [] : parsed.problems.join('\n');
    expect(problems).toContain('databases.Main');
    expect(problems).toContain('server.port');
    expect(problems).toContain('colour');
  });

  it('refuses something that is not an object at all', () => {
    const parsed = parseProjectConfig(undefined);
    expect(parsed.ok).toBe(false);
  });

  it('splits databases with a URL from those still waiting for one', () => {
    const parsed = parseProjectConfig({ databases: { main: { url: ' sqlite:a.db ' }, later: { url: '' }, none: {} } });
    if (!parsed.ok) throw new Error('expected a valid config');
    const { ready, missing } = configuredDatabases(parsed.config);
    expect([...ready]).toEqual([['main', 'sqlite:a.db']]);
    expect(missing).toEqual(['later', 'none']);
  });

  it('maps settings onto the variables the server reads, with the data folder in the project', () => {
    const parsed = parseProjectConfig({
      server: { port: 8080, host: '127.0.0.1' },
      metaStore: { url: 'postgres://m/meta' },
      storage: { url: 's3://bucket' },
    });
    if (!parsed.ok) throw new Error('expected a valid config');
    expect(projectEnvironment(parsed.config, '/srv/app')).toEqual({
      ADMINIUM_DATA_DIR: join('/srv/app', 'data'),
      PORT: '8080',
      HOST: '127.0.0.1',
      ADMINIUM_META_URL: 'postgres://m/meta',
      ADMINIUM_STORAGE_URL: 's3://bucket',
    });
  });

  it('says which file and field each project variable came from', () => {
    const parsed = parseProjectConfig({ server: { port: 8080 }, metaStore: { url: 'postgres://m/meta' } });
    if (!parsed.ok) throw new Error('expected a valid config');
    expect(configFields(parsed.config)).toEqual({ PORT: 'server.port', ADMINIUM_META_URL: 'metaStore.url' });

    const project = { root: dir, configFile: join(dir, 'adminium.config.ts') };
    // PORT is set already, so the config's port is not the one in use.
    const env = { PORT: '9000', ADMINIUM_SECRET: 'from-the-file' };
    expect(variableSources(project, parsed.config, env, ['ADMINIUM_SECRET'])).toEqual({
      ADMINIUM_SECRET: '.env',
      ADMINIUM_META_URL: 'adminium.config.ts (metaStore.url)',
    });
  });

  it('lets the environment win, and treats an empty variable as unset', () => {
    const merged = withDefaults({ PORT: '9000', HOST: '' }, { PORT: '8080', HOST: '0.0.0.0', ADMINIUM_DATA_DIR: '/d' });
    expect(merged).toEqual({ PORT: '9000', HOST: '0.0.0.0', ADMINIUM_DATA_DIR: '/d' });
  });

  it('reads a variable through env(), with a fallback for unset and empty', () => {
    process.env.ADMINIUM_TEST_ENV_HELPER = 'set';
    process.env.ADMINIUM_TEST_ENV_EMPTY = '';
    try {
      expect(envHelper('ADMINIUM_TEST_ENV_HELPER')).toBe('set');
      expect(envHelper('ADMINIUM_TEST_ENV_EMPTY', 'fallback')).toBe('fallback');
      expect(envHelper('ADMINIUM_TEST_ENV_UNSET')).toBeUndefined();
    } finally {
      delete process.env.ADMINIUM_TEST_ENV_HELPER;
      delete process.env.ADMINIUM_TEST_ENV_EMPTY;
    }
  });

  it('inlines helpers that behave like the real ones', async () => {
    const helpers = (await import(
      `data:text/javascript;base64,${Buffer.from(HELPERS_SOURCE).toString('base64')}`
    )) as { defineConfig: (c: unknown) => unknown; env: (n: string, f?: string) => string | undefined };
    const config = { databases: {} };
    expect(helpers.defineConfig(config)).toBe(config);
    process.env.ADMINIUM_TEST_INLINE = '';
    try {
      expect(helpers.env('ADMINIUM_TEST_INLINE', 'x')).toBe(envHelper('ADMINIUM_TEST_INLINE', 'x'));
    } finally {
      delete process.env.ADMINIUM_TEST_INLINE;
    }
  });
});

describe('finding the project', () => {
  it('finds the config in the folder or any parent', () => {
    writeFileSync(join(dir, 'adminium.config.ts'), '');
    mkdirSync(join(dir, 'a', 'b'), { recursive: true });
    const found = findProject(join(dir, 'a', 'b'), {});
    expect(found).toEqual({ root: dir, configFile: join(dir, 'adminium.config.ts') });
  });

  it('is null outside any project', () => {
    expect(findProject(dir, {})).toBeNull();
  });

  it('refuses a folder with two config files', () => {
    writeFileSync(join(dir, 'adminium.config.ts'), '');
    writeFileSync(join(dir, 'adminium.config.mjs'), '');
    expect(() => configFileIn(dir)).toThrow(/more than one/);
  });

  it('uses ADMINIUM_PROJECT_DIR when it is set, and says so when it points nowhere useful', () => {
    const project = join(dir, 'project');
    mkdirSync(project);
    writeFileSync(join(project, 'adminium.config.mjs'), '');
    expect(findProject('/', { ADMINIUM_PROJECT_DIR: project })?.root).toBe(project);
    expect(() => findProject('/', { ADMINIUM_PROJECT_DIR: dir })).toThrow(/has no adminium.config.ts/);
  });
});

describe('.env', () => {
  it('fills only what the environment leaves unset or empty', () => {
    writeFileSync(join(dir, '.env'), 'A=from-file\nB=from-file\nC=from-file\n');
    const env: Record<string, string | undefined> = { A: 'from-shell', B: '' };
    expect(loadDotEnv(dir, env).sort()).toEqual(['B', 'C']);
    expect(env).toEqual({ A: 'from-shell', B: 'from-file', C: 'from-file' });
  });

  it('creates the file with comments, and only adds what is missing afterwards', () => {
    addToDotEnv(dir, [{ key: 'ADMINIUM_SECRET', value: 'first', comment: ['keep it'] }]);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('# keep it\nADMINIUM_SECRET=first\n');
    const again = addToDotEnv(dir, [
      { key: 'ADMINIUM_SECRET', value: 'second' },
      { key: 'DATABASE_URL', value: '' },
    ]);
    expect(again).toEqual({ written: ['DATABASE_URL'], kept: ['ADMINIUM_SECRET'] });
    expect(readDotEnv(dir)).toEqual({ ADMINIUM_SECRET: 'first', DATABASE_URL: '' });
  });

  it('appends cleanly to a file that does not end with a newline', () => {
    writeFileSync(join(dir, '.env'), 'OTHER=1');
    addToDotEnv(dir, [{ key: 'DATABASE_URL', value: 'sqlite:x.db' }]);
    expect(readDotEnv(dir)).toEqual({ OTHER: '1', DATABASE_URL: 'sqlite:x.db' });
  });
});

describe('package managers', () => {
  it('follows the one that ran the command, and falls back to npm', () => {
    expect(detectPackageManager({ npm_config_user_agent: 'pnpm/10.28.1 npm/? node/v22.23.2' })).toBe('pnpm');
    expect(detectPackageManager({ npm_config_user_agent: 'yarn/1.22.22 npm/? node/v22' })).toBe('yarn');
    expect(detectPackageManager({ npm_config_user_agent: 'bun/1.2.0' })).toBe('bun');
    expect(detectPackageManager({ npm_config_user_agent: 'deno/2' })).toBe('npm');
    expect(detectPackageManager({})).toBe('npm');
  });

  it('always says `run`, except for npm start, so no script meets a built-in command', () => {
    expect(runScript('npm', 'dev')).toBe('npm run dev');
    expect(runScript('npm', 'start')).toBe('npm start');
    expect(runScript('yarn', 'check')).toBe('yarn run check');
    expect(runScript('pnpm', 'adminium:dev')).toBe('pnpm run adminium:dev');
  });
});
