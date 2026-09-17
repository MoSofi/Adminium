// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium eject`: the page of code it writes, the command, and what happens
 * to the page's row once the folder changed: the page keeps its id, grants,
 * database and data source, whichever of the file sync and the page build
 * sees the change first, and regeneration leaves it alone.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

import { pagesRepo, permissionsRepo, projectFilesRepo, rolesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { runGeneration } from '../src/generate/run.js';
import { hasCodePage, type BuiltClientPage } from '../src/project/client-build.js';
import { componentName, ejectedPageSource, objectLiteral } from '../src/project/eject.js';
import { diskFileStore } from '../src/project/file-store.js';
import { applyProjectPages, sourceOfStored } from '../src/project/project-pages.js';
import { reconcileProject } from '../src/project/reconcile.js';
import { createProjectService } from '../src/project/service.js';
import { APP_VERSION } from '../src/version.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';
import { makeInstall, type Install } from './project-fixtures.js';

let install: Install | null = null;
afterEach(async () => {
  await install?.close();
  install = null;
});

/** An install whose project folder has its page files, as `adminium dev` leaves it. */
async function projectWithFiles(): Promise<Install> {
  install = await makeInstall();
  await reconcileProject({ meta: install.meta, store: diskFileStore(install.dir), mode: 'dev' });
  writeFileSync(
    join(install.dir, 'adminium.config.mjs'),
    `export default { databases: { main: { url: 'sqlite:${join(install.dir, 'shop.db')}' } } };\n`,
  );
  writeFileSync(join(install.dir, 'package.json'), JSON.stringify({ dependencies: { '@adminiumjs/adminium': APP_VERSION } }));
  return install;
}

function builtPage(name: string, title: string): BuiltClientPage {
  return {
    name,
    source: `pages/${name}.tsx`,
    module: `pages/${name}-A.js`,
    imports: [],
    styles: [],
    title,
    icon: 'receipt',
    nav: { group: 'library', order: 3, hidden: false },
  };
}

type Transform = (
  source: string,
  options: { loader: 'tsx'; format: 'cjs'; jsx: 'automatic' },
) => Promise<{ code: string }>;

/** esbuild's `transform`, from the esbuild vitest brings (`project-client-build.test.ts` does the same). */
async function esbuildTransform(): Promise<Transform> {
  const fromHere = createRequire(import.meta.url);
  const vite = createRequire(fromHere.resolve('vitest/package.json')).resolve('vite');
  const mod = (await import(pathToFileURL(createRequire(vite).resolve('esbuild')).href)) as {
    transform?: Transform;
    default?: { transform: Transform };
  };
  const transform = mod.transform ?? mod.default?.transform;
  if (transform === undefined) throw new Error('esbuild has no transform');
  return transform;
}

/** What the ejected file's component draws: `<GeneratedPage page={…} />`'s props. */
async function drawnPage(source: string): Promise<{ definition: Record<string, unknown>; page: unknown }> {
  const transform = await esbuildTransform();
  const { code } = await transform(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' });
  const module = { exports: {} as { default?: Record<string, unknown> } };
  const modules: Record<string, unknown> = {
    '@adminiumjs/adminium/ui': { GeneratedPage: 'GeneratedPage', definePage: (definition: unknown) => definition },
    'react/jsx-runtime': { jsx: (type: unknown, props: unknown) => ({ type, props }) },
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name: string) => modules[name] });
  const definition = module.exports.default ?? {};
  const drawn = (definition['component'] as () => { type: unknown; props: { page: unknown } })();
  expect(drawn.type).toBe('GeneratedPage');
  return { definition, page: drawn.props.page };
}

describe('the page of code eject writes', () => {
  it('writes values as TypeScript a person edits', () => {
    expect(objectLiteral({ a: 1, 'b-c': "it's", d: [true, null], e: {}, f: [] })).toBe(
      "{\n  a: 1,\n  'b-c': 'it\\'s',\n  d: [true, null],\n  e: {},\n  f: [],\n}",
    );
    expect(objectLiteral({ key: 'nav.tasks', fallback: 'Tasks' })).toBe("{ key: 'nav.tasks', fallback: 'Tasks' }");
    expect(objectLiteral('line\nbreak "quoted" \\ back')).toBe("'line\\nbreak \"quoted\" \\\\ back'");
    expect(() => objectLiteral(Number.NaN)).toThrow('has no literal');
    expect(componentName('orders-by-month')).toBe('OrdersByMonthPage');
    expect(componentName('2024-report')).toBe('Page2024Report');
  });

  it('draws the page file it came from, with its title and sidebar place', async () => {
    const portable = {
      v: 1,
      kind: 'page',
      template: 'page-crud',
      title: { fallback: 'Orders', key: 'nav.orders' },
      source: { database: 'main', table: 'main.orders' },
      nav: { group: 'library', icon: 'receipt', order: 70, slug: 'orders' },
      access: { minRole: 'viewer', permissions: ['table:main.orders:read'] },
      config: { columns: [{ name: 'status', label: "Buyer's status", enumValues: ['a', 'b'] }], pageSize: 25 },
    };
    const source = ejectedPageSource('orders', portable);
    expect(source).toContain('ejected from pages/orders.json by `adminium eject`');
    expect(source).toContain("import { GeneratedPage, definePage } from '@adminiumjs/adminium/ui';");
    const { definition, page } = await drawnPage(source);
    expect(page).toEqual(portable);
    expect(definition).toMatchObject({ title: 'Orders', icon: 'receipt', nav: { group: 'library', order: 70 } });
    expect(ejectedPageSource('plain', { title: 'Plain', nav: { hidden: true } })).toContain("nav: { hidden: true },");
    expect(() => ejectedPageSource('Not An Address', {})).toThrow('is not a page address');
  });
});

describe('adminium eject', () => {
  it('replaces a page file with a page of code', async () => {
    const { dir } = await projectWithFiles();
    const before = JSON.parse(readFileSync(join(dir, 'pages', 'orders.json'), 'utf8')) as Record<string, unknown>;
    const io = fakeIo({ interactive: false });
    await expect(runCli(['eject', 'orders'], { io, deps: fakeDeps({ cwd: dir }) })).resolves.toBe(0);
    expect(existsSync(join(dir, 'pages', 'orders.json'))).toBe(false);
    expect(io.stdout()).toContain('Wrote pages/orders.tsx and deleted pages/orders.json.');
    const { page, definition } = await drawnPage(readFileSync(join(dir, 'pages', 'orders.tsx'), 'utf8'));
    const { $schema: _schema, origin: _origin, generated: _generated, ...portable } = before;
    expect(page).toEqual(portable);
    expect(definition['title']).toBe((before['title'] as { fallback: string }).fallback);
    expect(hasCodePage(dir, 'orders')).toBe(true);
  });

  it('says what is wrong, and changes nothing', async () => {
    const { dir } = await projectWithFiles();
    const run = async (argv: string[], cwd = dir): Promise<string> => {
      const io = fakeIo({ interactive: false });
      await expect(runCli(argv, { io, deps: fakeDeps({ cwd }) })).resolves.toBe(1);
      return io.stderr();
    };
    expect(await run(['eject'])).toContain('takes one page address');
    expect(await run(['eject', 'a', 'b'])).toContain('takes one page address');
    expect(await run(['eject', 'orders'], join(dir, '..'))).toContain('runs inside a project');
    expect(await run(['eject', 'Orders!'])).toContain('is not a page address');
    expect(await run(['eject', 'nowhere'])).toContain('pages/nowhere.json does not exist.');

    writeFileSync(join(dir, 'pages', 'customers.tsx'), 'export default {};\n');
    expect(await run(['eject', 'customers'])).toContain('already written in React');
    rmSync(join(dir, 'pages', 'customers.tsx'));

    const orders = join(dir, 'pages', 'orders.json');
    const text = readFileSync(orders, 'utf8');
    writeFileSync(orders, text.replace('"template"', '"tempalte"'));
    expect(await run(['eject', 'orders'])).toContain('pages/orders.json is not valid, so it was not ejected');
    writeFileSync(orders, JSON.stringify({ ...(JSON.parse(text) as object), enabled: false }));
    expect(await run(['eject', 'orders'])).toContain('is turned off');
    expect(existsSync(join(dir, 'pages', 'orders.tsx'))).toBe(false);
    expect(existsSync(orders)).toBe(true);
  });
});

describe('an ejected page', () => {
  /** Each project's `pages/orders.json` as it was before the eject. */
  const originalFiles = new Map<string, string>();

  async function ejectedOrders() {
    const project = await projectWithFiles();
    const pages = pagesRepo(project.meta);
    const row = await pages.findBySlug(project.mainId, 'orders');
    if (row === null) throw new Error('no orders page');
    const viewer = await rolesRepo(project.meta).findBySlug('viewer');
    if (viewer === null) throw new Error('no viewer role');
    await permissionsRepo(project.meta).grant(viewer.id, 'page', row.id, { view: true, edit: false });
    originalFiles.set(project.dir, readFileSync(join(project.dir, 'pages', 'orders.json'), 'utf8'));
    rmSync(join(project.dir, 'pages', 'orders.json'));
    writeFileSync(join(project.dir, 'pages', 'orders.tsx'), 'export default {};\n');
    const folder = {
      hasCodePage: (slug: string) => hasCodePage(project.dir, slug),
      hasPageFile: (slug: string) => existsSync(join(project.dir, 'pages', `${slug}.json`)),
    };
    return { project, pages, row, viewer, folder };
  }

  async function expectAdopted(ctx: Awaited<ReturnType<typeof ejectedOrders>>, title: string): Promise<void> {
    const after = await ctx.pages.findById(ctx.row.id);
    expect(after).toMatchObject({ origin: 'project', type: 'project-page', connectionId: ctx.project.mainId, title });
    expect(sourceOfStored(after?.config)).toEqual(sourceOfStored(ctx.row.config));
    expect((after?.config as { config: unknown }).config).toEqual({ file: 'orders' });
    const grants = await permissionsRepo(ctx.project.meta).listForResource('page', ctx.row.id);
    expect(grants.map((grant) => grant.roleId)).toEqual([ctx.viewer.id]);
    expect((await ctx.pages.listAll()).filter((page) => page.slug === 'orders')).toHaveLength(1);
  }

  it('keeps its row when the file sync sees it first', async () => {
    const ctx = await ejectedOrders();
    const { meta, dir } = ctx.project;
    const report = await reconcileProject({ meta, store: diskFileStore(dir), mode: 'dev', ...ctx.folder });
    expect(report.replacedByCode).toEqual(['pages/orders.json']);
    expect(report.removed).toEqual([]);
    expect((await projectFilesRepo(meta).list()).map((record) => record.path)).not.toContain('pages/orders.json');
    await expectAdopted(ctx, ctx.row.title);

    // The build then gives it its code's title and place, under the same id.
    const applied = await applyProjectPages(meta, [builtPage('orders', 'Orders in code')], ctx.folder);
    expect(applied).toMatchObject({ applied: ['orders'], adopted: [], problems: [] });
    await expectAdopted(ctx, 'Orders in code');
    expect((await ctx.pages.findById(ctx.row.id))?.navGroup).toBe('library');

    // Nothing is left for the sync to do, and regeneration leaves it alone.
    const again = await reconcileProject({ meta, store: diskFileStore(dir), mode: 'dev', ...ctx.folder });
    expect([...again.applied, ...again.written, ...again.removed, ...again.replacedByCode]).toEqual([]);
    const generated = await runGeneration({ manager: ctx.project.manager, meta, connectionId: ctx.project.mainId, createdBy: null });
    expect(generated.persistence.preserved).toContain(ctx.row.id);
    await expectAdopted(ctx, 'Orders in code');
  });

  it('keeps its row when the build sees it first', async () => {
    const ctx = await ejectedOrders();
    const { meta, dir } = ctx.project;
    const applied = await applyProjectPages(meta, [builtPage('orders', 'Orders in code')], ctx.folder);
    expect(applied).toMatchObject({ applied: ['orders'], adopted: ['orders'], problems: [] });
    await expectAdopted(ctx, 'Orders in code');

    const report = await reconcileProject({ meta, store: diskFileStore(dir), mode: 'dev', ...ctx.folder });
    expect([...report.removed, ...report.replacedByCode]).toEqual([]);
    expect((await projectFilesRepo(meta).list()).map((record) => record.path)).not.toContain('pages/orders.json');
    await expectAdopted(ctx, 'Orders in code');
  });

  it('keeps its row while the build is behind its code, and loses it with its code', async () => {
    const ctx = await ejectedOrders();
    const { meta } = ctx.project;
    await applyProjectPages(meta, [builtPage('orders', 'Orders in code')], ctx.folder);
    expect((await applyProjectPages(meta, [], ctx.folder)).removed).toEqual([]);
    await expectAdopted(ctx, 'Orders in code');

    rmSync(join(ctx.project.dir, 'pages', 'orders.tsx'));
    expect((await applyProjectPages(meta, [], ctx.folder)).removed).toEqual(['orders']);
    expect(await ctx.pages.findById(ctx.row.id)).toBeNull();
  });

  it('goes back to its page file, with its row, when the eject is undone', async () => {
    const undone = async (order: 'sync first' | 'build first') => {
      const ctx = await ejectedOrders();
      const { meta, dir } = ctx.project;
      const file = join(dir, 'pages', 'orders.json');
      await reconcileProject({ meta, store: diskFileStore(dir), mode: 'dev', ...ctx.folder });
      await applyProjectPages(meta, [builtPage('orders', 'Orders in code')], ctx.folder);
      await expectAdopted(ctx, 'Orders in code');

      // `git restore pages/orders.json && git rm pages/orders.tsx`
      writeFileSync(file, originalFiles.get(ctx.project.dir) ?? '');
      rmSync(file.replace('.json', '.tsx'));
      const sync = () => reconcileProject({ meta, store: diskFileStore(dir), mode: 'dev', ...ctx.folder });
      const build = () => applyProjectPages(meta, [], ctx.folder);
      if (order === 'sync first') {
        expect((await sync()).applied).toEqual(['pages/orders.json']);
        expect((await build()).removed).toEqual([]);
      } else {
        expect((await build()).removed).toEqual([]);
        expect((await sync()).applied).toEqual(['pages/orders.json']);
      }
      const after = await ctx.pages.findById(ctx.row.id);
      expect(after).toMatchObject({ origin: 'generated', type: 'page-crud', connectionId: ctx.project.mainId });
      const grants = await permissionsRepo(meta).listForResource('page', ctx.row.id);
      expect(grants.map((grant) => grant.roleId)).toEqual([ctx.viewer.id]);
      await ctx.project.close();
      install = null;
    };
    await undone('sync first');
    await undone('build first');
  });

  it('is not taken over where no page file was ever applied', async () => {
    const ctx = await ejectedOrders();
    const { meta } = ctx.project;
    await projectFilesRepo(meta).remove('pages/orders.json');
    const applied = await applyProjectPages(meta, [builtPage('orders', 'Orders in code')], ctx.folder);
    expect(applied.adopted).toEqual([]);
    expect(applied.problems[0]?.message).toContain('the address /p/orders is already used');
    expect((await ctx.pages.findById(ctx.row.id))?.origin).toBe('generated');
  });

  it('is only deleted, as before, when no code took its place', async () => {
    const ctx = await ejectedOrders();
    const { meta, dir } = ctx.project;
    rmSync(join(dir, 'pages', 'orders.tsx'));
    const report = await reconcileProject({ meta, store: diskFileStore(dir), mode: 'dev', ...ctx.folder });
    expect(report.removed).toEqual(['pages/orders.json']);
    expect(await ctx.pages.findById(ctx.row.id)).toBeNull();
  });

  it('on a server where the page was changed too, becomes code when the project copy is chosen', async () => {
    const ctx = await ejectedOrders();
    const { meta, dir } = ctx.project;
    await ctx.pages.updateMeta(ctx.row.id, { title: 'Renamed on the server' });
    const logs: string[] = [];
    const service = createProjectService({
      meta,
      root: dir,
      mode: 'server',
      log: (line) => logs.push(line),
      warn: (line) => logs.push(line),
      pollMs: 0,
      watchFiles: false,
    });
    try {
      await service.reconcile();
      const status = await service.status();
      expect(status.entries.find((entry) => entry.path === 'pages/orders.json')?.status).toBe('conflict');
      expect((await ctx.pages.findById(ctx.row.id))?.origin).toBe('generated');

      await service.resolve('pages/orders.json', 'project');
      await expectAdopted(ctx, 'Renamed on the server');
    } finally {
      await service.close();
    }
  });
});
