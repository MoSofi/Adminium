// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  classifyTableColumns,
  COLUMN_RULE_IDS,
  parseDatabaseModel,
  type ClassifiedColumn,
  type DatabaseModel,
} from '../src/index.js';

/**
 * Targeted unit tests per §7.1 heuristic family (05-introspection-engine.md),
 * including the adversarial cases: a free-text 'status' column must NOT
 * become status-workflow, a money-named string column must NOT become money,
 * and `company_name` must NOT be flagged as payment PII despite containing
 * the substring "pan".
 */

const saas: DatabaseModel = parseDatabaseModel({
  irVersion: 1,
  dialect: 'postgres',
  name: 'saas_fixture',
  tables: [
    {
      schema: 'public',
      name: 'users',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'email', logicalType: 'varchar', maxLength: 255, isUnique: true },
        { name: 'first_name', logicalType: 'varchar', maxLength: 100 },
        { name: 'last_name', logicalType: 'varchar', maxLength: 100 },
        { name: 'password_hash', logicalType: 'varchar', maxLength: 255 },
        { name: 'api_token', logicalType: 'varchar', maxLength: 64 },
        { name: 'avatar_url', logicalType: 'varchar', maxLength: 500 },
        { name: 'phone', logicalType: 'varchar', maxLength: 32 },
        { name: 'ssn', logicalType: 'varchar', maxLength: 11 },
        { name: 'birth_date', logicalType: 'date' },
        { name: 'street_address', logicalType: 'varchar', maxLength: 200 },
        { name: 'last_ip', logicalType: 'inet', dbType: 'inet' },
        { name: 'is_active', logicalType: 'boolean' },
        { name: 'created_at', logicalType: 'timestamptz', default: { kind: 'now' } },
        { name: 'updated_at', logicalType: 'timestamptz', default: { kind: 'now' } },
      ],
      primaryKey: ['id'],
    },
    {
      schema: 'public',
      name: 'projects',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'name', logicalType: 'varchar', maxLength: 200 },
        { name: 'slug', logicalType: 'varchar', maxLength: 80, isUnique: true },
        { name: 'budget', logicalType: 'decimal', numericPrecision: 12, numericScale: 2 },
        { name: 'progress_pct', logicalType: 'integer' },
        { name: 'health_score', logicalType: 'integer' },
        { name: 'color', logicalType: 'varchar', maxLength: 7 },
        {
          name: 'owner_id',
          logicalType: 'integer',
          references: { tableId: 'public.users', column: 'id' },
        },
        {
          name: 'parent_id',
          logicalType: 'integer',
          references: { tableId: 'public.projects', column: 'id' },
        },
        { name: 'start_date', logicalType: 'date' },
        { name: 'end_date', logicalType: 'date' },
        { name: 'metadata', logicalType: 'json', dbType: 'jsonb' },
        { name: 'tags', logicalType: 'text', isArray: true },
      ],
      primaryKey: ['id'],
      checks: [
        { name: null, expression: 'progress_pct >= 0 AND progress_pct <= 100' },
        { name: null, expression: 'health_score >= 0 AND health_score <= 5' },
      ],
    },
    {
      schema: 'public',
      name: 'tasks',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        {
          name: 'project_id',
          logicalType: 'integer',
          references: { tableId: 'public.projects', column: 'id' },
        },
        { name: 'title', logicalType: 'varchar', maxLength: 200 },
        { name: 'description', logicalType: 'text' },
        {
          name: 'status',
          logicalType: 'enum',
          dbType: 'task_status',
          enumRef: 'public.task_status',
        },
        {
          name: 'priority',
          logicalType: 'enum',
          dbType: 'task_priority',
          enumRef: 'public.task_priority',
        },
        {
          name: 'assignee_id',
          logicalType: 'integer',
          references: { tableId: 'public.users', column: 'id' },
        },
        { name: 'due_date', logicalType: 'date' },
        { name: 'estimate_hours', logicalType: 'integer' },
        { name: 'time_spent', logicalType: 'integer' },
        { name: 'created_at', logicalType: 'timestamptz', default: { kind: 'now' } },
      ],
      primaryKey: ['id'],
    },
    {
      schema: 'public',
      name: 'payments',
      columns: [
        { name: 'id', logicalType: 'bigint', isPrimaryKey: true, nullable: false },
        { name: 'amount_cents', logicalType: 'bigint' },
        { name: 'refund_amount', logicalType: 'decimal' },
        { name: 'currency_code', logicalType: 'varchar', maxLength: 3 },
        { name: 'exchange_rate', logicalType: 'decimal' },
        { name: 'account_number', logicalType: 'varchar', maxLength: 34 },
        { name: 'paid_at', logicalType: 'timestamptz' },
        {
          name: 'status',
          logicalType: 'enum',
          dbType: 'payment_status',
          enumRef: 'public.payment_status',
        },
      ],
      primaryKey: ['id'],
    },
    {
      // Adversarial shapes live here.
      schema: 'public',
      name: 'notes',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        // 'status' as free-form varchar with NO enum: must NOT be workflow.
        { name: 'status', logicalType: 'varchar', maxLength: 255 },
        // money-named but a string: must stay non-money.
        { name: 'price_label', logicalType: 'varchar', maxLength: 40 },
        // contains "pan" as substring: must NOT be payment-id PII.
        { name: 'company_name', logicalType: 'varchar', maxLength: 120 },
        // 'name' on a non-people table: not person-name.
        { name: 'name', logicalType: 'varchar', maxLength: 120 },
        { name: 'body', logicalType: 'text' },
        // timestamp-typed but no timestampish name: plain.
        { name: 'reminder', logicalType: 'timestamp' },
      ],
      primaryKey: ['id'],
    },
    {
      schema: 'public',
      name: 'invoices',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        // FK via ACCEPTED INFERRED relation (no declared references).
        { name: 'user_id', logicalType: 'integer' },
        // id-suffixed but resolved by nothing: external-id.
        { name: 'stripe_ref', logicalType: 'varchar', maxLength: 64 },
        { name: 'total', logicalType: 'decimal' },
      ],
      primaryKey: ['id'],
    },
  ],
  enums: [
    {
      id: 'public.task_status',
      name: 'task_status',
      values: ['todo', 'in_progress', 'review', 'done', 'blocked'],
      source: 'native',
    },
    {
      id: 'public.task_priority',
      name: 'task_priority',
      values: ['low', 'medium', 'high', 'urgent'],
      source: 'native',
    },
    {
      id: 'public.payment_status',
      name: 'payment_status',
      values: ['pending', 'paid', 'refunded', 'failed'],
      source: 'native',
    },
  ],
  relations: [
    {
      id: 'inferred:public.invoices(user_id)->public.users(id)',
      kind: 'inferred-name',
      cardinality: 'one-to-many',
      from: { tableId: 'public.invoices', columns: ['user_id'] },
      to: { tableId: 'public.users', columns: ['id'] },
      confidence: 0.85,
    },
  ],
});

function classify(tableName: string): Map<string, ClassifiedColumn> {
  const table = saas.tables.find((t) => t.name === tableName)!;
  return new Map(classifyTableColumns(saas, table).map((c) => [c.column, c]));
}

const users = classify('users');
const projects = classify('projects');
const tasks = classify('tasks');
const payments = classify('payments');
const notes = classify('notes');
const invoices = classify('invoices');

describe('rule pipeline shape', () => {
  it('exposes all 30 §7.1 rule ids in precedence order', () => {
    expect(COLUMN_RULE_IDS).toHaveLength(30);
    expect(COLUMN_RULE_IDS[0]).toBe('r01-secret');
    expect(COLUMN_RULE_IDS[29]).toBe('r30-plain');
  });

  it('emits heuristic source and bounded confidence everywhere', () => {
    for (const map of [users, projects, tasks, payments, notes, invoices]) {
      for (const c of map.values()) {
        expect(c.semantics.source).toBe('heuristic');
        expect(c.semantics.confidence).toBeGreaterThan(0);
        expect(c.semantics.confidence).toBeLessThanOrEqual(1);
        expect(c.reasons.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('r01 secret (hard-excluded)', () => {
  it('flags password_hash and api_token as secret + masked', () => {
    for (const name of ['password_hash', 'api_token']) {
      const c = users.get(name)!;
      expect(c.semantics.primary).toBe('secret');
      expect(c.semantics.flags.secret).toBe(true);
      expect(c.semantics.flags.maskedByDefault).toBe(true);
    }
  });
});

describe('r02 pk-id / r03 fk', () => {
  it('classifies primary keys as pk-id with mono format', () => {
    expect(users.get('id')!.semantics.primary).toBe('pk-id');
    expect(users.get('id')!.semantics.format).toBe('mono');
  });

  it('classifies declared FK columns as fk at confidence 1', () => {
    const c = tasks.get('project_id')!;
    expect(c.semantics.primary).toBe('fk');
    expect(c.semantics.confidence).toBe(1);
  });

  it('treats accepted (≥ 0.8) inferred relations as fk', () => {
    expect(invoices.get('user_id')!.semantics.primary).toBe('fk');
    expect(invoices.get('user_id')!.ruleId).toBe('r03-fk');
  });
});

describe('r04 money', () => {
  it('classifies numeric money-named columns with currency format', () => {
    expect(projects.get('budget')!.semantics.primary).toBe('money');
    expect(projects.get('budget')!.semantics.format).toBe('currency');
    expect(payments.get('refund_amount')!.semantics.primary).toBe('money');
    expect(invoices.get('total')!.semantics.primary).toBe('money');
  });

  it('detects _cents integers and currency sibling columns', () => {
    const c = payments.get('amount_cents')!;
    expect(c.semantics.primary).toBe('money');
    expect(c.semantics.format).toBe('currency-cents');
    expect(c.reasons.join(' ')).toContain('currency_code');
  });

  it('ADVERSARIAL: money-named string column is NOT money', () => {
    const c = notes.get('price_label')!;
    expect(c.semantics.primary).not.toBe('money');
    expect(c.semantics.primary).toBe('plain');
  });
});

describe('r05 percent / r06 score', () => {
  it('uses CHECK bounds to keep percent 0–100 scale', () => {
    const c = projects.get('progress_pct')!;
    expect(c.semantics.primary).toBe('percent');
    expect(c.semantics.format).toBe('percent');
  });

  it('classifies bounded health_score as score', () => {
    expect(projects.get('health_score')!.semantics.primary).toBe('score');
  });

  it('classifies exchange_rate as percent-family (rate vocabulary)', () => {
    expect(payments.get('exchange_rate')!.semantics.primary).toBe('percent');
  });
});

describe('r07 status-workflow vs r08 category-enum (arity + vocabulary)', () => {
  it('workflow vocabulary enum → status-workflow with status-pill', () => {
    const c = tasks.get('status')!;
    expect(c.semantics.primary).toBe('status-workflow');
    expect(c.semantics.format).toBe('status-pill');
  });

  it('payment lifecycle enum → status-workflow', () => {
    expect(payments.get('status')!.semantics.primary).toBe('status-workflow');
  });

  it('non-workflow vocabulary enum → category-enum', () => {
    expect(tasks.get('priority')!.semantics.primary).toBe('category-enum');
  });

  it('ADVERSARIAL: free-text status varchar without enum stays plain', () => {
    const c = notes.get('status')!;
    expect(c.semantics.primary).toBe('plain');
    expect(c.ruleId).toBe('r30-plain');
  });
});

describe('r09–r12 timestamp roles', () => {
  it('created_at / updated_at by canonical name', () => {
    expect(users.get('created_at')!.semantics.primary).toBe('created-at');
    expect(users.get('created_at')!.semantics.format).toBe('relative-time');
    expect(users.get('updated_at')!.semantics.primary).toBe('updated-at');
  });

  it('updated_at with DEFAULT now() is NOT stolen by the created-at fallback', () => {
    expect(users.get('updated_at')!.ruleId).toBe('r10-updated-at');
  });

  it('pairs start_date/end_date as date-range with roles', () => {
    const start = projects.get('start_date')!;
    const end = projects.get('end_date')!;
    expect(start.semantics.primary).toBe('date-range');
    expect(start.semantics.pair).toEqual({ role: 'start', partner: 'end_date' });
    expect(end.semantics.pair).toEqual({ role: 'end', partner: 'start_date' });
  });

  it('unpaired due_date and paid_at fall to event-timestamp', () => {
    expect(tasks.get('due_date')!.semantics.primary).toBe('event-timestamp');
    expect(payments.get('paid_at')!.semantics.primary).toBe('event-timestamp');
  });

  it('timestamp-typed column without timestampish name stays plain', () => {
    expect(notes.get('reminder')!.semantics.primary).toBe('plain');
  });

  it('last_login_at style names classify by suffix', () => {
    expect(users.get('birth_date')!.semantics.primary).toBe('event-timestamp');
  });
});

describe('r13 duration', () => {
  it('detects unit suffixes and duration vocabulary', () => {
    expect(tasks.get('estimate_hours')!.semantics.primary).toBe('duration');
    expect(tasks.get('estimate_hours')!.semantics.format).toBe('duration');
    expect(tasks.get('time_spent')!.semantics.primary).toBe('duration');
  });
});

describe('r16–r18 person identity', () => {
  it('person-name on a people-shaped table', () => {
    expect(users.get('first_name')!.semantics.primary).toBe('person-name');
    expect(users.get('first_name')!.semantics.flags.pii).toBe('person-name');
    expect(users.get('first_name')!.semantics.flags.maskedByDefault).toBe(true);
  });

  it('ADVERSARIAL: bare "name" on a non-people table is not person-name', () => {
    expect(notes.get('name')!.semantics.primary).not.toBe('person-name');
    expect(notes.get('name')!.semantics.flags.pii).toBeNull();
  });

  it('email is mono + PII-masked', () => {
    const c = users.get('email')!;
    expect(c.semantics.primary).toBe('email');
    expect(c.semantics.format).toBe('mono');
    expect(c.semantics.flags.pii).toBe('email');
    expect(c.semantics.flags.maskedByDefault).toBe(true);
  });

  it('phone is tel + PII-masked', () => {
    const c = users.get('phone')!;
    expect(c.semantics.primary).toBe('phone');
    expect(c.semantics.flags.pii).toBe('phone');
  });
});

describe('r19–r27 media, urls, flags, misc', () => {
  it('avatar_url → image-url', () => {
    expect(users.get('avatar_url')!.semantics.primary).toBe('image-url');
  });

  it('is_active boolean → boolean-flag', () => {
    expect(users.get('is_active')!.semantics.primary).toBe('boolean-flag');
  });

  it('color varchar(7) → color with swatch format', () => {
    expect(projects.get('color')!.semantics.primary).toBe('color');
    expect(projects.get('color')!.semantics.format).toBe('color-swatch');
  });

  it('tags array → tags', () => {
    expect(projects.get('tags')!.semantics.primary).toBe('tags');
  });

  it('unique slug → slug at boosted confidence', () => {
    const c = projects.get('slug')!;
    expect(c.semantics.primary).toBe('slug');
    expect(c.semantics.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('inet column → ip-address with ip PII', () => {
    const c = users.get('last_ip')!;
    expect(c.semantics.primary).toBe('ip-address');
    expect(c.semantics.flags.pii).toBe('ip');
  });

  it('jsonb → json-config', () => {
    expect(projects.get('metadata')!.semantics.primary).toBe('json-config');
  });

  it('unresolved stripe_ref → external-id (mono)', () => {
    const c = invoices.get('stripe_ref')!;
    expect(c.semantics.primary).toBe('external-id');
    expect(c.semantics.format).toBe('mono');
  });

  it('long text → free-text', () => {
    expect(tasks.get('description')!.semantics.primary).toBe('free-text');
    expect(notes.get('body')!.semantics.primary).toBe('free-text');
  });
});

describe('§7.2 PII layer (independent of primary)', () => {
  it('ssn → gov-id, fully masked', () => {
    expect(users.get('ssn')!.semantics.flags.pii).toBe('gov-id');
    expect(users.get('ssn')!.semantics.flags.maskedByDefault).toBe(true);
  });

  it('account_number → payment-id even though primary is external-id', () => {
    const c = payments.get('account_number')!;
    expect(c.semantics.primary).toBe('external-id');
    expect(c.semantics.flags.pii).toBe('payment-id');
  });

  it('birth_date → dob PII on top of event-timestamp primary', () => {
    expect(users.get('birth_date')!.semantics.flags.pii).toBe('dob');
  });

  it('street_address → address PII', () => {
    expect(users.get('street_address')!.semantics.flags.pii).toBe('address');
  });

  it('ADVERSARIAL: company_name is NOT payment-id despite containing "pan"', () => {
    expect(notes.get('company_name')!.semantics.flags.pii).toBeNull();
    expect(notes.get('company_name')!.semantics.flags.maskedByDefault).toBe(false);
  });

  it('ADVERSARIAL: avatar_url is NOT gov-id despite containing "vat"', () => {
    expect(users.get('avatar_url')!.semantics.flags.pii).not.toBe('gov-id');
    expect(users.get('avatar_url')!.semantics.flags.maskedByDefault).toBe(false);
  });

  it('gov-id triggers match on token boundaries only', () => {
    // The names that must still be caught, and the ordinary words that must
    // not. `vat` inside avatar/private/reservation/activation was flagging
    // every avatar column in every generated app as a government ID.
    const detect = (name: string) => {
      const model = parseDatabaseModel({
        irVersion: 1,
        dialect: 'postgres',
        name: 'probe',
        tables: [
          {
            schema: 'public',
            name: 'people',
            columns: [
              { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
              { name, logicalType: 'varchar', maxLength: 64 },
            ],
            primaryKey: ['id'],
          },
        ],
      });
      const classified = classifyTableColumns(model, model.tables[0]!);
      return classified.find((c: ClassifiedColumn) => c.column === name)!.semantics.flags.pii;
    };

    for (const name of ['ssn', 'customer_ssn', 'tax_id', 'vat', 'vat_number', 'passport_number', 'national_id', 'driver_license']) {
      expect(detect(name), name).toBe('gov-id');
    }
    for (const name of ['avatar_url', 'private_notes', 'reservation_date', 'activation_code', 'observation', 'conservation_status']) {
      expect(detect(name), name).not.toBe('gov-id');
    }
  });
});
