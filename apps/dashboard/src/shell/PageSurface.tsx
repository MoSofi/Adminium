/**
 * The single page gutter (02-design-system.md §1.8 density axis).
 *
 * Every routed screen renders exactly one `PageSurface` as its outermost
 * element. Before it, each page invented its own gutter — `p-6` here,
 * `p-[var(--main-pad)]` there, `p-10` on one wizard, nothing at all on the
 * templates that forward straight to `@adminium/widgets` — so the padding
 * changed every time you moved between two screens of the same app.
 *
 * This owns the INNER main section only. The shell's chrome (sidebar, topbar)
 * is outside it and unaffected; `<main>` in AppShell stays padding-free so this
 * component is the only thing that can set the gutter.
 *
 * Three padding choices, plus a per-page override:
 *
 * - `none`     — flush to the main section on all four sides. For templates
 *                that draw their own full-bleed chrome (chat's two-pane split).
 * - `standard` — `--main-pad`: 28px x / 24px y, scaled by the density axis.
 *                The default, and what nearly every screen wants.
 * - `{x, y}`   — an explicit pair, from the page's stored `padding` config.
 *                Absent from the config ⇒ the template's own default above.
 *
 * `width` is an independent knob layered on top: `content` (900px) is the
 * reading column for screens that are a short stack of controls rather than a
 * grid — import, settings, account.
 */
import type { ReactNode } from 'react';
import { cn } from '@adminium/ui';

/** A stored per-page override: an explicit x/y pair in CSS pixels. */
export interface PagePaddingPair {
  x: number;
  y: number;
}

export type PagePadding = 'none' | 'standard' | PagePaddingPair;

/**
 * Max-width of the column inside the gutter, named after the container tokens.
 *
 * This is NOT part of the padding contract — it exists because the 900px
 * reading column (`content`) has to be expressible, and the rest are here so
 * the pages that already had those caps keep them. A page whose width is not
 * one of these passes `mx-auto max-w-[…]` through `className` instead; the set
 * is deliberately not being used to retro-fit a column onto pages that never
 * had one.
 */
export type PageSurfaceWidth = 'full' | 'narrow' | 'content' | 'page' | 'wide' | 'dash';

const WIDTH_CLASS: Record<PageSurfaceWidth, string> = {
  full: '',
  narrow: 'max-w-narrow',
  content: 'max-w-content',
  page: 'max-w-page',
  wide: 'max-w-widest',
  dash: 'max-w-dash',
};

export interface PageSurfaceProps {
  /** Defaults to `standard` — consistency is what you get for doing nothing. */
  padding?: PagePadding | undefined;
  /** Defaults to `full`: no column cap. */
  width?: PageSurfaceWidth | undefined;
  /**
   * Stretch to the main section's height and become a column, so a template's
   * own `h-full` chain resolves. Grid/table screens need it; a document-flow
   * page that just scrolls does not.
   */
  fill?: boolean | undefined;
  /** Extra layout classes for the page's own content flow (`gap-*`, etc.). */
  className?: string | undefined;
  /** Rendered as `data-testid`, for pages whose old wrapper carried one. */
  testId?: string | undefined;
  children: ReactNode;
}

export function PageSurface({
  padding = 'standard',
  width = 'full',
  fill = false,
  className,
  testId,
  children,
}: PageSurfaceProps) {
  const custom = typeof padding === 'object';

  return (
    <div
      data-part="page-surface"
      data-padding={custom ? 'custom' : padding}
      data-testid={testId}
      className={cn(
        'w-full',
        padding === 'standard' && 'p-[var(--main-pad)]',
        custom && 'p-[var(--adm-page-pad)]',
        width !== 'full' && `mx-auto ${WIDTH_CLASS[width]}`,
        fill && 'flex h-full min-h-0 flex-col',
        className,
      )}
      /* A stored pair only exists at runtime, and Tailwind generates utilities
         from source TEXT — so the pair rides a custom property that the literal
         `p-[var(--adm-page-pad)]` above reads. A custom property is also the
         only `style` the design system allows (02 §7, adminium/no-style-prop),
         which is why this is a plain literal rather than a conditional object. */
      style={{
        '--adm-page-pad': custom ? `${String(padding.y)}px ${String(padding.x)}px` : undefined,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Resolves a page envelope's stored `padding` against the template's default.
 *
 * `undefined` — the common case — means the admin never touched the control, so
 * the template keeps whatever it chose. Only an explicit stored value overrides.
 */
export function resolvePagePadding(stored: unknown, templateDefault: PagePadding): PagePadding {
  if (stored === 'none' || stored === 'standard') return stored;
  if (typeof stored === 'object' && stored !== null) {
    const { x, y } = stored as PagePaddingPair;
    // `>= 0` also rejects NaN and non-numbers, so a hand-edited or
    // future-version document degrades to the default rather than to a broken
    // layout (09 §3.1 never-crash).
    if (typeof x === 'number' && typeof y === 'number' && x >= 0 && y >= 0) return { x, y };
  }
  return templateDefault;
}
