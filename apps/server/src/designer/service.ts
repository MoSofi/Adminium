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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { MetaDb } from '@adminium/meta';

import type { AppInstallService, InstallActor, InstallHost } from '../apps/install-service.js';
import { ConflictError, NotFoundError, ValidationFailedError } from '../errors.js';
import type { AiConnections, ConnectionId } from '../llm/connections.js';
import { rebuildApps } from '../project/build.js';
import { checkApp } from '../project/apps/check-app.js';
import { applyLook, cleanLook, readLook, sidesWithScreens, type Look, type LookDirection } from '../project/apps/look.js';
import { hasOwnBuild } from '../project/apps/own-build.js';
import type { ProjectApps } from '../project/apps/project-apps.js';
import { sideCallIssues, sideCallLines } from '../project/apps/side-calls.js';
import { appKeyProblem, nameFromKey, scaffoldApp } from '../project/apps/scaffold-app.js';
import { APPS_DIR } from '../project/apps/read-app.js';
import { findProject } from '../project/locate.js';
import type { DesignerEvent } from './events.js';
import { createDesignerRunner, type Actor, type DesignerLimits, type DesignerRunner, type PipelineResult, type TurnHandle } from './runner.js';
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
}

export interface CreateSessionInput {
  /** An app already in the folder; absent to make a new one. */
  appKey?: string | undefined;
  /** What a new app is called. Its key is made from it. */
  name?: string | undefined;
  target: DesignerTarget;
  connectionId: string;
  model: string;
}

export interface Designer {
  store: SessionStore;
  runner: DesignerRunner;
  createSession(input: CreateSessionInput, by: Actor): Promise<DesignerSession>;
  /** The engine's last word on a turn. Exposed for the tools that apply mid-turn. */
  pipeline(session: DesignerSession, handle: TurnHandle, opts?: { version?: boolean; askRemovals?: boolean }): Promise<PipelineResult>;
  /**
   * Put the folder back as version `n` was (0: before the session), and apply
   * it. With `record` that is a new version on top (O1); without, it is "put
   * the files back" after a stopped turn (O3).
   */
  restore(sessionId: string, n: number, opts: { record: boolean; by: Actor }): Promise<{ version: { n: number; name: string } | null; applied: boolean }>;
  /** The look of the app's own screens, when it has screens whose look can be changed here; else null. */
  lookOf(appKey: string): Look | null;
  /**
   * "Change the look": write a direction to every side, build, apply and save
   * a version. No model is called.
   */
  setLook(sessionId: string, look: { direction: LookDirection; accent?: string | undefined }, by: Actor): Promise<{ look: Look; version: { n: number; name: string } | null; applied: boolean }>;
  /**
   * Build the folder's apps and apply them, with no turn behind it: what the
   * check, the build or the apply says is wrong with `key`, or nothing.
   */
  buildAndApply(key: string): Promise<string[]>;
  shutdown(): Promise<void>;
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
    else if (existsSync(join(root, APPS_DIR, appKey, side, 'src', 'theme.css')) && !/className="[^"]*\b(page|card|btn|form|field|grid|list|board)\b/.test(all)) {
      out.push(`- apps/${appKey}/${side}/src/App.tsx uses none of the starter's parts, so it has no look: use the classes of app.css (page, site-header, hero, grid, card, form, field, btn btn-primary, notice, empty).`);
    }
    // en() takes the English text itself; a language tag inside it is shown to people as written.
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
    return themed.length === 0 ? null : (readLook(host.root, appKey) ?? { direction: 'clean' });
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

  /** What the last install or apply of each app said about its pages. */
  const pageWarnings = new Map<string, string[]>();
  /** Public access the last apply left as it was: the screens are refused what the manifest grants until it is settled. */
  const accessWarnings = new Map<string, string[]>();

  async function pipeline(session: DesignerSession, handle: TurnHandle, opts: { version?: boolean; askRemovals?: boolean } = {}): Promise<PipelineResult> {
    const { events, turn } = handle;
    const key = session.appKey;

    // 1. The judge: the same check `adminium app check` runs.
    const check = checkApp(host.root, key, { version: host.version });
    const findings = check.findings.slice(0, 40).map((finding) => ({ file: finding.file, path: finding.path, message: finding.message, level: finding.level }));
    const errors = check.findings.filter((finding) => finding.level === 'error');
    events.emit(turn, { kind: 'check', ok: errors.length === 0, findings });
    if (errors.length > 0) return { ok: false, version: null };

    // 2. Built as `adminium build` builds it: the manifest put together, the screens bundled.
    const built = await rebuildApps(project(), { version: host.version, dev: true, signal: handle.signal });
    const app = built.apps.find((candidate) => candidate.key === key);
    const problems = app?.problems ?? (app === undefined ? [`apps/${key} was not built.`] : []);
    events.emit(turn, { kind: 'build', ok: problems.length === 0, problems: problems.slice(0, 20) });
    if (problems.length > 0) return { ok: false, version: null };

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
    const version = await host.versions.commit(session);
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

  const runner = createDesignerRunner({
    store,
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
      return [
        ...unloadedFiles(session),
        ...unopenedTables(manifest),
        ...unreadPersonalColumns(manifest),
        ...placeholderScreens(host.root, session.appKey, tables),
        // A call the page makes that Adminium refuses: the person would meet it as "That did not work".
        ...sideCallLines(sideCallIssues(host.root, session.appKey, manifest)),
        ...(session.version === null ? emptyFirstPreview(manifest) : []),
        ...unnamed,
      ];
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
  });

  return {
    store,
    runner,
    pipeline,
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
        const name = (input.name ?? '').trim() || 'My app';
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
        title: input.name?.trim() || nameFromKey(appKey),
        target: input.target,
        connectionId: connection.id,
        model: input.model,
        createdApp,
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
      if (runner.active() !== null) {
        throw new ConflictError('The Designer is working. Stop it, or wait for it to finish, before going back.', 'CONFLICT', { reason: 'TURN_RUNNING' });
      }
      if (host.versions == null || !(await host.versions.available())) {
        throw new ConflictError('Versions are off: git is not on this machine.', 'CONFLICT', { reason: 'VERSIONS_OFF' });
      }
      const version = await host.versions.restore(session, n, { record: opts.record });
      if (version !== null) store.update(session.id, { version: version.n });
      const events = runner.events(session.id);
      if (version !== null) events.emit(session.turns, { kind: 'version', n: version.n, name: version.name });
      // Applied as a save is: a removal that would lose data waits in Studio, and in the next turn.
      const applied = await pipeline(
        store.read(session.id),
        {
          turn: session.turns,
          by: opts.by,
          events,
          signal: new AbortController().signal,
          ask: () => Promise.reject(new Error('nothing is asked outside a turn')),
        },
        { version: false, askRemovals: false },
      );
      await host.audit('designer.version.restored', opts.by, { sessionId, appKey: session.appKey, to: n, recorded: version?.n ?? null });
      return { version, applied: applied.ok };
    },
    lookOf,
    async setLook(sessionId, input, by) {
      const session = store.read(sessionId);
      if (runner.active() !== null) {
        throw new ConflictError('The Designer is working. Stop it, or wait for it to finish, before changing the look.', 'CONFLICT', { reason: 'TURN_RUNNING' });
      }
      if (lookOf(session.appKey) === null) {
        throw new ConflictError('This app has no screens whose look can be changed here.', 'CONFLICT', { reason: 'NO_LOOK' });
      }
      const look = cleanLook({ direction: input.direction, accent: input.accent, words: readLook(host.root, session.appKey)?.words });
      applyLook(host.root, session.appKey, look);
      const events = runner.events(session.id);
      events.emit(session.turns, { kind: 'look', direction: look.direction });
      const applied = await pipeline(
        store.read(session.id),
        { turn: session.turns, by, events, signal: new AbortController().signal, ask: () => Promise.reject(new Error('nothing is asked outside a turn')) },
        { askRemovals: false },
      );
      await host.audit('designer.look.changed', by, { sessionId, appKey: session.appKey, direction: look.direction });
      return { look, version: applied.version, applied: applied.ok };
    },
    async buildAndApply(key) {
      const built = await rebuildApps(project(), { version: host.version, dev: true });
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
