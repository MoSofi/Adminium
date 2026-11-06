// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MAKE IT EDITABLE HERE: an installed app's screens, copied into this
 * server's project folder so the Designer can change them.
 *
 * A package made from a project app carries the app's folder under
 * `source/` (`pack-app.ts`). On a server with a project folder, the person
 * may copy it to `apps/<key>/`. From then on the app comes from that folder:
 * the install's row says `folder`, the project's build and reconcile apply
 * the folder as they apply any app of the project, and a newer file of the
 * key can no longer be uploaded here (`KEY_IN_PROJECT`).
 *
 * Refused, and nothing copied, when:
 *  - the install already runs from the folder (`FROM_FOLDER`);
 *  - this server runs no project folder (`NO_PROJECT`);
 *  - `apps/<key>/` exists (`FOLDER_EXISTS`): a person's folder is never
 *    written over;
 *  - the key is installed on two databases or more (`SEVERAL_INSTALLS`): a
 *    folder holds one app, once per server, and the other copies would be
 *    left with no way to update.
 * A package that carries no source has nothing to offer (`none`).
 *
 * The copy reads the package through the store's pinned reads (each file
 * checked against the hash recorded when it was unpacked) and writes plain
 * files only, under the same rules a package is made with (`pack-source.ts`):
 * a file from elsewhere is not trusted to have left out what runs. It is
 * written into a hidden folder beside `apps/<key>/` and moved into place in
 * one rename, so a stop part way leaves no half folder under the app's name.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { InstalledManifest } from '@adminium/meta';

import type { AppStore } from '../../apps/store.js';
import { SEEDS_DIR, SOURCE_DIR, sourceFileOf } from './pack-source.js';
import { APPS_DIR, appDir } from './read-app.js';

export type EditableRefusal = 'NO_PROJECT' | 'FOLDER_EXISTS' | 'SEVERAL_INSTALLS' | 'FROM_FOLDER';

export interface EditableState {
  state: 'offered' | 'refused' | 'none';
  reason?: EditableRefusal;
  /** `apps/<key>/`, as a person reads it. */
  folder: string;
  /** With `SEVERAL_INSTALLS`: how many databases have the app. */
  installs?: number;
}

export interface EditableInput {
  install: InstalledManifest;
  /** Every install of the key on this server. */
  installs: readonly InstalledManifest[];
  store: AppStore;
  /** The project folder this server runs, or null. */
  projectRoot: string | null;
  /** `folder` for an install of the project's own. */
  folderSource: string;
}

/** The package's source files, by their path under `source/`, from the store's pin. Empty for a package without one. */
async function packagedSource(store: AppStore, key: string, version: string): Promise<string[]> {
  let tree: Awaited<ReturnType<AppStore['verifyTree']>>;
  try {
    tree = await store.verifyTree(key, version);
  } catch {
    return [];
  }
  return Object.keys(tree.files).filter((path) => path.startsWith(`${SOURCE_DIR}/`));
}

/** Whether "Make it editable here" is offered for this install, and if not, why. */
export async function editableState(input: EditableInput): Promise<EditableState> {
  const { install } = input;
  const key = install.row.manifestKey;
  const folder = `${APPS_DIR}/${key}/`;
  if (install.row.source === input.folderSource) return { state: 'refused', reason: 'FROM_FOLDER', folder };
  if ((await packagedSource(input.store, key, install.row.version)).length === 0) return { state: 'none', folder };
  if (input.projectRoot === null) return { state: 'refused', reason: 'NO_PROJECT', folder };
  if (existsSync(appDir(input.projectRoot, key))) return { state: 'refused', reason: 'FOLDER_EXISTS', folder };
  const apps = input.installs.filter((one) => one.row.kind === 'app');
  if (apps.length > 1) return { state: 'refused', reason: 'SEVERAL_INSTALLS', folder, installs: apps.length };
  return { state: 'offered', folder };
}

/**
 * Copy the package's source (and its sample data) to `apps/<key>/`. The
 * caller has checked {@link editableState}; this checks the folder again
 * and refuses to write over one.
 */
export async function copySourceToFolder(store: AppStore, projectRoot: string, key: string, version: string): Promise<{ files: number }> {
  const target = appDir(projectRoot, key);
  if (existsSync(target)) throw new Error(`${APPS_DIR}/${key}/ already exists.`);
  const tree = await store.verifyTree(key, version);
  const paths = Object.keys(tree.files).sort();
  const staging = join(projectRoot, APPS_DIR, `.${key}-copy-${randomBytes(4).toString('hex')}`);
  mkdirSync(staging, { recursive: true });
  let files = 0;
  try {
    for (const path of paths) {
      let inside: string;
      if (path.startsWith(`${SOURCE_DIR}/`)) inside = path.slice(SOURCE_DIR.length + 1);
      // The sample data is carried once, at the package's root.
      else if (path.startsWith(`${SEEDS_DIR}/`)) inside = path;
      else continue;
      const { bytes } = await store.readVerifiedFile(key, version, path);
      const kept = sourceFileOf(inside, new Uint8Array(bytes), { seeds: path.startsWith(`${SEEDS_DIR}/`) });
      if (kept === null) continue;
      const file = join(staging, ...inside.split('/'));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, kept);
      files += 1;
    }
    if (existsSync(target)) throw new Error(`${APPS_DIR}/${key}/ already exists.`);
    renameSync(staging, target);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return { files };
}
