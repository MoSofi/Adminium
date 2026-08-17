// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  classifyModel,
  classifyTable,
  detectJoinTable,
  classifyTableColumns,
  parseDatabaseModel,
  type DatabaseModel,
} from '../src/index.js';

/**
 * Table-shape classification (05-introspection-engine.md §8 + the §6
 * structural detectors): join-table M2M shape, log/settings/people/workflow
 * shapes, self-FK hierarchy, polymorphic pairs, line-items/messages roles,
 * and display-column / natural-key selection.
 */

const model: DatabaseModel = parseDatabaseModel({
  irVersion: 1,
  dialect: 'postgres',
  name: 'shapes_fixture',
  tables: [
    {
      schema: 'public',
      name: 'users',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'full_name', logicalType: 'varchar', maxLength: 120 },
        { name: 'email', logicalType: 'varchar', maxLength: 255, isUnique: true },
        { name: 'avatar_url', logicalType: 'varchar', maxLength: 500 },
        {
          name: 'manager_id',
          logicalType: 'integer',
          references: { tableId: 'public.users', column: 'id' },
        },
      ],
      primaryKey: ['id'],
      uniques: [{ name: 'users_email_key', columns: ['email'] }],
    },
    {
      schema: 'public',
      name: 'tasks',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'title', logicalType: 'varchar', maxLength: 200 },
        {
          name: 'status',
          logicalType: 'enum',
          dbType: 'task_status',
          enumRef: 'public.task_status',
        },
        {
          name: 'assignee_id',
          logicalType: 'integer',
          references: { tableId: 'public.users', column: 'id' },
        },
      ],
      primaryKey: ['id'],
    },
    {
      schema: 'public',
      name: 'tags',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'name', logicalType: 'varchar', maxLength: 60, isUnique: true },
      ],
      primaryKey: ['id'],
    },
    {
      schema: 'public',
      name: 'task_tags',
      columns: [
        {
          name: 'task_id',
          logicalType: 'integer',
          nullable: false,
          isPrimaryKey: true,
          references: { tableId: 'public.tasks', column: 'id' },
        },
        {
          name: 'tag_id',
          logicalType: 'integer',
          nullable: false,
          isPrimaryKey: true,
          references: { tableId: 'public.tags', column: 'id' },
        },
      ],
      primaryKey: ['task_id', 'tag_id'],
    },
    {
      // Join-table candidate that must FAIL: extra data columns.
      schema: 'public',
      name: 'order_items',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        {
          name: 'order_id',
          logicalType: 'integer',
          references: { tableId: 'public.orders', column: 'id' },
        },
        {
          name: 'product_id',
          logicalType: 'integer',
          references: { tableId: 'public.products', column: 'id' },
        },
        { name: 'quantity', logicalType: 'integer' },
        { name: 'unit_price', logicalType: 'decimal' },
        { name: 'discount_pct', logicalType: 'decimal' },
      ],
      primaryKey: ['id'],
    },
    {
      schema: 'public',
      name: 'orders',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'reference', logicalType: 'varchar', maxLength: 40 },
      ],
      primaryKey: ['id'],
    },
    {
      schema: 'public',
      name: 'products',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'product_name', logicalType: 'varchar', maxLength: 120 },
        { name: 'price', logicalType: 'decimal' },
        { name: 'image_url', logicalType: 'varchar', maxLength: 500 },
      ],
      primaryKey: ['id'],
    },
    {
      schema: 'public',
      name: 'audit_log',
      columns: [
        { name: 'id', logicalType: 'bigint', isPrimaryKey: true, nullable: false },
        {
          name: 'actor_id',
          logicalType: 'integer',
          references: { tableId: 'public.users', column: 'id' },
        },
        { name: 'action', logicalType: 'varchar', maxLength: 60 },
        { name: 'detail', logicalType: 'text' },
        { name: 'created_at', logicalType: 'timestamptz', default: { kind: 'now' } },
      ],
      primaryKey: ['id'],
    },
    {
      schema: 'public',
      name: 'workspace_settings',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'key', logicalType: 'varchar', maxLength: 100 },
        { name: 'value', logicalType: 'json' },
      ],
      primaryKey: ['id'],
    },
    {
      schema: 'public',
      name: 'comments',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        {
          name: 'author_id',
          logicalType: 'integer',
          references: { tableId: 'public.users', column: 'id' },
        },
        { name: 'body', logicalType: 'text' },
        { name: 'commentable_type', logicalType: 'varchar', maxLength: 40 },
        { name: 'commentable_id', logicalType: 'integer' },
        { name: 'created_at', logicalType: 'timestamptz', default: { kind: 'now' } },
      ],
      primaryKey: ['id'],
    },
    {
      schema: 'public',
      name: 'venues',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'lat', logicalType: 'float' },
        { name: 'lng', logicalType: 'float' },
      ],
      primaryKey: ['id'],
    },
    {
      schema: 'public',
      name: 'schema_migrations',
      columns: [{ name: 'version', logicalType: 'varchar', maxLength: 64, nullable: false }],
    },
  ],
  enums: [
    {
      id: 'public.task_status',
      name: 'task_status',
      values: ['todo', 'in_progress', 'done'],
      source: 'native',
    },
  ],
});

const classified = new Map(classifyModel(model).tables.map((t) => [t.tableId, t]));

describe('join-table detection (§6 rule 2)', () => {
  it('detects task_tags as a join table at ≥ 0.8', () => {
    const t = classified.get('public.task_tags')!;
    expect(t.shape.kind).toBe('join');
    expect(t.semantics.role).toBe('join-table');
  });

  it('composite PK over the FK pair and composed name both boost confidence', () => {
    const table = model.tables.find((t) => t.name === 'task_tags')!;
    const result = detectJoinTable(table, classifyTableColumns(model, table));
    expect(result.isJoin).toBe(true);
    expect(result.confidence).toBeCloseTo(0.9, 5);
    expect(result.fkColumns.sort()).toEqual(['tag_id', 'task_id']);
  });

  it('does NOT classify order_items (extra data columns) as a join table', () => {
    const table = model.tables.find((t) => t.name === 'order_items')!;
    expect(detectJoinTable(table, classifyTableColumns(model, table)).isJoin).toBe(false);
    expect(classified.get('public.order_items')!.shape.kind).not.toBe('join');
  });
});

describe('shape kinds (§8 trigger table)', () => {
  it('users → people (directory trigger)', () => {
    expect(classified.get('public.users')!.shape.kind).toBe('people');
    expect(classified.get('public.users')!.semantics.role).toBe('people');
  });

  it('tasks → workflow (status-workflow enum → kanban trigger)', () => {
    expect(classified.get('public.tasks')!.shape.kind).toBe('workflow');
  });

  it('audit_log → log by name', () => {
    const t = classified.get('public.audit_log')!;
    expect(t.shape.kind).toBe('log');
    expect(t.semantics.role).toBe('log');
  });

  it('workspace_settings → settings by name', () => {
    expect(classified.get('public.workspace_settings')!.shape.kind).toBe('settings');
  });

  it('products → catalog (display column + money + image)', () => {
    expect(classified.get('public.products')!.shape.kind).toBe('catalog');
  });

  it('venues → geo (lat/lng pair dominates data columns)', () => {
    expect(classified.get('public.venues')!.shape.kind).toBe('geo');
  });

  it('schema_migrations → system role, hidden by default', () => {
    expect(classified.get('public.schema_migrations')!.semantics.role).toBe('system');
  });

  it('orders → generic fallback with a reason', () => {
    const t = classified.get('public.orders')!;
    expect(t.shape.kind).toBe('generic');
    expect(t.shape.reasons.length).toBeGreaterThan(0);
  });
});

describe('roles beyond shape (§8)', () => {
  it('order_items → line-items role (2 FKs + qty × rate)', () => {
    expect(classified.get('public.order_items')!.semantics.role).toBe('line-items');
  });

  it('comments → messages role (author FK + body + created-at)', () => {
    expect(classified.get('public.comments')!.semantics.role).toBe('messages');
  });
});

describe('hierarchy + polymorphic flags (§6 rules 3–4)', () => {
  it('users.manager_id self-FK → hierarchy', () => {
    expect(classified.get('public.users')!.semantics.hierarchy).toEqual({
      parentColumn: 'manager_id',
    });
  });

  it('commentable_type/commentable_id → polymorphic flag, no fabricated relation', () => {
    const t = classified.get('public.comments')!;
    expect(t.semantics.polymorphic).toEqual([
      { typeColumn: 'commentable_type', idColumn: 'commentable_id', targets: [] },
    ]);
    expect(model.relations).toHaveLength(0);
  });
});

describe('display column + natural key selection', () => {
  it('prefers exact title/name columns', () => {
    expect(classified.get('public.tasks')!.displayColumn).toBe('title');
    expect(classified.get('public.tags')!.displayColumn).toBe('name');
  });

  it('falls back to _name-suffixed, then first text-ish column', () => {
    expect(classified.get('public.products')!.displayColumn).toBe('product_name');
    expect(classified.get('public.orders')!.displayColumn).toBe('reference');
  });

  it('people tables use the person name', () => {
    expect(classified.get('public.users')!.displayColumn).toBe('full_name');
  });

  it('join/numeric-only tables have no display column', () => {
    expect(classified.get('public.task_tags')!.displayColumn).toBeNull();
    expect(classified.get('public.venues')!.displayColumn).toBeNull();
  });

  it('natural key = first unique text-ish column', () => {
    expect(classified.get('public.users')!.naturalKey).toBe('email');
    expect(classified.get('public.tags')!.naturalKey).toBe('name');
    expect(classified.get('public.orders')!.naturalKey).toBeNull();
  });
});

describe('classifyTable is pure and deterministic', () => {
  it('same inputs → deep-equal output', () => {
    const table = model.tables.find((t) => t.name === 'users')!;
    expect(classifyTable(model, table)).toEqual(classifyTable(model, table));
  });
});
