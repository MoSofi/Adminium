// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A page config as a project file holds it, turned into the document the page
 * renderer takes: the browser half of `apps/server/src/project/page-files.ts`.
 *
 * A file names databases by their key in `adminium.config.ts` (`database`),
 * and storage destinations by name. Here a key becomes the connection id the
 * bootstrap payload lists for it; a destination name is dropped, which means
 * the default destination, because the dashboard does not know the others.
 */

import { createContext, useContext } from 'react';

import type { PageTemplateProps } from '../pages/template-types.js';

/** Keys that describe a page file, not the page. */
const FILE_KEYS = new Set(['$schema', 'origin', 'enabled', 'generated']);

export type LocalPageResult =
  | { ok: true; envelope: Record<string, unknown> }
  | { ok: false; problems: string[] };

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function toLocalPageEnvelope(
  file: Readonly<Record<string, unknown>>,
  databases: Readonly<Record<string, string>>,
  id: string,
): LocalPageResult {
  const problems: string[] = [];
  const map = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) return node.map((item, index) => map(item, `${path}[${String(index)}]`));
    const record = asObject(node);
    if (record === null) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      const at = path === '' ? key : `${path}.${key}`;
      if (path === '' && FILE_KEYS.has(key)) continue;
      if (key === 'database' && (value === null || typeof value === 'string')) {
        if (value === null) {
          out['connectionId'] = null;
        } else if (Object.hasOwn(databases, value)) {
          out['connectionId'] = databases[value];
        } else {
          problems.push(`${at}: "${value}" is not a database in adminium.config.ts, or it has no connection yet`);
        }
        continue;
      }
      if (key === 'destination' && typeof value === 'string') continue;
      out[key] = map(value, at);
    }
    return out;
  };
  const envelope = map(file, '') as Record<string, unknown>;
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, envelope: { ...envelope, id } };
}

/** What the server resolved for the page's own table, as `TemplateMount` passes it. */
export type ProjectPageTableAccess = Pick<
  PageTemplateProps,
  'canCreate' | 'canUpdate' | 'canDelete' | 'canAttach' | 'canUnmask' | 'currency'
>;

/** The project page being rendered, for the kit pieces that need to know it. */
export interface ProjectPageInfo {
  slug: string;
  pageId: string;
  /** The page's data source: none for a page of code, its page file's for an ejected page. */
  source?: { connectionId: string | null; table: string | null } | undefined;
  /** Set on the page's record route, `/p/<slug>/r/<id>`. */
  recordId?: string | undefined;
  /** The person's write permissions on `source`'s table. */
  table?: ProjectPageTableAccess | undefined;
}

export const ProjectPageContext = createContext<ProjectPageInfo | null>(null);

export function useProjectPage(): ProjectPageInfo | null {
  return useContext(ProjectPageContext);
}
