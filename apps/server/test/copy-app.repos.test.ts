// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Make it yours", against the six apps as they were released.
 *
 * Never in CI: it reads the app repositories beside this one
 * (`ADMINIUM_APP_REPOS=<folder>`), each at its newest tag. For every app the
 * manifest is renamed to a key with a hyphen in it, and has to validate as a
 * local app with nothing of the old key left where a ref goes; and the
 * source's known places are each found.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';

import { validateManifest } from '@adminium/manifest';
import { describe, expect, it } from 'vitest';

import { isDropped, planCopy, renameManifest, renameSource } from '../src/project/apps/copy-app.js';
import { readSourceArchive } from '../src/project/apps/source-archive.js';

const REPOS = process.env['ADMINIUM_APP_REPOS'] ?? '';
const APPS = [
  ['point-of-sale', 'pos'],
  ['client-portal', 'clients'],
  ['online-ordering', 'ordering'],
  ['event-ticketing', 'events'],
  ['clinic-desk', 'clinic'],
  ['hotel-reservations', 'hotel'],
] as const;

const git = (repo: string, ...args: string[]): string => execFileSync('git', ['-C', join(REPOS, repo), ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

describe.skipIf(REPOS === '' || !existsSync(REPOS))('the six apps, made one’s own', () => {
  for (const [repo, key] of APPS) {
    it(`${key}: the manifest validates under a new key, and the source’s places are found`, () => {
      const tag = git(repo, 'tag', '--sort=-creatordate').split('\n')[0] as string;
      const manifest = JSON.parse(git(repo, 'show', `${tag}:manifest.json`)) as Record<string, unknown>;
      expect(manifest['key']).toBe(key);
      const renamed = renameManifest(manifest, 'my-shop', 'My shop');
      const checked = validateManifest(renamed.manifest, { allowLocalPublisher: true });
      expect(checked.ok ? [] : checked.issues.slice(0, 8)).toEqual([]);
      expect(renamed.leftovers).toEqual([]);
      expect(renamed.pages.size).toBeGreaterThan(5);

      const files = git(repo, 'ls-tree', '-r', '--name-only', tag).split('\n').filter((file) => file !== '' && !isDropped(file));
      const changes = files.flatMap((file) => (/\.(tsx?|json)$/.test(file) ? renameSource(file, git(repo, 'show', `${tag}:${file}`), key, 'my-shop', renamed.pages).changes : []));
      const what = (name: string): number => changes.filter((change) => change.what === name).reduce((sum, change) => sum + change.count, 0);
      console.info(`${key} ${tag}: ${String(files.length)} files kept; ${[...new Set(changes.map((change) => change.what))].filter((name) => !name.startsWith('the page ')).map((name) => `${name} ×${String(what(name))}`).join(', ')}; pages ×${String(changes.filter((change) => change.what.startsWith('the page ')).reduce((sum, change) => sum + change.count, 0))}`);
      // The four places in package.json, the key constant, and the sample's app.
      expect(what('the screens’ address')).toBe(2);
      expect(what('the build’s folder')).toBe(2);
      expect(what('the package’s name')).toBe(1);
      expect(what('the key constant')).toBeGreaterThanOrEqual(1);
      expect(what('the sample’s app')).toBe(1);
    });
  }
});

/** The copy written to a folder and built with its own command: `ADMINIUM_APP_BUILD=<folder>` and `ADMINIUM_APP_ONLY=<key>`. */
const BUILD = process.env['ADMINIUM_APP_BUILD'] ?? '';
describe.skipIf(REPOS === '' || BUILD === '')('a copy, built with its own build', { timeout: 900_000 }, () => {
  for (const [repo, key] of APPS.filter(([, candidate]) => (process.env['ADMINIUM_APP_ONLY'] ?? candidate) === candidate)) {
    it(`${key}: installs its packages and builds both sides under the new address`, () => {
      const tag = git(repo, 'tag', '--sort=-creatordate').split('\n')[0] as string;
      const names = git(repo, 'ls-tree', '-r', '--name-only', tag).split('\n').filter((file) => file !== '');
      const source = new Map(names.map((file) => [file, execFileSync('git', ['-C', join(REPOS, repo), 'show', `${tag}:${file}`], { maxBuffer: 256 * 1024 * 1024 })]));
      const plan = planCopy(source, { to: 'my-shop', name: 'My shop' });
      expect(plan.problems).toEqual([]);
      // Its own package and an empty list of releases, not the original's (spec 16).
      expect((JSON.parse(plan.files.get('package.json')?.toString('utf8') ?? '{}') as { name?: string }).name).toBe('my-shop');
      expect(JSON.parse(plan.files.get('RELEASES.json')?.toString('utf8') ?? 'null')).toEqual({ schemaVersion: 1, releases: [] });
      const dir = join(BUILD, key);
      rmSync(dir, { recursive: true, force: true });
      for (const [file, bytes] of plan.files) {
        mkdirSync(dirname(join(dir, file)), { recursive: true });
        writeFileSync(join(dir, file), bytes);
      }
      const run = (line: string): void => {
        execFileSync('sh', ['-c', line], { cwd: dir, stdio: 'pipe', env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '' } });
      };
      run(plan.build.install);
      run(plan.build.command);
      for (const side of ['staff', 'customer']) expect(existsSync(join(dir, plan.build.output, side, 'index.html')), side).toBe(true);
    });
  }
});

/** The archive GitHub serves for a tag, read and renamed: `ADMINIUM_APP_ARCHIVE=<file.tgz>`. */
const ARCHIVE = process.env['ADMINIUM_APP_ARCHIVE'] ?? '';
describe.skipIf(ARCHIVE === '')('the archive GitHub serves', () => {
  it('reads, and plans a copy with no problem', () => {
    const files = readSourceArchive(readFileSync(ARCHIVE));
    expect(files.has('manifest.json')).toBe(true);
    const plan = planCopy(files, { to: 'my-shop', name: 'My shop' });
    expect(plan.problems).toEqual([]);
    console.info(`${String(files.size)} files in the archive, ${String(plan.files.size)} in the copy`);
  });
});
