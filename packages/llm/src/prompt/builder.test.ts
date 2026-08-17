// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `buildPrompt` — the single prompt producer (06-llm-assist.md §1, §4, §5).
 *
 * Covers: BYO-marker byte-identity (criterion 1), the sample-free default
 * (criterion 8) at the whole-prompt level, section toggles (§4.4), locale
 * injection + the English-prompt/localized-output split, allow-list bounds, the
 * token estimate, and chunk rendering.
 */
import { parseDatabaseModel, type StatsResult } from '@adminium/engine';
import { describe, expect, it } from 'vitest';

import {
  BYO_SYSTEM_MARKER,
  BYO_USER_MARKER,
  applySectionToggles,
  buildPrompt,
  flattenByo,
  normalizeSections,
} from './builder.js';
import { PROMPT_V1_SYSTEM, PROMPT_V1_USER } from './templates/v1.js';
import { estimateTokens } from './token-estimate.js';
import {
  type AllowedVocabularies,
  type BuildPromptOptions,
  type PromptInput,
  type RequestedSection,
} from './types.js';

const allowed: AllowedVocabularies = {
  templates: ['page-crud', 'page-queue-inbox', 'page-board', 'page-directory'],
  widgets: ['kpi-stat-card', 'chart-line-area', 'chart-donut'],
};

const options: BuildPromptOptions = { allowed };

function demoModel() {
  return parseDatabaseModel({
    dialect: 'postgres',
    name: 'shop',
    tables: [
      {
        name: 'customers',
        primaryKey: ['id'],
        columns: [
          { name: 'id', logicalType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
          {
            name: 'email',
            logicalType: 'text',
            nullable: false,
            isUnique: true,
            semantics: { primary: 'email', flags: { pii: 'email' }, confidence: 0.99 },
          },
          { name: 'country', logicalType: 'text', nullable: true },
        ],
      },
      {
        name: 'products',
        primaryKey: ['id'],
        columns: [
          { name: 'id', logicalType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
          { name: 'sku', logicalType: 'text', nullable: false, isUnique: true },
          { name: 'category', logicalType: 'text', nullable: true },
        ],
      },
      {
        name: 'orders',
        primaryKey: ['id'],
        columns: [
          { name: 'id', logicalType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
          {
            name: 'customer_id',
            logicalType: 'uuid',
            nullable: false,
            references: { tableId: 'public.customers', column: 'id' },
          },
          { name: 'status', logicalType: 'enum', nullable: false, enumRef: 'public.orders.status' },
        ],
      },
    ],
    enums: [
      {
        id: 'public.orders.status',
        name: 'status',
        values: ['pending', 'paid', 'shipped', 'cancelled', 'refunded'],
        source: 'check',
      },
    ],
    relations: [
      {
        id: 'orders_customer_fk',
        kind: 'declared-fk',
        cardinality: 'one-to-many',
        from: { tableId: 'public.orders', columns: ['customer_id'] },
        to: { tableId: 'public.customers', columns: ['id'] },
      },
    ],
  });
}

const demoStats: StatsResult[] = [
  {
    table: { schema: 'public', name: 'customers' },
    rowCountEstimate: 8402,
    rowCountExact: false,
    sampled: true,
    columns: [
      { column: 'email', nullFraction: 0, distinctCount: 8402, sampleValues: ['SENTINEL_EMAIL@x.com'] },
      { column: 'country', nullFraction: 0, distinctCount: 6, sampleValues: ['DE', 'SENTINEL_CAT'] },
    ],
  },
  {
    table: { schema: 'public', name: 'products' },
    rowCountEstimate: 312,
    rowCountExact: false,
    sampled: true,
    columns: [{ column: 'category', nullFraction: 0, distinctCount: 6, sampleValues: ['SENTINEL_CAT'] }],
  },
];

function makeInput(overrides: Partial<PromptInput> = {}): PromptInput {
  return {
    snapshotId: 'snap_1',
    schemaIr: demoModel(),
    stats: demoStats,
    locales: ['en_US', 'de_DE'],
    sections: [],
    sampling: null,
    runId: '01J9ZK3W8E2Q4R6T8V0X2Y4Z6A',
    ...overrides,
  };
}

describe('flattenByo + BYO identity (criterion 1)', () => {
  it('flattens with the exact dividers', () => {
    expect(flattenByo('S', 'U')).toBe('=== SYSTEM ===\nS\n\n=== USER ===\nU');
  });

  it('the bytes between the markers are byte-identical to system + user', () => {
    const artifact = buildPrompt(makeInput(), options);
    expect(artifact.byo).toBe(
      `${BYO_SYSTEM_MARKER}\n${artifact.system}\n\n${BYO_USER_MARKER}\n${artifact.user}`,
    );

    // Reconstruct system/user by splitting on the markers — must round-trip exactly.
    const afterSystem = artifact.byo.slice((`${BYO_SYSTEM_MARKER}\n`).length);
    const [systemPart, userPart] = afterSystem.split(`\n\n${BYO_USER_MARKER}\n`);
    expect(systemPart).toBe(artifact.system);
    expect(userPart).toBe(artifact.user);
  });

  it('the direct-path system section is the verbatim template', () => {
    const artifact = buildPrompt(makeInput(), options);
    expect(artifact.system).toBe(PROMPT_V1_SYSTEM);
  });
});

describe('token rendering', () => {
  it('replaces every {{TOKEN}} (none left over)', () => {
    const artifact = buildPrompt(makeInput(), options);
    expect(artifact.user).not.toContain('{{');
    expect(artifact.user).toContain('run_id: 01J9ZK3W8E2Q4R6T8V0X2Y4Z6A');
  });

  it('injects the requested OUTPUT locales as data while the prompt text stays English', () => {
    const artifact = buildPrompt(makeInput({ locales: ['en_US', 'de_DE'] }), options);
    expect(artifact.user).toContain('["en_US","de_DE"]');
    // The instruction text itself is English, not translated.
    expect(artifact.user).toContain('=== YOUR DECISIONS ===');
  });

  it('bounds suggestions with the injected allow-lists', () => {
    const artifact = buildPrompt(makeInput(), options);
    expect(artifact.user).toContain('["page-crud","page-queue-inbox","page-board","page-directory"]');
    expect(artifact.user).toContain('["kpi-stat-card","chart-line-area","chart-donut"]');
  });

  it('requires en_US in the locale set', () => {
    expect(() => buildPrompt(makeInput({ locales: ['de_DE'] }), options)).toThrow(/en_US/);
  });
});

describe('sample-free default (criterion 8)', () => {
  it('emits no cell value from any table when sampling is off', () => {
    const artifact = buildPrompt(makeInput({ sampling: null }), options);
    expect(artifact.byo).not.toContain('SENTINEL');
    // The declared enum values (schema, not data) are still present.
    expect(artifact.byo).toContain('"pending"');
  });

  it('with sampling on, includes non-PII sampled values but never PII column values', () => {
    const artifact = buildPrompt(makeInput({ sampling: { maxValuesPerColumn: 20 } }), options);
    expect(artifact.byo).toContain('SENTINEL_CAT'); // category is non-PII
    expect(artifact.byo).not.toContain('SENTINEL_EMAIL'); // email is PII → excluded
  });
});

describe('section toggles (§4.4)', () => {
  it('defaults to all ten sections when none are specified', () => {
    const artifact = buildPrompt(makeInput({ sections: [] }), options);
    expect(artifact.sections).toHaveLength(10);
    expect(artifact.user).toContain('Requested: labels, groups, enums, relations, keys, templates, widgets, pii, icons, microcopy');
  });

  it('drops the decision blocks of deselected sections, keeping original numbers', () => {
    const artifact = buildPrompt(makeInput({ sections: ['labels', 'enums'] }), options);
    expect(artifact.user).toContain('Requested: labels, enums');
    expect(artifact.user).toContain('1. LABELS & DESCRIPTIONS');
    expect(artifact.user).toContain('3. ENUM SEMANTICS');
    expect(artifact.user).not.toContain('2. DOMAIN GROUPING');
    expect(artifact.user).not.toContain('7. DASHBOARD WIDGETS');
    expect(artifact.user).not.toContain('10. MICRO-COPY');
    // Downstream context sections are untouched.
    expect(artifact.user).toContain('=== TRIGGER TAXONOMY (for decision 6) ===');
    expect(artifact.user).toContain('=== RESPONSE SCHEMA (adminium.llm/v1) ===');
  });

  it('normalizeSections dedupes, canonically orders, and treats empty as all', () => {
    expect(normalizeSections(['enums', 'labels', 'enums'])).toEqual(['labels', 'enums']);
    expect(normalizeSections([])).toHaveLength(10);
  });

  it('applySectionToggles returns the template unchanged when all sections are active', () => {
    const all: RequestedSection[] = [
      'labels', 'groups', 'enums', 'relations', 'keys', 'templates', 'widgets', 'pii', 'icons', 'microcopy',
    ];
    expect(applySectionToggles(PROMPT_V1_USER, all)).toBe(PROMPT_V1_USER);
  });
});

describe('response-schema key removal (§4.4, finding 1)', () => {
  /** The embedded RESPONSE SCHEMA object region (token-free, so all-active === verbatim). */
  function schemaBlock(user: string): string {
    return user.slice(user.indexOf('=== RESPONSE SCHEMA'), user.indexOf('=== INPUT: DATABASE SCHEMA ==='));
  }

  it('leaves the embedded schema byte-identical when all sections are active', () => {
    const artifact = buildPrompt(makeInput({ sections: [] }), options); // empty ⇒ all
    expect(schemaBlock(artifact.user)).toBe(schemaBlock(PROMPT_V1_USER));
  });

  it('a labels-only run strips every deselected key from the embedded response schema', () => {
    const schema = schemaBlock(buildPrompt(makeInput({ sections: ['labels'] }), options).user);
    // Kept: schema_version + both label keys + the structural column key.
    expect(schema).toContain('schema_version:');
    expect(schema).toContain('label: L10n, description: L10n,'); // tables[].label/description
    expect(schema).toContain('label: L10n, description?: L10n,'); // columns[].label/description
    expect(schema).toContain('column: string,');
    // Removed: every other section's key is gone (no wasted output tokens).
    for (const gone of [
      'enums: [{',
      'relations: {',
      'navGroups: [{',
      'dashboards: [{',
      'pageTemplates: [{',
      'microcopy: {',
      'pii: null | {',
      'displayColumn: string | null',
      'naturalKey: string[] | null',
      'icon: string',
    ]) {
      expect(schema, `expected "${gone}" removed from the schema`).not.toContain(gone);
    }
  });

  it('a groups-only run keeps navGroups + dashboard domains but drops widgets and table keys', () => {
    const schema = schemaBlock(buildPrompt(makeInput({ sections: ['groups'] }), options).user);
    expect(schema).toContain('navGroups: [{');
    expect(schema).toContain('domain: string');
    expect(schema).not.toContain('widgets: [{');
    expect(schema).not.toContain('enums: [{');
    expect(schema).not.toContain('label: L10n, description: L10n,');
  });

  it('deselecting only widgets keeps the dashboards object (with domain) and closes it cleanly', () => {
    const nine: RequestedSection[] = [
      'labels', 'groups', 'enums', 'relations', 'keys', 'templates', 'pii', 'icons', 'microcopy',
    ];
    const schema = schemaBlock(buildPrompt(makeInput({ sections: nine }), options).user);
    expect(schema).toContain('dashboards: [{ id: string, domain: string');
    expect(schema).toContain('tables: string[] }],'); // widgets removed, dashboards closed with no trailing comma
    expect(schema).not.toContain('widgets: [{');
    expect(schema).toContain('navGroups: [{'); // groups still on
  });

  it('drops navGroups[].icon inline when icons are deselected but groups remain', () => {
    const eight: RequestedSection[] = [
      'labels', 'groups', 'enums', 'relations', 'keys', 'templates', 'widgets', 'microcopy',
    ]; // pii + icons off
    const schema = schemaBlock(buildPrompt(makeInput({ sections: eight }), options).user);
    expect(schema).toContain('navGroups: [{');
    expect(schema).toContain('label: L10n, order: number,'); // icon stripped from the navGroups line
    expect(schema).not.toContain('label: L10n, icon: string, order: number,');
    expect(schema).not.toContain('pii: null | {'); // pii off
  });
});

describe('token estimate + budget', () => {
  it('estimates ceil(chars / 3.6) over the flattened document', () => {
    const artifact = buildPrompt(makeInput(), options);
    expect(artifact.tokenEstimate).toBe(estimateTokens(artifact.byo));
    expect(artifact.tokenEstimate).toBeGreaterThan(0);
    expect(artifact.tokenEstimate).toBeLessThan(artifact.byo.length);
  });

  it('flags overBudget when the user section exceeds the budget', () => {
    expect(buildPrompt(makeInput(), { allowed, tokenBudget: 1 }).overBudget).toBe(true);
    expect(buildPrompt(makeInput(), { allowed, tokenBudget: 1_000_000 }).overBudget).toBe(false);
  });
});

describe('chunk rendering (§4.5)', () => {
  it('renders the chunk-info sentence and stubs out-of-chunk tables', () => {
    const artifact = buildPrompt(
      makeInput({ chunk: { index: 1, total: 2, stubTables: ['public.products'] } }),
      options,
    );
    expect(artifact.user).toContain('This is chunk 1 of 2 of a larger schema.');
    expect(artifact.user).toContain('"stub":true');
    expect(artifact.chunks[0]?.total).toBe(2);
  });

  it('omits the chunk-info line entirely for an unchunked run', () => {
    const artifact = buildPrompt(makeInput(), options);
    expect(artifact.user).not.toContain('This is chunk');
    expect(artifact.chunks).toHaveLength(1);
    expect(artifact.chunks[0]?.total).toBe(1);
  });
});
