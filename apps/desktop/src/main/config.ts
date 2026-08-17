// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Desktop config module (11-electron.md §2.3) — the `<userData>/config.json`
 * that the main process owns.
 *
 * This file holds the values the server cannot own because they decide how the
 * server is *launched* (§2.3): the data directory, the master secret, the LAN
 * bind, the update mode. It is read at boot step 2 and the secret is resolved at
 * boot step 3, before `ServerManager.start()` has anything to fork with.
 *
 * Three properties are load-bearing, and each one is a way the app bricks if it
 * is missing:
 *
 * 1. **Atomic writes.** A torn `config.json` is unrecoverable by the user: it
 *    holds the only copy of `ADMINIUM_SECRET`, and every encrypted DSN and LLM
 *    key in the meta-store is undecryptable without it. So writes go
 *    temp → fsync → rename, and a crash at any point leaves the previous file
 *    byte-intact ({@link saveConfig}).
 * 2. **Explicit version handling.** An older file migrates forward; a file from
 *    a *newer* build is refused loudly rather than parsed leniently and written
 *    back with its unknown keys dropped — that would silently destroy settings
 *    on a downgrade. Same policy as the §9 backup rule ("a backup whose
 *    metaMigrationVersion is newer than the app is refused").
 * 3. **The secret is never logged.** Not in diagnostics (§13), not in the backup
 *    zip (§9 strips `secretEncrypted`/`secretPlain`), not on the crash screen.
 *    {@link redactConfig} is the only shape that may leave this module.
 *
 * Everything external is injected — `safeStorage` ({@link SafeStorageLike}) and
 * the filesystem ({@link ConfigFs}) — so the whole module unit-tests without an
 * Electron runtime and the crash-mid-write path is directly exercisable.
 */

import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { z } from 'zod';

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Base for every failure this module raises, so callers can catch one type. */
export class DesktopConfigError extends Error {
  override readonly name: string = 'DesktopConfigError';
}

/**
 * `config.json` exists but is not usable: unreadable, not JSON, or not matching
 * the schema. Deliberately NOT treated as first-run — re-running the wizard
 * would generate a fresh secret and orphan every encrypted value in the
 * meta-store. The caller shows the crash screen with the file path instead.
 */
export class ConfigParseError extends DesktopConfigError {
  override readonly name = 'ConfigParseError';

  constructor(
    message: string,
    readonly path: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * The file's `version` cannot be brought to {@link CURRENT_CONFIG_VERSION}.
 *
 * - `kind: "newer"` — written by a newer build. Refuse: "Update Adminium first."
 * - `kind: "unsupported"` — older than any registered migration path.
 */
export class ConfigVersionError extends DesktopConfigError {
  override readonly name = 'ConfigVersionError';

  constructor(
    message: string,
    readonly kind: 'newer' | 'unsupported',
    readonly fileVersion: number,
    readonly appVersion: number,
  ) {
    super(message);
  }
}

/**
 * A `secretEncrypted` exists but `safeStorage` cannot decrypt it — the OS
 * keyring went away (a Linux keyring uninstalled, a restored-to-a-new-machine
 * profile, a changed login keychain).
 *
 * This MUST NOT silently fall through to generating a new secret. The existing
 * secret is the only key for every `enc:v1:` token in the meta-store; replacing
 * it converts "your keyring is missing" into "all your saved connections are
 * permanently corrupt". Boot fails loudly and the user restores from a backup
 * (§9) or reinstates the keyring.
 */
export class SecretUnavailableError extends DesktopConfigError {
  override readonly name = 'SecretUnavailableError';
}

// ─── Schema (§2.3) ───────────────────────────────────────────────────────────

/** The `version` this build writes. Bump only alongside a migration. */
export const CURRENT_CONFIG_VERSION = 1;

/** §11 update modes. */
export const updateModeSchema = z.enum(['notify', 'manual', 'disabled']);
export type UpdateMode = z.infer<typeof updateModeSchema>;

/**
 * Where `ADMINIUM_SECRET` lives (§2.2 step 3). `plain` drives the About-screen
 * warning banner (§13) and is surfaced through `getRuntimeInfo()` (§4).
 */
export const secretStorageSchema = z.enum(['safeStorage', 'plain']);
export type SecretStorage = z.infer<typeof secretStorageSchema>;

const portSchema = z.number().int().min(1).max(65535);

export const lanShareSchema = z.strictObject({
  enabled: z.boolean(),
  port: portSchema,
});

export const updatesSchema = z.strictObject({
  mode: updateModeSchema,
});

export const autoBackupSchema = z.strictObject({
  enabled: z.boolean(),
  /** Rotation depth for `<dataDir>/backups/` (§9). At least one. */
  keep: z.number().int().min(1).max(365),
});

/**
 * Persisted window bounds (§14). `x`/`y` are optional: on first run there are
 * none and Electron centers the window.
 *
 * Bounds are validated as positive integers only — deliberately NOT against the
 * §14 1024×700 minimum. This module's job is to keep the app bootable; a stale
 * or odd-scaled bound must not throw here and take `config.json` (and with it
 * the secret) out of reach. The window track clamps at apply time — see
 * {@link MIN_WINDOW_WIDTH} / {@link MIN_WINDOW_HEIGHT}.
 */
export const windowStateSchema = z.strictObject({
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  maximized: z.boolean(),
});

/** §14 minimum window size, for the window track's off-screen/clamp correction. */
export const MIN_WINDOW_WIDTH = 1024;
export const MIN_WINDOW_HEIGHT = 700;

/**
 * `<userData>/config.json` (§2.3).
 *
 * `strictObject`: an unknown key is a bug (a typo, a hand-edit) and not a
 * forward-compat channel — a genuinely newer file is caught earlier, by the
 * version gate, with a message the user can act on.
 *
 * `secretStorage` is not in the §2.3 example body but is mandated by §2.2 step 3
 * ("fall back to plaintext `config.secretPlain` and set `secretStorage: "plain"`
 * so the About screen can warn") and is read back by `getRuntimeInfo()` (§4), so
 * it is persisted here rather than recomputed by every reader.
 */
export const desktopConfigSchema = z.strictObject({
  version: z.literal(CURRENT_CONFIG_VERSION),
  dataDir: z.string().min(1),
  /** base64 of the safeStorage-encrypted `ADMINIUM_SECRET`. */
  secretEncrypted: z.string().min(1).nullable(),
  /** Only when safeStorage is unavailable (§2.2 step 3). */
  secretPlain: z.string().min(1).nullable(),
  secretStorage: secretStorageSchema,
  /** §5 — "Skip login on this computer". */
  singleUser: z.boolean(),
  /** §8.3 — off in Wave 1; the server binds 127.0.0.1. */
  lanShare: lanShareSchema,
  updates: updatesSchema,
  telemetryOptIn: z.boolean(),
  autoBackup: autoBackupSchema,
  window: windowStateSchema,
});

export type DesktopConfig = z.infer<typeof desktopConfigSchema>;

/** `config.json` minus every secret — the only shape that may be logged (§9, §13). */
export type RedactedDesktopConfig = Omit<DesktopConfig, 'secretEncrypted' | 'secretPlain'>;

/** §8.3 default LAN port; matches the server's own default (`config/env.ts`). */
export const DEFAULT_LAN_PORT = 4600;

/** §9 default backup rotation depth. */
export const DEFAULT_AUTO_BACKUP_KEEP = 7;

/** `<userData>/config.json` (§2.3). */
export function configPathFor(userDataDir: string): string {
  return join(userDataDir, 'config.json');
}

/** `<userData>/data` — the default data directory offered by the wizard (§6 step 1). */
export function defaultDataDirFor(userDataDir: string): string {
  return join(userDataDir, 'data');
}

/**
 * A fresh config for first run. The secret fields are null until
 * {@link resolveSecret} fills them, which is why they are nullable in the
 * schema: the wizard writes this file before a secret exists.
 */
export function createDefaultConfig(dataDir: string): DesktopConfig {
  return {
    version: CURRENT_CONFIG_VERSION,
    dataDir,
    secretEncrypted: null,
    secretPlain: null,
    secretStorage: 'safeStorage',
    singleUser: true,
    lanShare: { enabled: false, port: DEFAULT_LAN_PORT },
    updates: { mode: 'notify' },
    telemetryOptIn: false,
    autoBackup: { enabled: true, keep: DEFAULT_AUTO_BACKUP_KEEP },
    window: { width: 1440, height: 900, maximized: false },
  };
}

/**
 * Strips `secretEncrypted` / `secretPlain` — the exact pair §9 requires the
 * backup zip to omit. Use this for any log line, diagnostic dump (§13), or
 * archived copy of the config. The keys are *removed*, not nulled, so a
 * downstream `JSON.stringify` cannot resurrect a placeholder that looks like a
 * value.
 *
 * Built as an explicit allow-list rather than by spreading and deleting: with a
 * rest-spread, a secret-bearing field added to the schema later would leak by
 * default, and the leak would be invisible at the call site. Here the default is
 * "not copied", and the drift shows up as a missing field — caught by the test
 * that compares this key set against the schema's.
 */
export function redactConfig(config: DesktopConfig): RedactedDesktopConfig {
  return {
    version: config.version,
    dataDir: config.dataDir,
    secretStorage: config.secretStorage,
    singleUser: config.singleUser,
    lanShare: { ...config.lanShare },
    updates: { ...config.updates },
    telemetryOptIn: config.telemetryOptIn,
    autoBackup: { ...config.autoBackup },
    window: { ...config.window },
  };
}

// ─── Ports (injected, so this module tests without Electron) ─────────────────

/** The `safeStorage` surface this module uses. Electron's satisfies it. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface ConfigFileHandle {
  writeFile(data: string, encoding: 'utf8'): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** The filesystem surface {@link saveConfig} needs, narrowed to what it calls. */
export interface ConfigFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
  open(path: string, flags: string, mode: number): Promise<ConfigFileHandle>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
}

/** Real `node:fs/promises`, adapted explicitly rather than structurally. */
export const nodeConfigFs: ConfigFs = {
  readFile: (path, encoding) => fsp.readFile(path, encoding),
  mkdir: (path, options) => fsp.mkdir(path, options),
  open: (path, flags, mode) => fsp.open(path, flags, mode),
  rename: (oldPath, newPath) => fsp.rename(oldPath, newPath),
  rm: (path, options) => fsp.rm(path, options),
};

/**
 * Log sink. Intentionally message-only: there is no structured-payload argument,
 * because the only way a secret reaches a log is via a payload someone spread a
 * config into.
 */
export interface ConfigLogger {
  info(message: string): void;
  warn(message: string): void;
}

const silentLogger: ConfigLogger = { info: () => {}, warn: () => {} };

// ─── Migration ───────────────────────────────────────────────────────────────

/** Migrates a raw config body from version `N` to version `N + 1`. */
export type ConfigMigration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Keyed by the version migrated FROM.
 *
 * Version 0 means "no `version` key" — a config.json written before the field
 * existed, or hand-rolled. It carries forward by stamping the version; the
 * schema then validates the rest, so a v0 file that is missing required keys
 * still fails as a parse error rather than booting half-configured.
 *
 * Every future entry must be pure and total: it may not read the filesystem, and
 * it must produce something the *next* migration accepts (only the last one has
 * to satisfy the schema).
 */
export const CONFIG_MIGRATIONS: Readonly<Record<number, ConfigMigration>> = {
  0: (raw) => ({ ...raw, version: 1 }),
};

/** Just enough of the body to read the version before the real schema runs. */
const versionProbeSchema = z.looseObject({
  version: z.number().int().nonnegative().optional(),
});

/**
 * Brings a raw body to {@link CURRENT_CONFIG_VERSION}, or throws
 * {@link ConfigVersionError}. Exported for the migration tests and for the
 * restore path (§9), which validates a backup's bundled `config.json`.
 */
export function migrateConfig(
  raw: unknown,
  migrations: Readonly<Record<number, ConfigMigration>> = CONFIG_MIGRATIONS,
): { raw: Record<string, unknown>; fromVersion: number } {
  const probe = versionProbeSchema.safeParse(raw);
  if (!probe.success) {
    throw new ConfigVersionError(
      'config.json is not an object with a numeric "version"',
      'unsupported',
      -1,
      CURRENT_CONFIG_VERSION,
    );
  }

  const fromVersion = probe.data.version ?? 0;

  if (fromVersion > CURRENT_CONFIG_VERSION) {
    throw new ConfigVersionError(
      `config.json is version ${String(fromVersion)}, but this build understands ` +
        `version ${String(CURRENT_CONFIG_VERSION)}. Update Adminium first — ` +
        'opening it with this build would discard the newer settings.',
      'newer',
      fromVersion,
      CURRENT_CONFIG_VERSION,
    );
  }

  let body: Record<string, unknown> = { ...probe.data };
  for (let version = fromVersion; version < CURRENT_CONFIG_VERSION; version += 1) {
    const migration = migrations[version];
    if (migration === undefined) {
      throw new ConfigVersionError(
        `config.json is version ${String(fromVersion)} and no migration exists from ` +
          `version ${String(version)}.`,
        'unsupported',
        fromVersion,
        CURRENT_CONFIG_VERSION,
      );
    }
    body = migration(body);
  }

  return { raw: body, fromVersion };
}

// ─── Load / save ─────────────────────────────────────────────────────────────

export interface ConfigIoDeps {
  fs?: ConfigFs | undefined;
  logger?: ConfigLogger | undefined;
  migrations?: Readonly<Record<number, ConfigMigration>> | undefined;
}

export type LoadConfigResult =
  /** No file ⇒ first-run mode (§2.2 step 2). */
  | { status: 'missing' }
  | { status: 'loaded'; config: DesktopConfig; migratedFrom: number | null };

/**
 * Boot step 2. Returns `{ status: "missing" }` for a genuinely absent file and
 * throws for every other failure — see {@link ConfigParseError} for why a
 * corrupt file must not degrade into first-run.
 *
 * A migrated config is NOT written back here; the caller decides when to persist
 * (`migratedFrom !== null` ⇒ call {@link saveConfig}). Load stays read-only so a
 * failure later in boot cannot leave a half-upgraded file behind.
 */
export async function loadConfig(path: string, deps: ConfigIoDeps = {}): Promise<LoadConfigResult> {
  const fs = deps.fs ?? nodeConfigFs;
  const logger = deps.logger ?? silentLogger;

  let text: string;
  try {
    text = await fs.readFile(path, 'utf8');
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      logger.info(`no config.json at ${path}; starting first-run setup`);
      return { status: 'missing' };
    }
    throw new ConfigParseError(`could not read ${path}`, path, error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ConfigParseError(`${path} is not valid JSON`, path, error);
  }

  const { raw, fromVersion } = migrateConfig(parsed, deps.migrations ?? CONFIG_MIGRATIONS);

  const result = desktopConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigParseError(
      `${path} does not match the expected shape: ${formatIssues(result.error)}`,
      path,
      result.error,
    );
  }

  if (fromVersion !== CURRENT_CONFIG_VERSION) {
    logger.info(
      `migrated config.json from version ${String(fromVersion)} to ` +
        `${String(CURRENT_CONFIG_VERSION)}`,
    );
  }

  return {
    status: 'loaded',
    config: result.data,
    migratedFrom: fromVersion === CURRENT_CONFIG_VERSION ? null : fromVersion,
  };
}

/**
 * Atomic write (§2.3 "write temp + rename").
 *
 * Sequence: validate → write a uniquely named temp in the *same directory* (so
 * the rename is same-filesystem and therefore atomic) → `fsync` the file →
 * `rename` over the target → best-effort `fsync` of the directory so the
 * rename itself survives a power cut.
 *
 * A crash before the rename leaves the previous `config.json` untouched and only
 * an orphan temp file behind; a crash after it leaves the new one complete.
 * There is no window in which the target is partially written.
 *
 * Mode `0600`: this file holds the master secret in plaintext whenever
 * safeStorage is unavailable.
 */
export async function saveConfig(
  path: string,
  config: DesktopConfig,
  deps: ConfigIoDeps = {},
): Promise<void> {
  const fs = deps.fs ?? nodeConfigFs;

  // Never persist a body that would not load back: an invalid config.json is
  // indistinguishable from a corrupt one on the next boot.
  const validated = desktopConfigSchema.parse(config);
  const json = `${JSON.stringify(validated, null, 2)}\n`;

  const dir = dirname(path);
  await fs.mkdir(dir, { recursive: true });

  const tmp = join(dir, `.config.json.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const handle = await fs.open(tmp, 'w', 0o600);
    try {
      await handle.writeFile(json, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, path);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }

  await syncDirectory(fs, dir);
}

/**
 * fsync the directory entry so a completed `rename` is durable.
 *
 * Best-effort by design: Windows cannot open a directory as a file, and some
 * filesystems reject the fsync. The rename has already succeeded at this point —
 * failing the save over a missing durability hint would be a regression, not a
 * safety win.
 */
async function syncDirectory(fs: ConfigFs, dir: string): Promise<void> {
  let handle: ConfigFileHandle;
  try {
    handle = await fs.open(dir, 'r', 0o600);
  } catch {
    return;
  }
  try {
    await handle.sync();
  } catch {
    // ignored — see above
  } finally {
    await handle.close().catch(() => {});
  }
}

// ─── Secret resolution (§2.2 step 3) ─────────────────────────────────────────

/** 32 bytes → 64 hex chars, comfortably over the server's 16-char minimum. */
export const SECRET_BYTES = 32;

/** A fresh `ADMINIUM_SECRET`. */
export function generateSecret(): string {
  return randomBytes(SECRET_BYTES).toString('hex');
}

export interface ResolvedSecret {
  /** The plaintext `ADMINIUM_SECRET` for the server's fork env (§2.2 step 5). */
  secret: string;
  storage: SecretStorage;
  /** The config as it should now be persisted. */
  config: DesktopConfig;
  /** True when {@link config} differs from the input and must be saved. */
  changed: boolean;
  /** True when a brand-new secret was minted (first run, or a fresh install). */
  generated: boolean;
}

export interface ResolveSecretDeps {
  logger?: ConfigLogger | undefined;
  /** Overridable for tests; defaults to a CSPRNG. */
  generate?: (() => string) | undefined;
}

/**
 * Boot step 3: produce the plaintext secret and the config that should be on
 * disk afterwards.
 *
 * | safeStorage | on disk            | outcome                                       |
 * |-------------|--------------------|-----------------------------------------------|
 * | available   | `secretEncrypted`  | decrypt; `safeStorage`                         |
 * | available   | `secretPlain`      | **upgrade**: encrypt, drop the plaintext       |
 * | available   | neither            | generate, encrypt; `safeStorage`               |
 * | unavailable | `secretPlain`      | use as-is; `plain` (About-screen warning, §13) |
 * | unavailable | `secretEncrypted`  | {@link SecretUnavailableError} — never regenerate |
 * | unavailable | neither            | generate, store plaintext; `plain`             |
 *
 * The plaintext-to-encrypted upgrade matters because the fallback is sticky
 * otherwise: a Linux user who installs a keyring after first run would keep
 * their secret in cleartext forever, and the About screen would keep warning
 * about a condition that no longer holds.
 *
 * Returns the secret; never logs it, and never puts it in a thrown message.
 */
export function resolveSecret(
  config: DesktopConfig,
  safeStorage: SafeStorageLike,
  deps: ResolveSecretDeps = {},
): ResolvedSecret {
  const logger = deps.logger ?? silentLogger;
  const generate = deps.generate ?? generateSecret;

  if (safeStorage.isEncryptionAvailable()) {
    if (config.secretEncrypted !== null) {
      const secret = decryptOrThrow(config.secretEncrypted, safeStorage);
      if (config.secretPlain === null && config.secretStorage === 'safeStorage') {
        return { secret, storage: 'safeStorage', config, changed: false, generated: false };
      }
      logger.info(
        config.secretPlain !== null
          ? // A stale plaintext copy alongside a good encrypted one.
            'removing the leftover plaintext secret copy; safeStorage holds the secret'
          : 'correcting the secretStorage flag to "safeStorage"',
      );
      return {
        secret,
        storage: 'safeStorage',
        config: { ...config, secretPlain: null, secretStorage: 'safeStorage' },
        changed: true,
        generated: false,
      };
    }

    if (config.secretPlain !== null) {
      logger.info('safeStorage is now available; encrypting the stored secret');
      return {
        secret: config.secretPlain,
        storage: 'safeStorage',
        config: encryptInto(config, config.secretPlain, safeStorage),
        changed: true,
        generated: false,
      };
    }

    const secret = generate();
    logger.info('generated a new ADMINIUM_SECRET and stored it via safeStorage');
    return {
      secret,
      storage: 'safeStorage',
      config: encryptInto(config, secret, safeStorage),
      changed: true,
      generated: true,
    };
  }

  // safeStorage unavailable — Linux without a keyring (§2.2 step 3).
  if (config.secretEncrypted !== null) {
    throw new SecretUnavailableError(
      'config.json holds a safeStorage-encrypted ADMINIUM_SECRET, but this system ' +
        'reports no encryption backend (on Linux: no available keyring). Refusing ' +
        'to generate a replacement — every saved connection and API key is ' +
        'encrypted with the existing secret and would become unreadable. Start the ' +
        'keyring (gnome-keyring / kwallet) and relaunch, or restore from a backup.',
    );
  }

  if (config.secretPlain !== null) {
    logger.warn(
      'safeStorage is unavailable; ADMINIUM_SECRET remains stored in plaintext in ' +
        'config.json (file mode 0600). Install a system keyring to secure it.',
    );
    return {
      secret: config.secretPlain,
      storage: 'plain',
      config:
        config.secretStorage === 'plain' ? config : { ...config, secretStorage: 'plain' },
      changed: config.secretStorage !== 'plain',
      generated: false,
    };
  }

  const secret = generate();
  logger.warn(
    'safeStorage is unavailable; storing a newly generated ADMINIUM_SECRET in ' +
      'plaintext in config.json (file mode 0600). Install a system keyring to secure it.',
  );
  return {
    secret,
    storage: 'plain',
    config: { ...config, secretEncrypted: null, secretPlain: secret, secretStorage: 'plain' },
    changed: true,
    generated: true,
  };
}

function encryptInto(
  config: DesktopConfig,
  secret: string,
  safeStorage: SafeStorageLike,
): DesktopConfig {
  return {
    ...config,
    secretEncrypted: safeStorage.encryptString(secret).toString('base64'),
    secretPlain: null,
    secretStorage: 'safeStorage',
  };
}

/**
 * Decrypt, converting any backend failure into {@link SecretUnavailableError}.
 * The underlying error is deliberately not chained into the message: Electron's
 * `decryptString` throws with backend detail, and this message reaches the crash
 * screen and the logs.
 */
function decryptOrThrow(secretEncrypted: string, safeStorage: SafeStorageLike): string {
  let secret: string;
  try {
    secret = safeStorage.decryptString(Buffer.from(secretEncrypted, 'base64'));
  } catch {
    throw new SecretUnavailableError(
      'the stored ADMINIUM_SECRET could not be decrypted by safeStorage. The OS ' +
        'keyring entry that protects it is missing or belongs to a different user ' +
        'or machine. Refusing to generate a replacement — it would make every saved ' +
        'connection and API key unreadable. Restore from a backup, or remove ' +
        'config.json to start over (existing encrypted data will not be recoverable).',
    );
  }
  if (secret.length === 0) {
    throw new SecretUnavailableError(
      'safeStorage returned an empty ADMINIUM_SECRET; refusing to boot with no secret.',
    );
  }
  return secret;
}

// ─── Cloud-sync folder detection (§6 step 1, §9) ──────────────────────────────

/**
 * The four providers §6 step 1 names. `googleDrive` covers Drive for Desktop's
 * several mount shapes.
 */
export type CloudSyncProvider = 'dropbox' | 'icloud' | 'onedrive' | 'googleDrive';

export interface CloudSyncWarning {
  provider: CloudSyncProvider;
  /**
   * The provider's brand name. Not localized on purpose — a product name is not
   * a translatable string; the wizard interpolates it into the localized body.
   */
  providerLabel: string;
  /** The path segment that matched, e.g. `"Dropbox (Personal)"`. */
  matchedSegment: string;
  /** The i18n key the renderer resolves via `t()`; see {@link CLOUD_SYNC_WARNING_I18N_KEY}. */
  messageKey: string;
}

/**
 * The key the first-run wizard (11-T07, in `@adminium/dashboard`) renders with
 * `t(key, { provider: providerLabel })`. Lives here so the detector and the
 * warning cannot drift; the translations belong to the wizard's bundle.
 */
export const CLOUD_SYNC_WARNING_I18N_KEY = 'desktop.setup.dataDir.cloudSyncWarning';

interface ProviderMatcher {
  provider: CloudSyncProvider;
  label: string;
  /** Tested against a single path segment, case-insensitively. */
  pattern: RegExp;
  /**
   * `cloudStorage` ⇒ only matched directly beneath a `CloudStorage` segment.
   * See {@link CLOUD_STORAGE_DIR} for why that scoping is what makes the
   * hyphenated variants safe to recognise at all.
   */
  scope: 'any' | 'cloudStorage';
}

/**
 * macOS's `~/Library/CloudStorage`, the parent every provider's File-Provider
 * mount lives directly under.
 *
 * This segment is the whole reason the hyphenated brand names below can be
 * matched without false-positiving on ordinary folders. `OneDrive-Personal` and
 * `GoogleDrive-ava@gmail.com` are real sync roots; `onedrive-scripts` and
 * `dropbox-clone` are somebody's project directories, and a segment pattern
 * alone cannot tell them apart — `[ -]` says yes to all four. The PARENT can:
 * only macOS creates `CloudStorage`, and it puts nothing in it that is not a
 * sync root.
 */
const CLOUD_STORAGE_DIR = /^cloudstorage$/i;

/**
 * Matched per path *segment*, not by substring: `~/Projects/dropbox-clone/data`
 * is not a Dropbox folder, and this warning is blocking (§6 step 1), so a false
 * positive is a wall in front of a legitimate setup.
 *
 * Two scopes, and the split is what keeps the rule both complete and narrow.
 *
 * ANYWHERE — the brand alone, or with a SPACE-separated account suffix. These
 * are the names the desktop clients create in the home directory, and a space
 * is a separator ordinary folder names essentially never use for this shape:
 * `Dropbox (Personal)`, `Dropbox (Acme Inc)`, `OneDrive - Contoso`,
 * `Google Drive`.
 *
 * UNDER `CloudStorage` ONLY — the HYPHENATED variants. macOS's File Provider
 * mounts are `~/Library/CloudStorage/OneDrive-Personal`,
 * `~/Library/CloudStorage/OneDrive-Contoso`,
 * `~/Library/CloudStorage/GoogleDrive-ava@gmail.com`. A hyphen accepted in the
 * `any` scope would also match `~/Projects/dropbox-clone`,
 * `~/dropbox-backups`, and `~/onedrive-scripts` — ordinary folders no sync
 * client touches. Since this warning BLOCKS (§6 step 1), that false positive is
 * a wall in front of a legitimate setup; and since dropping the hyphen
 * ENTIRELY would stop flagging `OneDrive-Personal` — a false negative on a
 * SQLite-corruption warning, which is the worse failure of the two — the
 * separator is admitted exactly where the OS guarantees the meaning.
 */
const PROVIDER_MATCHERS: readonly ProviderMatcher[] = [
  // macOS: ~/Library/Mobile Documents/com~apple~CloudDocs; Windows: ~/iCloudDrive
  {
    provider: 'icloud',
    label: 'iCloud Drive',
    pattern: /^(mobile documents|icloud ?drive|com~apple~clouddocs)$/i,
    scope: 'any',
  },
  // Dropbox never hyphenates: `Dropbox`, `Dropbox (Personal)`, and under
  // CloudStorage a bare `Dropbox`. So it needs no cloudStorage entry.
  { provider: 'dropbox', label: 'Dropbox', pattern: /^dropbox( .*)?$/i, scope: 'any' },
  { provider: 'onedrive', label: 'OneDrive', pattern: /^onedrive( .*)?$/i, scope: 'any' },
  { provider: 'onedrive', label: 'OneDrive', pattern: /^onedrive-.+$/i, scope: 'cloudStorage' },
  { provider: 'googleDrive', label: 'Google Drive', pattern: /^(google ?drive|drivefs)$/i, scope: 'any' },
  {
    provider: 'googleDrive',
    label: 'Google Drive',
    pattern: /^google ?drive-.+$/i,
    scope: 'cloudStorage',
  },
];

/**
 * Drive for Desktop mounts a virtual drive whose top level is `My Drive` /
 * `Shared drives` with no "Google" anywhere in the path (`G:\My Drive\…`).
 *
 * Only checked directly beneath a drive-letter root — `~/Documents/My Drive` is
 * an ordinary folder someone named badly, and blocking it would be wrong.
 */
const GOOGLE_DRIVE_MOUNT_ROOT = /^(my drive|shared drives)$/i;
const WINDOWS_DRIVE_ROOT = /^[a-z]:$/i;

/** Splits on both separators so a Windows path is analyzable from any host. */
function splitSegments(path: string): string[] {
  return path.split(/[/\\]+/).filter((segment) => segment.length > 0 && segment !== '.');
}

/**
 * Is `dir` inside a known cloud-sync folder? (§6 step 1, §9)
 *
 * SQLite in a file-sync folder corrupts: the provider copies the `.sqlite`,
 * `-wal`, and `-shm` files independently and at different moments, so it can
 * upload a WAL that does not match its database, and it resolves "conflicts" by
 * forking the file behind an open handle. The wizard turns a hit into a blocking
 * warning that needs explicit confirmation.
 *
 * Returns `null` for an ordinary path.
 */
export function detectCloudSyncFolder(dir: string): CloudSyncWarning | null {
  const segments = splitSegments(dir);

  for (const [index, segment] of segments.entries()) {
    const underCloudStorage = CLOUD_STORAGE_DIR.test(segments[index - 1] ?? '');
    for (const matcher of PROVIDER_MATCHERS) {
      if (matcher.scope === 'cloudStorage' && !underCloudStorage) continue;
      if (matcher.pattern.test(segment)) {
        return {
          provider: matcher.provider,
          providerLabel: matcher.label,
          matchedSegment: segment,
          messageKey: CLOUD_SYNC_WARNING_I18N_KEY,
        };
      }
    }

    // `G:\My Drive\…` — a Drive for Desktop mount root, top level only.
    if (index === 1 && WINDOWS_DRIVE_ROOT.test(segments[0] ?? '') && GOOGLE_DRIVE_MOUNT_ROOT.test(segment)) {
      return {
        provider: 'googleDrive',
        providerLabel: 'Google Drive',
        matchedSegment: segment,
        messageKey: CLOUD_SYNC_WARNING_I18N_KEY,
      };
    }
  }

  return null;
}

// ─── Internals ───────────────────────────────────────────────────────────────

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === code
  );
}

/** Compact issue list for a {@link ConfigParseError} message. Values are never included. */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}
