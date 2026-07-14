import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  applyClassification,
  detectDomains,
  generatePages,
  parseDatabaseModel,
  slugify,
  SlugRegistry,
  type PageEnvelope,
} from '../src/index.js';
import { pageEnvelopeSchema, widgetConfigSchema } from '../src/config-schema/index.js';

const modelPath = fileURLToPath(new URL('./fixtures/northwind.model.json', import.meta.url));
const model = applyClassification(parseDatabaseModel(readFileSync(modelPath, 'utf8')));
const CONN = 'conn_01HZX0000000000000000000';

function page(pages: PageEnvelope[], slug: string): PageEnvelope {
  const found = pages.find((p) => p.nav.slug === slug);
  if (found === undefined) throw new Error(`no page with slug ${slug}`);
  return found;
}

describe('slugify / SlugRegistry', () => {
  it('kebab-cases identifiers', () => {
    expect(slugify('order_details')).toBe('order-details');
    expect(slugify('OrderDetails')).toBe('order-details');
    expect(slugify('us_states')).toBe('us-states');
  });

  it('caps slugs at the id budget and uniquifies deterministically', () => {
    const long = slugify('a_very_long_table_name_that_exceeds_the_id_budget');
    expect(long.length).toBeLessThanOrEqual(31);
    const registry = new SlugRegistry();
    expect(registry.claim('orders')).toBe('orders');
    expect(registry.claim('orders')).toBe('orders-2');
    expect(registry.claim('orders')).toBe('orders-3');
  });
});

describe('generatePages on Northwind (full-admin)', () => {
  const result = generatePages(model, { connectionId: CONN });

  it('emits one page-crud per included table plus one dashboard', () => {
    const crud = result.pages.filter((p) => p.template === 'page-crud');
    const dashboards = result.pages.filter((p) => p.template === 'page-dashboard');
    // 14 tables − 3 join tables (customer_customer_demo, employee_territories)
    // — wait: 2 join tables; us_states/region/etc are entities.
    expect(crud.map((p) => p.nav.slug)).toContain('customers');
    expect(crud.map((p) => p.nav.slug)).toContain('orders');
    expect(crud.map((p) => p.nav.slug)).toContain('products');
    expect(crud.map((p) => p.nav.slug)).not.toContain('customer-customer-demo');
    expect(crud.map((p) => p.nav.slug)).not.toContain('employee-territories');
    expect(crud).toHaveLength(12);
    expect(dashboards).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes('join table'))).toBe(true);
  });

  it('every envelope validates against the frozen schema', () => {
    for (const envelope of result.pages) {
      expect(() => pageEnvelopeSchema.parse(envelope)).not.toThrow();
    }
  });

  it('page ids are stable page_<slug> and fit char(36)', () => {
    for (const envelope of result.pages) {
      expect(envelope.id).toBe(`page_${envelope.nav.slug}`);
      expect(envelope.id.length).toBeLessThanOrEqual(36);
    }
  });

  it('embeds a generatedHash that is stable across runs', () => {
    const again = generatePages(model, { connectionId: CONN });
    expect(JSON.parse(JSON.stringify(again))).toEqual(JSON.parse(JSON.stringify(result)));
    for (const envelope of result.pages) {
      expect(typeof envelope.config['generatedHash']).toBe('string');
      expect((envelope.config['generatedHash'] as string).length).toBe(64);
    }
  });

  it('customers crud page has sane columns and access', () => {
    const customers = page(result.pages, 'customers');
    expect(customers.kind).toBe('page');
    expect(customers.source).toEqual({ connectionId: CONN, table: 'public.customers' });
    expect(customers.access.permissions).toEqual(['table:public.customers:read']);
    // gridColumnSpecSchema vocabulary ({name, logicalType, semantic, …}).
    const columns = customers.config['columns'] as { name: string; semantic: string; pii?: boolean }[];
    expect(columns.length).toBeLessThanOrEqual(8);
    expect(columns[0]?.name).toBe('company_name'); // display column first
    expect(columns.map((c) => c.name)).not.toContain('customer_id'); // pk hidden
    expect(columns.find((c) => c.name === 'phone')?.pii).toBe(true); // masked-by-default PII
    expect(customers.nav.group).toBe('library');
  });

  it('orders crud page sorts by PK desc (no created-at) and tabs inbound FKs', () => {
    const orders = page(result.pages, 'orders');
    expect(orders.config['defaultSort']).toEqual([{ column: 'order_id', dir: 'desc' }]);
    const detail = orders.config['detail'] as { tabsFromInboundFks: boolean; tabs: { table: string }[] };
    expect(detail.tabsFromInboundFks).toBe(true);
    expect(detail.tabs.map((t) => t.table)).toContain('public.order_details');
    const columns = orders.config['columns'] as {
      name: string;
      semantic: string;
      fk?: { table: string; column: string };
    }[];
    const customerFk = columns.find((c) => c.name === 'customer_id');
    expect(customerFk?.semantic).toBe('fk');
    expect(customerFk?.fk).toEqual({ table: 'public.customers', column: 'customer_id' });
  });

  it('products crud page renders money as cell-money and forms carry field defs', () => {
    const products = page(result.pages, 'products');
    const columns = products.config['columns'] as {
      name: string;
      semantic: string;
      align?: string;
    }[];
    const unitPrice = columns.find((c) => c.name === 'unit_price');
    expect(unitPrice?.semantic).toBe('money');
    expect(unitPrice?.align).toBe('end');
    const form = products.config['form'] as {
      fields: { column: string; input: string; required: boolean }[];
    };
    expect(form.fields.find((f) => f.column === 'supplier_id')?.input).toBe('fk-combobox');
    expect(form.fields.find((f) => f.column === 'unit_price')?.input).toBe('number');
    // Northwind PKs carry no default → they stay in the form as required inputs.
    expect(form.fields.find((f) => f.column === 'product_id')?.required).toBe(true);
  });

  it('employees land in the PEOPLE nav group', () => {
    const employees = page(result.pages, 'employees');
    expect(employees.nav.group).toBe('people');
    expect(employees.nav.icon).toBe('users');
  });

  it('dashboard has 4 KPIs + line + donut over orders with valid bindings', () => {
    const dashboard = page(result.pages, 'dashboard');
    expect(dashboard.kind).toBe('dashboard');
    expect(dashboard.nav.group).toBe('workspace');
    const layout = dashboard.config['layout'] as {
      version: number;
      items: { widget: string; w: number; config: Record<string, unknown> }[];
    };
    const kpis = layout.items.filter((i) => i.widget === 'kpi-stat-card');
    const lines = layout.items.filter((i) => i.widget === 'chart-line-area');
    const donuts = layout.items.filter((i) => i.widget === 'chart-donut');
    expect(kpis).toHaveLength(4);
    expect(lines).toHaveLength(1);
    expect(donuts).toHaveLength(1);
    expect(kpis.every((i) => i.w === 3)).toBe(true); // span heuristic kpi=3
    expect(lines[0]?.w).toBe(8); // line=8
    expect(donuts[0]?.w).toBe(4); // donut=4
    for (const item of layout.items) {
      expect(() => widgetConfigSchema.parse(item)).not.toThrow();
      const binding = item.config['binding'] as { connectionId: string; source: { name: string } };
      expect(binding.connectionId).toBe(CONN);
    }
    // Hero + KPI-count target the hub table (orders); donut breaks down orders.
    const line = lines[0] as { config: Record<string, unknown> };
    const lineBinding = line.config['binding'] as { source: { name: string }; bucket: { unit: string } };
    expect(lineBinding.source.name).toBe('orders');
    expect(lineBinding.bucket.unit).toBe('month');
    const donutBinding = (donuts[0] as { config: Record<string, unknown> }).config['binding'] as {
      source: { name: string };
      groupBy: string[];
    };
    expect(donutBinding.source.name).toBe('orders');
    expect(donutBinding.groupBy).toHaveLength(1);
  });
});

describe('domain detection', () => {
  it('finds a single orders-hub domain on Northwind', () => {
    const tables = model.tables.filter(
      (t) => t.semantics?.role !== 'join-table' && t.semantics?.role !== 'system' && !t.system,
    );
    const domains = detectDomains(model, tables);
    expect(domains.length).toBeGreaterThanOrEqual(1);
    expect(domains[0]?.hubTableId).toBe('public.orders');
    expect(domains[0]?.label).toBe('Orders');
  });
});

describe('intent variants (09 §8.4)', () => {
  it("'crud' emits no dashboards", () => {
    const result = generatePages(model, { connectionId: CONN, intent: 'crud' });
    expect(result.pages.some((p) => p.template === 'page-dashboard')).toBe(false);
    expect(result.pages.some((p) => p.template === 'page-crud')).toBe(true);
  });

  it("'read-only-analytics' emits read-only crud pages without forms", () => {
    const result = generatePages(model, { connectionId: CONN, intent: 'read-only-analytics' });
    const crud = result.pages.filter((p) => p.template === 'page-crud');
    expect(crud.length).toBeGreaterThan(0);
    for (const envelope of crud) {
      expect(envelope.config['readOnly']).toBe(true);
      expect(envelope.config['form']).toBeUndefined();
    }
    expect(result.pages.some((p) => p.template === 'page-dashboard')).toBe(true);
  });

  it('no connection id → dashboards skipped with a warning', () => {
    const detached = { ...model, source: { kind: 'import', format: 'json-ir' } as const };
    const result = generatePages(parseDatabaseModel(JSON.parse(JSON.stringify(detached))));
    expect(result.pages.some((p) => p.template === 'page-dashboard')).toBe(false);
    expect(result.warnings.some((w) => w.includes('no connection id'))).toBe(true);
  });
});
