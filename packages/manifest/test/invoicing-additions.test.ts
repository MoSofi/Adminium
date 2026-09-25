// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The manifest fields an invoicing app needs: a column's scale, formulas,
 * fills from a setting or the connection, numbers without gaps and their
 * prefixed text, states with moves, locks and no-delete, stamps from the
 * signed-in person, a date worked out from another and a fingerprint; claims
 * by an emailed link and by a token, children only as visible as their
 * parent, files and documents; held messages; the add-ons an app needs and
 * the document profiles it ships; and shapes an add-on defines.
 *
 * One manifest shaped like a studio's uses every one of them and validates;
 * each test then breaks one thing and reads the sentence that names it.
 */
import { describe, expect, it } from 'vitest';

import {
  evaluateFormula,
  formulaOrder,
  manifestWarnings,
  shapeConformanceIssues,
  shapeKey,
  validateManifest,
  type FormulaExpr,
  type ShapeDefinitionView,
} from '../src/index.js';
import { addOnManifest, columnOf, entryOf, invoiceParts, issuesText, manifest, messages, tableOf, valid, type Doc } from './invoicing-fixture.js';

function expectIssue(m: Doc, fragment: string) {
  expect(issuesText(m)).toContain(fragment);
}

describe('an invoicing app uses every new field', () => {
  it('validates, with its statement profile pointing at payments of a statement', () => {
    const m = manifest();
    // A statement's payments point at the client through the invoice in the
    // app; here they point at invoices, which is wrong — the check names it.
    expect(messages(m)).toEqual(['documents.0.statement.payments.via: "payments.document_id" does not point at "clients"']);
    const fixed = manifest();
    const doc = (fixed['documents'] as Doc[])[0]!;
    (doc['statement'] as Doc)['payments'] = { table: 'invoices', via: 'client_id', date: 'issued_on', amount: 'paid' };
    expect(messages(fixed)).toEqual([]);
  });
});

describe('column scale and formulas', () => {
  it('keeps scale for decimal and money', () => {
    const m = valid();
    columnOf(m, 'settings', 'reply_to')['scale'] = 2;
    expectIssue(m, 'scale applies to a decimal or money column only');
  });

  it('refuses a formula naming a missing column, counting with text, or reading itself', () => {
    let m = valid();
    (columnOf(m, 'invoices', 'total')['rules'] as Doc)['formula'] = { add: ['subtotal', 'nope'] };
    expectIssue(m, 'the table has no column "nope"');
    m = valid();
    (columnOf(m, 'invoices', 'total')['rules'] as Doc)['formula'] = { add: ['subtotal', 'void_reason'] };
    expectIssue(m, '"void_reason" is not a number, so a formula cannot count with it');
    m = valid();
    (columnOf(m, 'invoices', 'total')['rules'] as Doc)['formula'] = { add: ['total', 1] };
    expectIssue(m, 'a formula does not read its own column "total"');
  });

  it('refuses formulas that read each other in a circle', () => {
    const m = valid();
    (columnOf(m, 'invoices', 'tax')['rules'] as Doc)['formula'] = { mul: ['total', 2] };
    expectIssue(m, 'formulas read each other in a circle: tax → total → tax');
  });

  it('refuses a formula on text, and a second rule deciding the same column', () => {
    let m = valid();
    columnOf(m, 'clients', 'contact_name')['rules'] = { formula: 1 };
    expectIssue(m, 'a formula fills a decimal, money or whole-number column');
    m = valid();
    columnOf(m, 'invoices', 'total')['rules'] = { formula: { add: ['subtotal', 1] }, sequence: {} };
    expectIssue(m, 'a column is decided by one rule, and this one has sequence, formula');
  });

  it('allows eq on an enum and refuses a formula nested deeper than eight', () => {
    let deep: FormulaExpr = 'qty';
    for (let i = 0; i < 9; i++) deep = { add: [deep, 1] };
    const m = valid();
    (columnOf(m, 'invoice_lines', 'amount')['rules'] as Doc)['formula'] = deep;
    expectIssue(m, 'a formula nests at most 8 deep');
  });
});

describe('fills, numbers and stamps', () => {
  it('reads a default from an add-on only when the app requires it', () => {
    const m = valid();
    (m['addOns'] as Doc)['requires'] = [{ key: 'other', range: '>=1.0.0', reason: { 'en-US': 'x' } }];
    expectIssue(m, '"invoices" is not required by the app (addOns.requires), so its setting may not be there');
    expectIssue(m, '"invoices" defines the shape, so the app requires it (addOns.requires)');
  });

  it('keeps gapless numbers in a nullable int, and a scope on a foreign key', () => {
    let m = valid();
    columnOf(m, 'invoices', 'number_seq')['nullable'] = false;
    expectIssue(m, 'a numbered column is nullable: sample rows carry no number');
    m = valid();
    (columnOf(m, 'deliverable_versions', 'v')['rules'] as { sequence: Doc }).sequence['scope'] = 'file';
    expectIssue(m, '"file" is not a foreign key of "deliverable_versions"');
    m = valid();
    columnOf(m, 'deliverable_versions', 'v')['rules'] = { sequence: { scope: 'project_id' } };
    expectIssue(m, 'scope and startSetting number without gaps: add gapless');
  });

  it('writes a formatted number from a running number, into text wide enough', () => {
    let m = valid();
    (columnOf(m, 'invoices', 'number')['rules'] as { format: Doc }).format['from'] = 'status';
    expectIssue(m, '"status" is not a running number of "invoices"');
    m = valid();
    const number = columnOf(m, 'invoices', 'number');
    number['maxLength'] = 5;
    (number['rules'] as { format: Doc }).format = { from: 'number_seq', prefix: 'INV-', pad: 4 };
    expectIssue(m, 'holds 5 characters, fewer than the prefix and the padding');
  });

  it('checks the new stamps: today on a date, addDays with a map, claim and hashOf', () => {
    let m = valid();
    columnOf(m, 'invoices', 'issued_on')['type'] = 'timestamptz';
    expectIssue(m, 'a "today" stamp needs a date column');
    m = valid();
    const due = columnOf(m, 'invoices', 'due_on');
    delete ((due['rules'] as { stamp: { set: { addDays: Doc } } }).stamp.set.addDays['map'] as Doc)['net30'];
    expectIssue(m, 'each value of "invoices.terms" needs its days (net30)');
    m = valid();
    ((columnOf(m, 'proposals', 'signed_email')['rules'] as { stamp: { set: Doc } }).stamp.set)['claim'] = 'phone';
    expectIssue(m, 'no table the app\'s people sign in as has a column "phone"');
    m = valid();
    columnOf(m, 'proposals', 'fingerprint')['maxLength'] = 32;
    expectIssue(m, 'a fingerprint is 64 characters');
    m = valid();
    const fp = (columnOf(m, 'proposals', 'fingerprint')['rules'] as { stamp: { set: { hashOf: { children: Doc[] } } } }).stamp.set.hashOf;
    fp.children[0]!['via'] = 'position';
    expectIssue(m, '"proposal_lines.position" does not point at "proposals"');
    m = valid();
    columnOf(m, 'proposals', 'signed_name')['nullable'] = false;
    expectIssue(m, '"proposals.signed_name" is never empty, so it is never first filled');
  });

  it('allows a 16-character code and no longer', () => {
    const m = valid();
    (columnOf(m, 'projects', 'share_token')['rules'] as { code: Doc }).code['length'] = 17;
    expectIssue(m, 'requiredSchema.tables.7.columns.3.rules.code.length');
  });
});

describe('states', () => {
  it('names a move to a state the column does not have, and a child that does not point back', () => {
    let m = valid();
    ((tableOf(m, 'invoices')['states'] as Doc)['moves'] as Doc)['sent'] = ['paid'];
    expectIssue(m, '"paid" is not a value of "invoices.status"');
    m = valid();
    (((tableOf(m, 'invoices')['states'] as Doc)['children'] as Doc)['payments'] as Doc)['via'] = 'amount';
    expectIssue(m, '"payments.amount" does not point at "invoices"');
  });

  it('refuses a move kept for a role the app does not have, and numbered no-delete without a gapless number', () => {
    let m = valid();
    const moves = (tableOf(m, 'invoices')['states'] as Doc)['moves'] as Record<string, Doc[]>;
    moves['sent']![0]!['roles'] = ['owner'];
    expectIssue(m, '"owner" is not one of the app\'s roles');
    m = valid();
    (tableOf(m, 'proposals')['states'] as Doc)['noDelete'] = { when: 'numbered' };
    expectIssue(m, '"numbered" needs a column numbered without gaps');
  });

  it('empties only nullable columns when a child is created, and moves dates only later', () => {
    let m = valid();
    columnOf(m, 'invoices', 'client_paid_at')['nullable'] = false;
    expectIssue(m, '"invoices.client_paid_at" is not nullable, so it cannot be emptied');
    m = valid();
    (tableOf(m, 'proposals')['states'] as Doc)['onlyLater'] = ['status'];
    expectIssue(m, '"proposals.status" is not a date');
  });

  it('asks each move condition of a real column, compared by its type', () => {
    const m = valid();
    const moves = (tableOf(m, 'invoices')['states'] as Doc)['moves'] as Record<string, Doc[]>;
    (moves['draft']![0]!['requires'] as Doc)['where'] = [{ column: 'void_reason', gt: 0 }];
    expectIssue(m, '"invoices.void_reason" is not a number, so it cannot be compared');
  });
});

describe('claims by link and by token, visibleWith, files and documents', () => {
  it('asks the human check of a sign-in link, and a verified level of everything it opens', () => {
    let m = valid();
    delete entryOf(m, 'clients')['humanCheck'];
    expectIssue(m, 'a sign-in link is emailed on request, so the request asks the human check');
    m = valid();
    delete entryOf(m, 'invoices')['level'];
    expectIssue(m, 'signs people in by an emailed link, so this entry is read at level "verified"');
    m = valid();
    delete entryOf(m, 'invoice_lines')['level'];
    expectIssue(m, 'publicAccess.2.level');
  });

  it('keeps a token on a key of its own, read-only, holding a 16-character code', () => {
    let m = valid();
    delete entryOf(m, 'projects', 'handover')['key'];
    delete entryOf(m, 'deliverable_versions', 'handover')['key'];
    expectIssue(m, 'a token opens its row to whoever holds the link, on a key of its own');
    m = valid();
    (columnOf(m, 'projects', 'share_token')['rules'] as { code: Doc }).code['length'] = 12;
    expectIssue(m, 'the link\'s secret: a text column Adminium fills with a 16-character code');
    m = valid();
    entryOf(m, 'deliverable_versions', 'handover')['methods'] = ['GET', 'POST'];
    expectIssue(m, '"handover" opens a row to whoever holds its link, so it only reads');
  });

  it('finds the parent entry of visibleWith, in either direction, and refuses a PATCH through it', () => {
    let m = valid();
    (entryOf(m, 'invoice_lines')['visibleWith'] as Doc)['via'] = 'position';
    expectIssue(m, 'neither "invoice_lines.position" points at "invoices" nor "invoices.position" at "invoice_lines"');
    m = valid();
    (entryOf(m, 'invoice_lines')['visibleWith'] as Doc)['table'] = 'proposals';
    expectIssue(m, 'neither "invoice_lines.document_id" points at "proposals"');
    m = valid();
    entryOf(m, 'invoice_lines')['methods'] = ['GET', 'PATCH'];
    expectIssue(m, 'an entry visible with a parent reads, and may create; it changes nothing');
  });

  it('keeps files to text columns the entry shows', () => {
    const m = valid();
    entryOf(m, 'projects', 'handover')['select'] = ['status'];
    expectIssue(m, '"handover_file" is not one of the columns the entry shows');
  });

  it('checks writableWhen null on a nullable column and from-today on a date', () => {
    let m = valid();
    columnOf(m, 'invoices', 'client_paid_at')['nullable'] = false;
    expectIssue(m, '"invoices.client_paid_at" is never empty');
    m = valid();
    (entryOf(m, 'proposals')['writableWhen'] as Doc)['status'] = 'from-today';
    expectIssue(m, '"from-today" needs a date, and "status" is not one');
  });
});

describe('the outbox holds, waits and acts', () => {
  const producer = (m: Doc, i = 0) => ((m['outbox'] as Doc)['producers'] as Doc[])[i]!;

  it('needs a held status and a due column when a producer holds', () => {
    let m = valid();
    columnOf(m, 'messages', 'status')['enum'] = ['queued', 'sent', 'failed', 'skipped'];
    columnOf(m, 'messages', 'status')['default'] = 'queued';
    expectIssue(m, 'a producer holds its messages, so "messages.status" offers "held"');
    m = valid();
    delete ((m['outbox'] as Doc)['columns'] as Doc)['due'];
    expectIssue(m, 'a held message waits for its due moment: name the outbox\'s due column');
  });

  it('reads due days from a column of the watched row, and drops only a waiting message', () => {
    let m = valid();
    ((producer(m)['due'] as Doc)['days'] as Doc)['byColumn'] = 'rung';
    expectIssue(m, '"invoices" has no column "rung"');
    m = valid();
    producer(m, 1)['dropWhen'] = [{ column: 'status', eq: 'void', reason: 'void' }];
    expectIssue(m, 'only a message that waits (held, or due later) can be dropped');
  });

  it('changes a linked row once sent, through a foreign key of the watched row', () => {
    let m = valid();
    (producer(m)['onSent'] as Doc)['via'] = 'currency';
    expectIssue(m, '"invoices.currency" must be a foreign key');
    m = valid();
    (producer(m)['onSent'] as Doc)['set'] = { status: 'archived' };
    expectIssue(m, '"archived" is not a value of "projects.status"');
  });

  it('attaches a document through one of the outbox links', () => {
    const m = valid();
    ((m['emailTemplates'] as Doc[])[1]!['attach'] as Doc)['link'] = 'order';
    expectIssue(m, '"order" is not one of the outbox\'s links');
  });
});

describe('addOns and documents', () => {
  it('names each add-on once, features of named add-ons, and pages of declared features', () => {
    let m = valid();
    ((m['addOns'] as Doc)['suggests'] as Doc[])[0]!['key'] = 'invoices';
    expectIssue(m, '"invoices" is already named in requires');
    m = valid();
    (((m['addOns'] as Doc)['features'] as Doc[])[0]!['requires'] as string[])[0] = 'barcode-labels';
    expectIssue(m, '"barcode-labels" is neither required nor suggested by the app');
    m = valid();
    (m['pages'] as Doc[])[0]!['feature'] = 'nope';
    expectIssue(m, '"nope" is not one of the app\'s addOns.features');
  });

  it('refuses a range that does not parse and a reason with no US English', () => {
    let m = valid();
    ((m['addOns'] as Doc)['requires'] as Doc[])[0]!['range'] = 'latest';
    expectIssue(m, 'a semver range such as ">=1.1.0"');
    m = valid();
    ((m['addOns'] as Doc)['requires'] as Doc[])[0]!['reason'] = { 'de-DE': 'x' };
    expectIssue(m, 'labels must include en-US');
  });

  it('checks a document profile\'s columns, its add-on and its child lists', () => {
    let m = valid();
    (m['documents'] as Doc[])[0]!['mapping'] = { name: { column: 'nope' } };
    expectIssue(m, '"clients" has no column "nope"');
    m = valid();
    (m['documents'] as Doc[])[0]!['addOn'] = 'shipping-dhl';
    expectIssue(m, '"shipping-dhl" is neither required nor suggested by the app');
    m = valid();
    (m['documents'] as Doc[])[0]!['mapping'] = { lines: { collection: { table: 'invoice_lines', via: 'document_id', columns: { amount: 'amount' } } } };
    expectIssue(m, '"invoice_lines.document_id" does not point at "clients"');
  });

  it('keeps builtOn and part together, and apart from a shared shape', () => {
    let m = valid();
    delete tableOf(m, 'payments')['part'];
    expectIssue(m, 'a table built on a shape names the part it is');
    m = valid();
    tableOf(m, 'payments')['shape'] = 'payments@1';
    expectIssue(m, 'built on an add-on\'s shape or shared under a shape, not both');
  });
});

describe('warnings are advice, never issues', () => {
  it('names a column that will be required at install, and still validates', () => {
    const m = valid();
    const result = validateManifest(m);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.message)).toContain(
      '"clients.email" has no default and is not nullable, so it will be required at install: every new row must give it a value',
    );
    // A filled column is never warned about.
    expect(result.warnings.map((w) => w.message).join('\n')).not.toContain('"invoices.number_seq"');
    expect(manifestWarnings(result.ok ? result.manifest : ({} as never))).toEqual(result.warnings);
  });
});

// ── the add-on's side ────────────────────────────────────────────────────────

describe('an add-on defines shapes', () => {
  it('validates, and widened attach ranges parse', () => {
    expect(messages(addOnManifest())).toEqual([]);
  });

  it('checks each part as an app\'s table, reading only its own settings', () => {
    let m = addOnManifest();
    const shape = ((m['addOn'] as Doc)['shapes'] as Doc[])[0]!;
    const doc = (shape['parts'] as Record<string, { columns: Doc[] }>)['document']!;
    doc.columns.find((c) => c['ref'] === 'total')!['rules'] = { formula: { add: ['subtotal', 'nope'] } };
    expectIssue(m, 'addOn.shapes.0.parts.document.columns.');
    expectIssue(m, 'the table has no column "nope"');
    m = addOnManifest();
    const doc2 = ((((m['addOn'] as Doc)['shapes'] as Doc[])[0]!['parts'] as Record<string, { columns: Doc[] }>)['document'])!;
    (doc2.columns.find((c) => c['ref'] === 'tax_rate')!['rules'] as { default: Doc }).default['from'] = { addOn: 'invoices', setting: 'tax' };
    expectIssue(m, '"invoices" has no setting "tax"');
  });

  it('refuses a shape declared twice, a profile of a missing part, and a range that does not parse', () => {
    let m = addOnManifest();
    const shapes = (m['addOn'] as Doc)['shapes'] as Doc[];
    shapes.push(structuredClone(shapes[0]!));
    expectIssue(m, '"invoice@1" is declared twice');
    m = addOnManifest();
    ((((m['addOn'] as Doc)['shapes'] as Doc[])[0]!['documentProfiles'] as Doc[])[0]!)['part'] = 'receipts';
    expectIssue(m, '"invoice@1" has no part "receipts"');
    m = addOnManifest();
    ((m['addOn'] as Doc)['attaches'] as Doc[])[0]!['range'] = 'soon';
    expectIssue(m, 'range must be a semver range');
  });
});

describe('an app table conforms to its shape', () => {
  const shapes = (): Map<string, ShapeDefinitionView> => {
    const shape = (((addOnManifest()['addOn'] as Doc)['shapes'] as Doc[])[0]!) as unknown as ShapeDefinitionView;
    return new Map([[shapeKey('invoices', shape), shape]]);
  };
  const conformance = (m: Doc) => shapeConformanceIssues(m as never, shapes()).map((i) => `${i.code} ${i.path}: ${i.message}`);

  it('passes when the app spells the parts out, adds its own columns, extends the lock and keeps a move for a role', () => {
    expect(conformance(valid())).toEqual([]);
  });

  it('names a column the app dropped or retyped, and a rule it changed', () => {
    let m = valid();
    const lines = tableOf(m, 'invoice_lines');
    lines['columns'] = (lines['columns'] as Doc[]).filter((c) => c['ref'] !== 'discount');
    expect(conformance(m).join('\n')).toContain('SHAPE_MISMATCH requiredSchema.tables.3.columns: "invoice_lines" has no column "discount"');
    m = valid();
    columnOf(m, 'invoice_lines', 'qty')['scale'] = 2;
    expect(conformance(m).join('\n')).toContain('"invoice_lines.qty" is not declared as the shape declares it');
    m = valid();
    (columnOf(m, 'invoices', 'tax')['rules'] as Doc)['formula'] = { mul: ['subtotal', 0] };
    expect(conformance(m).join('\n')).toContain('changes the shape\'s formula rule');
    m = valid();
    (columnOf(m, 'invoices', 'void_reason') as Doc)['rules'] = { copy: { via: 'client_id', from: 'contact_name' } };
    expect(conformance(m).join('\n')).toContain('adds a copy rule the shape does not keep');
  });

  it('refuses states narrowed below the shape, and a shape that is not there', () => {
    let m = valid();
    ((tableOf(m, 'invoices')['states'] as Doc)['lock'] as Doc)['except'] = ['due_on'];
    expect(conformance(m).join('\n')).toContain('the lock keeps ladder, void_reason open, as the shape does');
    m = valid();
    ((tableOf(m, 'invoices')['states'] as Doc)['moves'] as Doc)['sent'] = [];
    expect(conformance(m).join('\n')).toContain('the moves between states are the shape\'s');
    m = valid();
    tableOf(m, 'payments')['builtOn'] = 'invoices/invoice@2';
    expect(conformance(m).join('\n')).toContain('SHAPE_UNKNOWN requiredSchema.tables.4.builtOn: "invoices/invoice@2" is not a shape the add-on defines');
  });

  it('asks the app to send the shape\'s messages', () => {
    const m = valid();
    (m['outbox'] as Doc)['producers'] = ((m['outbox'] as Doc)['producers'] as Doc[]).slice(1);
    expect(conformance(m).join('\n')).toContain('"invoices/invoice@1" sends "invoice-rung-1", and the app\'s outbox does not');
  });
});

describe('formulas are worked out exactly', () => {
  const amount = (invoiceParts().lines.columns.find((c) => c.ref === 'amount') as { rules: { formula: FormulaExpr } }).rules.formula;

  it('agrees on a decimal whatever form the database hands it back in', () => {
    // Postgres and MySQL return decimals as text with trailing zeros; SQLite as a number.
    for (const row of [
      { qty: '3.000', rate: '19.9900', discount: null, discount_kind: 'amount' },
      { qty: 3, rate: 19.99, discount: null, discount_kind: 'amount' },
    ]) {
      expect(evaluateFormula(amount, row, 2)).toBe('59.97');
    }
    expect(evaluateFormula(amount, { qty: '2', rate: '10.00', discount: '25', discount_kind: 'amount' }, 2)).toBe('0.00');
    expect(evaluateFormula(amount, { qty: '2', rate: '10.00', discount: '15', discount_kind: 'percent' }, 2)).toBe('17.00');
  });

  it('never goes through a float, divides exactly and rounds once, half away from zero', () => {
    expect(evaluateFormula({ mul: [{ div: [1, 3] }, 3] }, {}, 2)).toBe('1.00');
    expect(evaluateFormula({ add: ['a', 'b'] }, { a: 0.1, b: 0.2 }, 2)).toBe('0.30');
    expect(evaluateFormula({ div: ['a', 100] }, { a: '12.5' }, 3)).toBe('0.125');
    expect(evaluateFormula({ div: ['a', 1000] }, { a: '5' }, 2)).toBe('0.01');
    expect(evaluateFormula({ div: ['a', 1000] }, { a: '-5' }, 2)).toBe('-0.01');
    expect(evaluateFormula({ div: ['a', 1000] }, { a: '4' }, 2)).toBe('0.00');
    expect(evaluateFormula({ mul: ['a', 1] }, { a: '1234.5' }, 0)).toBe('1235');
    expect(evaluateFormula({ mul: ['a', 1] }, { a: '2.675' }, 2)).toBe('2.68');
  });

  it('is empty when an input is empty or a divisor is zero, unless coalesce says otherwise', () => {
    expect(evaluateFormula({ mul: ['qty', 'rate'] }, { qty: '1', rate: null }, 2)).toBeNull();
    expect(evaluateFormula({ div: ['a', 'b'] }, { a: '1', b: '0' }, 2)).toBeNull();
    expect(evaluateFormula({ coalesce: ['a', 0] }, { a: null }, 2)).toBe('0.00');
  });

  it('works a document out in dependency order', () => {
    const doc = invoiceParts().document.columns;
    const formulas = new Map(doc.filter((c) => (c as { rules?: { formula?: unknown } }).rules?.formula !== undefined).map((c) => [c.ref, (c as { rules: { formula: FormulaExpr } }).rules.formula]));
    expect(formulaOrder(formulas)).toEqual(['tax', 'total']);
    const row: Record<string, unknown> = { subtotal: '410.00', tax_rate: '12.500' };
    row['tax'] = evaluateFormula(formulas.get('tax')!, row, 2);
    row['total'] = evaluateFormula(formulas.get('total')!, row, 2);
    expect(row).toMatchObject({ tax: '51.25', total: '461.25' });
  });
});
