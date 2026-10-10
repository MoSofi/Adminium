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
  DesktopConnectResult,
  DesktopCreateProjectResult,
  DesktopGuest,
  DesktopFoundRow,
  DesktopGetPackagesResult,
  DesktopLocateProjectResult,
  DesktopMakeProgress,
  DesktopMakeStep,
  DesktopNewFolderInput,
  DesktopNewFolderJudgement,
  DesktopOpenProjectInput,
  DesktopOpenProjectResult,
  DesktopRecentProject,
  DesktopResolveKeyResult,
  DesktopUpdateProjectResult,
  DesktopStartState,
} from '../preload/api.js';
import type { DesktopConfig } from './config.js';
import { judgeGuestAddress, rememberGuest, type GuestCheck } from './guest.js';
import {
  cameWithAccounts,
  cleanVersionStore,
  dataBeforeName,
  enginePin,
  olderThan,
  prepareNewData,
  resolveMissingKey,
  type FolderFacts,
  type MissingKeyAnswer,
} from './folder-open.js';
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
  /** Fetches what a project that is already there is built with; absent in a build that cannot. */
  installPackages?: ((input: { root: string }) => Promise<MakeProjectResult>) | undefined;
  /** Whether the folder has what it is built with (a `node_modules`). */
  hasPackages?: ((root: string) => boolean) | undefined;
  /**
   * What the engine says the folder holds, read without running anything of it
   * (`make-project.ts`). Absent, or `null` for a folder: the folder is opened
   * as it was before there were facts (trust, packages, start).
   */
  folderFacts?: ((root: string) => Promise<FolderFacts | null>) | undefined;
  /** "Update this project": its own Adminium set to this app's, its packages fetched again. */
  updateProject?: ((input: { root: string }) => Promise<MakeProjectResult>) | undefined;
  /** Look for a newer Adminium now. `false`: this build does not update itself. */
  updateApp?: (() => boolean) | undefined;
  /** The system's file picker, for the `.env` a person still has. `null` on cancel. */
  chooseFile?: ((opts: { title: string; defaultPath?: string | undefined }) => Promise<string | null>) | undefined;
  /** Ask an address whether an Adminium is there (`guest.ts`); absent: a build that cannot connect. */
  checkGuest?: ((origin: string) => Promise<GuestCheck>) | undefined;
  /** Open another Adminium in a window of its own, with none of the app's bridge. */
  openGuest?: ((guest: { origin: string; encrypted: boolean }) => Promise<void>) | undefined;
  /** Delete a guest's cookies. */
  clearGuest?: ((origin: string) => Promise<void>) | undefined;
  /** The three writes below, for tests. */
  prepareNewData?: typeof prepareNewData | undefined;
  resolveMissingKey?: typeof resolveMissingKey | undefined;
  cleanVersionStore?: typeof cleanVersionStore | undefined;
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
  getPackages(input: { path: string; land?: 'designer' | 'dashboard' | undefined }): Promise<DesktopGetPackagesResult>;
  resolveKey(input: { path: string; answer: 'env' | 'fresh' | 'new'; title?: string | undefined }): Promise<DesktopResolveKeyResult>;
  updateProject(input: { path: string }): Promise<DesktopUpdateProjectResult>;
  updateApp(): boolean;
  connect(input: { address: string; anyway?: boolean | undefined }): Promise<DesktopConnectResult>;
  guests(): DesktopGuest[];
  forgetGuest(address: string): Promise<DesktopGuest[]>;
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

  const guestList = (): DesktopGuest[] => deps.readConfig().guests.map((guest) => ({ address: guest.address, version: guest.version }));

  /** The real path of a project folder the person agreed to open, as its code is now; `null` otherwise. */
  const agreedRoot = (path: string): string | null => {
    let root: string;
    try {
      root = real(path);
    } catch {
      return null;
    }
    if (!isProjectFolder(root, deps.folder.exists)) return null;
    const known = deps.readConfig().projects.find((entry) => entry.path === root) ?? null;
    return known === null || known.trusted === null || known.trusted !== fingerprint(root) ? null : root;
  };

  /**
   * The engine's facts for a folder. Asking costs a second or two (a program is started), and one opening may ask
   * several times (a screen, "Continue", the next screen): within an opening the answer is kept. A new opening
   * (`fresh`) asks again, and so does anything that changed the folder (see `forgetFacts`).
   */
  let kept: { root: string; facts: FolderFacts | null } | null = null;
  const factsOf = async (root: string, fresh: boolean): Promise<FolderFacts | null> => {
    if (deps.folderFacts === undefined) return null;
    if (!fresh && kept !== null && kept.root === root) return kept.facts;
    const facts = await deps.folderFacts(root);
    kept = { root, facts };
    return facts;
  };
  const forgetFacts = (): void => {
    kept = null;
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
        await deps.saveConfig(rememberProject(deps.readConfig(), { path: root, name: input.name.trim(), state: 'building', trusted: fingerprint(root), reviewed: true }, now()));
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
      const name = known?.name ?? nameFromFolder(root);
      // The first time here: what the folder holds and who it came with are shown once, and a version store that
      // travelled loses its sender's settings before anything asks git about it.
      const first = known === null || !known.reviewed;
      if (first && (known === null || known.trusted === null)) (deps.cleanVersionStore ?? cleanVersionStore)(root);
      await deps.saveConfig(rememberProject(config, { path: root, name, trusted: code }, now()));
      const seen = new Set(input.seen ?? []);
      const where = { path: root, displayPath: shown(root) };

      // Read, not run: the engine opens the folder's files and starts nothing of it.
      const facts = await factsOf(root, seen.size === 0);
      let pinNoted: string | null | undefined;
      if (facts !== null) {
        if (facts.running !== null) return { status: 'running', path: root, port: facts.running.port, by: facts.running.by };
        // Before anything is started: a store from a newer Adminium is not one this one may touch.
        if (facts.newer.length > 0) return { status: 'needs-newer', path: root, last: facts.lastEngine ?? facts.newer.at(-1)?.appliedBy ?? null, here: facts.engine.here };
        if (first && facts.otherManager !== null && !seen.has('manager')) return { status: 'other-manager', ...where, manager: facts.otherManager.manager };
        const pin = enginePin(facts);
        if (pin !== null && olderThan(pin, facts.engine.here)) {
          // Offered once per pin: declined, the project still opens, and is not asked again until the pin changes.
          if (known?.engineNoted !== pin && !seen.has('engine')) return { status: 'older-engine', ...where, was: pin, here: facts.engine.here };
          pinNoted = pin;
        } else pinNoted = null;
      }
      // Packages for THIS computer: none, or ones another kind of computer installed.
      if (facts === null ? !hasPackages(root) : facts.install === 'no-packages' || facts.install === 'another-machine') return { status: 'needs-packages', ...where };
      if (facts !== null) {
        if (facts.database === 'sqlite' && !facts.secret) {
          return { status: 'key-missing', ...where, name, dataBefore: dataBeforeName(now()) };
        }
        if (!seen.has('found') && facts.database !== 'elsewhere') {
          const made = (deps.prepareNewData ?? prepareNewData)(root, facts);
          if (made.key || made.database) forgetFacts();
          const rows: DesktopFoundRow[] = facts.database === 'sqlite' ? ['data', 'key'] : made.key ? ['no-data', 'made-key-and-database'] : made.database ? ['no-data', 'made-database'] : [];
          // Said the first time, and whenever something was made: never a key or a database made in silence.
          if (rows.length > 0 && (first || made.key || made.database)) return { status: 'found', ...where, name, rows };
        }
        if (first && cameWithAccounts(facts) && !seen.has('accounts')) {
          return { status: 'accounts', ...where, accounts: { people: facts.people, apiKeys: facts.apiKeys, publicKeys: facts.publicKeys } };
        }
      }
      const latest = deps.readConfig();
      await deps.saveConfig(rememberProject(latest, { path: root, name, reviewed: true, ...(pinNoted === undefined ? {} : { engineNoted: pinNoted }) }, now()));
      deps.onChoice({ kind: 'project', root, ...(input.land === 'dashboard' ? { land: 'dashboard' as const } : {}) });
      return { status: 'opened' };
    },

    async getPackages(input) {
      if (!deps.folder.exists(input.path)) return { status: 'missing' };
      let root: string;
      try {
        root = real(input.path);
      } catch {
        return { status: 'missing' };
      }
      if (!isProjectFolder(root, deps.folder.exists)) return { status: 'not-a-project' };
      // Only into a folder the person agreed to open, as its code is now: `openProject` is where that is asked.
      const known = deps.readConfig().projects.find((entry) => entry.path === root) ?? null;
      if (known === null || known.trusted === null || known.trusted !== fingerprint(root)) return { status: 'trust-needed' };
      // None at all, or ones another kind of computer installed (a folder copied from a Mac to Windows).
      const need = deps.folderFacts === undefined ? null : ((await deps.folderFacts(root))?.install ?? null);
      if (!hasPackages(root) || need === 'another-machine') {
        if (deps.installPackages === undefined) return { status: 'failed', detail: CANNOT_MAKE_PROJECT };
        if (making) return { status: 'failed', detail: 'Packages are already being fetched.' };
        making = true;
        try {
          const got = await deps.installPackages({ root });
          forgetFacts();
          if (!got.ok) return { status: 'failed', detail: got.detail };
        } finally {
          making = false;
        }
        // The lockfile an install writes is the project's own change, not one to ask about on the next opening.
        const config = deps.readConfig();
        await deps.saveConfig({ ...config, projects: config.projects.map((entry) => (entry.path === root ? { ...entry, trusted: fingerprint(root) } : entry)) });
      }
      deps.onChoice({ kind: 'project', root, ...(input.land === 'dashboard' ? { land: 'dashboard' as const } : {}) });
      return { status: 'opened' };
    },

    async resolveKey(input) {
      const root = agreedRoot(input.path);
      if (root === null) return { status: 'trust-needed' };
      const facts = deps.folderFacts === undefined ? null : await deps.folderFacts(root);
      // Asked only of a folder that really has data and no key: nothing here is ever a way to write a key over one.
      if (facts === null || facts.database !== 'sqlite' || facts.secret) return { status: 'failed', detail: 'This project is not missing its key.' };
      let answer: MissingKeyAnswer;
      if (input.answer === 'env') {
        const file = deps.chooseFile === undefined ? null : await deps.chooseFile({ title: input.title ?? '.env', defaultPath: deps.folder.home });
        if (file === null) return { status: 'cancelled' };
        answer = { kind: 'env', file };
      } else answer = { kind: input.answer };
      const outcome = (deps.resolveMissingKey ?? resolveMissingKey)(root, facts, answer, { now: now() });
      forgetFacts();
      if (outcome.ok) return { status: 'done' };
      return outcome.reason === 'not-a-key-file' ? { status: 'not-a-key-file' } : { status: 'failed', detail: outcome.detail ?? '' };
    },

    async updateProject(input) {
      const root = agreedRoot(input.path);
      if (root === null) return { status: 'trust-needed' };
      if (deps.updateProject === undefined) return { status: 'failed', detail: CANNOT_MAKE_PROJECT };
      if (making) return { status: 'failed', detail: 'Packages are already being fetched.' };
      making = true;
      try {
        const updated = await deps.updateProject({ root });
        forgetFacts();
        if (!updated.ok) return { status: 'failed', detail: updated.detail };
      } finally {
        making = false;
      }
      // The new pin is the project's own change (the person asked for it), not one to ask about at the next opening.
      const config = deps.readConfig();
      await deps.saveConfig({ ...config, projects: config.projects.map((entry) => (entry.path === root ? { ...entry, trusted: fingerprint(root) } : entry)) });
      return { status: 'updated' };
    },

    updateApp: () => deps.updateApp?.() ?? false,

    async connect(input) {
      const judged = judgeGuestAddress(input.address);
      if (!judged.ok) return { status: judged.reason };
      // Said before anything is sent there: a password typed on that page would cross the network readable.
      if (!judged.encrypted && input.anyway !== true) return { status: 'not-encrypted', address: judged.origin };
      if (deps.checkGuest === undefined || deps.openGuest === undefined) return { status: 'no-answer' };
      const found = await deps.checkGuest(judged.origin);
      if (!found.ok) return { status: found.reason };
      await deps.openGuest({ origin: judged.origin, encrypted: judged.encrypted });
      const config = deps.readConfig();
      await deps.saveConfig({ ...config, guests: rememberGuest(config.guests, judged.origin, found.version, now()) });
      return { status: 'opened', guests: guestList() };
    },

    guests: () => guestList(),

    async forgetGuest(address) {
      const config = deps.readConfig();
      // Only an address that is on the list: this is not a way to clear any cookie jar by name.
      if (config.guests.some((guest) => guest.address === address)) {
        await deps.clearGuest?.(address).catch(() => undefined);
        await deps.saveConfig({ ...config, guests: config.guests.filter((guest) => guest.address !== address) });
      }
      return guestList();
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
