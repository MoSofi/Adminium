/**
 * @adminium/server — server foundation (M0). The config layer ships first;
 * `buildServer()` (Fastify app, boot sequence per 01-architecture.md §8.1)
 * arrives in M2.
 */
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
