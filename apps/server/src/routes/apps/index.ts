// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/api/v1/apps` — installing a micro-SaaS app into this
 * instance.
 *
 * Until now the only way an app reached an installation was
 * `ADMINIUM_SURFACES_DIR`: a directory the operator populates by deploy, read
 * once at boot. These routes add the other half — bytes arrive over the API,
 * land in a store this server owns, and are served on the next request with no
 * restart (D1, D2).
 *
 * ─── Two calls, not one, and the seam is deliberate ─────────────────────────
 *
 * `POST /apps/upload` stages bytes; `POST /apps/install` turns a staged package
 * into an installed app. Splitting them costs a round trip and buys the place
 * where the schema plan goes: an operator has to be able to see what an install
 * would create in their database BEFORE it creates it, and a single call that
 * unpacked and installed in one motion would have nowhere to ask. It is also
 * the shape `routes/add-ons` already has, for the same reason.
 *
 * ─── Why an uploaded surface is treated like an add-on package ──────────────
 *
 * A surface is "just static files", but they are served at the DASHBOARD'S OWN
 * ORIGIN — inside the session-cookie boundary, where a script can drive
 * `/api/v1/*` as the signed-in operator. So uploading one is closer to
 * installing an add-on than to uploading an avatar, and it gets the same
 * ceremony: `system:manifests:manage`, an expected sha512, the hardened
 * unpack, the per-file tree pin re-checked before install parses a byte, and
 * an audit row per outcome (D5).
 *
 * ─── After changing this file ──────────────────────────────────────────────
 *
 * OpenAPI is generated from `dist`, so the order is: build → `pnpm openapi` →
 * commit the spec. Running `pnpm openapi` first silently writes a spec one
 * build behind, and only `openapi-check` catches it.
 */

import {
  compareSemver,
  isAddOnManifest,
  planInstall,
  validateManifest,
  type InstallPlan,
  type Manifest,
  prefixFor,
  satisfiesSemverRange,
  type InstallTablePlan,
  type PlanProblem,
  type TableChoice,
} from '@adminium/manifest';
import { checkManifestPages, sha256Hex, type DatabaseModel } from '@adminium/engine';
import {
  addOnSettingsRepo,
  appTablesRepo,
  CUSTOMER_KEY_PURPOSE,
  auditRepo,
  keyEnabledBy,
  keyStaffBinding,
  connectionTenantConfig,
  permissionsRepo,
  publicEndpointsRepo,
  publicKeysRepo,
  rolesRepo,
  SecretSettingRefused,
  manifestsRepo,
  pagesRepo,
  settingsRepo,
  snapshotsRepo,
  userPrefsRepo,
  type MetaDb,
} from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { AddOnCatalogError, pickLocalized } from '../../add-ons/catalog.js';
import {
  APP_CATALOG_ENABLED_SETTING,
  appCatalogSchema,
  isCurrentAppCatalogFormat,
  meetsMinimum,
  type AppCatalogClient,
  type AppCatalogEntry,
} from '../../apps/catalog.js';
import { surfacesOfInstalled, type InstalledApps } from '../../apps/installed.js';
import {
  envelopeAppKey,
  isThisAppsPage,
  materialiseManifestPages,
  type MaterialiseResult,
} from '../../apps/manifest-pages.js';
import { missingColumnsEdit, offered, type OfferedColumn } from '../../apps/missing-columns.js';
import type { AppSchemaTarget } from '../../apps/schema-target.js';
import { AddOnInstallError, type ExistingTable } from '../../add-ons/install-ddl.js';
import type { EditBody } from '../../schema-ddl/programmatic.js';
import type { AppStore } from '../../apps/store.js';
import { AddOnStoreError } from '../../add-ons/store.js';
import { refusalReason, uploadRefusalMessage } from '../../add-ons/upload-refusal.js';
import { SURFACE_SIDES, type SurfaceSide } from '../../cli/surfaces-root.js';
import { audited, auditExempt } from '../../audit/coverage.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import {
  appEntryFromCache,
  enqueueAppCatalogRefresh,
  enqueueAppDownload,
} from '../../jobs/app-acquire.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { forgetAppSurfaceSettings, NO_SURFACE_SETTINGS, sideOffOf } from '../../surfaces/settings.js';
import { validateDomainEntries, validateInstanceEntries } from '../../surfaces/validate.js';
import { normalizeHost } from '../../security/csrf.js';
import { settingValueIssues, settingValuesWithDefaults } from '../../apps/settings-values.js';
import { isUntouched } from '../../pages/generated-stamp.js';
import {
  createSampleDataService,
  enqueueSampleAdd,
  findSampleApp,
  type SampleDataDeps,
} from '../../apps/sample-data.js';
import { ownRules, removeManifestRules, writeManifestRules, type RulesResult } from '../../apps/manifest-rules.js';
import { formIssues, layoutTables } from '../../apps/manifest-page-config.js';
import { forgetAppRoleGrants, roleIssues, writeManifestRoles, type RolesResult } from '../../apps/manifest-roles.js';
import { installPublicAccess, planPublicEndpoints, publicAccessWarnings, staffBindingOf } from '../../apps/manifest-public.js';
import { installOutbox, removeOutbox, templateProblems, type OutboxResult } from '../../apps/manifest-outbox.js';
import type { EndpointService } from '../../public-api/endpoint-service.js';
import type { SnapshotView } from '../../crud/identifiers.js';
import type { DsnCrypto } from '@adminium/meta';
import { pageLayoutSchema } from '@adminium/engine/config';
import { APP_VERSION } from '../../version.js';
import {
  appCatalogReply,
  appCatalogSettingsBody,
  appCatalogSettingsReply,
  appInstallPlanReply,
  appJobReply,
  appKeyParams,
  appListReply,
  discardStagedAppReply,
  downloadAppBody,
  installAppBody,
  installedAppReply,
  appDomainsBody,
  appDomainsReply,
  appInstancesBody,
  appInstancesReply,
  appOverviewReply,
  appSettingsBody,
  appSettingsReply,
  appStatusReply,
  planAppBody,
  renameTablesBody,
  sampleRemoveBody,
  sampleRemovePlanReply,
  sampleRemoveReply,
  sampleStatusReply,
  uninstallAppBody,
  uninstallPlanReply,
  renameTablesPlanReply,
  renameTablesReply,
  stagedAppParams,
  stagedAppReply,
  uninstallAppReply,
  updateAppBody,
  updateAppReply,
  uploadAppQuery,
  type AppInstallPlanDto,
} from './schema.js';

/**
 * 32 MB, the add-on upload's limit.
 *
 * A surface bundle is a built SPA — clinic-desk's two sides come to a few
 * hundred KB gzipped — so this is not a working figure an operator will meet;
 * it is the ceiling that stops an unbounded body from being buffered on a
 * route that authenticates at `onRequest` and parses after.
 */
export const APP_UPLOAD_BODY_LIMIT = 32 * 1024 * 1024;

/** The manifest a bundle must carry at its root, after `package/` is stripped. */
const MANIFEST_FILE = 'manifest.json';

export interface AppRoutesDeps {
  meta: MetaDb;
  store: AppStore;
  /** The live installed set; refreshed after every install and uninstall. */
  installed: InstalledApps;
  /** Encrypt/decrypt closures over `ADMINIUM_SECRET`; routes never see the key. */
  credentialCrypto: { encrypt(v: string): string; decrypt(v: string): string };
  /**
   * App keys already served from `ADMINIUM_SURFACES_DIR`.
   *
   * A function rather than a list because the composition owns the discovery
   * and this module must not import the CLI to ask. Installing over one of
   * these is refused: those surfaces own registered routes that an installed
   * app's hook deliberately yields to, so the install would appear to succeed
   * and then serve nothing (D4).
   */
  directoryKeys: () => readonly string[];
  /**
   * Where an app's tables are planned and created.
   *
   * Optional so a composition with no connection layer still serves everything
   * else: an app that declares no tables installs there completely, and one
   * that does is refused with a reason rather than half-applied.
   */
  schemaTarget?: AppSchemaTarget | undefined;
  /**
   * An app's sample data. Absent in a composition with no connection layer or
   * no Files library; the routes then say the app offers none.
   */
  sampleData?: SampleDataDeps | undefined;
  /**
   * Making an app's public access: the endpoint service the public-admin
   * routes share, the schema views the public API reads, the key sealer and
   * the configured origins. Absent in a composition without the public API.
   */
  publicAccess?:
    | {
        service: EndpointService;
        viewFor: (connectionId: string) => Promise<SnapshotView | null>;
        crypto: DsnCrypto;
        origins: readonly string[];
        onChange?: () => void;
        /** A key revoked here stops at once, not when the resolver's cache (≤ 30 s) expires. */
        invalidateKey?: (keyId: string) => void;
      }
    | undefined;
  /**
   * The online app catalog (b G8-D3). The SAME client the acquisition jobs
   * use, so the routes' gate and the jobs' cannot disagree about whether the
   * catalog is on. Absent = off: nothing is offered, refreshed or downloaded,
   * and browsing lists the store alone.
   */
  catalog?: AppCatalogClient | undefined;
  /** Tests only; production compares minimums with the running version. */
  serverVersion?: string | undefined;
}

/**
 * The schema edit that adapts the tables an install reuses: each `add-column`
 * as the installer's own column shape (nullable), each widening, identity and
 * enum-value change as one `alterColumns` entry per column.
 */
export function editBodyFor(
  tables: readonly InstallTablePlan[],
  manifest: Manifest,
  model: DatabaseModel,
  idOf: (model: DatabaseModel, name: string) => string,
  /** The plan's real names (`customers` → `pos_customers`), for a link's target. */
  names: Readonly<Record<string, string>> = {},
): EditBody {
  const addColumns: NonNullable<EditBody['addColumns']> = [];
  const alterColumns: NonNullable<EditBody['alterColumns']> = [];
  for (const table of tables) {
    const spec = manifest.requiredSchema?.tables.find((t) => t.ref === table.ref);
    const id = idOf(model, table.table);
    const perColumn = new Map<string, NonNullable<EditBody['alterColumns']>[number]>();
    for (const edit of table.edits) {
      if (edit.kind === 'add-column') {
        const column = spec?.columns.find((c) => c.ref === edit.column);
        if (column?.type === 'fk' && column.references !== undefined) {
          const link = linkColumnFor(column.references, model, idOf, names);
          if (link !== null) addColumns.push({ table: id, column: { name: edit.column, ...link.column } as never, foreignKey: link.foreignKey });
          continue;
        }
        const shape = column === undefined ? null : offered(column);
        if (shape !== null) addColumns.push({ table: id, column: { name: edit.column, ...shape } as never });
        continue;
      }
      const entry = perColumn.get(edit.column) ?? { table: id, column: edit.column };
      if (edit.kind === 'widen') {
        const width = /^varchar\((\d+)\)$/.exec(edit.to);
        entry.widen =
          width === null
            ? { logicalType: edit.to as never }
            : { logicalType: 'varchar', maxLength: Number(width[1]) };
      } else if (edit.kind === 'set-identity') {
        entry.identity = true;
      } else {
        entry.enumValues = [...edit.values];
      }
      perColumn.set(edit.column, entry);
    }
    alterColumns.push(...perColumn.values());
  }
  return { addColumns, alterColumns };
}

/**
 * A link column an update adds, and the foreign key beside it: the target is
 * the app's own table under its real name (made a moment earlier, when the
 * update adds it too) or one the host already had, and the column is shaped
 * like that table's key — the planner then gives it the key's native type.
 */
function linkColumnFor(
  references: string,
  model: DatabaseModel,
  idOf: (model: DatabaseModel, name: string) => string,
  names: Readonly<Record<string, string>>,
): { column: Omit<OfferedColumn, 'name'>; foreignKey: { toTable: string; toColumns: string[]; onDelete: null } } | null {
  const toId = idOf(model, names[references] ?? references);
  const target = model.tables.find((t) => t.id === toId);
  const key = target?.primaryKey ?? [];
  if (target === undefined || key.length !== 1) return null;
  const keyColumn = target.columns.find((c) => c.name === key[0]);
  const logicalType = keyColumn?.logicalType === 'bigint' || keyColumn?.logicalType === 'uuid' ? keyColumn.logicalType : 'integer';
  return {
    column: { logicalType, nullable: true, default: null, maxLength: null, numericPrecision: null, numericScale: null, comment: null },
    foreignKey: { toTable: toId, toColumns: [key[0]!], onDelete: null },
  };
}

/** The operator's answers on the check step (`installAnswers` in the schema). */
export interface InstallAnswers {
  choices?: Readonly<Record<string, TableChoice>> | undefined;
  altPrefix?: string | undefined;
}

/**
 * The tables a plan must read: the manifest's own, and every table its foreign
 * keys point at. Nothing else in the database can change what the plan says.
 */
export function tablesNamedBy(manifest: Manifest): Set<string> {
  const names = new Set<string>();
  for (const table of manifest.requiredSchema?.tables ?? []) {
    names.add(table.ref);
    for (const column of table.columns) if (column.references !== undefined) names.add(column.references);
  }
  return names;
}

/**
 * A plan's identity: what it would create and reuse, what stands in its way,
 * and the live tables it read. Two plans hash alike only when installing now
 * would do exactly what the reviewed one said.
 */
export function planChecksum(plan: InstallPlan, existing: readonly ExistingTable[]): string {
  const tables = [...existing]
    .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
    .map((table) => ({
      t: table.ref,
      c: table.columns.map((c) => [c.ref, c.dbType ?? null, c.nullable ?? null, c.hasDefault ?? null, c.isPrimaryKey ?? null]),
    }));
  return sha256Hex(
    JSON.stringify({
      key: plan.addOnKey,
      version: plan.version,
      create: plan.create.map((t) => [t.ref, t.table ?? t.ref]),
      reuse: plan.reuse.map((t) => [t.ref, t.table ?? t.ref, t.missingColumns]),
      planned: (plan.tables ?? []).map((t) => [t.ref, t.table, t.action, t.renameExistingTo ?? null, t.edits]),
      problems: plan.problems.map((p) => [p.code, p.table, p.column ?? null]),
      tables,
    }),
  );
}

/** A stored status, narrowed; anything unrecognised reads as `error`. */
function statusOf(value: string): 'installing' | 'installed' | 'disabled' | 'error' {
  return value === 'installing' || value === 'installed' || value === 'disabled' ? value : 'error';
}

/** `compatibility.minAdminiumVersion` out of an unvalidated document, or null. */
function lenientMinimum(document: unknown): string | null {
  if (typeof document !== 'object' || document === null) return null;
  const compatibility = (document as { compatibility?: unknown }).compatibility;
  if (typeof compatibility !== 'object' || compatibility === null) return null;
  const minimum = (compatibility as { minAdminiumVersion?: unknown }).minAdminiumVersion;
  return typeof minimum === 'string' && /^\d+\.\d+\.\d+/.test(minimum) ? minimum : null;
}

/**
 * Why this release cannot update an install of `from` in place, or null when
 * it can. A release whose tables changed shape declares the versions it still
 * updates (`compatibility.updatesFrom`); an older install is told to
 * uninstall first rather than being walked into an update that cannot fit.
 */
export function updateRefusal(manifest: Manifest, from: string): ValidationFailedError | null {
  const range = manifest.compatibility.updatesFrom;
  if (range === undefined || satisfiesSemverRange(from, range)) return null;
  return new ValidationFailedError(
    `${manifest.name} ${from} used a different layout, so ${manifest.version} cannot update it in place. ` +
      `Uninstall it first, then install ${manifest.version}.`,
    { reason: 'UPDATE_NOT_SUPPORTED', from, to: manifest.version, updatesFrom: range },
  );
}

export function appRoutes(deps: AppRoutesDeps): FastifyPluginAsyncZod {
  const manifests = manifestsRepo(deps.meta, deps.credentialCrypto);
  const serverVersion = deps.serverVersion ?? APP_VERSION;

  /** The sides a staged tree actually carries, in serve order. */
  function sidesOf(files: Record<string, string>): SurfaceSide[] {
    return SURFACE_SIDES.filter((side) => `${side}/index.html` in files);
  }

  /**
   * The manifest of a staged package, verified and checked, or a refusal.
   *
   * Shared by plan and install so the two cannot disagree about what is in the
   * package — a preview computed from one reading and an install performed from
   * another is the shape of bug where the dialog shows one thing and the
   * database gets another.
   *
   * The tree is re-verified against its unpack-time pin BEFORE anything here
   * parses a byte of it: the data volume is shared, writable state, so neither
   * call re-trusts bare disk bytes.
   */
  async function verifiedManifest(key: string, version: string): Promise<Manifest> {
    try {
      await deps.store.verifyTree(key, version);
    } catch (error) {
      const reason = error instanceof AddOnStoreError ? error.reason : 'UNKNOWN';
      throw new ValidationFailedError(
        `The staged bundle for "${key}@${version}" no longer matches what was unpacked.`,
        { reason },
      );
    }

    let bytes: Buffer;
    try {
      bytes = await deps.store.readFile(key, version, MANIFEST_FILE);
    } catch {
      throw new ValidationFailedError(
        `"${key}@${version}" carries no readable \`${MANIFEST_FILE}\` at its root.`,
        { reason: 'MANIFEST_MISSING' },
      );
    }

    const manifest = appManifestFrom(bytes, `"${key}@${version}"`);
    if (manifest.key !== key) {
      // The key is a path segment AND a URL segment; a manifest naming a
      // different one would serve at a URL its own code does not expect,
      // because the build baked `/apps/<key>/<side>/` into every asset URL.
      // An upload can no longer stage one — it takes its key FROM the manifest
      // — but the bundled seed still reads its key off a filename.
      throw new ValidationFailedError(
        `The bundle was staged as "${key}" but its manifest declares "${manifest.key}".`,
        { reason: 'KEY_MISMATCH' },
      );
    }
    return manifest;
  }

  /**
   * An app manifest out of raw bytes, or a refusal.
   *
   * One reading for both places a manifest is read — the upload, which takes
   * the package's identity from it, and plan/install, which re-read it from
   * the verified tree — so the two cannot disagree about what counts as one.
   *
   * @param subject How the refusal names the package: `"clinic@1.0.0"` once it
   *   is staged, or `null` for a bundle still being uploaded, which has no name
   *   until this function has read one.
   */
  function appManifestFrom(bytes: Buffer, subject: string | null): Manifest {
    let document: unknown;
    try {
      document = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new ValidationFailedError(
        `${subject ?? 'This bundle'} carries no readable \`${MANIFEST_FILE}\` at its root.`,
        { reason: 'MANIFEST_MISSING' },
      );
    }

    const validated = validateManifest(document);
    if (!validated.ok) {
      /*
       * A NEWER APP, NOT A BROKEN ONE. Every block of the
       * manifest is `.strict()`, so a release that uses a field this server
       * does not know yet fails the parse — and the operator was told the
       * manifest "is not valid", when the truth is that Adminium needs an
       * upgrade. The minimum is read leniently, before the refusal is worded.
       * A manifest that parses is never refused here: the floor on the upload
       * path still runs where it always has.
       */
      const minimum = lenientMinimum(document);
      if (minimum !== null && !meetsMinimum(minimum, serverVersion)) {
        const key = typeof (document as { key?: unknown }).key === 'string' ? (document as { key: string }).key : null;
        throw new ValidationFailedError(
          `${key === null ? 'This app' : `"${key}"`} needs Adminium ${minimum} or later; this server is ` +
            `${serverVersion}. Upgrade Adminium before installing it.`,
          { reason: 'REQUIRES_NEWER_ADMINIUM', minAdminiumVersion: minimum, serverVersion },
        );
      }
      throw new ValidationFailedError(
        `The manifest in ${subject ?? 'this bundle'} is not valid.`,
        { issues: validated.issues },
      );
    }
    if (isAddOnManifest(validated.manifest)) {
      throw new ValidationFailedError(
        `"${validated.manifest.key}" is an add-on, not an app. Install it from Studio → Add-ons.`,
        { reason: 'WRONG_KIND' },
      );
    }
    return validated.manifest;
  }

  /**
   * What installing this manifest would do to one connection.
   *
   * Returns the plan BESIDE its DTO rather than only the DTO: `apply` takes the
   * plan, and rebuilding one from the wire shape would be a second place for
   * the two to disagree about what is being created.
   */
  /** Whether the caller may open the row-ceiling door a schema edit can need. */
  async function isSuperAdmin(request: FastifyRequest): Promise<boolean> {
    const server = request.server as { rbac?: { resolve?: (r: FastifyRequest) => Promise<{ superAdmin: boolean }> } };
    if (typeof server.rbac?.resolve !== 'function') return false;
    return (await server.rbac.resolve(request)).superAdmin;
  }

  type InstalledApp = Awaited<ReturnType<typeof manifests.list>>[number];

  /**
   * An install's tables that still carry the plain names they were made or
   * found with, now that the app is prefixed — every one of them, and what
   * each would be called. Null when there is nothing to rename.
   *
   * Only the app's own `created` and `adopted` tables: a `shared` table is
   * another app's, and a released or dropped one is not this install's.
   */
  async function oldNamesOf(
    installed: InstalledApp,
  ): Promise<{ prefix: string; connectionId: string; tables: { ref: string; from: string; to: string }[] } | null> {
    const document = installed.document as Manifest | null;
    const connectionId = installed.row.connectionId;
    if (document?.requiredSchema?.prefixed !== true || connectionId === null) return null;
    const prefix = prefixFor(installed.row.manifestKey);
    const records = await appTablesRepo(deps.meta).forInstall(connectionId, installed.row.manifestKey);
    const tables = records
      .filter((r) => r.role === 'app' && (r.state === 'created' || r.state === 'adopted'))
      .filter((r) => r.tableName !== `${prefix}${r.ref}`)
      .map((r) => ({ ref: r.ref, from: r.tableName, to: `${prefix}${r.ref}` }))
      .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
    return tables.length === 0 ? null : { prefix, connectionId, tables };
  }

  /** The schema edit that moves every one of them, against the live model. */
  function renameEdit(tables: readonly { from: string; to: string }[]): (model: DatabaseModel) => EditBody {
    return (model) => ({
      renames: {
        tables: tables.map((t) => ({
          from:
            model.tables.find((m) => m.name === t.from && (m.schema === model.defaultSchema || m.schema === null))?.id ??
            model.tables.find((m) => m.name === t.from)?.id ??
            t.from,
          to: t.to,
        })),
        columns: [],
      },
    });
  }

  async function planFor(
    manifest: Manifest,
    connectionId: string,
    answers: InstallAnswers = {},
  ): Promise<{ plan: InstallPlan; dto: AppInstallPlanDto; existing: ExistingTable[] }> {
    /*
     * WHAT THIS APP ALREADY HAS HERE, AND WHAT OTHERS DO. The table record is
     * read, never written: this also serves `/apps/plan`, which writes
     * nothing. An install made before the record existed has no rows in it;
     * its tables — found under their plain names — count as its own for the
     * plan, and are recorded when the install runs.
     */
    const recorded = await appTablesRepo(deps.meta).forConnection(connectionId);
    const own = recorded.filter((r) => r.appKey === manifest.key);
    const others = recorded.filter((r) => r.appKey !== manifest.key);
    const prefix =
      manifest.kind === 'app' && manifest.requiredSchema?.prefixed === true ? prefixFor(manifest.key) : null;
    const records: Record<string, { table: string; owned: boolean; state: string }> = {};
    for (const r of own) records[r.ref] = { table: r.tableName, owned: r.owned, state: r.state };

    const names = tablesNamedBy(manifest);
    for (const table of manifest.requiredSchema?.tables ?? []) {
      if (prefix !== null) names.add(`${prefix}${table.ref}`);
      if (answers.altPrefix !== undefined) names.add(`${answers.altPrefix}${table.ref}`);
    }
    for (const r of own) names.add(r.tableName);
    for (const choice of Object.values(answers.choices ?? {})) {
      if (choice.action === 'rename-existing') names.add(choice.to);
    }
    const live = await deps.schemaTarget?.read(connectionId, names);
    const tables = live?.tables ?? [];
    const dialect = live?.dialect;

    if (own.length === 0 && manifest.kind === 'app') {
      const installedHere = (await manifests.list('app')).some(
        (m) => m.row.manifestKey === manifest.key && m.row.connectionId === connectionId,
      );
      if (installedHere) {
        for (const table of manifest.requiredSchema?.tables ?? []) {
          if (tables.some((t) => t.ref === table.ref)) {
            records[table.ref] = { table: table.ref, owned: false, state: 'adopted' };
          }
        }
      }
    }

    const pure =
      manifest.kind === 'app' && dialect !== undefined && dialect !== 'generic'
        ? planInstall(
            manifest,
            { tables, dialect },
            {
              prefix,
              records,
              others: others.map((r) => ({ appKey: r.appKey, table: r.tableName, shape: r.shape, state: r.state })),
              choices: answers.choices,
              altPrefix: answers.altPrefix,
              dialect,
            },
          )
        : planInstall(manifest, {
            tables,
            ...(dialect === undefined || dialect === 'generic' ? {} : { dialect }),
          });
    // The refusals the pure planner cannot see: a page slug another app
    // already holds on this connection, and a page's form or layout that
    // names what the app never declared.
    const pageProblems = [
      ...(await slugProblems(manifest, connectionId)),
      ...pageConfigProblems(manifest),
      ...templateProblems(manifest).map((message) => ({ code: 'EMAIL_TEMPLATE_INVALID' as const, table: manifest.key, message })),
      ...roleIssues(manifest).map((issue) => ({ code: issue.code, table: issue.role, message: issue.message })),
    ];
    const plan: InstallPlan =
      pageProblems.length === 0
        ? pure
        : { ...pure, problems: [...pure.problems, ...pageProblems], installable: false };
    return {
      plan,
      existing: tables,
      dto: {
        checksum: planChecksum(plan, tables),
        ...(plan.tables === undefined
          ? {}
          : {
              // Each table's declared columns ride along, so the check step's
              // count and its column list come from the same place.
              tables: plan.tables.map((table) => ({
                ...table,
                columns: (manifest.requiredSchema?.tables.find((t) => t.ref === table.ref)?.columns ?? []).map(
                  (column) => ({ ref: column.ref, type: column.type }),
                ),
              })),
            }),
        ...(plan.names === undefined ? {} : { names: plan.names }),
        key: plan.addOnKey,
        version: plan.version,
        installable: plan.installable,
        touchesData: plan.touchesData,
        create: plan.create.map((table) => ({
          ref: table.ref,
          columns: table.columns.map((column) => ({ ref: column.ref, type: column.type })),
        })),
        reuse: plan.reuse.map((table) => ({
          ref: table.ref,
          missingColumns: table.missingColumns,
        })),
        references: plan.references,
        problems: plan.problems.map((problem) => ({
          code: problem.code,
          message: problem.message,
          table: problem.table,
          ...(problem.column === undefined ? {} : { column: problem.column }),
        })),
        requiresSchemaChange:
          plan.create.length > 0 || plan.reuse.some((t) => t.missingColumns.length > 0),
        missingColumnsEdit: missingColumnsEdit(plan, manifest),
        sampleData: manifest.kind === 'app' && manifest.sampleData !== undefined,
        pageWarnings:
          manifest.kind === 'app'
            ? checkManifestPages(manifest).map((issue) => ({
                page: issue.page,
                code: issue.code,
                message: issue.message,
                ...(issue.table === undefined ? {} : { table: issue.table }),
              }))
            : [],
      },
    };
  }

  /**
   * A page this app would create whose slug ANOTHER app holds on the same
   * connection. An operator's own page with the slug is not a refusal — the
   * app's page is simply not built, and the install reports it — but taking an
   * app's page from under it would break that app, so it stops the install.
   */
  /**
   * Where the staff screens open, as the manifest asks (`frontends[].placement`)
   * — at install only, and only while the operator has chosen nothing: their
   * choice outlives a reinstall, and the global default (inside the dashboard)
   * stays for every app that asks nothing, so no existing app moves.
   */
  async function placeFromManifest(manifest: Manifest, userId: string | null): Promise<void> {
    if (manifest.kind !== 'app') return;
    const asked = manifest.frontends.find((frontend) => frontend.side === 'staff')?.placement;
    if (asked === undefined) return;
    const settings = settingsRepo(deps.meta);
    const apps = await settings.get('surfaces.apps');
    if (apps[manifest.key]?.staff !== undefined) return;
    await settings.set('surfaces.apps', { ...apps, [manifest.key]: { ...(apps[manifest.key] ?? {}), staff: asked } }, { updatedBy: userId });
  }

  /** What the app's guests could do, for the check step: its endpoints, what would stop them, who may allow them. */
  async function publicAccessOf(
    manifest: Manifest,
    connectionId: string,
    names: Readonly<Record<string, string>>,
    request: FastifyRequest,
  ) {
    if (manifest.kind !== 'app' || (manifest.publicAccess ?? []).length === 0) return undefined;
    const view = deps.publicAccess === undefined ? null : await deps.publicAccess.viewFor(connectionId);
    return {
      endpoints: planPublicEndpoints(manifest, names, view, { tablesMadeLater: true }).map(
        ({ definition: _definition, ...entry }) => entry,
      ),
      warnings: await publicAccessWarnings(
        deps.meta,
        connectionId,
        deps.publicAccess?.origins ?? [],
        (manifest.publicAccess ?? []).some((entry) => entry.confirm !== undefined) || manifest.outbox !== undefined,
      ),
      canGrant: typeof request.can !== 'function' || (await request.can(PERMISSIONS.apiKeysManage)),
    };
  }

  /** A page's hand-written form or Overview layout, checked against the manifest itself. */
  function pageConfigProblems(manifest: Manifest): PlanProblem[] {
    if (manifest.kind !== 'app') return [];
    const declared = new Set((manifest.requiredSchema?.tables ?? []).map((table) => table.ref));
    return (manifest.pages ?? []).flatMap((page) => {
      const issues = formIssues(manifest, page);
      const layout = page.config?.['layout'];
      if (layout !== undefined) {
        const parsed = pageLayoutSchema.safeParse(layout);
        if (!parsed.success) issues.push('its layout is not a valid dashboard layout');
        else {
          for (const name of layoutTables(parsed.data)) {
            if (!declared.has(name)) issues.push(`its layout reads "${name}", which is not a table of the app`);
          }
        }
      }
      return issues.map((issue) => ({
        code: 'PAGE_FORM_INVALID' as const,
        table: page.ref,
        message: `The page "${page.ref}": ${issue}.`,
      }));
    });
  }

  async function slugProblems(manifest: Manifest, connectionId: string): Promise<PlanProblem[]> {
    if (manifest.kind !== 'app') return [];
    const slugs = new Set((manifest.pages ?? []).map((page) => page.ref));
    const current = (await manifests.list('app')).find((m) => m.row.manifestKey === manifest.key);
    const owners = new Map((await manifests.list()).map((m) => [m.row.id, m.row.manifestKey]));
    const pages = pagesRepo(deps.meta);
    const out: PlanProblem[] = [];
    for (const row of await pages.listAll()) {
      if (row.connectionId !== connectionId || !slugs.has(row.slug) || row.origin !== 'manifest') continue;
      const orphan = owners.has(row.manifestId ?? '') ? null : await pages.findById(row.id);
      if (isThisAppsPage({ ...row, config: orphan?.config }, manifest.key, current?.row.id ?? '', owners)) continue;
      const holder = owners.get(row.manifestId ?? '') ?? envelopeAppKey(orphan?.config) ?? 'another app';
      out.push({
        code: 'PAGE_SLUG_TAKEN',
        table: row.slug,
        message:
          `The page /p/${row.slug} on this database belongs to "${holder}". Installing here would ` +
          `take it over, so uninstall "${holder}" or install against a different database.`,
      });
    }
    return out;
  }

  /**
   * Write the manifest's pages, then tell open dashboards the nav moved.
   *
   * AFTER the row is recorded, because every page is tied to it — and a
   * failure here is logged and reported rather than thrown: the app IS
   * installed by then, and unwinding a working install because one of its
   * pages could not be written would be the worse outcome.
   */
  async function writePages(
    request: FastifyRequest,
    manifest: Manifest,
    manifestRowId: string,
    connectionId: string | null,
    userId: string | null,
    /**
     * An INSTALL passes true: its row is still `installing` and not served, so
     * a page that cannot be written stops the install at the `pages` stage
     *, resumable, instead of being logged and forgotten. An
     * update keeps the old rule until its own rework: the app is live, and
     * unwinding a working version over one page would be worse.
     */
    strict = false,
    names?: Readonly<Record<string, string>>,
    /** Make (install) or refresh (update) the app's public endpoints and key. */
    publicAccess = false,
  ): Promise<
    | {
        pages: MaterialiseResult;
        rules: RulesResult | undefined;
        roles: RolesResult | undefined;
        publicAccess: Awaited<ReturnType<typeof installPublicAccess>> | undefined;
        outbox: OutboxResult | undefined;
      }
    | undefined
  > {
    try {
      // The rules first: a page generated now reads them (a list of allowed
      // values becomes a dropdown).
      const rules =
        connectionId === null
          ? undefined
          : await writeManifestRules({ meta: deps.meta, manifest, connectionId, createdBy: userId });
      if (rules !== undefined && rules.skipped.length > 0) {
        request.log.info({ skipped: rules.skipped, app: manifest.key }, 'app rules skipped');
      }
      const result = await materialiseManifestPages({
        meta: deps.meta,
        manifest,
        manifestRowId,
        connectionId,
        createdBy: userId,
        ...(names === undefined ? {} : { names }),
      });
      // A page given the form Adminium makes, rather than the one it declared,
      // is said in the reply and in the log: never a field silently gone.
      if (result.warnings.length > 0) {
        request.log.warn({ warnings: result.warnings, app: manifest.key }, 'app pages written with warnings');
      }
      const server = request.server;
      if (
        server.hasDecorator('realtime') &&
        result.created.length + result.recomposed.length > 0
      ) {
        server.realtime.publish('config-changed', 'config-changed', {
          ...(connectionId === null ? {} : { connectionId }),
          configVersion: await pagesRepo(deps.meta).configVersion(),
        });
      }
      // The roles last: their grants point at the tables and at these pages.
      const roles =
        connectionId === null
          ? undefined
          : await writeManifestRoles({
              meta: deps.meta,
              manifest,
              connectionId,
              names: names ?? (await appTablesRepo(deps.meta).realNames(connectionId, manifest.key)),
            });
      // The emails it sends: the outbox over its tables, and its templates.
      const outbox =
        connectionId === null || manifestRowId === null
          ? undefined
          : await (async () => {
              const realNames = names ?? (await appTablesRepo(deps.meta).realNames(connectionId, manifest.key));
              const model = await deps.publicAccess?.viewFor(connectionId);
              const realId = (ref: string) => {
                const real = realNames[ref] ?? ref;
                return model?.model.tables.find((table) => table.name === real)?.id ?? real;
              };
              return installOutbox({ meta: deps.meta, manifest, manifestId: manifestRowId, connectionId, realId });
            })();
      // Guests last: the endpoints read tables that must exist, and the key is made from them.
      let made: Awaited<ReturnType<typeof installPublicAccess>> | undefined;
      if (publicAccess && connectionId !== null && deps.publicAccess !== undefined && manifest.kind === 'app') {
        const view = await deps.publicAccess.viewFor(connectionId);
        if (view !== null && (manifest.publicAccess ?? []).length > 0) {
          // Each of the app's keys is made once: the public side's, and a kiosk's.
          const at = Date.now();
          const own = await publicKeysRepo(deps.meta).listManagedBy(manifest.key);
          const live = own.filter((k) => k.kind === 'browser' && k.revokedAt === null && (k.expiresAt === null || k.expiresAt > at));
          const declaredPurposes = [CUSTOMER_KEY_PURPOSE, ...Object.keys(manifest.publicKeys ?? {})];
          const livePurposes = new Set(declaredPurposes.filter((purpose) => live.some((k) => k.purpose === purpose)));
          // An install starts afresh; an update never makes again a key the operator took back.
          const withheld = new Set(strict ? [] : declaredPurposes.filter((purpose) => !livePurposes.has(purpose) && own.some((k) => k.purpose === purpose)));
          const tableNames = names ?? (await appTablesRepo(deps.meta).realNames(connectionId, manifest.key));
          made = await installPublicAccess({
            service: deps.publicAccess.service,
            meta: deps.meta,
            crypto: deps.publicAccess.crypto,
            manifest,
            connectionId,
            names: tableNames,
            view,
            appName: manifest.name,
            actorId: userId,
            livePurposes,
            withheld,
          });
          // A second key follows the version: gone when it no longer declares
          // it, rebound when its role or switch changed.
          for (const k of live) {
            if (k.purpose === CUSTOMER_KEY_PURPOSE) continue;
            const binding = staffBindingOf(manifest, k.purpose, { names: tableNames, view });
            if (binding === null) {
              await publicKeysRepo(deps.meta).revoke(k.id);
            } else if (JSON.stringify(keyStaffBinding(k)) !== JSON.stringify(binding.requiresStaff) || JSON.stringify(keyEnabledBy(k)) !== JSON.stringify(binding.enabledBy)) {
              await publicKeysRepo(deps.meta).setBinding(k.id, binding);
            } else continue;
            deps.publicAccess.invalidateKey?.(k.id);
          }
          // The admin routes' own audit rows, with the app named.
          const actor = { actorKind: 'user' as const, actorId: userId, actorLabel: request.user?.email ?? 'unknown', category: 'system' as const };
          for (const ref of made.endpoints) {
            await auditRepo(deps.meta).append({
              ...actor,
              action: 'public-endpoint.save',
              changes: { after: { connectionId, ref, app: manifest.key } },
            });
          }
          for (const [purpose, keyId] of Object.entries(made.keys)) {
            await auditRepo(deps.meta).append({
              ...actor,
              action: 'public-key.create',
              changes: { after: { keyId, connectionId, app: manifest.key, purpose, access: made.endpoints } },
            });
          }
          deps.publicAccess.onChange?.();
        }
      }
      return { pages: result, rules, roles, publicAccess: made, outbox };
    } catch (error) {
      if (strict) throw error;
      request.log.warn({ err: error, manifestRowId }, 'app installed, but its pages were not written');
      return undefined;
    }
  }

  /**
   * Create the tables a manifest needs on one connection, or refuse.
   *
   * Shared by install and update so the two cannot disagree about what an app
   * may do to a database. The plan is RECOMPUTED here rather than taken from a
   * request: a client-supplied plan is a client-supplied list of tables to
   * create, and the preview route exists to be read, not to be replayed.
   *
   * @param verb How a refusal describes the attempt: `installed` or `updated`.
   */
  async function createTables(
    key: string,
    manifest: Manifest,
    connectionId: string,
    verb: 'installed' | 'updated',
    opts: { superAdmin: boolean; createdBy: string | null },
    expectedChecksum?: string,
    answers: InstallAnswers = {},
  ): Promise<{ created: string[]; reused: string[]; names: Record<string, string> }> {
    const checked = await checkedPlan(key, manifest, connectionId, verb, expectedChecksum, answers);
    const applied = await applyTables(checked, manifest, connectionId, opts);
    // Record what an update found and made, the same way an install does.
    const records = appTablesRepo(deps.meta);
    const row = (await manifests.list('app')).find((m) => m.row.manifestKey === key);
    for (const table of checked.plan.tables ?? []) {
      await records.record({
        appKey: key,
        manifestId: row?.row.id ?? null,
        connectionId,
        ref: table.ref,
        tableName: table.table,
        owned: table.action === 'create' || table.action === 'rename-existing',
        state: table.action === 'share' ? 'shared' : table.action === 'reuse' ? 'adopted' : 'created',
      });
    }
    return { ...applied, names: checked.plan.names ?? {} };
  }

  /**
   * Make the tables a checked plan describes, in the only order that works:
   *
   *   1. rename a stranger's table out of the way (the schema editor's own
   *      rename, so its pages and rules follow it);
   *   2. create the app's tables under their REAL names, foreign keys pointing
   *      at real names too;
   *   3. adapt the tables the app reuses — the safe edits the check step
   *      listed, through the schema editor's narrow doors.
   *
   * `onCreated` is told each table's SHORT name as it is created.
   * `afterRenames` runs between steps 1 and 2: a record naming the app's own
   * table must be written AFTER the rename, whose repair rewrites every record
   * naming the old name — the app's own pending record included, which would
   * then name the stranger's table it had just moved aside.
   */
  async function applyTables(
    checked: { plan: InstallPlan; existing: ExistingTable[]; target: AppSchemaTarget },
    manifest: Manifest,
    connectionId: string,
    opts: { superAdmin: boolean; createdBy: string | null },
    hooks: { afterRenames?: () => Promise<void>; onCreated?: (ref: string) => Promise<void> } = {},
  ): Promise<{ created: string[]; reused: string[] }> {
    const { plan, target } = checked;
    const tables = plan.tables ?? [];
    const idOf = (model: DatabaseModel, name: string): string =>
      model.tables.find((t) => t.name === name && (t.schema === model.defaultSchema || t.schema === null))?.id ??
      model.tables.find((t) => t.name === name)?.id ??
      name;

    const renames = tables.filter((t) => t.action === 'rename-existing' && t.renameExistingTo !== undefined);
    if (renames.length > 0) {
      await target.edit(
        connectionId,
        (model) => ({
          renames: {
            tables: renames.map((t) => ({ from: idOf(model, t.table), to: t.renameExistingTo! })),
            columns: [],
          },
        }),
        opts,
      );
    }
    await hooks.afterRenames?.();

    // Real names for the DDL: the plan's tables, and every internal FK.
    const names = plan.names ?? {};
    const refOf = new Map(Object.entries(names).map(([ref, real]) => [real, ref]));
    const realTables = (manifest.requiredSchema?.tables ?? []).map((table) => ({
      ...table,
      ref: names[table.ref] ?? table.ref,
      columns: table.columns.map((column) =>
        column.type === 'fk' && column.references !== undefined && names[column.references] !== undefined
          ? { ...column, references: names[column.references]! }
          : column,
      ),
    }));
    const realPlan: InstallPlan = {
      ...plan,
      create: plan.create.map((t) => ({ ...t, ref: t.table ?? t.ref })),
      reuse: plan.reuse.map((t) => ({ ...t, ref: t.table ?? t.ref })),
    };
    const realManifest = {
      ...manifest,
      requiredSchema: { ...(manifest.requiredSchema ?? { tables: [] }), tables: realTables },
    } as Manifest;
    const applied = await target.apply(realPlan, realManifest, connectionId, checked.existing, async (real) => {
      await hooks.onCreated?.(refOf.get(real) ?? real);
    });

    const edited = tables.filter((t) => (t.action === 'reuse' || t.action === 'share') && t.edits.length > 0);
    if (edited.length > 0) {
      await target.edit(connectionId, (model) => editBodyFor(edited, manifest, model, idOf, plan.names ?? {}), opts);
    }
    return applied;
  }

  /**
   * The plan for one connection, re-made from the live database, or the
   * refusal that stops the install BEFORE anything is written.
   */
  async function checkedPlan(
    key: string,
    manifest: Manifest,
    connectionId: string,
    verb: 'installed' | 'updated',
    expectedChecksum?: string,
    answers: InstallAnswers = {},
  ): Promise<{ plan: InstallPlan; existing: ExistingTable[]; target: AppSchemaTarget }> {
    if (deps.schemaTarget === undefined) {
      throw new ValidationFailedError(
        `"${key}" needs tables, and this server has no connection layer to create them in.`,
        { reason: 'DDL_UNAVAILABLE' },
      );
    }

    const { plan, dto, existing } = await planFor(manifest, connectionId, answers);
    /*
     * THE PLAN THE OPERATOR SAW, OR NONE. Re-planned from the live database a
     * moment ago; a table created, dropped or altered since the check step
     * would otherwise be installed against without anyone having seen it.
     */
    if (expectedChecksum !== undefined && expectedChecksum !== dto.checksum) {
      throw new ConflictError(
        'The database changed since this install was checked. Review the new check before installing.',
        'SCHEMA_DRIFT',
        { expected: expectedChecksum, actual: dto.checksum },
      );
    }
    /*
     * Missing columns keep their own refusal, with the edit that adds them —
     * the update screen offers to run it (48 G8-D6). Every other problem is a
     * plain refusal naming itself.
     */
    const onlyMissing = plan.problems.every((problem) => problem.code === 'COLUMNS_REQUIRED');
    /*
     * A context plan turns every column it CAN add into an edit, so a
     * `COLUMNS_REQUIRED` left in it is one no safe edit adds (a foreign key, a
     * key): refused here, by name, like any other problem — not later by the
     * DDL step's bare "this plan was refused".
     */
    if (!plan.installable && (!onlyMissing || plan.tables !== undefined)) {
      throw new ValidationFailedError(`"${key}" cannot be ${verb} on this database.`, {
        reason: 'PLAN_REFUSED',
        problems: dto.problems,
      });
    }
    /*
     * A table that EXISTS but is missing columns the app needs is refused
     * rather than altered, the same rule set for add-ons: creating a table
     * an app asked for is one conversation, and altering one the operator
     * already owns is a different one that is theirs to have.
     *
     * It holds for an update too (48 G8-D6), even where the table is one the
     * app's own earlier version created: telling those apart needs provenance
     * nothing records yet.
     *
     * The refusal is no longer the end of it: it carries the columns
     * as an `addColumns` edit (`edit`), which the update screen offers to run
     * through the schema doors — the operator's conversation, HELD with them
     * rather than skipped. The installer itself still alters nothing.
     */
    // A context plan adds missing columns itself, as edits; only the older
    // plan (no context) still refuses them here.
    const short = plan.tables === undefined ? plan.reuse.filter((table) => table.missingColumns.length > 0) : [];
    if (short.length > 0) {
      throw new ValidationFailedError(
        `"${key}" needs columns that are missing from tables this database already has.`,
        {
          reason: 'COLUMNS_REQUIRED',
          tables: short.map((table) => ({
            ref: table.ref,
            missingColumns: table.missingColumns,
          })),
          edit: missingColumnsEdit(plan, manifest),
        },
      );
    }

    return { plan, existing, target: deps.schemaTarget };
  }

  async function auditAppEvent(
    action: string,
    after: Record<string, unknown>,
    userId: string | null,
    userLabel: string,
  ): Promise<void> {
    await auditRepo(deps.meta).append({
      actorKind: 'user',
      actorId: userId,
      actorLabel: userLabel,
      category: 'app',
      action,
      changes: { after },
    });
  }

  return async (app) => {
    /*
     * Raw tarball bodies, this plugin's scope only — the idiom
     * `routes/add-ons` established and `routes/imports` before it. There is no
     * `@fastify/multipart` in this server and adding one for a single route
     * would put a new dependency on the path that unpacks untrusted archives.
     */
    app.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer' },
      (_request, body, done) => {
        done(null, body);
      },
    );

    app.get(
      '/apps',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { response: { 200: appListReply } },
      },
      async (request) => {
        const rows = await manifests.list('app');
        const placements = (await request.server.surfaceSettings?.read()) ?? NO_SURFACE_SETTINGS;
        const apps: z.infer<typeof installedAppReply>[] = rows.map((installed) => {
          const { row } = installed;
          const surfaces = surfacesOfInstalled(deps.store, {
            key: row.manifestKey,
            version: row.version,
          });
          return {
            key: row.manifestKey,
            version: row.version,
            source: row.source,
            installedAt: row.installedAt,
            connectionId: row.connectionId,
            sides: surfaces.map((surface) => {
              // Its own host when one is mapped to the app's own mount, else its prefix.
              const host = Object.entries(placements.domains).find(
                ([, target]) =>
                  target.appKey === row.manifestKey && target.side === surface.side && target.instance === undefined,
              )?.[0];
              return {
                side: surface.side,
                prefix: surface.prefix,
                navAvailable: surface.manifest !== null,
                openUrl: host === undefined ? `${surface.prefix}/` : `${request.protocol}://${host}/`,
                state:
                  statusOf(row.status) === 'disabled'
                    ? ('disabled' as const)
                    : sideOffOf(placements, row.manifestKey, surface.side)
                      ? ('off' as const)
                      : ('on' as const),
              };
            }),
            // Same rule as `InstalledApps.missing()`, off the same read.
            missing: surfaces.length === 0,
            status: statusOf(row.status),
          };
        });
        // The rename offer, for installs made before their app was prefixed.
        for (const [index, installed] of rows.entries()) {
          const old = await oldNamesOf(installed);
          if (old !== null) {
            apps[index] = { ...apps[index]!, oldTableNames: { prefix: old.prefix, count: old.tables.length } };
          }
        }

        /*
         * Staged-but-not-installed: bytes on disk no row accounts for. An
         * upload interrupted before install would otherwise be invisible AND
         * undeletable — the store would hold it, the page would not show it,
         * and the next upload of the same key would silently replace it.
         */
        const installedKeys = new Set(rows.map((r) => r.row.manifestKey));
        const staged: { key: string; version: string }[] = [];
        for (const key of await deps.store.keys()) {
          if (installedKeys.has(key)) continue;
          for (const version of await deps.store.versions(key)) staged.push({ key, version });
        }
        return { apps, staged };
      },
    );

    app.post(
      '/apps/upload',
      {
        /*
         * `onRequest` AS WELL AS `preHandler`, and the phase is the point:
         * Fastify parses the body before `preValidation`, so an RBAC guard
         * alone would run with up to 32 MB already buffered from a caller
         * nobody has authenticated. This is the cheap half, in the only phase
         * where cheap is available; it does not replace the guard below.
         */
        onRequest: app.requireAuth,
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        bodyLimit: APP_UPLOAD_BODY_LIMIT,
        schema: { querystring: uploadAppQuery, response: { 200: stagedAppReply } },
      },
      async (request) => {
        const body = request.body;
        if (!Buffer.isBuffer(body) || body.byteLength === 0) {
          throw new ValidationFailedError(
            'Send the bundle as a raw `application/octet-stream` body — the app’s release ' +
              '.tgz, holding `manifest.json` and a `staff/` and/or `customer/` directory.',
          );
        }
        const asserted = request.query;
        const userId = request.user?.id ?? null;
        const userLabel = request.user?.email ?? 'unknown';

        /*
         * THE BUNDLE NAMES ITSELF. Its key and version come out of its own
         * `manifest.json`, read by the store from the verified in-memory unpack
         * before a byte is written — so the package is staged under exactly the
         * identity the plan and install steps will later check it against.
         * A key typed by the operator could only ever agree with the manifest
         * or be refused, one step too late (47 step 1 follow-up).
         *
         * Held in an object rather than a `let`: TypeScript cannot see an
         * assignment made inside a callback, and would read a `let` as never
         * assigned on every line below this call.
         */
        const read: { manifest?: Manifest } = {};
        // What is installed, read BEFORE the stage: `identify` runs inside it
        // and cannot wait on the meta store.
        const installedVersions = new Map(
          (await manifests.list('app')).map((installed) => [installed.row.manifestKey, installed.row.version]),
        );
        let staged;
        try {
          staged = await deps.store.stage({
            tarball: new Uint8Array(body),
            expectedIntegrity: asserted.expectedSha512,
            identify: (bytes) => {
              const manifest = appManifestFrom(bytes, null);
              read.manifest = manifest;
              if (asserted.key !== undefined && asserted.key !== manifest.key) {
                throw new ValidationFailedError(
                  `The bundle was uploaded as "${asserted.key}" but its manifest declares "${manifest.key}".`,
                  { reason: 'KEY_MISMATCH' },
                );
              }
              if (asserted.version !== undefined && asserted.version !== manifest.version) {
                throw new ValidationFailedError(
                  `The bundle was uploaded as version ${asserted.version} but its manifest declares ${manifest.version}.`,
                  { reason: 'VERSION_MISMATCH' },
                );
              }
              /*
               * THE FLOOR, ON THE PATH THAT HAS NO CATALOG (G8-D2).
               *
               * `/apps/download` has checked `minAdminiumVersion` since the
               * feed grew the field, and this route never did — so the same
               * release the catalogue refuses installed without a word as a
               * file, which is the route an operator reaches for precisely
               * when the catalogue has said no. Checked HERE rather than in
               * `appManifestFrom`, which plan and install also call: a
               * package already on disk arrived through a path that checked,
               * and re-refusing it would break putting one back.
               *
               * After the caller's own assertions, for the sideload route's
               * reason: a mismatched key or version means they have not
               * established that they meant this bundle at all.
               */
              const minimum = manifest.compatibility.minAdminiumVersion;
              if (!meetsMinimum(minimum, serverVersion)) {
                throw new ValidationFailedError(
                  `"${manifest.key}" ${manifest.version} needs Adminium ${minimum} or later; ` +
                    `this server is ${serverVersion}. Upgrade Adminium before uploading it.`,
                  { reason: 'REQUIRES_NEWER_ADMINIUM', minAdminiumVersion: minimum, serverVersion },
                );
              }
              // A release that cannot update what is installed is refused
              // here too, before it sits in the store offering an update the
              // update route would refuse.
              const installedVersion = installedVersions.get(manifest.key);
              if (installedVersion !== undefined && installedVersion !== manifest.version) {
                const refused = updateRefusal(manifest, installedVersion);
                if (refused !== null) throw refused;
              }
              return { key: manifest.key, version: manifest.version };
            },
          });
        } catch (error) {
          const reason = refusalReason(error);
          await auditAppEvent(
            'app.unpack-refused',
            {
              // What is known of the package, which may be nothing: a refused
              // hash or archive is refused before the manifest is read.
              key: read.manifest?.key ?? asserted.key ?? null,
              version: read.manifest?.version ?? asserted.version ?? null,
              source: 'upload',
              reason,
              bytes: body.byteLength,
            },
            userId,
            userLabel,
          );
          // A manifest refusal is already a sentence about this bundle.
          if (error instanceof AppError) throw error;
          throw new ValidationFailedError(uploadRefusalMessage(error, 'app bundle'), { reason });
        }

        const { key, version } = staged;
        const sides = sidesOf(staged.tree.files);
        if (sides.length === 0) {
          // Staged and then discarded: a bundle with no servable side is not a
          // surface, and leaving it on disk would put a package in the staged
          // list that can never finish installing.
          await deps.store.removeVersion(key, version);
          await auditAppEvent(
            'app.unpack-refused',
            { key, version, source: 'upload', reason: 'NO_SURFACE' },
            userId,
            userLabel,
          );
          throw new ValidationFailedError(
            `"${key}@${version}" carries no surface: expected \`staff/index.html\`, ` +
              '`customer/index.html`, or both.',
            { reason: 'NO_SURFACE' },
          );
        }

        await auditAppEvent(
          'app.staged',
          {
            key,
            version,
            source: 'upload',
            integrity: staged.tree.integrity,
            files: Object.keys(staged.tree.files).length,
            sides,
          },
          userId,
          userLabel,
        );

        return {
          key,
          version,
          // Always set here: `identify` ran, or the stage above threw.
          name: read.manifest?.name ?? key,
          files: Object.keys(staged.tree.files).length,
          integrity: staged.tree.integrity,
          sides,
        };
      },
    );

    app.get(
      '/apps/catalog',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { response: { 200: appCatalogReply } },
      },
      async (request) => {
        const [rows, keys, cached, prefs] = await Promise.all([
          manifests.list('app'),
          deps.store.keys(),
          deps.store.readCatalogCache(),
          // A META read, not a network one: the feed carries eight locales per
          // row and the reply carries the one this operator reads.
          userPrefsRepo(deps.meta).resolve(request.user?.id ?? null),
        ]);
        const installedByKey = new Map(rows.map((m) => [m.row.manifestKey, m.row.version]));
        const locale = prefs.locale;
        /*
         * OFF MEANS NOTHING IS OFFERED FROM THE CACHE. A cache written while
         * the switch was on outlives it being turned off, and listing its rows
         * then would offer downloads the download route refuses, under a page
         * saying browsing online is off. The cached taglines still translate
         * disk rows: reading a file already on disk is not an outbound call.
         */
        const online = (await deps.catalog?.isEnabled()) ?? false;

        /*
         * The cached app catalog, or nothing. A cache that is not in the format
         * this server reads counts as none, and `catalogFetchedAt` then says
         * "never" so the page asks for a refresh rather than showing a fetch
         * time for a list it is not offering.
         */
        const parsedCatalog =
          cached === null || !isCurrentAppCatalogFormat(cached.document)
            ? null
            : appCatalogSchema.safeParse(cached.document);
        const feed = new Map<string, AppCatalogEntry>(
          parsedCatalog?.success === true
            ? parsedCatalog.data.apps.map((entry) => [entry.key, entry] as const)
            : [],
        );

        /**
         * What the catalog adds for an installed app: a newer release this
         * server can take, or one it cannot and why (G8-D2).
         */
        function catalogUpdate(
          key: string,
          installedVersion: string,
        ): { usable: string | null; blocked: { version: string; minAdminiumVersion: string } | null } {
          const listed = feed.get(key);
          if (
            !online ||
            listed === undefined ||
            compareSemver(listed.version, installedVersion) <= 0
          ) {
            return { usable: null, blocked: null };
          }
          return meetsMinimum(listed.minAdminiumVersion, serverVersion)
            ? { usable: listed.version, blocked: null }
            : {
                usable: null,
                blocked: { version: listed.version, minAdminiumVersion: listed.minAdminiumVersion },
              };
        }

        const apps = [];
        // Everything in the store first: it needs no network to be true.
        for (const key of keys) {
          const versions = await deps.store.versions(key);
          const version = versions[0];
          if (version === undefined) continue;

          /*
           * The manifest is parsed, not re-verified. `verifyTree` re-hashes
           * every file in the package and exists to close the stage-to-install
           * TOCTOU window; running it per row on a route the browse page calls
           * on every load would put a full digest of every bundled app on a
           * read path. Install still re-verifies before it parses a byte.
           */
          let name = key;
          let description = '';
          let categories: string[] = [];
          let publisher = '';
          let capabilities: string[] = [];
          let readable = false;
          let updatesFrom: string | undefined;
          try {
            const doc: unknown = JSON.parse(
              (await deps.store.readFile(key, version, MANIFEST_FILE)).toString('utf8'),
            );
            const validated = validateManifest(doc);
            if (validated.ok && !isAddOnManifest(validated.manifest)) {
              name = validated.manifest.name;
              description = validated.manifest.description.fallback;
              categories = [...validated.manifest.categories];
              publisher = validated.manifest.publisher.name;
              capabilities = [...(validated.manifest.capabilities ?? [])];
              updatesFrom = validated.manifest.compatibility.updatesFrom;
              readable = true;
            }
          } catch {
            // Unreadable is a state, not an error — see the schema's note.
          }

          const listed = feed.get(key);
          const current = installedByKey.get(key) ?? null;
          let updateTo: string | null = null;
          let needsNewerAdminium: { version: string; minAdminiumVersion: string } | null = null;
          let cannotUpdate: { version: string; updatesFrom: string } | null = null;
          if (current !== null) {
            /*
             * Disk and catalog both count; the newer usable one wins. A staged
             * release that does not update this install in place is no offer
             * — from disk, nor from the feed when the feed lists that same
             * release (which is how it got onto disk).
             */
            const newer = compareSemver(version, current) > 0;
            if (newer && updatesFrom !== undefined && !satisfiesSemverRange(current, updatesFrom)) {
              cannotUpdate = { version, updatesFrom };
            }
            const onDisk = newer && cannotUpdate === null ? version : null;
            const offered = catalogUpdate(key, current);
            const usable = cannotUpdate !== null && offered.usable === version ? null : offered.usable;
            const blocked = offered.blocked;
            updateTo =
              onDisk !== null && (usable === null || compareSemver(onDisk, usable) >= 0)
                ? onDisk
                : usable;
            // A blocked release older than what is already usable is not news.
            needsNewerAdminium =
              blocked !== null && (updateTo === null || compareSemver(blocked.version, updateTo) > 0)
                ? blocked
                : null;
          }

          apps.push({
            key,
            version,
            name,
            // The feed's line in the operator's language, else the manifest's
            // English fallback — the add-on page's order.
            description: pickLocalized(listed?.tagline, locale) ?? description,
            categories,
            publisher,
            capabilities,
            sides: surfacesOfInstalled(deps.store, { key, version }).map((s) => s.side),
            installed: current !== null,
            installedVersion: current === version ? null : current,
            readable,
            source: 'disk' as const,
            state: current === null ? ('staged' as const) : ('installed' as const),
            updateTo,
            updateStaged: updateTo !== null && versions.includes(updateTo),
            needsNewerAdminium,
            cannotUpdate,
          });
        }

        // Then what only the catalog offers. `source: 'catalog'` is the honest
        // label: installing one of these downloads it first.
        const onDisk = new Set(apps.map((row) => row.key));
        for (const entry of online ? feed.values() : []) {
          if (onDisk.has(entry.key)) continue;
          const current = installedByKey.get(entry.key) ?? null;
          const { usable, blocked } =
            current === null
              ? meetsMinimum(entry.minAdminiumVersion, serverVersion)
                ? { usable: null, blocked: null }
                : {
                    usable: null,
                    blocked: { version: entry.version, minAdminiumVersion: entry.minAdminiumVersion },
                  }
              : catalogUpdate(entry.key, current);
          apps.push({
            key: entry.key,
            version: entry.version,
            name: pickLocalized(entry.name, locale) ?? entry.key,
            description: pickLocalized(entry.tagline, locale) ?? '',
            categories: entry.categories,
            publisher: entry.publisher,
            capabilities: entry.capabilities,
            sides: entry.sides,
            // Installed with no package in the store is a damaged install, not
            // an available one; it is still named so the page shows it. This
            // loop only ever runs for keys with NOTHING on disk, so `installed`
            // here always means exactly that — say so instead of
            // labelling it the same as a healthy install.
            installed: current !== null,
            installedVersion: current === null || current === entry.version ? null : current,
            readable: true,
            source: 'catalog' as const,
            state: current === null ? ('available' as const) : ('missing' as const),
            updateTo: usable,
            updateStaged: false,
            needsNewerAdminium: blocked,
            cannotUpdate: null,
          });
        }

        /*
         * INSTALLED, AND IN NEITHER LIST. Both loops above start from bytes —
         * the store, then the cached feed — so an installed app whose files a
         * redeploy wiped, and that the feed does not carry (every uploaded app,
         * and every install with no cached feed), reached this point in no list
         * at all while the meta store still said installed.
         */
        const listed = new Set(apps.map((row) => row.key));
        for (const [key, version] of installedByKey) {
          if (listed.has(key)) continue;
          apps.push({
            key,
            version,
            name: key,
            description: '',
            categories: [],
            publisher: '',
            capabilities: [],
            sides: [],
            installed: true,
            installedVersion: null,
            readable: false,
            source: 'disk' as const,
            state: 'missing' as const,
            updateTo: null,
            updateStaged: false,
            needsNewerAdminium: null,
            cannotUpdate: null,
          });
        }

        apps.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        return {
          apps,
          catalogFetchedAt: parsedCatalog?.success === true ? (cached?.fetchedAt ?? null) : null,
          onlineEnabled: online,
        };
      },
    );

    app.put(
      '/apps/catalog',
      {
        /*
         * `manifests.manage`, NOT `settings.manage`: the switch that decides
         * whether this deployment talks to adminium.dev belongs with
         * installing apps, not with renaming the workspace.
         */
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { body: appCatalogSettingsBody, response: { 200: appCatalogSettingsReply } },
      },
      async (request) => {
        const settings = settingsRepo(deps.meta);
        const before = (await settings.get(APP_CATALOG_ENABLED_SETTING)) === true;
        const { enabled } = request.body;
        await settings.set(APP_CATALOG_ENABLED_SETTING, enabled, {
          updatedBy: request.user?.id ?? null,
        });

        await auditRepo(deps.meta).append({
          actorKind: 'user',
          actorId: request.user?.id ?? null,
          actorLabel: request.user?.email ?? 'unknown',
          category: 'app',
          action: 'app.catalog-toggled',
          changes: { before: { onlineEnabled: before }, after: { onlineEnabled: enabled } },
        });

        // The EFFECTIVE state: an environment veto outranks the stored setting,
        // and the reply says so rather than a switch that springs back.
        const allowed = deps.catalog?.networkFeaturesAllowed() ?? false;
        return { onlineEnabled: enabled && allowed, vetoed: enabled && !allowed };
      },
    );

    app.post(
      '/apps/catalog/refresh',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('worker') },
        schema: { response: { 200: appJobReply } },
      },
      async (request) => {
        // Checked HERE as well as inside the job, so pressing the button gets
        // an answer rather than a job that quietly reports "disabled".
        if (deps.catalog === undefined || !(await deps.catalog.isEnabled())) {
          throw new ValidationFailedError(
            'The online app catalog is off. The apps bundled with this build, and any you ' +
              'upload, are available without it.',
            { reason: 'CATALOG_DISABLED' },
          );
        }
        const job = await enqueueAppCatalogRefresh(deps.meta, {
          userId: request.user?.id ?? undefined,
        });
        return { jobId: job.id };
      },
    );

    app.post(
      '/apps/download',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('worker') },
        schema: { body: downloadAppBody, response: { 200: appJobReply } },
      },
      async (request) => {
        const { key, version } = request.body;
        if (deps.catalog === undefined || !(await deps.catalog.isEnabled())) {
          throw new ValidationFailedError(
            'The online app catalog is off, so nothing can be downloaded. Upload the app’s ' +
              'bundle instead, or switch the catalog on.',
            { reason: 'CATALOG_DISABLED' },
          );
        }

        /*
         * The cached row and its minimum, checked before a job exists (G8-D2),
         * so the page is told at once. The job checks both again: the cache may
         * be refreshed between this reply and the run.
         */
        let entry: AppCatalogEntry;
        try {
          entry = await appEntryFromCache(deps.store, key, version);
        } catch (error) {
          if (error instanceof AddOnCatalogError) {
            throw new ValidationFailedError(error.message, { reason: error.reason });
          }
          throw error;
        }
        if (!meetsMinimum(entry.minAdminiumVersion, serverVersion)) {
          throw new ValidationFailedError(
            `"${key}" ${version} needs Adminium ${entry.minAdminiumVersion} or later; this ` +
              `server is ${serverVersion}. Upgrade Adminium to install it.`,
            {
              reason: 'REQUIRES_NEWER_ADMINIUM',
              minAdminiumVersion: entry.minAdminiumVersion,
              serverVersion,
            },
          );
        }

        // Enqueued through the repo, NEVER through `POST /jobs`: the kind is
        // internal-only because its integrity value comes from the cached
        // catalog, and a caller who could hand-craft the payload would be
        // choosing their own.
        const job = await enqueueAppDownload(deps.meta, {
          key,
          version,
          userId: request.user?.id ?? undefined,
        });
        return { jobId: job.id };
      },
    );

    app.post(
      '/apps/plan',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: {
          audit: auditExempt(
            'a preview of what installing would do; it reads the staged package and the ' +
              'live database (no snapshot is written) and writes nothing. The install it ' +
              'precedes is audited.',
          ),
        },
        schema: { body: planAppBody, response: { 200: appInstallPlanReply } },
      },
      /*
       * WHAT AN INSTALL WOULD DO, BEFORE IT DOES IT.
       *
       * A POST that writes nothing, because it takes a body and because
       * planning reads a staged package the caller names. The plan calls the
       * consent dialog "the security surface, not decoration: it is where a
       * user sees what an add-on may reach before it can reach it" — the same
       * sentence is why this route exists for apps, and why the install route
       * recomputes the plan rather than trusting what came back from here.
       */
      async (request) => {
        const { key, version, connectionId, choices, altPrefix } = request.body;
        const manifest = await verifiedManifest(key, version);
        // The preview an update is checked with: the same refusal the update
        // route gives, before the operator is shown tables to consent to.
        const installed = (await manifests.list('app')).find((m) => m.row.manifestKey === key);
        if (installed !== undefined && installed.row.version !== version) {
          const refused = updateRefusal(manifest, installed.row.version);
          if (refused !== null) throw refused;
        }
        const { dto } = await planFor(manifest, connectionId, {
          ...(choices === undefined ? {} : { choices }),
          ...(altPrefix === undefined ? {} : { altPrefix }),
        });
        const publicAccess = await publicAccessOf(manifest, connectionId, dto.names ?? {}, request);
        return { plan: publicAccess === undefined ? dto : { ...dto, publicAccess } };
      },
    );

    app.post(
      '/apps/install',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { body: installAppBody, response: { 200: installedAppReply } },
      },
      async (request) => {
        const { key, version, connectionId, planChecksum: reviewed, choices, altPrefix } = request.body;
        const answers: InstallAnswers = {
          ...(choices === undefined ? {} : { choices }),
          ...(altPrefix === undefined ? {} : { altPrefix }),
        };
        const userId = request.user?.id ?? null;
        const userLabel = request.user?.email ?? 'unknown';

        if (deps.directoryKeys().includes(key)) {
          throw new ConflictError(
            `"${key}" is already served from ADMINIUM_SURFACES_DIR. Remove it from that ` +
              'directory and restart before installing an app under the same key.',
            'CONFLICT',
          );
        }

        let manifest: Manifest;
        try {
          manifest = await verifiedManifest(key, version);
        } catch (error) {
          /*
           * EVERY refusal is audited, not only the pin mismatch.
           *
           * "What arrived on this deployment and did anything refuse it" is the
           * question this category exists to answer, and a forged manifest or a
           * package claiming someone else's key is at least as worth a line as
           * a tree that drifted.
           */
          const reason = refusalReason(error);
          await auditAppEvent('app.verify-refused', { key, version, reason }, userId, userLabel);
          throw error;
        }

        const surfaces = surfacesOfInstalled(deps.store, { key, version });
        if (surfaces.length === 0) {
          throw new ValidationFailedError(
            `"${key}@${version}" carries no surface to serve.`,
            { reason: 'NO_SURFACE' },
          );
        }

        /*
         * THE ORDER, AND WHY IT IS RESUMABLE.
         *
         * Everything that can refuse runs first and writes nothing: the plan,
         * re-made from the live database, with every problem named. Then the
         * row is written as `installing` — never served in that state — and the
         * tables are recorded `pending` before any is created (after a
         * stranger's table is renamed out of the way, whose repair would
         * otherwise carry the app's own record with it). Each table flips to
         * `created` as it is made, the pages follow, and the row flips to
         * `installed` last.
         *
         * MySQL's DDL is not transactional, so nothing here is rolled back.
         * The record is the recovery instead: a failure answers 409
         * APP_INSTALL_INCOMPLETE naming the stage and the tables that exist,
         * and POSTing the same install again picks up from there — every create
         * is IF NOT EXISTS, and a table this install created is still recorded
         * as its own when the re-plan finds it already there.
         */
        // The public access an app asks for is made unless the reviewer
        // declined it — and only by someone who may hand out API keys.
        const grantsPublicAccess =
          manifest.kind === 'app' && (manifest.publicAccess ?? []).length > 0 && request.body.publicAccess !== false;
        if (grantsPublicAccess && typeof request.can === 'function' && !(await request.can(PERMISSIONS.apiKeysManage))) {
          throw new ForbiddenError(
            `"${key}" asks for public access, which only someone who may manage API keys can allow. ` +
              'Install it without public access, or ask someone who can.',
          );
        }

        const wanted = manifest.requiredSchema?.tables ?? [];
        if (wanted.length > 0 && connectionId === undefined) {
          throw new ValidationFailedError(
            `"${key}" needs ${String(wanted.length)} table(s), so it must be installed against ` +
              'a connection. Choose the database it should read.',
            { reason: 'NO_CONNECTION', tables: wanted.map((table) => table.ref) },
          );
        }

        const prior = (await manifests.list('app')).find((m) => m.row.manifestKey === key);
        // The same install, stopped part way: same version, same database.
        const resuming =
          prior !== undefined &&
          prior.row.status === 'installing' &&
          prior.row.version === version &&
          prior.row.connectionId === (connectionId ?? null);

        // A resume re-plans against tables it made itself, so the reviewed
        // checksum no longer describes the database — by design.
        const checked =
          wanted.length > 0 && connectionId !== undefined
            ? await checkedPlan(key, manifest, connectionId, 'installed', resuming ? undefined : reviewed, answers)
            : undefined;

        // Re-installing the same key replaces the row rather than adding a
        // second one: `list('app')` is what the registry reads, and two rows
        // for one key would make "which version is served" an ordering accident.
        let rowId: string;
        if (resuming) {
          rowId = prior.row.id;
        } else {
          if (prior !== undefined) await manifests.uninstall(prior.row.id);
          const row = await manifests.install({
            manifestKey: key,
            version,
            kind: 'app',
            source: 'file',
            document: manifest,
            // Remembered, not just used: this is also the connection the staff
            // surface reads at runtime.
            ...(connectionId === undefined ? {} : { connectionId }),
            installedBy: userId,
            status: 'installing',
          });
          rowId = row.row.id;
        }
        // Stops serving a replaced version at once; the new row is not served
        // until it is `installed`.
        await deps.installed.refresh();

        const tableRecords = appTablesRepo(deps.meta);
        let stage: 'tables' | 'pages' | 'finish' = 'tables';
        let applied: { created: string[]; reused: string[] } | undefined;
        let writtenPages: Awaited<ReturnType<typeof writePages>>;
        try {
          if (checked !== undefined && connectionId !== undefined) {
            await tableRecords.attach(connectionId, key, rowId);
            const pending = new Map<string, string>();
            const prefix = manifest.requiredSchema?.prefixed === true ? (answers.altPrefix ?? prefixFor(key)) : null;
            const recordTables = async (): Promise<void> => {
              for (const table of checked.plan.create) {
                // Owned: the live read a moment ago did not find it.
                const record = await tableRecords.record({
                  appKey: key,
                  manifestId: rowId,
                  connectionId,
                  ref: table.ref,
                  tableName: table.table ?? table.ref,
                  owned: true,
                  state: 'pending',
                  prefix,
                });
                pending.set(table.ref, record.id);
              }
              for (const table of checked.plan.reuse) {
                const shared = checked.plan.tables?.find((t) => t.ref === table.ref)?.action === 'share';
                await tableRecords.record({
                  appKey: key,
                  manifestId: rowId,
                  connectionId,
                  ref: table.ref,
                  tableName: table.table ?? table.ref,
                  owned: false,
                  state: shared ? 'shared' : 'adopted',
                  prefix,
                  ...(shared ? { shape: manifest.requiredSchema?.tables.find((t) => t.ref === table.ref)?.shape ?? null } : {}),
                });
              }
            };
            applied = await applyTables(
              checked,
              manifest,
              connectionId,
              { superAdmin: await isSuperAdmin(request), createdBy: userId },
              {
                afterRenames: recordTables,
                onCreated: async (ref) => {
                  const id = pending.get(ref);
                  if (id !== undefined) await tableRecords.setState(id, 'created');
                },
              },
            );
          }
          stage = 'pages';
          writtenPages = await writePages(
            request,
            manifest,
            rowId,
            connectionId ?? null,
            userId,
            true,
            checked?.plan.names,
            grantsPublicAccess,
          );
          stage = 'finish';
          await placeFromManifest(manifest, userId);
          await manifests.setStatus(rowId, 'installed');
          await deps.installed.refresh();
          // Its placement and its status are what the surface gate reads.
          request.server.surfaceSettings?.invalidate();
        } catch (error) {
          const records =
            connectionId === undefined ? [] : await tableRecords.forInstall(connectionId, key);
          const created = records.filter((r) => r.state === 'created').map((r) => r.ref);
          const pendingRefs = records.filter((r) => r.state === 'pending').map((r) => r.ref);
          const table = error instanceof AddOnInstallError ? (error.table ?? null) : null;
          // Every table exists, so what failed inside the table step was the
          // re-read of the schema that follows the creates.
          const where = stage === 'tables' && pendingRefs.length === 0 && table === null ? 'introspect' : stage;
          const message = error instanceof Error ? error.message : String(error);
          await auditAppEvent(
            'app.install-failed',
            { key, version, stage: where, table, created, pending: pendingRefs, message },
            userId,
            userLabel,
          );
          throw new ConflictError(
            `Installing "${key}" stopped at the ${where} step: ${message} ` +
              'Nothing was removed. Install it again to finish from where it stopped.',
            'APP_INSTALL_INCOMPLETE',
            { stage: where, table, created, pending: pendingRefs, cause: message },
          );
        }

        const installed = (await manifests.findById(rowId))!;
        await auditAppEvent(
          'app.installed',
          {
            key,
            version,
            source: 'file',
            sides: surfaces.map((s) => s.side),
            ...(connectionId === undefined ? {} : { connectionId }),
            ...(applied === undefined ? {} : { created: applied.created, reused: applied.reused }),
            ...(resuming ? { resumed: true } : {}),
          },
          userId,
          userLabel,
        );

        return {
          key,
          version,
          ...(applied === undefined ? {} : { schema: applied }),
          source: installed.row.source,
          installedAt: installed.row.installedAt,
          connectionId: installed.row.connectionId,
          sides: surfaces.map((surface) => ({
            side: surface.side,
            prefix: surface.prefix,
            navAvailable: surface.manifest !== null,
          })),
          // Freshly installed and serving nothing is odd but not impossible (a
          // package with no `index.html` under either side). Say so here too,
          // rather than letting the receipt read better than the install went.
          missing: surfaces.length === 0,
          ...(writtenPages === undefined ? {} : { pages: writtenPages.pages }),
          ...(writtenPages?.rules === undefined ? {} : { rules: writtenPages.rules }),
          ...(writtenPages?.roles === undefined ? {} : { roles: writtenPages.roles }),
          ...(writtenPages?.publicAccess === undefined ? {} : { publicAccess: writtenPages.publicAccess }),
          ...(writtenPages?.outbox === undefined ? {} : { outbox: writtenPages.outbox }),
        };
      },
    );

    app.post(
      '/apps/:key/update',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: appKeyParams, body: updateAppBody, response: { 200: updateAppReply } },
      },
      /*
       * AN UPDATE IS NOT A REINSTALL (48 G8-D6, modelled on).
       *
       * The installed row moves to the new version, so what the operator chose
       * at install survives it: the connection its tables live in and its staff
       * surface reads, and where its surfaces are placed. An uninstall/install
       * pair would drop both and ask again.
       *
       * It takes the newest STAGED version above the installed one. Getting it
       * onto disk is the download's job (or an upload's); this route never
       * reaches the network.
       */
      async (request) => {
        const { key } = request.params;
        const userId = request.user?.id ?? null;
        const userLabel = request.user?.email ?? 'unknown';

        const installed = (await manifests.list('app')).find((m) => m.row.manifestKey === key);
        if (installed === undefined) throw new NotFoundError(`"${key}" is not installed.`);

        const from = installed.row.version;
        const to = (await deps.store.versions(key)).find(
          (candidate) => compareSemver(candidate, from) > 0,
        );
        if (to === undefined) {
          throw new NotFoundError(
            `No newer version of "${key}" than ${from} is staged. Download or upload one first.`,
          );
        }

        // Re-hash and re-validate, exactly as install does: an update cannot
        // carry past the checks what an install could not.
        let manifest: Manifest;
        try {
          manifest = await verifiedManifest(key, to);
        } catch (error) {
          await auditAppEvent(
            'app.verify-refused',
            { key, version: to, from, reason: refusalReason(error) },
            userId,
            userLabel,
          );
          throw error;
        }

        const refused = updateRefusal(manifest, from);
        if (refused !== null) {
          await auditAppEvent(
            'app.verify-refused',
            { key, version: to, from, reason: 'UPDATE_NOT_SUPPORTED' },
            userId,
            userLabel,
          );
          throw refused;
        }

        const surfaces = surfacesOfInstalled(deps.store, { key, version: to });
        if (surfaces.length === 0) {
          throw new ValidationFailedError(`"${key}@${to}" carries no surface to serve.`, {
            reason: 'NO_SURFACE',
          });
        }

        /*
         * Tables against the connection the installed row ALREADY has, never a
         * new one: switching databases is an uninstall and an install, where
         * the operator is asked. New tables are created; a table missing columns
         * refuses the update (COLUMNS_REQUIRED) and leaves the running version
         * untouched.
         */
        const wanted = manifest.requiredSchema?.tables ?? [];
        const connectionId = installed.row.connectionId;
        let names: Record<string, string> | undefined;
        let applied: { created: string[]; reused: string[] } | undefined;
        if (wanted.length > 0) {
          if (connectionId === null) {
            throw new ValidationFailedError(
              `"${key}" ${to} needs ${String(wanted.length)} table(s), and ${from} was installed ` +
                'without a connection. Uninstall it and install it against the database it should read.',
              { reason: 'NO_CONNECTION', tables: wanted.map((table) => table.ref) },
            );
          }
          /*
           * The check the operator saw for this version, when they saw one: its
           * checksum, and what they chose for a new table whose name is taken.
           * A different PREFIX is not an update's to choose — the app's tables
           * stay where they are; that is an uninstall and an install.
           */
          const made = await createTables(
            key,
            manifest,
            connectionId,
            'updated',
            { superAdmin: await isSuperAdmin(request), createdBy: userId },
            request.body?.planChecksum,
            request.body?.choices === undefined ? {} : { choices: request.body.choices },
          );
          applied = { created: made.created, reused: made.reused };
          names = made.names;
        }

        await manifests.setVersion(installed.row.id, { version: to, document: manifest });
        await deps.installed.refresh();
        // New pages are added, untouched ones rebuilt for this version, and
        // any page an operator edited is left exactly as it is.
        // Public access follows the version only where the operator allowed
        // it at install: the app still holds the live key it was given then.
        const liveKey = await publicKeysRepo(deps.meta).newestLiveByApp(key, 'customer');
        const keepsPublicAccess = liveKey !== null && liveKey.managedBy === key;
        const writtenPages = await writePages(
          request,
          manifest,
          installed.row.id,
          connectionId,
          userId,
          false,
          names,
          keepsPublicAccess,
        );

        // D11: older versions go only AFTER the new one is recorded and served,
        // so a failure anywhere above leaves the running version on disk.
        const pruned: string[] = [];
        for (const old of await deps.store.versions(key)) {
          if (compareSemver(old, to) >= 0) continue;
          await deps.store.removeVersion(key, old);
          pruned.push(old);
        }

        await auditAppEvent(
          'app.updated',
          {
            key,
            from,
            to,
            pruned,
            sides: surfaces.map((s) => s.side),
            ...(connectionId === null ? {} : { connectionId }),
            ...(applied === undefined ? {} : { created: applied.created, reused: applied.reused }),
          },
          userId,
          userLabel,
        );

        return {
          app: {
            key,
            version: to,
            ...(applied === undefined ? {} : { schema: applied }),
            source: installed.row.source,
            installedAt: installed.row.installedAt,
            connectionId,
            sides: surfaces.map((surface) => ({
              side: surface.side,
              prefix: surface.prefix,
              navAvailable: surface.manifest !== null,
            })),
            missing: surfaces.length === 0,
            ...(writtenPages === undefined ? {} : { pages: writtenPages.pages }),
            ...(writtenPages?.rules === undefined ? {} : { rules: writtenPages.rules }),
            ...(writtenPages?.roles === undefined ? {} : { roles: writtenPages.roles }),
            ...(writtenPages?.publicAccess === undefined ? {} : { publicAccess: writtenPages.publicAccess }),
            ...(writtenPages?.outbox === undefined ? {} : { outbox: writtenPages.outbox }),
          },
          from,
          to,
          pruned,
        };
      },
    );

    // ── One app's own settings page ─────────────────────────────────────────

    /** The installed row, or a 404 naming the key. */
    async function installedRow(key: string): Promise<InstalledApp> {
      const row = (await manifests.list('app')).find((m) => m.row.manifestKey === key);
      if (row === undefined) throw new NotFoundError(`"${key}" is not installed.`);
      return row;
    }

    /** What an uninstall would remove and keep — the dialog's list, and the route's own. */
    async function uninstallPlanOf(row: InstalledApp) {
      const key = row.row.manifestKey;
      const connectionId = row.row.connectionId;
      const pageRows = await pagesRepo(deps.meta).listByManifest(row.row.id);
      const keys = (await publicKeysRepo(deps.meta).list()).filter(
        (candidate) => candidate.managedBy === key && candidate.revokedAt === null,
      );
      const endpoints =
        connectionId === null
          ? []
          : (await publicEndpointsRepo(deps.meta).listByConnection(connectionId)).filter(
              (endpoint) => endpoint.managedBy === key,
            );
      const roles = [];
      for (const role of (await rolesRepo(deps.meta).list()).filter((candidate) => candidate.appKey === key)) {
        const members = await deps.meta.db
          .selectFrom('adminium_user_roles')
          .select('userId')
          .where('roleId', '=', role.id)
          .execute();
        const apiKeys = await deps.meta.db
          .selectFrom('adminium_api_keys')
          .select('id')
          .where('roleId', '=', role.id)
          .execute();
        roles.push({ role, members: members.map((m) => m.userId), apiKeys: apiKeys.map((k) => k.id) });
      }
      const recordsRepo = appTablesRepo(deps.meta);
      const records =
        connectionId === null
          ? []
          : (await recordsRepo.forInstall(connectionId, key)).filter(
              (record) =>
                (record.role === 'app' || record.role === 'sample-ledger') &&
                record.state !== 'dropped' &&
                record.state !== 'pending',
            );
      const others =
        connectionId === null
          ? []
          : (await recordsRepo.forConnection(connectionId)).filter(
              (record) => record.appKey !== key && record.state !== 'dropped' && record.state !== 'released',
            );
      const domains = await settingsRepo(deps.meta).get('surfaces.domains');
      return {
        key,
        connectionId,
        pages: {
          removed: pageRows.filter((page) => isUntouched(page.config)),
          kept: pageRows.filter((page) => !isUntouched(page.config)),
        },
        keys,
        endpoints,
        roles,
        tables: records.map((record) => ({
          record,
          // Made by this app, and no other app's record names it.
          droppable:
            record.owned && record.state === 'created' && !others.some((other) => other.tableName === record.tableName),
        })),
        hosts: Object.entries(domains)
          .filter(([, target]) => target.appKey === key)
          .map(([host]) => host),
      };
    }

    // ── Sample data ────────────────────────────────────────────────────────

    const samples = deps.sampleData === undefined ? null : createSampleDataService(deps.sampleData);

    async function sampleAppOf(key: string) {
      const found = await findSampleApp(deps.meta, key);
      if (found === null) throw new NotFoundError(`"${key}" is not installed.`);
      return found;
    }

    app.get(
      '/apps/:key/sample-data',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { params: appKeyParams, response: { 200: sampleStatusReply } },
      },
      async (request) => {
        const target = await sampleAppOf(request.params.key);
        if (samples === null) {
          return { offered: false, loaded: false, total: 0, addedAt: null, tables: [], available: null };
        }
        const status = await samples.status(target);
        const available = status.offered && !status.loaded ? await samples.addPreview(target) : null;
        return { ...status, available };
      },
    );

    app.post(
      '/apps/:key/sample-data',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: appKeyParams, response: { 200: appJobReply } },
      },
      /*
       * A JOB: the rows and images of a small business are more than a request
       * should hold open, and the page follows its progress. The bundle is
       * checked here first, so a refusal is this request's answer rather than
       * a failed job.
       */
      async (request) => {
        const target = await sampleAppOf(request.params.key);
        if (samples === null) throw new NotFoundError(`"${target.key}" ships no sample data.`, { reason: 'NO_SAMPLE_DATA' });
        await samples.addPreview(target);
        const userId = request.user?.id ?? null;
        const locale = (await userPrefsRepo(deps.meta).resolve(userId)).locale;
        const job = await enqueueSampleAdd(deps.meta, {
          key: target.key,
          locale,
          userId,
          userLabel: request.user?.email ?? 'unknown',
        });
        return { jobId: job.id };
      },
    );

    app.post(
      '/apps/:key/sample-data/remove-plan',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: {
          audit: auditExempt(
            'a preview of removing the sample data; it refreshes the schema snapshot and reads the ' +
              'sample rows, and changes nothing. The removal it precedes is audited.',
          ),
        },
        schema: { params: appKeyParams, response: { 200: sampleRemovePlanReply } },
      },
      async (request) => {
        const target = await sampleAppOf(request.params.key);
        if (samples === null) return { tables: [], kept: [], changed: [], total: 0 };
        return samples.removePreview(target);
      },
    );

    app.post(
      '/apps/:key/sample-data/remove',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: appKeyParams, body: sampleRemoveBody, response: { 200: sampleRemoveReply } },
      },
      async (request) => {
        const target = await sampleAppOf(request.params.key);
        if (samples === null) return { removed: 0, kept: 0, byTable: {} };
        return samples.remove(target, {
          keepChanged: request.body.keepChanged,
          userId: request.user?.id ?? null,
          userLabel: request.user?.email ?? 'unknown',
        });
      },
    );

    app.get(
      '/apps/:key/uninstall-plan',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { params: appKeyParams, response: { 200: uninstallPlanReply } },
      },
      async (request) => {
        const plan = await uninstallPlanOf(await installedRow(request.params.key));
        const brief = (page: { slug: string; title: string }) => ({ slug: page.slug, title: page.title });
        return {
          key: plan.key,
          pages: { removed: plan.pages.removed.map(brief), kept: plan.pages.kept.map(brief) },
          keys: plan.keys.length,
          endpoints: plan.endpoints.length,
          rules:
            plan.connectionId === null
              ? 0
              : (await ownRules(deps.meta, plan.tables.map((entry) => entry.record), plan.connectionId)).length,
          roles: plan.roles.map((entry) => ({
            slug: entry.role.slug,
            name: entry.role.name,
            members: entry.members.length,
            apiKeys: entry.apiKeys.length,
          })),
          tables: plan.tables.map((entry) => ({ table: entry.record.tableName, droppable: entry.droppable })),
          hosts: plan.hosts,
          canDropTables: await isSuperAdmin(request),
        };
      },
    );

    const declaredSettings = (row: InstalledApp) => (row.document as Manifest | null)?.settings ?? [];

    /** This app's settings, read from the STORE — a page about to write must not see a cached copy. */
    async function settingsView(row: InstalledApp) {
      const key = row.row.manifestKey;
      const [apps, domains] = await Promise.all([
        settingsRepo(deps.meta).get('surfaces.apps'),
        settingsRepo(deps.meta).get('surfaces.domains'),
      ]);
      const entry = apps[key] ?? {};
      return {
        domains: Object.fromEntries(
          Object.entries(domains)
            .filter(([, target]) => target.appKey === key)
            .map(([host, target]) => [
              host,
              { side: target.side, ...(target.instance === undefined ? {} : { instance: target.instance }) },
            ]),
        ),
        key,
        name: entry.name ?? null,
        placement: entry.staff ?? ('internal' as const),
        connectionId: entry.connectionId ?? null,
        off: entry.off ?? [],
        values: settingValuesWithDefaults(declaredSettings(row), await addOnSettingsRepo(deps.meta).valuesFor(key)),
        declared: declaredSettings(row)
          .filter((setting) => setting.secret !== true)
          .map((setting) => ({
            key: setting.key,
            type: setting.type,
            ...(setting.type === 'enum' ? { enum: setting.enum } : {}),
            ...(setting.type === 'number' && setting.min !== undefined ? { min: setting.min } : {}),
            ...(setting.type === 'number' && setting.max !== undefined ? { max: setting.max } : {}),
            ...(setting.label === undefined ? {} : { label: setting.label.fallback }),
            ...(setting.help === undefined ? {} : { help: setting.help.fallback }),
          })),
      };
    }

    /** Every open dashboard and surface re-reads what changed. */
    async function surfacesChanged(request: FastifyRequest): Promise<void> {
      request.server.surfaceSettings?.invalidate();
      if (request.server.hasDecorator('realtime')) {
        request.server.realtime.publish('config-changed', 'config-changed', {
          configVersion: await pagesRepo(deps.meta).configVersion(),
        });
      }
    }

    app.get(
      '/apps/:key/settings',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { params: appKeyParams, response: { 200: appSettingsReply } },
      },
      async (request) => settingsView(await installedRow(request.params.key)),
    );

    app.patch(
      '/apps/:key/settings',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: appKeyParams, body: appSettingsBody, response: { 200: appSettingsReply } },
      },
      async (request) => {
        const row = await installedRow(request.params.key);
        const key = row.row.manifestKey;
        const body = request.body;
        const userId = request.user?.id ?? null;

        if (body.values !== undefined) {
          const issues = settingValueIssues(declaredSettings(row), body.values);
          if (issues.length > 0) {
            throw new ValidationFailedError(issues.map((issue) => issue.message).join(' '), { issues });
          }
        }
        if (body.connectionId != null && (await connectionTenantConfig(deps.meta, body.connectionId)) === null) {
          throw new ValidationFailedError('That connection does not exist.', { reason: 'UNKNOWN_CONNECTION' });
        }

        // Read-modify-write from the store, touching only what was sent.
        const settings = settingsRepo(deps.meta);
        const apps = await settings.get('surfaces.apps');
        const entry = { ...(apps[key] ?? {}) };
        if (body.name !== undefined) {
          if (body.name === null) delete entry.name;
          else entry.name = body.name;
        }
        if (body.placement !== undefined) entry.staff = body.placement;
        if (body.connectionId !== undefined) {
          if (body.connectionId === null) delete entry.connectionId;
          else entry.connectionId = body.connectionId;
        }
        if (body.off !== undefined) {
          if (body.off.length === 0) delete entry.off;
          else entry.off = [...new Set(body.off)];
        }
        const surfaceFields = ['name', 'placement', 'connectionId', 'off'] as const;
        if (surfaceFields.some((field) => body[field] !== undefined)) {
          await settings.set('surfaces.apps', { ...apps, [key]: entry }, { updatedBy: userId });
        }
        if (body.values !== undefined) {
          try {
            await addOnSettingsRepo(deps.meta).patch(
              key,
              body.values,
              declaredSettings(row).map((setting) => ({ key: setting.key, secret: setting.secret ?? false })),
              { updatedBy: userId },
            );
          } catch (error) {
            if (error instanceof SecretSettingRefused) {
              throw new ValidationFailedError(
                `These settings are a credential and are not set here: ${error.keys.join(', ')}.`,
                { reason: 'SECRET_SETTING_REFUSED', keys: error.keys },
              );
            }
            throw error;
          }
        }

        await surfacesChanged(request);
        // The fields that moved, never the values: a setting can hold a
        // customer-facing sentence.
        await auditAppEvent(
          'app.settings-changed',
          { key, fields: Object.keys(body), ...(body.values === undefined ? {} : { values: Object.keys(body.values) }) },
          userId,
          request.user?.email ?? 'unknown',
        );
        return settingsView(row);
      },
    );

    app.get(
      '/apps/:key/overview',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { params: appKeyParams, response: { 200: appOverviewReply } },
      },
      async (request) => {
        const row = await installedRow(request.params.key);
        const key = row.row.manifestKey;
        const connectionId = row.row.connectionId;
        const connection =
          connectionId === null
            ? undefined
            : await deps.meta.db
                .selectFrom('adminium_connections')
                .select(['id', 'name', 'engine'])
                .where('id', '=', connectionId)
                .executeTakeFirst();
        const records =
          connectionId === null ? [] : await appTablesRepo(deps.meta).forInstall(connectionId, key);
        const snapshot = connectionId === null ? null : await snapshotsRepo(deps.meta).latest(connectionId);
        const model = (snapshot?.schema ?? null) as DatabaseModel | null;
        const tables = records
          .filter(
            (record) =>
              (record.role === 'app' || record.role === 'sample-ledger') &&
              record.state !== 'dropped' &&
              record.state !== 'pending',
          )
          // The ledger last, as the list of what the app keeps about itself.
          .sort((a, b) => Number(a.role === 'sample-ledger') - Number(b.role === 'sample-ledger'))
          .map((record) => ({
            ref: record.ref,
            table: record.tableName,
            state: record.state,
            role: record.role === 'sample-ledger' ? ('sample-ledger' as const) : ('app' as const),
            rows:
              model?.tables.find((table) => table.name === record.tableName)?.rowCountEstimate ?? null,
          }));
        // This app's own lines, newest first. The key is in the row's JSON, so
        // the filter is here; a busy instance's app log is small.
        const entries = await auditRepo(deps.meta).list({ category: 'app', limit: 200 });
        const activity = entries
          .filter((entry) => {
            const after = (entry.changes as { after?: { key?: unknown } } | null)?.after;
            return after?.key === key;
          })
          .slice(0, 8)
          .map((entry) => ({ action: entry.action, at: entry.createdAt, actor: entry.actorLabel }));
        return {
          key,
          connection: connection === undefined ? null : connection,
          tables,
          activity,
        };
      },
    );

    for (const [verb, status] of [
      ['disable', 'disabled'],
      ['enable', 'installed'],
    ] as const) {
      app.post(
        `/apps/:key/${verb}`,
        {
          preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
          config: { audit: audited('rbac') },
          schema: { params: appKeyParams, response: { 200: appStatusReply } },
        },
        /*
         * SWITCHED OFF, NOT REMOVED. Disable leaves every table, record, page
         * and setting where it is: the app stops answering, its section leaves
         * the sidebar and its own keys stop working. Enable brings back
         * exactly that. Only an installed app can be disabled and only a
         * disabled one enabled; an install that stopped part way is finished
         * by installing again, never by a switch.
         */
        async (request) => {
          const row = await installedRow(request.params.key);
          const current = statusOf(row.row.status);
          const from = verb === 'disable' ? 'installed' : 'disabled';
          if (current !== from && current !== status) {
            throw new ConflictError(
              `"${row.row.manifestKey}" is ${current}, so it cannot be ${verb}d.`,
              'CONFLICT',
              { status: current },
            );
          }
          if (current !== status) {
            await manifests.setStatus(row.row.id, status);
            await deps.installed.refresh();
            await surfacesChanged(request);
            await auditAppEvent(
              verb === 'disable' ? 'app.disabled' : 'app.enabled',
              { key: row.row.manifestKey, version: row.row.version },
              request.user?.id ?? null,
              request.user?.email ?? 'unknown',
            );
          }
          return { key: row.row.manifestKey, status };
        },
      );
    }

    app.put(
      '/apps/:key/domains',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: appKeyParams, body: appDomainsBody, response: { 200: appDomainsReply } },
      },
      /*
       * THIS APP'S HOSTS, AND ONLY THEIRS. The whole list for the app is
       * sent; hosts it leaves out are unmapped, and every other app's hosts
       * are kept exactly as they are. A host another app already holds is
       * refused rather than taken over.
       */
      async (request) => {
        const row = await installedRow(request.params.key);
        const key = row.row.manifestKey;
        const settings = settingsRepo(deps.meta);
        const [apps, domains] = await Promise.all([settings.get('surfaces.apps'), settings.get('surfaces.domains')]);
        const others = Object.fromEntries(Object.entries(domains).filter(([, target]) => target.appKey !== key));
        const { normalized, issues } = validateDomainEntries(
          Object.fromEntries(Object.entries(request.body.domains).map(([host, target]) => [host, { ...target, appKey: key }])),
          {
            requestHost: normalizeHost(request.host),
            surfaces: surfacesOfInstalled(deps.store, { key, version: row.row.version }),
            settings: { apps, domains, statuses: {} },
          },
        );
        for (const host of Object.keys(normalized)) {
          const holder = Object.entries(others).find(([mapped]) => normalizeHost(mapped) === host)?.[1];
          if (holder !== undefined) {
            issues.push({ path: host, message: `"${host}" already opens "${holder.appKey}".`, code: 'host_taken' });
          }
        }
        if (issues.length > 0) throw new ValidationFailedError('The domain list did not validate.', { issues });

        await settings.set('surfaces.domains', { ...others, ...normalized }, { updatedBy: request.user?.id ?? null });
        // A host mapped again is no longer an uninstalled app's.
        const retired = await settings.get('surfaces.retiredHosts');
        const stillRetired = Object.fromEntries(Object.entries(retired).filter(([host]) => !Object.hasOwn(normalized, normalizeHost(host))));
        if (Object.keys(stillRetired).length !== Object.keys(retired).length) {
          await settings.set('surfaces.retiredHosts', stillRetired, { updatedBy: request.user?.id ?? null });
        }
        await surfacesChanged(request);
        await auditAppEvent(
          'app.domains-changed',
          { key, hosts: Object.keys(normalized) },
          request.user?.id ?? null,
          request.user?.email ?? 'unknown',
        );
        return {
          domains: Object.fromEntries(
            Object.entries(normalized).map(([host, target]) => [
              host,
              { side: target.side, ...(target.instance === undefined ? {} : { instance: target.instance }) },
            ]),
          ),
        };
      },
    );

    app.put(
      '/apps/:key/instances',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: appKeyParams, body: appInstancesBody, response: { 200: appInstancesReply } },
      },
      async (request) => {
        const row = await installedRow(request.params.key);
        const key = row.row.manifestKey;
        const settings = settingsRepo(deps.meta);
        const { rows, issues } = await validateInstanceEntries(key, request.body.instances, {
          surfaces: surfacesOfInstalled(deps.store, { key, version: row.row.version }),
          meta: deps.meta,
        });
        // An instance a host still opens cannot go: the host would serve nothing.
        const kept = new Set(rows.map((instance) => instance.slug));
        const domains = await settings.get('surfaces.domains');
        for (const [host, target] of Object.entries(domains)) {
          if (target.appKey === key && target.instance !== undefined && !kept.has(target.instance)) {
            issues.push({
              path: `${key}.${target.instance}`,
              message: `"${host}" still opens instance "${target.instance}". Unmap the host first.`,
              code: 'instance_in_use',
            });
          }
        }
        if (issues.length > 0) throw new ValidationFailedError('The instance list did not validate.', { issues });

        const apps = await settings.get('surfaces.apps');
        const entry = { ...(apps[key] ?? {}) };
        if (rows.length === 0) delete entry.instances;
        else entry.instances = rows;
        await settings.set('surfaces.apps', { ...apps, [key]: entry }, { updatedBy: request.user?.id ?? null });
        await surfacesChanged(request);
        await auditAppEvent(
          'app.instances-changed',
          { key, instances: rows.map((instance) => instance.slug) },
          request.user?.id ?? null,
          request.user?.email ?? 'unknown',
        );
        return { instances: rows };
      },
    );

    /*
     * RENAME AN OLD INSTALL'S TABLES TO THE APP'S PREFIX.
     *
     * An install made before its app was prefixed keeps the plain names it
     * made or found (`menu_items`), and the offer is to give every one of them
     * the prefix (`pos_menu_items`), so the app can tell its own tables apart.
     * It is the schema editor's own rename — the same plan, hazards and ledger
     * — and its repair carries the new names into the app's pages, rules,
     * endpoints and its table record. The plan route changes no table; the
     * rename route runs only the plan the operator reviewed.
     */
    app.post(
      '/apps/:key/rename-tables/plan',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: {
          audit: auditExempt(
            'a preview of the rename; it refreshes the schema snapshot the plan is made ' +
              'from and changes no table. The rename it precedes is audited.',
          ),
        },
        schema: { params: appKeyParams, response: { 200: renameTablesPlanReply } },
      },
      async (request) => {
        const { key } = request.params;
        const installed = (await manifests.list('app')).find((m) => m.row.manifestKey === key);
        if (installed === undefined) throw new NotFoundError(`"${key}" is not installed.`);
        const old = await oldNamesOf(installed);
        if (old === null) throw new NotFoundError(`"${key}" has no tables to rename.`);
        if (deps.schemaTarget === undefined) {
          throw new ValidationFailedError('This server has no connection layer to rename tables in.', {
            reason: 'DDL_UNAVAILABLE',
          });
        }
        const plan = await deps.schemaTarget.planEdit(old.connectionId, renameEdit(old.tables), {
          superAdmin: await isSuperAdmin(request),
        });
        return { prefix: old.prefix, connectionId: old.connectionId, tables: old.tables, plan };
      },
    );

    app.post(
      '/apps/:key/rename-tables',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: appKeyParams, body: renameTablesBody, response: { 200: renameTablesReply } },
      },
      async (request) => {
        const { key } = request.params;
        const installed = (await manifests.list('app')).find((m) => m.row.manifestKey === key);
        if (installed === undefined) throw new NotFoundError(`"${key}" is not installed.`);
        const old = await oldNamesOf(installed);
        if (old === null) throw new NotFoundError(`"${key}" has no tables to rename.`);
        if (deps.schemaTarget === undefined) {
          throw new ValidationFailedError('This server has no connection layer to rename tables in.', {
            reason: 'DDL_UNAVAILABLE',
          });
        }
        const userId = request.user?.id ?? null;
        const result = await deps.schemaTarget.edit(old.connectionId, renameEdit(old.tables), {
          superAdmin: await isSuperAdmin(request),
          createdBy: userId,
          expectedChecksum: request.body.checksum,
        });
        // Open dashboards and the app's surfaces read the new names.
        request.server.surfaceSettings?.invalidate();
        if (request.server.hasDecorator('realtime')) {
          request.server.realtime.publish('config-changed', 'config-changed', {
            connectionId: old.connectionId,
            configVersion: await pagesRepo(deps.meta).configVersion(),
          });
        }
        await auditAppEvent(
          'app.tables-renamed',
          { key, connectionId: old.connectionId, prefix: old.prefix, tables: old.tables, changeId: result.changeId },
          userId,
          request.user?.email ?? 'unknown',
        );
        return { prefix: old.prefix, renamed: old.tables, changeId: result.changeId };
      },
    );

    app.delete(
      '/apps/staged/:key/:version',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: stagedAppParams, response: { 200: discardStagedAppReply } },
      },
      async (request) => {
        const { key, version } = request.params;
        /*
         * Changing your mind must not be a dead end.
         *
         * An upload that is never installed — abandoned at the connection step,
         * refused at the plan step, or simply thought better of — leaves bytes
         * on disk that the list shows and nothing could remove. "Upload the same
         * key again to replace it" is true and is not an answer: it asks the
         * operator to perform the thing they decided against in order to undo
         * it.
         *
         * Refusing to discard an INSTALLED version is the one guard, and it is
         * the same one add-ons make: that path is uninstall, which stops
         * surfaces answering and asks for the key back first.
         */
        const installed = (await manifests.list('app')).find(
          (m) => m.row.manifestKey === key && m.row.version === version,
        );
        if (installed !== undefined) {
          throw new ConflictError(
            `"${key}@${version}" is installed, not merely staged. Uninstall it instead.`,
            'CONFLICT',
          );
        }

        await deps.store.removeVersion(key, version);
        await auditAppEvent(
          'app.discarded',
          { key, version, staged: true },
          request.user?.id ?? null,
          request.user?.email ?? 'unknown',
        );
        return { key, version, discarded: true };
      },
    );

    app.delete(
      '/apps/:key',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: appKeyParams, body: uninstallAppBody, response: { 200: uninstallAppReply } },
      },
      async (request) => {
        const { key } = request.params;
        const row = (await manifests.list('app')).find((m) => m.row.manifestKey === key);
        if (row === undefined) throw new NotFoundError(`"${key}" is not installed.`);
        const userId = request.user?.id ?? null;
        const dropTables = request.body?.dropTables === true;
        if (dropTables && request.body?.confirmKey !== key) {
          throw new ValidationFailedError(`Type "${key}" to confirm deleting its tables and data.`, {
            reason: 'CONFIRM_KEY_MISMATCH',
          });
        }
        const plan = await uninstallPlanOf(row);
        const superAdmin = await isSuperAdmin(request);
        const doomed = dropTables ? plan.tables.filter((entry) => entry.droppable) : [];
        const dropEdit = (model: DatabaseModel): EditBody => ({
          dropTables: doomed.map(
            (entry) =>
              model.tables.find(
                (t) => t.name === entry.record.tableName && (t.schema === model.defaultSchema || t.schema === null),
              )?.id ??
              model.tables.find((t) => t.name === entry.record.tableName)?.id ??
              entry.record.tableName,
          ),
        });
        /*
         * EVERYTHING THAT COULD REFUSE THE DROP IS ASKED FIRST. Discarding data
         * is Super Admin's alone in the schema editor, and a plan can refuse a
         * table; finding either out after the keys, pages and roles had gone
         * would leave half an uninstall behind.
         */
        if (doomed.length > 0) {
          if (!superAdmin) {
            throw new ForbiddenError('Deleting an app’s tables and data requires Super Admin.', 'FORBIDDEN', {
              reason: 'DROP_NEEDS_SUPER_ADMIN',
            });
          }
          if (deps.schemaTarget === undefined || plan.connectionId === null) {
            throw new ValidationFailedError('This server has no connection layer to drop tables in.', {
              reason: 'DDL_UNAVAILABLE',
            });
          }
          const check = await deps.schemaTarget.planEdit(plan.connectionId, dropEdit, { superAdmin });
          if (check.refusals.length > 0) {
            throw new AppError(422, 'SCHEMA_EDIT_REFUSED', 'These tables cannot be dropped on this database.', {
              refusals: check.refusals,
            });
          }
        }

        /*
         * IN ORDER, each step idempotent, so a failure part way can be run
         * again and finishes the rest.
         *
         * 1. Its own keys stop, THEN its endpoints go: an endpoint a live key
         *    still grants cannot be removed.
         */
        for (const managed of plan.keys) {
          await publicKeysRepo(deps.meta).revoke(managed.id);
          deps.publicAccess?.invalidateKey?.(managed.id);
        }
        for (const endpoint of plan.endpoints) await publicEndpointsRepo(deps.meta).remove(endpoint.id);
        /*
         * 2. Pages: one nobody touched goes, with its grants (a grant is a
         *    polymorphic string no FK reaches); one somebody edited stays, as
         *    their own ordinary page.
         */
        const pagePermissions = permissionsRepo(deps.meta);
        for (const page of plan.pages.removed) {
          await pagePermissions.revokeAllForResource('page', page.id);
          await pagesRepo(deps.meta).delete(page.id);
        }
        for (const page of plan.pages.kept) await pagesRepo(deps.meta).releaseFromManifest(page.id);
        /*
         * 3. Its roles. Deleting a role CASCADES: its members lose it and its
         *    `adm_sk_` keys are hard-deleted, not revoked — which is why the
         *    dialog listed them and the audit row names them.
         */
        for (const entry of plan.roles) {
          await deps.meta.db.deleteFrom('adminium_roles').where('id', '=', entry.role.id).execute();
        }
        await forgetAppRoleGrants(deps.meta, plan.roles.map((entry) => entry.role.slug));
        /*
         * 4. The column rules it wrote, while they are still as it wrote them.
         *    One the operator changed, switched off or re-saved differently is
         *    theirs, and stays.
         */
        const rulesRemoved =
          plan.connectionId === null
            ? 0
            : await removeManifestRules(deps.meta, plan.tables.map((entry) => entry.record), plan.connectionId);
        // Its emails: the outbox definition, and the templates nobody edited.
        const emailsRemoved = await removeOutbox(deps.meta, key);
        /*
         * 5. Its tables: dropped only when asked, with the key typed back, and
         *    only the ones this app made and nothing else names. Every other
         *    table is kept and its record released, so a reinstall recognises
         *    it.
         */
        const dropped: string[] = [];
        if (doomed.length > 0 && deps.schemaTarget !== undefined && plan.connectionId !== null) {
          await deps.schemaTarget.edit(plan.connectionId, dropEdit, { superAdmin, createdBy: userId });
          for (const entry of doomed) {
            await appTablesRepo(deps.meta).setState(entry.record.id, 'dropped');
            dropped.push(entry.record.tableName);
          }
        }
        const kept = plan.tables.filter((entry) => !dropped.includes(entry.record.tableName));
        for (const entry of kept) await appTablesRepo(deps.meta).setState(entry.record.id, 'released');
        // Its own settings go with it; a reinstall starts from the manifest's defaults.
        await addOnSettingsRepo(deps.meta).clear(key);

        /*
         * The row goes FIRST, then the bytes. The reverse order would leave a
         * row pointing at a package that is gone if the delete failed halfway —
         * an app listed as installed that serves nothing and cannot be removed.
         * This way a failure leaves bytes nobody references, which the staged
         * list shows and the operator can discard.
         */
        await manifests.uninstall(row.row.id);
        /*
         * A failed file removal no longer fails the uninstall:
         * the row is already gone, and answering 500 here left the operator
         * with an app the list no longer shows and an error saying it was not
         * removed. The bytes nobody references stay on disk, where the staged
         * list shows them and a discard removes them.
         */
        let filesRemoved = true;
        try {
          await deps.store.removeKey(key);
        } catch (error) {
          filesRemoved = false;
          request.log.warn({ err: error, key }, 'app uninstalled, but its files were not removed');
        }
        await deps.installed.refresh();
        /*
         * Its placement and domains go with it. A host left mapped to a key
         * nothing serves makes the domains editor refuse every later save —
         * including the one mapping that host to whatever replaces this app.
         */
        const forgotten = await forgetAppSurfaceSettings(
          deps.meta,
          key,
          request.user?.id ?? null,
        );
        request.server.surfaceSettings?.invalidate();
        // Open dashboards drop the app's section and pages without a reload.
        if (request.server.hasDecorator('realtime')) {
          request.server.realtime.publish('config-changed', 'config-changed', {
            configVersion: await pagesRepo(deps.meta).configVersion(),
          });
        }
        const removed = {
          pages: plan.pages.removed.length,
          keys: plan.keys.length,
          endpoints: plan.endpoints.length,
          roles: plan.roles.length,
          rules: rulesRemoved,
          emails: emailsRemoved,
        };
        const keptSummary = { pages: plan.pages.kept.length, tables: kept.map((entry) => entry.record.tableName) };
        await auditAppEvent(
          'app.uninstalled',
          {
            key,
            version: row.row.version,
            removed,
            kept: keptSummary,
            dropped,
            // The ids a cascade took, so the log can say exactly what went.
            ...(plan.roles.length === 0
              ? {}
              : {
                  roles: plan.roles.map((entry) => ({
                    id: entry.role.id,
                    slug: entry.role.slug,
                    members: entry.members,
                    apiKeys: entry.apiKeys,
                  })),
                }),
            ...(forgotten.removedHosts.length === 0 ? {} : { removedHosts: forgotten.removedHosts }),
            ...(filesRemoved ? {} : { filesRemoved: false }),
          },
          userId,
          request.user?.email ?? 'unknown',
        );
        return { key, uninstalled: true, removed, kept: keptSummary, dropped };
      },
    );
  };
}
