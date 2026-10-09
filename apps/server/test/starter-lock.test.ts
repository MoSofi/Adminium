// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DESKTOP_PROGRAMS_ENV } from '../src/project/programs.js';
import { addScreenPackagesTo, applyStarterLock, STARTER_REACT_VERSION, starterLockFor } from '../src/project/starter-lock.js';

const LISTED = { dependencies: { '@adminiumjs/adminium': '0.3.21', react: '19.2.0' }, devDependencies: { esbuild: '^0.28.0' } };
let root: string;
let starter: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-starter-'));
  starter = join(root, '.carried');
  mkdirSync(starter);
  writeFileSync(join(starter, 'starter.json'), JSON.stringify(LISTED));
  writeFileSync(join(starter, 'package-lock.json'), JSON.stringify({ name: 'starter', version: '0.0.0', lockfileVersion: 3, packages: { '': { name: 'starter', version: '0.0.0', ...LISTED }, 'node_modules/react': { version: '19.2.0', integrity: 'sha512-x' } } }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'juniper-kitchen', version: '0.1.0', private: true, ...LISTED }));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});
const env = (): Record<string, string> => ({
  [DESKTOP_PROGRAMS_ENV]: JSON.stringify({ binary: '/a', npm: '/n', shims: '/s', git: null, npmUserConfig: '/u', npmGlobalConfig: '/g', npmCache: '/c', starter }),
});

describe('the lockfile a new project starts with', () => {
  it('is laid in under the project’s own name when it was made for exactly what the project lists', () => {
    expect(applyStarterLock(root, env())).toBe(true);
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as { name: string; version: string; packages: Record<string, { name?: string; version?: string; integrity?: string }> };
    expect(lock.name).toBe('juniper-kitchen');
    expect(lock.packages['']).toMatchObject({ name: 'juniper-kitchen', version: '0.1.0' });
    // What it pins is untouched.
    expect(lock.packages['node_modules/react']).toEqual({ version: '19.2.0', integrity: 'sha512-x' });
  });

  it.each([
    ['another range', (m: typeof LISTED) => ({ ...m, dependencies: { ...m.dependencies, react: '^19.2.0' } })],
    ['one more package', (m: typeof LISTED) => ({ ...m, dependencies: { ...m.dependencies, zod: '4.0.0' } })],
    ['one package fewer', (m: typeof LISTED) => ({ ...m, devDependencies: {} })],
  ])('is not used for a project that lists %s: that one installs the ordinary way', (_label, change) => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'p', ...change(LISTED) }));
    expect(starterLockFor(root, starter)).toBeNull();
    expect(applyStarterLock(root, env())).toBe(false);
    expect(existsSync(join(root, 'package-lock.json'))).toBe(false);
  });

  it('never replaces a lockfile the project already has', () => {
    writeFileSync(join(root, 'package-lock.json'), '{"theirs":true}');
    expect(applyStarterLock(root, env())).toBe(false);
    expect(readFileSync(join(root, 'package-lock.json'), 'utf8')).toBe('{"theirs":true}');
  });

  it('is nothing on a terminal, in a build that carries none, or when what is carried is not whole', () => {
    expect(applyStarterLock(root, {})).toBe(false);
    rmSync(join(starter, 'package-lock.json'));
    expect(applyStarterLock(root, env())).toBe(false);
    writeFileSync(join(starter, 'package-lock.json'), '{"lockfileVersion":3}');
    expect(starterLockFor(root, starter)).toBeNull();
  });

  it('a project with no version of its own gets a lockfile with none', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'p', ...LISTED }));
    const lock = JSON.parse(starterLockFor(root, starter) ?? '{}') as { version?: string; packages: Record<string, { version?: string }> };
    expect(lock).not.toHaveProperty('version');
    expect(lock.packages['']).not.toHaveProperty('version');
  });
});

describe('addScreenPackagesTo', () => {
  it('lists React and the public client, exact, beside what is there', () => {
    addScreenPackagesTo(root, '0.3.21');
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(manifest.dependencies).toEqual({ '@adminiumjs/adminium': '0.3.21', react: STARTER_REACT_VERSION, 'react-dom': STARTER_REACT_VERSION, '@adminiumjs/public-client': '0.3.21' });
    expect(manifest.devDependencies).toEqual(LISTED.devDependencies);
  });

  it('leaves a folder with no package.json alone', () => {
    rmSync(join(root, 'package.json'));
    expect(() => addScreenPackagesTo(root, '0.3.21')).not.toThrow();
    expect(existsSync(join(root, 'package.json'))).toBe(false);
  });
});
