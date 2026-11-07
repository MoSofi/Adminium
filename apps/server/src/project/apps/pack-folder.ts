// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DOWNLOAD: a project app packed by the server it runs on, at a version the
 * person chose.
 *
 * `adminium app pack` packs the folder as it is. The server's Download asks
 * for a version first, because a target refuses the same version twice and
 * the person who changed the screens has no other place to raise it. So:
 *
 *  - the version may not be lower than the folder's manifest says;
 *  - a higher one is written back into the folder's manifest BEFORE the app
 *    is checked, built and packed (the packer always takes the manifest's
 *    version), so the file's name and what it holds agree;
 *  - only an app made here is packed: a catalog app's sides are its
 *    publisher's, never repacked under another name;
 *  - the file is read for what must stay on this server before it is handed
 *    out: a secret the server keeps, or an id of it (`pack-leaks.ts`). Its
 *    source travels, so a key copied from the project's `.env` into
 *    `src/` would leave with it. A hit refuses the Download, naming the file
 *    and the line, never the value;
 *  - the package says where it was made (`provenance`): the server's display
 *    name as its label (never a host name), when, and on which Adminium, with
 *    a lineage drawn once per app and kept in its folder (`lineage.json`), so
 *    a newer file of the same app is an update on the server that has it,
 *    wherever the folder was cloned.
 *
 * The file is kept at `.adminium/packs/<key>-<version>.tgz` with its
 * fingerprint beside it, where `adminium app pack` writes too.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { compareSemver, LOCAL_PUBLISHER_ID } from '@adminium/manifest';

import { readAddOnTarball } from '../../add-ons/archive.js';
import { checkAppWithFiles, type AppFinding } from './check-app.js';
import { packLeaks, type PackLeakScan } from './pack-leaks.js';
import { packApp, PackTooLargeError, type PackedApp } from './pack-app.js';
import { appDir, appPath, listAppKeys, MANIFEST_FILE, MANIFEST_PARTS_DIR, readAppFolder } from './read-app.js';
import { buildAppSides, type BuiltSide } from './side-build.js';
import { loadProjectBundler, type LoadBundler } from '../build.js';

/** Where packs are kept: inside the folder a project already keeps out of git. */
export const PACKS_DIR = join('.adminium', 'packs');

/** The file in an app's folder that keeps its lineage between Downloads. */
export const LINEAGE_FILE = 'lineage.json';

export const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export type PackFolderReason = 'NOT_A_PROJECT_APP' | 'CATALOG_SIDES' | 'VERSION_BELOW' | 'PACK_CHECK_FAILED' | 'PACK_BUILD_FAILED' | 'PACK_TOO_LARGE' | 'PACK_LEAKS';

/** A Download that cannot be made, and why. */
export class PackFolderRefused extends Error {
  override readonly name = 'PackFolderRefused';
  constructor(
    readonly reason: PackFolderReason,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface PackFolderInput {
  root: string;
  key: string;
  version: string;
  /** The server's display name: where the file says it was made. */
  label: string | null;
  /** The running Adminium. */
  adminiumVersion: string;
  loadBundler?: LoadBundler | undefined;
  now?: Date | undefined;
  /** What the file is read for before it is handed out: this server's secrets and database ids. */
  scan: PackLeakScan;
}

export interface PackedFolderApp extends PackedApp {
  /** Where the file is kept. */
  file: string;
  bytes: number;
}

/** The file of the folder that says the app's version: `manifest.json`, or the parts' `app.json`. */
function versionFile(root: string, key: string): string {
  const one = join(appDir(root, key), MANIFEST_FILE);
  return existsSync(one) ? one : join(appDir(root, key), MANIFEST_PARTS_DIR, 'app.json');
}

/** The app's lineage, drawn at its first Download and kept in its folder. */
function lineageOf(root: string, key: string): string {
  const file = join(appDir(root, key), LINEAGE_FILE);
  if (existsSync(file)) {
    try {
      const kept = (JSON.parse(readFileSync(file, 'utf8')) as { lineage?: unknown }).lineage;
      if (typeof kept === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(kept)) return kept;
    } catch {
      // Unreadable: a new one is drawn and written over it.
    }
  }
  const lineage = randomBytes(16).toString('base64url');
  writeFileSync(file, `${JSON.stringify({ lineage }, null, 2)}\n`);
  return lineage;
}

const errorsOf = (findings: readonly AppFinding[]): AppFinding[] => findings.filter((finding) => finding.level === 'error');

/** Check, build and pack one project app at `version`, written back first when it is higher. */
export async function packFolderApp(input: PackFolderInput): Promise<PackedFolderApp> {
  const { root, key } = input;
  if (!listAppKeys(root).includes(key)) {
    throw new PackFolderRefused('NOT_A_PROJECT_APP', `There is no app "${key}" in this project (${appPath(key)}/).`);
  }
  const folder = readAppFolder(root, key);
  if (folder.document === null) {
    throw new PackFolderRefused('PACK_CHECK_FAILED', 'The app did not pass its check, so it cannot be packed.', { problems: folder.problems });
  }
  const publisher = (folder.document['publisher'] as { id?: unknown } | undefined)?.id;
  if (publisher !== LOCAL_PUBLISHER_ID) {
    throw new PackFolderRefused('CATALOG_SIDES', `"${key}" is published by "${String(publisher)}". Only an app made here is packed: a catalog app's screens are its publisher's.`, {
      publisher: typeof publisher === 'string' ? publisher : null,
    });
  }
  const manifestVersion = typeof folder.document['version'] === 'string' ? folder.document['version'] : '0.0.0';
  if (!VERSION_PATTERN.test(input.version) || compareSemver(input.version, manifestVersion) < 0) {
    throw new PackFolderRefused('VERSION_BELOW', `The version can't be lower than ${manifestVersion}, the version in ${appPath(key)}.`, { manifestVersion });
  }
  if (compareSemver(input.version, manifestVersion) > 0) {
    const file = versionFile(root, key);
    const written = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (typeof written['version'] !== 'string') {
      throw new PackFolderRefused('PACK_CHECK_FAILED', `${appPath(key, MANIFEST_PARTS_DIR, 'app.json')} does not say the app's version.`, { problems: [] });
    }
    writeFileSync(file, `${JSON.stringify({ ...written, version: input.version }, null, 2)}\n`);
  }

  const check = await checkAppWithFiles(root, key, { version: input.adminiumVersion });
  const errors = errorsOf(check.findings);
  if (errors.length > 0 || check.manifest === null) {
    throw new PackFolderRefused('PACK_CHECK_FAILED', 'The app did not pass its check, so it cannot be packed.', {
      problems: errors.map((finding) => ({ file: finding.file, path: finding.path, message: finding.message })),
    });
  }
  let sides: BuiltSide[] = [];
  if (check.sides.length > 0) {
    const bundler = await (input.loadBundler ?? loadProjectBundler)(root);
    if (bundler === null) {
      throw new PackFolderRefused('PACK_BUILD_FAILED', "Building the app's screens needs esbuild, and this project does not have it.");
    }
    try {
      sides = await buildAppSides({ root, key, name: check.manifest.name, bundler, sides: check.sides });
    } catch (error) {
      throw new PackFolderRefused('PACK_BUILD_FAILED', `The app's screens did not build: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const label = input.label?.trim().slice(0, 120) ?? '';
  let packed: PackedApp;
  try {
    packed = await packApp(check, sides, {
      provenance: {
        lineage: lineageOf(root, key),
        savedAt: (input.now ?? new Date()).toISOString(),
        adminiumVersion: input.adminiumVersion,
        ...(label === '' ? {} : { label }),
      },
    });
  } catch (error) {
    if (error instanceof PackTooLargeError) {
      throw new PackFolderRefused('PACK_TOO_LARGE', error.message, { bytes: error.bytes, limit: error.limit });
    }
    throw new PackFolderRefused('PACK_BUILD_FAILED', error instanceof Error ? error.message : String(error));
  }
  const leaks = packLeaks(
    readAddOnTarball(packed.tarball).map((entry) => [entry.path, entry.bytes] as const),
    input.scan,
  );
  if (leaks.length > 0) {
    throw new PackFolderRefused('PACK_LEAKS', 'The file would carry a secret or an id of this server, so it was not made. Take it out of the files named, then download again.', { leaks });
  }
  const dir = join(root, PACKS_DIR);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, packed.fileName);
  writeFileSync(file, packed.tarball);
  writeFileSync(`${file}.integrity`, `${packed.integrity}\n`);
  return { ...packed, file, bytes: packed.tarball.byteLength };
}

/** A kept pack's file, or null when that version was never packed here. */
export function keptPack(root: string, key: string, version: string): { file: string; integrity: string | null } | null {
  if (!VERSION_PATTERN.test(version) || !/^[a-z][a-z0-9-]{1,79}$/.test(key)) return null;
  const file = join(root, PACKS_DIR, `${key}-${version}.tgz`);
  if (!existsSync(file)) return null;
  const integrityFile = `${file}.integrity`;
  return { file, integrity: existsSync(integrityFile) ? readFileSync(integrityFile, 'utf8').trim() : null };
}
