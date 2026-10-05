// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rules a manifest ships: written as the rules page stores one, about
 * the manifest's own tables, roles and templates, and held to what a rule can
 * do — a comparison that can hold, a trigger that can fire, an email a rule
 * can fill.
 */
import { describe, expect, it } from 'vitest';

import { ADD_ON_INSTALL_FLOOR, installFloorWords, manifestAutomationsSchema, templatePlaceholdersOf, validateManifest } from '../src/index.js';
import { LEDGER_KIT } from './ledger-kit-fixture.js';

type Doc = Record<string, unknown>;

const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

const TEMPLATE = {
  key: 'ledger-kit-low',
  name: 'Running low',
  locales: {
    'en-US': { subject: '{{name}} is running low', blocks: [{ block: 'email.text', data: { text: 'Only {{balance}} left of {{record.name}}, says {{ruleName}}. Call {{supplier}}.' } }] },
    'de-DE': { subject: '{{name}} wird knapp', blocks: [{ block: 'email.text', data: { text: 'Nur noch {{balance}} von {{name}}. {{supplier}} anrufen.' } }] },
  },
};

const node = (id: string, kind: string, extra: Doc = {}) => ({ id, kind, title: id, ...extra });
const notify = (id: string, title: unknown = 'Low: {{record.name}}') => node(id, 'action', { action: { kind: 'notification', to: { roles: ['manager'] }, title } });

/** A record rule on `accounts`: when `low` changes to 1, tell the managers. */
const LOW = {
  key: 'low',
  name: { 'en-US': 'Running low', 'de-DE': 'Wird knapp' },
  enabled: true,
  trigger: { kind: 'record', event: 'updated', table: 'accounts', changedColumn: 'low', when: [{ left: { field: 'low' }, op: 'is', right: 1 }] },
  graph: { version: 1, nodes: [node('t', 'trigger'), notify('n')] },
};

/** The kit with rules of its own, a role, a template and its outbox. */
function kit(rules: Doc[], over: Doc = {}): Doc {
  const doc = structuredClone(LEDGER_KIT) as unknown as { requiredSchema: { prefixed: true; tables: { ref: string; columns: Doc[] }[] } };
  doc.requiredSchema.tables = doc.requiredSchema.tables.map((table) =>
    table.ref === 'accounts' ? { ...table, columns: [...table.columns, { ref: 'contact', type: 'text', maxLength: 200, nullable: true }, { ref: 'checked_on', type: 'date', nullable: true }, { ref: 'active', type: 'bool', default: true }] } : table,
  );
  return { ...(doc as unknown as Doc), roles: [{ key: 'manager', name: 'Manager', permissions: ['table:@accounts:read'] }], automations: rules, ...over };
}
const rule = (over: Doc): Doc => ({ ...structuredClone(LOW), ...over });
const trigger = (over: Doc): Doc => rule({ trigger: { ...LOW.trigger, ...over } });
const steps = (...nodes: Doc[]): Doc => rule({ graph: { version: 1, nodes: [node('t', 'trigger'), ...nodes] } });
const one = (doc: Doc): string => issuesOf(kit([doc])).join('\n');

describe('the vocabulary', () => {
  it('a rule on the manifest\'s own table, to its own role, validates', () => {
    expect(issuesOf(kit([LOW]))).toEqual([]);
    expect(installFloorWords(kit([LOW])).map((found) => found.word)).toContain('automations');
  });

  it('takes at most twelve rules, each with its own key of at most 80 characters', () => {
    expect(manifestAutomationsSchema.safeParse(Array.from({ length: 13 }, (_, i) => ({ ...LOW, key: `low-${String(i)}` }))).success).toBe(false);
    expect(manifestAutomationsSchema.safeParse([LOW, LOW]).success).toBe(false);
    expect(manifestAutomationsSchema.safeParse([{ ...LOW, key: `r${'x'.repeat(80)}` }]).success).toBe(false);
  });

  it('names no connection, no zone, no user, no address, no web address and no document profile', () => {
    const refused = (change: Doc) => manifestAutomationsSchema.safeParse([{ ...LOW, ...change }]).success;
    expect(refused({ trigger: { ...LOW.trigger, connectionId: 'cnx_1' } })).toBe(false);
    expect(refused({ trigger: { ...LOW.trigger, watch: true } })).toBe(false);
    expect(refused({ trigger: { kind: 'schedule', schedule: { kind: 'daily', time: '17:00', timezone: 'Europe/Berlin' } } })).toBe(false);
    const action = (a: Doc) => refused({ graph: { version: 1, nodes: [node('t', 'trigger'), node('a', 'action', { action: a })] } });
    expect(action({ kind: 'notification', to: { users: ['usr_1'] }, title: 'x' })).toBe(false);
    expect(action({ kind: 'email', templateKey: 'ledger-kit-low', to: { kind: 'fixed', addresses: ['a@example.com'] } })).toBe(false);
    expect(action({ kind: 'webhook', url: 'https://example.com' })).toBe(false);
    expect(action({ kind: 'document.render', profileId: 'dpr_1' })).toBe(false);
    expect(action({ kind: 'record.update', values: { reorder_at: '5' } })).toBe(true);
  });

  it('one trigger, first; unique step ids; no branch inside a branch; a wait of at most 30 days', () => {
    const graph = (nodes: Doc[]) => manifestAutomationsSchema.safeParse([{ ...LOW, graph: { version: 1, nodes } }]).success;
    expect(graph([notify('n'), node('t', 'trigger')])).toBe(false);
    expect(graph([node('t', 'trigger'), notify('n'), notify('n')])).toBe(false);
    expect(graph([node('t', 'trigger'), node('w', 'wait', { amount: 31, unit: 'days' })])).toBe(false);
    const condition = { left: { field: 'low' }, op: 'is', right: 1 };
    const branch = (inner: Doc[]) => node('b', 'branch', { condition, branches: [{ id: 'yes', label: 'Yes', nodes: inner }, { id: 'no', label: 'No', nodes: [node('s', 'stop')] }] });
    expect(graph([node('t', 'trigger'), branch([notify('n')])])).toBe(true);
    expect(graph([node('t', 'trigger'), branch([branch([])])])).toBe(false);
  });

  it('a text may be given in several languages, US English among them', () => {
    expect(issuesOf(kit([steps(notify('n', { 'en-US': 'Low: {{record.name}}', 'ar-EG': 'منخفض: {{record.name}}' }))]))).toEqual([]);
    expect(manifestAutomationsSchema.safeParse([{ ...LOW, name: { 'de-DE': 'Wird knapp' } }]).success).toBe(false);
  });
});

describe('what a rule names is the manifest\'s own', () => {
  it('its tables and their columns', () => {
    expect(one(trigger({ table: 'orders' }))).toContain('automations.0.trigger.table: "orders" is not one of this manifest\'s tables');
    expect(one(trigger({ when: [{ left: { field: 'colour' }, op: 'is', right: 'red' }] }))).toContain('"accounts" has no column "colour"');
    expect(one(steps(node('c', 'action', { action: { kind: 'record.create', table: 'entries', values: { account_id: '{{record.id}}', amount: '1', colour: 'red' } } })))).toContain('"entries" has no column "colour"');
    expect(one(steps(notify('n', 'Low: {{record.colour}}')))).toContain('{{record.colour}}: "accounts" has no column "colour"');
  });

  it('its roles', () => {
    expect(one(steps(node('a', 'action', { action: { kind: 'notification', to: { roles: ['owner'] }, title: 'x' } })))).toContain('"owner" is not one of this manifest\'s roles');
  });

  it('a counted table, by the column that matches a column of the record', () => {
    const count = (c: Doc, right: unknown = 0) => trigger({ when: [{ left: { count: { table: 'holds', matchColumn: 'account_id', equalsField: 'id', ...c } }, op: 'is', right }] });
    expect(one(count({}))).toBe('');
    expect(one(count({ table: 'orders' }))).toContain('"orders" is not one of this manifest\'s tables');
    expect(one(count({ matchColumn: 'item_id' }))).toContain('"holds" has no column "item_id"');
    expect(one(count({}, 'none'))).toContain('a count is compared with a number');
  });
});

describe('a comparison that can hold', () => {
  const when = (condition: Doc) => one(trigger({ when: [condition] }));

  it('a number is compared with a number: a 0/1 flag never with the word true', () => {
    expect(when({ left: { field: 'low' }, op: 'is', right: 'true' })).toContain('"accounts.low" is a number: compare it with a number ("true" is not one)');
    expect(when({ left: { field: 'balance' }, op: 'gt', right: '5' })).toContain('"accounts.balance" is a number');
    expect(when({ left: { field: 'balance' }, op: 'gt', right: 5 })).toBe('');
    expect(when({ left: { field: 'name' }, op: 'is', right: 'Flour' })).toBe('');
  });

  it('a relative comparison only on a date', () => {
    expect(when({ left: { field: 'name' }, op: 'within_next', right: { amount: 30, unit: 'days' } })).toContain('"within_next" compares a date with now, and "accounts.name" is text');
    expect(when({ left: { field: 'checked_on' }, op: 'within_next', right: { amount: 30, unit: 'days' } })).toBe('');
  });

  it('an operand of the kind its operator takes, and one given: a shipped rule is complete', () => {
    const parse = (condition: Doc) => manifestAutomationsSchema.safeParse([trigger({ when: [condition] })]).success;
    expect(parse({ left: { field: 'name' }, op: 'is_empty', right: 'x' })).toBe(false);
    expect(parse({ left: { field: 'name' }, op: 'is' })).toBe(false);
    expect(parse({ left: { field: 'checked_on' }, op: 'within_next', right: 30 })).toBe(false);
    expect(parse({ left: { count: { table: 'holds', matchColumn: 'account_id', equalsField: 'id' } }, op: 'contains', right: 'x' })).toBe(false);
  });
});

describe('a rule that can fire', () => {
  it('a changed column that is a total or a balance is refused: the rule names an announced formula over it', () => {
    expect(one(trigger({ changedColumn: 'taken', when: [] }))).toContain(
      '"accounts.taken" is a total Adminium settles after the save, and a rule is not told of that: name a formula column over it that carries "announce": true',
    );
    expect(one(trigger({ changedColumn: 'balance', when: [] }))).toContain('"accounts.balance" is a total Adminium settles after the save');
    expect(one(trigger({ changedColumn: 'low' }))).toBe('');
    expect(one(trigger({ event: 'created' }))).toContain('a changed column is said of a record that is updated');
  });

  it('a rule by the clock never filters the rows it visits by a count, and "once" needs a condition', () => {
    const scan = (forEach: Doc, schedule: Doc = { kind: 'daily', time: '17:00' }) => rule({ trigger: { kind: 'schedule', schedule, forEach: { table: 'accounts', once: false, where: [], ...forEach } } });
    expect(one(scan({ where: [{ left: { field: 'active' }, op: 'is', right: 'true' }] }))).toBe('');
    expect(one(scan({ where: [{ left: { count: { table: 'holds', matchColumn: 'account_id', equalsField: 'id' } }, op: 'gt', right: 0 }] }))).toContain(
      'a rule that runs by the clock cannot filter the rows it visits by a count',
    );
    expect(one(scan({ once: true }))).toContain('a row visited once needs a condition that picks it');
    expect(one(scan({}, { kind: 'weekly', time: '09:00' }))).toContain('a weekly rule names its day');
    expect(one(scan({}, { kind: 'monthly', time: '09:00' }))).toContain('a monthly rule names its day');
  });

  it('a rule never writes a column Adminium decides', () => {
    const update = (values: Doc) => one(steps(node('u', 'action', { action: { kind: 'record.update', values } })));
    expect(update({ reorder_at: '5' })).toBe('');
    expect(update({ taken: '5' })).toContain('"accounts.taken" is decided by Adminium (its rollup rule): a rule cannot write it');
    expect(update({ balance: '5' })).toContain('"accounts.balance" is decided by Adminium: a rule cannot write it');
    expect(update({ low: '1' })).toContain('"accounts.low" is decided by Adminium (its formula rule)');
  });
});

describe('an email a rule sends', () => {
  const email = (action: Doc = {}, templates: Doc[] = [TEMPLATE]) =>
    issuesOf(
      kit([steps(node('e', 'action', { action: { kind: 'email', templateKey: 'ledger-kit-low', to: { kind: 'field', column: 'contact' }, vars: { supplier: 'Mill & Co' }, ...action } }))], {
        emailTemplates: templates,
        outbox: undefined,
      }),
    ).join('\n');

  it('reads every placeholder of a template in every language it ships', () => {
    expect(templatePlaceholdersOf(TEMPLATE.locales['en-US'])).toEqual(['name', 'balance', 'record.name', 'ruleName', 'supplier']);
    expect(templatePlaceholdersOf({ subject: 'x', blocks: [{ block: 'email.rows', data: { text: '{{row.qty}} {{total}}' } }] })).toEqual(['total']);
  });

  it('is one of the manifest\'s own templates, to a column of the record', () => {
    const issues = email({ templateKey: 'other-welcome' });
    expect(issues).toContain('"other-welcome" is not one of this manifest\'s emailTemplates: a shipped rule sends only its own');
    expect(email({ to: { kind: 'field', column: 'email' } })).toContain('"accounts" has no column "email"');
  });

  it('is refused when a rule cannot fill it, with what to write', () => {
    const issues = email({ vars: {} });
    expect(issues).toContain(
      '"ledger-kit-low" (en-US) reads {{supplier}}, which a rule cannot fill. Add "vars": { "supplier": "{{record.<column>}}" } to this step, or send this email from the outbox.',
    );
    expect(issues).toContain('"ledger-kit-low" (de-DE) reads {{supplier}}');
  });

  it('a step\'s own text fills a placeholder; one the template never reads is refused; its tokens are columns', () => {
    expect(email({ vars: { supplier: 'Mill & Co', colour: 'red' } })).toContain('"ledger-kit-low" reads no {{colour}} in any language: take it out, or fix the name');
    expect(email({ vars: { supplier: '{{record.colour}}' } })).toContain('{{record.colour}}: "accounts" has no column "colour"');
  });

  it('never a template only the outbox can fill: a document, a list of rows, a block it drops', () => {
    const withAttach = { ...TEMPLATE, attach: { kind: 'receipt', link: 'order' } };
    expect(email({}, [withAttach])).toContain('"ledger-kit-low" carries a document, which only the outbox draws');
    const marked = { ...TEMPLATE, locales: { 'en-US': { subject: '{{name}}', blocks: [{ block: 'email.text', data: { text: 'x', onlyWith: 'name' } }] } } };
    expect(email({ vars: {} }, [marked])).toContain('has a block only the outbox fills or drops (email.text)');
  });
});

describe('the floor', () => {
  it('an app that ships a rule says so in its floor', () => {
    const app = {
      kind: 'app',
      manifestVersion: 1,
      key: 'shop',
      name: 'Shop',
      version: '0.3.0',
      publisher: { id: 'adminium', name: 'Adminium' },
      license: 'MIT',
      description: { key: 'd', fallback: 'A shop' },
      categories: ['commerce'],
      compatibility: { minAdminiumVersion: '0.3.17' },
      pages: [{ ref: 'orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'manage', icon: 'list', order: 1 } }],
      frontends: [{ side: 'staff', kind: 'none' }],
      roles: [{ key: 'desk', name: 'Desk' }],
      requiredSchema: { tables: [{ ref: 'orders', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'status', type: 'text', maxLength: 20, default: 'new' }] }] },
      automations: [
        {
          key: 'shop-new',
          name: 'New order',
          enabled: true,
          trigger: { kind: 'record', event: 'created', table: 'orders' },
          graph: { version: 1, nodes: [node('t', 'trigger'), node('n', 'action', { action: { kind: 'notification', to: { roles: ['desk'] }, title: 'New order {{record.id}}' } })] },
        },
      ],
    };
    expect(issuesOf(app).join('\n')).toContain('automations: "automations" is read by Adminium 0.3.18 and later');
    expect(issuesOf({ ...app, compatibility: { minAdminiumVersion: ADD_ON_INSTALL_FLOOR } })).toEqual([]);
  });
});
