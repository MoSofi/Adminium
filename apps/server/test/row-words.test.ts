// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whose a row is, as the server stores it (plan 67, A1): what a manifest's
 * staff column, `belongs`, `private` and a role's `rows` become at install,
 * what the effective model carries of them, what is refused against the live
 * tables, and what follows a renamed column.
 */
import { applyClassification, parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import type { SchemaOverride } from '@adminium/meta';
import { describe, expect, it } from 'vitest';

import { opsForRules, realRuleRefs, tableOpsFor } from '../src/apps/manifest-rules.js';
import { storedRowLimit } from '../src/apps/manifest-roles.js';
import { belongsRuleIssue, columnRuleIssue } from '../src/connections/column-rules-validation.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { MANIFEST_WORDS_RUN, UNBUILT_MANIFEST_WORDS, unbuiltInManifest } from '../src/crud/unbuilt-rules.js';
import { renamedInRule } from '../src/schema-ddl/rename-repair.js';

const table = (name: string, columns: string[]) => ({
  schema: 'public',
  name,
  primaryKey: ['id'],
  columns: columns.map((column) => ({
    name: column,
    logicalType: column === 'id' || (column.endsWith('_id') && !['owner_id', 'user_id', 'cover_id'].includes(column)) ? 'integer' : column.endsWith('_on') ? 'date' : 'text',
    nullable: column !== 'id',
    ...(column === 'id' ? { isPrimaryKey: true, default: { kind: 'autoincrement' } } : {}),
  })),
});
const link = (from: string, column: string, to: string) => ({
  id: `public.${from}.${column}->public.${to}.id`,
  kind: 'declared-fk',
  cardinality: 'one-to-many',
  through: null,
  from: { tableId: `public.${from}`, columns: [column] },
  to: { tableId: `public.${to}`, columns: ['id'] },
});
const MODEL = applyClassification(
  parseDatabaseModel({
    dialect: 'postgres',
    name: 'crm',
    defaultSchema: 'public',
    schemas: ['public'],
    tables: [
      table('crm_deals', ['id', 'owner_id', 'state']),
      table('crm_covers', ['id', 'owner_id', 'cover_id', 'starts_on', 'ends_on']),
      table('crm_quotes', ['id', 'deal_id']),
      table('crm_agents', ['id', 'user_id']),
      table('crm_tickets', ['id', 'assignee_id']),
    ],
    relations: [link('crm_quotes', 'deal_id', 'crm_deals'), link('crm_tickets', 'assignee_id', 'crm_agents')],
  }),
) as DatabaseModel;
const deals = MODEL.tables.find((one) => one.name === 'crm_deals')!;
const tickets = MODEL.tables.find((one) => one.name === 'crm_tickets')!;
const quotes = MODEL.tables.find((one) => one.name === 'crm_quotes')!;

let n = 0;
const row = (op: string, tableName: string, columnName: string | null, value: Record<string, unknown>, origin: SchemaOverride['origin'] = 'app'): SchemaOverride =>
  ({ id: `ovr_${String(++n)}`, connectionId: 'conn_1', op, tableName, columnName, value, origin, llmRunId: null, status: 'active', createdAt: n, updatedAt: n, createdBy: null }) as unknown as SchemaOverride;

describe('what an install writes', () => {
  it('a staff column is a rule of its column', () => {
    expect(opsForRules('crm', { staff: true })).toEqual([{ op: 'column.staff', value: { staff: true } }]);
    expect(opsForRules('crm', {})).toEqual([]);
  });

  it('the ways people belong are one rule of the table, with a listing\'s table made real; private is another', () => {
    const ways = [{ column: 'owner_id', set: 'team' }, { through: { table: 'covers', link: 'owner_id', on: 'owner_id', user: 'cover_id', from: 'starts_on', to: 'ends_on' } }];
    const ops = tableOpsFor({ belongs: ways, private: true });
    expect(ops).toEqual([
      { op: 'table.belongs', value: { ways } },
      { op: 'table.private', value: { private: true } },
    ]);
    // The manifest's own object is never the one stored.
    expect((ops[0]!.value['ways'] as unknown[])[1]).not.toBe(ways[1]);
    const real = realRuleRefs('table.belongs', ops[0]!.value, (ref) => `public.crm_${ref}`);
    expect(real.missing).toEqual([]);
    expect((real.value['ways'] as { through?: { table: string } }[])[1]!.through!.table).toBe('public.crm_covers');
    // A column called like a table is left alone: only a listing's `table` names one.
    expect((real.value['ways'] as { column?: string }[])[0]!.column).toBe('owner_id');
    expect(tableOpsFor({})).toEqual([]);
  });

  it('a role\'s rows are kept action by action, as the manifest says them', () => {
    expect(storedRowLimit({ read: { reach: 'team', unowned: true }, update: { reach: 'own', while: { column: 'state', in: ['open'] } } })).toEqual({
      read: { reach: 'team', unowned: true },
      update: { reach: 'own', while: { column: 'state', in: ['open'] } },
    });
    expect(storedRowLimit({ delete: { reach: 'own' } })).toEqual({ delete: { reach: 'own' } });
  });
});

describe('what the model carries', () => {
  const ways = [{ column: 'owner_id' }, { through: { table: 'public.crm_covers', link: 'owner_id', on: 'owner_id', user: 'cover_id' } }];

  it('a staff column, a table\'s ways and its privacy', () => {
    const model = applyOverrides(MODEL, [
      row('column.staff', 'public.crm_deals', 'owner_id', { staff: true }),
      row('table.belongs', 'public.crm_deals', null, { ways }),
      row('table.private', 'public.crm_deals', null, { private: true }),
    ]);
    const found = model.tables.find((one) => one.name === 'crm_deals')!;
    expect(found.columns.find((column) => column.name === 'owner_id')!.staff).toBe(true);
    expect(found.columns.find((column) => column.name === 'state')!.staff).toBeUndefined();
    expect(found.belongs).toEqual(ways);
    expect(found.private).toBe(true);
    const other = model.tables.find((one) => one.name === 'crm_quotes')!;
    expect(other.belongs).toBeUndefined();
    expect(other.private).toBeUndefined();
  });

  it('an app\'s ways stand over an owner\'s, whichever was written first; a row switched off says nothing', () => {
    const owner = row('table.belongs', 'public.crm_deals', null, { ways: [{ column: 'state' }] }, 'user');
    const app = row('table.belongs', 'public.crm_deals', null, { ways });
    for (const rows of [[owner, app], [app, owner]]) {
      expect(applyOverrides(MODEL, rows).tables.find((one) => one.name === 'crm_deals')!.belongs).toEqual(ways);
    }
    expect(applyOverrides(MODEL, [{ ...app, status: 'disabled' }]).tables.find((one) => one.name === 'crm_deals')!.belongs).toBeUndefined();
  });
});

describe('what is refused against the live tables', () => {
  it('a staff member in a column that is not text, or is the key', () => {
    const column = (name: string) => deals.columns.find((one) => one.name === name)!;
    expect(columnRuleIssue('column.staff', { staff: true }, column('owner_id'), MODEL)).toBeNull();
    expect(columnRuleIssue('column.staff', { staff: true }, column('id'), MODEL)).toBe('"id" cannot hold a staff member.');
    expect(columnRuleIssue('column.staff', { staff: true }, tickets.columns.find((one) => one.name === 'assignee_id')!, MODEL)).toBe('A staff member is kept in text; "assignee_id" is integer.');
  });

  it('a way that names a column, a listing or a link the database has not', () => {
    const issue = (ways: unknown[], of = deals) => belongsRuleIssue({ ways }, of, MODEL);
    expect(issue([{ column: 'owner_id' }, { through: { table: 'public.crm_covers', link: 'owner_id', on: 'owner_id', user: 'cover_id', from: 'starts_on', to: 'ends_on' } }])).toBeNull();
    expect(issue([{ column: 'assignee_id', person: 'user_id' }], tickets)).toBeNull();
    expect(issue([{ via: 'deal_id' }], quotes)).toBeNull();
    expect(issue([{ column: 'boss' }])).toBe('"boss" is not a column of crm_deals.');
    expect(issue([{ column: 'owner_id', person: 'user_id' }])).toBe('"owner_id" of crm_deals links to no table, so there is no row to read a person from.');
    expect(issue([{ column: 'assignee_id', person: 'login' }], tickets)).toBe('"login" is not a column of crm_agents.');
    expect(issue([{ via: 'state' }])).toBe('"state" of crm_deals links to no table.');
    expect(issue([{ via: 'parent_id' }])).toBe('"parent_id" is not a column of crm_deals.');
    expect(issue([{ through: { table: 'public.crm_helpers', link: 'deal_id', user: 'user_id' } }])).toBe('The table "public.crm_helpers" is not in this database.');
    expect(issue([{ through: { table: 'public.crm_covers', link: 'deal', user: 'cover_id' } }])).toBe('"deal" is not a column of crm_covers.');
    expect(issue([{ through: { table: 'public.crm_covers', link: 'owner_id', on: 'owner', user: 'cover_id' } }])).toBe('"owner" is not a column of crm_deals.');
    expect(issue([{ through: { table: 'public.crm_covers', link: 'owner_id', on: 'owner_id', user: 'cover_id', to: 'until' } }])).toBe('"until" is not a column of crm_covers.');
    expect(belongsRuleIssue({ ways: [] }, deals, MODEL)).toBe('Whose a row of crm_deals is, is not spelled as Adminium stores it.');
    expect(belongsRuleIssue(null, deals, MODEL)).toBe('Whose a row of crm_deals is, is not spelled as Adminium stores it.');
  });
});

describe('a renamed column', () => {
  it('is followed where a way reads it of the table\'s own row', () => {
    const value = { ways: [{ column: 'owner_id', set: 'team' }, { via: 'deal_id' }, { through: { table: 'public.crm_covers', link: 'owner_id', on: 'owner_id', user: 'cover_id' } }] };
    expect(renamedInRule('table.belongs', value, 'owner_id', 'rep_id')).toEqual({
      ways: [{ column: 'rep_id', set: 'team' }, { via: 'deal_id' }, { through: { table: 'public.crm_covers', link: 'owner_id', on: 'rep_id', user: 'cover_id' } }],
    });
    expect(renamedInRule('table.belongs', value, 'deal_id', 'opportunity_id')).toMatchObject({ ways: [{ column: 'owner_id' }, { via: 'opportunity_id' }, {}] });
    // Nothing of this table's row is called that: the same object comes back.
    expect(renamedInRule('table.belongs', value, 'cover_id', 'stand_in')).toBe(value);
  });
});

describe('the four words', () => {
  it('a staff column is run; the ways, a role\'s rows and a private table are read and refused until 0.3.27', () => {
    expect(MANIFEST_WORDS_RUN).toContain('column.staff');
    expect(UNBUILT_MANIFEST_WORDS).toEqual({ 'table.belongs': '0.3.27', 'roles.rows': '0.3.27', 'table.private': '0.3.27' });
    const app = {
      kind: 'app',
      requiredSchema: { tables: [{ ref: 'deals', columns: [{ ref: 'owner_id', type: 'text', rules: { staff: true } }], belongs: [{ column: 'owner_id' }], private: true }] },
      roles: [{ key: 'rep', limits: { deals: { rows: { read: { reach: 'own' } } } } }],
    };
    expect(unbuiltInManifest(app)).toEqual([
      { word: 'table.belongs', path: 'requiredSchema.tables.0.belongs', release: '0.3.27' },
      { word: 'table.private', path: 'requiredSchema.tables.0.private', release: '0.3.27' },
      { word: 'roles.rows', path: 'roles.0.limits.deals.rows', release: '0.3.27' },
    ]);
    expect(unbuiltInManifest({ kind: 'app', requiredSchema: { tables: [{ ref: 'deals', columns: [{ ref: 'owner_id', type: 'text', rules: { staff: true } }] }] } })).toEqual([]);
  });
});
