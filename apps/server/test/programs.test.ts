// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How the server starts another program, on a terminal and inside the desktop
 * app: each row of the table, in both columns.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addPackagesArgs,
  buildLinePath,
  DESKTOP_PROGRAMS_ENV,
  desktopPrograms,
  gitProgram,
  mayOpenBrowser,
  namedPackageManager,
  nodeProgram,
  NPM_REGISTRY,
  packageManagerProgram,
} from '../src/project/programs.js';

const APP = {
  binary: '/Applications/Adminium.app/Contents/MacOS/Adminium',
  npm: '/Applications/Adminium.app/Contents/Resources/npm',
  shims: '/Users/a/Library/Application Support/Adminium/shims',
  git: '/usr/bin/git',
  npmUserConfig: '/Users/a/Library/Application Support/Adminium/npm/user.npmrc',
  npmGlobalConfig: '/Users/a/Library/Application Support/Adminium/npm/global.npmrc',
  npmCache: '/Users/a/Library/Application Support/Adminium/npm/cache',
  starter: null as string | null,
};
const desktop = (over: Record<string, unknown> = {}): Record<string, string> => ({ [DESKTOP_PROGRAMS_ENV]: JSON.stringify({ ...APP, ...over }) });
const TERMINAL: Record<string, string> = {};

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-programs-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('desktopPrograms', () => {
  it('is nothing on a terminal', () => {
    expect(desktopPrograms(TERMINAL)).toBeNull();
    expect(desktopPrograms({ [DESKTOP_PROGRAMS_ENV]: '' })).toBeNull();
  });

  it('reads what the app wrote', () => {
    expect(desktopPrograms(desktop())).toEqual(APP);
    expect(desktopPrograms(desktop({ git: null }))?.git).toBeNull();
    // The starter's lockfile is carried by a release build, and by no other.
    expect(desktopPrograms(desktop({ starter: '/Applications/Adminium.app/Contents/Resources/starter' }))?.starter).toBe('/Applications/Adminium.app/Contents/Resources/starter');
    expect(desktopPrograms(desktop({ starter: undefined }))?.starter).toBeNull();
    expect(() => desktopPrograms(desktop({ starter: 'starter' }))).toThrow(/"starter" must be an absolute path/);
  });

  it.each([
    ['not JSON', 'npm', /is not JSON/],
    ['not an object', '"npm"', /must be an absolute path/],
    ['a relative program', JSON.stringify({ ...APP, binary: 'Adminium' }), /"binary" must be an absolute path/],
    ['no npm', JSON.stringify({ ...APP, npm: undefined }), /"npm" must be an absolute path/],
    ['a git by name', JSON.stringify({ ...APP, git: 'git' }), /"git" must be an absolute path or null/],
    ['no git key at all', JSON.stringify({ ...APP, git: undefined }), /"git" must be an absolute path or null/],
  ])('refuses a value that is %s, rather than falling back to the terminal’s answer', (_label, value, message) => {
    expect(() => desktopPrograms({ [DESKTOP_PROGRAMS_ENV]: value })).toThrow(message);
    // And so does every question asked of it.
    expect(() => nodeProgram(['-v'], { [DESKTOP_PROGRAMS_ENV]: value })).toThrow(message);
  });
});

describe('Node, with arguments', () => {
  it('on a terminal: this process’s own program', () => {
    expect(nodeProgram(['--test', 'a.test.js'], TERMINAL)).toEqual({ command: process.execPath, args: ['--test', 'a.test.js'], env: {} });
  });

  it('in the desktop app: the app’s main program, asked to be Node, never this process’s own path', () => {
    const launch = nodeProgram(['--test', 'a.test.js'], desktop());
    expect(launch).toEqual({ command: APP.binary, args: ['--test', 'a.test.js'], env: { ELECTRON_RUN_AS_NODE: '1' } });
    expect(launch.command).not.toBe(process.execPath);
  });
});

describe('the package manager', () => {
  it('on a terminal: the folder’s own by its lockfile, else the one named, else the one running the command', () => {
    expect(packageManagerProgram(root, TERMINAL).manager).toBe('npm');
    expect(packageManagerProgram(root, { npm_config_user_agent: 'pnpm/10.1.0 node/v22' }).manager).toBe('pnpm');
    expect(packageManagerProgram(root, TERMINAL, 'yarn').manager).toBe('yarn');
    writeFileSync(join(root, 'pnpm-lock.yaml'), '');
    const program = packageManagerProgram(root, TERMINAL);
    expect(program.manager).toBe('pnpm');
    expect(program.launch(['install'])).toEqual({ command: 'pnpm', args: ['install'], env: {} });
    expect(program.note).toBeNull();
  });

  it('in the desktop app: always the carried npm, as the app’s program with npm’s entry first (no .cmd for a shell to run)', () => {
    const program = packageManagerProgram(root, desktop(), 'pnpm');
    expect(program.manager).toBe('npm');
    const launch = program.launch(['install', 'react@19.2.0', '--save-exact']);
    expect(launch.command).toBe(APP.binary);
    expect(launch.args).toEqual([join(APP.npm, 'bin', 'npm-cli.js'), 'install', 'react@19.2.0', '--save-exact']);
    expect([launch.command, ...launch.args].some((part) => /\.(cmd|bat|ps1)$/i.test(part))).toBe(false);
    expect(launch.env).toEqual({
      ELECTRON_RUN_AS_NODE: '1',
      NPM_CONFIG_USERCONFIG: APP.npmUserConfig,
      NPM_CONFIG_GLOBALCONFIG: APP.npmGlobalConfig,
      NPM_CONFIG_CACHE: APP.npmCache,
      NPM_CONFIG_REGISTRY: NPM_REGISTRY,
      NPM_CONFIG_UPDATE_NOTIFIER: 'false',
      NPM_CONFIG_FUND: 'false',
      NPM_CONFIG_IGNORE_SCRIPTS: 'true',
    });
    expect(NPM_REGISTRY).toBe('https://registry.npmjs.org/');
    expect(program.note).toBeNull();
  });

  it.each([
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
  ])('in the desktop app a folder with %s is told, installed with npm, and its file left alone', (file, manager) => {
    writeFileSync(join(root, file), 'theirs');
    const program = packageManagerProgram(root, desktop());
    expect(program.manager).toBe('npm');
    expect(program.launch(['install']).command).toBe(APP.binary);
    expect(program.note).toBe(`This project uses ${manager}. The app installs with npm; your ${manager} file (${file}) is left as it is.`);
  });

  it('adds exact versions with no install scripts, in each manager’s words', () => {
    expect(addPackagesArgs('npm', ['a@1.0.0'])).toEqual(['install', 'a@1.0.0', '--ignore-scripts', '--save-exact']);
    expect(addPackagesArgs('pnpm', ['a@1.0.0'])).toEqual(['add', 'a@1.0.0', '--ignore-scripts', '--save-exact']);
    expect(addPackagesArgs('yarn', ['a@1.0.0'])).toEqual(['add', 'a@1.0.0', '--ignore-scripts', '--exact']);
    expect(addPackagesArgs('bun', ['a@1.0.0'])).toEqual(['add', 'a@1.0.0', '--ignore-scripts', '--exact']);
  });

  it('is named npm in the desktop app whatever started the app', () => {
    expect(namedPackageManager({ npm_config_user_agent: 'pnpm/10.1.0' })).toBe('pnpm');
    expect(namedPackageManager({ ...desktop(), npm_config_user_agent: 'pnpm/10.1.0' })).toBe('npm');
  });
});

describe('an app’s own build line', () => {
  it('on a terminal: the person’s PATH, untouched', () => {
    expect(buildLinePath('/usr/bin:/bin', TERMINAL)).toBe('/usr/bin:/bin');
    expect(buildLinePath(undefined, TERMINAL)).toBeUndefined();
  });

  it('in the desktop app: the stand-ins’ folder first', () => {
    expect(buildLinePath('/usr/bin:/bin', desktop())).toBe(`${APP.shims}${delimiter}/usr/bin:/bin`);
    expect(buildLinePath(undefined, desktop())).toBe(APP.shims);
    expect(buildLinePath('', desktop())).toBe(APP.shims);
  });
});

describe('git, and a browser', () => {
  it('on a terminal: git by name, and a page may be opened', () => {
    expect(gitProgram(TERMINAL)).toBe('git');
    expect(mayOpenBrowser(TERMINAL)).toBe(true);
  });

  it('in the desktop app: the git the app found or none, and never a browser beside its window', () => {
    expect(gitProgram(desktop())).toBe('/usr/bin/git');
    expect(gitProgram(desktop({ git: null }))).toBeNull();
    expect(mayOpenBrowser(desktop())).toBe(false);
  });
});
