// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The project folders the app knows: the recent list, and where a new project
 * may go.
 *
 * Electron-free: it is given paths and answers with decisions, so every rule is
 * tested under plain Node. The words for each refusal and warning are the
 * pages'; this module hands them a reason.
 */
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';

import { detectCloudSyncFolder, MAX_RECENT_PROJECTS, type CloudSyncProvider, type DesktopConfig, type ProjectEntry } from './config.js';

// ─── The recent list ─────────────────────────────────────────────────────────

/** A project as the first screen lists it. */
export interface RecentProject extends ProjectEntry {
  /** The folder is no longer where it was: moved, deleted, or on a disk that is not attached. */
  missing: boolean;
}

/** The files that make a folder a project, as the server looks for them. */
export const PROJECT_CONFIG_FILES = ['adminium.config.ts', 'adminium.config.mjs', 'adminium.config.js'] as const;

export function isProjectFolder(dir: string, exists: (path: string) => boolean = existsSync): boolean {
  return PROJECT_CONFIG_FILES.some((file) => exists(join(dir, file)));
}

export function recentProjects(config: DesktopConfig, exists: (path: string) => boolean = existsSync): RecentProject[] {
  return [...config.projects]
    .sort((a, b) => (a.lastOpened < b.lastOpened ? 1 : a.lastOpened > b.lastOpened ? -1 : 0))
    .map((project) => ({ ...project, missing: !isProjectFolder(project.path, exists) }));
}

/**
 * Put a project at the head of the list, as opened now. A project already
 * listed keeps what the app knows of it (its share port, the trust it was
 * given) unless the caller says otherwise; the list keeps its newest twelve.
 */
export function rememberProject(
  config: DesktopConfig,
  project: { path: string; name: string } & Partial<Pick<ProjectEntry, 'state' | 'sharePort' | 'trusted' | 'reviewed' | 'engineNoted'>>,
  now: Date = new Date(),
): DesktopConfig {
  const known = config.projects.find((entry) => entry.path === project.path);
  const entry: ProjectEntry = {
    path: project.path,
    name: project.name,
    lastOpened: now.toISOString(),
    state: project.state ?? known?.state ?? 'building',
    sharePort: project.sharePort === undefined ? (known?.sharePort ?? null) : project.sharePort,
    trusted: project.trusted === undefined ? (known?.trusted ?? null) : project.trusted,
    reviewed: project.reviewed ?? known?.reviewed ?? false,
    engineNoted: project.engineNoted === undefined ? (known?.engineNoted ?? null) : project.engineNoted,
  };
  const rest = config.projects.filter((other) => other.path !== project.path);
  return { ...config, projects: [entry, ...rest].slice(0, MAX_RECENT_PROJECTS) };
}

/** "Remove": the list forgets the folder. Nothing on disk is touched. */
export function forgetProject(config: DesktopConfig, path: string): DesktopConfig {
  return { ...config, projects: config.projects.filter((entry) => entry.path !== path) };
}

export type RelocateResult = { ok: true; config: DesktopConfig } | { ok: false; reason: 'not-a-project' | 'not-listed' | 'already-listed' };

/**
 * "Locate…": the same project, at a new place. The trust it was given does NOT
 * move with it: a folder at another path is asked about again, because what is
 * there may not be what was agreed to.
 */
export function relocateProject(config: DesktopConfig, from: string, to: string, exists: (path: string) => boolean = existsSync): RelocateResult {
  const known = config.projects.find((entry) => entry.path === from);
  if (known === undefined) return { ok: false, reason: 'not-listed' };
  if (!isProjectFolder(to, exists)) return { ok: false, reason: 'not-a-project' };
  if (to !== from && config.projects.some((entry) => entry.path === to)) return { ok: false, reason: 'already-listed' };
  return { ok: true, config: { ...config, projects: config.projects.map((entry) => (entry.path === from ? { ...entry, path: to, trusted: null } : entry)) } };
}

// ─── Where a new project may go ──────────────────────────────────────────────

export type FolderRefusal = 'no-name' | 'bad-name' | 'home-folder' | 'system-folder' | 'inside-the-app' | 'inside-a-project' | 'exists-with-files' | 'not-absolute';
export type FolderWarning = 'icloud' | 'onedrive' | 'dropbox' | 'googledrive' | 'no-links';

export type NewProjectFolder =
  | { ok: true; path: string; warning: FolderWarning | null }
  | { ok: false; path: string | null; refused: FolderRefusal };

export interface FolderDeps {
  home: string;
  /** The app's own folder (its bundle, or the folder it runs from). */
  appDir: string;
  platform: NodeJS.Platform;
  exists: (path: string) => boolean;
  /** The real path of the nearest folder that exists, links followed. */
  real: (path: string) => string;
  /** What a folder holds, or `null` when it is not a folder that can be read. */
  list: (path: string) => string[] | null;
  /** Whether the disk under this folder can hold links (`null`: could not tell). */
  holdsLinks?: (path: string) => boolean | null;
}

/** A project's name as a folder's: lower case, words joined by dashes. */
export function folderNameFor(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Where the app proposes to keep a new project: `~/Adminium/<name>`. */
export function proposedParent(home: string = homedir()): string {
  return join(home, 'Adminium');
}

const within = (inner: string, outer: string): boolean => {
  const rel = relative(outer, inner);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** The folders nothing of a person's should be made in. */
function systemFolders(platform: NodeJS.Platform): string[] {
  if (platform === 'win32') return ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData'];
  if (platform === 'darwin') return ['/System', '/Library', '/Applications', '/usr', '/bin', '/sbin', '/etc', '/var', '/private', '/opt', '/dev'];
  return ['/usr', '/bin', '/sbin', '/etc', '/var', '/opt', '/boot', '/dev', '/proc', '/sys', '/lib', '/lib64', '/root'];
}

/** The nearest parent of `path` that exists, by its real path, with the rest of `path` put back. */
function realOf(path: string, deps: FolderDeps): string {
  let existing = path;
  const tail: string[] = [];
  while (!deps.exists(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    tail.unshift(basename(existing));
    existing = parent;
  }
  let real = existing;
  try {
    real = deps.real(existing);
  } catch {
    // Not readable: judged by its name.
  }
  return tail.length === 0 ? real : join(real, ...tail);
}

const SYNCED: Record<CloudSyncProvider, FolderWarning> = { icloud: 'icloud', onedrive: 'onedrive', dropbox: 'dropbox', googleDrive: 'googledrive' };

/**
 * Judge where a new project is to go: `<parent>/<a folder made from the name>`.
 *
 * The app always makes a folder of its own; it never fills one that holds
 * files. Refused: the home folder itself, a system folder, a folder inside the
 * app, a folder inside another project (found by walking up REAL paths, so a
 * link into a project is seen), and a folder that exists and is not empty.
 * Warned, with the choice left to the person: a synced folder, and a disk that
 * cannot hold links.
 */
export function judgeNewProjectFolder(parent: string, name: string, deps: FolderDeps): NewProjectFolder {
  const folder = folderNameFor(name);
  if (name.trim() === '') return { ok: false, path: null, refused: 'no-name' };
  if (folder === '') return { ok: false, path: null, refused: 'bad-name' };
  if (!isAbsolute(parent)) return { ok: false, path: null, refused: 'not-absolute' };
  const path = realOf(resolve(parent, folder), deps);
  const home = realOf(deps.home, deps);

  if (path === home || path === parse(path).root) return { ok: false, path, refused: 'home-folder' };
  if (within(path, realOf(deps.appDir, deps))) return { ok: false, path, refused: 'inside-the-app' };
  // The home folder may itself be under a system folder's name on some systems (/var/home): what is inside it is the person's.
  if (!within(path, home) && systemFolders(deps.platform).some((system) => within(path, system))) return { ok: false, path, refused: 'system-folder' };

  // Up from the folder's parent: a project found anywhere above would adopt this one as its own.
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    if (isProjectFolder(dir, deps.exists)) return { ok: false, path, refused: 'inside-a-project' };
    if (dirname(dir) === dir) break;
  }
  const holds = deps.list(path);
  if (holds !== null && holds.some((entry) => entry !== '.DS_Store' && entry !== 'Thumbs.db' && entry !== 'desktop.ini')) return { ok: false, path, refused: 'exists-with-files' };

  const synced = detectCloudSyncFolder(path);
  if (synced !== null) return { ok: true, path, warning: SYNCED[synced.provider] };
  if (deps.holdsLinks?.(dirname(path)) === false) return { ok: true, path, warning: 'no-links' };
  return { ok: true, path, warning: null };
}

/** {@link FolderDeps} for a real machine. */
export function realFolderDeps(appDir: string, platform: NodeJS.Platform = process.platform): FolderDeps {
  return {
    home: homedir(),
    appDir,
    platform,
    exists: existsSync,
    real: (path) => realpathSync(path),
    list: (path) => {
      try {
        if (!statSync(path).isDirectory()) return null;
        return readdirSync(path);
      } catch {
        return null;
      }
    },
  };
}
