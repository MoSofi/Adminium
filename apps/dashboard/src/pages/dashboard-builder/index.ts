// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dashboard builder UX (04-widget-registry.md task 04-T14) — the edit-mode
 * surface layered onto the `page-dashboard` render path.
 */
export { DashboardBuilder, type DashboardBuilderProps } from './DashboardBuilder.js';
export { canEditSharedLayout, editTargetForCapability, type EditTarget } from './permissions.js';
export {
  insertWidget,
  duplicateItem,
  removeItem,
  updateItemConfig,
  lockedPathsOf,
  newInstanceId,
} from './placement.js';
export { deriveInspectorFields, type InspectorField, type InspectorFieldKind } from './inspectorFields.js';
export { paletteGroups, filterPaletteGroups, paletteWidgetCount, type PaletteGroup } from './widgetCatalog.js';
