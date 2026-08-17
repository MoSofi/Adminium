// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The workspace's mark and name — the one component that decides what
 * "Adminium" is called and what its logo looks like on any given install.
 *
 * Adminium ships white-label: an operator sets `branding.appName` and uploads
 * a logo, and every surface that used to hardcode the hexagon and the word
 * follows. Those surfaces are not all signed in — the sign-in screen, the 404
 * and the error heroes render with no session — which is why the underlying
 * query hits the PUBLIC `/branding` route and why this component renders the
 * built-in mark, not a spinner or a gap, while that query is in flight: chrome
 * that flickers between two identities on every cold load is worse than chrome
 * that starts neutral.
 *
 * `tone` exists because the mark sits on three different grounds: the accent
 * tile of the rail, a translucent well on the auth screen's coloured panel,
 * and nothing at all when a caller supplies its own frame.
 */
import { useContext, useEffect } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { Hexagon } from 'lucide-react';
import { cn } from '@adminium/ui';

import { brandingQuery, DEFAULT_BRANDING, type BrandingData } from '../app/branding.js';

/** Stand-in for the surfaces that render outside a provider; never fetches. */
const DETACHED_CLIENT = new QueryClient();

/**
 * The live branding, falling back to the built-in identity until it loads.
 *
 * The provider check is not defensive habit: `StateHero` is the surface the
 * app shows when it is broken, and it is mounted by error boundaries that can
 * sit ABOVE `QueryClientProvider`. `useQuery` throws without a client, so a
 * branded mark on that screen would have turned "the API is down" into a blank
 * page. No client → no branding, and the built-in mark renders.
 */
export function useBranding(): BrandingData {
  // The cast is a types-only artifact: react-query's `Context<QueryClient |
  // undefined>` is built against its own copy of @types/react, so this app's
  // `useContext` widens the value to `{}`. One runtime context either way.
  const client = useContext(QueryClientContext) as QueryClient | undefined;
  // `useQuery` resolves its client from the context OR this second argument,
  // and throws when it finds neither — so the detached client is what keeps
  // the hook unconditional (hooks rules) while `enabled: false` keeps it inert.
  const { data } = useQuery(
    { ...brandingQuery(), enabled: client !== undefined },
    client ?? DETACHED_CLIENT,
  );
  return data ?? DEFAULT_BRANDING;
}

/**
 * Keeps the browser tab named after the workspace. `index.html` ships the
 * built-in title for the pre-hydration paint; this is what makes a rebrand
 * reach the one piece of chrome that lives outside React's tree — including
 * the bookmark and the window title of the desktop build.
 */
export function useBrandedDocumentTitle(): void {
  const { appName } = useBranding();
  useEffect(() => {
    document.title = appName;
  }, [appName]);
}

export interface BrandMarkProps {
  /**
   * `accent` — filled accent tile (sidebar, 404).
   * `onAccent` — translucent well for a mark already sitting on accent (auth).
   * `muted` — small dim variant (state heroes).
   */
  tone?: 'accent' | 'onAccent' | 'muted';
  /** Hide the wordmark and render the tile alone. */
  nameHidden?: boolean;
  /** The rail's accent bloom (`shadow-glow`) behind the built-in tile. */
  glow?: boolean;
  className?: string | undefined;
}

/** The square the mark occupies — identical for the fallback tile and a logo. */
const TILE_SIZE = {
  accent: 'size-[30px] rounded-[9px]',
  onAccent: 'size-[30px] rounded-[9px]',
  muted: 'size-[22px] rounded-[7px]',
} as const;

/** Plate colours for the BUILT-IN mark only; an uploaded logo brings its own. */
const TILE_BG = {
  accent: 'bg-accent text-accent-fg',
  onAccent: 'bg-white/15',
  muted: 'bg-accent text-accent-fg',
} as const;

const GLYPH_SIZE = { accent: 'size-[17px]', onAccent: 'size-[17px]', muted: 'size-3' } as const;

// No text colour on `onAccent`/`muted`: those sit on grounds that already set
// one (the auth panel is white-on-accent), and forcing `text-fg` there paints
// the wordmark dark on a dark panel.
const NAME_TONE = {
  accent: 'text-[16px] font-extrabold tracking-[-0.02em] text-fg',
  onAccent: 'text-[16px] font-extrabold tracking-[-0.02em]',
  muted: 'text-[12px] font-bold',
} as const;

export function BrandMark({
  tone = 'accent',
  nameHidden = false,
  glow = false,
  className,
}: BrandMarkProps) {
  const { appName, logoUrl } = useBranding();

  return (
    <span data-part="brand-mark" className={cn('flex items-center gap-2.5', className)}>
      {logoUrl === null ? (
        <span
          className={cn(
            'flex shrink-0 items-center justify-center',
            TILE_SIZE[tone],
            TILE_BG[tone],
            glow ? 'shadow-glow' : '',
          )}
        >
          <Hexagon className={GLYPH_SIZE[tone]} aria-hidden="true" />
        </span>
      ) : (
        /* Same square, `object-contain`: an uploaded logo is any aspect ratio
           and the rail reserves one box. Deliberately no plate behind it — a
           coloured square under a transparent PNG is how a white-labelled app
           looks unfinished. `alt=""` because the wordmark beside it already
           names the workspace; with `nameHidden` the caller labels the mark. */
        <img
          src={logoUrl}
          alt=""
          data-part="brand-logo"
          className={cn('shrink-0 object-contain', TILE_SIZE[tone])}
        />
      )}
      {nameHidden ? null : (
        <span data-part="brand-name" className={cn('truncate', NAME_TONE[tone])}>
          {appName}
        </span>
      )}
    </span>
  );
}
