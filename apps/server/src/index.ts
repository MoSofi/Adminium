/**
 * @adminium/server — Fastify 5 application (08-server-api.md §1) plus the M0
 * config layer (env, secrets, bootstrap file). `buildServer()` assembles the
 * app; `start()` runs the boot sequence and listens (01-architecture.md §8.1 —
 * meta connect/migration gates join in a later wave).
 */
export {
  buildLogger,
  buildServer,
  REDACT_PATHS,
  type AdminiumServer,
  type BuildLoggerOptions,
  type BuildServerOptions,
} from './app.js';
export { start, type StartOptions } from './start.js';
export {
  AppError,
  ConflictError,
  errorEnvelope,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  ValidationFailedError,
  type ErrorCode,
  type ErrorEnvelope,
} from './errors.js';
export { API_PREFIX, registerRoutes } from './routes/index.js';
export { corePlugin, type CorePluginOptions } from './plugins/core.js';
export { staticPlugin, type StaticPluginOptions } from './plugins/static.js';
export {
  metaDialect,
  systemHealthzReply,
  systemInfoReply,
  type SystemHealthzReply,
  type SystemInfoReply,
} from './routes/system/schema.js';
export { APP_VERSION } from './version.js';
export {
  EnvValidationError,
  LOG_LEVELS,
  envSchema,
  formatEnvErrorTable,
  loadEnv,
  type Env,
  type EnvWriter,
} from './config/env.js';
export {
  ENC_TOKEN_PREFIX,
  SecretFormatError,
  SecretIntegrityError,
  decryptSecret,
  deriveKey,
  encryptSecret,
  isEncryptedSecret,
} from './config/secrets.js';
export {
  BOOTSTRAP_FILENAME,
  BootstrapFileError,
  bootstrapPath,
  bootstrapSchema,
  readBootstrap,
  writeBootstrap,
  type Bootstrap,
} from './config/bootstrap.js';
// Meta-store resolution + connection (01 §3.1/§7.2). The wrappers — CLI today,
// Docker/Electron next — all answer "where does the meta store live?" here.
export {
  META_URL_KEY_SALT,
  MetaDriverMissingError,
  MetaUrlError,
  connectMetaStore,
  embeddedMetaWarning,
  metaEngineFromUrl,
  metaUrlCryptoFromSecret,
  openMetaStore,
  resolveMetaUrl,
  sqlitePathFromUrl,
  type ConnectMetaStoreOptions,
  type MetaEngine,
  type MetaStoreHandle,
  type MetaUrlCrypto,
  type MetaUrlSource,
  type ResolveMetaUrlOptions,
  type ResolvedMetaUrl,
} from './meta/store.js';
// The `adminium` CLI (01 §4.1). `runCli` returns an exit code and never touches
// `process` — `src/cli/index.ts` is the only module that exits.
export { COMMANDS, findCommand, runCli, type RunCliOptions } from './cli/run.js';
export {
  defaultCliDeps,
  displayUrl,
  loadCliEnv,
  openRuntime,
  startServer,
  type CliDeps,
  type CliRuntime,
  type EnvOverrides,
  type OpenRuntimeOptions,
  type StartedServer,
} from './cli/runtime.js';
export { BUNDLED_DASHBOARD_DIR, resolveStaticRoot, staticRootCandidates } from './cli/static-root.js';
export {
  CliError,
  CliUsageError,
  EXIT_ERROR,
  EXIT_NOTHING_ACCEPTED,
  EXIT_OK,
  EXIT_VALIDATION_FAILED,
  type ExitCode,
} from './cli/exit.js';
// M10-T03 — the config bundle: `export-zip` / `import-zip` and, later, the
// Studio download/upload routes are front doors onto these two services.
export {
  EXPORT_ZIP_MANIFEST_VERSION,
  exportZip,
  type ExportZip,
  type ExportZipOptions,
  type ExportZipResult,
} from './export/zip-service.js';
export {
  ImportZipError,
  importZip,
  type ImportZip,
  type ImportZipOptions,
  type ImportZipResult,
} from './export/import-service.js';
export { PlaintextSecretError } from './export/redaction.js';
export type { BundleManifest, ConfigBundle } from './export/bundle.js';
