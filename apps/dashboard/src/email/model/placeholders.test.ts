// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editor's reading of a placeholder. The first block is the SAME cases the
 * manifest package's `placeholders.test.ts` holds for the server's reading:
 * the two files are one grammar, and a change to one that is not made to the
 * other fails here or there.
 */
import { describe, expect, it } from 'vitest';

import { answeredNames, asMissing, blocksShownFor, fillPlaceholders, placeholderNames, placeholdersIn, requiredPlaceholderNames, showWhenNames, showWhenOf, spokenName, withBackup, writePlaceholder } from './placeholders.js';

describe('a placeholder, and its backup (the cases the server holds too)', () => {
  it('reads the name, and the words after a bar', () => {
    expect(placeholdersIn('Thanks, {{first_name|there}}! {{ order.total }} {{ city | your town }} {{gone|}}')).toMatchObject([
      { name: 'first_name', backup: 'there', whole: '{{first_name|there}}' },
      { name: 'order.total', backup: undefined },
      { name: 'city', backup: 'your town' },
      { name: 'gone', backup: '' },
    ]);
  });

  it('writes the value; the backup when the value is not there or is empty', () => {
    const text = 'Thanks, {{first_name|there}}!';
    expect(fillPlaceholders(text, { first_name: 'Lena' })).toBe('Thanks, Lena!');
    expect(fillPlaceholders(text, { first_name: '' })).toBe('Thanks, there!');
    expect(fillPlaceholders(text, { first_name: '   ' })).toBe('Thanks, there!');
    expect(fillPlaceholders(text, {})).toBe('Thanks, there!');
    expect(fillPlaceholders('Hello{{title|}}.', {})).toBe('Hello.');
  });

  it('with no bar reads as it always did: an empty value writes nothing, an unknown name is left as written', () => {
    expect(fillPlaceholders('a {{x}} b {{y}} c', { x: '' })).toBe('a  b {{y}} c');
    expect(fillPlaceholders('{{ x }}', { x: '1' })).toBe('1');
  });

  it('is not a placeholder with braces in the backup, a bar in the name, or nothing named', () => {
    expect(placeholdersIn('{{a|{{b}}}} {{|x}} {{a b|c}}').map((one) => one.name)).toEqual(['b']);
    expect(fillPlaceholders('{{x|a|b}}', {})).toBe('a|b');
  });

  it('names every placeholder a value reads, and apart from them the ones that must be given', () => {
    const doc = { subject: 'For {{name|you}}', blocks: [{ data: { text: '{{name}} {{city|}}', rows: [{ a: '{{total}}' }] } }] };
    expect(placeholderNames(doc)).toEqual(['name', 'city', 'total']);
    expect(requiredPlaceholderNames(doc)).toEqual(['name', 'total']);
  });

  it('writes one back, and a backup loses the braces it cannot hold', () => {
    expect(writePlaceholder('first_name')).toBe('{{first_name}}');
    expect(writePlaceholder('first_name', ' there ')).toBe('{{first_name|there}}');
    expect(writePlaceholder('first_name', 'a}}b')).toBe('{{first_name|ab}}');
  });

  it('a block tied to a value is left out without it, or says its other words when it is a text', () => {
    const blocks = [
      { block: 'email.text', id: 'a', showWhen: { var: 'first_name' }, otherwise: 'Thanks for ordering!', data: { paras: ['Thanks, {{first_name}}!'] } },
      { block: 'email.button', id: 'b', showWhen: { var: 'track_url' }, otherwise: 'never shown', data: { label: 'Track' } },
      { block: 'email.text', id: 'c', data: { text: 'Always.' } },
    ];
    expect(blocksShownFor(blocks, { first_name: 'Lena', track_url: 'https://x.example' })).toEqual(blocks);
    const shown = blocksShownFor(blocks, { first_name: ' ' });
    expect(shown.map((block) => block.id)).toEqual(['a', 'c']);
    expect(shown[0]).toMatchObject({ data: { text: 'Thanks for ordering!' } });
    expect(showWhenOf({ showWhen: { var: 'a b' } })).toBeNull();
    expect(showWhenNames(blocks)).toEqual(['first_name', 'track_url']);
  });
});

describe('what only the editor needs', () => {
  it('sets, changes and takes away the backup of one placeholder of a text, by its place', () => {
    const text = 'Hi {{first_name}}, {{first_name}} of {{city|town}}';
    expect(withBackup(text, 1, 'there')).toBe('Hi {{first_name}}, {{first_name|there}} of {{city|town}}');
    expect(withBackup(text, 2, 'your city')).toBe('Hi {{first_name}}, {{first_name}} of {{city|your city}}');
    expect(withBackup(text, 2, '')).toBe('Hi {{first_name}}, {{first_name}} of {{city}}');
    expect(withBackup(text, 2, undefined)).toBe('Hi {{first_name}}, {{first_name}} of {{city}}');
    expect(withBackup(text, 9, 'x')).toBe(text);
  });

  it('draws a value as a reader with nothing filled meets it', () => {
    expect(asMissing({ text: 'Hi {{name|there}}', rows: ['{{a}}', { b: '{{c|}}!' }], n: 3 })).toEqual({ text: 'Hi there', rows: ['{{a}}', { b: '!' }], n: 3 });
  });

  it('says a name as a person does, and lists the names a document answers for itself', () => {
    expect(spokenName('first_name')).toBe('first name');
    expect(spokenName('customer_id.first-name')).toBe('first name');
    expect(answeredNames({ subject: '{{a|x}} {{b}}', preheader: '', footer: '{{f|}}', blocks: [{ showWhen: { var: 'c' }, data: { text: '{{d}} {{e|y}}' } }] })).toEqual(['a', 'e', 'f', 'c']);
  });
});
