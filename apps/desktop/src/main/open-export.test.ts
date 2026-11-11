// SPDX-License-Identifier: AGPL-3.0-only
/**
 * File → "Open a project…" with an "Export everything" file.
 *
 * Two halves. The first holds main's own part with the engine faked: the
 * order (the key before the restore), what crosses on the command line and
 * what only on standard input, that a refusal leaves no folder, and what
 * Start remembers. The second runs the REAL engine command line
 * (`apps/server/dist`) on a real export made by `adminium archive create
 * --export`: a new project comes out with its people, pages and files, the
 * chosen Super Admin signs in with the password typed in the app, and a full
 * signed archive or a changed file is refused with nothing made.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

import { firstRun, openMetaStore, startProject, type StartedProject } from '@adminium/server';
import argon2 from 'argon2';
import Database from 'better-sqlite3';
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultConfig, type DesktopConfig } from './config.js';
import { runToEnd, type MakeProjectDeps, type RanProgram } from './make-project.js';
import { createDescribeExport, createImportExport, projectNameFromExport, readExportAnswer, type ExportAnswer, type OpenExportDeps } from './open-export.js';
import { realFolderDeps } from './projects.js';
import { createStartService, projectFingerprint, type StartDeps } from './start.js';

let home: string;
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'adminium-open-export-')));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const ANSWER: ExportAnswer = {
  ok: true,
  dryRun: false,
  kind: 'export',
  appVersion: '0.3.56',
  createdAt: 1_762_800_000_000,
  people: 3,
  pages: 2,
  connections: 2,
  files: 1,
  databases: 1,
  projectFiles: 0,
  owners: [
    { id: 'usr_a', email: 'ava@example.com', name: 'Ava' },
    { id: 'usr_b', email: 'bo@example.com', name: 'Bo' },
  ],
  passwordMinLength: 10,
  owner: 'bo@example.com',
  warnings: [],
};

interface Call {
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
  input: string | undefined;
  /** What the folder held when the command started. */
  envFileThen: string | null;
}

/** The engine, faked: `import-zip` answers `restore`, `new` lays a config file. */
function fakeEngine(opts: { restore?: (call: Call) => RanProgram; made?: RanProgram } = {}) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const deps: MakeProjectDeps = {
    binary: '/app/Adminium',
    cliEntry: '/app/server/cli.js',
    programs: () => Promise.resolve(undefined),
    env: { PATH: '/usr/bin', ADMINIUM_SECRET: 'the-classic-servers-own-secret', ADMINIUM_META_URL: 'postgres://elsewhere/meta' },
    run: (_command, args, run) => {
      const envFile = join(run.cwd, '.env');
      const call: Call = { args, cwd: run.cwd, env: run.env, input: run.input, envFileThen: existsSync(envFile) ? readFileSync(envFile, 'utf8') : null };
      calls.push(call);
      if (args[1] === 'new') {
        run.onOutput?.('Started a git repository.\nInstalling dependencies with npm…\n');
        const made = opts.made ?? { code: 0, output: 'Started a git repository.', timedOut: false };
        if (made.code === 0) writeFileSync(join(run.cwd, 'adminium.config.ts'), 'export default {};\n');
        return Promise.resolve(made);
      }
      if (opts.restore !== undefined) return Promise.resolve(opts.restore(call));
      if (!args.includes('--dry-run')) {
        mkdirSync(join(run.cwd, 'data'), { recursive: true });
        writeFileSync(join(run.cwd, 'data', 'meta.db'), '');
      }
      return Promise.resolve({ code: 0, output: `${JSON.stringify({ ...ANSWER, dryRun: args.includes('--dry-run') })}\n`, timedOut: false });
    },
    log: (line) => {
      logs.push(line);
    },
  };
  return { deps, calls, logs };
}

describe('reading the engine’s answer', () => {
  it('takes the last JSON line of either shape, and calls anything else a failure with its last lines', () => {
    expect(readExportAnswer(`warning: something\n${JSON.stringify(ANSWER)}\n`)).toEqual({ ok: true, answer: ANSWER });
    expect(readExportAnswer('{"ok":false,"refused":"full-archive","message":"This file is a full archive, not an export.","hint":"Restore it with `adminium archive restore <file>`."}')).toEqual({
      ok: false,
      refused: 'full-archive',
      detail: 'This file is a full archive, not an export. Restore it with `adminium archive restore <file>`.',
    });
    expect(readExportAnswer('{"ok":false,"refused":"something-new","message":"No."}')).toMatchObject({ ok: false, refused: 'refused' });
    expect(readExportAnswer('Error: unknown flag --json')).toEqual({ ok: false, refused: 'failed', detail: 'Error: unknown flag --json' });
    // A line that only looks like an answer is not one.
    expect(readExportAnswer('{"ok":true}')).toMatchObject({ ok: false, refused: 'failed' });
  });

  it('proposes the name from the file, without the date the download put on it', () => {
    expect(projectNameFromExport('/Users/sam/Downloads/hollis-bakery-2026-11-10.zip')).toBe('Hollis Bakery');
    expect(projectNameFromExport('C:\\Users\\Sam\\juniper_kitchen.zip')).toBe('Juniper Kitchen');
    expect(projectNameFromExport('/x/2026-11-10.zip')).toBe('Imported Project');
  });
});

describe('what the file holds', () => {
  it('is asked of the engine as a dry run in a scratch folder that is gone afterwards, never with the app’s own key', async () => {
    const { deps, calls } = fakeEngine();
    const scratch = join(home, 'scratch');
    const describeExport = createDescribeExport({ ...deps, scratch: () => (mkdirSync(scratch), scratch) });
    const outcome = await describeExport('/Users/sam/Downloads/shop.zip');
    expect(outcome).toMatchObject({ ok: true, answer: { owners: ANSWER.owners, passwordMinLength: 10 } });
    expect(calls[0]?.args).toEqual(['/app/server/cli.js', 'import-zip', '/Users/sam/Downloads/shop.zip', '--dry-run', '--json', '--data-dir', join(scratch, 'data'), '--project-dir', join(scratch, 'project')]);
    expect(calls[0]?.env.ADMINIUM_SECRET).not.toBe('the-classic-servers-own-secret');
    expect(calls[0]?.env.ADMINIUM_META_URL).toBeUndefined();
    expect(calls[0]?.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(existsSync(scratch)).toBe(false);
  });
});

describe('a new project from the file', () => {
  const root = (): string => join(home, 'Adminium', 'shop');

  it('writes its own key first, restores with the chosen Super Admin, the password on standard input only, then makes the folder a project', async () => {
    const { deps, calls, logs } = fakeEngine();
    const importExport = createImportExport({ ...deps, newSecret: () => 'k'.repeat(64) });
    const steps: string[] = [];
    const made = await importExport({ file: '/Users/sam/Downloads/shop.zip', root: root(), ownerEmail: 'bo@example.com', password: 'a-long-new-password', onStep: (step) => steps.push(step) });
    // The restore, then the download `new` starts: the page shows each, so a long wait is not a silent one.
    expect(steps).toEqual(['files', 'packages']);
    expect(made).toMatchObject({ ok: true, carriedProject: false, answer: { owner: 'bo@example.com' } });

    const [restore, project] = calls;
    // `--local-owner`: the one picked here is this computer's owner; the file never says who that is.
    expect(restore?.args).toEqual(['/app/server/cli.js', 'import-zip', '/Users/sam/Downloads/shop.zip', '--json', '--data-dir', join(root(), 'data'), '--project-dir', root(), '--owner', 'bo@example.com', '--password-stdin', '--local-owner']);
    expect(restore?.cwd).toBe(root());
    // The key was in place before the file was read: a `.env` inside the export cannot land in its place.
    expect(restore?.envFileThen).toContain(`ADMINIUM_SECRET=${'k'.repeat(64)}`);
    expect(restore?.env.ADMINIUM_SECRET).toBe('k'.repeat(64));
    expect(restore?.env.ADMINIUM_META_URL).toBeUndefined();
    expect(restore?.input).toBe('a-long-new-password\n');
    expect(JSON.stringify(calls.map((call) => call.args))).not.toContain('a-long-new-password');
    expect(logs.join('\n')).not.toContain('a-long-new-password');

    // No project folder came with it: the engine's `new` makes one around the data and fetches its packages.
    expect(project?.args).toEqual(['/app/server/cli.js', 'new', '--yes']);
    expect(project?.cwd).toBe(root());
    expect(project?.env.ADMINIUM_SECRET).toBeUndefined();
    expect(existsSync(join(root(), 'adminium.config.ts'))).toBe(true);
  });

  it('runs no `new` over a project folder the file brought, and says it brought one', async () => {
    const { deps, calls } = fakeEngine({
      restore: (call) => {
        writeFileSync(join(call.cwd, 'adminium.config.ts'), 'export default {};\n');
        return { code: 0, output: JSON.stringify({ ...ANSWER, projectFiles: 4 }), timedOut: false };
      },
    });
    const made = await createImportExport(deps)({ file: '/f.zip', root: root(), ownerEmail: 'ava@example.com', password: 'a-long-new-password' });
    expect(made).toMatchObject({ ok: true, carriedProject: true });
    expect(calls).toHaveLength(1);
  });

  it('leaves no folder behind when the engine refuses the file, or `new` fails', async () => {
    const refused = fakeEngine({ restore: () => ({ code: 1, output: '{"ok":false,"refused":"refused","message":"This archive was changed after it was made: adminium-archive/meta/adminium_users.json does not match its manifest."}', timedOut: false }) });
    expect(await createImportExport(refused.deps)({ file: '/f.zip', root: root(), ownerEmail: 'ava@example.com', password: 'a-long-new-password' })).toEqual({
      ok: false,
      refused: 'refused',
      detail: 'This archive was changed after it was made: adminium-archive/meta/adminium_users.json does not match its manifest.',
    });
    expect(existsSync(root())).toBe(false);

    const broken = fakeEngine({ made: { code: 1, output: 'Error: the ADMINIUM_SECRET given does not open…', timedOut: false } });
    expect(await createImportExport(broken.deps)({ file: '/f.zip', root: root(), ownerEmail: 'ava@example.com', password: 'a-long-new-password' })).toMatchObject({ ok: false, refused: 'failed' });
    expect(existsSync(root())).toBe(false);

    // An empty folder the person chose stays, empty again.
    mkdirSync(root(), { recursive: true });
    await createImportExport(refused.deps)({ file: '/f.zip', root: root(), ownerEmail: 'ava@example.com', password: 'a-long-new-password' });
    expect(readdirSync(root())).toEqual([]);
  });

  it('never goes into a folder that holds anything', async () => {
    mkdirSync(root(), { recursive: true });
    writeFileSync(join(root(), 'notes.txt'), 'mine');
    const { deps, calls } = fakeEngine();
    expect(await createImportExport(deps)({ file: '/f.zip', root: root(), ownerEmail: 'ava@example.com', password: 'a-long-new-password' })).toMatchObject({ ok: false, refused: 'failed' });
    expect(calls).toHaveLength(0);
    expect(readdirSync(root())).toEqual(['notes.txt']);
  });
});

describe('Start, with an export', () => {
  let config: DesktopConfig;
  beforeEach(() => {
    config = createDefaultConfig(join(home, 'data'));
  });

  function service(overrides: Partial<StartDeps> = {}) {
    const deps: StartDeps = {
      readConfig: () => config,
      saveConfig: (next) => {
        config = next;
        return Promise.resolve();
      },
      folder: { ...realFolderDeps(join(home, 'the-app'), 'darwin'), home },
      classicUsed: () => false,
      chooseDirectory: () => Promise.resolve(null),
      now: () => new Date('2026-11-11T08:00:00.000Z'),
      onChoice: () => undefined,
      ...overrides,
    };
    return createStartService(deps);
  }

  it('shows a file picked from the menu once, and reads what it holds', async () => {
    const file = join(home, 'Downloads', 'hollis-bakery-2026-11-10.zip');
    mkdirSync(join(home, 'Downloads'));
    writeFileSync(file, 'zip');
    let pending: string | null = file;
    const { deps } = fakeEngine();
    const start = service({
      takePendingExport: () => {
        const taken = pending;
        pending = null;
        return taken;
      },
      describeExport: createDescribeExport(deps),
    });
    expect(start.state().pendingExport).toEqual({ path: file, displayPath: '~/Downloads/hollis-bakery-2026-11-10.zip' });
    expect(start.state().pendingExport).toBeNull();
    const read = await start.readExport({ path: file });
    expect(read).toMatchObject({ status: 'ready', facts: { name: 'Hollis Bakery', people: 3, pages: 2, files: 1, owners: ANSWER.owners, passwordMinLength: 10 } });
    expect(await start.readExport({ path: join(home, 'gone.zip') })).toEqual({ status: 'missing' });
  });

  it('remembers the new project as agreed to when the app made all its code, and asks about code the file brought', async () => {
    const file = join(home, 'shop.zip');
    writeFileSync(file, 'zip');
    const made = fakeEngine();
    const start = service({ importExport: createImportExport(made.deps) });
    const result = await start.importExport({ path: file, parent: join(home, 'Adminium'), name: 'Shop', owner: 'bo@example.com', password: 'a-long-new-password' });
    expect(result).toEqual({ status: 'imported', path: join(home, 'Adminium', 'shop'), owner: 'bo@example.com', connections: 1, drafts: [] });
    expect(config.projects[0]).toMatchObject({ path: join(home, 'Adminium', 'shop'), name: 'Shop', reviewed: false, trusted: projectFingerprint(join(home, 'Adminium', 'shop')) });

    const carried = fakeEngine({
      restore: (call) => {
        writeFileSync(join(call.cwd, 'adminium.config.ts'), 'export default {};\n');
        return { code: 0, output: JSON.stringify(ANSWER), timedOut: false };
      },
    });
    const other = service({ importExport: createImportExport(carried.deps) });
    await other.importExport({ path: file, parent: join(home, 'Adminium'), name: 'Sent To Me', owner: 'ava@example.com', password: 'a-long-new-password' });
    expect(config.projects[0]).toMatchObject({ name: 'Sent To Me', trusted: null });
    // Not agreed to: opening it asks first.
    expect(await other.openProject({ path: join(home, 'Adminium', 'sent-to-me') })).toMatchObject({ status: 'trust-needed' });
  });

  it('judges the folder again and refuses one that is not new, before the engine is asked anything', async () => {
    const file = join(home, 'shop.zip');
    writeFileSync(file, 'zip');
    mkdirSync(join(home, 'Adminium', 'shop'), { recursive: true });
    writeFileSync(join(home, 'Adminium', 'shop', 'a.txt'), 'x');
    const { deps, calls } = fakeEngine();
    const start = service({ importExport: createImportExport(deps) });
    expect(await start.importExport({ path: file, parent: join(home, 'Adminium'), name: 'Shop', owner: 'ava@example.com', password: 'a-long-new-password' })).toEqual({ status: 'folder-refused', refused: 'exists-with-files' });
    expect(calls).toHaveLength(0);
    expect(config.projects).toEqual([]);
  });

  it('remembers nothing when the file is refused', async () => {
    const file = join(home, 'full.zip');
    writeFileSync(file, 'zip');
    const { deps } = fakeEngine({ restore: () => ({ code: 1, output: '{"ok":false,"refused":"full-archive","message":"This file is a full archive, not an export.","hint":"Restore it with `adminium archive restore <file>`."}', timedOut: false }) });
    const start = service({ importExport: createImportExport(deps) });
    expect(await start.importExport({ path: file, parent: join(home, 'Adminium'), name: 'Shop', owner: 'ava@example.com', password: 'a-long-new-password' })).toMatchObject({ status: 'refused', refused: 'full-archive' });
    expect(config.projects).toEqual([]);
    expect(existsSync(join(home, 'Adminium', 'shop'))).toBe(false);
  });
});

// ─── The real engine ─────────────────────────────────────────────────────────

const CLI = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'server', 'dist', 'cli', 'index.js');
const SOURCE_SECRET = 'source-instance-secret-0123456789abcdef';
const PASSWORD = 'a-long-new-password-for-bo';

/** `<prefix>_` and 26 Crockford characters, as `@adminium/meta` makes ids. */
const id = (prefix: string, tail: string): string => `${prefix}_01J${tail.toUpperCase().padEnd(23, '0')}`;

const realEngine = (): OpenExportDeps => {
  const env: Record<string, string | undefined> = { ...process.env };
  // The source instance's key, or a project's, is never the one an import runs with.
  for (const name of ['ADMINIUM_SECRET', 'ADMINIUM_DATA_DIR', 'ADMINIUM_META_URL', 'ADMINIUM_PROJECT_DIR', 'NODE_OPTIONS', 'VITEST', 'VITEST_POOL_ID', 'VITEST_WORKER_ID']) delete env[name];
  return { binary: process.execPath, cliEntry: CLI, programs: () => Promise.resolve(undefined), env, run: runToEnd, install: false };
};

async function cli(args: string[], cwd: string): Promise<RanProgram> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined && !name.startsWith('VITEST')) env[name] = value;
  env.ADMINIUM_SECRET = SOURCE_SECRET;
  delete env.ADMINIUM_META_URL;
  return runToEnd(process.execPath, [CLI, ...args], { cwd, env, timeoutMs: 60_000 });
}

/** An instance with three people (two Super Admins), a page and an uploaded file, and its export and full archive. */
async function sourceInstance(): Promise<{ exportFile: string; fullFile: string; fileId: string; fileBytes: Buffer }> {
  const dataDir = join(home, 'source', 'data');
  mkdirSync(dataDir, { recursive: true });
  const store = await openMetaStore({ dataDir, secret: SOURCE_SECRET });
  await firstRun(store.meta);
  await store.close();
  const db = new Database(join(dataDir, 'meta.db'));
  const at = Date.parse('2026-11-01T09:00:00Z');
  const role = (slug: string): string => (db.prepare('select id from adminium_roles where slug = ?').get(slug) as { id: string }).id;
  const person = db.prepare("insert into adminium_users (id, email, name, status, password_hash, created_at, updated_at) values (?, ?, ?, 'active', ?, ?, ?)");
  const link = db.prepare('insert into adminium_user_roles (user_id, role_id, created_at) values (?, ?, ?)');
  const hash = await argon2.hash('the-old-password', { type: argon2.argon2id });
  for (const [index, [email, name, slug]] of [
    ['ava@example.com', 'Ava', 'super-admin'],
    ['bo@example.com', 'Bo', 'super-admin'],
    ['cy@example.com', 'Cy', 'editor'],
  ].entries()) {
    const user = id('usr', `A${String(index)}`);
    person.run(user, email, name, hash, at + index, at + index);
    link.run(user, role(slug ?? 'editor'), at + index);
  }
  db.prepare("insert into adminium_pages (id, slug, type, title, config, origin, created_at, updated_at) values (?, 'orders', 'dashboard', 'Orders', '{\"v\":1,\"widgets\":[]}', 'user', ?, ?)").run(id('page', 'B1'), at, at);
  const fileId = id('file', 'C1');
  const fileBytes = randomBytes(2048);
  db.prepare("insert into adminium_files (id, storage_key, filename, mime, size_bytes, sha256, kind, created_at) values (?, ?, 'logo.png', 'image/png', ?, ?, 'upload', ?)").run(
    fileId,
    fileId,
    fileBytes.length,
    createHash('sha256').update(fileBytes).digest('hex'),
    at,
  );
  db.close();
  mkdirSync(join(dataDir, 'files'), { recursive: true });
  writeFileSync(join(dataDir, 'files', fileId), fileBytes);

  const exportFile = join(home, 'Downloads', 'hollis-bakery-2026-11-10.zip');
  const fullFile = join(home, 'Downloads', 'whole-server.zip');
  mkdirSync(join(home, 'Downloads'), { recursive: true });
  for (const [file, extra] of [
    [exportFile, ['--export']],
    [fullFile, []],
  ] as const) {
    const made = await cli(['archive', 'create', file, ...extra, '--data-dir', dataDir], join(home, 'source'));
    expect(made.code, made.output).toBe(0);
  }
  return { exportFile, fullFile, fileId, fileBytes };
}

describe('the real engine, on a real export', () => {
  it('makes a new project with the people, pages and files, and the chosen Super Admin signs in with the password set here', { timeout: 180_000 }, async () => {
    expect(existsSync(CLI), `build the server first: ${CLI}`).toBe(true);
    const source = await sourceInstance();
    const engine = realEngine();

    const read = await createDescribeExport(engine)(source.exportFile);
    expect(read.ok, JSON.stringify(read)).toBe(true);
    if (!read.ok) return;
    expect(read.answer.owners.map((owner) => owner.email)).toEqual(['ava@example.com', 'bo@example.com']);
    expect(read.answer).toMatchObject({ people: 3, pages: 1, files: 1 });

    const root = join(home, 'Adminium', 'hollis-bakery');
    const made = await createImportExport(engine)({ file: source.exportFile, root, ownerEmail: 'bo@example.com', password: PASSWORD });
    expect(made.ok, JSON.stringify(made)).toBe(true);
    // A project folder, made around the data, with its own key.
    expect(existsSync(join(root, 'adminium.config.ts'))).toBe(true);
    expect(readFileSync(join(root, '.env'), 'utf8')).toMatch(/^ADMINIUM_SECRET=[0-9a-f]{64}$/m);

    const db = new Database(join(root, 'data', 'meta.db'), { readonly: true });
    try {
      const people = db.prepare('select email, password_hash as hash from adminium_users order by email').all() as { email: string; hash: string | null }[];
      expect(people.map((person) => person.email)).toEqual(['ava@example.com', 'bo@example.com', 'cy@example.com']);
      const bo = people.find((person) => person.email === 'bo@example.com');
      expect(await argon2.verify(bo?.hash ?? '', PASSWORD)).toBe(true);
      // Nobody else's password came, the old one least of all.
      expect(people.filter((person) => person.email !== 'bo@example.com').map((person) => person.hash)).toEqual([null, null]);
      expect(await argon2.verify(bo?.hash ?? '', 'the-old-password')).toBe(false);
      expect((db.prepare("select title from adminium_pages where slug = 'orders'").get() as { title: string } | undefined)?.title).toBe('Orders');
    } finally {
      db.close();
    }
    expect(readFileSync(join(root, 'data', 'files', source.fileId))).toEqual(source.fileBytes);
  });

  it('refuses a full signed archive, and an export changed after it was made, with nothing made', { timeout: 180_000 }, async () => {
    const source = await sourceInstance();
    const engine = realEngine();

    const full = await createDescribeExport(engine)(source.fullFile);
    expect(full).toMatchObject({ ok: false, refused: 'full-archive' });
    if (!full.ok) expect(full.detail).toContain('adminium archive restore');
    const root = join(home, 'Adminium', 'whole');
    expect(await createImportExport(engine)({ file: source.fullFile, root, ownerEmail: 'ava@example.com', password: PASSWORD })).toMatchObject({ ok: false, refused: 'full-archive' });
    expect(existsSync(root)).toBe(false);

    // One person's row changed inside the file: its digest no longer matches the manifest.
    const members = unzipSync(readFileSync(source.exportFile));
    const users = Buffer.from(members['adminium-archive/meta/adminium_users.json'] as Uint8Array).toString('utf8');
    members['adminium-archive/meta/adminium_users.json'] = strToU8(users.replace('cy@example.com', 'cy@evil.example'));
    const tampered = join(home, 'Downloads', 'tampered.zip');
    writeFileSync(tampered, zipSync(members as Zippable));
    expect(await createDescribeExport(engine)(tampered)).toMatchObject({ ok: false, refused: 'refused' });
    const into = join(home, 'Adminium', 'tampered');
    const refused = await createImportExport(engine)({ file: tampered, root: into, ownerEmail: 'ava@example.com', password: PASSWORD });
    expect(refused).toMatchObject({ ok: false, refused: 'refused' });
    if (!refused.ok) expect(refused.detail).toContain('does not match its manifest');
    expect(existsSync(into)).toBe(false);

    // Not an archive at all.
    const plain = join(home, 'Downloads', 'notes.zip');
    writeFileSync(plain, zipSync({ 'notes.txt': strToU8('hello') }));
    expect(await createDescribeExport(engine)(plain)).toMatchObject({ ok: false, refused: 'not-an-export' });
  });
});

// ─── A project folder that travels in the export ─────────────────────────────

const freePort = async (): Promise<number> =>
  new Promise((done) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });

/**
 * A project's config reads its `.env` through `process.env` (the terminal's start loads it there), so a
 * server started in this process is given `process.env` itself, cleared of what a start leaves in it.
 */
type Conn = { name: string; status: string; dsnMasked: string | null };
const PROJECT_NAMES = ['ADMINIUM_SECRET', 'ADMINIUM_RUNTIME', 'DATABASE_URL', 'SHOP_API_KEY'];
async function boot(root: string, opts: Omit<Parameters<typeof startProject>[0], 'root' | 'env'>): Promise<StartedProject> {
  for (const name of PROJECT_NAMES) delete process.env[name];
  return startProject({ root, env: process.env, ...opts });
}
afterEach(() => {
  for (const name of PROJECT_NAMES) delete process.env[name];
});

describe('the real engine, on an export of a desktop project with its own folder', () => {
  let live: StartedProject | null = null;
  afterEach(async () => {
    await live?.close();
    live = null;
  });

  it('opens: its .env is written as `new` writes one, the picked Super Admin is this computer’s owner, and it boots and serves its pages', { timeout: 300_000 }, async () => {
    // A project as the app makes one: a config reading DATABASE_URL, its own SQLite data, a key in .env.
    const source = join(home, 'shop');
    mkdirSync(join(source, 'data'), { recursive: true });
    writeFileSync(join(source, 'adminium.config.mjs'), 'export default { databases: { main: { url: process.env.DATABASE_URL } } };\n');
    writeFileSync(join(source, 'package.json'), '{"name":"shop","private":true,"type":"module"}\n');
    writeFileSync(join(source, '.env'), `ADMINIUM_SECRET=${SOURCE_SECRET}\nDATABASE_URL=sqlite:./data/app.sqlite\nSHOP_API_KEY=the-real-key\n`);
    writeFileSync(join(source, '.env.example'), 'DATABASE_URL=\nSHOP_API_KEY=example\n');
    const shop = new Database(join(source, 'data', 'app.sqlite'));
    shop.exec("create table orders (id integer primary key, customer text not null); insert into orders (customer) values ('Ana'), ('Ben');");
    shop.close();
    // Built here first: the app's owner is made, the database connected and its pages written.
    live = await boot(source, { port: await freePort(), mode: 'design' });
    await live.close();
    live = null;
    const meta = new Database(join(source, 'data', 'meta.db'));
    const original = (meta.prepare("select json_extract(value, '$') as id from adminium_settings where key = 'designer.localOwnerId'").get() as { id: string }).id;
    expect(original).toMatch(/^usr_/);
    // A second Super Admin, the one who will be picked on the other computer.
    const superAdmin = (meta.prepare("select id from adminium_roles where slug = 'super-admin'").get() as { id: string }).id;
    const bo = id('usr', 'D1');
    meta.prepare("insert into adminium_users (id, email, name, status, created_at, updated_at) values (?, 'bo@example.com', 'Bo', 'active', 2, 2)").run(bo);
    meta.prepare('insert into adminium_user_roles (user_id, role_id, created_at) values (?, ?, 2)').run(bo, superAdmin);
    // Its own database came in as a connection, with pages made for it.
    expect((meta.prepare("select count(*) as n from adminium_connections where project_key = 'main'").get() as { n: number }).n).toBe(1);
    meta.close();

    const exported = join(home, 'Downloads', 'shop.zip');
    mkdirSync(join(home, 'Downloads'), { recursive: true });
    const made = await cli(['archive', 'create', exported, '--export'], source);
    expect(made.code, made.output).toBe(0);
    const members = unzipSync(readFileSync(exported));
    const settings = Buffer.from(members['adminium-archive/meta/adminium_settings.json'] as Uint8Array).toString('utf8');
    // The file never says who is signed in without a password, and carries no .env.
    expect(settings).not.toContain('designer.ownerId');
    expect(settings).not.toContain('designer.localOwnerId');
    expect(Object.keys(members)).toContain('adminium-archive/project/adminium.config.mjs');
    expect(Object.keys(members).some((name) => name.endsWith('/.env'))).toBe(false);

    const root = join(home, 'Adminium', 'shop-copy');
    const opened = await createImportExport(realEngine())({ file: exported, root, ownerEmail: 'bo@example.com', password: PASSWORD });
    expect(opened.ok, JSON.stringify(opened)).toBe(true);
    if (!opened.ok) return;
    expect(opened.carriedProject).toBe(true);
    const env = readFileSync(join(root, '.env'), 'utf8');
    expect(env).toMatch(/^ADMINIUM_SECRET=[0-9a-f]{64}$/m);
    expect(env).toMatch(/^DATABASE_URL=sqlite:\.\/data\/databases\/[a-z0-9_-]+\.sqlite$/m);
    expect(env).toMatch(/^SHOP_API_KEY=$/m);
    expect(env).not.toContain('the-real-key');
    expect(env).not.toContain(SOURCE_SECRET);

    // The picked Super Admin is this computer's owner, the one the app signs in without a password; the original is not.
    const restored = new Database(join(root, 'data', 'meta.db'), { readonly: true });
    const ownerSetting = (key: string): unknown => (restored.prepare("select json_extract(value, '$') as v from adminium_settings where key = ?").get(key) as { v: unknown } | undefined)?.v ?? null;
    expect(ownerSetting('designer.ownerId')).toBe(bo);
    expect(ownerSetting('designer.localOwnerId')).toBeNull();
    restored.close();

    // It boots, as a terminal starts it (its own process: the engine that restored it), and serves its pages.
    const port = await freePort();
    const childEnv: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) if (value !== undefined && !name.startsWith('VITEST') && !PROJECT_NAMES.includes(name)) childEnv[name] = value;
    const server = spawn(process.execPath, [CLI, 'start', '--port', String(port)], { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let said = '';
    server.stdout.on('data', (chunk: Buffer) => (said += chunk.toString('utf8')));
    server.stderr.on('data', (chunk: Buffer) => (said += chunk.toString('utf8')));
    try {
      const url = `http://127.0.0.1:${String(port)}`;
      const deadline = Date.now() + 120_000;
      let up = false;
      while (!up && Date.now() < deadline && server.exitCode === null) {
        up = await fetch(`${url}/api/v1/healthz`).then(
          (res) => res.ok,
          () => false,
        );
        if (!up) await new Promise((wait) => setTimeout(wait, 500));
      }
      expect(up, said).toBe(true);
      // Bo signs in with the password set in the app.
      const login = await fetch(`${url}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify({ email: 'bo@example.com', password: PASSWORD }) });
      expect(login.status, said).toBe(200);
      const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
      const pages = await fetch(`${url}/api/v1/pages`, { headers: { cookie } });
      expect(pages.status).toBe(200);
      expect(JSON.stringify(await pages.json())).toContain('orders');
      // The project's own database is the SQLite file that came in the export, connected.
      const listed = (await (await fetch(`${url}/api/v1/connections`, { headers: { cookie } })).json()) as { connections?: Conn[]; data?: { connections: Conn[] } };
      const main = (listed.data?.connections ?? listed.connections ?? []).find((connection) => connection.name === 'main');
      expect(main).toMatchObject({ status: 'connected' });
      expect(main?.dsnMasked).toContain(join(root, 'data', 'databases'));
    } finally {
      server.kill('SIGTERM');
      await new Promise((done) => (server.exitCode === null ? server.once('exit', done) : done(undefined)));
    }
  });
});
