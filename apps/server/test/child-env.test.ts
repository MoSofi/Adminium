// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The operator's secrets out of reach (`config/operator-secrets.ts`, `config/child-env.ts`).
 *
 * Two promises. After a boot, `process.env` holds none of the operator's secrets, and the modules that use them still
 * work: sessions are signed, the setup token is checked, a model key reaches the provider. And no program the server
 * starts sees one of them, whatever `process.env` holds at the time: each child is given a named environment, which
 * is asserted here by starting each one for real (a fake `npm`, `pnpm`, `git` and browser opener on the PATH write
 * down what they were given).
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { archiveSigningKey } from '../src/archive/mac.js';
import { addScreenPackages } from '../src/cli/commands/design.js';
import { loadCliEnv, openBrowser, runProcess } from '../src/cli/runtime.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { childEnvironment } from '../src/config/child-env.js';
import { loadEnv } from '../src/config/env.js';
import { holdOperatorSecrets, isOperatorSecretName, operatorSecret } from '../src/config/operator-secrets.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { installer } from '../src/designer/ask-needs.js';
import { runChild, startLongChild } from '../src/designer/child.js';
import { createSkills } from '../src/designer/skills.js';
import type { ToolContext } from '../src/designer/tool-types.js';
import { createDesignerTools } from '../src/designer/tools.js';
import { createVersions } from '../src/designer/versions.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { runLine } from '../src/project/apps/own-build.js';
import { installProject } from '../src/project/install.js';
import { prepareSetupToken } from '../src/setup/token.js';
import { runCli } from '../src/cli/run.js';
import { tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

const SECRET = 's'.repeat(48);
const SETUP_TOKEN = 'a-chosen-setup-token-0001';
/** One of every kind the server is given, each with a value no child may print. */
const SECRETS: Record<string, string> = {
  ADMINIUM_SECRET: SECRET,
  ADMINIUM_SETUP_TOKEN: SETUP_TOKEN,
  ADMINIUM_ARCHIVE_KEY: 'archive-key-'.padEnd(40, 'k'),
  // 32 random bytes, as the operator endpoint's token must be (`config/env.ts`).
  ADMINIUM_OPERATOR_TOKEN: '0e7d1c9a4b3f2e8d6c5b4a39281706f5e4d3c2b1a0f9e8d7c6b5a49382716051',
  ADMINIUM_AI_ANTHROPIC_API_KEY: 'sk-ant-operator-key',
  ADMINIUM_AI_GOOGLE_API_KEY: 'google-operator-key',
  ADMINIUM_FIGMA_TOKEN: 'figd_operator-figma-token-0001',
  PEXELS_API_KEY: 'pexels-operator-key-0001',
  UNSPLASH_ACCESS_KEY: 'unsplash-operator-key-0001',
  PIXABAY_API_KEY: 'pixabay-operator-key-0001',
};
const SECRET_VALUES = Object.values(SECRETS);

let saved: NodeJS.ProcessEnv;
beforeEach(() => {
  saved = { ...process.env };
});
afterEach(() => {
  for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
  Object.assign(process.env, saved);
});

/** The relay's credential: a trial's, so it is held without booting one (a trial boot needs much more). */
const RELAY_URL = 'smtp://relay-user:relay-pass@relay.example.test:587';

/** Put every secret in `process.env`, as a container or a shell would, with what the operator token needs beside it. */
function setSecrets(): void {
  Object.assign(process.env, SECRETS, { ADMINIUM_OPERATOR_LISTEN: '10.0.0.2:4601' });
}

/** What a child saw: no secret's name, and no secret's value under any name. */
function expectNoSecret(seen: Record<string, string>, label: string): void {
  for (const name of Object.keys(SECRETS)) expect(seen, `${label}: ${name}`).not.toHaveProperty(name);
  const text = JSON.stringify(seen);
  for (const value of SECRET_VALUES) expect(text.includes(value), `${label}: a secret's value`).toBe(false);
}

/** `NAME=value` lines (`env`'s output) as an object. */
function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(line.slice(0, at))) out[line.slice(0, at)] = line.slice(at + 1);
  }
  return out;
}

describe('after the server boots', () => {
  let composed: ComposedServer | undefined;
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'adminium-child-env-'));
  });
  afterEach(async () => {
    await composed?.app.close();
    composed = undefined;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('process.env holds none of the secrets, and sessions, the setup token and the model keys still work', async () => {
    setSecrets();
    // The boot as `adminium start` does it: the environment read once, then the server composed.
    const env = loadCliEnv(process.env, { dataDir, host: '127.0.0.1' });
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const prepared = await prepareSetupToken({ meta, env, mode: 'server' });
    expect(prepared?.fromEnv).toBe(true);
    const keys: (string | undefined)[] = [];
    const runService = createRunService({ meta });
    const metaStore: MetaStoreHandle = { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
    composed = await composeServer({
      env,
      metaStore,
      manager: new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(env.ADMINIUM_SECRET), metaDsn: null }),
      runService,
      applyService: createApplyService({ meta, runService }),
      allowed: { templates: [], widgets: [], widgetContracts: {} },
      logger: false,
      telemetry: false,
      onMetaRelocated: () => undefined,
      pictureMakerSeam: (_kind, opts) => {
        keys.push(opts.apiKey);
        return {} as never;
      },
    });
    const { app } = composed;
    await app.ready();

    for (const name of Object.keys(SECRETS)) expect(process.env[name], name).toBeUndefined();
    for (const value of SECRET_VALUES) expect(Object.values(process.env)).not.toContain(value);

    // The setup token, chosen in the environment that is gone: checked all the same.
    const body = { email: 'owner@example.test', password: 'a-long-enough-test-password-1!', name: 'Owner' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/setup/super-admin', payload: { ...body, setupToken: 'WRONG-WRONG-WRONG-WRONG' } })).statusCode).toBe(403);
    const setup = await app.inject({ method: 'POST', url: '/api/v1/setup/super-admin', payload: { ...body, setupToken: SETUP_TOKEN } });
    expect(setup.statusCode, setup.body).toBe(201);

    // The session cookie, signed with the secret that is gone: read back.
    const cookie = String(setup.headers['set-cookie']).split(';')[0] ?? '';
    expect((await app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie: `${cookie.slice(0, -2)}xx` } })).statusCode).toBe(401);

    // A model key, from the environment that is gone, reaches the provider (a fake) it is for.
    await app.aiConnections.pictureMaker('google');
    expect(keys).toEqual([SECRETS['ADMINIUM_AI_GOOGLE_API_KEY']]);
    // The operator's own credentials are held for the modules that will read them.
    expect(operatorSecret('ADMINIUM_OPERATOR_TOKEN')).toBe(SECRETS['ADMINIUM_OPERATOR_TOKEN']);
    expect(operatorSecret('ADMINIUM_ARCHIVE_KEY')).toBe(SECRETS['ADMINIUM_ARCHIVE_KEY']);
    // The archive's signing key, and the keys the Designer reads late (Figma, the picture sites), from the same place.
    expect(archiveSigningKey({ ADMINIUM_SECRET: SECRET })).toEqual(
      archiveSigningKey({ ADMINIUM_SECRET: SECRET, ADMINIUM_ARCHIVE_KEY: SECRETS['ADMINIUM_ARCHIVE_KEY'] }),
    );
    expect(archiveSigningKey({ ADMINIUM_SECRET: SECRET }).source).toBe('archive-key');
    for (const name of ['ADMINIUM_FIGMA_TOKEN', 'PEXELS_API_KEY', 'UNSPLASH_ACCESS_KEY', 'PIXABAY_API_KEY']) {
      expect(operatorSecret(name), name).toBe(SECRETS[name]);
    }

    // A second boot in this process reads the environment as the first one did.
    expect(loadCliEnv(process.env, { dataDir }).ADMINIUM_SECRET).toBe(SECRET);
    expect(loadEnv().ADMINIUM_SECRET).toBe(SECRET);
    // An object of a caller's own is read as given: a secret left out stays out.
    expect(() => loadCliEnv({ ADMINIUM_DATA_DIR: dataDir }, {})).toThrow(/ADMINIUM_SECRET is required/);
  });

  it('a value set again since the boot is taken out, and replaces the held one', () => {
    process.env['ADMINIUM_OPERATOR_TOKEN'] = 'first-operator-token';
    expect(holdOperatorSecrets()).toEqual(['ADMINIUM_OPERATOR_TOKEN']);
    process.env['ADMINIUM_OPERATOR_TOKEN'] = 'second-operator-token';
    expect(operatorSecret('ADMINIUM_OPERATOR_TOKEN')).toBe('second-operator-token');
    expect(process.env['ADMINIUM_OPERATOR_TOKEN']).toBeUndefined();
    // Only the operator's names: a project's own variables stay where its config reads them.
    process.env['SHOP_DATABASE_URL'] = 'postgres://shop';
    expect(holdOperatorSecrets()).toEqual([]);
    expect(process.env['SHOP_DATABASE_URL']).toBe('postgres://shop');
    for (const name of Object.keys(SECRETS)) expect(isOperatorSecretName(name), name).toBe(true);
    // The trial's relay credential is the operator's too.
    process.env['ADMINIUM_TRIAL_SMTP_URL'] = RELAY_URL;
    expect(isOperatorSecretName('ADMINIUM_TRIAL_SMTP_URL')).toBe(true);
    expect(operatorSecret('ADMINIUM_TRIAL_SMTP_URL')).toBe(RELAY_URL);
    expect(process.env['ADMINIUM_TRIAL_SMTP_URL']).toBeUndefined();
    // Set to nothing is unset: the held value is forgotten too.
    process.env['ADMINIUM_OPERATOR_TOKEN'] = '';
    expect(operatorSecret('ADMINIUM_OPERATOR_TOKEN')).toBeUndefined();
    expect(isOperatorSecretName('ADMINIUM_DATA_DIR')).toBe(false);
  });
});

describe('on Windows (a Windows-shaped environment, on every platform)', () => {
  /** What `process.env` holds on a Windows machine: `Path`, not `PATH`, and Windows' own names. */
  const WINDOWS_ENV: Record<string, string> = {
    Path: 'C:\\Windows\\system32;C:\\Program Files\\nodejs\\',
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    SystemRoot: 'C:\\Windows',
    windir: 'C:\\Windows',
    SystemDrive: 'C:',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    ProgramData: 'C:\\ProgramData',
    COMSPEC: 'C:\\Windows\\system32\\cmd.exe',
    NUMBER_OF_PROCESSORS: '8',
    PROCESSOR_ARCHITECTURE: 'AMD64',
    USERPROFILE: 'C:\\Users\\ava',
    APPDATA: 'C:\\Users\\ava\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\ava\\AppData\\Local',
    TEMP: 'C:\\Users\\ava\\AppData\\Local\\Temp',
    HOMEDRIVE: 'C:',
    HOMEPATH: '\\Users\\ava',
    // Windows reads names in any case: these are the operator's secrets all the same.
    Adminium_Secret: SECRET,
    adminium_ai_anthropic_api_key: 'sk-ant-operator-key',
    GITHUB_TOKEN: 'ghp_not-for-children',
    SHOP_ONLY: 'not listed',
  };

  it("keeps the programs' path and Windows' own names, spelled PATH for the path", () => {
    for (const profile of ['program', 'build', 'packages', 'browser'] as const) {
      const env = childEnvironment(profile, {}, WINDOWS_ENV, 'win32');
      expect(env['PATH'], profile).toBe(WINDOWS_ENV['Path']);
      expect(env, profile).not.toHaveProperty('Path');
      for (const name of ['SystemRoot', 'windir', 'SystemDrive', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'HOMEDRIVE', 'HOMEPATH']) {
        expect(env[name], `${profile}: ${name}`).toBe(WINDOWS_ENV[name]);
      }
      expect(env['ComSpec'], profile).toBe(WINDOWS_ENV['COMSPEC']);
      expectNoSecret(env, profile);
      expect(env, profile).not.toHaveProperty('GITHUB_TOKEN');
      expect(env, profile).not.toHaveProperty('SHOP_ONLY');
    }
  });

  it('a caller’s own Path replaces the copied one, and a secret it passes in any case is dropped', () => {
    const env = childEnvironment('program', { Path: 'C:\\tools', adminium_secret: SECRET, APP_PORT: '4700' }, WINDOWS_ENV, 'win32');
    expect(Object.keys(env).filter((name) => name.toUpperCase() === 'PATH')).toEqual(['Path']);
    expect(env['Path']).toBe('C:\\tools');
    expect(env['APP_PORT']).toBe('4700');
    expectNoSecret(env, 'add');
  });

  it('elsewhere, names keep their case: a `Path` is not the path', () => {
    const env = childEnvironment('program', {}, { Path: '/not/the/path', PATH: '/usr/bin' }, 'linux');
    expect(env).toEqual({ PATH: '/usr/bin' });
  });
});

describe.skipIf(process.platform === 'win32')('a program the server starts', () => {
  let bin: string;
  let dumps: string;
  let root: string;

  /** A program on the PATH that writes down its environment, one file per run, and succeeds. */
  function fakeProgram(name: string): void {
    const file = join(bin, name);
    // Written aside and renamed, so a reader never sees a dump half written.
    writeFileSync(file, `#!/bin/sh\n/usr/bin/env > "${dumps}/.part-${name}.$$" && mv "${dumps}/.part-${name}.$$" "${dumps}/${name}.$$.env"\nexit 0\n`);
    chmodSync(file, 0o755);
  }
  /** What each run of `name` was given. */
  function seenBy(name: string): Record<string, string>[] {
    return readdirSync(dumps)
      .filter((file) => file.startsWith(`${name}.`))
      .map((file) => parseEnvLines(readFileSync(join(dumps, file), 'utf8')));
  }

  beforeEach(() => {
    bin = mkdtempSync(join(tmpdir(), 'adminium-child-env-bin-'));
    dumps = mkdtempSync(join(tmpdir(), 'adminium-child-env-dumps-'));
    root = tempProject('adminium-child-env-project-');
    for (const name of ['npm', 'pnpm', 'yarn', 'git', 'open', 'xdg-open']) fakeProgram(name);
    process.env['PATH'] = `${bin}:${process.env['PATH'] ?? ''}`;
    // Set after the boot took them out: a late value must not reach a child either.
    setSecrets();
    process.env['NODE_OPTIONS'] = '--require ./evil.js';
    process.env['npm_config_registry'] = 'https://registry.example.test/';
    process.env['npm_config__authToken'] = 'npm-auth-token-value';
    process.env['HTTPS_PROXY'] = 'http://proxy.example.test:3128';
  });
  afterEach(() => {
    for (const dir of [bin, dumps, root]) rmSync(dir, { recursive: true, force: true });
  });

  it('the Designer’s run_tests: code the model wrote sees where programs are and nothing of this server’s', async () => {
    const io = fakeIo({ interactive: false });
    const deps = fakeDeps({ cwd: root, env: {} });
    deps.runProcess = () => ({ status: 0, stdout: '' });
    expect(await runCli(['app', 'new', 'repairs'], { io, deps }), io.stderr()).toBe(0);
    rmSync(join(root, 'apps/repairs/tests'), { recursive: true, force: true });
    mkdirSync(join(root, 'apps/repairs/tests'), { recursive: true });
    const out = join(dumps, 'run-tests.json');
    writeFileSync(join(root, 'apps/repairs/tests/env.test.mjs'), `import test from 'node:test';\nimport { writeFileSync } from 'node:fs';\ntest('env', () => writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.env)));\n`);
    const tools = createDesignerTools({ root, version: '0.0.0', designer: () => ({}) as never, skills: createSkills(), listAddOns: async () => [] }, 'repairs');
    const runTests = tools.find((tool) => tool.name === 'run_tests');
    const signal = new AbortController().signal;
    const ask = async () => ({ type: 'question' as const, text: 'Run them' });
    const context = { session: { id: 'ds_000000000000000000000000', appKey: 'repairs' }, turn: 1, signal, ask, handle: { turn: 1, signal, ask } } as unknown as ToolContext;
    expect(await runTests?.run({}, context)).toMatchObject({ label: 'Tests passed' });
    const seen = JSON.parse(readFileSync(out, 'utf8')) as Record<string, string>;
    expectNoSecret(seen, 'run_tests');
    expect(seen).not.toHaveProperty('NODE_OPTIONS');
    expect(seen).not.toHaveProperty('HTTPS_PROXY');
    expect(seen['PATH']).toBe(process.env['PATH']);
    expect(seen['ADMINIUM_SKIP_CLI']).toBe('1');
  });

  it('an own build’s line (and so Start with an app, whose build runs the same line): where programs are, CI, and its guard', async () => {
    const result = await runLine('/usr/bin/env', root, undefined, { ADMINIUM_BUILD_ROOT: root, NODE_OPTIONS: '--require "/guard.cjs"', ADMINIUM_SECRET: 'passed-on-purpose' });
    expect(result.ok, result.output).toBe(true);
    const seen = parseEnvLines(result.output);
    expectNoSecret(seen, 'own build');
    expect(seen['PATH']).toBe(process.env['PATH']);
    expect(seen['CI']).toBe('1');
    expect(seen['ADMINIUM_BUILD_ROOT']).toBe(root);
    // The guard's own NODE_OPTIONS, never this process's.
    expect(seen['NODE_OPTIONS']).toBe('--require "/guard.cjs"');
  });

  it('a Designer command (runChild, startLongChild): the program profile when none is named', async () => {
    const dump = "process.stdout.write(JSON.stringify(process.env))";
    const result = await runChild(process.execPath, ['-e', dump], { cwd: root, timeoutMs: 10_000 });
    const seen = JSON.parse(result.output) as Record<string, string>;
    expectNoSecret(seen, 'runChild');
    expect(seen).not.toHaveProperty('NODE_OPTIONS');
    expect(seen['PATH']).toBe(process.env['PATH']);
    // A caller that passes a secret on purpose still does not get it through.
    const passed = await runChild(process.execPath, ['-e', dump], { cwd: root, timeoutMs: 10_000, env: { ...process.env } });
    expectNoSecret(JSON.parse(passed.output) as Record<string, string>, 'runChild given process.env');

    const long = startLongChild(process.execPath, ['-e', dump], { cwd: root });
    await long.ended;
    expectNoSecret(JSON.parse(long.output().trim()) as Record<string, string>, 'startLongChild');
  });

  it('package installs (project install, request_package, design’s first packages): package settings, proxy, no credential', async () => {
    writeFileSync(join(root, 'package.json'), '{"name":"x","version":"1.0.0"}');
    await installProject(root);
    expect(await installer(root)([{ name: 'clsx', version: '2.1.1' }], new AbortController().signal)).toBeNull();
    await addScreenPackages(root, process.env);
    const seen = [...seenBy('npm'), ...seenBy('pnpm'), ...seenBy('yarn')];
    expect(seen).toHaveLength(3);
    for (const one of seen) {
      expectNoSecret(one, 'install');
      expect(one).not.toHaveProperty('NODE_OPTIONS');
      expect(one).not.toHaveProperty('npm_config__authToken');
      expect(one['PATH']).toBe(process.env['PATH']);
      expect(one['npm_config_registry']).toBe('https://registry.example.test/');
      expect(one['HTTPS_PROXY']).toBe('http://proxy.example.test:3128');
    }
  });

  it('git for the Designer’s versions, and `adminium new`’s programs', async () => {
    const versions = createVersions(root, { git: join(bin, 'git') });
    // `git --version`, then `git init` and the snapshot's own commands: the fake answers each with nothing.
    expect(await versions.available()).toBe(true);
    await versions.snapshot({ id: 'ds_000000000000000000000000', appKey: 'repairs' } as never).catch(() => undefined);
    runProcess('git', ['init', '--quiet'], { cwd: root });
    runProcess('npm', ['install'], { cwd: root, env: { NPM_CONFIG_FUND: 'false' } });
    const seen = [...seenBy('git'), ...seenBy('npm')];
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const one of seen) {
      expectNoSecret(one, 'git / new');
      expect(one).not.toHaveProperty('NODE_OPTIONS');
      expect(one['PATH']).toBe(process.env['PATH']);
    }
    expect(seenBy('npm').at(-1)?.['NPM_CONFIG_FUND']).toBe('false');
  });

  it('the browser a started server opens', async () => {
    expect(await openBrowser('http://127.0.0.1:4600/')).toBe(true);
    const name = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const end = Date.now() + 10_000;
    while (seenBy(name).length === 0 && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 20));
    const [seen] = seenBy(name);
    expect(seen).toBeDefined();
    expectNoSecret(seen ?? {}, 'browser');
    expect(seen?.['PATH']).toBe(process.env['PATH']);
  });

  it('every profile is a named list: an unnamed variable is not passed, an operator secret never is', () => {
    const from = { PATH: '/bin', HOME: '/h', SOMETHING_ELSE: 'x', ...SECRETS, npm_config_cache: '/c', DISPLAY: ':0' };
    expect(childEnvironment('program', {}, from)).toEqual({ PATH: '/bin', HOME: '/h' });
    expect(childEnvironment('build', {}, from)).toEqual({ PATH: '/bin', HOME: '/h', CI: '1' });
    expect(childEnvironment('packages', {}, from)).toEqual({ PATH: '/bin', HOME: '/h', npm_config_cache: '/c' });
    expect(childEnvironment('browser', {}, from)).toEqual({ PATH: '/bin', HOME: '/h', DISPLAY: ':0' });
    expect(childEnvironment('program', { ...SECRETS, EXTRA: 'y' }, from)).toEqual({ PATH: '/bin', HOME: '/h', EXTRA: 'y' });
    expect(existsSync(bin)).toBe(true);
  });
});
