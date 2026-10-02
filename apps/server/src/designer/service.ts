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
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { MetaDb } from '@adminium/meta';

import type { AppInstallService, InstallActor, InstallHost } from '../apps/install-service.js';
import { ConflictError, NotFoundError, ValidationFailedError } from '../errors.js';
import type { AiConnections, ConnectionId } from '../llm/connections.js';
import { rebuildApps } from '../project/build.js';
import { checkApp } from '../project/apps/check-app.js';
import type { ProjectApps } from '../project/apps/project-apps.js';
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
  /** The tools and what the model is told; given by the parts that build them. */
  tools?: (session: DesignerSession) => DesignerTool[];
  prompt?: (session: DesignerSession, messages: import('@adminium/llm').RunMessage[]) => Promise<{ system: string; messages: import('@adminium/llm').RunMessage[] }>;
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

export function createDesigner(host: DesignerHost): Designer {
  const store = createSessionStore(host.root);
  const project = (): { root: string; configFile: string } => {
    const found = findProject(host.root, {});
    if (found === null) throw new ConflictError('The project folder has no adminium.config file any more.', 'CONFLICT', { reason: 'NOT_A_PROJECT' });
    return found;
  };

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
    const built = await rebuildApps(project(), { version: host.version, dev: true });
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

    if (opts.version === false || host.versions == null) return { ok: true, version: null };
    const version = await host.versions.commit(session);
    if (version !== null) {
      store.update(session.id, { version: version.n });
      events.emit(turn, { kind: 'version', n: version.n, name: version.name });
    }
    return { ok: true, version };
  }

  const runner = createDesignerRunner({
    store,
    runnerFor: async (session) => {
      const resolved = await host.connections.runner(session.connectionId as ConnectionId, session.model);
      return { runner: resolved.runner, maxTokens: DESIGNER_MAX_OUTPUT_TOKENS };
    },
    tools: (session) => host.tools?.(session) ?? [],
    prompt: async (session, messages) => host.prompt?.(session, messages) ?? { system: 'You are Adminium Designer.', messages },
    pipeline: (session, handle) => pipeline(session, handle),
    limits: () => host.limits(),
    publish: (event) => {
      host.publish(event);
    },
    audit: (action, session, detail) => host.audit(action, null, { sessionId: session.id, appKey: session.appKey, ...detail }),
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
      if (!verdict.canBuild) {
        throw new ConflictError(`This model cannot build: ${verdict.message}`, 'CONFLICT', { reason: 'MODEL_CANNOT_BUILD', why: verdict.reason });
      }

      let appKey = input.appKey;
      let createdApp = false;
      if (appKey === undefined) {
        const name = (input.name ?? '').trim() || 'My app';
        if (name.length > 80) throw new ValidationFailedError('An app’s name is at most 80 characters.', { reason: 'NAME' });
        appKey = keyFromName(host.root, name);
        scaffoldApp({ root: host.root, key: appKey, name, sides: [], version: host.version });
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
    shutdown: () => runner.shutdown(),
  };
}
