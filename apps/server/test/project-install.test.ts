// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Installing a project's packages whole: what is run, on a terminal and in the
 * desktop app, and that the mark is there only after a success.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run.js';
import type { ChildResult } from '../src/designer/child.js';
import { INSTALL_STAMP_FILE, installNeed, writeInstallStamp } from '../src/project/install-stamp.js';
import { installNeedWords, installProject, wholeInstallArgs } from '../src/project/install.js';
import { DESKTOP_PROGRAMS_ENV } from '../src/project/programs.js';
import { APP_VERSION } from '../src/version.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

const APP = { binary: '/app/Adminium', npm: '/app/npm', shims: '/u/bin', git: null, npmUserConfig: '/u/user.npmrc', npmGlobalConfig: '/u/global.npmrc', npmCache: '/u/cache' };
const DESKTOP = { [DESKTOP_PROGRAMS_ENV]: JSON.stringify(APP) };

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-install-'));
  writeFileSync(join(root, 'package.json'), '{"name":"p","private":true}\n');
  writeFileSync(join(root, 'adminium.config.mjs'), 'export default {};\n');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A manager that "installs": it makes node_modules, then ends as told. */
const runner = (end: Partial<ChildResult> = {}) => {
  const calls: Array<{ command: string; args: readonly string[]; env: Record<string, string | undefined> }> = [];
  const run = async (command: string, args: readonly string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<ChildResult> => {
    calls.push({ command, args, env: opts.env ?? {} });
    // The mark must already be gone while the manager runs.
    expect(existsSync(join(opts.cwd, INSTALL_STAMP_FILE))).toBe(false);
    mkdirSync(join(opts.cwd, 'node_modules', 'react'), { recursive: true });
    return { code: 0, output: 'added 18 packages', timedOut: false, stopped: false, ...end };
  };
  return { run, calls };
};

describe('installProject', () => {
  it('on a terminal: the folder’s own manager, a plain install with no scripts, then the mark', async () => {
    const { run, calls } = runner();
    const result = await installProject(root, { env: {}, run });
    expect(result).toMatchObject({ ok: true, manager: 'npm', command: 'npm install --ignore-scripts', note: null });
    expect(calls).toEqual([expect.objectContaining({ command: 'npm', args: ['install', '--ignore-scripts'] })]);
    expect(installNeed(root)).toBeNull();
  });

  it('from the lockfile when there is one', async () => {
    writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}');
    const { run, calls } = runner();
    expect((await installProject(root, { env: {}, run })).command).toBe('npm ci --ignore-scripts');
    expect(calls[0]?.args).toEqual(['ci', '--ignore-scripts']);
    expect(wholeInstallArgs('pnpm', root)).toEqual(['install', '--ignore-scripts']);
  });

  it('in the desktop app: the carried npm through the app’s program, whatever the folder was made with, and it says so', async () => {
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'theirs');
    const { run, calls } = runner();
    const result = await installProject(root, { env: DESKTOP, run });
    expect(calls[0]?.command).toBe('/app/Adminium');
    expect(calls[0]?.args).toEqual([join('/app/npm', 'bin', 'npm-cli.js'), 'install', '--ignore-scripts']);
    expect(calls[0]?.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1', NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/', NPM_CONFIG_IGNORE_SCRIPTS: 'true' });
    expect(result.manager).toBe('npm');
    expect(result.note).toBe('This project uses pnpm. The app installs with npm; your pnpm file (pnpm-lock.yaml) is left as it is.');
    expect(installNeed(root)).toBeNull();
  });

  it.each([
    ['fails', { code: 1 }, { ok: false, stopped: false, timedOut: false }],
    ['is cancelled', { code: null, stopped: true }, { ok: false, stopped: true }],
    ['takes too long', { code: null, timedOut: true }, { ok: false, timedOut: true }],
  ])('an install that %s leaves no mark, even over one that was there', async (_label, end, expected) => {
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    writeInstallStamp(root, APP_VERSION);
    const { run } = runner(end as Partial<ChildResult>);
    expect(await installProject(root, { env: {}, run })).toMatchObject(expected);
    expect(installNeed(root)).toBe('not-finished');
  });

  it('has words for each reason', () => {
    for (const need of ['no-packages', 'not-finished', 'another-machine', 'changed'] as const) expect(installNeedWords(need)).toMatch(/building blocks/);
  });
});

describe('adminium install --check', () => {
  const check = async (): Promise<{ code: number; out: string }> => {
    const io = fakeIo();
    const code = await runCli(['install', '--check'], { io, deps: fakeDeps({ cwd: root, env: {} }) });
    return { code, out: io.stdout() };
  };

  it('says whether an install is needed and why, and installs nothing', async () => {
    expect(await check()).toEqual({ code: 3, out: expect.stringContaining('needed: no-packages') as string });
    mkdirSync(join(root, 'node_modules'));
    expect((await check()).out).toContain('needed: not-finished');
    writeInstallStamp(root, APP_VERSION);
    expect(await check()).toEqual({ code: 0, out: expect.stringContaining('in place') as string });
  });

  it('refuses a folder that is no project', async () => {
    rmSync(join(root, 'adminium.config.mjs'));
    const refused = fakeIo();
    expect(await runCli(['install', '--check'], { io: refused, deps: fakeDeps({ cwd: root, env: {} }) })).not.toBe(0);
    expect(refused.stderr()).toContain('There is no project in this folder');
  });
});
