// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A project's widgets, drawn (49-developer-projects.md §6.3). Loaded lazily by
 * `scope.tsx` the first time a page shows one.
 *
 * - A **cell** that cannot be drawn (no such widget, a card where a cell was
 *   asked for, a file that did not load, a component that threw) shows the
 *   value as plain text with a warning mark, so the table stays usable.
 * - A **card** that cannot load throws, and the widget frame shows its error
 *   state with a Retry.
 */

import { TriangleAlert } from 'lucide-react';
import { Component, createElement, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import type { GridColumnSpec, GridRow } from '@adminium/widgets';

import { t } from '../i18n/t.js';
import type { ProjectClientWidget } from './bootstrapProject.js';
import { useProjectMessages } from './projectMessages.js';
import { InProjectCardContext } from './kit/surface.js';
import { checkDefinition, useProjectModule } from './useProjectModule.js';

/** What a project widget's component is given (`@adminiumjs/adminium/ui`). */
interface CellProps {
  value: unknown;
  record: GridRow;
  column: { name: string; label: string };
}

interface CardProps {
  config: Record<string, unknown>;
  data: unknown;
}

function plainValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function sourceOf(id: string): string {
  return `widgets/${id.startsWith('project.') ? id.slice('project.'.length) : id}.tsx`;
}

/** The value, and a mark whose label says why the widget did not draw it. */
function UndrawnCell({ value, reason }: { value: unknown; reason: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" data-testid="project-cell-undrawn">
      <span className="truncate">{plainValue(value)}</span>
      <TriangleAlert className="size-3.5 shrink-0 text-warn" role="img" aria-label={reason}>
        <title>{reason}</title>
      </TriangleAlert>
    </span>
  );
}

class CellBoundary extends Component<{ fallback: (error: Error) => ReactNode; children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[project] a cell widget threw', error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.error === null ? this.props.children : this.props.fallback(this.state.error);
  }
}

export function ProjectCell({
  id,
  widget,
  column,
  row,
}: {
  id: string;
  widget: ProjectClientWidget | null;
  column: GridColumnSpec;
  row: GridRow;
}): ReactNode {
  useProjectMessages();
  const usable = widget !== null && widget.kind === 'cell' ? widget : null;
  const loaded = useProjectModule(usable, (value) => checkDefinition(value, sourceOf(id), 'defineWidget'));
  const value = row[column.name];

  if (usable === null) {
    const reason =
      widget === null
        ? t('project:cell.unknown', 'This project has no widget {id}.', { id })
        : t('project:cell.notCell', '{id} is a card, not a table cell.', { id });
    return <UndrawnCell value={value} reason={reason} />;
  }
  if (loaded.status === 'loading') return <span className="truncate">{plainValue(value)}</span>;
  if (loaded.status === 'failed') return <UndrawnCell value={value} reason={loaded.error.message} />;
  return (
    <CellBoundary fallback={(error) => <UndrawnCell value={value} reason={error.message} />}>
      {createElement(loaded.definition.component as unknown as ComponentType<CellProps>, {
        value,
        record: row,
        column: { name: column.name, label: column.label },
      })}
    </CellBoundary>
  );
}

export function ProjectCard({
  widget,
  config,
  data,
}: {
  widget: ProjectClientWidget;
  config: Record<string, unknown>;
  data: unknown;
}): ReactNode {
  // Not for itself: the card's own code may draw the kit's `DataTable`.
  useProjectMessages();
  const loaded = useProjectModule(widget, (value) => checkDefinition(value, sourceOf(widget.id), 'defineWidget'));
  // The frame's error boundary shows it, with a Retry that mounts this again.
  if (loaded.status === 'failed') throw loaded.error;
  // Widget bodies pad themselves (`WidgetFrame`), in line with the card's title.
  return (
    <div className="px-[var(--widget-pad)] pb-[var(--widget-pad)]" data-testid="project-card">
      {loaded.status === 'loading' ? (
        <div className="h-24 animate-pulse rounded-md bg-surface-2" data-testid="project-card-loading" />
      ) : (
        <InProjectCardContext.Provider value>
          {createElement(loaded.definition.component as unknown as ComponentType<CardProps>, { config, data })}
        </InProjectCardContext.Provider>
      )}
    </div>
  );
}
