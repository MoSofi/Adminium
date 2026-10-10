// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `startProject`: the terminal's start path with a handle, as the desktop
 * app's server child calls it. A real server on a real port each time: what
 * is proved here is that `close()` leaves nothing behind and a second start
 * on the same folder works.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HOST_DECIDED_ENV, startProject, type StartedProject } from '../src/cli/start-project.js';
import { markRunning, readRunning, refuseIfRunning, runningFile, runningMessage } from '../src/project/running.js';
import { fakeIo, TEST_SECRET } from './cli-helpers.js';

const anyPort = async (): Promise<number> =>
  new Promise((done) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });

const listening = async (port: number): Promise<boolean> =>
  new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(true));
    probe.listen(port, '127.0.0.1', () => probe.close(() => done(false)));
  });

/** `fetch` will not send a Host of the caller's choosing; a plain request does. */
const statusAs = async (port: number, host: string): Promise<number> =>
  new Promise((done, fail) => {
    request({ host: '127.0.0.1', port, path: '/api/v1/healthz', headers: { host } }, (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    })
      .once('error', fail)
      .end();
  });

let root: string;
let live: StartedProject | null = null;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'adminium-start-project-')));
  writeFileSync(join(root, 'adminium.config.mjs'), 'export default {};\n');
  writeFileSync(join(root, 'package.json'), '{"name":"p","private":true,"type":"module"}\n');
  writeFileSync(join(root, '.env'), `ADMINIUM_SECRET=${TEST_SECRET}\n`);
  mkdirSync(join(root, 'data'));
});
afterEach(async () => {
  await live?.close();
  live = null;
  rmSync(root, { recursive: true, force: true });
});

const env = (): Record<string, string | undefined> => ({ PATH: process.env.PATH, HOME: process.env.HOME });

describe('startProject', () => {
  it('serves the folder, says where, and close() leaves nothing: then it starts again', { timeout: 120_000 }, async () => {
    const port = await anyPort();
    live = await startProject({ root, port, mode: 'serve', io: fakeIo(), env: env() });
    expect(live.url).toBe(`http://127.0.0.1:${String(port)}`);
    expect(live.port).toBe(port);
    expect((await fetch(`${live.url}/api/v1/healthz`)).status).toBe(200);
    expect(live.busy()).toBeNull();
    // The data is the project's own, not the home folder's.
    expect(existsSync(join(root, 'data'))).toBe(true);

    const mark = JSON.parse(readFileSync(runningFile(root), 'utf8')) as { pid: number; port: number; mode: string; by: string };
    expect(mark).toMatchObject({ pid: process.pid, port, mode: 'start', by: 'cli' });

    await live.close();
    live = null;
    expect(await listening(port)).toBe(false);
    expect(existsSync(runningFile(root))).toBe(false);

    const again = await anyPort();
    live = await startProject({ root, port: again, mode: 'serve', io: fakeIo(), env: { ...env(), ADMINIUM_RUNTIME: 'desktop' } });
    expect((await fetch(`${live.url}/api/v1/healthz`)).status).toBe(200);
    expect(JSON.parse(readFileSync(runningFile(root), 'utf8'))).toMatchObject({ by: 'desktop', port: again });
    // A project in the desktop app has none of the classic workspace's own routes: they act on another instance.
    for (const path of ['/api/v1/desktop/lan-share', '/api/v1/desktop/local-database', '/api/v1/desktop/backup']) {
      const res = await fetch(`${live.url}${path}`, { method: path.endsWith('lan-share') ? 'GET' : 'POST' });
      expect(res.status, path).toBe(404);
    }
  });

  it('shared by the desktop app: this computer’s own names only, and the app’s window signs the owner in', { timeout: 120_000 }, async () => {
    // Made as the app makes it: built first, which is where its owner comes from.
    live = await startProject({ root, port: await anyPort(), mode: 'design', io: fakeIo(), env: env() });
    await live.close();
    const port = await anyPort();
    const token = 'e'.repeat(64);
    live = await startProject({ root, port, mode: 'serve', io: fakeIo(), env: { ...env(), ADMINIUM_RUNTIME: 'desktop', ADMINIUM_BOOT_TOKEN: token }, shared: true, ownerOnThisComputer: true });
    const asHost = (host: string): Promise<number> =>
      new Promise((done, failed) => {
        const asked = httpRequest({ host: '127.0.0.1', port, path: '/api/v1/healthz', headers: { host }, agent: false }, (res) => {
          res.resume();
          done(res.statusCode ?? 0);
        });
        asked.on('error', failed);
        asked.end();
      });
    expect(await asHost(`127.0.0.1:${String(port)}`)).toBe(200);
    expect(await asHost(`localhost:${String(port)}`)).toBe(200);
    expect(await asHost(`evil.example:${String(port)}`)).toBe(421);

    const signedIn = await fetch(`${live.url}/api/v1/auth/desktop-session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bootToken: token }) });
    expect(signedIn.status).toBe(200);
    expect(((await signedIn.json()) as { data: { user: { email: string } } }).data.user.email).toBe('owner@adminium.localhost');
    await live.close();
    live = null;

    // Served without that word (a terminal's `adminium start`, or a host that did not ask): any name, and no such door.
    const plain = await anyPort();
    live = await startProject({ root, port: plain, mode: 'serve', io: fakeIo(), env: { ...env(), ADMINIUM_RUNTIME: 'desktop', ADMINIUM_BOOT_TOKEN: token } });
    const other = await fetch(`${live.url}/api/v1/auth/desktop-session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bootToken: token }) });
    expect(other.status).toBe(403);
  });

  it('design mode: this machine only, the owner made, the Designer answering, nothing busy', { timeout: 120_000 }, async () => {
    const port = await anyPort();
    const io = fakeIo();
    live = await startProject({ root, port, mode: 'design', io, env: { ...env(), HOST: '0.0.0.0' } });
    expect(live.url).toBe(`http://127.0.0.1:${String(port)}`);
    expect(live.token).toBeNull();
    expect(io.stdout()).toContain('Made you the owner of this project');
    expect(JSON.parse(readFileSync(runningFile(root), 'utf8'))).toMatchObject({ mode: 'design' });
    // The other name is the preview's; any third name is refused.
    expect(await statusAs(port, `127.0.0.1:${String(port)}`)).toBe(200);
    expect(await statusAs(port, `localhost:${String(port)}`)).toBe(200);
    expect(await statusAs(port, `evil.test:${String(port)}`)).toBe(421);
    expect(live.busy()).toBeNull();
  });

  it('does not obey a folder that names what the host decides', { timeout: 120_000 }, async () => {
    const port = await anyPort();
    const elsewhere = await anyPort();
    writeFileSync(
      join(root, '.env'),
      [`ADMINIUM_SECRET=${TEST_SECRET}`, 'HOST=0.0.0.0', `PORT=${String(elsewhere)}`, 'ADMINIUM_TRUST_PROXY=true', 'ADMINIUM_DESIGNER=live', 'ADMINIUM_STATIC_ROOT=/tmp/nowhere', 'NODE_OPTIONS=--require ./evil.cjs', 'ADMINIUM_LOG_LEVEL=error', ''].join('\n'),
    );
    const io = fakeIo();
    // The host leaves the trust and Designer names unset on purpose: the file must not fill them.
    live = await startProject({ root, port, mode: 'serve', io, env: { ...env(), ADMINIUM_RUNTIME: 'desktop' }, refuse: HOST_DECIDED_ENV });
    expect(live.port).toBe(port);
    expect(live.url).toBe(`http://127.0.0.1:${String(port)}`);
    expect(await listening(elsewhere)).toBe(false);
    expect(live.refused).toEqual(['ADMINIUM_DESIGNER', 'ADMINIUM_STATIC_ROOT', 'ADMINIUM_TRUST_PROXY', 'HOST', 'NODE_OPTIONS', 'PORT']);
    expect(io.stderr()).toContain("Ignored from this project's .env and config");
  });

  it('obeys the same file on a terminal, where the folder and the person are one', { timeout: 120_000 }, async () => {
    const port = await anyPort();
    writeFileSync(join(root, '.env'), `ADMINIUM_SECRET=${TEST_SECRET}\nADMINIUM_TRUST_PROXY=true\n`);
    live = await startProject({ root, port, mode: 'serve', io: fakeIo(), env: env() });
    expect(live.refused).toEqual([]);
  });

  it('fills the environment it is given in place, so the project’s config reads its own .env', { timeout: 120_000 }, async () => {
    const port = await anyPort();
    writeFileSync(join(root, '.env'), `ADMINIUM_SECRET=${TEST_SECRET}\nP66_T12_FROM_DOTENV=yes\n`);
    const given: Record<string, string | undefined> = { ...env(), ADMINIUM_PROJECT_DIR: '/elsewhere', ADMINIUM_PROJECT_MODE: 'dev' };
    live = await startProject({ root, port, mode: 'serve', io: fakeIo(), env: given });
    expect(given.P66_T12_FROM_DOTENV).toBe('yes');
    // Which folder and which mode are this call's to say.
    expect(given).not.toHaveProperty('ADMINIUM_PROJECT_DIR');
    expect(given).not.toHaveProperty('ADMINIUM_PROJECT_MODE');
    expect(JSON.parse(readFileSync(runningFile(root), 'utf8'))).toMatchObject({ mode: 'start' });
  });

  it('refuses a folder that is not the project itself, even inside one', async () => {
    const inner = join(root, 'apps');
    mkdirSync(inner);
    await expect(startProject({ root: inner, port: 1, mode: 'serve', io: fakeIo(), env: env() })).rejects.toThrow(/is not a project folder/);
    // Nor a project named by the environment.
    const elsewhere = mkdtempSync(join(tmpdir(), 'adminium-not-a-project-'));
    try {
      await expect(startProject({ root: elsewhere, port: 1, mode: 'serve', io: fakeIo(), env: { ...env(), ADMINIUM_PROJECT_DIR: root } })).rejects.toThrow(/is not a project folder/);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('does not start a project another process is serving', async () => {
    mkdirSync(join(root, '.adminium'), { recursive: true });
    // This test runner's parent is certainly alive and is not this process.
    writeFileSync(runningFile(root), JSON.stringify({ pid: process.ppid, port: 4711, mode: 'design', startedAt: 'x', by: 'desktop' }));
    await expect(startProject({ root, port: await anyPort(), mode: 'serve', io: fakeIo(), env: env() })).rejects.toThrow('This project is already running (in the Adminium app), on port 4711.');
  });
});

describe('.adminium/running.json', () => {
  it('is written, honoured while its process lives, and replaced when it does not', () => {
    const forget = markRunning(root, { port: 4700, mode: 'design', by: 'cli' });
    // This process's own mark never refuses this process.
    expect(readRunning(root)).toBeNull();
    const mine = JSON.parse(readFileSync(runningFile(root), 'utf8')) as { pid: number };
    writeFileSync(runningFile(root), JSON.stringify({ ...mine, pid: 999_999 }));

    expect(readRunning(root, () => true)).toMatchObject({ pid: 999_999, port: 4700, mode: 'design', by: 'cli' });
    expect(() => refuseIfRunning(root, () => true)).toThrow('This project is already running (in a terminal), on port 4700.');
    expect(runningMessage({ pid: 1, port: 9, mode: 'start', startedAt: '', by: 'desktop' })).toContain('in the Adminium app');

    // Its process is gone: the file means nothing, and the next start replaces it.
    expect(readRunning(root, () => false)).toBeNull();
    expect(() => refuseIfRunning(root, () => false)).not.toThrow();

    // Forgetting removes only this process's own mark.
    forget();
    expect(existsSync(runningFile(root))).toBe(true);
    const mineAgain = markRunning(root, { port: 4701, mode: 'start', by: 'desktop' });
    mineAgain();
    expect(existsSync(runningFile(root))).toBe(false);
  });

  it('a mark written before this computer was last started is nobody’s, whoever has its number now', () => {
    mkdirSync(join(root, '.adminium'), { recursive: true });
    const mark = (startedAt: string): void => writeFileSync(runningFile(root), JSON.stringify({ pid: 999_999, port: 4700, mode: 'start', by: 'cli', startedAt }));
    const now = Date.parse('2026-10-10T12:00:00.000Z');
    // A year ago: this computer has been started since, by any measure.
    mark('2025-10-10T12:00:00.000Z');
    expect(readRunning(root, () => true, () => now)).toBeNull();
    // A moment ago: its server may well be there.
    mark('2026-10-10T11:59:59.000Z');
    expect(readRunning(root, () => true, () => now)).toMatchObject({ port: 4700 });
  });

  it('reads nothing from a file that is not a mark', () => {
    mkdirSync(join(root, '.adminium'), { recursive: true });
    for (const text of ['', 'not json', 'null', '{"pid":"1","port":2}', '{"pid":-4,"port":2}', '{"pid":12}']) {
      writeFileSync(runningFile(root), text);
      expect(readRunning(root, () => true)).toBeNull();
    }
  });
});

describe('versions with no git at all', () => {
  it('are off without anything being started to find out', async () => {
    const { createVersions } = await import('../src/designer/versions.js');
    // A git that would hang or raise a dialog if it were started: it must not be.
    const off = createVersions(tmpdir(), { git: null });
    const started = Date.now();
    expect(await off.available()).toBe(false);
    expect(Date.now() - started).toBeLessThan(200);
    expect(await off.commit({ id: 'ds_x', appKey: 'a' } as never)).toBeNull();
    // A path that is not git is "not available", as before.
    expect(await createVersions(tmpdir(), { git: join(tmpdir(), 'no-such-git') }).available()).toBe(false);
  });
});
