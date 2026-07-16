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
import { createApplyService, type ApplyService } from '../llm/apply-service.js';
import { createPromptService, type PromptService } from '../llm/prompt-service.js';
import { createRunService, type RunService } from '../llm/run-service.js';
import { createConnectionStatsCollector } from '../llm/stats-collector.js';
import type { CollectRunStats } from '../llm/prompt-service.js';
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

  const runService = createRunService({ meta: metaStore.meta });
  const applyService = createApplyService({ meta: metaStore.meta, runService });

  // The real §4.2 collector, not the `NO_STATS` default: `generate-prompt
  // --sampling` promises "sampled example values in the prompt" in its own
  // `--help`, and the prompt service silently omits every aggregate when nobody
  // injects one. Both front doors now inject the same collector (see
  // `startServer` below, which passes it to `composeServer`).
  const collectStats = createConnectionStatsCollector({ manager });

  let promptService: PromptService | null = null;
  let allowed: AllowedVocabularies | null = null;
  let promptServiceError: Error | null = null;
  try {
    allowed = await loadAllowedVocabularies();
    promptService = createPromptService({ meta: metaStore.meta, runService, allowed, collectStats });
  } catch (error) {
    promptServiceError = error instanceof Error ? error : new Error(String(error));
  }

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
  app: AdminiumServer;
  close(): Promise<void>;
}

/** Boot + listen. Injected ({@link CliDeps.startServer}) so tests never bind a port. */
export type StartServer = (runtime: CliRuntime) => Promise<StartedServer>;

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
export const startServer: StartServer = async (runtime) => {
  const { env } = runtime;
  const staticRoot = resolveStaticRoot();
  const { app } = await composeServer({
    env,
    metaStore: runtime.metaStore,
    manager: runtime.manager,
    runService: runtime.runService,
    applyService: runtime.applyService,
    allowed: runtime.allowed,
    collectStats: runtime.collectStats,
    ...(staticRoot === undefined ? {} : { staticRoot }),
  });
  await app.listen({ port: env.PORT, host: env.HOST });
  return {
    url: displayUrl(env.HOST, env.PORT),
    app,
    async close() {
      await app.close();
    },
  };
};

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
}

export function defaultCliDeps(): CliDeps {
  return {
    env: process.env,
    cwd: process.cwd(),
    openRuntime,
    startServer,
    exportZip: defaultExportZip,
    importZip: defaultImportZip,
  };
}
