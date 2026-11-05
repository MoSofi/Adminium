// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A picture from a row's file column in an app's email (`email.image` with
 * `fileId: "{{ticket.photo}}"`): what `validate` takes and refuses without a
 * server. The whole value is one placeholder, of a file column that takes
 * pictures, on a row the message reaches through one of the outbox's links;
 * never a secret, a personal or a withheld column, and never a row of a list.
 */
import { describe, expect, it } from 'vitest';

import { namesAPlaceholder, ROW_PICTURE_MAX_BYTES, ROW_PICTURE_TYPES, rowPictureName } from '../src/index.js';
import { issuesText, tableOf, venue, type Doc } from './conditioned-moves-fixture.js';

const picture = (accept: string[] = ['png', 'jpeg'], more: Doc = {}): Doc => ({ ref: 'photo', type: 'text', maxLength: 64, nullable: true, rules: { file: { accept, maxBytes: 1048576 }, ...more } });

/** The venue with an outbox linking a ticket, whose photo an email shows. */
function mailing(image: Doc, photo: Doc = picture()): Doc {
  const m = venue();
  (tableOf(m, 'tickets')['columns'] as Doc[]).push(
    photo,
    { ref: 'scan', type: 'text', maxLength: 64, nullable: true, rules: { file: { accept: ['pdf'], maxBytes: 1048576 } } },
    { ref: 'holder_name', type: 'text', maxLength: 120, nullable: true },
  );
  (m['requiredSchema'] as { tables: Doc[] }).tables.push({
    ref: 'messages',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'kind', type: 'enum', enum: ['ticket-photo'] },
      { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
      { ref: 'to', type: 'text', maxLength: 254, nullable: true },
      { ref: 'order_id', type: 'fk', references: 'orders', nullable: true },
      { ref: 'ticket_id', type: 'fk', references: 'tickets', nullable: true },
    ],
  });
  m['outbox'] = {
    table: 'messages',
    columns: { kind: 'kind', status: 'status', to: 'to' },
    links: { order: 'order_id', ticket: 'ticket_id' },
    recipient: { via: 'order_id', table: 'orders', email: 'email' },
    kinds: { 'ticket-photo': 'venue-ticket-photo' },
    classes: { 'ticket-photo': 'service' },
  };
  // A file column, and a picture from one in an email: read by 0.3.28 and 0.3.45.
  m['compatibility'] = { minAdminiumVersion: '0.3.45' };
  m['emailTemplates'] = [
    {
      key: 'venue-ticket-photo',
      name: 'Your ticket photo',
      locales: { 'en-US': { subject: 'Your photo', blocks: [{ block: 'email.text', data: { text: 'Hi' } }, { block: 'email.image', data: { alt: 'Your photo', ...image } }] } },
    },
  ];
  return m;
}

describe('a picture from a row in an email', () => {
  it('reads its name only from a whole placeholder with no backup', () => {
    expect(rowPictureName('{{ticket.photo}}')).toBe('ticket.photo');
    expect(rowPictureName('  {{ ticket.photo }} ')).toBe('ticket.photo');
    expect(rowPictureName('file_0123456789abcdefghijklmn')).toBeNull();
    expect(rowPictureName('{{ticket.photo|none}}')).toBeNull();
    expect(rowPictureName('see {{ticket.photo}}')).toBeNull();
    expect(rowPictureName(42)).toBeNull();
    expect(namesAPlaceholder('see {{ticket.photo}}')).toBe(true);
    expect(namesAPlaceholder('file_0123456789abcdefghijklmn')).toBe(false);
    expect(ROW_PICTURE_TYPES).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
    expect(ROW_PICTURE_MAX_BYTES).toBe(2 * 1024 * 1024);
  });

  it('takes a file column of a linked row, required or not', () => {
    expect(issuesText(mailing({ fileId: '{{ticket.photo}}' }))).toBe('');
    expect(issuesText(mailing({ fileId: '{{ticket.photo}}', required: true }))).toBe('');
  });

  it('refuses a placeholder that is not the whole value, or has a backup', () => {
    expect(issuesText(mailing({ fileId: 'photo: {{ticket.photo}}' }))).toMatch(/fileId.*whole value/);
    expect(issuesText(mailing({ fileId: '{{ticket.photo|none}}' }))).toMatch(/whole value/);
  });

  it('refuses a row the message does not reach, a row of a list, and a name with no row', () => {
    expect(issuesText(mailing({ fileId: '{{guest.photo}}' }))).toMatch(/"guest" is not a row this message reaches/);
    expect(issuesText(mailing({ fileId: '{{practice.photo}}' }))).toMatch(/"practice" is not a row this message reaches/);
    expect(issuesText(mailing({ fileId: '{{row.photo}}' }))).toMatch(/a row of a list shows no picture/);
    expect(issuesText(mailing({ fileId: '{{photo}}' }))).toMatch(/names no row/);
  });

  it('refuses a column that is not a file column of pictures', () => {
    expect(issuesText(mailing({ fileId: '{{ticket.missing}}' }))).toMatch(/"tickets" has no column "missing"/);
    expect(issuesText(mailing({ fileId: '{{ticket.holder_name}}' }))).toMatch(/"tickets.holder_name" is not a file column/);
    expect(issuesText(mailing({ fileId: '{{ticket.scan}}' }))).toMatch(/"tickets.scan" takes no picture/);
  });

  it('refuses a secret or a personal file column, marked or guessed by its name', () => {
    expect(issuesText(mailing({ fileId: '{{ticket.photo}}' }, picture(['png'], { personal: true })))).toMatch(/"tickets.photo" is personal data, which an email never shows/);
    expect(issuesText(mailing({ fileId: '{{ticket.photo}}' }, picture(['png'], { secret: true })))).toMatch(/"tickets.photo" is a secret, which an email never shows/);
    // Guessed personal by its name, as the install guesses it: a passport's photo.
    const passport = { ...picture(['png']), ref: 'passport_photo' };
    expect(issuesText(mailing({ fileId: '{{ticket.passport_photo}}' }, passport))).toMatch(/"tickets.passport_photo" is personal data, which an email never shows/);
  });

  it('needs Adminium 0.3.45', () => {
    const m = mailing({ fileId: '{{ticket.photo}}' });
    m['compatibility'] = { minAdminiumVersion: '0.3.44' };
    expect(issuesText(m)).toMatch(/"email.rowPicture" is read by Adminium 0.3.45 and later/);
  });

  it('refuses a "required" that is not true or false', () => {
    expect(issuesText(mailing({ fileId: '{{ticket.photo}}', required: 'yes' }))).toMatch(/"required" is true or false/);
  });
});
