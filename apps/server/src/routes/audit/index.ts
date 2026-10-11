// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Audit query routes: `GET /audit` with category/actor/date-range/resource
 * filters and keyset pagination on `(created_at, id)` descending (both
 * indexed, ids are time-ordered ULIDs), plus `GET /audit/:id`. Append-only:
 * no mutating routes exist.
 *
 * Requires `system:audit:read` (meta closed-set key `audit.read`).
 */
import type { RowLimitContext } from '../../crud/row-limit.js';
import { rowLimitContextOf, rowTestOf } from '../../crud/row-limit-context.js';
import { auditEntityKeyPart, type MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { NotFoundError, ValidationFailedError } from '../../errors.js';
import type { SnapshotView } from '../../crud/identifiers.js';
import { readableImage, readViewOf } from '../../crud/read-view.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { cursorText } from '../../security/nul-bytes.js';
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

export function parseJsonColumn(value: unknown): Record<string, unknown> | null {
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

/**
 * The entries as the reader may see them: a record's before and after images
 * without the columns their role does not read of its table (their read of it
 * is limited to others). Nearly everyone reads every entry as it is.
 */
async function asReadBy(request: FastifyRequest, entries: AuditEntryDto[]): Promise<AuditEntryDto[]> {
  const permissions = await request.server.rbac.resolve(request);
  if (permissions.superAdmin === true || permissions.readLimits === undefined) return entries;
  const views = new Map<string, Promise<SnapshotView | null>>();
  const viewOf = (connectionId: string) => {
    if (!views.has(connectionId)) views.set(connectionId, loadSnapshotView(meta(request), connectionId).then((view) => readViewOf(view, permissions)).catch(() => null));
    return views.get(connectionId)!;
  };
  const out: AuditEntryDto[] = [];
  for (const entry of entries) {
    const entity = entry.entity as { connectionId?: unknown; table?: unknown } | null;
    const changes = entry.changes as { before?: unknown; after?: unknown } | null;
    if (entity === null || typeof entity.connectionId !== 'string' || typeof entity.table !== 'string' || changes === null || typeof changes !== 'object') {
      out.push(entry);
      continue;
    }
    const view = await viewOf(entity.connectionId);
    if (view === null || !view.readLimited) {
      out.push(entry);
      continue;
    }
    const image = (value: unknown) => (typeof value === 'object' && value !== null && !Array.isArray(value) ? readableImage(view, entity.table as string, value as Record<string, unknown>) : value);
    out.push({ ...entry, changes: { ...changes, ...('before' in changes ? { before: image(changes.before) } : {}), ...('after' in changes ? { after: image(changes.after) } : {}) } });
  }
  return out;
}

const meta = (request: FastifyRequest): MetaDb => request.server.rbac.meta;

/**
 * The entries a reader held to some rows of a table may see: none of that
 * table's. An entry holds a row's images, or names one (a file hung on it, a
 * document drawn of it), and the log cannot be cut down to the rows that are
 * theirs after the fact; a record's own history, on its page, is where they
 * read what happened to a row they reach. Nearly everyone reads every entry:
 * nothing limits them and no schema is loaded.
 */
async function withoutRowsOutOfReach(request: FastifyRequest, entries: AuditEntryDto[]): Promise<AuditEntryDto[]> {
  const permissions = await request.server.rbac.resolve(request);
  const reaches = new Map<string, Promise<{ view: SnapshotView; rows: RowLimitContext | null } | null>>();
  const reachOf = (connectionId: string) => {
    if (!reaches.has(connectionId)) {
      reaches.set(
        connectionId,
        loadSnapshotView(meta(request), connectionId)
          .then(async (view) => ({ view, rows: await rowLimitContextOf(meta(request), permissions, connectionId, view.model) }))
          .catch(() => null),
      );
    }
    return reaches.get(connectionId)!;
  };
  const tableOf = (value: unknown): string | null => (typeof value === 'object' && value !== null && typeof (value as { table?: unknown }).table === 'string' ? (value as { table: string }).table : null);
  const out: AuditEntryDto[] = [];
  for (const entry of entries) {
    const entity = entry.entity as { connectionId?: unknown } | null;
    const changes = entry.changes as { before?: unknown; after?: unknown } | null;
    const connectionId = typeof entity?.connectionId === 'string' ? entity.connectionId : entry.connectionId;
    const tables = [tableOf(entity), tableOf(changes?.before), tableOf(changes?.after)].filter((table): table is string => table !== null);
    if (connectionId === null || tables.length === 0) {
      out.push(entry);
      continue;
    }
    const reach = await reachOf(connectionId);
    // No schema to read (a connection that is gone): nothing says whose the rows were, and nothing limited anybody there.
    if (reach === null || reach.rows === null) {
      out.push(entry);
      continue;
    }
    const whole = tables.every((name) => {
      const table = reach.view.linkTable(name);
      return table !== null && rowTestOf(reach.rows, table.id, 'read') === null;
    });
    if (whole) out.push(entry);
  }
  return out;
}

interface Cursor {
  createdAt: number;
  id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}:${cursor.id}`, 'utf8').toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  // U+0000 in a cursor is no cursor the server wrote, and would reach the database (`cursorText`).
  const decoded = cursorText(raw) ?? '';
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
      const { actorId, category, resource, connectionId, entityTable, entityId, from, to, cursor, limit } =
        request.query;

      let q = meta.db.selectFrom('adminium_audit_log').selectAll();
      if (actorId !== undefined) q = q.where('actorId', '=', actorId);
      if (category !== undefined) q = q.where('category', '=', category);
      // Per-record filter (30 WS-A): equality on the denormalized indexed
      // columns. Clamped through the same helper the write side uses, so an
      // over-long key still matches the truncated form it was stored as.
      if (connectionId !== undefined) q = q.where('connectionId', '=', connectionId);
      if (entityTable !== undefined) q = q.where('entityTable', '=', auditEntityKeyPart(entityTable));
      if (entityId !== undefined) q = q.where('entityId', '=', auditEntityKeyPart(entityId));
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
      // A short page is still followed by `nextCursor`: what was left out is not counted.
      return { entries: await asReadBy(request, await withoutRowsOutOfReach(request, page.map((row) => toDto(row as AuditRow)))), nextCursor };
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
      const [entry] = await asReadBy(request, await withoutRowsOutOfReach(request, [toDto(row as AuditRow)]));
      // An entry of a table whose rows the reader reaches only in part is, for them, not there.
      if (entry === undefined) throw new NotFoundError('Audit entry not found.', { id: request.params.id });
      return entry;
    },
  );
};
