import type { GridColumnSpec, GridColumnSpecInput, GridRow } from './column-spec.js';
import { gridColumnSpecSchema } from './column-spec.js';

/**
 * Deterministic demo payloads for the `tables` family (04 §7.7 — every
 * definition's `demoData(seed)`), shaped like the CRUD API `record-list`
 * envelope rows. Deliberately domain-true (customers with money/status/
 * fk/bool/timestamp columns) so stories and the builder palette read real.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMPANIES = [
  'Northwind Traders',
  'Globex Corp',
  'Initech',
  'Umbrella Labs',
  'Stark Industries',
  'Wayne Enterprises',
  'Acme Holdings',
  'Hooli',
  'Vandelay Industries',
  'Pied Piper',
  'Soylent Corp',
  'Tyrell Systems',
] as const;

const OWNERS = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Edsger Dijkstra'] as const;
const STATUSES = ['active', 'trialing', 'past_due', 'canceled'] as const;
const PLANS = ['starter', 'team', 'enterprise'] as const;

const demoColumnInputs: readonly GridColumnSpecInput[] = [
  { name: 'id', label: 'ID', logicalType: 'integer', semantic: 'pk-id', primaryKey: true, readOnly: true, hasDefault: true, nullable: false, mono: true, hidden: true },
  { name: 'name', label: 'Customer', logicalType: 'varchar', semantic: 'person-name', nullable: false, isDisplay: true, maxLength: 120 },
  { name: 'email', label: 'Email', logicalType: 'varchar', semantic: 'email', nullable: false, unique: true, mono: true },
  { name: 'plan', label: 'Plan', logicalType: 'enum', semantic: 'category-enum', enumValues: [...PLANS], nullable: false },
  {
    name: 'status',
    label: 'Status',
    logicalType: 'enum',
    semantic: 'status-workflow',
    enumValues: [...STATUSES],
    enumTones: { active: 'pos', trialing: 'warn', past_due: 'warn', canceled: 'danger' },
    nullable: false,
  },
  { name: 'mrr', label: 'MRR', logicalType: 'decimal', semantic: 'money', currency: 'USD', nullable: false },
  { name: 'seats', label: 'Seats', logicalType: 'integer', nullable: false },
  { name: 'is_verified', label: 'Verified', logicalType: 'boolean', semantic: 'boolean-flag', nullable: false, hasDefault: true },
  {
    name: 'owner_id',
    label: 'Owner',
    logicalType: 'integer',
    semantic: 'fk',
    fk: { table: 'public.team_members', column: 'id', displayKey: 'owner_name' },
    nullable: true,
  },
  { name: 'phone', label: 'Phone', logicalType: 'varchar', semantic: 'phone', pii: true, nullable: true },
  { name: 'created_at', label: 'Created', logicalType: 'timestamptz', semantic: 'created-at', readOnly: true, hasDefault: true, nullable: false },
];

/** Column specs for the demo customers table (parsed → defaults applied). */
export const demoCustomerColumns: readonly GridColumnSpec[] = demoColumnInputs.map((input) =>
  gridColumnSpecSchema.parse(input),
);

/** Deterministic `record-list` rows; pg-style: decimal serialized as string. */
export function demoCustomerRows(seed: number, count = 8): GridRow[] {
  const random = mulberry32(seed || 1);
  const base = Date.UTC(2026, 0, 15, 12, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const company = COMPANIES[Math.floor(random() * COMPANIES.length) % COMPANIES.length] as string;
    const owner = Math.floor(random() * OWNERS.length) % OWNERS.length;
    const status = STATUSES[Math.floor(random() * STATUSES.length) % STATUSES.length] as string;
    const mrr = Math.round(random() * 8000) + 90;
    return {
      id: index + 1,
      name: `${company}${index >= COMPANIES.length ? ` ${String(index)}` : ''}`,
      email: `billing@${company.toLowerCase().replace(/[^a-z]+/g, '')}.com`,
      plan: PLANS[Math.floor(random() * PLANS.length) % PLANS.length] as string,
      status,
      // Serialized like pg `decimal` — a STRING — so the numeric-sort fix is
      // exercised by default everywhere demo data renders.
      mrr: String(mrr),
      seats: Math.floor(random() * 250) + 1,
      is_verified: random() > 0.3,
      owner_id: owner + 1,
      owner_name: OWNERS[owner] as string,
      phone: `+1 415 555 0${String(100 + index)}`,
      created_at: new Date(base - Math.floor(random() * 90) * 86_400_000).toISOString(),
    };
  });
}

/** `record-list` envelope for grid-shaped demo contracts. */
export function demoRecordList(seed: number, count = 8): { data: GridRow[]; page: { limit: number; offset: number; total: number } } {
  const data = demoCustomerRows(seed, count);
  return { data, page: { limit: count, offset: 0, total: 8402 } };
}
