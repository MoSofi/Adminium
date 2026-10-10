// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A VALUE THAT IS MISSING.
 *
 * A template says itself what to write when a value is not there: a backup
 * word on a placeholder (`{{first_name|there}}`), and a block shown only when
 * a value is there, with other words in its place. Both are the renderer's,
 * so every sender has them; the stored document keeps them; a rule's own
 * fields read the same grammar.
 */
import { describe, expect, it } from 'vitest';

import { substitute } from '../src/automations/templating.js';
import { templatePlaceholders, templateRequiredPlaceholders } from '../src/automations/templates.js';
import { documentColumns, normalizeDocument } from '../src/email/document.js';
import { renderEmail } from '../src/email/render.js';
import { onlyReads } from '../src/outbox/sender.js';

const blocks = [
  { block: 'email.heading', id: 'h', data: { text: 'Thanks, {{first_name|there}}!' } },
  { block: 'email.text', id: 'a', showWhen: { var: 'first_name' }, otherwise: 'We hope <you> enjoyed it.', data: { paras: ['We hope you enjoyed it, {{first_name}}.', 'See you soon.'] } },
  { block: 'email.button', id: 'b', showWhen: { var: 'track_url' }, data: { label: 'Track {{order_no}}', url: '{{track_url}}' } },
  { block: 'email.text', id: 'c', data: { text: 'Order {{order_no}} to {{city|}}{{unknown}}' } },
];
const document = { subject: 'For {{first_name|you}}', preheader: 'Hi {{first_name|}}', blocks, footer: 'Sent to {{email|the address on file}}.' };
const render = (vars: Record<string, string>) => renderEmail({ document, locale: 'en_US', vars, dir: 'ltr' });

describe('a value that is missing', () => {
  it('the value is written where it is there, in the subject, the preheader, the blocks and the footer', () => {
    const out = render({ first_name: 'Lena', track_url: 'https://shop.example/t/1', order_no: 'A-7', city: 'Kyiv', email: 'lena@mail.example' });
    expect(out.subject).toBe('For Lena');
    expect(out.text).toContain('Thanks, Lena!');
    expect(out.text).toContain('We hope you enjoyed it, Lena.');
    expect(out.text).toContain('See you soon.');
    expect(out.text).toContain('Track A-7');
    expect(out.text).toContain('Order A-7 to Kyiv{{unknown}}');
    expect(out.text).toContain('Sent to lena@mail.example.');
    expect(out.html).toContain('Hi Lena');
  });

  it('the backup is written when it is not: absent, empty or blank; a block tied to it says its other words or is left out', () => {
    for (const vars of [{ order_no: 'A-7' }, { order_no: 'A-7', first_name: '', track_url: '', city: '' }, { order_no: 'A-7', first_name: '  ' }] as Record<string, string>[]) {
      const out = render(vars);
      expect(out.subject).toBe('For you');
      expect(out.text).toContain('Thanks, there!');
      expect(out.text).toContain('We hope <you> enjoyed it.');
      expect(out.text).not.toContain('See you soon.');
      expect(out.text).not.toContain('Track');
      expect(out.text).toContain('Order A-7 to {{unknown}}');
      expect(out.text).toContain('Sent to the address on file.');
      // The other words are a person's text like any other: escaped in the HTML part.
      expect(out.html).toContain('We hope &lt;you&gt; enjoyed it.');
      expect(out.html).not.toContain('{{first_name');
    }
  });

  it('a backup is escaped like a value', () => {
    const out = renderEmail({ document: { subject: 's', blocks: [{ block: 'email.text', data: { text: 'Hi {{name|<b>you</b>}}' } }] }, locale: 'en_US', vars: {}, dir: 'ltr' });
    expect(out.html).toContain('Hi &lt;b&gt;you&lt;/b&gt;');
    expect(out.text).toContain('Hi <b>you</b>');
  });

  it('a template stored before this reads as it did: no bar, no condition', () => {
    const old = { subject: '{{a}} {{b}}', blocks: [{ block: 'email.text', data: { text: '{{a}}|{{b}} | {{c}}' } }] };
    const out = renderEmail({ document: old, locale: 'en_US', vars: { a: 'x', b: '' }, dir: 'ltr' });
    expect(out.subject).toBe('x');
    expect(out.text).toContain('x| | {{c}}');
  });

  it('the stored document keeps a block\'s condition, and its other words only on a block that is one text', () => {
    const doc = normalizeDocument({
      subject: 's',
      blocks: [
        ...blocks,
        { block: 'email.button', id: 'x', showWhen: { var: 'u' }, otherwise: 'dropped: a button has no other words', data: {} },
        { block: 'email.text', id: 'y', showWhen: { var: 'not a name' }, otherwise: 'dropped with its condition', data: {} },
        { block: 'email.text', id: 'z', otherwise: 'dropped: tied to nothing', data: {} },
      ],
    });
    const by = Object.fromEntries(doc.blocks.map((block) => [block.id, block]));
    expect(by['a']).toMatchObject({ showWhen: { var: 'first_name' }, otherwise: 'We hope <you> enjoyed it.' });
    expect(by['b']).toMatchObject({ showWhen: { var: 'track_url' } });
    expect(by['b']!.otherwise).toBeUndefined();
    expect(by['x']).toMatchObject({ showWhen: { var: 'u' } });
    expect(by['x']!.otherwise).toBeUndefined();
    for (const id of ['c', 'y', 'z']) {
      expect(by[id]!.showWhen).toBeUndefined();
      expect(by[id]!.otherwise).toBeUndefined();
    }
    // And what is written back to the row carries them.
    const stored = Object.fromEntries(documentColumns(doc).blocks.map((block) => [block['id'], block]));
    expect(stored['a']).toMatchObject({ showWhen: { var: 'first_name' }, otherwise: 'We hope <you> enjoyed it.' });
    expect(Object.keys(stored['c']!)).toEqual(['id', 'block', 'data', 'style']);
  });

  it('a template reads every name, and must be given only those with no backup in a block that is shown', () => {
    const template = { subject: document.subject, preheader: document.preheader, blocks, footer: document.footer };
    expect(templatePlaceholders(template)).toEqual(['first_name', 'order_no', 'track_url', 'city', 'unknown', 'email']);
    // Whoever reads it: `first_name` and `track_url` are read only inside the blocks tied to them.
    expect(templateRequiredPlaceholders(template)).toEqual(['order_no', 'unknown']);
    // For a customer with no first name and no tracking: the blocks that read them are not shown, and ask for nothing.
    expect(templateRequiredPlaceholders(template, { order_no: 'A-7' })).toEqual(['order_no', 'unknown']);
  });

  it('a block that is shown asks for nothing its other words read', () => {
    const tied = { subject: 'Hello', preheader: '', footer: '', blocks: [{ id: 'a', block: 'email.text', data: { text: 'Hi {{first_name}}' }, showWhen: { var: 'first_name' }, otherwise: 'Hi {{nickname}}' }] };
    expect(templateRequiredPlaceholders(tied, { first_name: 'Lena' })).toEqual(['first_name']);
    // Left out for this reader, its other words are what is printed, and they are asked for.
    expect(templateRequiredPlaceholders(tied, {})).toEqual(['nickname']);
  });

  it('a person\'s own wording still reads only what the template reads, however a name is spelled', () => {
    const reads = new Set(['client.name']);
    // With a backup, a name the template does not read is taken out like any other: the renderer never meets it.
    const kept = onlyReads('Dear {{client.name|friend}}, {{client.tax_id|x}} {{ client.tax_id | }} {{client.tax_id}}!', reads);
    expect(kept).toBe('Dear {{client.name|friend}},   !');
    const out = renderEmail({ document: { subject: 's', blocks: [{ block: 'email.text', data: { text: kept } }] }, locale: 'en_US', vars: { 'client.name': '', 'client.tax_id': 'SECRET-1' }, dir: 'ltr' });
    expect(out.text).toContain('Dear friend,');
    expect(out.text).not.toContain('SECRET-1');
  });

  it('a rule\'s own fields read the same grammar', () => {
    expect(substitute('Dear {{record.first_name|customer}}, {{record.city}} {{nope}} {{nope|}}', { 'record.first_name': '', 'record.city': 'Kyiv' })).toBe('Dear customer, Kyiv {{nope}} ');
  });
});
