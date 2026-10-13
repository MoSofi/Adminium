// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words a rule tells people with, and the mark of a text people are
 * mentioned in, as the manifest check reads them: the person a staff column
 * names, once per spell, urgent, a summary for each person, a row a step
 * makes read by the steps after it — and each of them written wrongly.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest } from '../src/index.js';

const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };
const node = (key: string, action: Record<string, unknown>) => ({ id: key, kind: 'action', title: key, action });
const flow = (...nodes: Record<string, unknown>[]) => ({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, ...nodes] });
const page = (ref: string, table: string, order: number) => ({ ref, template: 'page-crud', title: { key: `t.${ref}`, fallback: ref }, nav: { group: 'sales', icon: 'list', order }, bindings: { rows: table } });
const template = (key: string, subject: string, blocks: Record<string, unknown>[]) => ({ key, name: key, locales: { 'en-US': { subject, blocks } } });

function sales(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'sales',
    name: 'Sales',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.sales.desc', fallback: 'Sales.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'sales', label: en('Sales'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'contacts', columns: [id, { ref: 'name', type: 'text', maxLength: 120 }] },
        {
          ref: 'deals',
          belongs: [{ column: 'owner_id', set: 'anyone' }],
          indexes: [['owner_id']],
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 120 },
            { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true },
            { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
            { ref: 'state', type: 'enum', enum: ['open', 'won'], default: 'open' },
            { ref: 'quiet', type: 'int', default: 0 },
            { ref: 'amount', type: 'int', default: 0 },
          ],
        },
        { ref: 'follow_ups', columns: [id, { ref: 'deal_id', type: 'fk', references: 'deals' }, { ref: 'note', type: 'text', maxLength: 200, nullable: true }] },
        { ref: 'enquiries', columns: [id, { ref: 'name', type: 'text', maxLength: 120 }] },
      ],
    },
    roles: [
      { key: 'rep', name: 'Rep', permissions: ['table:@deals:read', 'table:@deals:create', 'table:@deals:update', 'table:@follow_ups:read', 'page:@sales-deals:view'], limits: { deals: { rows: { read: { reach: 'own' }, update: { reach: 'own' } } } } },
      { key: 'manager', name: 'Manager', permissions: ['table:@deals:read', 'table:@deals:update', 'page:@sales-deals:view'] },
      { key: 'clerk', name: 'Clerk', permissions: ['table:@enquiries:read', 'table:@enquiries:create'] },
    ],
    pages: [page('sales-deals', 'deals', 1), page('sales-enquiries', 'enquiries', 2)],
    emailTemplates: [
      template('sales-week', 'Your open deals, {{name}}', [
        { block: 'email.text', data: { text: '{{count.open}} open.' } },
        { block: 'email.rows', id: 'rows-open', data: { section: 'open', row: { title: '{{row.name}}', amount: '{{row.amount}}' }, empty: 'Nothing is open.' } },
      ]),
      template('sales-won', '{{record.name}} is won', [{ block: 'email.text', data: { text: 'Well done on {{record.name}}.' } }]),
    ],
    automations: [
      {
        key: 'quiet-deal',
        name: en('A quiet deal: tell its owner'),
        enabled: true,
        trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMinutes: '5' }, forEach: { table: 'deals', once: 'per-spell', where: [{ left: { field: 'quiet' }, op: 'is', right: 1 }] } },
        graph: flow(node('tell', { kind: 'notification', to: { column: 'owner_id' }, title: en('Quiet: {{record.name}}') })),
      },
      {
        key: 'follow-up-made',
        name: en('A follow-up is made: tell the deal’s owner'),
        enabled: true,
        trigger: { kind: 'record', event: 'created', table: 'follow_ups' },
        graph: flow(node('tell', { kind: 'notification', to: { column: 'deal_id.owner_id' }, title: en('A follow-up on your deal') })),
      },
      {
        key: 'amount-changed',
        name: en('A deal’s amount changes: tell its owner at once'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'deals', changedColumn: 'amount' },
        graph: flow(node('tell', { kind: 'notification', to: { column: 'owner_id' }, title: en('Amount changed: {{record.name}}'), urgent: true })),
      },
      {
        key: 'deal-won',
        name: en('A deal is won: write to its owner'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'deals', changedColumn: 'state', when: [{ left: { field: 'state' }, op: 'is', right: 'won' }] },
        graph: flow(node('mail', { kind: 'email', templateKey: 'sales-won', to: { kind: 'staff', column: 'owner_id' } })),
      },
      {
        key: 'weekly',
        name: en('Each person’s open deals'),
        enabled: true,
        trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMinutes: '60' } },
        graph: flow(node('sum', { kind: 'digest', templateKey: 'sales-week', to: { roles: ['rep', 'manager'] }, sections: [{ key: 'open', table: 'deals', owner: 'owner_id', where: [{ left: { field: 'state' }, op: 'is', right: 'open' }], orderBy: { column: 'name' } }] })),
      },
      {
        key: 'enquiry-in',
        name: en('An enquiry: a contact, a deal for them, and a follow-up on it'),
        enabled: true,
        trigger: { kind: 'record', event: 'created', table: 'enquiries' },
        graph: flow(
          node('contact', { kind: 'record.create', table: 'contacts', name: 'contact', values: { name: '{{record.name}}' } }),
          node('deal', { kind: 'record.create', table: 'deals', name: 'deal', values: { name: 'Deal for {{steps.contact.name}}', contact_id: '{{steps.contact.id}}' } }),
          { id: 'w', kind: 'wait', title: 'An hour', amount: 1, unit: 'hours' },
          node('follow', { kind: 'record.create', table: 'follow_ups', values: { deal_id: '{{steps.deal.id}}', note: 'Call {{steps.contact.name}}' } }),
        ),
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

type Doc = ReturnType<typeof sales> & {
  automations: { key: string; trigger: Record<string, unknown>; graph: { nodes: { action: Record<string, any> }[] } }[];
  requiredSchema: { tables: { ref: string; columns: { ref: string; rules?: unknown }[] }[] };
};
const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};
const changed = (change: (doc: Doc) => void): string => {
  const doc = sales() as Doc;
  change(doc);
  return issuesOf(doc).join('\n');
};
const rule = (doc: Doc, key: string) => doc.automations.find((one) => one.key === key)!;
const column = (doc: Doc, table: string, ref: string) => doc.requiredSchema.tables.find((one) => one.ref === table)!.columns.find((one) => one.ref === ref)!;

describe('rules that tell the person on the row', () => {
  it('validates, and each word it uses is one an older server is told it cannot run', () => {
    expect(issuesOf(sales())).toEqual([]);
    const words = new Set(installFloorWords(sales()).map((found) => found.word));
    for (const word of ['automations.staffRecipient', 'automations.perSpell', 'automations.urgent', 'automations.digest', 'automations.stepName']) expect(words.has(word as never), word).toBe(true);
  });

  it('tells only the person a staff column names, on the record or on the row one of its links names', () => {
    expect(changed((doc) => (rule(doc, 'quiet-deal').graph.nodes[1]!.action['to'] = { column: 'name' }))).toContain('"deals.name" is not a staff column');
    expect(changed((doc) => (rule(doc, 'follow-up-made').graph.nodes[1]!.action['to'] = { column: 'nope_id.owner_id' }))).toContain('"follow_ups" has no column "nope_id"');
    expect(changed((doc) => (rule(doc, 'deal-won').graph.nodes[1]!.action['to'] = { kind: 'staff', column: 'state' }))).toContain('"deals.state" is not a staff column');
    expect(changed((doc) => (rule(doc, 'quiet-deal').graph.nodes[1]!.action['urgent'] = 'yes'))).not.toBe('');
  });

  it('holds a summary to sections of the person\'s own rows, each drawn by a rows block of its template', () => {
    expect(changed((doc) => (rule(doc, 'weekly').graph.nodes[1]!.action['sections'][0].owner = 'name'))).toContain('a section lists the rows whose person is the one written to');
    const renamed = changed((doc) => (rule(doc, 'weekly').graph.nodes[1]!.action['sections'][0].key = 'mine'));
    expect(renamed).toContain('has a rows block that names no section of this step');
    expect(renamed).toContain('draws no rows block for the section "mine"');
  });

  it('lets a step read only a row a step before it makes, by a column that row has', () => {
    expect(changed((doc) => (rule(doc, 'enquiry-in').graph.nodes[2]!.action['values'].name = 'Deal for {{steps.ghost.name}}'))).toContain('no earlier step makes a row called "ghost"');
    expect(changed((doc) => (rule(doc, 'enquiry-in').graph.nodes[2]!.action['values'].name = 'Deal for {{steps.contact.nope}}'))).toContain('"contacts" has no column "nope"');
    expect(changed((doc) => (rule(doc, 'enquiry-in').graph.nodes[2]!.action['name'] = 'contact'))).toContain('"contact" already names a row an earlier step makes');
  });

  it('sends a template through an outbox or by a rule\'s step, and says which one nothing sends', () => {
    expect(changed((doc) => delete (doc as { automations?: unknown }).automations)).toContain('nothing sends "sales-week", "sales-won": this app declares no outbox');
  });
});

describe('a text people are mentioned in', () => {
  it('is a text column, and its "about" a link of its table', () => {
    const marked = sales() as Doc;
    column(marked, 'follow_ups', 'note').rules = { mentions: { about: 'deal_id' } };
    expect(issuesOf(marked)).toEqual([]);
    expect(installFloorWords(marked).map((found) => found.word)).toContain('column.mentions');
    expect(changed((doc) => (column(doc, 'deals', 'amount').rules = { mentions: true }))).toContain('people are mentioned in a text column, and "deals.amount" is int');
    expect(changed((doc) => (column(doc, 'follow_ups', 'note').rules = { mentions: { about: 'note' } }))).toContain('"follow_ups.note" is not a link of this table');
  });
});
