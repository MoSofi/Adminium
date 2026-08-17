// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TRACK OPS — data-contract shapes for the §13 ops / billing / API / marketing
 * cards (the 18 ids that are neither `document-canvas` nor a `block-*`).
 *
 * Every one of these is a projection of a REAL table an Adminium user already
 * has (a monitors table, a payment-methods table, an api_keys table…), so none
 * of them invents a bespoke envelope: they bind the canonical §3 `record` /
 * `record-list` shapes and normalize at the component boundary. The interfaces
 * below are the POST-resolution normalized views the components render — field
 * NAMES on the wire are config-driven (`nameField`, `statusField`, …), exactly
 * as `GanttTask` is to a task row (see domain-types.ts).
 *
 * Envelopes carry `total` so the host's shared `isEmptyByShape['record-list']`
 * predicate routes the empty state on it (04 §3).
 */

/** The §3 `record-list` envelope every list-shaped widget here binds. */
export interface OpsListData {
  rows: Record<string, unknown>[];
  total: number;
}

/** The §3 `record` envelope every single-row card here binds. */
export interface OpsRecordData {
  row: Record<string, unknown> | null;
}

// --- slo-monitor-card / uptime-segment-bar -----------------------------------

/**
 * Per-day service health (annex §13: "30-bar daily uptime sparkline (height +
 * color by Operational/Degraded/Down)"). A closed vocabulary so a corrupt
 * status column can never smuggle an unknown state into the tone map.
 */
export const UPTIME_STATES = ['operational', 'degraded', 'down', 'unknown'] as const;
export type UptimeState = (typeof UPTIME_STATES)[number];

/** One normalized SLA monitor (annex "{name, endpoint, target, current, status, budget, p95}"). */
export interface SloMonitor {
  name: string;
  endpoint?: string | undefined;
  /** Target availability, percent 0–100. */
  target: number;
  /** Current availability, percent 0–100. */
  current: number;
  status: UptimeState;
  /** Error budget REMAINING, percent 0–100. */
  budget: number;
  /** p95 latency in milliseconds. */
  p95?: number | undefined;
  /** Trailing daily statuses, oldest → newest (the 30-bar sparkline). */
  history: UptimeState[];
}

/** One day strip in the statuspage-style bar. */
export interface UptimeDay {
  /** UTC epoch ms of the day. */
  ms: number;
  state: UptimeState;
}

// --- experiment-variant-compare ----------------------------------------------

/** One experiment arm (annex "variants[{name, conv, users, control?}]"). */
export interface ExperimentVariant {
  id: string;
  name: string;
  /** Conversion rate, percent 0–100. */
  conv: number;
  /** Participants. */
  users: number;
  /** Conversions (derived when the column is absent: users × conv). */
  conversions: number;
  /** The control arm — lift is measured against it. */
  control: boolean;
}

// --- credit-card-tile ---------------------------------------------------------

/** Card networks the tile renders a brand treatment for. */
export const CARD_BRANDS = ['visa', 'mastercard', 'amex', 'discover', 'unknown'] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

/** A stored payment method (annex "{brand, last4, holder, exp, isDefault}"). */
export interface PaymentMethod {
  brand: CardBrand;
  last4: string;
  holder?: string | undefined;
  /** Expiry as stored — "04/28". Never parsed into a Date (it is not an instant). */
  exp?: string | undefined;
  isDefault: boolean;
}

// --- plan-pricing-cards -------------------------------------------------------

/** One pricing tier (annex "plan defs + billing period state"). */
export interface PricingPlan {
  id: string;
  name: string;
  tagline?: string | undefined;
  /** Monthly list price in `currency`'s major units. The annual price is DERIVED. */
  monthly: number;
  features: string[];
  /** The tier the card grid promotes (accent border + POPULAR pill). */
  promoted: boolean;
  /** The viewer's active plan, from the subscription record. */
  current: boolean;
}

// --- api-keys-panel -----------------------------------------------------------

/** A key record (annex "{name, env, prefix, tail, scopes[], lastUsed, kind}"). */
export interface ApiKeyRecord {
  id: string;
  name: string;
  /** Deployment env — drives the live/test badge. */
  env: string;
  /** Public prefix, shown verbatim: "sk_live_". */
  prefix: string;
  /** Last few characters, shown verbatim after the bullets. */
  tail: string;
  scopes: string[];
  /** Epoch ms of the last request signed with this key; absent → never used. */
  lastUsed?: number | undefined;
  /** `secret` keys mask by default and offer a reveal; `publishable` never mask. */
  kind: 'secret' | 'publishable';
  /**
   * Can this key still be revoked? Absent ⇒ yes (the common case).
   *
   * `false` for a key that is already revoked or expired: revoking it is a no-op,
   * and the panel hides the control rather than rendering a button whose click
   * does nothing. A dead control that swallows clicks silently — no confirm, no
   * toast, no disabled state — leaves the user unable to tell whether the app is
   * broken or the action simply did not apply.
   */
  revocable?: boolean | undefined;
}

// --- webhook-endpoints-list ---------------------------------------------------

/** A hook registration (annex "{event, url, lastFired, enabled}"). */
export interface WebhookEndpoint {
  id: string;
  event: string;
  url: string;
  lastFired?: number | undefined;
  enabled: boolean;
}

// --- resource-api-card --------------------------------------------------------

/** A per-table API card (annex "table metadata + request stats"). */
export interface ResourceApi {
  name: string;
  rowCount: number;
  /** Row-level security is on — the card badges RLS vs Public. */
  rls: boolean;
  methods: string[];
  /** Trailing per-day request counts, oldest → newest (the sparkline). */
  requests: number[];
  /** Requests per day (the headline stat). */
  perDay: number;
}

// --- policy-list --------------------------------------------------------------

/** An RLS policy row (annex "{name, cmd, role, enabled} per table"). */
export interface RlsPolicy {
  id: string;
  name: string;
  /** SQL command the policy governs — SELECT / INSERT / UPDATE / DELETE / ALL. */
  cmd: string;
  role: string;
  enabled: boolean;
}

// --- onboarding-checklist -----------------------------------------------------

/** A checklist step (annex "tasks {title, desc, icon, time, action, done}"). */
export interface OnboardingTask {
  id: string;
  title: string;
  desc?: string | undefined;
  /** Estimated minutes — rendered through the Intl layer, never as a raw "5 min". */
  minutes?: number | undefined;
  /** CTA label; absent → the row has no action button. */
  action?: string | undefined;
  /** CTA target — a drill-through href. */
  href?: string | undefined;
  done: boolean;
}

// --- starter-template-picker --------------------------------------------------

/** A starter definition (annex "starterDefs[] merged over base doc"). */
export interface StarterDef {
  id: string;
  title: string;
  category?: string | undefined;
  /** Thumbnail mini-chart series — REAL numbers, per the annex's generated thumb. */
  series: number[];
  /** The "start from nothing" card, rendered as a dashed ghost tile. */
  blank: boolean;
}

// --- live-timer ---------------------------------------------------------------

/** The stopwatch's bound row (annex "{taskName, project, running, elapsed}"). */
export interface TimerState {
  taskName: string;
  project?: string | undefined;
  running: boolean;
  /** Seconds accumulated BEFORE `startedAt` (a paused total). */
  elapsed: number;
  /**
   * Epoch ms the current run began; only meaningful while `running`. Elapsed
   * time is `elapsed + (now - startedAt)/1000` — and `now` is INJECTED, never
   * read from the wall clock inside the widget (see domain-ops-lib.ts).
   */
  startedAt?: number | undefined;
}

// --- sync-status-card ---------------------------------------------------------

/** Connection + sync progress (annex "DB identity, 'Connected · 42ms', …"). */
export interface SyncStatus {
  name: string;
  engine?: string | undefined;
  connected: boolean;
  /** Round-trip probe latency, ms. */
  latencyMs?: number | undefined;
  rowsSynced: number;
  tables: number;
  lastSync?: number | undefined;
  nextSync?: number | undefined;
  /** Sync-now state machine (annex): idle → syncing → synced | failed. */
  phase: 'idle' | 'syncing' | 'synced' | 'failed';
}

// --- testimonial-card ---------------------------------------------------------

/** A marketing quote (annex "{initials, quote, name, role, company}"). */
export interface Testimonial {
  quote: string;
  name: string;
  role?: string | undefined;
  company?: string | undefined;
  /** Explicit initials override; absent → derived from `name` by `Avatar`. */
  initials?: string | undefined;
}

// --- api-playground -----------------------------------------------------------

/** HTTP methods the composer offers. */
export const HTTP_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** The selected endpoint (annex "selected endpoint metadata + sample rows"). */
export interface PlaygroundEndpoint {
  method: HttpMethod;
  path: string;
  /** Query params / body fields the composer lists as editable rows. */
  params: { key: string; value: string }[];
  /** Canned response body — the widget NEVER performs a request. */
  sample: unknown;
  /** HTTP status the response pane pills. */
  status: number;
  /** Simulated round-trip, ms. */
  latencyMs: number;
}
