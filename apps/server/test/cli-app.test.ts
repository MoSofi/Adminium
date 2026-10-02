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
        publicAccess: [{ table: 'jobs', methods: ['GET', 'POST'], select: ['id', 'title'], writable: ['title', 'notes'] }],
      },
    });
    const { code, out } = await run('check', 'repairs');
    expect(code, out).toBe(0);
    expect(out).toContain('the customer side may reach only this:');
    expect(out).toContain('jobs: read (id, title) and add a row (title, notes)');
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
