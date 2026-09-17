// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A project's pages and widgets inside a composed server (49 §6.3–§6.4): the
 * page rows a build gets, the bootstrap payload that lists the files, the
 * route that serves them, Studio's page routes refusing changes, a rebuild in
 * dev, and nothing at all on the desktop app.
 *
 * The build is written by hand, as `adminium build` would leave it, so this
 * needs no esbuild (`project-client-build.test.ts` runs the real one).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { createFirstSuperAdmin, pagesRepo, permissionsRepo, rolesRepo, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { applyProjectPages, projectPageId } from '../src/project/project-pages.js';
import { adminPasswordHash, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, login } from './auth-helpers.js';
import { makeEnv } from './helpers.js';
import { makeInstall, type Install } from './project-fixtures.js';

interface FakePage {
  name: string;
  title?: string;
  group?: 'workspace' | 'library' | 'planning' | 'people' | 'account';
  order?: number | null;
  hidden?: boolean;
}

interface FakeBuild {
  pages?: FakePage[];
  widgets?: { name: string; kind: 'cell' | 'card'; title?: string | null }[];
  tag?: string;
}

const sha = (text: string, algorithm = 'sha256', encoding: 'hex' | 'base64' = 'hex'): string =>
  createHash(algorithm).update(text).digest(encoding);

/** Files and a manifest, the way `adminium build` leaves them. */
function writeClientBuild(dir: string, build: FakeBuild): void {
  const root = join(dir, '.adminium', 'build');
  const tag = build.tag ?? 'A1';
  const files: { path: string; hash: string; integrity: string }[] = [];
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, 'client', path)), { recursive: true });
    writeFileSync(join(root, 'client', path), text);
    files.push({ path, hash: sha(text), integrity: `sha384-${sha(text, 'sha384', 'base64')}` });
  };
  write(`chunks/chunk-${tag}.js`, 'export const shared = 1;\n');
  const pages = (build.pages ?? []).map((page) => {
    write(`pages/${page.name}-${tag}.js`, `import "../chunks/chunk-${tag}.js";\nexport default {};\n`);
    write(`pages/${page.name}-${tag}.css`, `.${page.name} {}\n`);
    return {
      name: page.name,
      source: `pages/${page.name}.tsx`,
      module: `pages/${page.name}-${tag}.js`,
      imports: [`chunks/chunk-${tag}.js`],
      styles: [`pages/${page.name}-${tag}.css`],
      title: page.title ?? page.name,
      icon: 'chart-line',
      nav: { group: page.group ?? 'workspace', order: page.order ?? null, hidden: page.hidden ?? false },
    };
  });
  const widgets = (build.widgets ?? []).map((widget) => {
    write(`widgets/${widget.name}-${tag}.js`, 'export default {};\n');
    return {
      name: widget.name,
      source: `widgets/${widget.name}.tsx`,
      module: `widgets/${widget.name}-${tag}.js`,
      imports: [],
      styles: [],
      kind: widget.kind,
      title: widget.title ?? null,
    };
  });
  const digest = sha(JSON.stringify({ pages, widgets, files }));
  const manifest = {
    adminiumVersion: 'test',
    builtAt: new Date().toISOString(),
    config: { entry: 'adminium.config.ts', inputs: {} },
    server: { digest: '', files: [], inputs: {} },
    client: { digest, pages, widgets, files, inputs: {} },
  };
  const file = join(root, 'manifest.json');
  writeFileSync(`${file}.tmp`, JSON.stringify(manifest));
  renameSync(`${file}.tmp`, file);
}

function memoryStore(meta: MetaDb): MetaStoreHandle {
  return { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
}

let install: Install | null = null;
let composed: ComposedServer | null = null;
afterEach(async () => {
  await composed?.app.close();
  await install?.close();
  composed = null;
  install = null;
});

interface Served {
  install: Install;
  app: ComposedServer['app'];
  cookie: string;
  logs: string[];
}

async function serve(
  opts: { mode?: 'dev' | 'server'; env?: Record<string, string>; build?: FakeBuild; before?: (install: Install) => Promise<void> } = {},
): Promise<Served> {
  install = await makeInstall();
  const { meta } = install;
  writeClientBuild(install.dir, opts.build ?? { pages: [{ name: 'revenue', title: 'Revenue', group: 'library', order: 7 }], widgets: [{ name: 'flag-cell', kind: 'cell' }, { name: 'sales', kind: 'card', title: 'Sales' }] });
  await opts.before?.(install);
  const logs: string[] = [];
  const runService = createRunService({ meta });
  composed = await composeServer({
    env: makeEnv({ ADMINIUM_DATA_DIR: join(install.dir, 'data'), ...opts.env }),
    metaStore: memoryStore(meta),
    manager: install.manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    logger: false,
    telemetry: false,
    project: {
      root: install.dir,
      mode: opts.mode ?? 'server',
      log: (line) => logs.push(line),
      warn: (line) => logs.push(line),
    },
  });
  await composed.app.ready();
  await createFirstSuperAdmin(meta, { email: ADMIN_EMAIL, name: ADMIN_NAME, passwordHash: await adminPasswordHash() });
  const { cookie } = await login(composed.app, ADMIN_EMAIL, ADMIN_PASSWORD);
  return { install, app: composed.app, cookie: cookie ?? '', logs };
}

interface BootstrapProjectReply {
  databases: Record<string, string>;
  client: {
    digest: string;
    pages: { slug: string; module: { url: string; integrity: string }; imports: { url: string }[]; styles: { url: string }[] }[];
    widgets: { id: string; kind: string; title: string | null; module: { url: string } }[];
  } | null;
}

interface BootstrapReply {
  project?: BootstrapProjectReply;
  nav: { groups: { key: string; items: { slug: string }[] }[] };
}

async function bootstrap(served: Served): Promise<BootstrapReply> {
  const res = await served.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie: served.cookie } });
  expect(res.statusCode).toBe(200);
  return res.json().data as BootstrapReply;
}

describe('a project page id', () => {
  // SQLite does not enforce the column width; Postgres and MySQL do.
  it('fits the 36-character page id for any address', () => {
    expect(projectPageId('revenue')).toBe('page_proj_revenue');
    const long = 'a-very-long-page-address-of-31c';
    const other = 'a-very-long-page-address-of-31d';
    expect(long).toHaveLength(31);
    expect(projectPageId(long).length).toBeLessThanOrEqual(36);
    expect(projectPageId(long)).toMatch(/^page_proj_a-very-long-page-[0-9a-f]{8}$/);
    expect(projectPageId(long)).not.toBe(projectPageId(other));
    expect(projectPageId('a'.repeat(26))).toBe(`page_proj_${'a'.repeat(26)}`);
    expect(projectPageId('a'.repeat(27)).length).toBe(36);
  });
});

describe('a project page', () => {
  it('gets a page row at start, in its sidebar place', async () => {
    const served = await serve();
    const page = await pagesRepo(served.install.meta).findById(projectPageId('revenue'));
    expect(page).toMatchObject({
      slug: 'revenue',
      type: 'project-page',
      origin: 'project',
      title: 'Revenue',
      icon: 'chart-line',
      navGroup: 'library',
      navOrder: 7,
      connectionId: null,
      isEnabled: true,
    });
    expect(page?.config).toMatchObject({ template: 'project-page', config: { file: 'revenue' }, nav: { slug: 'revenue' } });
    const data = await bootstrap(served);
    const library = data.nav.groups.find((group) => group.key === 'library');
    expect(library?.items.map((item) => item.slug)).toContain('revenue');
    const read = await served.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${projectPageId('revenue')}`,
      headers: { cookie: served.cookie },
    });
    expect(read.statusCode).toBe(200);
  });

  it('keeps a place a reorder gave it when its code sets none, and loses its row with its file', async () => {
    const served = await serve({ build: { pages: [{ name: 'notes' }] } });
    const pages = pagesRepo(served.install.meta);
    const first = await pages.findById(projectPageId('notes'));
    expect(first?.navGroup).toBe('workspace');
    await pages.reorderNav([{ id: projectPageId('notes'), navGroup: 'workspace' }], Date.now());
    const moved = (await pages.findById(projectPageId('notes')))?.navOrder;
    await applyProjectPages(served.install.meta, [
      {
        name: 'notes',
        source: 'pages/notes.tsx',
        module: 'pages/notes-B.js',
        imports: [],
        styles: [],
        title: 'Notes',
        icon: 'file',
        nav: { group: 'workspace', order: null, hidden: false },
      },
    ]);
    expect((await pages.findById(projectPageId('notes')))?.navOrder).toBe(moved);

    const applied = await applyProjectPages(served.install.meta, []);
    expect(applied.removed).toEqual(['notes']);
    expect(await pages.findById(projectPageId('notes'))).toBeNull();
  });

  it('is not added over a page that already has its address', async () => {
    const served = await serve({
      build: { pages: [{ name: 'customers' }] },
    });
    // The generated pages of the shop database include one at /p/customers.
    expect(await pagesRepo(served.install.meta).findById(projectPageId('customers'))).toBeNull();
    const overview = await served.app.inject({ method: 'GET', url: '/api/v1/project/overview', headers: { cookie: served.cookie } });
    expect((overview.json().data as { problems: { source: string; message: string }[] }).problems).toEqual([
      expect.objectContaining({ source: 'pages/customers.tsx', message: expect.stringContaining('/p/customers is already used') }),
    ]);
    expect(served.logs.join('\n')).toContain('pages/customers.tsx: the address /p/customers is already used');
  });

  it('gives a new page the audience the other project pages have', async () => {
    const served = await serve({ build: { pages: [{ name: 'revenue' }] } });
    const meta = served.install.meta;
    const viewer = await rolesRepo(meta).findBySlug('viewer');
    if (viewer === null) throw new Error('no viewer role');
    await permissionsRepo(meta).grant(viewer.id, 'page', projectPageId('revenue'), { view: true, edit: false });
    await applyProjectPages(meta, [
      {
        name: 'revenue',
        source: 'pages/revenue.tsx',
        module: 'pages/revenue-B.js',
        imports: [],
        styles: [],
        title: 'Revenue',
        icon: 'file',
        nav: { group: 'workspace', order: null, hidden: false },
      },
      {
        name: 'margins',
        source: 'pages/margins.tsx',
        module: 'pages/margins-B.js',
        imports: [],
        styles: [],
        title: 'Margins',
        icon: 'file',
        nav: { group: 'workspace', order: null, hidden: true },
      },
    ]);
    const grants = await permissionsRepo(meta).listForResource('page', projectPageId('margins'));
    expect(grants.map((grant) => grant.roleId)).toEqual([viewer.id]);
    expect((await pagesRepo(meta).findById(projectPageId('margins')))?.navGroup).toBeNull();
  });

  it('cannot be changed, copied or deleted in Studio, and can be reordered', async () => {
    const served = await serve();
    const id = projectPageId('revenue');
    const headers = { cookie: served.cookie };
    const attempts = [
      { method: 'PATCH' as const, url: `/api/v1/pages/${id}`, payload: { title: 'Money' } },
      { method: 'PATCH' as const, url: `/api/v1/pages/${id}/config`, payload: { config: {} } },
      { method: 'PATCH' as const, url: `/api/v1/pages/${id}/layout`, payload: { version: 1, items: [] } },
      { method: 'POST' as const, url: `/api/v1/pages/${id}/duplicate`, payload: { slug: 'money', title: 'Money' } },
      { method: 'DELETE' as const, url: `/api/v1/pages/${id}` },
    ];
    for (const attempt of attempts) {
      const res = await served.app.inject({ ...attempt, headers });
      expect(res.statusCode, `${attempt.method} ${attempt.url}`).toBe(409);
      expect((res.json() as { error: { message: string } }).error.message).toBe(
        'This page comes from pages/revenue.tsx in the project folder. Change it there.',
      );
    }
    const reorder = await served.app.inject({
      method: 'PUT',
      url: '/api/v1/pages/nav-order',
      headers,
      payload: { items: [{ pageId: id, navGroup: 'library' }] },
    });
    expect(reorder.statusCode).toBe(200);
  });
});

describe('the built files', () => {
  it('are listed in the bootstrap payload with their integrity, beside the database keys', async () => {
    const served = await serve();
    const { project } = await bootstrap(served);
    expect(project?.databases).toEqual({ main: served.install.mainId });
    expect(project?.client?.pages).toEqual([
      {
        slug: 'revenue',
        module: { url: '/api/v1/project/client/pages/revenue-A1.js', integrity: expect.stringMatching(/^sha384-/) },
        imports: [{ url: '/api/v1/project/client/chunks/chunk-A1.js', integrity: expect.stringMatching(/^sha384-/) }],
        styles: [{ url: '/api/v1/project/client/pages/revenue-A1.css', integrity: expect.stringMatching(/^sha384-/) }],
      },
    ]);
    expect(project?.client?.widgets.map(({ id, kind, title }) => ({ id, kind, title }))).toEqual([
      { id: 'project.flag-cell', kind: 'cell', title: null },
      { id: 'project.sales', kind: 'card', title: 'Sales' },
    ]);
  });

  it('are served to people who are signed in, only as built, and cached for good', async () => {
    const served = await serve();
    const url = '/api/v1/project/client/pages/revenue-A1.js';
    const ok = await served.app.inject({ method: 'GET', url, headers: { cookie: served.cookie } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(ok.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(ok.body).toContain('chunk-A1.js');
    const css = await served.app.inject({ method: 'GET', url: '/api/v1/project/client/pages/revenue-A1.css', headers: { cookie: served.cookie } });
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');

    expect((await served.app.inject({ method: 'GET', url })).statusCode).toBe(401);
    for (const missing of ['pages/other.js', 'manifest.json', '../manifest.json', 'pages/%2e%2e/%2e%2e/manifest.json']) {
      const res = await served.app.inject({ method: 'GET', url: `/api/v1/project/client/${missing}`, headers: { cookie: served.cookie } });
      expect(res.statusCode, missing).toBe(404);
    }

    writeFileSync(join(served.install.dir, '.adminium', 'build', 'client', 'pages', 'revenue-A1.js'), 'alert(1);\n');
    const changed = await served.app.inject({ method: 'GET', url, headers: { cookie: served.cookie } });
    expect(changed.statusCode).toBe(422);
    expect((changed.json() as { error: { message: string } }).error.message).toContain('changed after the build');
  });

  it('are listed in the Studio overview', async () => {
    const served = await serve();
    const res = await served.app.inject({ method: 'GET', url: '/api/v1/project/overview', headers: { cookie: served.cookie } });
    expect(res.json().data).toMatchObject({
      pages: [{ slug: 'revenue', source: 'pages/revenue.tsx', title: 'Revenue', group: 'library', hidden: false }],
      widgets: [
        { id: 'project.flag-cell', source: 'widgets/flag-cell.tsx', kind: 'cell' },
        { id: 'project.sales', source: 'widgets/sales.tsx', kind: 'card' },
      ],
    });
  });
});

describe('a rebuild in dev', () => {
  it('rewrites the page rows and tells open dashboards', async () => {
    const served = await serve({ mode: 'dev' });
    const published = vi.spyOn(served.app.realtime, 'publish');
    writeClientBuild(served.install.dir, { pages: [{ name: 'margins', title: 'Margins' }], tag: 'B2' });
    await vi.waitFor(
      async () => {
        expect(await pagesRepo(served.install.meta).findById(projectPageId('margins'))).not.toBeNull();
      },
      { timeout: 5000, interval: 100 },
    );
    expect(await pagesRepo(served.install.meta).findById(projectPageId('revenue'))).toBeNull();
    await vi.waitFor(() => {
      expect(published).toHaveBeenCalledWith('config-changed', 'project-changed', { digest: expect.any(String) });
    });
    const { project } = await bootstrap(served);
    expect(project?.client?.pages.map((page) => page.module.url)).toEqual(['/api/v1/project/client/pages/margins-B2.js']);
    expect(served.logs).toContain('Removed the page /p/revenue; its file is gone.');
  });

  it('is not watched on a server', async () => {
    const served = await serve();
    writeClientBuild(served.install.dir, { pages: [{ name: 'margins' }], tag: 'B2' });
    await new Promise((resolveWait) => setTimeout(resolveWait, 1300));
    expect(await pagesRepo(served.install.meta).findById(projectPageId('margins'))).toBeNull();
  });
});

describe('on the desktop app', () => {
  it('serves no project code, and adds no pages', async () => {
    const served = await serve({ env: { ADMINIUM_RUNTIME: 'desktop' } });
    expect(await pagesRepo(served.install.meta).findById(projectPageId('revenue'))).toBeNull();
    const { project } = await bootstrap(served);
    expect(project).toEqual({ databases: { main: served.install.mainId }, client: null });
    const res = await served.app.inject({
      method: 'GET',
      url: '/api/v1/project/client/pages/revenue-A1.js',
      headers: { cookie: served.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
