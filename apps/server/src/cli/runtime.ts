/**
 * The CLI's composition root.
 *
 * THE GOVERNING RULE (16-milestones.md, M10 risk register): "CLI subcommands
 * share the same server services as the Studio routes; **one code path, two
 * front doors**." This module is where that is made true — it builds the exact
 * service graph `scripts/demo-v01.mjs` and the route wiring build
 * (`ConnectionManager`, `runIntrospection`, `runGeneration`, the run/apply/prompt
 * services), and the subcommands consume nothing else. A command that reached
 * past this into its own query or its own HTTP call would be the drift the risk
 * register warns about.
 *
 * Everything is injectable ({@link CliDeps}) so the subcommand tests drive the
 * dispatcher against fakes: no meta store, no source database, no listening
 * socket.
 */

import { adapterRegistry } from '@adminium/engine/adapter';
import type { AllowedVocabularies } from '@adminium/llm';

import type { AdminiumServer } from '../app.js';
import { composeServer } from '../compose.js';
import { envSchema, formatEnvErrorTable, type Env } from '../config/env.js';
import { ConnectionManager } from '../connections/manager.js';
import { dsnCryptoFromSecret } from '../connections/crypto.js';
import { registerAdapters } from '../connections/register-adapters.js';
import { importZip as defaultImportZip, type ImportZip } from '../export/import-service.js';
import { exportZip as defaultExportZip, type ExportZip } from '../export/zip-service.js';
import { runGeneration } from '../generate/run.js';
import { createApplyService, type ApplyService } from '../llm/apply-service.js';
import { createPromptService, type PromptService } from '../llm/prompt-service.js';
import { createRunService, type RunService } from '../llm/run-service.js';
import { createConnectionStatsCollector } from '../llm/stats-collector.js';
import type { CollectRunStats } from '../llm/prompt-service.js';
import type { OnMetaRelocated } from '../meta/relocate.js';
import { openMetaStore, type MetaStoreHandle } from '../meta/store.js';
import { loadAllowedVocabularies } from './allowlist.js';
import { CliError } from './exit.js';
import { resolveStaticRoot } from './static-root.js';

// ─── Env ─────────────────────────────────────────────────────────────────────

/**
 * Flag overrides applied ON TOP of the process environment. 01 §7.1 makes env
 * the configuration substrate; the CLI's contract is that an explicit flag beats
 * an inherited variable, so they are merged BEFORE the Zod schema runs and the
 * result is validated exactly once, by exactly the existing schema.
 */
export interface EnvOverrides {
  port?: number | undefined;
  host?: string | undefined;
  dataDir?: string | undefined;
  metaUrl?: string | undefined;
  logLevel?: string | undefined;
  /** CSV of origins allowed to hand this instance a DSN — `init --bridge`. */
  bridgeOrigins?: string | undefined;
}

/**
 * Merge overrides into `env` and validate through the existing
 * {@link envSchema}. A missing/short `ADMINIUM_SECRET` is called out on its own
 * because it gates the AES-256-GCM helper that every stored DSN and provider key
 * depends on — booting without it would mean a store that cannot be read back.
 */
export function loadCliEnv(
  env: Record<string, string | undefined>,
  overrides: EnvOverrides = {},
): Env {
  const merged: Record<string, string | undefined> = {
    ...env,
    ...(overrides.port === undefined ? {} : { PORT: String(overrides.port) }),
    ...(overrides.host === undefined ? {} : { HOST: overrides.host }),
    ...(overrides.dataDir === undefined ? {} : { ADMINIUM_DATA_DIR: overrides.dataDir }),
    ...(overrides.metaUrl === undefined ? {} : { ADMINIUM_META_URL: overrides.metaUrl }),
    ...(overrides.logLevel === undefined ? {} : { ADMINIUM_LOG_LEVEL: overrides.logLevel }),
    ...(overrides.bridgeOrigins === undefined
      ? {}
      : { ADMINIUM_BRIDGE_ORIGINS: overrides.bridgeOrigins }),
  };

  const result = envSchema.safeParse(merged);
  if (result.success) return result.data;

  const secretIssue = result.error.issues.some((issue) => issue.path[0] === 'ADMINIUM_SECRET');
  const table = formatEnvErrorTable(result.error.issues);
  throw new CliError(
    secretIssue
      ? 'ADMINIUM_SECRET is required — it derives the key that encrypts every stored DSN and API key.'
      : 'Invalid environment configuration.',
    {
      hint: secretIssue
        ? 'Generate one and re-run, e.g.\n  export ADMINIUM_SECRET=$(openssl rand -hex 32)\n\n' + table
        : table,
    },
  );
}

// ─── Runtime ─────────────────────────────────────────────────────────────────

export interface CliRuntime {
  env: Env;
  metaStore: MetaStoreHandle;
  manager: ConnectionManager;
  runService: RunService;
  applyService: ApplyService;
  /** Present only when the widgets allow-lists could be loaded (LLM commands). */
  promptService: PromptService | null;
  /** The `@adminium/widgets` allow-lists backing {@link promptService}. */
  allowed: AllowedVocabularies | null;
  /** Why {@link promptService} is null, for the command's error message. */
  promptServiceError: Error | null;
  /** §4.2 aggregates over the connection's data role — what `--sampling` needs. */
  collectStats: CollectRunStats;
  close(): Promise<void>;
}

export interface OpenRuntimeOptions {
  /** Loopback DSNs are legitimate for a local self-host install (demo-v01 does this). */
  blockLoopback?: boolean;
}

/**
 * Open the meta store and compose the services. Does NOT bootstrap — `migrate`
 * owns that explicitly, and `start`/`init` call `firstRun` deliberately.
 *
 * The widgets allow-lists are loaded UNCONDITIONALLY (they used to be gated on a
 * `withLlm` flag only the two LLM subcommands passed). `startServer` needs them
 * to register the `/llm` resource, so gating them on the subcommand meant
 * `adminium start` — the actual product — could never serve AI assist, failing
 * M10's "LLM assist available (creds or BYO)" exit criterion. The load is one
 * `existsSync` plus one dynamic import, and a failure is recorded rather than
 * thrown: the LLM subcommands surface it, `start` degrades to no `/llm` routes.
 */
export async function openRuntime(env: Env, opts: OpenRuntimeOptions = {}): Promise<CliRuntime> {
  const metaStore = await openMetaStore({
    metaUrl: env.ADMINIUM_META_URL,
    dataDir: env.ADMINIUM_DATA_DIR,
    secret: env.ADMINIUM_SECRET,
  });

  await registerAdapters(adapterRegistry);

  const manager = new ConnectionManager({
    meta: metaStore.meta,
    crypto: dsnCryptoFromSecret(env.ADMINIUM_SECRET),
    // The embedded fallback has no DSN to collide with (01 §3.1).
    metaDsn: metaStore.source === 'embedded' ? null : metaStore.url,
    ...(opts.blockLoopback === undefined ? {} : { blockLoopback: opts.blockLoopback }),
  });

  // §3.1 pre-flight, and it has to be HERE — before `start`/`init` call
  // `firstRun` — because its whole job is refusing a foreign `adminium_*`
  // namespace while the database is still untouched. See the method for why the
  // migration ledger is what tells our tables from somebody else's.
  await manager.assertMetaPrefixAvailable();

  const runService = createRunService({ meta: metaStore.meta });

  // The real §4.2 collector, not the `NO_STATS` default: `generate-prompt
  // --sampling` promises "sampled example values in the prompt" in its own
  // `--help`, and the prompt service silently omits every aggregate when nobody
  // injects one. Both front doors now inject the same collector (see
  // `startServer` below, which passes it to `composeServer`).
  const collectStats = createConnectionStatsCollector({ manager });

  // Loaded BEFORE the apply service, which needs `allowed.widgetContracts` to
  // bind each widget to a query shape it can read. Still best-effort by design:
  // a missing widget vocabulary costs the AI surface, never the boot (see the
  // module header on degradation), and the planner falls back to inferring the
  // shape from bound columns when the contracts are absent.
  let promptService: PromptService | null = null;
  let allowed: AllowedVocabularies | null = null;
  let promptServiceError: Error | null = null;
  try {
    allowed = await loadAllowedVocabularies();
    promptService = createPromptService({ meta: metaStore.meta, runService, allowed, collectStats });
  } catch (error) {
    promptServiceError = error instanceof Error ? error : new Error(String(error));
  }

  const applyService = createApplyService({
    meta: metaStore.meta,
    runService,
    ...(allowed?.widgetContracts === undefined
      ? {}
      : { widgetContracts: allowed.widgetContracts }),
    // §8.3 step 3 — the real runGeneration-backed hook (both front doors share
    // this service graph): pages pick up the freshly applied overrides, and the
    // apply's `origin: 'llm'` seed rows are expanded into envelopes
    // (generate/materialize-llm.ts). Failures propagate to the caller AFTER the
    // apply is durable — applyRun fires the hook post-commit by design.
    regenerate: async ({ connectionId, appliedBy }) => {
      await runGeneration({ manager, meta: metaStore.meta, connectionId, createdBy: appliedBy });
    },
  });

  return {
    env,
    metaStore,
    manager,
    runService,
    applyService,
    promptService,
    allowed,
    promptServiceError,
    collectStats,
    async close() {
      await manager.disposeAll().catch(() => undefined);
      await metaStore.close();
    },
  };
}

// ─── Server boot ─────────────────────────────────────────────────────────────

export interface StartedServer {
  /** The URL to open — what `start` and the wizard print. */
  url: string;
  /**
   * The local bridge's one-time pairing code, or null when the bridge is off.
   * Surfaced here because the CLI is the ONLY thing that may render it: it is
   * the consent token for a cross-origin hand-off, and the person who needs it
   * is the one looking at this terminal.
   */
  bridgePairingCode: string | null;
  app: AdminiumServer;
  close(): Promise<void>;
}

export interface StartServerOptions {
  /**
   * Fired after a meta relocation commits, so the host can rebuild against the
   * new store (`cli/relocation-host.ts`). Omitted ⇒ the relocation route is not
   * registered at all: a topology with no way to restart itself must not offer
   * a button that half-moves an instance and then keeps serving the old store.
   */
  onMetaRelocated?: OnMetaRelocated | undefined;
}

/** Boot + listen. Injected ({@link CliDeps.startServer}) so tests never bind a port. */
export type StartServer = (
  runtime: CliRuntime,
  opts?: StartServerOptions,
) => Promise<StartedServer>;

/** Loopback and 0.0.0.0 are not clickable — print something a browser can open. */
export function displayUrl(host: string, port: number): string {
  const hostname = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  return `http://${hostname}:${String(port)}`;
}

/**
 * The real boot: the shared composition root (`../compose.ts`) plus `listen`.
 *
 * It used to be `buildServer` alone, which is only the Fastify SKELETON — six of
 * the seventeen `/api/v1` namespaces the dashboard calls. `adminium start`,
 * `adminium init`'s final boot and the Docker CMD therefore all served an API
 * whose connect wizard 404'd; the full wiring existed only inside
 * `scripts/demo-v01.mjs`. `composeServer` is that wiring, moved somewhere the
 * shipped artifact actually reaches (01 §4: "All four deployment modes run the
 * identical `@adminium/server` process; only the wrapper differs").
 */
export const startServer: StartServer = async (runtime, opts = {}) => {
  const { env } = runtime;
  const staticRoot = resolveStaticRoot();
  const { app, bridgePairingCode } = await composeServer({
    env,
    metaStore: runtime.metaStore,
    manager: runtime.manager,
    runService: runtime.runService,
    applyService: runtime.applyService,
    allowed: runtime.allowed,
    collectStats: runtime.collectStats,
    ...(staticRoot === undefined ? {} : { staticRoot }),
    ...(opts.onMetaRelocated === undefined ? {} : { onMetaRelocated: opts.onMetaRelocated }),
  });
  await app.listen({ port: env.PORT, host: env.HOST });
  installSignalShutdown(app);
  return {
    url: displayUrl(env.HOST, env.PORT),
    bridgePairingCode,
    app,
    async close() {
      await app.close();
    },
  };
};

/**
 * Ctrl-C must run `app.close()`, which is what fires the `onClose` hooks that
 * stop the job worker and the cron scheduler (`jobs/register.ts`).
 *
 * WHY THIS EXISTS. `start()` in `../start.ts` has always installed these — but
 * nothing in the CLI calls it (`cli/run.ts` imports `./commands/start.js`, a
 * different module), so every server the CLI boots — `adminium`, `adminium
 * start`, the wizard's final boot — ran with NO signal handler at all. The
 * hooks never fired. If anything then closed the meta store while the process
 * was still alive, `JobWorker.poll` kept ticking against a destroyed Kysely
 * driver and logged a full stack trace once a second, forever. In practice that
 * buries every other line in the terminal within seconds: the observed symptom
 * was a scrollback containing nothing but "job poll failed — driver has already
 * been destroyed", with the actual error the user was looking for scrolled far
 * out of reach.
 *
 * `once` per signal, and a module-level guard, so a process that boots twice
 * (tests, the desktop wrapper) cannot stack listeners and trip Node's
 * MaxListenersExceededWarning.
 */
let signalShutdownInstalled = false;

/**
 * The app the signal handlers close — a MUTABLE holder, not the closed-over
 * `app` argument, because a meta relocation replaces the server mid-process
 * (`cli/relocation-host.ts`). With the argument captured, the handler installed
 * on the first boot kept closing the FIRST app forever: after a relocation,
 * Ctrl-C shut down an already-dead Fastify and exited 0 without ever running
 * the live server's `onClose` hooks, so the job worker and cron scheduler were
 * never stopped. The `once`-per-signal guard below is still right; what has to
 * move is which app it points at.
 */
let shutdownTarget: AdminiumServer | null = null;

/** Re-point the signal handlers after the server has been rebuilt. */
export function setShutdownTarget(app: AdminiumServer): void {
  shutdownTarget = app;
}

export function installSignalShutdown(
  app: AdminiumServer,
  proc: Pick<NodeJS.Process, 'once' | 'exit'> = process,
): void {
  setShutdownTarget(app);
  if (signalShutdownInstalled) return;
  signalShutdownInstalled = true;

  let closing = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    // A second Ctrl-C while the first close is still draining should still be
    // an escape hatch, not a no-op — the user is asking to stop NOW.
    if (closing) {
      proc.exit(130);
      return;
    }
    closing = true;
    const live = shutdownTarget ?? app;
    // `info`, so the wizard's quiet `warn` default stays quiet on Ctrl-C.
    live.log.info({ signal }, 'shutting down');
    live.close().then(
      () => proc.exit(0),
      (error: unknown) => {
        live.log.error({ err: error }, 'error during shutdown');
        proc.exit(1);
      },
    );
  };
  proc.once('SIGTERM', () => shutdown('SIGTERM'));
  proc.once('SIGINT', () => shutdown('SIGINT'));
}

// ─── Injected dependency bag ─────────────────────────────────────────────────

export interface CliDeps {
  env: Record<string, string | undefined>;
  cwd: string;
  /** Opens the shared service graph. */
  openRuntime: (env: Env, opts?: OpenRuntimeOptions) => Promise<CliRuntime>;
  /** Boots + listens. */
  startServer: StartServer;
  /** M10-T03's bundler. */
  exportZip: ExportZip;
  /** M10-T03's restore path — the same service a Studio upload route would call. */
  importZip: ImportZip;
  /** Launches the setup wizard's browser mode. Resolves false when it could not. */
  openBrowser: OpenBrowser;
}

/** Injected so the wizard tests never shell out. */
export type OpenBrowser = (url: string) => Promise<boolean>;

/** Per-platform "open this URL in the default browser" command. */
function browserCommand(platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === 'darwin') return { command: 'open', args: [] };
  if (platform === 'win32') {
    // `start` is a cmd builtin, and its first quoted operand is taken as the
    // window TITLE — hence the empty one, or a URL in quotes never opens.
    return { command: 'cmd', args: ['/c', 'start', ''] };
  }
  return { command: 'xdg-open', args: [] };
}

/**
 * Open `url` in the default browser, best-effort.
 *
 * Never throws and never blocks: a headless box, a locked-down desktop or a
 * missing `xdg-open` is an ordinary outcome, not a setup failure — the caller
 * prints the URL either way. The child is detached and `unref`ed so a browser
 * that outlives this process cannot hold the terminal open.
 */
export const openBrowser: OpenBrowser = async (url) => {
  // Only ever called with a URL this process just bound, but the check is cheap
  // and keeps a future caller from turning this into a shell-injection sink.
  if (!/^https?:\/\//.test(url)) return false;
  try {
    const { spawn } = await import('node:child_process');
    const { command, args } = browserCommand(process.platform);
    const child = spawn(command, [...args, url], { stdio: 'ignore', detached: true });
    return await new Promise<boolean>((resolve) => {
      child.on('error', () => {
        resolve(false);
      });
      // No 'spawn' event within a tick of the error window means it launched.
      child.on('spawn', () => {
        child.unref();
        resolve(true);
      });
    });
  } catch {
    return false;
  }
};

export function defaultCliDeps(): CliDeps {
  return {
    env: process.env,
    cwd: process.cwd(),
    openRuntime,
    startServer,
    exportZip: defaultExportZip,
    importZip: defaultImportZip,
    openBrowser,
  };
}
