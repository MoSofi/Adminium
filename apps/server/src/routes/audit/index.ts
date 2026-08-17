// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Audit query routes (08-server-api.md §2.14, M2-T06): `GET /audit` with
 * category/actor/date-range/resource filters and keyset pagination on
 * `(created_at, id)` descending (both indexed, ids are time-ordered ULIDs —
 * 07 §3.11), plus `GET /audit/:id`. Append-only: no mutating routes exist.
 *
 * Requires `system:audit:read` (meta closed-set key `audit.read`).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { NotFoundError, ValidationFailedError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  auditEntryReply,
  auditIdParams,
  auditListQuery,
  auditListReply,
  type AuditEntryDto,
} from './schema.js';

interface AuditRow {
  id: string;
  createdAt: number;
  actorKind: string;
  actorId: string | null;
  actorLabel: string;
  category: string;
  action: string;
  connectionId: string | null;
  entity: unknown;
  changes: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

function parseJsonColumn(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function toDto(row: AuditRow): AuditEntryDto {
  return {
    id: row.id,
    createdAt: row.createdAt,
    actorKind: row.actorKind as AuditEntryDto['actorKind'],
    actorId: row.actorId,
    actorLabel: row.actorLabel,
    category: row.category as AuditEntryDto['category'],
    action: row.action,
    connectionId: row.connectionId,
    entity: parseJsonColumn(row.entity),
    changes: parseJsonColumn(row.changes),
    ip: row.ip,
    userAgent: row.userAgent,
    requestId: row.requestId,
  };
}

interface Cursor {
  createdAt: number;
  id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}:${cursor.id}`, 'utf8').toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = decoded.indexOf(':');
  const createdAt = separator > 0 ? Number(decoded.slice(0, separator)) : Number.NaN;
  const id = separator > 0 ? decoded.slice(separator + 1) : '';
  if (!Number.isFinite(createdAt) || id.length === 0) {
    throw new ValidationFailedError('Malformed pagination cursor.', { cursor: raw });
  }
  return { createdAt, id };
}

/** Escape LIKE wildcards in the user-supplied resource filter. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export const auditRoutes: FastifyPluginAsyncZod = async (app) => {
  const { meta } = app.rbac;

  app.get(
    '/audit',
    {
      preHandler: app.rbac.require(PERMISSIONS.auditRead),
      schema: { querystring: auditListQuery, response: { 200: auditListReply } },
    },
    async (request) => {
      const { actorId, category, resource, from, to, cursor, limit } = request.query;

      let q = meta.db.selectFrom('adminium_audit_log').selectAll();
      if (actorId !== undefined) q = q.where('actorId', '=', actorId);
      if (category !== undefined) q = q.where('category', '=', category);
      if (from !== undefined) q = q.where('createdAt', '>=', from);
      if (to !== undefined) q = q.where('createdAt', '<=', to);
      if (resource !== undefined && resource.length > 0) {
        // Dotted-verb prefix: resource=role matches role.create, role.delete, …
        const prefix = escapeLike(resource);
        q = q.where((eb) =>
          eb.or([eb('action', '=', resource), eb('action', 'like', `${prefix}.%`)]),
        );
      }
      if (cursor !== undefined) {
        const decoded = decodeCursor(cursor);
        q = q.where((eb) =>
          eb.or([
            eb('createdAt', '<', decoded.createdAt),
            eb.and([eb('createdAt', '=', decoded.createdAt), eb('id', '<', decoded.id)]),
          ]),
        );
      }

      const rows = await q
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(limit + 1)
        .execute();

      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const nextCursor =
        rows.length > limit && last !== undefined
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null;
      return { entries: page.map((row) => toDto(row as AuditRow)), nextCursor };
    },
  );

  app.get(
    '/audit/:id',
    {
      preHandler: app.rbac.require(PERMISSIONS.auditRead),
      schema: { params: auditIdParams, response: { 200: auditEntryReply } },
    },
    async (request) => {
      const row = await meta.db
        .selectFrom('adminium_audit_log')
        .selectAll()
        .where('id', '=', request.params.id)
        .executeTakeFirst();
      if (row === undefined) throw new NotFoundError('Audit entry not found.', { id: request.params.id });
      return toDto(row as AuditRow);
    },
  );
};
