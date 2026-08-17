// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @adminium/server — Fastify 5 application (08-server-api.md §1) plus the M0
 * config layer (env, secrets, bootstrap file). `buildServer()` assembles the
 * app; `start()` runs the boot sequence and listens (01-architecture.md §8.1 —
 * meta connect/migration gates join in a later wave).
 */
import { ALL_MIGRATIONS } from '@adminium/meta';

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
/**
 * THE COMPOSITION ROOT (see `compose.ts`) — the complete server, not the
 * skeleton.
 *
 * `buildServer` above is exported and `composeServer` was not, which made the
 * public API of this package a trap: the only documented way in built the six
 * `/api/v1` namespaces that need no injected services and silently omitted the
 * other eleven the dashboard calls. That is precisely the M10 bug — a hollow API
 * whose connect wizard 404s — and 11-electron.md §3 walks the next wrapper
 * straight into it by describing the Electron entry as importing "the exported
 * `buildServer()` factory". Exporting the real root is what lets that wrapper be
 * correct: 01 §4's "only the wrapper differs" requires the thing that does not
 * differ to be reachable from outside.
 */
export {
  composeServer,
  TELEMETRY_CRON,
  TELEMETRY_JITTER_MS,
  TELEMETRY_SCHEDULE_NAME,
  type ComposedServer,
  type ComposeServerOptions,
} from './compose.js';
/**
 * The idempotent boot bootstrap (07-meta-store.md §6) — re-exported, not
 * re-implemented.
 *
 * `cli/commands/start.ts` imports `firstRun` straight from `@adminium/meta`
 * because it lives INSIDE this package. A wrapper outside it cannot: the
 * 01-architecture.md §2.3 matrix gives `@adminium/desktop` exactly two inputs,
 * "`@adminium/server` (spawned)" and "dashboard build output", so the Electron
 * utilityProcess entry has no legal path to `@adminium/meta`. Without this line
 * its only options are to grow a banned dependency edge or to call
 * `applyMigrations` instead — and the second one is the M10 bug: migrations
 * create `adminium_roles` but nothing in the ledger SEEDS it, so a
 * migrate-only boot serves a first-run wizard whose `POST /setup/super-admin`
 * dies in `createFirstSuperAdmin` ("built-in roles missing") permanently, the
 * claim row rolling back with every retry. On desktop that wizard is the app's
 * front door (11-electron.md §6), so the very first launch would dead-end.
 *
 * `firstRun` is the documented "safe to run at every boot" entry point: migrate,
 * seed the built-in roles, seed `system.*`. Exporting it makes the correct call
 * the reachable one for every wrapper, which is the whole point of 01 §4's "only
 * the wrapper differs".
 */
export { firstRun, type FirstRunResult } from '@adminium/meta';
/**
 * The newest migration this build ships (11-electron.md §9, 11-T12).
 *
 * Re-exported for the same reason `firstRun` above is: the Electron
 * utilityProcess entry has no legal path to `@adminium/meta` (01 §2.3 gives
 * `@adminium/desktop` exactly two inputs), and it needs this string to tell the
 * main process how new the app is — which is what lets main refuse a backup
 * whose `metaMigrationVersion` is newer than itself BEFORE it moves any data
 * aside. Computed here rather than restated, so it cannot fall behind the
 * ledger it names.
 */
export const LATEST_META_MIGRATION: string = (() => {
  const latest = ALL_MIGRATIONS[ALL_MIGRATIONS.length - 1]?.name;
  if (latest === undefined) {
    throw new Error('@adminium/meta shipped an empty migration ledger — this build is broken.');
  }
  return latest;
})();
// The §9 desktop backup format, frozen at formatVersion 1. Exported because it
// is a CONTRACT, not an implementation: the Electron main process validates an
// archive against these types before a restore (`import type` only — see
// `apps/desktop/src/main/backup-archive.ts`), and the M10 CLI's import reads the
// same manifest out of the same zip.
export {
  BACKUP_CONFIG_PATH,
  BACKUP_DATABASES_DIR,
  BACKUP_FILE_PATTERN,
  BACKUP_FORMAT_VERSION,
  BACKUP_MANIFEST_PATH,
  BACKUP_META_PATH,
  BACKUP_SLUG_PATTERN,
  PRE_RESTORE_PREFIX,
  backupDatabasePath,
  backupFileName,
  backupManifestSchema,
  compareMetaMigrationVersion,
  deriveDatabaseSlug,
  preRestoreDirName,
  sha256Hex,
  uniqueSlug,
  type BackupDatabaseEntry,
  type BackupExternalDatabase,
  type BackupLocalDatabase,
  type BackupManifest,
  type BackupMetaEntry,
  type BackupVersionOrder,
} from './backup/format.js';
export {
  BACKUPS_DIR,
  BACKUP_STAGING_DIR,
  BackupRedactionError,
  DEFAULT_AUTO_BACKUP_KEEP,
  createBackup,
  rotateBackups,
  rotateBackupsOnDisk,
  type CreateBackupOptions,
  type CreateBackupResult,
  type RotateBackupsResult,
} from './backup/backup-service.js';
export { BACKUP_NOTIFICATION_KIND } from './backup/notify.js';
/**
 * The session cookie's name (08-server-api.md §2.1).
 *
 * Exported because the Electron main process has to send it: §9's backup route
 * is session-guarded and main calls it carrying the WINDOW'S cookie, read out of
 * Electron's own cookie jar (`main/index.ts`'s `electronBackupTransport`). Main
 * cannot import this at runtime — that would load Fastify into the main process
 * to read a string — so it restates the name and pins it here with a test.
 */
export { SESSION_COOKIE } from './auth/sessions.js';
export { desktopRoutes, type DesktopRoutesDeps } from './routes/desktop/index.js';
export {
  desktopBackupBody,
  desktopBackupReply,
  type DesktopBackupBody,
  type DesktopBackupReply,
} from './routes/desktop/schema.js';
// §12 capability plumbing. The main process reaches the grant table over the
// loopback REST API (`main/capabilities/host.ts`'s grant reader), so it imports
// the grant SHAPE and the closed id vocabulary from here — the same "restate the
// name and pin it with a test" arrangement `SESSION_COOKIE` and the backup format
// use, and for the same reason: main must not load Fastify to read a string.
export {
  desktopCapabilityRoutes,
  type DesktopCapabilityRoutesDeps,
} from './routes/desktop-capabilities/index.js';
export {
  capabilityIdSchema,
  isKnownCapabilityId,
  KNOWN_CAPABILITY_IDS,
  type KnownCapabilityId,
} from './capabilities/catalog.js';
export type { CapabilityGrant } from '@adminium/meta';
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
