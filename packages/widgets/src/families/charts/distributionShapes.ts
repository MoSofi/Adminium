/**
 * Distribution & correlation charts group (04-T09): config schemas, §3 envelope
 * narrowing, and deterministic seeded demo payloads for the seven widgets
 * `chart-boxplot`, `chart-violin`, `chart-ridgeline`, `chart-scatter-bubble`,
 * `chart-hexbin`, `chart-correlation-matrix`, `chart-parallel-coordinates`.
 *
 * This module is chart-primitive-free (only the seeded PRNG is pulled from
 * @adminium/charts) so the registry metadata, demo generators, and narrowing
 * guards stay verifiable without loading the family's component chunk (04 §2.3).
 * Demo payloads use `mulberry32` off an FNV-hashed seed — no Date.now/random,
 * byte-identical across runs and platforms (04 §7.7).
 */
import { mulberry32 } from '@adminium/charts';
import { z } from 'zod';

import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

// --- narrowing helpers -------------------------------------------------------

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : null;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function numArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: number[] = [];
  for (const entry of value) {
    const n = num(entry);
    if (n === undefined) return undefined;
    out.push(n);
  }
  return out;
}

// --- distribution (boxplot / violin / ridgeline) -----------------------------

export interface DistributionGroupData {
  key: string;
  label: string;
  min: number;
  q1: number;
  med: number;
  q3: number;
  max: number;
  density?: number[] | undefined;
}

export interface DistributionData {
  groups: DistributionGroupData[];
}

/** Narrows the §3 `distribution` envelope; null on a malformed payload. */
export function asDistribution(data: unknown): DistributionData | null {
  const r = rec(data);
  if (r === null || !Array.isArray(r.groups)) return null;
  const groups: DistributionGroupData[] = [];
  for (const entry of r.groups) {
    const g = rec(entry);
    if (g === null) return null;
    const min = num(g.min);
    const q1 = num(g.q1);
    const med = num(g.med);
    const q3 = num(g.q3);
    const max = num(g.max);
    const label = typeof g.label === 'string' ? g.label : String(g.key ?? '');
    // Ridgeline groups may carry density only; box/violin need the quantiles.
    const density = numArray(g.density);
    groups.push({
      key: typeof g.key === 'string' ? g.key : label,
      label,
      min: min ?? 0,
      q1: q1 ?? min ?? 0,
      med: med ?? 0,
      q3: q3 ?? max ?? 0,
      max: max ?? 0,
      density,
    });
  }
  return { groups };
}

// --- matrix (hexbin / correlation-matrix) ------------------------------------

export interface MatrixData {
  rowKeys: string[];
  colKeys: string[];
  cells: (number | null)[][];
}

/** Narrows the §3 `matrix` envelope to numeric/null cells; null on malformed. */
export function asMatrix(data: unknown): MatrixData | null {
  const r = rec(data);
  if (r === null || !Array.isArray(r.rowKeys) || !Array.isArray(r.colKeys) || !Array.isArray(r.cells)) {
    return null;
  }
  const cells: (number | null)[][] = [];
  for (const row of r.cells) {
    if (!Array.isArray(row)) return null;
    cells.push(row.map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : num(value) ?? null)));
  }
  return {
    rowKeys: r.rowKeys.map((k) => String(k)),
    colKeys: r.colKeys.map((k) => String(k)),
    cells,
  };
}

// --- record-list (scatter / parallel) ----------------------------------------

export interface RecordListData {
  rows: Rec[];
  total: number;
}

/** Narrows the §3 `record-list` envelope; null on malformed. */
export function asRecordList(data: unknown): RecordListData | null {
  const r = rec(data);
  if (r === null || !Array.isArray(r.rows)) return null;
  const rows: Rec[] = [];
  for (const entry of r.rows) {
    const row = rec(entry);
    if (row === null) return null;
    rows.push(row);
  }
  const total = num(r.total);
  return { rows, total: total ?? rows.length };
}

/** Reads a numeric field off a record-list row. */
export function rowNumber(row: Rec, field: string): number | undefined {
  return num(row[field]);
}

/** Reads a string field off a record-list row. */
export function rowString(row: Rec, field: string): string | undefined {
  const value = row[field];
  return typeof value === 'string' ? value : value === undefined || value === null ? undefined : String(value);
}

// --- config schemas ----------------------------------------------------------

export const chartBoxplotConfigSchema = widgetSharedConfigSchema.extend({
  /** Value-axis unit label (annex §2 `unit`). */
  unit: z.string().optional(),
  showAxis: z.boolean().default(true),
  showCategoryLabels: z.boolean().default(true),
  height: z.number().int().min(120).max(600).default(260),
});
export type ChartBoxplotConfig = z.infer<typeof chartBoxplotConfigSchema>;

export const chartViolinConfigSchema = widgetSharedConfigSchema.extend({
  showAxis: z.boolean().default(true),
  showCategoryLabels: z.boolean().default(true),
  height: z.number().int().min(120).max(600).default(260),
});
export type ChartViolinConfig = z.infer<typeof chartViolinConfigSchema>;

export const chartRidgelineConfigSchema = widgetSharedConfigSchema.extend({
  /** Peak height as a multiple of the row step (annex §2 `overlap`). */
  overlap: z.number().min(0.5).max(3).default(1.5),
  showLabels: z.boolean().default(true),
  height: z.number().int().min(120).max(600).default(260),
});
export type ChartRidgelineConfig = z.infer<typeof chartRidgelineConfigSchema>;

export const chartScatterBubbleConfigSchema = widgetSharedConfigSchema.extend({
  xField: z.string().default('team_size'),
  yField: z.string().default('revenue'),
  /** Optional bubble-size dimension (annex §2 bubble radius). */
  rField: z.string().optional(),
  /** Optional category → color legend (annex §2 `segments`). */
  segmentField: z.string().optional(),
  trendLine: z.boolean().default(true),
  axisLabels: z.boolean().default(true),
  height: z.number().int().min(120).max(600).default(280),
});
export type ChartScatterBubbleConfig = z.infer<typeof chartScatterBubbleConfigSchema>;

export const chartHexbinConfigSchema = widgetSharedConfigSchema.extend({
  minAlpha: z.number().min(0).max(1).default(0.18),
  height: z.number().int().min(120).max(600).default(260),
});
export type ChartHexbinConfig = z.infer<typeof chartHexbinConfigSchema>;

export const chartCorrelationMatrixConfigSchema = widgetSharedConfigSchema.extend({
  showLabels: z.boolean().default(true),
  /** |r| above which cell text flips to the accent foreground. */
  strongThreshold: z.number().min(0).max(1).default(0.55),
  height: z.number().int().min(120).max(600).default(280),
});
export type ChartCorrelationMatrixConfig = z.infer<typeof chartCorrelationMatrixConfigSchema>;

export const chartParallelCoordinatesConfigSchema = widgetSharedConfigSchema.extend({
  /** Ordered numeric columns rendered as vertical axes (annex §2 `axes`). */
  axes: z.array(z.string()).min(2).default(['speed', 'reach', 'cost', 'roi']),
  /** Optional category column driving polyline color (annex §2 `colorBy`). */
  colorBy: z.string().optional(),
  showAxisLabels: z.boolean().default(true),
  height: z.number().int().min(120).max(600).default(280),
});
export type ChartParallelCoordinatesConfig = z.infer<typeof chartParallelCoordinatesConfigSchema>;

// --- deterministic demo payloads (§3 envelopes) ------------------------------

function round(value: number): number {
  return Math.round(value);
}

/** Gaussian-ish density bump normalised to a small integer-ish profile. */
function densityProfile(random: () => number, samples: number): number[] {
  const peak = 2 + random() * (samples - 4);
  const sigma = samples / (3 + random() * 2);
  return Array.from({ length: samples }, (_, i) => {
    const base = Math.exp(-((i - peak) ** 2) / (2 * sigma * sigma));
    return Number((base + random() * 0.08).toFixed(4));
  });
}

const BOX_REGIONS = ['NA', 'EU', 'APAC', 'LATAM'] as const;

export function boxplotDemoData(seed: number): DistributionData {
  const random = mulberry32(seed);
  return {
    groups: BOX_REGIONS.map((label) => {
      const med = 60 + random() * 90;
      const spread = 24 + random() * 40;
      const q1 = med - spread * (0.4 + random() * 0.25);
      const q3 = med + spread * (0.4 + random() * 0.25);
      const min = q1 - spread * (0.5 + random() * 0.5);
      const max = q3 + spread * (0.5 + random() * 0.5);
      return {
        key: label.toLowerCase(),
        label,
        min: round(Math.max(0, min)),
        q1: round(q1),
        med: round(med),
        q3: round(q3),
        max: round(max),
      };
    }),
  };
}

const VIOLIN_VARIANTS = ['Control', 'Variant A', 'Variant B'] as const;

export function violinDemoData(seed: number): DistributionData {
  const random = mulberry32(seed);
  return {
    groups: VIOLIN_VARIANTS.map((label) => {
      const med = 40 + random() * 60;
      return {
        key: label.toLowerCase().replace(/\s+/g, '-'),
        label,
        min: 0,
        q1: round(med * 0.6),
        med: round(med),
        q3: round(med * 1.4),
        max: 160,
        density: densityProfile(random, 16),
      };
    }),
  };
}

const RIDGE_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;

export function ridgelineDemoData(seed: number): DistributionData {
  const random = mulberry32(seed);
  return {
    groups: RIDGE_DAYS.map((label) => ({
      key: label.toLowerCase(),
      label,
      min: 0,
      q1: 0,
      med: 0,
      q3: 0,
      max: 24,
      density: densityProfile(random, 24),
    })),
  };
}

const SCATTER_SEGMENTS = ['SMB', 'Mid-market', 'Enterprise'] as const;

export function scatterDemoData(seed: number): {
  rows: Record<string, unknown>[];
  columns: { key: string; label: string }[];
  total: number;
} {
  const random = mulberry32(seed);
  const rows = Array.from({ length: 26 }, (_, i) => {
    const teamSize = round(5 + random() * 95);
    const revenue = round(teamSize * (900 + random() * 1400) + (random() - 0.5) * 12000);
    return {
      id: i + 1,
      team_size: teamSize,
      revenue: Math.max(1000, revenue),
      deals: round(3 + random() * 40),
      segment: SCATTER_SEGMENTS[Math.floor(random() * SCATTER_SEGMENTS.length) % SCATTER_SEGMENTS.length],
    };
  });
  return {
    rows,
    columns: [
      { key: 'team_size', label: 'Team size' },
      { key: 'revenue', label: 'Revenue' },
      { key: 'deals', label: 'Deals' },
      { key: 'segment', label: 'Segment' },
    ],
    total: rows.length,
  };
}

export function hexbinDemoData(seed: number, rows = 6, cols = 12): MatrixData {
  const random = mulberry32(seed);
  const cells: (number | null)[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      // Density concentrated toward the middle band; sparse cells drop out.
      const distance = Math.abs(r - rows / 2) / rows + Math.abs(c - cols / 2) / cols;
      const intensity = (1 - distance) * (0.5 + random());
      if (intensity < 0.35) return null;
      return round(intensity * 60);
    }),
  );
  return {
    rowKeys: Array.from({ length: rows }, (_, r) => `r${r}`),
    colKeys: Array.from({ length: cols }, (_, c) => `c${c}`),
    cells,
  };
}

const CORRELATION_COLUMNS = ['MRR', 'Seats', 'Tenure', 'NPS', 'Logins'] as const;

export function correlationDemoData(seed: number): MatrixData {
  const random = mulberry32(seed);
  const n = CORRELATION_COLUMNS.length;
  const cells: (number | null)[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (let i = 0; i < n; i += 1) {
    const rowI = cells[i];
    if (rowI === undefined) continue;
    rowI[i] = 1;
    for (let j = i + 1; j < n; j += 1) {
      const r = Number(((random() * 2 - 1) * 0.9).toFixed(2));
      rowI[j] = r;
      const rowJ = cells[j];
      if (rowJ !== undefined) rowJ[i] = r;
    }
  }
  return {
    rowKeys: [...CORRELATION_COLUMNS],
    colKeys: [...CORRELATION_COLUMNS],
    cells,
  };
}

const PARALLEL_SEGMENTS = ['Free', 'Pro', 'Business'] as const;

export function parallelDemoData(seed: number): {
  rows: Record<string, unknown>[];
  columns: { key: string; label: string }[];
  total: number;
} {
  const random = mulberry32(seed);
  const rows = Array.from({ length: 18 }, (_, i) => ({
    id: i + 1,
    speed: round(random() * 100),
    reach: round(random() * 100),
    cost: round(random() * 100),
    roi: round(random() * 100),
    segment: PARALLEL_SEGMENTS[Math.floor(random() * PARALLEL_SEGMENTS.length) % PARALLEL_SEGMENTS.length],
  }));
  return {
    rows,
    columns: [
      { key: 'speed', label: 'Speed' },
      { key: 'reach', label: 'Reach' },
      { key: 'cost', label: 'Cost' },
      { key: 'roi', label: 'ROI' },
      { key: 'segment', label: 'Segment' },
    ],
    total: rows.length,
  };
}
