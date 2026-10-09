// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The programs a project's server may start, as the app provides them: its own
 * main program run as Node, the npm it carries, and three stand-ins (`node`,
 * `npm`, `npx`) for the lines an app's author wrote.
 *
 * MADE AT EVERY LAUNCH, from this launch's own path. The app's path is not a
 * constant: it changes when the app is moved, updated, run from its disk image
 * or mounted as an AppImage, and a stand-in that names last week's path starts
 * nothing. They live in the app's own data folder, never in a project.
 *
 * The path is MAIN's `process.execPath`. The server child's own is a helper
 * that cannot run as Node, which is the whole reason the child is told.
 *
 * Electron-free, so every line is tested under plain Node.
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, win32 } from 'node:path';

/** The value of `ADMINIUM_DESKTOP_PROGRAMS`, as the server package reads it (`project/programs.ts` there). */
export interface DesktopProgramsValue {
  binary: string;
  npm: string;
  shims: string;
  git: string | null;
  npmUserConfig: string;
  npmGlobalConfig: string;
  npmCache: string;
}

export interface ProvideProgramsInput {
  /** Main's own `process.execPath`. */
  binary: string;
  /** The folder of the carried npm (it holds `bin/npm-cli.js`). */
  npmDir: string;
  /** The app's own data folder. */
  userDataDir: string;
  /** A git that works here, or `null`. */
  git: string | null;
  platform: NodeJS.Platform;
}

/** A path inside single quotes for `sh`: the one character that needs care is the quote itself. */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The text of a stand-in for `sh`. `entry` is npm's or npx's own file; none for `node`. */
export function shimForSh(binary: string, entry: string | null, npm: Pick<DesktopProgramsValue, 'npmUserConfig' | 'npmGlobalConfig' | 'npmCache'>): string {
  const lines = ['#!/bin/sh', '# Made by Adminium at every launch. It starts the app’s own program as Node.', 'export ELECTRON_RUN_AS_NODE=1'];
  if (entry !== null) {
    lines.push(
      `export NPM_CONFIG_USERCONFIG=${shQuote(npm.npmUserConfig)}`,
      `export NPM_CONFIG_GLOBALCONFIG=${shQuote(npm.npmGlobalConfig)}`,
      `export NPM_CONFIG_CACHE=${shQuote(npm.npmCache)}`,
      'export NPM_CONFIG_UPDATE_NOTIFIER=false',
    );
  }
  lines.push(`exec ${shQuote(binary)}${entry === null ? '' : ` ${shQuote(entry)}`} "$@"`, '');
  return lines.join('\n');
}

/**
 * The text of a stand-in for `cmd.exe`. Paths go inside double quotes; a
 * Windows path cannot hold one. `%` is doubled so a folder named `100%` is not
 * read as a variable.
 */
export function shimForCmd(binary: string, entry: string | null, npm: Pick<DesktopProgramsValue, 'npmUserConfig' | 'npmGlobalConfig' | 'npmCache'>): string {
  const q = (value: string): string => `"${value.replace(/%/g, '%%')}"`;
  const lines = ['@echo off', 'rem Made by Adminium at every launch. It starts the app’s own program as Node.', 'setlocal', 'set ELECTRON_RUN_AS_NODE=1'];
  if (entry !== null) {
    lines.push(
      `set "NPM_CONFIG_USERCONFIG=${npm.npmUserConfig.replace(/%/g, '%%')}"`,
      `set "NPM_CONFIG_GLOBALCONFIG=${npm.npmGlobalConfig.replace(/%/g, '%%')}"`,
      `set "NPM_CONFIG_CACHE=${npm.npmCache.replace(/%/g, '%%')}"`,
      'set NPM_CONFIG_UPDATE_NOTIFIER=false',
    );
  }
  lines.push(`${q(binary)}${entry === null ? '' : ` ${q(entry)}`} %*`, 'exit /b %ERRORLEVEL%', '');
  return lines.join('\r\n');
}

/**
 * Write the stand-ins and npm's two (empty) settings files, and say where
 * everything is. Safe to call at every launch: it writes the same files again.
 */
export function provideDesktopPrograms(input: ProvideProgramsInput): DesktopProgramsValue {
  const home = join(input.userDataDir, 'programs');
  const shims = join(home, 'bin');
  const npmHome = join(home, 'npm');
  const value: DesktopProgramsValue = {
    binary: input.binary,
    npm: input.npmDir,
    shims,
    git: input.git,
    npmUserConfig: join(npmHome, 'user.npmrc'),
    npmGlobalConfig: join(npmHome, 'global.npmrc'),
    npmCache: join(npmHome, 'cache'),
  };
  mkdirSync(shims, { recursive: true });
  mkdirSync(value.npmCache, { recursive: true });
  // The app's own, and empty: a person's `~/.npmrc` (a token, another registry) decides nothing here.
  for (const file of [value.npmUserConfig, value.npmGlobalConfig]) if (!existsSync(file)) writeFileSync(file, '');
  const windows = input.platform === 'win32';
  // The paths written INTO a stand-in are the target system's, whatever system writes them.
  const inApp = windows ? win32.join : join;
  for (const [name, entry] of [
    ['node', null],
    ['npm', inApp(input.npmDir, 'bin', 'npm-cli.js')],
    ['npx', inApp(input.npmDir, 'bin', 'npx-cli.js')],
  ] as const) {
    const file = join(shims, windows ? `${name}.cmd` : name);
    writeFileSync(file, windows ? shimForCmd(input.binary, entry, value) : shimForSh(input.binary, entry, value));
    if (!windows) chmodSync(file, 0o755);
  }
  return value;
}
