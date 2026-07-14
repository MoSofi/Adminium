/**
 * The staged validation pipeline (06-llm-assist.md §7.2/§7.3) + the fixture
 * corpus (§6.2/§6.3).
 *
 * Locks (acceptance criteria 3–5):
 *  - `responses/valid-demo.json` (§6.3) passes stages 1–7 with ZERO errors and
 *    ZERO warnings against `demo-schema.json` (§6.2), and nothing is pruned.
 *  - every `responses/invalid-*.json` yields its documented code + JSON path,
 *    with the correct fatal-vs-per-item behaviour.
 *  - one hallucinated table drops only its own suggestions + the dashboard
 *    widgets bound to it, while every other suggestion survives (criterion 4).
 *  - an unsupported `schema_version` is fatal; a supported-but-older one still
 *    validates (criterion 5).
 */
import { readFileSync } from 'node:fs';

import { parseDatabaseModel, type DatabaseModel, type StatsResult } from '@adminium/engine';
import { describe, expect, it } from 'vitest';

import type { LlmValidationCode } from './errors.js';
import { validateResponse, type ValidationContext } from './validate.js';

/* --------------------------------------------------------------- fixtures */

function fixture(relative: string): string {
  return readFileSync(new URL(`../../test/fixtures/${relative}`, import.meta.url), 'utf8');
}

const snapshot: DatabaseModel = parseDatabaseModel(fixture('demo-schema.json'));

/** The 11 recommendable templates + `page-crud` (present but never recommended). */
const ALLOWED_TEMPLATES = [
  'page-crud',
  'page-dashboard',
  'page-master-detail',
  'page-queue-inbox',
  'page-board',
  'page-calendar',
  'page-scheduler',
  'page-directory',
  'page-log-viewer',
  'page-files',
  'page-chat',
  'page-builder',
] as const;

/** The curated dashboard-widget subset (06 §5 builder notes). */
const ALLOWED_WIDGETS = [
  'kpi-stat-card',
  'kpi-progress',
  'kpi-delta',
  'chart-line-area',
  'chart-bar',
  'chart-donut',
  'chart-multiline',
  'chart-stacked-bar-100',
  'chart-funnel',
  'chart-heatmap-calendar',
  'chart-cohort-matrix',
  'chart-ranking-bars',
  'chart-sparkline',
  'mini-table',
  'top-movers-list',
  'activity-feed',
] as const;

/** Context for the two-locale golden run (§6.3 requested `["en_US","de_DE"]`). */
const demoCtx: ValidationContext = {
  snapshot,
  locales: ['en_US', 'de_DE'],
  allowedTemplates: ALLOWED_TEMPLATES,
  allowedWidgets: ALLOWED_WIDGETS,
  runId: '01J9ZK3W8E2Q4R6T8V0X2Y4Z6A',
};

/** Context for the minimal single-locale corpus fixtures. */
const corpusCtx: ValidationContext = {
  snapshot,
  locales: ['en_US'],
  allowedTemplates: ALLOWED_TEMPLATES,
  allowedWidgets: ALLOWED_WIDGETS,
};

/* ------------------------------------------------- valid golden (§6.3) */

describe('valid-demo.json — golden response (acceptance criterion 3)', () => {
  const result = validateResponse(fixture('responses/valid-demo.json'), demoCtx);

  it('passes stages 1–7 with zero errors and zero warnings', () => {
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.response).toBeDefined();
  });

  it('prunes nothing — every suggestion survives', () => {
    const response = result.response;
    expect(response).toBeDefined();
    if (!response) return;
    expect(response.tables).toHaveLength(3);
    expect(response.tables.map((t) => t.table)).toEqual([
      'public.orders',
      'public.customers',
      'public.products',
    ]);
    expect(response.enums).toHaveLength(1);
    expect(response.relations.confirmed).toHaveLength(1);
    expect(response.relations.inferred).toHaveLength(1);
    expect(response.navGroups).toHaveLength(2);
    expect(response.dashboards[0]?.widgets).toHaveLength(5);
    // Key columns and PII survive intact.
    expect(response.tables[0]?.displayColumn).toBe('order_number');
    expect(response.tables[1]?.columns.find((c) => c.column === 'email')?.pii?.kind).toBe('email');
  });

  it('emits no run-id mismatch warning when the run_id matches', () => {
    expect(result.warnings.some((w) => w.code === 'LLM_RUN_MISMATCH')).toBe(false);
  });
});

/* --------------------------------------------- invalid corpus (criterion 4) */

interface CorpusCase {
  file: string;
  code: LlmValidationCode;
  path: string;
  fatal: boolean;
}

const CORPUS: readonly CorpusCase[] = [
  { file: 'invalid-bad-json.json', code: 'LLM_JSON_PARSE', path: '', fatal: true },
  { file: 'invalid-truncated.json', code: 'LLM_TRUNCATED', path: '', fatal: true },
  {
    file: 'invalid-unsupported-version.json',
    code: 'LLM_VERSION_MISMATCH',
    path: 'schema_version',
    fatal: true,
  },
  { file: 'invalid-model-declined.json', code: 'LLM_MODEL_DECLINED', path: 'error', fatal: true },
  { file: 'invalid-schema.json', code: 'LLM_SCHEMA_INVALID', path: 'tables[0].confidence', fatal: true },
  { file: 'invalid-locale-keys.json', code: 'LLM_LOCALE_KEYS', path: 'tables[0].label', fatal: false },
  {
    file: 'invalid-unknown-column.json',
    code: 'LLM_UNKNOWN_COLUMN',
    path: 'tables[0].columns[0].column',
    fatal: false,
  },
  {
    file: 'invalid-bad-display-column.json',
    code: 'LLM_BAD_DISPLAY_COLUMN',
    path: 'tables[0].displayColumn',
    fatal: false,
  },
  { file: 'invalid-not-an-enum.json', code: 'LLM_NOT_AN_ENUM', path: 'enums[0].column', fatal: false },
  { file: 'invalid-enum-values.json', code: 'LLM_ENUM_VALUES', path: 'enums[0].tones', fatal: false },
  {
    file: 'invalid-unknown-relation.json',
    code: 'LLM_UNKNOWN_RELATION',
    path: 'relations.confirmed[0]',
    fatal: false,
  },
  {
    file: 'invalid-dangling-fk.json',
    code: 'LLM_RELATION_INVALID',
    path: 'relations.inferred[0]',
    fatal: false,
  },
  {
    file: 'invalid-disallowed-template.json',
    code: 'LLM_UNKNOWN_TEMPLATE',
    path: 'tables[0].pageTemplates[0].template',
    fatal: false,
  },
  {
    file: 'invalid-disallowed-widget.json',
    code: 'LLM_UNKNOWN_WIDGET',
    path: 'dashboards[0].widgets[0].widget',
    fatal: false,
  },
  {
    file: 'invalid-widget-binding.json',
    code: 'LLM_WIDGET_BINDING',
    path: 'dashboards[0].widgets[0].metricColumn',
    fatal: false,
  },
  { file: 'invalid-group.json', code: 'LLM_GROUP_INVALID', path: 'navGroups[0].tables', fatal: false },
  {
    file: 'invalid-hallucinated-table.json',
    code: 'LLM_UNKNOWN_TABLE',
    path: 'tables[1].table',
    fatal: false,
  },
];

describe('invalid-*.json corpus — documented code + JSON path', () => {
  it.each(CORPUS)('$file → $code at "$path"', ({ file, code, path, fatal }) => {
    const result = validateResponse(fixture(`responses/${file}`), corpusCtx);
    const match = result.errors.find((error) => error.code === code);
    expect(match, `expected a ${code} error`).toBeDefined();
    expect(match?.path).toBe(path);
    expect(match?.message.length ?? 0).toBeGreaterThan(0);

    if (fatal) {
      expect(match?.severity).toBe('fatal');
      expect(result.response).toBeUndefined();
    } else {
      expect(match?.severity).toBe('item');
      expect(result.response).toBeDefined();
    }
  });

  it('the version-mismatch fatal carries the regeneration hint', () => {
    const result = validateResponse(fixture('responses/invalid-unsupported-version.json'), corpusCtx);
    const error = result.errors[0];
    expect(error?.code).toBe('LLM_VERSION_MISMATCH');
    expect(error?.hint).toContain('Regenerate the prompt');
  });
});

/* --------------- non-canonical locale key is per-item, not fatal (stage 5) */

describe('non-canonical locale key stays a per-item drop (§7.2 stage 5)', () => {
  // A stray BCP-47 / unrequested key on ONE column must not fail the whole run
  // at Zod (stage 4); stage 5 drops only that suggestion and keeps the rest.
  const response = JSON.stringify({
    schema_version: 'adminium.llm/v1',
    tables: [
      {
        table: 'public.orders',
        confidence: 0.9,
        label: { en_US: 'Orders' },
        description: { en_US: 'Customer orders.' },
        icon: 'shopping-cart',
        displayColumn: null,
        naturalKey: null,
        columns: [
          { column: 'order_number', label: { 'en-US': 'Order number' } }, // non-canonical → dropped
          { column: 'status', label: { en_US: 'Status' } }, // canonical → kept
        ],
      },
    ],
  });

  it('drops the offending column with LLM_LOCALE_KEYS while the run + siblings survive', () => {
    const result = validateResponse(response, corpusCtx);
    expect(result.response).toBeDefined();
    const err = result.errors.find((e) => e.code === 'LLM_LOCALE_KEYS');
    expect(err?.path).toBe('tables[0].columns[0].label');
    expect(err?.severity).toBe('item');
    // The table stays; only the bad column is gone, the good one remains.
    const orders = result.response?.tables[0];
    expect(orders?.table).toBe('public.orders');
    expect(orders?.columns.map((c) => c.column)).toEqual(['status']);
    // Crucially, no fatal LLM_SCHEMA_INVALID from the Zod layer.
    expect(result.errors.some((e) => e.code === 'LLM_SCHEMA_INVALID')).toBe(false);
  });
});

/* ------------------------------- hallucinated-table isolation (criterion 4) */

describe('hallucinated-table isolation (acceptance criterion 4)', () => {
  const result = validateResponse(fixture('responses/invalid-hallucinated-table.json'), corpusCtx);

  it('reports LLM_UNKNOWN_TABLE for the hallucinated table only', () => {
    const unknown = result.errors.filter((e) => e.code === 'LLM_UNKNOWN_TABLE');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.path).toBe('tables[1].table');
    expect(unknown[0]?.message).toContain('public.order_items');
  });

  it('drops the hallucinated table but keeps the real one', () => {
    const response = result.response;
    expect(response).toBeDefined();
    if (!response) return;
    expect(response.tables.map((t) => t.table)).toEqual(['public.orders']);
  });

  it('drops the enum + dashboard widget that depended on the hallucinated table', () => {
    const response = result.response;
    expect(response).toBeDefined();
    if (!response) return;
    // The real orders.status enum survives; the order_items enum is gone.
    expect(response.enums.map((e) => `${e.table}.${e.column}`)).toEqual(['public.orders.status']);
    // Only the widget bound to the real table survives.
    const widgets = response.dashboards[0]?.widgets ?? [];
    expect(widgets).toHaveLength(1);
    expect(widgets[0]?.table).toBe('public.orders');
  });
});

/* ---------------- pseudo-enum acceptance + stub rejection (findings 5 & 7) */

describe('pseudo-enum acceptance + stub-table rejection (§7.3)', () => {
  const demoStats: StatsResult[] = [
    {
      table: { schema: 'public', name: 'customers' },
      rowCountEstimate: 8402,
      rowCountExact: false,
      sampled: false,
      columns: [{ column: 'country', nullFraction: 0, distinctCount: 24 }],
    },
    {
      table: { schema: 'public', name: 'products' },
      rowCountEstimate: 312,
      rowCountExact: false,
      sampled: false,
      columns: [{ column: 'category', nullFraction: 0, distinctCount: 6 }],
    },
  ];

  const countryEnum = JSON.stringify({
    schema_version: 'adminium.llm/v1',
    enums: [
      {
        table: 'public.customers',
        column: 'country',
        kind: 'category',
        order: null,
        tones: { DE: 'muted' },
        reason: 'Low-cardinality country classification.',
        confidence: 0.7,
      },
    ],
  });

  it('accepts an enums[] suggestion on a pseudoEnumCandidate text column when stats are present (finding 5)', () => {
    const result = validateResponse(countryEnum, { ...corpusCtx, stats: demoStats });
    expect(result.errors.filter((e) => e.code === 'LLM_NOT_AN_ENUM')).toEqual([]);
    expect(result.response?.enums).toHaveLength(1);
    expect(result.response?.enums[0]?.column).toBe('country');
  });

  it('rejects the same enum when no stats are supplied (pseudo detection off)', () => {
    const result = validateResponse(countryEnum, corpusCtx);
    const err = result.errors.find((e) => e.code === 'LLM_NOT_AN_ENUM');
    expect(err?.path).toBe('enums[0].column');
    expect(result.response?.enums).toEqual([]);
  });

  it('drops enum + widget suggestions bound to a stub (context-only) table (finding 7)', () => {
    const response = JSON.stringify({
      schema_version: 'adminium.llm/v1',
      enums: [
        {
          table: 'public.products',
          column: 'category',
          kind: 'category',
          order: null,
          tones: { a: 'muted' },
          reason: 'x',
          confidence: 0.5,
        },
      ],
      dashboards: [
        {
          id: 'catalog',
          domain: 'Catalog',
          label: { en_US: 'Catalog' },
          order: 0,
          tables: ['public.products'],
          widgets: [
            {
              widget: 'kpi-stat-card',
              rank: 1,
              span: 3,
              table: 'public.products',
              agg: 'count',
              titleEn: 'Products',
              reason: 'x',
              confidence: 0.6,
            },
          ],
        },
      ],
    });
    const result = validateResponse(response, {
      ...corpusCtx,
      stubTables: ['public.products'],
      stats: demoStats,
    });
    expect(result.response).toBeDefined();
    expect(result.errors.find((e) => e.code === 'LLM_NOT_AN_ENUM')?.path).toBe('enums[0].table');
    expect(result.errors.find((e) => e.code === 'LLM_WIDGET_BINDING')?.path).toBe(
      'dashboards[0].widgets[0].table',
    );
    expect(result.response?.enums).toEqual([]);
    expect(result.response?.dashboards[0]?.widgets).toEqual([]);
  });
});

/* -------------------------------- version negotiation (acceptance criterion 5) */

describe('schema_version negotiation through the pipeline (criterion 5)', () => {
  it('fatally rejects an unsupported version', () => {
    const result = validateResponse(fixture('responses/invalid-unsupported-version.json'), corpusCtx);
    expect(result.response).toBeUndefined();
    expect(result.errors[0]?.code).toBe('LLM_VERSION_MISMATCH');
  });

  it('still validates a supported-but-older version once v2 exists', () => {
    // Simulate the post-v2 world: v1 stays supported and must keep validating.
    const futureCtx: ValidationContext = {
      ...demoCtx,
      supportedVersions: ['adminium.llm/v2', 'adminium.llm/v1'],
    };
    const result = validateResponse(fixture('responses/valid-demo.json'), futureCtx);
    expect(result.errors).toEqual([]);
    expect(result.response).toBeDefined();
  });
});

/* ------------------------------------------------ warnings & run binding */

describe('warnings — non-blocking notices', () => {
  it('warns (not errors) on an unknown icon when a manifest is supplied, with a table fallback', () => {
    const response = JSON.stringify({
      schema_version: 'adminium.llm/v1',
      tables: [
        {
          table: 'public.orders',
          confidence: 0.9,
          label: { en_US: 'Orders' },
          description: { en_US: 'Customer orders.' },
          icon: 'not-a-real-lucide-icon',
          displayColumn: null,
          naturalKey: null,
        },
      ],
    });
    const result = validateResponse(response, {
      ...corpusCtx,
      allowedIcons: new Set(['shopping-cart', 'users', 'package', 'table']),
    });
    expect(result.errors).toEqual([]);
    const warning = result.warnings.find((w) => w.code === 'LLM_UNKNOWN_ICON');
    expect(warning?.path).toBe('tables[0].icon');
    expect(result.response?.tables[0]?.icon).toBe('table');
  });

  it('warns when the response run_id differs from the expected run id', () => {
    const response = JSON.stringify({
      schema_version: 'adminium.llm/v1',
      run_id: '01OTHERRUNIDOTHERRUNIDXXXX',
    });
    const result = validateResponse(response, { ...corpusCtx, runId: '01EXPECTEDRUNIDEXPECTEDXXXX' });
    expect(result.warnings.some((w) => w.code === 'LLM_RUN_MISMATCH')).toBe(true);
    expect(result.response).toBeDefined();
  });
});
