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
import { rowTestOf } from '../../crud/row-limit-context.js';
import { reachOfRequest } from '../../crud/row-reach-request.js';
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

/** Which tables of a connection a reader reaches only some rows of, by connection; null where nothing limits them. */
type Limited = Map<string, { view: SnapshotView; rows: RowLimitContext } | 'unreadable' | null>;

/**
 * The reader's row limits on every connection, read once for a request: for
 * nearly everyone an empty answer and no schema loaded (`reachOfRequest`).
 */
async function limitsOf(request: FastifyRequest): Promise<Limited> {
  const out: Limited = new Map();
  for (const { id } of await meta(request).db.selectFrom('adminium_connections').select('id').execute()) out.set(id, await reachOfRequest(meta(request), request, id));
  return out;
}

/** The names an entry's table may be kept under (`entityTable`) that this reader reaches only in part, per connection. */
function tablesInPart(limited: Limited): { connectionId: string; tables: string[] | 'all' }[] {
  const out: { connectionId: string; tables: string[] | 'all' }[] = [];
  for (const [connectionId, reach] of limited) {
    if (reach === null) continue;
    // Somebody something could limit, on a schema that cannot be read: nothing of that connection's tables.
    if (reach === 'unreadable') out.push({ connectionId, tables: 'all' });
    else {
      const tables = reach.view.model.tables.filter((table) => rowTestOf(reach.rows, table.id, 'read') !== null).map((table) => auditEntityKeyPart(table.id));
      if (tables.length > 0) out.push({ connectionId, tables });
    }
  }
  return out;
}

/**
 * The entries a reader held to some rows of a table may see: none of that
 * table's. An entry holds a row's images, or names one (a file hung on it, a
 * document drawn of it), and the log cannot be cut down to the rows that are
 * theirs after the fact; a record's own history, on its page, is where they
 * read what happened to a row they reach. Nearly everyone reads every entry.
 *
 * The entries ABOUT a record are left out in the query itself (`tablesInPart`),
 * so they are neither counted nor paged over; this takes out the few that
 * name a table only in what changed.
 */
function withoutRowsOutOfReach(limited: Limited, entries: AuditEntryDto[]): AuditEntryDto[] {
  const tableOf = (value: unknown): string | null => (typeof value === 'object' && value !== null && typeof (value as { table?: unknown }).table === 'string' ? (value as { table: string }).table : null);
  const out: AuditEntryDto[] = [];
  for (const entry of entries) {
    const entity = entry.entity as { connectionId?: unknown } | null;
    const changes = entry.changes as { before?: unknown; after?: unknown } | null;
    const connectionId = typeof entity?.connectionId === 'string' ? entity.connectionId : entry.connectionId;
    const tables = [tableOf(entity), tableOf(changes?.before), tableOf(changes?.after)].filter((table): table is string => table !== null);
    const reach = connectionId === null ? null : (limited.get(connectionId) ?? null);
    if (tables.length === 0 || reach === null) {
      out.push(entry);
      continue;
    }
    if (reach === 'unreadable') continue;
    const whole = tables.every((name) => {
      const table = reach.view.linkTable(name) ?? reach.view.linkTable(reach.view.model.tables.find((one) => one.name === name)?.id ?? '');
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

      const limited = await limitsOf(request);
      const inPart = tablesInPart(limited);
      const base = () => {
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
        // A record's entries of a table the reader reaches only in part: not in the answer, the count of a page or a cursor.
        for (const { connectionId: of, tables } of inPart) {
          q = q.where((eb) =>
            eb.or([eb('connectionId', 'is', null), eb('connectionId', '<>', of), tables === 'all' ? eb('entityTable', 'is', null) : eb.or([eb('entityTable', 'is', null), eb('entityTable', 'not in', tables)])]),
          );
        }
        return q;
      };

      /*
       * Pages are filled with entries the reader may see, and the cursor is
       * always the last entry ANSWERED: an entry left out is never what a
       * page ends on, so its time and id are in no cursor. For nearly
       * everyone that is one query, as it always was.
       */
      const shown: AuditEntryDto[] = [];
      let after = cursor === undefined ? null : decodeCursor(cursor);
      let more = true;
      for (let round = 0; round < 6 && more && shown.length < limit; round += 1) {
        let q = base();
        if (after !== null) {
          const at = after;
          q = q.where((eb) => eb.or([eb('createdAt', '<', at.createdAt), eb.and([eb('createdAt', '=', at.createdAt), eb('id', '<', at.id)])]));
        }
        const rows = await q.orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(limit + 1).execute();
        more = rows.length > limit;
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        const visible = withoutRowsOutOfReach(limited, page.map((row) => toDto(row as AuditRow)));
        const room = limit - shown.length;
        shown.push(...visible.slice(0, room));
        // Cut short with entries to spare: the next page starts after the last one answered.
        if (visible.length > room) more = true;
        after = visible.length > room || last === undefined ? after : { createdAt: last.createdAt, id: last.id };
        if (visible.length > room) break;
      }
      const lastShown = shown[shown.length - 1];
      const nextCursor = more && lastShown !== undefined ? encodeCursor({ createdAt: lastShown.createdAt, id: lastShown.id }) : null;
      return { entries: await asReadBy(request, shown), nextCursor };
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
      const limited = await limitsOf(request);
      const inPart = tablesInPart(limited);
      // An entry about a record of a table the reader reaches only in part, as the list leaves it out.
      const ofRecord = row.connectionId !== null && row.entityTable !== null && inPart.some((one) => one.connectionId === row.connectionId && (one.tables === 'all' || one.tables.includes(row.entityTable as string)));
      const [entry] = ofRecord ? [] : await asReadBy(request, withoutRowsOutOfReach(limited, [toDto(row as AuditRow)]));
      // An entry of a table whose rows the reader reaches only in part is, for them, not there.
      if (entry === undefined) throw new NotFoundError('Audit entry not found.', { id: request.params.id });
      return entry;
    },
  );
};
