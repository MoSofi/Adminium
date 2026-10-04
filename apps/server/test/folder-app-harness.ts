// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app in a project folder, run against a real database: a temp project
 * with the starter `adminium app new` writes, built the way `adminium build`
 * builds it, and the reconciler a server runs over it — on the engine asked
 * for, in the mode asked for.
 */
import { readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect } from 'vitest';
import { auditRepo, manifestsRepo, projectAppsRepo, type ProjectAppRow } from '@adminium/meta';

import { createAppInstallService } from '../src/apps/install-service.js';
import { findSampleApp } from '../src/apps/sample-data.js';
import { runCli } from '../src/cli/run.js';
import { buildProjectApps, folderAppsOf, type AppsBuild } from '../src/project/apps/build-apps.js';
import { createProjectApps, type AppliedApp, type ProjectApps } from '../src/project/apps/project-apps.js';
import { loadProjectBundler } from '../src/project/build.js';
import type { ProjectConfig } from '../src/project/config.js';
import { APP_VERSION } from '../src/version.js';
import { installHarness, type Dialect, type Harness } from './app-install-harness.js';
import { canBuildSides, tempProject } from './app-project-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

export interface FolderHarness {
  root: string;
  harness: Harness;
  /** Everything the reconciler logged and warned, in order. */
  lines: { log: string[]; warn: string[] };
  /** The `app-changed` events it sent: `[key, hash]`. */
  changed: [string, string][];
  /** This server's public API, as the reconciler finds it and may change it. */
  publicApi: { registered: boolean; enabled: boolean };
  /** `adminium app new`, with its flags. */
  newApp: (...argv: string[]) => Promise<void>;
  /** Change one JSON file of the project. */
  edit: (file: string, change: (value: Record<string, unknown>) => unknown) => void;
  put: (file: string, value: unknown) => void;
  remove: (file: string) => void;
  /** Build the apps as `adminium build` does, then reconcile. */
  sync: () => Promise<AppliedApp[]>;
  /** Build only. */
  build: () => Promise<AppsBuild>;
  /** A reconciler over the same project in another mode, or with another `apps` block: a second server start. */
  restart: (change?: { mode?: 'dev' | 'server'; apps?: ProjectConfig['apps']; databases?: readonly string[] }) => ProjectApps;
  row: (key: string) => Promise<{ source: string; status: string; version: string; document: Record<string, unknown> } | null>;
  state: (key: string) => Promise<ProjectAppRow | null>;
  /** The audit lines about apps, oldest first. */
  audit: () => Promise<{ action: string; actorKind: string; actorLabel: string }[]>;
  close: () => Promise<void>;
}

export async function folderHarness(
  dialect: Dialect,
  opts: { mode: 'dev' | 'server'; apps?: ProjectConfig['apps']; superAdmin?: boolean } = { mode: 'dev' },
): Promise<FolderHarness> {
  const root = tempProject('adminium-folder-app-');
  let built: AppsBuild | null = null;
  const harness = await installHarness(dialect, { full: true, superAdmin: opts.superAdmin !== false, folder: () => folderAppsOf(root, built) });
  const lines = { log: [] as string[], warn: [] as string[] };
  const changed: [string, string][] = [];
  const publicApi = { registered: true, enabled: false };
  const service = createAppInstallService(harness.deps);
  const manifests = manifestsRepo(harness.meta, { encrypt: (v) => v, decrypt: (v) => v });

  const make = (mode: 'dev' | 'server', apps: ProjectConfig['apps'], databases: readonly string[]): ProjectApps =>
    createProjectApps({
      mode,
      built: () => built,
      service,
      meta: harness.meta,
      apps,
      databases,
      connectionFor: async () => harness.connectionId,
      log: (message) => lines.log.push(message),
      warn: (message) => lines.warn.push(message),
      host: { log: { info: () => undefined, warn: () => undefined } },
      changed: (key, hash) => changed.push([key, hash]),
      addSampleData: async (key) => {
        const target = await findSampleApp(harness.meta, key);
        if (target !== null) await harness.samples?.add(target, { locale: 'en-US', userId: null, userLabel: 'project folder' });
      },
      sampleEverAdded: async (key) => {
        const target = await findSampleApp(harness.meta, key);
        return target === null || harness.samples === undefined ? true : harness.samples.everAdded(target);
      },
      refreshServed: () => harness.deps.installed.refresh(),
      publicApi: {
        get registered() {
          return publicApi.registered;
        },
        isEnabled: async () => publicApi.enabled,
        enable: async () => {
          publicApi.enabled = true;
        },
      },
    });
  let apps = make(opts.mode, opts.apps, ['main']);

  const build = async (): Promise<AppsBuild> => {
    built = await buildProjectApps(root, { version: APP_VERSION, bundler: canBuildSides ? await loadProjectBundler(root) : null });
    return built;
  };

  return {
    root,
    harness,
    lines,
    changed,
    publicApi,
    newApp: async (...argv) => {
      const io = fakeIo({ interactive: false });
      const deps = fakeDeps({ cwd: root, env: {} });
      deps.runProcess = () => ({ status: 0, stdout: '' });
      expect(await runCli(['app', 'new', ...argv], { io, deps }), io.stderr()).toBe(0);
    },
    edit: (file, change) => {
      const path = join(root, file);
      writeFileSync(path, `${JSON.stringify(change(JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>), null, 2)}\n`);
    },
    put: (file, value) => {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), `${JSON.stringify(value, null, 2)}\n`);
    },
    remove: (file) => {
      rmSync(join(root, file), { recursive: true, force: true });
    },
    build,
    sync: async () => {
      await build();
      return apps.reconcile();
    },
    restart: (change = {}) => {
      apps = make(change.mode ?? opts.mode, change.apps ?? opts.apps, change.databases ?? ['main']);
      return apps;
    },
    row: async (key) => {
      const found = (await manifests.list('app')).find((m) => m.row.manifestKey === key);
      return found === undefined
        ? null
        : { source: found.row.source, status: found.row.status, version: found.row.version, document: found.document as Record<string, unknown> };
    },
    state: (key) => projectAppsRepo(harness.meta).find(key),
    audit: async () =>
      (await auditRepo(harness.meta).list({ category: 'app', limit: 200 }))
        .map((entry) => ({ action: entry.action, actorKind: entry.actorKind, actorLabel: entry.actorLabel }))
        .reverse(),
    close: async () => {
      await harness.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
