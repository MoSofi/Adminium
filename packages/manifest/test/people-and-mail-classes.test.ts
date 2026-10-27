// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words e-mail to contacts reads: each mail's class (marketing or
 * service), the app's people tables, a table the law keeps, and room for more
 * rules. What the check accepts, what it refuses and the release an app that
 * uses one asks for; and from that release on, a mail that says no class is
 * refused, while an app built for an older Adminium reads as service.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { MAIL_CLASS_FLOOR, composeManifest, installFloorWords, mailClassOf, splitManifest, validateManifest, withoutModules, type AppManifest } from '../src/index.js';

type Doc = Record<string, unknown>;

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Doc = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
const staff = (ref: string) => text(ref, 36, { rules: { staff: true } });
const template = (key: string, body = 'About your quote.') => ({ key, name: key, locales: { 'en-US': { subject: 'Your quote', blocks: [{ block: 'email.text', data: { text: body } }] } } });
const node = (nodeId: string, kind: string, extra: Doc = {}) => ({ id: nodeId, kind, title: nodeId, ...extra });

/** A small CRM: contacts, deals with a rep, quotes, an outbox of two kinds, and one rule that mails the quote's address. */
function crm(floor = '0.3.36') {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: floor },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'contacts',
          keyField: 'name',
          columns: [
            id,
            text('email', 254),
            text('name', 80),
            text('language', 10),
            { ref: 'may_email', type: 'bool', default: false },
            text('notes', 200),
            { ref: 'won_deals', type: 'int', default: 0 },
            { ref: 'opt_out_offered_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { columns: ['may_email'] }, strict: true } } },
            { ref: 'seen_at', type: 'timestamptz', nullable: true },
          ],
        },
        { ref: 'deals', columns: [id, text('name', 80), staff('owner_id'), { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true }] },
        {
          ref: 'quotes',
          columns: [
            id,
            { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true },
            { ref: 'deal_id', type: 'fk', references: 'deals', nullable: true },
            staff('owner_id'),
            { ref: 'stage', type: 'enum', enum: ['draft', 'sent'], default: 'draft' },
            text('sent_to_email', 254),
            text('to_name', 80),
            text('note', 200),
          ],
        },
        {
          ref: 'messages',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: ['quote-sent', 'news'] },
            { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            text('to_address', 254),
            { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true },
            { ref: 'quote_id', type: 'fk', references: 'quotes', nullable: true },
            text('error', 200),
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
          ],
        },
      ],
    },
    pages: [{ ref: 'crm-quotes', template: 'page-crud', title: { key: 't', fallback: 'Quotes' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'quotes' } }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: { quote: 'quote_id' },
      recipient: { via: 'contact_id', table: 'contacts', email: 'email', name: 'name' },
      kinds: { 'quote-sent': 'crm-quote-sent', news: 'crm-news' } as Record<string, string>,
      classes: undefined as Record<string, string> | undefined,
      producers: [{ kind: 'quote-sent', link: 'quote_id', recipient: { column: 'sent_to_email' }, onChange: { table: 'quotes', column: 'stage', to: 'sent' } }],
    },
    emailTemplates: [template('crm-quote-sent'), template('crm-news'), template('crm-note')],
    automations: [
      {
        key: 'note-mail',
        name: { 'en-US': 'A note on a quote: write to the customer' },
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'quotes', changedColumn: 'note' },
        graph: { version: 1, nodes: [node('t', 'trigger'), node('mail', 'action', { action: { kind: 'email', templateKey: 'crm-note', to: { kind: 'field', column: 'sent_to_email' } } as Doc })] },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  } as Doc & {
    compatibility: { minAdminiumVersion: string };
    outbox: { kinds: Record<string, string>; classes: Record<string, string> | undefined; recipient: Doc };
    automations: { key: string; graph: { nodes: Doc[] } }[];
    requiredSchema: { tables: { ref: string; columns: Doc[]; keep?: unknown }[] };
    people?: Doc[];
    publicAccess?: Doc[];
    emailTemplates: Doc[];
  };
}
type Crm = ReturnType<typeof crm>;

/** The same CRM at W1's floor, each mail classed. */
function classed(): Crm {
  const doc = crm(MAIL_CLASS_FLOOR);
  doc.outbox.classes = { 'quote-sent': 'service', news: 'marketing' };
  (doc.automations[0]!.graph.nodes[1]!['action'] as Doc)['class'] = 'service';
  return doc;
}

/** Its people: contacts, by the outbox's own address. */
const contacts = (over: Doc = {}): Doc => ({
  table: 'contacts',
  kind: 'people',
  email: 'email',
  language: 'language',
  firstName: 'firstWordOfName',
  consent: { column: 'may_email', purpose: 'newsletter' },
  copies: [
    { table: 'quotes', column: 'sent_to_email', holds: 'email', via: 'contact_id' },
    { table: 'quotes', column: 'to_name', holds: 'name' },
  ],
  customer: 'won_deals',
  optOutMark: 'opt_out_offered_at',
  ...over,
});
const withPeople = (...entries: Doc[]): Crm => {
  const doc = classed();
  doc.people = entries;
  return doc;
};

const issuesOf = (doc: unknown): string => {
  const result = validateManifest(doc);
  return result.ok ? '' : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
};
const words = (doc: unknown): string[] => installFloorWords(doc).map((found) => found.word);
const typed = (doc: unknown): AppManifest => {
  const result = validateManifest(doc);
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join('\n'));
  return result.manifest as AppManifest;
};
const step = (doc: Crm): Doc => doc.automations[0]!.graph.nodes[1]!['action'] as Doc;

describe('marketing or service', () => {
  it('a manifest for an older Adminium says no class, and every mail of it reads as service', () => {
    const doc = crm('0.3.36');
    expect(issuesOf(doc)).toBe('');
    const m = typed(doc);
    expect(mailClassOf(m, { outboxKind: 'news' })).toBe('service');
    expect(mailClassOf(m, { outboxKind: 'quote-sent' })).toBe('service');
    expect(mailClassOf(m, { step: step(doc) as never })).toBe('service');
  });

  it('from the floor on, an outbox kind that says no class is refused by name; the same manifest a release before is accepted', () => {
    const gap = classed();
    gap.outbox.classes = { 'quote-sent': 'service' };
    const said = issuesOf(gap);
    expect(said).toContain('outbox.classes: the outbox\'s kind "news" says no class, and compatibility.minAdminiumVersion is 0.3.38');
    expect(said).not.toContain('"quote-sent" says no class');
    // No classes at all: both kinds are named.
    const none = classed();
    none.outbox.classes = undefined;
    expect(issuesOf(none)).toContain('"quote-sent" says no class');
    expect(issuesOf(none)).toContain('"news" says no class');
    // The same manifest a release before: accepted, and read as service.
    const older = classed();
    older.outbox.classes = undefined;
    delete step(older)['class'];
    older.compatibility.minAdminiumVersion = '0.3.36';
    expect(issuesOf(older)).toBe('');
    expect(mailClassOf(typed(older), { outboxKind: 'news' })).toBe('service');
  });

  it('a classed manifest validates at the floor, says the words and reads each class', () => {
    const doc = classed();
    expect(issuesOf(doc)).toBe('');
    expect(words(doc)).toEqual(expect.arrayContaining(['outbox.classes', 'automations.emailClass']));
    const m = typed(doc);
    expect(mailClassOf(m, { outboxKind: 'news' })).toBe('marketing');
    expect(mailClassOf(m, { outboxKind: 'quote-sent' })).toBe('service');
    expect(mailClassOf(m, { step: step(doc) as never })).toBe('service');
    expect(mailClassOf(m, { step: { to: { kind: 'staff', column: 'owner_id' } } })).toBe('staff');
    expect(mailClassOf(m, { step: { to: { kind: 'listed', table: 'deals' } } })).toBe('staff');
  });

  it('a class written under an older floor asks for the release that reads it', () => {
    const doc = classed();
    doc.compatibility.minAdminiumVersion = '0.3.36';
    const said = issuesOf(doc);
    expect(said).toContain('"outbox.classes" is read by Adminium 0.3.38 and later');
    expect(said).toContain('"automations.emailClass" is read by Adminium 0.3.38 and later');
  });

  it('a class is said of a kind the outbox sends, and is marketing or service', () => {
    const doc = classed();
    doc.outbox.classes = { 'quote-sent': 'service', news: 'marketing', gone: 'service' };
    expect(issuesOf(doc)).toContain('outbox.classes.gone: "gone" is not one of the outbox\'s kinds');
    const odd = classed();
    odd.outbox.classes = { 'quote-sent': 'service', news: 'promotional' };
    expect(issuesOf(odd)).not.toBe('');
  });

  it('a rule\'s mail to staff carries no class; its mail to the record\'s own address must say one at the floor', () => {
    const toStaff = classed();
    step(toStaff)['to'] = { kind: 'staff', column: 'owner_id' };
    expect(issuesOf(toStaff)).toContain('a mail to staff is never stopped, so it has no class');
    const withoutClass = classed();
    delete step(withoutClass)['class'];
    expect(issuesOf(withoutClass)).toContain('automations.0.graph.nodes.1.action.class: the rule "note-mail" mails the record\'s own address and says no class');
    // To staff with no class: nothing is asked.
    const staffBare = classed();
    step(staffBare)['to'] = { kind: 'staff', column: 'owner_id' };
    delete step(staffBare)['class'];
    expect(issuesOf(staffBare)).toBe('');
  });

  it('a mail sent to the people a listing names carries no class either', () => {
    const doc = classed();
    doc.requiredSchema.tables.push({ ref: 'quote_people', columns: [id, { ref: 'quote_id', type: 'fk', references: 'quotes' }, text('user_id', 36, { rules: { staff: true } })] });
    const quotes = doc.requiredSchema.tables.find((table) => table.ref === 'quotes') as Doc;
    quotes['belongs'] = [{ through: { table: 'quote_people', link: 'quote_id', user: 'user_id' } }];
    step(doc)['to'] = { kind: 'listed', table: 'quote_people' };
    expect(issuesOf(doc)).toContain('a mail to staff is never stopped, so it has no class');
  });

  it('reading a kind\'s template is unchanged by the classes: an outbox mail that names the rep still asks for its release', () => {
    const naming = (classes: boolean): Crm => {
      const doc = classed();
      doc.emailTemplates[0] = template('crm-quote-sent', 'Your rep is {{quote.owner_id.name}}.');
      if (!classes) {
        doc.outbox.classes = undefined;
        delete step(doc)['class'];
        doc.compatibility.minAdminiumVersion = '0.3.36';
      }
      return doc;
    };
    expect(words(naming(false))).toContain('outbox.staffName');
    expect(words(naming(true))).toContain('outbox.staffName');
    expect(installFloorWords(naming(true)).find((found) => found.word === 'outbox.staffName')?.path).toBe('emailTemplates.0');
  });
});

describe('the people an app keeps', () => {
  it('a full entry validates and says its word', () => {
    const doc = withPeople(contacts());
    expect(issuesOf(doc)).toBe('');
    expect(words(doc)).toContain('people');
    const older = withPeople(contacts());
    older.outbox.classes = undefined;
    delete step(older)['class'];
    older.compatibility.minAdminiumVersion = '0.3.36';
    expect(issuesOf(older)).toContain('"people" is read by Adminium 0.3.38 and later');
  });

  it('an address that is not the one the outbox writes to for the same table is refused', () => {
    expect(issuesOf(withPeople(contacts({ email: 'notes' })))).toContain('people.0.email: the outbox writes to "contacts.email" (outbox.recipient.email), so the people of "contacts" have that address');
  });

  it('an address that is not the one a person signs in with is refused', () => {
    const doc = withPeople(contacts());
    doc.publicAccess = [{ table: 'contacts', methods: ['GET'], select: ['name'], claim: { verify: 'email-link', email: 'notes' } }];
    expect(issuesOf(doc)).toContain('signs "contacts" in by "notes" (claim.email)');
  });

  it('an opt-out mark that is not a strict stamp is refused, and so is one that is no moment', () => {
    expect(issuesOf(withPeople(contacts({ optOutMark: 'seen_at' })))).toContain('"contacts.seen_at" is set by the screen that shows the opt-out line, never by hand: make it a strict stamp');
    expect(issuesOf(withPeople(contacts({ optOutMark: 'notes' })))).toContain('"contacts.notes" is not a moment (timestamptz)');
  });

  it('a consent column that is not a yes or no is refused, and so is a purpose of its own', () => {
    expect(issuesOf(withPeople(contacts({ consent: { column: 'notes', purpose: 'newsletter' } })))).toContain('"contacts.notes" is not a bool (a yes or no)');
    expect(issuesOf(withPeople(contacts({ consent: { column: 'may_email', purpose: 'offers' } })))).not.toBe('');
  });

  it('a customer column is a yes or no or a number', () => {
    expect(issuesOf(withPeople(contacts({ customer: 'may_email' })))).toBe('');
    expect(issuesOf(withPeople(contacts({ customer: 'notes' })))).toContain('"contacts.notes" is not a bool or a number');
  });

  it('every column is the table\'s, and of a kind that fits', () => {
    expect(issuesOf(withPeople(contacts({ table: 'nope' })))).toContain('"nope" is not a table of this app');
    expect(issuesOf(withPeople(contacts({ language: 'nope' })))).toContain('"contacts" has no column "nope"');
    expect(issuesOf(withPeople(contacts({ language: 'won_deals' })))).toContain('"contacts.won_deals" is not a text column (a language)');
    expect(issuesOf(withPeople(contacts({ firstName: { column: 'may_email' } })))).toContain('"contacts.may_email" is not a text column');
    expect(issuesOf(withPeople(contacts({ name: 'won_deals' })))).toContain('"contacts.won_deals" is not a text column');
  });

  it('a people table names its address; a companies table may have none, and then names nothing read to mail it', () => {
    expect(issuesOf(withPeople(contacts({ email: undefined })))).toContain('a people table names the column that holds the address ("email")');
    const doc = withPeople(contacts(), { table: 'deals', kind: 'companies', name: 'name' });
    expect(issuesOf(doc)).toBe('');
    expect(issuesOf(withPeople(contacts(), { table: 'deals', kind: 'companies', name: 'name', consent: { column: 'name', purpose: 'newsletter' } }))).toContain('"consent" is read to mail the table\'s people, and this entry names no address');
    // No name and no keyField: the name is asked for.
    expect(issuesOf(withPeople(contacts(), { table: 'deals', kind: 'companies' }))).toContain('"deals" has no keyField: name the column that names a person ("name")');
  });

  it('a copy is a text column of another table, listed once, with a link back to the person', () => {
    const copy = (one: Doc) => withPeople(contacts({ copies: [one] }));
    expect(issuesOf(copy({ table: 'contacts', column: 'notes', holds: 'name' }))).toContain('a copy is kept on another table');
    expect(issuesOf(copy({ table: 'nope', column: 'x', holds: 'name' }))).toContain('"nope" is not a table of this app');
    expect(issuesOf(copy({ table: 'quotes', column: 'stage', holds: 'name' }))).toContain('"quotes.stage" is not a text column (a name)');
    expect(issuesOf(copy({ table: 'quotes', column: 'to_name', holds: 'name', via: 'deal_id' }))).toContain('"quotes.deal_id" links to "deals", not to "contacts"');
    expect(issuesOf(withPeople(contacts({ copies: [{ table: 'quotes', column: 'to_name', holds: 'name' }, { table: 'quotes', column: 'to_name', holds: 'name' }] })))).toContain('"quotes.to_name" is listed twice');
  });

  it('is written in people.json in an app folder', () => {
    const doc = withPeople(contacts());
    const files = splitManifest(doc);
    expect(files.map((file) => file.path)).toContain('people.json');
    const composed = composeManifest(files);
    expect(composed.ok && composed.document['people']).toEqual(doc.people);
  });

  it('a table is declared once', () => {
    expect(issuesOf(withPeople(contacts(), contacts()))).toContain('a table is declared as people once');
  });
});

describe('a table the law keeps', () => {
  it('says why, from a closed list, and asks for the release that reads it', () => {
    const doc = classed();
    doc.requiredSchema.tables.find((table) => table.ref === 'quotes')!.keep = { law: 'tax' };
    expect(issuesOf(doc)).toBe('');
    expect(installFloorWords(doc).find((found) => found.word === 'table.keep')?.path).toBe('requiredSchema.tables.2.keep');
    const odd = classed();
    odd.requiredSchema.tables.find((table) => table.ref === 'quotes')!.keep = { law: 'because' };
    expect(issuesOf(odd)).not.toBe('');
    const older = crm('0.3.36');
    older.requiredSchema.tables.find((table) => table.ref === 'quotes')!.keep = { law: 'tax' };
    expect(issuesOf(older)).toContain('"table.keep" is read by Adminium 0.3.38 and later');
  });
});

describe('room for thirty-two rules', () => {
  const rules = (doc: Crm, count: number): Crm => {
    const first = doc.automations[0]!;
    doc.automations = Array.from({ length: count }, (_, i) => ({ ...structuredClone(first), key: `note-mail-${String(i)}` }));
    return doc;
  };

  it('thirty-two at the floor are taken; below it the floor is asked for; thirty-three are refused', () => {
    expect(issuesOf(rules(classed(), 32))).toBe('');
    expect(words(rules(classed(), 25))).toContain('automations.more');
    expect(words(rules(classed(), 24))).not.toContain('automations.more');
    expect(issuesOf(rules(crm('0.3.36'), 24))).toBe('');
    expect(issuesOf(rules(crm('0.3.36'), 25))).toContain('automations: "automations.more" is read by Adminium 0.3.38 and later, and compatibility.minAdminiumVersion is 0.3.36: set it to 0.3.38 or later');
    expect(issuesOf(rules(classed(), 33))).not.toBe('');
  });
});

// A byte-exact copy of the Sales CRM's v0.2.2 manifest (git show v0.2.2:manifest.json, commit 41eba35c6). It is kept
// beside the released set, not in it: that set is what was released before an add-on could install like an app.
describe('the Sales CRM as released, and as K6 and K9 will declare it', () => {
  const released = (): Doc => JSON.parse(readFileSync(new URL('./fixtures/sales-crm-0.2.2.manifest.json', import.meta.url), 'utf8')) as Doc;

  /** The CRM with its people declared and every mail classed, at the floor that reads them. */
  function declared(): Doc {
    const doc = released() as Doc & { compatibility: { minAdminiumVersion: string }; outbox: { kinds: Record<string, string>; classes?: Record<string, string> }; requiredSchema: { tables: { ref: string; columns: Doc[] }[] } };
    doc.compatibility.minAdminiumVersion = '0.3.38';
    // K9: every kind service, the thank-you that gives a code marketing.
    doc.outbox.classes = Object.fromEntries(Object.keys(doc.outbox.kinds).map((kind) => [kind, kind === 'referral-thanks' ? 'marketing' : 'service']));
    // K6 and K10 add the "won deals" count and the opt-out mark to contacts. Not as a stored total over deals:
    // the sales manager reaches only some deals, and a stored total is refused for such a role (K6 keeps it otherwise).
    const contactsTable = doc.requiredSchema.tables.find((table) => table.ref === 'contacts')!;
    contactsTable.columns.push(
      { ref: 'won_deals', type: 'int', default: 0 },
      { ref: 'opt_out_offered_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { columns: ['may_email'] }, strict: true } } },
    );
    doc['people'] = [
      {
        table: 'contacts',
        kind: 'people',
        email: 'email',
        name: 'name',
        company: 'company_id',
        firstName: 'firstWordOfName',
        consent: { column: 'may_email', purpose: 'newsletter' },
        customer: 'won_deals',
        optOutMark: 'opt_out_offered_at',
        copies: [
          { table: 'quotes', column: 'to_email', holds: 'email', via: 'sent_to_contact_id' },
          { table: 'quotes', column: 'to_name', holds: 'name', via: 'sent_to_contact_id' },
          { table: 'quotes', column: 'sent_to_email', holds: 'email', via: 'sent_to_contact_id' },
          { table: 'quotes', column: 'sent_to_name', holds: 'name', via: 'sent_to_contact_id' },
          { table: 'quotes', column: 'accepted_name', holds: 'name', via: 'sent_to_contact_id' },
          { table: 'sign_offs', column: 'signer_name', holds: 'name' },
          { table: 'sign_offs', column: 'copy_sent_to', holds: 'email' },
          { table: 'delivery_notes', column: 'signed_name', holds: 'name', via: 'signed_by_contact_id' },
          { table: 'showroom_bookings', column: 'visitor_name', holds: 'name', via: 'contact_id' },
        ],
      },
      { table: 'companies', kind: 'companies', name: 'name' },
      // Enquiries: people of their own, whose consent the log alone holds.
      { table: 'enquiries', kind: 'people', email: 'email', name: 'person', company: 'company_id', firstName: 'firstWordOfName' },
    ];
    return doc;
  }

  it('validates unchanged', () => {
    expect(issuesOf(released())).toBe('');
    expect(words(released())).not.toEqual(expect.arrayContaining(['people']));
  });

  it('validates with its people declared and every mail classed', () => {
    const doc = declared();
    expect(issuesOf(doc)).toBe('');
    const m = typed(doc);
    expect(mailClassOf(m, { outboxKind: 'referral-thanks' })).toBe('marketing');
    expect(mailClassOf(m, { outboxKind: 'quote-sent' })).toBe('service');
  });

  it('left without the quotes part, the copies kept on quotes and the classes of its kinds go with it', () => {
    const left = withoutModules(declared(), ['quotes']) as Doc & { people: { table: string; copies?: { table: string }[] }[]; outbox: { kinds: Record<string, string>; classes: Record<string, string> } };
    expect(left.outbox.kinds['quote-sent']).toBeUndefined();
    expect(left.outbox.classes['quote-sent']).toBeUndefined();
    expect(left.outbox.classes['referral-thanks']).toBe('marketing');
    const copies = left.people.find((entry) => entry.table === 'contacts')?.copies ?? [];
    expect(copies.some((copy) => copy.table === 'quotes')).toBe(false);
    expect(copies.some((copy) => copy.table === 'sign_offs')).toBe(true);
    expect(issuesOf(left)).toBe('');
  });

  it('refuses the CRM\'s people when the address differs from its outbox\'s', () => {
    const doc = declared() as Doc & { people: Doc[] };
    doc.people[0] = { ...doc.people[0], email: 'phone' };
    expect(issuesOf(doc)).toContain('the outbox writes to "contacts.email" (outbox.recipient.email)');
  });
});

describe('the fleet\'s own cases', () => {
  /** The classed CRM with a settings row, and a kind that goes only to the house's own address. */
  function withHouseKind(producerTo: Doc): Crm {
    const doc = classed();
    doc.requiredSchema.tables.push({ ref: 'settings', columns: [id, text('reply_to', 254)] });
    (doc.outbox as Doc)['settings'] = { table: 'settings' };
    const messages = doc.requiredSchema.tables.find((table) => table.ref === 'messages')!;
    (messages.columns.find((column) => column['ref'] === 'kind') as { enum: string[] }).enum.push('house-note');
    doc.outbox.kinds['house-note'] = 'crm-house-note';
    doc.emailTemplates.push(template('crm-house-note'));
    (doc.outbox as unknown as { producers: Doc[] }).producers.push({ kind: 'house-note', link: 'quote_id', recipient: producerTo, onChange: { table: 'quotes', column: 'stage', to: 'draft' } });
    return doc;
  }

  it('a kind sent only to the house needs no class, and one it says is taken; a kind to a typed address is a contact\'s and says one', () => {
    const house = withHouseKind({ setting: { table: 'settings', column: 'reply_to' } });
    expect(issuesOf(house)).toBe('');
    expect(mailClassOf(typed(house), { outboxKind: 'house-note' })).toBe('staff');
    const said = withHouseKind({ setting: { table: 'settings', column: 'reply_to' } });
    said.outbox.classes = { ...said.outbox.classes, 'house-note': 'service' };
    expect(issuesOf(said)).toBe('');
    expect(mailClassOf(typed(said), { outboxKind: 'house-note' })).toBe('service');
    // To an address a column of the row holds (a friend, a copy, a supplier): a contact's mail.
    const typedAddress = withHouseKind({ column: 'sent_to_email' });
    expect(issuesOf(typedAddress)).toContain('the outbox\'s kind "house-note" says no class');
    // One producer to the house and one to a typed address: the kind reaches a contact, and says its class.
    const both = withHouseKind({ setting: { table: 'settings', column: 'reply_to' } });
    (both.outbox as unknown as { producers: Doc[] }).producers.push({ kind: 'house-note', link: 'quote_id', recipient: { column: 'sent_to_email' }, onChange: { table: 'quotes', column: 'stage', to: 'sent' } });
    expect(issuesOf(both)).toContain('the outbox\'s kind "house-note" says no class');
  });

  it('a consent column need not be the outbox\'s service opt-in', () => {
    const doc = withPeople(contacts());
    (doc.outbox.recipient as Doc)['optIn'] = 'may_email';
    expect(issuesOf(doc)).toBe('');
    const reminders = withPeople(contacts());
    reminders.requiredSchema.tables[0]!.columns.push({ ref: 'remind_email', type: 'bool', default: true });
    (reminders.outbox.recipient as Doc)['optIn'] = 'remind_email';
    expect(issuesOf(reminders)).toBe('');
  });

  it('a person is never named by their address', () => {
    const doc = withPeople(contacts({ name: 'email' }));
    expect(issuesOf(doc)).toContain('"contacts" is named by its address ("email")');
    const byKey = withPeople(contacts());
    (byKey.requiredSchema.tables[0] as Doc)['keyField'] = 'email';
    expect(issuesOf(byKey)).toContain('"contacts" is named by its address ("email", its keyField)');
  });

  it('a copy may hold a phone number', () => {
    const doc = withPeople(contacts({ copies: [{ table: 'quotes', column: 'note', holds: 'phone', via: 'contact_id' }] }));
    expect(issuesOf(doc)).toBe('');
    expect(issuesOf(withPeople(contacts({ copies: [{ table: 'quotes', column: 'stage', holds: 'phone' }] })))).toContain('"quotes.stage" is not a text column (a phone number)');
  });

  it('a mark may be carried from the row a person is made from, when that row\'s mark is a strict stamp too', () => {
    const doc = withPeople(contacts({ optOutMark: { column: 'opt_out_offered_at', carryFrom: { table: 'quotes', column: 'marked_at' } } }));
    doc.requiredSchema.tables.find((table) => table.ref === 'quotes')!.columns.push({ ref: 'marked_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: 'create', strict: true } } });
    expect(issuesOf(doc)).toBe('');
    const loose = withPeople(contacts({ optOutMark: { column: 'opt_out_offered_at', carryFrom: { table: 'quotes', column: 'note' } } }));
    expect(issuesOf(loose)).toContain('"quotes.note" is not a moment (timestamptz)');
    const own = withPeople(contacts({ optOutMark: { column: 'opt_out_offered_at', carryFrom: { table: 'contacts', column: 'opt_out_offered_at' } } }));
    expect(issuesOf(own)).toContain('a mark is carried from the row a person is made from, on another table');
    expect(issuesOf(withPeople(contacts({ optOutMark: { column: 'seen_at' } })))).toContain('make it a strict stamp');
  });

  it('an update carries an old unsubscribe mark to the do-not-email list, and a linked row\'s newest tick into consent, once', () => {
    const doc = withPeople(contacts({ carry: [{ stopList: { column: 'seen_at' } }, { consent: { from: 'deals', via: 'contact_id', column: 'won', latest: 'id' } }] }));
    doc.requiredSchema.tables.find((table) => table.ref === 'deals')!.columns.push({ ref: 'won', type: 'bool', default: false });
    expect(issuesOf(doc)).toBe('');
    // A column the manifest no longer declares cannot be carried: it stays declared one more release.
    expect(issuesOf(withPeople(contacts({ carry: [{ stopList: { column: 'unsubscribed_at' } }] })))).toContain('"contacts" has no column "unsubscribed_at": a carried column stays declared');
    // A tick carried from a table that does not link to the person, or that is no yes or no.
    expect(issuesOf(withPeople(contacts({ carry: [{ consent: { from: 'quotes', via: 'deal_id', column: 'note', latest: 'id' } }] })))).toContain('"quotes.deal_id" links to "deals", not to "contacts"');
    expect(issuesOf(withPeople(contacts({ carry: [{ consent: { from: 'quotes', via: 'contact_id', column: 'note', latest: 'id' } }] })))).toContain('"quotes.note" is not a bool');
    // Carried into consent, a consent column is declared.
    expect(issuesOf(withPeople(contacts({ consent: undefined, carry: [{ consent: { from: 'quotes', via: 'contact_id', column: 'note', latest: 'id' } }] })))).toContain('declare it ("consent")');
  });

  describe('a stranger\'s consent tick', () => {
    const tick = (over: Doc = {}): Doc => ({ column: 'news_ok', purpose: 'newsletter', wording: { version: 1, text: { 'en-US': 'Email me about offers', 'de-DE': 'Schreibt mir über Angebote' } }, ...over });
    function booking(consent: Doc, entry: Doc = {}): Crm {
      const doc = withPeople(contacts());
      doc.requiredSchema.tables.find((table) => table.ref === 'quotes')!.columns.push({ ref: 'news_ok', type: 'bool', default: false });
      doc.publicAccess = [{ table: 'quotes', methods: ['PATCH'], writable: ['news_ok'], claimedBy: { table: 'contacts', column: 'contact_id' }, consent, ...entry }];
      return doc;
    }
    const tickIssues = (doc: Crm): string[] => issuesOf(doc).split('\n').filter((line) => line.includes('.consent'));

    it('is a bool the entry writes, kept for one of the app\'s people, with its wording and version', () => {
      expect(tickIssues(booking(tick()))).toEqual([]);
      expect(words(booking(tick()))).toContain('publicAccess.consent');
      expect(issuesOf(booking(tick({ column: 'note' })))).toContain('"quotes.note" is not a bool (a tick)');
      expect(issuesOf(booking(tick(), { writable: ['note'] }))).toContain('"quotes.news_ok" is not writable through this entry');
      expect(issuesOf(booking(tick(), { methods: ['GET'] }))).toContain('a tick is given on a create or a change');
      expect(issuesOf(booking(tick(), { claimedBy: undefined }))).toContain('"quotes" is not one of the app\'s people tables');
      expect(issuesOf(booking(tick({ wording: { version: 1, text: { 'de-DE': 'Nur deutsch' } } })))).toContain('en-US among them');
      expect(issuesOf(booking(tick({ wording: { version: 0, text: { 'en-US': 'x' } } })))).not.toBe('');
    });
  });
});
