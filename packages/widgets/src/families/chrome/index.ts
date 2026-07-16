/**
 * `chrome` family public surface (annex §11) — the navigation/chrome components
 * (sidebar-nav, command-palette, global-search, breadcrumb, tab-bar, nav-card,
 * shortcuts-panel, avatar-stack) plus the TRACK FCS registry metadata. Component
 * code is also reachable through each definition's `lazy()` ref, so the registry
 * still emits one chunk per family (04 §2.3); this barrel is for direct
 * template/story composition and tests. Registry metadata lives in
 * `chrome-track.definitions.ts`; schemas + demo generators in `chrome-config.ts`.
 */
export {
  AvatarStackWidget,
  avatarStackConfigSchema,
  avatarStackDemoData,
  peopleOf,
  type AvatarStackConfig,
  type Person,
} from './AvatarStackWidget.js';
export {
  BreadcrumbWidget,
  breadcrumbConfigSchema,
  breadcrumbDemoData,
  crumbsOf,
  type BreadcrumbConfig,
  type Crumb,
} from './Breadcrumb.js';
export {
  CommandPaletteWidget,
  commandEntriesOf,
  commandPaletteConfigSchema,
  commandPaletteDemoData,
  groupEntries,
  type CommandEntry,
  type CommandPaletteConfig,
} from './CommandPaletteWidget.js';
export {
  GlobalSearchView,
  GlobalSearchWidget,
  facetCounts,
  filterResults,
  globalSearchConfigSchema,
  globalSearchDemoData,
  searchResultsOf,
  type GlobalSearchConfig,
  type GlobalSearchViewProps,
  type SearchResult,
} from './GlobalSearch.js';
export {
  NavCardView,
  NavCardWidget,
  navCardConfigSchema,
  navCardDemoData,
  navCardsOf,
  type NavCardConfig,
  type NavCardItem,
  type NavCardViewProps,
} from './NavCard.js';
export {
  DEFAULT_SHORTCUT_GROUPS,
  MOD_TOKEN,
  ShortcutsPanelView,
  ShortcutsPanelWidget,
  displayKey,
  shortcutsPanelConfigSchema,
  shortcutsPanelDemoData,
  type ShortcutEntry,
  type ShortcutGroup,
  type ShortcutsPanelConfig,
  type ShortcutsPanelViewProps,
} from './ShortcutsPanel.js';
export {
  SidebarNavView,
  SidebarNavWidget,
  navGroupsOf,
  sidebarNavConfigSchema,
  sidebarNavDemoData,
  type NavGroup,
  type NavItem,
  type SidebarNavConfig,
  type SidebarNavViewProps,
} from './SidebarNav.js';
export { TabBarWidget, tabBarConfigSchema, tabBarDemoData, tabsOf, type TabBarConfig, type TabDef } from './TabBar.js';
export {
  COMMAND_GROUPS,
  DEFAULT_COMMAND_GROUP_ORDER,
  DEFAULT_SEARCH_GROUP_ORDER,
  TAB_STYLES,
  booleanField,
  collapseTrail,
  fold,
  formatCount,
  formatUpdated,
  highlightParts,
  isSafeHref,
  matches,
  numberField,
  oneOf,
  recordRowsOf,
  resolveLocale,
  stringField,
  type CommandGroupKey,
  type TabStyle,
} from './chrome-lib.js';
export { CHROME_ICON_NAMES, chromeIcon } from './chrome-icons.js';
export { CHROME_DEMO_EPOCH, shortcutEntrySchema } from './chrome-config.js';
export {
  avatarStackDefinition,
  breadcrumbDefinition,
  chromeTrackDefinitions,
  commandPaletteDefinition,
  globalSearchDefinition,
  navCardDefinition,
  shortcutsPanelDefinition,
  sidebarNavDefinition,
  tabBarDefinition,
} from './chrome-track.definitions.js';
