/**
 * Working-copy layout state for the dashboard builder (04-widget-registry.md
 * §6.2). Holds the draft `PageLayout` being edited plus the current inspector
 * selection, and exposes the add / duplicate / remove / config-edit mutations
 * as pure layout transforms (see `placement.ts`). Persistence (shared vs
 * personal) is wired by the surrounding editor, which watches `draft`/`dirty`.
 */

import { useCallback, useState } from 'react';
import type { WidgetDefinition } from '@adminium/widgets';
import type { PageLayout } from '@adminium/widgets/page-config';

import {
  duplicateItem,
  insertWidget,
  removeItem,
  updateItemConfig,
} from './placement.js';

export interface BuilderLayoutApi {
  draft: PageLayout;
  /** Currently inspected item id, or null. */
  selectedId: string | null;
  /** Has the draft diverged from its last seed. */
  dirty: boolean;
  select: (id: string | null) => void;
  /** Add a widget at first-fit; selects and returns the new item id. */
  add: (definition: WidgetDefinition) => string;
  /** Clone an item; selects and returns the new item id. */
  duplicate: (itemId: string) => string;
  /** Remove an item; clears the selection if it was selected. */
  remove: (itemId: string) => void;
  /** Replace an item's config (live inspector edit). */
  setConfig: (itemId: string, config: Record<string, unknown>) => void;
  /** Replace the whole draft (grid drag/resize settle) and mark dirty. */
  replace: (layout: PageLayout) => void;
  /** Reset the draft to a fresh seed (edit-mode entry, post-reset). */
  reseed: (layout: PageLayout) => void;
  /** Mark the draft persisted (clears `dirty`). */
  markClean: () => void;
}

export function useBuilderLayout(seed: PageLayout): BuilderLayoutApi {
  const [draft, setDraft] = useState<PageLayout>(seed);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const select = useCallback((id: string | null) => setSelectedId(id), []);

  // add/duplicate do NOT open the inspector: selection (drawer-open) stays an
  // explicit "Configure" action, so adding a widget never traps focus in a
  // drawer over the canvas.
  const add = useCallback((definition: WidgetDefinition): string => {
    let created = '';
    setDraft((current) => {
      const next = insertWidget(current, definition);
      created = next.itemId;
      return next.layout;
    });
    setDirty(true);
    return created;
  }, []);

  const duplicate = useCallback((itemId: string): string => {
    let created = '';
    setDraft((current) => {
      const next = duplicateItem(current, itemId);
      created = next.itemId;
      return next.layout;
    });
    if (created !== '') setDirty(true);
    return created;
  }, []);

  const remove = useCallback((itemId: string) => {
    setDraft((current) => removeItem(current, itemId));
    setSelectedId((current) => (current === itemId ? null : current));
    setDirty(true);
  }, []);

  const setConfig = useCallback((itemId: string, config: Record<string, unknown>) => {
    setDraft((current) => updateItemConfig(current, itemId, config));
    setDirty(true);
  }, []);

  const replace = useCallback((layout: PageLayout) => {
    setDraft(layout);
    setDirty(true);
  }, []);

  const reseed = useCallback((layout: PageLayout) => {
    setDraft(layout);
    setSelectedId(null);
    setDirty(false);
  }, []);

  const markClean = useCallback(() => setDirty(false), []);

  return { draft, selectedId, dirty, select, add, duplicate, remove, setConfig, replace, reseed, markClean };
}
