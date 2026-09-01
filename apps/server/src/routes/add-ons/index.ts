// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/api/v1/add-ons` — install, list, enable/disable and uninstall
 * (26-add-on-runtime.md §5.1, 26-T06; audit rows per 26-T16).
 *
 * ─── This is what un-reserved `manifests.manage` ───────────────────────────
 *
 * `RESERVED_SYSTEM_ACTION_KEYS`'s own docblock says to move a key out of the
 * reserved list "in the same change that lands its first enforcement point".
 * These routes are that point (26 D3). Deliberately NOT `settings.manage`,
 * which 08 §2.19 originally specified: installing an add-on runs its server
 * half in this process, and that is not the same authority as changing a
 * workspace setting.
 *
 * `GET` is the exception and is only `authenticated` — it is the list a HOST
 * reads on every page load in connected mode (§6), so gating it behind an
 * admin permission would mean no ordinary user could see an add-on's surface.
 * It carries no secret to make that safe (see `schema.ts`).
 *
 * AUTHENTICATED IS NOT NOTHING, and for a fortnight it was: neither `GET` route
 * carried a `preHandler` at all, and this server has no ambient auth hook — a
 * route that names no guard has none. Found by the 26-T15 round trip; the two
 * routes now say `app.requireAuth` where they previously only said so in prose.
 * `add-on-routes.test.ts` asserts every route's guard from the live route table
 * rather than from a list, so a route added without one fails there.
 *
 * ─── Install takes a staged package, never a manifest body ─────────────────
 *
 * 32-add-on-distribution.md §4.3 amends §5.1's `POST` to take a
 * `{ key, version }` reference into the on-disk store. The bytes are already
 * verified against the hash the npm packument and the release ledger agreed
 * on, and the tree is RE-VERIFIED here against its unpack-time pin before a
 * single byte is parsed — the data volume is shared, writable state, so
 * install never re-trusts bare disk bytes. A route that accepted a manifest
 * document would be a route that installs code nobody checked.
 *
 * ─── The DDL runs BEFORE the meta row is written ───────────────────────────
 *
 * `applyInstall` (26-T02) creates the tables a plan says to create, through
 * `deps.schemaTarget`. The ordering is deliberate and is the shape MySQL's lack
 * of transactional DDL leaves available: a multi-table install cannot be one
 * transaction, so the tables go first and the manifest row goes last. A failure
 * halfway leaves real tables and nothing registered — and every create is
 * `IF NOT EXISTS`, so retrying completes the install rather than colliding with
 * it. The reverse order would leave an add-on registered against tables that
 * are not there.
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
  planInstall,
  validateManifest,
  type AddOnManifest,
  type InstallPlan,
} from '@adminium/manifest';
import {
  auditRepo,
  manifestsRepo,
  settingsRepo,
  type InstalledManifest,
  type MetaDb,
} from '@adminium/meta';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import {
  CATALOG_ENABLED_SETTING,
  catalogSchema,
  type CatalogClient,
} from '../../add-ons/catalog.js';
import { addOnHttpClientFor } from '../../add-ons/egress.js';
import {
  AddOnOAuthError,
  createOAuthFlowStore,
  exchangeAuthorizationCode,
  type OAuthConnect,
  type OAuthFlowStore,
} from '../../add-ons/oauth.js';
import type { AddOnSchemaTarget } from '../../add-ons/schema-target.js';
import type { AddOnStore } from '../../add-ons/store.js';
import {
  enqueueAddOnDownload,
  enqueueCatalogRefresh,
} from '../../jobs/add-on-acquire.js';
import { audited } from '../../audit/coverage.js';
import { ConflictError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
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
  type InstallPlanDto,
} from './schema.js';

/** Sideload cap: the largest first-party dist is ~300 KB (32 D5's own sizing). */
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
}

/** The add-on block of a validated manifest, narrowed for reading. */
type AddOnBlock = AddOnManifest['addOn'];

/**
 * The FULL validator, not just the schema parse.
 *
 * `addOnManifestSchema.safeParse` checks the SHAPE. `validateManifest` adds the
 * policy layer, and two of its rules are the reason this wave exists:
 *
 *  - **The publisher gate** (24 D13 / 26 D4). `allowThirdPartyPublishers` stays
 *    off, so a manifest whose `publisher.id` is not `adminium` is refused. It is
 *    a policy control rather than a supply-chain one — the field is inside the
 *    package — but it is the control the rulings name, and a schema parse does
 *    not run it.
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
 * Turn an OAuth refusal into the 422 it always was.
 *
 * `AddOnOAuthError` is a plain `Error`, so an unmapped one reaches the §1.4
 * handler as `INTERNAL` and renders a 500. Every one of its six reasons is a
 * client-visible, actionable condition — a manifest that points its authorize
 * URL at a host it never declared, a state nobody started, a flow that expired,
 * a provider that answered without a token — and not one of them is a fault in
 * this server.
 *
 * [Found 2026-08-31 by the 26-T15 round trip, on `import-canva`.] A 500 is not
 * a cosmetic mis-labelling here: it tells an operator to look at their server
 * logs for a problem that is in an add-on's manifest, and it puts a real
 * refusal in the bucket monitoring pages.
 */
function asOAuthRefusal(error: unknown): never {
  if (error instanceof AddOnOAuthError) {
    throw new ValidationFailedError(error.message, { code: error.reason });
  }
  throw error;
}

export function addOnRoutes(deps: AddOnRoutesDeps): FastifyPluginAsyncZod {
  const manifests = manifestsRepo(deps.meta, deps.credentialCrypto);
  // One store per composed server: in memory, single-use, short-lived, bounded
  // (see `add-ons/oauth.ts` on why, and on the multi-process limitation).
  const oauthFlows: OAuthFlowStore = deps.oauthFlows ?? createOAuthFlowStore();

  /**
   * The SRI value a host pins a bundle to.
   *
   * Derived from the sha256 the store recorded at unpack rather than
   * recomputed: 26 §5.4 asks for a hash "recorded at install and checked on
   * read", and one hash used for both is the only shape where what a host pins
   * and what the server will serve cannot drift apart.
   */
  function sriFor(sha256Hex: string): string {
    return `sha256-${Buffer.from(sha256Hex, 'hex').toString('base64')}`;
  }

  /** Distinct client paths the manifest declares, in first-declared order. */
  function bundlePathsOf(block: AddOnBlock): string[] {
    return [...new Set((block.slots ?? []).map((slot) => slot.client))];
  }

  async function toDto(installed: InstalledManifest): Promise<AddOnDto> {
    const manifest = parseManifest(installed.document, installed.row.manifestKey);
    const block: AddOnBlock = manifest.addOn;
    // `credentialStatus` deliberately, not `getCredential`: a LIST must never
    // decrypt anything (24 D15).
    const credential = await manifests.credentialStatus(installed.row.id);
    return {
      key: manifest.key,
      name: manifest.name,
      version: installed.row.version,
      connectKind: block.connect.kind,
      connected: credential !== null,
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
       * signal §5.4 exists to raise, and it was arriving as an internal fault.
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
    };
  }

  /**
   * Runs the planner against whatever the data source currently has.
   *
   * Returns the plan BESIDE its DTO rather than only the DTO: `applyInstall`
   * takes the plan, and rebuilding one from the wire shape would be a second
   * place for the two to disagree about what is being created.
   */
  async function planFor(
    manifest: AddOnManifest,
    attachTo: readonly string[] = [],
  ): Promise<{ plan: InstallPlan; dto: InstallPlanDto }> {
    const tables = (await deps.schemaTarget?.read(attachTo)) ?? [];
    const plan = planInstall(manifest, { tables });
    const requiresSchemaChange =
      plan.create.length > 0 || plan.reuse.some((t) => t.missingColumns.length > 0);
    const dto: InstallPlanDto = {
      addOnKey: plan.addOnKey,
      version: plan.version,
      installable: plan.installable,
      touchesData: plan.touchesData,
      create: plan.create.map((t) => ({
        ref: t.ref,
        columns: t.columns.map((c) => ({ ref: c.ref, type: c.type })),
      })),
      reuse: plan.reuse.map((t) => ({ ref: t.ref, missingColumns: t.missingColumns })),
      references: plan.references,
      problems: plan.problems.map((p) => ({
        code: p.code,
        message: p.message,
        table: p.table,
        ...(p.column === undefined ? {} : { column: p.column }),
      })),
      requiresSchemaChange,
    };
    return { plan, dto };
  }

  /** Reads and re-verifies a staged package, then parses its manifest. */
  async function manifestFromStore(key: string, version: string): Promise<AddOnManifest> {
    try {
      // The TOCTOU close: the tree is checked against the per-file pin recorded
      // at unpack before anything reads it.
      await deps.store.verifyTree(key, version);
    } catch (error) {
      const reason = (error as { reason?: string }).reason ?? 'UNKNOWN';
      if (reason === 'TREE_MISSING') {
        throw new NotFoundError(
          `No verified package for "${key}@${version}" is staged on this instance. ` +
            'Download it from the catalog, or upload its tarball, before installing.',
        );
      }
      throw new ValidationFailedError(
        `The staged package for "${key}@${version}" no longer matches the bytes that were ` +
          'verified when it was downloaded, so it will not be installed.',
        { reason },
      );
    }
    const bytes = await deps.store.readFile(key, version, 'manifest.json');
    let document: unknown;
    try {
      document = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new ValidationFailedError(`The manifest in "${key}@${version}" is not readable JSON.`);
    }
    return parseManifest(document, key);
  }

  /** The connect block of an oauth2 manifest, narrowed. */
  function connectOf(manifest: AddOnManifest): OAuthConnect {
    const connect = manifest.addOn.connect;
    if (connect.authorizeUrl === undefined || connect.tokenUrl === undefined) {
      // The validator requires both on an `oauth2` connect (§5.6), so reaching
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

  /** Shared by the sideload and (later) any other byte source. */
  async function stageTarball(
    key: string,
    version: string,
    tarball: Uint8Array,
    expectedIntegrity: string,
    userId: string | null,
    userLabel: string,
  ) {
    try {
      const staged = await deps.store.stage({ key, version, tarball, expectedIntegrity });
      await auditRepo(deps.meta).append({
        actorKind: 'user',
        actorId: userId,
        actorLabel: userLabel,
        category: 'add-on',
        action: 'add-on.staged',
        changes: {
          after: {
            key,
            version,
            source: 'upload',
            integrity: staged.tree.integrity,
            files: Object.keys(staged.tree.files).length,
          },
        },
      });
      return staged;
    } catch (error) {
      const reason = (error as { reason?: string }).reason ?? 'UNKNOWN';
      await auditRepo(deps.meta).append({
        actorKind: 'user',
        actorId: userId,
        actorLabel: userLabel,
        category: 'add-on',
        action: reason === 'INTEGRITY_MISMATCH' ? 'add-on.verify-refused' : 'add-on.unpack-refused',
        changes: { after: { key, version, source: 'upload', reason, bytes: tarball.byteLength } },
      });
      throw new ValidationFailedError(
        `The uploaded package for "${key}@${version}" was refused.`,
        { reason },
      );
    }
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
      async () => {
        // NEVER fetches inline (§4.3). Browsing is a disk read: the bundled set
        // plus whatever the last refresh cached. That is what makes the page
        // work identically on an air-gapped install, and what stops a page load
        // from becoming an outbound call nobody asked for.
        const [installedList, stagedKeys, cached] = await Promise.all([
          manifests.list('add-on'),
          deps.store.keys(),
          deps.store.readCatalogCache(),
        ]);

        const installed = new Map(installedList.map((m) => [m.row.manifestKey, m.row.version]));
        const staged = new Map<string, string>();
        for (const key of stagedKeys) {
          const versions = await deps.store.versions(key);
          const newest = versions[0];
          if (newest !== undefined) staged.set(key, newest);
        }

        const rows = new Map<string, (typeof entries)[number]>();
        const entries: Array<{
          key: string;
          name: string;
          version: string;
          source: 'bundled' | 'catalog';
          state: 'installed' | 'staged' | 'available';
          upgradeTo: string | null;
        }> = [];

        // Everything on disk first: it needs no network to be true.
        for (const [key, version] of staged) {
          let name = key;
          try {
            const document = JSON.parse(
              (await deps.store.readFile(key, version, 'manifest.json')).toString('utf8'),
            ) as { name?: string };
            name = document.name ?? key;
          } catch {
            // A staged tree we cannot read a name out of is still worth listing
            // by key — hiding it would leave bytes on disk nothing accounts for.
          }
          const current = installed.get(key);
          const row = {
            key,
            name,
            version: current ?? version,
            source: 'bundled' as const,
            state: (current === undefined ? 'staged' : 'installed') as 'staged' | 'installed',
            upgradeTo:
              current !== undefined && compareSemver(version, current) > 0 ? version : null,
          };
          entries.push(row);
          rows.set(key, row);
        }

        // Then anything the last refresh offered that is not already accounted
        // for. `source: 'catalog'` is the honest label: these need the network.
        const parsedCatalog = cached === null ? null : catalogSchema.safeParse(cached.document);
        if (parsedCatalog?.success === true) {
          for (const entry of parsedCatalog.data.addOns) {
            const existing = rows.get(entry.key);
            if (existing === undefined) {
              const current = installed.get(entry.key);
              entries.push({
                key: entry.key,
                name: entry.name['en_US'] ?? entry.key,
                version: current ?? entry.version,
                source: 'catalog',
                state: current === undefined ? 'available' : 'installed',
                upgradeTo:
                  current !== undefined && compareSemver(entry.version, current) > 0
                    ? entry.version
                    : null,
              });
              continue;
            }
            // Already on disk, but the catalog may know a newer version.
            const current = installed.get(entry.key) ?? existing.version;
            if (compareSemver(entry.version, current) > 0) existing.upgradeTo = entry.version;
          }
        }

        entries.sort((a, b) => (a.key < b.key ? -1 : 1));
        return {
          addOns: entries,
          catalogFetchedAt: cached?.fetchedAt ?? null,
          onlineEnabled: (await deps.catalog?.isEnabled()) ?? false,
        };
      },
    );

    app.put(
      '/add-ons/catalog',
      {
        /*
         * `manifests.manage`, NOT `settings.manage` — 26 D3 in one route.
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
        // The typed refusal §4.3 asks for. Checked HERE as well as inside the
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
        // Enqueued through the repo, NEVER through `POST /jobs`: the kind is
        // internal-only because its integrity value comes from the cached
        // catalog, and a caller who could hand-craft the payload would be
        // choosing their own.
        const job = await enqueueAddOnDownload(deps.meta, {
          key: request.body.key,
          version: request.body.version,
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
        // code path for bundled, npm and upload — so an air-gapped operator
        // gets the same guarantees, not a softer set.
        const body = request.body;
        if (!Buffer.isBuffer(body) || body.byteLength === 0) {
          throw new ValidationFailedError(
            'Send the package as a raw `application/octet-stream` body — the .tgz that ' +
              '`npm pack @adminiumjs/add-on-<key>` produces.',
          );
        }
        const { key, version, expectedSha512 } = request.query;
        const staged = await stageTarball(
          key,
          version,
          new Uint8Array(body),
          expectedSha512,
          request.user?.id ?? null,
          request.user?.email ?? 'unknown',
        );
        return {
          key,
          version,
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
        // Declining to install must not be a dead end (§4.3): downloaded bytes
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
        // 26-T17: re-validate, re-check `attaches`, re-hash. An upgrade is NOT
        // a reinstall — the hosts it is mounted on and the credential it was
        // given both survive it, which is why it is a version bump on the
        // existing row rather than an uninstall/install pair.
        const { key } = request.params;
        const installed = await manifests.findByKey(key);
        if (installed === null) throw new NotFoundError(`"${key}" is not installed.`);

        const from = installed.row.version;
        const staged = (await deps.store.versions(key)).filter(
          (candidate) => compareSemver(candidate, from) > 0,
        );
        const to = staged[0];
        if (to === undefined) {
          throw new NotFoundError(
            `No newer version of "${key}" is staged. Download one first.`,
          );
        }

        // Re-hash, re-validate: the staged tree is checked against its
        // unpack-time pin and the manifest through the FULL validator, so an
        // upgrade cannot smuggle past the publisher gate what an install could
        // not.
        const manifest = await manifestFromStore(key, to);
        if (manifest.key !== key) {
          throw new ValidationFailedError(
            `The staged package declares key "${manifest.key}", not "${key}".`,
          );
        }

        // Re-check `attaches`: a new version may have DROPPED a host this
        // instance is currently mounted on, and upgrading into that would leave
        // an attachment the manifest no longer claims to support.
        const declared = new Set(manifest.addOn.attaches.map((a) => a.app));
        const orphaned = declared.has('*')
          ? []
          : installed.attachments.map((a) => a.attachedTo).filter((host) => !declared.has(host));
        if (orphaned.length > 0) {
          throw new ValidationFailedError(
            `"${key}" ${to} no longer attaches to ${orphaned.join(', ')}, which this instance ` +
              'has it mounted on.',
            { orphaned, declared: [...declared] },
          );
        }

        const { dto: upgradePlan } = await planFor(manifest, installed.attachments.map((a) => a.attachedTo));
        if (!upgradePlan.installable || upgradePlan.requiresSchemaChange) {
          throw new ValidationFailedError(
            `"${key}" ${to} cannot be applied to this instance.`,
            {
              problems: upgradePlan.problems,
              requiresSchemaChange: upgradePlan.requiresSchemaChange,
            },
          );
        }

        await manifests.setVersion(installed.row.id, { version: to, document: manifest });

        // D11: older directories are pruned only AFTER the upgrade verified,
        // so a failure anywhere above leaves the running version on disk.
        const pruned: string[] = [];
        for (const old of await deps.store.versions(key)) {
          if (compareSemver(old, to) >= 0) continue;
          await deps.store.removeVersion(key, old);
          pruned.push(old);
        }

        await auditRepo(deps.meta).append({
          actorKind: 'user',
          actorId: request.user?.id ?? null,
          actorLabel: request.user?.email ?? 'unknown',
          category: 'add-on',
          action: 'add-on.upgraded',
          changes: { after: { key, from, to, pruned } },
        });

        const after = await manifests.findByKey(key);
        return { addOn: await toDto(after!), from, to, pruned };
      },
    );

    app.get(
      '/add-ons',
      {
        /*
         * AUTHENTICATED, not `manifests.manage` — this is the list a HOST reads
         * on every page load (§6), and it carries no secret (24 D15).
         *
         * [The guard was MISSING until 2026-08-31, found by the 26-T15 round
         * trip on its first real run.] The comment that stood here said
         * "Authenticated" and no `preHandler` said so, and nothing caught it:
         * `compose.ts` has no ambient auth hook — every route in this server
         * guards itself — so a docblock was the entire control. Anonymous, the
         * reply named every installed add-on, its version, WHETHER IT IS
         * CONNECTED, the exact hosts each one may contact, and the URL of every
         * bundle. That is a map of an operator's integrations handed to anyone
         * who asked, and it is exactly the class of defect D6 says a green
         * suite cannot find.
         */
        preHandler: app.requireAuth,
        schema: { response: { 200: addOnListReply } },
      },
      async () => ({ addOns: await Promise.all((await manifests.list('add-on')).map(toDto)) }),
    );

    app.get(
      '/add-ons/:key/plan',
      {
        preHandler: app.rbac.require(PERMISSIONS.manifestsManage),
        schema: { params: addOnKeyParams, response: { 200: installPlanReply } },
      },
      async (request) => {
        // The consent dialog's document (§7), computed from the staged package
        // BEFORE anything is installed — which is the whole point of a plan.
        const versions = await deps.store.versions(request.params.key);
        const version = versions[0];
        if (version === undefined) {
          throw new NotFoundError(
            `No package for "${request.params.key}" is staged on this instance.`,
          );
        }
        return { plan: (await planFor(await manifestFromStore(request.params.key, version))).dto };
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

        if ((await manifests.findByKey(key)) !== null) {
          throw new ConflictError(
            `"${key}" is already installed. Uninstall it first, or upgrade it instead.`,
          );
        }

        const manifest = await manifestFromStore(key, version);

        // §5.1: check `attaches` against what the caller asked for. A manifest
        // declaring `app: '*'` attaches anywhere; otherwise the host must be
        // named. This is the gate that stops an add-on being mounted somewhere
        // its author never claimed it works.
        const declared = new Set(manifest.addOn.attaches.map((a) => a.app));
        const anywhere = declared.has('*');
        const refused = anywhere ? [] : attachTo.filter((host) => !declared.has(host));
        if (refused.length > 0) {
          throw new ValidationFailedError(
            `"${key}" does not declare that it attaches to ${refused.join(', ')}.`,
            { declared: [...declared], refused },
          );
        }

        const { plan: rawPlan, dto: plan } = await planFor(manifest, attachTo);
        if (!plan.installable) {
          throw new ValidationFailedError(
            `"${key}" cannot be installed on this instance.`,
            { problems: plan.problems },
          );
        }

        // A table that EXISTS but is missing columns the add-on needs is still
        // refused, and deliberately (26-T02): creating a table an add-on asked
        // for is one conversation, and altering one the operator already owns
        // is a different one that is theirs to have. The planner reports it as
        // a partial match, and the message names the columns rather than
        // offering to add them.
        const incomplete = plan.reuse.filter((t) => t.missingColumns.length > 0);
        if (incomplete.length > 0) {
          throw new ValidationFailedError(
            `"${key}" needs columns that tables in this database do not have. Adding columns to ` +
              'tables you already own is not something an install will do.',
            { code: 'ADD_ON_COLUMNS_REQUIRED', incomplete },
          );
        }

        // The DDL (26-T02). Runs BEFORE the meta row is written, so a failure
        // leaves nothing registered — and every create is `IF NOT EXISTS`, so
        // a retry after a partial failure completes the install rather than
        // colliding with it. That ordering is what MySQL's lack of
        // transactional DDL leaves available.
        let created: string[] = [];
        if (plan.create.length > 0) {
          if (deps.schemaTarget === undefined) {
            throw new ValidationFailedError(
              `"${key}" needs tables this instance cannot create, because no data source is ` +
                'wired into the add-on installer here.',
              { code: 'ADD_ON_DDL_REQUIRED', create: plan.create.map((t) => t.ref) },
            );
          }
          ({ created } = await deps.schemaTarget.apply(rawPlan, manifest, attachTo));
        }

        const installed = await manifests.install({
          manifestKey: key,
          version,
          kind: 'add-on',
          source: 'marketplace',
          document: manifest,
          installedBy: request.user?.id ?? null,
          attachTo,
        });

        await auditRepo(deps.meta).append({
          actorKind: 'user',
          actorId: request.user?.id ?? null,
          actorLabel: request.user?.email ?? 'unknown',
          category: 'add-on',
          action: 'add-on.installed',
          changes: {
            after: { key, version, attachTo, tables: plan.reuse.map((t) => t.ref), created },
          },
        });

        return { addOn: await toDto(installed), plan };
      },
    );

    app.get(
      '/add-ons/:key/bundle/*',
      {
        // Inside `/api/v1`, DELIBERATELY — 26 §5.4 writes the path as
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
          // §5.4's "checked on read": the bytes are re-hashed against the pin
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

        // 24 D16 / 26 D5, and the whole of it: ONE delete, against a table that
        // holds only secrets. Nothing here touches the data source, the
        // manifest row or its attachments — which is what makes "disconnecting
        // keeps your data" a property of the code rather than of a promise.
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

        const after = await manifests.findByKey(request.params.key);
        return { addOn: await toDto(after!) };
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

        // 24 D16 / 26 D5, in the order that makes the promise true: the meta
        // rows go (credentials with them, by cascade), and NOTHING touches the
        // data source. Tables the add-on brought stay, with their rows.
        await manifests.uninstall(installed.row.id);

        // The package directory is 32 D11's store hook. Deliberately after the
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

        return { key, tablesKept: true, packageRemoved };
      },
    );
  };
}
