// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An email that lists rows (an order's tickets, each with its QR code) and a
 * QR code in an image, in the manifest: what a template may say, and what
 * `validate` refuses without a server.
 */
import { describe, expect, it } from 'vitest';

import { emailRowsDataSchema } from '../src/index.js';
import { unlistedColumn } from '../src/public-access.js';
import { issuesText, tableOf, venue, type Doc } from './conditioned-moves-fixture.js';

/** The venue with an outbox, a ticket code, and a confirmation listing the order's tickets. */
function mailing(): Doc {
  const m = venue();
  (tableOf(m, 'tickets')['columns'] as Doc[]).push(
    { ref: 'code', type: 'text', maxLength: 9, nullable: true, rules: { code: { length: 8 } } },
    { ref: 'holder_name', type: 'text', maxLength: 120, nullable: true },
    { ref: 'transferred', type: 'bool', default: false },
    { ref: 'position', type: 'int', default: 0 },
  );
  (m['requiredSchema'] as { tables: Doc[] }).tables.push(
    {
      ref: 'ticket_extras',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'ticket_id', type: 'fk', references: 'tickets' },
        { ref: 'name', type: 'text', maxLength: 80 },
      ],
    },
    {
      ref: 'messages',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'kind', type: 'enum', enum: ['order-confirmed'] },
        { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
        { ref: 'to', type: 'text', maxLength: 254, nullable: true },
        { ref: 'order_id', type: 'fk', references: 'orders', nullable: true },
        { ref: 'ticket_id', type: 'fk', references: 'tickets', nullable: true },
      ],
    },
  );
  m['outbox'] = {
    table: 'messages',
    columns: { kind: 'kind', status: 'status', to: 'to' },
    links: { order: 'order_id', ticket: 'ticket_id' },
    recipient: { via: 'order_id', table: 'orders', email: 'email' },
    kinds: { 'order-confirmed': 'venue-order-confirmed' },
  };
  const blocks = () => [
    { block: 'email.text', data: { text: 'Your tickets for order {{order.id}}' } },
    {
      block: 'email.rows',
      data: {
        from: { link: 'order', table: 'tickets', via: 'order_id', orderBy: 'position', where: { column: 'status', in: ['valid'] }, unless: 'transferred', limit: 50 },
        joins: { extras: { table: 'ticket_extras', via: 'ticket_id', column: 'name', separator: ', ' } },
        row: { title: '{{row.holder_name}}', meta: '{{row.event.name}} · {{row.code}} · {{row.extras}}', note: 'Doors {{row.event.doors_at.time}}', image: '{{row.code.qr}}' },
        empty: 'No tickets',
      },
    },
    { block: 'email.image', data: { qr: '{{ticket.code.qr}}', size: 116, alt: 'Your ticket' } },
  ];
  m['emailTemplates'] = [
    {
      key: 'venue-order-confirmed',
      name: 'Order confirmed',
      locales: { 'en-US': { subject: 'Your tickets', blocks: blocks() }, 'de-DE': { subject: 'Ihre Tickets', blocks: blocks() } },
    },
  ];
  return m;
}

const blocksOf = (m: Doc, locale = 'en-US') =>
  ((((m['emailTemplates'] as Doc[])[0]!['locales'] as Doc)[locale] as Doc)['blocks'] as Doc[]);
const rowsData = (m: Doc, locale = 'en-US') => blocksOf(m, locale)[1]!['data'] as Doc;

describe('an email that lists rows', () => {
  it('takes rows of a child of a linked row, with a join, one link of the row, forms and a QR code each', () => {
    expect(issuesText(mailing())).toBe('');
  });

  it('keeps its data strict: an unknown key, more than 50 rows, three joins, an image that is not a QR code', () => {
    expect(emailRowsDataSchema.safeParse({ ...rowsData(mailing()), extra: 1 }).success).toBe(false);
    let m = mailing();
    (rowsData(m)['from'] as Doc)['limit'] = 51;
    expect(issuesText(m)).not.toBe('');
    m = mailing();
    rowsData(m)['joins'] = { a: { table: 'ticket_extras', via: 'ticket_id', column: 'name' }, b: { table: 'ticket_extras', via: 'ticket_id', column: 'name' }, c: { table: 'ticket_extras', via: 'ticket_id', column: 'name' } };
    expect(issuesText(m)).toContain('a row joins one or two lists');
    m = mailing();
    (rowsData(m)['row'] as Doc)['image'] = 'https://example.com/a.png';
    expect(issuesText(m)).toContain("a row's image is a QR code of a code column: {{row.<column>.qr}}");
  });

  it('refuses other words nothing would print: with no value to hang on, or on a block that is not one text', () => {
    let m = mailing();
    Object.assign(blocksOf(m)[0]!, { showWhen: { var: 'order.id' }, otherwise: 'Your tickets' });
    Object.assign(blocksOf(m, 'de-DE')[0]!, { showWhen: { var: 'order.id' }, otherwise: 'Ihre Tickets' });
    // Only the floor is asked for (this fixture's is older): the words themselves are taken.
    expect(issuesText(m)).not.toContain('otherwise');
    m = mailing();
    Object.assign(blocksOf(m)[0]!, { otherwise: 'Your tickets' });
    expect(issuesText(m)).toContain('it needs a "showWhen"');
    m = mailing();
    Object.assign(blocksOf(m)[2]!, { showWhen: { var: 'order.id' }, otherwise: 'No picture' });
    expect(issuesText(m)).toContain('only a text or a heading block can say other words');
  });

  it('refuses a link the outbox lacks, a table or link that does not lead from it, and columns the rows lack', () => {
    let m = mailing();
    (rowsData(m)['from'] as Doc)['link'] = 'booking';
    expect(issuesText(m)).toContain('"booking" is not one of the outbox\'s links');
    m = mailing();
    (rowsData(m)['from'] as Doc)['via'] = 'event_id';
    expect(issuesText(m)).toContain('"tickets.event_id" does not point at the row "order" names');
    m = mailing();
    (rowsData(m)['from'] as Doc)['table'] = 'nope';
    expect(issuesText(m)).toContain('"nope" is not a table of this app');
    m = mailing();
    (rowsData(m)['from'] as Doc)['orderBy'] = 'nope';
    expect(issuesText(m)).toContain('"tickets" has no column "nope"');
    m = mailing();
    (rowsData(m)['from'] as Doc)['unless'] = 'position';
    expect(issuesText(m)).toContain('"tickets.position" is not a bool');
    m = mailing();
    (rowsData(m)['from'] as Doc)['where'] = { column: 'status', in: ['gone'] };
    expect(issuesText(m)).toContain('"gone" is not a value of "tickets.status"');
  });

  it('refuses a join that does not point at the rows, or joins a column that is not text', () => {
    let m = mailing();
    ((rowsData(m)['joins'] as Doc)['extras'] as Doc)['via'] = 'id';
    expect(issuesText(m)).toContain('"ticket_extras.id" does not point at "tickets"');
    m = mailing();
    ((rowsData(m)['joins'] as Doc)['extras'] as Doc)['column'] = 'ticket_id';
    expect(issuesText(m)).toContain('"ticket_extras.ticket_id" is not a text column');
  });

  it('refuses a join of a column no reader of an email may see listed: a secret, personal data, a code', () => {
    for (const [rules, kept] of [
      [{ secret: true }, 'a secret'],
      [{ personal: true }, 'personal data'],
      [{ code: { length: 8 } }, 'a code'],
    ] as const) {
      const m = mailing();
      ((tableOf(m, 'ticket_extras')['columns'] as Doc[]).find((c) => c['ref'] === 'name')!)['rules'] = rules;
      expect(issuesText(m)).toContain(`"ticket_extras.name" is ${kept}, which an email never lists from another row`);
    }
  });

  it('names every column a list one level down never prints', () => {
    const m = {
      publicAccess: [
        { table: 'tickets', methods: ['GET'], claim: { by: 'token', column: 'link_token' } },
        { table: 'tickets', methods: ['GET'], withhold: { columns: ['holder_email'], unlessHolder: 'holder_id' } },
      ],
      requiredSchema: {
        tables: [
          {
            ref: 'tickets',
            columns: [
              { ref: 'link_token', rules: { code: { length: 16 } } },
              { ref: 'holder_email' },
              { ref: 'promo' },
              { ref: 'promo_id', rules: { lookup: { from: 'promo', table: 'promos', column: 'code' } } },
              { ref: 'name' },
            ],
          },
        ],
      },
    } as never;
    expect(unlistedColumn(m, 'tickets', 'link_token')).toBe('the code a shared link opens its row with');
    expect(unlistedColumn(m, 'tickets', 'holder_email')).toBe('withheld from all but its holder');
    expect(unlistedColumn(m, 'tickets', 'promo')).toBe('a code a person typed');
    expect(unlistedColumn(m, 'tickets', 'name')).toBeNull();
  });

  it('refuses a {{row.*}} no row fills, a form its type lacks, and one outside a rows block', () => {
    let m = mailing();
    (rowsData(m)['row'] as Doc)['title'] = '{{row.nickname}}';
    expect(issuesText(m)).toContain('{{row.nickname}}: "tickets" has no column "nickname", no link "nickname_id" and no join "nickname"');
    m = mailing();
    (rowsData(m)['row'] as Doc)['title'] = '{{row.event.nope}}';
    expect(issuesText(m)).toContain('{{row.event.nope}}: "events" has no column "nope"');
    m = mailing();
    (rowsData(m)['row'] as Doc)['note'] = '{{row.valid_to.days_since}}';
    expect(issuesText(m)).toContain('"tickets.valid_to" is a timestamptz column, which has no "days_since" form');
    // A time of day kept as text: only a text column short enough to hold one (`15:00`) has the form.
    m = mailing();
    (rowsData(m)['row'] as Doc)['note'] = '{{row.holder_name.time}}';
    expect(issuesText(m)).toContain('{{row.holder_name.time}}: "tickets.holder_name" is not a time of day kept as text (a text column of at most 8 characters), so it has no "time" form');
    m = mailing();
    (tableOf(m, 'tickets')['columns'] as Doc[]).push({ ref: 'doors', type: 'text', maxLength: 5, nullable: true });
    (rowsData(m)['row'] as Doc)['note'] = 'Doors {{row.doors.time}}';
    expect(issuesText(m)).not.toContain('row.doors.time');
    m = mailing();
    blocksOf(m)[0]!['data'] = { text: 'Hi {{row.holder_name}}' };
    expect(issuesText(m)).toContain('{{row.…}} is read only inside an email.rows block');
  });

  it('lists the same rows in every language', () => {
    const m = mailing();
    (rowsData(m, 'de-DE')['from'] as Doc)['orderBy'] = 'id';
    expect(issuesText(m)).toContain('every language lists the same rows: from and joins are the same in each');
    const words = mailing();
    (rowsData(words, 'de-DE')['row'] as Doc)['note'] = 'Einlass {{row.event.doors_at.time}}';
    expect(issuesText(words)).toBe('');
  });
});

describe('a QR code', () => {
  it('is drawn only of a code column', () => {
    let m = mailing();
    (rowsData(m)['row'] as Doc)['image'] = '{{row.holder_name.qr}}';
    expect(issuesText(m)).toContain('"tickets.holder_name" is not a code column, so it has no QR code');
    m = mailing();
    blocksOf(m)[2]!['data'] = { qr: '{{ticket.door.qr}}' };
    expect(issuesText(m)).toContain('"tickets.door" is not a code column, so it has no QR code');
  });

  it('is only ever the whole value of an image', () => {
    let m = mailing();
    blocksOf(m)[0]!['data'] = { text: 'Your code: {{ticket.code.qr}}' };
    expect(issuesText(m)).toContain('a QR code is the whole value of an image (email.image "qr", or a row\'s "image"), nowhere else');
    m = mailing();
    ((m['emailTemplates'] as Doc[])[0]!['locales'] as Record<string, Doc>)['en-US']!['subject'] = '{{ticket.code.qr}}';
    expect(issuesText(m)).toContain('nowhere else');
    m = mailing();
    (rowsData(m)['row'] as Doc)['meta'] = '{{row.code.qr}}';
    expect(issuesText(m)).toContain('nowhere else');
    m = mailing();
    blocksOf(m)[2]!['data'] = { qr: 'Scan {{ticket.code.qr}}' };
    expect(issuesText(m)).toContain('nowhere else');
  });

  it('keeps an image QR code 80 to 200 pixels across, and a row\'s drawn by a rows block', () => {
    let m = mailing();
    blocksOf(m)[2]!['data'] = { qr: '{{ticket.code.qr}}', size: 300 };
    expect(issuesText(m)).toContain('a QR code is 80 to 200 pixels across');
    m = mailing();
    blocksOf(m)[2]!['data'] = { qr: '{{row.code.qr}}' };
    expect(issuesText(m)).toContain("a row's QR code is drawn by an email.rows block");
  });
});
