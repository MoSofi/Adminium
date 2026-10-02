#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Mirror `skills/` to the public skills repository, as a release step.
 *
 *   node scripts/release/mirror-skills.mjs --version <x.y.z> [--push] [--repo <owner/name>] [--dir <clone>]
 *
 * The skills are released WITH the engine: they name its commands and are
 * produced from its docs, so the public copy must be the tree at the release
 * and say which version it is for. This script is the only way that copy is
 * written — nothing is edited there by hand.
 *
 * What it does:
 *   1. refuses unless the references are current and every claim holds
 *      (`skills-references-check`, `skills-claims-check`);
 *   2. clones the public repository (or uses `--dir`);
 *   3. replaces its `skills/` folder and `README.md` with this tree's, and
 *      writes `skills/VERSION`. `LICENSE` and `.git` are left alone;
 *   4. commits as the configured release author, and tags `v<version>`;
 *   5. WITHOUT `--push`: stops, prints what changed and where the clone is.
 *      WITH `--push`: pushes the branch and the tag.
 *
 * Layout there: `README.md`, `LICENSE`, `skills/VERSION`, `skills/<name>/…` —
 * what `npx skills add <owner>/skills` reads.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = join(ROOT, 'skills');
/** Build inputs that stay in the monorepo. */
const NOT_MIRRORED = new Set(['README.md', 'references.config.mjs']);
const AUTHOR = { name: 'Mohamed Sofi', email: 'designsuniverse@gmail.com' };

const args = process.argv.slice(2);
const value = (flag) => {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
};
const known = new Set(['--version', '--push', '--repo', '--dir']);
const unknown = args.filter((arg, i) => arg.startsWith('--') ? !known.has(arg) : !known.has(args[i - 1] ?? ''));
if (unknown.length > 0) {
  console.error(`unknown argument(s): ${unknown.join(' ')}`);
  process.exit(1);
}
const version = value('--version');
if (version === undefined || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('usage: mirror-skills.mjs --version <x.y.z> [--push] [--repo <owner/name>] [--dir <clone>]');
  process.exit(1);
}
const repo = value('--repo') ?? 'Adminiumjs/skills';
const push = args.includes('--push');

const run = (command, argv, opts = {}) => execFileSync(command, argv, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts });
const git = (cwd, ...argv) => run('git', argv, { cwd });

// 1. Only a tree that passes its own gates is mirrored.
for (const gate of ['skills-references-check', 'skills-claims-check']) {
  try {
    run('pnpm', ['run', '-s', gate], { cwd: ROOT });
  } catch {
    console.error(`\n${gate} failed: the skills are not mirrored. Fix it first.`);
    process.exit(1);
  }
}

// 2. The public repository.
const clone = value('--dir') === undefined ? mkdtempSync(join(tmpdir(), 'adminium-skills-mirror-')) : resolve(value('--dir'));
if (value('--dir') === undefined) run('git', ['clone', '--quiet', `https://github.com/${repo}.git`, clone]);
if (!existsSync(join(clone, '.git'))) {
  console.error(`${clone} is not a git clone`);
  process.exit(1);
}
if (git(clone, 'status', '--porcelain').trim() !== '') {
  console.error(`${clone} has uncommitted changes: the mirror only writes into a clean clone.`);
  process.exit(1);
}

// 3. Replace the tree.
rmSync(join(clone, 'skills'), { recursive: true, force: true });
for (const entry of readdirSync(SOURCE, { withFileTypes: true })) {
  if (NOT_MIRRORED.has(entry.name) || entry.name.startsWith('.')) continue;
  cpSync(join(SOURCE, entry.name), join(clone, 'skills', entry.name), { recursive: true });
}
writeFileSync(join(clone, 'skills', 'VERSION'), `${version}\n`);
writeFileSync(join(clone, 'README.md'), readFileSync(join(SOURCE, 'README.md'), 'utf8').replace(/in `VERSION`/g, 'in `skills/VERSION`'));

// 4. Commit and tag.
git(clone, 'add', '-A');
const changed = git(clone, 'status', '--porcelain').trim();
const tag = `v${version}`;
if (changed === '') {
  console.log(`${repo} already holds the skills for ${version}: nothing to commit.`);
} else {
  git(clone, '-c', `user.name=${AUTHOR.name}`, '-c', `user.email=${AUTHOR.email}`, 'commit', '--quiet', '-m', `release: skills for adminium ${version}`);
  console.log(git(clone, 'show', '--stat', '--format=%h %s', 'HEAD').split('\n').slice(0, 1).join('\n'));
  console.log(`${String(changed.split('\n').length)} path(s) changed.`);
}
const tags = git(clone, 'tag', '--list', tag).trim();
if (tags === '') git(clone, 'tag', tag);
else if (git(clone, 'rev-parse', `${tag}^{commit}`).trim() !== git(clone, 'rev-parse', 'HEAD').trim()) {
  console.error(`the tag ${tag} already exists on another commit: a release's skills are never rewritten.`);
  process.exit(1);
}

// 5. Push, or stop.
if (!push) {
  console.log(`\nNot pushed. The clone is at ${clone}\nPush it with:  node scripts/release/mirror-skills.mjs --version ${version} --dir ${clone} --push`);
  process.exit(0);
}
const branch = git(clone, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
git(clone, 'push', '--quiet', 'origin', branch);
git(clone, 'push', '--quiet', 'origin', tag);
console.log(`\nPushed ${repo} ${branch} and ${tag}.`);
