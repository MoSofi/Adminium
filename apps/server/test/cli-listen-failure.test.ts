// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A server that cannot bind must not leave its timers running.
 *
 * THE BUG THIS PINS. `composeServer` starts the job worker and the cron
 * scheduler from its `onReady` hook, so by the time `listen` runs they are
 * already ticking. When the bind failed, `startServer` propagated the error
 * without closing the app — `installSignalShutdown` sits one line further down
 * and never ran — while `commands/init.ts` answered the failed start by closing
 * the meta store. Both timers then polled a destroyed Kysely driver once a
 * second, with a full stack trace, forever, in a process that never exited.
 *
 * Observed for real: a fresh `npx @adminiumjs/adminium` whose default port was
 * already taken by another instance. The terminal filled with `job poll failed`
 * and the actual cause — the port — was never printed at all.
 */
import { createServer, type Server } from 'node:net';

import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installSignalShutdown,
  listenOrClose,
  resetSignalShutdownForTests,
  SHUTDOWN_DEADLINE_MS,
} from '../src/cli/runtime.js';
import { CliError } from '../src/cli/exit.js';

let squatter: Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (squatter === null) return resolve();
    squatter.close(() => resolve());
  });
  squatter = null;
});

/** Take a port, and report which one. */
async function occupy(): Promise<number> {
  squatter = createServer();
  await new Promise<void>((resolve) => squatter?.listen(0, '127.0.0.1', resolve));
  const address = squatter.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

describe('when the port is taken', () => {
  it('closes the app, so the hooks that stop the worker actually fire', async () => {
    const port = await occupy();
    const app = fastify();
    let closed = false;
    app.addHook('onClose', async () => {
      closed = true;
    });

    await expect(listenOrClose(app, { PORT: port, HOST: '127.0.0.1' })).rejects.toThrow();
    // The whole point: `jobs/register.ts` stops the worker and the scheduler
    // from this hook, and nothing else ever will.
    expect(closed).toBe(true);
  });

  it('says the port is in use, and how to move', async () => {
    const port = await occupy();
    const app = fastify();
    const error = await listenOrClose(app, { PORT: port, HOST: '127.0.0.1' }).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toContain(`Port ${String(port)} is already in use`);
    expect((error as CliError).hint ?? '').toContain('--port');
    await app.close();
  });
});

describe('when the port is free', () => {
  it('listens, and leaves the app open', async () => {
    const app = fastify();
    let closed = false;
    app.addHook('onClose', async () => {
      closed = true;
    });

    await listenOrClose(app, { PORT: 0, HOST: '127.0.0.1' });
    expect(closed).toBe(false);
    expect(app.server.listening).toBe(true);
    await app.close();
  });
});

describe('any other bind failure', () => {
  it('is passed through untouched — the app is still closed', async () => {
    const cause = Object.assign(new Error('kernel said no'), { code: 'EPERM' });
    let closed = false;
    const app = {
      listen: () => Promise.reject(cause),
      close: () => {
        closed = true;
        return Promise.resolve();
      },
    };
    await expect(listenOrClose(app, { PORT: 4600, HOST: '0.0.0.0' })).rejects.toBe(cause);
    expect(closed).toBe(true);
  });
});

/**
 * Ctrl-C must end the process — even when the close it starts never finishes.
 *
 * THE BUG THIS PINS. The dashboard's app shell opens a WebSocket the moment
 * anyone is signed in, and Fastify's default close policy (`'idle'`) waits for
 * active connections — an upgraded socket is never idle. So a single open
 * browser tab turned `app.close()` into a promise that never settled: SIGINT
 * reached the handler, the handler called close, and the terminal sat there
 * while the server went on serving. `forceCloseConnections` (app.ts) removes
 * the cause; this deadline is the guarantee that no future hook can bring it
 * back.
 */
describe('Ctrl-C on a close that never finishes', () => {
  it('leaves anyway, once the deadline passes', async () => {
    vi.useFakeTimers();
    try {
      const handlers = new Map<string, () => void>();
      const exits: number[] = [];
      const proc = {
        once: (signal: string, handler: () => void) => {
          handlers.set(signal, handler);
          return proc as never;
        },
        exit: ((code?: number) => {
          exits.push(code ?? 0);
        }) as never,
      };
      const app = {
        // Never settles — the open-WebSocket shape.
        close: () => new Promise<void>(() => undefined),
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      };

      installSignalShutdown(app as never, proc as never);
      handlers.get('SIGINT')?.();
      expect(exits).toEqual([]);

      await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS + 10);
      expect(exits).toEqual([0]);
    } finally {
      vi.useRealTimers();
      resetSignalShutdownForTests();
    }
  });
});
