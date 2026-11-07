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

import { narrowToWorkspace, workspaceIdQuery } from '../../workspaces/list-filter.js';
import { installReachOf } from '../../installs/reach.js';
import { grantKeyOf, installOnConnection, requireInstall, resolveInstall, selectorOf } from '../../installs/resolve.js';
import { rowTestOf } from '../../crud/row-limit-context.js';
import { reachOfRequest } from '../../crud/row-reach-request.js';
import { tableOfReal } from '../../installs/table-id.js';
import {
  compareSemver,
  isAddOnManifest,
  LOCAL_PUBLISHER_ID,
  validateManifest,
  type Manifest,
  satisfiesSemverRange,
  PHONE_SIDE,
  WORKSPACE_FILE,
} from '@adminium/manifest';
import { type DatabaseModel } from '@adminium/engine';
import {
  addOnSettingsRepo,
  appAfterInstallRepo,
  appPartsRepo,
  appTablesRepo,
  appUpdatesRepo,
  auditRepo,
  emailTemplatesRepo,
  connectionTenantConfig,
  connectionsRepo,
  pagesRepo,
  permissionsRepo,
  projectAppsRepo,
  publicEndpointsRepo,
  SecretSettingRefused,
  settingsRepo,
  snapshotsRepo,
  userPrefsRepo,
  jobsRepo,
  readAppModules,
  automationsRepo,
  rolesRepo,
  roleNameFor,
  realTableOf,
  type AppTableRecord,
} from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { AddOnCatalogError, pickLocalized } from '../../add-ons/catalog.js';
import {
  addOnNeedsOf,
  addOnPlanProblems,
} from '../../apps/add-ons.js';
import {
  APP_CATALOG_ENABLED_SETTING,
  appCatalogSchema,
  isCurrentAppCatalogFormat,
  meetsMinimum,
  type AppCatalogEntry,
  type UnavailableApp,
} from '../../apps/catalog.js';
import { addOnsHereFor, asInstalledHere, partsLeftOut, planModulesOf, planWholeOf, tickedByDefault } from '../../apps/app-modules.js';
import { surfacesOfInstalled } from '../../apps/installed.js';
import { afterInstallView, rightOf as afterInstallRightOf } from '../../apps/after-install-view.js';
import { INSTANCE_EVENTS, carriesInstance, instanceValuesNow, undoInstance } from '../../apps/manifest-instance.js';
import { workspaceFileRefusal } from '../../apps/workspace-files.js';
import { workspaceFileRoutes } from './workspace-files.js';
import { refusalReason, uploadRefusalMessage } from '../../add-ons/upload-refusal.js';
import { audited, auditExempt } from '../../audit/coverage.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import {
  appEntryFromCache,
  APP_CATALOG_REFRESH_KIND,
  enqueueAppCatalogRefresh,
  enqueueAppDownload,
} from '../../jobs/app-acquire.js';
import { CATALOG_REFRESH_KIND } from '../../jobs/add-on-acquire.js';
import { forgetClosedDoors, loadAppParts, roleIsOffered, switchOf } from '../../rbac/app-parts.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { pickLabel, sameLanguage } from '../../i18n/bcp47.js';
import { forgetAppSurfaceSettings, instancesOf, NO_SURFACE_SETTINGS, sideOffOf } from '../../surfaces/settings.js';
import { validateDomainEntries, validateInstanceEntries } from '../../surfaces/validate.js';
import { normalizeHost } from '../../security/csrf.js';
import { settingValueIssues, settingValuesWithDefaults } from '../../apps/settings-values.js';
import {
  createSampleDataService,
  enqueueSampleAdd,
  sampleAddUnderway,
  findSampleApp,
} from '../../apps/sample-data.js';
import { ownRules, shapeRules } from '../../apps/manifest-rules.js';
import { servedPublicEntries } from '../../apps/manifest-public.js';
import { SCHEMA_REMAP } from '../schema/index.js';
import { liveRowCounts } from '../../apps/table-counts.js';
import {
  createAppInstallService,
  FOLDER_SOURCE,
  MANIFEST_FILE,
  statusOf,
  updateRefusal,
  type AppRoutesDeps,
  type InstallActor,
  type InstallHost,
} from '../../apps/install-service.js';
import {
  appCatalogReply,
  appCatalogSettingsBody,
  appCatalogSettingsReply,
  appInstallPlanReply,
  addSampleBody,
  appJobReply,
  appKeyParams,
  appPartBody,
  appPartOpenReply,
  appPartParams,
  appPartsReply,
  appRulesReply,
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
  answerRemovalBody,
  answerRemovalReply,
  appRemovalsReply,
  planAppBody,
  connectionParams,
  shapeRulesReply,
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
  appInstanceParams,
  appInstanceAdoptPlanReply,
  appInstanceAdoptBody,
  appInstanceAdoptReply,
  afterInstallHiddenBody,
  afterInstallParams,
  afterInstallReply,
  afterInstallTickBody,
  appLookReply,
  appLookUndoReply,
  uninstallAppReply,
  updateAppBody,
  updateAppReply,
  uploadAppQuery,
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

// The install logic lives in the service; what this module always exported still comes from here.
export {
  editBodyFor,
  planChecksum,
  tablesNamedBy,
  updateRefusal,
  type AppRoutesDeps,
  type InstallAnswers,
} from '../../apps/install-service.js';


/** Whether a stored manifest declares a phone side: read from the document as it is, valid or not. */
function phoneOf(document: unknown): boolean {
  const frontends = (document as { frontends?: unknown } | null)?.frontends;
  return Array.isArray(frontends) && frontends.some((entry) => (entry as { side?: unknown } | null)?.side === PHONE_SIDE);
}

export function appRoutes(deps: AppRoutesDeps): FastifyPluginAsyncZod {
  const service = createAppInstallService(deps);
  const {
    manifests,
    serverVersion,
    files,
    sidesOf,
    servesNothingByDesign,
    publisherOf,
    manifestOnlyDocument,
    publisherIdOf,
    publisherChangeRefusal,
    lineageRefusal,
    olderVersionRefusal,
    copiesOf,
    verifiedManifest,
    appManifestFrom,
    addOnRowsFor,
    oldNamesOf,
    renameEdit,
    planFor,
    publicAccessOf,
    auditAppEvent,
  } = service;

  type InstalledApp = Awaited<ReturnType<typeof manifests.list>>[number];
  /** Connection names, for a refusal that lists a key's installs. */
  const connectionNames = async (): Promise<Map<string, string>> =>
    new Map((await deps.meta.db.selectFrom('adminium_connections').select(['id', 'name']).execute()).map((row) => [row.id, row.name]));

  /** Whether the caller may open the row-ceiling door a schema edit can need. */
  async function isSuperAdmin(request: FastifyRequest): Promise<boolean> {
    const server = request.server as { rbac?: { resolve?: (r: FastifyRequest) => Promise<{ superAdmin: boolean }> } };
    if (typeof server.rbac?.resolve !== 'function') return false;
    return (await server.rbac.resolve(request)).superAdmin;
  }

  /** Whether this key's installed row is an app of the project folder. */
  async function runsFromFolder(key: string): Promise<boolean> {
    // A package of a key the folder also carries is shadowed: what an update would read is the folder's manifest.
    if (files.sourceOf(key) === 'folder') return true;
    // key-wide: a project app is installed once per server.
    return (await manifests.list('app')).some((m) => m.row.manifestKey === key && m.row.source === FOLDER_SOURCE);
  }

  /** The refusal for a change Studio cannot make to an app the folder decides. */
  function folderDecides(key: string): ValidationFailedError {
    return new ValidationFailedError(
      `"${key}" runs from this project's folder (apps/${key}/). It is installed and changed from there: edit the folder, and \`adminium dev\` or the next start applies it.`,
      { reason: 'KEY_IN_PROJECT' },
    );
  }

  /** The signed-in caller, as the install service knows one. */
  function actorOf(request: FastifyRequest): InstallActor {
    return {
      id: request.user?.id ?? null,
      label: request.user?.email ?? 'unknown',
      superAdmin: () => isSuperAdmin(request),
      can: async (permission) => typeof request.can !== 'function' || (await request.can(permission as never)),
    };
  }

  /** This server, as the install service uses it. */
  function hostOf(request: FastifyRequest): InstallHost {
    const server = request.server;
    return {
      log: request.log,
      ...(server.hasDecorator('realtime')
        ? { publish: (channel, event, payload) => server.realtime.publish(channel, event as never, payload as never) }
        : {}),
      invalidateSurfaceSettings: () => server.surfaceSettings?.invalidate(),
    };
  }

  /**
   * An app file's bytes staged as the upload stages them: the package names
   * itself, every refusal the upload gives (the floor, the project folder, the
   * publisher, the catalogue's keys, another lineage, an older version), an
   * audit row per outcome, and where the file goes on this server. The upload
   * route and each app inside a workspace file come through here, so the two
   * cannot refuse differently.
   */
  async function stageAppFile(input: {
    body: Buffer;
    asserted: { key?: string | undefined; version?: string | undefined; expectedSha512: string };
    userId: string | null;
    userLabel: string;
    source?: 'upload' | 'workspace-file';
  }): Promise<z.infer<typeof stagedAppReply>> {
    const { body, asserted, userId, userLabel } = input;
    const source = input.source ?? 'upload';

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
    const installedRows = await manifests.list('app');
    // Each copy of each key, with its database's name: what a refusal below names, and where the reply says the file goes.
    const copiesByKey = new Map<string, Awaited<ReturnType<typeof copiesOf>>>();
    for (const keyed of new Set(installedRows.map((installed) => installed.row.manifestKey))) copiesByKey.set(keyed, await copiesOf(keyed));
    const installedVersions = new Map(installedRows.map((installed) => [installed.row.manifestKey, installed.row.version]));
    const installedPublishers = new Map(installedRows.map((installed) => [installed.row.manifestKey, publisherIdOf(installed.document)]));
    // Keys an install runs from the project folder, as well as the folders the build lists: a copy made editable here is the folder's at once.
    const folderKeys = new Set(installedRows.filter((installed) => installed.row.source === FOLDER_SOURCE).map((installed) => installed.row.manifestKey));
    // The keys the cached catalogue lists, when there is one: a self-made
    // app may not take the key of an app the catalogue offers.
    const cachedCatalog = await deps.store.readCatalogCache();
    const parsedCatalog =
      cachedCatalog === null || !isCurrentAppCatalogFormat(cachedCatalog.document)
        ? null
        : appCatalogSchema.safeParse(cachedCatalog.document);
    const catalogKeys = new Set(parsedCatalog?.success === true ? parsedCatalog.data.apps.map((entry) => entry.key) : []);
    // Who each key already in the store belongs to, by its newest readable package.
    const stagedPublishers = new Map<string, string>();
    for (const stagedKey of await deps.store.keys()) {
      for (const stagedVersion of await deps.store.versions(stagedKey)) {
        try {
          const id = publisherIdOf(JSON.parse((await deps.store.readFile(stagedKey, stagedVersion, MANIFEST_FILE)).toString('utf8')));
          if (id !== null) {
            stagedPublishers.set(stagedKey, id);
            break;
          }
        } catch {
          // Unreadable: it decides nothing here, and install refuses it on its own.
        }
      }
    }
    let staged;
    try {
      staged = await deps.store.stage({
        tarball: new Uint8Array(body),
        expectedIntegrity: asserted.expectedSha512,
        identify: (bytes, paths) => {
          // A workspace file is uploaded on its own route, which reads it one app at a time.
          if (paths.includes(WORKSPACE_FILE)) throw workspaceFileRefusal(bytes, serverVersion);
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
          // A key the project folder carries is the folder's: a package of it would be shadowed, never served.
          if (files.sourceOf(manifest.key) === 'folder' || folderKeys.has(manifest.key)) {
            throw new ValidationFailedError(
              `"${manifest.key}" is an app of this project (apps/${manifest.key}/). Change it there, or give this package another key.`,
              { reason: 'KEY_IN_PROJECT' },
            );
          }
          // Only against a row that is there: with none, there is nobody to take over from.
          const changed = installedPublishers.has(manifest.key)
            ? publisherChangeRefusal(manifest, installedPublishers.get(manifest.key) ?? null)
            : null;
          if (changed !== null) throw changed;
          // Another version of this key already in the store (bundled, downloaded, uploaded) decides whose key it is.
          const stagedPublisher = stagedPublishers.get(manifest.key);
          if (stagedPublisher !== undefined && stagedPublisher !== manifest.publisher.id) {
            throw new ValidationFailedError(
              `A package of "${manifest.key}" from the publisher "${stagedPublisher}" is already on this server, and this one says ` +
                `"${manifest.publisher.id}". Discard that package first, or give this app another key.`,
              { reason: 'PUBLISHER_CHANGED', installed: stagedPublisher, offered: manifest.publisher.id },
            );
          }
          if (manifest.publisher.id === LOCAL_PUBLISHER_ID && catalogKeys.has(manifest.key) && !installedVersions.has(manifest.key)) {
            throw new ValidationFailedError(
              `"${manifest.key}" is the key of an app in the online catalogue. Give your app another key.`,
              { reason: 'KEY_IN_CATALOG' },
            );
          }
          // Another dashboard's app saved under this key, or an older version than a copy runs: refused, saying where.
          const copies = copiesByKey.get(manifest.key) ?? [];
          const otherApp = lineageRefusal(manifest, copies) ?? olderVersionRefusal(manifest, copies);
          if (otherApp !== null) throw otherApp;
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
          source,
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
    if (sides.length === 0 && !servesNothingByDesign(read.manifest ?? null)) {
      // Staged and then discarded: a bundle with no servable side is not a
      // surface, and leaving it on disk would put a package in the staged
      // list that can never finish installing.
      await deps.store.removeVersion(key, version);
      await auditAppEvent(
        'app.unpack-refused',
        { key, version, source, reason: 'NO_SURFACE' },
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
        source,
        integrity: staged.tree.integrity,
        files: Object.keys(staged.tree.files).length,
        sides,
      },
      userId,
      userLabel,
    );

    // Where it goes: nowhere yet, over every copy, or onto a database without one.
    const copies = copiesByKey.get(key) ?? [];
    const taken = new Set(copies.map((copy) => copy.connectionId));
    const databasesFree = (await connectionsRepo(deps.meta, deps.credentialCrypto).list()).filter((connection) => !taken.has(connection.id)).length;
    const route: 'install' | 'update' | 'install-another' = copies.length === 0 ? 'install' : copies.some((copy) => compareSemver(version, copy.version) > 0) ? 'update' : 'install-another';
    return {
      key,
      version,
      // Always set here: `identify` ran, or the stage above threw.
      name: read.manifest?.name ?? key,
      ...(read.manifest === undefined ? {} : { publisher: { id: read.manifest.publisher.id, name: read.manifest.publisher.name } }),
      files: Object.keys(staged.tree.files).length,
      integrity: staged.tree.integrity,
      sides,
      route,
      installs: copies.map(({ document: _document, ...copy }) => copy),
      databasesFree,
    };
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

    // Workspace files: several app files in one, each staged through `stageAppFile` and installed through the service.
    await app.register(
      workspaceFileRoutes({
        deps,
        serverVersion,
        stageAppFile,
        copiesOf,
        install: (request, body) => service.install(actorOf(request), hostOf(request), body),
        update: (request, { key, installId, connectionId, body }) => service.update(actorOf(request), hostOf(request), { key, body, installId, ...(connectionId === null ? {} : { connectionId }) }),
        checkUpdate: (request, { key, installId, connectionId, body }) => service.checkUpdate(actorOf(request), hostOf(request), { key, body, installId, ...(connectionId === null ? {} : { connectionId }) }),
        auditAppEvent: (action, after, userId, userLabel) => auditAppEvent(action, after, userId, userLabel),
      }),
    );

    app.get(
      '/apps',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        preSerialization: narrowToWorkspace(deps.meta, 'apps', (row) => row['connectionId'] as string | null),
        schema: { querystring: z.object({ workspaceId: workspaceIdQuery }), response: { 200: appListReply } },
      },
      async (request) => {
        const rows = await manifests.list('app');
        // A copy whose update moved its version and stopped: said on its row, so it can be finished after a reload.
        const unfinished = new Map((await appUpdatesRepo(deps.meta).list()).map((update) => [update.manifestId, update]));
        const placements = (await request.server.surfaceSettings?.read()) ?? NO_SURFACE_SETTINGS;
        // How each app from the project folder stands: what was applied, and what was not.
        const folderState = rows.some((installed) => installed.row.source === FOLDER_SOURCE)
          ? new Map((await projectAppsRepo(deps.meta).list()).map((state) => [state.appKey, state]))
          : new Map<string, never>();
        const names = rows.some((installed) => installed.row.connectionId !== null) ? await connectionNames() : new Map<string, string>();
        const apps: z.infer<typeof installedAppReply>[] = await Promise.all(rows.map(async (installed) => {
          const { row } = installed;
          const slug = row.instanceSlug;
          const address = grantKeyOf(row);
          const packaged = surfacesOfInstalled(files, {
            key: row.manifestKey,
            version: row.version,
          });
          // A later install's screens are its own mount, when its sides serve every install; otherwise they open for the first only.
          const mounted = slug === '' || instancesOf(placements, row.manifestKey).some((instance) => instance.slug === slug);
          const surfaces = mounted
            ? packaged.map((surface) => (slug === '' ? surface : { ...surface, prefix: `/apps/${row.manifestKey}/${slug}/${surface.side}` }))
            : [];
          const document = (installed.document ?? null) as { name?: unknown; provenance?: { label?: unknown; savedAt?: unknown; adminiumVersion?: unknown } } | null;
          const provenance = document?.provenance;
          return {
            key: row.manifestKey,
            version: row.version,
            installId: row.id,
            slug,
            address,
            connectionName: row.connectionId === null ? null : (names.get(row.connectionId) ?? null),
            name: typeof document?.name === 'string' && document.name !== '' ? document.name : row.manifestKey,
            // A self-made app's icon (a lucide name); the page falls back to its package glyph.
            ...(typeof (document as { icon?: unknown } | null)?.icon === 'string' ? { icon: (document as { icon: string }).icon } : {}),
            ...(provenance !== undefined && typeof provenance.savedAt === 'string' && typeof provenance.adminiumVersion === 'string'
              ? { madeAt: { label: typeof provenance.label === 'string' ? provenance.label : null, savedAt: provenance.savedAt, adminiumVersion: provenance.adminiumVersion } }
              : {}),
            ...(mounted || packaged.length === 0 ? {} : { screensFirstOnly: true as const }),
            source: row.source,
            ...(row.source === FOLDER_SOURCE
              ? {
                  folder: {
                    state: files.sourceOf(row.manifestKey) === 'folder' ? ('here' as const) : ('gone' as const),
                    ...(folderState.get(row.manifestKey)?.removals == null
                      ? {}
                      : { removals: folderState.get(row.manifestKey)!.removals!.changes }),
                    ...(folderState.get(row.manifestKey)?.failure == null
                      ? {}
                      : {
                          notApplied: {
                            stage: folderState.get(row.manifestKey)!.failure!.stage,
                            message: folderState.get(row.manifestKey)!.failure!.message,
                          },
                        }),
                  },
                }
              : {}),
            installedAt: row.installedAt,
            connectionId: row.connectionId,
            // Only a record of the version this copy runs: an older one is from an update that never moved it.
            ...(unfinished.get(row.id)?.toVersion === row.version
              ? { unfinishedUpdate: { from: unfinished.get(row.id)!.fromVersion, to: row.version, stage: unfinished.get(row.id)!.stoppedAt } }
              : {}),
            sides: surfaces.map((surface) => {
              // Its own host when one is mapped to this install's own mount, else its prefix.
              const host = Object.entries(placements.domains).find(
                ([, target]) =>
                  target.appKey === row.manifestKey && target.side === surface.side && target.instance === (slug === '' ? undefined : slug),
              )?.[0];
              return {
                side: surface.side,
                prefix: surface.prefix,
                navAvailable: surface.manifest !== null,
                openUrl: host === undefined ? `${surface.prefix}/` : `${request.protocol}://${host}/`,
                state:
                  statusOf(row.status) === 'disabled'
                    ? ('disabled' as const)
                    : sideOffOf(placements, address, surface.side)
                      ? ('off' as const)
                      : ('on' as const),
              };
            }),
            ...(phoneOf(installed.document) ? { phone: true as const } : {}),
            ...(publisherOf(installed.document) === null ? {} : { publisher: publisherOf(installed.document)! }),
            // No side served, unless the app declares none: that one is whole.
            // …while its package is still here: one whose files are gone is missing like any other.
            missing:
              packaged.length === 0 &&
              !(manifestOnlyDocument(installed.document) && (await files.has(row.manifestKey, row.version))),
            status: statusOf(row.status),
          };
        }));
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
        return stageAppFile({ body, asserted: request.query, userId: request.user?.id ?? null, userLabel: request.user?.email ?? 'unknown' });
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

        /** What the catalog shows beside a row's name, or nothing it knows. */
        const displayOf = (listed: AppCatalogEntry | UnavailableApp | undefined) => ({
          iconTint: listed?.iconTint ?? null,
          iconPaths: listed?.iconPaths ?? null,
          lastUpdatedAt: listed?.lastUpdatedAt ?? null,
          requiresAddOns: listed !== undefined && 'addOns' in listed ? (listed.addOns?.requires ?? []) : [],
        });

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
            const validated = validateManifest(doc, { allowLocalPublisher: true });
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
            availability: 'installable' as const,
            ...displayOf(listed),
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
            availability: 'installable' as const,
            ...displayOf(entry),
          });
        }

        /*
         * LISTED, NOT DOWNLOADABLE: an app the site marks coming soon, or one
         * whose every release needs a newer Adminium — the add-on page's rule.
         */
        const unavailable = online && parsedCatalog?.success === true ? parsedCatalog.data.unavailable : [];
        for (const entry of unavailable) {
          const blocked =
            entry.availability === 'too-new' && entry.version !== null && entry.minAdminiumVersion !== null
              ? { version: entry.version, minAdminiumVersion: entry.minAdminiumVersion }
              : null;
          const existing = apps.find((row) => row.key === entry.key);
          if (existing !== undefined) {
            if (blocked !== null && existing.needsNewerAdminium === null && compareSemver(blocked.version, existing.version) > 0) {
              existing.needsNewerAdminium = blocked;
            }
            continue;
          }
          if (installedByKey.has(entry.key)) continue;
          apps.push({
            key: entry.key,
            version: entry.version ?? '',
            name: pickLocalized(entry.name, locale) ?? entry.key,
            description: pickLocalized(entry.tagline, locale) ?? '',
            categories: [],
            publisher: entry.author ?? '',
            capabilities: entry.capabilities,
            sides: [],
            installed: false,
            installedVersion: null,
            readable: true,
            source: 'catalog' as const,
            state: 'available' as const,
            updateTo: null,
            updateStaged: false,
            needsNewerAdminium: blocked,
            cannotUpdate: null,
            availability: entry.availability === 'coming-soon' ? ('coming-soon' as const) : ('installable' as const),
            ...displayOf(entry),
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
        /*
         * AN APP THE PROJECT FOLDER CARRIES has no package and is in no feed,
         * and its files are right here: listed as the installed app it is,
         * described by the manifest it was applied with.
         */
        for (const installed of rows) {
          const key = installed.row.manifestKey;
          if (listed.has(key) || files.sourceOf(key) !== 'folder') continue;
          const document = installed.document as Partial<Manifest> | null;
          listed.add(key);
          apps.push({
            key,
            version: installed.row.version,
            name: typeof document?.name === 'string' ? document.name : key,
            description: document?.description?.fallback ?? '',
            categories: [...(document?.categories ?? [])],
            publisher: document?.publisher?.name ?? '',
            capabilities: [...(document?.capabilities ?? [])],
            sides: surfacesOfInstalled(files, { key, version: installed.row.version }).map((s) => s.side),
            installed: true,
            installedVersion: null,
            readable: true,
            source: 'disk' as const,
            state: 'installed' as const,
            updateTo: null,
            updateStaged: false,
            needsNewerAdminium: null,
            cannotUpdate: null,
            availability: 'installable' as const,
            ...displayOf(undefined),
          });
        }
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
            availability: 'installable' as const,
            ...displayOf(undefined),
          });
        }

        apps.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        // A status row per copy, one per database.
        const withCopies = [];
        for (const entry of apps) {
          const copies = entry.installed ? await copiesOf(entry.key) : [];
          withCopies.push({ ...entry, installs: copies.map(({ document: _document, ...copy }) => copy) });
        }
        return {
          apps: withCopies,
          catalogFetchedAt: parsedCatalog?.success === true ? (cached?.fetchedAt ?? null) : null,
          onlineEnabled: online,
          // Being fetched now, by its own refresh or with the add-on list (one request for both).
          refreshing: online && ((await jobsRepo(deps.meta).active(APP_CATALOG_REFRESH_KIND)) !== null || (await jobsRepo(deps.meta).active(CATALOG_REFRESH_KIND)) !== null),
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
        if (files.sourceOf(key) === 'folder') {
          throw new ValidationFailedError(
            `"${key}" is an app of this project (apps/${key}/). A package of it would never be served.`,
            { reason: 'KEY_IN_PROJECT' },
          );
        }
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
        const { key, version, connectionId, choices, altPrefix, shares, pages, existing } = request.body;
        const declared = await verifiedManifest(key, version);
        // The preview an update is checked with: the same refusal the update
        // route gives, before the operator is shown tables to consent to.
        // The copy on the database asked about, whose version an update there moves from; else any copy.
        const copyHere = await manifests.findInScope(key, connectionId);
        // key-wide: one publisher names a key across the server, so any copy's document says it.
        const installed = (copyHere !== null && copyHere.row.kind === 'app' ? copyHere : undefined) ?? (await manifests.listByKey(key)).find((m) => m.row.kind === 'app');
        if (installed !== undefined) {
          // Never the plan of a takeover: the same refusal install and update give.
          const changed = publisherChangeRefusal(declared, publisherIdOf(installed.document));
          if (changed !== null) throw changed;
        }
        if (installed !== undefined && installed.row.version !== version) {
          const refused = updateRefusal(declared, installed.row.version);
          if (refused !== null) throw refused;
        }
        // The add-ons it names, each with its own plan: their consent is part of the app's.
        const addOns = await addOnRowsFor(declared, connectionId, true);
        // The app as it would stand with the add-ons ticked: a part built on one that is not there is left out.
        const here = addOnsHereFor(addOns, request.body.addOns ?? tickedByDefault(addOns));
        // A part this app already has tables of here is never left out again.
        const made = await service.tablesMadeFor(key, connectionId);
        const leftOut = partsLeftOut(declared, here, made);
        const manifest = asInstalledHere(declared, here, made);
        const { dto } = await planFor(
          manifest,
          connectionId,
          {
            ...(choices === undefined ? {} : { choices }),
            ...(altPrefix === undefined ? {} : { altPrefix }),
            ...(existing === undefined ? {} : { existing }),
            ...(shares === undefined ? {} : { shares }),
            ...(pages === undefined ? {} : { pages }),
          },
          addOns,
          // The copy on this database, when there is one: the plan is its update, and the other copies follow it.
          (await manifests.findInScope(key, connectionId))?.row.id,
        );
        const publicAccess = await publicAccessOf(
          manifest,
          connectionId,
          dto.names ?? {},
          actorOf(request),
          installed !== undefined && installed.row.connectionId === connectionId,
          new Map((dto.tables ?? []).map((table) => [table.ref, new Set(table.edits.filter((edit) => edit.kind === 'add-column').map((edit) => edit.column))])),
          // What the add-ons it brings would serve through its key is part of what is being allowed.
          addOns,
        );
        // What the add-ons refuse whatever the install says, so `installable` is the install's answer too.
        const addOnProblems = addOnPlanProblems(manifest.name, addOns);
        // An update to a version without the server-wide part puts back what the copy here wrote over the server.
        const restored =
          copyHere !== null && copyHere.row.kind === 'app' && copyHere.row.version !== version && !carriesInstance(declared)
            ? (await instanceValuesNow(deps.meta, copyHere.row.id)).filter((value) => !value.changed).map((value) => ({ kind: value.kind, item: value.item }))
            : [];
        return {
          plan: {
            ...dto,
            ...(restored.length === 0 ? {} : { instanceRestore: { needs: PERMISSIONS.settingsManage, canRestore: await canOf(request)(PERMISSIONS.settingsManage), values: restored } }),
            ...(addOnProblems.length === 0 ? {} : { installable: false, problems: [...dto.problems, ...addOnProblems] }),
            ...(publicAccess === undefined ? {} : { publicAccess }),
            ...(addOns.length === 0 ? {} : { addOns }),
            ...(declared.kind !== 'app' || declared.modules === undefined ? {} : { modules: planModulesOf(declared, leftOut, installed === undefined ? null : readAppModules(installed.row.modules)), whole: planWholeOf(declared) }),
          },
        };
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
        // An app the project folder carries is installed from there, with the folder's own rules.
        if (files.sourceOf(request.body.key) === 'folder') throw folderDecides(request.body.key);
        return service.install(actorOf(request), hostOf(request), request.body);
      },
    );

    /*
     * A LEGACY INSTANCE MADE AN INSTALL OF ITS OWN, as one reviewed step: what
     * it would do (its database, the settings it takes, the roles that will
     * open it), then the step itself. The tables there are used as they are;
     * the plan the operator reviews is `POST /apps/plan` on the instance's
     * database with `existing: "use"`.
     */
    app.get(
      '/apps/:key/instances/:slug/adopt',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { params: appInstanceParams, response: { 200: appInstanceAdoptPlanReply } },
      },
      async (request) => {
        const { key, slug } = request.params;
        const { connectionId, first } = await service.legacyInstanceOf(key, slug);
        const declared = (first.document as Manifest | null)?.settings ?? [];
        const values = await addOnSettingsRepo(deps.meta).valuesForInstall(first.row.id);
        const roles = [];
        const permissions = permissionsRepo(deps.meta);
        for (const role of await rolesRepo(deps.meta).list()) {
          const held = (await permissions.listForRole(role.id)).some((one) => one.resourceKind === 'app' && one.resourceRef === key && (one.actions as { staff?: boolean }).staff === true);
          if (held) roles.push({ id: role.id, name: role.name });
        }
        return {
          key,
          slug,
          connectionId,
          connectionName: (await connectionsRepo(deps.meta, deps.credentialCrypto).findById(connectionId))?.name ?? connectionId,
          version: first.row.version,
          settings: declared.filter((setting) => setting.secret !== true && values[setting.key] !== undefined).map((setting) => setting.key).sort(),
          secretsLeft: declared.filter((setting) => setting.secret === true).map((setting) => setting.key).sort(),
          roles,
        };
      },
    );

    app.post(
      '/apps/:key/instances/:slug/adopt',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: appInstanceParams, body: appInstanceAdoptBody, response: { 200: appInstanceAdoptReply } },
      },
      async (request) => service.adoptInstance(actorOf(request), hostOf(request), { key: request.params.key, slug: request.params.slug, planChecksum: request.body.planChecksum }),
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
        if (await runsFromFolder(request.params.key)) throw folderDecides(request.params.key);
        // One copy at a time, the one the request names: each is updated (and reviewed) on its own.
        const selector = selectorOf(request);
        return service.update(actorOf(request), hostOf(request), { key: request.params.key, body: request.body, installId: selector.installId, connectionId: selector.connectionId });
      },
    );

    /*
     * WHAT A FOLDER APP'S MANIFEST DROPPED THAT HOLDS DATA. Applying the
     * folder never drops a table or a column that holds rows: it records the
     * question and applies everything else. These two routes read it and
     * answer it — from Studio, from a script, from whatever stands in for
     * the person. The apply runs in this server, so the question cannot be a
     * prompt in somebody's terminal.
     */
    app.get(
      '/project/apps/:key/removals',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { params: appKeyParams, response: { 200: appRemovalsReply } },
      },
      async (request) => {
        await installedRow(request, request.params.key);
        return { key: request.params.key, removals: (await service.removals.pending(request.params.key))?.changes ?? null };
      },
    );

    app.post(
      '/project/apps/:key/removals',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: appKeyParams, body: answerRemovalBody, response: { 200: answerRemovalReply } },
      },
      // Saying yes destroys data, so it is Super Admin's alone, as dropping an app's tables on an uninstall is.
      async (request) => service.answerRemoval(actorOf(request), hostOf(request), { key: request.params.key, accept: request.body.accept }),
    );

    /*
     * THE RULES A SHAPE SET, for the column inspector: each still as the
     * add-on's shape wrote it, with the add-on's name and what switching it
     * off stops guaranteeing. Read by the same people who may edit the rules.
     */
    app.get(
      '/connections/:id/shape-rules',
      {
        preHandler: app.rbac.require(SCHEMA_REMAP),
        schema: { params: connectionParams, response: { 200: shapeRulesReply } },
      },
      async (request) => {
        const rules = await shapeRules(deps.meta, request.params.id);
        const names = new Map<string, string>();
        for (const addOn of new Set(rules.map((rule) => rule.addOn))) {
          // The add-on as this database has it (its name is the same on every copy).
          const installed = await installOnConnection(manifests, addOn, request.params.id);
          const name = (installed?.document as { name?: unknown } | null)?.name;
          names.set(addOn, typeof name === 'string' ? name : addOn);
        }
        return { rules: rules.map((rule) => ({ ...rule, addOnName: names.get(rule.addOn) ?? rule.addOn })) };
      },
    );

    // ── One app's own settings page ─────────────────────────────────────────

    /**
     * The ONE install a request means: the `X-Adminium-Install` header or
     * `?connectionId=`, else the key's only install. Several and nothing
     * naming which: 409 `APP_INSTALL_AMBIGUOUS`. None: a 404 naming the key.
     */
    async function installedRow(request: FastifyRequest, key: string): Promise<InstalledApp> {
      return (await requireInstall(manifests, key, selectorOf(request), { kind: 'app', connectionNames, reaches: installReachOf(deps.meta, request) })) as InstalledApp;
    }

    /** What an uninstall would remove and keep — the dialog's list, and the route's own. */
    const uninstallPlanOf = (row: InstalledApp) => service.removals.listOf(row);

    // ── Sample data ────────────────────────────────────────────────────────

    const samples = deps.sampleData === undefined ? null : createSampleDataService(deps.sampleData);

    // The install the request names (the header, or ?connectionId=), else the key's only one.
    async function sampleAppOf(request: FastifyRequest, key: string) {
      const found = await findSampleApp(deps.meta, key, selectorOf(request));
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
        const target = await sampleAppOf(request, request.params.key);
        if (samples === null) {
          return { offered: false, loaded: false, total: 0, addedAt: null, tables: [], available: null };
        }
        const stored = await samples.status(target);
        // Loaded once the add has finished: rows the job has written so far are not yet the whole of it.
        const status = stored.loaded && (await sampleAddUnderway(deps.meta, target)) ? { ...stored, loaded: false } : stored;
        const available = status.offered && !status.loaded ? await samples.addPreview(target) : null;
        return { ...status, available };
      },
    );

    app.post(
      '/apps/:key/sample-data',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: appKeyParams, body: addSampleBody, response: { 200: appJobReply } },
      },
      /*
       * A JOB: the rows and images of a small business are more than a request
       * should hold open, and the page follows its progress. The bundle is
       * checked here first, so a refusal is this request's answer rather than
       * a failed job.
       */
      async (request) => {
        const target = await sampleAppOf(request, request.params.key);
        if (samples === null) throw new NotFoundError(`"${target.key}" ships no sample data.`, { reason: 'NO_SAMPLE_DATA' });
        await samples.addPreview(target);
        // Only the add-ons this app names: a sample is never put into an add-on the app has nothing to do with.
        const withAddOns = [...new Set(request.body?.addOns ?? [])];
        const needs = addOnNeedsOf(target.manifest);
        const named = new Set([...(needs?.requires ?? []), ...(needs?.suggests ?? [])].map((entry) => entry.key));
        const stranger = withAddOns.find((key) => !named.has(key));
        if (stranger !== undefined) {
          throw new ValidationFailedError(`"${stranger}" is not an add-on ${target.manifest.name} names.`, { reason: 'ADD_ON_NOT_NAMED', addOn: stranger });
        }
        const userId = request.user?.id ?? null;
        const locale = (await userPrefsRepo(deps.meta).resolve(userId)).locale;
        const job = await enqueueSampleAdd(deps.meta, {
          key: target.key,
          installId: target.manifestId,
          locale,
          userId,
          userLabel: request.user?.email ?? 'unknown',
          ...(withAddOns.length === 0 ? {} : { withAddOns }),
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
        const target = await sampleAppOf(request, request.params.key);
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
        const target = await sampleAppOf(request, request.params.key);
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
        const plan = await uninstallPlanOf(await installedRow(request, request.params.key));
        const brief = (page: { slug: string; title: string }) => ({ slug: page.slug, title: page.title });
        // Its sample rows in a table another app goes on using: they stay, and the dialog says so.
        const sharedRefs = new Set(plan.tables.filter((entry) => entry.sharedWith.length > 0).map((entry) => entry.record.ref));
        const sampleApp = sharedRefs.size === 0 || samples === null ? null : await findSampleApp(deps.meta, plan.key);
        const sharedSampleRows =
          sampleApp === null || samples === null
            ? 0
            : (await samples.status(sampleApp)).tables.filter((table) => sharedRefs.has(table.ref)).reduce((sum, table) => sum + table.count, 0);
        return {
          key: plan.key,
          pages: { removed: plan.pages.removed.map(brief), kept: plan.pages.kept.map(brief) },
          keys: plan.keys.length,
          endpoints: plan.endpoints.length,
          rules:
            plan.connectionId === null
              ? 0
              : (await ownRules(deps.meta, plan.tables.map((entry) => entry.record), plan.connectionId)).length,
          ...(plan.instanceValues === 0 ? {} : { instance: { values: plan.instanceValues, canRestore: await canOf(request)(PERMISSIONS.settingsManage) } }),
          roles: plan.roles.map((entry) => ({
            slug: entry.role.slug,
            name: entry.role.name,
            members: entry.members.length,
            apiKeys: entry.apiKeys.length,
          })),
          tables: plan.tables.map((entry) => ({
            table: realTableOf(entry.record),
            droppable: entry.droppable,
            ...(entry.sharedWith.length === 0 ? {} : { sharedWith: entry.sharedWith }),
          })),
          hosts: plan.hosts,
          ...(sharedSampleRows === 0 ? {} : { sharedSampleRows }),
          canDropTables: await isSuperAdmin(request),
          ...(plan.addOns.length === 0 ? {} : { addOns: plan.addOns }),
          ...(plan.requiredBy.length === 0 ? {} : { requiredBy: plan.requiredBy }),
        };
      },
    );

    const declaredSettings = (row: InstalledApp) => (row.document as Manifest | null)?.settings ?? [];

    /** This app's settings, read from the STORE — a page about to write must not see a cached copy. */
    async function settingsView(row: InstalledApp) {
      const key = row.row.manifestKey;
      const document = row.document as Manifest | null;
      const addOns = document === null ? [] : (await addOnRowsFor(document, row.row.connectionId, false)).map(({ plan: _plan, ...rest }) => rest);
      const [apps, domains] = await Promise.all([
        settingsRepo(deps.meta).get('surfaces.apps'),
        settingsRepo(deps.meta).get('surfaces.domains'),
      ]);
      // An install's own entry: the bare install's under its key, a later one's under `<key>~<slug>`.
      const entry = apps[grantKeyOf(row.row)] ?? {};
      /*
       * Whether the customer side can actually answer. Its switch says the
       * PAGES are served; what they read and save goes through the public
       * API, by the access the install made. With the API off, or the app
       * installed without its access, the page read "Customer screens · On"
       * over pages that open and can do nothing.
       */
      // An entry that opens a table to forms (the key `forms`) is never served by the public API: a forms-only app asks nothing of it.
      const asks = document !== null && document.kind === 'app' && servedPublicEntries(document.publicAccess ?? []).length > 0;
      const publicAccess = !asks
        ? undefined
        : {
            apiOn: (await settingsRepo(deps.meta).get('publicApi.enabled')) === true,
            granted:
              row.row.connectionId !== null &&
              (await publicEndpointsRepo(deps.meta).listByConnection(row.row.connectionId)).some((endpoint) => endpoint.managedBy === key),
          };
      return {
        ...(publicAccess === undefined ? {} : { publicAccess }),
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
        ...(addOns.length === 0 ? {} : { addOns }),
        values: settingValuesWithDefaults(declaredSettings(row), await addOnSettingsRepo(deps.meta).valuesForInstall(row.row.id)),
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
      async (request) => settingsView(await installedRow(request, request.params.key)),
    );

    app.patch(
      '/apps/:key/settings',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: appKeyParams, body: appSettingsBody, response: { 200: appSettingsReply } },
      },
      async (request) => {
        const row = await installedRow(request, request.params.key);
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
        // This install's entry: its name, placement and switched-off sides are its own.
        const address = grantKeyOf(row.row);
        const entry = { ...(apps[address] ?? {}) };
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
          await settings.set('surfaces.apps', { ...apps, [address]: entry }, { updatedBy: userId });
        }
        if (body.values !== undefined) {
          try {
            await addOnSettingsRepo(deps.meta).patch(
              { manifestId: row.row.id, addOnKey: key },
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

    /** What one install put here, counted from its own records. */
    async function addedBy(row: InstalledApp): Promise<{ pages: number; emailTemplates: number; scheduledReports: number; roles: number }> {
      const pages = await deps.meta.db
        .selectFrom('adminium_pages')
        .select((eb) => eb.fn.countAll<number | string>().as('n'))
        .where('manifestId', '=', row.row.id)
        .executeTakeFirst();
      const templates = await emailTemplatesRepo(deps.meta).listManagedBy(row.row.manifestKey, row.row.id);
      return {
        pages: Number(pages?.n ?? 0),
        emailTemplates: new Set(templates.filter((template) => template.archivedAt === null).map((template) => template.key)).size,
        scheduledReports: (await appPartsRepo(deps.meta).list(row.row.id, 'scheduled-report')).length,
        roles: (await rolesRepo(deps.meta).listForInstall(row.row.id)).length,
      };
    }

    app.get(
      '/apps/:key/overview',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { params: appKeyParams, response: { 200: appOverviewReply } },
      },
      async (request) => {
        const row = await installedRow(request, request.params.key);
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
        // Counted now: the snapshot's estimate is what the install saw, before any row.
        const manager = deps.sampleData?.manager;
        const live =
          manager === undefined || connectionId === null || model === null
            ? new Map<string, number>()
            : await liveRowCounts(manager, connectionId, model, records.map((record) => realTableOf(record)));
        // How many rows a table holds is told to somebody who reads them all: a count of a table read in part is left out.
        // By the table's id: `sales.orders` read in part says nothing of `public.orders`, nor the other way round.
        const inPart = new Set<string>();
        let noCounts = false;
        if (connectionId !== null && model !== null) {
          const reach = await reachOfRequest(deps.meta, request, connectionId);
          // Somebody something could limit, and no schema to say on which tables: no count of any.
          if (reach === 'unreadable') noCounts = true;
          else if (reach !== null) for (const table of reach.view.model.tables) if (rowTestOf(reach.rows, table.id, 'read') !== null) inPart.add(table.id);
        }
        const modelTableOf = (record: AppTableRecord) => (model === null ? undefined : tableOfReal(model, realTableOf(record)));
        const tables = records
          .filter(
            (record) =>
              (record.role === 'app' || record.role === 'sample-ledger') &&
              record.state !== 'dropped' &&
              record.state !== 'pending',
          )
          // The ledger last, as the list of what the app keeps about itself.
          .sort((a, b) => Number(a.role === 'sample-ledger') - Number(b.role === 'sample-ledger'))
          .map((record) => {
            const found = modelTableOf(record);
            return {
              ref: record.ref,
              table: realTableOf(record),
              state: record.state,
              // Found here and used, or another app's: the install did not make it.
              ...(record.role === 'app' && (record.state === 'adopted' || record.state === 'shared') ? { before: true as const } : {}),
              role: record.role === 'sample-ledger' ? ('sample-ledger' as const) : ('app' as const),
              rows: noCounts || (found !== undefined && inPart.has(found.id)) ? null : (live.get(realTableOf(record)) ?? found?.rowCountEstimate ?? null),
            };
          });
        // This app's own lines, newest first. The key is in the row's JSON, so
        // the filter is here; a busy instance's app log is small.
        const entries = await auditRepo(deps.meta).list({ category: 'app', limit: 200 });
        const activity = entries
          .filter((entry) => {
            const after = (entry.changes as { after?: { key?: unknown; installId?: unknown } } | null)?.after;
            // A line that names its install is this install's only.
            return after?.key === key && (after.installId === undefined || after.installId === row.row.id);
          })
          .slice(0, 8)
          .map((entry) => {
            // What the line is about, where the action alone does not say: the add-on a step set up.
            const name = (entry.changes as { after?: { name?: unknown } } | null)?.after?.name;
            return {
              action: entry.action,
              at: entry.createdAt,
              actor: entry.actorLabel,
              ...(entry.action === 'app.add-on-step' && typeof name === 'string' && name !== '' ? { subject: name } : {}),
            };
          });
        return {
          key,
          connection: connection === undefined ? null : connection,
          added: await addedBy(row),
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
          const row = await installedRow(request, request.params.key);
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
            // Switched on again: a part that waited for an add-on connected while the app was off is put in now.
            if (verb === 'enable') await service.putInParts({ appKey: row.row.manifestKey, actor: actorOf(request), host: hostOf(request) });
          }
          return { key: row.row.manifestKey, status };
        },
      );
    }

    // ── After you install ──────────────────────────────────────────────────

    /** Whether the caller holds a permission; a composition with no grants (a test) holds every one. */
    const canOf = (request: FastifyRequest) => async (permission: string): Promise<boolean> =>
      typeof request.can !== 'function' || (await request.can(permission as never));

    const afterInstallOf = (request: FastifyRequest, row: InstalledApp) =>
      afterInstallView(
        deps.meta,
        { id: row.row.id, manifestKey: row.row.manifestKey, connectionId: row.row.connectionId, instanceSlug: row.row.instanceSlug },
        canOf(request),
      );

    app.get(
      '/apps/:key/after-install',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { params: appKeyParams, response: { 200: afterInstallReply } },
      },
      async (request) => afterInstallOf(request, await installedRow(request, request.params.key)),
    );

    /*
     * Put the list away once everything on it is done. Registered before the
     * item route: `hidden` is never an item's id.
     */
    app.put(
      '/apps/:key/after-install/hidden',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: appKeyParams, body: afterInstallHiddenBody, response: { 200: afterInstallReply } },
      },
      async (request) => {
        const row = await installedRow(request, request.params.key);
        const view = await afterInstallOf(request, row);
        if (request.body.hidden && view.items.some((item) => !item.done)) {
          throw new AppError(409, 'AFTER_INSTALL_NOT_DONE', 'Something after the install is still to do, so the list stays.', {
            open: view.items.filter((item) => !item.done).length,
          });
        }
        await appAfterInstallRepo(deps.meta).setHidden(row.row.id, request.body.hidden, request.user?.id ?? null);
        await auditAppEvent(
          request.body.hidden ? 'app.after-install-hidden' : 'app.after-install-shown',
          { key: row.row.manifestKey, installId: row.row.id },
          request.user?.id ?? null,
          request.user?.email ?? 'unknown',
        );
        return afterInstallOf(request, row);
      },
    );

    app.put(
      '/apps/:key/after-install/:id',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: afterInstallParams, body: afterInstallTickBody, response: { 200: afterInstallReply } },
      },
      async (request) => {
        const row = await installedRow(request, request.params.key);
        const repo = appAfterInstallRepo(deps.meta);
        // Of this install only: another install's item is not here.
        const item = await repo.findById(row.row.id, request.params.id);
        if (item === null) throw new NotFoundError('That item is not on this install\'s list.');
        const right = afterInstallRightOf(item.kind);
        if (!(await canOf(request)(right))) {
          throw new ForbiddenError('Ticking this off needs the permission to do it.', 'FORBIDDEN', { reason: 'AFTER_INSTALL_RIGHT', right });
        }
        await repo.setDone(row.row.id, item.id, request.body.done, request.user?.id ?? null);
        // What was done, never the value it was done with.
        await auditAppEvent(
          'app.after-install-ticked',
          { key: row.row.manifestKey, installId: row.row.id, kind: item.kind, item: item.item, done: request.body.done },
          request.user?.id ?? null,
          request.user?.email ?? 'unknown',
        );
        return afterInstallOf(request, row);
      },
    );

    // ── The look and languages a self-made app's file brought ──────────────

    app.get(
      '/apps/:key/look',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { params: appKeyParams, response: { 200: appLookReply } },
      },
      async (request) => {
        const row = await installedRow(request, request.params.key);
        const values = await instanceValuesNow(deps.meta, row.row.id);
        if (values.length === 0) return { look: null };
        type Group = 'logo' | 'colours' | 'languages' | 'wordings' | 'systemEmails' | 'settings';
        const groupOf = (value: (typeof values)[number]): Group => {
          if (value.kind === 'word') return 'wordings';
          if (value.kind === 'email') return 'systemEmails';
          if (value.kind === 'locale') return 'languages';
          if (value.item === 'branding.logoFileId' || value.item === 'branding.faviconFileId') return 'logo';
          if (value.item.startsWith('appearance.')) return 'colours';
          return 'settings';
        };
        const changed = new Set<Group>();
        for (const value of values) if (value.changed) changed.add(groupOf(value));
        const of = (group: Group) => values.filter((value) => groupOf(value) === group);
        return {
          look: {
            appliedAt: Math.min(...values.map((value) => value.at)),
            logo: of('logo').length > 0,
            colours: of('colours').length > 0,
            // The languages it switched on; one it switched off is a change of wording, said nowhere.
            languages: of('languages').filter((value) => value.applied === true).map((value) => value.item),
            wordings: of('wordings').length,
            systemEmails: new Set(of('systemEmails').map((value) => value.item.slice(0, value.item.indexOf('/')))).size,
            settings: of('settings').length,
            changed: (['logo', 'colours', 'languages', 'wordings', 'systemEmails', 'settings'] as const).filter((group) => changed.has(group)),
            canUndo: await canOf(request)(PERMISSIONS.settingsManage),
          },
        };
      },
    );

    app.post(
      '/apps/:key/look/undo',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: appKeyParams, response: { 200: appLookUndoReply } },
      },
      async (request) => {
        const row = await installedRow(request, request.params.key);
        // It is written over the whole server: only someone who may change the server's settings puts it back.
        if (!(await canOf(request)(PERMISSIONS.settingsManage))) {
          throw new ForbiddenError('Putting back the look and languages needs the permission to change the server\'s settings.', 'FORBIDDEN', { reason: 'SETTINGS_MANAGE' });
        }
        const done = await undoInstance(deps.meta, row.row.id, request.user?.id ?? null);
        // The screens repaint the look and the words they show.
        const host = hostOf(request);
        if (done.branding) host.publish?.('config-changed', INSTANCE_EVENTS.branding, {});
        if (done.words) host.publish?.('config-changed', INSTANCE_EVENTS.i18n, {});
        await auditAppEvent(
          'app.look-undone',
          { key: row.row.manifestKey, installId: row.row.id, restored: done.restored.length, kept: done.kept.length },
          request.user?.id ?? null,
          request.user?.email ?? 'unknown',
        );
        return { restored: done.restored, kept: done.kept };
      },
    );

    // ── Parts ──────────────────────────────────────────────────────────────

    /** The app's whole manifest as its package holds it (a part left out of the install is in it), or what is installed when the package is gone. */
    async function declaredManifest(row: InstalledApp): Promise<Manifest | null> {
      try {
        return await verifiedManifest(row.row.manifestKey, row.row.version);
      } catch {
        return (row.document as Manifest | null) ?? null;
      }
    }

    async function partsView(row: InstalledApp, locale: string): Promise<z.infer<typeof appPartsReply>> {
      const key = row.row.manifestKey;
      const declared = await declaredManifest(row);
      const state = (await loadAppParts(deps.meta, [key])).get(row.row.id);
      if (declared === null || declared.kind !== 'app' || state === undefined || state.modules === null) return { parts: [] };
      const installed = (row.document as Manifest | null) ?? declared;
      const made = new Set((installed.requiredSchema?.tables ?? []).map((table) => table.ref));
      const addOnNames = new Map((await manifests.list('add-on')).map((m) => [m.row.manifestKey, (m.document as { name?: string } | null)?.name ?? m.row.manifestKey]));
      const appRoles = await rolesRepo(deps.meta).listForInstall(row.row.id);
      const members = new Map<string, number>();
      for (const role of appRoles) members.set(role.id, (await rolesRepo(deps.meta).usersInRole(role.id)).length);
      const rules = (await automationsRepo(deps.meta).listManagedBy(key, row.row.connectionId)).filter((rule) => rule.enabled);
      const needs = new Map((declared.addOns?.features ?? []).map((feature) => [feature.id, feature.requires]));
      return {
        parts: (declared.modules ?? []).map((module) => {
          const tables = (declared.requiredSchema?.tables ?? []).filter((table) => 'module' in table && table.module === module.id);
          return {
            id: module.id,
            label: pickLabel(module.label, locale) ?? module.id,
            default: module.default,
            switch: switchOf(state.modules!, module.id),
            on: !state.off.has(module.id),
            waiting: (state.waiting.get(module.id) ?? []).map((addOn) => ({ key: addOn, name: addOnNames.get(addOn) ?? addOn })),
            needs: (module.feature === undefined ? [] : (needs.get(module.feature) ?? [])).map((addOn) => ({ key: addOn, name: addOnNames.get(addOn) ?? addOn })),
            leftOut: tables.some((table) => !made.has(table.ref)),
            pages: (declared.pages ?? []).filter((page) => page.module === module.id).length,
            tables: tables.length,
            rules: rules.filter((rule) => rule.module === module.id).length,
            roles: appRoles
              .filter((role) => role.modules?.includes(module.id) === true)
              .map((role) => ({ slug: role.slug, name: roleNameFor(role, (names) => sameLanguage(names, locale)), members: members.get(role.id) ?? 0 })),
          };
        }),
      };
    }

    const readerLocale = async (request: FastifyRequest): Promise<string> =>
      request.user === null || request.user === undefined ? 'en-US' : (await userPrefsRepo(deps.meta).resolve(request.user.id)).locale;

    app.get(
      '/apps/:key/parts',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { params: appKeyParams, response: { 200: appPartsReply } },
      },
      async (request) => partsView(await installedRow(request, request.params.key), await readerLocale(request)),
    );

    app.get(
      '/apps/:key/parts/:part/open',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { params: appPartParams, response: { 200: appPartOpenReply } },
      },
      /*
       * WHAT IS OPEN IN A PART, asked before it is switched off: the rows of
       * its tables that are part way through their states (a job not signed
       * off), the rules that would stop, and the people who would be left
       * with nothing. Counts only: no row is shown.
       */
      async (request) => {
        const row = await installedRow(request, request.params.key);
        const key = row.row.manifestKey;
        const locale = await readerLocale(request);
        const document = (row.document as Manifest | null) ?? null;
        const module = document?.kind === 'app' ? (document.modules ?? []).find((one) => one.id === request.params.part) : undefined;
        if (document === null || module === undefined) throw new NotFoundError(`"${key}" has no part "${request.params.part}".`);
        const connectionId = row.row.connectionId;
        const names = connectionId === null ? {} : await appTablesRepo(deps.meta).realNames(connectionId, key);
        const snapshot = connectionId === null ? null : await snapshotsRepo(deps.meta).latest(connectionId);
        const model = (snapshot?.schema ?? null) as DatabaseModel | null;
        const manager = deps.sampleData?.manager;
        const open: { table: string; label: string; rows: number }[] = [];
        const handle = connectionId === null || model === null || manager === undefined ? null : await manager.mustFind(connectionId).then((found) => manager.data(found)).catch(() => null);
        // How many rows a table holds is told to somebody who reads them all: a table read in part is left out, as on the app's page.
        // By the table's id: a table in a schema of its own (`sales.jobs`) is found as itself, never missed and counted.
        const inPart = new Set<string>();
        if (connectionId !== null && model !== null) {
          const reach = await reachOfRequest(deps.meta, request, connectionId);
          if (reach === 'unreadable') for (const table of model.tables) inPart.add(table.id);
          else if (reach !== null) for (const table of reach.view.model.tables) if (rowTestOf(reach.rows, table.id, 'read') !== null) inPart.add(table.id);
        }
        if (connectionId !== null && model !== null && handle !== null) {
          for (const table of document.requiredSchema?.tables ?? []) {
            if (!('module' in table) || table.module !== module.id || table.states === undefined) continue;
            const real = tableOfReal(model, names[table.ref] ?? table.ref);
            if (real === undefined || inPart.has(real.id)) continue;
            // A state something still moves out of: the row is not at its end.
            const unfinished = Object.entries(table.states.moves).filter(([, moves]) => moves.length > 0).map(([state]) => state);
            if (unfinished.length === 0) continue;
            const counted = await handle.db
              .selectFrom(real.id as never)
              .select((eb) => eb.fn.countAll().as('n'))
              .where(table.states.column as never, 'in', unfinished as never)
              .executeTakeFirst();
            const rows = Number((counted as { n?: unknown } | undefined)?.n ?? 0);
            const label = table.labelPlural ?? table.label;
            if (rows > 0) open.push({ table: table.ref, label: label === undefined ? table.ref : typeof label === 'string' ? label : (pickLabel(label, locale) ?? table.ref), rows });
          }
        }
        // The people every one of whose roles is of this part alone, or of parts already off.
        const state = await loadAppParts(deps.meta);
        // This install's part off, under its id and its key alike (a role finds its install by either); another copy's stays as it is.
        const after = new Map([...state].map(([app, parts]) => [app, parts.id === row.row.id ? { ...parts, off: new Set([...parts.off, module.id]) } : parts]));
        const roles = rolesRepo(deps.meta);
        const holders = new Set<string>();
        for (const role of (await roles.listForInstall(row.row.id)).filter((one) => one.modules?.includes(module.id) === true)) {
          for (const userId of await roles.usersInRole(role.id)) holders.add(userId);
        }
        let stranded = 0;
        for (const userId of holders) {
          const held = await roles.rolesForUser(userId);
          const before = held.some((role) => roleIsOffered(role, state) && state.get(role.appKey ?? '')?.disabled !== true);
          const then = held.some((role) => roleIsOffered(role, after) && state.get(role.appKey ?? '')?.disabled !== true);
          if (before && !then) stranded += 1;
        }
        return {
          id: module.id,
          label: pickLabel(module.label, locale) ?? module.id,
          open,
          rules: (await automationsRepo(deps.meta).listManagedBy(key, connectionId)).filter((rule) => rule.enabled && rule.module === module.id).length,
          pages: (document.pages ?? []).filter((page) => page.module === module.id).length,
          stranded,
        };
      },
    );

    /*
     * THE APP'S OWN RULES, EACH ON OR OFF, for the app's own people.
     *
     * A screen of the app that depends on a rule ("the owner is told when a
     * deal sits too long") has to say whether that rule runs, and switching a
     * rule is the work of somebody who manages rules, which no role of an app
     * does. So anybody who may open the app's staff side (`app:<key>:staff`)
     * reads this much, and no more: for each rule THE INSTALLED MANIFEST ships,
     * its key, its name in the reader's language, and whether it is on.
     *
     * Not listed: a rule somebody made by hand (it is no rule of the app's,
     * whatever table it watches), another app's or an add-on's, a rule of a
     * part that is switched off, and a rule of a stage that is not installed
     * (the installed manifest does not ship it). A shipped rule that is not
     * there (the rules page never removes one; a restore may) is listed as
     * off: it does not run. The name is the manifest's own, never one
     * somebody typed since.
     */
    app.get(
      '/apps/:key/rules',
      {
        onRequest: app.requireAuth,
        schema: { params: appKeyParams, response: { 200: appRulesReply } },
      },
      async (request) => {
        const key = request.params.key;
        const refuse = () => new ForbiddenError('This account cannot open this app’s staff screens.', 'FORBIDDEN', { reason: 'NO_STAFF_ACCESS', appKey: key });
        const may = async (grantKey: string) => typeof request.can === 'function' && (await request.can(`app:${grantKey}:staff` as never));
        /*
         * The install FIRST, then that install's grant: holding one install's
         * grant opens no other's. Somebody with no grant learns nothing of the
         * app — not whether it is installed, nor on how many databases.
         */
        let found: InstalledApp | null;
        try {
          // Several and none named: the choice lists only the copies whose screens this person opens; none, the refusal.
          found = (await resolveInstall(manifests, key, selectorOf(request), { kind: 'app', connectionNames, reaches: (one) => may(grantKeyOf(one.row)), unreached: refuse })) as InstalledApp | null;
        } catch (error) {
          if (error instanceof ConflictError || (await may(key))) throw error;
          throw refuse();
        }
        if (found === null) {
          if (!(await may(key))) throw refuse();
          throw new NotFoundError(`"${key}" is not installed.`);
        }
        if (!(await may(grantKeyOf(found.row)))) throw refuse();
        const row = found;
        if (row.row.status !== 'installed') throw new NotFoundError(`"${key}" is not installed.`);
        const document = (row.document as Manifest | null) ?? null;
        const shipped = document?.kind === 'app' ? (document.automations ?? []) : [];
        if (shipped.length === 0) return { rules: [] };
        const locale = await readerLocale(request);
        const parts = (await loadAppParts(deps.meta, [key])).get(row.row.id);
        const stored = new Map((await automationsRepo(deps.meta).listManagedBy(key, row.row.connectionId)).map((rule) => [rule.templateKey, rule] as const));
        return {
          rules: shipped
            .filter((rule) => rule.module === undefined || parts === undefined || !parts.off.has(rule.module))
            .map((rule) => ({
              key: rule.key,
              name: typeof rule.name === 'string' ? rule.name : (pickLabel(rule.name, locale) ?? rule.key),
              on: stored.get(rule.key)?.enabled === true,
            })),
        };
      },
    );

    app.put(
      '/apps/:key/parts/:part',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: appPartParams, body: appPartBody, response: { 200: appPartsReply } },
      },
      /*
       * THE SWITCH. On needs no update and no restart: the part's pages,
       * rules and roles are read against the switch each time. Nothing that
       * happened while it was off is replayed. A part that is always on, and
       * one the app does not have, has no switch.
       */
      async (request) => {
        const row = await installedRow(request, request.params.key);
        const key = row.row.manifestKey;
        const stored = readAppModules(row.row.modules);
        const def = stored?.defs.find((one) => one.id === request.params.part);
        if (stored === null || def === undefined) throw new NotFoundError(`"${key}" has no part "${request.params.part}".`);
        if (def.default === 'always') {
          throw new AppError(409, 'PART_ALWAYS_ON', 'This part of the app is always on.', { appKey: key, module: def.id });
        }
        const before = switchOf(stored, def.id);
        if (before !== request.body.on) {
          await manifests.setModuleSwitch(row.row.id, def.id, request.body.on);
          forgetClosedDoors(deps.meta);
          await surfacesChanged(request);
          await auditAppEvent(
            request.body.on ? 'app.part-on' : 'app.part-off',
            { key, version: row.row.version, module: def.id },
            request.user?.id ?? null,
            request.user?.email ?? 'unknown',
          );
        }
        return partsView(await installedRow(request, key), await readerLocale(request));
      },
    );

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
        const row = await installedRow(request, request.params.key);
        const key = row.row.manifestKey;
        const settings = settingsRepo(deps.meta);
        const [apps, domains, pageHosts] = await Promise.all([settings.get('surfaces.apps'), settings.get('surfaces.domains'), settings.get('surfaces.pageHosts')]);
        const others = Object.fromEntries(Object.entries(domains).filter(([, target]) => target.appKey !== key));
        const { normalized, issues } = validateDomainEntries(
          Object.fromEntries(Object.entries(request.body.domains).map(([host, target]) => [host, { ...target, appKey: key }])),
          {
            requestHost: normalizeHost(request.host),
            surfaces: surfacesOfInstalled(files, { key, version: row.row.version }),
            settings: { apps, domains, statuses: {} },
          },
        );
        for (const host of Object.keys(normalized)) {
          const holder = Object.entries(others).find(([mapped]) => normalizeHost(mapped) === host)?.[1];
          if (holder !== undefined) {
            issues.push({ path: host, message: `"${host}" already opens "${holder.appKey}".`, code: 'host_taken' });
          }
          // A host that serves the add-on pages is not this app's to take either.
          if (Object.keys(pageHosts).some((mapped) => normalizeHost(mapped) === host)) {
            issues.push({ path: host, message: `"${host}" already opens the add-on pages.`, code: 'host_taken' });
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
        const row = await installedRow(request, request.params.key);
        const key = row.row.manifestKey;
        const settings = settingsRepo(deps.meta);
        const { rows, issues } = await validateInstanceEntries(key, request.body.instances, {
          surfaces: surfacesOfInstalled(files, { key, version: row.row.version }),
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
        const installed = await installedRow(request, key);
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
        const installed = await installedRow(request, key);
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
        // key-wide: installed on any database at this version, one version per app, so that is every copy's.
        const installed = (await manifests.listByKey(key)).find((m) => m.row.kind === 'app' && m.row.version === version);
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
        // One install: named by the request, or the key's only one. The others stay, with their files.
        const row = await installedRow(request, key);
        /*
         * AN APP THE FOLDER STILL CARRIES would be installed again at the next
         * build or start. Removing it starts in the project: delete the
         * folder, and then uninstall what is left here.
         */
        if (row.row.source === FOLDER_SOURCE && files.sourceOf(key) === 'folder') {
          throw new ValidationFailedError(
            `"${key}" runs from this project's folder. Delete apps/${key}/ from the project first; uninstalling it here would only have it installed again.`,
            { reason: 'KEY_IN_PROJECT' },
          );
        }
        const userId = request.user?.id ?? null;
        const dropTables = request.body?.dropTables === true;
        if (dropTables && request.body?.confirmKey !== key) {
          throw new ValidationFailedError(`Type "${key}" to confirm deleting its tables and data.`, {
            reason: 'CONFIRM_KEY_MISMATCH',
          });
        }
        const plan = await uninstallPlanOf(row);
        const superAdmin = await isSuperAdmin(request);
        // Everything that could refuse the drop is asked first; then the steps, in order (`apps/removal.ts`).
        const settingsManage = await canOf(request)(PERMISSIONS.settingsManage);
        await service.removals.checkDrop(plan, { dropTables, superAdmin, settingsManage });
        const { rulesRemoved, emailsRemoved, dropped, kept, instanceRestored } = await service.removals.remove(plan, { dropTables, superAdmin, settingsManage, createdBy: userId });
        // Its own settings go with it (the row's cascade too); a reinstall starts from the manifest's defaults.
        await addOnSettingsRepo(deps.meta).clearForInstall(row.row.id);
        /*
         * Its links to add-ons go; the add-ons stay installed — they are
         * shared, and removing one is its own decision, made in Add-ons. The
         * link rows belong to the ADD-ONS' manifest rows, so the app row's
         * cascade below would not take them.
         */
        // The other installs of the key (on other databases) keep the app's files, its project record and their own links.
        const othersRemain = (await manifests.listByKey(key)).some((one) => one.row.id !== row.row.id);
        // What the folder had applied, failed or asked: forgotten with the app (a project app is once per server).
        if (!othersRemain) await projectAppsRepo(deps.meta).remove(key);
        const detached = await manifests.detachHost({ key, hostInstall: row.row.id });
        if (detached > 0) await deps.addOns?.installer.rebuildRuntime?.();

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
        // One version per app on a server, one copy of its files: they go with the last install.
        if (othersRemain) filesRemoved = false;
        else {
          try {
            await deps.store.removeKey(key);
          } catch (error) {
            filesRemoved = false;
            request.log.warn({ err: error, key }, 'app uninstalled, but its files were not removed');
          }
        }
        await deps.installed.refresh();
        /*
         * Its placement and domains go with it. A host left mapped to a key
         * nothing serves makes the domains editor refuse every later save —
         * including the one mapping that host to whatever replaces this app.
         */
        const forgotten = await forgetAppSurfaceSettings(
          deps.meta,
          { key, slug: row.row.instanceSlug },
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
          ...(instanceRestored === 0 ? {} : { instance: instanceRestored }),
        };
        const keptSummary = {
          pages: plan.pages.kept.length,
          tables: kept.map((entry) => realTableOf(entry.record)),
          ...(plan.addOns.length === 0 ? {} : { addOns: plan.addOns.map((addOn) => addOn.key) }),
        };
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
        return { key, uninstalled: true, removed, kept: keptSummary, dropped, ...(filesRemoved ? {} : { filesRemoved: false }) };
      },
    );
  };
}
