import { lazy } from 'react';

import {
  avatarStackConfigSchema,
  avatarStackDemoData,
  breadcrumbConfigSchema,
  breadcrumbDemoData,
  commandPaletteConfigSchema,
  commandPaletteDemoData,
  globalSearchConfigSchema,
  globalSearchDemoData,
  navCardConfigSchema,
  navCardDemoData,
  shortcutsPanelConfigSchema,
  shortcutsPanelDemoData,
  sidebarNavConfigSchema,
  sidebarNavDemoData,
  tabBarConfigSchema,
  tabBarDemoData,
} from './chrome-config.js';
import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';

/**
 * TRACK FCS — `chrome` family registry metadata (annex §11; 04-T10). Metadata
 * only: the components load through the `chrome-track-components` barrel via
 * `lazy(() => import(...))`, so the family stays in ONE lazy chunk and the
 * registry metadata never eagerly pulls component code — or Radix's
 * dialog/popover/tabs — into a sibling family's bundle (04 §2.3; the
 * chunk-budget gate). Schemas + `demoData` come from the PURE `chrome-config.ts`
 * for the same reason. The GREEN LOOP spreads `chromeTrackDefinitions` into the
 * registry map. Widget ids match the annex catalog exactly (acceptance #1).
 *
 * Sizing is the annex's grid note converted to 40px half-units
 * (04 §6.1: `h = round(annexRows × 2)`); widths map 1:1.
 *
 * SHAPE CHOICES (04 §3): every chrome widget except `shortcuts-panel` binds to a
 * `record-list` — the nav tree, the ⌘K index, the search index, the breadcrumb
 * trail, the tab defs, the hub cards and the people list are all row sets the
 * generator produces (annex §11 auto-instantiation). `shortcuts-panel` is
 * `static`: the host's shortcut manager passes the registered set as config.
 *
 * `placement`: `sidebar-nav` is the app-shell rail and `command-palette` /
 * `shortcuts-panel` are portal overlays — none are grid-placed. `breadcrumb`,
 * `tab-bar` and `avatar-stack` are inline chrome. `global-search` and `nav-card`
 * are the two that legitimately occupy grid area on a hub/results page.
 */

export const sidebarNavDefinition: WidgetDefinition = defineWidget({
  id: 'sidebar-nav',
  family: 'chrome',
  component: lazy(() => import('./chrome-track-components.js').then((m) => ({ default: m.SidebarNavWidget }))),
  configSchema: sidebarNavConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 2, minH: 12, defaultW: 2, defaultH: 24 }, // annex "app shell rail" (256px ≈ 2 cols)
  placement: 'page',
  skeleton: 'list',
  demoData: sidebarNavDemoData,
  descriptionKey: 'widgets.chrome.sidebarNav.description',
});

export const commandPaletteDefinition: WidgetDefinition = defineWidget({
  id: 'command-palette',
  family: 'chrome',
  component: lazy(() => import('./chrome-track-components.js').then((m) => ({ default: m.CommandPaletteWidget }))),
  configSchema: commandPaletteConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 6, minH: 8, defaultW: 8, defaultH: 12 }, // annex "overlay"
  placement: 'overlay',
  skeleton: 'block',
  demoData: commandPaletteDemoData,
  descriptionKey: 'widgets.chrome.commandPalette.description',
});

export const globalSearchDefinition: WidgetDefinition = defineWidget({
  id: 'global-search',
  family: 'chrome',
  component: lazy(() => import('./chrome-track-components.js').then((m) => ({ default: m.GlobalSearchWidget }))),
  configSchema: globalSearchConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 4, minH: 2, defaultW: 12, defaultH: 12 }, // annex "header inline + full page"
  placement: 'grid',
  skeleton: 'list',
  demoData: globalSearchDemoData,
  descriptionKey: 'widgets.chrome.globalSearch.description',
});

export const breadcrumbDefinition: WidgetDefinition = defineWidget({
  id: 'breadcrumb',
  family: 'chrome',
  component: lazy(() => import('./chrome-track-components.js').then((m) => ({ default: m.BreadcrumbWidget }))),
  configSchema: breadcrumbConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 4, minH: 1, defaultW: 6, defaultH: 2 }, // annex "inline"
  placement: 'inline',
  skeleton: 'block',
  demoData: breadcrumbDemoData,
  descriptionKey: 'widgets.chrome.breadcrumb.description',
});

export const tabBarDefinition: WidgetDefinition = defineWidget({
  id: 'tab-bar',
  family: 'chrome',
  component: lazy(() => import('./chrome-track-components.js').then((m) => ({ default: m.TabBarWidget }))),
  configSchema: tabBarConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 4, minH: 2, defaultW: 12, defaultH: 2 }, // annex "inline"
  placement: 'inline',
  skeleton: 'block',
  demoData: tabBarDemoData,
  descriptionKey: 'widgets.chrome.tabBar.description',
});

export const navCardDefinition: WidgetDefinition = defineWidget({
  id: 'nav-card',
  family: 'chrome',
  component: lazy(() => import('./chrome-track-components.js').then((m) => ({ default: m.NavCardWidget }))),
  configSchema: navCardConfigSchema,
  dataContract: 'record-list',
  // annex "min 3×2 each" — one instance renders the whole hub grid, so the
  // default spans the row rather than a single card's footprint.
  sizing: { minW: 3, minH: 4, defaultW: 12, defaultH: 8 },
  placement: 'grid',
  skeleton: 'card',
  demoData: navCardDemoData,
  descriptionKey: 'widgets.chrome.navCard.description',
});

export const shortcutsPanelDefinition: WidgetDefinition = defineWidget({
  id: 'shortcuts-panel',
  family: 'chrome',
  component: lazy(() => import('./chrome-track-components.js').then((m) => ({ default: m.ShortcutsPanelWidget }))),
  configSchema: shortcutsPanelConfigSchema,
  // annex §11: "static groups of {label, keys[], isSequence}"
  dataContract: 'static',
  sizing: { minW: 6, minH: 8, defaultW: 8, defaultH: 12 }, // annex "overlay"
  placement: 'overlay',
  skeleton: 'list',
  demoData: shortcutsPanelDemoData,
  descriptionKey: 'widgets.chrome.shortcutsPanel.description',
});

export const avatarStackDefinition: WidgetDefinition = defineWidget({
  id: 'avatar-stack',
  family: 'chrome',
  component: lazy(() => import('./chrome-track-components.js').then((m) => ({ default: m.AvatarStackWidget }))),
  configSchema: avatarStackConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 2, minH: 2, defaultW: 3, defaultH: 2 }, // annex "inline"
  placement: 'inline',
  skeleton: 'block',
  demoData: avatarStackDemoData,
  descriptionKey: 'widgets.chrome.avatarStack.description',
});

/** Every `chrome` widget delivered by TRACK FCS, in annex §11 order. */
export const chromeTrackDefinitions: readonly WidgetDefinition[] = [
  sidebarNavDefinition,
  commandPaletteDefinition,
  globalSearchDefinition,
  breadcrumbDefinition,
  tabBarDefinition,
  navCardDefinition,
  shortcutsPanelDefinition,
  avatarStackDefinition,
];
