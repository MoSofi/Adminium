/**
 * THE utilityProcess ENTRY (11-electron.md §2.1 topology, §2.2 steps 5–7).
 *
 * This is the whole of the desktop app's server: a wrapper that resolves the
 * §2.2 env block, opens the local SQLite meta store, bootstraps it, composes the
 * REAL server, listens on an OS-assigned loopback port, and reports that port
 * back to the main process over `parentPort`. It contains no business logic and
 * must never grow any (§1 principle 1: "Anything that smells like a feature
 * belongs in `@adminium/server`").
 *
 * ─── `composeServer`, NOT `buildServer` ──────────────────────────────────────
 *
 * §3 describes this file as importing "the exported `buildServer()` factory".
 * Taken literally that is a BUG, and one this repo has already shipped once:
 * `buildServer` is the Fastify SKELETON — six of the seventeen `/api/v1`
 * namespaces the dashboard calls (`compose.ts` header, and the M10 review that
 * found `adminium start` serving an API whose connect wizard 404'd).
 * `composeServer` is the shared composition root that wires the other eleven,
 * and it is what `cli/runtime.ts`'s `startServer` — the working reference — has
 * called ever since. The desktop shell is a wrapper (01 §4: "All four deployment
 * modes run the identical `@adminium/server` process; only the wrapper
 * differs"), so it goes through the same door as every other wrapper. Reaching
 * for `buildServer` here would ship a hollow API to every desktop user.
 *
 * By the same argument the service graph comes from `openRuntime` rather than a
 * hand-rolled copy: it is the one place that opens the meta store via
 * `openMetaStore` (01 §7.2 precedence), registers the adapters, and builds the
 * `ConnectionManager` + run/apply/prompt services. A second assembly of those
 * parts, living here, is precisely the drift the M10 risk register warns about.
 *
 * ─── `firstRun`, NOT `applyMigrations` ───────────────────────────────────────
 *
 * Migrations create `adminium_roles`; nothing in the migration ledger seeds it.
 * A boot that only migrated would serve a first-run wizard whose
 * `POST /setup/super-admin` dies inside `createFirstSuperAdmin` ("built-in roles
 * missing") — permanently, because the claim row rolls back with it and every
 * retry re-fails (`cli/commands/start.ts`, 07-meta-store.md §6). On desktop that
 * failure mode is worse than on self-host: §6's first-run wizard is the app's
 * front door, so the very first launch would dead-end. `firstRun` is the
 * documented idempotent boot entry point — migrate + seed built-in roles + seed
 * `system.*`.
 *
 * ─── Failure reporting ───────────────────────────────────────────────────────
 *
 * Every stage is wrapped so a failure becomes an `error` message on the
 * handshake (§2.2's `{ type: "error", stage, message }`) BEFORE the process
 * exits nonzero. Without it the parent's only signal is a 30 s timeout, and the
 * crash screen can offer the user nothing but a log path.
 */

// EVERYTHING comes through `@adminium/server`, including `firstRun` (which that
// package re-exports from `@adminium/meta` for exactly this caller). The
// 01-architecture.md §2.3 matrix gives this app two inputs — "`@adminium/server`
// (spawned)" and "dashboard build output (static files)" — and no others.
import {
  LATEST_META_MIGRATION,
  composeServer,
  firstRun,
  loadCliEnv,
  metaEngineFromUrl,
  openRuntime,
  resolveStaticRoot,
  type AdminiumServer,
  type CliRuntime,
} from '@adminium/server';

import {
  parseDesktopServerEnv,
  toServerEnvRecord,
  type DesktopServerEnv,
} from './env.js';
import {
  parseParentMessage,
  type ServerBootStage,
  type ServerMessage,
} from './protocol.js';

/**
 * The Electron `parentPort` surface this module actually uses.
 *
 * Declared structurally rather than imported from `electron`: the server bundle
 * has no reason to carry Electron's types (it is plain Node running under
 * Electron's bundled runtime), and a narrow local interface is what lets the
 * suites drive `runServerEntry` with a plain object instead of a real fork.
 */
export interface ParentPortLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  /** Present on `MessagePortMain`; a no-op-safe nudge for queued messages. */
  start?(): void;
}

/** Reads `process.parentPort` without asserting Electron's global augmentation. */
export function resolveParentPort(proc: NodeJS.Process = process): ParentPortLike | null {
  const port = (proc as NodeJS.Process & { parentPort?: ParentPortLike }).parentPort;
  return port ?? null;
}

/** Thrown by a boot stage; carries the stage so the handshake can name it. */
export class BootStageError extends Error {
  override readonly name = 'BootStageError';
  constructor(
    readonly stage: ServerBootStage,
    message: string,
    readonly detail: string | undefined,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

async function stage<T>(name: ServerBootStage, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof BootStageError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const detail = error instanceof Error && error.stack !== undefined ? error.stack : undefined;
    throw new BootStageError(name, message, detail, { cause: error });
  }
}

/**
 * The listening port, read off the socket rather than off the config.
 *
 * With `ADMINIUM_PORT=0` the config says nothing — the OS picked. This is the
 * only place the number exists, and getting it wrong means a window that
 * navigates to a dead origin.
 */
export function resolveListeningPort(app: AdminiumServer): number {
  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error(
      `expected a TCP address after listen, got ${address === null ? 'null' : `"${address}"`}`,
    );
  }
  return address.port;
}

export interface BootedServer {
  app: AdminiumServer;
  runtime: CliRuntime;
  port: number;
  host: string;
  migrationsApplied: number;
  /** The newest migration THIS BUILD ships — see `protocol.ts`'s `migrations.version`. */
  metaMigrationVersion: string;
}

/**
 * The boot, minus the process plumbing. Exported so an integration test can
 * drive it; the suites in this track cover the pure pieces it composes.
 */
export async function bootDesktopServer(
  processEnv: NodeJS.ProcessEnv = process.env,
): Promise<BootedServer> {
  const desktop: DesktopServerEnv = await stage('env', () => parseDesktopServerEnv(processEnv));

  const env = await stage('env', () => {
    // §2.1 is unconditional: "Meta-store is always local SQLite at
    // <dataDir>/meta.db, even when the source DB is a remote Postgres/MySQL."
    // The DSN is normally computed by `buildServerEnv`, so a non-SQLite value
    // means somebody overrode it — refuse rather than quietly opening a remote
    // meta store that takes the user's prefs, pages and sessions offline the
    // moment the network drops (§7: "fully functional with the network cable
    // unplugged, forever").
    const engine = metaEngineFromUrl(desktop.metaDsn);
    if (engine !== 'sqlite') {
      throw new Error(
        `the desktop meta store must be SQLite (11-electron.md §2.1), got "${engine}" ` +
          `from ADMINIUM_META_DSN`,
      );
    }
    return loadCliEnv(toServerEnvRecord(desktop, processEnv));
  });

  const runtime = await stage('meta-store', () =>
    openRuntime(env, {
      // The desktop app's databases ARE local: `<dataDir>/databases/*.sqlite`,
      // and §6 offers "Connect to a server database" against whatever the user
      // can reach — including a Postgres on their own machine. The SSRF guard
      // defaults to `blockLoopback: NODE_ENV === 'production'`, which is exactly
      // what a packaged build sets, so leaving it to the default would make a
      // shipped desktop app refuse the local databases it exists to administer.
      blockLoopback: false,
    }),
  );

  try {
    const { appliedMigrations } = await stage('migrate', () => firstRun(runtime.metaStore.meta));

    const app = await stage('compose', async () => {
      // §3: the packaged build copies the dashboard into `resources/` and points
      // the server's existing static handler at it (`ADMINIUM_STATIC_ROOT`, set
      // by ServerManager). Absent ⇒ the monorepo/tarball candidates ⇒ absent ⇒
      // API only, which is the static plugin's documented degradation.
      const staticRoot = resolveStaticRoot(
        desktop.staticRoot === undefined ? {} : { override: desktop.staticRoot },
      );
      const composed = await composeServer({
        env,
        metaStore: runtime.metaStore,
        manager: runtime.manager,
        runService: runtime.runService,
        applyService: runtime.applyService,
        allowed: runtime.allowed,
        collectStats: runtime.collectStats,
        ...(staticRoot === undefined ? {} : { staticRoot }),
      });
      return composed.app;
    });

    const port = await stage('listen', async () => {
      // §2.4: loopback, and port 0 ⇒ the OS assigns. `desktop.port` is the only
      // value that reaches the socket; `env.PORT` deliberately never does (see
      // `env.ts`).
      await app.listen({ port: desktop.port, host: desktop.host });
      return resolveListeningPort(app);
    });

    return {
      app,
      runtime,
      port,
      host: desktop.host,
      migrationsApplied: appliedMigrations.length,
      metaMigrationVersion: LATEST_META_MIGRATION,
    };
  } catch (error) {
    await runtime.close().catch(() => undefined);
    throw error;
  }
}

/** Close Fastify (which disposes the pools via `onClose`) then the meta store. */
async function shutdown(booted: BootedServer): Promise<void> {
  await booted.app.close().catch(() => undefined);
  await booted.runtime.close().catch(() => undefined);
}

export interface RunServerEntryOptions {
  parentPort: ParentPortLike | null;
  env?: NodeJS.ProcessEnv | undefined;
  /** Test seam. Defaults to `process.exit`. */
  exit?: (code: number) => void;
  /** Test seam. Defaults to `console.error` — piped into the log file by §9. */
  onLog?: (line: string) => void;
}

/**
 * Boot, announce, and wire the shutdown path. Returns the booted server so a
 * caller (or a test) can drive it; on failure it reports `error` over the
 * handshake and exits nonzero, which is what §2.2 step 9 turns into the crash
 * screen.
 */
export async function runServerEntry(opts: RunServerEntryOptions): Promise<BootedServer | null> {
  const port = opts.parentPort;
  const log = opts.onLog ?? ((line: string) => console.error(line));
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const post = (message: ServerMessage): void => {
    if (port === null) {
      // Not forked (someone ran the bundle directly). Say so on stderr rather
      // than crashing — this is a useful debugging mode, and §9 pipes stderr
      // into the log file either way.
      log(`[server] no parentPort; ${JSON.stringify(message)}`);
      return;
    }
    port.postMessage(message);
  };

  let booted: BootedServer;
  try {
    booted = await bootDesktopServer(opts.env ?? process.env);
  } catch (error) {
    const stageName: ServerBootStage = error instanceof BootStageError ? error.stage : 'env';
    const message = error instanceof Error ? error.message : String(error);
    const detail = error instanceof BootStageError ? error.detail : undefined;
    post({
      type: 'error',
      stage: stageName,
      message,
      ...(detail === undefined ? {} : { detail }),
    });
    log(`[server] boot failed at stage "${stageName}": ${message}`);
    exit(1);
    return null;
  }

  if (port !== null) {
    port.on('message', (event) => {
      const parsed = parseParentMessage(event.data);
      if (!parsed.ok) {
        log(`[server] ignoring unrecognized parent message: ${parsed.error}`);
        return;
      }
      void shutdown(booted).then(
        () => exit(0),
        () => exit(1),
      );
    });
    port.start?.();
  }

  post({
    type: 'ready',
    port: booted.port,
    host: booted.host,
    migrations: { applied: booted.migrationsApplied, version: booted.metaMigrationVersion },
  });

  return booted;
}

/**
 * Self-start.
 *
 * `import.meta.url === process.argv[1]` guards do not survive bundling, and
 * `utilityProcess.fork` calls nothing — it just runs the module — so the entry
 * has to start itself. The gate is `ADMINIUM_RUNTIME=desktop`, which
 * `buildServerEnv` always sets, because it is true in both shapes that should
 * boot (forked by ServerManager; `node out/server/index.js` with the env block
 * exported, which is how you debug this thing outside Electron) and false in the
 * one that should not (a vitest worker importing this module for its exports).
 * Keying on `parentPort` instead would silently kill the debugging shape.
 */
if (process.env.ADMINIUM_RUNTIME === 'desktop') {
  void runServerEntry({ parentPort: resolveParentPort() });
}
