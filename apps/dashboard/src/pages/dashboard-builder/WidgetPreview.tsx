/**
 * Deterministic demo-data preview of a registry widget (04-widget-registry.md
 * §5.3 "Demo mode"): renders the widget through `WidgetHost` fed by its own
 * seeded `demoData`, framed at a compact size for the palette. Non-interactive
 * (`aria-hidden` + `pointer-events-none`) — the surrounding palette entry owns
 * the accessible name and the click/keyboard affordance.
 */

import { useMemo } from 'react';
import {
  WidgetErrorBoundary,
  WidgetHost,
  type WidgetDataState,
  type WidgetDefinition,
} from '@adminium/widgets';

/** FNV-1a 32-bit hash → stable seed per widget id (04 §7.7). */
export function seedFromString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface WidgetPreviewProps {
  definition: WidgetDefinition;
  className?: string | undefined;
}

export function WidgetPreview({ definition, className }: WidgetPreviewProps) {
  const seed = seedFromString(definition.id);
  const data: WidgetDataState = useMemo(
    () => ({ status: 'success', data: definition.demoData(seed) }),
    [definition, seed],
  );
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none h-28 overflow-hidden rounded-lg border border-border bg-surface ${className ?? ''}`}
    >
      <WidgetErrorBoundary fallback={() => <div className="size-full" />}>
        <WidgetHost
          widgetId={definition.id}
          instanceId={`preview-${definition.id}`}
          config={{}}
          data={data}
        />
      </WidgetErrorBoundary>
    </div>
  );
}
