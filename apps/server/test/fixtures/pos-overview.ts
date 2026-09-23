// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The POS Overview's wave-1 composition: a plain grid of registry widgets on
 * the `page-dashboard` renderer, with the page's day control — the layout the
 * POS manifest ships for its Overview page, written against the app's SHORT
 * table names (the installer binds them to the real ones).
 *
 * Fourteen cards: the KPI tiles (sales, tickets, average ticket, tips, guests
 * served), sales by hour (by day for a week), payments by method, the open
 * tickets right now, the day's bookings, best sellers, what is sold out,
 * the shifts' cash, refunds by reason, and who is on shift. Every "today"
 * follows the day control on the venue's clock. Nothing here claims a
 * comparison, a half-hour figure or a kitchen time: those wait for engine
 * features of their own.
 */

/** The tables the Overview reads, as a manifest declares them (a subset of wave 1). */
export const POS_OVERVIEW_TABLES = [
  {
    ref: 'tickets',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'number', type: 'text', maxLength: 16, nullable: true },
      { ref: 'status', type: 'enum', enum: ['open', 'sent', 'paid', 'void'], default: 'open' },
      { ref: 'guests', type: 'int', default: 1 },
      { ref: 'total', type: 'money', nullable: true },
      { ref: 'opened_at', type: 'timestamptz', default: 'now' },
      { ref: 'closed_at', type: 'timestamptz', nullable: true },
    ],
  },
  {
    ref: 'ticket_items',
    columns: [
      { ref: 'id', type: 'bigint', role: 'pk' },
      { ref: 'ticket_id', type: 'fk', references: 'tickets' },
      { ref: 'name', type: 'text', maxLength: 80 },
      { ref: 'qty', type: 'int', default: 1 },
      { ref: 'unit_price', type: 'money' },
      { ref: 'sent_at', type: 'timestamptz', nullable: true },
      { ref: 'voided_at', type: 'timestamptz', nullable: true },
    ],
  },
  {
    ref: 'payments',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'ticket_id', type: 'fk', references: 'tickets' },
      { ref: 'method', type: 'enum', enum: ['cash', 'card', 'qr'] },
      { ref: 'amount', type: 'money' },
      { ref: 'tip', type: 'money', nullable: true },
      { ref: 'paid_at', type: 'timestamptz', default: 'now' },
    ],
  },
  {
    ref: 'refunds',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'ticket_id', type: 'fk', references: 'tickets' },
      { ref: 'amount', type: 'money' },
      { ref: 'reason', type: 'text', maxLength: 80 },
      { ref: 'refunded_at', type: 'timestamptz', default: 'now' },
    ],
  },
  {
    ref: 'reservations',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'name', type: 'text', maxLength: 40 },
      { ref: 'party_size', type: 'int' },
      { ref: 'starts_at', type: 'timestamptz' },
      { ref: 'status', type: 'enum', enum: ['confirmed', 'seated', 'no_show', 'cancelled'], default: 'confirmed' },
    ],
  },
  {
    ref: 'menu_items',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'name', type: 'text', maxLength: 80 },
      { ref: 'price', type: 'money' },
      { ref: 'available', type: 'bool', default: true },
    ],
  },
  {
    ref: 'shifts',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'started_at', type: 'timestamptz', default: 'now' },
      { ref: 'opening_float', type: 'money' },
      { ref: 'expected_cash', type: 'money', nullable: true },
      { ref: 'over_short', type: 'money', nullable: true },
    ],
  },
  {
    ref: 'staff',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'name', type: 'text', maxLength: 40 },
    ],
  },
  {
    ref: 'time_clock',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'staff_id', type: 'fk', references: 'staff' },
      { ref: 'clock_in', type: 'timestamptz', default: 'now' },
      { ref: 'clock_out', type: 'timestamptz', nullable: true },
    ],
  },
] as const;

/** A window that follows the page's day control. */
const day = (column: string) => ({ column, last: 1, unit: 'day', param: 'day' });
const paid = [{ column: 'status', op: 'eq', value: 'paid' }];
const source = (name: string) => ({ name, type: 'table' });

/** `x, y, w, h` on the 12-column grid, in half-row heights. */
const at = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

export const POS_OVERVIEW_LAYOUT = {
  version: 1,
  toolbar: { day: true },
  items: [
    // ── the day in numbers ────────────────────────────────────────────────
    {
      i: 'kpi-sales',
      widget: 'kpi-stat-card',
      ...at(0, 0, 4, 3),
      config: {
        title: 'Sales',
        metricFormat: 'currency',
        iconName: 'dollar',
        binding: { kind: 'table-query', source: source('tickets'), shape: 'metric+delta', aggregations: [{ fn: 'sum', column: 'total', alias: 'sales' }], filters: paid, window: day('closed_at') },
      },
    },
    {
      i: 'kpi-tickets',
      widget: 'kpi-stat-card',
      ...at(4, 0, 4, 3),
      config: {
        title: 'Tickets',
        metricFormat: 'plain',
        binding: { kind: 'table-query', source: source('tickets'), shape: 'metric+delta', aggregations: [{ fn: 'count', alias: 'tickets' }], filters: paid, window: day('closed_at') },
      },
    },
    {
      i: 'kpi-average',
      widget: 'kpi-stat-card',
      ...at(8, 0, 4, 3),
      config: {
        title: 'Average ticket',
        metricFormat: 'currency',
        binding: { kind: 'table-query', source: source('tickets'), shape: 'metric+delta', aggregations: [{ fn: 'avg', column: 'total', alias: 'average' }], filters: paid, window: day('closed_at') },
      },
    },
    {
      i: 'kpi-tips',
      widget: 'kpi-stat-card',
      ...at(0, 3, 6, 3),
      config: {
        title: 'Tips',
        metricFormat: 'currency',
        binding: { kind: 'table-query', source: source('payments'), shape: 'metric+delta', aggregations: [{ fn: 'sum', column: 'tip', alias: 'tips' }], window: day('paid_at') },
      },
    },
    {
      i: 'kpi-guests',
      widget: 'kpi-stat-card',
      ...at(6, 3, 6, 3),
      config: {
        title: 'Guests served',
        metricFormat: 'plain',
        binding: { kind: 'table-query', source: source('tickets'), shape: 'metric+delta', aggregations: [{ fn: 'sum', column: 'guests', alias: 'guests' }], filters: paid, window: day('closed_at') },
      },
    },
    // ── sales ─────────────────────────────────────────────────────────────
    {
      i: 'sales-by-hour',
      widget: 'chart-bar',
      ...at(0, 6, 8, 8),
      config: {
        title: 'Sales by hour',
        binding: {
          kind: 'table-query',
          source: source('tickets'),
          shape: 'timeseries',
          aggregations: [{ fn: 'sum', column: 'total', alias: 'sales' }],
          bucket: { column: 'closed_at', unit: 'hour' },
          filters: paid,
          window: day('closed_at'),
        },
      },
    },
    {
      i: 'payments',
      widget: 'chart-donut',
      ...at(8, 6, 4, 8),
      config: {
        title: 'Payments',
        binding: { kind: 'table-query', source: source('payments'), shape: 'categorical', aggregations: [{ fn: 'sum', column: 'amount', alias: 'paid' }], groupBy: ['method'], window: day('paid_at') },
      },
    },
    // ── service ───────────────────────────────────────────────────────────
    {
      i: 'right-now',
      widget: 'mini-table',
      ...at(0, 14, 6, 8),
      config: {
        title: 'Right now',
        binding: {
          kind: 'table-query',
          source: source('tickets'),
          shape: 'record-list',
          select: ['number', 'opened_at', 'total'],
          filters: [{ column: 'status', op: 'in', value: ['open', 'sent'] }],
          orderBy: [{ column: 'opened_at', dir: 'asc' }],
          limit: 8,
        },
      },
    },
    {
      i: 'bookings',
      widget: 'mini-table',
      ...at(6, 14, 6, 8),
      config: {
        title: 'Today’s bookings',
        binding: {
          kind: 'table-query',
          source: source('reservations'),
          shape: 'record-list',
          select: ['starts_at', 'name', 'party_size', 'status'],
          window: day('starts_at'),
          orderBy: [{ column: 'starts_at', dir: 'asc' }],
          limit: 12,
        },
      },
    },
    // ── menu ──────────────────────────────────────────────────────────────
    {
      i: 'best-sellers',
      widget: 'chart-ranking-bars',
      ...at(0, 22, 6, 8),
      config: {
        title: 'Best sellers',
        binding: {
          kind: 'table-query',
          source: source('ticket_items'),
          shape: 'categorical',
          aggregations: [{ fn: 'sum', column: 'qty', alias: 'sold' }],
          groupBy: ['name'],
          filters: [{ column: 'voided_at', op: 'is_null' }],
          window: day('sent_at'),
          limit: 5,
        },
      },
    },
    {
      i: 'sold-out',
      widget: 'mini-table',
      ...at(6, 22, 6, 8),
      config: {
        title: 'Sold out now',
        binding: {
          kind: 'table-query',
          source: source('menu_items'),
          shape: 'record-list',
          select: ['name', 'price'],
          filters: [{ column: 'available', op: 'eq', value: false }],
          orderBy: [{ column: 'name', dir: 'asc' }],
          limit: 12,
        },
      },
    },
    // ── cash and people ───────────────────────────────────────────────────
    {
      i: 'shift-cash',
      widget: 'mini-table',
      ...at(0, 30, 4, 8),
      config: {
        title: 'Shift and cash',
        binding: {
          kind: 'table-query',
          source: source('shifts'),
          shape: 'record-list',
          select: ['started_at', 'opening_float', 'expected_cash', 'over_short'],
          orderBy: [{ column: 'started_at', dir: 'desc' }],
          limit: 2,
        },
      },
    },
    {
      i: 'refunds',
      widget: 'chart-ranking-bars',
      ...at(4, 30, 4, 8),
      config: {
        title: 'Refunds',
        binding: { kind: 'table-query', source: source('refunds'), shape: 'categorical', aggregations: [{ fn: 'sum', column: 'amount', alias: 'refunded' }], groupBy: ['reason'], window: day('refunded_at'), limit: 5 },
      },
    },
    {
      i: 'on-shift',
      widget: 'mini-table',
      ...at(8, 30, 4, 8),
      config: {
        title: 'On shift',
        binding: {
          kind: 'table-query',
          source: source('time_clock'),
          shape: 'record-list',
          select: ['clock_in'],
          // Who, by name: the clock row holds only the staff member's key.
          lookups: ['staff_name:staff_id.name'],
          filters: [{ column: 'clock_out', op: 'is_null' }],
          orderBy: [{ column: 'clock_in', dir: 'asc' }],
          limit: 12,
        },
      },
    },
  ],
};
