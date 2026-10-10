// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A TEST may import the engine freely (see `backup-format-parity.test.ts`): it does not ship.
import { DESIGN_DATABASE } from '@adminium/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INSTALLING_LINE, MAKE_PROJECT_TIMEOUT_MS, NEW_PROJECT_DATABASE, createInstallPackages, createMakeProject, lastLines, runToEnd, type MakeProjectDeps, type RanProgram } from './make-project.js';

let home: string;
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'adminium-make-')));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const deps = (run: MakeProjectDeps['run'], more: Partial<MakeProjectDeps> = {}): MakeProjectDeps => ({
  binary: '/Applications/Adminium.app/Contents/MacOS/Adminium',
  cliEntry: '/app/node_modules/@adminium/server/dist/cli/index.js',
  programs: () => Promise.resolve('{"binary":"x"}'),
  env: { PATH: '/usr/bin', ADMINIUM_SECRET: 'the-classic-workspace-secret', GONE: undefined },
  run,
  ...more,
});
const ran = (more: Partial<RanProgram> = {}): RanProgram => ({ code: 0, output: '', timedOut: false, ...more });

describe('the database a new project starts with', () => {
  it('is the engine’s own', () => {
    expect(NEW_PROJECT_DATABASE).toBe(DESIGN_DATABASE);
  });
});

describe('getting the packages of a project that is there', () => {
  it('runs the engine’s `install` in the folder, as Node, with the app’s programs and no secret of anyone else’s', async () => {
    const run = vi.fn<MakeProjectDeps['run']>(() => Promise.resolve(ran()));
    await expect(createInstallPackages(deps(run))({ root: home })).resolves.toEqual({ ok: true });
    expect(run).toHaveBeenCalledWith('/Applications/Adminium.app/Contents/MacOS/Adminium', ['/app/node_modules/@adminium/server/dist/cli/index.js', 'install'], {
      cwd: home,
      env: { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1', ADMINIUM_DESKTOP_PROGRAMS: '{"binary":"x"}' },
      timeoutMs: MAKE_PROJECT_TIMEOUT_MS,
    });
  });

  it('says why in the installer’s own last lines, and never removes a folder that was there', async () => {
    writeFileSync(join(home, 'adminium.config.ts'), 'export default {};\n');
    await expect(createInstallPackages(deps(() => Promise.resolve(ran({ code: 1, output: 'a\nnpm error code ENOTFOUND' }))))({ root: home })).resolves.toEqual({ ok: false, detail: 'a\nnpm error code ENOTFOUND' });
    await expect(createInstallPackages(deps(() => Promise.resolve(ran({ code: null, timedOut: true }))))({ root: home })).resolves.toEqual({ ok: false, detail: 'Getting the packages took too long and was stopped.' });
    expect(existsSync(join(home, 'adminium.config.ts'))).toBe(true);
  });
});

describe('making a project', () => {
  it('runs the engine’s `new` in the parent, as Node, with the app’s programs and no secret of anyone else’s', async () => {
    const parent = join(home, 'Adminium');
    const root = join(parent, 'shop');
    const run = vi.fn<MakeProjectDeps['run']>(() => {
      mkdirSync(root, { recursive: true });
      return Promise.resolve(ran());
    });
    const log = vi.fn();
    await expect(createMakeProject(deps(run, { log }))({ parent, folder: 'shop', root })).resolves.toEqual({ ok: true });
    expect(run).toHaveBeenCalledWith(
      '/Applications/Adminium.app/Contents/MacOS/Adminium',
      ['/app/node_modules/@adminium/server/dist/cli/index.js', 'new', 'shop', '--yes', '--database', NEW_PROJECT_DATABASE],
      { cwd: parent, env: { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1', ADMINIUM_DESKTOP_PROGRAMS: '{"binary":"x"}' }, timeoutMs: MAKE_PROJECT_TIMEOUT_MS, onOutput: expect.any(Function) as unknown },
    );
    // The parent was made first: `new` is run IN it.
    expect(existsSync(parent)).toBe(true);
    // An empty file is an empty database, and a SQLite connection opens only a file that exists.
    expect(readFileSync(join(root, 'data', 'app.sqlite'), 'utf8')).toBe('');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('exit 0'));
  });

  it('takes away a folder it made and could not finish, so the same name can be tried again', async () => {
    const root = join(home, 'shop');
    const run: MakeProjectDeps['run'] = () => {
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'package.json'), '{}');
      return Promise.resolve(ran({ code: 1, output: 'npm ci failed' }));
    };
    await expect(createMakeProject(deps(run))({ parent: home, folder: 'shop', root })).resolves.toEqual({ ok: false, detail: 'npm ci failed' });
    expect(existsSync(root)).toBe(false);
  });

  it('leaves a folder that was there before it, whatever happened', async () => {
    const root = join(home, 'shop');
    mkdirSync(root);
    const run: MakeProjectDeps['run'] = () => {
      writeFileSync(join(root, 'package.json'), '{}');
      return Promise.resolve(ran({ code: null, output: '', timedOut: true }));
    };
    await expect(createMakeProject(deps(run))({ parent: home, folder: 'shop', root })).resolves.toMatchObject({ ok: false });
    expect(existsSync(join(root, 'package.json'))).toBe(true);
  });

  it('says where it is: the files, the packages once the engine hands over to npm, then the database', async () => {
    const root = join(home, 'shop');
    const steps: string[] = [];
    const run: MakeProjectDeps['run'] = (_command, _args, opts) => {
      mkdirSync(root, { recursive: true });
      // In pieces, as a pipe delivers it: the line is found across two chunks, and said once.
      opts.onOutput?.('Started a git repository.\nInstalling depen');
      steps.push('(before the line is whole)');
      opts.onOutput?.('dencies with npm…\n');
      opts.onOutput?.('added 212 packages\nInstalling dependencies with npm…\n');
      return Promise.resolve(ran());
    };
    await createMakeProject(deps(run))({ parent: home, folder: 'shop', root, onStep: (step) => steps.push(step) });
    expect(steps).toEqual(['files', '(before the line is whole)', 'packages', 'database']);
  });

  it('listens for the very words the engine prints before its install', () => {
    const source = readFileSync(new URL('../../../server/src/cli/commands/new.ts', import.meta.url), 'utf8');
    expect(source).toContain(`io.out(\`${INSTALLING_LINE} \${command}…\`)`);
  });

  it('keeps a database that is already there', async () => {
    const root = join(home, 'shop');
    const run: MakeProjectDeps['run'] = () => {
      mkdirSync(join(root, 'data'), { recursive: true });
      writeFileSync(join(root, 'data', 'app.sqlite'), 'rows');
      return Promise.resolve(ran());
    };
    await createMakeProject(deps(run))({ parent: home, folder: 'shop', root });
    expect(readFileSync(join(root, 'data', 'app.sqlite'), 'utf8')).toBe('rows');
  });

  it('goes without the programs value in a build that has none', async () => {
    const run = vi.fn<MakeProjectDeps['run']>(() => Promise.resolve(ran({ code: 1 })));
    await createMakeProject(deps(run, { programs: () => Promise.resolve(undefined) }))({ parent: home, folder: 'shop', root: join(home, 'shop') });
    expect(run.mock.calls[0]?.[2].env).not.toHaveProperty('ADMINIUM_DESKTOP_PROGRAMS');
  });

  it('answers with the end of what was printed when it fails, and makes no database', async () => {
    const root = join(home, 'shop');
    const output = ['a', 'b', 'c', 'd', 'e', 'f', 'npm error code ENOTFOUND', '', 'npm error network request failed  '].join('\n');
    const made = await createMakeProject(deps(() => Promise.resolve(ran({ code: 1, output }))))({ parent: home, folder: 'shop', root });
    expect(made).toEqual({ ok: false, detail: 'c\nd\ne\nf\nnpm error code ENOTFOUND\nnpm error network request failed' });
    expect(existsSync(join(root, 'data'))).toBe(false);
  });

  it('says so when it took too long', async () => {
    const made = await createMakeProject(deps(() => Promise.resolve(ran({ code: null, timedOut: true }))))({ parent: home, folder: 'shop', root: join(home, 'shop') });
    expect(made).toEqual({ ok: false, detail: 'Getting the packages took too long and was stopped.' });
  });

  it('says so when the parent cannot be made, and runs nothing', async () => {
    writeFileSync(join(home, 'a-file'), '');
    const run = vi.fn<MakeProjectDeps['run']>(() => Promise.resolve(ran()));
    const made = await createMakeProject(deps(run))({ parent: join(home, 'a-file', 'under'), folder: 'shop', root: join(home, 'a-file', 'under', 'shop') });
    expect(made.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('the last lines of a program’s output', () => {
  it('drops the blank ones and keeps the end', () => {
    expect(lastLines('one\n\n two \nthree\n', 2)).toBe(' two\nthree');
    expect(lastLines('')).toBe('');
  });
});

describe('running a program to its end', () => {
  const env = { PATH: process.env.PATH ?? '' };
  it('reads both streams and how it ended', async () => {
    const result = await runToEnd(process.execPath, ['-e', 'console.log("out"); console.error("err"); process.exit(3)'], { cwd: home, env, timeoutMs: 20_000 });
    expect(result.code).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.output).toContain('out');
    expect(result.output).toContain('err');
  });
  it('stops one that takes too long', async () => {
    const result = await runToEnd(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: home, env, timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
  });
  it('answers, not throws, for a program that is not there', async () => {
    const result = await runToEnd(join(home, 'no-such-program'), [], { cwd: home, env, timeoutMs: 5_000 });
    expect(result.code).toBeNull();
    expect(result.output).not.toBe('');
  });
});
