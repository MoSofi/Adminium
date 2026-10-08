// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Designer's versions, against a real git, inside a person's own
 * repository that does everything it can to get in the way: a hook that
 * fails every commit, signing switched on, work staged and not committed.
 * Versions must be made and restored all the same, and the person's
 * repository must be exactly as it was, byte for byte.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DesignerSession } from '../src/designer/session-store.js';
import { createVersions, type Versions } from '../src/designer/versions.js';

let root: string;
let versions: Versions;
const session = { id: 'ds_000000000000000000000001', appKey: 'repairs', createdApp: true } as DesignerSession;

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
const put = (path: string, text: string): void => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
};
const read = (path: string): string | null => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null);

/** Everything about the person's repository a version could disturb. */
const theirs = (): Record<string, string> => ({
  head: git('rev-parse', 'HEAD'),
  // What is staged, and every entry of the index (a refreshed file stat is not a change).
  staged: git('diff', '--cached'),
  index: git('ls-files', '--stage'),
  log: git('log', '--all', '--format=%H %s'),
  refs: git('for-each-ref'),
  reflog: existsSync(join(root, '.git', 'logs', 'HEAD')) ? readFileSync(join(root, '.git', 'logs', 'HEAD'), 'utf8') : '',
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-versions-'));
  versions = createVersions(root);
  if (!hasGit) return;
  git('init', '--quiet');
  git('config', 'user.name', 'Person');
  git('config', 'user.email', 'person@example.test');
  put('README.md', 'mine\n');
  put('apps/repairs/manifest/app.json', '{"v":0}');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'their first commit');
  // Now make the repository as hostile as a real one can be.
  git('config', 'commit.gpgsign', 'true');
  git('config', 'user.signingkey', 'NO-SUCH-KEY');
  put('.git/hooks/pre-commit', '#!/bin/sh\necho refused >&2\nexit 1\n');
  chmodSync(join(root, '.git/hooks/pre-commit'), 0o755);
  put('README.md', 'mine, edited and staged\n');
  git('add', 'README.md');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!hasGit)('the Designer’s versions', () => {
  it('are recorded beside the person’s repository, never in it', async () => {
    const before = theirs();
    await versions.snapshot(session);
    put('apps/repairs/manifest/app.json', '{"v":1}');
    put('hooks/on-job.ts', 'export default 1;');
    expect(await versions.commit(session)).toEqual({ n: 1, name: 'v1' });
    put('apps/repairs/manifest/app.json', '{"v":2}');
    expect(await versions.commit(session)).toEqual({ n: 2, name: 'v2' });
    // Nothing changed: no version.
    expect(await versions.commit(session)).toBeNull();

    expect((await versions.list(session.id)).map((version) => [version.n, version.name, version.current])).toEqual([
      [2, 'v2', true],
      [1, 'v1', false],
    ]);
    expect(theirs()).toEqual(before);
    expect(existsSync(join(root, '.adminium/designer/versions.git/HEAD'))).toBe(true);
  });

  it('record only the app’s folder, hooks and actions', async () => {
    put('apps/repairs/manifest/app.json', '{"v":1}');
    put('apps/other/manifest/app.json', '{"other":true}');
    put('data/secret.db', 'x');
    await versions.commit(session);
    const files = execFileSync('git', ['--git-dir', join(root, '.adminium/designer/versions.git'), 'ls-tree', '-r', '--name-only', session.id], { encoding: 'utf8' })
      .trim()
      .split('\n');
    expect(files).toEqual(['apps/repairs/manifest/app.json']);
  });

  it('go back as a new version on top, deleting only what the version did not have, inside the app', async () => {
    put('apps/repairs/manifest/app.json', '{"v":1}');
    await versions.commit(session);
    put('apps/repairs/manifest/app.json', '{"v":2}');
    put('apps/repairs/manifest/tables/jobs.json', '{"ref":"jobs"}');
    put('apps/other/x.json', 'not the Designer’s');
    put('notes.md', 'not the Designer’s');
    await versions.commit(session);
    const before = theirs();

    expect(await versions.restore(session, 1, { record: true })).toEqual({ n: 3, name: 'v3 · Back to v1' });
    expect(read('apps/repairs/manifest/app.json')).toBe('{"v":1}');
    expect(read('apps/repairs/manifest/tables/jobs.json')).toBeNull();
    expect(read('apps/other/x.json')).toBe('not the Designer’s');
    expect(read('notes.md')).toBe('not the Designer’s');
    expect((await versions.list(session.id)).map((version) => version.name)).toEqual(['v3 · Back to v1', 'v2', 'v1']);
    expect(theirs()).toEqual(before);
  });

  it('put the files back after a stop, as the last version had them, without a new version', async () => {
    put('apps/repairs/manifest/app.json', '{"v":1}');
    await versions.commit(session);
    put('apps/repairs/manifest/app.json', '{"half":"made"}');
    put('apps/repairs/manifest/tables/half.json', '{}');
    expect(await versions.restore(session, 1, { record: false })).toBeNull();
    expect(read('apps/repairs/manifest/app.json')).toBe('{"v":1}');
    expect(read('apps/repairs/manifest/tables/half.json')).toBeNull();
    expect(await versions.list(session.id)).toHaveLength(1);
  });

  it('put the files back to before the session when it has no version yet', async () => {
    await versions.snapshot(session);
    put('apps/repairs/manifest/app.json', '{"changed":true}');
    await versions.restore(session, 0, { record: false });
    expect(read('apps/repairs/manifest/app.json')).toBe('{"v":0}');
  });

  it('say which files are not as the newest version has them: changed, added and gone, and never what a build left', async () => {
    // Nothing recorded for this session yet: what changed cannot be known.
    expect(await versions.changed(session)).toBeNull();
    // Before the first version the folder is held against what it was before the session.
    await versions.snapshot(session);
    expect(await versions.changed(session)).toEqual([]);
    put('apps/repairs/manifest/app.json', '{"v":1}');
    expect(await versions.changed(session)).toEqual(['apps/repairs/manifest/app.json']);

    put('apps/repairs/customer/src/App.tsx', 'one');
    put('hooks/on-save.ts', 'export {};');
    await versions.commit(session);
    expect(await versions.changed(session)).toEqual([]);
    put('apps/repairs/customer/src/App.tsx', 'two');
    put('apps/repairs/manifest/tables/half made.json', '{}');
    rmSync(join(root, 'hooks/on-save.ts'));
    // The app's own build output, another app and the person's own files are nobody's unfinished change.
    put('apps/repairs/dist-customer/index.js', 'built');
    put('apps/repairs/dist/index.js', 'built');
    put('apps/other/manifest/app.json', '{}');
    put('README.md', 'mine again\n');
    expect((await versions.changed(session))?.sort()).toEqual(['apps/repairs/customer/src/App.tsx', 'apps/repairs/manifest/tables/half made.json', 'hooks/on-save.ts']);
    // Looking changes nothing: no version was made, and the person's repository is as it was.
    expect(await versions.list(session.id)).toHaveLength(1);
    await versions.restore(session, 1, { record: false });
    expect((await versions.changed(session))?.filter((path) => !path.includes('/dist'))).toEqual([]);
  });

  it('refuse a version that is not there', async () => {
    await versions.commit(session);
    await expect(versions.restore(session, 9, { record: true })).rejects.toThrow('no version 9');
  });
});

describe('versions with no git on the machine', () => {
  it('are off, and say so', async () => {
    const off = createVersions(root, { git: join(root, 'no-such-git') });
    expect(await off.available()).toBe(false);
    expect(await off.commit(session)).toBeNull();
    expect(await off.list(session.id)).toEqual([]);
    await expect(off.restore(session, 1, { record: true })).rejects.toThrow('Versions are off');
    expect(await off.changed(session)).toBeNull();
  });
});
