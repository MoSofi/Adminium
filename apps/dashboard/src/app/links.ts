// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Navigation href helpers (09-generated-app.md §2.3): the only way shell and
 * page code build links to generated pages. Leaf module (no router import) so
 * PageRenderer can consume it without a router.tsx ↔ pages cycle; router.tsx
 * re-exports them as its public API.
 */
export function hrefForPage(slug: string): string {
  return `/p/${encodeURIComponent(slug)}`;
}

export function hrefForRecord(slug: string, recordId: string): string {
  return `/p/${encodeURIComponent(slug)}/r/${encodeURIComponent(recordId)}`;
}
