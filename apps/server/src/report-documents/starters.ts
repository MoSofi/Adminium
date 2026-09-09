// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The twelve starters behind the New modal and the blank document — the
 * comp's `starterDefs()` (475-493), `fromStarter` (494) and `createBlank`
 * (554), under 43-report-builder.md Appendix C and Appendix D (43-T03).
 *
 * WHAT CHANGED FROM THE COMP, AND WHY. Four seeded strings trip the 17 §2
 * lexicon or 24 D12 ("names no company"); Appendix D lists each one and its
 * replacement, and `report-starters.test.ts` greps every string in this file
 * for the words and for the company name. Nothing else moves: the figures,
 * the fictional account names (Northwind, Globex, Initech, Umbrella,
 * Soylent) and the SaaS flavour (MRR, ARR, churn, CAC, DAU) are a fictional
 * business's own metrics, which 17 §3.4 allows.
 *
 * A starter is a WHOLE body, not a patch: the comp's `fromStarter` reads
 * `accent`, `kicker`, `reportTitle`, `subtitle` and `blocks` off the def and
 * defaults the rest, so a starter that omits an accent gets the workspace's.
 * Block ids are minted here, server-side, one per block.
 *
 * The starter NAMES are English literals rather than message keys: the comp's
 * are, the dashboard shows them as the row's name, and a name is the
 * operator's to rename (34's rule). The CATEGORY is a lowercase key the
 * dashboard labels through the namespace.
 */
import {
  DEFAULT_ACCENT,
  newLocalId,
  normalizeReportBody,
  type ReportBlock,
  type ReportBlockKind,
  type ReportBody,
} from './document.js';

/** The comp's twelve starter keys, in its modal order (475-493). */
export const STARTER_KEYS = [
  'exec',
  'weekly',
  'mbr',
  'sales',
  'marketing',
  'finance',
  'product',
  'health',
  'campaign',
  'board',
  'incident',
  'scorecard',
] as const;

export type ReportStarterKey = (typeof STARTER_KEYS)[number];

const STARTER_SET: ReadonlySet<string> = new Set(STARTER_KEYS);

export function isReportStarterKey(value: unknown): value is ReportStarterKey {
  return typeof value === 'string' && STARTER_SET.has(value);
}

/** The comp's eight categories (Appendix C), as the lowercase keys the card carries. */
export type StarterCategory =
  | 'leadership'
  | 'operations'
  | 'revenue'
  | 'growth'
  | 'finance'
  | 'product'
  | 'success'
  | 'engineering';

/** What the New modal shows per card (comp 84-95, 570-577). */
export interface ReportStarterCard {
  key: ReportStarterKey;
  name: string;
  category: StarterCategory;
  /** Lucide icon SLUG (the comp's); the dashboard's `icons.ts` maps it to a component. */
  icon: string;
  /** The thumbnail's title line. */
  reportTitle: string;
  accent: string;
  /** The card's meta line — "{category} · N blocks" (95). */
  blockCount: number;
  /** The thumbnail's bars: the first bar/line series, else the comp's fallback (570). */
  series: number[];
}

/** A starter fully rendered: the card and the body. */
export interface RenderedStarter {
  card: ReportStarterCard;
  body: ReportBody;
}

/** A seeded block, before its id is minted: the kind, the title, and the kind's fields. */
type SeedBlock = { kind: ReportBlockKind; title: string } & Record<string, unknown>;

interface StarterDef {
  key: ReportStarterKey;
  name: string;
  category: StarterCategory;
  icon: string;
  kicker: string;
  reportTitle: string;
  subtitle: string;
  accent?: string;
  blocks: SeedBlock[];
}

/** `[label, value, delta]` — the comp's `K()` (476). */
function kpis(rows: readonly (readonly [string, string, string])[]): { label: string; value: string; delta: string }[] {
  return rows.map(([label, value, delta]) => ({ label, value, delta }));
}

/** `[label, value]` — the comp's `S()` (477). */
function series(rows: readonly (readonly [string, number])[]): { label: string; value: number }[] {
  return rows.map(([label, value]) => ({ label, value }));
}

/**
 * The comp's `starterDefs()` (475-493), verbatim except for the four
 * Appendix D replacements, which are marked where they occur.
 */
const STARTER_DEFS: readonly StarterDef[] = [
  {
    key: 'exec',
    name: 'Executive summary',
    category: 'leadership',
    icon: 'briefcase',
    kicker: 'Quarterly report',
    reportTitle: 'Q3 2026 Executive Summary',
    subtitle: 'For the leadership team · Jul 1 – Sep 30',
    blocks: [
      {
        kind: 'text',
        title: 'Overview',
        // Appendix D row 1 replaces the comp's phrase here; the word it swaps
        // out is one the 17 §2 sweep catches, so it is named there, not quoted.
        text: 'Revenue grew 12.4% quarter-over-quarter, driven by expansion in larger accounts. Churn held steady at 1.9%. Net new MRR reached $48.2k — the strongest quarter to date.',
      },
      {
        kind: 'kpi',
        title: 'Key metrics',
        kpis: kpis([
          ['MRR', '$482k', '+12%'],
          ['Customers', '8,420', '+340'],
          ['Churn', '1.9%', '−0.2%'],
        ]),
      },
      {
        kind: 'bar',
        title: 'Revenue by month',
        series: series([
          ['Apr', 52],
          ['May', 68],
          ['Jun', 60],
          ['Jul', 82],
          ['Aug', 74],
          ['Sep', 96],
        ]),
      },
      {
        kind: 'table',
        title: 'Top accounts',
        rows: [
          ['Account', 'Revenue'],
          ['Northwind', '$182k'],
          ['Globex', '$146k'],
          ['Initech', '$98k'],
        ],
      },
    ],
  },
  {
    key: 'weekly',
    name: 'Weekly digest',
    category: 'operations',
    icon: 'calendar-days',
    kicker: 'Weekly update',
    reportTitle: 'Week 28 Digest',
    subtitle: 'Jul 6 – Jul 12',
    blocks: [
      {
        kind: 'kpi',
        title: 'This week',
        kpis: kpis([
          ['Tasks', '128', '+18'],
          ['Releases', '3', ''],
          ['Uptime', '99.98%', ''],
        ]),
      },
      {
        kind: 'text',
        title: 'Highlights',
        text: 'The team shipped the new automations engine and closed 12 support tickets ahead of SLA. Focus next week: onboarding polish.',
      },
      {
        kind: 'line',
        title: 'Active users',
        series: series([
          ['Mon', 40],
          ['Tue', 55],
          ['Wed', 62],
          ['Thu', 58],
          ['Fri', 78],
          ['Sat', 44],
        ]),
      },
    ],
  },
  {
    key: 'mbr',
    name: 'Monthly business review',
    category: 'leadership',
    icon: 'presentation',
    kicker: 'Monthly review',
    reportTitle: 'July Business Review',
    subtitle: 'Company-wide performance',
    blocks: [
      { kind: 'heading', title: 'Section', text: 'Growth' },
      {
        kind: 'kpi',
        title: 'Growth metrics',
        kpis: kpis([
          ['MRR', '$482k', '+12%'],
          ['ARR', '$5.8M', '+14%'],
          ['Net rev retention', '112%', ''],
        ]),
      },
      {
        kind: 'bar',
        title: 'New signups',
        series: series([
          ['W1', 44],
          ['W2', 61],
          ['W3', 58],
          ['W4', 79],
        ]),
      },
      { kind: 'divider', title: 'Divider' },
      {
        kind: 'text',
        title: 'Risks',
        // Appendix D row 3 replaces the comp's phrase here (17 §2).
        text: 'Enterprise pipeline slowed slightly; two renewals at risk. Mitigation work in progress with CS.',
      },
    ],
  },
  {
    key: 'sales',
    name: 'Sales report',
    category: 'revenue',
    icon: 'trending-up',
    accent: '#0d9488',
    kicker: 'Sales',
    reportTitle: 'Sales Performance',
    subtitle: 'Pipeline & closed-won',
    blocks: [
      {
        kind: 'kpi',
        title: 'Pipeline',
        kpis: kpis([
          ['Closed-won', '$312k', '+9%'],
          ['Pipeline', '$1.4M', ''],
          ['Win rate', '28%', '+3%'],
        ]),
      },
      {
        kind: 'bar',
        title: 'Bookings by rep',
        series: series([
          ['Ava', 88],
          ['Jordan', 72],
          ['Priya', 95],
          ['Sam', 64],
        ]),
      },
      {
        kind: 'table',
        title: 'Deals closing',
        rows: [
          ['Deal', 'Value'],
          ['Northwind expansion', '$64k'],
          ['Globex renewal', '$48k'],
          ['Umbrella new', '$30k'],
        ],
      },
    ],
  },
  {
    key: 'marketing',
    name: 'Marketing report',
    category: 'growth',
    icon: 'megaphone',
    accent: '#ea580c',
    kicker: 'Marketing',
    reportTitle: 'Marketing Funnel',
    subtitle: 'Acquisition & conversion',
    blocks: [
      {
        kind: 'kpi',
        title: 'Funnel',
        kpis: kpis([
          ['Visitors', '184k', '+22%'],
          ['Signups', '4,210', '+14%'],
          ['CAC', '$41', '−6%'],
        ]),
      },
      {
        kind: 'line',
        title: 'Traffic trend',
        series: series([
          ['Wk1', 30],
          ['Wk2', 48],
          ['Wk3', 44],
          ['Wk4', 66],
          ['Wk5', 82],
        ]),
      },
      {
        kind: 'table',
        title: 'Top channels',
        rows: [
          ['Channel', 'Signups'],
          ['Organic', '1,840'],
          ['Paid', '1,120'],
          ['Referral', '640'],
        ],
      },
    ],
  },
  {
    key: 'finance',
    name: 'Financial statement',
    category: 'finance',
    icon: 'landmark',
    kicker: 'Finance',
    reportTitle: 'P&L Statement',
    subtitle: 'July 2026',
    blocks: [
      {
        kind: 'table',
        title: 'Income statement',
        rows: [
          ['Line', 'Amount'],
          ['Revenue', '$482,000'],
          ['COGS', '−$96,400'],
          ['Gross profit', '$385,600'],
          ['Opex', '−$210,000'],
          ['Net income', '$175,600'],
        ],
      },
      {
        kind: 'kpi',
        title: 'Margins',
        kpis: kpis([
          ['Gross margin', '80%', ''],
          ['Net margin', '36%', ''],
          ['Burn', '$0', ''],
        ]),
      },
    ],
  },
  {
    key: 'product',
    name: 'Product analytics',
    category: 'product',
    icon: 'line-chart',
    kicker: 'Product',
    reportTitle: 'Feature Adoption',
    subtitle: 'Engagement & retention',
    blocks: [
      {
        kind: 'kpi',
        title: 'Engagement',
        kpis: kpis([
          ['DAU', '12.4k', '+8%'],
          ['WAU', '38k', ''],
          ['Stickiness', '33%', '+2%'],
        ]),
      },
      {
        kind: 'bar',
        title: 'Feature usage',
        series: series([
          ['Dash', 92],
          ['Reports', 74],
          ['Auto', 58],
          ['API', 41],
          ['Chat', 66],
        ]),
      },
      {
        kind: 'text',
        title: 'Notes',
        text: 'Automations adoption is climbing steadily since launch. Retention for automation users is 14pts higher than average.',
      },
    ],
  },
  {
    key: 'health',
    name: 'Customer health',
    category: 'success',
    icon: 'heart-pulse',
    accent: '#12805c',
    kicker: 'Customer success',
    reportTitle: 'Account Health',
    subtitle: 'Risk & expansion signals',
    blocks: [
      {
        kind: 'kpi',
        title: 'Health',
        kpis: kpis([
          ['Healthy', '78%', ''],
          ['At risk', '14%', ''],
          ['NPS', '52', '+4'],
        ]),
      },
      {
        kind: 'table',
        title: 'At-risk accounts',
        rows: [
          ['Account', 'Score'],
          ['Initech', '38'],
          ['Umbrella', '44'],
          ['Soylent', '49'],
        ],
      },
    ],
  },
  {
    key: 'campaign',
    name: 'Campaign recap',
    category: 'growth',
    icon: 'rocket',
    accent: '#ea580c',
    kicker: 'Campaign',
    reportTitle: 'Launch Recap',
    subtitle: 'Automations launch results',
    blocks: [
      { kind: 'heading', title: 'Section', text: 'Results at a glance' },
      {
        kind: 'kpi',
        title: 'Results',
        kpis: kpis([
          ['Reach', '92k', ''],
          ['CTR', '4.8%', ''],
          ['Conversions', '1,240', ''],
        ]),
      },
      { kind: 'image', title: 'Creative', text: 'campaign hero image' },
    ],
  },
  {
    key: 'board',
    name: 'Board deck',
    category: 'leadership',
    icon: 'gavel',
    kicker: 'Board meeting',
    reportTitle: 'Board Update — Q3',
    subtitle: 'Confidential',
    blocks: [
      {
        kind: 'kpi',
        title: 'Headline',
        kpis: kpis([
          ['ARR', '$5.8M', '+14%'],
          ['Runway', '22mo', ''],
          ['Headcount', '84', '+9'],
        ]),
      },
      {
        kind: 'bar',
        title: 'ARR growth',
        series: series([
          ['Q1', 40],
          ['Q2', 52],
          ['Q3', 68],
          ['Q4', 80],
        ]),
      },
      { kind: 'divider', title: 'Divider' },
      {
        kind: 'text',
        title: 'Asks',
        // Appendix D row 2 replaces the comp's phrase here (17 §2).
        text: 'Approve the Series B raise timeline and the expanded hiring roadmap for the platform team.',
      },
    ],
  },
  {
    key: 'incident',
    name: 'Incident postmortem',
    category: 'engineering',
    icon: 'shield-alert',
    accent: '#e5484d',
    kicker: 'Postmortem',
    reportTitle: 'INC-482 Postmortem',
    subtitle: 'API latency degradation',
    blocks: [
      {
        kind: 'table',
        title: 'Timeline',
        rows: [
          ['Time', 'Event'],
          ['14:02', 'Alert fired'],
          ['14:09', 'On-call paged'],
          ['14:26', 'Rollback started'],
          ['14:41', 'Resolved'],
        ],
      },
      {
        kind: 'text',
        title: 'Root cause',
        text: 'A connection-pool misconfiguration in the new release exhausted database connections under peak load.',
      },
      {
        kind: 'text',
        title: 'Action items',
        text: 'Add pool-size guardrails, load-test the release pipeline, and improve alert thresholds.',
      },
    ],
  },
  {
    key: 'scorecard',
    name: 'KPI scorecard',
    category: 'operations',
    icon: 'gauge',
    kicker: 'Scorecard',
    reportTitle: 'Company Scorecard',
    subtitle: 'All key metrics at a glance',
    blocks: [
      {
        kind: 'kpi',
        title: 'North stars',
        kpis: kpis([
          ['MRR', '$482k', '+12%'],
          ['NRR', '112%', ''],
          ['Churn', '1.9%', '−0.2%'],
          ['NPS', '52', '+4'],
        ]),
      },
      {
        kind: 'kpi',
        title: 'Operations',
        kpis: kpis([
          ['Uptime', '99.98%', ''],
          ['Tickets', '128', ''],
          ['CSAT', '94%', ''],
        ]),
      },
    ],
  },
];

const BY_KEY: ReadonlyMap<ReportStarterKey, StarterDef> = new Map(STARTER_DEFS.map((def) => [def.key, def]));

/** The comp's thumbnail fallback when a starter draws no chart (570). */
const FALLBACK_SERIES: readonly number[] = [40, 66, 52, 78, 60];

/** The first bar/line block's values, at most six — the thumbnail's bars (570, 584-591). */
export function thumbSeries(blocks: readonly { kind: string; series?: readonly { value: number }[] }[]): number[] {
  const chart = blocks.find((block) => block.kind === 'bar' || block.kind === 'line');
  const values = chart?.series === undefined ? FALLBACK_SERIES : chart.series.map((point) => point.value);
  return values.slice(0, 6);
}

function cardOf(def: StarterDef): ReportStarterCard {
  return {
    key: def.key,
    name: def.name,
    category: def.category,
    icon: def.icon,
    reportTitle: def.reportTitle,
    accent: def.accent ?? DEFAULT_ACCENT,
    blockCount: def.blocks.length,
    series: thumbSeries(def.blocks as readonly { kind: string; series?: { value: number }[] }[]),
  };
}

/** The New modal's grid, in the comp's order (570). */
export function starterCards(): ReportStarterCard[] {
  return STARTER_DEFS.map(cardOf);
}

/** The comp's `blk()` (474) — a seeded block with a fresh id, `full` and shown. */
function block(seed: SeedBlock): ReportBlock {
  return normalizeReportBody({ blocks: [{ ...seed, id: newLocalId(), w: 'full', show: true }] }).blocks[0] as ReportBlock;
}

/** The comp's `fromStarter` (494): the def's header and blocks, fresh block ids. */
export function renderStarter(key: ReportStarterKey): RenderedStarter {
  const def = BY_KEY.get(key);
  if (def === undefined) throw new Error(`unknown report starter: ${key}`);
  const body: ReportBody = {
    accent: def.accent ?? DEFAULT_ACCENT,
    kicker: def.kicker,
    reportTitle: def.reportTitle,
    subtitle: def.subtitle,
    bgImage: '',
    bgTint: 0.82,
    blocks: def.blocks.map(block),
  };
  return { card: cardOf(def), body };
}

/** The comp's `createBlank` (554): the placeholder header and one text block. */
export function blankBody(): ReportBody {
  return {
    accent: DEFAULT_ACCENT,
    kicker: 'Report',
    reportTitle: 'Untitled report',
    subtitle: 'Add a subtitle',
    bgImage: '',
    bgTint: 0.82,
    blocks: [block({ kind: 'text', title: 'Text', text: 'Start writing your report, or add a block from the left.' })],
  };
}

/** The blank document's name, by kind (554) — and the icon the card falls back to. */
export const BLANK_ICON = 'file-text';
