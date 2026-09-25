// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The less travelled refusals of the invoicing fields, one break each, and
 * the exact arithmetic's edges: every value form a driver hands back, every
 * comparison, and the currencies that are not written with two decimals.
 */
import { describe, expect, it } from 'vitest';

import {
  currencyScale,
  evaluateFormula,
  formulaColumns,
  formulaHolds,
  manifestWarnings,
  namedAddOns,
  requiresAddOn,
  shapeConformanceIssues,
  shapeKey,
  toRatio,
  validateManifest,
  type ShapeDefinitionView,
} from '../src/index.js';
import { addOnManifest, columnOf, entryOf, issuesText, tableOf, valid, type Doc } from './invoicing-fixture.js';

const expectIssue = (m: Doc, fragment: string) => expect(issuesText(m)).toContain(fragment);
const producers = (m: Doc) => (m['outbox'] as Doc)['producers'] as Doc[];
const states = (m: Doc, table: string) => tableOf(m, table)['states'] as Doc;

describe('add-on needs', () => {
  it('lists what an app names, and knows what it requires', () => {
    const needs = valid()['addOns'] as Parameters<typeof namedAddOns>[0];
    expect(namedAddOns(needs)).toEqual([
      { key: 'invoices', need: 'requires' },
      { key: 'holiday-calendars', need: 'suggests' },
    ]);
    expect(namedAddOns(undefined)).toEqual([]);
    expect(requiresAddOn(needs, 'invoices')).toBe(true);
    expect(requiresAddOn(needs, 'holiday-calendars')).toBe(false);
  });

  it('refuses an app needing itself, and a feature declared twice', () => {
    let m = valid();
    ((m['addOns'] as Doc)['suggests'] as Doc[])[0]!['key'] = 'studio';
    expectIssue(m, 'an app does not need itself');
    m = valid();
    const features = (m['addOns'] as Doc)['features'] as Doc[];
    features.push({ ...features[0]! });
    expectIssue(m, '"holidays" is declared twice');
  });
});

describe('document profiles', () => {
  const doc = (m: Doc) => (m['documents'] as Doc[])[0]!;

  it('names a missing table, child table, column through a link, and a duplicate', () => {
    let m = valid();
    doc(m)['table'] = 'nope';
    expectIssue(m, '"nope" is not a table of this app');
    m = valid();
    doc(m)['mapping'] = { lines: { collection: { table: 'nope', via: 'x', columns: {} } } };
    expectIssue(m, '"nope" is not a table of this manifest');
    m = valid();
    doc(m)['mapping'] = { lines: { collection: { table: 'invoices', via: 'client_id', orderBy: 'nope', columns: { n: 'number' } } } };
    expectIssue(m, '"invoices" has no column "nope"');
    m = valid();
    doc(m)['table'] = 'invoices';
    delete doc(m)['statement'];
    doc(m)['mapping'] = { who: { via: 'number', column: 'email' } };
    expectIssue(m, '"number" is not a foreign key of "invoices"');
    m = valid();
    doc(m)['table'] = 'invoices';
    delete doc(m)['statement'];
    doc(m)['mapping'] = { who: { via: 'client_id', column: 'phone' } };
    expectIssue(m, '"clients" has no column "phone"');
    m = valid();
    (m['documents'] as Doc[]).push(structuredClone(doc(m)));
    expectIssue(m, '"clients" already has a "statement" document');
  });

  it('checks a statement\'s sources and the feature a profile belongs to', () => {
    let m = valid();
    ((doc(m)['statement'] as Doc)['documents'] as Doc)['table'] = 'nope';
    expectIssue(m, 'documents.0.statement.documents.table: "nope" is not a table of this app');
    m = valid();
    ((doc(m)['statement'] as Doc)['documents'] as Doc)['amount'] = 'nope';
    expectIssue(m, '"invoices" has no column "nope"');
    m = valid();
    doc(m)['feature'] = 'nope';
    expectIssue(m, 'documents.0.feature: "nope" is not one of the app\'s addOns.features');
  });
});

describe('states, the rarer refusals', () => {
  it('needs an enum state column', () => {
    let m = valid();
    states(m, 'proposals')['column'] = 'nope';
    expectIssue(m, '"proposals" has no column "nope"');
    m = valid();
    states(m, 'proposals')['column'] = 'valid_until';
    expectIssue(m, '"proposals.valid_until" is not an enum, so it cannot hold a state');
  });

  it('asks for children and moves the state only by moves', () => {
    let m = valid();
    (((states(m, 'invoices')['moves'] as Doc)['draft'] as Doc[])[0]!['requires'] as Doc)['children'] = { payments_x: 1 };
    expectIssue(m, '"payments_x" is not one of this table\'s children');
    m = valid();
    ((states(m, 'invoices')['lock'] as Doc)['except'] as string[]).push('status');
    expectIssue(m, 'the state moves by its moves, never by the lock');
    m = valid();
    ((states(m, 'invoices')['lock'] as Doc)['except'] as string[]).push('nope');
    expectIssue(m, '"invoices" has no column "nope"');
    m = valid();
    ((states(m, 'proposals')['moves'] as Doc)['sent'] as string[]).push('sent');
    expectIssue(m, 'a move goes to another state');
  });

  it('names a child that is not a table, a lock with no lock, and a child with nothing to say', () => {
    let m = valid();
    (states(m, 'invoices')['children'] as Doc)['nope'] = { via: 'x', lock: true };
    expectIssue(m, '"nope" is not a table of this manifest');
    m = valid();
    states(m, 'proposals')['children'] = { proposal_lines: { via: 'proposal_id', lock: true } };
    delete states(m, 'proposals')['lock'];
    expectIssue(m, 'a child is locked with its parent, and the parent has no lock');
    m = valid();
    states(m, 'proposals')['children'] = { proposal_lines: { via: 'proposal_id' } };
    expectIssue(m, 'a child says lock, parentIn or clearOnCreate');
    m = valid();
    states(m, 'proposals')['children'] = { proposal_lines: { via: 'proposal_id', clearOnCreate: ['nope'] } };
    expectIssue(m, '"proposals" has no column "nope"');
    m = valid();
    states(m, 'proposals')['children'] = { proposal_lines: { via: 'proposal_id', lock: true, parentIn: ['sent'] } };
    expectIssue(m, 'a child is locked with its parent, or writable only in some of its states');
  });

  it('locks a row once another row in a state points at it', () => {
    let m = valid();
    states(m, 'proposals')['lockedWhenReferencedBy'] = [{ table: 'invoices', via: 'client_id', in: ['sent'] }];
    expectIssue(m, '"invoices.client_id" does not point at "proposals"');
    m = valid();
    states(m, 'proposals')['lockedWhenReferencedBy'] = [{ table: 'nope', via: 'x', in: ['sent'] }];
    expectIssue(m, '"nope" is not a table of this manifest');
    m = valid();
    states(m, 'proposals')['lockedWhenReferencedBy'] = [{ table: 'proposal_lines', via: 'proposal_id', in: ['sent'] }];
    delete states(m, 'proposals')['lock'];
    expectIssue(m, 'a row locked by a reference needs a lock to say what stays open');
    m = valid();
    states(m, 'proposals')['noDelete'] = { when: ['sent', 'gone'] };
    expectIssue(m, '"gone" is not a value of "proposals.status"');
    m = valid();
    states(m, 'proposals')['onlyLater'] = ['nope'];
    expectIssue(m, '"proposals" has no column "nope"');
  });
});

describe('text stored normalised, stamps that copy or leave staff their choice, dates before today', () => {
  it('normalises only text', () => {
    let m = valid();
    (columnOf(m, 'clients', 'email') as Doc)['rules'] = { normalize: 'email' };
    expect(issuesText(m)).toBe('');
    m = valid();
    (columnOf(m, 'invoices', 'number_seq')['rules'] as Doc)['normalize'] = 'trim';
    expectIssue(m, 'only text is stored trimmed or in lower case');
  });

  it('copies another column of the same type, and lets staff keep their own value', () => {
    let m = valid();
    columnOf(m, 'proposals', 'signed_email')['rules'] = { stamp: { set: { copy: 'signed_name' }, on: 'create' } };
    expect(issuesText(m)).toBe('');
    m = valid();
    columnOf(m, 'proposals', 'signed_email')['rules'] = { stamp: { set: { copy: 'signed_email' }, on: 'create' } };
    expectIssue(m, 'a stamp copies another column');
    m = valid();
    columnOf(m, 'proposals', 'signed_email')['rules'] = { stamp: { set: { copy: 'client_id' }, on: 'create' } };
    expectIssue(m, '"proposals.client_id" is a fk, and "signed_email" a text');
    m = valid();
    columnOf(m, 'proposals', 'signed_email')['rules'] = { stamp: { set: { copy: 'nope' }, on: 'create' } };
    expectIssue(m, '"proposals" has no column "nope"');
    m = valid();
    columnOf(m, 'invoices', 'ladder')['rules'] = { stamp: { set: { byOrigin: { public: 'firm' } }, on: 'create' } };
    expect(issuesText(m)).toBe('');
    m = valid();
    columnOf(m, 'invoices', 'ladder')['rules'] = { stamp: { set: { byOrigin: { public: 'nope' } }, on: 'create' } };
    expectIssue(m, '"nope" is not a value of "invoices.ladder"');
  });

  it('takes before-today on a date only, and more than sixteen templates', () => {
    let m = valid();
    (entryOf(m, 'proposals')['writableWhen'] as Doc)['valid_until'] = 'before-today';
    expect(issuesText(m)).toBe('');
    m = valid();
    (entryOf(m, 'proposals')['writableWhen'] as Doc)['status'] = 'before-today';
    expectIssue(m, '"before-today" needs a date, and "status" is not one');
    m = valid();
    const templates = m['emailTemplates'] as Doc[];
    for (let i = 0; i < 20; i++) templates.push({ ...structuredClone(templates[0]!), key: `studio-extra-${String(i)}` });
    expect(issuesText(m)).toBe('');
  });
});

describe('the outbox, the rarer refusals', () => {
  it('gates a producer by a switch of the settings row', () => {
    let m = valid();
    (m['requiredSchema'] as { tables: Doc[] }).tables[0]!['columns'] = [
      ...((m['requiredSchema'] as { tables: Doc[] }).tables[0]!['columns'] as Doc[]),
      { ref: 'notify_sent', type: 'bool', default: true },
    ];
    producers(m)[1]!['gate'] = { setting: { table: 'settings', column: 'notify_sent' } };
    expect(issuesText(m)).toBe('');
    m = valid();
    producers(m)[1]!['gate'] = { setting: { table: 'settings', column: 'reply_to' } };
    expectIssue(m, '"settings.reply_to" must be a bool');
  });

  it('types the new outbox columns', () => {
    let m = valid();
    ((m['outbox'] as Doc)['columns'] as Doc)['effectAt'] = 'to';
    expectIssue(m, '"messages.to" must be a timestamptz');
    m = valid();
    ((m['outbox'] as Doc)['columns'] as Doc)['bodyOverride'] = 'due';
    expectIssue(m, '"messages.due" must be a text column');
  });

  it('reads a setting only of an add-on the app requires, or of a real column', () => {
    let m = valid();
    producers(m)[1]!['recipient'] = { setting: { addOn: 'holiday-calendars', setting: 'x' } };
    expectIssue(m, '"holiday-calendars" is not required by the app');
    m = valid();
    producers(m)[1]!['recipient'] = { setting: { table: 'settings', column: 'nope' } };
    expectIssue(m, '"settings" has no column "nope"');
  });

  it('gives every value of a column its days, and keeps due off a reminder before a moment', () => {
    let m = valid();
    (producers(m)[0]!['due'] as Doc)['days'] = { byColumn: 'ladder', values: { gentle: 7 } };
    expectIssue(m, 'each value of "invoices.ladder" needs its days (standard, firm)');
    m = valid();
    (producers(m)[0]!['due'] as Doc)['date'] = 'number';
    expectIssue(m, '"invoices.number" must be a date');
    m = valid();
    delete producers(m)[0]!['due'];
    expectIssue(m, 'one message overtakes another when it comes due: name its due');
  });

  it('takes a batch\'s window as its due, and no other', () => {
    let m = valid();
    producers(m)[0]!['batchMinutes'] = 10;
    expectIssue(m, 'a batch comes due when its window closes, so it takes no due of its own');
    m = valid();
    delete producers(m)[0]!['due'];
    producers(m)[0]!['batchMinutes'] = 10;
    // Overtaken and dropped like any message that waits: its window is its wait.
    expect(issuesText(m)).not.toContain('name its due');
    expect(issuesText(m)).not.toContain('only a message that waits');
  });

  it('fits a drop condition\'s values, and an onSent change to its table', () => {
    let m = valid();
    (producers(m)[0]!['dropWhen'] as Doc[])[1]!['eq'] = 'paid';
    expectIssue(m, '"paid" is not a value of "invoices.status"');
    m = valid();
    (producers(m)[0]!['onSent'] as Doc)['table'] = 'nope';
    expectIssue(m, '"nope" is not a table of this app');
    m = valid();
    delete (producers(m)[0]!['onSent'] as Doc)['via'];
    expectIssue(m, 'the message is about "invoices"; name the foreign key (via) that reaches "projects"');
    m = valid();
    (producers(m)[0]!['onSent'] as Doc)['set'] = { status: null };
    expectIssue(m, '"projects.status" is never empty');
    m = valid();
    (producers(m)[0]!['onSent'] as Doc)['set'] = { nope: 1 };
    expectIssue(m, '"projects" has no column "nope"');
  });

  it('links a child source to the row its foreign key points at', () => {
    let m = valid();
    producers(m)[1] = { kind: 'invoice-sent', link: 'invoice_id', onCreate: { table: 'payments', via: 'document_id' }, batchMinutes: 10 };
    expect(issuesText(m)).toBe('');
    m = valid();
    producers(m)[1] = { kind: 'invoice-sent', link: 'invoice_id', onCreate: { table: 'payments' } };
    expectIssue(m, '"messages.invoice_id" does not point at "payments"');
    m = valid();
    producers(m)[1] = { kind: 'invoice-sent', link: 'invoice_id', onCreate: { table: 'payments', via: 'amount' } };
    expectIssue(m, '"payments.amount" must be a foreign key');
  });
});

describe('public access, the rarer refusals', () => {
  it('asks a key with no staff behind it for a token identity', () => {
    let m = valid();
    (m['publicKeys'] as Doc)['open'] = {};
    expectIssue(m, 'a key no staff signs in opens one row by its token: "open" needs an entry that claims by token');
    m = valid();
    const token = entryOf(m, 'projects', 'handover')['claim'] as Doc;
    token['column'] = 'nope';
    expectIssue(m, '"projects" has no column "nope"');
  });

  it('checks a token\'s expiry and its stop switch', () => {
    let m = valid();
    (entryOf(m, 'projects', 'handover')['claim'] as Doc)['expires'] = 'status';
    expectIssue(m, '"projects.status" is not a date');
    m = valid();
    (entryOf(m, 'projects', 'handover')['claim'] as Doc)['expires'] = 'nope';
    expectIssue(m, '"projects" has no column "nope"');
    m = valid();
    (entryOf(m, 'projects', 'handover')['claim'] as Doc)['stopped'] = 'status';
    expectIssue(m, '"projects.status" is not a bool of this app');
  });

  it('refuses an off switch on a shared link\'s key, which nothing would read', () => {
    const m = valid();
    const handover = (m['publicKeys'] as Doc)['handover'] as Doc;
    handover['enabledBy'] = { table: 'projects', column: 'share_stopped' };
    expectIssue(m, '"handover" opens a row by its link, which is switched off in that row, not by a setting');
  });

  it('keeps a link identity\'s address in a text column', () => {
    let m = valid();
    (entryOf(m, 'clients')['claim'] as Doc)['email'] = 'id';
    expectIssue(m, '"clients.id" is not a text column');
    m = valid();
    (entryOf(m, 'clients')['claim'] as Doc)['email'] = 'nope';
    expectIssue(m, '"clients" has no column "nope"');
  });

  it('finds exactly one parent, no more than two steps from the claim', () => {
    let m = valid();
    (m['publicAccess'] as Doc[]).push({ ...structuredClone(entryOf(m, 'invoices')), methods: ['GET'] });
    expectIssue(m, 'more than one entry reads "invoices" on the "customer" key, so the parent is not clear');
    m = valid();
    (entryOf(m, 'invoice_lines')['visibleWith'] as Doc)['table'] = 'settings';
    expectIssue(m, 'no entry reads "settings" on the "customer" key');
    m = valid();
    entryOf(m, 'invoice_lines')['claimedBy'] = { table: 'clients', column: 'document_id' };
    expectIssue(m, 'an entry is claimed or visible with a parent, not both');
    m = valid();
    entryOf(m, 'clients')['visibleWith'] = { table: 'invoices', via: 'client_id' };
    expectIssue(m, 'an identity is not also visible through another');
  });

  it('follows a chain of visibleWith, and refuses one three steps long or leading nowhere', () => {
    const chain = valid();
    const tables = (chain['requiredSchema'] as { tables: Doc[] }).tables;
    tables.push({ ref: 'line_notes', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'line_id', type: 'fk', references: 'invoice_lines' }] });
    tables.push({ ref: 'note_pins', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'note_id', type: 'fk', references: 'line_notes' }] });
    const access = chain['publicAccess'] as Doc[];
    access.push({ table: 'line_notes', methods: ['GET'], select: ['id'], visibleWith: { table: 'invoice_lines', via: 'line_id' }, level: 'verified' });
    expect(issuesText(chain)).toBe('');
    access.push({ table: 'note_pins', methods: ['GET'], select: ['id'], visibleWith: { table: 'line_notes', via: 'note_id' }, level: 'verified' });
    expectIssue(chain, 'an entry is at most two steps from the entry its person claims');

    const loop = valid();
    const loopTables = (loop['requiredSchema'] as { tables: Doc[] }).tables;
    loopTables.push({ ref: 'a', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'b_id', type: 'fk', references: 'b' }] });
    loopTables.push({ ref: 'b', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'a_id', type: 'fk', references: 'a' }] });
    (loop['publicAccess'] as Doc[]).push(
      { table: 'a', methods: ['GET'], select: ['id'], visibleWith: { table: 'b', via: 'b_id' } },
      { table: 'b', methods: ['GET'], select: ['id'], visibleWith: { table: 'a', via: 'a_id' } },
    );
    expectIssue(loop, 'the entries it is visible with lead to no claimed person');
  });

  it('keeps files and documents to a signed-in person\'s rows, and files to text', () => {
    let m = valid();
    (m['publicAccess'] as Doc[]).push({ table: 'settings', methods: ['GET'], select: ['reply_to'], files: ['reply_to'] });
    expectIssue(m, 'files and documents are a signed-in person\'s own: the entry needs a claim');
    m = valid();
    entryOf(m, 'projects', 'handover')['files'] = ['share_stopped'];
    entryOf(m, 'projects', 'handover')['select'] = ['share_stopped'];
    expectIssue(m, '"projects.share_stopped" is not a text column holding a file');
    m = valid();
    entryOf(m, 'projects', 'handover')['files'] = ['nope'];
    expectIssue(m, '"projects" has no column "nope"');
  });

  it('refuses a verified level where the identity sends no code and opens no link', () => {
    const m = valid();
    const clients = entryOf(m, 'clients');
    clients['claim'] = { match: ['email'] };
    delete clients['humanCheck'];
    expectIssue(m, 'the "customer" key\'s identity sends no code, so no session is ever verified');
  });
});

describe('the shape\'s own checks and conformance, the rarer paths', () => {
  const shapeList = (m: Doc) => (m['addOn'] as Doc)['shapes'] as Doc[];

  it('reads parts of another shape by name@version/part, and checks outbox parts and templates', () => {
    let m = addOnManifest();
    const quote = { name: 'quote', version: 1, parts: { document: { columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'total', type: 'decimal', nullable: true }] } } };
    shapeList(m).push(quote);
    const lines = (shapeList(m)[0]!['parts'] as Record<string, { columns: Doc[] }>)['lines']!;
    lines.columns.push({ ref: 'quote_id', type: 'fk', references: 'quote@1/document', nullable: true });
    lines.columns.push({ ref: 'quote_total', type: 'decimal', nullable: true, rules: { copy: { via: 'quote_id', from: 'total' } } });
    expect(issuesText(m)).toBe('');
    m = addOnManifest();
    ((shapeList(m)[0]!['outbox'] as Doc)['producers'] as Doc[])[0]!['onChange'] = { table: 'invoice', column: 'status', to: 'sent' };
    expectIssue(m, '"invoice@1" has no part "invoice"');
    m = addOnManifest();
    ((shapeList(m)[0]!['outbox'] as Doc)['templates'] as Doc[])[0]!['kind'] = 'invoice-rung-9';
    expectIssue(m, 'no producer sends "invoice-rung-9"');
    m = addOnManifest();
    (shapeList(m)[0]!['parts'] as Doc)['document'] = { columns: [] };
    expectIssue(m, 'addOn.shapes.0.parts.document.columns');
    m = addOnManifest();
    ((((shapeList(m)[0]!['parts'] as Record<string, Doc>)['document']!['columns'] as Doc[]).find((c) => c['ref'] === 'tax_rate')!['rules'] as Doc)['default'] = { from: { addOn: 'other', setting: 'x' } });
    expectIssue(m, 'a shape reads only its own add-on\'s settings, not "other"');
    m = addOnManifest();
    (shapeList(m)[0]!['documentProfiles'] as Doc[])[0]!['mapping'] = { n: { column: 'nope' } };
    expectIssue(m, '"document" has no column "nope"');
  });

  const shapes = (mutate?: (shape: Doc) => void): Map<string, ShapeDefinitionView> => {
    const shape = structuredClone(shapeList(addOnManifest())[0]!);
    mutate?.(shape);
    return new Map([[shapeKey('invoices', shape as unknown as ShapeDefinitionView), shape as unknown as ShapeDefinitionView]]);
  };
  const conformance = (m: Doc, map = shapes()) => shapeConformanceIssues(m as never, map).map((i) => i.message).join('\n');
  const partStates = (shape: Doc) => (shape['parts'] as Record<string, Doc>)['document']!['states'] as Doc;

  it('names a part the shape lacks, and states the app dropped', () => {
    let m = valid();
    tableOf(m, 'payments')['part'] = 'refunds';
    expect(conformance(m)).toContain('"invoices/invoice@1" has no part "refunds"');
    m = valid();
    delete tableOf(m, 'invoices')['states'];
    expect(conformance(m)).toContain('"invoices" drops the shape\'s states');
    // A part with no states leaves the app's own states alone.
    m = valid();
    tableOf(m, 'payments')['states'] = { column: 'voided', initial: 'x', moves: {} };
    expect(conformance(m)).toBe('');
  });

  it('compares a lock, its children and the rest of the states', () => {
    let m = valid();
    expect(conformance(m, shapes((shape) => delete partStates(shape)['lock']))).toContain('the shape locks nothing');
    m = valid();
    delete (states(m, 'invoices')['children'] as Doc)['payments'];
    expect(conformance(m)).toContain('"payments" is tied to the state as the shape ties it');
    m = valid();
    expect(conformance(m, shapes((shape) => (((partStates(shape)['children'] as Doc)['payments'] as Doc)['clearOnCreate'] = ['void_reason'])))).toContain(
      'creating a "payments" row empties void_reason, as the shape says',
    );
    m = valid();
    states(m, 'invoices')['noDelete'] = { when: ['void'] };
    expect(conformance(m)).toContain('noDelete is the shape\'s');
    m = valid();
    states(m, 'invoices')['initial'] = 'sent';
    expect(conformance(m)).toContain('the state column and the first state are the shape\'s');
    m = valid();
    (states(m, 'invoices')['lock'] as Doc)['when'] = ['void'];
    expect(conformance(m)).toContain('the lock is the shape\'s');
  });

  it('lets an app put a copy in front of a column the shape fills from a setting, and nowhere else', () => {
    let m = valid();
    (columnOf(m, 'invoices', 'tax_rate')['rules'] as Doc)['copy'] = { via: 'client_id', from: 'contact_name' };
    expect(conformance(m)).toBe('');
    m = valid();
    (columnOf(m, 'invoices', 'ladder') as Doc)['rules'] = { copy: { via: 'client_id', from: 'contact_name' } };
    expect(conformance(m)).toContain('"invoices.ladder" adds a copy rule the shape does not keep');
  });

  it('maps part names inside a fingerprint and a reference lock before comparing', () => {
    const withHash = (shape: Doc) => {
      const doc = (shape['parts'] as Record<string, { columns: Doc[]; states: Doc }>)['document']!;
      doc.columns.push({
        ref: 'fingerprint',
        type: 'text',
        maxLength: 64,
        nullable: true,
        rules: {
          stamp: {
            set: { hashOf: { columns: ['number'], children: [{ table: 'lines', via: 'document_id', columns: ['amount'] }], linked: [{ via: 'x', table: 'lines', columns: ['amount'], children: [{ table: 'lines', via: 'document_id', columns: ['amount'] }] }] } },
            on: { column: 'status', values: ['sent'] },
          },
        },
      });
      doc.states['lockedWhenReferencedBy'] = [{ table: 'payments', via: 'document_id', in: ['sent'] }];
    };
    const m = valid();
    (tableOf(m, 'invoices')['columns'] as Doc[]).push({
      ref: 'fingerprint',
      type: 'text',
      maxLength: 64,
      nullable: true,
      rules: {
        stamp: {
          set: { hashOf: { columns: ['number'], children: [{ table: 'invoice_lines', via: 'document_id', columns: ['amount'] }], linked: [{ via: 'x', table: 'invoice_lines', columns: ['amount'], children: [{ table: 'invoice_lines', via: 'document_id', columns: ['amount'] }] }] } },
          on: { column: 'status', values: ['sent'] },
        },
      },
    });
    states(m, 'invoices')['lockedWhenReferencedBy'] = [{ table: 'payments', via: 'document_id', in: ['sent'] }];
    expect(conformance(m, shapes(withHash))).toBe('');
  });
});

describe('exact arithmetic, every value form and comparison', () => {
  it('reads what the drivers hand back, and nothing else', () => {
    expect(toRatio(12n)).toEqual({ n: 12n, d: 1n });
    expect(toRatio(true)).toEqual({ n: 1n, d: 1n });
    expect(toRatio('1.5e2')).toEqual({ n: 150n, d: 1n });
    expect(toRatio('2.5E-1')).toEqual({ n: 1n, d: 4n });
    expect(toRatio(' 7 ')).toEqual({ n: 7n, d: 1n });
    expect(toRatio('.5')).toEqual({ n: 1n, d: 2n });
    for (const bad of ['', '.', 'abc', '1,5', Number.NaN, Number.POSITIVE_INFINITY, {}, [], undefined, null]) expect(toRatio(bad)).toBeNull();
  });

  it('compares with eq, neq, isNull, and, or and the orderings', () => {
    const row = { kind: 'percent', on: 1, off: '0', n: '2.50', empty: null, blank: '' };
    const holds = (c: Parameters<typeof formulaHolds>[0]) => formulaHolds(c, row, 2);
    expect(holds({ eq: ['kind', 'percent'] })).toBe(true);
    expect(holds({ eq: ['on', true] })).toBe(true);
    expect(holds({ eq: ['off', false] })).toBe(true);
    expect(holds({ eq: ['n', 2.5] })).toBe(true);
    expect(holds({ eq: ['empty', 'x'] })).toBe(false);
    expect(holds({ neq: ['kind', 'amount'] })).toBe(true);
    expect(holds({ neq: ['empty', 'amount'] })).toBe(false);
    expect(holds({ isNull: 'empty' })).toBe(true);
    expect(holds({ isNull: 'blank' })).toBe(true);
    expect(holds({ isNull: 'n' })).toBe(false);
    expect(holds({ and: [{ gt: ['n', 2] }, { lte: ['n', 2.5] }] })).toBe(true);
    expect(holds({ or: [{ lt: ['n', 1] }, { gte: ['n', 2.5] }] })).toBe(true);
    expect(holds({ gt: ['empty', 1] })).toBe(false);
    expect(formulaColumns({ and: [{ isNull: 'a' }, { neq: ['b', 1] }, { gt: [{ add: ['c', 1] }, 0] }] })).toEqual(['a', 'b', 'c']);
    expect(evaluateFormula({ if: [{ isNull: 'empty' }, 1, 2] }, row, 0)).toBe('1');
    expect(evaluateFormula({ min: ['n', 1] }, row, 1)).toBe('1.0');
    expect(evaluateFormula({ max: ['n', 1] }, row, 1)).toBe('2.5');
    expect(evaluateFormula({ round: ['n', 0] }, row, 2)).toBe('3.00');
  });

  it('knows the currencies not written with two decimals', () => {
    expect(currencyScale('JPY')).toBe(0);
    expect(currencyScale('krw')).toBe(0);
    expect(currencyScale('KWD')).toBe(3);
    expect(currencyScale('EUR')).toBe(2);
    expect(currencyScale(null)).toBe(2);
    expect(currencyScale('EURO')).toBe(2);
    expect(evaluateFormula({ mul: ['a', 1] }, { a: '1.2345' }, 3)).toBe('1.235');
  });
});

describe('warnings', () => {
  it('say nothing about an add-on, and ride a refused manifest too', () => {
    const addOn = validateManifest(addOnManifest());
    expect(addOn.ok && manifestWarnings(addOn.manifest)).toEqual([]);
    const refused = validateManifest({ kind: 'app' });
    expect(refused.ok).toBe(false);
    expect(refused.warnings).toEqual([]);
    const m = valid();
    columnOf(m, 'settings', 'reply_to')['nullable'] = false;
    const result = validateManifest(m);
    expect(result.warnings.some((w) => w.path === 'requiredSchema.tables.0.columns.2')).toBe(true);
  });
});

describe('dates kept within dates', () => {
  it('bounds a payment by today and by its invoice, and refuses bounds that name nothing', () => {
    const paidOn = (m: Doc) => columnOf(m, 'payments', 'paid_on');
    let m = valid();
    paidOn(m)['rules'] = { notAfter: 'today', notBefore: { column: 'issued_on', via: 'document_id' } };
    expect(issuesText(m)).toBe('');
    m = valid();
    columnOf(m, 'invoices', 'due_on')['rules'] = { ...(columnOf(m, 'invoices', 'due_on')['rules'] as Doc), notBefore: { column: 'issued_on' } };
    expect(issuesText(m)).toBe('');
    m = valid();
    paidOn(m)['rules'] = { notBefore: { column: 'nope', via: 'document_id' } };
    expectIssue(m, '"invoices" has no column "nope"');
    m = valid();
    paidOn(m)['rules'] = { notBefore: { column: 'issued_on', via: 'amount' } };
    expectIssue(m, '"payments.amount" is not a foreign key');
    m = valid();
    paidOn(m)['rules'] = { notBefore: { column: 'total', via: 'document_id' } };
    expectIssue(m, '"invoices.total" is not a date');
    m = valid();
    paidOn(m)['rules'] = { notBefore: { column: 'paid_on' } };
    expectIssue(m, 'a date is bounded by another column');
    m = valid();
    (columnOf(m, 'payments', 'amount') as Doc)['rules'] = { notAfter: 'today' };
    expectIssue(m, 'only a date is kept within dates');
  });
});
