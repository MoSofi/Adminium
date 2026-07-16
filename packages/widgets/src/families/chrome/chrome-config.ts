/**
 * `chrome` family config schemas + deterministic demo generators (annex §11) —
 * PURE module (zod + chrome-lib only; no React, no @adminium/ui, no lucide).
 *
 * WHY THIS EXISTS: the registry metadata graph reaches this family through
 * `chrome-track.definitions.ts`, which imports these schemas and `demoData`
 * generators. Those must NOT drag the @adminium/ui-heavy components into the
 * eager registry chunk — components load only through
 * `lazy(() => import('./chrome-track-components.js'))` (one lazy chunk per
 * family, 04 §2.3; the media/system/boards `*-config` convention).
 *
 * LABELS: widgets are locale-agnostic (04 §2) — user-visible copy arrives as
 * already-translated strings through config, with English developer fallbacks.
 * The dashboard fills them from `t('…')`; en-US entries live at `widgets.chrome.*`.
 *
 * DETERMINISM (04 §7.7): every `demoData(seed)` is a pure function of `seed` —
 * no `Date.now()`, no `Math.random()`. Timestamps derive from `CHROME_DEMO_EPOCH`.
 */

import { z } from 'zod';
import { mulberry32 } from '@adminium/charts';

import { COMMAND_GROUPS, TAB_STYLES } from './chrome-lib.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/**
 * Fixed reference clock for every `chrome` demo payload — 2026-03-17T09:15:00Z.
 * Demo data must be byte-identical across runs (04 §7.7 / the determinism gate).
 */
export const CHROME_DEMO_EPOCH = Date.UTC(2026, 2, 17, 9, 15, 0);

const toneSchema = z.enum(['neutral', 'accent', 'pos', 'warn', 'danger', 'info']);

// ── sidebar-nav (annex §11) ─────────────────────────────────────────────────

export const sidebarNavConfigSchema = widgetSharedConfigSchema.extend({
  /** Which field of each row carries what (04 §5). */
  groupField: z.string().default('group'),
  labelField: z.string().default('label'),
  iconField: z.string().default('icon'),
  hrefField: z.string().default('href'),
  badgeField: z.string().default('badge'),
  keyField: z.string().default('key'),
  /**
   * Group render order + display labels. Groups present in the payload but
   * absent here render after the ordered ones, in payload order.
   */
  groups: z.array(z.object({ key: z.string(), label: z.string().optional() })).optional(),
  /** Href of the currently-active item; the host passes the live route. */
  activeHref: z.string().optional(),
  /** Collapse group sections (annex §11 `collapsible`). */
  collapsible: z.boolean().default(false),
  /** Render live count badges from `badgeField` (annex §11). */
  showBadges: z.boolean().default(true),
  a11yLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type SidebarNavConfig = z.infer<typeof sidebarNavConfigSchema>;

const DEMO_NAV: readonly { group: string; label: string; icon: string; href: string; badge?: number }[] = [
  { group: 'workspace', label: 'Overview', icon: 'home', href: '/' },
  { group: 'workspace', label: 'Orders', icon: 'table', href: '/orders', badge: 12 },
  { group: 'workspace', label: 'Customers', icon: 'users', href: '/customers' },
  { group: 'library', label: 'Products', icon: 'table', href: '/products' },
  { group: 'library', label: 'Categories', icon: 'table', href: '/categories' },
  { group: 'people', label: 'Team', icon: 'users', href: '/team' },
  { group: 'account', label: 'Settings', icon: 'settings', href: '/settings' },
];

export function sidebarNavDemoData(seed: number): {
  rows: Record<string, unknown>[];
  columns: { name: string; label: string }[];
  total: number;
} {
  const random = mulberry32(seed);
  const rows = DEMO_NAV.map((item) => ({
    key: item.href,
    group: item.group,
    label: item.label,
    icon: item.icon,
    href: item.href,
    // Seed varies the live badge counts, not the nav structure.
    badge: item.badge === undefined ? undefined : Math.round(item.badge * (0.4 + random())),
  }));
  return {
    rows,
    columns: [
      { name: 'group', label: 'Group' },
      { name: 'label', label: 'Label' },
      { name: 'href', label: 'Href' },
      { name: 'badge', label: 'Badge' },
    ],
    total: rows.length,
  };
}

// ── command-palette + global-search (annex §11) ─────────────────────────────

/** The index fields both search surfaces read (annex §11 `flat index`). */
const searchIndexFields = {
  idField: z.string().default('id'),
  groupField: z.string().default('group'),
  labelField: z.string().default('label'),
  subField: z.string().default('sub'),
  iconField: z.string().default('icon'),
  hrefField: z.string().default('href'),
  shortcutField: z.string().default('shortcut'),
};

export const commandPaletteConfigSchema = widgetSharedConfigSchema.extend({
  ...searchIndexFields,
  /** Fixed group render order (annex §11). Unknown groups render last. */
  groupOrder: z.array(z.enum(COMMAND_GROUPS)).optional(),
  /** Display labels per group key. */
  groupLabels: z.record(z.enum(COMMAND_GROUPS), z.string()).optional(),
  /** Cap on rendered results per group — the palette is a shortlist, not a list. */
  maxPerGroup: z.number().int().min(1).max(50).default(6),
  placeholder: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
  /** Footer key-legend copy. */
  navigateHint: z.string().optional(),
  selectHint: z.string().optional(),
  closeHint: z.string().optional(),
});
export type CommandPaletteConfig = z.infer<typeof commandPaletteConfigSchema>;

const DEMO_COMMANDS: readonly { id: string; group: string; label: string; sub?: string; icon?: string; href: string; shortcut?: string }[] = [
  { id: 'a1', group: 'actions', label: 'Create order', icon: 'plus', href: '/orders/new', shortcut: 'C' },
  { id: 'a2', group: 'actions', label: 'Export customers', icon: 'download', href: '/customers?export=1' },
  { id: 'a3', group: 'actions', label: 'Invite teammate', icon: 'users', href: '/team/invite' },
  { id: 'n1', group: 'navigate', label: 'Orders', sub: 'public.orders', icon: 'table', href: '/orders' },
  { id: 'n2', group: 'navigate', label: 'Customers', sub: 'public.customers', icon: 'table', href: '/customers' },
  { id: 'n3', group: 'navigate', label: 'Products', sub: 'public.products', icon: 'table', href: '/products' },
  { id: 'r1', group: 'recent', label: 'Order #10248', sub: 'Opened yesterday', icon: 'clock', href: '/orders/10248' },
  { id: 'r2', group: 'recent', label: 'Ana Trujillo', sub: 'Opened 2 days ago', icon: 'clock', href: '/customers/2' },
];

export function commandPaletteDemoData(seed: number): {
  rows: Record<string, unknown>[];
  columns: { name: string; label: string }[];
  total: number;
} {
  const random = mulberry32(seed);
  // Seed decides how deep the index goes — always enough to show >1 group.
  const count = 4 + Math.floor(random() * (DEMO_COMMANDS.length - 3));
  const rows = DEMO_COMMANDS.slice(0, count).map((row) => ({ ...row }));
  return {
    rows,
    columns: [
      { name: 'group', label: 'Group' },
      { name: 'label', label: 'Label' },
      { name: 'href', label: 'Href' },
    ],
    total: rows.length,
  };
}

export const globalSearchConfigSchema = widgetSharedConfigSchema.extend({
  ...searchIndexFields,
  /** `type` drives the per-result icon/tone meta (annex §11 `typeMeta`). */
  typeField: z.string().default('type'),
  snippetField: z.string().default('snippet'),
  metaField: z.string().default('meta'),
  updatedField: z.string().default('updated'),
  /** Header dropdown vs the full-page results view (annex §11). */
  variant: z.enum(['dropdown', 'page']).default('dropdown'),
  /** Per-entity-type display meta. */
  typeMeta: z
    .record(z.string(), z.object({ label: z.string().optional(), icon: z.string().optional(), tone: toneSchema.optional() }))
    .optional(),
  /** Facet rail order (the `page` variant). */
  entityTypes: z.array(z.string()).optional(),
  /** Quick links shown when the query is empty (the `dropdown` variant). */
  quickLinks: z.array(z.object({ label: z.string(), href: z.string(), icon: z.string().optional() })).optional(),
  maxResults: z.number().int().min(1).max(100).default(20),
  placeholder: z.string().optional(),
  /** "{count} results for …" summary copy; `{count}` and `{query}` interpolate. */
  summaryTemplate: z.string().optional(),
  allLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type GlobalSearchConfig = z.infer<typeof globalSearchConfigSchema>;

const DEMO_SEARCH: readonly { id: string; type: string; label: string; snippet: string; meta: string; hours: number }[] = [
  { id: 's1', type: 'record', label: 'Order #10248', snippet: 'Vins et alcools Chevalier · $440.00 · Shipped', meta: 'orders', hours: 3 },
  { id: 's2', type: 'people', label: 'Ana Trujillo', snippet: 'Owner · Emparedados y helados · México D.F.', meta: 'customers', hours: 27 },
  { id: 's3', type: 'page', label: 'Revenue dashboard', snippet: 'Monthly revenue, orders by region, top movers', meta: 'dashboards', hours: 5 },
  { id: 's4', type: 'metric', label: 'Total revenue', snippet: 'SUM(order_details.unit_price × quantity)', meta: 'metrics', hours: 50 },
  { id: 's5', type: 'record', label: 'Order #10249', snippet: 'Toms Spezialitäten · $1,863.40 · Delivered', meta: 'orders', hours: 9 },
  { id: 's6', type: 'page', label: 'Customers', snippet: 'CRUD admin for public.customers', meta: 'pages', hours: 120 },
];

export function globalSearchDemoData(seed: number): {
  rows: Record<string, unknown>[];
  columns: { name: string; label: string }[];
  total: number;
} {
  const random = mulberry32(seed);
  const count = 3 + Math.floor(random() * (DEMO_SEARCH.length - 2));
  const rows = DEMO_SEARCH.slice(0, count).map((row) => ({
    id: row.id,
    type: row.type,
    label: row.label,
    snippet: row.snippet,
    meta: row.meta,
    href: `/search/${row.id}`,
    // Offsets from the fixed epoch — never Date.now() (04 §7.7).
    updated: new Date(CHROME_DEMO_EPOCH - row.hours * 3_600_000).toISOString(),
  }));
  return {
    rows,
    columns: [
      { name: 'type', label: 'Type' },
      { name: 'label', label: 'Title' },
      { name: 'snippet', label: 'Snippet' },
      { name: 'updated', label: 'Updated' },
    ],
    total: rows.length,
  };
}

// ── breadcrumb (annex §11) ──────────────────────────────────────────────────

export const breadcrumbConfigSchema = widgetSharedConfigSchema.extend({
  labelField: z.string().default('name'),
  hrefField: z.string().default('href'),
  idField: z.string().default('id'),
  /** Collapse the middle of a deep trail behind an ellipsis (annex §11 `maxDepth/collapse`). */
  maxDepth: z.number().int().min(2).max(12).default(6),
  a11yLabel: z.string().optional(),
});
export type BreadcrumbConfig = z.infer<typeof breadcrumbConfigSchema>;

const DEMO_TRAIL = ['Files', 'Projects', 'Coastal Beach House', 'Site Photos', 'Exterior', 'Final'] as const;

export function breadcrumbDemoData(seed: number): {
  rows: Record<string, unknown>[];
  columns: { name: string; label: string }[];
  total: number;
} {
  const random = mulberry32(seed);
  const depth = 2 + Math.floor(random() * (DEMO_TRAIL.length - 1));
  const rows = DEMO_TRAIL.slice(0, depth).map((name, index) => ({
    id: `n${index}`,
    name,
    href: `/files/${DEMO_TRAIL.slice(0, index + 1).map((part) => part.toLowerCase().replace(/ /g, '-')).join('/')}`,
  }));
  return { rows, columns: [{ name: 'name', label: 'Name' }], total: rows.length };
}

// ── tab-bar (annex §11) ─────────────────────────────────────────────────────

export const tabBarConfigSchema = widgetSharedConfigSchema.extend({
  keyField: z.string().default('key'),
  labelField: z.string().default('label'),
  iconField: z.string().default('icon'),
  countField: z.string().default('count'),
  hrefField: z.string().default('href'),
  /** Annex §11 `style` — underline or segmented pills. */
  style: z.enum(TAB_STYLES).default('underline'),
  /** Render count pills in labels (annex §11 `counts`). */
  counts: z.boolean().default(true),
  /** Active tab key; uncontrolled when absent (first tab wins). */
  activeKey: z.string().optional(),
  a11yLabel: z.string().optional(),
});
export type TabBarConfig = z.infer<typeof tabBarConfigSchema>;

const DEMO_TABS: readonly { key: string; label: string; icon: string; count?: number }[] = [
  { key: 'all', label: 'All', icon: 'table', count: 248 },
  { key: 'open', label: 'Open', icon: 'inbox', count: 31 },
  { key: 'shipped', label: 'Shipped', icon: 'check', count: 195 },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

export function tabBarDemoData(seed: number): {
  rows: Record<string, unknown>[];
  columns: { name: string; label: string }[];
  total: number;
} {
  const random = mulberry32(seed);
  const rows = DEMO_TABS.map((tab) => ({
    ...tab,
    count: tab.count === undefined ? undefined : Math.round(tab.count * (0.5 + random())),
    href: `/orders?tab=${tab.key}`,
  }));
  return { rows, columns: [{ name: 'label', label: 'Tab' }], total: rows.length };
}

// ── nav-card (annex §11) ────────────────────────────────────────────────────

export const navCardConfigSchema = widgetSharedConfigSchema.extend({
  nameField: z.string().default('name'),
  descField: z.string().default('desc'),
  iconField: z.string().default('icon'),
  hrefField: z.string().default('href'),
  tintField: z.string().default('tint'),
  /** Cards per row (annex §11 `columns`). */
  columns: z.number().int().min(1).max(4).default(3),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type NavCardConfig = z.infer<typeof navCardConfigSchema>;

const DEMO_NAV_CARDS: readonly { name: string; desc: string; icon: string; href: string; tint: string }[] = [
  { name: 'Orders', desc: 'Browse, filter and edit every order across all regions.', icon: 'table', href: '/orders', tint: 'accent' },
  { name: 'Customers', desc: 'The full customer directory with contact details.', icon: 'users', href: '/customers', tint: 'info' },
  { name: 'Revenue', desc: 'Monthly revenue, top movers and regional breakdown.', icon: 'chart', href: '/dashboards/revenue', tint: 'pos' },
  { name: 'Settings', desc: 'Workspace, connections, members and billing.', icon: 'settings', href: '/settings', tint: 'neutral' },
  { name: 'Audit log', desc: 'Every mutation with actor, before and after.', icon: 'clock', href: '/audit', tint: 'warn' },
  { name: 'Exports', desc: 'Scheduled and one-off data exports.', icon: 'download', href: '/exports', tint: 'accent' },
];

export function navCardDemoData(seed: number): {
  rows: Record<string, unknown>[];
  columns: { name: string; label: string }[];
  total: number;
} {
  const random = mulberry32(seed);
  const count = 2 + Math.floor(random() * (DEMO_NAV_CARDS.length - 1));
  const rows = DEMO_NAV_CARDS.slice(0, count).map((card) => ({ ...card }));
  return { rows, columns: [{ name: 'name', label: 'Name' }], total: rows.length };
}

// ── shortcuts-panel (annex §11) ─────────────────────────────────────────────

/** One keycap row: a label + the chord(s) that trigger it. */
export const shortcutEntrySchema = z.object({
  label: z.string(),
  /** Keys in press order. `isSequence` renders them as a "then" chord. */
  keys: z.array(z.string()).min(1).max(4),
  isSequence: z.boolean().default(false),
});

export const shortcutsPanelConfigSchema = widgetSharedConfigSchema.extend({
  /**
   * Annex §11: "static groups of {label, keys[], isSequence}". This widget is
   * `static` — the cheat sheet IS its config, so the host (which owns the live
   * shortcut manager) passes the registered set in rather than the widget
   * fetching one.
   */
  groups: z
    .array(z.object({ group: z.string(), entries: z.array(shortcutEntrySchema) }))
    .optional(),
  /**
   * Modifier glyph for this platform — `⌘` on macOS, `Ctrl` elsewhere. The host
   * decides (it knows the platform); the widget only renders (annex §11
   * "Keycaps localize per platform").
   */
  modKey: z.string().default('⌘'),
  footerHint: z.string().optional(),
  emptyTitle: z.string().optional(),
});
export type ShortcutsPanelConfig = z.infer<typeof shortcutsPanelConfigSchema>;

/** The built-in cheat sheet rendered when config supplies no groups. */
export const DEFAULT_SHORTCUT_GROUPS = [
  {
    group: 'General',
    entries: [
      { label: 'Open command palette', keys: ['MOD', 'K'], isSequence: false },
      { label: 'Search', keys: ['/'], isSequence: false },
      { label: 'Show shortcuts', keys: ['?'], isSequence: false },
    ],
  },
  {
    group: 'Navigation',
    entries: [
      { label: 'Go to dashboard', keys: ['G', 'D'], isSequence: true },
      { label: 'Go to orders', keys: ['G', 'O'], isSequence: true },
    ],
  },
  {
    group: 'Records',
    entries: [
      { label: 'New record', keys: ['C'], isSequence: false },
      { label: 'Save', keys: ['MOD', 'S'], isSequence: false },
      { label: 'Undo', keys: ['MOD', 'Z'], isSequence: false },
    ],
  },
] as const;

/** `shortcuts-panel` is `static`: the cheat sheet is config, so there is nothing to seed. */
export function shortcutsPanelDemoData(): Record<string, never> {
  return {};
}

// ── avatar-stack (annex §11) ────────────────────────────────────────────────

export const avatarStackConfigSchema = widgetSharedConfigSchema.extend({
  nameField: z.string().default('name'),
  initialsField: z.string().default('initials'),
  imageField: z.string().default('imageUrl'),
  onlineField: z.string().default('online'),
  /** Avatars shown before the "+N" overflow bubble (annex §11 `max`). */
  max: z.number().int().min(1).max(12).default(5),
  size: z.enum(['sm', 'md', 'lg']).default('md'),
  /** Presence variant: online dots + an "N online" caption (annex §11). */
  presence: z.boolean().default(false),
  onlineLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
});
export type AvatarStackConfig = z.infer<typeof avatarStackConfigSchema>;

const DEMO_PEOPLE = ['Ana Trujillo', 'Bo Lien', 'Carlos Diaz', 'Dana Wu', 'Eli S', 'Farah N', 'Gil P', 'Hana K'] as const;

export function avatarStackDemoData(seed: number): {
  rows: Record<string, unknown>[];
  columns: { name: string; label: string }[];
  total: number;
} {
  const random = mulberry32(seed);
  const count = 3 + Math.floor(random() * (DEMO_PEOPLE.length - 2));
  const rows = DEMO_PEOPLE.slice(0, count).map((name) => ({
    name,
    initials: name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase(),
    online: random() > 0.5,
  }));
  return { rows, columns: [{ name: 'name', label: 'Name' }], total: rows.length };
}
