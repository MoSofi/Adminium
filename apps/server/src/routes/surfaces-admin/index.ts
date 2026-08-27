// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Managing hosted app surfaces (29-app-surfaces.md §3.1, 29-T17's server half):
 * what this instance serves, where each staff surface appears (29 D9), and
 * which hosts are attached to which surface (29 D3).
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
  publicKeysRepo,
  settingsRepo,
  surfaceInstanceSlug,
  type MetaDb,
} from '@adminium/meta';

import { audited } from '../../audit/coverage.js';
import { NotFoundError, ValidationFailedError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { normalizeHost } from '../../security/csrf.js';
import {
  instancesOf,
  staffConnectionOf,
  staffPlacementOf,
  type SurfaceSettings,
} from '../../surfaces/settings.js';
import {
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
}

interface DomainIssue {
  path: string;
  message: string;
  code: string;
}

/**
 * A mapped host is a hostname with an optional port — never a URL. Validated
 * by round-tripping through `new URL('http://' + host)`: whatever survives
 * with its host intact and nothing else attached is servable; everything else
 * (schemes, paths, credentials, spaces) is named back to the operator.
 */
function hostIssueFor(host: string): string | null {
  if (host.includes('/') || host.includes('@') || host.includes('#') || host.includes('?')) {
    return 'must be a bare hostname (with an optional port), not a URL';
  }
  try {
    const url = new URL(`http://${host}`);
    if (normalizeHost(url.host) !== normalizeHost(host)) {
      return 'must be a bare hostname (with an optional port)';
    }
  } catch {
    return 'is not a valid hostname';
  }
  return null;
}

export function surfacesAdminRoutes(deps: SurfacesAdminRoutesDeps): FastifyPluginAsyncZod {
  const settings = settingsRepo(deps.meta);
  const keys = publicKeysRepo(deps.meta);

  return async (app) => {
    const readSettings = async (): Promise<SurfaceSettings> =>
      (await app.surfaceSettings?.read()) ?? { apps: {}, domains: {} };

    app.get(
      '/surfaces',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        schema: { response: { 200: surfacesListReply } },
      },
      async () => {
        const current = await readSettings();
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
          surfaces.push({
            appKey: surface.appKey,
            side: surface.side,
            prefix: surface.prefix,
            navAvailable: surface.manifest !== null && surface.manifest.nav.length > 0,
            navItems: surface.manifest?.nav.length ?? 0,
            staffPlacement:
              surface.side === 'staff' ? staffPlacementOf(current, surface.appKey) : null,
            // Staff only, for the same reason `boundKey` is customer only: the
            // customer side already carries its connection through its key.
            connectionId:
              surface.side === 'staff' ? staffConnectionOf(current, surface.appKey) : null,
            boundKey,
            domains: mapped,
          });
        }
        const instances: Record<string, { slug: string; connectionId: string }[]> = {};
        for (const surface of app.surfaces) {
          const list = instancesOf(current, surface.appKey);
          if (list.length > 0) instances[surface.appKey] = list;
        }
        return { surfaces, domains: current.domains, instances };
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
        const hasStaff = app.surfaces.some(
          (surface) => surface.appKey === appKey && surface.side === 'staff',
        );
        if (!hasStaff) {
          throw new NotFoundError('No staff surface is discovered for this app.', { appKey });
        }
        const current = await readSettings();
        const before = staffPlacementOf(current, appKey);
        const nextApps = {
          ...current.apps,
          [appKey]: { ...current.apps[appKey], staff: request.body.staff },
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
     * WHICH DATABASE a staff surface reads (29 D9).
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
     * THE SAME APP OVER SEVERAL DATABASES (29 D9) — the shape the dashboard's
     * own generated pages have always had, where a page carries a connection
     * and two connections simply make two sets.
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
          if (!app.surfaces.some((s) => s.appKey === appKey)) {
            issues.push({
              path: appKey,
              message: `"${appKey}" is not a surface this instance serves.`,
              code: 'unknown_surface',
            });
            continue;
          }
          const seen = new Set<string>();
          const rows: { slug: string; connectionId: string }[] = [];
          for (const entry of list) {
            const slug = surfaceInstanceSlug.safeParse(entry.slug);
            if (!slug.success) {
              issues.push({
                path: `${appKey}.${entry.slug}`,
                message: `"${entry.slug}" ${slug.error.issues[0]?.message ?? 'is not a valid slug'}.`,
                code: 'invalid_slug',
              });
              continue;
            }
            if (seen.has(slug.data)) {
              issues.push({
                path: `${appKey}.${entry.slug}`,
                message: `"${entry.slug}" is listed twice for this app.`,
                code: 'duplicate_slug',
              });
              continue;
            }
            // Validated here, not at read time: a mount pointed at a connection
            // that does not exist fails exactly like one pointed at nothing, and
            // the operator would debug the app instead of the setting.
            if ((await connectionTenantConfig(deps.meta, entry.connectionId)) === null) {
              issues.push({
                path: `${appKey}.${entry.slug}`,
                message: `"${entry.slug}" points at a connection that does not exist.`,
                code: 'unknown_connection',
              });
              continue;
            }
            seen.add(slug.data);
            rows.push({ slug: slug.data, connectionId: entry.connectionId });
          }
          if (rows.length > 0) normalized[appKey] = rows;
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
        const issues: DomainIssue[] = [];
        const normalized: Record<string, SurfaceDomainTargetDto> = {};
        const requestHost = normalizeHost(request.host);
        // Read once, up front: an instance named by a host is validated against
        // the instances that actually exist.
        const declared = await readSettings();

        for (const [host, target] of Object.entries(request.body.domains)) {
          const hostIssue = hostIssueFor(host);
          if (hostIssue !== null) {
            issues.push({ path: host, message: `"${host}" ${hostIssue}.`, code: 'invalid_host' });
            continue;
          }
          const key = normalizeHost(host);
          if (key in normalized) {
            issues.push({
              path: host,
              message: `"${host}" duplicates another entry once normalized ("${key}").`,
              code: 'duplicate_host',
            });
            continue;
          }
          if (requestHost !== '' && key === requestHost) {
            issues.push({
              path: host,
              message: `"${host}" is the host you are using to reach Studio — mapping it would take this dashboard away from you.`,
              code: 'request_host',
            });
            continue;
          }
          const exists = app.surfaces.some(
            (surface) => surface.appKey === target.appKey && surface.side === target.side,
          );
          if (!exists) {
            issues.push({
              path: host,
              message: `No ${target.side} surface is discovered for app "${target.appKey}".`,
              code: 'unknown_surface',
            });
            continue;
          }
          /*
           * An instance named here must EXIST. A host pointed at a slug nobody
           * declared would serve the app's own database while the operator
           * believes it is serving another business's — the one failure this
           * whole mapping exists to make impossible.
           */
          if (
            target.instance !== undefined &&
            !instancesOf(declared, target.appKey).some((i) => i.slug === target.instance)
          ) {
            issues.push({
              path: host,
              message: `"${target.appKey}" has no instance "${target.instance}".`,
              code: 'unknown_instance',
            });
            continue;
          }
          normalized[key] = {
            appKey: target.appKey,
            side: target.side,
            ...(target.instance === undefined ? {} : { instance: target.instance }),
          };
        }

        if (issues.length > 0) {
          throw new ValidationFailedError('The domain map did not validate.', { issues });
        }

        const current = await readSettings();
        await settings.set('surfaces.domains', normalized, {
          updatedBy: (request as unknown as { user?: { id?: string } }).user?.id ?? null,
        });
        app.surfaceSettings?.invalidate();
        await app.rbac.audit(request, {
          category: 'system',
          action: 'surfaces.domains',
          changes: { before: { domains: current.domains }, after: { domains: normalized } },
        });
        return { domains: normalized };
      },
    );
  };
}
