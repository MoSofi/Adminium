import { Suspense, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';

import { isEmptyData } from '../registry/data-empty.js';
import { logConfigWarnings, validateConfigAgainst, widgetRegistry } from '../registry/index.js';
import type { ParsedConfig } from '../registry/index.js';
import { widgetMissingDefinition } from '../registry/widget-missing.js';
import { SkeletonSilhouette } from './SkeletonSilhouette.js';
import { WidgetFrame } from './WidgetFrame.js';
import type { WidgetFrameState } from './WidgetFrame.js';
import { useResolvedWidgetId } from './WidgetRuntimeContext.js';
import type { WidgetDefinition, WidgetEvent } from '../registry/types.js';

/**
 * The data state handed to WidgetHost by the page renderer. DECISION (04
 * §5.3): @adminium/widgets stays free of @tanstack/react-query — the
 * `useWidgetData` hook (TanStack Query, batching, refreshInterval, params)
 * lives in apps/dashboard (04-T03 binding layer), and this shape mirrors a
 * TanStack Query result so the hook's output spreads straight in. Storybook
 * and demo mode pass `{ status: 'success', data: demoData(seed) }` directly.
 */
export interface WidgetDataState<T = unknown> {
  status: 'loading' | 'error' | 'success';
  data?: T | undefined;
  error?: unknown;
  refetch?: (() => void) | undefined;
  /** Stale-while-revalidate: true keeps `loaded` + header spinner (04 §4). */
  isRefetching?: boolean | undefined;
}

export interface WidgetHostProps {
  /** Registry id from the stored page config (`layout.items[].widget`). */
  widgetId: string;
  /** Widget instance id (`layout.items[].i`, nanoid). */
  instanceId: string;
  /** Raw stored instance config — validated here on mount (04 §2.2). */
  config?: unknown;
  data: WidgetDataState;
  onEvent?: ((event: WidgetEvent) => void) | undefined;
  /** Drag-grip render slot, forwarded to WidgetFrame (edit mode, M7). */
  dragGrip?: ReactNode | (() => ReactNode) | undefined;
  /** Kebab menu items, forwarded to WidgetFrame. */
  menu?: ReactNode | undefined;
  /** Info popover content override (defaults to the definition's descriptionKey). */
  info?: ReactNode | undefined;
  /**
   * Registry override for tests and the manifest extension host; defaults to
   * the global registry.
   */
  registry?: ReadonlyMap<string, WidgetDefinition> | undefined;
}

const noopEvent = (): void => {};

function errorMessageOf(error: unknown): string | undefined {
  if (error instanceof Error && error.message !== '') return error.message;
  if (typeof error === 'string' && error !== '') return error;
  return undefined;
}

/**
 * WidgetHost — binds a WidgetDefinition + stored instance config + a data
 * state to WidgetFrame and the lazy widget component (04 §2.2, §4):
 *
 * - unknown widget id → the `widget-missing` system card, never a crash;
 * - `map-*` → `map-choropleth-grid` under the offline asset policy, so the
 *   desktop app never imports a map engine (11-electron.md §7; registry/offline.ts);
 * - `validateInstanceConfig` on mount, per-field default fallback + one
 *   structured console warning;
 * - loading → skeleton silhouette; error → error card + Retry (refetch);
 * - success + `isEmpty(data)` per the definition's dataContract → empty state;
 * - lazy chunk loading → Suspense falls back to the same silhouette.
 */
export function WidgetHost({
  widgetId,
  instanceId,
  config,
  data,
  onEvent,
  dragGrip,
  menu,
  info,
  registry,
}: WidgetHostProps) {
  const map = registry ?? widgetRegistry;
  // §7's offline asset policy, applied BEFORE the map is read — resolving the id
  // is what keeps the map chunk (and Leaflet behind it) from ever being imported
  // in the desktop shell. Identity online, so self-host/Cloud are untouched.
  // A custom `registry` that lacks the fallback target renders widget-missing
  // rather than the map: in an offline runtime that is the conservative answer,
  // and `registry/offline.test.tsx` pins the target's presence in the real map.
  const resolvedId = useResolvedWidgetId(widgetId);
  const resolved = map.get(resolvedId);
  const missing = resolved === undefined;
  const definition = resolved ?? widgetMissingDefinition;

  const parsed: ParsedConfig = useMemo(() => {
    const validated = validateConfigAgainst(definition, config);
    if (!missing) return validated;
    // Carry the missing id for the fallback card, plus a structured warning.
    return {
      config: { ...validated.config, missingId: widgetId },
      warnings: [
        {
          widgetId,
          path: '',
          code: 'unknown-widget',
          message: `No widget registered as '${widgetId}'; rendering the widget-missing fallback`,
        },
        ...validated.warnings,
      ],
    };
  }, [definition, missing, widgetId, config]);

  useEffect(() => {
    logConfigWarnings(instanceId, parsed);
  }, [instanceId, parsed]);

  const state: WidgetFrameState = missing
    ? 'loaded'
    : data.status === 'loading'
      ? 'skeleton'
      : data.status === 'error'
        ? 'error'
        : isEmptyData(data.data, definition.dataContract)
          ? 'empty'
          : 'loaded';

  const cfg = parsed.config;
  const emptyOverride = cfg.emptyState as
    | { icon?: string; titleKey?: string; bodyKey?: string }
    | undefined;

  const Component = definition.component;
  const frameless = definition.placement === 'page';

  return (
    <WidgetFrame
      state={state}
      title={typeof cfg.title === 'string' ? cfg.title : undefined}
      info={info ?? definition.descriptionKey}
      menu={menu}
      dragGrip={dragGrip}
      skeleton={definition.skeleton}
      // titleKey/bodyKey are i18n keys — the dashboard resolves them via
      // @adminium/i18n; passed through raw here so overrides stay visible
      // even before the i18n hookup (04-T06 wires the translator).
      empty={
        emptyOverride === undefined
          ? undefined
          : { title: emptyOverride.titleKey, body: emptyOverride.bodyKey }
      }
      errorMessage={data.status === 'error' ? errorMessageOf(data.error) : undefined}
      onRetry={data.refetch}
      refetching={data.isRefetching === true}
      frameless={frameless}
      testId={typeof cfg.testId === 'string' ? cfg.testId : undefined}
    >
      <Suspense fallback={<SkeletonSilhouette variant={definition.skeleton} />}>
        <Component
          config={cfg}
          data={data.data}
          instanceId={instanceId}
          onEvent={onEvent ?? noopEvent}
        />
      </Suspense>
    </WidgetFrame>
  );
}
