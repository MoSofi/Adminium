// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/api/v1/add-ons` — install, list, enable/disable and uninstall
 * (audit rows).
 *
 * ─── This is what un-reserved `manifests.manage` ───────────────────────────
 *
 * `RESERVED_SYSTEM_ACTION_KEYS`'s own docblock says to move a key out of the
 * reserved list "in the same change that lands its first enforcement point".
 * These routes are that point. Deliberately NOT `settings.manage`, which
 * originally specified: installing an add-on runs its server half in this
 * process, and that is not the same authority as changing a workspace
 * setting.
 *
 * `GET` is the exception and is only `authenticated` — it is the list a HOST
 * reads on every page load in connected mode, so gating it behind an admin
 * permission would mean no ordinary user could see an add-on's surface. It
 * carries no secret to make that safe (see `schema.ts`).
 *
 * AUTHENTICATED IS NOT NOTHING, and for a fortnight it was: neither `GET` route
 * carried a `preHandler` at all, and this server has no ambient auth hook — a
 * route that names no guard has none. Found by the round trip; the two routes
 * now say `app.requireAuth` where they previously only said so in prose.
 * `add-on-routes.test.ts` asserts every route's guard from the live route table
 * rather than from a list, so a route added without one fails there.
 *
 * ─── Install takes a staged package, never a manifest body ─────────────────
 *
 * `POST` was amended to take a `{ key, version }`
 * reference into the on-disk store. The bytes are already verified against
 * an independent hash — the bundled pin, the catalog row's ledger value, or
 * the operator's own — and the tree is RE-VERIFIED here against its
 * unpack-time pin before a single byte is parsed — the data volume is
 * shared, writable state, so install never re-trusts bare disk bytes. A
 * route that accepted a manifest document would be a route that installs
 * code nobody checked.
 *
 * ─── The DDL runs BEFORE the meta row is written ───────────────────────────
 *
 * `applyInstall` creates the tables a plan says to create, through
 * `deps.schemaTarget`. The ordering is deliberate and is the shape MySQL's lack
 * of transactional DDL leaves available: a multi-table install cannot be one
 * transaction, so the tables go first and the manifest row goes last. A failure
 * halfway leaves real tables and nothing registered — and every create is `IF
 * NOT EXISTS`, so retrying completes the install rather than colliding with it.
 * The reverse order would leave an add-on registered against tables that are
 * not there.
 *
 * Two things install still REFUSES rather than does:
 *
 *  - **Adding columns to a table that already exists** (`ADD_ON_COLUMNS_REQUIRED`).
 *    Creating a table an add-on asked for is one conversation; altering one the
 *    operator already owns is a different one, and it is theirs to have.
 *  - **Creating anything with no data source wired in** (`ADD_ON_DDL_REQUIRED`),
 *    which is the composition without a `schemaTarget`. An add-on that brings
 *    no tables still installs there completely.
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
  validateManifest,
  type AddOnManifest,
} from '@adminium/manifest';
import {
  SecretSettingRefused,
  addOnSettingsRepo,
  auditRepo,
  manifestsRepo,
  settingsRepo,
  userPrefsRepo,
  type InstalledManifest,
  type MetaDb,
} from '@adminium/meta';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import {
  AddOnCatalogError,
  CATALOG_ENABLED_SETTING,
  catalogSchema,
  isCurrentCatalogFormat,
  lenientMinimum,
  meetsMinimum,
  pickLocalized,
  type CatalogClient,
} from '../../add-ons/catalog.js';
import { addOnHttpClientFor } from '../../add-ons/egress.js';
import {
  addOnManifestFromStore,
  attachAddOn,
  installAddOn,
  planAddOn,
  upgradeAddOn,
  type Actor,
} from '../../add-ons/install.js';
import { needsByAddOn, needsOf, type AppNeed } from '../../add-ons/needs.js';
import {
  AddOnOAuthError,
  createOAuthFlowStore,
  exchangeAuthorizationCode,
  type OAuthConnect,
  type OAuthFlowStore,
} from '../../add-ons/oauth.js';
import type { AddOnRuntimeState } from '../../add-ons/runtime.js';
import type { AddOnSchemaTarget } from '../../add-ons/schema-target.js';
import { packageIsInStore } from '../../add-ons/store.js';
import type { AddOnStore, StagedPackage } from '../../add-ons/store.js';
import { refusalReason, uploadRefusalMessage } from '../../add-ons/upload-refusal.js';
import {
  addOnEntryFromCache,
  enqueueAddOnDownload,
  enqueueCatalogRefresh,
} from '../../jobs/add-on-acquire.js';
import { audited } from '../../audit/coverage.js';
import { attachAppDocuments } from '../../documents/app-documents.js';
import { AppError, ConflictError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { settingValueIssues } from '../../apps/settings-values.js';
import { addOnSettingsGrantHeld } from '../../rbac/add-on-grant.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { getPrincipal } from '../../rbac/principal.js';
import { APP_VERSION } from '../../version.js';
import {
  addOnBundleParams,
  addOnKeyParams,
  addOnListReply,
  catalogBrowseReply,
  catalogSettingsBody,
  catalogSettingsReply,
  completeOAuthBody,
  connectAddOnBody,
  connectAddOnReply,
  discardStagedReply,
  disconnectAddOnReply,
  downloadAddOnBody,
  downloadAddOnReply,
  refreshCatalogReply,
  stagedPackageReply,
  stagedParams,
  startOAuthBody,
  startOAuthReply,
  upgradeAddOnReply,
  uploadAddOnQuery,
  installAddOnBody,
  installAddOnReply,
  installPlanReply,
  patchAddOnBody,
  patchAddOnReply,
  uninstallAddOnReply,
  type AddOnDto,
  addOnSettingsBody,
  addOnSettingsReply,
  attachAddOnBody,
  attachAddOnReply,
} from './schema.js';

/** Sideload cap: the largest first-party dist is ~300 KB (own sizing). */
export const UPLOAD_BODY_LIMIT = 32 * 1024 * 1024;

export interface AddOnRoutesDeps {
  meta: MetaDb;
  store: AddOnStore;
  /**
   * The catalog client, for the two routes that may reach the network. Optional
   * so a composition without one still serves everything else — an instance
   * that can only ever use the bundled set is a supported configuration, not a
   * degraded one.
   */
  catalog?: CatalogClient | undefined;
  /** Encrypt/decrypt closures over `ADMINIUM_SECRET`; routes never see the key. */
  credentialCrypto: { encrypt(v: string): string; decrypt(v: string): string };
  /**
   * The database an add-on's tables are planned against and created in.
   *
   * Injected rather than reached for: planning must work on an instance with no
   * connection at all (an add-on that touches no data installs there happily),
   * and a route that demanded a live introspection would refuse that case.
   * Absent entirely, every plan sees an empty database and any install needing
   * tables is refused rather than half-applied.
   */
  schemaTarget?: AddOnSchemaTarget | undefined;
  /** Injectable only so a test can drive an expired or unknown state. */
  oauthFlows?: OAuthFlowStore | undefined;
  /**
   * Rebuild the add-on runtime after install, upgrade, enable/disable and
   * uninstall.
   *
   * `runtime.ts` has claimed this since wave 26 and `compose.ts` built the
   * state exactly once, at boot — so a provider installed at 10am was
   * unreachable until the process restarted, round trip could never have
   * passed. Optional because a route-only test topology composes no runtime
   * at all; absent, the routes behave as they did before.
   */
  rebuildRuntime?: (() => Promise<void>) | undefined;
  /**
   * The add-on runtime as it stands, read AFTER a rebuild: connecting an add-on
   * to an installed app makes the app's documents that add-on draws, and only
   * a loaded provider says which kinds it draws. Absent, as in a route-only
   * test topology, no document is made.
   */
  runtime?: (() => AddOnRuntimeState | null) | undefined;
  /**
   * The half of uninstall that is 34's. Called INSIDE the uninstall
   * handler, before the manifest row goes, so no job can be enqueued for a
   * provider that is already gone.
   */
  onAddOnRemoved?: ((key: string) => Promise<void>) | undefined;
  /** Tests only; production checks declared minimums against the running version. */
  serverVersion?: string | undefined;
}

/** The add-on block of a validated manifest, narrowed for reading. */
type AddOnBlock = AddOnManifest['addOn'];

/**
 * The FULL validator, not just the schema parse.
 *
 * `addOnManifestSchema.safeParse` checks the SHAPE. `validateManifest` adds the
 * policy layer, and two of its rules are the reason this wave exists:
 *
 * - **The publisher gate**. `allowThirdPartyPublishers` stays off, so a manifest
 *  whose `publisher.id` is not `adminium` is refused. It is a policy control
 *  rather than a supply-chain one — the field is inside the package — but it is
 *  the control the rulings name, and a schema parse does not run it.
 *  - **`FRONTEND_SECRET_LEAK`** (acceptance #7): `publicSettings` may never name
 *    a `secret: true` setting. That is the rule standing between a credential
 *    and a browser, and it is enforced here on the real installed manifest
 *    rather than only in the add-on repo's own CI.
 */
function parseManifest(document: unknown, key: string): AddOnManifest {
  const result = validateManifest(document);
  if (!result.ok) {
    throw new ValidationFailedError(
      `The stored manifest for "${key}" is not a valid add-on manifest.`,
      { issues: result.issues },
    );
  }
  if (!isAddOnManifest(result.manifest)) {
    throw new ValidationFailedError(`"${key}" is an app manifest, not an add-on.`);
  }
  return result.manifest;
}

/**
 * An add-on manifest out of an uploaded package's bytes, or a refusal.
 *
 * The same FULL validator `parseManifest` runs on a stored manifest, so the
 * publisher gate and `FRONTEND_SECRET_LEAK` refuse a package at the upload,
 * where the file was chosen, instead of after it has been staged. Its own
 * function because the package has no name to put in a refusal until this has
 * read one.
 */
function uploadedManifest(bytes: Buffer, serverVersion: string): AddOnManifest {
  let document: unknown;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new ValidationFailedError(
      'This package carries no readable `manifest.json` at its root.',
      { reason: 'MANIFEST_MISSING' },
    );
  }
  const result = validateManifest(document);
  if (!result.ok) {
    // A NEWER ADD-ON, NOT A BROKEN ONE: a manifest using a field this server
    // does not know yet fails the strict parse, and its own floor says why.
    const minimum = lenientMinimum(document);
    if (minimum !== null && !meetsMinimum(minimum, serverVersion)) {
      const key = typeof (document as { key?: unknown }).key === 'string' ? (document as { key: string }).key : null;
      throw new ValidationFailedError(
        `${key === null ? 'This add-on' : `"${key}"`} needs Adminium ${minimum} or later; this server is ` +
          `${serverVersion}. Upgrade Adminium before uploading it.`,
        { reason: 'REQUIRES_NEWER_ADMINIUM', minAdminiumVersion: minimum, serverVersion },
      );
    }
    throw new ValidationFailedError('The manifest in this package is not a valid add-on manifest.', {
      issues: result.issues,
    });
  }
  if (!isAddOnManifest(result.manifest)) {
    throw new ValidationFailedError(
      `"${result.manifest.key}" is an app, not an add-on. Install it from Studio → Hosted apps.`,
      { reason: 'WRONG_KIND' },
    );
  }
  return result.manifest;
}

/**
 * Turn an OAuth refusal into the 422 it always was.
 *
 * `AddOnOAuthError` is a plain `Error`, so an unmapped one reaches the handler
 * as `INTERNAL` and renders a 500. Every one of its six reasons is a
 * client-visible, actionable condition — a manifest that points its authorize
 * URL at a host it never declared, a state nobody started, a flow that expired,
 * a provider that answered without a token — and not one of them is a fault in
 * this server.
 *
 * [Found 2026-08-31 by the round trip, on `import-canva`.] A 500 is not a
 * cosmetic mis-labelling here: it tells an operator to look at their server
 * logs for a problem that is in an add-on's manifest, and it puts a real
 * refusal in the bucket monitoring pages.
 */
function asOAuthRefusal(error: unknown): never {
  if (error instanceof AddOnOAuthError) {
    throw new ValidationFailedError(error.message, { code: error.reason });
  }
  throw error;
}

/** 409 `ADD_ON_REQUIRED_BY`: the apps that cannot run without the add-on, named. */
function requiredByError(key: string, requiring: readonly AppNeed[], verb: 'removed' | 'switched off'): AppError {
  const names = requiring.map((need) => need.appName);
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`;
  return new AppError(
    409,
    'ADD_ON_REQUIRED_BY',
    `"${key}" can’t be ${verb}: ${list} ${names.length === 1 ? 'needs' : 'need'} it. ` +
      `Uninstall ${names.length === 1 ? 'that app' : 'those apps'} first.`,
    { addOn: key, apps: requiring.map((need) => ({ app: need.app, name: need.appName, status: need.status })) },
  );
}

export function addOnRoutes(deps: AddOnRoutesDeps): FastifyPluginAsyncZod {
  const manifests = manifestsRepo(deps.meta, deps.credentialCrypto);
  const serverVersion = deps.serverVersion ?? APP_VERSION;
  // One store per composed server: in memory, single-use, short-lived, bounded
  // (see `add-ons/oauth.ts` on why, and on the multi-process limitation).
  const oauthFlows: OAuthFlowStore = deps.oauthFlows ?? createOAuthFlowStore();

  /**
   * The SRI value a host pins a bundle to.
   *
   * Derived from the sha256 the store recorded at unpack rather than
   * recomputed: the hash is "recorded at install and checked on
   * read", and one hash used for both is the only shape where what a host pins
   * and what the server will serve cannot drift apart.
   */
  function sriFor(sha256Hex: string): string {
    return `sha256-${Buffer.from(sha256Hex, 'hex').toString('base64')}`;
  }

  /**
   * Distinct client paths the manifest declares, in first-declared order.
   *
   * Slot fills AND page modules (51a): this list is both what the bundle route
   * will serve and what the install report hashes, so a page whose module is
   * missing from it is a 404 at mount — the page would be declared, listed in
   * the rail, and unservable.
   */
  function bundlePathsOf(block: AddOnBlock): string[] {
    return [
      ...new Set([
        ...(block.slots ?? []).map((slot) => slot.client),
        ...(block.pages ?? []).map((page) => page.client),
      ]),
    ];
  }

  /** Who did it, for the audit rows the shared installer writes. */
  function actorOf(request: FastifyRequest): Actor {
    return { id: request.user?.id ?? null, label: request.user?.email ?? 'unknown' };
  }

  /**
   * The documents of installed apps the add-on was just connected to — made
   * here, not left for the app's next update. Run after the runtime rebuild,
   * which is what knows the kinds the add-on draws; run whether or not the
   * connection changed, so connecting again mends an app connected before.
   */
  async function makeAppDocuments(request: FastifyRequest, hosts: readonly string[]): Promise<void> {
    if (deps.runtime === undefined || hosts.length === 0) return;
    const made = await attachAppDocuments({ meta: deps.meta, hosts, runtime: deps.runtime, createdBy: request.user?.id ?? null });
    for (const { app, result } of made) {
      if (result.skipped.length + result.refused.length === 0) continue;
      request.log.info({ app, skipped: result.skipped, refused: result.refused }, 'app document profiles skipped');
    }
  }

  /** The app needs a reply carries, in the wire shape. */
  function needsDto(needs: readonly AppNeed[]) {
    return needs.map((need) => ({
      app: need.app,
      appName: need.appName,
      status: need.status,
      need: need.need,
      range: need.range,
      features: need.features.map((feature) => ({ id: feature.id, label: { ...feature.label } })),
    }));
  }

  async function toDto(installed: InstalledManifest, usedBy?: readonly AppNeed[]): Promise<AddOnDto> {
    const manifest = parseManifest(installed.document, installed.row.manifestKey);
    const block: AddOnBlock = manifest.addOn;
    // `credentialStatus` deliberately, not `getCredential`: a LIST must never
    // decrypt anything.
    const credential = await manifests.credentialStatus(installed.row.id);
    return {
      key: manifest.key,
      name: manifest.name,
      version: installed.row.version,
      connectKind: block.connect.kind,
      connected: credential !== null,
      // The one disk read in this DTO. Without it the list is a pure meta read
      // and cannot tell a running add-on from one a redeploy erased.
      missing: !(await packageIsInStore(deps.store, {
        key: manifest.key,
        version: installed.row.version,
      })),
      connectionExpiresAt: credential?.expiresAt ?? null,
      attachments: installed.attachments.map((a) => ({
        attachedTo: a.attachedTo,
        enabled: a.disabledAt === null,
      })),
      // Both optional in the schema: an add-on may fill no slot (a data pack
      // the host reads through a typed surface) or provide no contract.
      slots: (block.slots ?? []).map((s) => ({
        slot: s.slot,
        client: s.client,
        order: s.order ?? 0,
      })),
      provides: (block.provides ?? []).map((p) => ({ contract: p.contract, version: p.version })),
      networkAllow: block.network?.allow ?? [],
      /*
       * The manifest's declaration, flattened for a form that has to render
       * every variant with one component. `enum`'s options come across because
       * only the manifest knows them; everything else the form derives from
       * `type`.
       */
      settings: (manifest.settings ?? []).map((setting) => ({
        key: setting.key,
        type: setting.type,
        required: setting.required ?? false,
        secret: setting.secret ?? false,
        label: setting.label ?? null,
        help: (setting as { help?: { key: string; fallback: string } }).help ?? null,
        options: setting.type === 'enum' ? [...(setting.enum ?? [])] : [],
      })),
      // The stored NON-SECRET half. A secret is written through connect and
      // read back never, so nothing here can carry one.
      settingValues: await addOnSettingsRepo(deps.meta).valuesFor(manifest.key),
      /*
       * THE PIN, NOT THE BYTES — and one drifted file does not take the list
       * down with it.
       *
       * This used to call `readVerifiedFile` per bundle: a full read plus a
       * fresh sha256, on the route a host calls on EVERY page load, only to
       * discard the bytes and return the hash the pin already recorded. Worse
       * than the cost, `AddOnStoreError` is a plain `Error` rather than an
       * `AppError`, so a single tampered or truncated file rendered as a 500
       * INTERNAL and took the whole list with it — every add-on, every user,
       * and every reply that goes through `toDto` (install, upgrade, connect,
       * patch). "Somebody edited a package on the data volume" is the one
       * signal exists to raise, and it was arriving as an internal fault.
       *
       * Now the integrity value comes from the pin, and a bundle whose pin
       * cannot be read is reported as an integrity of `null` for that ONE
       * bundle. "Checked on read" is unchanged where it matters: the bundle
       * route still re-hashes the bytes it serves.
       */
      bundles: (
        await Promise.all(
          bundlePathsOf(block).map(async (path) => {
            const url = `/api/v1/add-ons/${manifest.key}/bundle/${path}`;
            try {
              const sha256 = await deps.store.pinnedSha256(
                manifest.key,
                installed.row.version,
                path,
              );
              return { path, url, integrity: sriFor(sha256) };
            } catch {
              return null;
            }
          }),
        )
      ).filter((bundle): bundle is { path: string; url: string; integrity: string } => bundle !== null),
      usedBy: needsDto(usedBy ?? (await needsOf(deps.meta, manifest.key))),
    };
  }

  /** The installer's dependencies: the same ones for every door that installs. */
  const installer = {
    meta: deps.meta,
    store: deps.store,
    credentialCrypto: deps.credentialCrypto,
    schemaTarget: deps.schemaTarget,
    rebuildRuntime: deps.rebuildRuntime,
  };

  /** The connect block of an oauth2 manifest, narrowed. */
  function connectOf(manifest: AddOnManifest): OAuthConnect {
    const connect = manifest.addOn.connect;
    if (connect.authorizeUrl === undefined || connect.tokenUrl === undefined) {
      // The validator requires both on an `oauth2` connect, so reaching
      // this means an installed manifest predates that rule.
      throw new ValidationFailedError(
        `"${manifest.key}" declares an OAuth connect without both endpoint URLs.`,
      );
    }
    return {
      authorizeUrl: connect.authorizeUrl,
      tokenUrl: connect.tokenUrl,
      ...(connect.scopes === undefined ? {} : { scopes: connect.scopes }),
    };
  }

  /** Installed + oauth2, or a refusal that says which of the two failed. */
  async function oauthContextFor(key: string) {
    const installed = await manifests.findByKey(key);
    if (installed === null) throw new NotFoundError(`"${key}" is not installed.`);
    const manifest = parseManifest(installed.document, key);
    if (manifest.addOn.connect.kind !== 'oauth2') {
      throw new ValidationFailedError(
        `"${key}" does not connect over OAuth — its connect kind is ` +
          `"${manifest.addOn.connect.kind}".`,
      );
    }
    return { installed, manifest };
  }

  /**
   * Stages an uploaded package under the identity its own manifest declares.
   *
   * The key and version come out of `manifest.json`, read by the store from the
   * verified in-memory unpack before a byte is written, so the package lands
   * under exactly the key its bundle URLs and its install will use. A caller's
   * `asserted` key or version is only checked against it.
   */
  async function stageUpload(
    asserted: { key?: string | undefined; version?: string | undefined },
    tarball: Uint8Array,
    expectedIntegrity: string,
    userId: string | null,
    userLabel: string,
  ): Promise<{ staged: StagedPackage; name: string }> {
    // An object, not a `let`: TypeScript cannot see an assignment made inside
    // the callback, and would read a `let` as never assigned below it.
    const read: { manifest?: AddOnManifest } = {};
    let staged: StagedPackage;
    try {
      staged = await deps.store.stage({
        tarball,
        expectedIntegrity,
        identify: (bytes) => {
          const manifest = uploadedManifest(bytes, serverVersion);
          read.manifest = manifest;
          if (asserted.key !== undefined && asserted.key !== manifest.key) {
            throw new ValidationFailedError(
              `The package was uploaded as "${asserted.key}" but its manifest declares "${manifest.key}".`,
              { reason: 'KEY_MISMATCH' },
            );
          }
          if (asserted.version !== undefined && asserted.version !== manifest.version) {
            throw new ValidationFailedError(
              `The package was uploaded as version ${asserted.version} but its manifest declares ${manifest.version}.`,
              { reason: 'VERSION_MISMATCH' },
            );
          }
          /*
           * THE FLOOR, ON THE PATH THAT HAS NO CATALOG.
           *
           * A minimum only the catalogue checks is not a minimum — the same
           * release arrives here as a file, and this is the path an operator
           * reaches for precisely when the catalogue has said no. The manifest
           * is the authority either way: the feed row only copies what this
           * document declares, so refusing on the document refuses the
           * identical fact one step closer to the bytes.
           *
           * LAST OF THE THREE, and the order is deliberate. A caller who
           * asserted the wrong key or version has not established that they
           * meant this package at all, so "you uploaded a different add-on"
           * is the correction to give them; "this needs a newer Adminium" is
           * only true of a package they meant to send.
           */
          const minimum = manifest.compatibility.minAdminiumVersion;
          if (!meetsMinimum(minimum, serverVersion)) {
            throw new ValidationFailedError(
              `"${manifest.key}" ${manifest.version} needs Adminium ${minimum} or later; this ` +
                `server is ${serverVersion}. Upgrade Adminium before uploading it.`,
              { reason: 'REQUIRES_NEWER_ADMINIUM', minAdminiumVersion: minimum, serverVersion },
            );
          }
          return { key: manifest.key, version: manifest.version };
        },
      });
    } catch (error) {
      const reason = refusalReason(error);
      await auditRepo(deps.meta).append({
        actorKind: 'user',
        actorId: userId,
        actorLabel: userLabel,
        category: 'add-on',
        action: reason === 'INTEGRITY_MISMATCH' ? 'add-on.verify-refused' : 'add-on.unpack-refused',
        changes: {
          after: {
            // What is known of the package, which may be nothing: a refused
            // hash or archive is refused before the manifest is read.
            key: read.manifest?.key ?? asserted.key ?? null,
            version: read.manifest?.version ?? asserted.version ?? null,
            source: 'upload',
            reason,
            bytes: tarball.byteLength,
          },
        },
      });
      // A manifest refusal is already a sentence about this package.
      if (error instanceof AppError) throw error;
      throw new ValidationFailedError(uploadRefusalMessage(error, 'add-on package'), { reason });
    }

    await auditRepo(deps.meta).append({
      actorKind: 'user',
      actorId: userId,
      actorLabel: userLabel,
      category: 'add-on',
      action: 'add-on.staged',
      changes: {
        after: {
          key: staged.key,
          version: staged.version,
          source: 'upload',
          integrity: staged.tree.integrity,
          files: Object.keys(staged.tree.files).length,
        },
      },
    });
    // Always set here: `identify` ran, or the stage above threw.
    return { staged, name: read.manifest?.name ?? staged.key };
  }

  return async (app) => {
    // Raw tarball bodies, this plugin's scope only. There is no
    // `@fastify/multipart` in this server and adding one for a single route
    // would be a new dependency on the RCE path; the established idiom for a
    // binary upload here is a scoped parser plus a route-scoped `bodyLimit`
    // (`routes/imports`).
    app.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer' },
      (_request, body, done) => {
        done(null, body);
      },
    );

    app.get(
      '/add-ons/catalog',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { response: { 200: catalogBrowseReply } },
      },
      async (request) => {
        // NEVER fetches inline. Browsing is a disk read: the bundled set
        // plus whatever the last refresh cached. That is what makes the page
        // work identically on an air-gapped install, and what stops a page load
        // from becoming an outbound call nobody asked for.
        //
        // The prefs read is the one addition and it is a META read, not
        // a network one: the feed carries eight locales per row and the server
        // projects ONE, so the reply keeps a single string per field instead of
        // an 8x multiplier the browser would discard seven-eighths of.
        const [installedList, stagedKeys, cached, prefs] = await Promise.all([
          manifests.list('add-on'),
          deps.store.keys(),
          deps.store.readCatalogCache(),
          userPrefsRepo(deps.meta).resolve(request.user?.id ?? null),
        ]);
        const locale = prefs.locale;

        const installed = new Map(installedList.map((m) => [m.row.manifestKey, m.row.version]));
        const staged = new Map<string, string>();
        /*
         * Every version on disk per key, not only the newest: an installed row
         * is missing when THAT version is absent, which a newest-only map
         * cannot tell apart from a key whose other version happens to be here.
         * This is `packageIsInStore`'s question asked in bulk — one `versions`
         * call per key rather than one per installed row — and it must stay
         * the same question.
         */
        const onDisk = new Map<string, readonly string[]>();
        for (const key of stagedKeys) {
          const versions = await deps.store.versions(key);
          onDisk.set(key, versions);
          const newest = versions[0];
          if (newest !== undefined) staged.set(key, newest);
        }

        /*
         * The cached feed is parsed BEFORE the staged loop, not after, because
         * D3 makes it the preferred tagline source for rows that are already on
         * disk: a bundled add-on's own `description` is one English string,
         * while the feed has the same line in eight languages. Air-gapped
         * installs have no cache and fall through to the manifest, which is the
         * case that stops the card being blank where it matters most.
         */
        // A cache in an earlier feed format (a server upgraded from 0.2.8 or
        // before still holds its last v1 feed) counts as no cache: its rows are
        // not offered, and `catalogFetchedAt` below says "never" so the page
        // asks for a refresh instead of showing a fetch time for a list it hid.
        const parsedCatalog =
          cached === null || !isCurrentCatalogFormat(cached.document)
            ? null
            : catalogSchema.safeParse(cached.document);
        const feed = new Map(
          parsedCatalog?.success === true
            ? parsedCatalog.data.addOns.map((entry) => [entry.key, entry] as const)
            : [],
        );

        const rows = new Map<string, (typeof entries)[number]>();
        const entries: Array<{
          key: string;
          name: string;
          version: string;
          source: 'bundled' | 'catalog';
          state: 'installed' | 'staged' | 'available' | 'missing';
          upgradeTo: string | null;
          needsNewerAdminium: { version: string; minAdminiumVersion: string } | null;
          tagline: string | null;
          categories: string[];
          connectKind: 'none' | 'api-key' | 'oauth2';
        }> = [];

        /**
         * A feed row this server is too old for, or null.
         *
         * LISTED, NOT HIDDEN. Dropping such a row would leave an operator
         * searching for an add-on the site advertises and finding nothing,
         * with no way to learn that the answer is "upgrade Adminium". Saying
         * which version it needs turns a mystery into a decision — the app
         * shelf's ruling, applied to the same question.
         */
        function blockedBy(
          entry: { version: string; minAdminiumVersion: string },
        ): { version: string; minAdminiumVersion: string } | null {
          return meetsMinimum(entry.minAdminiumVersion, serverVersion)
            ? null
            : { version: entry.version, minAdminiumVersion: entry.minAdminiumVersion };
        }

        // Everything on disk first: it needs no network to be true.
        for (const [key, version] of staged) {
          let name = key;
          let described: string | null = null;
          let categories: string[] = [];
          let connectKind: 'none' | 'api-key' | 'oauth2' = 'none';
          try {
            const document = JSON.parse(
              (await deps.store.readFile(key, version, 'manifest.json')).toString('utf8'),
            ) as {
              name?: string;
              // `i18nMessageSchema` — a catalog key plus its English fallback.
              // The server renders no bundles, so the fallback is what it has.
              description?: { fallback?: string };
              categories?: string[];
              addOn?: { connect?: { kind?: 'none' | 'api-key' | 'oauth2' } };
            };
            name = document.name ?? key;
            described = document.description?.fallback ?? null;
            categories = document.categories ?? [];
            connectKind = document.addOn?.connect?.kind ?? 'none';
          } catch {
            // A staged tree we cannot read a name out of is still worth listing
            // by key — hiding it would leave bytes on disk nothing accounts for.
          }
          const current = installed.get(key);
          const listed = feed.get(key);
          const row = {
            key,
            name,
            version: current ?? version,
            source: 'bundled' as const,
            state: (current === undefined ? 'staged' : 'installed') as 'staged' | 'installed',
            upgradeTo:
              current !== undefined && compareSemver(version, current) > 0 ? version : null,
            // Filled by the feed pass below, which is the only thing that
            // knows a version this server cannot take. A package already on
            // disk got here through a download or an upload, and both of
            // those refuse a floor above this server.
            needsNewerAdminium: null,
            // D3's order: the feed's localized line, else this tree's own.
            tagline: pickLocalized(listed?.tagline, locale) ?? described,
            categories: categories.length > 0 ? categories : (listed?.categories ?? []),
            connectKind,
          };
          entries.push(row);
          rows.set(key, row);
        }

        // Then anything the last refresh offered that is not already accounted
        // for. `source: 'catalog'` is the honest label: these need the network.
        for (const entry of feed.values()) {
          const blocked = blockedBy(entry);
          const existing = rows.get(entry.key);
          if (existing === undefined) {
            const current = installed.get(entry.key);
            // A newer release, offered only when this server can take it.
            // `upgradeTo` is what the Upgrade button acts on, so pointing it
            // at a version the download route refuses would be an action that
            // cannot succeed; the refusal goes in `needsNewerAdminium`, which
            // is a sentence rather than a button.
            const newer = current !== undefined && compareSemver(entry.version, current) > 0;
            entries.push({
              key: entry.key,
              // This used to read `entry.name['en_US']` — a key the feed
              // has never carried — so every row here was labelled with its own
              // slug. `pickLocalized` reaches `en` for six locales and `zh-cn`
              // / `zh-tw` for the other two.
              name: pickLocalized(entry.name, locale) ?? entry.key,
              version: current ?? entry.version,
              source: 'catalog',
              state: current === undefined ? 'available' : 'installed',
              upgradeTo: newer && blocked === null ? entry.version : null,
              // For a row with nothing installed the blocked release IS the
              // row; for an installed one it is the upgrade it cannot take.
              needsNewerAdminium: current === undefined || newer ? blocked : null,
              tagline: pickLocalized(entry.tagline, locale),
              categories: entry.categories,
              connectKind: entry.connect.kind,
            });
            continue;
          }
          // Already on disk, but the catalog may know a newer version.
          const current = installed.get(entry.key) ?? existing.version;
          if (compareSemver(entry.version, current) > 0) {
            if (blocked === null) existing.upgradeTo = entry.version;
            // A blocked release no newer than one already on disk and usable
            // is not news — the operator has a version to move to either way.
            else if (
              existing.upgradeTo === null ||
              compareSemver(entry.version, existing.upgradeTo) > 0
            ) {
              existing.needsNewerAdminium = blocked;
            }
          }
        }

        /*
         * INSTALLED, BUT NOT HERE. Both loops above start from bytes — what is
         * on disk, then what the last feed refresh cached — so an installed
         * add-on whose files a redeploy wiped reached this point either
         * labelled `installed` (if the feed happened to carry it) or not at all
         * (every uploaded add-on, and every install with no cached feed). The
         * meta store is the only witness that it was ever installed, so this
         * pass is the one that reads from it.
         */
        for (const [key, version] of installed) {
          if ((onDisk.get(key) ?? []).includes(version)) continue;
          const fromFeed = feed.get(key);
          const listed = rows.get(key) ?? entries.find((entry) => entry.key === key);
          if (listed !== undefined) {
            listed.state = 'missing';
            listed.version = version;
            // Nothing to upgrade TO when there is nothing here to upgrade.
            listed.upgradeTo = null;
            // Re-stated for what this row now is. Whatever the feed pass
            // decided was about an UPGRADE from a version that turns out not
            // to be here; the only question left is whether the release the
            // feed offers can be downloaded back at all.
            listed.needsNewerAdminium = fromFeed === undefined ? null : blockedBy(fromFeed);
            continue;
          }
          entries.push({
            key,
            name: pickLocalized(fromFeed?.name, locale) ?? key,
            version,
            source: fromFeed === undefined ? 'bundled' : 'catalog',
            state: 'missing',
            upgradeTo: null,
            // Re-acquiring is this row's only action, and it is a download —
            // so a feed row above this server's floor must say so here too,
            // or the button is one the download route will refuse.
            needsNewerAdminium: fromFeed === undefined ? null : blockedBy(fromFeed),
            tagline: pickLocalized(fromFeed?.tagline, locale),
            categories: fromFeed?.categories ?? [],
            connectKind: fromFeed?.connect.kind ?? 'none',
          });
        }

        entries.sort((a, b) => (a.key < b.key ? -1 : 1));
        return {
          addOns: entries,
          catalogFetchedAt: parsedCatalog?.success === true ? (cached?.fetchedAt ?? null) : null,
          onlineEnabled: (await deps.catalog?.isEnabled()) ?? false,
        };
      },
    );

    app.put(
      '/add-ons/catalog',
      {
        /*
         * `manifests.manage`, NOT `settings.manage` — the separation, in one route.
         *
         * This is a settings-registry boolean and every other one lives under
         * `/settings/*`, which is gated on `settings.manage`. Putting it there
         * would hand the switch that decides whether this deployment talks to a
         * package registry to everyone who can rename the workspace, and would
         * undo the un-reserving that wave did on purpose.
         */
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { body: catalogSettingsBody, response: { 200: catalogSettingsReply } },
      },
      async (request) => {
        const settings = settingsRepo(deps.meta);
        const before = (await settings.get(CATALOG_ENABLED_SETTING)) === true;
        const { enabled } = request.body;
        await settings.set(CATALOG_ENABLED_SETTING, enabled, {
          updatedBy: request.user?.id ?? null,
        });

        await auditRepo(deps.meta).append({
          actorKind: 'user',
          actorId: request.user?.id ?? null,
          actorLabel: request.user?.email ?? 'unknown',
          category: 'add-on',
          action: 'add-on.catalog-toggled',
          changes: { before: { onlineEnabled: before }, after: { onlineEnabled: enabled } },
        });

        /*
         * The EFFECTIVE state, which is not always what was asked for. An
         * environment veto outranks the stored setting, and the reply says so
         * rather than letting the page render a switch that silently disagrees
         * with what the server will actually do.
         */
        const allowed = deps.catalog?.networkFeaturesAllowed() ?? false;
        return { onlineEnabled: enabled && allowed, vetoed: enabled && !allowed };
      },
    );

    app.post(
      '/add-ons/catalog/refresh',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('worker') },
        schema: { response: { 200: refreshCatalogReply } },
      },
      async (request) => {
        // The typed refusal asks for. Checked HERE as well as inside the
        // job so an operator pressing the button gets an answer, rather than a
        // job that silently reports "disabled" into a log they are not reading.
        if (deps.catalog === undefined || !(await deps.catalog.isEnabled())) {
          throw new ValidationFailedError(
            'The online add-on catalog is off. The add-ons bundled with this build are ' +
              'available without it.',
            { code: 'CATALOG_DISABLED' },
          );
        }
        const job = await enqueueCatalogRefresh(deps.meta, {
          userId: request.user?.id ?? undefined,
        });
        return { jobId: job.id };
      },
    );

    app.post(
      '/add-ons/download',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('worker') },
        schema: { body: downloadAddOnBody, response: { 200: downloadAddOnReply } },
      },
      async (request) => {
        if (deps.catalog === undefined || !(await deps.catalog.isEnabled())) {
          throw new ValidationFailedError(
            'The online add-on catalog is off, so nothing can be downloaded. Upload the ' +
              'package instead, or switch the catalog on.',
            { code: 'CATALOG_DISABLED' },
          );
        }

        const { key, version } = request.body;
        /*
         * The cached row and the minimum it declares, checked before a job
         * exists, so the page is told at once instead of watching a job fail.
         * The job checks both again: the cache may be refreshed in between.
         */
        let entry;
        try {
          entry = await addOnEntryFromCache(deps.store, key, version);
        } catch (error) {
          if (error instanceof AddOnCatalogError) {
            throw new ValidationFailedError(error.message, { code: error.reason });
          }
          throw error;
        }
        if (!meetsMinimum(entry.minAdminiumVersion, serverVersion)) {
          throw new ValidationFailedError(
            `"${key}" ${version} needs Adminium ${entry.minAdminiumVersion} or later; this ` +
              `server is ${serverVersion}. Upgrade Adminium to install it.`,
            {
              code: 'REQUIRES_NEWER_ADMINIUM',
              minAdminiumVersion: entry.minAdminiumVersion,
              serverVersion,
            },
          );
        }

        // Enqueued through the repo, NEVER through `POST /jobs`: the kind is
        // internal-only because its integrity value comes from the cached
        // catalog, and a caller who could hand-craft the payload would be
        // choosing their own.
        const job = await enqueueAddOnDownload(deps.meta, {
          key,
          version,
          userId: request.user?.id ?? undefined,
        });
        return { jobId: job.id };
      },
    );

    app.post(
      '/add-ons/upload',
      {
        /*
         * `onRequest` AS WELL AS `preHandler`, and the phase is the point.
         *
         * Fastify parses the body BEFORE `preValidation` and `preHandler`, so
         * `manifests.manage` below — and the global CSRF check — both run with
         * up to 32 MB already buffered from a caller nobody has authenticated.
         * `onRequest` fires before the parser, so an anonymous request is
         * refused at the headers rather than after the bytes.
         *
         * It does not replace the RBAC guard: this one only asks whether there
         * is a session, and installing an add-on needs a good deal more than
         * that. It is the cheap half, in the only phase where cheap is
         * available.
         */
        onRequest: app.requireAuth,
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        bodyLimit: UPLOAD_BODY_LIMIT,
        schema: { querystring: uploadAddOnQuery, response: { 200: stagedPackageReply } },
      },
      async (request) => {
        // D4: sideload is a first-class source, not an escape hatch. It runs
        // the IDENTICAL verify-then-hardened-unpack path as a download — one
        // code path for bundled, downloaded and uploaded packages — so an
        // air-gapped operator gets the same guarantees, not a softer set.
        const body = request.body;
        if (!Buffer.isBuffer(body) || body.byteLength === 0) {
          throw new ValidationFailedError(
            'Send the package as a raw `application/octet-stream` body — the add-on’s .tgz, ' +
              'as downloaded from https://downloads.adminium.dev.',
          );
        }
        const { key, version, expectedSha512 } = request.query;
        const { staged, name } = await stageUpload(
          { key, version },
          new Uint8Array(body),
          expectedSha512,
          request.user?.id ?? null,
          request.user?.email ?? 'unknown',
        );
        /*
         * The INSTALLED version, uploaded again, is how an operator puts back
         * files the data directory lost (a redeploy on a host with no disk).
         * The files are served again at once; a server half only loads on a
         * rebuild, so rebuild here rather than leave it off until something
         * unrelated triggers one.
         */
        const installed = await manifests.findByKey(staged.key);
        if (installed !== null && installed.row.version === staged.version) {
          await deps.rebuildRuntime?.();
        }
        return {
          key: staged.key,
          version: staged.version,
          name,
          files: Object.keys(staged.tree.files).length,
          integrity: staged.tree.integrity,
        };
      },
    );

    app.delete(
      '/add-ons/staged/:key/:version',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: stagedParams, response: { 200: discardStagedReply } },
      },
      async (request) => {
        const { key, version } = request.params;
        // Declining to install must not be a dead end: downloaded bytes
        // an operator decided against should be removable without installing
        // them first. Refusing to discard an INSTALLED version is the one
        // guard — that path is uninstall, which has different consequences and
        // a different confirm.
        const installed = await manifests.findByKey(key);
        if (installed !== null && installed.row.version === version) {
          throw new ConflictError(
            `"${key}@${version}" is installed, not merely staged. Uninstall it instead.`,
          );
        }
        await deps.store.removeVersion(key, version);
        await auditRepo(deps.meta).append({
          actorKind: 'user',
          actorId: request.user?.id ?? null,
          actorLabel: request.user?.email ?? 'unknown',
          category: 'add-on',
          action: 'add-on.deleted',
          changes: { after: { key, version, staged: true } },
        });
        return { key, version, discarded: true };
      },
    );

    app.post(
      '/add-ons/:key/upgrade',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: addOnKeyParams, response: { 200: upgradeAddOnReply } },
      },
      async (request) => {
        // Re-validate, re-check `attaches`, re-hash. An upgrade is NOT a
        // reinstall — the hosts it is mounted on and the credential it was
        // given both survive it, which is why it is a version bump on the
        // existing row rather than an uninstall/install pair. The body is the
        // installer's, shared with an app install's "update it too".
        const { installed, from, to, pruned } = await upgradeAddOn(installer, {
          key: request.params.key,
          actor: actorOf(request),
        });
        return { addOn: await toDto(installed), from, to, pruned };
      },
    );

    app.get(
      '/add-ons',
      {
        /*
         * AUTHENTICATED, not `manifests.manage` — this is the list a HOST reads
         * on every page load, and it carries no secret.
         *
         * [The guard was MISSING until 2026-08-31, found by the round trip on
         * its first real run.] The comment that stood here said "Authenticated"
         * and no `preHandler` said so, and nothing caught it: `compose.ts` has
         * no ambient auth hook — every route in this server guards itself — so
         * a docblock was the entire control. Anonymous, the reply named every
         * installed add-on, its version, WHETHER IT IS CONNECTED, the exact
         * hosts each one may contact, and the URL of every bundle. That is a
         * map of an operator's integrations handed to anyone who asked, and it
         * is exactly the class of defect D6 says a green suite cannot find.
         */
        preHandler: app.requireAuth,
        schema: { response: { 200: addOnListReply } },
      },
      async (request) => {
        /*
         * WHO USES WHAT is for those who manage add-ons: this list is read by
         * every signed-in person (a host reads it on each page load), and the
         * apps an instance runs, with their status, are not theirs to map.
         * Everyone else gets an empty list. One read of every app's needs for
         * the whole list, not one per row.
         */
        const mayManage = typeof request.can !== 'function' || (await request.can(PERMISSIONS.manifestsManage));
        const needs = mayManage ? await needsByAddOn(deps.meta) : new Map<string, AppNeed[]>();
        return {
          addOns: await Promise.all(
            (await manifests.list('add-on')).map((installed) => toDto(installed, needs.get(installed.row.manifestKey) ?? [])),
          ),
        };
      },
    );

    app.get(
      '/add-ons/:key/plan',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { params: addOnKeyParams, response: { 200: installPlanReply } },
      },
      async (request) => {
        // The consent dialog's document, computed from the staged package
        // BEFORE anything is installed — which is the whole point of a plan.
        const versions = await deps.store.versions(request.params.key);
        const version = versions[0];
        if (version === undefined) {
          throw new NotFoundError(
            `No package for "${request.params.key}" is staged on this instance.`,
          );
        }
        const { manifest, warnings } = await addOnManifestFromStore(installer, request.params.key, version);
        return { plan: (await planAddOn(installer, manifest, { attachTo: [], warnings })).dto };
      },
    );

    app.post(
      '/add-ons',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { body: installAddOnBody, response: { 200: installAddOnReply } },
      },
      async (request) => {
        const { key, version, attachTo } = request.body;
        /*
         * The shared install: verify, check the hosts it is mounted on
         * (declared, in range, its scopes within their tables), plan, create
         * its tables, then the meta row — the same body an app install runs
         * for the add-ons it needs. An add-on with pages is mounted on the
         * dashboard as well, or its page would reach no rail.
         */
        const { installed, plan } = await installAddOn(installer, {
          key,
          version,
          attachTo,
          actor: actorOf(request),
        });
        await makeAppDocuments(request, attachTo);
        return { addOn: await toDto(installed), plan };
      },
    );

    app.post(
      '/add-ons/:key/attachments',
      {
        /*
         * `manifests.manage`, like install: mounting an add-on on another host
         * runs its code against that host's data.
         */
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: addOnKeyParams, body: attachAddOnBody, response: { 200: attachAddOnReply } },
      },
      async (request) => {
        const { installed, change } = await attachAddOn(installer, {
          key: request.params.key,
          host: request.body.app,
          actor: actorOf(request),
        });
        await makeAppDocuments(request, [request.body.app]);
        return { addOn: await toDto(installed), change };
      },
    );

    app.get(
      '/add-ons/:key/bundle/*',
      {
        // Inside `/api/v1`, DELIBERATELY — writes the path as
        // `/add-ons/<key>/client.js`, outside the API namespace. Everything
        // outside `/api/` in this server is invisible to all three route
        // ratchets (schema, audit coverage, OpenAPI) and inherits no rate
        // limiting. Since the URL is SERVED in the list reply rather than
        // hardcoded by a host, its shape is free — so it goes where the
        // guarantees are. The `*` wildcard carries the nested path
        // (`dist/client.js`), which a `:file` param cannot hold.
        //
        // [Corrected 2026-08-31.] What stood here said being inside `/api/`
        // meant inheriting "the auth hook". THERE IS NO SUCH HOOK — every route
        // in this server guards itself — so this one served an add-on's client
        // bundle to anybody who asked. A browser sends cookies with a
        // same-origin module request, so the guard costs a connected host
        // nothing: hosted mode is the only mode that reads this, and it has a
        // session by construction.
        preHandler: app.requireAuth,
        schema: { params: addOnBundleParams },
      },
      async (request, reply) => {
        const { key } = request.params;
        const file = request.params['*'];

        const installed = await manifests.findByKey(key);
        if (installed === null) throw new NotFoundError(`"${key}" is not installed.`);
        const manifest = parseManifest(installed.document, key);

        // The path must be one the MANIFEST declares, not merely one that
        // exists in the package. Checked before the store sees it, so a request
        // for `package.json` or a stray file is a 404 rather than a served
        // byte — the store's containment check is the second line, not the
        // first.
        if (!bundlePathsOf(manifest.addOn).includes(file)) {
          throw new NotFoundError(`"${key}" does not ship a bundle at "${file}".`);
        }

        let bytes: Buffer;
        let sha256: string;
        try {
          // "Checked on read": the bytes are re-hashed against the pin
          // recorded at unpack, so a package edited on the data volume after
          // install is refused rather than served into a host page.
          ({ bytes, sha256 } = await deps.store.readVerifiedFile(
            key,
            installed.row.version,
            file,
          ));
        } catch {
          throw new ValidationFailedError(
            `The installed bundle for "${key}" no longer matches the bytes that were verified ` +
              'when it was installed, so it will not be served.',
          );
        }

        return reply
          .header('content-type', 'text/javascript; charset=utf-8')
          .header('x-adminium-integrity', sriFor(sha256))
          // Immutable: the URL carries no version, but the bytes are pinned to
          // the installed version's hash and an upgrade changes the integrity
          // the host is told to pin — so a stale cache fails the pin rather
          // than silently serving the old half of a half-upgraded add-on.
          .header('cache-control', 'no-cache')
          .send(bytes);
      },
    );

    app.post(
      '/add-ons/:key/connect',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: {
          params: addOnKeyParams,
          body: connectAddOnBody,
          response: { 200: connectAddOnReply },
        },
      },
      async (request) => {
        const { key } = request.params;
        const installed = await manifests.findByKey(key);
        if (installed === null) throw new NotFoundError(`"${key}" is not installed.`);
        const manifest = parseManifest(installed.document, key);
        const kind = manifest.addOn.connect.kind;

        if (kind === 'none') {
          // Not an error the caller can fix by sending different values, so it
          // says what IS true rather than what is missing.
          throw new ValidationFailedError(
            `"${key}" needs no connection — it declares connect kind "none" and works as soon ` +
              'as it is enabled.',
          );
        }
        if (kind === 'oauth2') {
          throw new ValidationFailedError(
            `"${key}" connects over OAuth. Start the flow at ` +
              `POST /add-ons/${key}/connect/oauth/start instead.`,
            { connectKind: kind },
          );
        }

        // The manifest decides which fields a credential has. Anything else is
        // refused rather than stored: a credential store that accepts whatever
        // it is sent is one nobody can audit, and a typo'd key would otherwise
        // sit there forever looking like a configured secret.
        const secretKeys = (manifest.settings ?? [])
          .filter((setting) => setting.secret === true)
          .map((setting) => setting.key);
        const supplied = Object.keys(request.body.credentials);
        const unknown = supplied.filter((name) => !secretKeys.includes(name));
        const missing = secretKeys.filter((name) => !supplied.includes(name));
        if (unknown.length > 0 || missing.length > 0) {
          throw new ValidationFailedError(
            `The credentials for "${key}" do not match what its manifest declares.`,
            { expected: secretKeys, unknown, missing },
          );
        }

        await manifests.setCredential(installed.row.id, {
          kind: 'api-key',
          secret: request.body.credentials,
        });

        await auditRepo(deps.meta).append({
          actorKind: 'user',
          actorId: request.user?.id ?? null,
          actorLabel: request.user?.email ?? 'unknown',
          category: 'add-on',
          action: 'add-on.connected',
          // The FIELD NAMES, never the values — this row exists to say a
          // connection was made, not to record the secret a second time in a
          // table with different retention.
          changes: { after: { key, connectKind: kind, fields: secretKeys } },
        });

        const after = await manifests.findByKey(key);
        return { addOn: await toDto(after!) };
      },
    );

    app.post(
      '/add-ons/:key/connect/oauth/start',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: {
          params: addOnKeyParams,
          body: startOAuthBody,
          response: { 200: startOAuthReply },
        },
      },
      async (request) => {
        const { key } = request.params;
        const { manifest } = await oauthContextFor(key);
        let authorizeUrl: string;
        let state: string;
        try {
          ({ authorizeUrl, state } = oauthFlows.start({
            addOnKey: key,
            connect: connectOf(manifest),
            allow: manifest.addOn.network?.allow ?? [],
            clientId: request.body.clientId,
            clientSecret: request.body.clientSecret,
            redirectUri: request.body.redirectUri,
          }));
        } catch (error) {
          asOAuthRefusal(error);
        }

        await auditRepo(deps.meta).append({
          actorKind: 'user',
          actorId: request.user?.id ?? null,
          actorLabel: request.user?.email ?? 'unknown',
          category: 'add-on',
          action: 'add-on.oauth-started',
          // The client ID identifies the registration and is not a secret; the
          // SECRET is never written to a row, here or anywhere.
          changes: { after: { key, clientId: request.body.clientId } },
        });

        return { authorizeUrl, state };
      },
    );

    app.post(
      '/add-ons/:key/connect/oauth/complete',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: {
          params: addOnKeyParams,
          body: completeOAuthBody,
          response: { 200: connectAddOnReply },
        },
      },
      async (request) => {
        const { key } = request.params;
        const { installed, manifest } = await oauthContextFor(key);

        // Single-use: taking the flow removes it, so a replayed code is inert.
        const flow = oauthFlows.take(request.body.state);
        if (flow === null || flow.addOnKey !== key) {
          throw new ValidationFailedError(
            'That authorization has expired or does not belong to this add-on. Start again.',
            { code: 'UNKNOWN_STATE' },
          );
        }

        const result = await exchangeAuthorizationCode({
          // The SAME guarded client an add-on's own calls use, so the token
          // endpoint is held to one allow-list enforced in one place.
          http: addOnHttpClientFor(deps.meta, manifest),
          connect: connectOf(manifest),
          allow: manifest.addOn.network?.allow ?? [],
          addOnKey: key,
          flow,
          code: request.body.code,
        }).catch(asOAuthRefusal);

        await manifests.setCredential(installed.row.id, {
          kind: 'oauth2',
          secret: result.envelope,
          expiresAt: result.expiresAt,
          scopes: result.scopes,
        });

        await auditRepo(deps.meta).append({
          actorKind: 'user',
          actorId: request.user?.id ?? null,
          actorLabel: request.user?.email ?? 'unknown',
          category: 'add-on',
          action: 'add-on.connected',
          changes: {
            after: { key, connectKind: 'oauth2', scopes: result.scopes, expiresAt: result.expiresAt },
          },
        });

        const after = await manifests.findByKey(key);
        return { addOn: await toDto(after!) };
      },
    );

    app.delete(
      '/add-ons/:key/connect',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: addOnKeyParams, response: { 200: disconnectAddOnReply } },
      },
      async (request) => {
        const { key } = request.params;
        const installed = await manifests.findByKey(key);
        if (installed === null) throw new NotFoundError(`"${key}" is not installed.`);

        // And the whole of it: ONE delete, against a table that holds only
        // secrets. Nothing here touches the data source, the manifest row or
        // its attachments — which is what makes "disconnecting keeps your data"
        // a property of the code rather than of a promise.
        const credentialsDeleted = await manifests.deleteCredential(installed.row.id);

        await auditRepo(deps.meta).append({
          actorKind: 'user',
          actorId: request.user?.id ?? null,
          actorLabel: request.user?.email ?? 'unknown',
          category: 'add-on',
          action: 'add-on.disconnected',
          changes: { after: { key, credentialsDeleted, tablesKept: true } },
        });

        return { key, credentialsDeleted, tablesKept: true };
      },
    );

    app.patch(
      '/add-ons/:key',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: {
          params: addOnKeyParams,
          body: patchAddOnBody,
          response: { 200: patchAddOnReply },
        },
      },
      async (request) => {
        const installed = await manifests.findByKey(request.params.key);
        if (installed === null) throw new NotFoundError(`"${request.params.key}" is not installed.`);

        /*
         * SWITCHED OFF UNDER AN APP THAT REQUIRES IT — refused, for that app's
         * attachment only: every other app's switch stays free. A switched-off
         * app still holds its requirement; only uninstalling it releases it.
         */
        const host = request.body.attachedTo;
        const needs = (await needsOf(deps.meta, request.params.key)).filter((need) => need.app === host);
        if (!request.body.enabled) {
          const requiring = needs.filter((need) => need.need === 'requires');
          if (requiring.length > 0) throw requiredByError(request.params.key, requiring, 'switched off');
        }

        const changed = await manifests.setAttachmentEnabled(
          installed.row.id,
          request.body.attachedTo,
          request.body.enabled,
        );
        if (!changed) {
          throw new NotFoundError(
            `"${request.params.key}" is not attached to "${request.body.attachedTo}".`,
          );
        }

        await auditRepo(deps.meta).append({
          actorKind: 'user',
          actorId: request.user?.id ?? null,
          actorLabel: request.user?.email ?? 'unknown',
          category: 'add-on',
          action: request.body.enabled ? 'add-on.enabled' : 'add-on.disabled',
          changes: {
            after: { key: request.params.key, attachedTo: request.body.attachedTo },
          },
        });

        // Enable/disable changes which providers resolve, so the runtime is
        // rebuilt here too — an add-on switched off must stop rendering
        // immediately, not at the next restart.
        await deps.rebuildRuntime?.();
        // Switched back on: the app's documents it draws, if the app was
        // installed while it was off. Switched off, they stay and are off.
        if (request.body.enabled) await makeAppDocuments(request, [request.body.attachedTo]);

        const after = await manifests.findByKey(request.params.key);
        const features = request.body.enabled ? [] : needs.filter((need) => need.need === 'feature');
        return { addOn: await toDto(after!), ...(features.length === 0 ? {} : { features: needsDto(features) }) };
      },
    );

    /*
     * THE SETTINGS, AND NOTHING ELSE. `manifests.manage` also installs,
     * upgrades and removes add-ons — code that runs in this process — so a
     * person who only keeps an add-on's letterhead up to date holds the
     * per-add-on grant `addOn:<key>:settings` instead (an app role may carry
     * it). Checked for THIS key: the grant for one add-on edits no other —
     * and an app role's grant counts only while that app has the add-on
     * connected and switched on (see `rbac/add-on-grant.ts`).
     */
    const manifestsGuard = app.rbac.require(PERMISSIONS.manifestsManage);
    async function settingsGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
      const { key } = request.params as { key: string };
      if (typeof request.can === 'function' && (await request.can(PERMISSIONS.manifestsManage))) return;
      const principal = getPrincipal(request);
      if (principal !== null && (await addOnSettingsGrantHeld(deps.meta, principal, key))) return;
      await manifestsGuard(request, reply);
    }

    app.put(
      '/add-ons/:key/settings',
      {
        preHandler: [app.requireAuth, settingsGuard],
        config: { audit: audited('rbac') },
        schema: {
          params: addOnKeyParams,
          body: addOnSettingsBody,
          response: { 200: addOnSettingsReply },
        },
      },
      async (request) => {
        /*
         * THE NON-SECRET HALF. A credential goes through CONNECT, into the
         * encrypted table; this writes the values an add-on's settings panel
         * edits and a renderer reads back in clear.
         *
         * The repo refuses a key the manifest marks `secret`, which is the
         * enforcement point — not this route. There is more than one writer
         * (this PUT, the installer's defaults, a future import), and a rule
         * enforced at one door is a rule with three doors.
         */
        const { key } = request.params;
        const installed = await manifests.findByKey(key);
        if (installed === null) throw new NotFoundError(`"${key}" is not installed.`);
        const manifest = parseManifest(installed.document, installed.row.manifestKey);

        /*
         * EVERY VALUE AGAINST ITS DECLARATION, whoever saves it: text is text,
         * an enum one of its values, a number in its bounds, nothing too large,
         * and no key the add-on does not declare. These values are shared by
         * every app the add-on serves, and read by renderers and browsers.
         * A secret key is left to the repo, which refuses it by name.
         */
        const secrets = new Set((manifest.settings ?? []).filter((setting) => setting.secret === true).map((setting) => setting.key));
        const issues = settingValueIssues(
          manifest.settings ?? [],
          Object.fromEntries(Object.entries(request.body.values).filter(([name]) => !secrets.has(name))),
          { unknown: 'refuse' },
        );
        if (issues.length > 0) {
          throw new ValidationFailedError(issues.map((issue) => issue.message).join(' '), {
            code: 'SETTING_INVALID',
            issues,
          });
        }

        let saved;
        try {
          saved = await addOnSettingsRepo(deps.meta).patch(
            key,
            request.body.values,
            (manifest.settings ?? []).map((setting) => ({
              key: setting.key,
              secret: setting.secret ?? false,
            })),
            { updatedBy: request.user?.id ?? null },
          );
        } catch (error) {
          if (error instanceof SecretSettingRefused) {
            throw new ValidationFailedError(
              `These settings are a credential and are set by connecting, not here: ${error.keys.join(', ')}.`,
              { code: 'SECRET_SETTING_REFUSED', keys: error.keys },
            );
          }
          throw error;
        }

        await auditRepo(deps.meta).append({
          actorKind: 'user',
          actorId: request.user?.id ?? null,
          actorLabel: request.user?.email ?? 'unknown',
          category: 'add-on',
          action: 'add-on.settings-changed',
          // The KEYS that moved, never the values: a settings row can hold a
          // letterhead, an address, a customer-facing sentence.
          changes: { after: { key, keys: Object.keys(request.body.values) } },
        });

        return { key, values: saved.values, updatedAt: saved.updatedAt };
      },
    );

    app.delete(
      '/add-ons/:key',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        config: { audit: audited('rbac') },
        schema: { params: addOnKeyParams, response: { 200: uninstallAddOnReply } },
      },
      async (request) => {
        const { key } = request.params;
        const installed = await manifests.findByKey(key);
        if (installed === null) throw new NotFoundError(`"${key}" is not installed.`);

        /*
         * NOT FROM UNDER AN APP THAT REQUIRES IT. Every app row counts —
         * switched off, or an install that stopped part way — because each
         * will look for it again. An app that only uses it for a feature does
         * not stop the removal; the reply names the features that stop.
         */
        const needs = await needsOf(deps.meta, key);
        const requiring = needs.filter((need) => need.need === 'requires');
        if (requiring.length > 0) throw requiredByError(key, requiring, 'removed');
        const features = needs.filter((need) => need.need === 'feature');

        // In the order that makes the promise true: the meta rows go
        // (credentials with them, by cascade), and NOTHING touches the data
        // source. Tables the add-on brought stay, with their rows.
        /*
         * The half, BEFORE the manifest row goes.
         *
         * Disables this add-on's document profiles and drops its settings.
         * The ORDER is the point: a profile disabled after the manifest row
         * had already gone would leave a window in which a write could enqueue
         * a render for a provider that no longer exists. Documents and
         * profiles themselves survive — keeps the customer's data, and a
         * mapping is work an operator did.
         */
        await deps.onAddOnRemoved?.(key);

        await manifests.uninstall(installed.row.id);

        // The package directory is store hook. Deliberately after the
        // meta delete: a failure here leaves bytes on disk, which is a tidiness
        // problem, whereas the reverse order could leave an installed add-on
        // whose code is gone.
        let packageRemoved = true;
        try {
          await deps.store.removeKey(key);
        } catch {
          packageRemoved = false;
        }

        await auditRepo(deps.meta).append({
          actorKind: 'user',
          actorId: request.user?.id ?? null,
          actorLabel: request.user?.email ?? 'unknown',
          category: 'add-on',
          action: 'add-on.uninstalled',
          changes: {
            after: { key, version: installed.row.version, packageRemoved, tablesKept: true },
          },
        });

        // The runtime is rebuilt WHOLE, never patched: a partially
        // updated provider map is worse than a stale one, because a stale one
        // is at least consistent with itself.
        await deps.rebuildRuntime?.();

        return { key, tablesKept: true, packageRemoved, ...(features.length === 0 ? {} : { features: needsDto(features) }) };
      },
    );
  };
}
