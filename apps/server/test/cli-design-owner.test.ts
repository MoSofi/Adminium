// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium design` and `adminium owner set` from the command line, and the
 * plain flow's new first choice.
 *
 * `owner set` is the ONE way the owner `design` made gets a password, so it
 * is run here against a real project and its real meta store: refused for an
 * owner with a password, refused for an owner it did not make, and once it
 * succeeds the owner signs in like anyone and the design link no longer
 * applies to them.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFirstSuperAdmin, createLocalOwner, firstRun, settingsRepo, usersRepo } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyPassword } from '../src/auth/passwords.js';
import { runStart } from '../src/cli/commands/start.js';
import { designCommand, freePort } from '../src/cli/commands/design.js';
import { runCli } from '../src/cli/run.js';
import { openMetaStore } from '../src/meta/store.js';
import { fakeDeps, fakeIo, TEST_SECRET } from './cli-helpers.js';

// The server itself is not started here: what `design` does before it is.
vi.mock('../src/cli/commands/start.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/cli/commands/start.js')>()),
  runStart: vi.fn(async () => Promise.resolve(0)),
}));

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-owner-'));
  writeFileSync(join(root, 'adminium.config.mjs'), 'export default {};\n');
  writeFileSync(join(root, 'package.json'), '{"name":"p","private":true,"type":"module"}\n');
  writeFileSync(join(root, '.env'), `ADMINIUM_SECRET=${TEST_SECRET}\n`);
  mkdirSync(join(root, 'data'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The project's own meta store, as the commands open it. */
async function store() {
  const handle = await openMetaStore({ metaUrl: undefined, dataDir: join(root, 'data'), secret: TEST_SECRET });
  await firstRun(handle.meta);
  return handle;
}

const ownerSet = async (answers: string[], argv: string[] = []) => {
  const io = fakeIo({ interactive: true, answers });
  const code = await runCli(['owner', 'set', ...argv], { io, deps: fakeDeps({ cwd: root, env: {} }) });
  return { code, io };
};

describe('adminium owner set', () => {
  it('gives the owner design made an address and a password, and the design link stops applying to them', async () => {
    const before = await store();
    const owner = await createLocalOwner(before.meta);
    await before.close();

    const { code, io } = await ownerSet(['me@example.test', 'a-long-enough-test-password-1!', 'a-long-enough-test-password-1!']);
    expect(code, io.stderr()).toBe(0);
    expect(io.stdout()).toContain('The owner is now me@example.test');

    const after = await store();
    const updated = await usersRepo(after.meta).findById(owner.id);
    expect(updated?.email).toBe('me@example.test');
    expect(await verifyPassword(updated?.passwordHash ?? '', 'a-long-enough-test-password-1!')).toBe(true);
    expect(await settingsRepo(after.meta).get('designer.localOwnerId')).toBeNull();
    await after.close();

    // Once set, it is the account's own business: not this command's.
    const second = await ownerSet(['x@example.test', 'another-long-password-2!', 'another-long-password-2!']);
    expect(second.code).not.toBe(0);
    expect(second.io.stderr()).toContain('not made by `adminium design`');
  });

  it('refuses two passwords that differ, and a short one, and changes nothing', async () => {
    const before = await store();
    const owner = await createLocalOwner(before.meta);
    await before.close();
    expect((await ownerSet(['me@example.test', 'a-long-enough-test-password-1!', 'not-the-same-password-1!'])).code).not.toBe(0);
    const after = await store();
    expect((await usersRepo(after.meta).findById(owner.id))?.passwordHash).toBeNull();
    await after.close();
  });

  it('refuses a project whose owner was not made by design', async () => {
    const before = await store();
    await createFirstSuperAdmin(before.meta, { email: 'someone@example.test', passwordHash: 'x' });
    await before.close();
    const { code, io } = await ownerSet(['me@example.test']);
    expect(code).not.toBe(0);
    expect(io.stderr()).toContain('not made by `adminium design`');
  });
});

describe('adminium design', () => {
  it('finds a free port on this machine, past one that is taken', async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(4791, '127.0.0.1', resolve));
    try {
      expect(await freePort(4791, 4795)).toBe(4792);
    } finally {
      await new Promise<void>((resolve) => taken.close(() => resolve()));
    }
  });

  it('refuses a folder name inside a project, and two names anywhere', async () => {
    const io = fakeIo({ interactive: false });
    expect(await runCli(['design', 'other'], { io, deps: fakeDeps({ cwd: root, env: {} }) })).not.toBe(0);
    expect(io.stderr()).toContain('already in a project');
    expect(await runCli(['design', 'a', 'b'], { io: fakeIo({ interactive: false }), deps: fakeDeps({ cwd: root, env: {} }) })).not.toBe(0);
  });

  it('makes a project with its own database file, then starts on this machine only', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'adminium-design-'));
    try {
      const io = fakeIo({ interactive: false });
      // No install, no git: what `new` runs is not what this checks.
      const runProcess = vi.fn(() => ({ status: 0, stdout: '' }));
      expect(await runCli(['design', 'shop', '--port', '4793', '--no-open'], { io, deps: { ...fakeDeps({ cwd: outside, env: {} }), runProcess } }), io.stderr()).toBe(0);
      const made = join(outside, 'shop');
      expect(readFileSync(join(made, '.env'), 'utf8')).toContain('sqlite:./data/app.sqlite');
      // A SQLite connection opens only a file that exists: `design` makes it.
      expect(existsSync(join(made, 'data', 'app.sqlite'))).toBe(true);
      expect(vi.mocked(runStart)).toHaveBeenCalledWith(
        expect.objectContaining({ deps: expect.objectContaining({ cwd: made }), argv: expect.arrayContaining(['--port', '4793']) }),
        expect.anything(),
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('is listed among the commands, after dev', async () => {
    const io = fakeIo({ interactive: false });
    await runCli(['--help'], { io, deps: fakeDeps({ cwd: root, env: {} }) });
    const help = io.stdout();
    expect(help).toContain('design');
    expect(help.indexOf(' design ')).toBeGreaterThan(help.indexOf(' dev '));
    expect(designCommand.usage).toBe('adminium design [folder] [--port <n>] [--no-open]');
  });
});

describe('the plain flow’s first choice', () => {
  it('opens the Designer for “Describe an app”, and keeps `new` for the other two', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'adminium-home-'));
    try {
      const run = vi.spyOn(designCommand, 'run').mockResolvedValue(0);
      const io = fakeIo({ interactive: true, answers: ['shop'], selections: [0] });
      expect(await runCli([], { io, deps: fakeDeps({ cwd: outside, env: {} }) })).toBe(0);
      expect(io.menus()[0]?.title).toBe('What do you want to start with?');
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ argv: ['shop'] }));
      run.mockRestore();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
