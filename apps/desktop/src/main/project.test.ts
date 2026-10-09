// SPDX-License-Identifier: AGPL-3.0-only
import { createServer, type Server } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { E2E_PROJECT_ENV, firstFreePort, seamProject, sessionCookieNames, stopBusyWords } from './project.js';

const open: Server[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((server) => new Promise((done) => server.close(done))));
});

const listenAnywhere = async (): Promise<number> =>
  new Promise((done) => {
    const server = createServer();
    open.push(server);
    server.listen(0, '127.0.0.1', () => {
      done((server.address() as { port: number }).port);
    });
  });

describe('firstFreePort', () => {
  it('skips a port something listens on and takes the next', async () => {
    const taken = await listenAnywhere();
    const port = await firstFreePort(taken, taken + 20);
    expect(port).toBeGreaterThan(taken);
    expect(port).toBeLessThanOrEqual(taken + 20);
  });

  it('says so when the whole range is taken', async () => {
    const taken = await listenAnywhere();
    await expect(firstFreePort(taken, taken)).rejects.toThrow(`No port from ${String(taken)} to ${String(taken)} is free`);
  });
});

describe('seamProject (the test seam)', () => {
  const fs = (files: string[]) => ({ exists: (path: string) => files.includes(path), real: (path: string) => (path === '/link' ? '/real/juniper' : path) });
  const env = (root: string) => ({ [E2E_PROJECT_ENV]: root });

  it('opens the folder named, by its real path, when it is a project', () => {
    expect(seamProject(env('/p/juniper'), false, fs(['/p/juniper/adminium.config.ts']))).toEqual({ root: '/p/juniper' });
    expect(seamProject(env('/link'), false, fs(['/real/juniper/adminium.config.mjs']))).toEqual({ root: '/real/juniper' });
  });

  it('a packaged app never reads it: a folder’s code runs only after the trust question', () => {
    expect(seamProject(env('/p/juniper'), true, fs(['/p/juniper/adminium.config.ts']))).toBeUndefined();
  });

  it('is nothing for no name, a relative name, a folder that is gone, or one that is not a project itself', () => {
    const files = fs(['/p/adminium.config.ts']);
    expect(seamProject({}, false, files)).toBeUndefined();
    expect(seamProject(env('  '), false, files)).toBeUndefined();
    expect(seamProject(env('juniper'), false, files)).toBeUndefined();
    // A parent that is a project does not make this folder one.
    expect(seamProject(env('/p/apps'), false, files)).toBeUndefined();
    expect(
      seamProject(env('/gone'), false, {
        exists: () => true,
        real: () => {
          throw new Error('ENOENT');
        },
      }),
    ).toBeUndefined();
  });
});

describe('stopBusyWords', () => {
  it('names what is running', () => {
    expect(stopBusyWords({ kind: 'turn', sessionId: 'ds_1' })).toEqual({
      title: 'The Designer is in the middle of a turn.',
      detail: 'If you quit now it is stopped where it is. What was already written stays.',
      goOn: 'Quit anyway',
      stay: 'Keep working',
    });
    expect(stopBusyWords({ kind: 'save', sessionId: null }).title).toBe('Your changes are being saved.');
    expect(stopBusyWords({ kind: 'something-new', sessionId: null }).title).toBe('This project is being changed.');
  });
});

describe('sessionCookieNames', () => {
  it('tries design mode’s name first, then the plain one', () => {
    expect(sessionCookieNames('adminium_session', 4700)).toEqual(['adminium_session_4700', 'adminium_session']);
  });
});
