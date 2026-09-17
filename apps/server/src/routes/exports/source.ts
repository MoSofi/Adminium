// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an export READS, resolved before any grant check — shared by
 * `POST /exports` and `POST /exports/preview`, so a saved view resolves to
 * the same table and the same filters whether it is previewed or written.
 */
import type { FastifyRequest } from 'fastify';
import { pagesRepo, viewsRepo, type MetaDb } from '@adminium/meta';

import { NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';

/**
 * `config.source.table` off a page envelope, which `pagesRepo` stores opaquely.
 * Same narrowing the generate and llm-apply paths do against the same field.
 */
export function pageSourceTable(config: unknown): string | null {
  const source = (config as { source?: { table?: unknown } } | null)?.source;
  return typeof source?.table === 'string' && source.table.length > 0 ? source.table : null;
}

/** The saved grid state a `filters` view stores (routes/views/schema.ts). */
interface ViewQuery {
  search?: unknown;
  sort?: unknown;
  filters?: unknown[];
}

/**
 * What an export actually reads, resolved BEFORE the grant check —
 * "identifier resolution first, then RBAC on the resolved name".
 *
 * A `table` source names its table. A `view` source does NOT: it names a saved
 * grid state, which belongs to a PAGE, and the page carries the binding. So the
 * resolution is view → page → `config.source.table`, and the view's own filters
 * ride along as the query. The grant is then checked on the resolved table
 * exactly as for a direct table export — a saved view is a shortcut through the
 * same door, never a way around it.
 *
 * `page` resolves to nothing and never can: `exportSourceSchema` carries
 * `table`, `viewId` and `filters`, and no field that identifies a page. It is a
 * kind the vocabulary advertises and the payload cannot express.
 */
export async function resolveSource(
  meta: MetaDb,
  source: { kind: 'table' | 'view' | 'page'; table?: string | null | undefined; viewId?: string | null | undefined; filters?: unknown[] | undefined },
  connectionId: string,
  userId: string,
): Promise<{ table: string; filters: unknown[] | undefined; pageId?: string }> {
  if (source.kind === 'page') {
    throw new ValidationFailedError(
      '`source.kind = "page"` cannot be exported: an export source carries no page id. Export the page\'s table, or a saved view of it.',
      { kind: source.kind },
    );
  }

  if (source.kind === 'table') {
    if (typeof source.table !== 'string' || source.table.length === 0) {
      throw new ValidationFailedError('`source.table` is required for a table export.', {
        kind: source.kind,
      });
    }
    return { table: source.table, filters: source.filters };
  }

  if (typeof source.viewId !== 'string' || source.viewId.length === 0) {
    throw new ValidationFailedError('`source.viewId` is required for a view export.', {
      kind: source.kind,
    });
  }
  const saved = await viewsRepo(meta).findById(source.viewId);
  // A view the caller cannot see is reported as absent rather than forbidden:
  // whether a private view exists is itself the owner's business.
  if (saved === null || saved.kind !== 'filters' || (saved.userId !== null && saved.userId !== userId)) {
    throw new NotFoundError(`View ${source.viewId} not found.`);
  }

  const page = await pagesRepo(meta).findById(saved.pageId);
  const table = page === null ? null : pageSourceTable(page.config);
  if (page === null || table === null) {
    throw new ValidationFailedError('That saved view is not bound to a table.', {
      viewId: source.viewId,
    });
  }
  if (page.connectionId !== null && page.connectionId !== connectionId) {
    throw new ValidationFailedError('That saved view belongs to a different connection.', {
      viewId: source.viewId,
    });
  }

  const query = (saved.config ?? {}) as ViewQuery;
  // REFUSED RATHER THAN IGNORED. A view's search narrows what it shows, and an
  // export source has nowhere to carry one — exporting the view without it would
  // hand back MORE rows than the view displays and call the file by the view's
  // name. Sort is dropped silently by contrast, because ordering changes how the
  // same rows are arranged, not which rows they are.
  if (typeof query.search === 'string' && query.search.length > 0) {
    throw new ValidationFailedError(
      'That saved view has a search term, and an export cannot carry one yet — the file would contain more rows than the view shows.',
      { viewId: source.viewId },
    );
  }

  const viewFilters = Array.isArray(query.filters) ? query.filters : undefined;
  const extra = source.filters;
  const filters =
    viewFilters === undefined ? extra : extra === undefined ? viewFilters : [...viewFilters, ...extra];
  // The page rides along so the JOB can compute its derived columns: the
  // export ROW's source has nowhere to carry a page id, and the fact is known
  // here.
  return { table, filters, pageId: saved.pageId };
}

export function requireUserId(request: FastifyRequest): string {
  const user = (request as unknown as { user?: { id?: string } }).user;
  const id = user?.id ?? request.apiKeyPrincipal?.id ?? null;
  if (id === null) throw new UnauthorizedError();
  return id;
}
