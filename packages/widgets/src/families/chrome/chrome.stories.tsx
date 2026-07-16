/**
 * TRACK FCS `chrome` family stories (annex §11): each widget's loaded variant,
 * the four WidgetFrame states through WidgetHost (acceptance #4), and
 * light/dark × LTR/RTL matrices with REAL geometry mirroring (acceptance #9 —
 * the RTL frames set `dir="rtl"` so the breadcrumb chevrons, the nav's
 * icon-then-label rows and end-aligned badges, the nav-card's sliding arrow
 * (`ms-` + `rtl:rotate-180`), the avatar stack's `-ms-2` overlap, and the search
 * facet rail genuinely flip; a bare attribute would prove nothing). Widgets
 * resolve through a LOCAL registry override so the stories work before the green
 * loop merges the definitions into the global map. Payloads are the same seeded
 * generators `demoData` uses.
 */
import type { ReactNode } from 'react';

import {
  avatarStackDemoData,
  breadcrumbDemoData,
  commandPaletteDemoData,
  globalSearchDemoData,
  navCardDemoData,
  sidebarNavDemoData,
  tabBarDemoData,
} from './chrome-config.js';
import { chromeTrackDefinitions } from './chrome-track.definitions.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const registry = buildRegistry([...chromeTrackDefinitions] as WidgetDefinition[]);

const meta = { title: 'Widgets/Chrome' };
export default meta;

type Status = 'success' | 'loading' | 'error';

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: Status = 'success',
  height = 'h-64',
) {
  return (
    <div className={`${height} w-full`}>
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
        registry={registry}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('SEARCH_INDEX_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

function Frame({ dark, dir, children }: { dark?: boolean; dir?: 'ltr' | 'rtl'; children: ReactNode }) {
  const content = (
    <div dir={dir} className="bg-bg p-4">
      {children}
    </div>
  );
  return dark ? <div data-theme="dark">{content}</div> : content;
}

const NAV_GROUPS = [
  { key: 'workspace', label: 'Workspace' },
  { key: 'library', label: 'Library' },
  { key: 'people', label: 'People' },
  { key: 'account', label: 'Account' },
];

const navConfig = { groups: NAV_GROUPS, activeHref: '/orders' };

const TYPE_META = {
  record: { label: 'Record', icon: 'table', tone: 'accent' },
  people: { label: 'Person', icon: 'users', tone: 'info' },
  page: { label: 'Page', icon: 'file', tone: 'pos' },
  metric: { label: 'Metric', icon: 'chart', tone: 'warn' },
};

// `referenceTime` pins "now" so the relative stamps are byte-deterministic in
// VRT captures (shared config, 04 §2.1) — CHROME_DEMO_EPOCH.
const searchConfig = {
  variant: 'page',
  typeMeta: TYPE_META,
  format: { referenceTime: Date.UTC(2026, 2, 17, 9, 15, 0) },
};

// ── Per-widget loaded variants ─────────────────────────────────────────────

export const SidebarNavStory = {
  name: 'sidebar-nav',
  render: () => (
    <div className="w-64">{host('sidebar-nav', 's-nav', navConfig, sidebarNavDemoData(4), 'success', 'h-[32rem]')}</div>
  ),
};

export const CommandPaletteStory = {
  name: 'command-palette',
  render: () => (
    <div>
      <p className="mb-2 text-body-sm text-fg-muted">Press ⌘K / Ctrl+K to open the palette.</p>
      {host('command-palette', 's-palette', { title: 'Command palette' }, commandPaletteDemoData(9), 'success', 'h-24')}
    </div>
  ),
};

export const GlobalSearchStory = {
  name: 'global-search · page',
  render: () => host('global-search', 's-search', searchConfig, globalSearchDemoData(7), 'success', 'h-[28rem]'),
};

export const GlobalSearchDropdown = {
  name: 'global-search · dropdown',
  render: () =>
    host(
      'global-search',
      's-search-dd',
      {
        variant: 'dropdown',
        typeMeta: TYPE_META,
        quickLinks: [
          { label: 'Orders', href: '/orders', icon: 'table' },
          { label: 'Customers', href: '/customers', icon: 'users' },
        ],
      },
      globalSearchDemoData(7),
      'success',
      'h-64',
    ),
};

export const BreadcrumbStory = {
  name: 'breadcrumb',
  render: () => host('breadcrumb', 's-crumb', {}, breadcrumbDemoData(6), 'success', 'h-20'),
};

export const TabBarStory = {
  name: 'tab-bar',
  render: () => host('tab-bar', 's-tabs', { style: 'underline' }, tabBarDemoData(3), 'success', 'h-20'),
};

export const TabBarSegmented = {
  name: 'tab-bar · segmented',
  render: () => host('tab-bar', 's-tabs-seg', { style: 'segmented' }, tabBarDemoData(3), 'success', 'h-20'),
};

export const NavCardStory = {
  name: 'nav-card',
  render: () => host('nav-card', 's-navcard', { columns: 3 }, navCardDemoData(11), 'success', 'h-72'),
};

export const ShortcutsPanelStory = {
  name: 'shortcuts-panel',
  render: () => host('shortcuts-panel', 's-shortcuts', { modKey: '⌘', footerHint: 'Press ? anytime' }, {}, 'success', 'h-80'),
};

export const AvatarStackStory = {
  name: 'avatar-stack',
  render: () =>
    host('avatar-stack', 's-avatars', { presence: true, onlineLabel: '{count} online', max: 5 }, avatarStackDemoData(2), 'success', 'h-24'),
};

// ── Four WidgetFrame states (acceptance #4) ────────────────────────────────

/** sidebar-nav: loaded · skeleton · empty · error. */
export const States = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-4 gap-4">
        {host('sidebar-nav', 'st-loaded', navConfig, sidebarNavDemoData(4), 'success', 'h-96')}
        {host('sidebar-nav', 'st-skeleton', navConfig, undefined, 'loading', 'h-96')}
        {host('sidebar-nav', 'st-empty', { ...navConfig, emptyState: { titleKey: 'No navigation yet' } }, { rows: [], total: 0 }, 'success', 'h-96')}
        {host('sidebar-nav', 'st-error', navConfig, undefined, 'error', 'h-96')}
      </div>
    </Frame>
  ),
};

/** nav-card: the same four states on a grid-placed widget. */
export const NavCardStates = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('nav-card', 'nc-loaded', { columns: 2 }, navCardDemoData(11), 'success', 'h-72')}
        {host('nav-card', 'nc-skeleton', { columns: 2 }, undefined, 'loading', 'h-72')}
        {host('nav-card', 'nc-empty', { columns: 2, emptyState: { titleKey: 'Nothing to show' } }, { rows: [], total: 0 }, 'success', 'h-72')}
        {host('nav-card', 'nc-error', { columns: 2 }, undefined, 'error', 'h-72')}
      </div>
    </Frame>
  ),
};

// ── Theme × direction matrix (acceptance #9) ───────────────────────────────

/**
 * REAL mirroring: each cell sets `dir` on a wrapper so the logical utilities
 * resolve for that direction — the breadcrumb chevrons point the other way, the
 * nav badges move edge, the nav-card arrow flips (`rtl:rotate-180`), and the
 * avatar stack overlaps from the other side (`-ms-2`).
 */
function matrixCells(key: string) {
  // Instance ids derive from the cell key, never randomised — VRT captures must
  // be byte-identical across runs (04 §7.7).
  return (
    <div className="grid gap-4">
      {host('breadcrumb', `m-crumb-${key}`, {}, breadcrumbDemoData(6), 'success', 'h-20')}
      {host('tab-bar', `m-tabs-${key}`, { style: 'underline' }, tabBarDemoData(3), 'success', 'h-20')}
      {host('nav-card', `m-navcard-${key}`, { columns: 2 }, navCardDemoData(11), 'success', 'h-64')}
      {host('avatar-stack', `m-avatars-${key}`, { presence: true, onlineLabel: '{count} online' }, avatarStackDemoData(2), 'success', 'h-24')}
      <div className="w-64">{host('sidebar-nav', `m-nav-${key}`, navConfig, sidebarNavDemoData(4), 'success', 'h-80')}</div>
    </div>
  );
}

export const LightLtr = { name: 'light · LTR', render: () => <Frame dir="ltr">{matrixCells('light-ltr')}</Frame> };
export const LightRtl = { name: 'light · RTL', render: () => <Frame dir="rtl">{matrixCells('light-rtl')}</Frame> };
export const DarkLtr = { name: 'dark · LTR', render: () => <Frame dark dir="ltr">{matrixCells('dark-ltr')}</Frame> };
export const DarkRtl = { name: 'dark · RTL', render: () => <Frame dark dir="rtl">{matrixCells('dark-rtl')}</Frame> };
