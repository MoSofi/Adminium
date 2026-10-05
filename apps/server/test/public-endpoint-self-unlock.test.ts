// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An endpoint whose row opens only with its own code (`unlock_by.self`): the
 * stored text keeps `self` and `length`, and the endpoint names its own table
 * and key — there is no link to follow.
 */
import { applyClassification, parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import type { SchemaOverride } from '@adminium/meta';
import { describe, expect, it } from 'vitest';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { definitionToResource, endpointIssues, parseDefinition, printDefinition, sourceTable, type PublicEndpointDefinition } from '../src/public-api/endpoint.js';

const col = (name: string, extra: Record<string, unknown> = {}) => ({ name, logicalType: 'text', ...extra });
const key = col('id', { logicalType: 'integer', nullable: false, isPrimaryKey: true, default: { kind: 'autoincrement' } });
const table = (name: string, columns: ReturnType<typeof col>[]) => ({ schema: 'public', name, primaryKey: ['id'], columns: [key, ...columns] });

const override = (op: string, tableName: string, value: Record<string, unknown>, columnName: string | null = null): SchemaOverride => ({
  id: `ovr_${tableName}_${op}`,
  connectionId: 'cnx_test',
  op: op as SchemaOverride['op'],
  tableName,
  columnName,
  value,
  origin: 'app',
  llmRunId: null,
  status: 'active',
  createdBy: null,
  createdAt: 0,
  updatedAt: 0,
});

const model = applyClassification(
  parseDatabaseModel({
    dialect: 'postgres',
    name: 'shop',
    defaultSchema: 'public',
    schemas: ['public'],
    tables: [
      { ...table('cards', [col('code'), col('label'), col('status'), col('balance', { logicalType: 'decimal' })]), uniques: [{ name: 'cards_code_key', columns: ['code'] }] },
      { ...table('vouchers', [col('code'), col('card_id', { logicalType: 'integer' })]), uniques: [{ name: 'vouchers_code_key', columns: ['code'] }] },
    ],
    relations: [
      { id: 'fk:vouchers-card_id', kind: 'declared-fk', cardinality: 'one-to-many', from: { tableId: 'public.vouchers', columns: ['card_id'] }, to: { tableId: 'public.cards', columns: ['id'] }, onDelete: 'no-action' },
    ],
  }),
) as DatabaseModel;

const view = new SnapshotView(
  'cnx_test',
  applyOverrides(model, [
    override('column.normalize', 'public.cards', { normalize: 'code' }, 'code'),
    override('column.normalize', 'public.vouchers', { normalize: 'code' }, 'code'),
  ]),
);

function def(over: Partial<PublicEndpointDefinition> = {}): PublicEndpointDefinition {
  return {
    path: '/cards_unlocked',
    source: 'public.cards',
    methods: ['GET'],
    select: ['id', 'balance', 'status'],
    filters: [],
    pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
    auth: { role: 'anon' },
    rate_limit: { requests: 60, window: '1m' },
    response: { shape: 'object', envelope: 'data' },
    unlock_by: { table: 'public.cards', column: 'code', link: 'id', self: true, length: 12, where: [{ column: 'status', eq: 'active' }] },
    ...over,
  };
}
const issues = (d: PublicEndpointDefinition) => endpointIssues(d, { ref: d.path.slice(1), view }).map((i) => i.code);

describe('the stored text', () => {
  it('ordered keeps self and length', () => {
    const text = printDefinition(def());
    expect(JSON.parse(text)).toMatchObject({ unlock_by: { table: 'public.cards', column: 'code', link: 'id', self: true, length: 12 } });
    const parsed = parseDefinition(text);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.definition.unlock_by).toMatchObject({ self: true, length: 12 });
    expect(printDefinition(parsed.definition)).toBe(text);
  });

  it('a linking unlock prints neither', () => {
    const linking = def({ path: '/cards_by_voucher', unlock_by: { table: 'public.vouchers', column: 'code', link: 'card_id' } });
    expect(Object.keys(JSON.parse(printDefinition(linking)).unlock_by as object)).toEqual(['table', 'column', 'link']);
  });

  it('the compiled resource carries both, for the read that judges the code', () => {
    const resource = definitionToResource('cards_unlocked', def(), ['GET'], sourceTable(view, 'public.cards'));
    expect(resource.unlockBy).toMatchObject({ table: 'public.cards', column: 'code', link: 'id', self: true, length: 12 });
  });
});

describe('a row opened by its own code', () => {
  it('names its own table and its key, and only reads', () => {
    expect(issues(def())).toEqual([]);
    expect(issues(def({ methods: ['GET', 'PATCH'] }))).toContain('ENDPOINT_UNLOCK_READ_ONLY');
    // Another table's code is a linking unlock; `self` of it is refused.
    expect(issues(def({ unlock_by: { table: 'public.vouchers', column: 'code', link: 'id', self: true } }))).toEqual(['ENDPOINT_UNLOCK_UNKNOWN_COLUMN']);
    expect(issues(def({ unlock_by: { table: 'public.cards', column: 'code', link: 'label', self: true } }))).toEqual(['ENDPOINT_UNLOCK_UNKNOWN_COLUMN']);
  });

  it('is found by a code: one row per code, compared as one', () => {
    expect(issues(def({ unlock_by: { table: 'public.cards', column: 'label', link: 'id', self: true } }))).toEqual(['ENDPOINT_UNLOCK_NOT_A_CODE', 'ENDPOINT_UNLOCK_NOT_A_CODE']);
  });

  it('a length is said only of such a row', () => {
    expect(issues(def({ path: '/cards_by_voucher', unlock_by: { table: 'public.vouchers', column: 'code', link: 'card_id', length: 12 } }))).toEqual(['ENDPOINT_UNLOCK_UNKNOWN_COLUMN']);
    expect(parseDefinition({ ...def(), unlock_by: { table: 'public.cards', column: 'code', link: 'id', self: true, length: 3 } }).ok).toBe(false);
  });
});
