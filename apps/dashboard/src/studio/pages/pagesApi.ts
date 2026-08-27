// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio page-manager API client (08-server-api.md §2.6).
 *
 * Shapes mirror the server Zod reply schemas in
 * `apps/server/src/routes/pages/schema.ts` — the copied-mirror convention from
 * `app/bootstrap.ts` applies: change both together.
 *
 * Every mutation invalidates `['bootstrap']` as well as `['studio', 'pages']`.
 * The sidebar is rendered from the bootstrap nav tree, which is a projection of
 * exactly the rows these calls write, and its query holds `staleTime: Infinity`
 * — without the second invalidation a rename or reorder would be correct on the
 * server, correct in this list, and stale in the rail beside it until reload.
 */

import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { PagePaddingConfig, PageWidthConfig } from '@adminium/engine/config';

import { api } from '../../app/api.js';

/** The five fixed sidebar buckets (09 §2.2). Mirrors `NAV_GROUP_KEYS`. */
export const NAV_GROUPS = ['workspace', 'library', 'planning', 'people', 'account'] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export function isNavGroup(value: string | null): value is NavGroup {
  return value !== null && (NAV_GROUPS as readonly string[]).includes(value);
}

/**
 * How a page came to exist. It is not cosmetic — it decides what the manager
 * may offer:
 *
 * - `generated` — the Engine owns it. Edits survive regeneration (they make the
 *   envelope hash stale, which the generator reads as "a human touched this"),
 *   but deleting it only lasts until the next run re-creates it.
 * - `manifest` — an add-on owns it; the server refuses to delete it.
 * - `user` — created here.
 * - `llm` / `system` — seeded by the assistant or the first-run bootstrap.
 */
export type PageOrigin = 'generated' | 'user' | 'manifest' | 'system' | 'llm';

export interface PageSummaryDto {
  id: string;
  connectionId: string | null;
  slug: string;
  /** Page-template id (`page-crud`, `page-dashboard`, …). */
  type: string;
  title: string;
  icon: string | null;
  navGroup: string | null;
  navOrder: number;
  origin: string;
  manifestId: string | null;
  isEnabled: boolean;
  revision: number;
  updatedAt: number;
}

export interface CreatePageInput {
  slug: string;
  title: string;
  template: string;
  navGroup: NavGroup;
  icon?: string | null;
  connectionId?: string | null;
  table?: string | null;
  /** Page gutter; omit for the template's own default. */
  padding?: PagePaddingConfig | null;
  /** Content column; omit for the template's own default. */
  width?: PageWidthConfig | null;
}

export interface UpdatePageInput {
  slug?: string;
  title?: string;
  icon?: string | null;
  navGroup?: NavGroup;
  navOrder?: number;
  isEnabled?: boolean;
  /**
   * Page gutter. `null` CLEARS the override back to the template default;
   * omitting the key leaves whatever is stored untouched.
   */
  padding?: PagePaddingConfig | null;
  /** Content column, on the same "null clears" contract as `padding`. */
  width?: PageWidthConfig | null;
  /** 08 §2.6 optimistic concurrency — the revision this client last read. */
  expectedRevision?: number;
}

export const PAGES_QUERY_KEY = ['studio', 'pages'] as const;

export function studioPagesQuery() {
  return queryOptions({
    queryKey: PAGES_QUERY_KEY,
    queryFn: async (): Promise<PageSummaryDto[]> => {
      const reply = await api.get<{ data: PageSummaryDto[] }>('/api/v1/pages');
      return reply.data;
    },
  });
}

export async function createPage(input: CreatePageInput): Promise<PageSummaryDto> {
  const reply = await api.post<{ data: PageSummaryDto }>('/api/v1/pages', input);
  return reply.data;
}

export async function updatePage(pageId: string, patch: UpdatePageInput): Promise<PageSummaryDto> {
  const reply = await api.patch<{ data: PageSummaryDto }>(
    `/api/v1/pages/${encodeURIComponent(pageId)}`,
    patch,
  );
  return reply.data;
}

export async function duplicatePage(
  pageId: string,
  input: { slug: string; title: string },
): Promise<PageSummaryDto> {
  const reply = await api.post<{ data: PageSummaryDto }>(
    `/api/v1/pages/${encodeURIComponent(pageId)}/duplicate`,
    input,
  );
  return reply.data;
}

export async function deletePage(pageId: string): Promise<void> {
  await api.delete(`/api/v1/pages/${encodeURIComponent(pageId)}`);
}

export async function saveNavOrder(
  items: readonly { pageId: string; navGroup: NavGroup }[],
): Promise<number> {
  const reply = await api.put<{ data: { moved: number } }>('/api/v1/pages/nav-order', { items });
  return reply.data.moved;
}

/** Replace a page's per-template config body (its items). */
export async function savePageConfig(
  pageId: string,
  config: Record<string, unknown>,
  expectedRevision?: number,
): Promise<PageSummaryDto> {
  const reply = await api.patch<{ data: PageSummaryDto }>(
    `/api/v1/pages/${encodeURIComponent(pageId)}/config`,
    expectedRevision === undefined ? { config } : { config, expectedRevision },
  );
  return reply.data;
}

/**
 * Drop every cache a page mutation invalidates.
 *
 * `['bootstrap']` is the load-bearing one — see the module docblock. `['page',
 * id]` covers the rendered document when the mutation touched a body, and the
 * whole-prefix invalidation is cheap enough not to bother narrowing.
 */
export async function invalidatePages(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: PAGES_QUERY_KEY }),
    client.invalidateQueries({ queryKey: ['bootstrap'] }),
    client.invalidateQueries({ queryKey: ['page'] }),
  ]);
}

/**
 * The route prefix every page slug lives under (`/p/$slug`, 09 §2.3).
 *
 * Exported so the forms can SHOW it rather than describe it: the field takes
 * the slug alone, and without the prefix on screen "URL" reads like it wants a
 * full path.
 */
export const PAGE_URL_PREFIX = '/p/';

/**
 * Strict slug — the value actually sent to the server. Also the title→slug
 * derivation. Never ends in a dash, so it always satisfies the kebab-case
 * pattern the envelope and the route schema enforce.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    // Strip combining marks so "Café" becomes "cafe", not "caf".
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    // MAX_SLUG_LENGTH in the Engine's id allocator; a longer slug is one
    // `pageIdFor` cannot represent if the page is ever regenerated.
    .slice(0, 31)
    .replace(/-+$/, '');
}

/**
 * Slug sanitizer for a field the user is TYPING into — strict `slugify` plus a
 * trailing dash the user just entered.
 *
 * Running `slugify` itself on every keystroke makes a dash impossible to type:
 * it strips trailing dashes, so a controlled input rewrites `ops-` back to
 * `ops` before the next character arrives, and the help text ends up promising
 * dashes the field silently refuses. Keeping one pending separator lets
 * `ops-overview` be typed a character at a time, while everything else is
 * still normalized live (case, accents, punctuation, length).
 *
 * The trailing dash is not a valid slug, so the caller applies `slugify` again
 * on submit. That is the whole split: lenient while typing, strict on the wire.
 */
export function slugifyInput(raw: string): string {
  const core = slugify(raw);
  if (core === '') return '';
  const endedOnSeparator = /[^a-z0-9]$/i.test(raw);
  return endedOnSeparator && core.length < 31 ? `${core}-` : core;
}

/**
 * Group pages into the five fixed buckets, in sidebar order.
 *
 * Rows whose `navGroup` is null or unrecognized are collected separately: the
 * server's `buildNavTree` drops them from the nav entirely, so they exist and
 * render at `/p/<slug>` but appear in no group. Surfacing them is the only way
 * an admin can find and re-file one.
 */
export interface GroupedPages {
  groups: { key: NavGroup; pages: PageSummaryDto[] }[];
  ungrouped: PageSummaryDto[];
}

export function groupPages(pages: readonly PageSummaryDto[]): GroupedPages {
  const groups = NAV_GROUPS.map((key) => ({
    key,
    pages: pages
      .filter((page) => page.navGroup === key)
      .sort((a, b) => a.navOrder - b.navOrder || a.slug.localeCompare(b.slug)),
  }));
  const ungrouped = pages
    .filter((page) => !isNavGroup(page.navGroup))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return { groups, ungrouped };
}

/**
 * Move one page within its group — the reorder algebra, kept pure so the
 * button controls and any future pointer layer share it and it can be tested
 * without a DOM. Out-of-range moves are no-ops rather than wrapping around.
 */
export function movePage<T>(list: readonly T[], index: number, delta: number): T[] {
  const next = index + delta;
  if (index < 0 || index >= list.length || next < 0 || next >= list.length) return [...list];
  const out = [...list];
  const [moved] = out.splice(index, 1);
  if (moved === undefined) return [...list];
  out.splice(next, 0, moved);
  return out;
}

/**
 * Flatten the grouped rail back into the wire order the bulk endpoint takes.
 * Ungrouped pages are deliberately omitted: they have no position to write,
 * and sending them with an invented group would silently re-file them.
 */
export function toNavOrderPayload(
  groups: readonly { key: NavGroup; pages: readonly PageSummaryDto[] }[],
): { pageId: string; navGroup: NavGroup }[] {
  return groups.flatMap((group) =>
    group.pages.map((page) => ({ pageId: page.id, navGroup: group.key })),
  );
}
