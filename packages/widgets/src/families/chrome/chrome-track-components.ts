// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `chrome` family component barrel — the single lazy-import target for this
 * family's definitions, so the registry metadata graph reaches the
 * @adminium/ui-heavy chrome components (and Radix's dialog/popover/tabs) only
 * through a dynamic `import()` boundary (one lazy chunk for the family,
 * 04 §2.3). Mirrors the kpi/charts/feeds/boards/media/system convention.
 */
export { AvatarStackWidget } from './AvatarStackWidget.js';
export { BreadcrumbWidget } from './Breadcrumb.js';
export { CommandPaletteWidget } from './CommandPaletteWidget.js';
export { GlobalSearchWidget } from './GlobalSearch.js';
export { NavCardWidget } from './NavCard.js';
export { ShortcutsPanelWidget } from './ShortcutsPanel.js';
export { SidebarNavWidget } from './SidebarNav.js';
export { TabBarWidget } from './TabBar.js';
