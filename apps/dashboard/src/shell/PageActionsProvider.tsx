// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Page → topbar channel (03 app-shell, and the Analytics comp's header, whose
 * right cluster carries a page-owned range control and Export button next to
 * the shell's own search/bell/avatar).
 *
 * Until this landed a page had no way to put anything in the header: `Topbar`
 * took a title and four shell callbacks, and every page rendered its own
 * in-content toolbar instead. The channel exists so the APP-SIDE bindings can
 * hoist page-level chrome; the `@adminium/widgets` templates must keep out of
 * it, since they ship without the app's React context.
 *
 * Two payloads, two mechanisms, deliberately:
 *
 * - **Actions travel by portal.** A `ReactNode` has no stable identity across
 *   renders, so pushing one into context state needs either a hand-maintained
 *   dependency array at every call site or a re-render of the entire shell on
 *   every page render. A portal has neither problem: the node stays in the
 *   page's React tree (its context, its closures, its event bubbling) and only
 *   its DOM position moves.
 * - **The subtitle travels by state.** It is a string, so it compares cheaply
 *   and its effect has honest dependencies — and `Topbar` needs the value
 *   itself, not a slot, to decide whether the title block is one line or two.
 *
 * One publisher per page: a second live `<PageActions>` overwrites the first's
 * subtitle and portals into the same container.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@adminium/ui';

interface PageActionsChannel {
  /** Topbar mount point for portalled action nodes; null until the slot mounts. */
  container: HTMLElement | null;
  setContainer: (element: HTMLElement | null) => void;
  subtitle: string | null;
  setSubtitle: (subtitle: string | null) => void;
  title: string | null;
  setTitle: (title: string | null) => void;
  backTo: string | null;
  setBackTo: (backTo: string | null) => void;
}

const PageActionsContext = createContext<PageActionsChannel | null>(null);

/** Wraps the Topbar + routed outlet pair so the slot and its publishers share a channel. */
export function PageActionsProvider({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [backTo, setBackTo] = useState<string | null>(null);
  const value = useMemo<PageActionsChannel>(
    () => ({ container, setContainer, subtitle, setSubtitle, title, setTitle, backTo, setBackTo }),
    [container, subtitle, title, backTo],
  );
  return <PageActionsContext.Provider value={value}>{children}</PageActionsContext.Provider>;
}

/**
 * The topbar mount point. `empty:hidden` matters: an always-rendered empty div
 * would still consume one `gap` step of the right cluster on every page that
 * publishes nothing, shifting search/bell/avatar by 10px for no reason.
 */
export function PageActionsSlot({ className }: { className?: string }) {
  const channel = useContext(PageActionsContext);
  if (channel === null) return null;
  return (
    <div
      ref={channel.setContainer}
      data-part="topbar-page-actions"
      className={cn('flex items-center gap-2 empty:hidden', className)}
    />
  );
}

/** The published page subtitle, or null outside a provider / when nothing is published. */
export function usePageSubtitle(): string | null {
  return useContext(PageActionsContext)?.subtitle ?? null;
}

/**
 * The published topbar heading. Null means "the shell derives it", which is
 * right for `/p/$slug` (the nav row already names it) and wrong for a routed
 * sub-screen like a page editor: the shell's fallback is `nav.home`, so those
 * screens read "Home" while their own <h1> says something else.
 */
export function usePageTitle(): string | null {
  return useContext(PageActionsContext)?.title ?? null;
}

/** Where the topbar's back control returns to, or null for no back control. */
export function usePageBackTo(): string | null {
  return useContext(PageActionsContext)?.backTo ?? null;
}

export interface PageActionsProps {
  /** Topbar h1 for this screen. Overrides the shell's path-derived title. */
  title?: string | undefined;
  /** Secondary line under the topbar h1 — page context, not a restatement of the title. */
  subtitle?: string | undefined;
  /**
   * Path the topbar's back control returns to. A sub-screen reached from a
   * list publishes the list's path; omit it and no back control renders.
   */
  backTo?: string | undefined;
  /** Controls rendered at the start of the topbar's right cluster. */
  children?: ReactNode;
}

/**
 * Publishes topbar content for as long as it is mounted. A component rather
 * than a hook so `children` re-render with the page — no dependency array to
 * keep in sync, and no stale closure in a hoisted button's onClick.
 *
 * Render it anywhere inside the page; it draws nothing where it sits.
 */
export function PageActions({ title, subtitle, backTo, children }: PageActionsProps): ReactNode {
  const channel = useContext(PageActionsContext);
  const setSubtitle = channel?.setSubtitle;
  const setTitle = channel?.setTitle;
  const setBackTo = channel?.setBackTo;

  useEffect(() => {
    if (setSubtitle === undefined || subtitle === undefined) return;
    setSubtitle(subtitle);
    // Clearing on unmount is what stops one page's subtitle bleeding onto the
    // next: React runs every destroy before any create in the same commit, so a
    // route swap clears then republishes rather than the reverse.
    return () => setSubtitle(null);
  }, [setSubtitle, subtitle]);

  // Same publish-and-clear contract as the subtitle, for the same reason: a
  // stale title or back arrow surviving a route change is worse than none.
  useEffect(() => {
    if (setTitle === undefined || title === undefined) return;
    setTitle(title);
    return () => setTitle(null);
  }, [setTitle, title]);

  useEffect(() => {
    if (setBackTo === undefined || backTo === undefined) return;
    setBackTo(backTo);
    return () => setBackTo(null);
  }, [setBackTo, backTo]);

  if (channel === null || channel.container === null || children === undefined) return null;
  return createPortal(children, channel.container);
}
