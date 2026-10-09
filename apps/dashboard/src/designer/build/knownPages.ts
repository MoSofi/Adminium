// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pages the address bar can offer on each side.
 *
 * The dashboard's are the app's own pages, as the engine applied them. The
 * staff side's are the screens its `nav.json` lists, read as the file it is.
 * A customer side lists nothing anywhere: its pages are the ones this
 * preview has been on, each with the title the page gave itself.
 */
import { useQuery } from '@tanstack/react-query';

import { architectureQuery, designerApi, designerKeys, type ArchitectureDoc } from '../api.js';
import type { KnownPage } from './AddressBar.js';
import { tidyPagePath, type VisitedPage } from './pagePath.js';
import type { PreviewSide } from './usePreview.js';

/** The dashboard's pages of this app: `/p/<page>`, with the page's own name. */
export function dashboardPages(doc: ArchitectureDoc | undefined): KnownPage[] {
  return (doc?.lists.pages ?? []).flatMap((page) => {
    const path = tidyPagePath(`/p/${page.ref}`);
    return path === null ? [] : [{ path, name: page.name }];
  });
}

/** A label of `nav.json`: plain words, or words for each language (English, else the first there is). */
function navLabel(label: unknown): string {
  if (typeof label === 'string') return label.slice(0, 80);
  if (label === null || typeof label !== 'object') return '';
  const words = label as Record<string, unknown>;
  const first = words['en-US'] ?? Object.values(words)[0];
  return typeof first === 'string' ? first.slice(0, 80) : '';
}

/** The staff side's screens from the text of its `nav.json`; nothing when the file is not what such a file is. */
export function staffPages(content: string | undefined): KnownPage[] {
  let entries: unknown;
  try {
    entries = JSON.parse(content ?? '');
  } catch {
    return [];
  }
  if (!Array.isArray(entries)) return [];
  const pages: KnownPage[] = [];
  for (const entry of entries.slice(0, 60)) {
    const raw = (entry as { path?: unknown } | null)?.path;
    const path = typeof raw === 'string' ? tidyPagePath(`/${raw}`) : null;
    if (path === null || pages.some((page) => page.path === path)) continue;
    pages.push({ path, name: navLabel((entry as { label?: unknown }).label) });
  }
  return pages;
}

export function customerPages(visited: readonly VisitedPage[]): KnownPage[] {
  return visited.map((page) => ({ path: page.path, name: page.title }));
}

/** The pages to offer on the side being shown. A list that cannot be read is an empty one: a typed path still goes. */
export function useKnownPages(sessionId: string, appKey: string, side: PreviewSide, visited: readonly VisitedPage[], enabled: boolean): KnownPage[] {
  const architecture = useQuery({ ...architectureQuery(sessionId), enabled: enabled && side === 'dashboard' });
  const navPath = `apps/${appKey}/staff/nav.json`;
  const nav = useQuery({
    // Under the files' own key: what asks for the files again (a turn's end, a save, a hold let go) asks for this list too.
    queryKey: [...designerKeys.files(sessionId), 'content', navPath] as const,
    queryFn: () => designerApi.fileContent(sessionId, navPath),
    enabled: enabled && side === 'staff',
    retry: false,
  });
  if (side === 'dashboard') return dashboardPages(architecture.data);
  if (side === 'staff') return staffPages(nav.data?.content);
  return customerPages(visited);
}
