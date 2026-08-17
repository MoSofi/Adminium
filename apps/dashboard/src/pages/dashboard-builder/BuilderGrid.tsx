/**
 * Edit-mode dashboard canvas (04-widget-registry.md §6.2). Renders the working
 * draft on Track GRID's edit-mode `DashboardGrid` (dnd-kit drag, SE-corner
 * resize, keyboard a11y — all owned by the grid) and layers the builder chrome:
 * a configure / duplicate / remove toolbar and a selection ring. The grip is the
 * grid's own `GridDragHandle` (bound to the item's drag activator through grid
 * context). Widgets render from deterministic demo data — the canvas edits
 * layout + config, not live queries.
 *
 * `onLayoutChange` feeds every settled move/resize back into the builder draft;
 * `getSizing` enforces each widget's registry resize floor.
 */

import { Copy, Settings2, Trash2 } from 'lucide-react';
import { useCallback } from 'react';
import {
  DashboardGrid,
  GridDragHandle,
  WidgetHost,
  getWidget,
  resolveOfflineWidgetId,
  useWidgetRuntimeEnv,
  type GridEditLabelsInput,
  type MinSize,
  type WidgetDataState,
} from '@adminium/widgets';
import type { PageLayout } from '@adminium/widgets/page-config';
import { IconButton } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { humanize } from './text.js';
import { widgetDisplayName } from './WidgetPalette.js';
import { seedFromString } from './WidgetPreview.js';

export interface BuilderGridProps {
  draft: PageLayout;
  selectedId: string | null;
  dir: 'ltr' | 'rtl';
  onConfigure: (itemId: string) => void;
  onDuplicate: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  onLayoutChange: (layout: PageLayout) => void;
}

/** Localized grid drag/resize labels + a11y announcements (04 §6.2). */
const gridLabels: GridEditLabelsInput = {
  dragHandle: (title) => t('ui:grid.dragHandle', 'Drag to move {title}', { title }),
  resizeHandle: (title) => t('ui:grid.resizeHandle', 'Resize {title}', { title }),
  announce: {
    grabbed: (title) =>
      t(
        'ui:grid.a11y.grabbed',
        'Grabbed {title}. Use the arrow keys to move, hold Shift to resize, Enter to save, Escape to cancel.',
        { title },
      ),
    moved: (title, col, row) =>
      t('ui:grid.a11y.moved', '{title} moved to column {col}, row {row}.', { title, col, row }),
    resized: (title, w, h) =>
      t('ui:grid.a11y.resized', '{title} resized to {w} columns by {h} rows.', { title, w, h }),
    committed: (title, col, row) =>
      t('ui:grid.a11y.committed', '{title} placed at column {col}, row {row}.', { title, col, row }),
    reverted: (title) => t('ui:grid.a11y.reverted', '{title} returned to its original position.', { title }),
  },
};

export function BuilderGrid({
  draft,
  selectedId,
  dir,
  onConfigure,
  onDuplicate,
  onRemove,
  onLayoutChange,
}: BuilderGridProps) {
  // The canvas must preview what the PAGE will render, and §7's offline policy
  // decides that: `WidgetHost` mounts `resolveOfflineWidgetId(item.widget)`, so
  // the demo data below has to come from the same id. Reading the stored id here
  // fed a map-bubble's lat/lng points to the choropleth tilegram on desktop —
  // a blank map, in the builder the user is authoring the page in.
  const runtimeEnv = useWidgetRuntimeEnv();

  // The floor has to come from the definition that ACTUALLY MOUNTS, not the one
  // stored. §7's offline policy swaps `map-bubble` (min 6×8) for
  // `map-choropleth-grid` (min 4×6) on desktop, so reading the stored id pinned
  // the tilegram to a floor its own component does not need. Same class of bug
  // the comment at the top of this component records fixing for demo data — the
  // sizing resolver was simply missed at the time.
  //
  // The no-definition fallback is the widget-missing card's own sizing, because
  // that is the card that renders when a definition is absent.
  const sizingFor = useCallback(
    (widgetId: string): MinSize => {
      const sizing = getWidget(resolveOfflineWidgetId(widgetId, runtimeEnv))?.sizing;
      return { minW: sizing?.minW ?? 3, minH: sizing?.minH ?? 2 };
    },
    [runtimeEnv],
  );

  return (
    <DashboardGrid
      layout={draft}
      editMode
      dir={dir}
      getSizing={sizingFor}
      labels={gridLabels}
      onLayoutChange={onLayoutChange}
      testId="dashboard-builder-canvas"
      renderItem={(item, ctx) => {
        const definition = getWidget(item.widget);
        // The STORED definition names the item, because the Configure/Duplicate/
        // Remove buttons below act on what the user PLACED — a "Bubble map" is
        // still what they added and still what they would configure.
        const name = definition !== undefined ? widgetDisplayName(definition) : humanize(item.widget);
        // The RESOLVED definition owns the demo data, because §7's policy decides
        // which component `WidgetHost` mounts and the two have different data
        // contracts. Same id ⇒ same object in every online runtime.
        const rendered = getWidget(resolveOfflineWidgetId(item.widget, runtimeEnv));
        const data: WidgetDataState =
          rendered !== undefined
            ? { status: 'success', data: rendered.demoData(seedFromString(item.i)) }
            : { status: 'success', data: undefined };
        const selected = item.i === selectedId;
        return (
          <div
            data-builder-item={item.i}
            className={`group relative h-full rounded-2xl border border-dashed ${
              selected ? 'border-accent ring-2 ring-accent' : 'border-border-strong'
            }`}
          >
            <div className="pointer-events-none h-full [&_*]:pointer-events-none">
              <WidgetHost
                widgetId={item.widget}
                instanceId={item.i}
                config={item.config}
                data={data}
                // The grip belongs in the frame's header slot — `grid-edit.tsx`
                // says so ("rendered by the host inside the WidgetFrame header
                // slot only") and `WidgetFrame` lays it out inline before the
                // title. Absolutely positioning it at the card's top-start
                // instead dropped it ON the title text.
                //
                // `pointer-events-auto!` is load-bearing: the wrapper above
                // neutralizes the preview so a demo widget's own controls are
                // inert, and `[&_*]:pointer-events-none` outranks a plain
                // `pointer-events-auto` on specificity. Without the important
                // flag the grip renders in the right place and cannot be
                // dragged.
                {...(ctx.editMode
                  ? { dragGrip: <GridDragHandle className="pointer-events-auto!" /> }
                  : {})}
              />
            </div>
            <div className="absolute end-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-border bg-surface/95 p-0.5 shadow-sm">
              <IconButton
                size="sm"
                variant="ghost"
                tooltip
                label={t('builder.item.configure', 'Configure {name}', { name })}
                onClick={() => onConfigure(item.i)}
              >
                <Settings2 className="size-4" aria-hidden="true" />
              </IconButton>
              <IconButton
                size="sm"
                variant="ghost"
                tooltip
                label={t('builder.item.duplicate', 'Duplicate {name}', { name })}
                onClick={() => onDuplicate(item.i)}
              >
                <Copy className="size-4" aria-hidden="true" />
              </IconButton>
              <IconButton
                size="sm"
                variant="ghost"
                tooltip
                className="text-danger hover:text-danger"
                label={t('builder.item.remove', 'Remove {name}', { name })}
                onClick={() => onRemove(item.i)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
          </div>
        );
      }}
    />
  );
}
