// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Writing a project's files: what a new folder gets, and what an existing one
 * keeps.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  dockerfile,
  ESBUILD_RANGE,
  mergePackageJson,
  missingIgnoreLines,
  NODE_RANGE,
  REACT_TYPES_RANGE,
  scaffoldProject,
} from '../src/project/scaffold.js';
import { createSampleDatabase, sampleSeedCandidates } from '../src/project/sample.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adminium-scaffold-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const base = { packageName: 'shop-admin', adminiumSpec: '0.2.10' };

describe('package.json', () => {
  it('is created with the pinned version, the scripts and the esbuild dev dependency', () => {
    const { json, scripts, notes } = mergePackageJson(null, base);
    expect(json).toMatchObject({
      name: 'shop-admin',
      private: true,
      type: 'module',
      scripts: {
        dev: 'adminium dev',
        build: 'adminium build',
        start: 'adminium start',
        check: 'adminium check',
        pull: 'adminium pull',
      },
      dependencies: { '@adminiumjs/adminium': '0.2.10' },
      devDependencies: { esbuild: ESBUILD_RANGE, '@types/react': REACT_TYPES_RANGE },
      engines: { node: NODE_RANGE },
    });
    expect(scripts).toEqual({ dev: 'dev', build: 'build', start: 'start', check: 'check', pull: 'pull' });
    expect(notes).toEqual([]);
  });

  it("keeps an app's own scripts and names Adminium's beside them", () => {
    const existing = {
      name: 'my-app',
      version: '3.1.0',
      scripts: { dev: 'vite', build: 'vite build', test: 'vitest' },
      dependencies: { react: '^19.0.0' },
    };
    const { json, scripts, notes } = mergePackageJson(existing, base);
    expect(json.scripts).toEqual({
      dev: 'vite',
      build: 'vite build',
      test: 'vitest',
      'adminium:dev': 'adminium dev',
      'adminium:build': 'adminium build',
      start: 'adminium start',
      check: 'adminium check',
      pull: 'adminium pull',
    });
    expect(scripts).toEqual({ dev: 'adminium:dev', build: 'adminium:build', start: 'start', check: 'check', pull: 'pull' });
    expect(notes.join('\n')).toContain('Your "dev" script is kept');
    // Nothing else of theirs moves.
    expect(json.name).toBe('my-app');
    expect(json.version).toBe('3.1.0');
    expect(json).not.toHaveProperty('type');
    expect(json).not.toHaveProperty('engines');
    expect(json.dependencies).toEqual({ react: '^19.0.0', '@adminiumjs/adminium': '0.2.10' });
  });

  it('keeps a version of Adminium the folder already names, and says so', () => {
    const { json, notes } = mergePackageJson({ dependencies: { '@adminiumjs/adminium': '0.2.9' } }, base);
    expect((json.dependencies as Record<string, string>)['@adminiumjs/adminium']).toBe('0.2.9');
    expect(notes.join('\n')).toContain('"0.2.9"');
  });

  it('gives up with a clear message when both names are taken by something else', () => {
    expect(() =>
      mergePackageJson({ scripts: { dev: 'vite', 'adminium:dev': 'something else' } }, base),
    ).toThrow(/already has "dev" and "adminium:dev"/);
  });

  it('does not add esbuild or React types twice when the app already depends on them', () => {
    const { json } = mergePackageJson({ dependencies: { esbuild: '^0.25.0', '@types/react': '^18.3.0' } }, base);
    expect(json.devDependencies).toEqual({});
  });
});

describe('.gitignore lines', () => {
  it('counts a line as present whatever slashes surround it', () => {
    expect(missingIgnoreLines('/node_modules\ndata/\n', ['node_modules/', 'data/', '.adminium/', '.env'])).toEqual([
      '.adminium/',
      '.env',
    ]);
  });
});

describe('the Dockerfile', () => {
  it('builds on the official image at the same version, with the project baked in', () => {
    const text = dockerfile('npm', '0.2.10');
    expect(text).toContain('FROM ghcr.io/mosofi/adminium:0.2.10');
    expect(text).toContain('RUN npm ci');
    expect(text).toContain('RUN npx --no-install adminium build && rm -rf node_modules');
    // The whole folder: `start` compares the build with the sources it came from.
    expect(text).toContain('COPY --from=build --chown=node:node /project/ /project/');
    expect(text).toContain('ENV ADMINIUM_PROJECT_DIR=/project');
  });

  it('installs with the lockfile of the package manager in use', () => {
    expect(dockerfile('pnpm', '1.0.0')).toContain('pnpm install --frozen-lockfile');
    expect(dockerfile('yarn', '1.0.0')).toContain('yarn install --frozen-lockfile');
  });
});

describe('writing the files', () => {
  const opts = () => ({ ...base, root: dir, version: '0.2.10', packageManager: 'npm' as const });

  it('fills an empty folder', () => {
    const result = scaffoldProject(opts());
    expect(result.created.sort()).toEqual(
      [
        '.dockerignore',
        '.env.example',
        '.gitignore',
        'Dockerfile',
        'README.md',
        'actions/.gitkeep',
        'adminium.config.ts',
        'hooks/.gitkeep',
        'package.json',
        'tsconfig.json',
        'widgets/.gitkeep',
      ].sort(),
    );
    expect(result.merged).toEqual([]);
    expect(result.skipped).toEqual([]);
    const config = readFileSync(join(dir, 'adminium.config.ts'), 'utf8');
    expect(config).toContain("from '@adminiumjs/adminium'");
    expect(config).toContain("env('DATABASE_URL')");
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.env');
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('`npm run dev`');
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('defineHook');
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('defineWidget');
    expect(JSON.parse(readFileSync(join(dir, 'tsconfig.json'), 'utf8'))).toMatchObject({
      compilerOptions: { jsx: 'react-jsx' },
      include: ['adminium.config.ts', 'hooks', 'actions', 'pages', 'widgets'],
    });
  });

  it('never overwrites a file, and adds only what is missing to package.json and .gitignore', () => {
    writeFileSync(join(dir, 'README.md'), '# Mine\n');
    writeFileSync(join(dir, 'tsconfig.json'), '{ "mine": true }\n');
    writeFileSync(join(dir, '.gitignore'), 'node_modules/');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'mine', scripts: { start: 'node server.js' } }));

    const result = scaffoldProject(opts());

    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('# Mine\n');
    expect(readFileSync(join(dir, 'tsconfig.json'), 'utf8')).toBe('{ "mine": true }\n');
    expect(result.skipped.sort()).toEqual(['README.md', 'tsconfig.json']);
    expect(result.merged.sort()).toEqual(['.gitignore', 'package.json']);
    const gitignore = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(gitignore.startsWith('node_modules/\n\n# Adminium\n')).toBe(true);
    expect(gitignore.match(/node_modules/g)).toHaveLength(1);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.start).toBe('node server.js');
    expect(pkg.scripts['adminium:start']).toBe('adminium start');
    expect(result.scripts.start).toBe('adminium:start');
  });

  it('refuses a package.json it cannot read rather than replacing it', () => {
    writeFileSync(join(dir, 'package.json'), '{ not json');
    expect(() => scaffoldProject(opts())).toThrow(/package.json is not valid JSON/);
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe('{ not json');
    expect(existsSync(join(dir, 'adminium.config.ts'))).toBe(false);
  });
});

describe('the sample database', () => {
  it('looks for the seed in the package first, then beside the desktop app in a checkout', () => {
    const candidates = sampleSeedCandidates('file:///repo/apps/server/dist/project/sample.js');
    expect(candidates).toEqual([
      join('/repo/apps/server', 'samples', 'demo-seed.mjs'),
      join('/repo/apps', 'desktop', 'resources', 'demo', 'demo-seed.mjs'),
    ]);
  });

  it('says when this build has no sample, or a seed that cannot make one', async () => {
    const file = join(dir, 'data', 'sample.sqlite');
    await expect(createSampleDatabase(file, [join(dir, 'missing.mjs')])).rejects.toThrow(
      'The sample database is not included in this Adminium build.',
    );
    const seed = join(dir, 'seed.mjs');
    writeFileSync(seed, 'export const nothing = 1;\n');
    await expect(createSampleDatabase(file, [join(dir, 'missing.mjs'), seed])).rejects.toThrow(
      `${seed} does not export createDemoDatabase().`,
    );
    expect(existsSync(file)).toBe(false);
  });
});
