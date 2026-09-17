// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where an instance's own state lands when nobody named a directory
 * (`ADMINIUM_DATA_DIR`, `--data-dir`).
 *
 * The schema default is `./data` — RELATIVE, so it means "wherever this process
 * was started". That is exactly right for one shape of install and wrong for
 * the other:
 *
 *  - **beside a project.** A checkout, a compose file, an app this panel
 *    administers. `./data` sits next to the code, gets gitignored with it, and
 *    matches what `docker-compose.yml` and the deploy manifests describe. Every
 *    container and the Electron shell also pass the variable explicitly, so
 *    they never reach this file at all.
 *  - **from a shell, anywhere.** `npx @adminiumjs/adminium try` is most often run
 *    from whatever directory the user happened to be standing in — a home
 *    directory, `~/Downloads`, a repo that has nothing to do with Adminium.
 *    There `./data` is litter: a `meta.db`, `files/`, `backups/` and
 *    `add-ons/` dropped somewhere nobody chose — and, worse, an instance that
 *    CANNOT BE FOUND AGAIN from one directory over, because the next run
 *    resolves a different `./data` and boots an empty one.
 *
 * So the CLI picks between them instead of assuming. Nothing else does: this is
 * reached only through `loadCliEnv`, because only the CLI knows it was launched
 * by a person standing in a directory. `loadEnv()` — the container, the desktop
 * shell, an embedding host — keeps the plain `./data` default it always had.
 *
 * ── THE ORDER MATTERS, AND CONTINUITY COMES FIRST ───────────────────────────
 * An instance already living in `<cwd>/data` keeps it, whatever else this file
 * would have concluded. Anything else would be data loss wearing a default's
 * costume: the store is still on disk, the operator's next `adminium start`
 * just quietly boots a brand-new empty one beside it, and every page, login and
 * setting they had is "gone".
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

/** The default when the CLI is run inside a project. Relative, as it always was. */
export const PROJECT_DATA_DIR = './data';

/** The per-user directory for an instance that belongs to no project. */
export const HOME_DATA_DIR_NAME = '.adminium';

/**
 * Proof that an Adminium instance already lives in `<cwd>/data`.
 *
 * Both are files this product writes and nothing else does — the bootstrap file
 * and the OD-1 embedded store. A bare `data/` directory is NOT proof: plenty of
 * projects have one full of CSVs, and adopting it because of the name would be
 * how Adminium ends up scattering its state through somebody's dataset folder.
 */
const INSTANCE_MARKERS = ['adminium.json', 'meta.db'] as const;

/**
 * Files that make a directory somebody's PROJECT rather than somebody's shell.
 *
 * Deliberately wide, and deliberately not npm-only: a Django or Go service is
 * as much a project as a Node one, and the panel that administers it belongs
 * beside it. Both ways of being wrong are mild — a false positive writes
 * `./data`, which is what every version so far did, and a false negative puts a
 * working instance in the home directory — so the list favours the behaviour
 * people already have.
 */
const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'Dockerfile',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'Gemfile',
  'composer.json',
  'pom.xml',
] as const;

export interface DefaultDataDirOptions {
  /** Test seam; defaults to `process.cwd()`. */
  cwd?: string;
  /** Test seam; defaults to `os.homedir()`. */
  home?: string;
  /** Test seam; defaults to `existsSync`. */
  exists?: (path: string) => boolean;
}

/**
 * The directory `ADMINIUM_DATA_DIR` falls back to for a CLI run.
 *
 * Returns the RELATIVE `./data` for the project case on purpose: that is the
 * value the variable has always carried there, it is what the wizard prints,
 * and resolving it is the caller's job exactly as before. The home case returns
 * an absolute path — it has to, since its whole point is to mean the same
 * directory from wherever the command is run next.
 */
export function defaultDataDir(opts: DefaultDataDirOptions = {}): string {
  const exists = opts.exists ?? existsSync;
  const cwd = resolve(opts.cwd ?? process.cwd());
  const home = opts.home ?? homedir();

  // 1. An instance is already here. Nothing below may overrule this.
  if (INSTANCE_MARKERS.some((marker) => exists(join(cwd, 'data', marker)))) {
    return PROJECT_DATA_DIR;
  }

  // No home to fall back TO (a container image without one, `HOME` unset):
  // `./data` is still better than an absolute path built from an empty string.
  if (home === '' || !exists(home)) return PROJECT_DATA_DIR;

  // 2. The home directory is never a "project", however many dotfile repos and
  // stray package.jsons live in it — that is precisely the case this exists for.
  if (resolve(home) !== cwd && PROJECT_MARKERS.some((marker) => exists(join(cwd, marker)))) {
    return PROJECT_DATA_DIR;
  }

  // 3. Run from a shell, in nobody's project: keep it with the user, not the cwd.
  return join(home, HOME_DATA_DIR_NAME);
}

/**
 * `/Users/ada/.adminium` → `~/.adminium`, for a path a PERSON reads.
 *
 * Only for prose the wizard prints. Logs and error messages keep the absolute
 * form — a remedy someone will paste into a shell must not depend on which
 * shell expands the tilde (`cli-migrate.test.ts` pins that for the bootstrap
 * file), and nothing here is ever fed back to a filesystem call.
 */
export function tildify(path: string, home: string = homedir()): string {
  if (home === '') return path;
  if (path === home) return '~';
  return path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
}
