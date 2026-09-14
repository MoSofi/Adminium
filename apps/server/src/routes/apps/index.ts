// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/api/v1/apps` — installing a micro-SaaS app into this instance
 * (47-app-installation.md §1 step 1).
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
 * where the schema plan goes (47 O2, step 2): an operator has to be able to see
 * what an install would create in their database BEFORE it creates it, and a
 * single call that unpacked and installed in one motion would have nowhere to
 * ask. It is also the shape `routes/add-ons` already has, for the same reason.
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
  isAddOnManifest,
  planInstall,
  validateManifest,
  type InstallPlan,
  type Manifest,
} from '@adminium/manifest';
import { auditRepo, manifestsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { surfacesOfInstalled, type InstalledApps } from '../../apps/installed.js';
import type { AppSchemaTarget } from '../../apps/schema-target.js';
import type { AppStore } from '../../apps/store.js';
import { AddOnStoreError } from '../../add-ons/store.js';
import { refusalReason, uploadRefusalMessage } from '../../add-ons/upload-refusal.js';
import { SURFACE_SIDES, type SurfaceSide } from '../../cli/surfaces-root.js';
import { audited, auditExempt } from '../../audit/coverage.js';
import { AppError, ConflictError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  appCatalogReply,
  appInstallPlanReply,
  appKeyParams,
  appListReply,
  discardStagedAppReply,
  installAppBody,
  installedAppReply,
  planAppBody,
  stagedAppParams,
  stagedAppReply,
  uninstallAppReply,
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
   * Where an app's tables are planned and created (47 O2).
   *
   * Optional so a composition with no connection layer still serves everything
   * else: an app that declares no tables installs there completely, and one
   * that does is refused with a reason rather than half-applied.
   */
  schemaTarget?: AppSchemaTarget | undefined;
}

export function appRoutes(deps: AppRoutesDeps): FastifyPluginAsyncZod {
  const manifests = manifestsRepo(deps.meta, deps.credentialCrypto);

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
  async function planFor(
    manifest: Manifest,
    connectionId: string,
  ): Promise<{ plan: InstallPlan; dto: AppInstallPlanDto }> {
    const tables = (await deps.schemaTarget?.read(connectionId)) ?? [];
    const plan = planInstall(manifest, { tables });
    return {
      plan,
      dto: {
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
      },
    };
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
      async () => {
        const rows = await manifests.list('app');
        const apps = rows.map((installed) => {
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
            sides: surfaces.map((surface) => ({
              side: surface.side,
              prefix: surface.prefix,
              navAvailable: surface.manifest !== null,
            })),
          };
        });

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
            'Send the bundle as a raw `application/octet-stream` body — the .tgz that ' +
              '`npm pack` produces for a built surface, holding `manifest.json` and a ' +
              '`staff/` and/or `customer/` directory.',
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
      async () => {
        const rows = await manifests.list('app');
        const installedByKey = new Map(rows.map((m) => [m.row.manifestKey, m.row.version]));

        const apps = [];
        for (const key of await deps.store.keys()) {
          const version = (await deps.store.versions(key))[0];
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
              readable = true;
            }
          } catch {
            // Unreadable is a state, not an error — see the schema's note.
          }

          const installedVersion = installedByKey.get(key) ?? null;
          apps.push({
            key,
            version,
            name,
            description,
            categories,
            publisher,
            capabilities,
            sides: surfacesOfInstalled(deps.store, { key, version }).map((s) => s.side),
            installed: installedVersion !== null,
            installedVersion: installedVersion === version ? null : installedVersion,
            readable,
          });
        }
        return { apps };
      },
    );

    app.post(
      '/apps/plan',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: {
          audit: auditExempt(
            'a preview of what installing would do; it reads the staged package and the ' +
              'snapshot and writes nothing. The install it precedes is audited.',
          ),
        },
        schema: { body: planAppBody, response: { 200: appInstallPlanReply } },
      },
      /*
       * WHAT AN INSTALL WOULD DO, BEFORE IT DOES IT.
       *
       * A POST that writes nothing, because it takes a body and because
       * planning reads a staged package the caller names. 26 §7 calls the
       * consent dialog "the security surface, not decoration: it is where a
       * user sees what an add-on may reach before it can reach it" — the same
       * sentence is why this route exists for apps, and why the install route
       * recomputes the plan rather than trusting what came back from here.
       */
      async (request) => {
        const { key, version, connectionId } = request.body;
        const manifest = await verifiedManifest(key, version);
        const { dto } = await planFor(manifest, connectionId);
        return { plan: dto };
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
        const { key, version, connectionId } = request.body;
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
         * THE TABLES, AND THE ORDER THEY GO IN (47 O2).
         *
         * The DDL runs BEFORE the meta row is written, which is the shape
         * MySQL's lack of transactional DDL leaves available: a multi-table
         * install cannot be one transaction, so the tables go first and the row
         * goes last. A failure halfway leaves real tables and nothing
         * registered — and every create is `IF NOT EXISTS`, so retrying
         * completes the install rather than colliding with it. The reverse
         * order would leave an app registered against tables that are not
         * there, which is the state a surface cannot recover from on its own.
         *
         * The plan is RECOMPUTED here rather than taken from the request. A
         * client-supplied plan is a client-supplied list of tables to create,
         * and the preview route exists to be read, not to be replayed.
         */
        const wanted = manifest.requiredSchema?.tables ?? [];
        let applied: { created: string[]; reused: string[] } | undefined;
        if (wanted.length > 0) {
          if (connectionId === undefined) {
            throw new ValidationFailedError(
              `"${key}" needs ${String(wanted.length)} table(s), so it must be installed against ` +
                'a connection. Choose the database it should read.',
              { reason: 'NO_CONNECTION', tables: wanted.map((table) => table.ref) },
            );
          }
          if (deps.schemaTarget === undefined) {
            throw new ValidationFailedError(
              `"${key}" needs tables, and this server has no connection layer to create them in.`,
              { reason: 'DDL_UNAVAILABLE' },
            );
          }

          const { plan, dto } = await planFor(manifest, connectionId);
          if (!plan.installable) {
            throw new ValidationFailedError(`"${key}" cannot be installed on this database.`, {
              reason: 'PLAN_REFUSED',
              problems: dto.problems,
            });
          }
          /*
           * A table that EXISTS but is missing columns the app needs is refused
           * rather than altered, the same rule 26-T02 set for add-ons: creating
           * a table an app asked for is one conversation, and altering one the
           * operator already owns is a different one that is theirs to have.
           */
          const short = plan.reuse.filter((table) => table.missingColumns.length > 0);
          if (short.length > 0) {
            throw new ValidationFailedError(
              `"${key}" needs columns that are missing from tables this database already has.`,
              {
                reason: 'COLUMNS_REQUIRED',
                tables: short.map((table) => ({
                  ref: table.ref,
                  missingColumns: table.missingColumns,
                })),
              },
            );
          }

          applied = await deps.schemaTarget.apply(plan, manifest, connectionId);
        }

        // Re-installing the same key replaces the row rather than adding a
        // second one: `list('app')` is what the registry reads, and two rows
        // for one key would make "which version is served" an ordering accident.
        const existing = (await manifests.list('app')).find((m) => m.row.manifestKey === key);
        if (existing !== undefined) await manifests.uninstall(existing.row.id);

        const installed = await manifests.install({
          manifestKey: key,
          version,
          kind: 'app',
          source: 'file',
          document: manifest,
          // Remembered, not just used: this is also the connection the staff
          // surface reads at runtime (29 D9).
          ...(connectionId === undefined ? {} : { connectionId }),
          installedBy: userId,
        });

        await deps.installed.refresh();
        await auditAppEvent(
          'app.installed',
          {
            key,
            version,
            source: 'file',
            sides: surfaces.map((s) => s.side),
            ...(connectionId === undefined ? {} : { connectionId }),
            ...(applied === undefined ? {} : { created: applied.created, reused: applied.reused }),
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
        };
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
        schema: { params: appKeyParams, response: { 200: uninstallAppReply } },
      },
      async (request) => {
        const { key } = request.params;
        const row = (await manifests.list('app')).find((m) => m.row.manifestKey === key);
        if (row === undefined) throw new NotFoundError(`"${key}" is not installed.`);

        /*
         * The row goes FIRST, then the bytes. The reverse order would leave a
         * row pointing at a package that is gone if the delete failed halfway —
         * an app listed as installed that serves nothing and cannot be removed.
         * This way a failure leaves bytes nobody references, which the staged
         * list shows and the operator can discard.
         */
        await manifests.uninstall(row.row.id);
        await deps.store.removeKey(key);
        await deps.installed.refresh();
        await auditAppEvent(
          'app.uninstalled',
          { key, version: row.row.version },
          request.user?.id ?? null,
          request.user?.email ?? 'unknown',
        );
        return { key, uninstalled: true };
      },
    );
  };
}
