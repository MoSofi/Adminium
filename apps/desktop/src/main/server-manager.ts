// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ServerManager — forks, supervises and shuts down the embedded server
 * (11-electron.md §2.1 topology, §2.2 boot sequence steps 5/7/9).
 *
 * ─── Nothing here needs Electron ─────────────────────────────────────────────
 *
 * The fork function is a DEPENDENCY ({@link CreateServerManagerOptions.fork}),
 * as are the clock, the timers and the log. The default fork is the real
 * `utilityProcess.fork`; the suites pass a fake child and never load Electron at
 * all. That seam is not decoration: a real Electron app cannot be launched in
 * CI, so anything reachable only from inside `utilityProcess.fork` is code whose
 * first execution happens on a user's machine. The handshake, the restart
 * arithmetic and the env contract are the parts most likely to be wrong, so they
 * are the parts kept on this side of the seam.
 *
 * ─── The restart policy, and where it departs from a naive reading ───────────
 *
 * §2.2 step 9: "exit code 0 (deliberate restart, e.g. LAN toggle) ⇒ silent
 * restart; nonzero ⇒ crash screen … Three crashes within 60 s ⇒ stop
 * auto-restarting and show the log path."
 *
 * Three things that reading leaves open, decided here:
 *
 * 1. **"Exit code 0 ⇒ restart" cannot be unconditional.** `stop()` — the quit
 *    path — exits 0 BY DESIGN. Restarting there would resurrect the server while
 *    the app is closing and hang `app.quit()` behind a child it keeps
 *    re-forking. So exits the manager ASKED for are never restarted; the exit
 *    code only classifies the ones it did not.
 * 2. **The 3-in-60 s cap counts every unexpected exit, not only nonzero ones.**
 *    A child exiting 0 in a tight loop is the same user-visible disaster as one
 *    segfaulting in a tight loop — a desktop app pinned at 100% CPU forking
 *    forever — and this cap is the only thing standing between us and it. Only
 *    nonzero exits are *reported* as crashes; both are counted.
 * 3. **Exits before `ready` are the handshake's business, not the policy's**
 *    (see {@link ServerManagerImpl}'s `#supervise`). §2.2 step 7 sends a failed
 *    boot to the crash screen; re-forking a server that cannot open its data
 *    directory just delays the same dialog.
 *
 * Backoff is layered on top (the "supervised restart" part): §2.2 asks for a
 * silent restart, not an instant one, and re-forking a server that died on a
 * locked SQLite file succeeds 500 ms later where it fails at 0 ms. A deliberate
 * exit-0 restart keeps a 0 ms delay, so §8.3's LAN toggle stays snappy.
 */

import { utilityProcess } from 'electron';

import {
  buildServerEnv,
  LOOPBACK_HOST,
  type BuildServerEnvInput,
  type DesktopLogLevel,
} from '../server/env.js';
import { parseServerMessage, type ServerReadyMessage } from '../server/protocol.js';
import {
  createDesktopLogging,
  createMemoryLogSink,
  pipeStreamToLog,
  type LogSink,
  type ReadableLike,
} from './logging.js';

// ─── The child, structurally ─────────────────────────────────────────────────

/**
 * The slice of Electron's `UtilityProcess` this module uses.
 *
 * Structural rather than `import type { UtilityProcess } from 'electron'` so a
 * test can hand over a plain object literal without satisfying a 30-member
 * EventEmitter.
 */
export interface ServerChildLike {
  readonly pid?: number | undefined;
  postMessage(message: unknown): void;
  kill(): boolean;
  readonly stdout?: ReadableLike | null | undefined;
  readonly stderr?: ReadableLike | null | undefined;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
}

export interface ForkOptions {
  /** Absolute path of the built entry — `out/server/index.js` (§2.1). */
  entry: string;
  env: Record<string, string>;
}

/** Injected. Defaults to {@link utilityProcessFork}. */
export type ForkServer = (opts: ForkOptions) => ServerChildLike;

/**
 * The real fork.
 *
 * `stdio: ['ignore', 'pipe', 'pipe']` is the load-bearing part. The default
 * (`inherit`) sends the child's output to the terminal that launched the app —
 * which, for a packaged desktop app double-clicked in Finder, is nowhere at all.
 * §9 requires those two streams land in `adminium-server.log`, and they can only
 * be piped if they are pipes.
 */
export const utilityProcessFork: ForkServer = ({ entry, env }) =>
  utilityProcess.fork(entry, [], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    serviceName: 'adminium-server',
  }) as unknown as ServerChildLike;

// ─── State ───────────────────────────────────────────────────────────────────

export interface ServerReadyInfo {
  host: string;
  /** The RESOLVED port — with `ADMINIUM_PORT=0` this message is where it exists. */
  port: number;
  /** `http://127.0.0.1:<port>` (§2.2 step 8). */
  url: string;
  migrationsApplied: number;
  /**
   * The newest meta migration this app's server build ships (§9, 11-T12).
   *
   * The handshake is the ONLY way this reaches the main process — see
   * `server/protocol.ts`'s `migrations.version`. §9's restore refuses a backup
   * newer than this, and it must do so before it touches any data.
   */
  metaVersion: string;
  pid: number | undefined;
}

export type ServerState =
  | { readonly status: 'idle' }
  | { readonly status: 'starting'; readonly attempt: number }
  | ({ readonly status: 'ready' } & ServerReadyInfo)
  | {
      readonly status: 'restarting';
      readonly attempt: number;
      readonly delayMs: number;
      readonly reason: string;
    }
  | { readonly status: 'stopped' }
  /** The give-up state §2.2 step 9's crash page renders. */
  | {
      readonly status: 'failed';
      readonly reason: string;
      readonly exitCode: number | null;
      /** "Show logs" target (§9). */
      readonly logPath: string;
      /** The excerpt §2.2 step 7 asks the crash screen to show. */
      readonly excerpt: readonly string[];
    };

export type ServerStateListener = (state: ServerState) => void;

/**
 * What `main/index.ts` renders a crash screen from (§2.2 step 9).
 *
 * Emitted ONLY for exits that were neither asked for nor pre-`ready`: a quit, a
 * deliberate `restart()`, and a boot that never handshook are all already
 * handled by whoever called `stop`/`restart`/`start`, and re-reporting them here
 * would flash a crash screen over a perfectly normal shutdown.
 */
export interface ServerExit {
  code: number | null;
  /**
   * Always `null` today: Electron's `UtilityProcess` `exit` event reports a code
   * and no signal. Present because a killed child is a real case the crash copy
   * distinguishes, and because the field is cheaper to carry than to add later.
   */
  signal: string | null;
  /** False ⇒ the shell should show the crash screen. */
  willRestart: boolean;
  /** True ⇒ the 3-in-60 s cap tripped; "Restart server" is the user's move now. */
  giveUp: boolean;
  logPath: string;
}

export type ServerExitListener = (exit: ServerExit) => void;

// ─── Restart policy (pure) ───────────────────────────────────────────────────

export interface RestartPolicy {
  /** §2.2: "Three crashes within 60 s ⇒ stop auto-restarting". */
  maxRestarts: number;
  windowMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RESTART_POLICY: RestartPolicy = {
  maxRestarts: 3,
  windowMs: 60_000,
  baseDelayMs: 500,
  maxDelayMs: 5_000,
};

/** §2.2 step 7: "Timeout 30 s ⇒ crash screen with log excerpt." */
export const DEFAULT_READY_TIMEOUT_MS = 30_000;
/** How long a `shutdown` message gets before `kill()`. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
/** Lines of log attached to a failure. Enough for a stack, short enough to read. */
export const CRASH_EXCERPT_LINES = 20;

export type RestartDecision =
  | { readonly action: 'none' }
  | { readonly action: 'restart'; readonly delayMs: number; readonly attempt: number }
  | { readonly action: 'give-up'; readonly reason: string };

export interface RestartDecisionInput {
  /** True when `stop()`/`restart()` asked for this exit. */
  expected: boolean;
  exitCode: number | null;
  /** Timestamps of unexpected exits inside the window, INCLUDING this one. */
  exitsInWindow: readonly number[];
  policy: RestartPolicy;
}

/**
 * The whole of §2.2 step 9, as arithmetic. Extracted from the manager because a
 * restart loop is easy to write, hard to observe, and catastrophic when wrong —
 * this way the cap is a table of inputs and outputs rather than a claim.
 */
export function decideRestart(input: RestartDecisionInput): RestartDecision {
  if (input.expected) return { action: 'none' };

  const count = input.exitsInWindow.length;
  if (count >= input.policy.maxRestarts) {
    const seconds = Math.round(input.policy.windowMs / 1000);
    return {
      action: 'give-up',
      reason:
        `The server stopped ${String(count)} times in ${String(seconds)} seconds. ` +
        'Adminium has stopped restarting it automatically.',
    };
  }

  // Exit 0 unexpectedly = the server restarted itself on purpose (§2.2 names the
  // LAN toggle). Nothing is wrong, so nothing is throttled.
  if (input.exitCode === 0) return { action: 'restart', delayMs: 0, attempt: count };

  const delayMs = Math.min(
    input.policy.baseDelayMs * 2 ** Math.max(0, count - 1),
    input.policy.maxDelayMs,
  );
  return { action: 'restart', delayMs, attempt: count };
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/** A boot that never reached `ready`. Carries what the crash page needs. */
export class ServerStartError extends Error {
  override readonly name = 'ServerStartError';
  constructor(
    message: string,
    readonly detail: {
      readonly logPath: string;
      readonly excerpt: readonly string[];
      readonly exitCode: number | null;
    },
  ) {
    super(message);
  }
}

// ─── Options ─────────────────────────────────────────────────────────────────

export interface TimerApi {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_TIMERS: TimerApi = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export interface CreateServerManagerOptions {
  /** Absolute path of `out/server/index.js` (§2.1). */
  entry: string;
  /** §2.3 `dataDir`, absolute. */
  dataDir: string;
  /** The decrypted `ADMINIUM_SECRET` (§2.2 step 3). */
  secret: string;
  /**
   * Mints §2.2 step 4's boot token. Called ONCE PER FORK, not once per app
   * launch — read {@link ServerManager.bootToken} after `ready` to learn the
   * live child's token, and never cache the value across a restart.
   *
   * ─── WHY A FACTORY AND NOT THE TOKEN ─────────────────────────────────────
   *
   * This used to take a `bootToken: string`, minted once at `main/index.ts`'s
   * step 4 and re-emitted into `#buildEnv()` on every fork. Each fresh child
   * therefore built a fresh `createBootTokenGuard(T)` with `consumed = false`
   * — so the SAME token bought a SECOND passwordless super-admin session after
   * every LAN toggle and every crash auto-restart (up to 3 per 60 s). §5 says
   * "one success per boot token"; what the code delivered was one success per
   * child process, with the token's real lifetime being the whole app run.
   *
   * `routes/auth/desktop-session.ts` documents the invariant this restores:
   * "a restarted server is a new boot with a new token — which is exactly why
   * 'a token from a previous boot' fails: nothing in this process ever heard of
   * it". That was false for every in-run restart. Minting per fork is what
   * makes it true, and it is a factory rather than a `setBootToken()` setter
   * precisely so no restart path can forget to call it — the crash-restart loop
   * never would have.
   */
  createBootToken: () => string;
  /**
   * §2.3 `singleUser`, mirrored into `adminium_settings` by the child at boot so
   * §5's auto-login route can read it. Required for the reason
   * {@link BuildServerEnvInput.singleUser} gives: forgetting it is a silent 403
   * on every launch, not a compile error.
   */
  singleUser: boolean;
  /** §2.4/§8.3. Defaults to loopback; only the LAN toggle passes `0.0.0.0`. */
  host?: string | undefined;
  /** Defaults to 0 — the §2.1 random free port. */
  port?: number | undefined;
  telemetryOptIn?: boolean | undefined;
  logLevel?: DesktopLogLevel | undefined;
  /** §3: the dashboard build inside `resources/`. */
  staticRoot?: string | undefined;
  /** §6 step 2 card 4: `resources/demo/demo-seed.mjs` (11-T08). */
  demoSeedScript?: string | undefined;
  /** 32-T11: `resources/add-ons-bundle`, the pre-verified bundled add-on set. */
  bundledAddOnsDir?: string | undefined;
  /**
   * §9's `<userData>/logs`. Given it, the manager writes the child's stdout and
   * stderr into a rotating `adminium-server.log`. Omitted (and with no explicit
   * `log`), it keeps the last lines in memory only — enough for the crash screen
   * excerpt, but "Show logs" has nothing to reveal.
   */
  logsDir?: string | undefined;
  /** Overrides {@link CreateServerManagerOptions.logsDir}. Injected by the suites. */
  log?: LogSink | undefined;
  readyTimeoutMs?: number | undefined;
  shutdownTimeoutMs?: number | undefined;
  restartPolicy?: Partial<RestartPolicy> | undefined;
  /** Test seams. */
  fork?: ForkServer | undefined;
  timers?: TimerApi | undefined;
  now?: (() => number) | undefined;
  inheritEnv?: NodeJS.ProcessEnv | undefined;
}

/** The port `main/index.ts` drives (§2.2 steps 5, 7 and 9). */
export interface ServerManager {
  readonly state: ServerState;
  /**
   * The token handed to the LIVE child, mirrored for the §2.2 step 8 URL, or
   * `null` before the first fork.
   *
   * Re-read after every `ready` — it is minted PER FORK, so a value cached
   * across a restart is one the running server has never heard of. See
   * {@link CreateServerManagerOptions.createBootToken}.
   */
  readonly bootToken: string | null;
  /** §2.2 steps 5–7. Resolves with the RESOLVED port. */
  start(): Promise<ServerReadyInfo>;
  /** Graceful: `shutdown` message, then `kill()` if ignored. */
  stop(): Promise<void>;
  /** Deliberate (§8.3's LAN toggle). Not throttled, not counted. */
  restart(changes?: { host?: string; port?: number }): Promise<ServerReadyInfo>;
  /** Unexpected post-`ready` exits only. Returns an unsubscribe. */
  onExit(listener: ServerExitListener): () => void;
  /** Every state transition, called immediately with the current one. */
  subscribe(listener: ServerStateListener): () => void;
}

export function createServerManager(opts: CreateServerManagerOptions): ServerManager {
  return new ServerManagerImpl(opts);
}

// ─── The manager ─────────────────────────────────────────────────────────────

class ServerManagerImpl implements ServerManager {
  readonly #opts: CreateServerManagerOptions;
  readonly #log: LogSink;
  readonly #timers: TimerApi;
  readonly #now: () => number;
  readonly #policy: RestartPolicy;
  readonly #fork: ForkServer;
  readonly #stateListeners = new Set<ServerStateListener>();
  readonly #exitListeners = new Set<ServerExitListener>();

  #state: ServerState = { status: 'idle' };
  #child: ServerChildLike | null = null;
  /** `run` ⇒ §2.2 step 9 applies to an exit; anything else ⇒ we asked for it. */
  #intent: 'run' | 'stopping' | 'restarting' = 'run';
  /**
   * True only between `ready` and the next exit.
   *
   * An exit BEFORE `ready` is the handshake's failure to report, not the restart
   * policy's. Without this flag both fire: the handshake rejects into `failed`
   * and the exit listener simultaneously schedules a restart that overwrites it
   * a few hundred milliseconds later — the crash screen would appear and then
   * vanish, and a server that cannot open its data directory would fork forever.
   */
  #supervise = false;
  /** Timestamps of unexpected exits, for the 3-in-60 s cap. */
  #unexpectedExits: number[] = [];
  #restartTimer: unknown = null;
  /** Resolved by the exit listener so `stop()` can await a graceful close. */
  readonly #exitWaiters = new Set<(code: number) => void>();
  /** §8.3 flips these and restarts; nothing in Wave 1 does. */
  #host: string;
  #port: number | undefined;
  /**
   * The token the LIVE child was forked with, or `null` before the first fork.
   *
   * `null` is a real state and not a placeholder: until a child exists there is
   * no boot, and §5's token is a per-boot fact. Callers that navigate the window
   * read this AFTER `ready`.
   */
  #bootToken: string | null = null;

  constructor(opts: CreateServerManagerOptions) {
    this.#opts = opts;
    this.#log =
      opts.log ??
      (opts.logsDir === undefined
        ? createMemoryLogSink()
        : createDesktopLogging({ logsDir: opts.logsDir }).server);
    this.#timers = opts.timers ?? REAL_TIMERS;
    this.#now = opts.now ?? Date.now;
    this.#policy = { ...DEFAULT_RESTART_POLICY, ...opts.restartPolicy };
    this.#fork = opts.fork ?? utilityProcessFork;
    this.#host = opts.host ?? LOOPBACK_HOST;
    this.#port = opts.port;
  }

  get state(): ServerState {
    return this.#state;
  }

  /**
   * The live child's §5 token, or `null` before the first fork.
   *
   * Re-read it after every `ready`. A caller holding one across a restart is
   * holding a token the running server has never heard of — which is the whole
   * point (see {@link CreateServerManagerOptions.createBootToken}).
   */
  get bootToken(): string | null {
    return this.#bootToken;
  }

  subscribe(listener: ServerStateListener): () => void {
    this.#stateListeners.add(listener);
    listener(this.#state);
    return () => this.#stateListeners.delete(listener);
  }

  onExit(listener: ServerExitListener): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  /**
   * §2.2 steps 5–7. Resolves once the child reports its port; rejects with a
   * {@link ServerStartError} carrying the log excerpt if it never does.
   */
  async start(): Promise<ServerReadyInfo> {
    if (this.#state.status === 'ready') return readyInfo(this.#state);
    this.#intent = 'run';
    this.#setState({ status: 'starting', attempt: 0 });
    return this.#spawnOrFail();
  }

  /**
   * Graceful shutdown: `{ type: "shutdown" }` first — which lets Fastify run its
   * `onClose` hooks (pool disposal, and §9's `wal_checkpoint(TRUNCATE)` so the
   * `.sqlite` files are self-contained at rest) — and `kill()` only if the child
   * ignores it. Killing first leaves WAL sidecars next to every database.
   */
  async stop(): Promise<void> {
    this.#cancelRestartTimer();
    const child = this.#child;
    if (child === null) {
      this.#setState({ status: 'stopped' });
      return;
    }
    this.#intent = 'stopping';
    await this.#closeChild(child);
    this.#setState({ status: 'stopped' });
  }

  /**
   * Stop and start again, deliberately (§8.3's LAN toggle is the caller). Not
   * throttled and not counted against the cap: the user asked for it.
   */
  async restart(changes: { host?: string; port?: number } = {}): Promise<ServerReadyInfo> {
    this.#cancelRestartTimer();
    if (changes.host !== undefined) this.#host = changes.host;
    if (changes.port !== undefined) this.#port = changes.port;

    const child = this.#child;
    if (child !== null) {
      this.#intent = 'restarting';
      await this.#closeChild(child);
    }
    this.#unexpectedExits = [];
    this.#intent = 'run';
    this.#setState({ status: 'starting', attempt: 0 });
    return this.#spawnOrFail();
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  async #spawnOrFail(): Promise<ServerReadyInfo> {
    try {
      return await this.#spawnAndWait();
    } catch (error) {
      this.#failFrom(error);
      throw error;
    }
  }

  #setState(state: ServerState): void {
    this.#state = state;
    for (const listener of this.#stateListeners) listener(state);
  }

  #failFrom(error: unknown): void {
    const detail = error instanceof ServerStartError ? error.detail : null;
    this.#setState({
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
      exitCode: detail?.exitCode ?? null,
      logPath: this.#log.path,
      excerpt: detail?.excerpt ?? this.#log.recentLines(CRASH_EXCERPT_LINES),
    });
  }

  /**
   * Called exactly once per `#spawnAndWait`, which is what makes the mint below
   * exactly one token per child. If this ever grows a second call site per
   * spawn, the fork and the window would disagree about the token and §5's
   * auto-login would 401 — move the mint into `#spawnAndWait` rather than
   * letting `#buildEnv` become non-idempotent.
   */
  #buildEnv(): Record<string, string> {
    // Step 4, per FORK. The previous child's token dies with it: nothing in the
    // new process has ever heard of it, which is precisely the property §5's
    // "one success per boot token" needs and the old once-per-launch token did
    // not have.
    this.#bootToken = this.#opts.createBootToken();
    const input: BuildServerEnvInput = {
      dataDir: this.#opts.dataDir,
      secret: this.#opts.secret,
      bootToken: this.#bootToken,
      singleUser: this.#opts.singleUser,
      host: this.#host,
      ...(this.#port === undefined ? {} : { port: this.#port }),
      ...(this.#opts.telemetryOptIn === undefined
        ? {}
        : { telemetryOptIn: this.#opts.telemetryOptIn }),
      ...(this.#opts.logLevel === undefined ? {} : { logLevel: this.#opts.logLevel }),
      ...(this.#opts.staticRoot === undefined ? {} : { staticRoot: this.#opts.staticRoot }),
      ...(this.#opts.demoSeedScript === undefined
        ? {}
        : { demoSeedScript: this.#opts.demoSeedScript }),
      ...(this.#opts.bundledAddOnsDir === undefined
        ? {}
        : { bundledAddOnsDir: this.#opts.bundledAddOnsDir }),
      ...(this.#opts.inheritEnv === undefined ? {} : { inherit: this.#opts.inheritEnv }),
    };
    return buildServerEnv(input);
  }

  /** One fork + one handshake. */
  async #spawnAndWait(): Promise<ServerReadyInfo> {
    this.#supervise = false;
    const env = this.#buildEnv();

    let child: ServerChildLike;
    try {
      child = this.#fork({ entry: this.#opts.entry, env });
    } catch (error) {
      throw new ServerStartError(
        `Could not start the Adminium server process: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          logPath: this.#log.path,
          excerpt: this.#log.recentLines(CRASH_EXCERPT_LINES),
          exitCode: null,
        },
      );
    }

    this.#child = child;

    // §9: pipe both streams before anything can be written to them — a boot that
    // dies in its first 50 ms is the one whose output matters most.
    if (child.stdout !== null && child.stdout !== undefined) {
      pipeStreamToLog(child.stdout, this.#log, '[server:out]');
    }
    if (child.stderr !== null && child.stderr !== undefined) {
      pipeStreamToLog(child.stderr, this.#log, '[server:err]');
    }

    const ready = this.#awaitReady(child);
    child.on('exit', (code) => {
      this.#onExit(child, code);
    });

    const message = await ready;
    const info: ServerReadyInfo = {
      host: message.host,
      port: message.port,
      url: `http://${message.host}:${String(message.port)}`,
      migrationsApplied: message.migrations.applied,
      metaVersion: message.migrations.version,
      pid: child.pid,
    };
    this.#supervise = true;
    this.#setState({ status: 'ready', ...info });
    this.#log.write(
      `[main] server ready on ${info.url} (pid ${String(info.pid ?? 'unknown')}, ` +
        `${String(info.migrationsApplied)} migration(s) applied)`,
    );
    return info;
  }

  /**
   * The §2.2 step 7 handshake.
   *
   * Three ways to lose: an `error` message (the child said why), an exit before
   * `ready` (it died), or silence for 30 s (it hung). A MALFORMED message is
   * deliberately NOT a fourth — it is logged and ignored, so a child babbling
   * junk lands on the timeout with its babble in the log excerpt rather than
   * failing instantly on a message we may simply not understand yet. That keeps
   * an additive protocol change from bricking a boot, and it costs nothing: the
   * timeout is the backstop either way.
   */
  #awaitReady(child: ServerChildLike): Promise<ServerReadyMessage> {
    return new Promise<ServerReadyMessage>((resolve, reject) => {
      let settled = false;
      const timeoutMs = this.#opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        this.#timers.clearTimeout(timer);
        fn();
      };

      const fail = (reason: string, exitCode: number | null): void => {
        finish(() => {
          reject(
            new ServerStartError(reason, {
              logPath: this.#log.path,
              excerpt: this.#log.recentLines(CRASH_EXCERPT_LINES),
              exitCode,
            }),
          );
        });
      };

      const timer = this.#timers.setTimeout(() => {
        fail(
          `The Adminium server did not start within ${String(
            Math.round(timeoutMs / 1000),
          )} seconds. See the log for details: ${this.#log.path}`,
          null,
        );
      }, timeoutMs);

      child.on('message', (raw) => {
        const parsed = parseServerMessage(raw);
        if (!parsed.ok) {
          this.#log.write(`[main] ignoring unrecognized server message: ${parsed.error}`);
          return;
        }
        if (parsed.message.type === 'error') {
          const { stage, message, detail } = parsed.message;
          if (detail !== undefined) this.#log.write(`[server:err] ${detail}`);
          fail(`The Adminium server failed to start (${stage}): ${message}`, null);
          return;
        }
        const ready = parsed.message;
        finish(() => {
          resolve(ready);
        });
      });

      child.on('exit', (code) => {
        fail(
          `The Adminium server exited with code ${String(code)} before it finished starting. ` +
            `See the log for details: ${this.#log.path}`,
          code,
        );
      });
    });
  }

  #onExit(child: ServerChildLike, code: number): void {
    // A stale child's exit (we already replaced it) must not drive state.
    if (this.#child !== child) return;
    this.#child = null;

    for (const waiter of this.#exitWaiters) waiter(code);
    this.#exitWaiters.clear();

    const expected = this.#intent !== 'run';
    this.#log.write(
      `[main] server process exited with code ${String(code)}${expected ? ' (expected)' : ''}`,
    );
    if (expected) return;

    // Pre-`ready` exits belong to the handshake (see `#supervise`).
    if (!this.#supervise) return;
    this.#supervise = false;

    const now = this.#now();
    this.#unexpectedExits = [
      ...this.#unexpectedExits.filter((at) => now - at < this.#policy.windowMs),
      now,
    ];

    const decision = decideRestart({
      expected: false,
      exitCode: code,
      exitsInWindow: this.#unexpectedExits,
      policy: this.#policy,
    });

    this.#emitExit({
      code,
      signal: null,
      willRestart: decision.action === 'restart',
      giveUp: decision.action === 'give-up',
      logPath: this.#log.path,
    });

    if (decision.action === 'none') return;

    if (decision.action === 'give-up') {
      this.#log.write(`[main] ${decision.reason}`);
      this.#setState({
        status: 'failed',
        reason: decision.reason,
        exitCode: code,
        logPath: this.#log.path,
        excerpt: this.#log.recentLines(CRASH_EXCERPT_LINES),
      });
      return;
    }

    const reason =
      code === 0
        ? 'The server restarted itself.'
        : `The server stopped unexpectedly (exit code ${String(code)}).`;
    this.#setState({
      status: 'restarting',
      attempt: decision.attempt,
      delayMs: decision.delayMs,
      reason,
    });
    this.#log.write(
      `[main] restarting the server in ${String(decision.delayMs)}ms ` +
        `(attempt ${String(decision.attempt)})`,
    );
    this.#restartTimer = this.#timers.setTimeout(() => {
      this.#restartTimer = null;
      void this.#spawnAndWait().catch((error: unknown) => {
        this.#failFrom(error);
      });
    }, decision.delayMs);
  }

  #emitExit(exit: ServerExit): void {
    for (const listener of this.#exitListeners) listener(exit);
  }

  #cancelRestartTimer(): void {
    if (this.#restartTimer !== null) {
      this.#timers.clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }
  }

  /** Post `shutdown`, wait, then `kill()`. Resolves once the child is gone. */
  #closeChild(child: ServerChildLike): Promise<void> {
    const timeoutMs = this.#opts.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        this.#timers.clearTimeout(timer);
        this.#exitWaiters.delete(waiter);
        resolve();
      };
      const waiter = (): void => {
        done();
      };
      this.#exitWaiters.add(waiter);

      const timer = this.#timers.setTimeout(() => {
        this.#log.write(
          `[main] the server ignored the shutdown request for ${String(timeoutMs)}ms; killing it`,
        );
        child.kill();
        done();
      }, timeoutMs);

      try {
        child.postMessage({ type: 'shutdown' });
      } catch {
        // The port is already torn down — the child is on its way out anyway.
        child.kill();
        done();
      }
    });
  }
}

function readyInfo(state: Extract<ServerState, { status: 'ready' }>): ServerReadyInfo {
  return {
    host: state.host,
    port: state.port,
    url: state.url,
    migrationsApplied: state.migrationsApplied,
    metaVersion: state.metaVersion,
    pid: state.pid,
  };
}
