// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The CLI side of project files: `new` adopting an existing instance (and
 * `--import`), `pull` from the project's own database and from a server, and
 * `check` reading page files with no database.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pagesRepo } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { projectWidgetFindings } from '../src/cli/commands/check.js';
import { runCli } from '../src/cli/run.js';
import { openRuntime } from '../src/cli/runtime.js';
import { chooseProjectKeys, envVarFor, keyFromName } from '../src/project/adopt.js';
import { readDotEnv } from '../src/project/dotenv.js';
import { diskFileStore } from '../src/project/file-store.js';
import { stableStringify } from '../src/project/json.js';
import { reconcileProject } from '../src/project/reconcile.js';
import { APP_VERSION } from '../src/version.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';
import { INSTALL_SECRET, makeInstall, type Install } from './project-fixtures.js';

let dir: string;
let installs: Install[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adminium-cli-files-'));
});
afterEach(async () => {
  for (const install of installs) await install.close();
  installs = [];
  rmSync(dir, { recursive: true, force: true });
});

/** CLI deps that open real meta stores. */
function realDeps(cwd: string, env: Record<string, string | undefined> = {}) {
  const deps = fakeDeps({ cwd, env: { ADMINIUM_SECRET: INSTALL_SECRET, ...env } });
  deps.openRuntime = vi.fn(openRuntime);
  deps.runProcess = () => ({ status: 0, stdout: '' });
  return deps;
}

/** An instance made outside any project, with its store in `<folder>/meta.db`. */
async function instanceIn(folder: string): Promise<Install> {
  const install = await makeInstall({ metaFile: join(folder, 'meta.db'), unkeyed: true });
  installs.push(install);
  // The CLI opens the file itself; this handle must let go of it first.
  await install.meta.db.destroy();
  return install;
}

describe('choosing keys for an instance\'s databases', () => {
  it('gives the oldest `main` and the rest their names as keys', () => {
    const keys = chooseProjectKeys([
      { id: 'b', name: 'Billing DB', projectKey: null, createdAt: 2 },
      { id: 'a', name: 'Shop', projectKey: null, createdAt: 1 },
      { id: 'c', name: 'billing db', projectKey: null, createdAt: 3 },
      { id: 'd', name: 'Kept', projectKey: 'kept', createdAt: 0 },
    ]);
    expect(Object.fromEntries(keys)).toEqual({ a: 'main', b: 'billing-db', c: 'billing-db-2' });
    expect(chooseProjectKeys([{ id: 'x', name: 'Other', projectKey: 'main', createdAt: 1 }]).get('x')).toBeUndefined();
    expect(Object.fromEntries(chooseProjectKeys([{ id: 'y', name: 'CRM', projectKey: null, createdAt: 1 }, { id: 'z', name: 'Main', projectKey: 'main', createdAt: 0 }]))).toEqual({ y: 'crm' });
  });

  it('makes a key of any name, and an env var of any key', () => {
    expect(keyFromName('2024 Archive!')).toBe('db-2024-archive');
    expect(keyFromName('***')).toBe('db');
    expect(envVarFor('main')).toBe('DATABASE_URL');
    expect(envVarFor('billing-db')).toBe('BILLING_DB_DATABASE_URL');
  });
});

describe('adminium new over an existing instance', () => {
  it('makes its databases the project\'s and writes its pages as files', async () => {
    await instanceIn(join(dir, 'data'));
    const io = fakeIo({ interactive: false });
    await expect(runCli(['new', '--yes', '--no-install', '--no-git'], { io, deps: realDeps(dir) })).resolves.toBe(0);

    expect(readFileSync(join(dir, 'adminium.config.ts'), 'utf8')).toContain("main: { url: env('DATABASE_URL') }");
    expect(readDotEnv(dir)).toMatchObject({ ADMINIUM_SECRET: INSTALL_SECRET, DATABASE_URL: '' });
    expect(existsSync(join(dir, 'pages', 'orders.json'))).toBe(true);
    expect(existsSync(join(dir, 'schema', 'main.json'))).toBe(true);
    expect(io.stdout()).toContain('The project\'s databases: main (main).');
    expect(io.stdout()).not.toContain('set DATABASE_URL in .env');
  });

  it('stops before writing anything when the secret does not open the instance', async () => {
    await instanceIn(join(dir, 'data'));
    const io = fakeIo({ interactive: false });
    const deps = realDeps(dir, { ADMINIUM_SECRET: 'a-different-secret-entirely' });
    await expect(runCli(['new', '--yes', '--no-install', '--no-git'], { io, deps })).resolves.toBe(1);
    expect(io.stderr()).toContain('does not open the stored connection string of "main"');
    expect(existsSync(join(dir, 'pages'))).toBe(false);
  });

  it('refuses a database flag, since the instance brings its own', async () => {
    await instanceIn(join(dir, 'data'));
    const io = fakeIo({ interactive: false });
    await expect(runCli(['new', '--yes', '--sample'], { io, deps: realDeps(dir) })).resolves.toBe(1);
    expect(io.stderr()).toContain('takes its databases from the existing instance');
  });

  it('copies an instance in with --import, then adopts it', async () => {
    await instanceIn(join(dir, 'elsewhere'));
    const io = fakeIo({ interactive: false });
    const code = await runCli(['new', 'shop', '--yes', '--no-install', '--no-git', '--import', join(dir, 'elsewhere')], {
      io,
      deps: realDeps(dir),
    });
    expect(code).toBe(0);
    expect(existsSync(join(dir, 'shop', 'data', 'meta.db'))).toBe(true);
    expect(existsSync(join(dir, 'shop', 'pages', 'customers.json'))).toBe(true);

    const missing = fakeIo({ interactive: false });
    await expect(runCli(['new', 'x', '--yes', '--import', join(dir, 'nothing-here')], { io: missing, deps: realDeps(dir) })).resolves.toBe(1);
    expect(missing.stderr()).toContain('holds no Adminium instance');
  });
});

/** A project folder whose store already holds generated pages and their files. */
async function projectWithFiles(): Promise<Install> {
  const install = await makeInstall({ metaFile: join(dir, 'data', 'meta.db') });
  installs.push(install);
  await reconcileProject({ meta: install.meta, store: diskFileStore(dir), mode: 'dev' });
  writeFileSync(
    join(dir, 'adminium.config.mjs'),
    `export default { databases: { main: { url: 'sqlite:${join(install.dir, 'shop.db')}' } } };\n`,
  );
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { '@adminiumjs/adminium': APP_VERSION } }));
  return install;
}

describe('adminium pull', () => {
  it('writes what the project\'s own database says', async () => {
    const install = await projectWithFiles();
    const page = await pagesRepo(install.meta).findBySlug(install.mainId, 'orders');
    await pagesRepo(install.meta).updateMeta(page?.id ?? '', { title: 'Pulled title' });
    writeFileSync(join(dir, 'pages', 'unapplied.json'), '{}');
    await install.meta.db.destroy();

    const io = fakeIo({ interactive: false });
    await expect(runCli(['pull'], { io, deps: realDeps(dir) })).resolves.toBe(0);
    expect(io.stdout()).toContain('Wrote pages/orders.json');
    expect(readFileSync(join(dir, 'pages', 'orders.json'), 'utf8')).toContain('"fallback": "Pulled title"');
    expect(io.stderr()).toContain('Kept pages/unapplied.json');
  });

  it('writes the files a server changed, and deletes the ones it deleted', async () => {
    const install = await projectWithFiles();
    await install.meta.db.destroy();
    writeFileSync(join(dir, '.env'), 'ADMINIUM_API_KEY=adm_sk_test\n');
    const serverCopy = stableStringify({ changed: true });
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              version: APP_VERSION,
              mode: 'server',
              changes: [
                { path: 'pages/orders.json', status: 'changed-on-server', content: serverCopy },
                { path: 'pages/customers.json', status: 'changed-on-server', content: null },
                { path: 'pages/new-one.json', status: 'not-in-project', content: serverCopy },
                { path: '../escape.json', status: 'conflict', content: serverCopy },
              ],
              outside: [{ pageId: 'page_x', slug: 'other', connectionId: null, reason: 'its database is not in adminium.config.ts' }],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const deps = realDeps(dir);
    deps.fetch = fetchMock as unknown as typeof fetch;
    const io = fakeIo({ interactive: false });
    await expect(runCli(['pull', '--from', 'https://admin.example.com/'], { io, deps })).resolves.toBe(0);

    expect(fetchMock).toHaveBeenCalledWith('https://admin.example.com/api/v1/project/export', {
      headers: { authorization: 'Bearer adm_sk_test', accept: 'application/json' },
    });
    expect(readFileSync(join(dir, 'pages', 'orders.json'), 'utf8')).toBe(serverCopy);
    expect(existsSync(join(dir, 'pages', 'customers.json'))).toBe(false);
    expect(readFileSync(join(dir, 'pages', 'new-one.json'), 'utf8')).toBe(serverCopy);
    expect(existsSync(join(dir, 'escape.json'))).toBe(false);
    expect(io.stdout()).toContain('Wrote pages/new-one.json (made on the server)');
    expect(io.stderr()).toContain('Skipped ../escape.json');
    expect(io.stderr()).toContain('Left out page "other"');
  });

  it('explains a missing key and what each refusal from the server means', async () => {
    const install = await projectWithFiles();
    await install.meta.db.destroy();
    const noKey = fakeIo({ interactive: false });
    await expect(runCli(['pull', '--from', 'https://a.example'], { io: noKey, deps: realDeps(dir) })).resolves.toBe(1);
    expect(noKey.stderr()).toContain('needs an API key');

    for (const [status, message] of [
      [401, 'did not accept ADMINIUM_API_KEY'],
      [403, 'may not read this project'],
      [404, 'does not serve an Adminium project'],
      [500, 'answered 500'],
    ] as const) {
      const deps = realDeps(dir, { ADMINIUM_API_KEY: 'adm_sk_x' });
      deps.fetch = (async () => Promise.resolve(new Response('{}', { status }))) as unknown as typeof fetch;
      const io = fakeIo({ interactive: false });
      await expect(runCli(['pull', '--from', 'https://a.example'], { io, deps })).resolves.toBe(1);
      expect(io.stderr()).toContain(message);
    }
  });
});

describe('adminium check and page files', () => {
  it('passes valid files and names the file and field of a broken one', async () => {
    const install = await projectWithFiles();
    await install.meta.db.destroy();
    const io = fakeIo({ interactive: false });
    await expect(runCli(['check'], { io, deps: realDeps(dir) })).resolves.toBe(0);
    expect(io.stdout()).toMatch(/✓ \d+ page file\(s\) and 1 schema file\(s\) are valid/);

    const orders = JSON.parse(readFileSync(join(dir, 'pages', 'orders.json'), 'utf8')) as Record<string, unknown>;
    (orders['source'] as Record<string, unknown>)['database'] = 'billing';
    writeFileSync(join(dir, 'pages', 'orders.json'), stableStringify(orders));
    writeFileSync(join(dir, 'pages', 'Bad Name.json'), '{}');
    const broken = fakeIo({ interactive: false });
    await expect(runCli(['check'], { io: broken, deps: realDeps(dir) })).resolves.toBe(2);
    expect(broken.stderr()).toContain('✗ pages/orders.json:\n    source.database: "billing" is not a database in adminium.config.ts');
    expect(broken.stderr()).toContain('✗ pages/Bad Name.json:\n    the file name must be a page address');
  });
});

/**
 * A current build of the config and of these hooks and actions, as
 * `adminium build` leaves it. Bundle names must differ between calls in one
 * test: vitest caches an imported file by its path.
 */
function builtProject(bundles: Record<string, string>): void {
  const build = join(dir, '.adminium', 'build');
  rmSync(join(dir, 'hooks'), { recursive: true, force: true });
  rmSync(join(dir, 'actions'), { recursive: true, force: true });
  mkdirSync(build, { recursive: true });
  writeFileSync(join(build, 'config.mjs'), readFileSync(join(dir, 'adminium.config.mjs'), 'utf8'));
  const files = Object.entries(bundles).map(([key, text]) => {
    const [kind, name] = key.split('/') as ['hooks' | 'actions', string];
    mkdirSync(join(dir, kind), { recursive: true });
    writeFileSync(join(dir, kind, `${name}.ts`), '// source\n');
    const output = `server/${kind}/${name}.mjs`;
    mkdirSync(join(build, 'server', kind), { recursive: true });
    writeFileSync(join(build, output), text);
    return { kind, name, source: `${kind}/${name}.ts`, output, hash: createHash('sha256').update(text).digest('hex') };
  });
  writeFileSync(
    join(build, 'manifest.json'),
    JSON.stringify({
      adminiumVersion: APP_VERSION,
      builtAt: new Date().toISOString(),
      config: { entry: 'adminium.config.mjs', inputs: {} },
      server: { digest: String(files.length), files, inputs: {} },
    }),
  );
}

describe('adminium check and project code', () => {
  it('loads the built hooks and actions, and names the ones that would not load', async () => {
    const install = await projectWithFiles();
    await install.meta.db.destroy();
    builtProject({
      'hooks/orders': "export default { table: 'orders', beforeCreate() {} };\n",
      'hooks/broken': 'export default {};\n',
      'actions/refund': "export default { table: 'orders', database: 'billing', label: 'Refund', run() {} };\n",
    });
    const io = fakeIo({ interactive: false });
    await expect(runCli(['check'], { io, deps: realDeps(dir) })).resolves.toBe(2);
    expect(io.stderr()).toContain('✗ hooks/broken.ts: The hook is not valid: table');
    expect(io.stderr()).toContain(
      '✗ actions/refund.ts is for database "billing", which adminium.config.mjs does not list.',
    );

    builtProject({
      'hooks/orders': "export default { table: 'orders', beforeCreate() {} };\n",
      'actions/refund-main': "export default { table: 'orders', label: 'Refund', run() {} };\n",
    });
    const fixed = fakeIo({ interactive: false });
    await expect(runCli(['check'], { io: fixed, deps: realDeps(dir) })).resolves.toBe(0);
    expect(fixed.stdout()).toContain('✓ 1 hook(s) and 1 action(s) load');
  });

  it('checks that page files name project widgets that exist, of the right kind', async () => {
    const install = await projectWithFiles();
    await install.meta.db.destroy();
    builtProject({});
    // Two built widgets, listed the way the build lists them.
    const build = join(dir, '.adminium', 'build');
    const manifest = JSON.parse(readFileSync(join(build, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    const widgets = (['flag-cell', 'sales'] as const).map((name, index) => {
      mkdirSync(join(dir, 'widgets'), { recursive: true });
      writeFileSync(join(dir, 'widgets', `${name}.tsx`), '// source\n');
      mkdirSync(join(build, 'client', 'widgets'), { recursive: true });
      writeFileSync(join(build, 'client', 'widgets', `${name}-A.js`), 'export default {};\n');
      return { name, source: `widgets/${name}.tsx`, module: `widgets/${name}-A.js`, imports: [], styles: [], kind: index === 0 ? 'cell' : 'card', title: null };
    });
    const hash = createHash('sha256').update('export default {};\n').digest('hex');
    manifest['client'] = {
      digest: 'd',
      pages: [],
      widgets,
      files: widgets.map((widget) => ({ path: widget.module, hash, integrity: 'sha384-x' })),
      inputs: {},
    };
    writeFileSync(join(build, 'manifest.json'), JSON.stringify(manifest));

    const orders = JSON.parse(readFileSync(join(dir, 'pages', 'orders.json'), 'utf8')) as {
      config: { columns: Record<string, unknown>[] };
    };
    const columns = orders.config.columns;
    (columns[0] as Record<string, unknown>)['widget'] = 'project.flag-cell';
    writeFileSync(join(dir, 'pages', 'orders.json'), stableStringify(orders));
    const good = fakeIo({ interactive: false });
    await expect(runCli(['check'], { io: good, deps: realDeps(dir) })).resolves.toBe(0);
    expect(good.stdout()).toContain('✓ 0 page(s) and 2 widget(s) build');

    (columns[0] as Record<string, unknown>)['widget'] = 'project.sales';
    (columns[1] as Record<string, unknown>)['widget'] = 'project.missing';
    writeFileSync(join(dir, 'pages', 'orders.json'), stableStringify(orders));
    const bad = fakeIo({ interactive: false });
    await expect(runCli(['check'], { io: bad, deps: realDeps(dir) })).resolves.toBe(2);
    expect(bad.stderr()).toContain(
      '✗ pages/orders.json: config.columns[0].widget names "project.sales", which is a card widget; this place takes a cell widget.',
    );
    expect(bad.stderr()).toContain(
      '✗ pages/orders.json: config.columns[1].widget names "project.missing", and widgets/ has no such widget.',
    );
  });

  it('checks dashboard layout items for card widgets', () => {
    const client = {
      digest: 'd',
      pages: [],
      widgets: [
        { name: 'sales', source: 'widgets/sales.tsx', module: 'm', imports: [], styles: [], kind: 'card' as const, title: null },
        { name: 'flag', source: 'widgets/flag.tsx', module: 'm', imports: [], styles: [], kind: 'cell' as const, title: null },
      ],
      files: [],
      inputs: {},
    };
    const page = {
      config: {
        layout: {
          items: [{ widget: 'project.sales' }, { widget: 'project.flag' }, { widget: 'kpi-stat-card' }, { widget: 7 }],
        },
      },
    };
    expect(projectWidgetFindings('pages/home.json', page, client)).toEqual([
      {
        level: 'error',
        text: 'pages/home.json: config.layout.items[1].widget names "project.flag", which is a cell widget; this place takes a card widget.',
      },
    ]);
  });

  it('asks for a build when there are hooks and no way to build them', async () => {
    const install = await projectWithFiles();
    await install.meta.db.destroy();
    mkdirSync(join(dir, 'hooks'));
    writeFileSync(join(dir, 'hooks', 'orders.ts'), 'export default {};\n');
    const io = fakeIo({ interactive: false });
    await expect(runCli(['check'], { io, deps: realDeps(dir) })).resolves.toBe(2);
    expect(io.stderr()).toContain('adminium.config.mjs cannot be loaded: the project has not been built');
  });
});
