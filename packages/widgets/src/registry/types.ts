// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentType, LazyExoticComponent } from 'react';
import { z } from 'zod';

import type { DataShape } from '../page-config/index.js';

/**
 * Widget registry core types — 04-widget-registry.md §2.1, verbatim.
 * A widget is one React component + one Zod config schema + one data-contract
 * declaration + default grid sizing, registered exactly once in a typed map.
 * Visual variants are config, never new registry ids.
 */

/** The thirteen widget families (04 §2.4). */
export type WidgetFamily =
  | 'kpi'
  | 'charts'
  | 'tables'
  | 'feeds'
  | 'calendar'
  | 'boards'
  | 'geo'
  | 'media'
  | 'communication'
  | 'forms'
  | 'chrome'
  | 'system'
  | 'domain';

export const WIDGET_FAMILIES = [
  'kpi',
  'charts',
  'tables',
  'feeds',
  'calendar',
  'boards',
  'geo',
  'media',
  'communication',
  'forms',
  'chrome',
  'system',
  'domain',
] as const satisfies readonly WidgetFamily[];

export interface WidgetSizing {
  minW: number; // 12-col grid units
  minH: number; // half-row units (04 §6.1 — 40px half-units, annex 1.5 rows → 3)
  defaultW: number;
  defaultH: number;
}

/** WidgetFrame loading silhouette variants (04 §2.1 / §4). */
export type WidgetSkeleton = 'card' | 'chart' | 'table' | 'list' | 'block';

/** Grid placement class (04 §2.1). */
export type WidgetPlacement = 'grid' | 'inline' | 'overlay' | 'page';

export interface WidgetCapabilities {
  exportPng?: boolean; // chart raster export (04 §7.6)
  exportCsv?: boolean; // record-list/table export
  realtime?: boolean; // accepts `stream` bindings over WS
  editsData?: boolean; // performs INSERT/UPDATE/DELETE (kanban drop, inline edit…)
}

export interface WidgetDefinition<S extends z.ZodType = z.ZodType> {
  id: string; // kebab-case, globally unique: 'kpi-stat-card'
  family: WidgetFamily;
  component: LazyExoticComponent<ComponentType<WidgetProps<z.infer<S>>>>;
  configSchema: S; // always .extend() of widgetSharedConfigSchema
  dataContract: DataShape | DataShape[]; // shapes this widget accepts (04 §3)
  sizing: WidgetSizing;
  placement: WidgetPlacement;
  // inline  = never grid-placed (chart-sparkline, status-pill, unread-badge)
  // overlay = portal widgets (modal-wizard, toast-stack, drawer-form)
  // page    = fills the page body (kanban-board, file-browser, state-hero)
  skeleton: WidgetSkeleton; // WidgetFrame loading silhouette
  capabilities?: WidgetCapabilities;
  demoData: (seed: number) => unknown; // deterministic payload matching dataContract (04 §7.7)
  descriptionKey: string; // i18n key, shown in builder palette + info tooltip
}

export interface WidgetProps<C> {
  config: C;
  data: unknown; // narrowed by shape guards from 04 §3
  instanceId: string;
  // drill-through, cross-widget links, mutations. A host MAY return a promise
  // for `mutate` events (resolves on commit, rejects on failure) so optimistic
  // widgets — e.g. the kanban boards — can roll back a rejected move; handlers
  // that ignore the result stay valid (`void` is assignable).
  onEvent: (e: WidgetEvent) => void | Promise<unknown>;
}

/**
 * Events a widget component may emit through `onEvent`. The host (dashboard
 * shell / PageRenderer) interprets them — widgets never navigate or mutate
 * directly.
 */
export type WidgetEvent =
  /** Drill-through navigation to a route (config.href or a computed link). */
  | { type: 'drill-through'; href: string }
  /** Open a single record (row click in data-grid, card click in kanban…). */
  | {
      type: 'record-open';
      connectionId?: string | undefined;
      table: string;
      recordId: string | number;
      /**
       * Instance id of a sibling widget this selection pairs with — the host
       * MAY focus/scroll it to the same record (annex §7 `map-bubble.linkedList`
       * names a `ranked-entity-list`). Widgets never talk to each other, so the
       * pairing rides on the event and the host decides what to do with it;
       * absent → an unpaired open, which every existing host already handles.
       */
      linkedInstanceId?: string | undefined;
    }
  /**
   * Mutation *intent* — widgets with `capabilities.editsData` describe the
   * change; the host runs it through the CRUD API (with undo + audit).
   */
  | {
      type: 'mutate';
      intent: 'insert' | 'update' | 'delete';
      connectionId?: string | undefined;
      table: string;
      recordId?: string | number | undefined;
      values?: Record<string, unknown> | undefined;
    };

/**
 * Identity helper that erases the config-schema type parameter so concrete
 * definitions (whose components are typed against their own config) can live
 * in heterogeneous `WidgetDefinition[]` family arrays. React component props
 * are contravariant, so this cast is the sanctioned single point of erasure —
 * `validateInstanceConfig` re-establishes safety at the config boundary.
 */
export function defineWidget<S extends z.ZodType>(definition: WidgetDefinition<S>): WidgetDefinition {
  return definition as unknown as WidgetDefinition;
}
