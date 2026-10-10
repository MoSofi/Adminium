// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { desktopPrograms } from '@adminium/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { carriedNpmDir, provideDesktopPrograms, shimForCmd, shimForSh } from './programs.js';

let userData: string;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), "adminium's programs "));
});
afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

const NPM = { npmUserConfig: '/u/user.npmrc', npmGlobalConfig: '/u/global.npmrc', npmCache: '/u/cache' };

describe('provideDesktopPrograms', () => {
  it('writes three stand-ins and npm’s own empty settings, and says where everything is', () => {
    const value = provideDesktopPrograms({ binary: '/Applications/Adminium.app/Contents/MacOS/Adminium', npmDir: '/Applications/Adminium.app/Contents/Resources/npm', userDataDir: userData, git: null, platform: 'darwin' });
    expect(value).toEqual({
      binary: '/Applications/Adminium.app/Contents/MacOS/Adminium',
      npm: '/Applications/Adminium.app/Contents/Resources/npm',
      shims: join(userData, 'programs', 'bin'),
      git: null,
      npmUserConfig: join(userData, 'programs', 'npm', 'user.npmrc'),
      npmGlobalConfig: join(userData, 'programs', 'npm', 'global.npmrc'),
      npmCache: join(userData, 'programs', 'npm', 'cache'),
      approvals: join(userData, 'approved-builds'),
      starter: null,
    });
    expect(readdirSync(value.shims).sort()).toEqual(['node', 'npm', 'npx']);
    for (const name of ['node', 'npm', 'npx']) expect(statSync(join(value.shims, name)).mode & 0o111, name).not.toBe(0);
    expect(readFileSync(value.npmUserConfig, 'utf8')).toBe('');
    expect(readFileSync(value.npmGlobalConfig, 'utf8')).toBe('');
    // The server package reads exactly this value.
    expect(desktopPrograms({ ADMINIUM_DESKTOP_PROGRAMS: JSON.stringify(value) })).toEqual(value);
  });

  it('writes them again at the next launch from that launch’s own path, and keeps settings a person changed', () => {
    const first = provideDesktopPrograms({ binary: '/Volumes/Adminium/Adminium.app/Contents/MacOS/Adminium', npmDir: '/Volumes/Adminium/npm', userDataDir: userData, git: null, platform: 'darwin' });
    writeFileSync(first.npmUserConfig, 'proxy=http://proxy.example:8080\n');
    const second = provideDesktopPrograms({ binary: '/Applications/Adminium.app/Contents/MacOS/Adminium', npmDir: '/Applications/Adminium.app/Contents/Resources/npm', userDataDir: userData, git: '/usr/bin/git', platform: 'darwin' });
    const node = readFileSync(join(second.shims, 'node'), 'utf8');
    expect(node).toContain("exec '/Applications/Adminium.app/Contents/MacOS/Adminium' \"$@\"");
    expect(node).not.toContain('/Volumes/');
    expect(readFileSync(second.npmUserConfig, 'utf8')).toBe('proxy=http://proxy.example:8080\n');
    expect(second.git).toBe('/usr/bin/git');
  });

  it('on Windows they are .cmd files', () => {
    const value = provideDesktopPrograms({ binary: 'C:\\Users\\Ava\\AppData\\Local\\Programs\\Adminium\\Adminium.exe', npmDir: 'C:\\Users\\Ava\\AppData\\Local\\Programs\\Adminium\\resources\\npm', userDataDir: userData, git: null, platform: 'win32' });
    expect(readdirSync(value.shims).sort()).toEqual(['node.cmd', 'npm.cmd', 'npx.cmd']);
    const npm = readFileSync(join(value.shims, 'npm.cmd'), 'utf8');
    const line = '"C:\\Users\\Ava\\AppData\\Local\\Programs\\Adminium\\Adminium.exe"';
    const entry = '"C:\\Users\\Ava\\AppData\\Local\\Programs\\Adminium\\resources\\npm\\bin\\npm-cli.js"';
    expect(npm).toContain(`) else (\r\n  ${line} ${entry} %*\r\n)`);
    expect(npm).toContain(`if defined ADMINIUM_BUILD_GUARD (\r\n  ${line} --require "%ADMINIUM_BUILD_GUARD%" ${entry} %*\r\n`);
  });

  it.skipIf(process.platform === 'win32')('a stand-in really starts the program it names as Node, from a folder with a quote and a space in its name', () => {
    // This test's own Node stands in for the app's program: what is proved is the script, its quoting and its environment.
    const value = provideDesktopPrograms({ binary: process.execPath, npmDir: join(userData, 'no npm here'), userDataDir: userData, git: null, platform: process.platform });
    const out = execFileSync(join(value.shims, 'node'), ['-e', 'process.stdout.write(JSON.stringify([process.env.ELECTRON_RUN_AS_NODE, process.argv.slice(1)]))', 'a b', "it's"], { encoding: 'utf8' });
    expect(JSON.parse(out)).toEqual(['1', ['a b', "it's"]]);
  });
});

describe('the guard of a copied app’s build', () => {
  it.skipIf(process.platform === 'win32')('is handed to the program as an argument when its name is set, before anything else runs', () => {
    const value = provideDesktopPrograms({ binary: process.execPath, npmDir: join(userData, 'no npm here'), userDataDir: userData, git: null, platform: process.platform });
    const guard = join(userData, "guard's file.cjs");
    writeFileSync(guard, 'globalThis.guarded = true;\n');
    const run = (env: Record<string, string>): string =>
      execFileSync(join(value.shims, 'node'), ['-e', 'process.stdout.write(String(globalThis.guarded === true))'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });
    expect(run({ ADMINIUM_BUILD_GUARD: guard })).toBe('true');
    // No build of a copied app: nothing is loaded first.
    expect(run({})).toBe('false');
    expect(run({ ADMINIUM_BUILD_GUARD: '' })).toBe('false');
  });

  it('comes before npm’s own entry, so npm and everything it starts is behind it', () => {
    const text = shimForSh('/app/Adminium', '/res/npm/bin/npm-cli.js', NPM);
    expect(text).toContain(`exec '/app/Adminium' --require "$ADMINIUM_BUILD_GUARD" '/res/npm/bin/npm-cli.js' "$@"`);
  });
});

describe('the stand-ins’ text', () => {
  it('sh: quotes a path that holds a quote, and gives npm the app’s own settings', () => {
    const text = shimForSh("/Users/o'brien/Adminium.app/Contents/MacOS/Adminium", '/res/npm/bin/npm-cli.js', NPM);
    expect(text.startsWith('#!/bin/sh\n')).toBe(true);
    expect(text).toContain("exec '/Users/o'\\''brien/Adminium.app/Contents/MacOS/Adminium' '/res/npm/bin/npm-cli.js' \"$@\"\n");
    expect(text).toContain("export NPM_CONFIG_USERCONFIG='/u/user.npmrc'");
    expect(shimForSh('/a', null, NPM)).not.toContain('NPM_CONFIG');
  });

  it('cmd: doubles a percent sign, and ends with the program’s own exit code', () => {
    const text = shimForCmd('C:\\100% mine\\Adminium.exe', null, NPM);
    expect(text).toContain('  "C:\\100%% mine\\Adminium.exe" %*\r\n)\r\nexit /b %ERRORLEVEL%\r\n');
    expect(shimForCmd('C:\\a.exe', 'C:\\npm\\bin\\npx-cli.js', NPM)).toContain('set "NPM_CONFIG_CACHE=/u/cache"');
  });
});

describe('carriedNpmDir', () => {
  it('is beside the archive in a packaged app, and this package’s own dependency from the sources', () => {
    expect(carriedNpmDir(true, '/Applications/Adminium.app/Contents/Resources', '/ignored')).toBe('/Applications/Adminium.app/Contents/Resources/npm');
    expect(carriedNpmDir(false, '/ignored', '/repo/apps/desktop/out/main', (path) => `/real${path}`)).toBe('/real/repo/apps/desktop/node_modules/npm');
    // A link that cannot be followed is still named, so the failure says which file is missing.
    expect(
      carriedNpmDir(false, '/ignored', '/repo/apps/desktop/out/main', () => {
        throw new Error('ENOENT');
      }),
    ).toBe('/repo/apps/desktop/node_modules/npm');
  });

  it('the dependency is there, with npm’s own entries, at the pinned version', () => {
    const dir = carriedNpmDir(false, '', join(import.meta.dirname, '..', '..', 'out', 'main'));
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))).toMatchObject({ name: 'npm', version: '10.9.8' });
    expect(readdirSync(join(dir, 'bin'))).toEqual(expect.arrayContaining(['npm-cli.js', 'npx-cli.js']));
  });
});

describe('the starter’s lockfile', () => {
  it('is named only when this build really carries one', () => {
    const base = { binary: '/app/Adminium', npmDir: '/app/npm', userDataDir: userData, git: null, platform: 'darwin' as const };
    const dir = join(userData, 'starter');
    expect(provideDesktopPrograms({ ...base, starterDir: dir }).starter).toBeNull();
    mkdirSync(dir);
    writeFileSync(join(dir, 'starter-lock.json'), '{}');
    expect(provideDesktopPrograms({ ...base, starterDir: dir }).starter).toBe(dir);
    expect(provideDesktopPrograms({ ...base, starterDir: null }).starter).toBeNull();
  });
});
