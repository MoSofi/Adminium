// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `system` family component barrel — the single lazy-import target for this
 * family's definitions, so the registry metadata graph reaches the
 * @adminium/ui-heavy system components only through a dynamic `import()`
 * boundary (one lazy chunk for the family, 04 §2.3). Mirrors the
 * kpi/charts/feeds/boards/media `*-components.ts` convention.
 */
export { AlertBannerWidget } from './AlertBanner.js';
export { AutosaveIndicatorWidget } from './AutosaveIndicatorWidget.js';
export { ConnectionStatusWidget } from './ConnectionStatus.js';
export { DiagnosticsReadoutWidget } from './DiagnosticsReadout.js';
export { EmptyStateWidget } from './EmptyStateWidget.js';
export { ProgressLogConsoleWidget } from './ProgressLogConsole.js';
export { StateHeroWidget } from './StateHero.js';
export { StatusBannerHeroWidget } from './StatusBannerHero.js';
export { StatusPillWidget } from './StatusPill.js';
