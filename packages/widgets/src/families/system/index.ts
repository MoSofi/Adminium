// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `system` family public surface (annex §12) — the state/feedback components
 * (state-hero, empty-state, status-pill, alert-banner, status-banner-hero,
 * connection-status, autosave-indicator, progress-log-console,
 * diagnostics-readout) plus the TRACK FCS registry metadata. Component code is
 * also reachable through each definition's `lazy()` ref, so the registry still
 * emits one chunk per family (04 §2.3); this barrel is for direct
 * template/story composition and tests. Registry metadata lives in
 * `system-track.definitions.ts`; schemas + demo generators in `system-config.ts`.
 */
export {
  AlertBannerView,
  AlertBannerWidget,
  alertBannerConfigSchema,
  alertBannerDemoData,
  type AlertBannerConfig,
  type AlertBannerViewProps,
} from './AlertBanner.js';
export {
  AutosaveIndicatorView,
  AutosaveIndicatorWidget,
  autosaveIndicatorConfigSchema,
  autosaveIndicatorDemoData,
  autosaveStatusOf,
  type AutosaveIndicatorConfig,
  type AutosaveIndicatorViewProps,
} from './AutosaveIndicatorWidget.js';
export {
  ConnectionStatusView,
  ConnectionStatusWidget,
  connectionStatusConfigSchema,
  connectionStatusDemoData,
  type ConnectionStatusConfig,
  type ConnectionStatusViewProps,
} from './ConnectionStatus.js';
export {
  DEFAULT_DIAGNOSTIC_CHECKS,
  DiagnosticsReadoutView,
  DiagnosticsReadoutWidget,
  diagnosticsReadoutConfigSchema,
  diagnosticsReadoutDemoData,
  type DiagnosticCheck,
  type DiagnosticsReadoutConfig,
  type DiagnosticsReadoutViewProps,
} from './DiagnosticsReadout.js';
export {
  EmptyStateWidget,
  emptyStateConfigSchema,
  emptyStateDemoData,
  type EmptyStateConfig,
} from './EmptyStateWidget.js';
export {
  ProgressLogConsoleView,
  ProgressLogConsoleWidget,
  logLinesOf,
  progressLogConsoleConfigSchema,
  progressLogConsoleDemoData,
  progressPctOf,
  type LogLine,
  type ProgressLogConsoleConfig,
  type ProgressLogConsoleViewProps,
} from './ProgressLogConsole.js';
export {
  StateHeroView,
  StateHeroWidget,
  resolveStateHeroEntry,
  stateHeroConfigSchema,
  stateHeroDemoData,
  type StateHeroConfig,
  type StateHeroEntryConfig,
  type StateHeroViewProps,
} from './StateHero.js';
export {
  StatusBannerHeroView,
  StatusBannerHeroWidget,
  statusBannerHeroConfigSchema,
  statusBannerHeroDemoData,
  type HeroStat,
  type StatusBannerHeroConfig,
  type StatusBannerHeroViewProps,
} from './StatusBannerHero.js';
export {
  StatusPillWidget,
  StatusPillWidgetView,
  statusPillConfigSchema,
  statusPillDemoData,
  type StatusPillConfig,
  type StatusPillWidgetProps,
} from './StatusPill.js';
export {
  AUTOSAVE_STATUSES,
  CONNECTION_STATES,
  LOG_LINE_KINDS,
  SERVICE_STATES,
  STATE_HERO_VIEWS,
  SYSTEM_TONES,
  bindingSourceOf,
  booleanField,
  clampPct,
  formatStamp,
  numberField,
  oneOf,
  recordRowOf,
  recordRowsOf,
  resolveLocale,
  stringField,
  uiToneOf,
  worstServiceState,
  type AutosaveStatus,
  type BindingSource,
  type ConnectionState,
  type LogLineKind,
  type ServiceState,
  type StateHeroViewId,
  type SystemTone,
} from './system-lib.js';
export { SYSTEM_ICON_NAMES, stateHeroIcon, systemIcon } from './system-icons.js';
export { SYSTEM_DEMO_EPOCH, stateHeroEntrySchema } from './system-config.js';
export {
  alertBannerDefinition,
  autosaveIndicatorDefinition,
  connectionStatusDefinition,
  diagnosticsReadoutDefinition,
  emptyStateDefinition,
  progressLogConsoleDefinition,
  stateHeroDefinition,
  statusBannerHeroDefinition,
  statusPillDefinition,
  systemTrackDefinitions,
} from './system-track.definitions.js';
