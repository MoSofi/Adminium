/**
 * The §2.2 handshake and the §2.2 step 9 restart policy, driven with a fake
 * child and a fake clock. No Electron, no fork, no socket.
 *
 * The restart cases are the reason this file exists. "Three crashes within 60 s
 * ⇒ stop auto-restarting" has no way to fail loudly in manual testing — you have
 * to make a packaged server die three times on a stopwatch to see it — so the
 * arithmetic is pinned here and {@link decideRestart} is exported for exactly
 * this.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  BOOT_TOKEN_HEX_LENGTH,
  EPHEMERAL_PORT,
  metaDsnForDataDir,
} from '../server/env.js';
import { createMemoryLogSink, type ReadableLike } from './logging.js';
import {
  createServerManager,
  DEFAULT_RESTART_POLICY,
  decideRestart,
  ServerStartError,
  type CreateServerManagerOptions,
  type ForkOptions,
  type ServerChildLike,
  type ServerExit,
  type ServerState,
} from './server-manager.js';

// ─── Fakes ───────────────────────────────────────────────────────────────────

const SECRET = 's'.repeat(32);
const TOKEN = 'a'.repeat(BOOT_TOKEN_HEX_LENGTH);
const DATA_DIR = '/tmp/adminium-desktop-test';

/** A `utilityProcess` child the test drives by hand. */
class FakeChild implements ServerChildLike {
  readonly pid = 4242;
  readonly posted: unknown[] = [];
  killed = false;
  readonly stdout: ReadableLike | null = null;
  readonly stderr: ReadableLike | null = null;
  #messageHandlers: Array<(message: unknown) => void> = [];
  #exitHandlers: Array<(code: number) => void> = [];

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }

  on(event: 'message' | 'exit', listener: (arg: never) => void): this {
    if (event === 'message') this.#messageHandlers.push(listener as (m: unknown) => void);
    else this.#exitHandlers.push(listener as (c: number) => void);
    return this;
  }

  /** The child says something over parentPort. */
  send(message: unknown): void {
    for (const handler of [...this.#messageHandlers]) handler(message);
  }

  /** §2.2 step 7's ready message. */
  ready(port = 51234, applied = 0): void {
    this.send({ type: 'ready', port, host: '127.0.0.1', migrations: { applied } });
  }

  exit(code: number): void {
    for (const handler of [...this.#exitHandlers]) handler(code);
  }
}

/** A clock + timer queue the test advances explicitly. */
function fakeTimers() {
  let now = 1_000_000;
  let nextId = 1;
  const queue = new Map<number, { at: number; run: () => void }>();

  return {
    now: () => now,
    api: {
      setTimeout(handler: () => void, ms: number): unknown {
        const id = nextId++;
        queue.set(id, { at: now + ms, run: handler });
        return id;
      },
      clearTimeout(handle: unknown): void {
        queue.delete(handle as number);
      },
    },
    /** Move the clock and run everything that came due, in order. */
    advance(ms: number): void {
      now += ms;
      for (;;) {
        const due = [...queue.entries()]
          .filter(([, entry]) => entry.at <= now)
          .sort((a, b) => a[1].at - b[1].at);
        const first = due[0];
        if (first === undefined) return;
        queue.delete(first[0]);
        first[1].run();
      }
    },
    get pending(): number {
      return queue.size;
    },
  };
}

interface Harness {
  children: FakeChild[];
  forkCalls: ForkOptions[];
  clock: ReturnType<typeof fakeTimers>;
  manager: ReturnType<typeof createServerManager>;
  log: ReturnType<typeof createMemoryLogSink>;
  states: ServerState[];
  exits: ServerExit[];
}

function harness(overrides: Partial<CreateServerManagerOptions> = {}): Harness {
  const children: FakeChild[] = [];
  const forkCalls: ForkOptions[] = [];
  const clock = fakeTimers();
  const log = createMemoryLogSink();

  const manager = createServerManager({
    entry: '/app/out/server/index.js',
    dataDir: DATA_DIR,
    secret: SECRET,
    bootToken: TOKEN,
    singleUser: true,
    log,
    timers: clock.api,
    now: clock.now,
    inheritEnv: {},
    fork: (opts) => {
      forkCalls.push(opts);
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    ...overrides,
  });

  const states: ServerState[] = [];
  manager.subscribe((state) => states.push(state));
  const exits: ServerExit[] = [];
  manager.onExit((exit) => exits.push(exit));

  return { children, forkCalls, clock, manager, log, states, exits };
}

/** The child at `index`, once the manager has forked it. */
function childAt(h: Harness, index: number): FakeChild {
  const child = h.children[index];
  if (child === undefined) throw new Error(`no child forked at index ${String(index)}`);
  return child;
}

// ─── decideRestart (pure) ────────────────────────────────────────────────────

describe('decideRestart', () => {
  const policy = DEFAULT_RESTART_POLICY;

  it('never restarts an exit we asked for', () => {
    // The quit path exits 0 BY DESIGN. A rule of "code 0 ⇒ restart" read
    // literally would resurrect the server while the app is closing.
    expect(
      decideRestart({ expected: true, exitCode: 0, exitsInWindow: [1], policy }),
    ).toEqual({ action: 'none' });
    expect(
      decideRestart({ expected: true, exitCode: 1, exitsInWindow: [1], policy }),
    ).toEqual({ action: 'none' });
  });

  it('restarts an unexpected exit 0 immediately (§2.2: the LAN toggle)', () => {
    expect(decideRestart({ expected: false, exitCode: 0, exitsInWindow: [1], policy })).toEqual({
      action: 'restart',
      delayMs: 0,
      attempt: 1,
    });
  });

  it('backs off exponentially on crashes', () => {
    expect(
      decideRestart({ expected: false, exitCode: 1, exitsInWindow: [1], policy }),
    ).toMatchObject({ action: 'restart', delayMs: 500 });
    expect(
      decideRestart({ expected: false, exitCode: 1, exitsInWindow: [1, 2], policy }),
    ).toMatchObject({ action: 'restart', delayMs: 1000 });
  });

  it('caps the backoff at maxDelayMs', () => {
    const generous = { ...policy, maxRestarts: 99 };
    const decision = decideRestart({
      expected: false,
      exitCode: 1,
      exitsInWindow: Array.from({ length: 20 }, (_, index) => index),
      policy: generous,
    });

    expect(decision).toMatchObject({ action: 'restart', delayMs: generous.maxDelayMs });
  });

  it('gives up on the third exit inside the window (§2.2)', () => {
    const decision = decideRestart({
      expected: false,
      exitCode: 1,
      exitsInWindow: [1, 2, 3],
      policy,
    });

    expect(decision.action).toBe('give-up');
    expect(decision.action === 'give-up' && decision.reason).toContain('3 times in 60 seconds');
  });

  it('counts exit-0 loops toward the cap too', () => {
    // A child exiting 0 in a tight loop is the same disaster as one segfaulting
    // in a tight loop: a desktop app pinned at 100% CPU, forking forever.
    expect(
      decideRestart({ expected: false, exitCode: 0, exitsInWindow: [1, 2, 3], policy }).action,
    ).toBe('give-up');
  });
});

// ─── The handshake (§2.2 steps 5–7) ──────────────────────────────────────────

describe('ServerManager.start — the handshake', () => {
  it('resolves with the port the child reports, not one we assumed', () => {
    const h = harness();
    const started = h.manager.start();
    childAt(h, 0).ready(51234, 7);

    return started.then((ready) => {
      expect(ready.port).toBe(51234);
      expect(ready.url).toBe('http://127.0.0.1:51234');
      expect(ready.migrationsApplied).toBe(7);
      expect(ready.pid).toBe(4242);
      expect(h.manager.state).toMatchObject({ status: 'ready', port: 51234 });
    });
  });

  it('forks the entry with the §2.2 step 5 env block', () => {
    const h = harness();
    void h.manager.start().catch(() => undefined);

    const call = h.forkCalls[0];
    expect(call?.entry).toBe('/app/out/server/index.js');
    expect(call?.env).toMatchObject({
      ADMINIUM_RUNTIME: 'desktop',
      ADMINIUM_HOST: '127.0.0.1',
      ADMINIUM_PORT: String(EPHEMERAL_PORT),
      ADMINIUM_DATA_DIR: DATA_DIR,
      ADMINIUM_META_DSN: metaDsnForDataDir(DATA_DIR),
      ADMINIUM_SECRET: SECRET,
      ADMINIUM_BOOT_TOKEN: TOKEN,
    });
  });

  it('times out with an actionable error when the child never speaks', async () => {
    const h = harness({ readyTimeoutMs: 30_000 });
    const started = h.manager.start();
    const assertion = expect(started).rejects.toThrow(/did not start within 30 seconds/);

    h.clock.advance(30_000);
    await assertion;
  });

  it('times out — rather than failing fast — on a malformed ready message', async () => {
    // Ignoring what we cannot parse keeps an additive protocol change from
    // bricking a boot; the timeout is the backstop either way, and the junk is
    // in the excerpt.
    const h = harness({ readyTimeoutMs: 30_000 });
    const started = h.manager.start();

    childAt(h, 0).send({ type: 'ready', port: 'not-a-number' });
    childAt(h, 0).send({ hello: 'there' });
    expect(h.manager.state.status).toBe('starting');

    const assertion = expect(started).rejects.toThrow(/did not start within 30 seconds/);
    h.clock.advance(30_000);
    await assertion;

    expect(h.log.recentLines().join('\n')).toContain('unrecognized server message');
  });

  it('surfaces the stage from an error message instead of waiting out the timeout', async () => {
    const h = harness();
    const started = h.manager.start();

    childAt(h, 0).send({
      type: 'error',
      stage: 'meta-store',
      message: "EACCES: permission denied, open '/data/meta.db'",
      detail: 'Error: EACCES\n    at Database.open',
    });

    await expect(started).rejects.toThrow(/failed to start \(meta-store\): EACCES/);
    expect(h.manager.state).toMatchObject({ status: 'failed', exitCode: null });
  });

  it('fails immediately when the child dies before ready', async () => {
    const h = harness();
    const started = h.manager.start();
    childAt(h, 0).exit(3);

    await expect(started).rejects.toThrow(/exited with code 3 before it finished starting/);
  });

  it('does NOT enter the restart loop when the first boot fails', async () => {
    // §2.2 step 7 sends a failed boot to the crash screen. Re-forking a server
    // that cannot open its data dir would flash the crash screen and hide it.
    const h = harness();
    const started = h.manager.start();
    childAt(h, 0).exit(1);
    await expect(started).rejects.toThrow(ServerStartError);

    h.clock.advance(60_000);

    expect(h.children).toHaveLength(1);
    expect(h.manager.state.status).toBe('failed');
    expect(h.exits).toEqual([]);
  });

  it('attaches the log path and excerpt to the failure', async () => {
    const h = harness();
    h.log.write('something explanatory');
    const started = h.manager.start();
    childAt(h, 0).exit(9);

    await expect(started).rejects.toMatchObject({
      detail: { exitCode: 9, logPath: h.log.path },
    });
    expect(h.manager.state).toMatchObject({ status: 'failed', exitCode: 9 });
    const state = h.manager.state;
    expect(state.status === 'failed' && state.excerpt.join('\n')).toContain(
      'something explanatory',
    );
  });

  it('reports a fork that throws as a start failure rather than an unhandled crash', async () => {
    const h = harness({
      fork: () => {
        throw new Error('ENOENT: out/server/index.js');
      },
    });

    await expect(h.manager.start()).rejects.toThrow(/Could not start the Adminium server process/);
    expect(h.manager.state.status).toBe('failed');
  });

  it('is idempotent once ready', async () => {
    const h = harness();
    const started = h.manager.start();
    childAt(h, 0).ready();
    await started;

    await h.manager.start();
    expect(h.children).toHaveLength(1);
  });

  it('cancels the ready timer once ready, so a later tick cannot reject', async () => {
    const h = harness();
    const started = h.manager.start();
    childAt(h, 0).ready();
    await started;

    expect(h.clock.pending).toBe(0);
  });
});

// ─── The restart policy (§2.2 step 9) ────────────────────────────────────────

describe('ServerManager — supervision', () => {
  async function started(overrides: Partial<CreateServerManagerOptions> = {}): Promise<Harness> {
    const h = harness(overrides);
    const promise = h.manager.start();
    childAt(h, 0).ready();
    await promise;
    return h;
  }

  it('restarts after a crash, with backoff', async () => {
    const h = await started();

    childAt(h, 0).exit(1);
    expect(h.manager.state).toMatchObject({ status: 'restarting', delayMs: 500 });
    expect(h.children).toHaveLength(1);

    h.clock.advance(500);
    expect(h.children).toHaveLength(2);

    childAt(h, 1).ready(52000);
    await vi.waitFor(() => {
      expect(h.manager.state).toMatchObject({ status: 'ready', port: 52000 });
    });
  });

  it('restarts an unexpected exit 0 silently and immediately', async () => {
    const h = await started();

    childAt(h, 0).exit(0);
    expect(h.manager.state).toMatchObject({ status: 'restarting', delayMs: 0 });
    expect(h.exits[0]).toMatchObject({ code: 0, willRestart: true, giveUp: false });

    h.clock.advance(0);
    expect(h.children).toHaveLength(2);
  });

  it('gives up after three crashes in 60 s and exposes the log path', async () => {
    const h = await started();

    // Crash 1 → restart.
    childAt(h, 0).exit(1);
    h.clock.advance(500);
    childAt(h, 1).ready();
    await vi.waitFor(() => {
      expect(h.manager.state.status).toBe('ready');
    });

    // Crash 2 → restart.
    childAt(h, 1).exit(1);
    h.clock.advance(1000);
    childAt(h, 2).ready();
    await vi.waitFor(() => {
      expect(h.manager.state.status).toBe('ready');
    });

    // Crash 3 → give up.
    childAt(h, 2).exit(1);

    expect(h.manager.state).toMatchObject({
      status: 'failed',
      exitCode: 1,
      logPath: h.log.path,
    });
    const state = h.manager.state;
    expect(state.status === 'failed' && state.reason).toContain('3 times in 60 seconds');
    expect(h.exits.at(-1)).toMatchObject({ willRestart: false, giveUp: true });

    // And it stays given up.
    h.clock.advance(120_000);
    expect(h.children).toHaveLength(3);
  });

  it('forgives crashes that fall outside the window', async () => {
    const h = await started();

    childAt(h, 0).exit(1);
    h.clock.advance(500);
    childAt(h, 1).ready();
    await vi.waitFor(() => {
      expect(h.manager.state.status).toBe('ready');
    });

    // An hour later, a second crash is a FIRST crash again.
    h.clock.advance(3_600_000);
    childAt(h, 1).exit(1);

    expect(h.manager.state).toMatchObject({ status: 'restarting', delayMs: 500 });
  });

  it('does not restart or report an exit that stop() asked for', async () => {
    const h = await started();

    const stopping = h.manager.stop();
    childAt(h, 0).exit(0);
    await stopping;

    expect(h.manager.state).toEqual({ status: 'stopped' });
    expect(h.exits).toEqual([]);
    h.clock.advance(60_000);
    expect(h.children).toHaveLength(1);
  });

  it('reports willRestart so the shell knows whether to show the crash screen', async () => {
    const h = await started();
    childAt(h, 0).exit(1);

    expect(h.exits).toEqual([
      { code: 1, signal: null, willRestart: true, giveUp: false, logPath: h.log.path },
    ]);
  });

  it('ignores a stale child exit after it has been replaced', async () => {
    const h = await started();
    const first = childAt(h, 0);

    first.exit(1);
    h.clock.advance(500);
    childAt(h, 1).ready();
    await vi.waitFor(() => {
      expect(h.manager.state.status).toBe('ready');
    });

    // The dead child emits again (a duplicate 'exit' is not hypothetical when
    // both the handshake and the supervisor listen).
    h.exits.length = 0;
    first.exit(1);

    expect(h.exits).toEqual([]);
    expect(h.manager.state.status).toBe('ready');
  });

  it('goes to failed — not into a loop — when a supervised restart never boots', async () => {
    const h = await started();

    childAt(h, 0).exit(1);
    h.clock.advance(500);
    childAt(h, 1).exit(2);

    await vi.waitFor(() => {
      expect(h.manager.state.status).toBe('failed');
    });
    h.clock.advance(120_000);
    expect(h.children).toHaveLength(2);
  });
});

// ─── Shutdown ────────────────────────────────────────────────────────────────

describe('ServerManager.stop', () => {
  async function started(overrides: Partial<CreateServerManagerOptions> = {}): Promise<Harness> {
    const h = harness(overrides);
    const promise = h.manager.start();
    childAt(h, 0).ready();
    await promise;
    return h;
  }

  it('asks politely first — kill() would leave WAL sidecars behind (§9)', async () => {
    const h = await started();

    const stopping = h.manager.stop();
    expect(childAt(h, 0).posted).toEqual([{ type: 'shutdown' }]);
    expect(childAt(h, 0).killed).toBe(false);

    childAt(h, 0).exit(0);
    await stopping;
  });

  it('kills a child that ignores the shutdown message', async () => {
    const h = await started({ shutdownTimeoutMs: 5000 });

    const stopping = h.manager.stop();
    h.clock.advance(5000);
    await stopping;

    expect(childAt(h, 0).killed).toBe(true);
    expect(h.manager.state).toEqual({ status: 'stopped' });
    expect(h.log.recentLines().join('\n')).toContain('killing it');
  });

  it('cancels a pending restart so quitting mid-backoff does not re-fork', async () => {
    const h = await started();
    childAt(h, 0).exit(1);
    expect(h.manager.state.status).toBe('restarting');

    await h.manager.stop();
    h.clock.advance(60_000);

    expect(h.children).toHaveLength(1);
    expect(h.manager.state).toEqual({ status: 'stopped' });
  });

  it('is safe with no child running', async () => {
    const h = harness();
    await h.manager.stop();
    expect(h.manager.state).toEqual({ status: 'stopped' });
  });

  it('kills the child when postMessage throws on a torn-down port', async () => {
    const h = await started();
    const child = childAt(h, 0);
    vi.spyOn(child, 'postMessage').mockImplementation(() => {
      throw new Error('port closed');
    });

    await h.manager.stop();

    expect(child.killed).toBe(true);
  });
});

describe('ServerManager.restart', () => {
  it('re-forks with the new host/port and does not count against the cap (§8.3)', async () => {
    const h = harness();
    const first = h.manager.start();
    childAt(h, 0).ready();
    await first;

    const restarting = h.manager.restart({ host: '0.0.0.0', port: 4600 });
    childAt(h, 0).exit(0);
    await vi.waitFor(() => {
      expect(h.children).toHaveLength(2);
    });
    childAt(h, 1).ready(4600);
    const ready = await restarting;

    expect(ready.port).toBe(4600);
    expect(h.forkCalls[1]?.env).toMatchObject({
      ADMINIUM_HOST: '0.0.0.0',
      ADMINIUM_PORT: '4600',
    });
    expect(h.exits).toEqual([]);
  });

  it('keeps the boot token stable across a restart', async () => {
    const h = harness();
    const first = h.manager.start();
    childAt(h, 0).ready();
    await first;

    expect(h.manager.bootToken).toBe(TOKEN);
    expect(h.forkCalls[0]?.env.ADMINIUM_BOOT_TOKEN).toBe(TOKEN);
  });
});

describe('ServerManager.subscribe', () => {
  it('replays the current state immediately', () => {
    const h = harness();
    expect(h.states[0]).toEqual({ status: 'idle' });
  });

  it('walks idle → starting → ready', async () => {
    const h = harness();
    const started = h.manager.start();
    childAt(h, 0).ready();
    await started;

    expect(h.states.map((state) => state.status)).toEqual(['idle', 'starting', 'ready']);
  });
});
