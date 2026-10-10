// SPDX-License-Identifier: AGPL-3.0-only
import { createServer, type Server } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { EN_US_STOP_WORDS, E2E_GIT_ENV, E2E_PORT_ENV, E2E_PROJECT_ENV, PROJECT_PORTS, firstFreePort, projectPortRange, seamGit, seamProject, sessionCookieNames, stopBusyWords } from './project.js';

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

describe('seamGit (the second test seam)', () => {
  const SHA = 'a'.repeat(64);
  const named = (value: unknown): NodeJS.ProcessEnv => ({ [E2E_GIT_ENV]: typeof value === 'string' ? value : JSON.stringify(value) });

  it('names the test’s own file on this machine', () => {
    expect(seamGit(named({ url: 'http://127.0.0.1:9401/git.tar.gz', sha256: SHA, bytes: 512 }), false)).toEqual({
      url: 'http://127.0.0.1:9401/git.tar.gz',
      download: { file: 'git.tar.gz', bytes: 512, sha256: SHA },
    });
  });

  it('is never read by a packaged app: it would choose the program the app fetches and runs', () => {
    expect(seamGit(named({ url: 'http://127.0.0.1:9401/git.tar.gz', sha256: SHA, bytes: 512 }), true)).toBeNull();
  });

  it('is nothing when it is absent, not JSON, another machine’s address, or not a file’s hash and size', () => {
    expect(seamGit({}, false)).toBeNull();
    expect(seamGit(named('  '), false)).toBeNull();
    expect(seamGit(named('{'), false)).toBeNull();
    expect(seamGit(named({ url: 'https://example.com/git.tar.gz', sha256: SHA, bytes: 512 }), false)).toBeNull();
    expect(seamGit(named({ url: 7, sha256: SHA, bytes: 512 }), false)).toBeNull();
    expect(seamGit(named({ url: 'http://127.0.0.1:9401/git.tar.gz', sha256: 'abc', bytes: 512 }), false)).toBeNull();
    expect(seamGit(named({ url: 'http://127.0.0.1:9401/git.tar.gz', sha256: 5, bytes: 512 }), false)).toBeNull();
    expect(seamGit(named({ url: 'http://127.0.0.1:9401/git.tar.gz', sha256: SHA, bytes: 0 }), false)).toBeNull();
    expect(seamGit(named({ url: 'http://127.0.0.1:9401/git.tar.gz', sha256: SHA, bytes: '512' }), false)).toBeNull();
    expect(seamGit(named({ url: 'http://127.0.0.1:9401/git.tar.gz', sha256: SHA, bytes: 1.5 }), false)).toBeNull();
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

describe('projectPortRange', () => {
  it('is the product’s range, which a packaged app always uses', () => {
    expect(projectPortRange({}, false)).toEqual(PROJECT_PORTS);
    expect(projectPortRange({ [E2E_PORT_ENV]: '9480' }, true)).toEqual(PROJECT_PORTS);
  });

  it('starts where an unpackaged test run says, twenty ports wide', () => {
    expect(projectPortRange({ [E2E_PORT_ENV]: '9480' }, false)).toEqual({ first: 9480, last: 9499 });
    for (const odd of ['', 'x', '80', '70000', '94.5']) expect(projectPortRange({ [E2E_PORT_ENV]: odd }, false)).toEqual(PROJECT_PORTS);
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
    // Closing a project asks the same thing in its own words.
    expect(stopBusyWords({ kind: 'turn', sessionId: 'ds_1' }, 'close')).toMatchObject({ goOn: 'Close anyway', detail: 'If you close the project now it is stopped where it is. What was already written stays.' });
    expect(stopBusyWords({ kind: 'something-new', sessionId: null }).title).toBe('This project is being changed.');
  });

  it('asks in the language the project’s page handed over', () => {
    const de = { ...EN_US_STOP_WORDS, turn: 'Der Designer ist mitten in einem Durchgang.', other: 'Dieses Projekt wird gerade geändert.', closeDetail: 'Wenn Sie das Projekt jetzt schließen…', closeAnyway: 'Trotzdem schließen', keepWorking: 'Weiterarbeiten' };
    expect(stopBusyWords({ kind: 'turn', sessionId: 'ds_1' }, 'close', de)).toEqual({ title: 'Der Designer ist mitten in einem Durchgang.', detail: 'Wenn Sie das Projekt jetzt schließen…', goOn: 'Trotzdem schließen', stay: 'Weiterarbeiten' });
    expect(stopBusyWords({ kind: 'new', sessionId: null }, 'quit', de).title).toBe('Dieses Projekt wird gerade geändert.');
  });
});

describe('sessionCookieNames', () => {
  it('tries design mode’s name first, then the plain one', () => {
    expect(sessionCookieNames('adminium_session', 4700)).toEqual(['adminium_session_4700', 'adminium_session']);
  });
});
