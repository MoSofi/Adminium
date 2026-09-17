// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A project folder for `project.spec.ts` (49-T28), run the way a developer
 * runs one.
 *
 * - **The folder** is made by the BUILT CLI, `adminium new --database`, in a
 *   temp folder. `--no-install` skips npm: the project's one dependency the
 *   commands need, esbuild, is linked in from this package's own.
 * - **The databases** follow the leg's engine: Northwind as the project's
 *   `main` database, and on Postgres and MySQL the project's meta store too,
 *   each in a database of its own. On SQLite the meta store is the project's
 *   `data/` folder, as `new` leaves it.
 * - **The server** is `adminium dev`, then `adminium start`, started and
 *   stopped by the spec. Neither is a Playwright `webServer`: a redeploy is a
 *   restart the spec has to control.
 *
 * `NODE_ENV` is kept out of the children. The image runs in production, where
 * a source database on 127.0.0.1 is refused; a developer's `npm run dev` is not
 * production, and this is that.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENGINE, PORT, TEST_MYSQL_URL, TEST_POSTGRES_URL } from './constants.js';

const require = createRequire(import.meta.url);

/** The slices of `better-sqlite3` and `pg` used here; neither package ships its types. */
type SqliteDatabase = new (file: string) => { exec(sql: string): void; close(): void };
interface PgClient {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}
type PgModule = { Client: new (options: { connectionString: string }) => PgClient };

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(repoRoot, 'apps', 'server', 'dist', 'cli', 'index.js');
const DASHBOARD = join(repoRoot, 'apps', 'dashboard', 'dist');

/** Clear of the engine ports (+0), the first-run server (+20) and the SMTP sink (+100, +101). */
export const PROJECT_PORT = PORT + 40;
export const PROJECT_URL = `http://127.0.0.1:${String(PROJECT_PORT)}`;

/** The project's owner, created through the first-run route. */
export const PROJECT_OWNER = {
  email: 'owner@project.local',
  name: 'Project Owner',
  password: 'adminium-project-password',
};

/** The one origin the project's public API accepts. */
export const PUBLIC_ORIGIN = 'http://shop.project.test';

const SOURCE_DATABASE = 'adminium_e2e_project';
const META_DATABASE = 'adminium_e2e_project_meta';

/** The owner's session, per engine (see `storageStatePath` in constants.ts for why). */
export function projectStatePath(): string {
  return fileURLToPath(new URL(`../.playwright/auth/state-project-${ENGINE}.json`, import.meta.url));
}

const fixture = (adapter: string, file: string): string =>
  readFileSync(join(repoRoot, 'packages', adapter, 'fixtures', file), 'utf8');

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Northwind in a database of its own, and an empty meta store beside it. */
async function createDatabases(work: string): Promise<{ sourceUrl: string; metaUrl: string | null }> {
  if (ENGINE === 'sqlite') {
    const file = join(work, 'northwind.sqlite');
    const Database = require('better-sqlite3') as SqliteDatabase;
    const db = new Database(file);
    try {
      db.exec(fixture('adapter-sqlite', 'northwind.sqlite.sql'));
    } finally {
      db.close();
    }
    return { sourceUrl: `sqlite:${file}`, metaUrl: null };
  }
  if (ENGINE === 'postgres') {
    const pg = require('pg') as PgModule;
    const admin = new pg.Client({ connectionString: TEST_POSTGRES_URL });
    await admin.connect();
    try {
      for (const name of [SOURCE_DATABASE, META_DATABASE]) {
        await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await admin.query(`CREATE DATABASE ${name}`);
      }
    } finally {
      await admin.end();
    }
    const sourceUrl = databaseUrl(TEST_POSTGRES_URL, SOURCE_DATABASE);
    const seed = new pg.Client({ connectionString: sourceUrl });
    await seed.connect();
    try {
      await seed.query(fixture('adapter-postgres', 'northwind.sql'));
    } finally {
      await seed.end();
    }
    return { sourceUrl, metaUrl: databaseUrl(TEST_POSTGRES_URL, META_DATABASE) };
  }
  const mysql = await import('mysql2/promise');
  const admin = await mysql.createConnection({ uri: TEST_MYSQL_URL, multipleStatements: true });
  try {
    for (const name of [SOURCE_DATABASE, META_DATABASE]) {
      await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await admin.query(`CREATE DATABASE \`${name}\``);
    }
  } finally {
    await admin.end();
  }
  const sourceUrl = databaseUrl(TEST_MYSQL_URL, SOURCE_DATABASE);
  const seed = await mysql.createConnection({ uri: sourceUrl, multipleStatements: true });
  try {
    await seed.query(fixture('adapter-mysql', 'northwind.mysql.sql'));
  } finally {
    await seed.end();
  }
  return { sourceUrl, metaUrl: databaseUrl(TEST_MYSQL_URL, META_DATABASE) };
}

async function dropDatabases(): Promise<void> {
  if (ENGINE === 'postgres') {
    const pg = require('pg') as PgModule;
    const admin = new pg.Client({ connectionString: TEST_POSTGRES_URL });
    await admin.connect();
    try {
      for (const name of [SOURCE_DATABASE, META_DATABASE]) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  } else if (ENGINE === 'mysql') {
    const mysql = await import('mysql2/promise');
    const admin = await mysql.createConnection({ uri: TEST_MYSQL_URL });
    try {
      for (const name of [SOURCE_DATABASE, META_DATABASE]) await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
    } finally {
      await admin.end();
    }
  }
}

/** The environment a developer's shell would give the CLI: nothing of Adminium's, and not production. */
function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith('ADMINIUM_') || key === 'NODE_ENV') continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });
}

/** `adminium dev` or `adminium start`, in its own process group so a stop reaches the server under `dev`. */
class ServerProcess {
  private text = '';
  readonly exited: Promise<number | null>;
  private readonly child: ChildProcess;

  constructor(args: string[], cwd: string) {
    this.child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv({ ADMINIUM_STATIC_ROOT: DASHBOARD, ADMINIUM_PUBLIC_API_ORIGINS: PUBLIC_ORIGIN }),
    });
    this.child.stdout?.on('data', (chunk: Buffer) => (this.text += chunk.toString('utf8')));
    this.child.stderr?.on('data', (chunk: Buffer) => (this.text += chunk.toString('utf8')));
    this.exited = new Promise((resolve) => this.child.once('exit', (code) => resolve(code)));
  }

  output(): string {
    return this.text;
  }

  async stop(signal: NodeJS.Signals): Promise<void> {
    const pid = this.child.pid;
    if (pid === undefined || this.child.exitCode !== null || this.child.signalCode !== null) return;
    try {
      process.kill(-pid, signal);
    } catch {
      return;
    }
    const done = await Promise.race([this.exited.then(() => true), sleep(20_000).then(() => false)]);
    if (!done) {
      process.kill(-pid, 'SIGKILL');
      await this.exited;
    }
  }
}

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export class ProjectHarness {
  /** The server running now, if any. */
  private server: ServerProcess | null = null;

  private constructor(
    /** The temp folder the project sits in. */
    readonly work: string,
    /** The project folder. */
    readonly root: string,
    readonly sourceUrl: string,
  ) {}

  /** `adminium new` on a fresh Northwind, with the project's code written in. */
  static async create(files: Record<string, string>): Promise<ProjectHarness> {
    if (!existsSync(CLI)) throw new Error(`${CLI} is missing — build the server first`);
    if (!(await portIsFree(PROJECT_PORT))) throw new Error(`port ${String(PROJECT_PORT)} is taken`);
    // The real path: on macOS the temp folder is a link, and the server names the project by where it is.
    const work = realpathSync(mkdtempSync(join(tmpdir(), 'adminium-e2e-project-')));
    const { sourceUrl, metaUrl } = await createDatabases(work);
    const project = new ProjectHarness(work, join(work, 'demo'), sourceUrl);
    const made = project.runIn(work, ['new', 'demo', '--database', sourceUrl, '--yes', '--no-install', '--no-git']);
    if (made.status !== 0) throw new Error(`adminium new exited ${String(made.status)}:\n${made.stdout}${made.stderr}`);

    // The project's own esbuild, as `npm install` would have put it there.
    mkdirSync(join(project.root, 'node_modules'), { recursive: true });
    symlinkSync(dirname(require.resolve('esbuild/package.json')), join(project.root, 'node_modules', 'esbuild'), 'dir');
    if (metaUrl !== null) appendFileSync(join(project.root, '.env'), `\nADMINIUM_META_URL=${metaUrl}\n`);
    for (const [path, text] of Object.entries(files)) project.write(path, text);
    return project;
  }

  private runIn(cwd: string, args: string[], env: Record<string, string> = {}): CliResult {
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd, env: childEnv(env), encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  /** A CLI command in the project folder, run to the end. */
  cli(args: string[], env: Record<string, string> = {}): CliResult {
    return this.runIn(this.root, args, env);
  }

  path(file: string): string {
    return join(this.root, ...file.split('/'));
  }

  exists(file: string): boolean {
    return existsSync(this.path(file));
  }

  read(file: string): string {
    return readFileSync(this.path(file), 'utf8');
  }

  write(file: string, text: string): void {
    mkdirSync(dirname(this.path(file)), { recursive: true });
    writeFileSync(this.path(file), text);
  }

  readJson<T = Record<string, unknown>>(file: string): T {
    return JSON.parse(this.read(file)) as T;
  }

  /** Change a JSON file the way an editor saves it. */
  editJson(file: string, edit: (doc: Record<string, unknown>) => void): void {
    const doc = this.readJson(file);
    edit(doc);
    this.write(file, `${JSON.stringify(doc, null, 2)}\n`);
  }

  output(): string {
    return this.server?.output() ?? '';
  }

  /** How many times the current process has booted the server. */
  boots(): number {
    return (this.output().match(/^Project: /gm) ?? []).length;
  }

  private async waitForHealth(timeoutMs = 120_000): Promise<void> {
    for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await sleep(250)) {
      try {
        const response = await fetch(`${PROJECT_URL}/api/v1/healthz`);
        if (response.ok) return;
      } catch {
        // not listening yet
      }
    }
    throw new Error(`nothing healthy on ${PROJECT_URL}:\n${this.output()}`);
  }

  /** `adminium dev`, ready once it serves and has written the database's page files. */
  async dev(): Promise<void> {
    await this.stop();
    this.server = new ServerProcess(['dev', '--port', String(PROJECT_PORT), '--host', '127.0.0.1'], this.root);
    await this.waitForHealth();
    for (const deadline = Date.now() + 60_000; ; await sleep(250)) {
      if (this.exists('pages/customers.json') && this.exists('schema/main.json')) break;
      if (Date.now() > deadline) throw new Error(`dev wrote no page files:\n${this.output()}`);
    }
  }

  /** `adminium start`: the project deployed as a server. A second call is a redeploy. */
  async serve(): Promise<void> {
    await this.stop();
    this.server = new ServerProcess(['start', '--port', String(PROJECT_PORT), '--host', '127.0.0.1'], this.root);
    await this.waitForHealth();
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server === null) return;
    await server.stop(server.output().includes('in development') ? 'SIGINT' : 'SIGTERM');
    for (const deadline = Date.now() + 20_000; !(await portIsFree(PROJECT_PORT)); await sleep(250)) {
      if (Date.now() > deadline) throw new Error(`port ${String(PROJECT_PORT)} is still taken after the server stopped`);
    }
  }

  /** Stop, drop the databases, and remove the folder (kept when `E2E_KEEP_PROJECT` is set). */
  async close(): Promise<void> {
    await this.stop().catch(() => undefined);
    if (process.env['E2E_KEEP_PROJECT'] !== undefined) {
      console.log(`[project] kept ${this.root}`);
      return;
    }
    await dropDatabases().catch(() => undefined);
    rmSync(this.work, { recursive: true, force: true });
  }
}
