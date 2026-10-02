// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Packing an app folder into the file the install page takes.
 *
 * The package is what `routes/apps` unpacks: `manifest.json` at its root (the
 * manifest as ONE document, whichever form the folder writes it in), each
 * built side as `staff/` and `customer/`, and `seeds/` for the sample data.
 * It is written by the same tar writer that repacks an installed app, so it is
 * the one archive shape the server's reader accepts.
 */

import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { packStagedTree } from '../../add-ons/pack.js';
import { sha512Integrity } from '../../add-ons/store.js';
import { CliError } from '../../cli/exit.js';
import type { AppCheck } from './check-app.js';
import { appPath } from './read-app.js';
import type { BuiltSide } from './side-build.js';

/** The most the upload route takes; a package over it is refused here, where it can be said why. */
export const MAX_PACKAGE_BYTES = 32 * 1024 * 1024;

export interface PackedApp {
  key: string;
  version: string;
  /** The gzipped archive. */
  tarball: Uint8Array;
  /** `sha512-<base64>`: the fingerprint the install page asks for. */
  integrity: string;
  fileCount: number;
  /** `<key>-<version>.tgz` */
  fileName: string;
}

/** A link, or anything that is not a plain file or folder, under `dir` — or null. Dotfiles count: a package carries none. */
function unpackable(dir: string, prefix: string): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${prefix}/${entry.name}`;
    const stat = lstatSync(join(dir, entry.name));
    if (stat.isSymbolicLink()) return `${path} is a link`;
    if (entry.name.startsWith('.')) return `${path} is a hidden file`;
    if (stat.isDirectory()) {
      const inner = unpackable(join(dir, entry.name), path);
      if (inner !== null) return inner;
    } else if (!stat.isFile()) return `${path} is not a plain file`;
  }
  return null;
}

/**
 * Pack a checked, built app. `check.manifest` must be set (the check passed)
 * and `sides` are the builds to carry.
 */
export async function packApp(check: AppCheck, sides: readonly BuiltSide[]): Promise<PackedApp> {
  const manifest = check.manifest;
  const document = check.folder.document;
  if (manifest === null || document === null) throw new CliError('The app did not pass its check, so it cannot be packed.');
  const { key } = check;

  const staging = mkdtempSync(join(tmpdir(), `adminium-app-pack-${key}-`));
  try {
    // One document, with `kind` said outright: a reader should not have to know it defaults to "app".
    writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify({ kind: 'app', ...document }, null, 2)}\n`);
    for (const side of sides) {
      const refused = unpackable(side.dir, side.side);
      if (refused !== null) throw new CliError(`The built ${side.side} side cannot be packed: ${refused}.`);
      cpSync(side.dir, join(staging, side.side), { recursive: true });
    }
    const seeds = join(check.folder.dir, 'seeds');
    if (existsSync(seeds)) {
      const refused = unpackable(seeds, appPath(key, 'seeds'));
      if (refused !== null) throw new CliError(`The sample data cannot be packed: ${refused}.`);
      mkdirSync(join(staging, 'seeds'));
      cpSync(seeds, join(staging, 'seeds'), { recursive: true });
    }

    const packed = await packStagedTree(staging);
    if (packed.tarball.byteLength > MAX_PACKAGE_BYTES) {
      throw new CliError(
        `The package is ${String(Math.ceil(packed.tarball.byteLength / (1024 * 1024)))} MB, and an upload takes at most ${String(MAX_PACKAGE_BYTES / (1024 * 1024))} MB.`,
        { hint: 'Large images in a side or in seeds/ are the usual cause.' },
      );
    }
    return {
      key,
      version: manifest.version,
      tarball: packed.tarball,
      integrity: sha512Integrity(packed.tarball),
      fileCount: packed.fileCount,
      fileName: `${key}-${manifest.version}.tgz`,
    };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
