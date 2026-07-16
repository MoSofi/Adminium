/**
 * Dashboard-build resolution + the published-package wiring (01 §4.1: the
 * `adminium` package "bundles the server, the dashboard `dist/`, and the meta
 * migrations — one `npx adminium` is a complete install").
 *
 * The resolver's contract is an ORDER, so that is what is asserted — checking
 * "did it find a build" would only test whichever tree the suite happens to run
 * in, and would flip meaning between a dev checkout and a published tarball.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BUNDLED_DASHBOARD_DIR,
  resolveStaticRoot,
  staticRootCandidates,
} from '../src/cli/static-root.js';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('staticRootCandidates', () => {
  it('probes the published-tarball location before the monorepo one', () => {
    const [bundled, monorepo] = staticRootCandidates();
    expect(bundled).toBe(join(serverRoot, BUNDLED_DASHBOARD_DIR));
    expect(monorepo).toBe(resolve(serverRoot, '..', 'dashboard', 'dist'));
  });

  it('finds the monorepo candidate exactly where demo-v01.mjs looks', () => {
    // demo-v01.mjs: join(repoRoot, 'apps', 'dashboard', 'dist')
    const repoRoot = resolve(serverRoot, '..', '..');
    expect(staticRootCandidates()).toContain(join(repoRoot, 'apps', 'dashboard', 'dist'));
  });

  it('puts an explicit override ahead of both', () => {
    const candidates = staticRootCandidates({ override: '/custom/build' });
    expect(candidates[0]).toBe('/custom/build');
    expect(candidates).toHaveLength(3);
  });
});

describe('resolveStaticRoot', () => {
  it('returns the first candidate that holds an index.html', () => {
    const found = resolveStaticRoot({
      exists: (path) => path === join(serverRoot, BUNDLED_DASHBOARD_DIR, 'index.html'),
    });
    expect(found).toBe(join(serverRoot, BUNDLED_DASHBOARD_DIR));
  });

  it('falls through to the monorepo build when the bundled copy is absent', () => {
    const monorepo = resolve(serverRoot, '..', 'dashboard', 'dist');
    const found = resolveStaticRoot({ exists: (path) => path === join(monorepo, 'index.html') });
    expect(found).toBe(monorepo);
  });

  it('requires index.html, not merely the directory — the static plugin needs the file', () => {
    expect(resolveStaticRoot({ exists: (path) => !path.endsWith('index.html') })).toBeUndefined();
  });

  it('returns undefined when nothing is built, so the server still boots API-only', () => {
    expect(resolveStaticRoot({ exists: () => false })).toBeUndefined();
  });

  it('honors an override that exists', () => {
    const found = resolveStaticRoot({
      override: '/custom/build',
      exists: (path) => path === join('/custom/build', 'index.html'),
    });
    expect(found).toBe('/custom/build');
  });
});

describe('package.json — the published `adminium` package (01 §4.1)', () => {
  it('exposes the `adminium` bin pointing at the compiled CLI entry', async () => {
    const pkg = JSON.parse(await readFile(join(serverRoot, 'package.json'), 'utf8')) as {
      bin: Record<string, string>;
    };
    expect(pkg.bin.adminium).toBe('./dist/cli/index.js');
  });

  it('ships the server build and the bundled dashboard in the tarball', async () => {
    const pkg = JSON.parse(await readFile(join(serverRoot, 'package.json'), 'utf8')) as {
      files: string[];
    };
    expect(pkg.files).toContain('dist');
    expect(pkg.files).toContain(BUNDLED_DASHBOARD_DIR);
  });

  it('depends on better-sqlite3 at runtime — the embedded meta fallback needs it', async () => {
    const pkg = JSON.parse(await readFile(join(serverRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    // §3.1 OD-1 makes embedded SQLite the default for a bare `adminium start`,
    // so the driver cannot be a devDependency of the published package.
    expect(pkg.dependencies['better-sqlite3']).toBeDefined();
    expect(pkg.devDependencies['better-sqlite3']).toBeUndefined();
  });

  it('bundles the meta migrations by depending on @adminium/meta, which owns them', async () => {
    const pkg = JSON.parse(await readFile(join(serverRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['@adminium/meta']).toBeDefined();
  });

  it('the CLI entry carries a shebang, without which `bin` cannot execute', async () => {
    const source = await readFile(join(serverRoot, 'src', 'cli', 'index.ts'), 'utf8');
    expect(source.startsWith('#!/usr/bin/env node')).toBe(true);
  });
});
