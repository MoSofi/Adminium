/**
 * Dashboard layout-persistence hooks (04-widget-registry.md §6.3) — the save
 * surface the builder (04-T14, Batch 2) consumes. Three write paths plus the
 * resolved-layout read:
 *
 *   useSaveSharedLayout   → debounced (800 ms) PATCH of the shared default
 *   useSavePersonalLayout → debounced (800 ms) PUT of the caller's override
 *   useResetLayout        → DELETE the override ("Reset layout")
 *   useResolvedLayout     → the server-resolved layout (override wins) for a page
 *
 * Every write invalidates the page document (`['page', pageId]`), the single
 * source the renderer and `useResolvedLayout` both read, so a save reflects
 * without a reload. Continuous drag/resize produces a burst of layouts; the
 * trailing debounce collapses them into one request, and `flush()` lets the
 * builder force the pending save on blur / edit-mode exit.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pageLayoutSchema, type PageLayout } from '@adminium/widgets/page-config';

import { pageQuery } from '../../api/pages.js';
import { layoutApi } from './layoutApi.js';

/** Trailing debounce for continuous drag/resize saves (04 §6.3). */
export const LAYOUT_SAVE_DEBOUNCE_MS = 800;

function pageKey(pageId: string): readonly ['page', string] {
  return ['page', pageId];
}

export interface DebouncedLayoutSave {
  /** Schedule a trailing save; supersedes any pending one. */
  save: (layout: PageLayout) => void;
  /** Fire the pending save immediately (blur / exit edit mode). */
  flush: () => Promise<void>;
  /** Drop the pending save WITHOUT firing it (e.g. before a Reset DELETE, so a
   *  trailing PUT can't re-create the override the reset just removed). */
  cancel: () => void;
  /** A request is in flight. */
  isSaving: boolean;
}

/** Wrap a layout mutation in a trailing debounce with an imperative flush. */
function useDebouncedLayoutSave(
  mutate: (layout: PageLayout) => Promise<PageLayout>,
  delayMs: number,
): DebouncedLayoutSave {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<PageLayout | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const run = useCallback(async (): Promise<void> => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const layout = pending.current;
    pending.current = null;
    if (layout === null) return;
    setIsSaving(true);
    try {
      await mutate(layout);
    } finally {
      setIsSaving(false);
    }
  }, [mutate]);

  const save = useCallback(
    (layout: PageLayout): void => {
      pending.current = layout;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void run();
      }, delayMs);
    },
    [delayMs, run],
  );

  const cancel = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pending.current = null;
  }, []);

  // Cancel a pending timer on unmount — never fire a save into a dead tree.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return { save, flush: run, cancel, isSaving };
}

/** Debounced PATCH of the shared default layout (Admin+ / page-edit). */
export function useSaveSharedLayout(pageId: string): DebouncedLayoutSave {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (layout: PageLayout) => layoutApi.saveShared(pageId, layout),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pageKey(pageId) }),
  });
  return useDebouncedLayoutSave(mutation.mutateAsync, LAYOUT_SAVE_DEBOUNCE_MS);
}

/** Debounced PUT of the caller's personal layout override. */
export function useSavePersonalLayout(pageId: string): DebouncedLayoutSave {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (layout: PageLayout) => layoutApi.savePersonal(pageId, layout),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pageKey(pageId) }),
  });
  return useDebouncedLayoutSave(mutation.mutateAsync, LAYOUT_SAVE_DEBOUNCE_MS);
}

export interface ResetLayout {
  reset: () => Promise<void>;
  isResetting: boolean;
}

/** DELETE the personal override; the shared default resolves again on refetch. */
export function useResetLayout(pageId: string): ResetLayout {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => layoutApi.reset(pageId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pageKey(pageId) }),
  });
  return {
    reset: () => mutation.mutateAsync(),
    isResetting: mutation.isPending,
  };
}

/** Pull the (already server-resolved) layout out of a loaded page document. */
export function resolvedLayoutFromDocument(page: {
  config?: Record<string, unknown> | undefined;
}): PageLayout | null {
  const parsed = pageLayoutSchema.safeParse(page.config?.['layout']);
  return parsed.success ? parsed.data : null;
}

export interface ResolvedLayout {
  /** The resolved layout (override wins), or null while loading / when invalid. */
  layout: PageLayout | null;
  isLoading: boolean;
}

/**
 * The server-resolved layout for a page — reads the same `['page', pageId]`
 * document the renderer uses (the server already applied override-wins
 * resolution), so it stays in lockstep with saves without a second fetch.
 */
export function useResolvedLayout(pageId: string): ResolvedLayout {
  const query = useQuery(pageQuery(pageId));
  const result = query.data;
  const layout =
    result !== undefined && result.status === 'ok'
      ? resolvedLayoutFromDocument(result.page)
      : null;
  return { layout, isLoading: query.isLoading };
}
