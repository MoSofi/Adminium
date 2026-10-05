// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Installing and updating an app, without a request.
 *
 * Everything here used to be closures inside the `/api/v1/apps` route plugin,
 * reachable only through a `FastifyRequest`. Nothing but an HTTP call could
 * install an app. The logic is the same text, moved: the request is replaced
 * by the two things the helpers took from it —
 *
 *   - an ACTOR: who is doing this, whether they are Super Admin, and what
 *     they may allow (public access is only a key manager's to give);
 *   - a HOST: the log, the realtime publish and the surface-settings cache of
 *     the server the install runs in.
 *
 * The routes build both from the request and stay the only place that knows
 * about schemas, guards and audit config. A second caller — a project folder
 * that carries an app — builds its own actor and host and calls the same code.
 */

import {
  compareSemver,
  isAddOnManifest,
  isManifestOnly,
  LOCAL_PUBLISHER_ID,
  planInstall,
  validateManifest,
  type InstallPlan,
  type Manifest,
  installsLikeAnApp,
  prefixFor,
  satisfiesSemverRange,
  uniqueWithOf,
  type InstallTablePlan,
  type PlanProblem,
  type ShareChoice,
  shapeTables,
  tableShapeOf,
  type TableChoice,
} from '@adminium/manifest';
import { checkManifestPages, sha256Hex, type DatabaseModel } from '@adminium/engine';
import {
  appTablesRepo,
  CUSTOMER_KEY_PURPOSE,
  auditRepo,
  connectionsRepo,
  publicEndpointsRepo,
  publicKeysRepo,
  manifestsRepo,
  pagesRepo,
  settingsRepo,
  type MetaDb,
} from '@adminium/meta';
import type { z } from 'zod';

import { lenientMinimum, type CatalogClient } from '../add-ons/catalog.js';
import type { AddOnInstallerDeps } from '../add-ons/install.js';
import { builtOnTables, shapeProblems, shapeRecordsFor, shapesForPlan } from './app-shapes.js';
import {
  addOnTablesByName,
  appHost,
  attachedRangeRefusal,
  decideAddOnSteps,
  namesAddOns,
  pruneNamedAddOns,
  resolveAppAddOns,
  runAddOnSteps,
  stepsAlreadyTaken,
  tablesComingFromAddOns,
  type AddOnChoice,
  type AddOnStep,
  type AddOnsDone,
  type AppAddOnRow,
} from './add-ons.js';
import {
  meetsMinimum,
  type AppCatalogClient,
} from './catalog.js';
import { createAppFiles, type AppFiles } from './app-files.js';
import type { InstallActor, InstallCore, InstallHost } from '../add-ons/install-core.js';
import { createRemovals } from './removal.js';
import { surfacesOfInstalled, type InstalledApps } from './installed.js';
import {
  envelopeAppKey,
  isThisAppsPage,
  materialiseManifestPages,
  type MaterialiseResult,
} from './manifest-pages.js';
import { addedDefault, missingColumnsEdit, offered, type OfferedColumn } from './missing-columns.js';
import type { AppSchemaTarget } from './schema-target.js';
import { AddOnInstallError, type ExistingTable } from '../add-ons/install-ddl.js';
import type { EditBody } from '../schema-ddl/programmatic.js';
import type { AppStore } from './store.js';
import { AddOnStoreError } from '../add-ons/store.js';
import { refusalReason } from '../add-ons/upload-refusal.js';
import { SURFACE_SIDES, type SurfaceSide } from '../cli/surfaces-root.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../errors.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import {
  type SampleDataDeps,
} from './sample-data.js';
import { rulesKeptBack, writeManifestRules, type RulesResult } from './manifest-rules.js';
import { formIssues, layoutQueryProblems, layoutTables } from './manifest-page-config.js';
import {
  addOnGrantsOf,
  roleIssues,
  roleSlugProblems,
  writeManifestRoles,
  type RolesResult,
} from './manifest-roles.js';
import {
  installPublicAccess,
  keysOpenedWithoutStaff,
  planPublicEndpoints,
  keepsMoney,
  publicAccessWarnings,
  signsInByLink,
  takeBackPublicAccess,
  type PublicAccessCommit,
} from './manifest-public.js';
import { installOutbox, templateProblems, type OutboxResult } from './manifest-outbox.js';
import { installAppDocuments } from '../documents/app-documents.js';
import type { AddOnRuntimeState } from '../add-ons/runtime.js';
import type { EndpointService } from '../public-api/endpoint-service.js';
import type { SnapshotView } from '../crud/identifiers.js';
import { refuseUnbuiltManifest } from '../crud/unbuilt-rules.js';
import type { DsnCrypto } from '@adminium/meta';
import { pageLayoutSchema } from '@adminium/engine/config';
import { APP_VERSION } from '../version.js';
import {
  installAppBody,
  installedAppReply,
  updateAppBody,
  updateAppReply,
  type AppInstallPlanDto,
} from '../routes/apps/schema.js';

/** A manifest row's `source` for an app a project folder carries; every package is `file`. */
export const FOLDER_SOURCE = 'folder';

/** The manifest a bundle must carry at its root, after `package/` is stripped. */
export const MANIFEST_FILE = 'manifest.json';

export interface AppRoutesDeps {
  meta: MetaDb;
  store: AppStore;
  /**
   * Where each app's files are read from: the store, or the project folder
   * for an app the project carries. Absent, every app is the store's.
   */
  files?: AppFiles | undefined;
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
  /** The add-ons loaded now: an app's documents are made only while their add-on is. */
  addOnRuntime?: (() => AddOnRuntimeState | null) | undefined;
  /**
   * The add-on installer, for the add-ons an app needs: the add-on store, its
   * schema target and the runtime rebuild — the same ones the add-on routes
   * hold, because installing an add-on with an app IS installing an add-on.
   * Absent, an app that requires an add-on is refused (nothing can install
   * one here) and an app that names none installs exactly as before.
   */
  addOns?:
    | {
        installer: AddOnInstallerDeps;
        catalog?: CatalogClient | undefined;
        /** Where the bundled add-on tarballs are; defaults to the boot seed's own rule. */
        bundledDir?: string | undefined;
      }
    | undefined;
}

/**
 * The schema edit that adapts the tables an install reuses: each `add-column`
 * as the installer's own column shape (nullable), each widening, identity and
 * enum-value change as one `alterColumns` entry per column.
 *
 * An added column keeps what the manifest says of it that a table made fresh
 * would have: its one-of-a-kind rule (`unique`, a constraint under the
 * installer's own name) and its fixed default. Left out, an updated install
 * took the same hours onto two invoice lines, and a new switch read empty
 * where a new install reads it off.
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
  const addUniques: NonNullable<EditBody['addUniques']> = [];
  const addIndexes: NonNullable<EditBody['addIndexes']> = [];
  for (const table of tables) {
    const spec = manifest.requiredSchema?.tables.find((t) => t.ref === table.ref);
    const id = idOf(model, table.table);
    const perColumn = new Map<string, NonNullable<EditBody['alterColumns']>[number]>();
    for (const edit of table.edits) {
      if (edit.kind === 'add-column') {
        const column = spec?.columns.find((c) => c.ref === edit.column);
        // Unique alone, or with its parent row (a number counted per parent), as a table made with it is.
        const partners = column === undefined ? null : uniqueWithOf(column);
        const unique = partners === null ? {} : partners.length === 0 ? { unique: true } : { unique: true, uniqueWith: partners };
        if (column?.type === 'fk' && column.references !== undefined) {
          const link = linkColumnFor(column.references, model, idOf, names);
          if (link !== null) addColumns.push({ table: id, column: { name: edit.column, ...link.column } as never, foreignKey: link.foreignKey, ...unique });
          continue;
        }
        const shape = column === undefined ? null : offered(column);
        if (shape !== null) {
          // A unique column starts every row empty: one default for them all would clash.
          const fill = column === undefined || partners !== null ? null : addedDefault(column);
          addColumns.push({ table: id, column: { name: edit.column, ...shape, default: fill } as never, ...unique });
        }
        continue;
      }
      // A plain index a limit or a total counts by.
      if (edit.kind === 'add-index') {
        addIndexes.push({ table: id, columns: [edit.column], name: edit.name });
        continue;
      }
      // A set the app declares, by its own name: never merged with a rule on its last column alone.
      if (edit.kind === 'add-unique' && edit.name !== undefined) {
        addUniques.push({ table: id, columns: [...(edit.with ?? []), edit.column], name: edit.name });
        continue;
      }
      const entry = perColumn.get(edit.column) ?? { table: id, column: edit.column };
      if (edit.kind === 'add-unique') {
        entry.unique = true;
        if (edit.with !== undefined && edit.with.length > 0) entry.uniqueWith = [...edit.with];
      } else if (edit.kind === 'widen') {
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
  return { addColumns, alterColumns, ...(addUniques.length === 0 ? {} : { addUniques }), ...(addIndexes.length === 0 ? {} : { addIndexes }) };
}

/**
 * An edit that changes a column the reused table already has — made before
 * the app's new tables link to it (`applyTables`). Anything else (a column
 * added, a unique set, an index) comes after, as it may name an added column.
 */
function changesExistingColumn(kind: InstallTablePlan['edits'][number]['kind']): boolean {
  return kind === 'widen' || kind === 'set-identity' || kind === 'enum-values';
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
  /** Per shape (`menu@1`): use another installed app's tables of it, or keep separate ones. */
  shares?: Readonly<Record<string, ShareChoice>> | undefined;
}

/** An update's answers: the check's table choices and shape answers, as the body carries them. */
function updateAnswers(body: { choices?: Record<string, TableChoice> | undefined; shares?: Record<string, ShareChoice> | undefined } | null | undefined): InstallAnswers {
  return {
    ...(body?.choices === undefined ? {} : { choices: body.choices }),
    ...(body?.shares === undefined ? {} : { shares: body.shares }),
  };
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

/** A table record's shape fields: the part it is built on and the columns the shape owns, or none. */
function shapeRecordOf(
  records: ReadonlyMap<string, { builtOn: string; shapeColumns: string[] }>,
  ref: string,
): { builtOn: string; shapeColumns: string[] } | Record<string, never> {
  return records.get(ref) ?? {};
}

/** A stored status, narrowed; anything unrecognised reads as `error`. */
export function statusOf(value: string): 'installing' | 'installed' | 'disabled' | 'error' {
  return value === 'installing' || value === 'installed' || value === 'disabled' ? value : 'error';
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

export type { InstallActor, InstallHost } from '../add-ons/install-core.js';

export type InstallInput = z.infer<typeof installAppBody> & {
  /** `folder` for an app the project folder carries: no package stands behind its row. A package when absent. */
  source?: typeof FOLDER_SOURCE | undefined;
  /**
   * What an install with nobody to ask may do. Absent, it is a person's
   * install and everything their check step showed is done.
   */
  unattended?: Unattended | undefined;
};

/** The limits of an install or an apply that no person reviewed. */
export interface Unattended {
  /** Install or update the add-ons the app requires. False: they must be here already. */
  installAddOns: boolean;
  /** Add columns to, or otherwise adapt, a table the app did not make itself. */
  adaptForeignTables: boolean;
}

export interface ApplyInPlaceInput {
  key: string;
  /** The version the folder's manifest declares; only for the wording of a refusal. */
  version: string;
  /** Give the app the public access its manifest declares. */
  publicAccess: boolean;
  /** Why not, for the reply and the log, when it is withheld. */
  publicAccessRefusal?: string | undefined;
  /**
   * The folder is being worked on (`adminium dev`, the Designer): a change to
   * what an entry shows or how it is reached takes effect. A server that only
   * runs the folder (`adminium start`) keeps what was allowed, as an update does.
   */
  editing?: boolean | undefined;
  unattended: Unattended;
}

export interface ApplyInPlaceReply {
  key: string;
  from: string;
  to: string;
  /** The manifest that was applied, and the one it replaced as the row recorded it. */
  manifest: Manifest;
  previous: Manifest | null;
  rowId: string;
  connectionId: string | null;
  schema?: { created: string[]; reused: string[] } | undefined;
  names: Record<string, string>;
  pages?: MaterialiseResult | undefined;
  publicAccess?: { endpoints: string[]; keyId: string | null; skipped: { ref: string; reason: string }[] } | undefined;
  addOns?: AddOnsDone | undefined;
}
export type InstalledAppReply = z.infer<typeof installedAppReply>;
export interface UpdateInput {
  key: string;
  body: z.infer<typeof updateAppBody>;
}
export type UpdateAppReply = z.infer<typeof updateAppReply>;

export type AppInstallService = ReturnType<typeof createAppInstallService>;

export function createAppInstallService(deps: AppRoutesDeps) {
  const manifests = manifestsRepo(deps.meta, deps.credentialCrypto);
  const serverVersion = deps.serverVersion ?? APP_VERSION;
  const files = deps.files ?? createAppFiles({ store: deps.store });
  /** What a folder app's manifest no longer declares: cleaned, or asked about. */
  const removals = createRemovals({
    meta: deps.meta,
    credentialCrypto: deps.credentialCrypto,
    schemaTarget: deps.schemaTarget,
    invalidateKey: (keyId) => deps.publicAccess?.invalidateKey?.(keyId),
    names: () => installedAppNames(),
  });

  /** The sides a staged tree actually carries, in serve order. */
  function sidesOf(files: Record<string, string>): SurfaceSide[] {
    return SURFACE_SIDES.filter((side) => `${side}/index.html` in files);
  }

  /**
   * An app that is its tables and pages and nothing else: made on this
   * install, declaring no screen of its own. The one package with no side
   * that is not a broken one.
   */
  function servesNothingByDesign(manifest: Manifest | null): boolean {
    return manifest !== null && manifest.publisher.id === LOCAL_PUBLISHER_ID && isManifestOnly(manifest);
  }

  /** The publisher a stored manifest document names, for the installed list. */
  function publisherOf(document: unknown): { id: string; name: string } | null {
    const publisher = (document as { publisher?: { id?: unknown; name?: unknown } } | null)?.publisher;
    return typeof publisher?.id === 'string' && typeof publisher.name === 'string' ? { id: publisher.id, name: publisher.name } : null;
  }

  /** {@link servesNothingByDesign}, asked of a stored document rather than a parsed manifest. */
  function manifestOnlyDocument(document: unknown): boolean {
    const frontends = (document as { frontends?: unknown } | null)?.frontends;
    return (
      publisherIdOf(document) === LOCAL_PUBLISHER_ID &&
      Array.isArray(frontends) &&
      frontends.length > 0 &&
      frontends.every((frontend) => (frontend as { kind?: unknown } | null)?.kind === 'none')
    );
  }

  /** The publisher id a stored manifest document names, or null. */
  function publisherIdOf(document: unknown): string | null {
    const id = (document as { publisher?: { id?: unknown } } | null)?.publisher?.id;
    return typeof id === 'string' ? id : null;
  }

  /**
   * A package may not take over an installed app from another publisher: a
   * self-made "pos" would otherwise install as the update of the real one,
   * and the reverse.
   */
  function publisherChangeRefusal(manifest: Manifest, installedPublisher: string | null): ValidationFailedError | null {
    // An installed row whose publisher cannot be read is nobody's to take over with a self-made app.
    if (installedPublisher === null && manifest.publisher.id !== LOCAL_PUBLISHER_ID) return null;
    if (installedPublisher === manifest.publisher.id) return null;
    return new ValidationFailedError(
      `"${manifest.key}" is installed from the publisher "${installedPublisher ?? 'unknown'}", and this package says ` +
        `"${manifest.publisher.id}". Uninstall it first, or give this app another key.`,
      { reason: 'PUBLISHER_CHANGED', installed: installedPublisher, offered: manifest.publisher.id },
    );
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
      await files.verify(key, version);
    } catch (error) {
      const reason = error instanceof AddOnStoreError ? error.reason : 'UNKNOWN';
      throw new ValidationFailedError(
        `The staged bundle for "${key}@${version}" no longer matches what was unpacked.`,
        { reason },
      );
    }

    let bytes: Buffer;
    try {
      bytes = await files.readFile(key, version, MANIFEST_FILE);
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

    // An app made on this install reads like any other here; where it could
    // pass for one from a catalogue it is refused at that door instead.
    const validated = validateManifest(document, { allowLocalPublisher: true });
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
    // A word this server reads and does not run yet: refused whole, never installed in part.
    refuseUnbuiltManifest(document, `"${validated.manifest.key}"`, serverVersion);
    return validated.manifest;
  }

  /**
   * What installing this manifest would do to one connection.
   *
   * Returns the plan BESIDE its DTO rather than only the DTO: `apply` takes the
   * plan, and rebuilding one from the wire shape would be a second place for
   * the two to disagree about what is being created.
   */
  type InstalledApp = Awaited<ReturnType<typeof manifests.list>>[number];

  /**
   * The add-ons an app names, resolved against this server — or every one of
   * them unavailable, on a composition with no add-on installer.
   */
  async function addOnRowsFor(manifest: Manifest, connectionId: string | null, withPlans: boolean): Promise<AppAddOnRow[]> {
    if (!namesAddOns(manifest)) return [];
    if (deps.addOns !== undefined) {
      return resolveAppAddOns(
        { ...deps.addOns, serverVersion },
        { manifest, connectionId, withPlans },
      );
    }
    const needs = manifest.kind === 'app' ? manifest.addOns : undefined;
    return [...(needs?.requires ?? []), ...(needs?.suggests ?? [])].map((entry) => ({
      key: entry.key,
      name: entry.key,
      need: (needs?.requires ?? []).some((n) => n.key === entry.key) ? ('requires' as const) : ('suggests' as const),
      range: entry.range,
      reason: entry.reason,
      checked: false,
      features: [],
      state: 'unavailable' as const,
      source: null,
      installedVersion: null,
      offeredVersion: null,
      satisfiesRange: false,
      staged: false,
      enabled: false,
      action: null,
      usedBy: [],
      plan: null,
      problems: [{ code: 'ADD_ON_UNAVAILABLE', message: 'This server cannot install add-ons.' }],
    }));
  }

  /** What an install would do to its add-ons, as part of the plan's checksum. */
  function addOnIdentity(rows: readonly AppAddOnRow[]): unknown {
    return rows.map((row) => [
      row.key,
      row.state,
      row.action,
      row.installedVersion,
      row.offeredVersion,
      row.plan === null || row.plan === undefined ? null : [row.plan.create.map((t) => t.ref), row.plan.reuse.map((t) => t.ref)],
      row.problems.map((p) => p.code),
    ]);
  }

  /** The add-on installer's deps, once. */
  function addOnDeps() {
    // The installer it is handed, able to install an add-on "like an app" through this service.
    return deps.addOns === undefined ? undefined : { ...deps.addOns, installer: { ...deps.addOns.installer, core: () => core }, serverVersion };
  }

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
    /**
     * The add-ons named by the app, resolved. Their planned tables count as
     * there (a foreign key into one resolves), and what the install would do
     * to them is part of the plan's identity. Absent for an app naming none,
     * whose checksum is exactly what it always was.
     */
    addOnRows?: readonly AppAddOnRow[],
  ): Promise<{
    plan: InstallPlan;
    dto: AppInstallPlanDto;
    existing: ExistingTable[];
    /** Per table built on a shape: the part and the columns the shape owns, for its record. */
    shapeRecords: Map<string, { builtOn: string; shapeColumns: string[] }>;
  }> {
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
    // An add-on that installs like an app is planned as one: under its own prefix, against its own records.
    const likeApp = manifest.kind === 'app' || installsLikeAnApp(manifest);
    const prefix = likeApp && manifest.requiredSchema?.prefixed === true ? prefixFor(manifest.key) : null;
    const records: Record<string, { table: string; owned: boolean; state: string }> = {};
    for (const r of own) records[r.ref] = { table: r.tableName, owned: r.owned, state: r.state };
    const installedHere =
      likeApp &&
      (await manifests.list(manifest.kind)).some((m) => m.row.manifestKey === manifest.key && m.row.connectionId === connectionId);
    /*
     * A FRESH INSTALL OF A PREFIXED VERSION STARTS ON ITS OWN TABLES. The
     * tables an unprefixed version left behind when it was uninstalled (kept,
     * under their plain names) were made for another schema: taking them over
     * would map the new version onto columns it never declared. They stay the
     * operator's, untouched, and the new version creates its prefixed tables.
     * An update of an installed app keeps its tables whatever their names.
     */
    if (prefix !== null && !installedHere) {
      for (const r of own) if (r.tableName === r.ref) delete records[r.ref];
    }

    const names = tablesNamedBy(manifest);
    for (const table of manifest.requiredSchema?.tables ?? []) {
      if (prefix !== null) names.add(`${prefix}${table.ref}`);
      if (answers.altPrefix !== undefined) names.add(`${answers.altPrefix}${table.ref}`);
    }
    for (const r of own) names.add(r.tableName);
    /*
     * ANOTHER APP'S TABLES OF A SHAPE THIS APP DECLARES are read too, whatever
     * their names: the planner can offer them only when it sees them (their
     * columns, for what sharing would add; their key, for a link into one).
     */
    const declaredShapes = shapeTables(manifest);
    for (const r of others) if (r.role === 'app' && r.shape !== null && declaredShapes.has(r.shape)) names.add(r.tableName);
    for (const choice of Object.values(answers.choices ?? {})) {
      if (choice.action === 'rename-existing') names.add(choice.to);
    }
    const live = await deps.schemaTarget?.read(connectionId, names);
    const found = live?.tables ?? [];
    // The tables a required add-on is about to create, where none of that name is there yet.
    const coming = tablesComingFromAddOns(addOnRows ?? []).filter((table) => !found.some((t) => t.ref === table.ref));
    const tables = [...found, ...coming];
    const dialect = live?.dialect;
    /*
     * AN ADD-ON'S TABLES ARE HELD, like another app's: one that is here (or
     * that a required add-on is about to make) is never offered to be renamed
     * out of the way, and a table of the same name is a collision the
     * operator resolves with a different prefix. Nothing records which
     * connection an add-on's tables went to, so only the ones really here
     * count — a same-named table on another database is no business of this
     * plan.
     */
    const addOnTables = await addOnTablesByName({ meta: deps.meta, credentialCrypto: deps.credentialCrypto });
    const addOnHolders = [
      ...found.flatMap((table) => {
        const holder = addOnTables.get(table.ref);
        return holder === undefined || holder === manifest.key ? [] : [{ appKey: holder, table: table.ref, shape: null, state: 'created' }];
      }),
      ...coming.map((table) => ({
        appKey: addOnRows?.find((row) => row.plan?.create.some((t) => t.ref === table.ref))?.key ?? 'an add-on',
        table: table.ref,
        shape: null,
        state: 'created',
      })),
    ];

    if (own.length === 0 && likeApp) {
      if (installedHere) {
        for (const table of manifest.requiredSchema?.tables ?? []) {
          if (tables.some((t) => t.ref === table.ref)) {
            records[table.ref] = { table: table.ref, owned: false, state: 'adopted' };
          }
        }
      }
    }

    const elsewhere = manifest.kind === 'app' ? await installedElsewhere(manifest.key, manifest.name, connectionId) : null;

    // The other apps' names, for a refusal or an offer that names one.
    const appNames = others.some((r) => r.shape !== null) ? await installedAppNames() : new Map<string, string>();
    const pure =
      likeApp && dialect !== undefined && dialect !== 'generic'
        ? planInstall(
            manifest,
            { tables, dialect, indexNames: live?.indexNames },
            {
              prefix,
              records,
              others: [
                // Another app's sample ledger keeps no shape: never a table to share, still a name held.
                ...others.map((r) => ({
                  appKey: r.appKey,
                  table: r.tableName,
                  shape: r.role === 'app' ? r.shape : null,
                  state: r.state,
                  ref: r.ref,
                  createdAt: r.createdAt,
                  ...(appNames.has(r.appKey) ? { appName: appNames.get(r.appKey)! } : {}),
                })),
                ...addOnHolders,
              ],
              choices: answers.choices,
              altPrefix: answers.altPrefix,
              shares: answers.shares,
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
    const shapes =
      builtOnTables(manifest).length === 0
        ? null
        : await shapesForPlan(deps.addOns?.installer, manifest, addOnRows ?? (await addOnRowsFor(manifest, connectionId, false)));
    const shapeIssues = shapes === null ? [] : shapeProblems(manifest, shapes);
    const pageProblems = [
      ...(elsewhere === null ? [] : [elsewhere.problem]),
      ...(await slugProblems(manifest, connectionId)),
      ...pageConfigProblems(manifest),
      ...templateProblems(manifest).map((message) => ({ code: 'EMAIL_TEMPLATE_INVALID' as const, table: manifest.key, message })),
      ...roleIssues(manifest).map((issue) => ({ code: issue.code, table: issue.role, message: issue.message })),
      ...(await roleSlugProblems(deps.meta, manifest)).map((issue) => ({ code: issue.code, table: issue.role, message: issue.message })),
      // The tables built on an add-on's shape, against the shape the install will run on.
      ...shapeIssues.map((issue) => ({ code: issue.code as PlanProblem['code'], table: issue.table, message: issue.message })),
      ...(await repeatedUniques(pure, connectionId, manifest, dialect)),
      ...(await shareRefProblems(manifest, connectionId, pure)),
    ];
    const plan: InstallPlan =
      pageProblems.length === 0
        ? pure
        : { ...pure, problems: [...pure.problems, ...pageProblems], installable: false };
    // A rule that would show a secret of a table the app reuses is skipped at install: said now.
    const ruleWarnings = await rulesKeptBack(
      deps.meta,
      manifest,
      connectionId,
      plan.reuse.map((table) => ({ ref: table.ref, tableName: plan.names?.[table.ref] ?? table.ref })),
    );
    const nameOf = (key: string) => appNames.get(key) ?? key;
    return {
      plan,
      shapeRecords: shapes === null ? new Map() : shapeRecordsFor(manifest, shapes),
      existing: found,
      dto: {
        checksum:
          addOnRows === undefined || addOnRows.length === 0
            ? planChecksum(plan, tables)
            : sha256Hex(JSON.stringify([planChecksum(plan, tables), addOnIdentity(addOnRows)])),
        ...(plan.tables === undefined
          ? {}
          : {
              // Each table's declared columns ride along, so the check step's
              // count and its column list come from the same place.
              tables: plan.tables.map((table) => ({
                ...table,
                ...(table.sharedWith === undefined ? {} : { sharedWithName: nameOf(table.sharedWith) }),
                columns: (manifest.requiredSchema?.tables.find((t) => t.ref === table.ref)?.columns ?? []).map(
                  (column) => ({ ref: column.ref, type: column.type }),
                ),
              })),
            }),
        ...(plan.names === undefined ? {} : { names: plan.names }),
        ...(plan.shareOffers === undefined
          ? {}
          : {
              shareOffers: plan.shareOffers.map((offer) => ({
                ...offer,
                withName: nameOf(offer.with),
                candidates: offer.candidates.map((key) => ({ key, name: nameOf(key) })),
              })),
            }),
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
          ...(problem.connectionId === undefined ? {} : { connectionId: problem.connectionId }),
        })),
        requiresSchemaChange:
          plan.create.length > 0 || plan.reuse.some((t) => t.missingColumns.length > 0),
        missingColumnsEdit: missingColumnsEdit(plan, manifest),
        ...(ruleWarnings.length === 0 ? {} : { ruleWarnings }),
        sampleData: manifest.kind === 'app' && manifest.sampleData !== undefined,
        ...(addOnGrantsOf(manifest).length === 0 ? {} : { addOnGrants: addOnGrantsOf(manifest) }),
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

  /** Every installed app's name, by key. */
  async function installedAppNames(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const m of await manifests.list('app')) {
      const name = (m.document as { name?: unknown } | null)?.name;
      out.set(m.row.manifestKey, typeof name === 'string' ? name : m.row.manifestKey);
    }
    return out;
  }

  /**
   * A PUBLIC ENDPOINT ON A SHARED TABLE UNDER A NAME ANOTHER APP'S HAS. An
   * endpoint's name comes from its table's real name, so two apps sharing a
   * table can ask for the same one — which the database would refuse part
   * way through the install. Said on the check instead.
   */
  async function shareRefProblems(manifest: Manifest, connectionId: string, plan: InstallPlan): Promise<PlanProblem[]> {
    if (manifest.kind !== 'app' || (manifest.publicAccess ?? []).length === 0) return [];
    const shared = new Set((plan.tables ?? []).filter((t) => t.action === 'share').map((t) => t.ref));
    if (shared.size === 0) return [];
    const stored = new Map((await publicEndpointsRepo(deps.meta).listByConnection(connectionId)).map((e) => [e.ref, e.managedBy]));
    const out: PlanProblem[] = [];
    for (const endpoint of planPublicEndpoints(manifest, plan.names ?? {}, null, { tablesMadeLater: true })) {
      if (!shared.has(endpoint.table)) continue;
      const holder = stored.get(endpoint.ref);
      if (holder === undefined || holder === manifest.key) continue;
      out.push({
        code: 'SHARE_REF_TAKEN',
        table: endpoint.table,
        message:
          `The public access "${endpoint.ref}" this app asks for on the shared table "${plan.names?.[endpoint.table] ?? endpoint.table}" is already ` +
          `${holder === null ? 'an endpoint of this workspace' : `"${holder}"'s`}. Keep a separate menu, or remove that endpoint first.`,
      });
    }
    return out;
  }

  /**
   * AN APP LIVES ON ONE CONNECTION. Installing it again on another would
   * replace its row and leave the first database behind: its tables, its
   * customer key still serving them, its links. So an app installed on
   * another connection — or stopped part way there — is not installable
   * here. It is updated where it is, or uninstalled there first.
   */
  async function installedElsewhere(
    key: string,
    name: string,
    connectionId: string | null,
  ): Promise<{ problem: PlanProblem; connectionId: string; connectionName: string } | null> {
    const earlier = (await manifests.list('app')).find((m) => m.row.manifestKey === key);
    const there = earlier?.row.connectionId ?? null;
    if (there === null || there === connectionId) return null;
    const connectionName = (await connectionsRepo(deps.meta, deps.credentialCrypto).findById(there))?.name ?? there;
    return {
      connectionId: there,
      connectionName,
      problem: {
        code: 'APP_INSTALLED_ELSEWHERE',
        table: key,
        connectionId: there,
        message:
          `"${name}" is already installed on the connection "${connectionName}". An app runs on one connection: ` +
          'update it there, or uninstall it there before installing it on another.',
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
    actor: InstallActor,
    /** The app is installed on this connection: the check is an update's. */
    installed = false,
    /** The columns the install adds to a table it uses as it is, by short name: there once it runs. */
    columnsMadeLater: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  ) {
    if (manifest.kind !== 'app' || (manifest.publicAccess ?? []).length === 0) return undefined;
    const view = deps.publicAccess === undefined ? null : await deps.publicAccess.viewFor(connectionId);
    const planned = planPublicEndpoints(manifest, names, view, { tablesMadeLater: true, columnsMadeLater });
    /*
     * An app already here (the check an update is shown): what its keys hold
     * already, what the update would give them, and what it would not make
     * again because the operator took that key back.
     */
    const onUpdate = new Map<string, 'held' | 'granted' | 'kept' | 'withheld'>();
    // A staff screen's key this version would open to anyone holding its link: a change to allow, like a new entry.
    const opensWithoutStaff = installed ? [...new Set((await keysOpenedWithoutStaff(deps.meta, manifest, connectionId)).map((k) => k.purpose))].sort() : undefined;
    if (installed && deps.publicAccess !== undefined) {
      const at = Date.now();
      const here = new Set((await publicKeysRepo(deps.meta).listLiveDerived(connectionId, at)).map((k) => k.id));
      const own = await publicKeysRepo(deps.meta).listManagedBy(manifest.key);
      const stored = new Set((await publicEndpointsRepo(deps.meta).listByConnection(connectionId)).map((e) => e.ref));
      for (const entry of planned) {
        const live = own.filter((k) => k.purpose === entry.key && k.kind === 'browser' && here.has(k.id));
        if (live.length === 0) {
          onUpdate.set(entry.ref, own.some((k) => k.purpose === entry.key) ? 'withheld' : 'granted');
          continue;
        }
        let holds = true;
        for (const k of live) {
          const held = await deps.publicAccess.service.heldByKey(connectionId, k.id);
          if (!entry.methods.every((m) => (held.get(entry.ref) ?? []).includes(m))) holds = false;
        }
        if (holds) {
          onUpdate.set(entry.ref, 'held');
          continue;
        }
        // A change to an entry its key holds that the key may not take: the entry stays as it is.
        const refused =
          stored.has(entry.ref) &&
          entry.definition !== null &&
          (await deps.publicAccess.service.checkEndpoint({ connectionId, ref: entry.ref, definition: entry.definition })).issues.length > 0;
        onUpdate.set(entry.ref, refused ? 'kept' : 'granted');
      }
    }
    return {
      endpoints: planned.map(({ definition: _definition, ...entry }) => {
        const state = onUpdate.get(entry.ref);
        return state === undefined ? entry : { ...entry, onUpdate: state };
      }),
      ...(opensWithoutStaff === undefined ? {} : { opensWithoutStaff }),
      warnings: await publicAccessWarnings(
        deps.meta,
        connectionId,
        deps.publicAccess?.origins ?? [],
        (manifest.publicAccess ?? []).some((entry) => entry.confirm !== undefined) || manifest.outbox !== undefined,
        { appKey: manifest.key, byLink: signsInByLink(manifest) },
        keepsMoney(manifest),
      ),
      canGrant: await actor.can(PERMISSIONS.apiKeysManage),
    };
  }

  /**
   * A unique rule the plan would give a column that has rows already, which
   * two of them break: refused on the check, by name, before anything moves —
   * never a half-done update the database stops midway.
   */
  async function repeatedUniques(plan: InstallPlan, connectionId: string, manifest?: Manifest, dialect?: string): Promise<PlanProblem[]> {
    const target = deps.schemaTarget;
    if (target?.repeats === undefined) return [];
    const out: PlanProblem[] = [];
    for (const table of plan.tables ?? []) {
      const added = new Set(table.edits.flatMap((other) => (other.kind === 'add-column' ? [other.column] : [])));
      const declared = (manifest?.requiredSchema?.tables ?? []).find((candidate) => candidate.ref === table.ref)?.columns ?? [];
      // A column the update adds with a default holds that one value in every row (MySQL gives a `now` time column none).
      const filled = (column: string) => {
        const value = declared.find((candidate) => candidate.ref === column)?.default;
        return value !== undefined && !(value === 'now' && dialect === 'mysql');
      };
      for (const edit of table.edits) {
        if (edit.kind !== 'add-unique') continue;
        const columns = [...(edit.with ?? []), edit.column];
        // A column the same update adds empty stays empty in every row: nothing there can repeat.
        if (columns.some((column) => added.has(column) && !filled(column))) continue;
        // One it adds filled is the same in every row: the rows repeat where the rest of the set does.
        if (!(await target.repeats(connectionId, table.table, columns.filter((column) => !added.has(column))))) continue;
        out.push({
          code: 'UNIQUE_DUPLICATES',
          table: table.ref,
          column: edit.column,
          message:
            edit.name !== undefined
              ? `"${table.table}" may hold the same ${columns.join(', ')} only once, and rows already there do. Make them differ, then check again.`
              : `"${table.table}.${edit.column}" may hold no value twice${edit.with === undefined ? '' : ` for the same ${edit.with.join(', ')}`}, ` +
                'and rows already there do. Make them differ, then check again.',
        });
      }
    }
    return out;
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
          issues.push(...layoutQueryProblems(parsed.data, manifest));
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
   * The audit row, and the resolver forgetting the key, for each change to an
   * app's public access the moment it is written — so a step after it that
   * fails (and an update swallows) cannot leave a grant nobody was told of.
   */
  function publicAccessRecorder(actor: InstallActor, app: string, connectionId: string, userId: string | null) {
    const by = { actorKind: actor.kind ?? ('user' as const), actorId: userId, actorLabel: actor.label, category: 'system' as const };
    const audit = async (action: string, changes: Record<string, unknown>) => {
      await auditRepo(deps.meta).append({ ...by, action, changes });
    };
    return async (change: PublicAccessCommit): Promise<void> => {
      if (change.kind === 'endpoint') {
        await audit('public-endpoint.save', { after: { connectionId, ref: change.ref, app } });
        return;
      }
      deps.publicAccess?.invalidateKey?.(change.keyId);
      const key = { keyId: change.keyId, connectionId, app, purpose: change.purpose };
      switch (change.kind) {
        case 'key':
          await audit('public-key.create', { after: { ...key, access: change.access } });
          return;
        case 'grant':
        case 'withdraw':
          if (change.kind === 'grant' && change.gained.length > 0) await audit('public-key.grant', { after: { ...key, granted: change.gained } });
          if (change.lost.length > 0) await audit('public-key.withdraw', { after: { ...key, withdrawn: change.lost } });
          return;
        case 'revoke':
          await audit('public-key.revoke', { before: key });
          return;
        case 'rebind':
          await audit('public-key.rebind', { after: { ...key, requiresStaff: change.requiresStaff, enabledBy: change.enabledBy } });
          return;
      }
    };
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
    actor: InstallActor,
    host: InstallHost,
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
    /**
     * An update's say on what its version adds to the app's public access:
     * `true` when the operator allowed it (the app's live keys gain it, a new
     * key is made), else the reason it is left out.
     */
    grant: true | { refusal: string } = true,
    /**
     * The manifest is the operator's own, edited in their project folder under
     * `adminium dev` or the Designer: an entry that now shows more, or is
     * reached another way, takes effect. An update of a published app never
     * passes this: there a widening is not the operator's to allow.
     */
    ownFolder = false,
  ): Promise<
    | {
        pages: MaterialiseResult;
        rules: RulesResult | undefined;
        roles: RolesResult | undefined;
        publicAccess: Omit<Awaited<ReturnType<typeof installPublicAccess>>, 'changedKeys'> | undefined;
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
        host.log.info({ skipped: rules.skipped, app: manifest.key }, 'app rules skipped');
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
        host.log.warn({ warnings: result.warnings, app: manifest.key }, 'app pages written with warnings');
      }
      if (
        host.publish !== undefined &&
        result.created.length + result.recomposed.length > 0
      ) {
        host.publish('config-changed', 'config-changed', {
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
              // With the live model, a table the outbox names that is not there is refused by name.
              const exists =
                model === null || model === undefined ? undefined : (id: string) => model.model.tables.some((table) => table.id === id);
              return installOutbox({ meta: deps.meta, manifest, manifestId: manifestRowId, connectionId, realId, exists });
            })();
      /*
       * The documents its rows print: a profile per shape profile of each
       * table built on an add-on's shape, and per entry of its own
       * `documents`, owned by the app. An update changes them in place; one
       * that cannot be made (its add-on is not here) is said, never half-made.
       */
      if (connectionId !== null && manifest.kind === 'app') {
        const documents = await installAppDocuments({
          meta: deps.meta,
          manifest,
          connectionId,
          view: (await deps.publicAccess?.viewFor(connectionId)) ?? null,
          names: names ?? (await appTablesRepo(deps.meta).realNames(connectionId, manifest.key)),
          runtime: deps.addOnRuntime ?? (() => null),
          createdBy: userId,
        });
        if (documents.skipped.length > 0) {
          host.log.info({ skipped: documents.skipped, app: manifest.key }, 'app document profiles skipped');
        }
      }
      // Guests last: the endpoints read tables that must exist, and the key is made from them.
      let made: Omit<Awaited<ReturnType<typeof installPublicAccess>>, 'changedKeys'> | undefined;
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
          // The live keys on this connection of each purpose this version still declares: given what it adds, once allowed.
          const here = new Set((await publicKeysRepo(deps.meta).listLiveDerived(connectionId, at)).map((k) => k.id));
          const liveKeys = new Map<string, string[]>();
          for (const purpose of livePurposes) liveKeys.set(purpose, live.filter((k) => k.purpose === purpose && here.has(k.id)).map((k) => k.id));
          const record = publicAccessRecorder(actor, manifest.key, connectionId, userId);
          try {
            const { changedKeys, ...reply } = await installPublicAccess({
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
              liveKeys,
              grant: grant === true,
              ...(grant === true ? {} : { refusal: grant.refusal }),
              ...(ownFolder && grant === true ? { ownFolder: true } : {}),
              onCommitted: record,
            });
            made = reply;
            /*
             * A staff screen's key the version turns into a shared link's: its
             * token would open what it reads with no sign-in. Unbound only on
             * the operator's explicit say (the check lists it), and only once
             * it holds exactly what the version declares; otherwise it stays
             * bound, which fails closed.
             */
            if (grant === true) {
              for (const { keyId, purpose } of await keysOpenedWithoutStaff(deps.meta, manifest, connectionId)) {
                if (!changedKeys.some((c) => c.keyId === keyId && c.settled)) continue;
                await publicKeysRepo(deps.meta).setBinding(keyId, { requiresStaff: null, enabledBy: null });
                await record({ kind: 'rebind', keyId, purpose, requiresStaff: null, enabledBy: null });
              }
            }
          } finally {
            deps.publicAccess.onChange?.();
          }
        }
      }
      return { pages: result, rules, roles, publicAccess: made, outbox };
    } catch (error) {
      if (strict) throw error;
      host.log.warn({ err: error, manifestRowId }, 'app installed, but its pages were not written');
      return undefined;
    }
  }

  /**
   * Records the tables a checked plan makes and takes, BEFORE any is made: a
   * table to create as `pending` (it becomes `created` the moment it exists),
   * one it takes as `adopted`, one it uses with another app as `shared`.
   * Answers the record id of each table still to be made, by its ref.
   */
  async function recordTables(input: {
    key: string;
    manifest: Manifest;
    rowId: string;
    connectionId: string;
    checked: { plan: InstallPlan; shapeRecords: ReadonlyMap<string, { builtOn: string; shapeColumns: string[] }> };
    prefix: string | null;
  }): Promise<Map<string, string>> {
    const { key, manifest, rowId, connectionId, checked, prefix } = input;
    const records = appTablesRepo(deps.meta);
    const pending = new Map<string, string>();
    for (const table of checked.plan.create) {
      // Owned: the live read a moment ago did not find it.
      const record = await records.record({
        appKey: key,
        manifestId: rowId,
        connectionId,
        ref: table.ref,
        tableName: table.table ?? table.ref,
        owned: true,
        state: 'pending',
        prefix,
        // The shape it is declared with, so another app can find it to share; none clears an old one.
        shape: tableShapeOf(manifest, table.ref),
        ...shapeRecordOf(checked.shapeRecords, table.ref),
      });
      pending.set(table.ref, record.id);
    }
    for (const table of checked.plan.reuse) {
      const shared = checked.plan.tables?.find((t) => t.ref === table.ref)?.action === 'share';
      await records.record({
        appKey: key,
        manifestId: rowId,
        connectionId,
        ref: table.ref,
        tableName: table.table ?? table.ref,
        owned: false,
        state: shared ? 'shared' : 'adopted',
        prefix,
        shape: tableShapeOf(manifest, table.ref),
        ...shapeRecordOf(checked.shapeRecords, table.ref),
      });
    }
    return pending;
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
    addOnRows?: readonly AppAddOnRow[],
  ): Promise<{ created: string[]; reused: string[]; names: Record<string, string> }> {
    const checked = await checkedPlan(key, manifest, connectionId, verb, expectedChecksum, answers, addOnRows);
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
        // A table this app shares stays shared on an update: never taken for one it adopted.
        state: table.action === 'share' || table.class === 'shared' ? 'shared' : table.action === 'reuse' ? 'adopted' : 'created',
        // The shape it is declared with, so another app can find it to share; none clears one a version dropped.
        shape: tableShapeOf(manifest, table.ref),
        ...shapeRecordOf(checked.shapeRecords, table.ref),
      });
    }
    return { ...applied, names: checked.plan.names ?? {} };
  }

  /**
   * Make the tables a checked plan describes, in the only order that works:
   *
   *   1. rename a stranger's table out of the way (the schema editor's own
   *      rename, so its pages and rules follow it);
   *   2. change the columns the tables the app reuses already have — a key
   *      made to number itself, a column widened, enum values added —
   *      through the schema editor's narrow doors;
   *   3. create the app's tables under their REAL names, foreign keys pointing
   *      at real names too;
   *   4. the rest of the check step's edits to the tables the app reuses: the
   *      columns it adds (a link among them may point at a table step 3
   *      made), and the unique sets and indexes, which may name one of them.
   *
   * Step 2 comes BEFORE the new tables: MySQL refuses to change a column a
   * foreign key points at ("Cannot change column 'id': used in a foreign key
   * constraint"), so a reused key made to number itself after a new table
   * linked to it stopped every such install halfway. Only a change to a
   * column already there goes early: a set over a column the same update
   * adds, made before that column, is refused and stops the update.
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
    const reused = tables.filter((t) => t.action === 'reuse' || t.action === 'share');
    const editsWhere = (keep: (kind: InstallTablePlan['edits'][number]['kind']) => boolean): InstallTablePlan[] =>
      reused
        .map((t) => ({ ...t, edits: t.edits.filter((edit) => keep(edit.kind)) }))
        .filter((t) => t.edits.length > 0);

    /*
     * The live read the plan was made from still holds a table moved aside
     * under its OLD name — the name the app's own new table now takes. Left
     * so, a new table's link to the app's table would point at the moved
     * table's key column (a column the app's table does not have).
     */
    const movedTo = new Map(renames.map((t) => [t.table, t.renameExistingTo!]));
    let existing = checked.existing.map((table) => {
      const to = movedTo.get(table.ref);
      return to === undefined ? table : { ...table, ref: to };
    });
    const altered = editsWhere(changesExistingColumn);
    if (altered.length > 0) {
      await target.edit(connectionId, (model) => editBodyFor(altered, manifest, model, idOf, plan.names ?? {}), opts);
      // A new table's link takes the key's type as the database has it NOW.
      const fresh = await target.read(connectionId, new Set(altered.map((t) => t.table)));
      existing = existing.map((table) => fresh.tables.find((t) => t.ref === table.ref) ?? table);
    }

    const applied = await target.apply(realPlan, realManifest, connectionId, existing, async (real) => {
      await hooks.onCreated?.(refOf.get(real) ?? real);
    });

    const extended = editsWhere((kind) => !changesExistingColumn(kind));
    if (extended.length > 0) {
      await target.edit(connectionId, (model) => editBodyFor(extended, manifest, model, idOf, plan.names ?? {}), opts);
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
    addOnRows?: readonly AppAddOnRow[],
  ): Promise<{
    plan: InstallPlan;
    existing: ExistingTable[];
    target: AppSchemaTarget;
    shapeRecords: Map<string, { builtOn: string; shapeColumns: string[] }>;
  }> {
    if (deps.schemaTarget === undefined) {
      throw new ValidationFailedError(
        `"${key}" needs tables, and this server has no connection layer to create them in.`,
        { reason: 'DDL_UNAVAILABLE' },
      );
    }

    const { plan, dto, existing, shapeRecords } = await planFor(manifest, connectionId, answers, addOnRows);
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
    /*
     * A TABLE THAT IS NOT WHAT ITS SHAPE SAYS is its own refusal, naming the
     * column: the app and the add-on disagree, and no choice on this screen
     * reconciles them.
     */
    const shapeRefusals = dto.problems.filter((problem) => problem.code === 'SHAPE_MISMATCH' || problem.code === 'SHAPE_UNKNOWN');
    if (shapeRefusals.length > 0) {
      throw new AppError(409, 'SHAPE_MISMATCH', `"${key}" cannot be ${verb}: ${shapeRefusals[0]!.message}`, {
        problems: shapeRefusals,
      });
    }
    /*
     * A TABLE ANOTHER APP SHARES under a shape this version stops declaring:
     * the other app goes on writing it as that shape, so the update is refused,
     * naming it — uninstalling that app first is the operator's call.
     */
    const inUse = dto.problems.filter((problem) => problem.code === 'SHAPE_IN_USE');
    if (inUse.length > 0) {
      throw new AppError(409, 'SHAPE_IN_USE', `"${key}" cannot be ${verb}: ${inUse[0]!.message}`, { problems: inUse });
    }
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

    return { plan, existing, target: deps.schemaTarget, shapeRecords };
  }

  async function auditAppEvent(
    action: string,
    after: Record<string, unknown>,
    userId: string | null,
    userLabel: string,
    kind: 'user' | 'system' = 'user',
  ): Promise<void> {
    await auditRepo(deps.meta).append({
      actorKind: kind,
      actorId: userId,
      actorLabel: userLabel,
      category: 'app',
      action,
      changes: { after },
    });
  }

  /**
   * With nobody to ask, an add-on is never installed or updated for an app:
   * what it requires must be here already. Connecting one that is installed
   * moves nothing and is allowed.
   */
  function refuseAddOnMoves(manifest: Manifest, steps: readonly AddOnStep[]): void {
    const moving = steps.filter((step) => step.action !== 'attach');
    if (moving.length === 0) return;
    throw new AppError(
      422,
      'ADD_ON_REQUIRED',
      `${manifest.name} needs ${moving.map((step) => `${step.name} ${step.version}`).join(' and ')}, which ${moving.length === 1 ? 'is' : 'are'} not installed here. ` +
        'A server installs no add-on for an app in its project folder: install it in Studio → Add-ons first.',
      { addOns: moving.map((step) => ({ key: step.key, action: step.action, version: step.version })) },
    );
  }

  /**
   * With nobody to ask, a table the app did not make itself is used as it is
   * or not at all: a column added to somebody else's table is a change to
   * their table, and that is a person's to allow. The app's own tables grow
   * with it.
   */
  function refuseForeignEdits(key: string, plan: InstallPlan): void {
    const foreign = (plan.tables ?? []).filter(
      (table) => table.edits.length > 0 && !(table.class === 'own-leftover' && table.adopted !== true),
    );
    if (foreign.length === 0) return;
    throw new ValidationFailedError(
      `"${key}" needs changes to ${foreign.map((table) => `"${table.table}"`).join(', ')}, which it did not make: ` +
        `${foreign.flatMap((table) => table.edits.map((edit) => `${table.table}.${edit.column} (${edit.kind})`)).join(', ')}. ` +
        'A server changes no table of somebody else’s for an app in its project folder: run `adminium dev` against this database, or make the change in Studio.',
      { reason: 'FOREIGN_TABLE_EDIT', tables: foreign.map((table) => ({ ref: table.ref, table: table.table, edits: table.edits })) },
    );
  }

  /**
   * APPLY AN APP FROM THE PROJECT FOLDER OVER ITSELF.
   *
   * Not an update: the version may be the same one (a person is editing the
   * manifest, not releasing it), and there is no staged package to take it
   * from. Not a reinstall: the row stays, so the app keeps serving, keeps its
   * connection, its keys and what an operator edited. The steps are the
   * update's own, in the update's order, with the same helpers: add-ons it
   * names, new tables and the columns its own tables gained, public access
   * it no longer declares taken back, the row's document moved, then pages,
   * rules, roles, emails and documents rewritten.
   *
   * Stopped anywhere, what ran stays and the app goes on serving what it
   * served: applying the folder again finishes it.
   */
  async function applyInPlace(actor: InstallActor, host: InstallHost, input: ApplyInPlaceInput): Promise<ApplyInPlaceReply> {
    const { key } = input;
    const userId = actor.id;
    const userLabel = actor.label;
    const installed = (await manifests.list('app')).find((m) => m.row.manifestKey === key);
    if (installed === undefined) throw new NotFoundError(`"${key}" is not installed.`);
    const from = installed.row.version;

    let stage: 'check' | 'add-ons' | 'tables' | 'add-on-updates' | 'public-access' | 'finish' | 'pages' = 'check';
    const stopped = (error: unknown): AppError => {
      const message = error instanceof Error ? error.message : String(error);
      const details = error instanceof AppError ? (error.details as Record<string, unknown> | undefined) : undefined;
      return new AppError(409, 'APP_APPLY_INCOMPLETE', message, { ...(details ?? {}), stage, cause: message });
    };

    let manifest: Manifest;
    let surfaces: ReturnType<typeof surfacesOfInstalled>;
    let addOnRows: AppAddOnRow[];
    let addOnSteps: AddOnStep[];
    const connectionId = installed.row.connectionId;
    try {
      manifest = await verifiedManifest(key, input.version);
      const changed = publisherChangeRefusal(manifest, publisherIdOf(installed.document));
      if (changed !== null) throw changed;
      surfaces = surfacesOfInstalled(files, { key, version: manifest.version });
      if (surfaces.length === 0 && !servesNothingByDesign(manifest)) {
        throw new ValidationFailedError(`"${key}" declares screens of its own and none is built.`, { reason: 'NO_SURFACE' });
      }
      // An add-on mounted on this app must still work with the version the folder says.
      const outOfRange = await attachedRangeRefusal({ meta: deps.meta, credentialCrypto: deps.credentialCrypto }, key, manifest.version);
      if (outOfRange !== null) throw outOfRange;
      addOnRows = await addOnRowsFor(manifest, connectionId, true);
      // Nobody ticks a box here: an add-on out of range is updated with the app where that is allowed at all.
      const choices: AddOnChoice[] = addOnRows
        .filter((row) => row.need === 'requires' && row.action !== null)
        .map((row) => ({ key: row.key, version: (row.action === 'attach' ? row.installedVersion : row.offeredVersion) ?? '', update: true }));
      addOnSteps = decideAddOnSteps(manifest.name, addOnRows, input.unattended.installAddOns ? choices : []);
      if (!input.unattended.installAddOns) refuseAddOnMoves(manifest, addOnSteps);
      if ((manifest.requiredSchema?.tables ?? []).length > 0 && connectionId === null) {
        throw new ValidationFailedError(`"${key}" needs tables, and it was installed without a database.`, { reason: 'NO_CONNECTION' });
      }
    } catch (error) {
      throw stopped(error);
    }
    const to = manifest.version;
    const wanted = manifest.requiredSchema?.tables ?? [];

    const addOnInstaller = addOnDeps();
    let addOnsDone: AddOnsDone | undefined = namesAddOns(manifest) ? { installed: [], updated: [], attached: [] } : undefined;
    const runSteps = async (steps: readonly AddOnStep[]): Promise<void> => {
      if (steps.length === 0 || addOnInstaller === undefined) return;
      const done = await runAddOnSteps(addOnInstaller, {
        steps,
        host: appHost(manifest, connectionId),
        connectionId,
        actor: { id: userId, label: userLabel },
        manifestRowId: installed.row.id,
      });
      addOnsDone = {
        installed: [...(addOnsDone?.installed ?? []), ...done.installed],
        updated: [...(addOnsDone?.updated ?? []), ...done.updated],
        attached: [...(addOnsDone?.attached ?? []), ...done.attached],
      };
    };

    let names: Record<string, string> | undefined;
    let applied: { created: string[]; reused: string[] } | undefined;
    try {
      // The plan first, with nothing written: a refusal leaves the app exactly as it was.
      if (wanted.length > 0 && connectionId !== null && (addOnSteps.length > 0 || !input.unattended.adaptForeignTables)) {
        const checked = await checkedPlan(key, manifest, connectionId, 'updated', undefined, {}, addOnRows);
        if (!input.unattended.adaptForeignTables) refuseForeignEdits(key, checked.plan);
      }
      stage = 'add-ons';
      await runSteps(addOnSteps.filter((step) => step.action !== 'update'));
      stage = 'tables';
      if (wanted.length > 0 && connectionId !== null) {
        const made = await createTables(
          key,
          manifest,
          connectionId,
          'updated',
          { superAdmin: await actor.superAdmin(), createdBy: userId },
          undefined,
          {},
          // Planned against the add-ons' tables as they now are.
          addOnSteps.length > 0 ? undefined : addOnRows,
        );
        applied = { created: made.created, reused: made.reused };
        names = made.names;
      }
      stage = 'add-on-updates';
      await runSteps(addOnSteps.filter((step) => step.action === 'update'));
      // What the manifest no longer declares comes out of the app's keys, whatever is allowed below.
      stage = 'public-access';
      if (connectionId !== null && deps.publicAccess !== undefined && manifest.kind === 'app') {
        const access = deps.publicAccess;
        try {
          await takeBackPublicAccess({
            service: access.service,
            meta: deps.meta,
            manifest,
            connectionId,
            names: names ?? (await appTablesRepo(deps.meta).realNames(connectionId, key)),
            view: await access.viewFor(connectionId),
            onCommitted: publicAccessRecorder(actor, key, connectionId, userId),
          });
        } finally {
          access.onChange?.();
        }
      }
      stage = 'finish';
      await manifests.setVersion(installed.row.id, { version: to, document: manifest });
    } catch (error) {
      const failure = stopped(error);
      await auditAppEvent('app.apply-failed', { key, from, to, stage, message: failure.message }, userId, userLabel, actor.kind);
      throw failure;
    }
    await deps.installed.refresh();

    /*
     * Pages, rules, roles, emails, documents and public access, as an update
     * writes them: new ones added, untouched ones rebuilt, an edited page
     * left alone, a key the operator took back never made again. Unlike an
     * update, a failure here is said: the person is watching the folder, and
     * a page that silently did not change is the thing they would not find.
     */
    stage = 'pages';
    const liveKey = await publicKeysRepo(deps.meta).newestLiveByApp(key, 'customer');
    const keepsPublicAccess = liveKey !== null && liveKey.managedBy === key;
    const caught: { error?: unknown } = {};
    const watching: InstallHost = {
      ...host,
      log: {
        info: (obj, msg) => host.log.info(obj, msg),
        warn: (obj, msg) => {
          if ('err' in obj) caught.error = (obj as { err: unknown }).err;
          host.log.warn(obj, msg);
        },
      },
    };
    const written = await writePages(
      actor,
      watching,
      manifest,
      installed.row.id,
      connectionId,
      userId,
      false,
      names,
      keepsPublicAccess || input.publicAccess,
      input.publicAccess ? true : { refusal: input.publicAccessRefusal ?? 'not allowed for this app' },
      input.editing === true,
    );
    if (written === undefined) {
      const failure = stopped(caught.error ?? new Error('its pages could not be written'));
      await auditAppEvent('app.apply-failed', { key, from, to, stage, message: failure.message }, userId, userLabel, actor.kind);
      throw failure;
    }
    host.invalidateSurfaceSettings?.();

    await auditAppEvent(
      'app.applied',
      {
        key,
        from,
        to,
        source: FOLDER_SOURCE,
        sides: surfaces.map((s) => s.side),
        ...(connectionId === null ? {} : { connectionId }),
        ...(applied === undefined ? {} : { created: applied.created, reused: applied.reused }),
      },
      userId,
      userLabel,
      actor.kind,
    );
    return {
      key,
      from,
      to,
      manifest,
      previous: (installed.document as Manifest | null) ?? null,
      rowId: installed.row.id,
      connectionId,
      ...(applied === undefined ? {} : { schema: applied }),
      names: names ?? (connectionId === null ? {} : await appTablesRepo(deps.meta).realNames(connectionId, key)),
      pages: written.pages,
      ...(written.publicAccess === undefined
        ? {}
        : { publicAccess: { endpoints: written.publicAccess.endpoints, keyId: written.publicAccess.keyId, skipped: written.publicAccess.skipped } }),
      ...(addOnsDone === undefined ? {} : { addOns: addOnsDone }),
    };
  }

  /**
   * Answer the question a folder app's removal left: drop what its manifest
   * no longer declares, or keep it. Audited either way, with what went.
   */
  async function answerRemoval(actor: InstallActor, host: InstallHost, input: { key: string; accept: boolean }) {
    const installed = (await manifests.list('app')).find((m) => m.row.manifestKey === input.key);
    if (installed === undefined) throw new NotFoundError(`"${input.key}" is not installed.`);
    const asked = await removals.pending(input.key);
    const result = await removals.answer({
      key: input.key,
      connectionId: installed.row.connectionId,
      accept: input.accept,
      actor,
      manifest: (installed.document as Manifest | null) ?? null,
    });
    await auditAppEvent(
      input.accept ? 'app.removal-accepted' : 'app.removal-declined',
      { key: input.key, changes: asked?.changes ?? [], dropped: result.dropped, kept: result.kept },
      actor.id,
      actor.label,
      actor.kind,
    );
    // The schema moved: open dashboards and the app's own screens read it again.
    host.invalidateSurfaceSettings?.();
    host.publish?.('config-changed', 'config-changed', {
      ...(installed.row.connectionId === null ? {} : { connectionId: installed.row.connectionId }),
      configVersion: await pagesRepo(deps.meta).configVersion(),
    });
    return result;
  }

  async function install(actor: InstallActor, host: InstallHost, input: InstallInput): Promise<InstalledAppReply> {
    const { key, version, connectionId, planChecksum: reviewed, choices, altPrefix, shares } = input;
    const answers: InstallAnswers = {
      ...(choices === undefined ? {} : { choices }),
      ...(altPrefix === undefined ? {} : { altPrefix }),
      ...(shares === undefined ? {} : { shares }),
    };
    const userId = actor.id;
    const userLabel = actor.label;
    const source = input.source ?? 'file';

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
      await auditAppEvent('app.verify-refused', { key, version, reason }, userId, userLabel, actor.kind);
      throw error;
    }

    const surfaces = surfacesOfInstalled(files, { key, version });
    if (surfaces.length === 0 && !servesNothingByDesign(manifest)) {
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
      manifest.kind === 'app' && (manifest.publicAccess ?? []).length > 0 && input.publicAccess !== false;
    if (grantsPublicAccess && !(await actor.can(PERMISSIONS.apiKeysManage))) {
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
    /*
     * AN INSTALL OVER AN INSTALLED KEY REPLACES ITS ROW, so it is held to
     * the publisher that row came from. A self-made package staged beside
     * the real app (uploaded before the real one was installed) would
     * otherwise take its place here, where the upload's check never ran.
     */
    if (prior !== undefined) {
      const changed = publisherChangeRefusal(manifest, publisherIdOf(prior.document));
      if (changed !== null) {
        await auditAppEvent('app.verify-refused', { key, version, reason: 'PUBLISHER_CHANGED' }, userId, userLabel, actor.kind);
        throw changed;
      }
    }
    // The same install, stopped part way: same version, same database.
    const resuming =
      prior !== undefined &&
      prior.row.status === 'installing' &&
      prior.row.version === version &&
      prior.row.connectionId === (connectionId ?? null);

    // Installed on another connection: refused before anything is written, as the plan says.
    const elsewhere = await installedElsewhere(key, manifest.name, connectionId ?? null);
    if (elsewhere !== null) {
      throw new ConflictError(elsewhere.problem.message, 'APP_INSTALLED_ELSEWHERE', {
        connectionId: elsewhere.connectionId,
        connection: elsewhere.connectionName,
      });
    }

    /*
     * A ROW REPLACED IS AN UPDATE BY ANOTHER DOOR: the add-ons mounted on
     * this app stay mounted (their links are keyed by the app's key), so
     * the new version is held to their binding ranges exactly as an update
     * is — never left running outside one.
     */
    if (prior !== undefined) {
      const outOfRange = await attachedRangeRefusal({ meta: deps.meta, credentialCrypto: deps.credentialCrypto }, key, version);
      if (outOfRange !== null) throw outOfRange;
    }

    /*
     * THE ADD-ONS IT NEEDS, DECIDED BEFORE ANYTHING IS WRITTEN: a required
     * one that cannot be had, one out of range nobody ticked to update,
     * one whose bytes are not here yet, one whose own plan is refused —
     * each stops the install here, with nothing written.
     */
    const addOnRows = await addOnRowsFor(manifest, connectionId ?? null, true);
    const addOnSteps: AddOnStep[] = decideAddOnSteps(manifest.name, addOnRows, (input.addOns ?? []) as AddOnChoice[]);
    if (input.unattended?.installAddOns === false) refuseAddOnMoves(manifest, addOnSteps);

    // A resume re-plans against tables it made itself, so the reviewed
    // checksum no longer describes the database — by design.
    let checked =
      wanted.length > 0 && connectionId !== undefined
        ? await checkedPlan(key, manifest, connectionId, 'installed', resuming ? undefined : reviewed, answers, addOnRows)
        : undefined;
    if (checked !== undefined && input.unattended?.adaptForeignTables === false) refuseForeignEdits(key, checked.plan);

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
        source,
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
    let stage: 'add-ons' | 'tables' | 'pages' | 'finish' = 'add-ons';
    let applied: { created: string[]; reused: string[] } | undefined;
    let writtenPages: Awaited<ReturnType<typeof writePages>>;
    let addOnsDone: AddOnsDone | undefined;
    try {
      /*
       * THE ADD-ONS FIRST, into the app's own database, so its tables can
       * be built on them. Kept if anything after fails: they are shared.
       */
      const addOnInstaller = addOnDeps();
      if (addOnSteps.length > 0 && addOnInstaller !== undefined) {
        await runAddOnSteps(addOnInstaller, {
          steps: addOnSteps,
          host: appHost(manifest, connectionId ?? null),
          connectionId: connectionId ?? null,
          actor: { id: userId, label: userLabel },
          manifestRowId: rowId,
        });
        // Their tables exist now: the app's plan is read again from the
        // database, so a foreign key into one is made with its real type.
        if (checked !== undefined && connectionId !== undefined && tablesComingFromAddOns(addOnRows).length > 0) {
          checked = await checkedPlan(key, manifest, connectionId, 'installed', undefined, answers);
        }
      }
      // The done line: every step this install took, this attempt or an earlier one.
      if (addOnInstaller !== undefined && namesAddOns(manifest)) {
        addOnsDone = await stepsAlreadyTaken(addOnInstaller, key, rowId);
      }
      stage = 'tables';
      const tablesPlan = checked;
      if (tablesPlan !== undefined && connectionId !== undefined) {
        await tableRecords.attach(connectionId, key, rowId);
        const pending = new Map<string, string>();
        const prefix = manifest.requiredSchema?.prefixed === true ? (answers.altPrefix ?? prefixFor(key)) : null;
        applied = await applyTables(
          tablesPlan,
          manifest,
          connectionId,
          { superAdmin: await actor.superAdmin(), createdBy: userId },
          {
            afterRenames: async () => {
              for (const [ref, id] of await recordTables({ key, manifest, rowId, connectionId, checked: tablesPlan, prefix })) pending.set(ref, id);
            },
            onCreated: async (ref) => {
              const id = pending.get(ref);
              if (id !== undefined) await tableRecords.setState(id, 'created');
            },
          },
        );
      }
      stage = 'pages';
      writtenPages = await writePages(
        actor,
        host,
        manifest,
        rowId,
        connectionId ?? null,
        userId,
        true,
        tablesPlan?.plan.names,
        grantsPublicAccess,
      );
      stage = 'finish';
      await placeFromManifest(manifest, userId);
      await manifests.setStatus(rowId, 'installed');
      // The add-ons' earlier versions, kept while the install could still stop.
      const installer = addOnDeps();
      if (installer !== undefined && namesAddOns(manifest)) await pruneNamedAddOns(installer.installer, manifest);
      await deps.installed.refresh();
      // Its placement and its status are what the surface gate reads.
      host.invalidateSurfaceSettings?.();
    } catch (error) {
      const records =
        connectionId === undefined ? [] : await tableRecords.forInstall(connectionId, key);
      const created = records.filter((r) => r.state === 'created').map((r) => r.ref);
      const pendingRefs = records.filter((r) => r.state === 'pending').map((r) => r.ref);
      const table = error instanceof AddOnInstallError && stage !== 'add-ons' ? (error.table ?? null) : null;
      // What the add-on steps did before the stop: kept, and not redone by "Try again".
      const addOnInstaller = addOnDeps();
      const keptAddOns = addOnInstaller === undefined ? undefined : await stepsAlreadyTaken(addOnInstaller, key, rowId);
      // Every table exists, so what failed inside the table step was the
      // re-read of the schema that follows the creates.
      const where = stage === 'tables' && pendingRefs.length === 0 && table === null ? 'introspect' : stage;
      const message = error instanceof Error ? error.message : String(error);
      const addOnsKept =
        keptAddOns === undefined || keptAddOns.installed.length + keptAddOns.updated.length + keptAddOns.attached.length === 0
          ? {}
          : { addOns: keptAddOns };
      await auditAppEvent(
        'app.install-failed',
        { key, version, stage: where, table, created, pending: pendingRefs, message, ...addOnsKept },
        userId,
        userLabel,
        actor.kind,
      );
      throw new ConflictError(
        `Installing "${key}" stopped at the ${where} step: ${message} ` +
          'Nothing was removed. Install it again to finish from where it stopped.',
        'APP_INSTALL_INCOMPLETE',
        { stage: where, table, created, pending: pendingRefs, cause: message, ...addOnsKept },
      );
    }

    const installed = (await manifests.findById(rowId))!;
    await auditAppEvent(
      'app.installed',
      {
        key,
        version,
        source,
        sides: surfaces.map((s) => s.side),
        ...(connectionId === undefined ? {} : { connectionId }),
        ...(applied === undefined ? {} : { created: applied.created, reused: applied.reused }),
        ...(resuming ? { resumed: true } : {}),
      },
      userId,
      userLabel,
      actor.kind,
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
      // An app that declares no screen of its own is whole with none.
      missing: surfaces.length === 0 && !servesNothingByDesign(manifest),
      ...(writtenPages === undefined ? {} : { pages: writtenPages.pages }),
      ...(writtenPages?.rules === undefined ? {} : { rules: writtenPages.rules }),
      ...(writtenPages?.roles === undefined ? {} : { roles: writtenPages.roles }),
      ...(writtenPages?.publicAccess === undefined ? {} : { publicAccess: writtenPages.publicAccess }),
      ...(writtenPages?.outbox === undefined ? {} : { outbox: writtenPages.outbox }),
      ...(addOnsDone === undefined ? {} : { addOns: addOnsDone }),
    };
  }

  async function update(actor: InstallActor, host: InstallHost, input: UpdateInput): Promise<UpdateAppReply> {
    const { key } = input;
    const userId = actor.id;
    const userLabel = actor.label;

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
        actor.kind,
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
        actor.kind,
      );
      throw refused;
    }

    const changed = publisherChangeRefusal(manifest, publisherIdOf(installed.document));
    if (changed !== null) {
      await auditAppEvent('app.verify-refused', { key, version: to, from, reason: 'PUBLISHER_CHANGED' }, userId, userLabel, actor.kind);
      throw changed;
    }

    const surfaces = surfacesOfInstalled(files, { key, version: to });
    if (surfaces.length === 0 && !servesNothingByDesign(manifest)) {
      throw new ValidationFailedError(`"${key}@${to}" carries no surface to serve.`, {
        reason: 'NO_SURFACE',
      });
    }

    // What the new version adds to the app's public access is allowed as
    // at install: only by someone who may hand out API keys.
    const canGrantKeys = await actor.can(PERMISSIONS.apiKeysManage);
    const asksPublicAccess = manifest.kind === 'app' && (manifest.publicAccess ?? []).length > 0;
    if (asksPublicAccess && input.body?.publicAccess === true && !canGrantKeys) {
      throw new ForbiddenError(
        `"${key}" asks for public access, which only someone who may manage API keys can allow. ` +
          'Update it without public access, or ask someone who can.',
      );
    }

    /*
     * AN ADD-ON MOUNTED ON THIS APP MUST STILL WORK WITH IT. A new version
     * outside an attached add-on's (binding) range is refused, naming the
     * add-on — never a silent detach, which would take a feature away
     * without anyone deciding to.
     */
    const outOfRange = await attachedRangeRefusal({ meta: deps.meta, credentialCrypto: deps.credentialCrypto }, key, to);
    if (outOfRange !== null) throw outOfRange;
    // The add-ons the NEW version names, decided before anything moves.
    const addOnRows = await addOnRowsFor(manifest, installed.row.connectionId, true);
    const addOnSteps = decideAddOnSteps(manifest.name, addOnRows, (input.body?.addOns ?? []) as AddOnChoice[]);

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
       *
       * With add-ons to install first, the checked plan is made BEFORE
       * they move (it refuses with nothing written), and the tables are
       * then planned again against the add-ons' tables as they are.
       */
      if (addOnSteps.length > 0) {
        await checkedPlan(
          key,
          manifest,
          connectionId,
          'updated',
          input.body?.planChecksum,
          updateAnswers(input.body),
          addOnRows,
        );
      }
    }
    /*
     * THE ORDER, AND WHY IT CAN BE FINISHED.
     *
     * Add-ons installed or connected for it first (its new tables may
     * point at theirs), then its tables, then the add-ons it UPDATES — an
     * update makes no table, so nothing of the app's waits on one — and
     * the app's own row moves last. Stopped anywhere, the running version
     * is still inside the range of every add-on it runs on, the add-ons'
     * earlier versions are still on disk, and updating again finishes:
     * each step already taken is found done.
     */
    const addOnInstaller = addOnDeps();
    let addOnsDone: AddOnsDone | undefined = namesAddOns(manifest) ? { installed: [], updated: [], attached: [] } : undefined;
    const earlySteps = addOnSteps.filter((step) => step.action !== 'update');
    const lateSteps = addOnSteps.filter((step) => step.action === 'update');
    const runSteps = async (steps: readonly AddOnStep[]): Promise<void> => {
      if (steps.length === 0 || addOnInstaller === undefined) return;
      const done = await runAddOnSteps(addOnInstaller, {
        steps,
        host: appHost(manifest, connectionId),
        connectionId,
        actor: { id: userId, label: userLabel },
        manifestRowId: installed.row.id,
      });
      addOnsDone = {
        installed: [...(addOnsDone?.installed ?? []), ...done.installed],
        updated: [...(addOnsDone?.updated ?? []), ...done.updated],
        attached: [...(addOnsDone?.attached ?? []), ...done.attached],
      };
    };
    let stage: 'add-ons' | 'tables' | 'add-on-updates' | 'public-access' | 'finish' = 'add-ons';
    try {
      await runSteps(earlySteps);
      stage = 'tables';
      if (wanted.length > 0 && connectionId !== null) {
        const made = await createTables(
          key,
          manifest,
          connectionId,
          'updated',
          { superAdmin: await actor.superAdmin(), createdBy: userId },
          addOnSteps.length > 0 ? undefined : input.body?.planChecksum,
          updateAnswers(input.body),
          // Planned against the add-ons' tables as they now are.
          addOnSteps.length > 0 ? undefined : addOnRows,
        );
        applied = { created: made.created, reused: made.reused };
        names = made.names;
      }
      stage = 'add-on-updates';
      await runSteps(lateSteps);
      /*
       * What the new version no longer declares comes out of the app's
       * keys now: before the version is recorded, so a failure here is
       * an update to finish, and before anything below that may fail and
       * be swallowed. Whatever the operator says about what it adds, and
       * whether or not the guests' key is still live.
       */
      stage = 'public-access';
      if (connectionId !== null && deps.publicAccess !== undefined && manifest.kind === 'app') {
        const access = deps.publicAccess;
        try {
          await takeBackPublicAccess({
            service: access.service,
            meta: deps.meta,
            manifest,
            connectionId,
            names: names ?? (await appTablesRepo(deps.meta).realNames(connectionId, key)),
            view: await access.viewFor(connectionId),
            onCommitted: publicAccessRecorder(actor, key, connectionId, userId),
          });
        } finally {
          access.onChange?.();
        }
      }
      stage = 'finish';
      await manifests.setVersion(installed.row.id, { version: to, document: manifest });
    } catch (error) {
      // A refusal before anything was written stays the refusal it is.
      if (earlySteps.length === 0 && (stage === 'add-ons' || stage === 'tables') && error instanceof AppError && error.statusCode < 500) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      await auditAppEvent(
        'app.update-failed',
        { key, from, to, stage, message, ...(addOnsDone === undefined ? {} : { addOns: addOnsDone }) },
        userId,
        userLabel,
        actor.kind,
      );
      throw new AppError(
        409,
        'APP_UPDATE_INCOMPLETE',
        `Updating "${key}" to ${to} stopped at the ${stage} step: ${message} ` +
          `Nothing was undone and ${from} is still running. Update it again to finish.`,
        { stage, from, to, cause: message, ...(addOnsDone === undefined ? {} : { addOns: addOnsDone }) },
      );
    }
    await deps.installed.refresh();
    // New pages are added, untouched ones rebuilt for this version, and
    // any page an operator edited is left exactly as it is.
    /*
     * Public access follows the version where the operator allowed it at
     * install (the app still holds the live key it was given then), or
     * where they allow it now. What the version ADDS — an entry the app's
     * key does not hold, a key it never had, a staff screen's key opening
     * without a sign-in — is given only when the operator says so on the
     * check (`publicAccess: true`), and only by someone who may manage API
     * keys. Not saying so gives nothing new. What it no longer declares
     * was taken back above, either way.
     */
    const liveKey = await publicKeysRepo(deps.meta).newestLiveByApp(key, 'customer');
    const keepsPublicAccess = liveKey !== null && liveKey.managedBy === key;
    const consent = input.body?.publicAccess;
    const grant =
      consent === true && canGrantKeys
        ? (true as const)
        : !canGrantKeys
          ? { refusal: 'only someone who may manage API keys can allow it' }
          : { refusal: consent === false ? 'not allowed with this update' : 'not asked for with this update: send "publicAccess": true to allow it' };
    const writtenPages = await writePages(
      actor,
      host,
      manifest,
      installed.row.id,
      connectionId,
      userId,
      false,
      names,
      keepsPublicAccess || consent === true,
      grant,
    );

    // D11: older versions go only AFTER the new one is recorded and served,
    // so a failure anywhere above leaves the running version on disk.
    const pruned: string[] = [];
    for (const old of await deps.store.versions(key)) {
      if (compareSemver(old, to) >= 0) continue;
      await deps.store.removeVersion(key, old);
      pruned.push(old);
    }
    // And the add-ons' earlier versions, kept until now.
    if (addOnInstaller !== undefined) await pruneNamedAddOns(addOnInstaller.installer, manifest);

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
      actor.kind,
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
        missing: surfaces.length === 0 && !servesNothingByDesign(manifest),
        ...(writtenPages === undefined ? {} : { pages: writtenPages.pages }),
        ...(writtenPages?.rules === undefined ? {} : { rules: writtenPages.rules }),
        ...(writtenPages?.roles === undefined ? {} : { roles: writtenPages.roles }),
        ...(writtenPages?.publicAccess === undefined ? {} : { publicAccess: writtenPages.publicAccess }),
        ...(writtenPages?.outbox === undefined ? {} : { outbox: writtenPages.outbox }),
        ...(addOnsDone === undefined ? {} : { addOns: addOnsDone }),
      },
      from,
      to,
      pruned,
    };
  }

  /**
   * What the add-on installer may ask of this service: the port carries no
   * schema target, so the two members that need it take this server's own.
   */
  const core: InstallCore = {
    planFor: (manifest, connectionId) => planFor(manifest, connectionId),
    checkedPlan: async (key, manifest, connectionId, verb, expectedChecksum) => {
      const { plan, existing, shapeRecords } = await checkedPlan(key, manifest, connectionId, verb, expectedChecksum);
      return { plan, existing, shapeRecords };
    },
    recordTables,
    applyTables: (checked, manifest, connectionId, opts, hooks) => {
      // `checkedPlan` answered these tables, so the target is there: it refuses without one.
      if (deps.schemaTarget === undefined) throw new ValidationFailedError('This server has no connection layer to create tables in.', { reason: 'DDL_UNAVAILABLE' });
      return applyTables({ plan: checked.plan, existing: [...checked.existing], target: deps.schemaTarget }, manifest, connectionId, opts, hooks);
    },
    createTables: (key, manifest, connectionId, verb, opts, expectedChecksum) => createTables(key, manifest, connectionId, verb, opts, expectedChecksum),
    writePages,
    publicAccessOf: (manifest, connectionId, names, actor, installed) => publicAccessOf(manifest, connectionId, names, actor, installed),
    removals: { listOf: removals.listOf, checkDrop: removals.checkDrop, remove: removals.remove },
  };

  return {
    core,
    manifests,
    serverVersion,
    files,
    sidesOf,
    servesNothingByDesign,
    publisherOf,
    manifestOnlyDocument,
    publisherIdOf,
    publisherChangeRefusal,
    verifiedManifest,
    appManifestFrom,
    addOnRowsFor,
    addOnDeps,
    oldNamesOf,
    renameEdit,
    planFor,
    installedAppNames,
    installedElsewhere,
    publicAccessOf,
    publicAccessRecorder,
    writePages,
    createTables,
    recordTables,
    applyTables,
    checkedPlan,
    auditAppEvent,
    install,
    update,
    applyInPlace,
    removals,
    answerRemoval,
    /** The versions of a key that are packages in the store, whatever the folder holds. */
    packagedVersions: (key: string): Promise<string[]> => deps.store.versions(key).catch(() => [] as string[]),
  };
}
