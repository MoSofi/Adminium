/**
 * `LlmResponseV1` contract + version negotiation (06-llm-assist.md §6.1, §6.3,
 * §4.3). Locks: the §6.3 golden response validates with zero errors; malformed
 * responses are rejected; `L10n` accepts a locale SUBSET (Zod-4 partialRecord
 * adaptation); version negotiation is fatal on unknown, ok on supported/older.
 */
import { describe, expect, it } from 'vitest';

import {
  isSupportedSchemaVersion,
  L10n,
  LlmResponseV1,
  negotiateSchemaVersion,
  SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  VERSION_MISMATCH_CODE,
  VERSION_MISMATCH_HINT,
} from './schema.js';

/** The §6.3 golden fixture (`responses/valid-demo.json`), reproduced in full. */
const validDemo = {
  schema_version: 'adminium.llm/v1',
  run_id: '01J9ZK3W8E2Q4R6T8V0X2Y4Z6A',
  tables: [
    {
      table: 'public.orders',
      confidence: 0.95,
      label: { en_US: 'Orders', de_DE: 'Bestellungen' },
      description: {
        en_US: "A customer's purchase of a product, tracked from placement to fulfilment.",
        de_DE: 'Der Kauf eines Produkts durch einen Kunden, von der Bestellung bis zur Lieferung.',
      },
      icon: 'shopping-cart',
      displayColumn: 'order_number',
      naturalKey: ['order_number'],
      pageTemplates: [
        {
          template: 'page-queue-inbox',
          rank: 1,
          triggers: ['workflow enum with pending-style states', 'requester FK (customer_id)'],
          reason:
            'status is a fulfilment workflow (pending→paid→shipped) staff work through like a queue.',
          confidence: 0.82,
        },
        {
          template: 'page-board',
          rank: 2,
          triggers: ['status enum classified workflow'],
          reason: 'Five ordered states suit a drag-to-advance fulfilment board.',
          confidence: 0.6,
        },
      ],
      microcopy: {
        emptyState: {
          headline: { en_US: 'No orders yet', de_DE: 'Noch keine Bestellungen' },
          guidance: {
            en_US: 'Orders appear here as customers place them. Create one manually to get started.',
            de_DE:
              'Bestellungen erscheinen hier, sobald Kunden sie aufgeben. Legen Sie zum Einstieg eine manuell an.',
          },
        },
        pageSubtitle: {
          en_US: 'Track and fulfil customer orders',
          de_DE: 'Kundenbestellungen verfolgen und abwickeln',
        },
      },
      columns: [
        { column: 'order_number', label: { en_US: 'Order number', de_DE: 'Bestellnummer' }, pii: null },
        { column: 'customer_id', label: { en_US: 'Customer', de_DE: 'Kunde' }, pii: null },
        { column: 'product_id', label: { en_US: 'Product', de_DE: 'Produkt' }, pii: null },
        { column: 'status', label: { en_US: 'Status', de_DE: 'Status' }, pii: null },
        {
          column: 'total_cents',
          label: { en_US: 'Total', de_DE: 'Gesamtbetrag' },
          description: {
            en_US: 'Order total in cents; divide by 100 for display currency.',
            de_DE: 'Bestellsumme in Cent; für die Anzeige durch 100 teilen.',
          },
          pii: null,
        },
        { column: 'placed_at', label: { en_US: 'Placed', de_DE: 'Bestellt am' }, pii: null },
      ],
    },
    {
      table: 'public.customers',
      confidence: 0.94,
      label: { en_US: 'Customers', de_DE: 'Kunden' },
      description: {
        en_US: 'People who buy products; each row is one customer account.',
        de_DE: 'Personen, die Produkte kaufen; jede Zeile ist ein Kundenkonto.',
      },
      icon: 'users',
      displayColumn: 'full_name',
      naturalKey: ['email'],
      pageTemplates: [
        {
          template: 'page-directory',
          rank: 1,
          triggers: ['people-shaped table: name + email'],
          reason: 'full_name + email make a browsable people directory with card layout.',
          confidence: 0.55,
        },
      ],
      microcopy: {
        emptyState: {
          headline: { en_US: 'No customers yet', de_DE: 'Noch keine Kunden' },
          guidance: {
            en_US: 'Customers are created at checkout. Add one manually or import a CSV to begin.',
            de_DE:
              'Kunden werden beim Checkout angelegt. Fügen Sie einen manuell hinzu oder importieren Sie eine CSV-Datei.',
          },
        },
        pageSubtitle: {
          en_US: 'Everyone who has bought from you',
          de_DE: 'Alle, die bei Ihnen gekauft haben',
        },
      },
      columns: [
        {
          column: 'email',
          label: { en_US: 'Email', de_DE: 'E-Mail' },
          pii: {
            kind: 'email',
            masking: 'mask-email',
            reason: "Column stores customer email addresses (unique, text, name 'email').",
            confidence: 0.99,
          },
        },
        {
          column: 'full_name',
          label: { en_US: 'Full name', de_DE: 'Vollständiger Name' },
          pii: {
            kind: 'name',
            masking: 'mask-partial',
            reason: 'Personal names are directly identifying.',
            confidence: 0.96,
          },
        },
        { column: 'country', label: { en_US: 'Country', de_DE: 'Land' }, pii: null },
        { column: 'created_at', label: { en_US: 'Signed up', de_DE: 'Registriert am' }, pii: null },
      ],
    },
    {
      table: 'public.products',
      confidence: 0.96,
      label: { en_US: 'Products', de_DE: 'Produkte' },
      description: {
        en_US: 'Items available for purchase, with pricing and category.',
        de_DE: 'Zum Kauf verfügbare Artikel mit Preis und Kategorie.',
      },
      icon: 'package',
      displayColumn: 'name',
      naturalKey: ['sku'],
      pageTemplates: [],
      microcopy: {
        emptyState: {
          headline: { en_US: 'No products yet', de_DE: 'Noch keine Produkte' },
          guidance: {
            en_US: 'Add your first product to start taking orders.',
            de_DE: 'Legen Sie Ihr erstes Produkt an, um Bestellungen entgegenzunehmen.',
          },
        },
        pageSubtitle: {
          en_US: 'Manage your catalog and pricing',
          de_DE: 'Katalog und Preise verwalten',
        },
      },
      columns: [
        { column: 'sku', label: { en_US: 'SKU', de_DE: 'Artikelnummer' }, pii: null },
        { column: 'name', label: { en_US: 'Name', de_DE: 'Name' }, pii: null },
        { column: 'category', label: { en_US: 'Category', de_DE: 'Kategorie' }, pii: null },
        {
          column: 'price_cents',
          label: { en_US: 'Price', de_DE: 'Preis' },
          description: { en_US: 'Unit price in cents.', de_DE: 'Stückpreis in Cent.' },
          pii: null,
        },
      ],
    },
  ],
  enums: [
    {
      table: 'public.orders',
      column: 'status',
      kind: 'workflow',
      order: ['pending', 'paid', 'shipped', 'cancelled', 'refunded'],
      terminal: ['shipped', 'cancelled', 'refunded'],
      tones: { pending: 'warn', paid: 'accent', shipped: 'pos', cancelled: 'danger', refunded: 'muted' },
      reason:
        'Values are lifecycle states of order fulfilment with clear temporal order and terminal outcomes.',
      confidence: 0.97,
    },
  ],
  relations: {
    confirmed: [
      {
        fromTable: 'public.orders',
        fromColumns: ['customer_id'],
        toTable: 'public.customers',
        toColumns: ['id'],
        semantics: 'orders belong to customers',
        correct: true,
        confidence: 0.99,
      },
    ],
    inferred: [
      {
        fromTable: 'public.orders',
        fromColumns: ['product_id'],
        toTable: 'public.products',
        toColumns: ['id'],
        kind: 'many-to-one',
        evidence:
          'Name pattern product_id, uuid types match, distinctCount 311 ≈ products rowCount 312; no FK declared.',
        confidence: 0.93,
      },
    ],
  },
  navGroups: [
    {
      id: 'sales',
      label: { en_US: 'Sales', de_DE: 'Verkauf' },
      icon: 'shopping-cart',
      order: 0,
      tables: ['public.orders', 'public.customers'],
      confidence: 0.9,
    },
    {
      id: 'catalog',
      label: { en_US: 'Catalog', de_DE: 'Katalog' },
      icon: 'package',
      order: 1,
      tables: ['public.products'],
      confidence: 0.9,
    },
  ],
  dashboards: [
    {
      id: 'revenue',
      domain: 'Revenue',
      label: { en_US: 'Revenue', de_DE: 'Umsatz' },
      order: 0,
      tables: ['public.orders', 'public.products'],
      widgets: [
        {
          widget: 'kpi-stat-card',
          rank: 1,
          span: 3,
          table: 'public.orders',
          metricColumn: 'total_cents',
          agg: 'sum',
          titleEn: 'Total revenue',
          reason: 'total_cents is the primary money measure.',
          confidence: 0.95,
        },
        {
          widget: 'kpi-stat-card',
          rank: 2,
          span: 3,
          table: 'public.orders',
          agg: 'count',
          titleEn: 'Orders',
          reason: 'Order volume is the core operational count.',
          confidence: 0.94,
        },
        {
          widget: 'chart-line-area',
          rank: 3,
          span: 8,
          table: 'public.orders',
          metricColumn: 'total_cents',
          timeColumn: 'placed_at',
          agg: 'sum',
          titleEn: 'Revenue over time',
          reason: 'Money measure + placed_at timestamp make the canonical trend chart.',
          confidence: 0.93,
        },
        {
          widget: 'chart-donut',
          rank: 4,
          span: 4,
          table: 'public.orders',
          dimensionColumn: 'status',
          agg: 'count',
          titleEn: 'Orders by status',
          reason: 'Workflow enum distribution shows fulfilment health at a glance.',
          confidence: 0.9,
        },
        {
          widget: 'top-movers-list',
          rank: 5,
          span: 6,
          table: 'public.products',
          metricColumn: 'price_cents',
          titleEn: 'Top products',
          reason: 'Ranks catalog items; joins via inferred orders.product_id relation.',
          confidence: 0.72,
        },
      ],
    },
  ],
  notes: [
    'orders.product_id has no declared foreign key — consider adding one in the database.',
    'customers.country is a 24-value text column; a lookup table or enum would improve integrity.',
  ],
} as const;

describe('LlmResponseV1 — golden fixture (§6.3)', () => {
  it('validates the valid-demo response with zero errors', () => {
    const result = LlmResponseV1.safeParse(validDemo);
    expect(result.success).toBe(true);
  });

  it('preserves the fixture values it parses', () => {
    const parsed = LlmResponseV1.parse(validDemo);
    expect(parsed.schema_version).toBe(SCHEMA_VERSION);
    expect(parsed.run_id).toBe('01J9ZK3W8E2Q4R6T8V0X2Y4Z6A');
    expect(parsed.tables.map((t) => t.table)).toEqual([
      'public.orders',
      'public.customers',
      'public.products',
    ]);
    expect(parsed.enums[0]?.tones).toMatchObject({ pending: 'warn', shipped: 'pos' });
    expect(parsed.relations.inferred).toHaveLength(1);
    expect(parsed.dashboards[0]?.widgets).toHaveLength(5);
  });
});

describe('LlmResponseV1 — minimal + defaults', () => {
  it('accepts a minimal hand-built valid response and fills defaults', () => {
    const parsed = LlmResponseV1.parse({ schema_version: SCHEMA_VERSION });
    expect(parsed).toEqual({
      schema_version: SCHEMA_VERSION,
      tables: [],
      enums: [],
      relations: { confirmed: [], inferred: [] },
      navGroups: [],
      dashboards: [],
    });
  });

  it('defaults a column pii to null and pageTemplates/columns to []', () => {
    const parsed = LlmResponseV1.parse({
      schema_version: SCHEMA_VERSION,
      tables: [
        {
          table: 'public.orders',
          confidence: 0.5,
          label: { en_US: 'Orders' },
          description: { en_US: 'x' },
          icon: 'shopping-cart',
          displayColumn: null,
          naturalKey: null,
          columns: [{ column: 'id', label: { en_US: 'ID' } }],
        },
      ],
    });
    const table = parsed.tables[0];
    expect(table?.pageTemplates).toEqual([]);
    expect(table?.columns[0]?.pii).toBeNull();
  });
});

describe('L10n — string-keyed record (locale-key check deferred to validate.ts stage 5)', () => {
  it('accepts a subset of the 8 locales (2 of 8)', () => {
    expect(L10n.safeParse({ en_US: 'Orders', de_DE: 'Bestellungen' }).success).toBe(true);
  });

  it('accepts an empty object (exact-keys check is deferred to validate.ts)', () => {
    expect(L10n.safeParse({}).success).toBe(true);
  });

  it('accepts an unknown / non-canonical locale key at the Zod layer', () => {
    // A stray key ('en-US', 'pt_BR', …) must NOT fail Zod (which is fatal for the
    // whole run); it is a per-item LLM_LOCALE_KEYS drop in stage 5 instead.
    expect(L10n.safeParse({ 'en-US': 'x' }).success).toBe(true);
    expect(L10n.safeParse({ pt_BR: 'x' }).success).toBe(true);
  });

  it('rejects an empty string value', () => {
    expect(L10n.safeParse({ en_US: '' }).success).toBe(false);
  });
});

describe('LlmResponseV1 — rejects malformed responses', () => {
  const base = { schema_version: SCHEMA_VERSION } as const;

  it('rejects an unknown top-level key (root is strict)', () => {
    expect(LlmResponseV1.safeParse({ ...base, bogus: 1 }).success).toBe(false);
  });

  it('rejects a missing schema_version', () => {
    expect(LlmResponseV1.safeParse({ tables: [] }).success).toBe(false);
  });

  it('rejects a wrong schema_version literal', () => {
    expect(LlmResponseV1.safeParse({ schema_version: 'adminium.llm/v2' }).success).toBe(false);
  });

  const table = {
    table: 'public.orders',
    confidence: 0.9,
    label: { en_US: 'Orders' },
    description: { en_US: 'x' },
    icon: 'shopping-cart',
    displayColumn: null,
    naturalKey: null,
  };

  it('rejects confidence > 1', () => {
    expect(
      LlmResponseV1.safeParse({ ...base, tables: [{ ...table, confidence: 1.2 }] }).success,
    ).toBe(false);
  });

  it('rejects a non-kebab-case icon', () => {
    expect(
      LlmResponseV1.safeParse({ ...base, tables: [{ ...table, icon: 'ShoppingCart' }] }).success,
    ).toBe(false);
  });

  it('rejects an empty naturalKey array (min 1 when non-null)', () => {
    expect(
      LlmResponseV1.safeParse({ ...base, tables: [{ ...table, naturalKey: [] }] }).success,
    ).toBe(false);
  });

  it('rejects a widget span outside {3,4,6,8,12}', () => {
    const bad = {
      ...base,
      dashboards: [
        {
          id: 'revenue',
          domain: 'Revenue',
          label: { en_US: 'Revenue' },
          order: 0,
          tables: ['public.orders'],
          widgets: [
            {
              widget: 'kpi-stat-card',
              rank: 1,
              span: 5,
              table: 'public.orders',
              titleEn: 'x',
              reason: 'x',
              confidence: 0.5,
            },
          ],
        },
      ],
    };
    expect(LlmResponseV1.safeParse(bad).success).toBe(false);
  });

  it('rejects a nav group id that is not a slug', () => {
    const bad = {
      ...base,
      navGroups: [
        { id: 'Not A Slug', label: { en_US: 'x' }, icon: 'users', order: 0, tables: ['public.orders'], confidence: 0.5 },
      ],
    };
    expect(LlmResponseV1.safeParse(bad).success).toBe(false);
  });

  it('strips benign extra keys on nested objects (only the root is strict)', () => {
    const parsed = LlmResponseV1.parse({
      ...base,
      tables: [{ ...table, columns: [{ column: 'id', label: { en_US: 'ID' }, extra: true }] }],
    });
    expect(parsed.tables[0]?.columns[0]).not.toHaveProperty('extra');
  });
});

describe('version negotiation (§4.3)', () => {
  it('exposes v1 as the only supported version today', () => {
    expect(SUPPORTED_SCHEMA_VERSIONS).toEqual(['adminium.llm/v1']);
  });

  it('resolves the supported version', () => {
    const n = negotiateSchemaVersion(SCHEMA_VERSION);
    expect(n).toEqual({ ok: true, version: 'adminium.llm/v1' });
  });

  it('fatally rejects an unknown version with the code and regeneration hint', () => {
    const n = negotiateSchemaVersion('adminium.llm/v0');
    expect(n.ok).toBe(false);
    if (n.ok) throw new Error('expected rejection');
    expect(n.code).toBe(VERSION_MISMATCH_CODE);
    expect(n.hint).toBe(VERSION_MISMATCH_HINT);
    expect(n.message).toContain('adminium.llm/v0');
    expect(n.message).toContain('Regenerate the prompt');
  });

  it('fatally rejects a missing / non-string version', () => {
    expect(negotiateSchemaVersion(undefined).ok).toBe(false);
    expect(negotiateSchemaVersion(42).ok).toBe(false);
    expect(negotiateSchemaVersion(null).ok).toBe(false);
  });

  it('still validates a supported-but-older version once v2 exists (future-proofing)', () => {
    // Simulate the post-v2 world: v1 stays supported and must keep negotiating ok.
    const future = ['adminium.llm/v2', 'adminium.llm/v1'] as const;
    expect(negotiateSchemaVersion('adminium.llm/v1', future).ok).toBe(true);
    expect(negotiateSchemaVersion('adminium.llm/v2', future).ok).toBe(true);
    expect(negotiateSchemaVersion('adminium.llm/v0', future).ok).toBe(false);
  });

  it('isSupportedSchemaVersion is a working predicate', () => {
    expect(isSupportedSchemaVersion('adminium.llm/v1')).toBe(true);
    expect(isSupportedSchemaVersion('nope')).toBe(false);
    expect(isSupportedSchemaVersion(123)).toBe(false);
  });
});
