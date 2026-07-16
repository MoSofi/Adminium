/**
 * Zip-import service — the other half of M10-T03 (01-architecture.md §6.1,
 * §8.2; acceptance: "Zip export from version N imports into version N+1 with all
 * config documents upgraded to the current `v` and validating against
 * `@adminium/engine/config`").
 *
 * VERSION REPLAY, the whole point of the manifest carrying versions:
 *   1. the meta migrator brings the target's *schema* up (`firstRun`);
 *   2. `runConfigMigrations` replays every config *document* `v` → latest;
 *   3. `pageEnvelopeSchema` then validates the upgraded document.
 * Order matters. Validating before migrating would reject exactly the old
 * bundles that replay exists to accept — a v1 page must be allowed in the door
 * so it can become a v2 page. So the bundle's row schemas (`bundle.ts`) are
 * structural only, and `@adminium/engine/config` — the §6.1 "single validation
 * authority ... [for] zip import" — is applied after the upgrade.
 *
 * A bundle from a NEWER build is refused outright (exit ≠ 0), never partially
 * read: a build that does not understand `v: 3` would silently drop the parts of
 * the document it cannot see, and a silent partial restore is worse than a
 * failed one.
 *
 * WRITE SEMANTICS: upsert by *natural* key, not by id. A fresh target has
 * already seeded its own built-in roles with its own ULIDs, so matching
 * `roles.slug` (and `pages(connection_id, slug)`, `views(page_id, name)`) is
 * what makes a round-trip land instead of colliding on a unique index. Ids are
 * remapped accordingly and the maps are threaded into dependent rows.
 */

import { readFile } from 'node:fs/promises';

import {
  ConfigMigrationError,
  configMigrations,
  latestConfigVersion,
  pageEnvelopeSchema,
  runConfigMigrations,
  type ConfigMigration,
} from '@adminium/engine/config';
import { firstRun, newId, settingsRepo, writeBool, type MetaDb } from '@adminium/meta';
import { strFromU8, unzipSync } from 'fflate';

import {
  BUNDLE_RESOURCES,
  MANIFEST_PATH,
  RESOURCE_SCHEMAS,
  bundleManifestSchema,
  resourcePath,
  type BundleManifest,
  type ConfigBundle,
} from './bundle.js';
import { EXPORT_ZIP_MANIFEST_VERSION } from './zip-service.js';

/** The slice of a Zod schema this module needs — see `envelopeSchema`. */
export interface SafeParseLike {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] } | undefined;
}

/** A validator for a config envelope: the `safeParse` surface, nothing more. */
export interface EnvelopeValidator {
  safeParse: (doc: unknown) => SafeParseLike;
}

export class ImportZipError extends Error {
  override readonly name = 'ImportZipError';
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

export interface ImportZipOptions {
  /** The meta store to import into. */
  meta: MetaDb;
  /** Path to the `.zip` to read. Mutually exclusive with {@link bytes}. */
  inPath?: string | undefined;
  /** Archive bytes, when the caller already has them (tests, HTTP upload). */
  bytes?: Uint8Array | undefined;
  /** Validate + report without writing anything. */
  dryRun?: boolean | undefined;
  /**
   * Config-migration chain — defaults to the build's registered migrations.
   * Injectable (the same affordance `@adminium/meta`'s migrator offers with
   * `MigratorOptions.migrations`) so the replay path can be exercised against a
   * synthetic v1→v2 step while the shipped chain is still empty.
   */
  configMigrations?: readonly ConfigMigration[] | undefined;
  /**
   * The envelope validator. **Tests only** — production must use the default,
   * because `@adminium/engine/config` is the §6.1 "single validation authority
   * ... [for] zip import" and a caller supplying its own would be exactly the
   * fork that rule exists to prevent.
   *
   * It exists because the validator and the migration chain are one world: the
   * shipped envelope pins `v: literal(CONFIG_VERSION)`, so injecting a v1→v2
   * migration without a v2-aware validator would describe a build that cannot
   * exist. Overriding one requires overriding the other.
   */
  envelopeSchema?: EnvelopeValidator | undefined;
  /** Clock override — tests. */
  now?: () => number;
}

export interface ImportZipResult {
  manifest: BundleManifest;
  /** Rows written (or that would be written, under `dryRun`) per resource. */
  counts: Readonly<Record<string, number>>;
  /** Config documents whose `v` was upgraded on the way in. */
  migratedDocuments: number;
  /** Non-fatal notes — dangling refs dropped, secrets that need re-entering. */
  warnings: string[];
  dryRun: boolean;
}

export type ImportZip = (opts: ImportZipOptions) => Promise<ImportZipResult>;

/** Read + structurally validate the archive. No database access. */
function parseBundle(bytes: Uint8Array): ConfigBundle {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (error) {
    throw new ImportZipError(
      'Could not read the archive — it is not a valid zip file.',
      error instanceof Error ? error.message : undefined,
    );
  }

  const readJsonEntry = (path: string): unknown => {
    const entry = files[path];
    if (entry === undefined) {
      throw new ImportZipError(
        `The archive is missing "${path}" — it is not an Adminium configuration bundle.`,
        'Bundles are produced by `adminium export-zip`.',
      );
    }
    try {
      return JSON.parse(strFromU8(entry));
    } catch (error) {
      throw new ImportZipError(
        `"${path}" in the archive is not valid JSON.`,
        error instanceof Error ? error.message : undefined,
      );
    }
  };

  const manifestResult = bundleManifestSchema.safeParse(readJsonEntry(MANIFEST_PATH));
  if (!manifestResult.success) {
    throw new ImportZipError(
      'The bundle manifest is malformed.',
      manifestResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }
  const manifest = manifestResult.data;

  if (manifest.formatVersion > EXPORT_ZIP_MANIFEST_VERSION) {
    throw new ImportZipError(
      `This bundle uses layout version ${String(manifest.formatVersion)}; this build understands ` +
        `up to ${String(EXPORT_ZIP_MANIFEST_VERSION)}.`,
      `The bundle was written by Adminium ${manifest.appVersion}. Upgrade to that version or later to import it.`,
    );
  }

  const bundle = { manifest } as ConfigBundle;
  for (const resource of BUNDLE_RESOURCES) {
    const raw = readJsonEntry(resourcePath(resource));
    const parsed = RESOURCE_SCHEMAS[resource].array().safeParse(raw);
    if (!parsed.success) {
      throw new ImportZipError(
        `"${resourcePath(resource)}" is malformed.`,
        parsed.error.issues
          .slice(0, 10)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('\n'),
      );
    }
    // Structurally validated above; the per-resource types line up by construction.
    (bundle as unknown as Record<string, unknown>)[resource] = parsed.data;
  }
  return bundle;
}

interface ReplayResult {
  config: unknown;
  migrated: boolean;
}

/**
 * Replay one config document forward, then validate it. `validate` is applied
 * only after the upgrade — see this module's header for why the order is load
 * bearing.
 */
function replayDocument(
  config: unknown,
  migrations: readonly ConfigMigration[],
  where: string,
  validator: EnvelopeValidator | null,
): ReplayResult {
  // Documents without a `v` are not envelopes (view grid state is opaque JSON,
  // 07 §3.18) — there is nothing to replay and nothing to validate.
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return { config, migrated: false };
  }
  const before = (config as Record<string, unknown>)['v'];
  if (typeof before !== 'number') return { config, migrated: false };

  let upgraded: Record<string, unknown>;
  try {
    upgraded = runConfigMigrations(config, migrations);
  } catch (error) {
    if (error instanceof ConfigMigrationError) {
      throw new ImportZipError(`${where}: ${error.message}`);
    }
    throw error;
  }

  if (validator !== null) {
    const result = validator.safeParse(upgraded);
    if (!result.success) {
      throw new ImportZipError(
        `${where}: the config document does not validate against this build's schema.`,
        (result.error?.issues ?? [])
          .slice(0, 10)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('\n'),
      );
    }
  }

  return { config: upgraded, migrated: upgraded.v !== before };
}

function packJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * Booleans must be bound dialect-correctly (`repos/util.ts`): better-sqlite3
 * refuses to bind a boolean, Postgres refuses a number for a boolean column.
 * Every boolean this module writes goes through here.
 */
function bool(meta: MetaDb, value: boolean): boolean | 0 | 1 {
  return writeBool(meta, value);
}

/**
 * Import a configuration bundle.
 *
 * Everything happens inside one transaction so a bundle that fails halfway
 * (a page that will not validate, say) leaves no half-restored instance behind.
 */
export const importZip: ImportZip = async (opts) => {
  // Resolved ONCE and used for both the replay and the version guard below.
  // They must never disagree: a guard that computed its target from the
  // registered chain while the replay ran a different (or empty) one would
  // accept a v1 document into a v2 build and store it un-migrated — the silent
  // half-restore this service exists to prevent.
  const chain = opts.configMigrations ?? configMigrations;
  const dryRun = opts.dryRun ?? false;
  const now = opts.now ?? Date.now;

  if (opts.inPath === undefined && opts.bytes === undefined) {
    throw new ImportZipError('No bundle given — pass a path or bytes.');
  }

  let bytes: Uint8Array;
  if (opts.bytes !== undefined) {
    bytes = opts.bytes;
  } else {
    try {
      bytes = new Uint8Array(await readFile(opts.inPath as string));
    } catch (error) {
      throw new ImportZipError(
        `Could not read ${String(opts.inPath)}.`,
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  const bundle = parseBundle(bytes);
  const { manifest } = bundle;
  const warnings: string[] = [];

  // §8.2 replay guard. `latestConfigVersion` accounts for the injected chain, so
  // this is the same question the runner itself would ask, asked early and once.
  const target = latestConfigVersion(chain);
  if (manifest.configVersion > target) {
    throw new ImportZipError(
      `This bundle carries config version ${String(manifest.configVersion)}; this build supports up to ` +
        `${String(target)}.`,
      `The bundle was written by Adminium ${manifest.appVersion}. A bundle only imports into that ` +
        'version or a later one — upgrade this instance rather than importing into an older build, ' +
        'which would drop the parts of your configuration it cannot read.',
    );
  }

  if (manifest.secrets.policy === 'omitted' && bundle.connections.length > 0) {
    warnings.push(
      `This bundle carries no credentials for its ${String(bundle.connections.length)} connection(s): ` +
        'any that are new to this instance need their connection string entered before they will ' +
        'work. Connections already configured here keep the string they have.',
    );
  }
  if (manifest.secrets.encrypted.length > 0) {
    warnings.push(
      'This bundle carries encrypted secrets; they only decrypt under the same ADMINIUM_SECRET the ' +
        'exporting instance used. If this instance has a different secret, re-enter them.',
    );
  }

  // ── replay every config document before touching the database ─────────────
  let migratedDocuments = 0;
  const validator = opts.envelopeSchema ?? pageEnvelopeSchema;
  const pages = bundle.pages.map((page) => {
    const { config, migrated } = replayDocument(page.config, chain, `pages.${page.slug}`, validator);
    if (migrated) migratedDocuments += 1;
    return { ...page, config };
  });
  const views = bundle.views.map((view) => {
    // Views hold opaque grid/layout state, not page envelopes — replay if it
    // carries a `v`, but do not judge it against the page schema.
    const { config, migrated } = replayDocument(view.config, chain, `views.${view.name}`, null);
    if (migrated) migratedDocuments += 1;
    return { ...view, config };
  });

  const counts: Record<string, number> = {};
  for (const resource of BUNDLE_RESOURCES) {
    counts[resource] = (bundle as unknown as Record<string, unknown[]>)[resource]?.length ?? 0;
  }

  if (dryRun) {
    return { manifest, counts, migratedDocuments, warnings, dryRun: true };
  }

  // ── the target's schema must be current before any write ──────────────────
  await firstRun(opts.meta, now());

  const at = now();
  const { db } = opts.meta;

  await db.transaction().execute(async (trx) => {
    const settings = settingsRepo({ ...opts.meta, db: trx });

    // settings — through settingsRepo so the registry validates every value.
    // Unknown or invalid keys are skipped rather than aborting the whole import:
    // a stale key in an old bundle should not make the bundle unimportable.
    for (const row of bundle.settings) {
      try {
        await settings.set(row.key as never, row.value as never, { at });
      } catch {
        warnings.push(`Skipped unknown or invalid setting "${row.key}".`);
        counts.settings = (counts.settings ?? 1) - 1;
      }
    }

    // roles — matched by slug; a fresh target already seeded its built-ins with
    // its own ids, so the bundle's role ids are remapped, not forced.
    const roleIdMap = new Map<string, string>();
    for (const role of bundle.roles) {
      const existing = await trx
        .selectFrom('adminium_roles')
        .select('id')
        .where('slug', '=', role.slug)
        .executeTakeFirst();
      if (existing) {
        roleIdMap.set(role.id, existing.id);
        await trx
          .updateTable('adminium_roles')
          .set({ name: role.name, description: role.description ?? null, updatedAt: at })
          .where('id', '=', existing.id)
          .execute();
      } else {
        roleIdMap.set(role.id, role.id);
        await trx
          .insertInto('adminium_roles')
          .values({
            id: role.id,
            slug: role.slug,
            name: role.name,
            description: role.description ?? null,
            isBuiltin: bool(opts.meta, role.isBuiltin),
            createdAt: at,
            updatedAt: at,
          })
          .execute();
      }
    }

    // role permissions — the bundle is authoritative for the roles it carries,
    // so replace their matrix wholesale rather than merging two permission sets
    // (a merge could only ever grant more than the export described).
    const targetRoleIds = [...new Set(roleIdMap.values())];
    if (targetRoleIds.length > 0) {
      await trx
        .deleteFrom('adminium_role_permissions')
        .where('roleId', 'in', targetRoleIds)
        .execute();
    }
    for (const permission of bundle.rolePermissions) {
      const roleId = roleIdMap.get(permission.roleId);
      if (roleId === undefined) {
        warnings.push(`Dropped a permission for unknown role "${permission.roleId}".`);
        counts.rolePermissions = (counts.rolePermissions ?? 1) - 1;
        continue;
      }
      await trx
        .insertInto('adminium_role_permissions')
        .values({
          id: newId('perm'),
          roleId,
          resourceKind: permission.resourceKind,
          resourceRef: permission.resourceRef,
          actions: packJson(permission.actions),
        })
        .execute();
    }

    // connections — no natural key beyond the id; upsert by id.
    //
    // THE DSN COLUMNS ARE ABSENT-vs-NULL SENSITIVE. A default bundle omits
    // secrets (the shareable default), so `connection.dataDsnEncrypted` is
    // `undefined` — "this bundle does not carry it", NOT "there is none". They
    // were coalesced with `?? null` and written on the UPDATE path, which turned
    // "not carried" into "erase it": re-importing a no-secrets bundle into a
    // configured instance — the flow the docs endorse, "a re-import updates what
    // is already there instead of duplicating it" — NULLed the live encrypted
    // DSNs and flipped every connection to `unconfigured`. The plaintext existed
    // only as AES-256-GCM ciphertext in the meta store and was never in the
    // bundle, so it was gone: working credentials destroyed, silently, by a sync.
    const secretsOmitted = manifest.secrets.policy === 'omitted';
    let preservedDsnConnections = 0;
    for (const connection of bundle.connections) {
      const existing = await trx
        .selectFrom('adminium_connections')
        .select('id')
        .where('id', '=', connection.id)
        .executeTakeFirst();

      const config = {
        name: connection.name,
        engine: connection.engine,
        sourceKind: connection.sourceKind,
        readOnly: bool(opts.meta, connection.readOnly),
        ssl: connection.ssl == null ? null : packJson(connection.ssl),
        settings: packJson(connection.settings),
        updatedAt: at,
      };
      const dsns = {
        introspectDsnEncrypted: connection.introspectDsnEncrypted ?? null,
        dataDsnEncrypted: connection.dataDsnEncrypted ?? null,
        // No DSN ⇒ the target cannot talk to the database yet. `unconfigured` is
        // the honest status; claiming `connected` would fail on first use.
        status: connection.dataDsnEncrypted == null ? 'unconfigured' : 'connected',
      };

      if (existing) {
        // Carry the bundle's config over; touch the DSN columns only when the
        // bundle actually carries credentials to put there.
        if (secretsOmitted) {
          preservedDsnConnections += 1;
          await trx
            .updateTable('adminium_connections')
            .set(config)
            .where('id', '=', connection.id)
            .execute();
        } else {
          await trx
            .updateTable('adminium_connections')
            .set({ ...config, ...dsns })
            .where('id', '=', connection.id)
            .execute();
        }
      } else {
        await trx
          .insertInto('adminium_connections')
          .values({ id: connection.id, ...config, ...dsns, createdAt: at })
          .execute();
      }
    }
    if (preservedDsnConnections > 0) {
      warnings.push(
        `Kept the existing connection string for ${String(preservedDsnConnections)} connection(s) ` +
          'already on this instance: this bundle carries no credentials, so it has nothing to ' +
          'replace them with.',
      );
    }

    const connectionIds = new Set(bundle.connections.map((c) => c.id));

    // snapshots — upsert by id; each belongs to a connection in this bundle.
    for (const snapshot of bundle.snapshots) {
      if (!connectionIds.has(snapshot.connectionId)) {
        warnings.push(`Dropped a schema snapshot for unknown connection "${snapshot.connectionId}".`);
        counts.snapshots = (counts.snapshots ?? 1) - 1;
        continue;
      }
      const existing = await trx
        .selectFrom('adminium_schema_snapshots')
        .select('id')
        .where('id', '=', snapshot.id)
        .executeTakeFirst();
      if (existing) continue; // snapshots are immutable (07 §3.14)
      // Exactly one active snapshot per connection is app-enforced; clear the
      // incumbent inside this transaction rather than trusting the target's state.
      if (snapshot.isActive) {
        await trx
          .updateTable('adminium_schema_snapshots')
          .set({ isActive: bool(opts.meta, false) })
          .where('connectionId', '=', snapshot.connectionId)
          .execute();
      }
      await trx
        .insertInto('adminium_schema_snapshots')
        .values({
          id: snapshot.id,
          connectionId: snapshot.connectionId,
          source: snapshot.source,
          importFormat: snapshot.importFormat ?? null,
          engineVersion: snapshot.engineVersion ?? null,
          schema: packJson(snapshot.schema),
          stats: snapshot.stats == null ? null : packJson(snapshot.stats),
          checksum: snapshot.checksum,
          isActive: bool(opts.meta, snapshot.isActive),
          createdAt: at,
        })
        .execute();
    }

    // overrides — upsert by id.
    for (const override of bundle.overrides) {
      if (!connectionIds.has(override.connectionId)) {
        warnings.push(`Dropped a schema override for unknown connection "${override.connectionId}".`);
        counts.overrides = (counts.overrides ?? 1) - 1;
        continue;
      }
      const existing = await trx
        .selectFrom('adminium_schema_overrides')
        .select('id')
        .where('id', '=', override.id)
        .executeTakeFirst();
      const shared = {
        connectionId: override.connectionId,
        op: override.op,
        tableName: override.tableName,
        columnName: override.columnName ?? null,
        value: packJson(override.value),
        origin: override.origin,
        status: override.status,
        confidence: override.confidence ?? null,
        updatedAt: at,
      };
      if (existing) {
        await trx.updateTable('adminium_schema_overrides').set(shared).where('id', '=', override.id).execute();
      } else {
        await trx
          .insertInto('adminium_schema_overrides')
          .values({ id: override.id, ...shared, createdAt: at })
          .execute();
      }
    }

    // pages — matched on the (connection_id, slug) unique index.
    const snapshotIds = new Set(bundle.snapshots.map((s) => s.id));
    const pageIdMap = new Map<string, string>();
    for (const page of pages) {
      if (page.connectionId !== null && !connectionIds.has(page.connectionId)) {
        warnings.push(`Dropped page "${page.slug}" — it belongs to a connection not in this bundle.`);
        counts.pages = (counts.pages ?? 1) - 1;
        continue;
      }
      let query = trx.selectFrom('adminium_pages').select(['id', 'revision']).where('slug', '=', page.slug);
      query = page.connectionId === null
        ? query.where('connectionId', 'is', null)
        : query.where('connectionId', '=', page.connectionId);
      const existing = await query.executeTakeFirst();

      const shared = {
        type: page.type,
        title: page.title,
        icon: page.icon ?? null,
        navGroup: page.navGroup ?? null,
        navOrder: page.navOrder,
        config: packJson(page.config),
        origin: page.origin,
        generatedFromSnapshotId:
          page.generatedFromSnapshotId != null && snapshotIds.has(page.generatedFromSnapshotId)
            ? page.generatedFromSnapshotId
            : null,
        isEnabled: bool(opts.meta, page.isEnabled),
        updatedAt: at,
      };

      if (existing) {
        pageIdMap.set(page.id, existing.id);
        await trx
          .updateTable('adminium_pages')
          // Bump the revision: watchers hold optimistic-concurrency tokens and an
          // import is a write like any other (07 §3.16).
          .set({ ...shared, revision: existing.revision + 1 })
          .where('id', '=', existing.id)
          .execute();
      } else {
        pageIdMap.set(page.id, page.id);
        await trx
          .insertInto('adminium_pages')
          .values({
            id: page.id,
            connectionId: page.connectionId,
            slug: page.slug,
            ...shared,
            manifestId: null,
            revision: 1,
            createdAt: at,
          })
          .execute();
      }
    }

    // views — shared views only; matched on (page_id, user_id IS NULL, name).
    for (const view of views) {
      const pageId = pageIdMap.get(view.pageId);
      if (pageId === undefined) {
        warnings.push(`Dropped view "${view.name}" — its page is not in this bundle.`);
        counts.views = (counts.views ?? 1) - 1;
        continue;
      }
      const existing = await trx
        .selectFrom('adminium_views')
        .select('id')
        .where('pageId', '=', pageId)
        .where('userId', 'is', null)
        .where('name', '=', view.name)
        .executeTakeFirst();
      const shared = {
        kind: view.kind,
        config: packJson(view.config),
        isDefault: bool(opts.meta, view.isDefault),
        updatedAt: at,
      };
      if (existing) {
        await trx.updateTable('adminium_views').set(shared).where('id', '=', existing.id).execute();
      } else {
        await trx
          .insertInto('adminium_views')
          .values({ id: view.id, pageId, userId: null, name: view.name, ...shared, createdAt: at })
          .execute();
      }
    }
  });

  return { manifest, counts, migratedDocuments, warnings, dryRun: false };
};
