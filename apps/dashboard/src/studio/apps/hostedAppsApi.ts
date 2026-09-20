// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Hosted-apps data layer over `/api/v1/surfaces`
 * (`apps/server/src/routes/surfaces-admin/`).
 *
 * Shapes mirror the server's Zod replies (`routes/surfaces-admin/schema.ts`) —
 * the copied-mirror convention: change both together.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../../app/api.js';

export type SurfaceSide = 'staff' | 'customer';
export type StaffPlacement = 'internal' | 'external';

export interface SurfaceDomainTarget {
  appKey: string;
  side: SurfaceSide;
  /** Which instance this host serves; absent is the app's own mount. */
  instance?: string;
}

/** Mirrors `surfaceSummary`. */
export interface SurfaceSummaryDto {
  appKey: string;
  side: SurfaceSide;
  /** URL prefix the surface serves under, e.g. `/apps/clients/staff`. */
  prefix: string;
  /** False = "predates the toolkit; internal placement unavailable". */
  navAvailable: boolean;
  navItems: number;
  /** Staff surfaces only; null on customer surfaces. */
  staffPlacement: StaffPlacement | null;
  /**
   * Staff surfaces only: which connection this surface reads. Null is unbound
   * — the app infers "the only connection serving", right on a
   * single-connection instance and a guess on any other.
   */
  connectionId: string | null;
  /** Customer surfaces only: the newest live bound key, or null. */
  boundKey: { id: string; name: string; prefix: string } | null;
  /**
   * The operator's own name for this app, or null when they have set none.
   * Null is what makes the field render EMPTY with {@link appName} as its
   * placeholder, rather than pre-filling a value nobody chose — which the
   * next save would then freeze in place.
   */
  nameOverride: string | null;
  /** What the app is called right now: the override, else its own label. */
  appName: string;
  /** Hosts currently mapped to this surface, normalized. */
  domains: string[];
}

/** One extra tenant of an app: `/apps/<appKey>/<slug>/<side>/`. */
export interface SurfaceInstance {
  slug: string;
  connectionId: string;
}

export interface SurfacesListReply {
  surfaces: SurfaceSummaryDto[];
  domains: Record<string, SurfaceDomainTarget>;
  instances: Record<string, SurfaceInstance[]>;
}

export const SURFACES_QUERY_KEY = ['surfaces'] as const;

export function surfacesQuery() {
  return queryOptions({
    queryKey: SURFACES_QUERY_KEY,
    queryFn: () => api.get<SurfacesListReply>('/api/v1/surfaces'),
  });
}

export function setStaffPlacement(
  appKey: string,
  staff: StaffPlacement,
): Promise<{ appKey: string; staff: StaffPlacement }> {
  return api.put<{ appKey: string; staff: StaffPlacement }>(
    `/api/v1/surfaces/${appKey}/placement`,
    { staff },
  );
}

/** `null` clears the binding and restores the single-connection inference. */
export function setStaffConnection(
  appKey: string,
  connectionId: string | null,
): Promise<{ appKey: string; connectionId: string | null }> {
  return api.put<{ appKey: string; connectionId: string | null }>(
    `/api/v1/surfaces/${appKey}/connection`,
    { connectionId },
  );
}

/** `null` clears the override; the app goes back to the name it was built with. */
export function setAppName(
  appKey: string,
  name: string | null,
): Promise<{ appKey: string; name: string | null }> {
  return api.put<{ appKey: string; name: string | null }>(`/api/v1/surfaces/${appKey}/name`, {
    name,
  });
}

/** Full-map write, like the domains editor — removing a row is saving without it. */
export function saveSurfaceInstances(
  instances: Record<string, SurfaceInstance[]>,
): Promise<{ instances: Record<string, SurfaceInstance[]> }> {
  return api.put<{ instances: Record<string, SurfaceInstance[]> }>(
    '/api/v1/surfaces/instances',
    { instances },
  );
}

export function saveSurfaceDomains(
  domains: Record<string, SurfaceDomainTarget>,
): Promise<{ domains: Record<string, SurfaceDomainTarget> }> {
  return api.put<{ domains: Record<string, SurfaceDomainTarget> }>('/api/v1/surfaces/domains', {
    domains,
  });
}

/* --- derived state (pure — unit-tested without a DOM) ---------------------- */

/** One editor row. The `key` is render identity, stable across host edits. */
export interface DomainRow {
  key: number;
  host: string;
  appKey: string;
  side: SurfaceSide;
  /** Instance this host serves; `''` is the app's own mount. */
  instance: string;
}

export function rowsFromDomains(domains: Record<string, SurfaceDomainTarget>): DomainRow[] {
  return Object.entries(domains)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([host, target], index) => ({ key: index, host, instance: '', ...target }));
}

/**
 * The full-map body a row set saves. Later rows win a host collision here;
 * the server refuses real duplicates (same host after normalization) with a
 * named issue, so nothing silently drops server-side.
 */
export function domainsFromRows(rows: readonly DomainRow[]): Record<string, SurfaceDomainTarget> {
  const out: Record<string, SurfaceDomainTarget> = {};
  for (const row of rows) {
    const host = row.host.trim();
    if (host === '') continue;
    out[host] = {
      appKey: row.appKey,
      side: row.side,
      // Omitted rather than empty: absent IS "the app's own mount", and the
      // server's schema takes no empty string for a slug.
      ...(row.instance === '' ? {} : { instance: row.instance }),
    };
  }
  return out;
}

/** One refused host, as the server's 422 named it. */
export interface DomainIssue {
  path: string;
  message: string;
  code: string;
}

/** Pull `details.issues` out of a failed domains write. */
export function domainIssuesFrom(error: unknown): DomainIssue[] {
  const details = (error as { details?: unknown } | null)?.details;
  const issues = (details as { issues?: unknown } | undefined)?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.filter(
    (issue): issue is DomainIssue =>
      typeof issue === 'object' && issue !== null && typeof (issue as DomainIssue).message === 'string',
  );
}

/** Customer app keys, for the mint flow's optional binding. */
export function customerAppKeys(reply: SurfacesListReply): string[] {
  return reply.surfaces
    .filter((surface) => surface.side === 'customer')
    .map((surface) => surface.appKey)
    .sort();
}

/** One editor row. `key` is render identity, stable across edits. */
export interface InstanceRow {
  key: number;
  appKey: string;
  slug: string;
  connectionId: string;
}

export function rowsFromInstances(map: Record<string, SurfaceInstance[]>): InstanceRow[] {
  return Object.entries(map)
    .flatMap(([appKey, list]) => list.map((i) => ({ appKey, ...i })))
    .map((row, index) => ({ key: index, ...row }));
}

/**
 * Rows → the map the server takes. Blank rows are DROPPED rather than sent:
 * an operator who clicks "add" and then changes their mind should not be shown
 * a validation error about a row they never filled in.
 */
export function instancesFromRows(rows: InstanceRow[]): Record<string, SurfaceInstance[]> {
  const map: Record<string, SurfaceInstance[]> = {};
  for (const row of rows) {
    if (row.slug.trim() === '' || row.connectionId === '') continue;
    (map[row.appKey] ??= []).push({ slug: row.slug.trim(), connectionId: row.connectionId });
  }
  return map;
}
