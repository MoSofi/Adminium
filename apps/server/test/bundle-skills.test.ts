// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `scripts/bundle-skills.mjs` — copies the repo's `skills/` into the package at `prepack` and in the release's
 * publish script.
 *
 * The script derives both folders from its own location, so it runs in a COPY of the repo layout (as
 * `dev-setup.test.ts` does). The copy sits under a `.claude/worktrees/…` folder: the script once tested the
 * ABSOLUTE path for dot folders, so in such a checkout every file was dropped, it still printed "copied", and a
 * package packed there would have shipped with no `skills/`.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'bundle-skills.mjs');

let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function checkout(): { repo: string; target: string } {
  root = mkdtempSync(join(tmpdir(), 'bundle-skills-'));
  const repo = join(root, '.claude', 'worktrees', 'some-lane');
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  put('skills/adminium/SKILL.md', '# Adminium\n');
  put('skills/adminium/reference/pages.md', 'pages\n');
  put('skills/VERSION', '0.0.1\n');
  put('skills/adminium/.DS_Store', 'junk\n');
  put('skills/.hidden/notes.md', 'hidden\n');
  mkdirSync(join(repo, 'apps', 'server', 'scripts'), { recursive: true });
  cpSync(script, join(repo, 'apps', 'server', 'scripts', 'bundle-skills.mjs'));
  return { repo, target: join(repo, 'apps', 'server', 'skills') };
}

describe('bundle-skills', () => {
  it('copies the skills from a checkout under a dot folder, and leaves the dot files inside behind', () => {
    const { repo, target } = checkout();
    execFileSync(process.execPath, [join(repo, 'apps', 'server', 'scripts', 'bundle-skills.mjs')], { stdio: 'pipe' });

    expect(readFileSync(join(target, 'adminium', 'SKILL.md'), 'utf8')).toBe('# Adminium\n');
    expect(readFileSync(join(target, 'adminium', 'reference', 'pages.md'), 'utf8')).toBe('pages\n');
    expect(existsSync(join(target, 'VERSION'))).toBe(false);
    expect(existsSync(join(target, 'adminium', '.DS_Store'))).toBe(false);
    expect(existsSync(join(target, '.hidden'))).toBe(false);
  });
});
