/**
 * Per-template gutter defaults for the tenant page templates.
 *
 * PageRenderer wraps every mounted template in one `PageSurface` built from
 * this table, so the bindings themselves draw no gutter. That is the point:
 * the padding of `/p/<slug>` is decided in ONE readable list, not by whichever
 * of fourteen binding files last got edited. Before this, `page-crud` carried
 * `p-[var(--main-pad)]` and the other thirteen carried nothing at all, which is
 * why moving between two pages of the same generated app changed the gutter.
 *
 * A page's stored `padding` config overrides the `padding` column here
 * (`resolvePagePadding`); `width` and `fill` stay template-owned, since they
 * describe how the layout is built rather than how much air it sits in.
 */
import type { PagePadding, PageSurfaceWidth } from '../shell/PageSurface.js';

export interface TemplateSurface {
  padding: PagePadding;
  width: PageSurfaceWidth;
  /** Template resolves its own `h-full` chain and manages its own scrolling. */
  fill: boolean;
}

/** Anything not listed — including templates from a future build. */
export const DEFAULT_TEMPLATE_SURFACE: TemplateSurface = {
  padding: 'standard',
  width: 'full',
  fill: false,
};

/*
 * Stored as three deviation lists rather than one row per template: every
 * template shares the `standard` gutter and only a handful differ on width or
 * height, so a full table spent most of its bytes restating the default — and
 * this file is in the synchronously-loaded entry set that
 * `scripts/check-entry-budget.mjs` ratchets.
 */

/** Templates whose children scroll internally, so the gutter must not scroll away. */
const FILLS = new Set([
  'page-crud',
  'page-directory',
  'page-board',
  'page-calendar',
  'page-scheduler',
  'page-master-detail',
  'page-queue-inbox',
  'page-log-viewer',
  'page-files',
  'page-chat',
  'page-builder',
]);

/*
 * Only the templates that ALREADY capped their column. This table carries the
 * caps forward; it is not a place to retro-fit one onto a template that used
 * the full width, which is why `page-directory`, `page-board` and the rest are
 * absent rather than set to a plausible-looking `wide`.
 */
const WIDTHS: Record<string, PageSurfaceWidth> = {
  'page-crud': 'wide',
  // Widest column in the app: a 12-column widget grid at `--container-page`
  // (1080px) squeezed each column to ~76px, which is what `dash` exists to fix.
  'page-dashboard': 'dash',
  'page-builder': 'page',
  // The import wizard's own column, `max-w-4xl` (896px) before this, rounded to
  // the 900px reading column — the one width the padding spec asks for.
  'page-wizard': 'content',
};

/**
 * The one full-bleed template. Chat's inbox rail and message pane draw their
 * own edges and are meant to meet the main section on all four sides; a gutter
 * there reads as a floating card, not a chat client.
 */
const FLUSH = 'page-chat';

export function templateSurface(templateId: string): TemplateSurface {
  return {
    padding: templateId === FLUSH ? 'none' : DEFAULT_TEMPLATE_SURFACE.padding,
    width: WIDTHS[templateId] ?? DEFAULT_TEMPLATE_SURFACE.width,
    fill: FILLS.has(templateId),
  };
}
