// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Managing hosted app surfaces (server half): what this instance serves, where
 * each staff surface appears, and which hosts are attached to which surface,
 * or to the add-on pages a stranger sees (`/x/…`, with a home page `/` sends
 * a visitor to). The editor saves both kinds of host as one map; they are
 * stored apart (`surfaces.domains`, `surfaces.pageHosts`) so everything that
 * reads an app's hosts reads what it always did.
 *
 * Behind `system:settings:manage` — placement and domain attachment are
 * instance configuration, not key management (which stays with
 * `system:api-keys:manage` in `routes/public-admin`).
 *
 * ── WRITES INVALIDATE THE SHARED CACHE ─────────────────────────────────────
 * Host routing consults `surfaces.domains` on every request through the cache
 * decorated by `plugins/surfaces.ts`; `/bootstrap` reads placements through
 * the same instance. Writing here without invalidating THAT cache would make
 * a save appear broken for a TTL and invite a second click — the same lesson
 * `publicApi.enabled` already carries. Other server processes still converge
 * within the TTL; Studio's save toast says so.
 *
 * ── THE REQUEST-HOST GUARD IS BEST-EFFORT, AND SAYS SO ─────────────────────
 * Refusing to map the host the operator is talking to right now catches the
 * common foot-gun (mapping away the very dashboard you are using). It is not
 * the real protection — the dashboard keeps working on every unmapped host,
 * so any lockout is recoverable from another hostname of the same instance.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  connectionTenantConfig,
  manifestsRepo,
  publicKeysRepo,
  settingsRepo,
  userPrefsRepo,
  type MetaDb,
} from '@adminium/meta';

import { audited } from '../../audit/coverage.js';
import { ConflictError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { splitInstallKey } from '../../installs/resolve.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { normalizeHost } from '../../security/csrf.js';
import { refuseUnlistedHosts } from '../../trial/operator-hosts.js';
import { resolveLabel } from '../../cli/surfaces-root.js';
import {
  pagesHomeIssueFor,
  validateDomainEntries,
  validateInstanceEntries,
  validatePageHostEntries,
  type DomainIssue,
} from '../../surfaces/validate.js';
import {
  appNameOf,
  appNameOverrideOf,
  instancesOf,
  staffConnectionOf,
  staffPlacementOf,
  type SurfaceSettings,
  NO_SURFACE_SETTINGS,
} from '../../surfaces/settings.js';
import {
  surfaceNameBody,
  surfaceNameReply,
  surfaceConnectionBody,
  surfaceInstancesBody,
  surfaceInstancesReply,
  surfaceConnectionReply,
  surfaceDomainsBody,
  surfaceDomainsReply,
  surfacePlacementBody,
  surfacePlacementParams,
  surfacePlacementReply,
  surfacesListReply,
  type SurfaceDomainTargetDto,
  type SurfaceSummaryDto,
} from './schema.js';

export interface SurfacesAdminRoutesDeps {
  meta: MetaDb;
  /** The live forms, by the add-on that holds them: the home picker of a pages host lists their addresses. */
  liveForms?: (() => Promise<readonly { addOn: string; slug: string }[]>) | undefined;
}

/** The domains editor's map: the app hosts, and the add-on pages hosts beside them. */
function editorMap(current: SurfaceSettings): Record<string, SurfaceDomainTargetDto> {
  return {
    ...current.domains,
    ...Object.fromEntries(Object.entries(current.pages ?? {}).map(([host, target]) => [host, { kind: 'pages' as const, home: target.home }])),
  };
}

export function surfacesAdminRoutes(deps: SurfacesAdminRoutesDeps): FastifyPluginAsyncZod {
  const settings = settingsRepo(deps.meta);
  const keys = publicKeysRepo(deps.meta);

  return async (app) => {
    const readSettings = async (): Promise<SurfaceSettings> =>
      (await app.surfaceSettings?.read()) ?? NO_SURFACE_SETTINGS;

    const installs = manifestsRepo(deps.meta, { encrypt: (value) => value, decrypt: (value) => value });
    /**
     * A route's `:appKey`: the app's key (its copy with the plain addresses),
     * or `<key>~<slug>` for a later copy, which must be installed. Each copy's
     * placement, name and sides are its own, kept under its address.
     */
    const copyOf = async (param: string): Promise<{ key: string; address: string; later: boolean }> => {
      const { key, slug } = splitInstallKey(param);
      if (slug === undefined || slug === '') return { key, address: key, later: false };
      const install = await installs.findBySlug(key, slug);
      if (install === null || install.row.kind !== 'app') throw new NotFoundError(`No copy of ${key} has the address "${slug}".`, { appKey: param });
      return { key, address: param, later: true };
    };

    app.get(
      '/surfaces',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        schema: { response: { 200: surfacesListReply } },
      },
      async (request) => {
        const current = await readSettings();
        /*
         * The reader's own locale, for the app-supplied fallback name only.
         *
         * An app ships its label in all eight locales; Studio shows whichever
         * one this operator reads in, exactly as the sidebar does. The
         * OVERRIDE is never localized — one operator types one business name —
         * so this affects only what the field falls back to.
         */
        const userId = (request as unknown as { user?: { id?: string } }).user?.id ?? null;
        const locale =
          userId === null ? 'en' : (await userPrefsRepo(deps.meta).resolve(userId)).locale;
        const surfaces: SurfaceSummaryDto[] = [];
        for (const surface of app.surfaces) {
          const mapped = Object.entries(current.domains)
            .filter(
              ([, target]) => target.appKey === surface.appKey && target.side === surface.side,
            )
            .map(([host]) => host)
            .sort();
          const boundKey =
            surface.side === 'customer'
              ? await keys.newestLiveByApp(surface.appKey, 'customer').then((row) =>
                  row === null ? null : { id: row.id, name: row.name, prefix: row.prefix },
                )
              : null;
          // One row per copy of the app: the copy with the plain addresses first, under the key; each later one under its own.
          const copies = (await installs.listByKey(surface.appKey))
            .filter((one) => one.row.kind === 'app')
            .sort((a, b) => (a.row.instanceSlug === '' ? -1 : b.row.instanceSlug === '' ? 1 : a.row.instanceSlug.localeCompare(b.row.instanceSlug)));
          const rows = copies.length === 0 ? [{ address: surface.appKey, installId: null, later: null }] : copies.map((one) => ({ address: one.row.instanceSlug === '' ? surface.appKey : `${surface.appKey}~${one.row.instanceSlug}`, installId: one.row.id, later: one.row.instanceSlug === '' ? null : one.row.scopeKey }));
          for (const row of rows) {
            surfaces.push({
              appKey: surface.appKey,
              address: row.address,
              installId: row.installId,
              side: surface.side,
              prefix: row.later === null ? surface.prefix : `/apps/${row.address.replace('~', '/')}/${surface.side}`,
              navAvailable: surface.manifest !== null && surface.manifest.nav.length > 0,
              navItems: surface.manifest?.nav.length ?? 0,
              staffPlacement:
                surface.side === 'staff' ? staffPlacementOf(current, row.address) : null,
              // Staff only, for the same reason `boundKey` is customer only: the
              // customer side already carries its connection through its key.
              // A later copy reads the database it is installed on.
              connectionId:
                surface.side === 'staff' ? (row.later ?? staffConnectionOf(current, row.address)) : null,
              boundKey,
              nameOverride: appNameOverrideOf(current, row.address),
              appName: appNameOf(
                current,
                row.address,
                surface.manifest === null
                  ? null
                  : resolveLabel(surface.manifest.appLabels, locale),
              ),
              domains: mapped,
            });
          }
        }
        const instances: Record<string, { slug: string; connectionId: string }[]> = {};
        for (const surface of app.surfaces) {
          const list = instancesOf(current, surface.appKey);
          if (list.length > 0) instances[surface.appKey] = list;
        }
        // Each live form's address, once, in order: a stranger's page a host's `/` may send to.
        // A slug is the add-on's free text, so only an address the save would take is offered:
        // the same rule a saved home passes, which keeps the redirect to a plain `/x/` path.
        const liveForms = deps.liveForms === undefined ? [] : await deps.liveForms().catch(() => []);
        const pageHomes = [...new Set(liveForms.map((form) => `/x/forms/${form.slug}`))].filter((home) => pagesHomeIssueFor(home) === null).sort();
        return { surfaces, domains: editorMap(current), instances, pageHomes };
      },
    );

    app.put(
      '/surfaces/:appKey/placement',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        config: { audit: audited('rbac') },
        schema: {
          params: surfacePlacementParams,
          body: surfacePlacementBody,
          response: { 200: surfacePlacementReply },
        },
      },
      async (request) => {
        const { appKey } = request.params;
        const { key, address } = await copyOf(appKey);
        const hasStaff = app.surfaces.some(
          (surface) => surface.appKey === key && surface.side === 'staff',
        );
        if (!hasStaff) {
          throw new NotFoundError('No staff surface is discovered for this app.', { appKey });
        }
        const current = await readSettings();
        const before = staffPlacementOf(current, address);
        const nextApps = {
          ...current.apps,
          [address]: { ...current.apps[address], staff: request.body.staff },
        };
        await settings.set('surfaces.apps', nextApps, {
          updatedBy: (request as unknown as { user?: { id?: string } }).user?.id ?? null,
        });
        app.surfaceSettings?.invalidate();
        await app.rbac.audit(request, {
          category: 'system',
          action: 'surfaces.placement',
          changes: {
            before: { appKey, staff: before },
            after: { appKey, staff: request.body.staff },
          },
        });
        return { appKey, staff: request.body.staff };
      },
    );

    /*
     * WHICH DATABASE a staff surface reads.
     *
     * The customer side answers this through its publishable key — key names a
     * scope, scope names a connection. The staff side has no key on purpose and
     * so had no answer at all, leaving the app to infer one from "the only
     * connection serving". That inference is correct until an instance has two
     * connections, and then it silently reads the wrong database and reports it
     * as a pile of absent tables.
     *
     * The binding is VALIDATED here rather than at read time: a surface pointed
     * at a connection that does not exist would fail identically to one pointed
     * at nothing, and the operator would be debugging the app instead of the
     * setting they just saved.
     */
    /*
     * WHAT THE OPERATOR CALLS THIS APP.
     *
     * Stored beside the placement rather than in the app's own bundle, because
     * the name belongs to the business running it and the bundle is not theirs
     * to rebuild. `null` clears the override and the app goes back to the name
     * its build carries — `appNameOf` is the one place that precedence lives.
     *
     * No staff-surface requirement, unlike `/placement` and `/connection`: a
     * customer-only app has a name too, and it is the name a mapped storefront
     * domain renders.
     */
    app.put(
      '/surfaces/:appKey/name',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        config: { audit: audited('rbac') },
        schema: {
          params: surfacePlacementParams,
          body: surfaceNameBody,
          response: { 200: surfaceNameReply },
        },
      },
      async (request) => {
        const { appKey } = request.params;
        const { key, address } = await copyOf(appKey);
        const known = app.surfaces.some((surface) => surface.appKey === key);
        if (!known) {
          throw new NotFoundError('No surface is discovered for this app.', { appKey });
        }
        const { name } = request.body;
        const current = await readSettings();
        const before = appNameOverrideOf(current, address);
        const nextApps = {
          ...current.apps,
          // Spread first: this must not disturb the placement, connection or
          // instances stored on the same record.
          [address]: { ...current.apps[address], ...(name === null ? {} : { name }) },
        };
        if (name === null) delete nextApps[address]?.name;
        await settings.set('surfaces.apps', nextApps, {
          updatedBy: (request as unknown as { user?: { id?: string } }).user?.id ?? null,
        });
        app.surfaceSettings?.invalidate();
        await app.rbac.audit(request, {
          category: 'system',
          action: 'surfaces.name',
          changes: { before: { appKey, name: before }, after: { appKey, name } },
        });
        return { appKey, name };
      },
    );

    app.put(
      '/surfaces/:appKey/connection',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        config: { audit: audited('rbac') },
        schema: {
          params: surfacePlacementParams,
          body: surfaceConnectionBody,
          response: { 200: surfaceConnectionReply },
        },
      },
      async (request) => {
        const { appKey } = request.params;
        const { key, later } = await copyOf(appKey);
        // A later copy reads the database it is installed on: that is the copy, not a setting.
        if (later) throw new ConflictError(`This copy of ${key} reads the database it is installed on. Install it on another database instead.`, 'CONFLICT', { reason: 'INSTALL_OWNS_DATABASE', appKey });
        const hasStaff = app.surfaces.some(
          (surface) => surface.appKey === appKey && surface.side === 'staff',
        );
        if (!hasStaff) {
          throw new NotFoundError('No staff surface is discovered for this app.', { appKey });
        }
        const { connectionId } = request.body;
        if (connectionId !== null) {
          // Reads two non-secret columns and needs no DSN crypto — the same
          // reason `connectionTenantConfig` exists at all.
          const found = await connectionTenantConfig(deps.meta, connectionId);
          if (found === null) {
            throw new ValidationFailedError('No such connection.', {
              in: 'body',
              issues: [
                { path: 'connectionId', message: 'no connection has this id', code: 'not_found' },
              ],
            });
          }
          // A database with a copy of its own: that copy reads it, under its own grant. Pointing this one there would serve that data under this one's.
          const owner = (await installs.listByKey(key)).find((one) => one.row.kind === 'app' && one.row.instanceSlug !== '' && one.row.connectionId === connectionId);
          if (owner !== undefined) {
            throw new ConflictError(`That database has its own copy of ${key}. Open that copy instead.`, 'CONFLICT', { reason: 'INSTALL_OWNS_DATABASE', appKey, connectionId, address: `${key}~${owner.row.instanceSlug}` });
          }
        }
        const current = await readSettings();
        const before = staffConnectionOf(current, appKey);
        const nextApps = {
          ...current.apps,
          // Spread first: this must not disturb the placement stored beside it.
          [appKey]: { ...current.apps[appKey], ...(connectionId === null ? {} : { connectionId }) },
        };
        if (connectionId === null) delete nextApps[appKey]?.connectionId;
        await settings.set('surfaces.apps', nextApps, {
          updatedBy: (request as unknown as { user?: { id?: string } }).user?.id ?? null,
        });
        app.surfaceSettings?.invalidate();
        await app.rbac.audit(request, {
          category: 'system',
          action: 'surfaces.connection',
          changes: { before: { appKey, connectionId: before }, after: { appKey, connectionId } },
        });
        return { appKey, connectionId };
      },
    );

    /*
     * THE SAME APP OVER SEVERAL DATABASES — the shape the dashboard's own
     * generated pages have always had, where a page carries a connection and
     * two connections simply make two sets.
     *
     * Every entry is validated before ANY is stored: a half-applied map would
     * leave an operator looking at a screen that disagrees with the URLs their
     * instance is served on, with no way to tell which half won.
     */
    app.put(
      '/surfaces/instances',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        config: { audit: audited('rbac') },
        schema: { body: surfaceInstancesBody, response: { 200: surfaceInstancesReply } },
      },
      async (request) => {
        const issues: DomainIssue[] = [];
        const normalized: Record<string, { slug: string; connectionId: string }[]> = {};
        for (const [appKey, list] of Object.entries(request.body.instances)) {
          const checked = await validateInstanceEntries(appKey, list, { surfaces: app.surfaces, meta: deps.meta });
          issues.push(...checked.issues);
          if (checked.rows.length > 0) normalized[appKey] = checked.rows;
        }

        if (issues.length > 0) {
          throw new ValidationFailedError('The instance list did not validate.', { issues });
        }

        const current = await readSettings();
        const before: Record<string, { slug: string; connectionId: string }[]> = {};
        const nextApps: typeof current.apps = {};
        for (const [appKey, entry] of Object.entries(current.apps)) {
          const existing = instancesOf(current, appKey);
          if (existing.length > 0) before[appKey] = existing;
          // Placement and the root binding are NOT this screen's to touch.
          const { instances: _dropped, ...rest } = entry;
          nextApps[appKey] = rest;
        }
        for (const [appKey, rows] of Object.entries(normalized)) {
          nextApps[appKey] = { ...nextApps[appKey], instances: rows };
        }

        await settings.set('surfaces.apps', nextApps, {
          updatedBy: (request as unknown as { user?: { id?: string } }).user?.id ?? null,
        });
        app.surfaceSettings?.invalidate();
        await app.rbac.audit(request, {
          category: 'system',
          action: 'surfaces.instances',
          changes: { before, after: normalized },
        });
        return { instances: normalized };
      },
    );

    app.put(
      '/surfaces/domains',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        config: { audit: audited('rbac') },
        schema: { body: surfaceDomainsBody, response: { 200: surfaceDomainsReply } },
      },
      async (request) => {
        // Read once, up front: an instance named by a host is validated against
        // the instances that actually exist.
        const declared = await readSettings();
        // One map on the wire, two in the store: the app hosts, and the hosts of the add-on pages.
        const appEntries: Record<string, { appKey: string; side: 'staff' | 'customer'; instance?: string | undefined }> = {};
        const pageEntries: Record<string, { home: string }> = {};
        for (const [host, target] of Object.entries(request.body.domains)) {
          if ('kind' in target) pageEntries[host] = { home: target.home };
          else appEntries[host] = target;
        }
        // Where the operator decides the addresses, only the domains it listed (`trial/operator-hosts.ts`).
        refuseUnlistedHosts(app, Object.keys(request.body.domains));
        const requestHost = normalizeHost(request.host);
        const apps = validateDomainEntries(appEntries, { requestHost, surfaces: app.surfaces, settings: declared });
        const pages = validatePageHostEntries(pageEntries, { requestHost, taken: new Set(Object.keys(apps.normalized)) });
        const issues = [...apps.issues, ...pages.issues];

        if (issues.length > 0) {
          throw new ValidationFailedError('The domain map did not validate.', { issues });
        }

        const current = await readSettings();
        const updatedBy = (request as unknown as { user?: { id?: string } }).user?.id ?? null;
        await settings.set('surfaces.domains', apps.normalized, { updatedBy });
        await settings.set('surfaces.pageHosts', pages.normalized, { updatedBy });
        app.surfaceSettings?.invalidate();
        const after = editorMap({ ...current, domains: apps.normalized, pages: pages.normalized });
        await app.rbac.audit(request, {
          category: 'system',
          action: 'surfaces.domains',
          changes: { before: { domains: editorMap(current) }, after: { domains: after } },
        });
        return { domains: after };
      },
    );
  };
}
