// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The RBAC principal — "who is acting" (08-server-api.md §8: the auth layer
 * resolves a principal, not a session, so API keys and users flow through the
 * same enforcement path).
 *
 * Session users are decorated as `request.user` by `plugins/auth.ts`; this
 * module reads that decoration *structurally* (no import, no augmentation) so
 * the two plugins stay independently buildable. API-key principals are set by
 * `plugins/rbac.ts` itself from `Authorization: Bearer adm_sk_…`.
 */

import type { FastifyRequest } from 'fastify';

export interface UserPrincipal {
  kind: 'user';
  id: string;
  /** Display snapshot for audit `actor_label` (07-meta-store.md §3.11). */
  label: string;
}

export interface ApiKeyPrincipal {
  kind: 'api-key';
  /** The `adminium_api_keys` row id. */
  id: string;
  label: string;
  /** The key acts with this role's permissions (07-meta-store.md §3.7). */
  roleId: string;
}

export type RbacPrincipal = UserPrincipal | ApiKeyPrincipal;

/** The minimal shape `plugins/auth.ts` puts on `request.user`. */
interface AuthUserLike {
  id?: unknown;
  name?: unknown;
  email?: unknown;
}

/**
 * Resolve the acting principal for a request: an API-key principal (set by
 * the rbac plugin's bearer hook) wins, then the auth plugin's session user.
 * `null` means unauthenticated.
 */
export function getPrincipal(request: FastifyRequest): RbacPrincipal | null {
  if (request.apiKeyPrincipal !== null && request.apiKeyPrincipal !== undefined) {
    return request.apiKeyPrincipal;
  }
  const user = (request as unknown as { user?: AuthUserLike | null }).user;
  if (user !== null && user !== undefined && typeof user.id === 'string') {
    const label =
      typeof user.name === 'string' && user.name.length > 0
        ? user.name
        : typeof user.email === 'string'
          ? user.email
          : user.id;
    return { kind: 'user', id: user.id, label };
  }
  return null;
}
