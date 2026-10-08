// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium app …` through the CLI, on an app folder in a temp project.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { APP_VERSION } from '../src/version.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-cli-app-'));
  writeFileSync(join(root, 'adminium.config.ts'), 'export default {};\n');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const APP = {
  manifestVersion: 1,
  key: 'repairs',
  name: 'Repairs',
  version: '0.1.0',
  publisher: { id: 'local', name: 'Local' },
  license: 'UNLICENSED',
  description: { key: 'repairs.description', fallback: 'A repair desk.' },
  categories: ['operations'],
  compatibility: { minAdminiumVersion: '0.3.0' },
  frontends: [{ side: 'staff', kind: 'none' }],
  prefixed: true,
};
const JOBS = {
  ref: 'jobs',
  columns: [
    { ref: 'id', type: 'id', role: 'pk' },
    { ref: 'title', type: 'text', nullable: true, maxLength: 120 },
    { ref: 'notes', type: 'text', nullable: true },
  ],
};
const PAGE = {
  ref: 'jobs',
  template: 'page-crud',
  title: { key: 'repairs.jobs', fallback: 'Jobs' },
  nav: { group: 'manifest:repairs', icon: 'wrench', order: 1 },
  bindings: { main: 'jobs' },
};

/** Write files under the project; a `null` leaves one out. */
function write(files: Record<string, unknown>): void {
  for (const [path, value] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  }
}

function parts(change: Record<string, unknown> = {}, key = 'repairs'): void {
  write({
    [`apps/${key}/manifest/app.json`]: { ...APP, key },
    [`apps/${key}/manifest/tables/jobs.json`]: JOBS,
    [`apps/${key}/manifest/pages/jobs.json`]: PAGE,
    ...change,
  });
}

async function run(...argv: string[]) {
  const io = fakeIo({ interactive: false });
  const code = await runCli(['app', ...argv], { io, deps: fakeDeps({ cwd: root, env: {} }) });
  return { code, out: io.stdout(), err: io.stderr() };
}

describe('adminium app', () => {
  it('lists its commands, and gives a command its own help', async () => {
    const bare = await run();
    expect(bare.code).toBe(0);
    expect(bare.out).toContain('adminium app <command>');
    expect(bare.out).toMatch(/^ {2}check\s/m);

    const help = await run('check', '--help');
    expect(help.code).toBe(0);
    expect(help.out).toContain('Usage: adminium app check [key]');
    expect(help.out).toContain('--split');
  });

  it('refuses a command it does not have, and a folder that is not a project', async () => {
    const unknown = await run('publish');
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain('Unknown app command "publish"');

    rmSync(join(root, 'adminium.config.ts'));
    const outside = await run('check');
    expect(outside.code).toBe(1);
    expect(outside.err).toContain('runs inside a project');
  });
});

describe('adminium app check', () => {
  it('passes a manifest written as parts, and says the customer side reaches nothing', async () => {
    parts();
    const { code, out, err } = await run('check');
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('✓ Repairs 0.1.0 (repairs): 1 table(s), 1 page(s), no screens of its own');
    expect(out).toContain('the customer side reaches nothing');
  });

  it('says in words what the customer side may reach', async () => {
    parts({
      'apps/repairs/manifest/access.json': {
        publicAccess: [{ table: 'jobs', methods: ['POST'], select: ['id'], writable: ['title', 'notes'] }],
      },
    });
    const { code, out } = await run('check', 'repairs');
    expect(code, out).toBe(0);
    expect(out).toContain('the customer side may reach only this:');
    expect(out).toContain('jobs: add a row (title, notes)');
  });

  it('refuses what an install would refuse of the app’s own key', async () => {
    // The manifest's shape allows it; the key an install makes for the app may not hold both.
    parts({ 'apps/repairs/manifest/access.json': { publicAccess: [{ table: 'jobs', methods: ['GET', 'POST'], select: ['id'], writable: ['title'] }] } });
    const both = await run('check');
    expect(both.code).toBe(2);
    expect(both.err).toContain('apps/repairs/manifest/access.json: publicAccess.0.methods — "jobs" lets anyone add a row, so it may not also let anyone read one');

  });

  it('refuses a role an install would refuse', async () => {
    parts({ 'apps/repairs/manifest/roles.json': [{ key: 'staff', name: 'Staff', permissions: ['system:users:manage', 'table:@ghosts:read', 'table:@jobs:read'] }] });
    const { code, err } = await run('check');
    expect(code).toBe(2);
    expect(err).toContain('apps/repairs/manifest/roles.json: 0 — The role "staff": "system:users:manage" gives a console permission, which an app cannot.');
    expect(err).toContain('"table:@ghosts:read" names a table the app does not declare');
  });

  it('names the part file a problem is in, and exits 2', async () => {
    parts({
      'apps/repairs/manifest/tables/jobs.json': { ...JOBS, columns: [{ ref: 'id', type: 'nonsense' }] },
      'apps/repairs/manifest/acess.json': {},
    });
    const first = await run('check');
    expect(first.code).toBe(2);
    expect(first.err).toContain('apps/repairs/manifest/acess.json — not a manifest part');

    rmSync(join(root, 'apps/repairs/manifest/acess.json'));
    const second = await run('check');
    expect(second.code).toBe(2);
    expect(second.err).toMatch(/✗ apps\/repairs\/manifest\/tables\/jobs\.json: columns\.0\.type — /);
  });

  it('warns without failing: a required column with no default', async () => {
    parts({ 'apps/repairs/manifest/tables/jobs.json': { ...JOBS, columns: [...JOBS.columns, { ref: 'customer', type: 'text', maxLength: 80 }] } });
    const { code, err } = await run('check');
    expect(code).toBe(0);
    expect(err).toMatch(/! apps\/repairs\/manifest\/tables\/jobs\.json: columns\.3 — "jobs\.customer" has no default/);
  });

  it('checks the folder against the manifest: its key, its Adminium, its sides', async () => {
    parts({ 'apps/repairs/manifest/app.json': { ...APP, key: 'other', compatibility: { minAdminiumVersion: '99.0.0' }, frontends: [{ side: 'customer', kind: 'spa' }] } });
    write({ 'apps/repairs/staff/src/main.tsx': 'export {};\n' });
    const { code, err } = await run('check');
    expect(code).toBe(2);
    expect(err).toContain('key — is "other", and the folder is apps/repairs');
    expect(err).toContain(`compatibility.minAdminiumVersion — is 99.0.0, and this is Adminium ${APP_VERSION}`);
    expect(err).toContain('declares a customer side, and apps/repairs/customer/src/main.tsx does not exist');
    expect(err).toContain('apps/repairs/staff — has code, and the manifest\'s frontends do not list a staff side');
  });

  it('checks the sample data against the tables', async () => {
    parts({ 'apps/repairs/manifest/sample.json': { sampleData: { file: 'seeds/sample.json' } } });
    const missing = await run('check');
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('apps/repairs/seeds/sample.json — is named by sampleData.file and does not exist');

    write({ 'apps/repairs/seeds/sample.json': { format: 'adminium.sample/1', app: 'repairs', tables: [{ ref: 'ghosts', rows: [{ title: 'x' }] }] } });
    const wrong = await run('check');
    expect(wrong.code).toBe(2);
    expect(wrong.err).toContain('apps/repairs/seeds/sample.json');

    write({ 'apps/repairs/seeds/sample.json': { format: 'adminium.sample/1', app: 'repairs', tables: [{ ref: 'jobs', rows: [{ title: 'Fix the door' }] }] } });
    expect((await run('check')).code).toBe(0);
  });

  it('tells an add-on in an app folder what it is, in one sentence', async () => {
    const { prefixed: _prefixed, ...whole } = APP;
    write({ 'apps/repairs/manifest.json': { ...whole, kind: 'add-on', addOn: { attaches: [{ app: '*' }], connect: { kind: 'none' } }, requiredSchema: { prefixed: true, tables: [JOBS] } } });
    const { code, err } = await run('check');
    expect(code).toBe(2);
    expect(err).toContain('kind — is an add-on. An app folder holds an app. An add-on is a package: Studio → Add-ons installs it.');
    // The one finding: never the validator's word about the folder's own publisher.
    expect(err).not.toContain('publisher');
  });

  it('refuses a word this Adminium reads and does not run yet, where it is written', async () => {
    parts({
      'apps/repairs/manifest/app.json': { ...APP, compatibility: { minAdminiumVersion: '0.3.18' } },
      'apps/repairs/manifest/add-ons.json': { suggests: [{ key: 'cards-kit', range: '*', reason: { 'en-US': 'Gift cards.' } }] },
      // A link into an add-on runs now; the last four of a code, kept beside it, does not yet.
      'apps/repairs/manifest/tables/jobs.json': {
        ...JOBS,
        columns: [...JOBS.columns, { ref: 'card_code', type: 'text', maxLength: 32, rules: { code: { length: 12 } } }, { ref: 'card_last4', type: 'text', maxLength: 4, nullable: true, rules: { codeLast4: { of: 'card_code' } } }],
      },
    });
    const { code, err } = await run('check');
    expect(code).toBe(2);
    expect(err).toMatch(/apps\/repairs\/manifest\/tables\/jobs\.json: columns\.4\.rules\.codeLast4 — uses "column\.codeLast4", which Adminium 0\.3\.19 runs and this Adminium \S+ does not\. Take it out, or run this folder on Adminium 0\.3\.19\./);
  });

  it('says that the add-ons it names add to what the customer side may reach, and checks its rows for them', async () => {
    const named = { ...APP, compatibility: { minAdminiumVersion: '0.3.18' } };
    const naming = { 'apps/repairs/manifest/add-ons.json': { suggests: [{ key: 'cards-kit', range: '*', reason: { 'en-US': 'Gift cards.' } }] } };
    parts({ ...naming, 'apps/repairs/manifest/access.json': { publicAccess: [{ table: 'jobs', methods: ['POST'], select: ['id'], writable: ['title'] }] } });
    const plain = await run('check');
    expect(plain.out + plain.err).toContain('jobs: add a row (title)');
    expect(plain.out + plain.err).toContain('plus what cards-kit grants when it is connected');

    // Its rows for the add-on: the file is there, is for that add-on, and says so.
    parts({
      ...naming,
      'apps/repairs/manifest/app.json': named,
      'apps/repairs/manifest/sample.json': { sampleData: { file: 'seeds/sample.json', addOns: { 'cards-kit': { file: 'seeds/cards.json' } } } },
      'apps/repairs/seeds/sample.json': { format: 'adminium.sample/1', app: 'repairs', tables: [{ ref: 'jobs', rows: [{ title: 'Fix the door' }] }] },
    });
    const missing = await run('check');
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('apps/repairs/seeds/cards.json — is named by sampleData.addOns.cards-kit.file and does not exist');
    const cards = [{ ref: 'cards', rows: [{ label: 'For Mia' }] }];
    write({ 'apps/repairs/seeds/cards.json': { format: 'adminium.sample/1', app: 'repairs', addOn: 'stock-kit', tables: cards } });
    const other = await run('check');
    expect(other.code).toBe(2);
    expect(other.err).toContain('apps/repairs/seeds/cards.json: addOn — is "stock-kit", and the manifest lists this file under "cards-kit".');
    write({ 'apps/repairs/seeds/cards.json': { format: 'adminium.sample/1', app: 'repairs', tables: cards } });
    expect((await run('check')).err).toContain('Rows for an add-on say which');
  });

  it('reads a single manifest.json too, refuses both forms at once, and a link among the parts', async () => {
    write({ 'apps/repairs/manifest.json': { ...APP, prefixed: undefined, requiredSchema: { tables: [JOBS], prefixed: true }, pages: [PAGE] } });
    expect((await run('check')).code).toBe(0);

    parts();
    const both = await run('check');
    expect(both.code).toBe(2);
    expect(both.err).toContain('has both manifest.json and manifest/');

    rmSync(join(root, 'apps/repairs/manifest.json'));
    symlinkSync(join(root, 'apps/repairs/manifest/app.json'), join(root, 'apps/repairs/manifest/roles.json'));
    const linked = await run('check');
    expect(linked.code).toBe(2);
    expect(linked.err).toContain('apps/repairs/manifest/roles.json — is a link');
  });

  it('asks which app when the project holds several, and takes the only one otherwise', async () => {
    parts();
    parts({}, 'desk');
    const ambiguous = await run('check');
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.err).toContain('This project has 2 apps');
    expect((await run('check', 'desk')).code).toBe(0);
    expect((await run('check', 'nothing')).err).toContain('There is no app "nothing"');
  });

  it('--json prints the same result as data', async () => {
    parts({ 'apps/repairs/manifest/tables/jobs.json': { ...JOBS, columns: [{ ref: 'id', type: 'nonsense' }] } });
    const { code, out } = await run('check', '--json');
    expect(code).toBe(2);
    const result = JSON.parse(out) as { ok: boolean; form: string; problems: { file: string; level: string }[] };
    expect(result).toMatchObject({ ok: false, key: 'repairs', form: 'parts' });
    expect(result.problems[0]).toMatchObject({ level: 'error', file: 'apps/repairs/manifest/tables/jobs.json' });
  });

  it('--split rewrites manifest.json as parts that compose back to it', async () => {
    const document = { ...APP, prefixed: undefined, requiredSchema: { tables: [JOBS], prefixed: true }, pages: [PAGE], roles: [{ key: 'repairs-staff', name: 'Repairs staff' }] };
    write({ 'apps/repairs/manifest.json': document });
    const { code, out } = await run('check', '--split');
    expect(code, out).toBe(0);
    expect(out).toContain('Wrote 4 part file(s) to apps/repairs/manifest/ and removed manifest.json');
    expect(existsSync(join(root, 'apps/repairs/manifest.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(root, 'apps/repairs/manifest/app.json'), 'utf8'))).toMatchObject({ key: 'repairs', prefixed: true });
    expect(existsSync(join(root, 'apps/repairs/manifest/roles.json'))).toBe(true);

    const again = await run('check', '--split');
    expect(again.code).toBe(1);
    expect(again.err).toContain('already exists');
  });
});

describe('adminium app new', () => {
  /** A project as `adminium new` leaves it, as far as `app new` reads it. */
  function project(): void {
    write({ 'package.json': { name: 'my-admin', private: true, dependencies: { '@adminiumjs/adminium': APP_VERSION }, devDependencies: { esbuild: '^0.28.0' } } });
  }
  async function runNew(...argv: string[]) {
    const calls: string[] = [];
    const io = fakeIo({ interactive: false });
    const deps = fakeDeps({ cwd: root, env: {} });
    deps.runProcess = (command, args) => {
      calls.push(`${command} ${args.join(' ')}`);
      return { status: 0, stdout: '' };
    };
    const code = await runCli(['app', 'new', ...argv], { io, deps });
    return { code, out: io.stdout(), err: io.stderr(), calls };
  }
  const pkg = () => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

  it('writes an app that is its tables and pages alone, and that passes its own check', async () => {
    project();
    const { code, out, err, calls } = await runNew('repairs');
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('Created apps/repairs/');
    expect(out).toContain('✓ Repairs 0.1.0 (repairs): 2 table(s), 2 page(s), no screens of its own');
    expect(out).toContain('the customer side reaches nothing');
    const app = JSON.parse(readFileSync(join(root, 'apps/repairs/manifest/app.json'), 'utf8')) as Record<string, unknown>;
    expect(app).toMatchObject({ key: 'repairs', publisher: { id: 'local' }, frontends: [{ side: 'staff', kind: 'none' }], compatibility: { minAdminiumVersion: APP_VERSION.replace(/[-+].*$/, '') } });
    expect(existsSync(join(root, 'apps/repairs/staff'))).toBe(false);
    expect(existsSync(join(root, 'apps/repairs/manifest/access.json'))).toBe(false);
    // No screens: nothing to install, and package.json is left alone.
    expect(calls).toEqual([]);
    expect(pkg().dependencies).toEqual({ '@adminiumjs/adminium': APP_VERSION });
    expect((await run('check')).code).toBe(0);
  });

  it('adds the sides asked for, what they need, and grants the customer side one table', async () => {
    project();
    const { code, out, calls } = await runNew('repair-desk', '--staff', '--customer', '--name', 'Repair Desk');
    expect(code, out).toBe(0);
    expect(out).toContain('Repair Desk 0.1.0 (repair-desk): 2 table(s), 2 page(s), staff and customer side');
    expect(out).toContain('items: read (id, title, status)');
    expect(out).toContain('requests: add a row (message)');
    for (const file of ['staff/src/main.tsx', 'staff/src/App.tsx', 'staff/nav.json', 'customer/src/App.tsx', 'tests/app.test.mjs', 'README.md', 'seeds/sample.json']) {
      expect(existsSync(join(root, 'apps/repair-desk', file)), file).toBe(true);
    }
    const staff = readFileSync(join(root, 'apps/repair-desk/staff/src/App.tsx'), 'utf8');
    expect(staff).toContain("en('Repair Desk')");
    expect(staff).not.toContain('__NAME__');
    expect(readFileSync(join(root, 'apps/repair-desk/tests/app.test.mjs'), 'utf8')).toContain("'check', 'repair-desk'");
    expect(pkg().dependencies).toMatchObject({ react: '^19.2.0', 'react-dom': '^19.2.0', '@adminiumjs/public-client': APP_VERSION });
    expect(pkg().devDependencies).toHaveProperty('@types/react-dom');
    expect(calls).toEqual(['npm install']);
    expect(out).toContain('Added to package.json: react, react-dom, @adminiumjs/public-client, @types/react-dom.');
  });

  it('uses the project’s own package manager, keeps versions already chosen, and can skip the install', async () => {
    project();
    write({ 'pnpm-lock.yaml': '', 'package.json': { name: 'x', dependencies: { react: '18.3.1' } } });
    const first = await runNew('desk', '--staff');
    expect(first.calls).toEqual(['pnpm install']);
    expect(pkg().dependencies.react).toBe('18.3.1');
    expect(pkg().dependencies).not.toHaveProperty('@adminiumjs/public-client');

    const second = await runNew('other', '--customer', '--no-install');
    expect(second.calls).toEqual([]);
    expect(second.out).toContain('Install them before building:  pnpm install');
  });

  it('refuses a bad key, a reserved one, and a folder that has things in it', async () => {
    project();
    for (const key of ['Repairs', 'x', 'dashboard']) {
      const refused = await runNew(key);
      expect(refused.code, key).toBe(1);
      expect(refused.err, key).toMatch(/cannot be an app key/);
    }
    expect((await runNew()).err).toContain('Give the app one key');

    write({ 'apps/taken/notes.txt': 'mine' });
    const taken = await runNew('taken');
    expect(taken.code).toBe(1);
    expect(taken.err).toContain('apps/taken already exists and is not empty');
  });
});
