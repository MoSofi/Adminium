// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TRACK OPS — config schemas + deterministic demo generators for the eighteen
 * §13 ops / billing / API / marketing cards. PURE module (zod + domain-lib +
 * domain-ops-lib only; NO React, no component imports).
 *
 * WHY THIS EXISTS: `domain-ops.definitions.ts` imports the schemas and the
 * `demoData` generators. If those lived in the component files, the registry's
 * eager graph — `registry/index.ts` statically imports every family's
 * definitions module — would drag eighteen @adminium/ui-heavy components into
 * the bundle of any page that renders any widget, and the sibling
 * `lazy(() => import('./domain-ops-components.js'))` ref would buy nothing
 * (04 §2.3; qa/chunk-budget.test.ts walks exactly this closure and fails on it).
 * Same convention as `domain-config.ts` / `system-config.ts` / `media-config.ts`.
 *
 * FIELD-NAME CONFIG: every widget here binds a table the user already has, so
 * each schema opens with a field map (`nameField`, `statusField`, …) that
 * projects THEIR columns onto the widget's model. Defaults name the columns the
 * annex's evidence screens use, so a conventionally-named table binds with no
 * config at all.
 *
 * DEMO DETERMINISM (04 §7.7): every generator derives from `mulberry32(seed)`
 * and the fixed `DOMAIN_DEMO_EPOCH` — no `Date.now()`, no `Math.random()`, at
 * module scope or inside a generator. Distinct seeds must yield distinct
 * payloads (the determinism gate asserts the seed genuinely threads through), so
 * every generator varies real content, never just a label.
 */
import { z } from 'zod';

import { DAY_MS, DOMAIN_DEMO_EPOCH, mulberry32, pickFrom } from './domain-lib.js';
import type {
  OpsListData,
  OpsRecordData,
  UptimeState,
} from './domain-ops-types.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/**
 * The demo "now" — day 34 of the demo window, as epoch ms. Stories and tests pin
 * `format.referenceTime` to this so every relative stamp ("2 hours ago"), the
 * running stopwatch, and the uptime axis land in a fixed place without a single
 * wall-clock read (04 §7.7 / VRT byte-determinism). It matches the gantt's
 * `GANTT_DEMO_TODAY_MS` so a page composing both reads as one moment in time.
 */
export const OPS_DEMO_NOW_MS = DOMAIN_DEMO_EPOCH + 34 * DAY_MS;

/** Shared empty-copy overrides every widget in this slice accepts. */
const emptyCopy = {
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
};

/** Seeded pick of `count` distinct members, preserving input order (stable). */
function sampleSome<T>(random: () => number, items: readonly T[], keepProbability: number, minimum: number): T[] {
  const kept = items.filter(() => random() < keepProbability);
  return kept.length >= minimum ? kept : items.slice(0, Math.max(minimum, 1));
}

// ═══════════════════════════════════════════════════════════════════════════
// starter-template-picker (annex §13)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `starter-template-picker` config. `docType` + `defs` are the annex's declared
 * config; `defs` lets a host inject its own starters over the bound list.
 */
export const starterTemplatePickerConfigSchema = widgetSharedConfigSchema.extend({
  idField: z.string().default('id'),
  titleField: z.string().default('title'),
  categoryField: z.string().default('category'),
  seriesField: z.string().default('series'),
  /** Which builder the starters seed — drives the thumbnail's kicker copy. */
  docType: z.enum(['invoice', 'report', 'email']).default('invoice'),
  /** Host-supplied starters, rendered INSTEAD of the bound rows when present. */
  defs: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        category: z.string().optional(),
        series: z.array(z.number()).optional(),
      }),
    )
    .max(24)
    .optional(),
  /** Append the dashed "Blank" ghost card (annex: "+ blank card"). */
  showBlank: z.boolean().default(true),
  /** Localized label for the blank card. */
  blankLabel: z.string().optional(),
  ...emptyCopy,
});
export type StarterTemplatePickerConfig = z.infer<typeof starterTemplatePickerConfigSchema>;

const STARTER_DEFS: readonly { id: string; title: string; category: string }[] = [
  { id: 'st-standard', title: 'Standard invoice', category: 'Billing' },
  { id: 'st-recurring', title: 'Recurring subscription', category: 'Billing' },
  { id: 'st-deposit', title: 'Deposit request', category: 'Billing' },
  { id: 'st-credit', title: 'Credit note', category: 'Billing' },
  { id: 'st-quote', title: 'Quote / estimate', category: 'Sales' },
  { id: 'st-proforma', title: 'Pro forma', category: 'Sales' },
  { id: 'st-receipt', title: 'Payment receipt', category: 'Sales' },
  { id: 'st-monthly', title: 'Monthly summary', category: 'Reports' },
  { id: 'st-quarterly', title: 'Quarterly review', category: 'Reports' },
  { id: 'st-usage', title: 'Usage breakdown', category: 'Reports' },
  { id: 'st-dunning', title: 'Payment reminder', category: 'Email' },
];

/** Deterministic starter `record-list`. The seed drives each thumbnail's series. */
export function starterTemplatePickerDemoData(seed: number): OpsListData {
  const random = mulberry32(seed || 1);
  const rows = STARTER_DEFS.map((def) => ({
    id: def.id,
    title: def.title,
    category: def.category,
    // A real mini-chart, per the annex ("mini chart from actual series").
    series: Array.from({ length: 7 }, () => Math.round(20 + random() * 80)),
  }));
  return { rows, total: rows.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// slo-monitor-card (annex §13)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `slo-monitor-card` config. `target` / `budgetThresholds` / `windowDays` are
 * the annex's declared config. `budgetThresholds` are REMAINING-budget floors
 * (see `budgetTone`), not consumed-budget ceilings.
 */
export const sloMonitorCardConfigSchema = widgetSharedConfigSchema.extend({
  nameField: z.string().default('name'),
  endpointField: z.string().default('endpoint'),
  targetField: z.string().default('target'),
  currentField: z.string().default('current'),
  statusField: z.string().default('status'),
  budgetField: z.string().default('budget'),
  p95Field: z.string().default('p95'),
  /** Column carrying the trailing daily status array. */
  historyField: z.string().default('history'),
  /** Fallback SLA target (percent) when the row carries no target column. */
  target: z.number().min(0).max(100).default(99.9),
  budgetThresholds: z
    .object({
      warn: z.number().min(0).max(100).default(50),
      danger: z.number().min(0).max(100).default(20),
    })
    .optional(),
  /** Days of history the sparkline renders (annex: 30). */
  windowDays: z.number().int().min(7).max(90).default(30),
  targetLabel: z.string().optional(),
  budgetLabel: z.string().optional(),
  latencyLabel: z.string().optional(),
  ...emptyCopy,
});
export type SloMonitorCardConfig = z.infer<typeof sloMonitorCardConfigSchema>;

const SLO_SERVICES: readonly { name: string; endpoint: string }[] = [
  { name: 'Public API', endpoint: 'api.adminium.app/v1' },
  { name: 'Dashboard', endpoint: 'app.adminium.app' },
  { name: 'Realtime gateway', endpoint: 'ws.adminium.app' },
  { name: 'Webhook dispatcher', endpoint: 'hooks.adminium.app' },
];

/**
 * Deterministic trailing status history. Mostly operational with seeded
 * degradations — a flat all-green history would make the sparkline untestable
 * (every bar identical) and unrepresentative.
 */
function demoHistory(random: () => number, days: number): UptimeState[] {
  return Array.from({ length: days }, () => {
    const roll = random();
    if (roll > 0.94) return 'down';
    if (roll > 0.82) return 'degraded';
    return 'operational';
  });
}

/** Deterministic monitor `record`. */
export function sloMonitorCardDemoData(seed: number): OpsRecordData {
  const random = mulberry32(seed || 1);
  const service = pickFrom(random, SLO_SERVICES);
  const history = demoHistory(random, 30);
  const current = 99 + random();
  return {
    row: {
      name: service.name,
      endpoint: service.endpoint,
      target: 99.9,
      current: Math.round(current * 100) / 100,
      status: history[history.length - 1] ?? 'operational',
      budget: Math.round(random() * 100),
      p95: Math.round(60 + random() * 260),
      history,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// uptime-segment-bar (annex §13)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `uptime-segment-bar` config. `period` / `stateColors` are the annex's declared
 * config; `period` is the 30/90-day toggle's INITIAL value (the toggle is
 * component state, so a stored config pins where it starts, not where it stays).
 */
export const uptimeSegmentBarConfigSchema = widgetSharedConfigSchema.extend({
  dayField: z.string().default('day'),
  statusField: z.string().default('status'),
  /** Initial window; the widget's own toggle switches it (annex: "30/90-day toggle"). */
  period: z.enum(['30', '90']).default('90'),
  /** Show the 30/90 toggle at all. */
  showToggle: z.boolean().default(true),
  /** Status → tone override; unmapped statuses use the shared uptime map. */
  stateColors: z.record(z.string(), z.string()).optional(),
  /** Localized "{days} days ago" axis label template. */
  daysAgoLabel: z.string().optional(),
  todayLabel: z.string().optional(),
  uptimeLabel: z.string().optional(),
  ...emptyCopy,
});
export type UptimeSegmentBarConfig = z.infer<typeof uptimeSegmentBarConfigSchema>;

/**
 * Deterministic daily-status `record-list`, oldest → newest, ending on the demo
 * "today". 90 rows so the widget's own 30/90 toggle has something to switch to.
 */
export function uptimeSegmentBarDemoData(seed: number): OpsListData {
  const random = mulberry32(seed || 1);
  const states = demoHistory(random, 90);
  const rows = states.map((status, index) => ({
    day: new Date(OPS_DEMO_NOW_MS - (89 - index) * DAY_MS).toISOString().slice(0, 10),
    status,
  }));
  return { rows, total: rows.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// experiment-variant-compare (annex §13)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `experiment-variant-compare` config. `confThresholds` is the annex's declared
 * config (the significance meter's ≥95 / ≥80 bands).
 *
 * `confidenceField` is read off the ENVELOPE first, then off the winning row:
 * statistical significance is a property of the TEST, not of one arm, and a
 * server that computes it returns it alongside `rows` — but a denormalized
 * variants table that stores it per row must also bind, so both are accepted.
 */
export const experimentVariantCompareConfigSchema = widgetSharedConfigSchema.extend({
  idField: z.string().default('id'),
  nameField: z.string().default('name'),
  convField: z.string().default('conv'),
  usersField: z.string().default('users'),
  conversionsField: z.string().default('conversions'),
  controlField: z.string().default('control'),
  confidenceField: z.string().default('confidence'),
  confThresholds: z
    .object({
      high: z.number().min(0).max(100).default(95),
      medium: z.number().min(0).max(100).default(80),
    })
    .optional(),
  /** Show the paired significance meter (annex: "paired significance-meter"). */
  showSignificance: z.boolean().default(true),
  controlLabel: z.string().optional(),
  winnerLabel: z.string().optional(),
  significanceLabel: z.string().optional(),
  /** Localized verdict copy for the two significance outcomes. */
  verdictSignificantLabel: z.string().optional(),
  verdictInconclusiveLabel: z.string().optional(),
  /** Localized "{users} participants · {conversions} conversions" template. */
  countsLabel: z.string().optional(),
  ...emptyCopy,
});
export type ExperimentVariantCompareConfig = z.infer<typeof experimentVariantCompareConfigSchema>;

const VARIANT_NAMES = ['Control', 'Variant B', 'Variant C', 'Variant D'] as const;

/** Deterministic variants `record-list` + the test's envelope-level confidence. */
export function experimentVariantCompareDemoData(seed: number): OpsListData & { confidence: number } {
  const random = mulberry32(seed || 1);
  const rows = VARIANT_NAMES.map((name, index) => {
    const users = Math.round(3200 + random() * 2400);
    const conv = Math.round((2.4 + random() * 4.2) * 100) / 100;
    return {
      id: `v${index}`,
      name,
      conv,
      users,
      conversions: Math.round((users * conv) / 100),
      control: index === 0,
    };
  });
  return { rows, total: rows.length, confidence: Math.round(60 + random() * 39) };
}

// ═══════════════════════════════════════════════════════════════════════════
// credit-card-tile (annex §13)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `credit-card-tile` config. `brandMeta` / `variant` are the annex's declared
 * config — the three variants ARE this widget (annex: "plus dashed `add-method`
 * ghost card and compact `payment-method-row`"), which is why they are config
 * and not three registry ids (04 §2.1: "visual variants are config, never new
 * registry ids").
 */
export const creditCardTileConfigSchema = widgetSharedConfigSchema.extend({
  brandField: z.string().default('brand'),
  last4Field: z.string().default('last4'),
  holderField: z.string().default('holder'),
  expField: z.string().default('exp'),
  defaultField: z.string().default('is_default'),
  variant: z.enum(['tile', 'row', 'ghost']).default('tile'),
  /** Brand → display name override (the tile's network wordmark). */
  brandMeta: z.record(z.string(), z.string()).optional(),
  defaultLabel: z.string().optional(),
  setDefaultLabel: z.string().optional(),
  manageLabel: z.string().optional(),
  addLabel: z.string().optional(),
  expiresLabel: z.string().optional(),
  ...emptyCopy,
});
export type CreditCardTileConfig = z.infer<typeof creditCardTileConfigSchema>;

const DEMO_CARDS: readonly { brand: string; last4: string; holder: string; exp: string }[] = [
  { brand: 'visa', last4: '4242', holder: 'A. REYES', exp: '04/28' },
  { brand: 'mastercard', last4: '4444', holder: 'M. LEE', exp: '11/27' },
  { brand: 'amex', last4: '0005', holder: 'R. CHO', exp: '08/29' },
  { brand: 'discover', last4: '1117', holder: 'C. FORD', exp: '02/30' },
];

/** Deterministic payment-method `record`. */
export function creditCardTileDemoData(seed: number): OpsRecordData {
  const random = mulberry32(seed || 1);
  const card = pickFrom(random, DEMO_CARDS);
  return {
    row: { brand: card.brand, last4: card.last4, holder: card.holder, exp: card.exp, is_default: random() < 0.5 },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// plan-pricing-cards (annex §13)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `plan-pricing-cards` config. `annualDiscount` / `promotedTier` / `selectable`
 * are the annex's declared config. `annualDiscount` is a FRACTION (0.2 = "2
 * months free"), never a percent — the card computes the annual price from the
 * monthly one, so the discount must be a multiplier.
 */
export const planPricingCardsConfigSchema = widgetSharedConfigSchema.extend({
  idField: z.string().default('id'),
  nameField: z.string().default('name'),
  taglineField: z.string().default('tagline'),
  priceField: z.string().default('monthly'),
  featuresField: z.string().default('features'),
  promotedField: z.string().default('promoted'),
  currentField: z.string().default('is_current'),
  annualDiscount: z.number().min(0).max(0.9).default(0.2),
  /** Plan id/name that gets the accent border + POPULAR pill (overrides the column). */
  promotedTier: z.string().optional(),
  /** In-modal variant: cards become radio-style selectable targets. */
  selectable: z.boolean().default(false),
  /** Initial billing period; the card grid's own toggle switches it. */
  period: z.enum(['monthly', 'annual']).default('monthly'),
  ctaLabel: z.string().optional(),
  currentLabel: z.string().optional(),
  popularLabel: z.string().optional(),
  monthlyLabel: z.string().optional(),
  annualLabel: z.string().optional(),
  /** Localized "per month" suffix under the big price. */
  perMonthLabel: z.string().optional(),
  /** Localized "Billed {total} yearly" note template. */
  billedAnnuallyLabel: z.string().optional(),
  ...emptyCopy,
});
export type PlanPricingCardsConfig = z.infer<typeof planPricingCardsConfigSchema>;

const DEMO_PLANS: readonly { id: string; name: string; tagline: string; monthly: number; features: string[] }[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'For side projects',
    monthly: 0,
    features: ['1 connection', '2 dashboards', 'Community support'],
  },
  {
    id: 'team',
    name: 'Team',
    tagline: 'For growing teams',
    monthly: 29,
    features: ['10 connections', 'Unlimited dashboards', 'Roles & audit log', 'Email support'],
  },
  {
    id: 'business',
    name: 'Business',
    tagline: 'For scale-ups',
    monthly: 99,
    features: ['Unlimited connections', 'SSO & SCIM', 'Row-level security', 'Priority support'],
  },
];

/** Deterministic plan `record-list`. The seed drives which tier the viewer is on. */
export function planPricingCardsDemoData(seed: number): OpsListData {
  const random = mulberry32(seed || 1);
  const currentIndex = Math.floor(random() * DEMO_PLANS.length) % DEMO_PLANS.length;
  const rows = DEMO_PLANS.map((plan, index) => ({
    id: plan.id,
    name: plan.name,
    tagline: plan.tagline,
    monthly: plan.monthly,
    features: plan.features,
    promoted: plan.id === 'team',
    is_current: index === currentIndex,
  }));
  return { rows, total: rows.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// api-keys-panel (annex §13)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `api-keys-panel` config. `scopes` catalog + `envs` are the annex's declared
 * config.
 *
 * `revealedSecret` is the annex's "one-time full-secret reveal success banner
 * after creation": the plaintext exists for exactly one render after a create
 * and is NEVER a bound column (the server stores a hash). It arrives as config
 * because the HOST owns that ephemeral value — a widget that could read the
 * plaintext off a row would mean the plaintext was stored.
 */
export const apiKeysPanelConfigSchema = widgetSharedConfigSchema.extend({
  idField: z.string().default('id'),
  nameField: z.string().default('name'),
  envField: z.string().default('env'),
  prefixField: z.string().default('prefix'),
  tailField: z.string().default('tail'),
  scopesField: z.string().default('scopes'),
  lastUsedField: z.string().default('last_used'),
  kindField: z.string().default('kind'),
  /** Scope vocabulary the panel may render as chips. */
  scopes: z.array(z.string()).max(24).optional(),
  /** Env vocabulary; the first entry is treated as the live/production env. */
  envs: z.array(z.string()).max(8).default(['live', 'test']),
  /** One-time plaintext shown in the post-create banner. Never persisted. */
  revealedSecret: z.string().optional(),
  revealedTitle: z.string().optional(),
  revealedBody: z.string().optional(),
  copyLabel: z.string().optional(),
  copiedLabel: z.string().optional(),
  revealLabel: z.string().optional(),
  hideLabel: z.string().optional(),
  rollLabel: z.string().optional(),
  revokeLabel: z.string().optional(),
  neverUsedLabel: z.string().optional(),
  /** Localized "Last used {since}" template. */
  lastUsedLabel: z.string().optional(),
  ...emptyCopy,
});
export type ApiKeysPanelConfig = z.infer<typeof apiKeysPanelConfigSchema>;

const DEMO_KEYS: readonly { name: string; env: string; kind: string; scopes: string[] }[] = [
  { name: 'Production server', env: 'live', kind: 'secret', scopes: ['read', 'write'] },
  { name: 'Analytics reader', env: 'live', kind: 'secret', scopes: ['read'] },
  { name: 'Web client', env: 'live', kind: 'publishable', scopes: ['read'] },
  { name: 'CI pipeline', env: 'test', kind: 'secret', scopes: ['read', 'write', 'admin'] },
  { name: 'Local dev', env: 'test', kind: 'publishable', scopes: ['read'] },
];

/** Deterministic hex-ish tail from the seeded PRNG (never `Math.random`). */
function demoHex(random: () => number, length: number): string {
  const alphabet = '0123456789abcdef';
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += alphabet[Math.floor(random() * 16) % 16];
  }
  return out;
}

/** Deterministic key `record-list`. */
export function apiKeysPanelDemoData(seed: number): OpsListData {
  const random = mulberry32(seed || 1);
  const rows = DEMO_KEYS.map((key, index) => ({
    id: `k${index}`,
    name: key.name,
    env: key.env,
    prefix: `${key.kind === 'secret' ? 'sk' : 'pk'}_${key.env}_`,
    tail: demoHex(random, 4),
    scopes: key.scopes,
    // Hours back from the pinned demo "now" — never the wall clock.
    last_used: random() < 0.85 ? OPS_DEMO_NOW_MS - Math.round(random() * 72) * 3_600_000 : null,
    kind: key.kind,
  }));
  return { rows, total: rows.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// api-playground (annex §13)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `api-playground` config. `paradigm` / `sandboxMode` are the annex's declared
 * config.
 *
 * `sandboxMode` is DEFAULT TRUE and is the only mode this widget implements: it
 * composes and displays, it never performs a request (a widget that could issue
 * arbitrary authenticated calls from a dashboard cell is a confused-deputy hole).
 * A write method's Send emits a `mutate` INTENT the host executes through the
 * CRUD API — with its permission checks, undo and audit — which is the same
 * contract every editing widget in the registry follows (04 §2.1).
 */
export const apiPlaygroundConfigSchema = widgetSharedConfigSchema.extend({
  methodField: z.string().default('method'),
  pathField: z.string().default('path'),
  paramsField: z.string().default('params'),
  sampleField: z.string().default('sample'),
  statusField: z.string().default('status'),
  latencyField: z.string().default('latency_ms'),
  paradigm: z.enum(['REST', 'GraphQL']).default('REST'),
  /** Compose-and-display only. The widget never issues a network request. */
  sandboxMode: z.boolean().default(true),
  sendLabel: z.string().optional(),
  sendingLabel: z.string().optional(),
  requestLabel: z.string().optional(),
  responseLabel: z.string().optional(),
  paramsLabel: z.string().optional(),
  /** Localized "Run the request to see the response" placeholder. */
  responsePlaceholder: z.string().optional(),
  ...emptyCopy,
});
export type ApiPlaygroundConfig = z.infer<typeof apiPlaygroundConfigSchema>;

const DEMO_ENDPOINTS: readonly { method: string; path: string; params: { key: string; value: string }[] }[] = [
  {
    method: 'GET',
    path: '/v1/orders',
    params: [
      { key: 'limit', value: '25' },
      { key: 'status', value: 'paid' },
    ],
  },
  { method: 'GET', path: '/v1/customers', params: [{ key: 'limit', value: '10' }] },
  { method: 'POST', path: '/v1/orders', params: [{ key: 'customer_id', value: 'cus_8842' }] },
  { method: 'PATCH', path: '/v1/orders/{id}', params: [{ key: 'status', value: 'refunded' }] },
];

/** Deterministic endpoint `record` with a canned response body. */
export function apiPlaygroundDemoData(seed: number): OpsRecordData {
  const random = mulberry32(seed || 1);
  const endpoint = pickFrom(random, DEMO_ENDPOINTS);
  const rows = Array.from({ length: 2 }, (_unused, index) => ({
    id: `ord_${demoHex(random, 6)}`,
    amount: Math.round(2000 + random() * 48_000) / 100,
    status: index === 0 ? 'paid' : 'pending',
  }));
  return {
    row: {
      method: endpoint.method,
      path: endpoint.path,
      params: endpoint.params,
      sample: { object: 'list', data: rows, has_more: false },
      status: 200,
      latency_ms: Math.round(24 + random() * 180),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// code-snippet-block (annex §13)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `code-snippet-block` config. `languages` / `templates` / `copyButton` are the
 * annex's declared config.
 *
 * SYNTAX HIGHLIGHTING IS OUT OF SCOPE (deliberately, not by omission): a
 * tokenizer means a highlighter dependency in every bundle that mounts an API
 * page, for a read-only snippet nobody edits. The block is a mono surface + a
 * language chip + a copy button; if highlighting is ever wanted it arrives as a
 * lazily-loaded decorator, not as a static dep on this family's chunk.
 */
export const codeSnippetBlockConfigSchema = widgetSharedConfigSchema.extend({
  languageField: z.string().default('language'),
  codeField: z.string().default('code'),
  /** Language tabs (annex: cURL / JS / Python); a single entry hides the tabs. */
  languages: z.array(z.string()).max(8).optional(),
  /** language → snippet template. Rendered verbatim; `{}` placeholders are the host's. */
  templates: z.record(z.string(), z.string()).optional(),
  /** Static snippet — used when nothing is bound (annex: "or static string"). */
  code: z.string().optional(),
  /** Language chip for the static snippet. */
  language: z.string().optional(),
  copyButton: z.boolean().default(true),
  copyLabel: z.string().optional(),
  copiedLabel: z.string().optional(),
  ...emptyCopy,
});
export type CodeSnippetBlockConfig = z.infer<typeof codeSnippetBlockConfigSchema>;

const DEMO_SNIPPETS: readonly { language: string; code: string }[] = [
  {
    language: 'cURL',
    code: "curl https://api.adminium.app/v1/orders \\\n  -H 'Authorization: Bearer sk_live_…' \\\n  -d limit=25",
  },
  {
    language: 'JavaScript',
    code: "const res = await fetch('https://api.adminium.app/v1/orders?limit=25', {\n  headers: { Authorization: `Bearer ${key}` },\n});\nconst { data } = await res.json();",
  },
  {
    language: 'Python',
    code: "import httpx\n\nres = httpx.get(\n    'https://api.adminium.app/v1/orders',\n    headers={'Authorization': f'Bearer {key}'},\n    params={'limit': 25},\n)\ndata = res.json()['data']",
  },
];

/** Deterministic snippet `record`. */
export function codeSnippetBlockDemoData(seed: number): OpsRecordData {
  const random = mulberry32(seed || 1);
  const snippet = pickFrom(random, DEMO_SNIPPETS);
  return { row: { language: snippet.language, code: snippet.code } };
}

// ═══════════════════════════════════════════════════════════════════════════
// webhook-endpoints-list (annex §13)
// ═══════════════════════════════════════════════════════════════════════════

/** `webhook-endpoints-list` config. `eventCatalog` is the annex's declared config. */
export const webhookEndpointsListConfigSchema = widgetSharedConfigSchema.extend({
  idField: z.string().default('id'),
  eventField: z.string().default('event'),
  urlField: z.string().default('url'),
  lastFiredField: z.string().default('last_fired'),
  enabledField: z.string().default('enabled'),
  /** Event vocabulary (derived from the connection's tables by the host). */
  eventCatalog: z.array(z.string()).max(64).optional(),
  neverFiredLabel: z.string().optional(),
  /** Localized "Last fired {since}" template. */
  lastFiredLabel: z.string().optional(),
  enableLabel: z.string().optional(),
  ...emptyCopy,
});
export type WebhookEndpointsListConfig = z.infer<typeof webhookEndpointsListConfigSchema>;

const DEMO_HOOKS: readonly { event: string; url: string }[] = [
  { event: 'orders.insert', url: 'https://hooks.acme.dev/orders/new' },
  { event: 'orders.update', url: 'https://hooks.acme.dev/orders/changed' },
  { event: 'customers.insert', url: 'https://crm.acme.dev/ingest' },
  { event: 'invoices.delete', url: 'https://audit.acme.dev/void' },
];

/** Deterministic webhook `record-list`. */
export function webhookEndpointsListDemoData(seed: number): OpsListData {
  const random = mulberry32(seed || 1);
  const rows = DEMO_HOOKS.map((hook, index) => ({
    id: `wh${index}`,
    event: hook.event,
    url: hook.url,
    last_fired: random() < 0.8 ? OPS_DEMO_NOW_MS - Math.round(random() * 48) * 3_600_000 : null,
    enabled: random() < 0.75,
  }));
  return { rows, total: rows.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// resource-api-card (annex §13)
// ═══════════════════════════════════════════════════════════════════════════

/** `resource-api-card` config. `methods` is the annex's declared config. */
export const resourceApiCardConfigSchema = widgetSharedConfigSchema.extend({
  nameField: z.string().default('name'),
  rowCountField: z.string().default('row_count'),
  rlsField: z.string().default('rls'),
  methodsField: z.string().default('methods'),
  requestsField: z.string().default('requests'),
  perDayField: z.string().default('per_day'),
  /** Method chips to render when the row carries no methods column. */
  methods: z.array(z.string()).max(8).default(['GET', 'POST', 'PATCH', 'DELETE']),
  rlsLabel: z.string().optional(),
  publicLabel: z.string().optional(),
  rowsLabel: z.string().optional(),
  /** Localized "{count}/day" template. */
  perDayLabel: z.string().optional(),
  ...emptyCopy,
});
export type ResourceApiCardConfig = z.infer<typeof resourceApiCardConfigSchema>;

const DEMO_RESOURCES: readonly { name: string; rows: number }[] = [
  { name: 'orders', rows: 128_402 },
  { name: 'customers', rows: 24_118 },
  { name: 'invoices', rows: 96_233 },
  { name: 'products', rows: 1_284 },
];

/** Deterministic resource `record`. */
export function resourceApiCardDemoData(seed: number): OpsRecordData {
  const random = mulberry32(seed || 1);
  const resource = pickFrom(random, DEMO_RESOURCES);
  const requests = Array.from({ length: 14 }, () => Math.round(200 + random() * 1800));
  return {
    row: {
      name: resource.name,
      row_count: resource.rows,
      rls: random() < 0.6,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      requests,
      per_day: requests[requests.length - 1] ?? 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// policy-list (annex §13)
// ═══════════════════════════════════════════════════════════════════════════

/** `policy-list` config — RLS policies per table. */
export const policyListConfigSchema = widgetSharedConfigSchema.extend({
  idField: z.string().default('id'),
  nameField: z.string().default('name'),
  cmdField: z.string().default('cmd'),
  roleField: z.string().default('role'),
  enabledField: z.string().default('enabled'),
  /** Command vocabulary the badge tones are keyed off. */
  commands: z.array(z.string()).max(8).default(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL']),
  enableLabel: z.string().optional(),
  ...emptyCopy,
});
export type PolicyListConfig = z.infer<typeof policyListConfigSchema>;

const DEMO_POLICIES: readonly { name: string; cmd: string; role: string }[] = [
  { name: 'Members read own rows', cmd: 'SELECT', role: 'member' },
  { name: 'Members insert own rows', cmd: 'INSERT', role: 'member' },
  { name: 'Admins manage everything', cmd: 'ALL', role: 'admin' },
  { name: 'Service role bypass', cmd: 'ALL', role: 'service' },
  { name: 'Nobody hard-deletes', cmd: 'DELETE', role: 'admin' },
];

/** Deterministic policy `record-list`. */
export function policyListDemoData(seed: number): OpsListData {
  const random = mulberry32(seed || 1);
  const rows = DEMO_POLICIES.map((policy, index) => ({
    id: `p${index}`,
    name: policy.name,
    cmd: policy.cmd,
    role: policy.role,
    enabled: random() < 0.7,
  }));
  return { rows, total: rows.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// live-timer (annex §13)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `live-timer` config. `minSeconds` / `defaultBillable` are the annex's declared
 * config (the `projects source` is the host's binding, not a widget concern).
 *
 * CLOCK POLICY — the tick is a component concern behind an INJECTED clock:
 * `format.referenceTime` pins "now" for demo, tests and VRT captures, and only
 * when it is absent does the component start its own 1s interval. Nothing in
 * this module reads the wall clock, so `demoData(seed)` is byte-identical
 * forever (04 §7.7 / the determinism gate) — which a `Date.now()` in a generator
 * would silently destroy.
 */
export const liveTimerConfigSchema = widgetSharedConfigSchema.extend({
  taskField: z.string().default('task_name'),
  projectField: z.string().default('project'),
  runningField: z.string().default('running'),
  elapsedField: z.string().default('elapsed_sec'),
  startedAtField: z.string().default('started_at'),
  /** Runs shorter than this are discarded rather than saved (annex `minSeconds`). */
  minSeconds: z.number().int().min(0).max(3600).default(60),
  defaultBillable: z.boolean().default(true),
  startLabel: z.string().optional(),
  stopLabel: z.string().optional(),
  taskPlaceholder: z.string().optional(),
  billableLabel: z.string().optional(),
  ...emptyCopy,
});
export type LiveTimerConfig = z.infer<typeof liveTimerConfigSchema>;

const DEMO_TASKS: readonly { task: string; project: string }[] = [
  { task: 'Schema review', project: 'Adminium' },
  { task: 'Customer onboarding call', project: 'Acme' },
  { task: 'Invoice reconciliation', project: 'Finance' },
  { task: 'Dashboard polish', project: 'Adminium' },
];

/**
 * Deterministic timer `record`. `started_at` is pinned relative to the demo
 * "now", so a RUNNING demo timer still renders a fixed elapsed value under a
 * pinned `format.referenceTime`.
 */
export function liveTimerDemoData(seed: number): OpsRecordData {
  const random = mulberry32(seed || 1);
  const entry = pickFrom(random, DEMO_TASKS);
  const running = random() < 0.5;
  const elapsed = Math.round(random() * 5400);
  return {
    row: {
      task_name: entry.task,
      project: entry.project,
      running,
      elapsed_sec: elapsed,
      started_at: running ? OPS_DEMO_NOW_MS - Math.round(random() * 900) * 1000 : null,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// sync-status-card (annex §13)
// ═══════════════════════════════════════════════════════════════════════════

/** `sync-status-card` config. `syncAction` is the annex's declared config. */
export const syncStatusCardConfigSchema = widgetSharedConfigSchema.extend({
  nameField: z.string().default('name'),
  engineField: z.string().default('engine'),
  connectedField: z.string().default('connected'),
  latencyField: z.string().default('latency_ms'),
  rowsSyncedField: z.string().default('rows_synced'),
  tablesField: z.string().default('tables'),
  lastSyncField: z.string().default('last_sync'),
  nextSyncField: z.string().default('next_sync'),
  phaseField: z.string().default('phase'),
  /** Localized label for the sync-now button (annex `syncAction`). */
  syncAction: z.string().optional(),
  connectedLabel: z.string().optional(),
  disconnectedLabel: z.string().optional(),
  rowsSyncedLabel: z.string().optional(),
  tablesLabel: z.string().optional(),
  lastSyncLabel: z.string().optional(),
  nextSyncLabel: z.string().optional(),
  syncingLabel: z.string().optional(),
  ...emptyCopy,
});
export type SyncStatusCardConfig = z.infer<typeof syncStatusCardConfigSchema>;

const DEMO_CONNECTIONS: readonly { name: string; engine: string }[] = [
  { name: 'acme_production', engine: 'PostgreSQL 16' },
  { name: 'billing_replica', engine: 'MySQL 8.4' },
  { name: 'analytics_local', engine: 'SQLite 3.46' },
];

/** Deterministic connection `record`. */
export function syncStatusCardDemoData(seed: number): OpsRecordData {
  const random = mulberry32(seed || 1);
  const connection = pickFrom(random, DEMO_CONNECTIONS);
  return {
    row: {
      name: connection.name,
      engine: connection.engine,
      connected: true,
      latency_ms: Math.round(8 + random() * 90),
      rows_synced: Math.round(120_000 + random() * 900_000),
      tables: Math.round(8 + random() * 40),
      last_sync: OPS_DEMO_NOW_MS - Math.round(random() * 90) * 60_000,
      next_sync: OPS_DEMO_NOW_MS + Math.round(5 + random() * 55) * 60_000,
      phase: 'idle',
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ip-allowlist-card (annex §13)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `ip-allowlist-card` config. The annex gives no config beyond the data; the
 * copy-feedback window is exposed because the annex pins it ("Copy → 'Copied ✓'
 * (1.4s)") and a test must be able to drive it without a real timer.
 */
export const ipAllowlistCardConfigSchema = widgetSharedConfigSchema.extend({
  ipField: z.string().default('ip'),
  labelFieldName: z.string().default('label'),
  /** Milliseconds the "Copied ✓" confirmation stays up (annex: 1.4s). */
  copyResetMs: z.number().int().min(200).max(10_000).default(1400),
  copyLabel: z.string().optional(),
  copiedLabel: z.string().optional(),
  ...emptyCopy,
});
export type IpAllowlistCardConfig = z.infer<typeof ipAllowlistCardConfigSchema>;

const DEMO_IPS: readonly { ip: string; label: string }[] = [
  { ip: '52.18.144.21', label: 'eu-west-1' },
  { ip: '52.18.144.22', label: 'eu-west-1' },
  { ip: '18.204.9.130', label: 'us-east-1' },
  { ip: '18.204.9.131', label: 'us-east-1' },
  { ip: '13.55.72.9', label: 'ap-southeast-2' },
];

/** Deterministic egress-IP `record-list`. The seed drives which regions are live. */
export function ipAllowlistCardDemoData(seed: number): OpsListData {
  const random = mulberry32(seed || 1);
  const kept = sampleSome(random, DEMO_IPS, 0.8, 2);
  const rows = kept.map((entry) => ({ ip: entry.ip, label: entry.label }));
  return { rows, total: rows.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// onboarding-checklist (annex §13)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `onboarding-checklist` config. `tasks` / `celebrateOnComplete` are the annex's
 * declared config.
 *
 * This is the REUSABLE WIDGET FORM of the reactive checklist already shipped in
 * apps/dashboard/src/onboarding (M5-T06). It deliberately shares NO code with it:
 * packages must not import apps (the dependency would invert the architecture),
 * so this is built from the data contract — steps + done flags — and the app's
 * own copy stays the app's. The two are expected to converge later, on the app's
 * side, by mounting this widget.
 */
export const onboardingChecklistConfigSchema = widgetSharedConfigSchema.extend({
  idField: z.string().default('id'),
  titleField: z.string().default('title'),
  descField: z.string().default('description'),
  minutesField: z.string().default('minutes'),
  actionField: z.string().default('action'),
  hrefField: z.string().default('href'),
  doneField: z.string().default('done'),
  /** Host-supplied steps, rendered INSTEAD of the bound rows when present. */
  tasks: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        minutes: z.number().optional(),
        action: z.string().optional(),
        href: z.string().optional(),
        done: z.boolean().optional(),
      }),
    )
    .max(24)
    .optional(),
  /** Swap the gauge for a success state at 100% (annex `celebrateOnComplete`). */
  celebrateOnComplete: z.boolean().default(true),
  /** Localized "{done} of {total} done" template. */
  progressLabel: z.string().optional(),
  celebrateTitle: z.string().optional(),
  celebrateBody: z.string().optional(),
  ...emptyCopy,
});
export type OnboardingChecklistConfig = z.infer<typeof onboardingChecklistConfigSchema>;

const DEMO_STEPS: readonly { id: string; title: string; description: string; minutes: number; action: string; href: string }[] = [
  {
    id: 'connect',
    title: 'Connect a database',
    description: 'Point Adminium at Postgres, MySQL or SQLite — read-only is fine.',
    minutes: 3,
    action: 'Connect',
    href: '/studio/connect',
  },
  {
    id: 'review',
    title: 'Review the generated schema',
    description: 'Check the labels and relations Adminium inferred from your tables.',
    minutes: 5,
    action: 'Review',
    href: '/studio/review',
  },
  {
    id: 'dashboard',
    title: 'Build your first dashboard',
    description: 'Drop a few widgets on a page and bind them to your data.',
    minutes: 8,
    action: 'Build',
    href: '/dashboards/new',
  },
  {
    id: 'invite',
    title: 'Invite your team',
    description: 'Add teammates and give them a role.',
    minutes: 2,
    action: 'Invite',
    href: '/settings/members',
  },
  {
    id: 'roles',
    title: 'Set up roles & permissions',
    description: 'Decide who can read, write and export.',
    minutes: 6,
    action: 'Configure',
    href: '/settings/roles',
  },
];

/** Deterministic checklist `record-list`. The seed drives how far along the user is. */
export function onboardingChecklistDemoData(seed: number): OpsListData {
  const random = mulberry32(seed || 1);
  const rows = DEMO_STEPS.map((step) => ({
    id: step.id,
    title: step.title,
    description: step.description,
    minutes: step.minutes,
    action: step.action,
    href: step.href,
    done: random() < 0.45,
  }));
  return { rows, total: rows.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// testimonial-card / trust-badges (annex §13 — one heading, two ids)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `testimonial-card` config. A Cloud/marketing surface (M12/M14 consumers) —
 * it renders its data contract and carries no logic beyond that.
 */
export const testimonialCardConfigSchema = widgetSharedConfigSchema.extend({
  quoteField: z.string().default('quote'),
  nameField: z.string().default('name'),
  roleField: z.string().default('role'),
  companyField: z.string().default('company'),
  initialsField: z.string().default('initials'),
  ...emptyCopy,
});
export type TestimonialCardConfig = z.infer<typeof testimonialCardConfigSchema>;

const DEMO_TESTIMONIALS: readonly { quote: string; name: string; role: string; company: string }[] = [
  {
    quote: 'We pointed it at our production replica and had a working admin panel before lunch.',
    name: 'Dana Whitfield',
    role: 'Head of Engineering',
    company: 'Northwind',
  },
  {
    quote: 'The generated screens were close enough that our ops team stopped filing dashboard tickets.',
    name: 'Ravi Menon',
    role: 'CTO',
    company: 'Fernpath',
  },
  {
    quote: 'Self-hosted, AGPL, and our data never left the VPC. That closed the security review in a day.',
    name: 'Ines Duarte',
    role: 'Platform Lead',
    company: 'Cobalt Health',
  },
];

/** Deterministic testimonial `record`. */
export function testimonialCardDemoData(seed: number): OpsRecordData {
  const random = mulberry32(seed || 1);
  const entry = pickFrom(random, DEMO_TESTIMONIALS);
  return { row: { quote: entry.quote, name: entry.name, role: entry.role, company: entry.company } };
}

/** `trust-badges` config — the dot-separated compliance claims row. */
export const trustBadgesConfigSchema = widgetSharedConfigSchema.extend({
  labelFieldName: z.string().default('label'),
  /** Host-supplied claims, rendered INSTEAD of the bound rows when present. */
  badges: z.array(z.string()).max(12).optional(),
  ...emptyCopy,
});
export type TrustBadgesConfig = z.infer<typeof trustBadgesConfigSchema>;

const DEMO_BADGES: readonly string[] = [
  'AGPL-3.0 core',
  'Self-hosted',
  'SOC 2 Type II',
  'GDPR ready',
  'Your data stays yours',
];

/** Deterministic claims `record-list`. The seed drives which claims are shown. */
export function trustBadgesDemoData(seed: number): OpsListData {
  const random = mulberry32(seed || 1);
  const kept = sampleSome(random, DEMO_BADGES, 0.75, 2);
  const rows = kept.map((label) => ({ label }));
  return { rows, total: rows.length };
}
