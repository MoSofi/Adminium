// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an app's source carries in its package, and what it never does: each
 * rule that keeps something that runs out of `source/`.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { fileLeftOut, folderLeftOut, readAppSource, sourceFileOf, strippedPackageJson } from '../src/project/apps/pack-source.js';

const text = (bytes: Uint8Array | null): string | null => (bytes === null ? null : Buffer.from(bytes).toString('utf8'));
const bytes = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'utf8'));

let dir: string | null = null;
afterEach(() => {
  if (dir !== null) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('the source an app package carries', () => {
  it('leaves out a build step, every tool config, esbuild scripts and shell scripts', () => {
    expect(fileLeftOut('build.json')).toBe('a build step');
    for (const name of ['vite.config.ts', 'vite.config.mjs', 'rollup.config.js', 'webpack.config.cjs', 'tsup.config.ts', 'postcss.config.cjs', 'tailwind.config.js', 'babel.config.js', 'metro.config.js', 'app.config.ts']) {
      expect(fileLeftOut(name), name).toBe('a tool’s config');
    }
    expect(fileLeftOut('esbuild.mjs')).toBe('a tool’s config');
    expect(fileLeftOut('esbuild.config.ts')).toBe('a tool’s config');
    for (const name of ['setup.sh', 'run.bat', 'go.cmd', 'x.ps1']) expect(fileLeftOut(name), name).toBe('a shell script');
    for (const name of ['.env', '.npmrc', '.gitignore']) expect(fileLeftOut(name), name).toBe('a hidden file');
    // What a person edits stays.
    for (const name of ['main.tsx', 'app.json', 'manifest.json', 'nav.json', 'logo.svg', 'config.json', 'site.css', 'tsconfig.json']) expect(fileLeftOut(name), name).toBeNull();
  });

  it('leaves out hidden folders and installed packages', () => {
    expect(folderLeftOut('node_modules')).toBe('installed packages');
    expect(folderLeftOut('.git')).toBe('a hidden folder');
    expect(folderLeftOut('src')).toBeNull();
  });

  it('rewrites a package.json without what runs, and leaves out one that is not JSON', () => {
    const stripped = strippedPackageJson(
      JSON.stringify({ name: 'shop', scripts: { postinstall: 'curl evil' }, bin: { x: 'x.js' }, gypfile: true, husky: {}, 'lint-staged': {}, 'simple-git-hooks': {}, dependencies: { react: '18.3.1' } }),
    );
    expect(JSON.parse(stripped ?? '{}')).toEqual({ name: 'shop', dependencies: { react: '18.3.1' } });
    expect(strippedPackageJson('{ not json')).toBeNull();
    expect(strippedPackageJson('[1]')).toBeNull();
    expect(text(sourceFileOf('staff/package.json', bytes('{"scripts":{"build":"x"},"name":"a"}')))).toBe('{\n  "name": "a"\n}\n');
  });

  it('keeps seeds/ out of source (the package has it at its root) unless a copy asks for it', () => {
    expect(sourceFileOf('seeds/sample.json', bytes('{}'))).toBeNull();
    expect(text(sourceFileOf('seeds/sample.json', bytes('{}'), { seeds: true }))).toBe('{}');
    expect(sourceFileOf('seeds/.hidden', bytes('x'), { seeds: true })).toBeNull();
    expect(sourceFileOf('staff/node_modules/react/index.js', bytes('x'))).toBeNull();
  });

  it('reads a folder as the package carries it: links skipped, never followed', () => {
    dir = mkdtempSync(join(tmpdir(), 'pack-source-'));
    const write = (path: string, body: string): void => {
      mkdirSync(join(dir as string, path, '..'), { recursive: true });
      writeFileSync(join(dir as string, path), body);
    };
    write('manifest.json', '{"key":"shop"}');
    write('staff/src/main.tsx', 'export {};');
    write('staff/vite.config.ts', 'export default {};');
    write('build.json', '{}');
    write('package.json', '{"name":"shop","scripts":{"dev":"vite"}}');
    write('node_modules/x/index.js', 'x');
    write('.env', 'SECRET=1');
    write('seeds/sample.json', '{}');
    symlinkSync(join(dir, 'manifest.json'), join(dir, 'staff', 'link.json'));
    const files = readAppSource(dir);
    expect(files.map((file) => file.path)).toEqual(['manifest.json', 'package.json', 'staff/src/main.tsx']);
    expect(text(files.find((file) => file.path === 'package.json')?.bytes ?? null)).toBe('{\n  "name": "shop"\n}\n');
  });
});
