// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A workspace file arriving: read, checked whole, and its apps staged one at
 * a time.
 *
 * The file is read twice, member by member, never expanded whole. The first
 * reading checks everything that refuses the WHOLE file before anything is
 * written: `workspace.json` is there and readable by this server (a newer
 * floor or format says "needs Adminium X"), its apps name exactly the
 * `apps/` members there are and no others, each member's fingerprint is
 * computed and equals its entry, the key and version inside each app file
 * equal its entry, no app file is itself a workspace file, at most one app
 * carries the server settings, and the gzip stream's footer holds. The second reading hands each app file to the
 * upload's own staging, with its fingerprint, so every per-app refusal (the
 * app's floor, another lineage, an older version, the project folder…) runs
 * unchanged and is reported on that app's row while the others stage.
 */
import { createHash } from 'node:crypto';

import { lenientMinimum } from '../add-ons/catalog.js';
import { meetsMinimum } from './catalog.js';
import { readAddOnTarball, tarballMembers, type ArchiveLimits, DEFAULT_ARCHIVE_LIMITS } from '../add-ons/archive.js';
import { ValidationFailedError } from '../errors.js';
import { WORKSPACE_FILE, WORKSPACE_FILE_APPS_MAX, readWorkspaceFile, type WorkspaceFile, type WorkspaceFileApp } from '@adminium/manifest';
import { WORKSPACE_APP_MAX_BYTES, WORKSPACE_FILE_MAX_BYTES } from './save/workspace.js';

/** The upload's body limit: the largest file Save workspace makes. */
export const WORKSPACE_UPLOAD_BODY_LIMIT = WORKSPACE_FILE_MAX_BYTES;

/**
 * The archive's own limits. Eight apps, `workspace.json` and the stub
 * `manifest.json`: ten members. Each app file at most 32 MB, as an app file
 * uploaded on its own; app files are already compressed, so the expansion is
 * barely larger than the file.
 */
export const WORKSPACE_ARCHIVE_LIMITS: ArchiveLimits = {
  ...DEFAULT_ARCHIVE_LIMITS,
  maxCompressedBytes: WORKSPACE_FILE_MAX_BYTES,
  maxUncompressedBytes: WORKSPACE_FILE_MAX_BYTES + 1024 * 1024,
  maxEntryBytes: WORKSPACE_APP_MAX_BYTES,
  maxEntries: WORKSPACE_FILE_APPS_MAX + 2,
  maxPathDepth: 2,
};

/** The stub manifest's member. */
const STUB = 'manifest.json';

export function integrityOf(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

/**
 * What `/apps/upload` says of a workspace file: "needs Adminium X" when its
 * floor is above this server, as an older server would say it, and otherwise
 * that it goes through the workspace upload.
 */
export function workspaceFileRefusal(stub: Buffer, serverVersion: string): ValidationFailedError {
  let document: unknown = null;
  try {
    document = JSON.parse(stub.toString('utf8'));
  } catch {
    // An unreadable stub is still a workspace file by its `workspace.json`.
  }
  const minimum = lenientMinimum(document);
  if (minimum !== null && !meetsMinimum(minimum, serverVersion)) {
    return new ValidationFailedError(`This workspace file needs Adminium ${minimum} or later; this server is ${serverVersion}. Upgrade Adminium before installing it.`, {
      reason: 'REQUIRES_NEWER_ADMINIUM',
      minAdminiumVersion: minimum,
      serverVersion,
    });
  }
  return new ValidationFailedError('This is a workspace file, holding several apps. Install it with Install a workspace file.', { reason: 'IS_WORKSPACE_FILE' });
}

function refuse(message: string, reason: string, details: Record<string, unknown> = {}): ValidationFailedError {
  return new ValidationFailedError(message, { reason, ...details });
}

/** What the first reading found: the document as uploaded, read and checked against the members. */
export interface CheckedWorkspaceFile {
  file: WorkspaceFile;
  /** `workspace.json` as uploaded. */
  document: string;
  integrity: string;
}

/**
 * The first reading: the whole file checked, nothing written. Throws a
 * `ValidationFailedError` naming the first thing that refuses the whole file.
 */
export async function checkWorkspaceFile(bytes: Uint8Array, serverVersion: string): Promise<CheckedWorkspaceFile> {
  let documentText: string | null = null;
  let stub = false;
  /** Each app member: its fingerprint and what its own manifest says it is. */
  const members = new Map<string, { integrity: string; key: string | null; version: string | null; nested: boolean; instance: boolean }>();
  const others: string[] = [];
  for await (const entry of tarballMembers(bytes, WORKSPACE_ARCHIVE_LIMITS)) {
    if (entry.path === WORKSPACE_FILE) {
      documentText = Buffer.from(entry.bytes).toString('utf8');
    } else if (entry.path === STUB) {
      stub = true;
    } else if (/^apps\/[^/]+\.tgz$/.test(entry.path)) {
      members.set(entry.path, { integrity: integrityOf(entry.bytes), ...innerIdentity(entry.bytes) });
    } else {
      others.push(entry.path);
    }
  }
  if (documentText === null) throw refuse('This file carries no workspace.json, so it is not a workspace file.', 'WORKSPACE_FILE_MISSING');
  let parsed: unknown;
  try {
    parsed = JSON.parse(documentText);
  } catch {
    throw refuse('The workspace.json in this file cannot be read.', 'WORKSPACE_FILE_INVALID');
  }
  const read = readWorkspaceFile(parsed, serverVersion);
  if (!read.ok) {
    if (read.reason === 'REQUIRES_NEWER_ADMINIUM') {
      throw refuse(`This workspace file needs Adminium ${read.minAdminiumVersion} or later; this server is ${serverVersion}. Upgrade Adminium before installing it.`, 'REQUIRES_NEWER_ADMINIUM', {
        minAdminiumVersion: read.minAdminiumVersion,
        serverVersion,
      });
    }
    throw refuse('The workspace.json in this file is not valid.', 'WORKSPACE_FILE_INVALID', { issues: read.issues });
  }
  const file = read.file;
  if (!stub) throw refuse('This workspace file carries no manifest.json beside its workspace.json.', 'WORKSPACE_FILE_INVALID');
  const named = new Set(file.apps.map((app) => app.file));
  const extra = [...others, ...[...members.keys()].filter((path) => !named.has(path))];
  if (extra.length > 0) throw refuse('This workspace file carries files its workspace.json does not name.', 'WORKSPACE_FILE_EXTRA', { files: extra.sort() });
  for (const app of file.apps) {
    const member = members.get(app.file);
    if (member === undefined) throw refuse(`This workspace file names ${app.file}, and does not carry it.`, 'WORKSPACE_FILE_MEMBER_MISSING', { file: app.file });
    if (member.integrity !== app.integrity) {
      throw refuse(`${app.file} is not the file that was saved: its fingerprint does not match.`, 'WORKSPACE_FILE_INTEGRITY', { file: app.file, expected: app.integrity, actual: member.integrity });
    }
    if (member.nested) throw refuse(`${app.file} is itself a workspace file. A workspace file holds app files only.`, 'WORKSPACE_FILE_NESTED', { file: app.file });
    if (member.key !== app.key || member.version !== app.version) {
      throw refuse(`${app.file} holds ${member.key ?? 'no app'} ${member.version ?? ''}, not ${app.key} ${app.version}.`.replace(/ +\./, '.'), 'WORKSPACE_FILE_APP_MISMATCH', {
        file: app.file,
        expected: { key: app.key, version: app.version },
        actual: { key: member.key, version: member.version },
      });
    }
  }
  // The server settings travel with one app at most: two would write over each other.
  const carrying = file.apps.filter((app) => members.get(app.file)?.instance === true).map((app) => app.key);
  if (carrying.length > 1) throw refuse('Two apps in this workspace file carry server settings. A workspace file carries them with one app at most.', 'WORKSPACE_FILE_TWO_INSTANCES', { keys: carrying });
  return { file, document: documentText, integrity: integrityOf(bytes) };
}

/** The key and version an app file's own manifest gives, and whether it is a workspace file itself. */
function innerIdentity(bytes: Uint8Array): { key: string | null; version: string | null; nested: boolean; instance: boolean } {
  try {
    const entries = readAddOnTarball(bytes);
    const nested = entries.some((entry) => entry.path === WORKSPACE_FILE);
    const manifest = entries.find((entry) => entry.path === STUB);
    if (manifest === undefined) return { key: null, version: null, nested, instance: false };
    const document = JSON.parse(Buffer.from(manifest.bytes).toString('utf8')) as { key?: unknown; version?: unknown; instance?: unknown };
    return {
      key: typeof document.key === 'string' ? document.key : null,
      version: typeof document.version === 'string' ? document.version : null,
      nested,
      instance: document.instance !== undefined && document.instance !== null,
    };
  } catch {
    // An unreadable app file is not the app its entry names: the whole file is refused below.
    return { key: null, version: null, nested: false, instance: false };
  }
}

/**
 * The second reading: each app member, in the order it was packed, with its entry.
 * Called only after {@link checkWorkspaceFile} passed on the same bytes.
 */
export async function eachWorkspaceApp(bytes: Uint8Array, file: WorkspaceFile, visit: (app: WorkspaceFileApp, member: Uint8Array) => Promise<void>): Promise<void> {
  const byFile = new Map(file.apps.map((app) => [app.file, app]));
  for await (const entry of tarballMembers(bytes, WORKSPACE_ARCHIVE_LIMITS)) {
    const app = byFile.get(entry.path);
    if (app !== undefined) await visit(app, entry.bytes);
  }
}
