import { describe, expect, it } from 'vitest';

import type {
  CandidateColumn,
  CandidateRelation,
  CandidateTableInput,
  ClassifiedColumnInput,
} from '../registry/candidates.js';
import { composeTemplate } from '../templates/compose.js';
import {
  domainHasDashboardSignal,
  emitDomainDashboardCandidates,
  type DashboardDomain,
} from './dashboard-domain.js';

/**
 * Domain dashboard assembly tests — the §15 widget set ported from the
 * Engine's bespoke `generate/dashboard.ts`, proven against the leaf's own
 * structural contract (candidates.test.ts idiom) and against
 * `composeTemplate('page-dashboard', …)`, which now owns the geometry.
 */

const CONN = 'conn_01HZX0000000000000000000';
const ctx = { connectionId: CONN };

interface ColumnSpec {
  name: string;
  logicalType: string;
  semantic: string;
  enumValues?: string[];
}

function build(
  id: string,
  specs: ColumnSpec[],
  overrides: { role?: string; rowCountEstimate?: number | null } = {},
): CandidateTableInput {
  const columns: CandidateColumn[] = specs.map((spec, index) => ({
    name: spec.name,
    ordinal: index + 1,
    logicalType: spec.logicalType,
    ...(spec.enumValues === undefined ? {} : { enumValues: spec.enumValues }),
  }));
  const classifiedColumns: ClassifiedColumnInput[] = specs.map((spec) => ({
    column: spec.name,
    semantic: spec.semantic,
  }));
  return {
    table: {
      id,
      schema: 'public',
      name: id.split('.').pop() as string,
      kind: 'table',
      rowCountEstimate: overrides.rowCountEstimate ?? 1_000,
      columns,
    },
    classified: {
      tableId: id,
      shape: 'generic',
      role: overrides.role ?? 'entity',
      columns: classifiedColumns,
    },
  };
}

const orders = build('public.orders', [
  { name: 'order_id', logicalType: 'integer', semantic: 'pk-id' },
  { name: 'total_amount', logicalType: 'decimal', semantic: 'money' },
  { name: 'status', logicalType: 'enum', semantic: 'status-workflow', enumValues: ['open', 'paid'] },
  { name: 'created_at', logicalType: 'timestamptz', semantic: 'created-at' },
]);
const customers = build(
  'public.customers',
  [
    { name: 'customer_id', logicalType: 'integer', semantic: 'pk-id' },
    { name: 'name', logicalType: 'varchar', semantic: 'person-name' },
    { name: 'region', logicalType: 'varchar', semantic: 'geo-region' },
    { name: 'country_code', logicalType: 'varchar', semantic: 'geo-region' },
  ],
  { rowCountEstimate: 400 },
);

const ordersDomain: DashboardDomain = {
  key: 'orders',
  label: 'Orders',
  tableIds: ['public.customers', 'public.orders'],
  hubTableId: 'public.orders',
};

const ordersRelations: CandidateRelation[] = [
  {
    id: 'r1',
    from: { tableId: 'public.orders', columns: ['customer_id'] },
    to: { tableId: 'public.customers' },
    confidence: 1,
  },
];

describe('emitDomainDashboardCandidates — the §15 widget set', () => {
  const candidates = emitDomainDashboardCandidates(
    ordersDomain,
    [orders, customers],
    ordersRelations,
    ctx,
  );

  it('emits exactly 4 KPIs in the bespoke order: count, money, new-30d, status', () => {
    const kpis = (candidates ?? []).filter((c) => c.widget === 'kpi-stat-card');
    expect(kpis.map((c) => c.instanceId)).toEqual([
      'kpi-count-orders',
      'kpi-sum-orders-total_amount',
      'kpi-new-orders',
      'kpi-status-orders',
    ]);
    expect(kpis.map((c) => c.config?.['title'])).toEqual([
      'Total Orders',
      'Total Total Amount',
      'New Orders (30d)',
      'Open Orders',
    ]);
  });

  it('binds the money and status KPIs to compilable descriptors (04 §5.1)', () => {
    const money = candidates?.find((c) => c.instanceId === 'kpi-sum-orders-total_amount');
    expect(money?.config).toMatchObject({
      format: 'currency',
      binding: {
        source: { schema: 'public', name: 'orders', type: 'table' },
        aggregations: [{ fn: 'sum', column: 'total_amount', alias: 'value' }],
      },
    });
    const status = candidates?.find((c) => c.instanceId === 'kpi-status-orders');
    expect(status?.config).toMatchObject({
      binding: { filters: [{ column: 'status', op: 'eq', value: 'open' }] },
    });
    const fresh = candidates?.find((c) => c.instanceId === 'kpi-new-orders');
    expect(fresh?.shape).toBe('metric+delta');
    expect(fresh?.config).toMatchObject({
      binding: { window: { column: 'created_at', last: 30, unit: 'day', compareToPrior: true } },
    });
  });

  it('sums money per month on the hero when the time-axis table has a money column', () => {
    const hero = candidates?.find((c) => c.widget === 'chart-line-area');
    expect(hero?.instanceId).toBe('hero-line-orders');
    expect(hero?.config).toMatchObject({
      title: 'Total Amount per Month',
      binding: {
        shape: 'timeseries',
        aggregations: [{ fn: 'sum', column: 'total_amount', alias: 'value' }],
        bucket: { column: 'created_at', unit: 'month' },
      },
    });
  });

  it('breaks down by the status enum ahead of geo columns', () => {
    const donut = candidates?.find((c) => c.widget === 'chart-donut');
    expect(donut?.instanceId).toBe('donut-orders-status');
    expect(donut?.config).toMatchObject({
      binding: { groupBy: ['status'], limit: 8 },
    });
  });

  it('composes onto page-dashboard v2 with the bespoke geometry (kpi 3×3, hero 8×8, donut 4×8)', () => {
    const { page, warnings } = composeTemplate('page-dashboard', candidates ?? []);
    expect(warnings.filter((w) => w.code === 'required-slot-unfillable')).toEqual([]);
    expect(page?.templateVersion).toBe(2);
    expect(page?.layout.items.map((i) => [i.i, i.widget, i.x, i.y, i.w, i.h])).toEqual([
      ['kpi-count-orders', 'kpi-stat-card', 0, 0, 3, 3],
      ['kpi-sum-orders-total_amount', 'kpi-stat-card', 3, 0, 3, 3],
      ['kpi-new-orders', 'kpi-stat-card', 6, 0, 3, 3],
      ['kpi-status-orders', 'kpi-stat-card', 9, 0, 3, 3],
      ['hero-line-orders', 'chart-line-area', 0, 3, 8, 8],
      ['donut-orders-status', 'chart-donut', 8, 3, 4, 8],
    ]);
  });
});

describe('emitDomainDashboardCandidates — fallbacks and triggers', () => {
  it('fills the KPI row with next-most-connected entity counts when money/status are missing', () => {
    const events = build('public.events', [
      { name: 'event_id', logicalType: 'integer', semantic: 'pk-id' },
      { name: 'occurred_at', logicalType: 'timestamptz', semantic: 'created-at' },
    ]);
    const venues = build('public.venues', [{ name: 'venue_id', logicalType: 'integer', semantic: 'pk-id' }], {
      rowCountEstimate: 50,
    });
    const staff = build('public.staff', [{ name: 'staff_id', logicalType: 'integer', semantic: 'pk-id' }], {
      rowCountEstimate: 900,
    });
    const link = build('public.event_staff', [{ name: 'event_id', logicalType: 'integer', semantic: 'fk' }], {
      role: 'join-table',
      rowCountEstimate: 9_999,
    });
    const domain: DashboardDomain = {
      key: 'events',
      label: 'Events',
      tableIds: ['public.event_staff', 'public.events', 'public.staff', 'public.venues'],
      hubTableId: 'public.events',
    };

    const kpis = (emitDomainDashboardCandidates(domain, [events, venues, staff, link], [], ctx) ?? []).filter(
      (c) => c.widget === 'kpi-stat-card',
    );
    // count(hub), new-30d, then row-estimate-ordered entity counts — join tables never count.
    expect(kpis.map((c) => c.instanceId)).toEqual([
      'kpi-count-events',
      'kpi-new-events',
      'kpi-count-staff',
      'kpi-count-venues',
    ]);
  });

  it('prefers a country column over other geo-region codes for the breakdown', () => {
    const shipments = build('public.shipments', [
      { name: 'shipment_id', logicalType: 'integer', semantic: 'pk-id' },
      { name: 'shipped_at', logicalType: 'timestamptz', semantic: 'created-at' },
      { name: 'ship_region', logicalType: 'varchar', semantic: 'geo-region' },
      { name: 'ship_country', logicalType: 'varchar', semantic: 'geo-region' },
    ]);
    const domain: DashboardDomain = {
      key: 'shipments',
      label: 'Shipments',
      tableIds: ['public.shipments'],
      hubTableId: 'public.shipments',
    };
    const donut = emitDomainDashboardCandidates(domain, [shipments], [], ctx)?.find(
      (c) => c.widget === 'chart-donut',
    );
    // ship_region ranks first by ordinal; the country tiebreak overrides it.
    expect(donut?.instanceId).toBe('donut-shipments-ship_country');
  });

  it('returns null without a time axis (05 §8 trigger) or a resolvable hub', () => {
    const static1 = build('public.lookup', [{ name: 'code', logicalType: 'varchar', semantic: 'pk-id' }]);
    const domain: DashboardDomain = {
      key: 'lookup',
      label: 'Lookup',
      tableIds: ['public.lookup'],
      hubTableId: 'public.lookup',
    };
    expect(emitDomainDashboardCandidates(domain, [static1], [], ctx)).toBeNull();
    expect(domainHasDashboardSignal(domain, [static1], [])).toBe(false);
    expect(domainHasDashboardSignal(ordersDomain, [orders, customers], ordersRelations)).toBe(true);

    const orphan: DashboardDomain = { ...domain, hubTableId: 'public.missing' };
    expect(emitDomainDashboardCandidates(orphan, [static1], [], ctx)).toBeNull();
  });

  it('counts rows per month on the hero when the time-axis table has no money column', () => {
    const signups = build('public.signups', [
      { name: 'signup_id', logicalType: 'integer', semantic: 'pk-id' },
      { name: 'created_at', logicalType: 'timestamptz', semantic: 'created-at' },
    ]);
    const domain: DashboardDomain = {
      key: 'signups',
      label: 'Signups',
      tableIds: ['public.signups'],
      hubTableId: 'public.signups',
    };
    const hero = emitDomainDashboardCandidates(domain, [signups], [], ctx)?.find(
      (c) => c.widget === 'chart-line-area',
    );
    expect(hero?.config).toMatchObject({
      title: 'Signups per Month',
      binding: { aggregations: [{ fn: 'count', alias: 'value' }] },
    });
  });
});
