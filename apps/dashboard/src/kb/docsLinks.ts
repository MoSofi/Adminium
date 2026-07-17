/**
 * The one place the docs site's origin is written down (14-docs-site.md).
 *
 * Every in-app deep link to documentation resolves through here so that when
 * the docs IA moves, or a self-hoster points at their own mirror, exactly one
 * file changes. Track DOCS owns what lives at these paths; this module owns
 * only the fact that they are addressed from one base.
 */
export const DOCS_BASE_URL = 'https://docs.adminium.dev';

export function docsUrl(path: string): string {
  return `${DOCS_BASE_URL}/${path.replace(/^\/+/, '')}`;
}

/**
 * The GitHub releases page — where "every release" actually lives.
 *
 * Not a docs route: the docs site has no `/releases` page, and the same URL is
 * already the canonical one `apps/server/src/telemetry/update-check.ts`
 * (`RELEASES_PAGE_URL`) sends people to when a new version exists.
 */
export const RELEASES_URL = 'https://github.com/adminium/adminium/releases';

/**
 * Where "search the docs" goes.
 *
 * The docs site's search is Starlight's **pagefind modal**, not a page: there is
 * no `/search` route to deep-link into and no `?q=` to prefill, so a link there
 * 404s — which is a poor thing to hand someone at the exact moment in-app help
 * has already failed them. Send them to the docs home, where the search control
 * is one keystroke away, and let the button's label promise only that.
 */
export const DOCS_SEARCH_URL = DOCS_BASE_URL;
