// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `node_modules/.adminium-install.json` — the mark that a project's packages
 * were installed, whole, for this machine.
 *
 * "Is it installed?" is not "is there a `node_modules` folder". An install that
 * was cancelled leaves a folder that looks present and is missing half of what
 * the build needs; a folder that travelled inside an archive from another
 * machine holds that machine's programs (esbuild's, SQLite's, Tailwind's) and
 * none of this one's. So the answer is a small file written only after an
 * install succeeded, saying what it was an install OF (the lockfile, by hash)
 * and FOR (the system and the chip), and anything else is "install again".
 *
 * The desktop app reads it before it starts a project's server. A terminal's
 * own installs write it too, so a project made there is not installed twice.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const INSTALL_STAMP_FILE = join('node_modules', '.adminium-install.json');

export interface InstallStamp {
  /** What was installed: a hash of `package-lock.json`, or of `package.json` where there is no lockfile. */
  lockHash: string;
  /** `process.platform` and `process.arch` of the machine it was installed on. */
  system: string;
  chip: string;
  /** The Adminium that did it. Told to the person when it differs; never a reason of its own to install again. */
  engine: string;
}

/** Why a project's packages must be installed (again), or `null` when they are in place. */
export type InstallNeed = 'no-packages' | 'not-finished' | 'another-machine' | 'changed' | null;

function hashOf(file: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

/** What an install of this folder would be an install of, as it stands now. `null`: there is no `package.json`. */
export function projectLockHash(root: string): string | null {
  const lock = hashOf(join(root, 'package-lock.json'));
  if (lock !== null) return `lock:${lock}`;
  const manifest = hashOf(join(root, 'package.json'));
  return manifest === null ? null : `manifest:${manifest}`;
}

export function readInstallStamp(root: string): InstallStamp | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(root, INSTALL_STAMP_FILE), 'utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const stamp = parsed as Partial<InstallStamp>;
  if (typeof stamp.lockHash !== 'string' || typeof stamp.system !== 'string' || typeof stamp.chip !== 'string' || typeof stamp.engine !== 'string') return null;
  return { lockHash: stamp.lockHash, system: stamp.system, chip: stamp.chip, engine: stamp.engine };
}

/**
 * Whether the project's packages must be installed, and why.
 *
 * The order is the order a person would be told in: nothing there; something
 * there that never finished (or that this app did not install); installed on
 * another kind of machine; installed, but the list of packages changed since.
 */
export function installNeed(root: string, machine: { system: string; chip: string } = { system: process.platform, chip: process.arch }): InstallNeed {
  if (!existsSync(join(root, 'node_modules'))) return 'no-packages';
  const stamp = readInstallStamp(root);
  if (stamp === null) return 'not-finished';
  if (stamp.system !== machine.system || stamp.chip !== machine.chip) return 'another-machine';
  return stamp.lockHash === projectLockHash(root) ? null : 'changed';
}

/** Take the mark away BEFORE an install starts: one that is cancelled or fails must leave none. */
export function clearInstallStamp(root: string): void {
  rmSync(join(root, INSTALL_STAMP_FILE), { force: true });
}

/** Write the mark, after an install succeeded. A folder with no `package.json` or no `node_modules` gets none. */
export function writeInstallStamp(root: string, engine: string, machine: { system: string; chip: string } = { system: process.platform, chip: process.arch }): InstallStamp | null {
  const lockHash = projectLockHash(root);
  if (lockHash === null || !existsSync(join(root, 'node_modules'))) return null;
  const stamp: InstallStamp = { lockHash, system: machine.system, chip: machine.chip, engine };
  const file = join(root, INSTALL_STAMP_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(stamp, null, 2)}\n`);
  return stamp;
}

/**
 * After packages were ADDED to an installed project (a needs card, the screen
 * packages): the lockfile changed with them, so the mark is brought up to
 * date. A project with no mark keeps none: it was never installed whole.
 */
export function refreshInstallStamp(root: string, engine: string): void {
  if (readInstallStamp(root) !== null) writeInstallStamp(root, engine);
}
