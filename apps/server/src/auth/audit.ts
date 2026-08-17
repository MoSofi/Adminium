// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Auth audit trail (08-server-api.md §7 item 9): every auth mutation writes an
 * `auth`-category entry — login, login_failed, logout, 2FA lifecycle, password
 * reset — with IP, user agent, and request id, never any secret material.
 */
import type { FastifyRequest } from 'fastify';
import { auditRepo, type AuditEntry, type MetaDb } from '@adminium/meta';

export interface AuthAuditInput {
  /** Dotted verb, e.g. `login`, `login_failed`, `2fa_enrolled`. */
  action: string;
  /** `usr_…` id when the principal is known. */
  actorId?: string | null | undefined;
  /** Display snapshot: user name, or the attempted email on failures. */
  actorLabel: string;
  changes?: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null } | null;
}

/** Appends an `auth` audit entry stamped with the request's context. */
export async function auditAuth(
  meta: MetaDb,
  request: FastifyRequest,
  input: AuthAuditInput,
): Promise<AuditEntry> {
  const userAgent = request.headers['user-agent'];
  return auditRepo(meta).append({
    actorKind: 'user',
    actorId: input.actorId ?? null,
    actorLabel: input.actorLabel,
    category: 'auth',
    action: input.action,
    changes: input.changes ?? null,
    ip: request.ip,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
    requestId: request.id,
  });
}
