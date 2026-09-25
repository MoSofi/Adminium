// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which add-on versions came WITH this Adminium — the bundled set.
 *
 * The Docker image (and the desktop build) park the pinned add-on tarballs in
 * a directory, `<key>-<version>.tgz` each beside its `.integrity`, and boot
 * seeds them into the add-on store. Once seeded, a bundled package and an
 * uploaded one look alike in the store; the directory is the only witness of
 * where a version came from, and "Comes with Adminium" is what the install
 * check says about it.
 *
 * The directory is `ADMINIUM_BUNDLED_ADD_ONS`, else `./add-ons-bundle`
 * relative to the process's working folder — the rule `compose.ts` seeds from.
 * An npx server has no such directory: nothing is bundled there, and its
 * add-ons come from the catalogue or from an upload.
 *
 * Only filenames are read. The bytes were verified when they were seeded, and
 * installing always reads the verified tree in the store, never this folder.
 */
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Where the bundled tarballs are, by the same rule the boot seed uses. */
export function bundledAddOnsDir(): string {
  return resolve(process.env['ADMINIUM_BUNDLED_ADD_ONS'] ?? './add-ons-bundle');
}

/** The seed's own filename grammar: the version is anchored from the right. */
const TARBALL = /^(?<key>[a-z][a-z0-9-]*)-(?<version>\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\.tgz$/;

/**
 * Key → the versions the bundled set carries. Empty when the directory is not
 * there, which is the normal case for a from-source or npx server.
 */
export async function bundledAddOnVersions(dir: string = bundledAddOnsDir()): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const match = TARBALL.exec(name);
    const key = match?.groups?.['key'];
    const version = match?.groups?.['version'];
    if (key === undefined || version === undefined) continue;
    out.set(key, [...(out.get(key) ?? []), version]);
  }
  return out;
}
