/**
 * Config-migration runner (01-architecture.md §8.2).
 *
 * Each migration is a pure function `(doc) => doc` upgrading one version
 * step. The server runs the chain at boot and lazily on read; zip import
 * replays the same path so old exports always upgrade, never silently drop.
 *
 * Browser-safe: no node: imports (this module ships in
 * `@adminium/engine/config`).
 */

/** A stored config document: the envelope with its integer version at `v`. */
export interface ConfigDocument {
  v: number;
  [key: string]: unknown;
}

export interface ConfigMigration {
  /** Version this migration upgrades from. */
  readonly from: number;
  /** Version this migration produces (`from + 1` by convention). */
  readonly to: number;
  /** Pure upgrade function; must not rely on mutating its input. */
  migrate(doc: ConfigDocument): ConfigDocument;
}

/** The current (latest) config schema version shipped with this build. */
export const CONFIG_VERSION = 1;

/**
 * Registered migrations, ordered by `from`. Empty while v1 is current; the
 * first real entry arrives with the v1→v2 bump.
 */
export const configMigrations: readonly ConfigMigration[] = [];

export class ConfigMigrationError extends Error {
  override readonly name = 'ConfigMigrationError';
}

/** Latest version reachable through `migrations` (>= CONFIG_VERSION). */
export function latestConfigVersion(
  migrations: readonly ConfigMigration[] = configMigrations,
): number {
  return migrations.reduce((max, m) => Math.max(max, m.to), CONFIG_VERSION);
}

/**
 * Upgrades `doc.v` to the latest version by running the migration chain.
 * Returns a new document — the input is never mutated. Throws
 * `ConfigMigrationError` when the document has no usable version, is newer
 * than this build understands (the boot downgrade guard's condition,
 * 01-architecture.md §8.1), or a step in the chain is missing.
 */
export function runConfigMigrations(
  doc: unknown,
  migrations: readonly ConfigMigration[] = configMigrations,
): ConfigDocument {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new ConfigMigrationError('config document must be an object');
  }
  const version = (doc as Record<string, unknown>)['v'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ConfigMigrationError(
      `config document has no valid version at "v" (got ${JSON.stringify(version)})`,
    );
  }

  const target = latestConfigVersion(migrations);
  if (version > target) {
    throw new ConfigMigrationError(
      `config document version ${String(version)} is newer than the latest supported version ` +
        `${String(target)} — upgrade Adminium to open it`,
    );
  }

  let current = { ...(doc as Record<string, unknown>), v: version } as ConfigDocument;
  while (current.v < target) {
    const from = current.v;
    const step = migrations.find((m) => m.from === from);
    if (!step) {
      throw new ConfigMigrationError(
        `no config migration registered from version ${String(from)}`,
      );
    }
    if (!Number.isInteger(step.to) || step.to <= step.from) {
      throw new ConfigMigrationError(
        `invalid migration step v${String(step.from)}→v${String(step.to)}`,
      );
    }
    // Clone before handing to the migration so a misbehaving (mutating)
    // migration can never corrupt the caller's document.
    const upgraded = step.migrate(structuredClone(current));
    current = { ...upgraded, v: step.to };
  }
  return current;
}
