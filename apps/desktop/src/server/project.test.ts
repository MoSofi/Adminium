// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Project mode in the server child (plan 66, spec 05): the environment main
 * gives it, the messages, and the entry itself with the server package's
 * `startProject` stood in for. The real start is the server package's own test
 * (`apps/server/test/start-project.test.ts`).
 */
import { HOST_DECIDED_ENV } from '@adminium/server';
import { describe, expect, it, vi } from 'vitest';

import {
  buildProjectServerEnv,
  buildServerEnv,
  isProjectEnv,
  parseDesktopProjectEnv,
  STRIPPED_INHERITED_ENV_KEYS,
} from './env.js';
import { resolveParentPort, runProjectEntry, runServerEntry, type ParentPortLike } from './index.js';
import { parseParentMessage, parseServerMessage } from './protocol.js';

const TOKEN = 'ab'.repeat(32);
const ROOT = '/Users/someone/Adminium/juniper';

const block = (over: Partial<Parameters<typeof buildProjectServerEnv>[0]> = {}) =>
  buildProjectServerEnv({ root: ROOT, mode: 'design', port: 4700, bootToken: TOKEN, ...over });

describe('buildProjectServerEnv', () => {
  it('states where the server listens and which folder it serves, in both spellings', () => {
    expect(block()).toEqual({
      ADMINIUM_RUNTIME: 'desktop',
      ADMINIUM_DESKTOP_PROJECT: ROOT,
      ADMINIUM_DESKTOP_PROJECT_MODE: 'design',
      ADMINIUM_HOST: '127.0.0.1',
      HOST: '127.0.0.1',
      ADMINIUM_PORT: '4700',
      PORT: '4700',
      ADMINIUM_BOOT_TOKEN: TOKEN,
    });
  });

  it('never sets the secret, the data folder or the store: they are the project’s own', () => {
    const env = block({ inherit: { ADMINIUM_SECRET: 'classic', ADMINIUM_DATA_DIR: '/classic', ADMINIUM_META_URL: 'sqlite:/classic/meta.db', ADMINIUM_META_DSN: 'x' } });
    for (const name of ['ADMINIUM_SECRET', 'ADMINIUM_DATA_DIR', 'ADMINIUM_META_URL', 'ADMINIUM_META_DSN', 'ADMINIUM_DESKTOP_SINGLE_USER', 'ADMINIUM_TRUST_PROXY', 'ADMINIUM_DESIGNER']) {
      expect(env, name).not.toHaveProperty(name);
    }
  });

  it('is this machine only while a project is built, whatever host is asked for', () => {
    expect(block({ host: '0.0.0.0' }).ADMINIUM_HOST).toBe('127.0.0.1');
    const shared = block({ mode: 'serve', host: '0.0.0.0' });
    expect(shared.ADMINIUM_HOST).toBe('0.0.0.0');
    expect(shared.HOST).toBe('0.0.0.0');
    expect(block({ mode: 'serve' }).ADMINIUM_HOST).toBe('127.0.0.1');
  });

  it('lets nothing inherited choose the folder, the mode or where the app’s own files are', () => {
    const hostile = Object.fromEntries(STRIPPED_INHERITED_ENV_KEYS.map((name) => [name, 'inherited']));
    const env = block({ inherit: { ...hostile, NODE_OPTIONS: '--require /x.cjs', LANG: 'en_GB.UTF-8' } });
    expect(Object.values(env)).not.toContain('inherited');
    expect(env.ADMINIUM_DESKTOP_PROJECT).toBe(ROOT);
    // Passed through as it is: the copied-app read guard rides on it (spec 06).
    expect(env.NODE_OPTIONS).toBe('--require /x.cjs');
    expect(env.LANG).toBe('en_GB.UTF-8');
  });

  it('gives the app’s own folders as they are, so none is looked for inside the opened folder', () => {
    const env = block({ staticRoot: '/app/out/dashboard', bundledAddOnsDir: '/app/add-ons', bundledAppsDir: '/app/apps-bundle', logLevel: 'info' });
    expect(env).toMatchObject({ ADMINIUM_STATIC_ROOT: '/app/out/dashboard', ADMINIUM_BUNDLED_ADD_ONS: '/app/add-ons', ADMINIUM_BUNDLED_APPS: '/app/apps-bundle', ADMINIUM_LOG_LEVEL: 'info' });
  });

  it('says where the app’s own programs are, and lets nothing inherited say it instead', () => {
    expect(block()).not.toHaveProperty('ADMINIUM_DESKTOP_PROGRAMS');
    expect(block({ inherit: { ADMINIUM_DESKTOP_PROGRAMS: '{"binary":"/tmp/evil"}' } })).not.toHaveProperty('ADMINIUM_DESKTOP_PROGRAMS');
    expect(block({ programs: '{"binary":"/app"}', inherit: { ADMINIUM_DESKTOP_PROGRAMS: '{"binary":"/tmp/evil"}' } }).ADMINIUM_DESKTOP_PROGRAMS).toBe('{"binary":"/app"}');
  });

  it('refuses a relative folder, a port that was not picked and a token of the wrong size', () => {
    expect(() => block({ root: 'juniper' })).toThrow(/absolute path/);
    expect(() => block({ port: 0 })).toThrow(/picked before the fork/);
    expect(() => block({ bootToken: 'abc' })).toThrow(/64 hex/);
  });

  it('every name it states is one a folder’s .env may not set', () => {
    for (const name of Object.keys(block({ staticRoot: '/s', bundledAddOnsDir: '/a', bundledAppsDir: '/b' }))) {
      if (name === 'ADMINIUM_LOG_LEVEL' || name === 'ADMINIUM_DESKTOP_PROJECT_MODE') continue;
      expect(HOST_DECIDED_ENV, name).toContain(name);
    }
    // And the two it leaves unset on purpose.
    expect(HOST_DECIDED_ENV).toEqual(expect.arrayContaining(['ADMINIUM_TRUST_PROXY', 'ADMINIUM_DESIGNER', 'NODE_OPTIONS', 'PATH']));
  });

  it('the classic block names no project, so the classic child stays the classic child', () => {
    const classic = buildServerEnv({ dataDir: '/classic', secret: 's'.repeat(64), bootToken: TOKEN, singleUser: true, inherit: { ADMINIUM_DESKTOP_PROJECT: ROOT, ADMINIUM_DESKTOP_PROJECT_MODE: 'design' } });
    expect(isProjectEnv(classic)).toBe(false);
    expect(isProjectEnv(block())).toBe(true);
  });
});

describe('parseDesktopProjectEnv', () => {
  it('reads back what main wrote', () => {
    expect(parseDesktopProjectEnv(block({ logLevel: 'debug' }))).toEqual({ root: ROOT, mode: 'design', host: '127.0.0.1', port: 4700, bootToken: TOKEN, logLevel: 'debug' });
  });

  it.each([
    ['a relative folder', { ADMINIUM_DESKTOP_PROJECT: 'juniper' }, /absolute path/],
    ['no mode', { ADMINIUM_DESKTOP_PROJECT_MODE: '' }, /design or serve/],
    ['no port', { ADMINIUM_PORT: '0' }, /a port main picked/],
    ['a network host while building', { ADMINIUM_HOST: '0.0.0.0' }, /127\.0\.0\.1 while a project is built/],
    ['a token that is not the minted one', { ADMINIUM_BOOT_TOKEN: 'zz'.repeat(32) }, /the token main minted/],
    ['another runtime', { ADMINIUM_RUNTIME: 'self-host' }, /must be desktop/],
  ])('refuses %s', (_label, over, message) => {
    expect(() => parseDesktopProjectEnv({ ...block(), ...over })).toThrow(message);
  });
});

describe('the messages', () => {
  it('main may ask what the server is in the middle of', () => {
    expect(parseParentMessage({ type: 'busy?' })).toEqual({ ok: true, message: { type: 'busy?' } });
    expect(parseParentMessage({ type: 'shutdown' }).ok).toBe(true);
    expect(parseParentMessage({ type: 'eval', code: 'x' }).ok).toBe(false);
  });

  it('and the server answers with the Designer’s word, or nothing', () => {
    expect(parseServerMessage({ type: 'busy', busy: null }).ok).toBe(true);
    expect(parseServerMessage({ type: 'busy', busy: { kind: 'turn', sessionId: 'ds_1' } }).ok).toBe(true);
    expect(parseServerMessage({ type: 'busy', busy: { kind: '' } }).ok).toBe(false);
    expect(parseServerMessage({ type: 'error', stage: 'project', message: 'x' }).ok).toBe(true);
  });
});

function fakePort() {
  const posted: unknown[] = [];
  let listener: ((event: { data: unknown }) => void) | null = null;
  const port: ParentPortLike = {
    postMessage: (message) => void posted.push(message),
    on: (_event, fn) => {
      listener = fn;
    },
  };
  return { port, posted, send: (data: unknown) => listener?.({ data }) };
}

const started = (over: Record<string, unknown> = {}) => ({
  url: 'http://127.0.0.1:4700',
  port: 4700,
  token: TOKEN,
  bridgePairingCode: null,
  refused: [],
  close: vi.fn(async () => undefined),
  busy: vi.fn(() => null as { kind: string; sessionId: string | null } | null),
  ...over,
});

describe('runProjectEntry', () => {
  it('goes to the folder, starts it as a terminal would, and says ready', async () => {
    const { port, posted } = fakePort();
    const handle = started();
    const start = vi.fn(async () => handle);
    const chdir = vi.fn();
    const env = block({ inherit: { LANG: 'C' } });
    await runProjectEntry({ parentPort: port, env, start, chdir, exit: vi.fn(), onLog: vi.fn() });

    expect(chdir).toHaveBeenCalledWith(ROOT);
    expect(chdir.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[0] ?? 0);
    const given = (start.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(given).toMatchObject({ root: ROOT, port: 4700, mode: 'design', host: '127.0.0.1', token: TOKEN, refuse: HOST_DECIDED_ENV });
    // While a project is built the token opens design mode's one door and no other.
    expect(given.env).not.toHaveProperty('ADMINIUM_BOOT_TOKEN');
    expect(given.env).toMatchObject({ ADMINIUM_RUNTIME: 'desktop', LANG: 'C' });
    // The same object the child was started with: the project's .env fills it, and its config reads it from there.
    expect(given.env).toBe(env);
    expect(posted).toEqual([{ type: 'ready', port: 4700, host: '127.0.0.1', migrations: { applied: 0, version: expect.any(String) as string } }]);
  });

  it('shared: no design link, the host main chose, the boot token kept for its own door', async () => {
    const { port } = fakePort();
    const start = vi.fn(async () => started({ token: null }));
    await runProjectEntry({ parentPort: port, env: block({ mode: 'serve', host: '0.0.0.0' }), start, chdir: vi.fn(), exit: vi.fn(), onLog: vi.fn() });
    const given = (start.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(given).toMatchObject({ mode: 'serve', host: '0.0.0.0' });
    expect(given).not.toHaveProperty('token');
    expect(given.env).toHaveProperty('ADMINIUM_BOOT_TOKEN', TOKEN);
  });

  it('answers busy? with the Designer’s word, and stops once, saying so by its exit', async () => {
    const { port, posted, send } = fakePort();
    let release: () => void = () => undefined;
    const handle = started({
      busy: vi.fn(() => ({ kind: 'turn', sessionId: 'ds_1' })),
      close: vi.fn(() => new Promise<void>((done) => (release = done))),
    });
    const exit = vi.fn();
    await runProjectEntry({ parentPort: port, env: block(), start: vi.fn(async () => handle), chdir: vi.fn(), exit, onLog: vi.fn() });

    send({ type: 'busy?' });
    expect(posted.at(-1)).toEqual({ type: 'busy', busy: { kind: 'turn', sessionId: 'ds_1' } });

    send({ type: 'shutdown' });
    send({ type: 'shutdown' });
    expect(handle.close).toHaveBeenCalledTimes(1);
    // Not gone until close() says everything is.
    expect(exit).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });

  it('a start that fails says at which step, with the server’s own words, and exits', async () => {
    const { port, posted } = fakePort();
    const exit = vi.fn();
    const result = await runProjectEntry({
      parentPort: port,
      env: block(),
      start: vi.fn(async () => Promise.reject(new Error('This project is already running (in a terminal), on port 4711.'))),
      chdir: vi.fn(),
      exit,
      onLog: vi.fn(),
    });
    expect(result).toBeNull();
    expect(posted).toEqual([expect.objectContaining({ type: 'error', stage: 'project', message: 'This project is already running (in a terminal), on port 4711.' })]);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('an environment main did not write never reaches the folder', async () => {
    const { port, posted } = fakePort();
    const start = vi.fn();
    const chdir = vi.fn();
    await runProjectEntry({ parentPort: port, env: { ...block(), ADMINIUM_DESKTOP_PROJECT_MODE: 'live' }, start, chdir, exit: vi.fn(), onLog: vi.fn() });
    expect(start).not.toHaveBeenCalled();
    expect(chdir).not.toHaveBeenCalled();
    expect(posted).toEqual([expect.objectContaining({ type: 'error', stage: 'env' })]);
  });
});

describe('the entries, at their edges', () => {
  it('a child that was not forked says so on its log instead of posting', async () => {
    const lines: string[] = [];
    const exit = vi.fn();
    await runProjectEntry({ parentPort: null, env: block(), start: vi.fn(async () => started()), chdir: vi.fn(), exit, onLog: (line) => lines.push(line) });
    expect(lines.join('\n')).toContain('no parentPort; {"type":"ready"');
    expect(exit).not.toHaveBeenCalled();
  });

  it('a start that throws something that is not an Error is still told, as text', async () => {
    const { port, posted } = fakePort();
    await runProjectEntry({ parentPort: port, env: block(), start: vi.fn(async () => Promise.reject('no disk')), chdir: vi.fn(), exit: vi.fn(), onLog: vi.fn() });
    expect(posted).toEqual([{ type: 'error', stage: 'project', message: 'no disk' }]);
  });

  it('a message that is not one of main’s is ignored, and said so', async () => {
    const { port, send } = fakePort();
    const lines: string[] = [];
    const handle = started();
    await runProjectEntry({ parentPort: port, env: block(), start: vi.fn(async () => handle), chdir: vi.fn(), exit: vi.fn(), onLog: (line) => lines.push(line) });
    send({ type: 'eval', code: 'process.exit()' });
    expect(handle.close).not.toHaveBeenCalled();
    expect(lines.join('\n')).toContain('ignoring unrecognized parent message');
  });

  it('a close that fails still ends the child, with a failing exit', async () => {
    const { port, send } = fakePort();
    const exit = vi.fn();
    await runProjectEntry({ parentPort: port, env: block(), start: vi.fn(async () => started({ close: vi.fn(async () => Promise.reject(new Error('busy file'))) })), chdir: vi.fn(), exit, onLog: vi.fn() });
    send({ type: 'shutdown' });
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });

  it('the classic child refuses an environment that is not its own, at the first step', async () => {
    const { port, posted } = fakePort();
    const exit = vi.fn();
    const lines: string[] = [];
    expect(await runServerEntry({ parentPort: port, env: { ADMINIUM_RUNTIME: 'desktop' }, exit, onLog: (line) => lines.push(line) })).toBeNull();
    expect(posted).toEqual([expect.objectContaining({ type: 'error', stage: 'env' })]);
    expect(exit).toHaveBeenCalledWith(1);
    expect(lines.join('\n')).toContain('boot failed at stage "env"');
    // And with no parent it says the same on its log.
    const alone: string[] = [];
    await runServerEntry({ parentPort: null, env: {}, exit: vi.fn(), onLog: (line) => alone.push(line) });
    expect(alone.join('\n')).toContain('no parentPort; {"type":"error"');
  });

  it('starts the port when it has a start, and skips a name inherited with no value', async () => {
    const { port } = fakePort();
    const startPort = vi.fn();
    await runProjectEntry({ parentPort: { ...port, start: startPort }, env: block({ inherit: { EMPTY: undefined, LANG: 'C' } }), start: vi.fn(async () => started()), chdir: vi.fn(), exit: vi.fn(), onLog: vi.fn() });
    expect(startPort).toHaveBeenCalledTimes(1);
    expect(block({ inherit: { EMPTY: undefined } })).not.toHaveProperty('EMPTY');
  });

  it('finds the parent’s port where Electron puts it, or nothing under plain Node', () => {
    const parentPort = fakePort().port;
    expect(resolveParentPort({ parentPort } as unknown as NodeJS.Process)).toBe(parentPort);
    expect(resolveParentPort({} as NodeJS.Process)).toBeNull();
  });

  it('parseDesktopProjectEnv names everything an empty environment lacks', () => {
    expect(() => parseDesktopProjectEnv({})).toThrow(/ADMINIUM_DESKTOP_PROJECT[\s\S]*ADMINIUM_DESKTOP_PROJECT_MODE[\s\S]*ADMINIUM_PORT[\s\S]*ADMINIUM_HOST[\s\S]*ADMINIUM_BOOT_TOKEN[\s\S]*ADMINIUM_RUNTIME/);
    expect(parseDesktopProjectEnv({ ...block(), ADMINIUM_LOG_LEVEL: 'loud' }).logLevel).toBeUndefined();
  });
});
