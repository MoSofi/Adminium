// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Validation for the two surface maps an operator edits — hosts and
 * instances — shared by the instance-wide Surfaces screen and one app's own
 * settings page, so the two can never accept different things.
 */
import { connectionTenantConfig, surfaceInstanceSlug, type MetaDb } from '@adminium/meta';

import type { HostedSurface, SurfaceSide } from '../cli/surfaces-root.js';
import { normalizeHost } from '../security/csrf.js';
import { instancesOf, type DomainMapping, type SurfaceSettings } from './settings.js';

export interface DomainIssue {
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
export function hostIssueFor(host: string): string | null {
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

/**
 * Validate host → surface entries, normalising each host. `settings` names
 * the instances that exist; `requestHost` is the host Studio is reached on,
 * which must never be mapped away.
 */
export function validateDomainEntries(
  entries: Readonly<Record<string, { appKey: string; side: SurfaceSide; instance?: string | undefined }>>,
  ctx: { requestHost: string; surfaces: readonly HostedSurface[]; settings: SurfaceSettings },
): { normalized: Record<string, DomainMapping>; issues: DomainIssue[] } {
  const issues: DomainIssue[] = [];
  const normalized: Record<string, DomainMapping> = {};
  for (const [host, target] of Object.entries(entries)) {
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
    if (ctx.requestHost !== '' && key === ctx.requestHost) {
      issues.push({
        path: host,
        message: `"${host}" is the host you are using to reach Studio — mapping it would take this dashboard away from you.`,
        code: 'request_host',
      });
      continue;
    }
    const exists = ctx.surfaces.some(
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
      !instancesOf(ctx.settings, target.appKey).some((i) => i.slug === target.instance)
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
  return { normalized, issues };
}

/** Validate one app's instance list: known app, valid unique slugs, real connections. */
export async function validateInstanceEntries(
  appKey: string,
  list: readonly { slug: string; connectionId: string }[],
  ctx: { surfaces: readonly HostedSurface[]; meta: MetaDb },
): Promise<{ rows: { slug: string; connectionId: string }[]; issues: DomainIssue[] }> {
  const issues: DomainIssue[] = [];
  const rows: { slug: string; connectionId: string }[] = [];
  if (!ctx.surfaces.some((s) => s.appKey === appKey)) {
    issues.push({
      path: appKey,
      message: `"${appKey}" is not a surface this instance serves.`,
      code: 'unknown_surface',
    });
    return { rows, issues };
  }
  const seen = new Set<string>();
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
    if ((await connectionTenantConfig(ctx.meta, entry.connectionId)) === null) {
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
  return { rows, issues };
}
