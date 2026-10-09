// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adminium Designer, put together for one project folder.
 *
 * The server builds this once, in design mode, and hands it to the routes.
 * It owns the session files, the runner, and the end of every turn: the
 * engine's own check, build and apply, and the version that records what was
 * made. The model never applies anything itself; it writes files, and this
 * decides what becomes of them.
 */
import type { Attachment, Attachments } from './attachments.js';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { MetaDb } from '@adminium/meta';

import type { AppInstallService, InstallActor, InstallHost } from '../apps/install-service.js';
import { ConflictError, NotFoundError, ValidationFailedError } from '../errors.js';
import type { AiConnections, ConnectionId } from '../llm/connections.js';
import { rebuildApps } from '../project/build.js';
import { checkApp } from '../project/apps/check-app.js';
import { dashboardPageLine, designIssues } from '../project/apps/design-check.js';
import { builtInStylesDir, findDesignSkill, listDesignSkills, type DesignSkill } from '../project/apps/design-skills.js';
import { ICONS_PACKAGE, listedPackages } from './needs.js';
import { applyLook, cleanLook, DESIGN_CSS_START, isDirection, lookInUse, missingFonts, ownFontPatch, readLook, resolveLook, sideLookFiles, sidesWithScreens, type Look } from '../project/apps/look.js';
import { hasOwnBuild } from '../project/apps/own-build.js';
import type { ProjectApps } from '../project/apps/project-apps.js';
import { sideCallIssues, sideCallLines } from '../project/apps/side-calls.js';
import { outsidePictureLines, outsidePictures } from '../project/apps/side-pictures.js';
import { appKeyProblem, DEFAULT_LOOK, nameFromKey, scaffoldApp } from '../project/apps/scaffold-app.js';
import { APPS_DIR } from '../project/apps/read-app.js';
import { findProject } from '../project/locate.js';
import { personLog, type DesignerEvent, type DesignerEventBody, type EventLog } from './events.js';
import { appJsonProblem, groupFiles, hashOf, isAppJson, isLookFile, isText, listEditable, saveLabel, withLineEnds, FILES_SAVED_MAX, type FileGroup } from './files.js';
import { createJail, JailError, MAX_WRITE_BYTES } from './jail.js';
import { HAND_EDITS_MAX, noCardRefusal } from './write-guard.js';
import { cleanSight, createSights, sightText } from './sight.js';
import { createDesignerRunner, type Actor, type BusyKind, type DesignerLimits, type DesignerRunner, type PipelineResult, type TurnHandle } from './runner.js';
import { createSessionStore, DESIGNER_TARGETS, type DesignerSession, type DesignerTarget, type SessionStore } from './session-store.js';
import type { DesignerTool } from './tool-types.js';
import type { Versions } from './versions.js';
import { DESIGNER_MAX_OUTPUT_TOKENS } from './prompt.js';

export interface DesignerHost {
  /** The project folder. */
  root: string;
  /** This engine's version, which an app is checked and built against. */
  version: string;
  meta: MetaDb;
  connections: AiConnections;
  /** The server's folder apps, once they are put together (they are made after the routes). */
  projectApps: () => ProjectApps | null;
  service: AppInstallService;
  installHost: InstallHost;
  /** The person behind a turn, as the install service asks about them. */
  actorFor(by: Actor): InstallActor;
  publish(event: DesignerEvent & { sessionId: string }): void;
  limits(): Promise<DesignerLimits>;
  audit(action: string, actor: Actor | null, detail: Record<string, unknown>): Promise<void>;
  log: (message: string, error?: unknown) => void;
  /** What people attach to a message. */
  attachments?: Attachments;
  /** The tools and what the model is told; given by the parts that build them. */
  tools?: (session: DesignerSession) => DesignerTool[];
  prompt?: (session: DesignerSession, messages: import('@adminium/llm').RunMessage[], opts?: import('./prompt.js').PromptOpts) => Promise<{ system: string; messages: import('@adminium/llm').RunMessage[] }>;
  /** Versions after each turn; absent in a harness that keeps none. */
  versions?: Versions | null;
  /** The sites this server lets pages load pictures from; absent in a harness with no policy. */
  pictureSites?: import('./tool-types.js').PictureSites;
  /** Where the built-in styles are; found beside the engine when left out. */
  stylesDir?: string | null;
  /** Asking the person for what a design needs, on one card. Absent in a harness that asks for nothing. */
  needs?: import('./ask-needs.js').NeedsAsker;
  /** How long a hand save, a style change or going back may hold the folder; the runner's own cap when left out. */
  holdCapMs?: number;
  /** For tests: called with a name as a hand save, a style change or going back reaches a step, so one can be held open or made to fail there. */
  seam?: (step: 'held' | 'write', detail?: string) => void | Promise<void>;
  /** Whether this Designer can look for pictures now (a source it may call). */
  findsPictures?: () => boolean;
  /** Take an app's sample rows out and add them again, as its files now have them (with pictures they did not have). */
  reseedSample?: (appKey: string) => Promise<void>;
}

export interface CreateSessionInput {
  /** An app already in the folder; absent to make a new one. */
  appKey?: string | undefined;
  /** What a new app is called. Its key is made from it. */
  name?: string | undefined;
  /** What the session is called until the app has a name: the first words of the request. Never the app's key. */
  title?: string | undefined;
  target: DesignerTarget;
  connectionId: string;
  model: string;
  /** A style picked at the start: a design skill's key. */
  style?: string | undefined;
}

export interface Designer {
  store: SessionStore;
  runner: DesignerRunner;
  createSession(input: CreateSessionInput, by: Actor): Promise<DesignerSession>;
  /** The engine's last word on a turn. Exposed for the tools that apply mid-turn. */
  pipeline(session: DesignerSession, handle: TurnHandle, opts?: { version?: boolean; askRemovals?: boolean; /** What the version is called after its number. */ label?: string }): Promise<PipelineResult>;
  /** The files of the session's app a person may read and save by hand, in groups; what has the folder now; the newest version. */
  listFiles(sessionId: string): Promise<{ groups: FileGroup[]; busy: BusyKind | null; version: number | null }>;
  /** One file of that list, as text, with the hash of its bytes. 404 for a path that is not on the list, whatever the reason. */
  readFile(sessionId: string, path: string): Promise<{ path: string; content: string; hash: string }>;
  /**
   * Save files by hand, all or none: each must be on the list and still be
   * what the person opened (`base`). Then the engine's check, build and apply,
   * and a version named for the files. No model is called.
   */
  saveFiles(sessionId: string, files: readonly SavedFile[], by: Actor): Promise<SaveResult>;
  /**
   * Put the folder back as version `n` was (0: before the session), and apply
   * it. With `record` that is a new version on top (O1); without, it is "put
   * the files back" after a stopped turn (O3).
   */
  restore(sessionId: string, n: number, opts: { record: boolean; by: Actor }): Promise<{ version: { n: number; name: string } | null; applied: boolean }>;
  /** The look of the app's own screens, when it has screens whose look can be changed here; else null. */
  lookOf(appKey: string): Look | null;
  /**
   * Whether the app still waits for its name: this session made it, nothing
   * of it is written or applied yet, and its key is still the first words of
   * the request.
   */
  needsName(session: DesignerSession): boolean;
  /**
   * Give a new app its name, and make its key from the name. Only while the
   * app is as bare as it was made: the folder is moved, and nothing that
   * names the key has been written yet.
   */
  nameApp(sessionId: string, name: string): Promise<{ key: string; name: string }>;
  /** After the app is next applied, its sample rows are added again: they were given pictures after they went in. */
  reseedAfterApply(appKey: string): void;
  /** What the preview saw of the app's screen (what is measurably broken on it, a picture of it). False when it is not a sight. */
  sawPage(sessionId: string, input: unknown): boolean;
  /** The styles a person can pick here: built in, and the project's own. */
  styles(): DesignSkill[];
  /** A look as the page is told it: the style, its name and where it is from; never the person's words. */
  publicLook(appKey: string): PublicLook | null;
  /**
   * "Change the style": write a style to every side, build, apply and save a
   * version. No model is called. Fonts the style names and the project lacks
   * are stood in for by the system's until the next message, which asks for them.
   */
  setLook(sessionId: string, look: { skill: string; accent?: string | undefined }, by: Actor): Promise<{ look: PublicLook; version: { n: number; name: string } | null; applied: boolean }>;
  /**
   * Build the folder's apps and apply them, with no turn behind it: what the
   * check, the build or the apply says is wrong with `key`, or nothing.
   */
  buildAndApply(key: string, signal?: AbortSignal): Promise<string[]>;
  shutdown(): Promise<void>;
}

/** A file as a hand save sends it: its path, its whole text, and the hash it had when the person opened it. */
export interface SavedFile {
  path: string;
  content: string;
  base: string;
}

export interface SaveResult {
  /** Whether the engine applied the app as it now is. When not, the files stay written and no version is made. */
  applied: boolean;
  version: { n: number; name: string } | null;
  /** Each saved file as it is on disk now. */
  files: { path: string; hash: string }[];
  /** Why it was not applied: the stage that said no, and its words. */
  problems?: { stage: 'check' | 'build' | 'apply'; lines: string[] };
}

/** Words that ask, beyond doubt, for a screen of the app's own: a turn that ends with none is sent back. (A phone number is no screen.) */
export const ASKS_FOR_SCREENS =
  /\b(web ?site|web ?page|landing page|home ?page|public (page|site|form)|a (site|page) for|storefront|portal|booking page|order online|kiosk|staff (screen|side)|customers? (can|could|should|need to|must) (see|book|order|send|browse|view|track|reserve|request|sign up))\b/i;

export interface PublicLook {
  skill: string;
  title: string;
  origin: 'built-in' | 'project' | 'earlier';
  accent?: string;
  swatch?: { bg: string; text: string; accent: string };
}

/** The picture columns of tables customers read, no sample row of which has a picture. */
export function emptyPictureColumns(root: string, appKey: string, manifest: unknown): { table: string; column: string }[] {
  const app = manifest as { kind?: string; publicAccess?: { table?: string; methods?: string[] }[]; requiredSchema?: { tables?: { ref: string; columns: { ref: string; type: string; semantic?: string }[] }[] } } | null;
  if (app === null || app.kind !== 'app') return [];
  let rows: Record<string, Record<string, unknown>[]> = {};
  try {
    const bundle = JSON.parse(readFileSync(join(root, APPS_DIR, appKey, 'seeds', 'sample.json'), 'utf8')) as { tables?: { ref: string; rows: Record<string, unknown>[] }[] };
    rows = Object.fromEntries((bundle.tables ?? []).map((table) => [table.ref, table.rows]));
  } catch {
    return [];
  }
  const read = new Set((app.publicAccess ?? []).filter((entry) => (entry.methods ?? []).includes('GET')).map((entry) => entry.table));
  return (app.requiredSchema?.tables ?? []).flatMap((table) =>
    !read.has(table.ref) || (rows[table.ref] ?? []).length === 0
      ? []
      : table.columns.filter((column) => column.type === 'text' && column.semantic === 'image' && (rows[table.ref] ?? []).every((row) => row[column.ref] === undefined || row[column.ref] === null)).map((column) => ({ table: table.ref, column: column.ref })),
  );
}

/** A key made from a name, free in this folder: `Repair desk` → `repair-desk`, then `-2`, `-3`. */
export function keyFromName(root: string, name: string): string {
  const base =
    name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/^[^a-z]+/, '')
      .slice(0, 60) || 'my-app';
  const free = (key: string): boolean => appKeyProblem(key) === null && !existsSync(join(root, APPS_DIR, key));
  const first = appKeyProblem(base) === null ? base : `app-${base}`.slice(0, 60);
  if (free(first)) return first;
  for (let n = 2; n < 1000; n += 1) {
    if (free(`${first}-${String(n)}`)) return `${first}-${String(n)}`;
  }
  throw new ConflictError('No free key could be made for that name.', 'CONFLICT', { reason: 'NO_FREE_KEY' });
}

/**
 * The tables nobody can open: no dashboard page shows them, and no role is
 * granted them. A child table (lines, payments) is opened through its
 * parent's page, and an outbox is the engine's own, so neither is named.
 */
export function unopenedTables(manifest: unknown): string[] {
  const app = manifest as {
    requiredSchema?: { tables?: { ref: string; part?: string; columns: { type: string; references?: string }[] }[] };
    pages?: { bindings?: Record<string, string> }[];
    roles?: { permissions?: string[] }[];
    outbox?: { table?: string };
    publicAccess?: unknown[];
    frontends?: { side?: string; kind?: string }[];
  } | null;
  const tables = app?.requiredSchema?.tables ?? [];
  if (tables.length === 0) return [];
  const shown = new Set((app?.pages ?? []).flatMap((page) => Object.values(page.bindings ?? {})));
  const granted = new Set((app?.roles ?? []).flatMap((role) => role.permissions ?? []).flatMap((permission) => /^table:@([a-z0-9_]+):/.exec(permission)?.[1] ?? []));
  const out: string[] = [];
  for (const table of tables) {
    if (table.ref === app?.outbox?.table) continue;
    // A table that hangs off one that has a page is reached from there.
    const parentShown = table.columns.some((column) => column.type === 'fk' && column.references !== undefined && column.references !== table.ref && shown.has(column.references));
    if (!shown.has(table.ref) && !parentShown) out.push(`- The table "${table.ref}" has no dashboard page: nobody can open it.`);
    if (!granted.has(table.ref)) out.push(`- No role is granted the table "${table.ref}": staff cannot read it.`);
  }
  // Customers were given a way in, and no screen to come in by.
  if ((app?.publicAccess ?? []).length > 0 && !(app?.frontends ?? []).some((side) => side.side === 'customer' && side.kind !== 'none')) {
    out.push('- Customers may reach the app’s data (access.json), and the app has no customer screen: if the person asked for a page their customers use, build the customer side.');
  }
  return out;
}

/** A column Adminium treats as a person's own by its name, and masks: the commonest ones, read as the engine reads them. */
const PERSONAL_COLUMN = /(^|_)(e_?mail|phone|mobile|telephone|tel)(_|$)/;

/**
 * A role that reads a table and not its personal columns. To that role an
 * email or a phone number reads as empty, and a board or a chart that shows
 * the column is refused outright: seen in the preview, which is shown as the
 * app's own role, as an error on the app's first page.
 */
export function unreadPersonalColumns(manifest: unknown): string[] {
  const app = manifest as { requiredSchema?: { tables?: { ref: string; columns: { ref: string }[] }[] }; roles?: { key?: string; name?: string; permissions?: string[] }[] } | null;
  const out: string[] = [];
  for (const table of app?.requiredSchema?.tables ?? []) {
    const personal = table.columns.map((column) => column.ref).filter((ref) => PERSONAL_COLUMN.test(ref));
    if (personal.length === 0) continue;
    for (const role of app?.roles ?? []) {
      const held = new Set(role.permissions ?? []);
      if (!held.has(`table:@${table.ref}:read`) || held.has(`table:@${table.ref}:read_pii`)) continue;
      out.push(
        `- The role "${role.key ?? role.name ?? ''}" reads the table "${table.ref}" and not its personal columns (${personal.join(', ')}): to that role they read as empty, and a board that shows one is refused. If these people work with them, add "table:@${table.ref}:read_pii" to the role in manifest/roles.json; if they should not see them, say so in a sentence.`,
      );
    }
  }
  return out;
}

/**
 * What customers read with nothing in it: a first preview that opens on an
 * empty list. Said only before the app's first version, since sample rows
 * are added once, at the first install.
 */
export function emptyFirstPreview(manifest: unknown): string[] {
  const app = manifest as { kind?: string; publicAccess?: { table?: string; methods?: string[] }[]; sampleData?: unknown } | null;
  if (app === null || app.kind !== 'app' || app.sampleData !== undefined) return [];
  const read = [...new Set((app.publicAccess ?? []).filter((entry) => (entry.methods ?? []).includes('GET') && typeof entry.table === 'string').map((entry) => entry.table as string))];
  if (read.length === 0) return [];
  return [
    `- Customers read ${read.map((table) => `"${table}"`).join(', ')} and the app brings no sample rows, so their page opens empty: write manifest/sample.json ({ "sampleData": { "file": "seeds/sample.json" } }) and seeds/sample.json with 4 to 8 believable rows for ${read.length === 1 ? 'it' : 'each'}.`,
  ];
}

/** The text of every source file under a side's `src/`, a few dozen at most. */
function sourcesOf(dir: string): string[] {
  const out: string[] = [];
  const walk = (folder: string): void => {
    if (!existsSync(folder) || out.length >= 60) return;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && /\.(tsx?|jsx?|mjs)$/.test(entry.name) && out.length < 60) out.push(readFileSync(path, 'utf8'));
    }
  };
  walk(dir);
  return out;
}

/**
 * A side whose screen is still a placeholder: a few lines that show nothing,
 * or the starter's own screen over tables this app does not have.
 */
export function placeholderScreens(root: string, appKey: string, tables: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const side of ['staff', 'customer'] as const) {
    const file = join(root, APPS_DIR, appKey, side, 'src', 'App.tsx');
    if (!existsSync(file)) continue;
    const source = readFileSync(file, 'utf8');
    const starter = /const ITEMS = 'items'/.test(source) && !tables.includes('items');
    // The whole side is read: a screen may keep its calls in a file beside App.tsx.
    const all = sourcesOf(join(root, APPS_DIR, appKey, side, 'src')).join('\n');
    const calls = /\.(list|create|get|update|remove)\(|createPublicClient|fetch\(/.test(all);
    if (starter) out.push(`- apps/${appKey}/${side}/src/App.tsx is still the starter's screen, over tables this app does not have: write it for this app's tables.`);
    else if (!calls) out.push(`- apps/${appKey}/${side}/src/ shows nothing real yet (it reads no table): write the screen the person asked for.`);
    // A screen that left the starter's parts behind is the browser's default look: bare.
    if (/\ben\(\s*['"`]en-[A-Z]{2}\s*:/.test(all)) out.push(`- apps/${appKey}/${side}/src/ calls en('en-US: …'): en() takes the English text alone, so people see "en-US:" on the page. Take the tag out.`);
  }
  return out;
}

export function createDesigner(host: DesignerHost): Designer {
  const store = createSessionStore(host.root);
  const project = (): { root: string; configFile: string } => {
    const found = findProject(host.root, {});
    if (found === null) throw new ConflictError('The project folder has no adminium.config file any more.', 'CONFLICT', { reason: 'NOT_A_PROJECT' });
    return found;
  };

  /** A copy of a published app keeps its authors' styles; an app with no side has nothing to restyle. */
  const lookOf = (appKey: string): Look | null => {
    if (hasOwnBuild(host.root, appKey)) return null;
    const themed = sidesWithScreens(host.root, appKey).filter((side) => existsSync(join(host.root, APPS_DIR, appKey, side, 'src', 'theme.css')));
    return themed.length === 0 ? null : lookInUse(host.root, appKey, DEFAULT_LOOK);
  };
  const stylesDir = host.stylesDir === undefined ? builtInStylesDir() : host.stylesDir;
  const places = { builtInDir: stylesDir };
  const publicLook = (appKey: string): PublicLook | null => {
    const look = lookOf(appKey);
    if (look === null) return null;
    const resolved = resolveLook(host.root, look, places);
    const theme = resolved.theme;
    return {
      skill: look.skill,
      title: resolved.title,
      // A look kept before styles is drawn with its own old values: it is none of the list's.
      origin: look.direction !== undefined ? 'earlier' : (resolved.skill?.origin ?? 'project'),
      ...(look.accent === undefined ? {} : { accent: look.accent }),
      ...(theme === null ? {} : { swatch: { bg: theme.light.bg, text: theme.light.text, accent: theme.light.accent } }),
    };
  };

  /**
   * A session's title follows the name its app was given, while the title is
   * still the one made from the first words of the request and the session
   * made the app. A person who renamed the session keeps their name.
   */
  const followName = (session: DesignerSession): void => {
    if (!session.createdApp || session.titled === true) return;
    const manifest = checkApp(host.root, session.appKey, { version: host.version }).manifest;
    const name = manifest !== null && typeof manifest.name === 'string' ? manifest.name.trim() : '';
    if (name !== '' && name !== session.title && name.length <= 80) store.update(session.id, { title: name });
  };

  /** Apps whose sample rows are to be added again once they are next applied. */
  const reseeds = new Set<string>();
  /** What the last install or apply of each app said about its pages. */
  const pageWarnings = new Map<string, string[]>();
  /** Public access the last apply left as it was: the screens are refused what the manifest grants until it is settled. */
  const accessWarnings = new Map<string, string[]>();

  async function pipeline(session: DesignerSession, handle: TurnHandle, opts: { version?: boolean; askRemovals?: boolean; label?: string } = {}): Promise<PipelineResult> {
    const { events, turn } = handle;
    const key = session.appKey;

    // 1. The judge: the same check `adminium app check` runs.
    const check = checkApp(host.root, key, { version: host.version });
    const findings = check.findings.slice(0, 40).map((finding) => ({ file: finding.file, path: finding.path, message: finding.message, level: finding.level }));
    const errors = check.findings.filter((finding) => finding.level === 'error');
    events.emit(turn, { kind: 'check', ok: errors.length === 0, findings });
    if (errors.length > 0) return { ok: false, version: null };

    // Told to stop (Stop, a cap, a shutdown): nothing more is built or applied.
    if (handle.signal.aborted) return { ok: false, version: null };

    // 2. Built as `adminium build` builds it: the manifest put together, the screens bundled.
    const built = await rebuildApps(project(), { version: host.version, dev: true, signal: handle.signal });
    const app = built.apps.find((candidate) => candidate.key === key);
    const problems = app?.problems ?? (app === undefined ? [`apps/${key} was not built.`] : []);
    events.emit(turn, { kind: 'build', ok: problems.length === 0, problems: problems.slice(0, 20) });
    if (problems.length > 0) return { ok: false, version: null };

    if (handle.signal.aborted) return { ok: false, version: null };

    // 3. Applied by the server, as `adminium dev` applies a saved file.
    const apps = host.projectApps();
    if (apps === null) {
      events.emit(turn, { kind: 'apply', ok: false, state: 'not-applied', stage: 'server', message: 'This server runs no project apps.' });
      return { ok: false, version: null };
    }
    const results = await apps.reconcile();
    const result = results.find((candidate) => candidate.key === key);
    const applied = result !== undefined && (result.state === 'installed' || result.state === 'applied' || result.state === 'unchanged');
    events.emit(turn, {
      kind: 'apply',
      ok: applied,
      state: result?.state ?? 'not-applied',
      ...(result?.stage === undefined ? {} : { stage: result.stage }),
      ...(result?.message === undefined ? {} : { message: result.message }),
    });
    if (!applied) return { ok: false, version: null };

    // Sample rows that were given pictures after they went in: taken out and added again, now that the server has the files.
    if (reseeds.delete(key) && host.reseedSample !== undefined) {
      await host.reseedSample(key).catch((error: unknown) => {
        host.log('could not add an app’s sample rows again with their pictures', error);
      });
    }

    // What the manifest no longer declares, and holds data, waits for the person here.
    const waiting = opts.askRemovals === false ? null : await host.service.removals.pending(key);
    if (waiting !== null) {
      const answer = await handle.ask({ type: 'removal', appKey: key, changes: waiting.changes });
      if (answer.type === 'removal') {
        await host.service.answerRemoval(host.actorFor(handle.by), host.installHost, { key, accept: answer.accept });
      }
    }

    // An apply that changes nothing says nothing about its pages: what the last real one said still holds.
    if (result?.state === 'installed' || result?.state === 'applied') {
      pageWarnings.set(key, result.pageWarnings ?? []);
      accessWarnings.set(key, result.accessWarnings ?? []);
    }
    const kept = pageWarnings.get(key) ?? [];
    const warnings = kept.length === 0 ? {} : { warnings: kept };
    followName(session);
    if (opts.version === false || host.versions == null) return { ok: true, version: null, ...warnings };
    const version = await host.versions.commit(session, opts.label);
    if (version !== null) {
      store.update(session.id, { version: version.n });
      events.emit(turn, { kind: 'version', n: version.n, name: version.name });
    }
    return { ok: true, version, ...warnings };
  }

  /**
   * A CSV the person attached to this turn's message whose rows nobody tried
   * to load: said once, so a model that shaped the table and stopped is sent
   * back for the half the person came for. A load that was asked and refused,
   * or that failed, is not said again.
   */
  /** The CSV files attached to this turn's message whose rows nobody tried to load. */
  const unloadedCsv = (session: DesignerSession): { messages: import('@adminium/llm').RunMessage[]; files: Attachment[] } => {
    if (host.attachments === undefined) return { messages: [], files: [] };
    const messages = store.messages(session.id).filter((entry) => entry.turn === session.turns).map((entry) => entry.message);
    const noted = messages.flatMap((message) => (message.role === 'user' ? message.content.flatMap((block) => (block.type === 'text' ? [...block.text.matchAll(/\(attachment (att_[0-9a-f]{20});/g)].map((match) => match[1] as string) : [])) : []));
    const tried = new Set(messages.flatMap((message) => message.content.flatMap((block) => (block.type === 'tool_call' && block.name === 'load_rows' && typeof block.input['attachment'] === 'string' ? [block.input['attachment']] : []))));
    const files = [...new Set(noted)].filter((id) => !tried.has(id)).flatMap((id) => {
      const entry = host.attachments?.find(session.id, id) ?? null;
      return entry === null || entry.kind !== 'csv' ? [] : [entry];
    });
    return { messages, files };
  };
  const unloadedFiles = (session: DesignerSession): string[] => {
    const { messages, files } = unloadedCsv(session);
    return files.map((entry) => {
      const first = `- The person attached "${entry.label}" (${String(entry.rows ?? 0)} rows) and its rows were not loaded: once the app is applied, call the tool load_rows with attachment ${entry.id} for the table the file belongs to (the person is asked first). If its rows belong in no table, say so in a sentence and finish.`;
      // Said among other things and passed over: said once more, alone in its words, since it is what the person attached the file for.
      const again = `- "${entry.label}" is still not loaded, and the person attached it to have its rows in the app. Call the tool load_rows now (not check_app, not apply_app): attachment ${entry.id}, the table, and which CSV column goes to which column. Or say in one sentence why its rows are not loaded.`;
      const toldFirst = messages.some((message) => message.role === 'user' && message.content.some((block) => block.type === 'text' && block.text.includes(first)));
      return toldFirst ? again : first;
    });
  };

  // What each session's preview last saw. Its picture is a file of the session, under a name of this server's.
  const sights = createSights();
  const SIGHT_FILE = /^the (staff|customer) page as it shows\.jpg$/;

  const runner = createDesignerRunner({
    store,
    sight: async (session, opts) => {
      // Nothing to look at: a copy of a published app is its authors', and a dashboard-only app has no screen of its own.
      if (hasOwnBuild(host.root, session.appKey) || sidesWithScreens(host.root, session.appKey).length === 0) return null;
      const sight = await sights.wait(session.id, opts.since, { signal: opts.signal });
      if (sight === null) return null;
      if (opts.again) return sight.stopped ? { text: sightText(sight, session.appKey, false, true) as string, side: sight.side, path: sight.path ?? '/' } : null;
      // The picture goes only to a model that reads pictures, as a file of this session: one at a time, the last one replaced.
      const reads = sight.picture !== null && host.attachments !== undefined && (await host.connections.readsImages(session.connectionId as ConnectionId, session.model).catch(() => null)) === true;
      let image: { ref: string; mediaType: string; name: string } | undefined;
      if (reads && sight.picture !== null && host.attachments !== undefined) {
        // The last picture of the page gives way to this one: found by its name, so one kept before a restart goes too.
        for (const old of host.attachments.list(session.id)) if (SIGHT_FILE.test(old.label)) host.attachments.remove(session.id, old.id);
        try {
          const kept = host.attachments.add(session.id, { filename: `the ${sight.side} page as it shows.jpg`, bytes: sight.picture });
          image = { ref: kept.id, mediaType: kept.mediaType, name: kept.label };
        } catch {
          // The session holds as many files as it may: the measured lines go without the picture.
        }
      }
      const text = sightText(sight, session.appKey, image !== undefined);
      return text === null ? null : { text, ...(image === undefined ? {} : { image }), side: sight.side, path: sight.path ?? '/' };
    },
    runnerFor: async (session) => {
      const resolved = await host.connections.runner(session.connectionId as ConnectionId, session.model);
      return { runner: resolved.runner, maxTokens: DESIGNER_MAX_OUTPUT_TOKENS };
    },
    ...(host.attachments === undefined ? {} : { attachments: host.attachments }),
    tools: (session) => host.tools?.(session) ?? [],
    prompt: async (session, messages, opts) => host.prompt?.(session, messages, opts) ?? { system: 'You are Adminium Designer.', messages },
    pipeline: (session, handle) => pipeline(session, handle),
    problems: (session) => [
      ...checkApp(host.root, session.appKey, { version: host.version })
        .findings.filter((finding) => finding.level === 'error')
        .map((finding) => `- ${finding.file} · ${finding.path} · ${finding.message}`),
      // A page the server wrote with nothing in it is as unfinished as an error.
      ...(pageWarnings.get(session.appKey) ?? []).map((warning) => `- ${warning} (the page was made empty: fix it or make it a "page-crud")`),
      ...(accessWarnings.get(session.appKey) ?? []).map((warning) => `- ${warning} The customer screen is refused what access.json now grants there: change the entry so the server takes it, or tell the person what is left for them.`),
    ],
    advice: (session) => {
      const manifest = checkApp(host.root, session.appKey, { version: host.version }).manifest;
      const tables = manifest !== null && manifest.kind === 'app' ? (manifest.requiredSchema?.tables ?? []).map((table) => table.ref) : [];
      // A copy of a published app is as its authors laid it out: its tables without pages and its screens are theirs.
      if (hasOwnBuild(host.root, session.appKey)) return [];
      // A name of four words or more is the first words of the request, not a name: it is what customers read in the page's header.
      const named = manifest !== null && typeof manifest.name === 'string' ? manifest.name : '';
      const unnamed =
        session.createdApp && session.titled !== true && session.version === null && named === session.title && named.trim().split(/\s+/).length > 3
          ? [`- The app is still named after the request ("${named}"), and that is what its pages show as the business's name: set "name" in manifest/app.json to what the business would call it, two or three words.`]
          : [];
      // Asked for a website or a screen, and built tables and dashboard pages alone: the half the person came for is missing.
      const asked = store
        .messages(session.id)
        .filter((entry, index, all) => entry.message.role === 'user' && all.findIndex((other) => other.turn === entry.turn) === index)
        .flatMap((entry) => entry.message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])))
        .join(' ');
      const noScreens =
        session.target !== 'dashboard' && ASKS_FOR_SCREENS.test(asked) && sidesWithScreens(host.root, session.appKey).length === 0
          ? [
              `- The person asked for ${/\bwebsite|\bsite\b|public|customers?\b/i.test(asked) ? 'a page customers see' : 'screens of the app\'s own'}, and the app has none yet: call add_side (${/\bstaff\b/i.test(asked) && !/\bwebsite|public|customers?\b/i.test(asked) ? '"staff"' : '"customer"'}) and build it now. Do not ask whether to: it is what they asked for.`,
            ]
          : [];
      return [
        ...noScreens,
        ...unloadedFiles(session),
        ...unopenedTables(manifest),
        ...unreadPersonalColumns(manifest),
        ...placeholderScreens(host.root, session.appKey, tables),
        // A call the page makes that Adminium refuses: the person would meet it as "That did not work".
        ...sideCallLines(sideCallIssues(host.root, session.appKey, manifest)),
        // A picture from a site this server does not let through: the person would meet it as an empty frame.
        ...(host.pictureSites === undefined ? [] : outsidePictureLines(outsidePictures(host.root, session.appKey), host.pictureSites.covers, host.pictureSites.closed() === null)),
        ...(session.version === null ? emptyFirstPreview(manifest) : []),
        ...unnamed,
      ];
    },
    // The design, held last: a class nothing styles, an emoji for an icon, no logo, no brief.
    design: async (session) => {
      const lines = (
        await designIssues(host.root, session.appKey, {
          builtInDir: stylesDir,
          fresh: session.createdApp && session.version === null,
          icons: listedPackages(host.root).has(ICONS_PACKAGE),
          ...(host.findsPictures?.() === true ? { emptyPictureColumns: emptyPictureColumns(host.root, session.appKey, checkApp(host.root, session.appKey, { version: host.version }).manifest) } : {}),
        })
      ).map((issue) => issue.line);
      // Asked for a look, and a dashboard page was written in this turn: those are Adminium's own.
      const all = store.messages(session.id);
      const turn = all.reduce((last, entry) => Math.max(last, entry.turn), 0);
      const mine = all.filter((entry) => entry.turn === turn);
      const request = (mine.find((entry) => entry.message.role === 'user')?.message.content ?? []).flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(' ');
      const written = mine.flatMap((entry) =>
        entry.message.content.flatMap((block) => (block.type === 'tool_call' && (block.name === 'write_file' || block.name === 'edit_file') && typeof block.input['path'] === 'string' ? [block.input['path']] : [])),
      );
      const page = dashboardPageLine(request, written);
      return page === null ? lines : [...lines, page];
    },
    // Before the model is asked: a side made before styles gets the stylesheet of its own it lacks, and fonts a style
    // changed from the page still waits for are asked for, on one card.
    opening: async (session, handle) => {
      const key = session.appKey;
      if (hasOwnBuild(host.root, key)) return;
      const look = lookOf(key);
      if (look === null) return;
      for (const side of sidesWithScreens(host.root, key)) {
        const file = join(host.root, APPS_DIR, key, side, 'src', 'design.css');
        if (existsSync(join(host.root, APPS_DIR, key, side, 'src', 'theme.css')) && !existsSync(file)) writeFileSync(file, DESIGN_CSS_START);
      }
      if (host.needs === undefined || look.direction !== undefined) return;
      const wants = missingFonts(host.root, look, places)
        .filter((font) => !(look.without ?? []).includes(font.family))
        .map((font) => ({ kind: 'font' as const, family: font.family, use: font.use }));
      if (wants.length > 0) await host.needs({ ask: handle.ask, signal: handle.signal, handle }, key, wants);
    },
    // What the person is told when the turn ends and a file they attached is still in no table: the model said nothing of it, so the Designer does.
    closing: (session) =>
      unloadedCsv(session).files.map(
        (entry) => `"${entry.label}" was not loaded: its rows are in no table yet. Ask for it again in a message of its own ("load ${entry.label} into …"), or use Import on the table's page in the dashboard.`,
      ),
    limits: () => host.limits(),
    publish: (event) => {
      host.publish(event);
    },
    audit: (action, session, detail) => host.audit(action, null, { sessionId: session.id, appKey: session.appKey, ...detail }),
    auditCard: (sessionId, by, detail) => host.audit('designer.card.answered', by, { sessionId, ...detail }),
    log: host.log,
    ...(host.holdCapMs === undefined ? {} : { holdCapMs: host.holdCapMs }),
  });

  /** The turn a person's own action stands in for: no turn at all, its events marked so, and nobody to ask. */
  const outsideATurn = (session: DesignerSession, by: Actor, signal: AbortSignal, events: EventLog = personLog(runner.events(session.id))): TurnHandle => ({
    turn: session.turns,
    by,
    events,
    signal,
    ask: () => Promise.reject(new Error('nothing is asked outside a turn')),
  });
  const jailOf = (appKey: string) => createJail(host.root, appKey);
  const editable = (appKey: string) => listEditable(host.root, appKey, { look: lookOf(appKey) !== null });

  /** A new app, as bare as `createSession` made it: its two starting files and nothing the Designer wrote. */
  const stillBare = (appKey: string): boolean => {
    const dir = join(host.root, APPS_DIR, appKey);
    const walk = (folder: string, rel: string): string[] =>
      existsSync(folder) ? readdirSync(folder, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(folder, entry.name), `${rel}${entry.name}/`) : [`${rel}${entry.name}`])) : [];
    return walk(dir, '').every((file) => ['manifest/app.json', 'manifest/roles.json', 'README.md', 'tests/app.test.mjs', '.DS_Store'].includes(file));
  };
  const needsName = (session: DesignerSession): boolean => session.createdApp && session.named !== true && session.version === null && stillBare(session.appKey);

  return {
    store,
    runner,
    pipeline,
    needsName,
    async nameApp(sessionId, given) {
      const session = store.read(sessionId);
      const name = given.replace(/\s+/g, ' ').trim();
      if (name === '' || name.length > 40 || name.split(' ').length > 4) throw new ValidationFailedError('A name is one to four words, 40 characters at most: what the business would call it.', { reason: 'NAME' });
      if (!needsName(session)) throw new ConflictError('The app already has its name and its files: its key stays as it is.', 'CONFLICT', { reason: 'ALREADY_NAMED' });
      const from = join(host.root, APPS_DIR, session.appKey);
      // The folder is taken out of the way first, so the name it has now is free to be the name it keeps.
      const key = keyFromName(host.root, name) === `${session.appKey}-2` ? session.appKey : keyFromName(host.root, name);
      if (key !== session.appKey) {
        rmSync(from, { recursive: true, force: true });
        scaffoldApp({ root: host.root, key, name, sides: [], version: host.version, bare: true });
      } else {
        const file = join(from, 'manifest', 'app.json');
        const app = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
        writeFileSync(file, `${JSON.stringify({ ...app, name, navGroups: [{ key: 'main', label: { 'en-US': name }, order: 1 }] }, null, 2)}\n`);
      }
      const next = store.update(session.id, { appKey: key, named: true, ...(session.titled === true ? {} : { title: name }) });
      // What "put the files back" returns to is the app as it is named now.
      await host.versions?.snapshot(next).catch((error: unknown) => {
        host.log('could not record the folder after an app was named', error);
      });
      await host.audit('designer.app.named', null, { sessionId: session.id, appKey: key, was: session.appKey });
      return { key, name };
    },
    async createSession(input, by) {
      if (!(DESIGNER_TARGETS as readonly string[]).includes(input.target)) {
        throw new ValidationFailedError('Choose what to build for: auto, dashboard or web.', { reason: 'TARGET' });
      }
      const connection = await host.connections.find(input.connectionId);
      if (connection === null) throw new NotFoundError('There is no such model connection.', { connectionId: input.connectionId });
      if (input.model.trim() === '') throw new ValidationFailedError('Choose a model.', { reason: 'MODEL' });
      // A model that cannot call tools cannot build (Q15): said before anything is made.
      const verdict = await host.connections.canBuildWith(connection.id, input.model);
      if (!verdict.canBuild && verdict.reason === 'error') {
        throw new ConflictError(`The model could not be asked: ${verdict.message}`, 'CONFLICT', { reason: 'MODEL_UNREACHABLE', code: verdict.code });
      }
      if (!verdict.canBuild) {
        throw new ConflictError(`This model cannot build: ${verdict.message}`, 'CONFLICT', { reason: 'MODEL_CANNOT_BUILD', why: verdict.reason });
      }

      let appKey = input.appKey;
      let createdApp = false;
      if (appKey === undefined) {
        // No name given: the Designer names the app in its first step, and the key is made from that name. Until then it is "new-app".
        const name = (input.name ?? '').trim() || 'New app';
        if (name.length > 80) throw new ValidationFailedError('An app’s name is at most 80 characters.', { reason: 'NAME' });
        appKey = keyFromName(host.root, name);
        // Bare: the model writes this app's own tables, with nothing of the starter's to clear away first.
        scaffoldApp({ root: host.root, key: appKey, name, sides: [], version: host.version, bare: true });
        createdApp = true;
      } else {
        const problem = appKeyProblem(appKey);
        if (problem !== null || !existsSync(join(host.root, APPS_DIR, appKey))) {
          throw new NotFoundError(`There is no app "${appKey}" in this project.`, { appKey });
        }
      }
      const session = store.create({
        appKey,
        title: input.name?.trim() || input.title?.trim() || nameFromKey(appKey),
        // A name the person gave is the app's name: the Designer is not asked for another.
        ...(createdApp && (input.name ?? '').trim() === '' ? {} : { named: true }),
        target: input.target,
        connectionId: connection.id,
        model: input.model,
        createdApp,
        // A key that is no style here is left out: the Designer chooses, as if none was picked.
        ...(input.style !== undefined && findDesignSkill(host.root, stylesDir, input.style)?.problem === undefined && findDesignSkill(host.root, stylesDir, input.style) !== null ? { style: input.style } : {}),
      });
      // What the folder held before the session: "put the files back" in its first turn returns to it.
      await host.versions?.snapshot(session).catch((error: unknown) => {
        host.log('could not record the folder before a Designer session', error);
      });
      await host.audit('designer.session.created', by, { sessionId: session.id, appKey, createdApp });
      return session;
    },
    async restore(sessionId, n, opts) {
      const session = store.read(sessionId);
      // The folder is taken before anything is awaited: a turn, a save or a style change cannot begin under this.
      const hold = runner.hold('restore', session.id);
      try {
        if (host.versions == null || !(await host.versions.available())) {
          throw new ConflictError('Versions are off: git is not on this machine.', 'CONFLICT', { reason: 'VERSIONS_OFF' });
        }
        hold.announce();
        await host.seam?.('held', 'restore');
        const version = await host.versions.restore(session, n, { record: opts.record });
        // The files are a version's again: none of them is the person's own edit any more.
        store.update(session.id, { ...(version === null ? {} : { version: version.n }), ...((session.handEdits ?? []).length === 0 ? {} : { handEdits: [] }) });
        const handle = outsideATurn(store.read(session.id), opts.by, hold.signal);
        if (version !== null) handle.events.emit(session.turns, { kind: 'version', n: version.n, name: version.name });
        // Applied as a save is: a removal that would lose data waits in Studio, and in the next turn.
        const applied = await pipeline(store.read(session.id), handle, { version: false, askRemovals: false });
        await host.audit('designer.version.restored', opts.by, { sessionId, appKey: session.appKey, to: n, recorded: version?.n ?? null });
        return { version, applied: applied.ok };
      } finally {
        hold.release();
      }
    },
    async listFiles(sessionId) {
      const session = store.read(sessionId);
      return { groups: groupFiles(await editable(session.appKey)), busy: runner.busy()?.kind ?? null, version: session.version };
    },
    async readFile(sessionId, path) {
      const session = store.read(sessionId);
      const listed = (await editable(session.appKey)).find((file) => file.path === path);
      // Not there and not allowed are one answer: the list is the only thing a path is held against.
      if (listed === undefined) throw new NotFoundError('That is not a file of this app that can be opened here.', { path: path.slice(0, 300) });
      if (!listed.text) throw new ValidationFailedError('This file is not text, so it cannot be opened here.', { reason: 'NOT_TEXT', path });
      const bytes = await readFile(jailOf(session.appKey).resolve(path, 'read'));
      if (!isText(bytes)) throw new ValidationFailedError('This file is not text, so it cannot be opened here.', { reason: 'NOT_TEXT', path });
      return { path, content: bytes.toString('utf8'), hash: await hashOf(bytes) };
    },
    async saveFiles(sessionId, files, by) {
      const session = store.read(sessionId);
      const key = session.appKey;
      if (files.length === 0 || files.length > FILES_SAVED_MAX) throw new ValidationFailedError(`A save holds 1 to ${String(FILES_SAVED_MAX)} files.`, { reason: 'FILES' });
      if (new Set(files.map((file) => file.path)).size !== files.length) throw new ValidationFailedError('A save names each file once.', { reason: 'FILES' });
      // The folder is taken before anything is awaited: nothing else writes it until this is over, however it ends.
      const hold = runner.hold('save', session.id);
      try {
        // An app that still waits for its name is moved to another folder when it gets one: nothing is saved into it before.
        if (needsName(session)) throw new ConflictError('The app has no name yet. Send the Designer a message first.', 'CONFLICT', { reason: 'APP_UNNAMED' });

        // 1. The list, made now: a path that is not on it is not saved, and neither is anything else of this save.
        const listed = new Map((await editable(key)).map((file) => [file.path, file]));
        const missing = files.find((file) => !listed.has(file.path));
        if (missing !== undefined) throw new NotFoundError('That is not a file of this app that can be saved here.', { path: missing.path.slice(0, 300) });
        const notText = files.find((file) => listed.get(file.path)?.text !== true);
        if (notText !== undefined) throw new ValidationFailedError('This file is not text, so it cannot be saved here.', { reason: 'NOT_TEXT', path: notText.path });

        // 2. Each file is still what the person opened.
        const changed = files.filter((file) => listed.get(file.path)?.hash !== file.base).map((file) => ({ path: file.path, hash: listed.get(file.path)?.hash ?? '' }));
        if (changed.length > 0) {
          throw new ConflictError('A file changed since you opened it.', 'CONFLICT', { reason: 'FILES_CHANGED', changed });
        }

        // 3. Each content is text a file may hold, and may be written with nobody asked.
        const jail = jailOf(key);
        const before = new Map<string, Buffer>();
        const next = new Map<string, string>();
        for (const file of files) {
          if (file.content.includes('\0')) throw new ValidationFailedError('A file is text, and this has a NUL in it.', { reason: 'NOT_TEXT', path: file.path });
          const old = await readFile(jail.resolve(file.path, 'read'));
          // Read again, so what is kept to write back is what is there now: a file that changed in between is refused as changed.
          if ((await hashOf(old)) !== file.base) throw new ConflictError('A file changed since you opened it.', 'CONFLICT', { reason: 'FILES_CHANGED', changed: [{ path: file.path, hash: await hashOf(old) }] });
          const content = withLineEnds(old.toString('utf8'), file.content);
          if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) throw new ValidationFailedError(`A file is at most ${String(MAX_WRITE_BYTES / 1024)} KB.`, { reason: 'TOO_LARGE', path: file.path });
          const refusal = noCardRefusal(host.root, key, file.path, content);
          if (refusal !== null) {
            throw new ValidationFailedError(
              refusal === 'build-command' ? 'An app’s own build command is not set here. Leave "build" out of app.json.' : 'This file is not changed by hand here.',
              { reason: 'NOT_ALLOWED', path: file.path, why: refusal },
            );
          }
          if (isAppJson(key, file.path)) {
            const problem = appJsonProblem(old.toString('utf8'), content);
            if (problem !== null) throw new ValidationFailedError(problem.message, { reason: 'APP_JSON', path: file.path, ...(problem.field === null ? {} : { field: problem.field }) });
          }
          before.set(file.path, old);
          next.set(file.path, content);
        }

        // 4. A look is read, and its files worked out, before anything is written: one that cannot be applied refuses the whole save.
        const lookPath = files.find((file) => isLookFile(key, file.path))?.path;
        let look: Look | null = null;
        if (lookPath !== undefined) {
          const refuse = (message: string): never => {
            throw new ValidationFailedError(message, { reason: 'LOOK', path: lookPath, message });
          };
          let raw: unknown;
          try {
            raw = JSON.parse(next.get(lookPath) as string);
          } catch (error) {
            refuse(`This is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
          }
          if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) refuse('look.json holds one object.');
          const given = raw as Record<string, unknown>;
          if (typeof given['skill'] === 'string') {
            const skill = findDesignSkill(host.root, stylesDir, given['skill']);
            if (skill === null || skill.problem !== undefined) refuse(skill?.problem ?? `There is no style called "${given['skill'].slice(0, 40)}".`);
            else if (!skill.hasTheme) refuse('This style is words alone: ask for it in the chat, and the Designer applies it.');
          } else if (!isDirection(given['direction'])) {
            // A look kept before styles has a direction and no style: it is read as it always was.
            refuse('look.json names a style: "skill", with the key of one of the styles.');
          }
          look = cleanLook({ skill: given['skill'], direction: given['direction'], accent: given['accent'], words: given['words'], theme: given['theme'], without: given['without'], ownFonts: given['ownFonts'] });
          try {
            sideLookFiles(host.root, look, places);
          } catch (error) {
            refuse(`This look cannot be applied: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        // 5. The engine applies the whole folder, so the folder must hold this save and nothing half-done beside it.
        const paths = files.map((file) => file.path);
        const loose = ((await host.versions?.changed(session).catch(() => null)) ?? []).filter((path) => !paths.includes(path));
        if (loose.length > 0) {
          throw new ConflictError('The Designer’s last change was not finished. Ask it to finish, or put the files back.', 'CONFLICT', { reason: 'UNFINISHED_CHANGE' });
        }
        // Everything that could refuse this save has been asked: from here it writes, and the session's pages are told.
        hold.announce();
        await host.seam?.('held', 'save');

        // 6. Written, all or none: a write that fails puts back, byte for byte, what the earlier ones replaced.
        const styleBefore = lookPath === undefined ? null : (readLook(host.root, key)?.skill ?? null);
        const written: string[] = [];
        try {
          for (const path of paths) {
            await host.seam?.('write', path);
            jail.write(path, next.get(path) as string);
            written.push(path);
          }
          // 7. What the Designer is told next turn is kept before the look is applied: whatever comes after, it is on record.
          store.update(session.id, { handEdits: [...new Set([...(session.handEdits ?? []), ...paths])].slice(-HAND_EDITS_MAX) });
          if (look !== null) applyLook(host.root, key, look, places);
        } catch (error) {
          for (const path of written) {
            try {
              writeFileSync(jail.resolve(path, 'write'), before.get(path) as Buffer);
            } catch (failed) {
              host.log('a file could not be put back after a hand save failed', failed);
            }
          }
          store.update(session.id, { handEdits: session.handEdits ?? [] });
          if (error instanceof JailError) throw new ValidationFailedError(error.message, { reason: 'NOT_ALLOWED' });
          throw error;
        }

        // 8. Check, build, apply, and a version named for the files. What each stage says is kept for the reply.
        const said: DesignerEventBody[] = [];
        const log = personLog(runner.events(session.id));
        const handle = outsideATurn(store.read(session.id), by, hold.signal, {
          ...log,
          emit: (turn, body) => {
            said.push(body);
            return log.emit(turn, body);
          },
        });
        if (look !== null && look.skill !== styleBefore) {
          const resolved = resolveLook(host.root, look, places);
          const fonts = missingFonts(host.root, look, places).map((font) => font.family);
          handle.events.emit(session.turns, { kind: 'style', skill: look.skill, title: resolved.title, ...(fonts.length === 0 ? {} : { fonts }) });
        }
        const verdict = await pipeline(store.read(session.id), handle, { askRemovals: false, label: saveLabel(paths.map((path) => listed.get(path)?.label ?? path)) });
        const after = new Map((await editable(key)).map((file) => [file.path, file.hash]));
        const result: SaveResult = {
          applied: verdict.ok,
          version: verdict.version,
          files: paths.flatMap((path) => (after.has(path) ? [{ path, hash: after.get(path) as string }] : [])),
        };
        if (!verdict.ok) {
          const check = said.find((body): body is Extract<DesignerEventBody, { kind: 'check' }> => body.kind === 'check' && !body.ok);
          const build = said.find((body): body is Extract<DesignerEventBody, { kind: 'build' }> => body.kind === 'build' && !body.ok);
          const apply = said.find((body): body is Extract<DesignerEventBody, { kind: 'apply' }> => body.kind === 'apply' && !body.ok);
          result.problems = hold.signal.aborted
            ? { stage: 'build', lines: ['The save was stopped before it was applied: it took too long, or the server is stopping.'] }
            : check !== undefined
              ? { stage: 'check', lines: check.findings.filter((finding) => finding.level === 'error').slice(0, 12).map((finding) => `${finding.file} · ${finding.message}`) }
              : build !== undefined
                ? { stage: 'build', lines: build.problems.slice(0, 12) }
                : { stage: 'apply', lines: [apply?.message ?? apply?.stage ?? apply?.state ?? 'The server did not say why.'] };
        }
        await host.audit('designer.files.saved', by, { sessionId, appKey: key, files: paths, version: verdict.version?.n ?? null, applied: verdict.ok });
        return result;
      } finally {
        hold.release();
      }
    },
    lookOf,
    publicLook,
    reseedAfterApply: (appKey) => void reseeds.add(appKey),
    sawPage(sessionId, input) {
      const sight = cleanSight(input);
      if (sight === null) return false;
      sights.put(store.read(sessionId).id, sight);
      return true;
    },
    styles: () => listDesignSkills(host.root, stylesDir),
    async setLook(sessionId, input, by) {
      const session = store.read(sessionId);
      // The folder is taken before anything is awaited: a turn, a save or going back cannot begin under this.
      const hold = runner.hold('style', session.id);
      try {
        if (lookOf(session.appKey) === null) {
          throw new ConflictError('This app has no screens whose look can be changed here.', 'CONFLICT', { reason: 'NO_LOOK' });
        }
        const skill = findDesignSkill(host.root, stylesDir, input.skill);
        if (skill === null || skill.problem !== undefined) {
          throw new NotFoundError(skill?.problem ?? 'There is no such style.', { skill: input.skill });
        }
        // A style of words alone has no values to write: it is the Designer's to apply, in a turn.
        if (!skill.hasTheme) throw new ConflictError('This style is words alone: ask for it in the chat, and the Designer applies it.', 'CONFLICT', { reason: 'STYLE_NEEDS_A_TURN' });
        hold.announce();
        await host.seam?.('held', 'style');
        const before = readLook(host.root, session.appKey);
        // A font file of the person's own stays in use across a change of style.
        const look = cleanLook({ skill: skill.key, accent: input.accent, words: before?.words, without: before?.without, ownFonts: before?.ownFonts, theme: ownFontPatch(before) });
        applyLook(host.root, session.appKey, look, places);
        const handle = outsideATurn(store.read(session.id), by, hold.signal);
        const fonts = missingFonts(host.root, look, places).map((font) => font.family);
        handle.events.emit(session.turns, { kind: 'style', skill: skill.key, title: skill.title, ...(fonts.length === 0 ? {} : { fonts }) });
        const applied = await pipeline(store.read(session.id), handle, { askRemovals: false });
        await host.audit('designer.look.changed', by, { sessionId, appKey: session.appKey, style: look.skill });
        return { look: publicLook(session.appKey) as PublicLook, version: applied.version, applied: applied.ok };
      } finally {
        hold.release();
      }
    },
    async buildAndApply(key, signal) {
      const built = await rebuildApps(project(), { version: host.version, dev: true, ...(signal === undefined ? {} : { signal }) });
      const app = built.apps.find((candidate) => candidate.key === key);
      if (app === undefined) return [`apps/${key} was not built.`];
      if ((app.problems ?? []).length > 0) return app.problems ?? [];
      const apps = host.projectApps();
      if (apps === null) return ['This server runs no project apps.'];
      const result = (await apps.reconcile()).find((candidate) => candidate.key === key);
      const applied = result !== undefined && (result.state === 'installed' || result.state === 'applied' || result.state === 'unchanged');
      return applied ? [] : [`It was not applied${result?.stage === undefined ? '' : ` (${result.stage})`}: ${result?.message ?? 'the server did not say why.'}`];
    },
    shutdown: () => runner.shutdown(),
  };
}
