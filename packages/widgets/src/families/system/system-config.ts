/**
 * `system` family config schemas + deterministic demo generators (annex §12) —
 * PURE module (zod + system-lib only; no React, no @adminium/ui, no lucide).
 *
 * WHY THIS EXISTS: the registry metadata graph reaches this family through
 * `system-track.definitions.ts`, which imports these schemas and `demoData`
 * generators. Those must NOT drag the @adminium/ui-heavy components into the
 * eager registry chunk — components load only through
 * `lazy(() => import('./system-track-components.js'))` (one lazy chunk per
 * family, 04 §2.3; the media/boards/kpi `*-config` convention). Component files
 * re-export these symbols so barrel/story/test import points stay stable.
 *
 * FIELD-NAMING CONFIG (04 §5): system widgets bind to rows from real tables
 * whose columns are named whatever the source schema calls them, so each widget
 * takes `*Field` config naming which column carries what. Defaults match the
 * annex's canonical contract; the auto-instantiation hook (annex §12) fills them
 * from the classifier's enum/health semantics.
 *
 * LABELS: widgets are locale-agnostic (04 §2) — user-visible copy arrives as
 * already-translated strings through config, with English developer fallbacks.
 * The dashboard fills them from `t('…')`; en-US entries live at `widgets.system.*`.
 *
 * DETERMINISM (04 §7.7): every `demoData(seed)` is a pure function of `seed` —
 * no `Date.now()`, no `Math.random()`. Timestamps derive from `SYSTEM_DEMO_EPOCH`.
 */

import { z } from 'zod';
import { mulberry32 } from '@adminium/charts';

import {
  AUTOSAVE_STATUSES,
  CONNECTION_STATES,
  LOG_LINE_KINDS,
  SERVICE_STATES,
  STATE_HERO_VIEWS,
  SYSTEM_TONES,
} from './system-lib.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/**
 * Fixed reference clock for every `system` demo payload — 2026-03-17T09:15:00Z.
 * Demo data must be byte-identical across runs (04 §7.7 / the determinism gate),
 * so relative stamps are offsets from this constant, never the wall clock.
 */
export const SYSTEM_DEMO_EPOCH = Date.UTC(2026, 2, 17, 9, 15, 0);

const toneSchema = z.enum(SYSTEM_TONES);

// ── state-hero (annex §12) ──────────────────────────────────────────────────

/** One entry of the `stateMap` — the hero copy for a single view id. */
export const stateHeroEntrySchema = z.object({
  /** Tone-tinted glyph chip (lucide icon name). */
  icon: z.string().optional(),
  tone: toneSchema.default('neutral'),
  /** Giant mono HTTP code behind the glyph; omitted for non-HTTP states. */
  code: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  primaryLabel: z.string().optional(),
  primaryHref: z.string().optional(),
  secondaryLabel: z.string().optional(),
  secondaryHref: z.string().optional(),
});
export type StateHeroEntryConfig = z.infer<typeof stateHeroEntrySchema>;

export const stateHeroConfigSchema = widgetSharedConfigSchema.extend({
  /** Which view of the map to render; the payload may override it (annex §12). */
  view: z.enum(STATE_HERO_VIEWS).default('404'),
  /** Per-view copy overrides, keyed by view id. Missing entries fall back to the built-in map. */
  stateMap: z.record(z.enum(STATE_HERO_VIEWS), stateHeroEntrySchema).optional(),
  /** 404 variant's floating decorative ornament (annex §12). */
  ornament: z.boolean().default(false),
  /** Quick-link chips under the CTA row (the 404 variant). */
  quickLinks: z.array(z.object({ label: z.string(), href: z.string() })).optional(),
  /** `req_…` support-handshake line, when the failure carried one. */
  requestId: z.string().optional(),
  /** Which field of the bound `record` carries the view id. */
  viewField: z.string().default('view'),
});
export type StateHeroConfig = z.infer<typeof stateHeroConfigSchema>;

export function stateHeroDemoData(seed: number): { row: Record<string, unknown> } {
  const random = mulberry32(seed);
  const view = STATE_HERO_VIEWS[Math.floor(random() * STATE_HERO_VIEWS.length)] ?? '404';
  return { row: { view } };
}

// ── empty-state (annex §12) ─────────────────────────────────────────────────

export const emptyStateConfigSchema = widgetSharedConfigSchema.extend({
  /** Annex §12 variants: plain, CTA, upload drop-zone. */
  variant: z.enum(['plain', 'cta', 'dropzone']).default('plain'),
  /** @adminium/ui copy preset used when `heading`/`body` are absent. */
  preset: z.enum(['no-data', 'all-caught-up', 'no-matches', 'nothing-scheduled']).default('no-data'),
  /** 56px tone-soft icon tile (lucide icon name). */
  glyph: z.string().optional(),
  /**
   * The heading. NOTE: not `title` — `title` is the WidgetFrame header on every
   * widget (shared config), and `empty-state` renders its own centred heading.
   */
  heading: z.string().optional(),
  /** Muted body copy; the annex caps the measure at 36ch. */
  body: z.string().optional(),
  primaryLabel: z.string().optional(),
  primaryHref: z.string().optional(),
  secondaryLabel: z.string().optional(),
  secondaryHref: z.string().optional(),
  /** Dense variant for small hosts. */
  compact: z.boolean().default(false),
});
export type EmptyStateConfig = z.infer<typeof emptyStateConfigSchema>;

/**
 * `empty-state` is a `static` widget — its payload is its config (annex §12:
 * "static per context, or derived boolean isEmpty from a filtered list"), so the
 * demo payload is an empty envelope rather than fabricated rows.
 */
export function emptyStateDemoData(): Record<string, never> {
  return {};
}

// ── status-pill (annex §12) ─────────────────────────────────────────────────

export const statusPillConfigSchema = widgetSharedConfigSchema.extend({
  /** Which field of the bound record carries the enum value. */
  statusField: z.string().default('status'),
  /** Annex §12 `map` {value: {label, tone}} — the LLM/heuristic-assigned tone map. */
  map: z.record(z.string(), z.object({ label: z.string().optional(), tone: toneSchema.optional() })).optional(),
  /** Tone used for a value absent from `map` and from the @adminium/ui default vocabulary. */
  fallbackTone: toneSchema.default('neutral'),
  /** Show the leading colored dot (annex §12 `dot`). */
  dot: z.boolean().default(true),
});
export type StatusPillConfig = z.infer<typeof statusPillConfigSchema>;

const DEMO_STATUSES = ['active', 'pending', 'failed', 'paid', 'refunded', 'draft'] as const;

export function statusPillDemoData(seed: number): { row: Record<string, unknown> } {
  const random = mulberry32(seed);
  return { row: { status: DEMO_STATUSES[Math.floor(random() * DEMO_STATUSES.length)] ?? 'active' } };
}

// ── alert-banner (annex §12) ────────────────────────────────────────────────

export const alertBannerConfigSchema = widgetSharedConfigSchema.extend({
  severityField: z.string().default('severity'),
  messageField: z.string().default('message'),
  /** Bold stat lead rendered before the copy (annex §12 "bold stat lead or icon"). */
  leadField: z.string().default('lead'),
  ctaLabelField: z.string().default('ctaLabel'),
  ctaHrefField: z.string().default('ctaHref'),
  /** Severity → @adminium/ui Alert tone. Values outside the map fall back to `info`. */
  severityMap: z.record(z.string(), z.enum(['info', 'pos', 'warn', 'danger'])).optional(),
  dismissible: z.boolean().default(false),
  dismissLabel: z.string().optional(),
});
export type AlertBannerConfig = z.infer<typeof alertBannerConfigSchema>;

const DEMO_ALERTS = [
  { severity: 'warn', lead: '92% of plan', message: 'You are approaching your monthly row limit.', ctaLabel: 'Upgrade plan', ctaHref: '/settings/billing' },
  { severity: 'info', lead: 'Recurring', message: 'This schedule repeats monthly on the 1st.', ctaLabel: 'Edit schedule', ctaHref: '/settings/schedules' },
  { severity: 'danger', lead: 'Deploy freeze', message: 'Releases are paused until the incident is resolved.', ctaLabel: 'View incident', ctaHref: '/status' },
  { severity: 'pos', lead: 'Rebalanced', message: 'Workload was redistributed across 4 teammates.', ctaLabel: 'Review', ctaHref: '/team/workload' },
] as const;

export function alertBannerDemoData(seed: number): { row: Record<string, unknown> } {
  const random = mulberry32(seed);
  const pick = DEMO_ALERTS[Math.floor(random() * DEMO_ALERTS.length)] ?? DEMO_ALERTS[0];
  return { row: { ...pick } };
}

// ── status-banner-hero (annex §12) ──────────────────────────────────────────

export const statusBannerHeroConfigSchema = widgetSharedConfigSchema.extend({
  /** Which field of each service row carries its `up|degraded|down` state. */
  stateField: z.string().default('state'),
  nameField: z.string().default('name'),
  /**
   * The inline right-aligned mono KPI trio (annex §12 "+ inline right-aligned
   * mono KPI trio"). Each entry names a field on the FIRST row of the payload.
   */
  stats: z
    .array(z.object({ key: z.string(), label: z.string().optional(), unit: z.string().optional() }))
    .max(3)
    .optional(),
  /** Per-state hero copy (annex §12 `stateStyles`). */
  titles: z.record(z.enum(SERVICE_STATES), z.string()).optional(),
  bodies: z.record(z.enum(SERVICE_STATES), z.string()).optional(),
});
export type StatusBannerHeroConfig = z.infer<typeof statusBannerHeroConfigSchema>;

const DEMO_SERVICES = ['API', 'Dashboard', 'Webhooks', 'Exports', 'Search'] as const;

export function statusBannerHeroDemoData(seed: number): {
  rows: Record<string, unknown>[];
  columns: { name: string; label: string }[];
  total: number;
} {
  const random = mulberry32(seed);
  const rows = DEMO_SERVICES.map((name, index) => {
    const roll = random();
    // Weighted so the demo hero is usually "up" but not always — the worst-wins
    // aggregate needs a degraded/down case to be visible across seeds.
    const state = roll > 0.88 ? 'down' : roll > 0.68 ? 'degraded' : 'up';
    return {
      name,
      state,
      uptime: Number((99.2 + random() * 0.79).toFixed(2)),
      p95: Math.round(80 + random() * 240),
      incidents: index === 0 ? Math.round(random() * 3) : 0,
    };
  });
  return {
    rows,
    columns: [
      { name: 'name', label: 'Service' },
      { name: 'state', label: 'State' },
      { name: 'uptime', label: 'Uptime' },
      { name: 'p95', label: 'p95' },
      { name: 'incidents', label: 'Incidents' },
    ],
    total: rows.length,
  };
}

// ── connection-status (annex §12) ───────────────────────────────────────────

export const connectionStatusConfigSchema = widgetSharedConfigSchema.extend({
  stateField: z.string().default('state'),
  hostField: z.string().default('host'),
  /** Detail line under the headline (error text on `failed`, table count on `connected`). */
  detailField: z.string().default('detail'),
  /** Per-state headline copy (annex §12 `messages`). */
  messages: z.record(z.enum(CONNECTION_STATES), z.string()).optional(),
  /** Render the inline Test action that re-issues the check. */
  testable: z.boolean().default(false),
  testLabel: z.string().optional(),
});
export type ConnectionStatusConfig = z.infer<typeof connectionStatusConfigSchema>;

const DEMO_HOSTS = ['db.prod.internal:5432', 'analytics.eu-west.rds:5432', 'localhost:3306', 'shop.cluster.local:5432'] as const;

export function connectionStatusDemoData(seed: number): { row: Record<string, unknown> } {
  const random = mulberry32(seed);
  const host = DEMO_HOSTS[Math.floor(random() * DEMO_HOSTS.length)] ?? DEMO_HOSTS[0];
  const roll = random();
  const state = roll > 0.82 ? 'failed' : roll > 0.62 ? 'connecting' : 'connected';
  const detail =
    state === 'connected'
      ? `${Math.round(6 + random() * 40)} tables detected`
      : state === 'failed'
        ? 'Connection refused — check the host and port.'
        : undefined;
  return { row: detail === undefined ? { state, host } : { state, host, detail } };
}

// ── autosave-indicator (annex §12) ──────────────────────────────────────────

export const autosaveIndicatorConfigSchema = widgetSharedConfigSchema.extend({
  dirtyField: z.string().default('dirty'),
  savingField: z.string().default('saving'),
  /** Epoch-ms of the last successful save; stamps the "saved at" time. */
  savedAtField: z.string().default('savedAt'),
  errorField: z.string().default('error'),
  /** Annex §12 `debounceMs` — the host's dirty→save debounce; surfaced for the info popover. */
  debounceMs: z.number().int().min(0).max(10_000).default(900),
  /** Show the "· HH:MM" stamp after "All changes saved". */
  showStamp: z.boolean().default(true),
  idleLabel: z.string().optional(),
  dirtyLabel: z.string().optional(),
  savingLabel: z.string().optional(),
  savedLabel: z.string().optional(),
  errorLabel: z.string().optional(),
});
export type AutosaveIndicatorConfig = z.infer<typeof autosaveIndicatorConfigSchema>;

export function autosaveIndicatorDemoData(seed: number): { row: Record<string, unknown> } {
  const random = mulberry32(seed);
  const roll = random();
  const status = roll > 0.8 ? 'saving' : roll > 0.55 ? 'dirty' : 'saved';
  return {
    row: {
      dirty: status === 'dirty',
      saving: status === 'saving',
      error: false,
      // Offset from the fixed demo epoch — never Date.now() (04 §7.7).
      savedAt: SYSTEM_DEMO_EPOCH - Math.round(random() * 9) * 60_000,
    },
  };
}

// ── progress-log-console (annex §12) ────────────────────────────────────────

export const progressLogConsoleConfigSchema = widgetSharedConfigSchema.extend({
  /** Annex §12 `variant`: the live streaming console vs the static terminal sim. */
  variant: z.enum(['live', 'static-terminal']).default('live'),
  textField: z.string().default('text'),
  kindField: z.string().default('kind'),
  /** Optional per-line 0–100 used to drive the paired determinate bar. */
  pctField: z.string().default('pct'),
  /** Render the paired determinate progress bar + mono % (annex §12). */
  showProgress: z.boolean().default(true),
  /** Cap on rendered lines; the console keeps the most RECENT `maxLines`. */
  maxLines: z.number().int().min(3).max(500).default(200),
  /** Auto-scroll to the newest line as the stream appends. */
  follow: z.boolean().default(true),
  a11yLabel: z.string().optional(),
  progressLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type ProgressLogConsoleConfig = z.infer<typeof progressLogConsoleConfigSchema>;

/** The introspection script the annex's evidence comps narrate (Connect Database). */
const DEMO_LOG_SCRIPT: readonly { kind: string; text: string }[] = [
  { kind: 'info', text: '$ adminium introspect --connection prod' },
  { kind: 'ok', text: 'Connected to db.prod.internal:5432 (PostgreSQL 16.2)' },
  { kind: 'ok', text: 'Read 14 tables, 3 views, 118 columns' },
  { kind: 'ok', text: 'Resolved 9 foreign keys, 2 self-references' },
  { kind: 'warn', text: 'orders.notes: 41% NULL — excluded from the list view' },
  { kind: 'ok', text: 'Classified 6 enum columns, 4 money columns' },
  { kind: 'warn', text: 'customers.ssn: looks like PII — masked by default' },
  { kind: 'ok', text: 'Generated 14 CRUD pages, 3 dashboards' },
  { kind: 'running', text: 'Building widget bindings…' },
];

export function progressLogConsoleDemoData(seed: number): {
  rows: Record<string, unknown>[];
  columns: { name: string; label: string }[];
  total: number;
} {
  const random = mulberry32(seed);
  // Seed decides how far the run has progressed — always at least the first
  // three lines so the demo never renders an ambiguous 1-line console.
  const count = 3 + Math.floor(random() * (DEMO_LOG_SCRIPT.length - 2));
  const rows = DEMO_LOG_SCRIPT.slice(0, count).map((line, index) => ({
    id: `log-${index}`,
    kind: line.kind,
    text: line.text,
    pct: Math.round(((index + 1) / DEMO_LOG_SCRIPT.length) * 100),
  }));
  return {
    rows,
    columns: [
      { name: 'kind', label: 'Kind' },
      { name: 'text', label: 'Line' },
      { name: 'pct', label: 'Progress' },
    ],
    total: rows.length,
  };
}

// ── diagnostics-readout (annex §12) ─────────────────────────────────────────

export const diagnosticsReadoutConfigSchema = widgetSharedConfigSchema.extend({
  /**
   * The checks to read off the bound record, in render order (annex §12
   * `checks`). Each names a field; `tones` maps that field's VALUE to a tone so
   * "Reachable"/"Refused" colour themselves.
   */
  checks: z
    .array(
      z.object({
        key: z.string(),
        label: z.string().optional(),
        tones: z.record(z.string(), toneSchema).optional(),
        mono: z.boolean().default(true),
      }),
    )
    .optional(),
  /** Epoch-ms freshness stamp field (annex §12 "+ last-checked timestamp"). */
  checkedAtField: z.string().default('checkedAt'),
  checkedAtLabel: z.string().optional(),
});
export type DiagnosticsReadoutConfig = z.infer<typeof diagnosticsReadoutConfigSchema>;

export function diagnosticsReadoutDemoData(seed: number): { row: Record<string, unknown> } {
  const random = mulberry32(seed);
  const reachable = random() > 0.35;
  return {
    row: {
      host: 'db.prod.internal:5432',
      dns: reachable ? 'Resolved' : 'Resolved',
      tcp: reachable ? 'Reachable' : 'Refused',
      tls: reachable ? 'Verified' : 'Not attempted',
      auth: reachable ? 'Accepted' : 'Not attempted',
      latency: `${Math.round(4 + random() * 60)} ms`,
      checkedAt: SYSTEM_DEMO_EPOCH - Math.round(random() * 5) * 60_000,
    },
  };
}

/** The default check list rendered when config supplies none. */
export const DEFAULT_DIAGNOSTIC_CHECKS: readonly {
  key: string;
  label: string;
  tones?: Record<string, (typeof SYSTEM_TONES)[number]>;
}[] = [
  { key: 'host', label: 'Host' },
  { key: 'dns', label: 'DNS', tones: { Resolved: 'pos', Failed: 'danger' } },
  { key: 'tcp', label: 'TCP', tones: { Reachable: 'pos', Refused: 'danger', Timeout: 'danger' } },
  { key: 'tls', label: 'TLS', tones: { Verified: 'pos', 'Not attempted': 'neutral', Invalid: 'danger' } },
  { key: 'auth', label: 'Auth', tones: { Accepted: 'pos', 'Not attempted': 'neutral', Rejected: 'danger' } },
  { key: 'latency', label: 'Latency' },
];

/** Re-exported vocabularies so the component files import one module. */
export { AUTOSAVE_STATUSES, CONNECTION_STATES, LOG_LINE_KINDS, SERVICE_STATES, STATE_HERO_VIEWS };
