// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an app's outbox may say about a change: a message when some columns
 * change (`onChange {columns, changed: true}`), one per change (`repeat`),
 * the row as it was (`was`, kept in the outbox's `was` column); a Reply-To
 * from its settings; a document a template may go without (`attach.optional`)
 * and the paragraph that goes with it (`withAttachment`); and a code read in
 * groups of four, in an email's rows and in a document.
 */
import { describe, expect, it } from 'vitest';

import { groupedCode } from '../src/index.js';
import { issuesText, tableOf, venue, type Doc } from './conditioned-moves-fixture.js';

function mailing(): Doc {
  const m = venue();
  (tableOf(m, 'orders')['columns'] as Doc[]).push(
    { ref: 'code', type: 'text', maxLength: 16, nullable: true, rules: { code: { length: 8 } } },
    { ref: 'note', type: 'text', maxLength: 200, nullable: true },
    { ref: 'secret_note', type: 'text', maxLength: 200, nullable: true, rules: { secret: true } },
    { ref: 'resend_at', type: 'timestamptz', nullable: true },
  );
  (tableOf(m, 'settings')['columns'] as Doc[]).push({ ref: 'house_email', type: 'text', maxLength: 254, nullable: true }, { ref: 'house_size', type: 'int', default: 1 });
  (m['requiredSchema'] as { tables: Doc[] }).tables.push({
    ref: 'messages',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'kind', type: 'enum', enum: ['moved', 'resend', 'paid'] },
      { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
      { ref: 'to', type: 'text', maxLength: 254, nullable: true },
      { ref: 'order_id', type: 'fk', references: 'orders', nullable: true },
      { ref: 'was', type: 'text', nullable: true },
      { ref: 'short', type: 'text', maxLength: 200, nullable: true },
    ],
  });
  m['outbox'] = {
    table: 'messages',
    columns: { kind: 'kind', status: 'status', to: 'to', was: 'was' },
    links: { order: 'order_id' },
    recipient: { via: 'order_id', table: 'orders', email: 'email' },
    settings: { table: 'settings', replyTo: 'house_email' },
    kinds: { moved: 'venue-moved', resend: 'venue-resend', paid: 'venue-paid' },
    producers: [
      { kind: 'moved', link: 'order_id', onChange: { table: 'orders', columns: ['held_until', 'pay_by'], changed: true }, repeat: true, was: ['held_until', 'pay_by', 'status'] },
      { kind: 'resend', link: 'order_id', onChange: { table: 'orders', columns: ['resend_at'], changed: true }, repeat: true },
      { kind: 'paid', link: 'order_id', onChange: { table: 'orders', column: 'status', to: 'paid' }, repeat: true },
    ],
  };
  const template = (kind: string, blocks: Doc[], attach?: Doc) => ({ key: `venue-${kind}`, name: kind, ...(attach === undefined ? {} : { attach }), locales: { 'en-US': { subject: kind, blocks } } });
  m['emailTemplates'] = [
    template('moved', [{ block: 'email.text', data: { text: 'Was {{was.held_until.date}}; code {{order.code.grouped}}' } }]),
    template('resend', [
      { block: 'email.rows', data: { from: { link: 'order', table: 'tickets', via: 'order_id' }, row: { title: '{{row.door}}' } } },
    ]),
    template('paid', [{ block: 'email.text', data: { text: 'Paid.' } }, { block: 'email.text', data: { text: 'Receipt attached.', withAttachment: true } }], { kind: 'receipt', link: 'order', optional: true }),
  ];
  return m;
}

const outbox = (m: Doc) => m['outbox'] as Doc;
const producers = (m: Doc) => outbox(m)['producers'] as Doc[];
const templates = (m: Doc) => m['emailTemplates'] as Doc[];
const blocksOf = (m: Doc, t: number) => ((templates(m)[t]!['locales'] as Doc)['en-US'] as Doc)['blocks'] as Doc[];

describe('an email of a change', () => {
  it('takes columns that changed, one message per change, the row as it was, a Reply-To and a document it may go without', () => {
    expect(issuesText(mailing())).toBe('');
  });

  it('refuses a column the table lacks, or one named twice', () => {
    let m = mailing();
    (producers(m)[0]!['onChange'] as Doc)['columns'] = ['nope'];
    expect(issuesText(m)).toContain('"orders" has no column "nope"');
    m = mailing();
    (producers(m)[0]!['onChange'] as Doc)['columns'] = ['pay_by', 'pay_by'];
    expect(issuesText(m)).toContain('"pay_by" is listed twice');
    m = mailing();
    (producers(m)[0]!['onChange'] as Doc)['changed'] = false;
    expect(issuesText(m)).not.toBe('');
  });

  it('sends one per change only from a producer of changes, and repeats no other way', () => {
    let m = mailing();
    producers(m)[1] = { kind: 'resend', link: 'order_id', onCreate: { table: 'orders' }, repeat: true };
    expect(issuesText(m)).toContain('a producer that listens for changes');
    m = mailing();
    producers(m)[2]!['repeatBy'] = 'pay_by';
    (outbox(m)['columns'] as Doc)['repeatKey'] = 'short';
    expect(issuesText(m)).toContain('takes no repeatBy');
  });

  it('keeps the row as it was only in a was column wide enough, and never a secret, personal or code column', () => {
    let m = mailing();
    delete (outbox(m)['columns'] as Doc)['was'];
    expect(issuesText(m)).toContain("in the outbox's was column, and none is named");
    m = mailing();
    (outbox(m)['columns'] as Doc)['was'] = 'short';
    expect(issuesText(m)).toContain('holds 1000 characters or more');
    m = mailing();
    (outbox(m)['columns'] as Doc)['was'] = 'order_id';
    expect(issuesText(m)).toContain('must be a text column');
    for (const [column, why] of [
      ['secret_note', 'a secret'],
      ['code', 'a code'],
      ['nope', 'has no column "nope"'],
    ] as const) {
      m = mailing();
      producers(m)[0]!['was'] = [column];
      expect(issuesText(m)).toContain(why);
    }
    m = mailing();
    producers(m)[2]!['was'] = ['status'];
    expect(issuesText(m)).toBe('');
    m = mailing();
    producers(m)[1] = { kind: 'resend', link: 'order_id', onCreate: { table: 'orders' }, was: ['status'] };
    expect(issuesText(m)).toContain('on a producer that listens for changes');
    // The was column is Adminium's to write: no rule of the app's decides or refuses it.
    m = mailing();
    ((tableOf(m, 'messages')['columns'] as Doc[]).find((c) => c['ref'] === 'was')!)['rules'] = { validation: { maxLength: 5000 } };
    expect(issuesText(m)).toContain('which Adminium writes');
  });

  it("takes a Reply-To only from a text column of the settings", () => {
    let m = mailing();
    (outbox(m)['settings'] as Doc)['replyTo'] = 'house_size';
    expect(issuesText(m)).toContain('a text column (an address)');
    m = mailing();
    (outbox(m)['settings'] as Doc)['replyTo'] = 'nope';
    expect(issuesText(m)).toContain('"settings" has no column "nope"');
  });

  it('marks a paragraph as the document\'s only where the template may go without it', () => {
    let m = mailing();
    delete (templates(m)[2]!['attach'] as Doc)['optional'];
    expect(issuesText(m)).toContain('(attach.optional)');
    m = mailing();
    (blocksOf(m, 2)[1]!['data'] as Doc)['withAttachment'] = 'yes';
    expect(issuesText(m)).toContain('withAttachment is true or absent');
    m = mailing();
    (templates(m)[2]!['attach'] as Doc)['optional'] = false;
    expect(issuesText(m)).not.toBe('');
  });

  it('reads a code in groups in a row, and no other column so', () => {
    let m = mailing();
    (tableOf(m, 'tickets')['columns'] as Doc[]).push({ ref: 'code', type: 'text', maxLength: 16, nullable: true, rules: { code: { length: 8 } } });
    ((blocksOf(m, 1)[0]!['data'] as Doc)['row'] as Doc)['title'] = '{{row.code.grouped}}';
    expect(issuesText(m)).toBe('');
    m = mailing();
    ((blocksOf(m, 1)[0]!['data'] as Doc)['row'] as Doc)['title'] = '{{row.door.grouped}}';
    expect(issuesText(m)).toContain('has no "grouped" form');
  });

  it('prints a code in groups of four', () => {
    expect(groupedCode('K7QXM2PD')).toBe('K7QX-M2PD');
    expect(groupedCode('k7qx-m2pd')).toBe('k7qx-m2pd');
    expect(groupedCode(' R4FN 7HCW ')).toBe('R4FN-7HCW');
    expect(groupedCode('ABCDEFGHIJ')).toBe('ABCD-EFGH-IJ');
    expect(groupedCode(null)).toBe('');
    expect(groupedCode('')).toBe('');
  });
});

describe('a document that prints a code in groups', () => {
  const withDocument = (form: Doc) => {
    const m = mailing();
    m['addOns'] = { suggests: [{ key: 'invoices', range: '>=1.0.0', reason: { 'en-US': 'Passes.' } }] };
    m['documents'] = [{ kind: 'pass', addOn: 'invoices', table: 'orders', name: 'Pass', mapping: { code: form } }];
    return m;
  };
  it('reads a code column in groups', () => {
    expect(issuesText(withDocument({ column: 'code', form: 'grouped' }))).toBe('');
  });
  it('refuses any other column in groups', () => {
    expect(issuesText(withDocument({ column: 'note', form: 'grouped' }))).toContain('is not a code column, so it is not printed in groups');
    expect(issuesText(withDocument({ column: 'code', form: 'spaced' }))).not.toBe('');
  });
});
