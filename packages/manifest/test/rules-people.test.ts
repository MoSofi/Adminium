// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words a rule tells people with, and the mark of a text people are
 * mentioned in, as the manifest check reads them: the person a staff column
 * names, once per spell, urgent, a summary for each person, a row a step
 * makes read by the steps after it — and each of them written wrongly.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest, WORD_FLOORS } from '../src/index.js';

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
        // What each rep is to book in a year: a summary measures a sum against it.
        { ref: 'targets', belongs: [{ column: 'rep_id', set: 'team' }], columns: [id, { ref: 'rep_id', type: 'text', maxLength: 36, rules: { staff: true } }, { ref: 'year', type: 'int' }, { ref: 'amount', type: 'int' }] },
      ],
    },
    roles: [
      { key: 'rep', name: 'Rep', permissions: ['table:@deals:read', 'table:@deals:create', 'table:@deals:update', 'table:@follow_ups:read', 'page:@sales-deals:view'], limits: { deals: { rows: { read: { reach: 'own' }, update: { reach: 'own' } } } } },
      { key: 'manager', name: 'Manager', permissions: ['table:@deals:read', 'table:@deals:update', 'table:@targets:read', 'page:@sales-deals:view'] },
      { key: 'clerk', name: 'Clerk', permissions: ['table:@enquiries:read', 'table:@enquiries:create'] },
    ],
    pages: [page('sales-deals', 'deals', 1), page('sales-enquiries', 'enquiries', 2)],
    emailTemplates: [
      template('sales-week', 'Your open deals, {{name}}', [
        { block: 'email.text', data: { text: '{{count.open}} open.' } },
        { block: 'email.rows', id: 'rows-open', data: { section: 'open', row: { title: '{{row.name}}', amount: '{{row.amount}}' }, empty: 'Nothing is open.' } },
      ]),
      template('sales-won', '{{record.name}} is won', [{ block: 'email.text', data: { text: 'Well done on {{record.name}}.' } }]),
      template('sales-team', 'The team, {{name}}', [
        { block: 'email.text', data: { text: '{{count.team}} open, {{sum.team.amount}} in all. Target {{target.reps|none set}}, cover {{cover.reps|not worked out}}. Read {{readAt}}.' } },
        { block: 'email.rows', id: 'rows-team', data: { section: 'team', row: { title: '{{row.name}}', amount: '{{row.amount}}' }, empty: 'Nothing is open.' } },
        { block: 'email.rows', id: 'rows-reps', data: { section: 'reps', row: { title: '{{row.owner}}', meta: '{{row.count}} open', amount: '{{row.sum.amount}}', note: 'of {{row.target|no target}}: {{row.cover|no cover}}' }, empty: 'Nobody.' } },
      ]),
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
        // Switched off: a manager asks for theirs, and nobody is written to by the clock.
        key: 'weekly-team',
        name: en('Each manager’s team'),
        enabled: false,
        trigger: { kind: 'schedule', schedule: { kind: 'weekly', dayOfWeek: 1, time: '07:00' } },
        graph: flow(
          node('sum', {
            kind: 'digest',
            templateKey: 'sales-team',
            to: { roles: ['manager'] },
            sections: [
              { key: 'team', table: 'deals', owner: 'owner_id', reach: 'team', sum: ['amount'], where: [{ left: { field: 'state' }, op: 'is', right: 'open' }], orderBy: { column: 'name' } },
              { key: 'reps', table: 'deals', owner: 'owner_id', reach: 'team', by: 'owner', sum: ['amount'], where: [{ left: { field: 'state' }, op: 'is', right: 'open' }], target: { table: 'targets', owner: 'rep_id', column: 'amount', year: 'year', of: 'amount' } },
            ],
          }),
        ),
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

  it('tells the lead of the person a staff column names, with roles for when there is none, and says the word to an older server', () => {
    const lead = (doc: Doc, to: unknown) => (rule(doc, 'quiet-deal').graph.nodes[1]!.action['to'] = to);
    const asked = sales() as Doc;
    lead(asked, { column: 'owner_id', lead: true, else: { roles: ['manager'] } });
    expect(issuesOf(asked)).toEqual([]);
    expect(installFloorWords(asked).map((found) => found.word)).toContain('automations.lead');
    expect(WORD_FLOORS['automations.lead']).toBe('0.3.28');
    // Roles for an empty column, without a lead, are the same word.
    const empty = sales() as Doc;
    lead(empty, { column: 'owner_id', else: { roles: ['manager'] } });
    expect(issuesOf(empty)).toEqual([]);
    expect(installFloorWords(empty).map((found) => found.word)).toContain('automations.lead');
    // A lead is never quietly nobody's; the roles are the manifest's own; the column a staff column.
    expect(changed((doc) => lead(doc, { column: 'owner_id', lead: true }))).toContain('a notice to a lead says who is told when there is none');
    expect(changed((doc) => lead(doc, { column: 'owner_id', lead: true, else: { roles: ['boss'] } }))).toContain('"boss" is not one of this manifest\'s roles');
    expect(changed((doc) => lead(doc, { column: 'name', lead: true, else: { roles: ['manager'] } }))).toContain('"deals.name" is not a staff column');
    expect(changed((doc) => lead(doc, { column: 'owner_id', lead: 'yes', else: { roles: ['manager'] } }))).not.toBe('');
    expect(changed((doc) => lead(doc, { column: 'owner_id', lead: true, else: { roles: [] } }))).not.toBe('');
  });

  it('tells the people a table lists against the record, by a notice or a mail each, and says the word to an older server', () => {
    /** The sales app with `deal_members` listing people on a deal, read `through` by the deal's own ways. */
    const listing = (doc: Doc): Doc => {
      doc.requiredSchema.tables.push({ ref: 'deal_members', belongs: [{ via: 'deal_id' }], columns: [id, { ref: 'deal_id', type: 'fk', references: 'deals' }, { ref: 'user_id', type: 'text', maxLength: 36, rules: { staff: true } }] } as never);
      (doc.requiredSchema.tables.find((one) => one.ref === 'deals') as unknown as { belongs: unknown[] }).belongs.push({ through: { table: 'deal_members', link: 'deal_id', user: 'user_id' } });
      return doc;
    };
    type Templates = { emailTemplates: { key: string; locales: Record<string, { blocks: { data: Record<string, unknown> }[] }> }[] };
    const told = listing(sales() as Doc);
    rule(told, 'quiet-deal').graph.nodes[1]!.action['to'] = { listed: 'deal_members' };
    rule(told, 'deal-won').graph.nodes[1]!.action['to'] = { kind: 'listed', table: 'deal_members' };
    // A mail to each of them may carry the record's address, as a mail to a person does.
    (told as unknown as Templates).emailTemplates.find((one) => one.key === 'sales-won')!.locales['en-US']!.blocks[0]!.data['text'] = 'Open it: {{recordUrl}}';
    expect(issuesOf(told)).toEqual([]);
    const words = installFloorWords(told).map((found) => `${found.word} ${found.path}`);
    expect(words).toContain('automations.listed automations.0.graph.nodes.1.action.to');
    expect(words).toContain('automations.listed automations.3.graph.nodes.1.action.to');
    expect(WORD_FLOORS['automations.listed']).toBe('0.3.28');
    const wrong = (change: (doc: Doc) => void): string => {
      const doc = listing(sales() as Doc);
      change(doc);
      return issuesOf(doc).join('\n');
    };
    // Only a table the record's own ways read through; never a table that merely has a staff column, nor one of another record.
    expect(wrong((doc) => (rule(doc, 'quiet-deal').graph.nodes[1]!.action['to'] = { listed: 'targets' }))).toContain('"targets" lists nobody against "deals"');
    expect(wrong((doc) => (rule(doc, 'deal-won').graph.nodes[1]!.action['to'] = { kind: 'listed', table: 'follow_ups' }))).toContain('"follow_ups" lists nobody against "deals"');
    expect(wrong((doc) => (rule(doc, 'follow-up-made').graph.nodes[1]!.action['to'] = { listed: 'deal_members' }))).toContain('"deal_members" lists nobody against "follow_ups"');
    // A rule about no record has nobody listed on it.
    expect(wrong((doc) => (rule(doc, 'weekly').graph.nodes[1]!.action = { kind: 'notification', to: { listed: 'deal_members' }, title: en('Hello') }))).toContain('this rule runs for no record, so nobody is listed on it to tell');
    // Nothing more is taken beside the table.
    expect(wrong((doc) => (rule(doc, 'quiet-deal').graph.nodes[1]!.action['to'] = { listed: 'deal_members', lead: true }))).not.toBe('');
  });

  it('fills the name of the person a staff column names, and the record\'s address only in a mail to a person', () => {
    type Templates = { emailTemplates: { key: string; locales: Record<string, { blocks: { data: Record<string, unknown> }[] }> }[] };
    const won = (doc: Doc) => (doc as unknown as Templates).emailTemplates.find((one) => one.key === 'sales-won')!.locales['en-US']!.blocks[0]!.data;
    const named = sales() as Doc;
    won(named)['text'] = 'Well done, {{owner_id.name}}, on {{record.name}} ({{record.owner_id.name}}). Open it: {{recordUrl}}';
    rule(named, 'quiet-deal').graph.nodes[1]!.action['title'] = en('{{owner_id.name}}: {{record.name}} is quiet');
    expect(issuesOf(named)).toEqual([]);
    const words = installFloorWords(named).map((found) => `${found.word} ${found.path}`);
    expect(words).toContain('automations.staffName automations.0');
    expect(words).toContain('automations.staffName automations.3');
    expect(words).toContain('automations.recordUrl automations.3');
    expect(WORD_FLOORS['automations.staffName']).toBe('0.3.28');
    expect(WORD_FLOORS['automations.recordUrl']).toBe('0.3.28');
    // A column that names nobody has no name; the address goes only to a person, never to an address a column holds.
    expect(changed((doc) => (won(doc)['text'] = 'Hello {{name.name}}'))).toContain('reads {{name.name}}, which a rule cannot fill');
    expect(changed((doc) => {
      won(doc)['text'] = 'Open it: {{recordUrl}}';
      rule(doc, 'deal-won').graph.nodes[1]!.action['to'] = { kind: 'field', column: 'name' };
    })).toContain('reads {{recordUrl}}, which only a mail to a person carries');
  });

  it('reads the record as it was before the change, in a rule run by a change only, in its texts, its writes and its mails', () => {
    type Templates = { emailTemplates: { key: string; locales: Record<string, { blocks: { data: Record<string, unknown> }[] }> }[] };
    const won = (doc: Doc) => (doc as unknown as Templates).emailTemplates.find((one) => one.key === 'sales-won')!.locales['en-US']!.blocks[0]!.data;
    const was = sales() as Doc;
    rule(was, 'amount-changed').graph.nodes[1]!.action['title'] = en('{{record.name}}: {{was.amount}} → {{record.amount}}');
    rule(was, 'amount-changed').graph.nodes.push({ action: { kind: 'record.update', values: { name: '{{record.name}} (was {{was.amount}})' } } } as never);
    (rule(was, 'amount-changed').graph.nodes.at(-1) as Record<string, unknown>)['id'] = 'keep';
    (rule(was, 'amount-changed').graph.nodes.at(-1) as Record<string, unknown>)['kind'] = 'action';
    (rule(was, 'amount-changed').graph.nodes.at(-1) as Record<string, unknown>)['title'] = 'keep';
    won(was)['text'] = 'Well done on {{record.name}}, {{was.state}} until now.';
    expect(issuesOf(was)).toEqual([]);
    const words = installFloorWords(was).map((found) => `${found.word} ${found.path}`);
    expect(words).toContain('automations.was automations.2');
    expect(words).toContain('automations.was automations.3');
    expect(WORD_FLOORS['automations.was']).toBe('0.3.28');
    // A rule run by the clock, or when a row is made, has no "as it was"; a column the record has not, none either.
    expect(changed((doc) => (rule(doc, 'quiet-deal').graph.nodes[1]!.action['title'] = en('{{was.name}}')))).toContain('{{was.name}}: only a rule run when its record is updated reads the record as it was');
    expect(changed((doc) => (rule(doc, 'amount-changed').graph.nodes[1]!.action['title'] = en('{{was.nope}}')))).toContain('{{was.nope}}: "deals" has no column "nope"');
    expect(changed((doc) => {
      won(doc)['text'] = 'Was {{was.state}}';
      rule(doc, 'deal-won').trigger['event'] = 'created';
      delete rule(doc, 'deal-won').trigger['changedColumn'];
      delete rule(doc, 'deal-won').trigger['when'];
    })).toContain('reads {{was.state}}, which a rule cannot fill');
  });

  it('reads an amount of time from a whole-number column of a settings row, where a scan or a condition step reads it', () => {
    const quiet = (doc: Doc) => rule(doc, 'quiet-deal').trigger['forEach'] as { where: Record<string, unknown>[] };
    const stamp = (doc: Doc) => Object.assign(column(doc, 'deals', 'quiet'), { type: 'timestamptz', default: undefined, nullable: true });
    const read = sales() as Doc;
    stamp(read);
    quiet(read).where = [{ left: { field: 'quiet' }, op: 'more_than_ago', right: { amount: 7, unit: 'days', setting: { table: 'targets', column: 'year' } } }];
    expect(issuesOf(read)).toEqual([]);
    expect(installFloorWords(read).map((found) => `${found.word} ${found.path}`)).toContain('automations.settingAmount automations.0');
    expect(WORD_FLOORS['automations.settingAmount']).toBe('0.3.28');
    const withSetting = (doc: Doc, setting: unknown) => {
      stamp(doc);
      quiet(doc).where = [{ left: { field: 'quiet' }, op: 'more_than_ago', right: { amount: 7, unit: 'days', setting } }];
    };
    expect(changed((doc) => withSetting(doc, { table: 'targets', column: 'rep_id' }))).toContain('"targets.rep_id" is not a whole-number column');
    expect(changed((doc) => withSetting(doc, { table: 'settings', column: 'days' }))).toContain('"settings" is not one of this manifest\'s tables');
    // Not in a trigger's own conditions, which are read inside the save.
    expect(
      changed((doc) => {
        const won = rule(doc, 'deal-won');
        won.trigger['when'] = [{ left: { field: 'name' }, op: 'within_last', right: { amount: 7, unit: 'days', setting: { table: 'targets', column: 'year' } } }];
      }),
    ).toContain('an amount read from a setting is read where a rule visits rows by the clock');
  });

  it('holds a summary to sections of the person\'s own rows, each drawn by a rows block of its template', () => {
    expect(changed((doc) => (rule(doc, 'weekly').graph.nodes[1]!.action['sections'][0].owner = 'name'))).toContain('a section lists the rows whose person is the one written to');
    const renamed = changed((doc) => (rule(doc, 'weekly').graph.nodes[1]!.action['sections'][0].key = 'mine'));
    expect(renamed).toContain('has a rows block that names no section of this step');
    expect(renamed).toContain('draws no rows block for the section "mine"');
  });

  it('holds a section to this year, or to the last days, by a date column of its own table', () => {
    const section = (doc: Doc) => rule(doc, 'weekly-team').graph.nodes[1]!.action['sections'][0];
    const dated = (doc: Doc, within: unknown) => {
      doc.requiredSchema.tables.find((one) => one.ref === 'deals')!.columns.push({ ref: 'closed_on', type: 'date', nullable: true } as never, { ref: 'touched_at', type: 'timestamptz', nullable: true } as never);
      (doc as unknown as { compatibility: { minAdminiumVersion: string } }).compatibility.minAdminiumVersion = '0.3.35';
      section(doc).within = within;
    };
    // `orEmpty`: rows whose date is empty count too (open deals beside the year's won ones).
    for (const within of [{ column: 'closed_on', this: 'year' }, { column: 'touched_at', lastDays: 30 }, { column: 'closed_on', this: 'year', orEmpty: true }, { column: 'touched_at', lastDays: 7, orEmpty: true }]) {
      const doc = sales() as Doc;
      dated(doc, within);
      expect(issuesOf(doc), JSON.stringify(within)).toEqual([]);
      expect(installFloorWords(doc).map((found) => `${found.word} ${found.path}`)).toContain('digest.within automations.5.graph.nodes.1.action.sections.0.within');
    }
    expect(WORD_FLOORS['digest.within']).toBe('0.3.35');
    // An older engine is told which release reads it.
    expect(changed((doc) => {
      dated(doc, { column: 'closed_on', this: 'year' });
      (doc as unknown as { compatibility: { minAdminiumVersion: string } }).compatibility.minAdminiumVersion = '0.3.28';
    })).toContain('0.3.35');
    expect(changed((doc) => dated(doc, { column: 'name', this: 'year' }))).toContain('"deals.name" is text: a section is held to a year or to days by a date column');
    expect(changed((doc) => dated(doc, { column: 'nope', lastDays: 7 }))).toContain('"deals" has no column "nope"');
    // A year, or a number of days from one to a year's: nothing else.
    expect(changed((doc) => dated(doc, { column: 'quiet', lastDays: 7 }))).toContain('"deals.quiet" is int: a section is held to a year or to days by a date column');
    for (const within of [{ column: 'closed_on', this: 'month' }, { column: 'closed_on', lastDays: 0 }, { column: 'closed_on', lastDays: 367 }, { column: 'closed_on' }, { column: 'closed_on', this: 'year', lastDays: 7 }, { column: 'closed_on', this: 'year', orEmpty: false }]) {
      expect(changed((doc) => dated(doc, within)), JSON.stringify(within)).not.toBe('');
    }
  });

  it('holds a section of a team to the same words: a number summed, a line a person, a target that is somebody\'s', () => {
    const words = new Set(installFloorWords(sales()).map((found) => found.word));
    for (const word of ['digest.reach', 'digest.sum', 'digest.by', 'digest.target']) expect(words.has(word as never), word).toBe(true);
    for (const word of ['digest.reach', 'digest.sum', 'digest.by', 'digest.target'] as const) expect(WORD_FLOORS[word]).toBe('0.3.28');
    const section = (doc: Doc, n: number) => rule(doc, 'weekly-team').graph.nodes[1]!.action['sections'][n];
    // There is no "all": a summary reads the person's rows, or theirs and their team's.
    expect(changed((doc) => (section(doc, 0).reach = 'all'))).not.toBe('');
    expect(changed((doc) => (section(doc, 0).sum = ['name']))).toContain('"deals.name" is not a number column: a sum adds numbers up');
    expect(changed((doc) => (section(doc, 0).sum = ['nope']))).toContain('"deals" has no column "nope"');
    expect(changed((doc) => (section(doc, 0).sum = ['amount', 'amount']))).toContain('"amount" is summed twice');
    expect(changed((doc) => (section(doc, 1).orderBy = { column: 'name' }))).toContain('is listed by name: it has no orderBy');
    expect(changed((doc) => (section(doc, 1).target.of = 'quiet'))).toContain('"quiet" is not one of this section\'s sums');
    expect(changed((doc) => (section(doc, 1).target.owner = 'year'))).toContain('"targets.year" is not a staff column');
    expect(changed((doc) => (section(doc, 1).target.column = 'rep_id'))).toContain('"targets.rep_id" is not a number column');
    expect(changed((doc) => (section(doc, 1).target.year = 'rep_id'))).toContain('it holds a calendar year');
    expect(changed((doc) => (section(doc, 1).target.table = 'goals'))).toContain('"goals" is not one of this manifest\'s tables');
    // A line a person reads the person and their figures, never a column of some row.
    const template = (doc: Doc) => (doc as unknown as { emailTemplates: { key: string; locales: Record<string, { blocks: { data: Record<string, any> }[] }> }[] }).emailTemplates.find((one) => one.key === 'sales-team')!.locales['en-US']!;
    expect(changed((doc) => (template(doc).blocks[2]!.data['row'].title = '{{row.name}}'))).toContain('reads {{row.name}} in the section "reps", which lists one line a person');
    // A sum nobody asked for is not filled; a target with nothing to say for a person who has none is refused.
    expect(changed((doc) => (template(doc).blocks[0]!.data['text'] = '{{sum.team.quiet}}'))).toContain('reads {{sum.team.quiet}}, which a summary cannot fill');
    expect(changed((doc) => (template(doc).blocks[0]!.data['text'] = 'Cover {{cover.reps}}'))).toContain('with nothing to write for a person who has no target');
    expect(changed((doc) => (template(doc).blocks[0]!.data['text'] = 'Cover {{cover.team}}'))).toContain('reads {{cover.team}}, which a summary cannot fill');
  });

  it('lets a step read only a row a step before it makes, by a column that row has', () => {
    expect(changed((doc) => (rule(doc, 'enquiry-in').graph.nodes[2]!.action['values'].name = 'Deal for {{steps.ghost.name}}'))).toContain('no earlier step makes a row called "ghost"');
    expect(changed((doc) => (rule(doc, 'enquiry-in').graph.nodes[2]!.action['values'].name = 'Deal for {{steps.contact.nope}}'))).toContain('"contacts" has no column "nope"');
    expect(changed((doc) => (rule(doc, 'enquiry-in').graph.nodes[2]!.action['name'] = 'contact'))).toContain('"contact" already names a row an earlier step makes');
  });

  it('sends a template through an outbox or by a rule\'s step, and says which one nothing sends', () => {
    expect(changed((doc) => delete (doc as { automations?: unknown }).automations)).toContain('nothing sends "sales-week", "sales-won", "sales-team": this app declares no outbox');
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
