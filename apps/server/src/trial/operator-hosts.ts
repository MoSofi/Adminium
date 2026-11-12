// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The addresses an operator gives an instance: where it answers, and where
 * links in its email point.
 *
 * Two variables decide them, on any server (`config/env.ts`):
 *
 *   ADMINIUM_PUBLIC_ORIGIN     the operator's address for the instance
 *                              (`https://hollis.try.example.com`); required
 *                              in trial mode and the hosted profile;
 *   ADMINIUM_OPERATOR_DOMAINS  the user's own domains the operator verified
 *                              (`shop.hollis.example,www.hollis.example`),
 *                              plain lower-case host names.
 *
 * With either set:
 *
 *  - the instance answers on the public origin's host and the listed domains
 *    only. Any other `Host` gets 421 before a route is reached, the way design
 *    mode and a shared desktop project refuse theirs. The host compared is
 *    `request.host`: the `Host` header, or `X-Forwarded-Host` from a trusted
 *    proxy (`security/trust-proxy.ts`). So a proxy that passes any name
 *    through, or rewrites `Host` to its upstream, changes nothing;
 *  - the health checks (`/api/v1/healthz`, `/api/v1/readyz`) answer on every
 *    host: an orchestrator or the operator's monitor dials the container by its
 *    address, and the two say only "alive" and "ready";
 *  - links in email point at the first listed domain, else the public origin
 *    ({@link OperatorHosts.origin}). It is held as `system.publicOrigin` from
 *    the boot on, nothing captures another (`security/public-origin.ts`), and
 *    Studio shows it read-only, "Set by the operator";
 *  - a domain mapped to an app's side or to the add-on pages
 *    (`surfaces.domains`, `surfaces.pageHosts`) must be one of the listed
 *    domains ({@link mayMapHost}).
 *
 * Without either, nothing here runs and the server answers every name, as it
 * always has.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Env } from '../config/env.js';
import { AppError } from '../errors.js';
import type { PolicyReason } from './policy.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The operator's addresses for this server, or null when none are set (`trial/operator-hosts.ts`). */
    operatorHosts: OperatorHosts | null;
  }
}

export interface OperatorHosts {
  /** Where links in email point: `https://` and the first listed domain, else `ADMINIUM_PUBLIC_ORIGIN`. */
  origin: string;
  /** `ADMINIUM_OPERATOR_DOMAINS`, in the operator's order. */
  domains: readonly string[];
  /** Every host name the instance answers on: the public origin's and the listed domains, lower case, no port. */
  hosts: ReadonlySet<string>;
}

/** The paths that answer on every host. */
export const ANY_HOST_PATHS: ReadonlySet<string> = new Set(['/api/v1/healthz', '/api/v1/readyz']);

export function operatorHostsOf(env: Pick<Env, 'ADMINIUM_PUBLIC_ORIGIN' | 'ADMINIUM_OPERATOR_DOMAINS'>): OperatorHosts | null {
  const domains = env.ADMINIUM_OPERATOR_DOMAINS ?? [];
  const publicOrigin = env.ADMINIUM_PUBLIC_ORIGIN;
  if (publicOrigin === undefined && domains.length === 0) return null;
  const hosts = new Set(domains);
  if (publicOrigin !== undefined) hosts.add(new URL(publicOrigin).hostname);
  const first = domains[0];
  return { origin: first === undefined ? publicOrigin! : `https://${first}`, domains, hosts };
}

/**
 * A `Host` value as the list holds names: lower case, without its port or the
 * dot a full name may end with. An IPv6 address keeps its brackets.
 */
export function hostNameOf(host: string | undefined): string {
  const lower = (host ?? '').trim().toLowerCase();
  const name = lower.startsWith('[') ? lower.slice(0, lower.indexOf(']') + 1) : lower.replace(/:\d*$/, '');
  return name.endsWith('.') ? name.slice(0, -1) : name;
}

/** Whether a host may be mapped to an app's side or to the add-on pages here. */
export function mayMapHost(hosts: OperatorHosts | null, host: string): boolean {
  return hosts === null || hosts.domains.includes(hostNameOf(host));
}

/**
 * Throws 403 when any of `hosts` is not one the operator listed, naming them,
 * with the profile's reason (`not-allowed` for an ordinary server with the
 * variables set). Nothing to refuse without operator hosts.
 */
export function refuseUnlistedHosts(app: FastifyInstance, hosts: readonly string[]): void {
  const operator = app.hasDecorator('operatorHosts') ? app.operatorHosts : null;
  const refused = hosts.filter((host) => !mayMapHost(operator, host));
  if (refused.length === 0) return;
  const answer = app.hasDecorator('trialPolicy') ? app.trialPolicy.allows('mappedDomains') : { allowed: true, reason: null };
  const reason: PolicyReason | 'not-allowed' = answer.reason ?? 'not-allowed';
  throw new AppError(403, 'FORBIDDEN', 'Only the domains the server’s operator listed can point here.', { reason, hosts: refused });
}

/** Whether the websites that frame forms are held to the listed domains (trial mode and the hosted profile). */
function websitesHeld(app: FastifyInstance): PolicyReason | null {
  return app.hasDecorator('trialPolicy') ? app.trialPolicy.allows('mappedDomains').reason : null;
}

/** The host of an http(s) origin, or null for anything else. */
function originHost(origin: string): string | null {
  try {
    return hostNameOf(new URL(origin.trim()).host);
  } catch {
    return null;
  }
}

/**
 * Throws 403 when a website to list for framing forms (`publicPages.websites`)
 * is not one of the operator's listed domains, where the profile holds them to
 * it. A line that is not a website at all is left to the list's own check.
 */
export function refuseUnlistedWebsites(app: FastifyInstance, lines: readonly string[]): void {
  const reason = websitesHeld(app);
  if (reason === null) return;
  const domains = app.hasDecorator('operatorHosts') ? (app.operatorHosts?.domains ?? []) : [];
  const refused = lines.map((line) => line.trim()).filter((line) => {
    const host = originHost(line);
    return host !== null && !domains.includes(host);
  });
  if (refused.length > 0) throw new AppError(403, 'FORBIDDEN', 'Only the domains the server’s operator listed can show forms in a frame.', { reason, origins: refused });
}

/** The listed websites that may frame forms here: where the profile holds them, only the operator's domains. */
export function framingWebsites(app: FastifyInstance, listed: () => Promise<readonly string[]>): () => Promise<readonly string[]> {
  if (websitesHeld(app) === null) return listed;
  const domains = app.operatorHosts?.domains ?? [];
  return async () => (await listed()).filter((origin) => domains.includes(originHost(origin) ?? ''));
}

/** The path the router will read, without the query. */
function pathOf(url: string): string {
  return url.split('?')[0] ?? url;
}

/**
 * Refuse every request to a name the operator did not give the instance.
 * Registered first, before any plugin, so nothing behind it sees one.
 */
export function registerOperatorHosts(app: FastifyInstance, hosts: OperatorHosts): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (hosts.hosts.has(hostNameOf(request.host))) return undefined;
    if (ANY_HOST_PATHS.has(pathOf(request.url))) return undefined;
    // 421: this server does not answer to that name. No body worth reading for a page that should not be here.
    return reply.code(421).header('content-type', 'text/plain; charset=utf-8').header('cache-control', 'no-store').send('This Adminium answers to its own addresses only.');
  });
}
