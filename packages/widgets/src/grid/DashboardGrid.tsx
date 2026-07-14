/**
 * DashboardGrid — the READ-ONLY M4 renderer for `pageLayoutSchema` layouts
 * (04-widget-registry.md §6.1). 12 fluid columns, 40 px half-row units,
 * 16 px gap. Below `lg` the grid reflows to one stacked column ordered by
 * `(y, x)`; items keep their height spans. Drag/resize editing (dnd-kit)
 * is 04-T12 — M7.
 *
 * Per-item placement uses the `--*` CSS-custom-property escape hatch (the
 * only sanctioned style prop): coordinates land in `--gi-*` variables that
 * the arbitrary-property utility classes consume, so no literal style
 * values ever render.
 */

import type { ReactNode } from 'react';

import { sortByPosition } from './layout-math.js';
import type { LayoutItem, PageLayout } from '../page-config/index.js';

export interface DashboardGridProps {
  layout: PageLayout;
  /** Render one placed widget (the item is already position-sorted). */
  renderItem: (item: LayoutItem) => ReactNode;
  className?: string | undefined;
  testId?: string | undefined;
}

export function DashboardGrid({ layout, renderItem, className, testId }: DashboardGridProps) {
  const items = sortByPosition(layout.items);
  return (
    <div
      data-dashboard-grid
      data-testid={testId}
      className={`grid grid-cols-1 auto-rows-[40px] gap-4 lg:grid-cols-12 ${className ?? ''}`}
    >
      {items.map((item) => (
        <div
          key={item.i}
          data-grid-item={item.i}
          data-grid-widget={item.widget}
          className="min-w-0 [grid-row:span_var(--gi-h)] lg:[grid-column:var(--gi-col)] lg:[grid-row:var(--gi-row)]"
          style={{
            '--gi-h': String(item.h),
            '--gi-col': `${item.x + 1} / span ${item.w}`,
            '--gi-row': `${item.y + 1} / span ${item.h}`,
          }}
        >
          {renderItem(item)}
        </div>
      ))}
    </div>
  );
}
