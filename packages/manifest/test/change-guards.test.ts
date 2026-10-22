// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A write the person a column names may not make: a reach's `notBy` (a
 * manager's own target), a column's `changes` (an approval made only from
 * asked, never by its asker nor the deal's owner; an enquiry's deal set only
 * while it is claimed, by its claimer), and a rule's placeholder that would
 * carry a code staff never see. One valid manifest, then each test breaks one
 * thing and reads the sentence that names it.
 */
import { describe, expect, it } from 'vitest';

import { WORD_FLOORS, installFloorWords, validateManifest } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const staff = (ref: string, nullable = true) => ({ ref, type: 'text', maxLength: 36, nullable, rules: { staff: true } });
const fk = (ref: string, references: string, nullable = false) => ({ ref, type: 'fk', references, nullable });

type Doc = Record<string, unknown>;

const approvalGuard = { to: ['approved', 'refused'], from: ['asked'], notBy: ['asked_by_id', 'deal_id.owner_id'] };
const dealGuard = { while: { column: 'state', in: ['claimed'] }, by: 'claimed_by_id' };

function tables(over: { approval?: unknown; deal?: unknown } = {}): Doc[] {
  return [
    { ref: 'deals', columns: [id, staff('owner_id'), { ref: 'name', type: 'text', maxLength: 80 }], belongs: [{ column: 'owner_id', set: 'team' }] },
    {
      ref: 'quotes',
      columns: [
        id,
        fk('deal_id', 'deals'),
        { ref: 'approval', type: 'enum', enum: ['none', 'asked', 'approved', 'refused'], rules: { changes: over.approval ?? [approvalGuard] } },
        { ...staff('asked_by_id'), rules: { staff: true, stamp: { set: 'user-id', on: { column: 'approval', values: ['asked'] } } } },
        { ref: 'share_code', type: 'text', maxLength: 16, nullable: true, rules: { code: { length: 16, hiddenFromStaff: true } } },
        { ref: 'total', type: 'decimal', nullable: true, rules: { secret: true } },
      ],
      belongs: [{ via: 'deal_id' }],
    },
    {
      ref: 'enquiries',
      columns: [
        id,
        { ref: 'state', type: 'enum', enum: ['open', 'claimed', 'dropped'] },
        staff('claimed_by_id'),
        { ...fk('deal_id', 'deals', true), rules: { changes: over.deal ?? [dealGuard] } },
      ],
      belongs: [{ column: 'claimed_by_id' }],
    },
    { ref: 'targets', columns: [id, staff('rep_id', false), { ref: 'amount', type: 'decimal' }], belongs: [{ column: 'rep_id', set: 'team' }] },
    { ref: 'starters', columns: [id, staff('manager_id'), staff('user_id'), { ref: 'first_year_target', type: 'decimal', nullable: true }], belongs: [{ column: 'manager_id' }] },
    { ref: 'starter_goals', columns: [id, fk('starter_id', 'starters'), { ref: 'amount', type: 'decimal' }], belongs: [{ via: 'starter_id' }] },
  ];
}

const managerOf = (rows: Record<string, unknown> = {}) => ({
  key: 'manager',
  name: 'Sales manager',
  permissions: ['table:@targets:read', 'table:@targets:update', 'table:@starters:read', 'table:@starters:update', 'table:@starter_goals:read', 'table:@starter_goals:update'],
  limits: {
    targets: { rows: { read: { reach: 'team' }, update: { reach: 'team', notBy: 'rep_id' } } },
    starters: { rows: { update: { reach: 'all', notBy: 'user_id' } } },
    starter_goals: { rows: { update: [{ reach: 'own', notBy: 'starter_id.user_id' }] } },
    ...rows,
  },
});

function manifest(over: { tables?: Doc[]; roles?: unknown[]; floor?: string; automations?: unknown[]; templates?: unknown[] } = {}): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'Sales',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'Sales.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: over.floor ?? '0.3.33' },
    requiredSchema: { tables: over.tables ?? tables() },
    pages: [{ ref: 'crm-deals', template: 'page-crud', title: { key: 't', fallback: 'Deals' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    roles: over.roles ?? [managerOf()],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
    ...(over.automations === undefined ? {} : { automations: over.automations }),
    ...(over.templates === undefined ? {} : { emailTemplates: over.templates }),
  };
}

const messages = (document: Doc): string[] => {
  const result = validateManifest(document);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

describe('a reach that leaves out the person a column names (notBy)', () => {
  it('validates on an update reach: a column of the row, a reach of every row, one through a link', () => {
    expect(messages(manifest())).toEqual([]);
  });

  it('is a word of 0.3.33, found where it is written', () => {
    expect(installFloorWords(manifest())).toContainEqual({ word: 'rows.notBy', path: 'roles.0.limits.targets.rows.update' });
    expect(installFloorWords(manifest())).toContainEqual({ word: 'rows.notBy', path: 'roles.0.limits.starter_goals.rows.update' });
    expect(WORD_FLOORS['rows.notBy']).toBe('0.3.33');
    expect(messages(manifest({ floor: '0.3.32' })).some((message) => message.includes('0.3.33'))).toBe(true);
  });

  it('names a staff column of the row, or of the row a link names', () => {
    const at = (notBy: string) => messages(manifest({ roles: [managerOf({ targets: { rows: { update: { reach: 'team', notBy } } } })] }));
    expect(at('boss')).toContain('roles.0.limits.targets.rows.update.notBy: "targets" has no column "boss": `notBy` names the person who may not change the row');
    expect(at('amount')).toContain('roles.0.limits.targets.rows.update.notBy: "targets.amount" does not hold a staff member (rules.staff): `notBy` names the person who may not change the row');
    expect(at('rep_id.user_id')).toContain('roles.0.limits.targets.rows.update.notBy: "targets.rep_id" is not a link to another of the app\'s tables, so it names no row to read "user_id" of: `notBy` names the person who may not change the row');
    const linked = (notBy: string) => messages(manifest({ roles: [managerOf({ starter_goals: { rows: { update: { reach: 'own', notBy } } } })] }));
    expect(linked('starter_id.nobody')).toContain('roles.0.limits.starter_goals.rows.update.notBy: "starters" has no column "nobody": `notBy` names the person who may not change the row');
    expect(linked('starter_id.first_year_target')).toContain(
      'roles.0.limits.starter_goals.rows.update.notBy: "starters.first_year_target" does not hold a staff member (rules.staff): `notBy` names the person who may not change the row',
    );
    expect(linked('Starter.user')).not.toEqual([]);
  });

  it('holds a change, never a read; never a private table\'s reach; never an add-on\'s table', () => {
    expect(messages(manifest({ roles: [managerOf({ targets: { rows: { read: { reach: 'team', notBy: 'rep_id' } } } })] }))).toContain(
      'roles.0.limits.targets.rows.read.notBy: `notBy` holds a change (update or delete): a person still reads the rows that name them',
    );
    const priv = tables().map((table) => (table['ref'] === 'targets' ? { ...table, private: true } : table));
    expect(messages(manifest({ tables: priv, roles: [managerOf({ targets: { rows: { read: { reach: 'own' }, update: { reach: 'own', notBy: 'rep_id' } } } })] }))).toContain(
      'roles.0.limits.targets.rows.update: "targets" is private: the role\'s update reaches the person\'s own rows only ({ "reach": "own" })',
    );
    // A reach of every row with nothing narrowing it is still no limit.
    expect(messages(manifest({ roles: [managerOf({ starters: { rows: { update: { reach: 'all' } } } })] })).some((message) => message.includes('say `while` or `notBy`'))).toBe(true);
  });
});

describe('when, and by whom, a column may change (changes)', () => {
  it('validates the approval guard and the claimed enquiry guard, as a word of 0.3.33', () => {
    expect(messages(manifest())).toEqual([]);
    expect(installFloorWords(manifest())).toContainEqual({ word: 'column.changes', path: 'requiredSchema.tables.1.columns.2.rules.changes' });
    expect(installFloorWords(manifest())).toContainEqual({ word: 'column.changes', path: 'requiredSchema.tables.2.columns.3.rules.changes' });
    expect(WORD_FLOORS['column.changes']).toBe('0.3.33');
  });

  it('says what a change waits for, in values the columns hold', () => {
    const approval = (guard: unknown) => messages(manifest({ tables: tables({ approval: [guard] }) }));
    expect(approval({ to: ['approved'] }).join('\n')).toContain('a guard says what a change waits for');
    expect(approval({ to: ['accepted'], from: ['asked'] })).toContain('requiredSchema.tables.1.columns.2.rules.changes.0.to.0: "accepted" is not a value of "quotes.approval"');
    expect(approval({ to: ['approved'], from: ['waiting'] })).toContain('requiredSchema.tables.1.columns.2.rules.changes.0.from.0: "waiting" is not a value of "quotes.approval"');
    expect(approval({ to: ['approved'], from: ['approved'] })).toContain(
      'requiredSchema.tables.1.columns.2.rules.changes.0.from: a change to a value is never a change from that same value: name the values it comes from',
    );
    const deal = (guard: unknown) => messages(manifest({ tables: tables({ deal: [guard] }) }));
    expect(deal({ while: { column: 'stage', in: ['claimed'] } })).toContain('requiredSchema.tables.2.columns.3.rules.changes.0.while.column: "enquiries" has no column "stage"');
    expect(deal({ while: { column: 'state', in: ['taken'] } })).toContain('requiredSchema.tables.2.columns.3.rules.changes.0.while.in.0: "taken" is not a value of "enquiries.state"');
    expect(deal({ while: { column: 'deal_id', isNull: false } })).toContain(
      'requiredSchema.tables.2.columns.3.rules.changes.0.while.column: a change is held by another column: what this one holds before the change is "from"',
    );
    expect(deal({ while: { column: 'claimed_by_id', isNull: false } })).toEqual([]);
    expect(approval({ while: { column: 'total', isNull: false } })).toContain('requiredSchema.tables.1.columns.2.rules.changes.0.while.column: "quotes.total" is a secret, and a change is never judged by one');
  });

  it('names people by a staff column of the row, or of the row a link names', () => {
    const approval = (guard: unknown) => messages(manifest({ tables: tables({ approval: [guard] }) }));
    expect(approval({ notBy: ['approval'] })).toContain('requiredSchema.tables.1.columns.2.rules.changes.0.notBy.0: "quotes.approval" does not hold a staff member (rules.staff): "notBy" names a person who never makes the change');
    expect(approval({ notBy: ['deal_id.name'] })).toContain('requiredSchema.tables.1.columns.2.rules.changes.0.notBy.0: "deals.name" does not hold a staff member (rules.staff): "notBy" names a person who never makes the change');
    expect(approval({ notBy: ['asked_by_id.owner_id'] })).toContain(
      'requiredSchema.tables.1.columns.2.rules.changes.0.notBy.0: "quotes.asked_by_id" is not a link to another of the app\'s tables, so it names no row to read "owner_id" of: "notBy" names a person who never makes the change',
    );
    expect(approval({ notBy: ['asked_by_id', 'asked_by_id'] })).toContain('requiredSchema.tables.1.columns.2.rules.changes.0.notBy.1: "asked_by_id" is named twice');
    expect(approval({ by: 'deal_id.owner_id', notBy: ['deal_id.owner_id'] })).toContain(
      'requiredSchema.tables.1.columns.2.rules.changes.0.notBy: "deal_id.owner_id" is both the person who makes the change and one who never does',
    );
    const deal = (guard: unknown) => messages(manifest({ tables: tables({ deal: [guard] }) }));
    expect(deal({ by: 'boss' })).toContain('requiredSchema.tables.2.columns.3.rules.changes.0.by: "enquiries" has no column "boss": "by" names the person who makes the change');
    expect(deal({ by: 'deal_id.owner_id' })).toEqual([]);
  });

  it('is no rule of a column Adminium decides', () => {
    const decided = tables().map((table) =>
      table['ref'] === 'quotes'
        ? { ...table, columns: (table['columns'] as Doc[]).map((column) => (column['ref'] === 'asked_by_id' ? { ...column, rules: { ...(column['rules'] as Doc), changes: [{ notBy: ['deal_id.owner_id'] }] } } : column)) }
        : table,
    );
    expect(messages(manifest({ tables: decided }))).toContain('requiredSchema.tables.1.columns.3.rules.changes: Adminium decides "quotes.asked_by_id" (its stamp rule), so no writer changes it and a guard holds nothing');
  });
});

describe('a rule never carries a code staff never see (E5)', () => {
  const template = { key: 'quote-link', name: 'Quote link', locales: { 'en-US': { subject: 'Your quote {{share_code}}', blocks: [{ block: 'email.text', data: { text: 'Hello' } }] } } };
  const rule = (action: Doc, event = 'updated') => ({
    key: 'tell',
    name: 'Tell',
    enabled: true,
    trigger: { kind: 'record', table: 'quotes', event },
    graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, { id: 'n1', kind: 'action', title: 'Tell', action }] },
  });
  const notice = (body: string) => rule({ kind: 'notification', to: { roles: ['manager'] }, title: 'Quote', body });

  it('lets a rule read the record\'s other columns', () => {
    expect(messages(manifest({ automations: [notice('Approval is {{record.approval}}, deal {{deal_id.name}}')] }))).toEqual([]);
  });

  it('refuses {{record.x}}, {{x}}, {{was.x}}, and a linked row\'s, naming the column', () => {
    for (const name of ['record.share_code', 'share_code', 'was.share_code']) {
      expect(messages(manifest({ automations: [notice(`Code {{${name}}}`)] }))).toContain(
        `automations.0.graph.nodes.1.action.body: {{${name}}} reads "quotes.share_code", a code staff never see (rules.code.hiddenFromStaff): no rule carries it`,
      );
    }
    const linked = tables().map((table) => (table['ref'] === 'deals' ? { ...table, columns: [...(table['columns'] as Doc[]), { ref: 'portal_code', type: 'text', maxLength: 16, nullable: true, rules: { code: { length: 16, hiddenFromStaff: true } } }] } : table));
    expect(messages(manifest({ tables: linked, automations: [notice('{{deal_id.portal_code}}')] }))).toContain(
      'automations.0.graph.nodes.1.action.body: {{deal_id.portal_code}} reads "deals.portal_code", a code staff never see (rules.code.hiddenFromStaff): no rule carries it',
    );
    expect(messages(manifest({ tables: linked, automations: [notice('{{record.deal_id.portal_code}}')] }))).toContain(
      'automations.0.graph.nodes.1.action.body: {{record.deal_id.portal_code}} reads "deals.portal_code", a code staff never see (rules.code.hiddenFromStaff): no rule carries it',
    );
  });

  it('refuses one in a value a step writes, and in the e-mail a rule sends', () => {
    expect(messages(manifest({ automations: [rule({ kind: 'record.update', values: { approval: '{{share_code}}' } })] }))).toContain(
      'automations.0.graph.nodes.1.action.values.approval: {{share_code}} reads "quotes.share_code", a code staff never see (rules.code.hiddenFromStaff): no rule carries it',
    );
    const mail = rule({ kind: 'email', to: { kind: 'staff', column: 'asked_by_id' }, templateKey: 'quote-link' });
    expect(messages(manifest({ automations: [mail], templates: [template] }))).toContain(
      'automations.0.graph.nodes.1.action.templateKey: {{share_code}} reads "quotes.share_code", a code staff never see (rules.code.hiddenFromStaff): no rule carries it',
    );
  });
});
