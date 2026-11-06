// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `?workspaceId=` on a list: the list as it is, cut to one workspace's
 * databases. It only ever NARROWS. The route keeps every check it has (who may
 * read what, per database); this then drops the rows of the other databases.
 * A workspace the person cannot see is not found, and naming a workspace and
 * a `connectionId` together is refused: one says what the other means.
 *
 * The client sends its tab's workspace; the server never reads a person's
 * stored last choice to filter.
 */
import type { MetaDb } from '@adminium/meta';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { NotFoundError, ValidationFailedError } from '../errors.js';
import { workspaceConnections } from './visibility.js';

/** The query field every narrowing list takes. */
export const workspaceIdQuery = z.string().min(1).max(36).optional();

/**
 * A route's `preSerialization` hook: the rows of `list` (a field of the
 * reply) whose database, read by `connectionOf`, is in the workspace. A row
 * of no database (server-wide) is kept only when `keepServerWide`.
 */
export function narrowToWorkspace(
  /** The meta store, or how to find it when the request comes: a route is registered before its scope's RBAC decorator may be. */
  meta: MetaDb | (() => MetaDb),
  list: string,
  connectionOf: (row: Record<string, unknown>) => string | null | undefined | Promise<string | null | undefined>,
  options: { keepServerWide?: boolean } = {},
) {
  return async (request: FastifyRequest, _reply: FastifyReply, payload: unknown): Promise<unknown> => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const workspaceId = typeof query['workspaceId'] === 'string' && query['workspaceId'] !== '' ? query['workspaceId'] : undefined;
    if (workspaceId === undefined) return payload;
    // As sent: a route's own query schema may not keep a `connectionId` it does not filter by.
    const sent = new URL(request.raw.url ?? '/', 'http://adminium.invalid').searchParams.get('connectionId');
    if ((typeof query['connectionId'] === 'string' && query['connectionId'] !== '') || (sent !== null && sent !== '')) {
      throw new ValidationFailedError('Name a workspace or a database, not both.', { workspaceId, connectionId: query['connectionId'] ?? sent });
    }
    const allowed = await workspaceConnections(typeof meta === 'function' ? meta() : meta, request, workspaceId);
    if (allowed === null) throw new NotFoundError('There is no such workspace.', { workspaceId });
    if (payload === null || typeof payload !== 'object') return payload;
    const rows = (payload as Record<string, unknown>)[list];
    if (!Array.isArray(rows)) return payload;
    const kept = [];
    for (const row of rows) {
      const connectionId = await connectionOf(row as Record<string, unknown>);
      if (connectionId === null || connectionId === undefined ? options.keepServerWide === true : allowed.has(connectionId)) kept.push(row);
    }
    return { ...(payload as Record<string, unknown>), [list]: kept };
  };
}
