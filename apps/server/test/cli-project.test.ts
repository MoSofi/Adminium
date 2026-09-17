// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The project commands through the CLI: `new`, bare `adminium`, `build`,
 * `check`, `start` inside a project, and `try` refusing to run in one.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { createSqliteMetaDb, firstRun } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { openRuntime, type CliRuntime, type RunProcess } from '../src/cli/runtime.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { readDotEnv } from '../src/project/dotenv.js';
import { APP_VERSION } from '../src/version.js';
import { fakeDeps, fakeIo, fakeRuntime, TEST_SECRET } from './cli-helpers.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adminium-cli-project-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Records every program `new` would run, and answers as told. */
function recorder(status: (command: string, args: readonly string[]) => number = () => 0) {
  const calls: string[] = [];
  const run: RunProcess = (command, args) => {
    calls.push(`${command} ${args.join(' ')}`);
    return { status: status(command, args), stdout: command === 'git' && args[0] === 'rev-parse' ? 'false\n' : '' };
  };
  return { calls, run };
}

function depsIn(cwd: string, env: Record<string, string | undefined> = {}, run: RunProcess = recorder().run) {
  const deps = fakeDeps({ cwd, env });
  deps.runProcess = run;
  return deps;
}

describe('adminium new <name>', () => {
  it('creates the folder with a secret, installs, and says what to run next', async () => {
    const io = fakeIo({ interactive: false });
    const { calls, run } = recorder();
    const code = await runCli(['new', 'shop-admin', '--yes'], { io, deps: depsIn(dir, {}, run) });
    expect(code).toBe(0);

    const root = join(dir, 'shop-admin');
    for (const file of ['package.json', 'adminium.config.ts', '.gitignore', 'Dockerfile', '.env']) {
      expect(existsSync(join(root, file)), file).toBe(true);
    }
    const env = readDotEnv(root);
    expect(env?.ADMINIUM_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(env?.DATABASE_URL).toBe('');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@adminiumjs/adminium']).toBe(APP_VERSION);
    expect(readFileSync(join(root, 'Dockerfile'), 'utf8')).toContain(`adminium:${APP_VERSION}`);

    expect(calls).toContain('npm install');
    expect(calls).toContain('git init --quiet');
    expect(io.stdout()).toContain('cd shop-admin');
    expect(io.stdout()).toContain('npm run dev');
    expect(io.stdout()).toContain('set DATABASE_URL in .env');
  });

  it('writes a database URL it was given, after checking it', async () => {
    const io = fakeIo({ interactive: false });
    await runCli(['new', 'a', '--database', 'postgres://u:p@localhost:5432/shop', '--no-install', '--no-git'], {
      io,
      deps: depsIn(dir),
    });
    expect(readDotEnv(join(dir, 'a'))?.DATABASE_URL).toBe('postgres://u:p@localhost:5432/shop');

    const bad = fakeIo({ interactive: false });
    await expect(runCli(['new', 'b', '--database', 'mongodb://x'], { io: bad, deps: depsIn(dir) })).resolves.toBe(1);
    expect(bad.stderr()).toContain('--database');
    expect(existsSync(join(dir, 'b'))).toBe(false);
  });

  it('creates the sample database and points DATABASE_URL at it', async () => {
    const io = fakeIo({ interactive: false });
    await runCli(['new', 'demo', '--sample', '--no-install', '--no-git'], { io, deps: depsIn(dir) });
    const root = join(dir, 'demo');
    expect(existsSync(join(root, 'data', 'sample.sqlite'))).toBe(true);
    expect(readDotEnv(root)?.DATABASE_URL).toBe('sqlite:./data/sample.sqlite');
    expect(io.stdout()).toContain('Created the sample database');
  });

  it('asks which database when it can, and uses the answer', async () => {
    const io = fakeIo({ interactive: true, selections: ['My own database'], answers: ['sqlite:./mine.db'] });
    await runCli(['new', 'asked', '--no-install', '--no-git'], { io, deps: depsIn(dir) });
    expect(readDotEnv(join(dir, 'asked'))?.DATABASE_URL).toBe('sqlite:./mine.db');
  });

  it('refuses a folder that already has things in it, and a bad name', async () => {
    mkdirSync(join(dir, 'taken'));
    writeFileSync(join(dir, 'taken', 'notes.txt'), 'mine');
    const io = fakeIo({ interactive: false });
    await expect(runCli(['new', 'taken'], { io, deps: depsIn(dir) })).resolves.toBe(1);
    expect(io.stderr()).toContain('already exists and is not empty');

    const named = fakeIo({ interactive: false });
    await expect(runCli(['new', 'Bad Name'], { io: named, deps: depsIn(dir) })).resolves.toBe(1);
    expect(named.stderr()).toContain('cannot be a project name');
  });

  it('reports a failed install and exits non-zero, with the files in place', async () => {
    const io = fakeIo({ interactive: false });
    const { run } = recorder((command) => (command === 'npm' ? 1 : 0));
    await expect(runCli(['new', 'x', '--yes', '--no-git'], { io, deps: depsIn(dir, {}, run) })).resolves.toBe(1);
    expect(io.stderr()).toContain('`npm install` failed');
    expect(existsSync(join(dir, 'x', 'adminium.config.ts'))).toBe(true);
    expect(io.stdout()).toContain('npm install');
  });

  it('uses the package manager that ran it', async () => {
    const io = fakeIo({ interactive: false });
    const { calls, run } = recorder();
    await runCli(['new', 'p', '--yes', '--no-git'], {
      io,
      deps: depsIn(dir, { npm_config_user_agent: 'pnpm/10.28.1 npm/? node/v22.23.2' }, run),
    });
    expect(calls).toContain('pnpm install');
    expect(io.stdout()).toContain('pnpm run dev');
  });

  it('installs Adminium from a tarball path when told to', async () => {
    const io = fakeIo({ interactive: false });
    await runCli(['new', 't', '--yes', '--no-install', '--no-git', '--adminium', './adminiumjs-adminium-9.9.9.tgz'], {
      io,
      deps: depsIn(dir),
    });
    const pkg = JSON.parse(readFileSync(join(dir, 't', 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@adminiumjs/adminium']).toBe(`file:${join(dir, 'adminiumjs-adminium-9.9.9.tgz')}`);
  });
});

describe('adminium new, in the current folder', () => {
  it('adds a project to an existing app without changing its files', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', scripts: { dev: 'vite' } }, null, 2));
    writeFileSync(join(dir, '.env'), 'VITE_KEY=abc\n');
    const io = fakeIo({ interactive: false });
    await expect(runCli(['new', '--yes', '--no-install', '--no-git'], { io, deps: depsIn(dir) })).resolves.toBe(0);

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.dev).toBe('vite');
    expect(pkg.scripts['adminium:dev']).toBe('adminium dev');
    const env = readDotEnv(dir);
    expect(env?.VITE_KEY).toBe('abc');
    expect(env?.ADMINIUM_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(io.stdout()).toContain('This folder is now an Adminium project.');
    expect(io.stdout()).toContain('npm run adminium:dev');
    expect(io.stdout()).not.toContain('  cd ');
  });

  it('asks before touching a folder with things in it, and needs --yes without a terminal', async () => {
    writeFileSync(join(dir, 'notes.txt'), 'mine');
    const quiet = fakeIo({ interactive: false });
    await expect(runCli(['new', '--no-install'], { io: quiet, deps: depsIn(dir) })).resolves.toBe(1);
    expect(quiet.stderr()).toContain('Pass --yes');
    expect(existsSync(join(dir, 'adminium.config.ts'))).toBe(false);

    const declined = fakeIo({ interactive: true, answers: ['n'] });
    await expect(runCli(['new', '--no-install'], { io: declined, deps: depsIn(dir) })).resolves.toBe(1);
    expect(existsSync(join(dir, 'adminium.config.ts'))).toBe(false);
  });

  it('refuses the home folder, and a folder that already is a project', async () => {
    const home = fakeIo({ interactive: false });
    await expect(runCli(['new', '--yes'], { io: home, deps: depsIn(homedir()) })).resolves.toBe(1);
    expect(home.stderr()).toContain('home folder cannot be a project');

    writeFileSync(join(dir, 'adminium.config.ts'), '');
    const again = fakeIo({ interactive: false });
    await expect(runCli(['new', '--yes'], { io: again, deps: depsIn(dir) })).resolves.toBe(1);
    expect(again.stderr()).toContain('already an Adminium project');
  });

  it('never mints a new secret over an existing instance', async () => {
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data', 'meta.db'), '');

    const refused = fakeIo({ interactive: false });
    await expect(runCli(['new', '--yes', '--no-install'], { io: refused, deps: depsIn(dir) })).resolves.toBe(1);
    expect(refused.stderr()).toContain('holds an Adminium instance');
    expect(existsSync(join(dir, '.env'))).toBe(false);

    const io = fakeIo({ interactive: false });
    // The instance is adopted, which opens its (empty) store for real.
    const deps = depsIn(dir, { ADMINIUM_SECRET: TEST_SECRET });
    deps.openRuntime = vi.fn(openRuntime);
    await expect(runCli(['new', '--yes', '--no-install', '--no-git'], { io, deps })).resolves.toBe(0);
    expect(readDotEnv(dir)?.ADMINIUM_SECRET).toBe(TEST_SECRET);
    expect(io.stdout()).toContain('Wrote 0 page and schema file(s) from the instance.');
  });
});

describe('bare `adminium`', () => {
  it('asks for a folder name and creates the project', async () => {
    const io = fakeIo({ interactive: true, answers: ['from-home'], selections: ['Decide later'] });
    await expect(runCli(['--no-install', '--no-git'], { io, deps: depsIn(dir) })).resolves.toBe(0);
    expect(io.questions()[0]).toBe('Project folder');
    expect(existsSync(join(dir, 'from-home', 'adminium.config.ts'))).toBe(true);
  });

  it("inside a project, lists that project's commands", async () => {
    writeFileSync(join(dir, 'adminium.config.ts'), '');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite', 'adminium:dev': 'adminium dev', start: 'adminium start' } }));
    mkdirSync(join(dir, 'src'));
    const io = fakeIo({ interactive: true });
    await expect(runCli([], { io, deps: depsIn(join(dir, 'src')) })).resolves.toBe(0);
    expect(io.stdout()).toContain('This is an Adminium project (..)');
    expect(io.stdout()).toContain('npm run adminium:dev');
    expect(io.stdout()).toContain('npm start');
    expect(io.stdout()).toContain('npx @adminiumjs/adminium build');
    expect(io.questions()).toEqual([]);
  });
});

/** A project with a plain JavaScript config, which needs no esbuild. */
function jsProject(config = "export default { databases: { main: { url: 'sqlite:./shop.db' } } };\n") {
  writeFileSync(join(dir, 'adminium.config.mjs'), config);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { '@adminiumjs/adminium': '0.2.10' } }));
}

describe('adminium build and check', () => {
  it('build explains that it needs esbuild', async () => {
    jsProject();
    const io = fakeIo();
    await expect(runCli(['build'], { io, deps: depsIn(dir) })).resolves.toBe(1);
    expect(io.stderr()).toContain('needs esbuild');
  });

  it('build and check refuse to run outside a project', async () => {
    for (const command of ['build', 'check']) {
      const io = fakeIo();
      await expect(runCli([command], { io, deps: depsIn(dir) })).resolves.toBe(1);
      expect(io.stderr()).toContain('this folder is not in one');
    }
  });

  it('check passes a sound project, and only warns about what start will need', async () => {
    jsProject();
    writeFileSync(join(dir, 'Dockerfile'), 'FROM node:22-slim AS build\nFROM ghcr.io/mosofi/adminium:0.2.10\n');
    const io = fakeIo();
    await expect(runCli(['check'], { io, deps: depsIn(dir) })).resolves.toBe(0);
    expect(io.stdout()).toContain('✓ adminium.config.mjs is valid');
    expect(io.stdout()).toContain('✓ database "main" has a usable URL');
    expect(io.stdout()).toContain('the Dockerfile builds on @adminiumjs/adminium 0.2.10');
    expect(io.stderr()).toContain('! ADMINIUM_SECRET is not set');
  });

  it('check fails on a Dockerfile that builds on another version, and on a bad URL', async () => {
    jsProject("export default { databases: { main: { url: 'oracle://nope' } } };\n");
    writeFileSync(join(dir, 'Dockerfile'), 'FROM ghcr.io/mosofi/adminium:0.2.9\n');
    const io = fakeIo();
    await expect(runCli(['check'], { io, deps: depsIn(dir) })).resolves.toBe(2);
    expect(io.stderr()).toContain('✗ the Dockerfile builds on ghcr.io/mosofi/adminium:0.2.9, but package.json installs 0.2.10');
    expect(io.stderr()).toContain('✗ database "main"');
  });

  it('check names .env as the source of a setting that is not valid', async () => {
    jsProject();
    writeFileSync(join(dir, '.env'), 'PORT=eighty\n');
    const io = fakeIo();
    await expect(runCli(['check'], { io, deps: depsIn(dir) })).resolves.toBe(2);
    expect(io.stderr()).toContain('✗ Invalid environment configuration.');
    expect(io.stderr()).toContain('PORT came from .env.');
  });

  it('check warns about a database with no URL, and a Dockerfile it cannot compare', async () => {
    jsProject("export default { databases: { main: { url: '' } } };\n");
    writeFileSync(join(dir, 'Dockerfile'), 'FROM ghcr.io/mosofi/adminium:0.2.10\n');
    const cases: [string, string][] = [
      [JSON.stringify({ dependencies: {} }), '! package.json does not depend on @adminiumjs/adminium; the Dockerfile builds on 0.2.10.'],
      ['{ not json', '! package.json does not depend on @adminiumjs/adminium; the Dockerfile builds on 0.2.10.'],
      [
        JSON.stringify({ dependencies: { '@adminiumjs/adminium': '^0.2.10' } }),
        '! package.json installs @adminiumjs/adminium "^0.2.10", not an exact version, so it cannot be compared with the Dockerfile\'s 0.2.10.',
      ],
    ];
    for (const [pkg, warning] of cases) {
      writeFileSync(join(dir, 'package.json'), pkg);
      const io = fakeIo();
      await expect(runCli(['check'], { io, deps: depsIn(dir) })).resolves.toBe(0);
      expect(io.stderr()).toContain('! database "main" has no URL yet; set it in .env.');
      expect(io.stderr()).toContain(warning);
    }
  });

  it('check fails on a build another Adminium version made', async () => {
    jsProject();
    mkdirSync(join(dir, '.adminium', 'build'), { recursive: true });
    writeFileSync(
      join(dir, '.adminium', 'build', 'manifest.json'),
      JSON.stringify({ adminiumVersion: '0.0.1', builtAt: '2026-01-01T00:00:00.000Z', config: { entry: 'adminium.config.mjs', inputs: {} } }),
    );
    const io = fakeIo();
    await expect(runCli(['check'], { io, deps: depsIn(dir) })).resolves.toBe(2);
    expect(io.stderr()).toContain(`✗ .adminium/build was made by Adminium 0.0.1, and this is ${APP_VERSION}. Run the build again.`);
  });

  it('check fails on an invalid config and says why', async () => {
    jsProject('export default { databases: { main: { address: 1 } } };\n');
    const io = fakeIo();
    await expect(runCli(['check'], { io, deps: depsIn(dir) })).resolves.toBe(2);
    expect(io.stderr()).toContain('adminium.config.mjs is not valid');
    expect(io.stderr()).toContain('databases.main');
  });
});

describe('adminium start inside a project', () => {
  async function realRuntime(): Promise<CliRuntime> {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const registry = new AdapterRegistry<AdapterProvider>();
    await registerAdapters(registry);
    const manager = new ConnectionManager({
      meta,
      crypto: dsnCryptoFromSecret(TEST_SECRET),
      registry,
      metaDsn: null,
      blockLoopback: false,
    });
    return fakeRuntime({
      metaStore: { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: vi.fn(async () => undefined) },
      manager,
    } as unknown as Partial<CliRuntime>);
  }

  it('boots with the project folder as its home and connects the configured database', async () => {
    jsProject();
    const shop = new BetterSqlite3(join(dir, 'shop.db'));
    shop.exec('CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT)');
    shop.close();
    writeFileSync(join(dir, '.env'), `ADMINIUM_SECRET=${TEST_SECRET}\n`);
    const runtime = await realRuntime();
    const deps = fakeDeps({ cwd: dir, env: { DATABASE_URL: 'ignored-here', ADMINIUM_SOURCE_URL: 'sqlite:./other.db' }, runtime });
    const io = fakeIo();

    await expect(runCli(['start', '--skip-migrate'], { io, deps })).resolves.toBe(0);

    expect(io.stdout()).toContain(`Project: ${dir}`);
    expect(deps.openRuntime.mock.calls[0]?.[0]).toMatchObject({
      ADMINIUM_DATA_DIR: join(dir, 'data'),
      ADMINIUM_SECRET: TEST_SECRET,
    });
    expect(io.stdout()).toContain('Database "main": added');
    const connection = await runtime.manager.connections.findByProjectKey('main');
    expect(connection?.status).toBe('connected');
    expect(io.stderr()).toContain('ADMINIUM_SOURCE_URL is ignored in a project');
    expect(io.stderr()).not.toContain('Adminium does not read it');
  });

  it('names .env when the secret it holds is too short, and does not boot', async () => {
    jsProject();
    writeFileSync(join(dir, '.env'), 'ADMINIUM_SECRET=short\n');
    const deps = fakeDeps({ cwd: dir, env: {} });
    const io = fakeIo();

    await expect(runCli(['start'], { io, deps })).resolves.toBe(1);

    expect(io.stderr()).toContain('ADMINIUM_SECRET is required');
    expect(io.stderr()).toContain('ADMINIUM_SECRET came from .env.');
    expect(deps.openRuntime).not.toHaveBeenCalled();
  });
});

describe('adminium try inside a project', () => {
  it('refuses, and points at the project instead', async () => {
    writeFileSync(join(dir, 'adminium.config.ts'), '');
    const io = fakeIo({ interactive: true });
    await expect(runCli(['try'], { io, deps: depsIn(dir, { ADMINIUM_SECRET: TEST_SECRET }) })).resolves.toBe(1);
    expect(io.stderr()).toContain('part of an Adminium project');
    expect(io.questions()).toEqual([]);
  });
});
