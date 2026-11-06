// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A workspace file: several self-made apps, one per database of a workspace,
 * in one download.
 *
 * The file is an ordinary package tarball holding three kinds of member:
 *
 *  - `workspace.json`, the document below: the workspace's name, where and
 *    when it was saved, and one entry per app (its member, key, version,
 *    fingerprint and the database it came from);
 *  - a stub `manifest.json`, `{ key, compatibility: { minAdminiumVersion } }`.
 *    An Adminium that does not know workspace files reads it as an app
 *    manifest, fails to validate it, and reads the floor leniently, so it says
 *    "needs Adminium X" rather than that the file has no manifest;
 *  - `apps/<key>-<version>.tgz`, each an ordinary app file with its own save.
 *
 * Its own schema, `.strict()`, and not a manifest field: it describes a
 * bundle of manifests, not an app. A server that knows workspace files and
 * meets a `v` it does not read refuses it by the same floor.
 */
import { z } from 'zod';

import { MANIFEST_ENGINES } from './schema.js';
import { compareSemver } from './semver.js';

/** The document's member name. */
export const WORKSPACE_FILE = 'workspace.json';
/** The format this build writes and reads. */
export const WORKSPACE_FILE_FORMAT = 1;
/** The first Adminium that reads workspace files. */
export const WORKSPACE_FILE_FLOOR = '0.3.49';
/** At most this many apps in one file. */
export const WORKSPACE_FILE_APPS_MAX = 8;
/** A workspace name: as long as a workspace's own. */
export const WORKSPACE_FILE_NAME_MAX = 80;
/** The extension that tells a workspace file from an app file by its name. */
export const WORKSPACE_FILE_SUFFIX = '.workspace.tgz';

const KEY = /^[a-z][a-z0-9-]{1,79}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
/** `sha512-` and the 88 base64 characters of a sha512. */
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/;

export const workspaceFileAppSchema = z
  .object({
    /** The member that holds this app: `apps/<key>-<version>.tgz`. */
    file: z.string().regex(/^apps\/[a-z][a-z0-9-]{1,79}-\d+\.\d+\.\d+\.tgz$/, 'an app member is apps/<key>-<version>.tgz'),
    key: z.string().regex(KEY, 'a key is lower-case letters, digits and -'),
    version: z.string().regex(VERSION, 'a version like 1.2.0'),
    /** The member's fingerprint: `sha512-` + base64 of its bytes. */
    integrity: z.string().regex(INTEGRITY, 'a fingerprint is sha512- and base64'),
    /** The database it was saved from. Only a hint for "Install on". */
    database: z
      .object({
        name: z.string().trim().min(1).max(120),
        engine: z.enum(MANIFEST_ENGINES),
      })
      .strict(),
  })
  .strict()
  .refine((app) => app.file === `apps/${app.key}-${app.version}.tgz`, { message: 'an app member is named by its key and version', path: ['file'] });

export const workspaceFileSchema = z
  .object({
    v: z.literal(WORKSPACE_FILE_FORMAT),
    name: z.string().trim().min(1).max(WORKSPACE_FILE_NAME_MAX),
    savedAt: z.iso.datetime({ offset: true }),
    /** Where it was made, as the target shows it. */
    label: z.string().trim().min(1).max(120),
    adminiumVersion: z.string().regex(VERSION, 'an Adminium version'),
    /** The workspace-file floor, or the highest floor of the apps inside. */
    minAdminiumVersion: z.string().regex(VERSION, 'an Adminium version'),
    /** Install order: required apps first, then the workspace's databases. */
    apps: z.array(workspaceFileAppSchema).min(1).max(WORKSPACE_FILE_APPS_MAX),
  })
  .strict()
  .refine((file) => new Set(file.apps.map((app) => app.key)).size === file.apps.length, { message: 'a workspace file holds each app key once', path: ['apps'] })
  .refine((file) => compareSemver(file.minAdminiumVersion, WORKSPACE_FILE_FLOOR) >= 0, { message: `a workspace file needs Adminium ${WORKSPACE_FILE_FLOOR} at least`, path: ['minAdminiumVersion'] });

export type WorkspaceFile = z.infer<typeof workspaceFileSchema>;
export type WorkspaceFileApp = z.infer<typeof workspaceFileAppSchema>;

/** The stub `manifest.json` beside `workspace.json`. */
export function workspaceStubManifest(key: string, minAdminiumVersion: string): { key: string; compatibility: { minAdminiumVersion: string } } {
  return { key, compatibility: { minAdminiumVersion } };
}

/**
 * The file's key and name: the workspace name made into a key
 * (`Fernhill Coffee` → `fernhill-coffee`), or `workspace-<date>` when the
 * name has no letter or digit a key can hold.
 */
export function workspaceFileKey(name: string, savedAt: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[0-9-]+/, '')
    .slice(0, 70)
    .replace(/-+$/, '');
  return KEY.test(slug) ? slug : `workspace-${savedAt.slice(0, 10)}`;
}

/** `<key>.workspace.tgz`. */
export function workspaceFileName(name: string, savedAt: string): string {
  return `${workspaceFileKey(name, savedAt)}${WORKSPACE_FILE_SUFFIX}`;
}

/**
 * The floor a document asks for, read leniently: from any document with a
 * string `minAdminiumVersion`, valid or not. What a server that cannot read a
 * newer format says it needs.
 */
export function workspaceFileFloor(document: unknown): string | null {
  if (typeof document !== 'object' || document === null) return null;
  const floor = (document as { minAdminiumVersion?: unknown }).minAdminiumVersion;
  return typeof floor === 'string' && VERSION.test(floor) ? floor : null;
}

export type WorkspaceFileReading =
  | { ok: true; file: WorkspaceFile }
  /** A newer format, or a file that asks for a newer Adminium than `serverVersion`. */
  | { ok: false; reason: 'REQUIRES_NEWER_ADMINIUM'; minAdminiumVersion: string }
  | { ok: false; reason: 'WORKSPACE_FILE_INVALID'; issues: { path: (string | number)[]; message: string }[] };

/**
 * Read a `workspace.json` the way a server of `serverVersion` does: a floor
 * above this server refuses the file as "needs Adminium X" whatever else is
 * wrong with it, so a newer format is never called broken.
 */
export function readWorkspaceFile(document: unknown, serverVersion: string): WorkspaceFileReading {
  const floor = workspaceFileFloor(document);
  if (floor !== null && compareSemver(floor, serverVersion) > 0) return { ok: false, reason: 'REQUIRES_NEWER_ADMINIUM', minAdminiumVersion: floor };
  const parsed = workspaceFileSchema.safeParse(document);
  if (!parsed.success) {
    const v = (document as { v?: unknown } | null)?.v;
    // Another format with no floor above this server: still a newer file, named by the floor it gives.
    if (typeof document === 'object' && document !== null && v !== WORKSPACE_FILE_FORMAT && typeof v === 'number' && v > WORKSPACE_FILE_FORMAT) {
      return { ok: false, reason: 'REQUIRES_NEWER_ADMINIUM', minAdminiumVersion: floor ?? WORKSPACE_FILE_FLOOR };
    }
    return { ok: false, reason: 'WORKSPACE_FILE_INVALID', issues: parsed.error.issues.map((issue) => ({ path: issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p)), message: issue.message })) };
  }
  return { ok: true, file: parsed.data };
}
