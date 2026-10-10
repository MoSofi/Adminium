// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the first screens ask of main: the recent list, where a new project may
 * go, making one, and opening one.
 *
 * ELECTRON-FREE. Everything that touches the machine is a port, so the order of
 * the questions is what the tests hold: main judges a folder AGAIN when asked to
 * make a project in it (the page's own judgement is a courtesy, never the
 * decision), and nothing of a folder is started before the person agreed to run
 * its code on this computer.
 *
 * TRUST is the fingerprint of the folder's code ({@link projectFingerprint}) at
 * the moment the person said "Open", kept in the app's own `config.json`. A
 * project the app made is agreed to by making it. While a project is open here
 * its code changes all the time (the Designer writes it), so the fingerprint is
 * taken again when the app lets go of the folder ({@link StartService.trustNow}):
 * the question comes back only when the code changed while the app was NOT
 * holding it, which is the case it exists for (a ZIP unpacked over the folder).
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';

import type {
  DesktopCreateProjectInput,
  DesktopCreateProjectResult,
  DesktopLocateProjectResult,
  DesktopMakeProgress,
  DesktopMakeStep,
  DesktopNewFolderInput,
  DesktopNewFolderJudgement,
  DesktopOpenProjectInput,
  DesktopOpenProjectResult,
  DesktopRecentProject,
  DesktopStartState,
} from '../preload/api.js';
import type { DesktopConfig } from './config.js';
import {
  PROJECT_CONFIG_FILES,
  folderNameFor,
  forgetProject,
  isProjectFolder,
  judgeNewProjectFolder,
  proposedParent,
  recentProjects,
  relocateProject,
  rememberProject,
  type FolderDeps,
} from './projects.js';

// ─── A path as a person reads it ─────────────────────────────────────────────

/** `~/Adminium/shop` for a folder under the home folder; elsewhere, and on Windows, the path itself. */
export function displayPathOf(path: string, home: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return path;
  if (path === home) return '~';
  return path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path;
}

// ─── The fingerprint of a folder's code ──────────────────────────────────────

export interface FingerprintFs {
  /** What a path is, links NOT followed; `null` when it is not there. */
  kind: (path: string) => 'file' | 'dir' | 'link' | 'other' | null;
  read: (path: string) => Buffer;
  list: (path: string) => string[];
  linkTarget: (path: string) => string;
}

const realFingerprintFs: FingerprintFs = {
  kind: (path) => {
    try {
      const stat = lstatSync(path);
      return stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : 'other';
    } catch {
      return null;
    }
  },
  read: (path) => readFileSync(path),
  list: (path) => readdirSync(path),
  linkTarget: (path) => readlinkSync(path),
};

/** The folders whose every file is code the engine runs. */
const CODE_FOLDERS = ['hooks', 'actions'] as const;

/**
 * A hash of the code a project runs when it is opened: its config file,
 * `package.json`, and everything under `hooks/` and `actions/`. Names and
 * contents both count; a link counts as where it points, and is not followed.
 * `null` for a folder that is not a project.
 */
export function projectFingerprint(root: string, fs: FingerprintFs = realFingerprintFs): string | null {
  const files: string[] = [];
  for (const name of [...PROJECT_CONFIG_FILES, 'package.json']) if (fs.kind(join(root, name)) !== null) files.push(name);
  if (!PROJECT_CONFIG_FILES.some((name) => files.includes(name))) return null;

  const walk = (relative: string): void => {
    for (const entry of [...fs.list(join(root, relative))].sort()) {
      if (entry === 'node_modules') continue;
      const child = `${relative}/${entry}`;
      if (fs.kind(join(root, child)) === 'dir') walk(child);
      else files.push(child);
    }
  };
  for (const folder of CODE_FOLDERS) if (fs.kind(join(root, folder)) === 'dir') walk(folder);

  const hash = createHash('sha256');
  for (const file of files) {
    const path = join(root, file);
    const kind = fs.kind(path);
    hash.update(`${file}\0${kind ?? 'gone'}\0`);
    if (kind === 'file') hash.update(fs.read(path));
    else if (kind === 'link') hash.update(fs.linkTarget(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

// ─── The service ─────────────────────────────────────────────────────────────

/** What the person chose on the first screens: main boots it. */
export type StartChoice = { readonly kind: 'classic' } | { readonly kind: 'project'; readonly root: string; /** Asked for from Start: the project's dashboard, not the Designer. */ readonly land?: 'dashboard' };

export type MakeProjectResult = { readonly ok: true } | { readonly ok: false; readonly detail: string };

export interface StartDeps {
  readConfig: () => DesktopConfig;
  saveConfig: (next: DesktopConfig) => Promise<void>;
  folder: FolderDeps;
  /** The classic workspace has been used on this computer. */
  classicUsed: () => boolean;
  /** The system's folder picker. */
  chooseDirectory: (opts: { title: string; defaultPath?: string | undefined }) => Promise<string | null>;
  /**
   * Make a project in `<parent>/<folder>` (the engine's own `new`, with the
   * app's programs) and install what it is built with. Absent in a build that
   * cannot (no engine entry): "Create" then fails with its own sentence.
   */
  makeProject?: ((input: { parent: string; folder: string; root: string; onStep?: (step: DesktopMakeStep) => void }) => Promise<MakeProjectResult>) | undefined;
  fingerprint?: ((root: string) => string | null) | undefined;
  /** Whether the folder has what it is built with (a `node_modules`). */
  hasPackages?: ((root: string) => boolean) | undefined;
  /** The real path of a folder that exists. */
  real?: ((path: string) => string) | undefined;
  now?: (() => Date) | undefined;
  onChoice: (choice: StartChoice) => void;
}

export interface StartService {
  state(): DesktopStartState;
  judgeNewFolder(input: DesktopNewFolderInput): DesktopNewFolderJudgement;
  chooseParent(input: { from: string; title: string }): Promise<string | null>;
  createProject(input: DesktopCreateProjectInput): Promise<DesktopCreateProjectResult>;
  makeProgress(): DesktopMakeProgress;
  chooseFolder(input: { title: string }): Promise<{ path: string; displayPath: string } | null>;
  openProject(input: DesktopOpenProjectInput): Promise<DesktopOpenProjectResult>;
  forgetProject(path: string): Promise<DesktopRecentProject[]>;
  locateProject(input: { path: string; title: string }): Promise<DesktopLocateProjectResult>;
  useClassic(): void;
  /** Take the fingerprint of a project the app is letting go of, so its own changes are not asked about. */
  trustNow(root: string): Promise<void>;
}

/** The sentence "Create" fails with in a build that cannot make a project. */
export const CANNOT_MAKE_PROJECT = 'This build of Adminium cannot make a project.';

export function createStartService(deps: StartDeps): StartService {
  const fingerprint = deps.fingerprint ?? ((root: string) => projectFingerprint(root));
  const hasPackages = deps.hasPackages ?? ((root: string) => existsSync(join(root, 'node_modules')));
  const real = deps.real ?? ((path: string) => realpathSync(path));
  const now = deps.now ?? (() => new Date());
  const shown = (path: string): string => displayPathOf(path, deps.folder.home, deps.folder.platform);

  const recent = (): DesktopRecentProject[] =>
    recentProjects(deps.readConfig(), deps.folder.exists).map((project) => ({
      path: project.path,
      displayPath: shown(project.path),
      name: project.name,
      lastOpened: project.lastOpened,
      state: project.state,
      missing: project.missing,
    }));

  const judge = (input: DesktopNewFolderInput): DesktopNewFolderJudgement => {
    const judged = judgeNewProjectFolder(input.parent, input.name, deps.folder);
    return judged.ok
      ? { ok: true, path: judged.path, displayPath: shown(judged.path), warning: judged.warning }
      : { ok: false, path: judged.path, displayPath: judged.path === null ? null : shown(judged.path), refused: judged.refused };
  };

  // One "make" at a time: a second click while npm runs must not start a second project.
  let making = false;
  let progress: DesktopMakeProgress = { step: null, since: 0 };
  const at = (step: DesktopMakeStep | null): void => {
    progress = { step, since: now().getTime() };
  };

  return {
    state: () => {
      const config = deps.readConfig();
      const list = recent();
      return {
        firstLaunch: list.length === 0 && !deps.classicUsed(),
        recent: list,
        proposedParent: proposedParent(deps.folder.home),
        proposedParentDisplay: shown(proposedParent(deps.folder.home)),
        language: config.language,
        theme: config.theme,
      };
    },

    judgeNewFolder: judge,

    chooseParent: (input) => deps.chooseDirectory({ title: input.title, defaultPath: input.from }),

    async createProject(input) {
      // Judged here, again: what the page showed is not what decides.
      const judged = judgeNewProjectFolder(input.parent, input.name, deps.folder);
      if (!judged.ok) return { status: 'refused', refused: judged.refused };
      if (judged.warning !== null && input.acceptWarning !== true) return { status: 'warned', warning: judged.warning };
      if (deps.makeProject === undefined) return { status: 'failed', detail: CANNOT_MAKE_PROJECT };
      if (making) return { status: 'failed', detail: 'A project is already being made.' };
      making = true;
      try {
        const made = await deps.makeProject({ parent: input.parent, folder: folderNameFor(input.name), root: judged.path, onStep: at });
        if (!made.ok) return { status: 'failed', detail: made.detail };
        at('opening');
        // By its real path now that it exists: that is how it is found again.
        const root = real(judged.path);
        // Made here, by the person, a moment ago: agreed to by making it.
        await deps.saveConfig(rememberProject(deps.readConfig(), { path: root, name: input.name.trim(), state: 'building', trusted: fingerprint(root) }, now()));
        deps.onChoice({ kind: 'project', root });
        return { status: 'created', path: root };
      } finally {
        making = false;
        // Left on 'opening' when it worked: the page is about to be replaced, and must not flash back to "Create".
        if (progress.step !== 'opening') at(null);
      }
    },

    makeProgress: () => progress,

    async chooseFolder(input) {
      const picked = await deps.chooseDirectory({ title: input.title, defaultPath: proposedParent(deps.folder.home) });
      if (picked === null) return null;
      let path = picked;
      try {
        path = real(picked);
      } catch {
        // Gone between the pick and now: `openProject` says so.
      }
      return { path, displayPath: shown(path) };
    },

    async openProject(input) {
      if (!deps.folder.exists(input.path)) return { status: 'missing' };
      let root: string;
      try {
        root = real(input.path);
      } catch {
        return { status: 'missing' };
      }
      // The folder itself, never a parent that happens to be a project.
      if (!isProjectFolder(root, deps.folder.exists)) return { status: 'not-a-project' };

      const config = deps.readConfig();
      const known = config.projects.find((entry) => entry.path === root) ?? null;
      const code = fingerprint(root);
      if (input.agreed !== true && (known === null || known.trusted === null || known.trusted !== code)) {
        return { status: 'trust-needed', path: root, displayPath: shown(root), changed: known !== null && known.trusted !== null };
      }
      // Agreed to (now, or before and unchanged). Nothing of the folder has been started up to this line.
      await deps.saveConfig(rememberProject(config, { path: root, name: known?.name ?? nameFromFolder(root), trusted: code }, now()));
      if (!hasPackages(root)) return { status: 'needs-packages' };
      deps.onChoice({ kind: 'project', root, ...(input.land === 'dashboard' ? { land: 'dashboard' as const } : {}) });
      return { status: 'opened' };
    },

    async forgetProject(path) {
      await deps.saveConfig(forgetProject(deps.readConfig(), path));
      return recent();
    },

    async locateProject(input) {
      const picked = await deps.chooseDirectory({ title: input.title });
      if (picked === null) return { status: 'cancelled' };
      let to = picked;
      try {
        to = real(picked);
      } catch {
        return { status: 'not-a-project' };
      }
      const moved = relocateProject(deps.readConfig(), input.path, to, deps.folder.exists);
      if (!moved.ok) return { status: moved.reason === 'already-listed' ? 'already-listed' : 'not-a-project' };
      await deps.saveConfig(moved.config);
      return { status: 'located', recent: recent() };
    },

    useClassic: () => {
      deps.onChoice({ kind: 'classic' });
    },

    async trustNow(root) {
      const config = deps.readConfig();
      const known = config.projects.find((entry) => entry.path === root);
      // Only a folder already agreed to: letting go of it never grants what was not given.
      if (known === undefined || known.trusted === null) return;
      const code = fingerprint(root);
      if (code === null || code === known.trusted) return;
      await deps.saveConfig({ ...config, projects: config.projects.map((entry) => (entry.path === root ? { ...entry, trusted: code } : entry)) });
    },
  };
}

/** A name for a folder opened for the first time: its own, with the dashes read as spaces. */
export function nameFromFolder(root: string): string {
  const base = root.split(/[\\/]/).filter((part) => part !== '').pop() ?? root;
  const words = base.replace(/[-_]+/g, ' ').trim();
  return words === '' ? base : words.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}
