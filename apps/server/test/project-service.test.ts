// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The project sync service a server runs (`project/service.ts`): settling a
 * conflict either way, for page and schema files and for a file the project
 * deleted; what it says about files it cannot apply; and waiting for a run.
 */
import { overridesRepo, pagesRepo, projectFilesRepo } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { memoryFileStore, type ProjectFileStore } from '../src/project/file-store.js';
import { parseJsonText, stableStringify } from '../src/project/json.js';
import { reconcileProject } from '../src/project/reconcile.js';
import { createProjectService, ProjectResolveError, type ProjectService } from '../src/project/service.js';
import { makeInstall, type Install } from './project-fixtures.js';

let dev: Install;
let server: Install;
let store: ReturnType<typeof memoryFileStore>;
let service: ProjectService;
let logs: string[];
let warnings: string[];

function serve(mode: 'dev' | 'server', files: ProjectFileStore = store): ProjectService {
  return createProjectService({
    meta: server.meta,
    root: '/srv/project',
    mode,
    store: files,
    watchFiles: false,
    pollMs: 0,
    debounceMs: 5,
    log: (line) => logs.push(line),
    warn: (line) => warnings.push(line),
  });
}

beforeEach(async () => {
  // A developer's machine wrote the files; the server is another install of the project.
  dev = await makeInstall();
  server = await makeInstall();
  store = memoryFileStore();
  await reconcileProject({ meta: dev.meta, store, mode: 'dev' });
  logs = [];
  warnings = [];
  service = serve('server');
  await service.reconcile();
});
afterEach(async () => {
  await service.close();
  await dev.close();
  await server.close();
});

const statusOf = async (path: string): Promise<string> =>
  (await service.status()).entries.find((entry) => entry.path === path)?.status ?? 'in-sync';

const ordersTitle = async (): Promise<string | undefined> =>
  (await pagesRepo(server.meta).findBySlug(server.mainId, 'orders'))?.title;

function editFile(path: string, edit: (value: Record<string, unknown>) => void): void {
  const parsed = parseJsonText(store.files.get(path) ?? '');
  if (!parsed.ok) throw new Error(parsed.message);
  const value = parsed.value as Record<string, unknown>;
  edit(value);
  store.files.set(path, stableStringify(value));
}

const renameOnServer = async (title: string): Promise<void> => {
  const page = await pagesRepo(server.meta).findBySlug(server.mainId, 'orders');
  await pagesRepo(server.meta).updateMeta(page?.id ?? '', { title });
};

const renameInFile = (title: string): void => {
  editFile('pages/orders.json', (value) => {
    (value['title'] as Record<string, unknown>)['fallback'] = title;
  });
};

describe('settling a conflict', () => {
  beforeEach(async () => {
    await renameOnServer('Server side');
    renameInFile('Project side');
    await service.reconcile();
    expect(await statusOf('pages/orders.json')).toBe('conflict');
  });

  it('keeps the server copy, which stays flagged until the project has it', async () => {
    await service.resolve('pages/orders.json', 'server');
    expect(await ordersTitle()).toBe('Server side');
    expect(await statusOf('pages/orders.json')).toBe('changed-on-server');
    // A later start with the same file neither applies it nor calls it a conflict again.
    await service.reconcile();
    expect(await ordersTitle()).toBe('Server side');
    expect(await statusOf('pages/orders.json')).toBe('changed-on-server');

    // The pulled copy, deployed, clears the flag.
    const pulled = (await service.changes()).find((change) => change.path === 'pages/orders.json');
    expect(pulled?.status).toBe('changed-on-server');
    store.files.set('pages/orders.json', pulled?.content ?? '');
    await service.reconcile();
    expect(await statusOf('pages/orders.json')).toBe('in-sync');
  });

  it("uses the project's copy, and says so", async () => {
    await service.resolve('pages/orders.json', 'project');
    expect(await ordersTitle()).toBe('Project side');
    expect(await statusOf('pages/orders.json')).toBe('in-sync');
    expect(logs).toContain("Applied pages/orders.json from the project, replacing this server's copy.");
  });

  it('refuses a file that is not valid, and a path with nothing to settle', async () => {
    store.files.set('pages/orders.json', '{"title": 1}');
    for (const keep of ['project', 'server'] as const) {
      const refusal = service.resolve('pages/orders.json', keep);
      await expect(refusal).rejects.toBeInstanceOf(ProjectResolveError);
      await expect(refusal).rejects.toThrow('pages/orders.json is not valid; fix the file first');
    }
    await expect(service.resolve('pages/customers.json', 'project')).rejects.toThrow('pages/customers.json has nothing to resolve');
    await expect(service.resolve('pages/nowhere.json', 'server')).rejects.toThrow('pages/nowhere.json is not a project file');
    expect(await ordersTitle()).toBe('Server side');
  });
});

describe("the project's copy of a file that is gone, or of a schema file", () => {
  it('removes a page the project deleted, though this server changed it', async () => {
    await renameOnServer('Server side');
    store.files.delete('pages/orders.json');
    await service.reconcile();
    expect(await statusOf('pages/orders.json')).toBe('conflict');
    expect(await ordersTitle()).toBe('Server side');

    await service.resolve('pages/orders.json', 'project');
    expect(await pagesRepo(server.meta).findBySlug(server.mainId, 'orders')).toBeNull();
    expect(await projectFilesRepo(server.meta).find('pages/orders.json')).toBeNull();
  });

  it("replaces this server's schema customizations with the file's", async () => {
    const overrides = overridesRepo(server.meta);
    await overrides.create({ connectionId: server.mainId, op: 'table.label', tableName: 'main.orders', value: { label: 'Server label' } });
    editFile('schema/main.json', (value) => {
      value['overrides'] = [{ table: 'main.orders', op: 'table.label', value: { label: 'Project label' } }];
    });
    await service.reconcile();
    expect(await statusOf('schema/main.json')).toBe('conflict');

    await service.resolve('schema/main.json', 'project');
    const labels = (await overrides.listForConnection(server.mainId))
      .filter((row) => row.op === 'table.label')
      .map((row) => row.value);
    expect(labels).toEqual([{ label: 'Project label' }]);
    expect(await statusOf('schema/main.json')).toBe('in-sync');
  });

  it('clears the customizations of a schema file the project deleted', async () => {
    const overrides = overridesRepo(server.meta);
    await overrides.create({ connectionId: server.mainId, op: 'table.label', tableName: 'main.orders', value: { label: 'Server label' } });
    store.files.delete('schema/main.json');
    await service.reconcile();
    expect(await statusOf('schema/main.json')).toBe('conflict');

    await service.resolve('schema/main.json', 'project');
    expect((await overrides.listForConnection(server.mainId)).filter((row) => row.origin !== 'auto')).toEqual([]);
  });
});

describe('what the service says in dev', () => {
  it('reports a file it cannot apply once, and again when its problems change', async () => {
    await service.close();
    service = serve('dev');
    const good = store.files.get('pages/orders.json') ?? '';
    const reports = (): number => warnings.filter((line) => line.startsWith('pages/orders.json was not applied:')).length;
    store.files.set('pages/orders.json', '{"title": 1}');
    await service.reconcile();
    await service.reconcile();
    expect(reports()).toBe(1);

    store.files.set('pages/orders.json', '{ not json');
    await service.reconcile();
    expect(reports()).toBe(2);
    expect(warnings.at(-1)).toContain('not valid JSON');

    // Fixed, then broken the same way again: that is news again.
    store.files.set('pages/orders.json', good);
    await service.reconcile();
    store.files.set('pages/orders.json', '{ not json');
    await service.reconcile();
    expect(reports()).toBe(3);
  });

  it('runs once the database moves, and idle() waits for that run', async () => {
    await service.close();
    service = serve('dev');
    await renameOnServer('Renamed in Studio');
    service.databaseChanged();
    await service.idle();
    expect(logs).toContain('Wrote pages/orders.json.');
    const written = parseJsonText(store.files.get('pages/orders.json') ?? '');
    expect(written.ok && (written.value as { title: { fallback: string } }).title.fallback).toBe('Renamed in Studio');
  });

  it('says when a run fails, and keeps serving', async () => {
    await service.close();
    const broken: ProjectFileStore = { ...store, list: async () => Promise.reject(new Error('the disk is gone')) };
    service = serve('dev', broken);
    service.databaseChanged();
    await service.idle();
    expect(warnings).toContain('Could not sync the project files: the disk is gone');
  });
});
