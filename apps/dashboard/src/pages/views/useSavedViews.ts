// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Saved-views query + mutations for one page-crud page (M5-T06). Kept separate
 * from the switcher UI so the binding can auto-apply a default view on load and
 * the switcher stays presentational.
 */

import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { viewsApi, type SavedView, type ViewConfig, type ViewWriteBody } from './viewsApi.js';

export function savedViewsKey(pageId: string): readonly ['views', string] {
  return ['views', pageId];
}

export function savedViewsQuery(pageId: string) {
  return queryOptions({
    queryKey: savedViewsKey(pageId),
    queryFn: () => viewsApi.list(pageId),
    staleTime: 60_000,
  });
}

export interface ViewUpdatePatch {
  name?: string;
  config?: ViewConfig;
  isDefault?: boolean;
}

export interface UseSavedViews {
  views: SavedView[];
  isLoading: boolean;
  isMutating: boolean;
  createView: (body: ViewWriteBody) => Promise<SavedView>;
  updateView: (viewId: string, patch: ViewUpdatePatch) => Promise<SavedView>;
  deleteView: (viewId: string) => Promise<void>;
}

export function useSavedViews(pageId: string): UseSavedViews {
  const queryClient = useQueryClient();
  const query = useQuery(savedViewsQuery(pageId));

  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: savedViewsKey(pageId) });

  const createMutation = useMutation({
    mutationFn: (body: ViewWriteBody) => viewsApi.create(pageId, body),
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: (vars: { viewId: string; patch: ViewUpdatePatch }) =>
      viewsApi.update(pageId, vars.viewId, vars.patch),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (viewId: string) => viewsApi.remove(pageId, viewId),
    onSuccess: invalidate,
  });

  return {
    views: query.data ?? [],
    isLoading: query.isLoading,
    isMutating: createMutation.isPending || updateMutation.isPending || deleteMutation.isPending,
    createView: (body) => createMutation.mutateAsync(body),
    updateView: (viewId, patch) => updateMutation.mutateAsync({ viewId, patch }),
    deleteView: (viewId) => deleteMutation.mutateAsync(viewId),
  };
}
