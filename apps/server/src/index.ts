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
