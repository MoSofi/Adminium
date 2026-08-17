// SPDX-License-Identifier: AGPL-3.0-only
import { lazy } from 'react';

import {
  alertBannerConfigSchema,
  alertBannerDemoData,
  autosaveIndicatorConfigSchema,
  autosaveIndicatorDemoData,
  connectionStatusConfigSchema,
  connectionStatusDemoData,
  diagnosticsReadoutConfigSchema,
  diagnosticsReadoutDemoData,
  emptyStateConfigSchema,
  emptyStateDemoData,
  progressLogConsoleConfigSchema,
  progressLogConsoleDemoData,
  stateHeroConfigSchema,
  stateHeroDemoData,
  statusBannerHeroConfigSchema,
  statusBannerHeroDemoData,
  statusPillConfigSchema,
  statusPillDemoData,
} from './system-config.js';
import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';

/**
 * TRACK FCS — `system` family registry metadata (annex §12; 04-T10). Metadata
 * only: the @adminium/ui-heavy components load through the
 * `system-track-components` barrel via `lazy(() => import(...))`, so the family
 * stays in ONE lazy chunk and registry metadata never eagerly pulls component
 * code into a sibling family's bundle (04 §2.3; the chunk-budget gate). Schemas
 * + `demoData` come from the PURE `system-config.ts` for the same reason. The
 * GREEN LOOP spreads `systemTrackDefinitions` into the registry map. Widget ids
 * match the annex catalog exactly (acceptance #1).
 *
 * Sizing is the annex's grid note converted to 40px half-units
 * (04 §6.1: `h = round(annexRows × 2)`); widths map 1:1.
 *
 * SHAPE CHOICES (04 §3): most of this family is a projection of ONE bound row
 * (`record`) — a status enum, an autosave flag set, a connection probe result.
 * Two are aggregates: `status-banner-hero` derives worst-wins state from the
 * service LIST, and `progress-log-console` takes a finished run's `record-list`
 * or a live `stream`. `empty-state` is `static` — its payload is its config.
 *
 * `placement` follows the annex's grid notes: `state-hero` fills the page,
 * `status-pill` / `autosave-indicator` are inline (never grid-placed — they sit
 * in a table cell and a header respectively), the rest are grid cards.
 */

export const stateHeroDefinition: WidgetDefinition = defineWidget({
  id: 'state-hero',
  family: 'system',
  component: lazy(() => import('./system-track-components.js').then((m) => ({ default: m.StateHeroWidget }))),
  configSchema: stateHeroConfigSchema,
  // The view id may arrive on a bound row (a health check), else config decides.
  dataContract: ['record', 'static'],
  sizing: { minW: 6, minH: 8, defaultW: 12, defaultH: 14 }, // annex "full page"
  placement: 'page',
  skeleton: 'block',
  demoData: stateHeroDemoData,
  descriptionKey: 'widgets.system.stateHero.description',
});

export const emptyStateDefinition: WidgetDefinition = defineWidget({
  id: 'empty-state',
  family: 'system',
  component: lazy(() => import('./system-track-components.js').then((m) => ({ default: m.EmptyStateWidget }))),
  configSchema: emptyStateConfigSchema,
  // annex §12: "static per context (or derived boolean isEmpty from a filtered list)"
  dataContract: 'static',
  sizing: { minW: 3, minH: 4, defaultW: 6, defaultH: 6 }, // annex "fills host widget"
  placement: 'grid',
  skeleton: 'block',
  demoData: emptyStateDemoData,
  descriptionKey: 'widgets.system.emptyState.description',
});

export const statusPillDefinition: WidgetDefinition = defineWidget({
  id: 'status-pill',
  family: 'system',
  component: lazy(() => import('./system-track-components.js').then((m) => ({ default: m.StatusPillWidget }))),
  configSchema: statusPillConfigSchema,
  dataContract: 'record',
  sizing: { minW: 2, minH: 2, defaultW: 2, defaultH: 2 }, // annex "inline"
  placement: 'inline',
  skeleton: 'block',
  demoData: statusPillDemoData,
  descriptionKey: 'widgets.system.statusPill.description',
});

export const alertBannerDefinition: WidgetDefinition = defineWidget({
  id: 'alert-banner',
  family: 'system',
  component: lazy(() => import('./system-track-components.js').then((m) => ({ default: m.AlertBannerWidget }))),
  configSchema: alertBannerConfigSchema,
  dataContract: 'record',
  sizing: { minW: 6, minH: 2, defaultW: 12, defaultH: 2 }, // annex "min 6×1"
  placement: 'grid',
  skeleton: 'block',
  demoData: alertBannerDemoData,
  descriptionKey: 'widgets.system.alertBanner.description',
});

export const statusBannerHeroDefinition: WidgetDefinition = defineWidget({
  id: 'status-banner-hero',
  family: 'system',
  component: lazy(() => import('./system-track-components.js').then((m) => ({ default: m.StatusBannerHeroWidget }))),
  configSchema: statusBannerHeroConfigSchema,
  // Worst-wins over the service list — binds to the list, never to a
  // pre-computed status (see the component's header comment).
  dataContract: 'record-list',
  sizing: { minW: 12, minH: 4, defaultW: 12, defaultH: 4 }, // annex "12×2"
  placement: 'grid',
  skeleton: 'block',
  demoData: statusBannerHeroDemoData,
  descriptionKey: 'widgets.system.statusBannerHero.description',
});

export const connectionStatusDefinition: WidgetDefinition = defineWidget({
  id: 'connection-status',
  family: 'system',
  component: lazy(() => import('./system-track-components.js').then((m) => ({ default: m.ConnectionStatusWidget }))),
  configSchema: connectionStatusConfigSchema,
  dataContract: 'record',
  sizing: { minW: 3, minH: 2, defaultW: 4, defaultH: 3 }, // annex "inline"
  placement: 'grid',
  skeleton: 'block',
  // The Test action emits a `mutate` intent the host runs (re-issues the probe).
  capabilities: { editsData: true },
  demoData: connectionStatusDemoData,
  descriptionKey: 'widgets.system.connectionStatus.description',
});

export const autosaveIndicatorDefinition: WidgetDefinition = defineWidget({
  id: 'autosave-indicator',
  family: 'system',
  component: lazy(() => import('./system-track-components.js').then((m) => ({ default: m.AutosaveIndicatorWidget }))),
  configSchema: autosaveIndicatorConfigSchema,
  dataContract: 'record',
  sizing: { minW: 2, minH: 2, defaultW: 3, defaultH: 2 }, // annex "inline header"
  placement: 'inline',
  skeleton: 'block',
  demoData: autosaveIndicatorDemoData,
  descriptionKey: 'widgets.system.autosaveIndicator.description',
});

export const progressLogConsoleDefinition: WidgetDefinition = defineWidget({
  id: 'progress-log-console',
  family: 'system',
  component: lazy(() => import('./system-track-components.js').then((m) => ({ default: m.ProgressLogConsoleWidget }))),
  configSchema: progressLogConsoleConfigSchema,
  // A finished run's rows, or a live WS channel's append-only snapshot (04 §5.3).
  dataContract: ['record-list', 'stream'],
  sizing: { minW: 6, minH: 6, defaultW: 8, defaultH: 8 }, // annex "min 6×3"
  placement: 'grid',
  skeleton: 'list',
  capabilities: { realtime: true },
  demoData: progressLogConsoleDemoData,
  descriptionKey: 'widgets.system.progressLogConsole.description',
});

export const diagnosticsReadoutDefinition: WidgetDefinition = defineWidget({
  id: 'diagnostics-readout',
  family: 'system',
  component: lazy(() => import('./system-track-components.js').then((m) => ({ default: m.DiagnosticsReadoutWidget }))),
  configSchema: diagnosticsReadoutConfigSchema,
  dataContract: 'record',
  sizing: { minW: 4, minH: 4, defaultW: 4, defaultH: 5 }, // annex "min 4×2"
  placement: 'grid',
  skeleton: 'list',
  demoData: diagnosticsReadoutDemoData,
  descriptionKey: 'widgets.system.diagnosticsReadout.description',
});

/** Every `system` widget delivered by TRACK FCS, in annex §12 order. */
export const systemTrackDefinitions: readonly WidgetDefinition[] = [
  stateHeroDefinition,
  emptyStateDefinition,
  statusPillDefinition,
  alertBannerDefinition,
  statusBannerHeroDefinition,
  connectionStatusDefinition,
  autosaveIndicatorDefinition,
  progressLogConsoleDefinition,
  diagnosticsReadoutDefinition,
];
