// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A version after every turn, and going back to one.
 *
 * Versions are git commits — in a repository of their OWN, a bare one under
 * `.adminium/designer/versions.git` with the project folder as its work
 * tree. The person's own repository is never read or written: not its HEAD,
 * not its index, not its hooks, not its config or its signing. There may be
 * no such repository at all (`adminium new --no-git`, or a folder inside
 * another project), and versions still work.
 *
 * Only what the Designer may write is recorded: the app's folder, `hooks/`
 * and `actions/`. Going back writes those files as they were and records
 * that as a new version on top ("v5 · Back to v2"): the list only grows, and
 * data already in the database is kept.
 *
 * With no git on the machine, versions are off, and the page says so.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { DESIGNER_DIR, type DesignerSession } from './session-store.js';
import { scrubbedEnvironment } from './child.js';

export interface Version {
  n: number;
  name: string;
  at: number;
  current: boolean;
}

export interface Versions {
  available(): Promise<boolean>;
  /** Record what the folder holds now. Null when nothing changed since the last version, or versions are off. */
  commit(session: DesignerSession, label?: string): Promise<{ n: number; name: string } | null>;
  /** The state before the first turn, for "put the files back" when no version exists yet. */
  snapshot(session: DesignerSession): Promise<void>;
  list(sessionId: string): Promise<Version[]>;
  /**
   * Put the folder back as version `n` was (0: as it was before the session).
   * With `record`, that is saved as a new version on top.
   */
  restore(session: DesignerSession, n: number, opts: { record: boolean }): Promise<{ n: number; name: string } | null>;
  /**
   * The files that are not as the session's newest version has them (before
   * the first version: as the folder was before the session), project-relative:
   * changed, added or gone. What a build of the app's own left in the folder
   * is not counted. Null when that cannot be known (versions off, or a session
   * with nothing recorded).
   */
  changed(session: DesignerSession): Promise<string[] | null>;
}

const GIT_TIMEOUT_MS = 30_000;

export class VersionsError extends Error {
  override readonly name = 'VersionsError';
}

export function createVersions(root: string, opts: { git?: string } = {}): Versions {
  const gitBinary = opts.git ?? 'git';
  const gitDir = join(root, DESIGNER_DIR, 'versions.git');
  let known: boolean | null = null;

  function git(args: readonly string[], env: Record<string, string> = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        gitBinary,
        [
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'commit.gpgsign=false',
          '-c',
          'core.autocrlf=false',
          '-c',
          'core.quotepath=false',
          ...args,
        ],
        {
          cwd: root,
          timeout: GIT_TIMEOUT_MS,
          maxBuffer: 16 * 1024 * 1024,
          env: {
            ...scrubbedEnvironment(),
            GIT_DIR: gitDir,
            GIT_WORK_TREE: root,
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_AUTHOR_NAME: 'Adminium Designer',
            GIT_AUTHOR_EMAIL: 'designer@adminium.invalid',
            GIT_COMMITTER_NAME: 'Adminium Designer',
            GIT_COMMITTER_EMAIL: 'designer@adminium.invalid',
            GIT_TERMINAL_PROMPT: '0',
            ...env,
          },
        },
        (error, stdout, stderr) => {
          if (error !== null) reject(new VersionsError(`git ${args[0] ?? ''} failed: ${(stderr || error.message).trim()}`));
          else resolve(stdout);
        },
      );
    });
  }

  const branch = (sessionId: string): string => `refs/heads/${sessionId}`;
  const base = (sessionId: string): string => `refs/designer-base/${sessionId}`;
  const indexFile = (sessionId: string): string => join(gitDir, `index-${sessionId}`);
  /** The folders a version holds, as they exist now. */
  const paths = (session: DesignerSession): string[] => [`apps/${session.appKey}`, 'hooks', 'actions'].filter((path) => existsSync(join(root, path)));

  async function ensure(): Promise<void> {
    if (existsSync(join(gitDir, 'HEAD'))) return;
    mkdirSync(join(root, DESIGNER_DIR), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      execFile(gitBinary, ['init', '--bare', '--quiet', gitDir], { timeout: GIT_TIMEOUT_MS, env: { ...scrubbedEnvironment(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }, (error) => {
        if (error !== null) reject(new VersionsError(`git init failed: ${error.message}`));
        else resolve();
      });
    });
  }

  async function revision(ref: string): Promise<string | null> {
    try {
      return (await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim() || null;
    } catch {
      return null;
    }
  }

  /** The tree of the folder's jailed paths now, written into this repository. */
  async function treeOfFolder(session: DesignerSession): Promise<string> {
    const env = { GIT_INDEX_FILE: indexFile(session.id) };
    rmSync(indexFile(session.id), { force: true });
    const present = paths(session);
    if (present.length > 0) await git(['add', '-A', '--', ...present], env);
    return (await git(['write-tree'], env)).trim();
  }

  async function record(session: DesignerSession, name: (n: number) => string): Promise<{ n: number; name: string } | null> {
    const tree = await treeOfFolder(session);
    const parent = await revision(branch(session.id));
    if (parent !== null && (await git(['rev-parse', `${parent}^{tree}`])).trim() === tree) return null;
    const count = parent === null ? 0 : Number((await git(['rev-list', '--count', parent])).trim());
    const n = count + 1;
    const message = name(n);
    const commit = (await git(['commit-tree', tree, ...(parent === null ? [] : ['-p', parent]), '-m', message])).trim();
    await git(['update-ref', branch(session.id), commit, ...(parent === null ? [] : [parent])]);
    return { n, name: message };
  }

  /** Every file under the jailed folders now, project-relative. */
  function filesNow(session: DesignerSession): string[] {
    const out: string[] = [];
    const walk = (folder: string): void => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const path = join(folder, entry.name);
        if (entry.isDirectory()) walk(path);
        else out.push(relative(root, path).split(sep).join('/'));
      }
    };
    for (const path of paths(session)) walk(join(root, path));
    return out;
  }

  return {
    async available() {
      if (known !== null) return known;
      known = await new Promise<boolean>((resolve) => {
        execFile(gitBinary, ['--version'], { timeout: 5000 }, (error) => resolve(error === null));
      });
      return known;
    },
    async commit(session, label) {
      if (!(await this.available())) return null;
      await ensure();
      return record(session, (n) => (label === undefined ? `v${String(n)}` : `v${String(n)} · ${label}`));
    },
    async snapshot(session) {
      if (!(await this.available())) return;
      await ensure();
      if ((await revision(base(session.id))) !== null) return;
      const tree = await treeOfFolder(session);
      const commit = (await git(['commit-tree', tree, '-m', 'before the session'])).trim();
      await git(['update-ref', base(session.id), commit]);
    },
    async list(sessionId) {
      if (!(await this.available()) || !existsSync(join(gitDir, 'HEAD'))) return [];
      const head = await revision(branch(sessionId));
      if (head === null) return [];
      const lines = (await git(['log', '--format=%s%x00%ct', head])).trim().split('\n').filter((line) => line !== '');
      const total = lines.length;
      return lines.map((line, index) => {
        const [name = '', at = '0'] = line.split('\0');
        return { n: total - index, name, at: Number(at) * 1000, current: index === 0 };
      });
    },
    async restore(session, n, opts) {
      if (!(await this.available())) throw new VersionsError('Versions are off: git is not on this machine.');
      await ensure();
      let target: string | null;
      if (n === 0) {
        target = await revision(base(session.id));
      } else {
        const head = await revision(branch(session.id));
        if (head === null) throw new VersionsError('This session has no versions yet.');
        const all = (await git(['rev-list', '--reverse', head])).trim().split('\n');
        target = all[n - 1] ?? null;
      }
      if (target === null) throw new VersionsError(`There is no version ${String(n)}.`);

      // What the version holds, inside the jailed folders.
      const roots = [`apps/${session.appKey}`, 'hooks', 'actions'];
      const listed = (await git(['ls-tree', '-r', '--name-only', target, '--', ...roots])).trim().split('\n').filter((line) => line !== '');
      const keep = new Set(listed);
      for (const file of filesNow(session)) {
        if (!keep.has(file)) rmSync(join(root, file), { force: true });
      }
      if (listed.length > 0) {
        const env = { GIT_INDEX_FILE: `${indexFile(session.id)}-restore` };
        rmSync(env.GIT_INDEX_FILE, { force: true });
        await git(['read-tree', target], env);
        await git(['checkout-index', '--force', '--', ...listed], env);
        rmSync(env.GIT_INDEX_FILE, { force: true });
      } else if (n === 0 && session.createdApp) {
        rmSync(join(root, 'apps', session.appKey), { recursive: true, force: true });
      }
      if (!opts.record) return null;
      return record(session, (next) => `v${String(next)} · Back to v${String(n)}`);
    },
    async changed(session) {
      if (!(await this.available()) || !existsSync(join(gitDir, 'HEAD'))) return null;
      const last = (await revision(branch(session.id))) ?? (await revision(base(session.id)));
      if (last === null) return null;
      const tree = await treeOfFolder(session);
      const names = (await git(['diff-tree', '-r', '--name-only', '--no-renames', '-z', `${last}^{tree}`, tree])).split('\0').filter((name) => name !== '');
      // What an app's own build wrote beside its source is no change of anyone's.
      const built = new RegExp(`^apps/${session.appKey}/dist(-|/|$)`, 'i');
      return names.filter((name) => !built.test(name));
    },
  };
}
