/**
 * Deterministic demo payloads for the "bars & ranking" chart group (04 §7.7):
 * every definition's `demoData(seed)` returns the §3 envelope the live server
 * would (record-list / categorical / matrix). Own seeded PRNG (no Date.now/
 * Math.random) keeps this pure and independent of the @adminium/charts build,
 * so the widget metadata + demo determinism is testable on its own.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REGIONS = ['United States', 'Germany', 'Japan', 'Brazil', 'India', 'Canada'] as const;
const CAUSES = ['Timeout', 'Validation', 'Auth', 'Rate limit', 'Network', 'Unknown'] as const;
const PLANS = ['Free', 'Pro', 'Business', 'Enterprise'] as const;
const SOURCES = ['Organic', 'Paid', 'Referral', 'Social', 'Email'] as const;
const GOALS = ['Revenue', 'Signups', 'Retention', 'NPS'] as const;

interface CategoricalEnvelope {
  items: { key: string; label: string; value: number }[];
  total: number;
}

function categorical(pairs: { label: string; value: number }[]): CategoricalEnvelope {
  const items = pairs.map((p) => ({ key: p.label.toLowerCase(), label: p.label, value: p.value }));
  return { items, total: items.reduce((sum, item) => sum + item.value, 0) };
}

interface RecordListEnvelope {
  rows: Record<string, unknown>[];
  columns: unknown[];
  total: number;
}

function recordList(rows: Record<string, unknown>[]): RecordListEnvelope {
  return { rows, columns: [], total: rows.length };
}

/** `record-list` — goal rows with measure/target/bands. */
export function bulletDemoData(seed: number): RecordListEnvelope {
  const random = mulberry32(seed);
  return recordList(
    GOALS.map((label) => ({
      label,
      measure: Math.round(30 + random() * 65),
      target: Math.round(60 + random() * 25),
      max: 100,
      bandCutoffs: [40, 75],
    })),
  );
}

/** `categorical` — sorted-descending top-N. */
export function rankingDemoData(seed: number): CategoricalEnvelope {
  const random = mulberry32(seed);
  return categorical(
    REGIONS.map((label) => ({ label, value: Math.round(200 + random() * 800) })).sort(
      (a, b) => b.value - a.value,
    ),
  );
}

/** `categorical` — sorted-descending cause counts. */
export function paretoDemoData(seed: number): CategoricalEnvelope {
  const random = mulberry32(seed);
  return categorical(
    CAUSES.map((label) => ({ label, value: Math.round(10 + random() * 240) })).sort(
      (a, b) => b.value - a.value,
    ),
  );
}

/** `record-list` — MRR bridge steps. */
export function waterfallDemoData(seed: number): RecordListEnvelope {
  const random = mulberry32(seed);
  const start = Math.round(180 + random() * 60);
  const newBiz = Math.round(30 + random() * 40);
  const expansion = Math.round(15 + random() * 25);
  const contraction = Math.round(8 + random() * 16);
  const churn = Math.round(12 + random() * 22);
  const net = start + newBiz + expansion - contraction - churn;
  return recordList([
    { label: 'Start', value: start, type: 'total' },
    { label: 'New', value: newBiz, type: 'up' },
    { label: 'Expansion', value: expansion, type: 'up' },
    { label: 'Contraction', value: contraction, type: 'down' },
    { label: 'Churn', value: churn, type: 'down' },
    { label: 'Net', value: net, type: 'total' },
  ]);
}

interface MatrixEnvelope {
  rowKeys: string[];
  colKeys: string[];
  cells: number[][];
}

/** `matrix` — plan (rows) × region (cols) revenue. */
export function marimekkoDemoData(seed: number): MatrixEnvelope {
  const random = mulberry32(seed);
  const colKeys = REGIONS.slice(0, 4);
  const rowKeys = [...PLANS];
  const cells = rowKeys.map(() => colKeys.map(() => Math.round(20 + random() * 180)));
  return { rowKeys: [...rowKeys], colKeys: [...colKeys], cells };
}

/** `categorical` — traffic-by-source shares. */
export function stackedBar100DemoData(seed: number): CategoricalEnvelope {
  const random = mulberry32(seed);
  return categorical(SOURCES.map((label) => ({ label, value: Math.round(20 + random() * 100) })));
}

/** `record-list` — plan-mix A → B shift. */
export function slopeDemoData(seed: number): RecordListEnvelope {
  const random = mulberry32(seed);
  return recordList(
    PLANS.map((label) => {
      const a = Math.round(10 + random() * 40);
      const b = Math.max(2, Math.round(a + (random() - 0.5) * 26));
      return { label, a, b };
    }),
  );
}
